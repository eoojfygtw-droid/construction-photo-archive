@echo off
rem ============================================================
rem register-line-tunnel.cmd - double-click to install the LINE tunnel as a
rem background autostart task. Self-elevates via UAC (creating a boot task needs admin).
rem Mirrors restart-bot.cmd's elevation pattern.
rem ============================================================
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-line-tunnel-task.ps1"
echo.
pause
