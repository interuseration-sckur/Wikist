#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PUBLIC_URL=""
SERVICE_USER="wikist"
REALTIME=1
NODE_VERSION="22.18.0"

for arg in "$@"; do
  case "$arg" in
    --public-url=*) PUBLIC_URL="${arg#*=}" ;;
    --user=*) SERVICE_USER="${arg#*=}" ;;
    --no-realtime) REALTIME=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root (sudo)." >&2
  exit 1
fi
if [[ -z "$PUBLIC_URL" ]]; then
  echo "Usage: sudo bash tools/install-ubuntu.sh --public-url=https://wiki.example.com [--user=wikist] [--no-realtime]" >&2
  exit 2
fi
if [[ ! "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "Invalid service user." >&2
  exit 2
fi
if [[ ! -r /etc/os-release ]]; then
  echo "This installer supports Ubuntu 22.04 and 24.04." >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This installer supports Ubuntu 22.04 and 24.04; detected ${ID:-unknown}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git tar xz-utils unzip software-properties-common

if ! command -v php >/dev/null 2>&1 || ! php -r 'exit(PHP_VERSION_ID >= 80401 ? 0 : 1);'; then
  add-apt-repository -y ppa:ondrej/php
  apt-get update
fi
apt-get install -y --no-install-recommends \
  php8.4-cli php8.4-curl php8.4-gd php8.4-intl php8.4-mbstring php8.4-opcache \
  php8.4-sqlite3 php8.4-xml php8.4-zip

if ! command -v node >/dev/null 2>&1 || ! node -e "const [a,b]=process.versions.node.split('.').map(Number);require('node:sqlite');process.exit(a>22||(a===22&&b>=5)?0:1)"; then
  case "$(uname -m)" in
    x86_64) NODE_ARCH="x64"; NODE_SHA256="c1bfeecf1d7404fa74728f9db72e697decbd8119ccc6f5a294d795756dfcfca7" ;;
    aarch64|arm64) NODE_ARCH="arm64"; NODE_SHA256="04fca1b9afecf375f26b41d65d52aa1703a621abea5a8948c7d1e351e85edade" ;;
    *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  NODE_ASSET="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  NODE_PREFIX="/opt/wikist-runtime/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf -- "$TMP_DIR"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ASSET}" -o "$TMP_DIR/$NODE_ASSET"
  echo "$NODE_SHA256  $TMP_DIR/$NODE_ASSET" | sha256sum --check --strict
  install -d -m 0755 /opt/wikist-runtime
  tar -xJf "$TMP_DIR/$NODE_ASSET" -C /opt/wikist-runtime
  ln -sfn "$NODE_PREFIX/bin/node" /usr/local/bin/node
  ln -sfn "$NODE_PREFIX/bin/npm" /usr/local/bin/npm
  ln -sfn "$NODE_PREFIX/bin/npx" /usr/local/bin/npx
  hash -r
fi

install -d -m 0750 "$ROOT/.runtime/composer"
COMPOSER_INSTALLER="$ROOT/.runtime/composer/composer-setup.php"
EXPECTED_CHECKSUM="$(curl --fail --location --proto '=https' --tlsv1.2 https://composer.github.io/installer.sig)"
curl --fail --location --proto '=https' --tlsv1.2 https://getcomposer.org/installer -o "$COMPOSER_INSTALLER"
ACTUAL_CHECKSUM="$(php -r "echo hash_file('sha384', '$COMPOSER_INSTALLER');")"
if [[ "$EXPECTED_CHECKSUM" != "$ACTUAL_CHECKSUM" ]]; then
  echo "Composer installer checksum verification failed." >&2
  exit 1
fi
php "$COMPOSER_INSTALLER" --2 --install-dir="$ROOT/.runtime/composer" --filename=composer.phar --quiet
rm -f -- "$COMPOSER_INSTALLER"

cd "$ROOT"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
php "$ROOT/.runtime/composer/composer.phar" install --working-dir="$ROOT/webman-backend" \
  --no-dev --optimize-autoloader --no-interaction --no-progress --no-scripts --no-plugins
if [[ "$REALTIME" -eq 1 ]]; then
  npm run setup:stack
else
  npm run setup:stack -- --no-realtime
fi
npm run service:install -- --public-url="$PUBLIC_URL" --user="$SERVICE_USER" --apply --yes
npm run doctor -- --all

echo "Wikist is running at $PUBLIC_URL"
echo "Open $PUBLIC_URL/install.html to finish the site profile and create the initial administrator."
if [[ "$REALTIME" -eq 1 ]]; then
  echo "Before accepting traffic, proxy the exact /connection/websocket path to 127.0.0.1:8902."
  echo "Then run: cd '$ROOT' && sudo npm run doctor:production -- --public-url=$PUBLIC_URL --service=wikist"
fi
