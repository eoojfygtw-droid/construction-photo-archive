@echo off
rem ============================================================
rem run-line-tunnel.cmd - launch the LINE public-ingress tunnel (persistent mode).
rem Called by scheduled task ConstructionLineTunnel at boot; auto-restarts on crash.
rem Opens a cloudflared quick tunnel to the bot's LINE webhook port and auto-registers
rem the (changing) public URL with LINE, so reboots need no manual webhook edit.
rem Logs are appended to data\_logs\line-tunnel.log. ASCII-only on purpose.
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
if not exist "data\_logs" mkdir "data\_logs"
call "C:\Program Files\nodejs\npm.cmd" run line-tunnel >> "data\_logs\line-tunnel.log" 2>&1
