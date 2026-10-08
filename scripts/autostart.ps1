# Start Sibr automatically (hidden, this computer only) every time you sign in to Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1          # turn on
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Off     # turn off
# Ollama and Tailscale already start with Windows, and `tailscale serve --bg` is remembered,
# so with this on there is nothing to do after a restart.
param([switch]$Off)
$name = "Sibr"
if ($Off) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "Sibr autostart is off."; exit }

$server = Join-Path (Split-Path -Parent $PSScriptRoot) "server"
$pyw = Join-Path $server ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pyw)) { Write-Host "Run scripts\setup.ps1 first."; exit 1 }
$action = New-ScheduledTaskAction -Execute $pyw -WorkingDirectory $server `
    -Argument "-m uvicorn sibr_api.app:app --host 127.0.0.1 --port 8787"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Sibr now starts by itself when you sign in. It is running now at http://localhost:8787/"
