param(
    # Older running Node backends still pass this argument. Accept but ignore it:
    # deployment always belongs to this checkout's tts-service directory.
    [string]$RuntimeDir,
    [ValidateSet('2.0')][string]$ModelVersion,
    [ValidateRange(1, 65535)][int]$Port = 7861,
    [switch]$StartOnly
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')
Initialize-TtsRuntime
$serverFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.py'))

# Only terminate this checkout's exact adapter, never arbitrary Python or port owners.
$serverPattern = '(?i)(?:^|[\s"])' + [regex]::Escape($serverFile).Replace('\\', '[\\/]') + '(?:"|\s|$)'
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" |
    Where-Object { $_.CommandLine -match $serverPattern })
$processIds = @($processes | ForEach-Object { $_.ProcessId })
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($StartOnly -and ($processes.Count -or $listeners.Count)) {
    throw 'TTS is already starting or not responding; automatic startup will not stop a running service.'
}
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
Start-Process -FilePath $python -ArgumentList @('-X', 'utf8', ('"' + $serverFile + '"')) `
    -WorkingDirectory $upstream -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $ttsRoot 'logs\tts-stdout.log') `
    -RedirectStandardError (Join-Path $ttsRoot 'logs\tts-stderr.log') | Out-Null
[IO.File]::WriteAllText((Join-Path $bundleRoot 'selected-model.json'), (@{ model = $ModelVersion } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
