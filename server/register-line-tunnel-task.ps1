# ============================================================
# register-line-tunnel-task.ps1 - run by the USER to (re)create & start the
# LINE public-ingress tunnel task (mirror of register-bot-task.ps1).
# Mode: run whether logged on or not (S4U) => NO console window, starts at
#       system boot, restarts on crash. The wrapper auto-registers the changing
#       trycloudflare URL with LINE, so reboots need no manual webhook edit.
# Run (from server dir): powershell -NoProfile -ExecutionPolicy Bypass -File register-line-tunnel-task.ps1
# If it fails with Access denied, run the same line in an ELEVATED PowerShell.
# ASCII-only on purpose (Windows PowerShell 5.1 misreads UTF-8 w/o BOM).
# ============================================================
$ErrorActionPreference = 'Stop'
$exe  = 'D:\projects\construction-photo-archive\server\run-line-tunnel.cmd'
$wd   = 'D:\projects\construction-photo-archive\server'
$user = "$env:USERDOMAIN\$env:USERNAME"

$action    = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $wd
$trigger   = New-ScheduledTaskTrigger -AtStartup
# S4U = "run whether user is logged on or not" -> runs in background session, no window.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'ConstructionLineTunnel' -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings `
  -Description 'Construction photo archive - LINE public tunnel, autostart at boot, restart on crash, auto-registers webhook URL' -Force | Out-Null
Write-Host '[OK] scheduled task ConstructionLineTunnel re-registered (background, no window)'

Start-ScheduledTask -TaskName 'ConstructionLineTunnel'
Start-Sleep -Seconds 12
Get-ScheduledTask -TaskName 'ConstructionLineTunnel' | Select-Object TaskName, State | Format-Table -AutoSize
$info = Get-ScheduledTaskInfo -TaskName 'ConstructionLineTunnel'
Write-Host ("LastTaskResult: {0}  (267009 = running)" -f $info.LastTaskResult)
Write-Host 'Tip: check data\_logs\line-tunnel.log for the registered webhook URL.'
