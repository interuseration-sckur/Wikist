param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9._:-]+$')]
  [string]$HostName,

  [Parameter(Mandatory = $true)]
  [string]$Package,

  [ValidatePattern('^[A-Za-z0-9._-]+$')]
  [string]$UserName = "root",

  [ValidatePattern('^/[A-Za-z0-9._/-]+$')]
  [string]$RemoteAppRoot = "/opt/wikist",

  [ValidatePattern('^/[A-Za-z0-9._/-]+$')]
  [string]$RemotePackageRoot = "/opt/wikist/data/imports/eom-zh-packages",

  [ValidatePattern('^(none|[A-Za-z0-9_.@-]+)$')]
  [string]$Service = "wikist",

  [ValidateRange(1, 10000)]
  [int]$BatchSize = 200,

  [switch]$Overwrite,
  [switch]$DryRun,
  [switch]$NoBackup,
  [switch]$NoDoctor
)

$ErrorActionPreference = "Stop"

foreach ($command in @("node.exe", "tar.exe", "scp.exe", "ssh.exe")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required and was not found in PATH."
  }
}

$packagePath = [System.IO.Path]::GetFullPath($Package)
$manifestPath = Join-Path $packagePath "manifest.json"
$checksumsPath = Join-Path $packagePath "checksums.sha256"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
  throw "The package must contain manifest.json and checksums.sha256."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.format -ne "wikist-eom-zh-package" -or $manifest.formatVersion -ne 1 -or $manifest.status -ne "ready") {
  throw "Only a ready wikist-eom-zh-package formatVersion 1 package can be transferred."
}
$entryCount = [int]$manifest.counts.packaged
if ($entryCount -lt 1 -or $manifest.entries.Count -ne $entryCount -or [string]::IsNullOrWhiteSpace($manifest.contentSha256)) {
  throw "The package manifest is incomplete."
}

# Reuse the importer as the authoritative checksum and package-schema verifier.
$validatorPath = Join-Path $PSScriptRoot "eom-zh-release-import.js"
$validationScript = 'require(process.argv[1]).loadRelease(process.argv[2]);'
& node.exe -e $validationScript $validatorPath $packagePath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Local release-package validation failed."
}

$contentHash = [string]$manifest.contentSha256
if ($contentHash -notmatch '^[a-f0-9]{64}$') {
  throw "Invalid package contentSha256."
}
$remotePackage = "$RemotePackageRoot/$contentHash"
$archiveName = "wikist-eom-zh-$($contentHash.Substring(0, 16)).tar.gz"
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $temporaryBase ("wikist-eom-zh-push-" + [Guid]::NewGuid().ToString("N")))
)
if (-not $temporaryRoot.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe temporary path."
}
$archive = Join-Path $temporaryRoot $archiveName
$checksumFile = "$archive.sha256"

New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  & tar.exe -C $packagePath -czf $archive .
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the transfer archive." }

  $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText(
    $checksumFile,
    "$archiveHash  $archiveName`n",
    [System.Text.UTF8Encoding]::new($false)
  )

  $target = "$UserName@$HostName"
  & scp.exe $archive $checksumFile "${target}:/tmp/"
  if ($LASTEXITCODE -ne 0) { throw "SCP upload failed." }

  $flags = @("--root=$RemoteAppRoot", "--package=$remotePackage", "--service=$Service", "--batch-size=$BatchSize")
  if ($Overwrite) { $flags += "--overwrite" }
  if ($DryRun) { $flags += "--dry-run" }
  if ($NoBackup) { $flags += "--no-backup" }
  if ($NoDoctor) { $flags += "--no-doctor" }
  $quotedFlags = ($flags | ForEach-Object { "'$_'" }) -join " "

  $remoteArchive = "/tmp/$archiveName"
  $remoteChecksum = "/tmp/$archiveName.sha256"
  $remoteTemplate = @'
set -Eeuo pipefail
ARCHIVE='__REMOTE_ARCHIVE__'
CHECKSUM='__REMOTE_CHECKSUM__'
PACKAGE_ROOT='__REMOTE_PACKAGE_ROOT__'
PACKAGE_PATH='__REMOTE_PACKAGE__'
APP_ROOT='__REMOTE_APP_ROOT__'
CONTENT_HASH='__CONTENT_HASH__'
HASH_PREFIX='__HASH_PREFIX__'
STAGING=''

cleanup() {
  case "$STAGING" in
    "$PACKAGE_ROOT"/.incoming-*) rm -rf -- "$STAGING" ;;
  esac
}
trap cleanup EXIT

verify_release() {
  local candidate="$1"
  [[ -d "$candidate" && -f "$candidate/manifest.json" ]] || return 1
  [[ "$(node -e 'const m=require(process.argv[1]);process.stdout.write(String(m.contentSha256||""))' "$candidate/manifest.json")" == "$CONTENT_HASH" ]] || return 1
  node -e 'require(process.argv[1]).loadRelease(process.argv[2]);' "$APP_ROOT/tools/eom-zh-release-import.js" "$candidate" >/dev/null
}

cd /tmp
sha256sum -c "$CHECKSUM"
mkdir -p "$PACKAGE_ROOT"
if ! verify_release "$PACKAGE_PATH"; then
  STAGING="$(mktemp -d "$PACKAGE_ROOT/.incoming-$HASH_PREFIX.XXXXXX")"
  tar -xzf "$ARCHIVE" -C "$STAGING"
  verify_release "$STAGING"
  if [[ -e "$PACKAGE_PATH" ]]; then
    QUARANTINE="$PACKAGE_PATH.invalid.$(date -u +%Y%m%dT%H%M%SZ).$$"
    mv -- "$PACKAGE_PATH" "$QUARANTINE"
  fi
  mv -- "$STAGING" "$PACKAGE_PATH"
  STAGING=''
fi
bash "$APP_ROOT/tools/import-eom-zh-ubuntu.sh" __QUOTED_FLAGS__
rm -f -- "$ARCHIVE" "$CHECKSUM"
'@
  $remoteCommand = $remoteTemplate
  $remoteCommand = $remoteCommand.Replace('__REMOTE_ARCHIVE__', $remoteArchive)
  $remoteCommand = $remoteCommand.Replace('__REMOTE_CHECKSUM__', $remoteChecksum)
  $remoteCommand = $remoteCommand.Replace('__REMOTE_PACKAGE_ROOT__', $RemotePackageRoot)
  $remoteCommand = $remoteCommand.Replace('__REMOTE_PACKAGE__', $remotePackage)
  $remoteCommand = $remoteCommand.Replace('__REMOTE_APP_ROOT__', $RemoteAppRoot)
  $remoteCommand = $remoteCommand.Replace('__CONTENT_HASH__', $contentHash)
  $remoteCommand = $remoteCommand.Replace('__HASH_PREFIX__', $contentHash.Substring(0, 16))
  $remoteCommand = $remoteCommand.Replace('__QUOTED_FLAGS__', $quotedFlags)

  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteCommand))
  & ssh.exe $target "echo '$encodedCommand' | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote verification/import failed. The release package and resume state remain on the host."
  }
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Verified package transferred: $contentHash ($entryCount entries)."