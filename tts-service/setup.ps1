param([switch]$CheckOnly, [ValidateSet('2.0')][string]$ModelVersion)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')
if ($CheckOnly) { Initialize-TtsRuntime; exit 0 }

# A complete selected engine is sufficient. Never fetch another model.
if (Test-Path -LiteralPath (Join-Path $bundleRoot 'runtime.json')) {
    try { Initialize-TtsRuntime; Write-Host 'Selected offline engine ready.'; exit 0 }
    catch { Write-Host "Incomplete installation: $($_.Exception.Message)" }
}
$versions = Get-Content -LiteralPath (Join-Path $ttsRoot $modelEntry.manifest) -Raw | ConvertFrom-Json
$downloads = Join-Path $ttsRoot 'cache\downloads'
New-Item -ItemType Directory -Force -Path $downloads, (Join-Path $bundleRoot 'tools'), $engineRoot | Out-Null
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
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $archive; break }
        catch { if ($attempt -eq 3) { throw }; Start-Sleep -Seconds (2 * $attempt) }
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    return $stage
}

try {
    $basePython = $null
    $runtimeManifest = Join-Path $bundleRoot 'runtime.json'
    if (Test-Path -LiteralPath $runtimeManifest) {
        $runtime = Get-Content -LiteralPath $runtimeManifest -Raw | ConvertFrom-Json
        $baseDir = [IO.Path]::GetFullPath((Join-Path $bundleRoot $runtime.python_home))
        if (-not $baseDir.StartsWith($bundleRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid bundled Python path.' }
        $candidate = Join-Path $baseDir 'python.exe'
        if (Test-Path -LiteralPath $candidate) { $basePython = $candidate }
    }
    # Reuse a complete per-engine environment even when only weights are absent.
    $dependenciesReady = $false
    if ($basePython) {
        & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') migrate
        if ($LASTEXITCODE -ne 0) { throw 'Cannot migrate legacy installation.' }
        if (Test-Path -LiteralPath $python) {
            & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') prepare --model $ModelVersion
            & $python -X utf8 (Join-Path $ttsRoot 'deployment.py') check-runtime --model $ModelVersion
            $dependenciesReady = $LASTEXITCODE -eq 0
        }
    }
    $uv = Join-Path $bundleRoot 'tools\uv.exe'
    if (-not $dependenciesReady) {
        if (-not (Test-Path -LiteralPath $uv)) {
            $stage = Expand-TtsDownload 'https://github.com/astral-sh/uv/releases/download/0.12.1/uv-x86_64-pc-windows-msvc.zip' 'uv'
            Copy-Item -LiteralPath (Join-Path $stage 'uv.exe') -Destination $uv
        }
        if (-not $basePython) {
            & $uv python install 3.11.13 --no-bin --no-registry
            if ($LASTEXITCODE -ne 0) { throw 'Python download failed.' }
            $basePython = (& $uv python find 3.11.13 --managed-python --no-python-downloads).Trim()
            if ($LASTEXITCODE -ne 0) { throw 'Bundled Python not found.' }
            & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') record-python --python-home (Split-Path $basePython)
            if ($LASTEXITCODE -ne 0) { throw 'Cannot record bundled Python path.' }
        }
    }
    if (-not (Test-Path -LiteralPath $upstream)) {
        $project = 'index-tts/index-tts'
        $name = 'index-tts'
        $stage = Expand-TtsDownload "https://github.com/$project/archive/$($versions.code_revision).zip" $modelEntry.directory
        $sourceDir = [IO.Path]::GetFullPath((Join-Path $stage "$name-$($versions.code_revision)"))
        if (-not $sourceDir.StartsWith($downloads + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source staging path.' }
        Move-Item -LiteralPath $sourceDir -Destination $upstream
        & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') seal-source --model $ModelVersion
        if ($LASTEXITCODE -ne 0) { throw 'Cannot record source version.' }
    }
    & $basePython -X utf8 (Join-Path $ttsRoot 'deployment.py') check-source --model $ModelVersion
    if ($LASTEXITCODE -ne 0) { throw 'Source version invalid. Restore the selected model from a matching offline bundle.' }
    if (-not $dependenciesReady) {
        Push-Location $upstream
        try {
            & $uv sync --frozen --no-editable --python $basePython --no-python-downloads
            if ($LASTEXITCODE -ne 0) { throw 'IndexTTS dependencies failed to install.' }
        } finally { Pop-Location }
    }
    $ffmpegDir = Join-Path $bundleRoot 'tools\ffmpeg'
    if (-not (Test-Path -LiteralPath (Join-Path $ffmpegDir 'bin\ffmpeg.exe')) -or
        -not (Test-Path -LiteralPath (Join-Path $ffmpegDir 'bin\ffprobe.exe'))) {
        $stage = Expand-TtsDownload 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' 'ffmpeg'
        $distribution = @(Get-ChildItem -LiteralPath $stage -Directory)[0]
        New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
        Get-ChildItem -LiteralPath $distribution.FullName -Force | Copy-Item -Destination $ffmpegDir -Recurse -Force
    }
    & $python -X utf8 (Join-Path $ttsRoot 'download_model.py')
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed; retained downloads will resume on retry.' }
    $env:HF_HUB_OFFLINE = '1'
    $env:TRANSFORMERS_OFFLINE = '1'
    Initialize-TtsRuntime
    & $python -X utf8 (Join-Path $ttsRoot 'compact_runtime.py') --apply
    if ($LASTEXITCODE -ne 0) { throw 'Cannot compact the inference runtime.' }
    Write-Host "$($modelEntry.label) ready. Start with: .\tts-service\start.ps1 -ModelVersion $ModelVersion"
} catch {
    throw "TTS setup failed: $($_.Exception.Message) Retry this model, or extract its offline package into tts-service. Other models are not required."
}
