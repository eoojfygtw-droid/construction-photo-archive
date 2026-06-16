# ============================================================
# unregister-line-tunnel-task.ps1 - REMOVE the LINE tunnel background task.
# Stops the running instance, cancels autostart, deletes the scheduled task,
# and kills any leftover cloudflared the task spawned.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File unregister-line-tunnel-task.ps1
# (LINE will stop receiving once the tunnel is gone; Telegram is unaffected.)
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'

# 1) stop the running task instance (kills its process tree)
Stop-ScheduledTask -TaskName 'ConstructionLineTunnel'
Start-Sleep -Seconds 2

# 2) delete the scheduled task (no more autostart)
Unregister-ScheduledTask -TaskName 'ConstructionLineTunnel' -Confirm:$false
Start-Sleep -Seconds 1

# 3) belt-and-braces: kill any leftover cloudflared the tunnel task started
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -match 'trycloudflare|--url http://127.0.0.1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Get-ScheduledTask -TaskName 'ConstructionLineTunnel' -ErrorAction SilentlyContinue) {
  Write-Host '[!] Task still exists - please re-run this in an ELEVATED PowerShell.'
} else {
  Write-Host '[OK] ConstructionLineTunnel removed. LINE ingress will no longer auto-start.'
}
