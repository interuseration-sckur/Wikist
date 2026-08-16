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
  echo Could not find Node.js 22.5 or newer.
  echo Install Node.js, add node.exe to PATH, or place it at runtime\node\node.exe.
  exit /b 1
)

"%NODE_BIN%" -e "const [major,minor]=process.versions.node.split('.').map(Number);try{require('node:sqlite')}catch{process.exit(1)}process.exit(major>22||(major===22&&minor>=5)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.5 or newer with node:sqlite support is required.
  exit /b 1
)

if /I "%~1"=="--setup" (
  "%NODE_BIN%" "%ROOT%\tools\setup-community-stack.js"
  if errorlevel 1 exit /b 1
  exit /b 0
)

if /I "%~1"=="--stop" (
  "%NODE_BIN%" "%ROOT%\tools\start-hybrid.js" --stop
  if errorlevel 1 exit /b 1
  exit /b 0
)

if /I "%~1"=="--status" (
  "%NODE_BIN%" "%ROOT%\tools\start-hybrid.js" --status
  if errorlevel 1 exit /b 1
  exit /b 0
)

if not exist "%ROOT%\data\wikist-stack.json" goto prepare_stack
if not exist "%ROOT%\data\centrifugo\config.json" goto prepare_stack
goto stack_ready

:prepare_stack
echo Preparing the Wikist realtime stack...
"%NODE_BIN%" "%ROOT%\tools\setup-community-stack.js"
if errorlevel 1 exit /b 1

:stack_ready

set "PORT_LABEL=%WIKIST_PORT%"
if not defined PORT_LABEL set "PORT_LABEL=8899"
echo Starting the complete Wikist stack with "%NODE_BIN%"
echo Wikist will use http://127.0.0.1:%PORT_LABEL%.
if /I "%~1"=="--restart" (
  "%NODE_BIN%" "%ROOT%\tools\start-hybrid.js" --restart
) else (
  "%NODE_BIN%" "%ROOT%\tools\start-hybrid.js"
)
