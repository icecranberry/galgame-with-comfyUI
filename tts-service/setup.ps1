param([string]$RuntimeDir = (Join-Path $PSScriptRoot 'runtime'))
$ErrorActionPreference = 'Stop'
$RuntimeDir = [System.IO.Path]::GetFullPath($RuntimeDir)
$versions = Get-Content (Join-Path $PSScriptRoot 'versions.json') -Raw | ConvertFrom-Json
Get-Command git, uv -ErrorAction Stop | Out-Null
$upstream = Join-Path $RuntimeDir 'index-tts'
if (-not (Test-Path -LiteralPath $upstream)) {
  git clone https://github.com/index-tts/index-tts.git $upstream
  if ($LASTEXITCODE -ne 0) { throw 'IndexTTS clone failed' }
}
$dirty = git -C $upstream status --porcelain
if ($dirty) { throw 'IndexTTS checkout has local changes; choose a separate RuntimeDir' }
git -C $upstream checkout --detach $versions.code_revision
if ($LASTEXITCODE -ne 0) { throw 'Cannot select pinned IndexTTS revision' }
Push-Location $upstream
try {
  # Core dependencies only. No DeepSpeed or web UI is needed for this adapter.
  uv sync --frozen --python 3.11
  if ($LASTEXITCODE -ne 0) { throw 'IndexTTS dependencies failed to install' }
  $env:TTS_MODEL_DIR = Join-Path $upstream 'checkpoints'
  & (Join-Path $upstream '.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'download_model.py')
  if ($LASTEXITCODE -ne 0) { throw 'Pinned model download failed' }
} finally { Pop-Location }
Write-Host "Ready. Start with: .\tts-service\start.ps1 -RuntimeDir `"$RuntimeDir`""
