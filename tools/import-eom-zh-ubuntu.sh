#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/wikist"
PACKAGE=""
SERVICE="wikist"
BATCH_SIZE="200"
STATE=""
OVERWRITE=0
DRY_RUN=0
BACKUP=1
DOCTOR=1

usage() {
  cat <<'EOF'
Usage: sudo bash tools/import-eom-zh-ubuntu.sh --package=PATH [options]

Options:
  --package=PATH       Ready EoM Chinese release package (required)
  --root=PATH          Wikist application root (default: /opt/wikist)
  --app-root=PATH      Alias for --root
  --service=NAME       systemd service (default: wikist; use none to skip)
  --batch-size=N       Entries handled in this invocation (default: 200)
  --state=PATH         Resume-state path under <root>/data/imports
  --overwrite          Update existing EoM pages; non-EoM pages stay protected
  --no-backup          Skip the importer's first-write backup
  --no-doctor          Skip production-doctor after a real batch
  --dry-run            Verify and plan only; do not stop the service
EOF
}

for argument in "$@"; do
  case "$argument" in
    --package=*) PACKAGE="${argument#*=}" ;;
    --root=*|--app-root=*) APP_ROOT="${argument#*=}" ;;
    --service=*) SERVICE="${argument#*=}" ;;
    --batch-size=*) BATCH_SIZE="${argument#*=}" ;;
    --state=*) STATE="${argument#*=}" ;;
    --overwrite) OVERWRITE=1 ;;
    --no-backup) BACKUP=0 ;;
    --no-doctor) DOCTOR=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --resume) ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

if [[ -z "$PACKAGE" ]]; then
  printf '%s\n' '--package is required.' >&2
  usage >&2
  exit 2
fi
if [[ ! "$BATCH_SIZE" =~ ^[1-9][0-9]*$ ]] || (( BATCH_SIZE > 10000 )); then
  printf '%s\n' '--batch-size must be 1..10000.' >&2
  exit 2
fi
if [[ "$SERVICE" != "none" && ! "$SERVICE" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  printf '%s\n' 'Invalid systemd service name.' >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js is required.' >&2; exit 1; }
command -v realpath >/dev/null 2>&1 || { printf '%s\n' 'realpath is required.' >&2; exit 1; }
[[ "$SERVICE" == "none" ]] || command -v systemctl >/dev/null 2>&1 || { printf '%s\n' 'systemctl is required unless --service=none.' >&2; exit 1; }
APP_ROOT="$(realpath -e "$APP_ROOT")"
PACKAGE="$(realpath -e "$PACKAGE")"
[[ "$APP_ROOT" != "/" && "$PACKAGE" != "/" ]] || { printf '%s\n' 'Unsafe root path.' >&2; exit 2; }
[[ -f "$APP_ROOT/package.json" ]] || { printf 'Wikist package.json not found in %s\n' "$APP_ROOT" >&2; exit 1; }
[[ -f "$PACKAGE/manifest.json" && -f "$PACKAGE/checksums.sha256" ]] || { printf 'Ready package metadata not found in %s\n' "$PACKAGE" >&2; exit 1; }

IMPORT_ARGS=("--package=$PACKAGE" "--root=$APP_ROOT" "--batch-size=$BATCH_SIZE")
[[ -z "$STATE" ]] || IMPORT_ARGS+=("--state=$STATE")
(( OVERWRITE == 0 )) || IMPORT_ARGS+=("--overwrite")
(( BACKUP == 1 )) || IMPORT_ARGS+=("--no-backup")

PREFLIGHT="$(mktemp /tmp/wikist-eom-zh-preflight.XXXXXX.json)"
RESULT="$(mktemp /tmp/wikist-eom-zh-result.XXXXXX.json)"
WAS_ACTIVE=0
cleanup() {
  rm -f -- "$PREFLIGHT" "$RESULT"
  if (( WAS_ACTIVE == 1 )) && [[ "$SERVICE" != "none" ]]; then
    systemctl start "$SERVICE" || true
  fi
}
trap cleanup EXIT

cd "$APP_ROOT"
set +e
node tools/eom-zh-import.js "${IMPORT_ARGS[@]}" --dry-run >"$PREFLIGHT"
PREFLIGHT_STATUS=$?
set -e
cat "$PREFLIGHT"
if (( PREFLIGHT_STATUS != 0 )); then
  exit "$PREFLIGHT_STATUS"
fi
if (( DRY_RUN == 1 )); then
  exit 0
fi

if [[ "$SERVICE" != "none" ]] && systemctl is-active --quiet "$SERVICE"; then
  WAS_ACTIVE=1
  systemctl stop "$SERVICE"
fi

set +e
node tools/eom-zh-import.js "${IMPORT_ARGS[@]}" >"$RESULT"
IMPORT_STATUS=$?
set -e
cat "$RESULT"
if (( IMPORT_STATUS != 0 )); then
  exit "$IMPORT_STATUS"
fi

if (( WAS_ACTIVE == 1 )); then
  systemctl start "$SERVICE"
  WAS_ACTIVE=0
fi
if (( DOCTOR == 1 )); then
  node tools/production-doctor.js
fi

REMAINING="$(node -e 'const fs=require("node:fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(x.remainingAfterBatch ?? "unknown"));' "$RESULT")"
printf 'EoM Chinese import batch completed; remaining: %s\n' "$REMAINING"