# Fixed deployment root, independent of the caller's cwd and old .env settings.
$ttsRoot = $PSScriptRoot
if (-not $ModelVersion) {
    $selectionFile = Join-Path $ttsRoot 'runtime\selected-model.json'
    $ModelVersion = if ($env:TTS_LOCAL_MODEL) { $env:TTS_LOCAL_MODEL } elseif (Test-Path -LiteralPath $selectionFile) { (Get-Content -LiteralPath $selectionFile -Raw | ConvertFrom-Json).model } else { '2.0' }
}
if ($ModelVersion -in @('2.5', 'voxcpm-2.0')) { $ModelVersion = '2.0' }
if ($ModelVersion -ne '2.0') { throw 'Unsupported local TTS model.' }
$env:TTS_LOCAL_MODEL = $ModelVersion
$bundleRoot = Join-Path $ttsRoot 'runtime'
$catalog = Get-Content -LiteralPath (Join-Path $ttsRoot 'local-models.json') -Raw | ConvertFrom-Json
$modelEntry = $catalog | Where-Object { $_.id -eq $ModelVersion }
$engineRoot = Join-Path $bundleRoot $modelEntry.directory
$upstream = Join-Path $engineRoot 'source'
$python = Join-Path $upstream '.venv\Scripts\python.exe'
$env:TTS_MODEL_DIR = Join-Path $engineRoot 'checkpoints'
$env:PYTHONPATH = $upstream
$env:PYTHONUTF8 = '1'
$env:PYTHONNOUSERSITE = '1'
$env:HF_HOME = Join-Path $ttsRoot 'cache\huggingface'
$env:HF_HUB_CACHE = Join-Path $env:TTS_MODEL_DIR 'hf_cache'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:TORCH_HOME = Join-Path $ttsRoot 'cache\torch'
$env:NUMBA_CACHE_DIR = Join-Path $ttsRoot 'cache\numba'
$env:PATH = (Join-Path $bundleRoot 'tools\ffmpeg\bin') + ';' + $env:PATH

function Initialize-TtsRuntime {
    param([switch]$RuntimeOnly)
    $manifestPath = Join-Path $bundleRoot 'runtime.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw 'TTS runtime missing. Run tts-service/setup.ps1, or extract the complete offline bundle into tts-service.'
    }
    $runtime = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $baseDir = [IO.Path]::GetFullPath((Join-Path $bundleRoot $runtime.python_home))
    if (-not $baseDir.StartsWith($bundleRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Invalid Python path in TTS runtime.json'
    }
    $basePython = Join-Path $baseDir 'python.exe'
    if (-not (Test-Path -LiteralPath $basePython)) { throw 'Bundled Python missing. Extract the complete offline bundle into tts-service.' }
    & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') migrate
    if ($LASTEXITCODE -ne 0) { throw 'Unable to migrate the old IndexTTS installation.' }
    & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') prepare --model $ModelVersion
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the offline TTS environment.' }
    if (-not $RuntimeOnly) {
        & $python -X utf8 (Join-Path $ttsRoot 'deployment.py') check --model $ModelVersion
        if ($LASTEXITCODE -ne 0) { throw 'TTS files incomplete. Run setup.ps1 or extract the complete offline bundle into tts-service.' }
    }
    foreach ($tool in @('ffmpeg', 'ffprobe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot "tools\ffmpeg\bin\$tool.exe"))) {
            throw "Missing tools/ffmpeg/bin/$tool.exe. Run setup.ps1 or extract the complete offline bundle."
        }
    }
    & $python -X utf8 (Join-Path $ttsRoot 'deployment.py') check-runtime --model $ModelVersion
    if ($LASTEXITCODE -ne 0) { throw 'Python dependencies incomplete. Run setup.ps1 or extract the complete offline bundle.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $ttsRoot 'logs') | Out-Null
}
