param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$localPath = Join-Path $projectPath '.local'
New-Item -ItemType Directory -Path $localPath -Force | Out-Null
if (-not (Test-Path (Join-Path $projectPath 'node_modules'))) { throw 'Install dependencies first: npm install' }
if ($Restart -and (Test-Path (Join-Path $localPath 'server.pid'))) {
 $serverProcessId = [int](Get-Content (Join-Path $localPath 'server.pid'))
 $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
 $ownedHealth = $null
 try { $ownedHealth = Invoke-RestMethod 'http://127.0.0.1:3080/api/health' -TimeoutSec 2 } catch {}
 if ($serverProcess -and $serverProcess.Name -eq 'node.exe' -and $serverProcess.CommandLine -match 'server/index.js' -and $ownedHealth.database -eq 'sqlite') {
  Stop-Process -Id $serverProcessId
  Start-Sleep -Milliseconds 500
 } elseif ($serverProcess) { throw 'The recorded PID does not match the Praktio server; refusing to stop it.' }
}
$healthReady = $false
try { $health = Invoke-RestMethod 'http://127.0.0.1:3080/api/health' -TimeoutSec 2; $healthReady = $health.ok -and $health.service -eq 'praktika' } catch {}
if (-not $healthReady) {
 $nodePath = (Get-Command node).Source
 $process = Start-Process -FilePath $nodePath -ArgumentList 'server/index.js' -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localPath 'server.log') -RedirectStandardError (Join-Path $localPath 'server-error.log')
 $process.Id | Set-Content (Join-Path $localPath 'server.pid')
}
for ($attempt = 0; $attempt -lt 40; $attempt++) {
 try { $health = Invoke-RestMethod 'http://127.0.0.1:3080/api/health' -TimeoutSec 1; if ($health.ok -and $health.service -eq 'praktika') { Write-Host 'Praktio is running: http://localhost:3080'; exit 0 } } catch {}
 Start-Sleep -Milliseconds 250
}
throw 'Server did not start. See .local/server-error.log'

