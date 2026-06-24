@echo off
chcp 65001 >nul
echo ========================================
echo   邻舍.EXE 打包脚本
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 安装依赖...
pip install PySide6 psutil pyinstaller
if %errorlevel% neq 0 (
    echo [ERROR] 依赖安装失败
    exit /b 1
)

echo.
echo [2/3] PyInstaller 打包...
pyinstaller ^
  --onefile ^
  --windowed ^
  --name "邻舍.EXE" ^
  --icon "assets/icon.ico" ^
  --add-data "assets/launchHeader.jpg;assets" ^
  --add-data "assets/icon.ico;assets" ^
  --hidden-import PySide6.QtCore ^
  --hidden-import PySide6.QtGui ^
  --hidden-import PySide6.QtWidgets ^
  --hidden-import PySide6.QtNetwork ^
  --clean ^
  --noconfirm ^
  main.py

if %errorlevel% neq 0 (
    echo [ERROR] 打包失败
    exit /b 1
)

echo.
echo [3/3] 复制到项目根目录...
copy /Y "dist\邻舍.EXE.exe" "..\邻舍.EXE.exe"
if %errorlevel% neq 0 (
    echo [ERROR] 复制失败
    exit /b 1
)

echo.
echo ========================================
echo   打包完成!
echo   输出: ..\邻舍.EXE.exe
echo ========================================
pause
