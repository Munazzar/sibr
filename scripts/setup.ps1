# One-time setup on Windows. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"
$model = if ($env:SIBR_LLM_MODEL) { $env:SIBR_LLM_MODEL } else { "llama3.2:3b" }

Write-Host "== Python environment"
$py = Join-Path $server ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    # First Python that can actually build a venv (some installs lack _socket/ssl and break ensurepip).
    $base = @((Get-Command python -All -ErrorAction SilentlyContinue).Source) +
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe") |
        Where-Object { $_ -and (Test-Path $_) -and -not ($_ -like "*WindowsApps*") } |
        Where-Object { $ErrorActionPreference = "Continue"; & $_ -c "import ssl" 2>$null; $LASTEXITCODE -eq 0 } | Select-Object -First 1
    if (-not $base) { Write-Host "No working Python 3 found. Install it with: winget install Python.Python.3.12"; exit 1 }
    & $base -m venv (Join-Path $server ".venv")
    if ($LASTEXITCODE) { exit 1 }
}
& $py -m pip install --upgrade pip
if ($LASTEXITCODE) { exit 1 }
# NVIDIA GPU: take the CUDA torch build before laya pulls the CPU one.
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    & $py -m pip install torch --index-url https://download.pytorch.org/whl/cu128
}
& $py -m pip install -r (Join-Path $server "requirements.txt") pytest
if ($LASTEXITCODE) { exit 1 }

$envFile = Join-Path $server ".env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $server ".env.example") $envFile }
# A random access key, so only people who have it can run evaluations.
if (-not (Select-String -Path $envFile -Pattern '^SIBR_API_KEY=.+' -Quiet)) {
    $key = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Add-Content $envFile "`nSIBR_API_KEY=$key"
    Write-Host "Access key written to server\.env: $key"
}
# A separate admin key for the live request log at /logs (keep this one to yourself).
if (-not (Select-String -Path $envFile -Pattern '^SIBR_ADMIN_KEY=.+' -Quiet)) {
    $admin = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Add-Content $envFile "SIBR_ADMIN_KEY=$admin"
    Write-Host "Admin key for http://localhost:8787/logs written to server\.env: $admin"
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
