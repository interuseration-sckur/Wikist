#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, "data", "deployment");

function parseArgs(argv) {
  const options = { publicUrl: "", user: "wikist", apply: false, yes: false, noStart: false };
  for (const arg of argv) {
    if (arg.startsWith("--public-url=")) options.publicUrl = arg.slice(13);
    else if (arg.startsWith("--user=")) options.user = arg.slice(7);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--no-start") options.noStart = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(options.user)) throw new Error("Invalid service user name.");
  return options;
}

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); } catch (_) { return fallback; }
}

function canonical(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch (_) { parsed = null; }
  if (!parsed || parsed.protocol !== "https:" || !parsed.host || parsed.username || parsed.password
    || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)
    || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Production service installation requires a public HTTPS --public-url origin.");
  }
  return parsed.origin;
}

function envMap(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const raw of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

function secret(existing) {
  return String(existing || "").length >= 32 ? String(existing) : crypto.randomBytes(32).toString("base64url");
}

function atomicWrite(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, mode); } catch (_) {}
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { cwd: options.cwd || root, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} exited with status ${result.status}`);
}

function generate(options) {
  const site = readJson(path.join(root, "config", "site.config.json"), {});
  const publicUrl = canonical(options.publicUrl || site.publicUrl);
  const publicHost = new URL(publicUrl).hostname;
  const existing = envMap(path.join(root, "webman-backend", ".env"));
  const stack = readJson(path.join(root, "data", "wikist-stack.json"), {});
  const centrifugo = stack.centrifugo || {};
  const realtimeEnabled = centrifugo.enabled === true;
  if (realtimeEnabled && (!centrifugo.apiKey || !centrifugo.tokenHmacSecret)) {
    throw new Error("Realtime stack is not initialized. Run npm run setup:stack first.");
  }
  const realtimeUrl = `wss://${publicHost}/connection/websocket`;
  const database = String(site.passport?.database || "data/wikist.sqlite").replace(/\\/g, "/");
  const environment = [
    "APP_ENV=production",
    "APP_DEBUG=false",
    `APP_NAME=${String(site.name || "Wikist").replace(/[\r\n=]/g, "")}`,
    `APP_URL=${publicUrl}`,
    `WIKIST_PUBLIC_URL=${publicUrl}`,
    `APP_SECRET=${secret(existing.APP_SECRET)}`,
    "WEBMAN_HOST=127.0.0.1",
    "WEBMAN_PORT=8899",
    "WEBMAN_WORKERS=1",
    `WEBMAN_USER=${options.user}`,
    `WEBMAN_GROUP=${options.user}`,
    "WIKIST_DB_DRIVER=sqlite",
    "WIKIST_DB_PROFILE=sqlite-single-host",
    `WIKIST_DB_DATABASE=${path.join(root, database).replace(/\\/g, "/")}`,
    "WIKIST_DB_BUSY_TIMEOUT=10000",
    "WIKIST_DB_SYNCHRONOUS=normal",
    `TRUSTED_ORIGINS=${publicUrl}`,
    "TRUSTED_PROXIES=127.0.0.1/32,::1/128",
    "SESSION_SECURE=true",
    "LEGACY_NODE_PROXY=true",
    "LEGACY_NODE_URL=http://127.0.0.1:8900",
    `LEGACY_NODE_TOKEN=${secret(existing.LEGACY_NODE_TOKEN)}`,
    `CENTRIFUGO_ENABLED=${realtimeEnabled}`,
    `CENTRIFUGO_PUBLIC_URL=${realtimeUrl}`,
    "CENTRIFUGO_API_URL=http://127.0.0.1:8902/api",
    `CENTRIFUGO_API_KEY=${centrifugo.apiKey}`,
    `CENTRIFUGO_TOKEN_HMAC_SECRET=${centrifugo.tokenHmacSecret}`,
    "WIKIST_INSTALL_MODE=0",
    "WIKIST_INSTALL_MODE_TTL_SECONDS=900",
    "",
  ].join("\n");
  const node = process.execPath.replace(/\\/g, "/");
  const project = root.replace(/\\/g, "/");
  const writablePaths = ["data", "content", "config", "logs", "plugins/vendor", "public/uploads", "webman-backend/runtime", ".runtime/centrifugo"]
    .map((relative) => `${project}/${relative}`)
    .join(" ");
  const service = `[Unit]\nDescription=Wikist knowledge platform\nAfter=network-online.target\nWants=network-online.target\nX-Wikist-Service-Version=2\n\n[Service]\nType=simple\nUser=${options.user}\nGroup=${options.user}\nWorkingDirectory=${project}\nEnvironmentFile=/etc/wikist/wikist.env\nExecStart=${node} ${project}/tools/start-hybrid.js\nExecStop=${node} ${project}/tools/start-hybrid.js --stop\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\nLimitNOFILE=65536\nUMask=0027\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=read-only\nProtectSystem=strict\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nReadWritePaths=${writablePaths}\n\n[Install]\nWantedBy=multi-user.target\n`;
  const nginx = `server {\n    listen 80;\n    server_name ${publicHost};\n    return 301 https://$host$request_uri;\n}\n\nserver {\n    listen 443 ssl http2;\n    server_name ${publicHost};\n\n    # Configure ssl_certificate and ssl_certificate_key for this host.\n    client_max_body_size 256m;\n\n    location /connection/websocket {\n        proxy_pass http://127.0.0.1:8902;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto https;\n    }\n\n    location / {\n        proxy_pass http://127.0.0.1:8899;\n        proxy_http_version 1.1;\n        proxy_set_header Host $http_host;\n        proxy_set_header X-Forwarded-Host $http_host;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    }\n}\n`;
  const caddy = `${publicHost} {\n    reverse_proxy /connection/websocket 127.0.0.1:8902\n    reverse_proxy 127.0.0.1:8899\n}\n`;
  atomicWrite(path.join(outputRoot, "wikist.env"), environment, 0o600);
  atomicWrite(path.join(outputRoot, "wikist.service"), service, 0o644);
  atomicWrite(path.join(outputRoot, "nginx-wikist.conf"), nginx, 0o644);
  atomicWrite(path.join(outputRoot, "Caddyfile"), caddy, 0o644);
  return { publicUrl, realtimeUrl, outputRoot, environment, service };
}

function apply(result, options) {
  if (process.platform !== "linux") throw new Error("--apply is only supported on Linux. Generated files can still be inspected on this platform.");
  if (typeof process.getuid !== "function" || process.getuid() !== 0) throw new Error("--apply must run as root so systemd files can be installed safely.");
  if (!options.yes) throw new Error("Review data/deployment first, then rerun with --apply --yes.");
  if (/\s/.test(root)) throw new Error("The Linux service installer requires a project path without whitespace.");
  let account = childProcess.spawnSync("id", ["-u", options.user], { encoding: "utf8", windowsHide: true });
  if (account.error || account.status !== 0) {
    run("useradd", ["--system", "--user-group", "--home-dir", root, "--no-create-home", "--shell", "/usr/sbin/nologin", options.user]);
    account = childProcess.spawnSync("id", ["-u", options.user], { encoding: "utf8", windowsHide: true });
    if (account.error || account.status !== 0) throw new Error(`Unable to create service user ${options.user}.`);
  }
  const groupResult = childProcess.spawnSync("id", ["-gn", options.user], { encoding: "utf8", windowsHide: true });
  if (groupResult.error || groupResult.status !== 0) throw new Error(`Unable to resolve the primary group for ${options.user}.`);
  const group = String(groupResult.stdout).trim();
  result.environment = result.environment.replace(/^WEBMAN_GROUP=.*$/m, `WEBMAN_GROUP=${group}`);
  result.service = result.service.replace(/^Group=.*$/m, `Group=${group}`);

  const writable = ["data", "content", "config", "logs", "plugins/vendor", "public/uploads", "webman-backend/runtime", ".runtime/centrifugo"]
    .map((relative) => path.resolve(root, relative));
  for (const directory of writable) {
    if (directory !== root && !directory.startsWith(root + path.sep)) throw new Error(`Unsafe runtime directory: ${directory}`);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Refusing to manage a symbolic-link runtime directory: ${directory}`);
    }
    run("install", ["-d", "-o", options.user, "-g", group, "-m", "0750", directory]);
    run("chown", ["-R", "-h", `${options.user}:${group}`, directory]);
    run("chmod", ["-R", "u+rwX", directory]);
  }
  const siteConfig = path.join(root, "config", "site.config.json");
  if (fs.existsSync(siteConfig)) run("chown", [`${options.user}:${group}`, siteConfig]);
  const serviceOwnedSecrets = [
    path.join(root, "webman-backend", ".env"),
    path.join(root, "data", "wikist-stack.json"),
    path.join(root, "data", "centrifugo", "config.json"),
  ];
  for (const filePath of serviceOwnedSecrets) {
    if (!fs.existsSync(filePath)) continue;
    if (fs.lstatSync(filePath).isSymbolicLink()) throw new Error(`Refusing to change ownership of a symbolic link: ${filePath}`);
    run("chown", [`${options.user}:${group}`, filePath]);
    run("chmod", ["0600", filePath]);
  }
  run(process.execPath, [path.join(root, "tools", "migrate-server.js"), `--public-url=${result.publicUrl}`, "--mode=single-production", "--yes"]);
  run("install", ["-d", "-o", "root", "-g", group, "-m", "0750", "/etc/wikist"]);
  atomicWrite("/etc/wikist/wikist.env", result.environment, 0o640);
  run("chown", [`root:${group}`, "/etc/wikist/wikist.env"]);
  atomicWrite("/etc/systemd/system/wikist.service", result.service, 0o644);
  run("systemctl", ["daemon-reload"]);
  run("systemctl", ["enable", "wikist.service"]);
  if (!options.noStart) run("systemctl", ["start", "wikist.service"]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: npm run service:install -- --public-url=https://wiki.example.com [--user=wikist] [--apply --yes] [--no-start]");
    return;
  }
  const result = generate(options);
  if (options.apply) apply(result, options);
  console.log(JSON.stringify({ ok: true, applied: options.apply, publicUrl: result.publicUrl, realtimeUrl: result.realtimeUrl, files: path.relative(root, outputRoot).replace(/\\/g, "/") }, null, 2));
}

try { main(); } catch (error) { console.error(`Wikist service installation failed: ${error.message}`); process.exit(1); }
