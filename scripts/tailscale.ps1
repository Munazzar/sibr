# Share Sibr with your own devices over Tailscale (HTTPS, tailnet only, never the public internet).
# Run once; it keeps working after restarts while Tailscale is running.
#   powershell -ExecutionPolicy Bypass -File scripts\tailscale.ps1
# The first run may print a link to enable HTTPS certificates for your tailnet; open it, then re-run.
# To stop sharing: tailscale serve reset
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) { Write-Host "Tailscale is not installed."; exit 1 }
tailscale serve --bg 8787
tailscale serve status
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) "server\.env"
$key = (Select-String -Path $envFile -Pattern '^SIBR_API_KEY=(.+)$' -ErrorAction SilentlyContinue).Matches.Groups[1].Value
Write-Host ""
Write-Host "On your phone or laptop (signed in to Tailscale), open the https://...ts.net address above."
if ($key) { Write-Host "The first time, add ?key=$key to the address, or type the key when asked." }
