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

# The GUI launcher hands child processes a narrowed environment that can lack
# PATHEXT, SystemDrive, windir or ComSpec. Without PATHEXT, PowerShell on some
# machines refuses to run an .exe as a command: no output, $LASTEXITCODE stays
# $null, and callers only see a generic "cannot migrate" message. Restore the
# system defaults here so every entry script (start/setup/restart/package)
# works regardless of the launching environment.
if (-not $env:PATHEXT) { $env:PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC' }
if (-not $env:ComSpec) { $env:ComSpec = Join-Path $env:SystemRoot 'System32\cmd.exe' }
if (-not $env:SystemDrive) { $env:SystemDrive = [IO.Path]::GetPathRoot($env:SystemRoot) }
if (-not $env:windir) { $env:windir = $env:SystemRoot }

# Runs one deployment.py step and, on failure, surfaces python's real output
# and exit code. With $ErrorActionPreference='Stop' (restart.ps1) a bare native
# call turns its first stderr line into a NativeCommandError and callers only
# end up showing the generic message without any python detail.
function Invoke-TtsDeploymentStep {
    param(
        [Parameter(Mandatory)][string]$Python,
        [Parameter(Mandatory)][string]$FailMessage,
        [Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$StepArgs
    )
    $ErrorActionPreference = 'Continue'
    $output = & $Python -X utf8 (Join-Path $ttsRoot 'deployment.py') @StepArgs 2>&1
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
        # PowerShell never started the process (e.g. missing PATHEXT in a
        # narrowed launcher environment); it leaves no output and no exit code.
        throw "$FailMessage（命令未被执行：退出码为空）`n无法运行：$Python`n启动环境可能缺少 PATHEXT/ComSpec 等系统变量。"
    }
    if ($exitCode -ne 0) {
        $detail = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
        if (-not $detail) {
            $detail = 'python 没有任何输出：可能是杀软拦截/隔离了 runtime 内置的 python，或压缩包解压不完整。'
        }
        throw "$FailMessage（退出码 $exitCode）`n$detail"
    }
}

function Initialize-TtsRuntime {
    param([switch]$RuntimeOnly, [switch]$SkipMigration)
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
    # Migration belongs to setup/upgrade. restart.ps1 calls this after the old
    # service is stopped so the legacy directories are no longer locked.
    if (-not $SkipMigration) {
        Invoke-TtsDeploymentStep -Python $basePython -FailMessage 'Unable to migrate the old IndexTTS installation.' migrate
    }
    Invoke-TtsDeploymentStep -Python $basePython -FailMessage 'Unable to prepare the offline TTS environment.' prepare --model $ModelVersion
    if (-not $RuntimeOnly) {
        Invoke-TtsDeploymentStep -Python $python -FailMessage 'TTS files incomplete. Run setup.ps1 or extract the complete offline bundle into tts-service.' check --model $ModelVersion
    }
    foreach ($tool in @('ffmpeg', 'ffprobe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot "tools\ffmpeg\bin\$tool.exe"))) {
            throw "Missing tools/ffmpeg/bin/$tool.exe. Run setup.ps1 or extract the complete offline bundle."
        }
    }
    Invoke-TtsDeploymentStep -Python $python -FailMessage 'Python dependencies incomplete. Run setup.ps1 or extract the complete offline bundle.' check-runtime --model $ModelVersion
    New-Item -ItemType Directory -Force -Path (Join-Path $ttsRoot 'logs') | Out-Null
}
