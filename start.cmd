@echo off
REM AG Bridge - one-click launcher for Windows.
REM Double-click this file, or run it from a terminal in the repo root.
REM It starts Antigravity (with CDP), installs deps if needed, and runs the bridge.
REM Pass extra options through, e.g.:  start.cmd -Port 9090 -NoAg
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
echo.
echo (AG Bridge stopped. Press any key to close.)
pause >nul
