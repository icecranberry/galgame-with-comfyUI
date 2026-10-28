param([string]$OutputPath, [ValidateSet('2.0')][string]$ModelVersion = '2.0', [switch]$ModelOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Initialize-TtsRuntime
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot "dist\linshe-tts-$($modelEntry.directory)$(if ($ModelOnly) { '-model' }).zip" }
$packArgs = @('--output', $OutputPath, '--model', $ModelVersion)
if ($ModelOnly) { $packArgs += '--model-only' }
& $python -X utf8 (Join-Path $PSScriptRoot 'pack_runtime.py') @packArgs
if ($LASTEXITCODE -ne 0) { throw 'TTS offline package creation failed.' }
