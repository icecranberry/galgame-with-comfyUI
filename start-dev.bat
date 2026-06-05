@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

title AI Agent - DEV Mode
cls

echo.
echo  ============================================
echo    AI Agent - Dev Mode (Hot Reload)
echo  ============================================
echo.
echo [0/4] Cleaning up...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING" 2^>nul') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING" 2^>nul') do taskkill /f /pid %%a >nul 2>nul
echo   Done
echo [1/4] Checking environment...
where node >nul 2>nul || (echo [ERROR] Node.js not found && pause && exit /b 1)
for /f "tokens=*" %%i in ('node -v 2^>^&1') do echo   Node.js: %%i
where python >nul 2>nul || (echo [ERROR] Python not found && pause && exit /b 1)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   Python: %%i
echo.
echo [2/4] Starting vector service (:8765)...
cd /d "%ROOT%\vector-service"
if not exist "venv\Scripts\python.exe" (
    echo   Creating venv...
    python -m venv venv
    call venv\Scripts\python.exe -m pip install -r requirements.txt -q
)
start /min "Vector-Service" venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8765
echo   Waiting for vector...
set /a VC=0
:wait_vs
ping -n 2 127.0.0.1 >nul 2>nul
set /a VC+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest http://localhost:8765/health -TimeoutSec 2 -UseBasicParsing).StatusCode; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto vs_ok
if %VC% geq 15 (echo   Vector timeout - continuing && goto skip_vector)
goto wait_vs
:vs_ok
echo   Vector OK
:skip_vector
echo.
echo [3/4] Starting agent-core (:3000)...
cd /d "%ROOT%\agent-core"
if not exist "node_modules\" (
    echo   Running npm install...
    call npm install
)
start /min "Agent-Core" node app.js
echo   Waiting for agent-core...
set /a AC=0
:wait_ac
ping -n 2 127.0.0.1 >nul 2>nul
set /a AC+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest http://localhost:3000/api/health -TimeoutSec 2 -UseBasicParsing).StatusCode; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto ac_ok
if %AC% geq 15 (echo   Agent-core timeout - check the minimized window && pause)
goto wait_ac
:ac_ok
echo   Agent-core OK
echo.
echo [4/4] Starting Web UI dev server (:5173)...
cd /d "%ROOT%\web-ui"
if not exist "node_modules\" (
    echo   Running npm install...
    call npm install
)

echo.
echo  ============================================
echo    All services running!
echo.
echo    Web UI:  http://localhost:5173 (HMR)
echo    API:     http://localhost:3000
echo    Vector:  http://localhost:8765
echo  ============================================
echo.
echo    Hot reload active - edit .vue files
echo    and changes appear instantly.
echo  ============================================
echo.

start "" http://localhost:5173
call npm run dev

echo.
echo [INFO] Vite dev server stopped.
echo Cleaning up background services...
taskkill /fi "WINDOWTITLE eq Vector*" /f >nul 2>nul
taskkill /fi "WINDOWTITLE eq Agent*" /f >nul 2>nul
pause
