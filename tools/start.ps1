$ErrorActionPreference = "Stop"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }

if (-not $nodePath) {
  $bundled = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundled) {
    $nodePath = $bundled
  }
}

if (-not $nodePath) {
  throw "Node.js was not found. Install Node.js 22.5+ or run Wikist in an environment that provides Node."
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$probe = & $nodePath -e "const [major,minor]=process.versions.node.split('.').map(Number);try{require('node:sqlite')}catch{process.exit(1)}process.exit(major>22||(major===22&&minor>=5)?0:1)"
if ($LASTEXITCODE -ne 0) {
  throw "Wikist requires Node.js 22.5+ with node:sqlite support."
}

& $nodePath (Join-Path $root "tools\start-hybrid.js") @args
exit $LASTEXITCODE
