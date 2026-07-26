@echo off
setlocal
cd /d "%~dp0"
title Galgame AI - Quick Start

echo.
echo ============================================
echo   Galgame AI - Quick Start
echo ============================================
echo.

where node >nul 2>nul || goto :missing_node
where npm >nul 2>nul || goto :missing_node
where python >nul 2>nul || goto :missing_python

if /i "%~1"=="--check" (
  echo [OK] Node.js, npm and Python were found.
  exit /b 0
)

if not exist "agent-core\node_modules" (
  echo [1/4] First run: installing backend packages...
  call npm install --prefix agent-core
  if errorlevel 1 goto :failed
) else (
  echo [1/4] Backend packages are ready.
)

if not exist "web-ui\node_modules" (
  echo [2/4] First run: installing frontend packages...
  call npm install --prefix web-ui
  if errorlevel 1 goto :failed
) else (
  echo [2/4] Frontend packages are ready.
)

if not exist "vector-service\venv\Scripts\python.exe" (
  echo [3/4] First run: creating the Python virtual environment...
  python -m venv "vector-service\venv"
  if errorlevel 1 goto :failed
)

set "VENV_PY=vector-service\venv\Scripts\python.exe"
"%VENV_PY%" -c "import fastapi, uvicorn, onnxruntime, chromadb" >nul 2>nul
if errorlevel 1 (
  echo [3/4] Installing vector-memory packages. This can take a while...
  "%VENV_PY%" -m pip install -r "vector-service\requirements.txt"
  if errorlevel 1 goto :failed
) else (
  echo [3/4] Vector-memory packages are ready.
)

echo [4/4] Starting the project...
echo       The browser will open: http://localhost:5173
echo       Press Ctrl+C in this window to stop all services.
echo.
call npm run dev
if errorlevel 1 goto :failed
exit /b 0

:missing_node
echo [ERROR] Node.js 18+ was not found. Install it from https://nodejs.org/
goto :pause_error

:missing_python
echo [ERROR] Python 3.10+ was not found. Install it and enable "Add Python to PATH".
goto :pause_error

:failed
echo.
echo [ERROR] Startup did not complete. Keep the error messages above.

:pause_error
echo.
pause
exit /b 1
