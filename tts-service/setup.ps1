param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')
if ($CheckOnly) { Initialize-TtsRuntime; exit 0 }

# Complete extracted bundles never need network, Git, uv or global Python.
if (Test-Path -LiteralPath (Join-Path $bundleRoot 'runtime.json')) {
    try { Initialize-TtsRuntime; Write-Host 'Offline bundle ready.'; exit 0 }
    catch { Write-Host "Incomplete installation: $($_.Exception.Message)" }
}
$versions = Get-Content (Join-Path $ttsRoot 'versions.json') -Raw | ConvertFrom-Json
$downloads = Join-Path $ttsRoot 'cache\downloads'
New-Item -ItemType Directory -Force -Path $downloads, (Join-Path $bundleRoot 'tools') | Out-Null
$env:UV_CACHE_DIR = Join-Path $ttsRoot 'cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $bundleRoot 'python'
$env:UV_PYTHON_CACHE_DIR = Join-Path $ttsRoot 'cache\python'
$env:UV_LINK_MODE = 'copy'
$env:UV_PROJECT_ENVIRONMENT = Join-Path $upstream '.venv'
$env:HF_HUB_OFFLINE = '0'
$env:TRANSFORMERS_OFFLINE = '0'

function Expand-TtsDownload([string]$Url, [string]$Name) {
    $archive = Join-Path $downloads ($Name + '.zip')
    $stage = Join-Path $downloads ($Name + '-' + [guid]::NewGuid().ToString('N'))
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    return $stage
}

try {
    $uv = Join-Path $bundleRoot 'tools\uv.exe'
    if (-not (Test-Path -LiteralPath $uv)) {
        $stage = Expand-TtsDownload 'https://github.com/astral-sh/uv/releases/download/0.12.1/uv-x86_64-pc-windows-msvc.zip' 'uv'
        Copy-Item -LiteralPath (Join-Path $stage 'uv.exe') -Destination $uv
    }
    & $uv python install 3.11.13 --no-bin --no-registry
    if ($LASTEXITCODE -ne 0) { throw 'Python download failed.' }
    $basePython = (& $uv python find 3.11.13 --managed-python --no-python-downloads).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Bundled Python not found.' }

    if (-not (Test-Path -LiteralPath $upstream)) {
        $stage = Expand-TtsDownload "https://github.com/index-tts/index-tts/archive/$($versions.code_revision).zip" 'index-tts'
        $sourceDir = [IO.Path]::GetFullPath((Join-Path $stage "index-tts-$($versions.code_revision)"))
        if (-not $sourceDir.StartsWith($downloads + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source staging path.' }
        Move-Item -LiteralPath $sourceDir -Destination $upstream
        & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') seal-source
        if ($LASTEXITCODE -ne 0) { throw 'Cannot record source version.' }
    }
    & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') check-source
    if ($LASTEXITCODE -ne 0) { throw 'Source version invalid. Restore index-tts from a matching offline bundle.' }
    Push-Location $upstream
    try {
        & $uv sync --frozen --no-editable --python $basePython --no-python-downloads
        if ($LASTEXITCODE -ne 0) { throw 'Python dependencies failed to install.' }
    } finally { Pop-Location }
    & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') record-python --python-home (Split-Path $basePython)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot record bundled Python path.' }
    & $python -X utf8 (Join-Path $ttsRoot 'download_model.py')
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }

    $ffmpegDir = Join-Path $bundleRoot 'tools\ffmpeg'
    if (-not (Test-Path -LiteralPath (Join-Path $ffmpegDir 'bin\ffmpeg.exe')) -or
        -not (Test-Path -LiteralPath (Join-Path $ffmpegDir 'bin\ffprobe.exe'))) {
        $stage = Expand-TtsDownload 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' 'ffmpeg'
        $distribution = @(Get-ChildItem -LiteralPath $stage -Directory)[0]
        New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
        Get-ChildItem -LiteralPath $distribution.FullName -Force | Copy-Item -Destination $ffmpegDir -Recurse -Force
    }
    $env:HF_HUB_OFFLINE = '1'
    $env:TRANSFORMERS_OFFLINE = '1'
    Initialize-TtsRuntime
    Write-Host 'Ready. Start with: .\tts-service\start.ps1'
} catch {
    throw "TTS setup failed: $($_.Exception.Message) Downloaded files remain in tts-service. Retry setup.ps1, or extract the complete offline bundle into this folder, then run setup.ps1 -CheckOnly."
}
