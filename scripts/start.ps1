# Start the Sibr model service and the site, then open the browser.
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"
$py = Join-Path $server ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "Run scripts\setup.ps1 first."; exit 1 }

$api = Start-Process -PassThru -WorkingDirectory $server -FilePath $py `
    -ArgumentList "-m", "uvicorn", "sibr_api.app:app", "--port", "8787"
$web = Start-Process -PassThru -WorkingDirectory $root -FilePath $py `
    -ArgumentList "-m", "http.server", "8080"
Start-Sleep -Seconds 4
Start-Process "http://localhost:8080/?api=http://localhost:8787"
Write-Host "Sibr is running at http://localhost:8080/?api=http://localhost:8787"
Write-Host "Press Enter to stop."
[void][Console]::ReadLine()
Stop-Process -Id $api.Id, $web.Id -ErrorAction SilentlyContinue
