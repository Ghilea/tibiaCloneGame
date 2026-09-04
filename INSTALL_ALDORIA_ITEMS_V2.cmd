@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_ALDORIA_ITEMS_V2.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" exit /b %CODE%
if exist "%~dp0.aldoria-items-v2-installed-ok" (
  del /f /q "%~dp0.aldoria-items-v2-installed-ok" >nul 2>&1
  del /f /q "%~dp0INSTALL_ALDORIA_ITEMS_V2.ps1" >nul 2>&1
  start "" /b cmd /c "ping 127.0.0.1 -n 2 >nul & del /f /q \"%~f0\""
)
exit /b 0
