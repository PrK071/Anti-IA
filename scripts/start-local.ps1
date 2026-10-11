param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$avatarUrl = 'http://127.0.0.1:3187'
$nodeCandidates = @((Join-Path $projectRoot '.runtime\node.exe'), (Join-Path $env:LOCALAPPDATA 'Kiro-Cli\node.exe'))
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
$nodeExecutable = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $nodeExecutable) { throw 'Node.js não encontrado. Instale Node.js 22 ou superior para abrir o AVATAR Local.' }
$alreadyRunning = $false
try { $health = Invoke-RestMethod -Uri "$avatarUrl/api/chatgpt/session" -TimeoutSec 2; $alreadyRunning = $health.app -eq 'avatar-chatgpt-local' } catch {}
if (-not $alreadyRunning) {
  $localData = Join-Path $projectRoot '.local'
  New-Item -ItemType Directory -Path $localData -Force | Out-Null
  Start-Process -FilePath $nodeExecutable -ArgumentList @('"scripts/local.mjs"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localData 'server.log') -RedirectStandardError (Join-Path $localData 'server-error.log') | Out-Null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    try { $health = Invoke-RestMethod -Uri "$avatarUrl/api/chatgpt/session" -TimeoutSec 2; if ($health.app -eq 'avatar-chatgpt-local') { $alreadyRunning = $true; break } } catch {}
  }
}
if (-not $alreadyRunning) { throw 'O AVATAR Local não iniciou. Verifique .local/server-error.log.' }
if (-not $NoBrowser) { Start-Process $avatarUrl }
