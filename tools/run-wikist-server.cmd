@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

rem Prefer a normal Node.js installation, then accept a portable runtime beside Wikist.
set "NODE_BIN="
where node.exe >nul 2>nul
if not errorlevel 1 set "NODE_BIN=node.exe"

if not defined NODE_BIN if exist "%ROOT%\runtime\node\node.exe" set "NODE_BIN=%ROOT%\runtime\node\node.exe"
if not defined NODE_BIN if exist "%ROOT%\runtime\node.exe" set "NODE_BIN=%ROOT%\runtime\node.exe"

rem Development fallback for the bundled Codex runtime on this machine.
if not defined NODE_BIN if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_BIN (
  echo Could not find Node.js 18 or newer.
  echo Install Node.js, add node.exe to PATH, or place it at runtime\node\node.exe.
  exit /b 1
)

"%NODE_BIN%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required.
  exit /b 1
)

if /I "%~1"=="--restart" (
  set "PORT_LABEL=%WIKIST_PORT%"
  if not defined PORT_LABEL set "PORT_LABEL=8899"
  echo Checking the existing Wikist service on port %PORT_LABEL%...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$portText = $env:WIKIST_PORT; if ([string]::IsNullOrWhiteSpace($portText)) { $port = 8899 } else { $port = [int]$portText }; $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($listener) { try { $site = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/site') -TimeoutSec 2; if ($site.comments.provider -ne 'wikist-local') { throw 'The listener is not a Wikist server.' } } catch { Write-Error ('Refusing to stop port ' + $port + ': ' + $_.Exception.Message); exit 3 }; Stop-Process -Id $listener.OwningProcess; Start-Sleep -Milliseconds 700 }"
  if errorlevel 1 exit /b 1
)

set "PORT_LABEL=%WIKIST_PORT%"
if not defined PORT_LABEL set "PORT_LABEL=8899"
echo Starting Wikist with "%NODE_BIN%"
echo Wikist will use http://127.0.0.1:%PORT_LABEL%.
"%NODE_BIN%" "%ROOT%\server.js"
