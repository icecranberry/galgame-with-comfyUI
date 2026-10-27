param([string]$OutputPath = (Join-Path $PSScriptRoot 'dist\linshe-tts-runtime.zip'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Initialize-TtsRuntime
& $python -X utf8 (Join-Path $PSScriptRoot 'pack_runtime.py') --output $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'TTS offline package creation failed.' }
