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
# A bundled interpreter must not inherit another Python installation's home.
Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
$env:PYTHONUTF8 = '1'
$env:PYTHONNOUSERSITE = '1'
$env:HF_HOME = Join-Path $ttsRoot 'cache\huggingface'
$env:HF_HUB_CACHE = Join-Path $env:TTS_MODEL_DIR 'hf_cache'
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:TORCH_HOME = Join-Path $ttsRoot 'cache\torch'
$env:NUMBA_CACHE_DIR = Join-Path $ttsRoot 'cache\numba'
$env:PATH = (Join-Path $bundleRoot 'tools\ffmpeg\bin') + ';' + $env:PATH

# Restore defaults for child tools in a narrowed launcher environment.
# A null LASTEXITCODE alone is not evidence of a missing environment variable.
$systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
$windowsDirectory = [IO.Directory]::GetParent($systemDirectory).FullName
$env:SystemRoot = $windowsDirectory
$env:windir = $windowsDirectory
$env:SystemDrive = [IO.Path]::GetPathRoot($windowsDirectory).TrimEnd('\')
$env:ComSpec = Join-Path $systemDirectory 'cmd.exe'
$extensions = @($env:PATHEXT -split ';' | Where-Object { $_ -match '^\.[A-Za-z0-9]+$' })
foreach ($extension in @('.COM', '.EXE', '.BAT', '.CMD')) {
    if ($extension -notin $extensions) { $extensions += $extension }
}
$env:PATHEXT = $extensions -join ';'

# Record evidence without dumping the inherited environment (which can contain
# secrets). Failure to write diagnostics must never hide the original error.
function Write-TtsStartupLog {
    param([string]$Message)
    try {
        $directory = Join-Path $ttsRoot 'logs'
        New-Item -ItemType Directory -Force -Path $directory -ErrorAction Stop | Out-Null
        $log = Join-Path $directory 'tts-startup.log'
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
            Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force -ErrorAction Stop
        }
        [IO.File]::AppendAllText($log, "[$([DateTime]::Now.ToString('s'))] $Message`r`n", [Text.UTF8Encoding]::new($false))
    }
    catch { Write-Warning "无法写入 TTS 启动日志：$($_.Exception.Message)" }
}

# Quote Windows argv for ProcessStartInfo on Windows PowerShell 5.1 (.NET
# Framework has no ArgumentList). Escape quotes and trailing backslashes.
function ConvertTo-TtsProcessArgument {
    param([AllowEmptyString()][string]$Value)
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

# Start the executable directly, independent of PowerShell command discovery
# and LASTEXITCODE. Keep OS launch errors distinct from Python failures.
function Invoke-TtsDeploymentStep {
    [CmdletBinding(PositionalBinding = $false)]
    param(
        [Parameter(Mandatory)][string]$Python,
        [Parameter(Mandatory)][string]$FailMessage,
        [ValidateRange(1, 300)][int]$TimeoutSeconds = 60,
        [switch]$Probe,
        [Parameter(Mandatory, Position = 0, ValueFromRemainingArguments)][string[]]$StepArgs
    )
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = $Python
    $arguments = if ($Probe) { @('-X', 'utf8', '-c', 'import sys, encodings, json; print(sys.version); print(sys.executable)') } else { @('-X', 'utf8', (Join-Path $ttsRoot 'deployment.py')) + $StepArgs }
    $step = if ($Probe) { 'python-self-check' } else { $StepArgs -join ' ' }
    $process.StartInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-TtsProcessArgument $_ }) -join ' ')
    $process.StartInfo.WorkingDirectory = $ttsRoot
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $process.StartInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    Write-TtsStartupLog "开始步骤：$step；程序：$Python"
    try {
        try { [void]$process.Start() }
        catch {
            $cause = $_.Exception.GetBaseException()
            $code = if ($cause -is [ComponentModel.Win32Exception]) { " (Win32 $($cause.NativeErrorCode))" } else { '' }
            throw "$FailMessage`n无法启动 Python$code：$($cause.Message)`n程序：$Python"
        }
        # Drain both pipes concurrently: a full stderr pipe must not deadlock
        # while the parent waits for stdout (or vice versa).
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Deployment steps do not spawn workers. Stop only this exact child.
            $process.Kill()
            if ($process.WaitForExit(5000)) {
                Write-TtsStartupLog ($stderr.GetAwaiter().GetResult() + "`n" + $stdout.GetAwaiter().GetResult())
            }
            throw "$FailMessage`n步骤 $step 超时（$TimeoutSeconds 秒）；程序：$Python"
        }
        $exitCode = $process.ExitCode
        $detail = ($stderr.GetAwaiter().GetResult() + "`n" + $stdout.GetAwaiter().GetResult()).Trim()
        Write-TtsStartupLog "完成步骤：$step；退出码：$exitCode`n$detail"
        if ($exitCode -ne 0) {
            if (-not $detail) { $detail = 'Python 未输出诊断信息，请检查运行包完整性及 Windows 应用程序错误记录。' }
            throw "$FailMessage（退出码 $exitCode）`n$detail`n程序：$Python"
        }
    }
    catch {
        Write-TtsStartupLog "失败步骤：$step`n$($_.Exception.Message)"
        throw
    }
    finally { $process.Dispose() }
}

function Initialize-TtsRuntimeFiles {
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
    if (-not (Test-Path -LiteralPath $basePython -PathType Leaf)) {
        throw "缺少内置 Python：$basePython。请补齐离线包。"
    }
    Invoke-TtsDeploymentStep -Python $basePython -FailMessage '内置 Python 自检失败。' -Probe -StepArgs @('self-check')
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

function Initialize-TtsRuntime {
    param([switch]$RuntimeOnly, [switch]$SkipMigration)
    try { Initialize-TtsRuntimeFiles -RuntimeOnly:$RuntimeOnly -SkipMigration:$SkipMigration }
    catch {
        Write-TtsStartupLog "初始化失败：$($_.Exception.Message)"
        throw
    }
}
