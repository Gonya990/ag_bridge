@echo off
REM AG Bridge - register auto-start at logon (self-elevates for Task Scheduler).
REM Double-click, or run from a terminal in the repo root.
REM Remove later with:  install-autostart.cmd -Remove
setlocal
cd /d "%~dp0"

REM Relaunch elevated if not already admin (Task Scheduler registration needs it).
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0' -ArgumentList '%*'"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-autostart.ps1" %*
echo.
pause >nul
