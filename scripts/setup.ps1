# One-time setup on Windows. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"
$model = if ($env:SIBR_LLM_MODEL) { $env:SIBR_LLM_MODEL } else { "llama3.2:3b" }

Write-Host "== Python environment"
$py = Join-Path $server ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv (Join-Path $server ".venv") }
    else { python -m venv (Join-Path $server ".venv") }
}
& $py -m pip install --upgrade pip
& $py -m pip install -r (Join-Path $server "requirements.txt")
& $py -m pip install pytest

$envFile = Join-Path $server ".env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $server ".env.example") $envFile }
# A random access key, so only people who have it can run evaluations.
if (-not (Select-String -Path $envFile -Pattern '^SIBR_API_KEY=.+' -Quiet)) {
    $key = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Add-Content $envFile "`nSIBR_API_KEY=$key"
    Write-Host "Access key written to server\.env: $key"
}

Write-Host "== Ollama (free local LLM)"
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "Ollama is not installed. Install it with:  winget install Ollama.Ollama   then re-run this script."
    exit 1
}
ollama pull $model

Write-Host "== Laya checkpoint (first download is about 1.7 GB)"
& $py -c "from laya import Router; r = Router(); print(r.predict('test idea', {'q': {'type': 'noul', 'instructions': 'Is this a test?'}}, model='english')['answers'])"

Write-Host "Setup done. Start Sibr with: powershell -ExecutionPolicy Bypass -File scripts\start.ps1"
Write-Host "To use it from your other devices: powershell -ExecutionPolicy Bypass -File scripts\tailscale.ps1"
