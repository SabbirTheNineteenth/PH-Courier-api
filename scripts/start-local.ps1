$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (!(Test-Path -LiteralPath '.env')) { throw 'Create .env using .env.example before starting.' }
$dotenv = @{}
foreach ($line in Get-Content -LiteralPath '.env') { if ($line -match '^([A-Z_]+)=(.*)$') { $dotenv[$matches[1]] = $matches[2].Trim().Trim('"') } }
$databaseUri = [Uri]$dotenv['DATABASE_URL']
if ($databaseUri.Host -eq '127.0.0.1' -and $databaseUri.Port -eq 55432 -and (Test-Path -LiteralPath '.local/postgres')) {
  $pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
  & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 55432 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $dataPath = Join-Path $projectRoot '.local/postgres'
    $logPath = Join-Path $projectRoot '.local/postgres.log'
    Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList "-D `"$dataPath`" -l `"$logPath`" -o `"-p 55432 -h 127.0.0.1`" -w start" -WindowStyle Hidden | Out-Null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      Start-Sleep -Milliseconds 200
      & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 55432 | Out-Null
      if ($LASTEXITCODE -eq 0) { break }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL did not become ready. Inspect .local/postgres.log.' }
  }
}
$apiPort = if ($dotenv['PORT']) { $dotenv['PORT'] } else { '4000' }
$apiOrigin = "http://127.0.0.1:$apiPort"
try { $ready = Invoke-RestMethod -Uri "$apiOrigin/ready" -TimeoutSec 3 } catch { $ready = $null }
if (!$ready.success) {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  New-Item -ItemType Directory -Path '.local' -Force | Out-Null
  $apiProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'dist/src/server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot '.local/api.log') -RedirectStandardError (Join-Path $projectRoot '.local/api-error.log')
  $apiProcess.Id | Set-Content -LiteralPath '.local/api.pid'
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 200
    try { $ready = Invoke-RestMethod -Uri "$apiOrigin/ready" -TimeoutSec 2; if ($ready.success) { break } } catch { }
  }
  if (!$ready.success) { throw 'API did not become ready. Inspect .local/api-error.log.' }
}
Write-Output "API ready: $apiOrigin"
Write-Output "Swagger: $apiOrigin/docs"
Write-Output 'Admin credentials are in the private .env file. Google and Stripe require your credentials.'
