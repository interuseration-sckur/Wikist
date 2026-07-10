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
  throw "Node.js was not found. Install Node.js 18+ or run Wikist in an environment that provides Node."
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
& $nodePath (Join-Path $root "server.js")
