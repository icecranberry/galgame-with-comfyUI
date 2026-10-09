param([string]$RuntimeDir = (Join-Path $PSScriptRoot 'runtime'))
$ErrorActionPreference = 'Stop'
$RuntimeDir = [System.IO.Path]::GetFullPath($RuntimeDir)
$upstream = Join-Path $RuntimeDir 'index-tts'
if (-not (Test-Path -LiteralPath $upstream)) { throw 'Run tts-service/setup.ps1 first' }
if (-not $env:TTS_MODEL_DIR) { $env:TTS_MODEL_DIR = Join-Path $upstream 'checkpoints' }
Push-Location $upstream
try { & (Join-Path $upstream '.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'server.py') }
finally { Pop-Location }
