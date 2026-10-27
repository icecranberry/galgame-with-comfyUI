# Fixed deployment root, independent of the caller's cwd and old .env settings.
$ttsRoot = $PSScriptRoot
$bundleRoot = Join-Path $ttsRoot 'runtime'
$upstream = Join-Path $bundleRoot 'index-tts'
$python = Join-Path $upstream '.venv\Scripts\python.exe'
$env:TTS_MODEL_DIR = Join-Path $bundleRoot 'checkpoints'
$env:PYTHONPATH = $upstream
$env:PYTHONUTF8 = '1'
$env:PYTHONNOUSERSITE = '1'
$env:HF_HOME = Join-Path $ttsRoot 'cache\huggingface'
$env:HF_HUB_CACHE = Join-Path $bundleRoot 'checkpoints\hf_cache'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:TORCH_HOME = Join-Path $ttsRoot 'cache\torch'
$env:NUMBA_CACHE_DIR = Join-Path $ttsRoot 'cache\numba'
$env:PATH = (Join-Path $bundleRoot 'tools\ffmpeg\bin') + ';' + $env:PATH

function Initialize-TtsRuntime {
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
    & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') prepare
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare the offline TTS environment.' }
    & $python -X utf8 (Join-Path $ttsRoot 'deployment.py') check
    if ($LASTEXITCODE -ne 0) { throw 'TTS files incomplete. Run setup.ps1 or extract the complete offline bundle into tts-service.' }
    foreach ($tool in @('ffmpeg', 'ffprobe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot "tools\ffmpeg\bin\$tool.exe"))) {
            throw "Missing tools/ffmpeg/bin/$tool.exe. Run setup.ps1 or extract the complete offline bundle."
        }
    }
    & $python -X utf8 (Join-Path $ttsRoot 'deployment.py') check-runtime
    if ($LASTEXITCODE -ne 0) { throw 'Python dependencies incomplete. Run setup.ps1 or extract the complete offline bundle.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $ttsRoot 'logs') | Out-Null
}
