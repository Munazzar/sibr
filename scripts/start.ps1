# Start Sibr (service + site on one port, this computer only) and open the browser.
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
# Other devices reach it only through Tailscale: run scripts\tailscale.ps1 once.
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"
$py = Join-Path $server ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "Run scripts\setup.ps1 first."; exit 1 }

$api = Start-Process -PassThru -WorkingDirectory $server -FilePath $py `
    -ArgumentList "-m", "uvicorn", "sibr_api.app:app", "--host", "127.0.0.1", "--port", "8787"
Start-Sleep -Seconds 4
Start-Process "http://localhost:8787/"
Write-Host "Sibr is running at http://localhost:8787/ (this computer only)."
Write-Host "Press Enter to stop."
[void][Console]::ReadLine()
Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
