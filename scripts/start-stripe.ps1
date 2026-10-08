$ErrorActionPreference = 'Stop'
function Read-SharedLog([string]$path) {
  $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $reader = New-Object IO.StreamReader($stream)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$envPath = Join-Path $projectRoot '.env'
$envText = [IO.File]::ReadAllText($envPath)
$stripeKey = [regex]::Match($envText, '(?m)^STRIPE_SECRET_KEY=(.*)$').Groups[1].Value.Trim().Trim('"').Trim("'")
if (!$stripeKey) { throw 'Set STRIPE_SECRET_KEY in the private .env first.' }
$nodePath = (Get-Command node.exe).Source
$stripeCommand = Get-Command stripe.cmd -ErrorAction Stop
$stripeShim = Join-Path (Split-Path -Parent $stripeCommand.Source) 'node_modules/@stripe/cli/bin/shim.js'
if (!(Test-Path -LiteralPath $stripeShim)) { throw 'Install the official @stripe/cli npm package before starting this helper.' }
$statePath = Join-Path $projectRoot '.local/stripe-listener.pid'
if (Test-Path -LiteralPath $statePath) {
  $oldProcessId = [int]([IO.File]::ReadAllText($statePath).Trim())
  $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $oldProcessId" -ErrorAction SilentlyContinue
  if ($oldProcess -and $oldProcess.Name -eq 'node.exe' -and $oldProcess.CommandLine.Contains($stripeShim)) { Write-Output 'Stripe listener is already running.'; exit 0 }
}
New-Item -ItemType Directory -Path (Join-Path $projectRoot '.local') -Force | Out-Null
$stdoutPath = Join-Path $projectRoot '.local/stripe-listener.log'
$stderrPath = Join-Path $projectRoot '.local/stripe-listener-error.log'
$arguments = @('"' + $stripeShim + '"', 'listen', '--skip-update', '--color', 'off', '--events-from', '@self', '--events', 'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired,refund.created,refund.updated,customer.created', '--forward-to', 'http://127.0.0.1:4000/api/v1/payments/webhook')
if ($stripeKey -match '^(sk|rk)_live_') { $arguments += '--live' }
$env:STRIPE_API_KEY = $stripeKey
try {
  $listener = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
} finally { Remove-Item Env:\STRIPE_API_KEY -ErrorAction SilentlyContinue }
[IO.File]::WriteAllText($statePath, [string]$listener.Id)
$secretMatch = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  $logs = (Read-SharedLog $stdoutPath) + (Read-SharedLog $stderrPath)
  $secretMatch = [regex]::Match($logs, 'whsec_[A-Za-z0-9]+')
  if ($secretMatch.Success) { break }
  if ($listener.HasExited) { throw 'Stripe listener exited. Inspect the private .local/stripe-listener-error.log; do not share unredacted logs.' }
}
if (!$secretMatch.Success) { throw 'Listener secret was not received yet. Inspect private listener logs.' }
$previous = [regex]::Match($envText, '(?m)^STRIPE_WEBHOOK_SECRET=(.*)$').Groups[1].Value.Trim()
$envText = [regex]::Replace($envText, '(?m)^STRIPE_WEBHOOK_SECRET=.*$', 'STRIPE_WEBHOOK_SECRET=' + $secretMatch.Value)
if ($envText -notmatch '(?m)^STRIPE_WEBHOOK_SECRET=') { $envText += "`nSTRIPE_WEBHOOK_SECRET=" + $secretMatch.Value + "`n" }
[IO.File]::WriteAllText($envPath, $envText, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Stripe listener started; webhook secret saved privately in .env.'
if ($previous -ne $secretMatch.Value) { Write-Output 'Restart the API to load the updated webhook secret.' }
Write-Output 'Forwarding to http://127.0.0.1:4000/api/v1/payments/webhook. Private logs and process ID are in .local.'
