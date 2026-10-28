param([ValidateSet('2.0')][string]$ModelVersion)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Initialize-TtsRuntime
Push-Location $upstream
try { & $python -X utf8 (Join-Path $PSScriptRoot 'server.py') }
finally { Pop-Location }
