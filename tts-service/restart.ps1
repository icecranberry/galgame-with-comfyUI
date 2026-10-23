param(
    [string]$RuntimeDir = $(if ($env:TTS_RUNTIME_DIR) { $env:TTS_RUNTIME_DIR } else { Join-Path $PSScriptRoot 'runtime' }),
    [ValidateRange(1, 65535)][int]$Port = 7861
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$RuntimeDir = [System.IO.Path]::GetFullPath($RuntimeDir)
$upstream = Join-Path $RuntimeDir 'index-tts'
$python = Join-Path $upstream '.venv\Scripts\python.exe'
$serverFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.py'))
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw 'TTS runtime missing. Run tts-service/setup.ps1, or set TTS_RUNTIME_DIR to the installed runtime directory.'
}

# Only terminate this checkout's exact adapter, never arbitrary Python or port owners.
$serverPattern = '(?i)(?:^|[\s"])' + [regex]::Escape($serverFile).Replace('\\', '[\\/]') + '(?:"|\s|$)'
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" |
    Where-Object { $_.CommandLine -match $serverPattern })
$processIds = @($processes | ForEach-Object { $_.ProcessId })
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if (@($listeners | Where-Object { $_.OwningProcess -notin $processIds }).Count) {
    throw "Port $Port is occupied by another process; no process was stopped."
}
foreach ($process in $processes) {
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
        # Include multiprocessing workers so no CUDA context survives the restart.
        & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
            throw "Unable to stop TTS process $($process.ProcessId)."
        }
    }
}
$deadline = (Get-Date).AddSeconds(10)
while (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { throw "TTS port $Port did not close." }
    Start-Sleep -Milliseconds 200
}
$env:TTS_PORT = [string]$Port
if (-not $env:TTS_MODEL_DIR) { $env:TTS_MODEL_DIR = Join-Path $upstream 'checkpoints' }
Start-Process -FilePath $python -ArgumentList @('-X', 'utf8', ('"' + $serverFile + '"')) `
    -WorkingDirectory $upstream -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RuntimeDir 'tts-stdout.log') `
    -RedirectStandardError (Join-Path $RuntimeDir 'tts-stderr.log') | Out-Null
