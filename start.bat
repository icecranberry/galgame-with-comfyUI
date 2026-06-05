@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

title AI Agent Launcher
cls

echo.
echo  ============================================
echo    AI Agent - Image Generation Agent
echo  ============================================
echo.

echo [0/5] Cleaning up...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING" 2^>nul') do taskkill /f /pid %%a >nul 2>nul
echo   Done

echo [1/5] Checking environment...
where node >nul 2>nul || (echo [ERROR] Node.js not found && pause && exit /b 1)
for /f "tokens=*" %%i in ('node -v 2^>^&1') do echo   Node.js: %%i
where python >nul 2>nul || (echo [ERROR] Python not found && pause && exit /b 1)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   Python: %%i

echo.
echo [2/5] Checking agent-core deps...
cd /d "%ROOT%\agent-core"
if not exist "node_modules\" (
    echo   Running npm install...
    call npm install
    if %errorlevel% neq 0 (echo [ERROR] npm install failed && pause && exit /b 1)
    echo   Done
)

echo.
echo [3/5] Building Web UI...
cd /d "%ROOT%\web-ui"
if not exist "node_modules\" (
    echo   Running npm install...
    call npm install
    if %errorlevel% neq 0 (echo [ERROR] npm install failed && pause && exit /b 1)
)
echo   Building (vite)...
call npx vite build
if %errorlevel% neq 0 (echo [WARN] Build had errors, continuing)
echo   Done

echo.
echo [4/5] Setting up vector service...
cd /d "%ROOT%\vector-service"

if not exist "venv\Scripts\python.exe" (
    echo   Creating Python venv...
    python -m venv venv
    if %errorlevel% neq 0 (echo [WARN] venv failed && goto skip_vector)
)

echo   Checking Python deps...
call venv\Scripts\python.exe -c "import chromadb, onnxruntime, fastapi, uvicorn; print('  All deps OK')"
if %errorlevel% neq 0 (
    echo   Dependencies missing, installing...
    call venv\Scripts\python.exe -m pip install -r requirements.txt
    if %errorlevel% neq 0 (echo [WARN] pip install failed && goto skip_vector)
    echo   Done
)

if not exist "models\jina-embeddings-v2-base-zh\onnx\" (
    echo   Downloading Embedding model (~500MB)...
    call venv\Scripts\python.exe download_model.py
    if %errorlevel% neq 0 (echo [WARN] Model download failed)
)

echo   Starting vector service...
start "Vector-Service" cmd /c "title Vector-Service && cd /d \"%ROOT%\vector-service\" && venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8765"

echo   Waiting for vector service...
set /a VC=0
:wait_vs
ping -n 2 127.0.0.1 >nul 2>nul
set /a VC+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest http://localhost:8765/health -TimeoutSec 2 -UseBasicParsing).StatusCode; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto vs_ok
if %VC% geq 20 goto vs_skip
echo   ... %VC%/20
goto wait_vs
:vs_ok
echo   Vector service ready
:skip_vector

echo.
echo [5/5] Starting Agent service...
cd /d "%ROOT%\agent-core"
echo.
echo  ============================================
echo    All services started!
echo.
echo    Web UI:  http://localhost:3000
echo    API:     http://localhost:3000/api
echo    Health:  http://localhost:3000/api/health
echo  ============================================
echo.
echo    Press Ctrl+C to stop
echo  ============================================
echo.

start "" http://localhost:3000

node app.js

echo.
echo [INFO] Agent stopped.
taskkill /fi "WINDOWTITLE eq Vector*" /f >nul 2>nul
pause
