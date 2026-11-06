param([string]$ComfyRoot, [string]$ComfyUrl = $env:TTS_COMFYUI_URL, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Get-GuardHash([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
# Resolve only an explicitly selected installation, never scan the whole disk.
if ($ComfyUrl) {
    $uri = [uri]$ComfyUrl
    $localNames = @('localhost', '127.0.0.1', '[::1]', '::1', [Environment]::MachineName)
    $localNames += @([Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | ForEach-Object { $_.ToString() })
    if ($uri.Host -notin $localNames) {
        Write-Host "ComfyUI 位于远程地址 $ComfyUrl；未修改本机节点，请在该服务主机安装守卫。"
        return
    }
}
$explicitRoot = [bool]$ComfyRoot
if (-not $ComfyRoot) {
    $configPath = Join-Path (Split-Path $PSScriptRoot) 'launcher_config.json'
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        Write-Warning '未找到 ComfyUI 配置。守卫尚未安装：请配置启动器路径，或运行 install-comfy-guard.ps1 -ComfyRoot <ComfyUI目录>。'
        return
    }
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $executable = $config.comfyui_exe
    if (-not $executable -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        Write-Warning "ComfyUI 启动器路径未配置或已失效：$executable。守卫尚未安装，请修正路径或显式指定 -ComfyRoot。"
        return
    }
    $parent = Split-Path ([IO.Path]::GetFullPath($executable))
    $candidates = @($parent, (Join-Path $parent 'ComfyUI'))
} else { $candidates = @([IO.Path]::GetFullPath($ComfyRoot)) }
$roots = @($candidates | Select-Object -Unique | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_ 'main.py') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_ 'server.py') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_ 'comfy') -PathType Container) -and
    (Test-Path -LiteralPath (Join-Path $_ 'custom_nodes') -PathType Container)
})
if ($roots.Count -ne 1) {
    $message = '无法唯一确认 ComfyUI 根目录（需包含 main.py、server.py、comfy、custom_nodes）。请用 -ComfyRoot 指定实际运行的目录。'
    if ($explicitRoot) { throw $message }
    Write-Warning $message
    return
}
$targetDirectory = Join-Path $roots[0] 'custom_nodes\linshe_tts_guard'
$target = Join-Path $targetDirectory '__init__.py'
$source = Join-Path $PSScriptRoot 'comfy_guard\__init__.py'
# Refuse redirected destinations; do not overwrite through junctions/symlinks.
$ancestor = $targetDirectory
while ($ancestor) {
    if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "节点目录包含链接，请确认实际目录后安装：$ancestor"
    }
    $ancestor = Split-Path $ancestor -Parent
}
if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "节点文件是链接，未覆盖：$target"
}
$hash = Get-GuardHash $source
$same = (Test-Path -LiteralPath $target -PathType Leaf) -and ((Get-GuardHash $target) -eq $hash)
if (-not $same -and -not $CheckOnly) {
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $backup = $target + '.' + [guid]::NewGuid().ToString('N') + '.bak'
        Copy-Item -LiteralPath $target -Destination $backup
        Write-Host "已备份旧节点：$backup"
    }
    $temporary = Join-Path $targetDirectory ([guid]::NewGuid().ToString('N') + '.tmp')
    try {
        Copy-Item -LiteralPath $source -Destination $temporary
        Move-Item -LiteralPath $temporary -Destination $target -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
    Write-Host "守卫文件已安装：$target"
} elseif ($same) { Write-Host "守卫文件已是当前版本：$target" }
else { Write-Warning "守卫文件缺失或版本不一致：$target（只检查，未修改）" }
if ($ComfyUrl) {
    try {
        $status = Invoke-RestMethod -Uri ($ComfyUrl.TrimEnd('/') + '/linshe/gpu/status') -Method Get -TimeoutSec 3
        if ($status.guard -eq 'linshe_tts_guard' -and $status.source_sha256 -eq $hash) {
            Write-Host '当前 ComfyUI 已加载本版本守卫。'
            return
        }
    } catch { Write-Host "守卫只读探测未通过：$($_.Exception.Message)" }
}
Write-Warning '尚未确认当前 ComfyUI 已加载本版本守卫。请等待绘图队列结束后重启 ComfyUI，再从邻舍生成试听；安装程序不会自动重启。'
