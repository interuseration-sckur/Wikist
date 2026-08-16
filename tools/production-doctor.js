#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtimeDirectories = ["data", "content", "config", "logs", "plugins/vendor", "public/uploads", "webman-backend/runtime"];
const sensitiveFiles = ["webman-backend/.env", "data/wikist-stack.json", "data/centrifugo/config.json", "config/site.config.json"];

function parseArgs(argv) {
  const options = { repair: false, publicUrl: "", service: "wikist", nginxInclude: "", help: false };
  for (const arg of argv) {
    if (arg === "--repair") options.repair = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--public-url=")) options.publicUrl = arg.slice(13);
    else if (arg.startsWith("--service=")) options.service = arg.slice(10);
    else if (arg.startsWith("--nginx-include=")) options.nginxInclude = arg.slice(16);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[A-Za-z0-9@_.-]{1,180}$/.test(options.service)) throw new Error("Invalid systemd service name.");
  return options;
}

function usage() {
  return `
Wikist production doctor

Diagnostics only:
  sudo node tools/production-doctor.js --public-url=https://wiki.example.com --service=wikist

Repair runtime ownership, generated realtime configuration and system environment:
  sudo node tools/production-doctor.js --repair --public-url=https://wiki.example.com --service=wikist

Also install a WebSocket location into an already included Nginx snippet path:
  sudo node tools/production-doctor.js --repair --public-url=https://wiki.example.com \\
    --service=wikist --nginx-include=/path/inside/active/server/wikist-realtime.conf
`.trim();
}

function command(commandName, args, options = {}) {
  return childProcess.spawnSync(commandName, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    windowsHide: true,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function output(result) {
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function nginxBinary() {
  const discovered = command("which", ["nginx"]);
  const candidates = [String(discovered.stdout || "").trim(), "/www/server/nginx/sbin/nginx", "/usr/sbin/nginx"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {}
  }
  return "";
}

function reloadNginx(binary) {
  const systemd = command("systemctl", ["reload", "nginx"]);
  if (systemd.status === 0) return;
  const signal = command(binary, ["-s", "reload"]);
  if (signal.status !== 0) throw new Error(`Nginx reload failed: ${output(systemd) || output(signal)}`);
}

function serviceProperty(service, property) {
  const result = command("systemctl", ["show", service, `--property=${property}`, "--value"]);
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); } catch (_) { return fallback; }
}

function readEnvironment(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const raw of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

function environmentText(current, updates) {
  const pending = new Map(Object.entries(updates).map(([key, value]) => [key, String(value)]));
  const lines = String(current || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line, index, all) => line !== "" || index < all.length - 1);
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  for (const [key, value] of pending) next.push(`${key}=${value}`);
  return `${next.join("\n").replace(/\s*$/, "")}\n`;
}

function atomicWrite(filePath, content, mode, uid = null, gid = null) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  if (uid !== null && gid !== null) fs.chownSync(temporary, uid, gid);
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, filePath);
}

function canonicalPublicUrl(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash
    || !["", "/"].includes(parsed.pathname) || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Production diagnostics require a public HTTPS origin without a path, query or credentials.");
  }
  return parsed.origin;
}

function realtimeUrl(publicUrl) {
  return publicUrl.replace(/^https:/i, "wss:") + "/connection/websocket";
}

function identity(name) {
  const uidResult = command("id", ["-u", name]);
  const gidResult = command("id", ["-g", name]);
  const groupResult = command("id", ["-gn", name]);
  if (uidResult.status !== 0 || gidResult.status !== 0 || groupResult.status !== 0) throw new Error(`Unable to resolve service account ${name}.`);
  return { user: name, group: String(groupResult.stdout).trim(), uid: Number(uidResult.stdout), gid: Number(gidResult.stdout) };
}

function safeRuntimePath(relative) {
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error(`Unsafe runtime path: ${target}`);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Refusing symbolic-link runtime path: ${target}`);
  return target;
}

function repairTree(target, account) {
  const visit = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    fs.chownSync(current, account.uid, account.gid);
    const mode = stat.isDirectory() ? 0o700 : ((stat.mode & 0o111) !== 0 ? 0o700 : 0o600);
    fs.chmodSync(current, mode);
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(current)) visit(path.join(current, entry));
  };
  fs.mkdirSync(target, { recursive: true, mode: 0o750 });
  visit(target);
}

function runAs(account, executable, args) {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return command("runuser", ["-u", account.user, "--", executable, ...args]);
  }
  return command(executable, args);
}

function canAccess(account, target, mode) {
  return runAs(account, "test", [`-${mode}`, target]).status === 0;
}

function tcpProbe(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(timeout, () => done(false, "timeout"));
    socket.once("connect", () => done(true, "listening"));
    socket.once("error", (error) => done(false, error.code || error.message));
  });
}

function httpProbe(target, timeout = 2000) {
  return new Promise((resolve) => {
    const parsed = new URL(target);
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.get(parsed, { timeout }, (response) => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, detail: `HTTP ${response.statusCode}` });
    });
    request.once("timeout", () => {
      request.destroy();
      resolve({ ok: false, detail: "timeout" });
    });
    request.once("error", (error) => resolve({ ok: false, detail: error.code || error.message }));
  });
}

function websocketProbe(target, origin, timeout = 4000) {
  return new Promise((resolve) => {
    const parsed = new URL(target);
    const transport = parsed.protocol === "wss:" ? https : http;
    const request = transport.request({
      protocol: parsed.protocol === "wss:" ? "https:" : "http:",
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
      },
    });
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      request.destroy();
      resolve({ ok, detail });
    };
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      done(response.statusCode === 101, `HTTP ${response.statusCode}`);
    });
    request.once("response", (response) => {
      response.resume();
      done(false, `HTTP ${response.statusCode}${response.headers["x-wikist-backend"] ? " via Wikist backend" : ""}`);
    });
    request.once("timeout", () => done(false, "timeout"));
    request.once("error", (error) => done(false, error.code || error.message));
    request.end();
  });
}

function nginxSnippet() {
  return `# Managed by Wikist production doctor. Include inside the HTTPS server block.\nlocation = /connection/websocket {\n    proxy_pass http://127.0.0.1:8902;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_set_header Host $host;\n    proxy_set_header Origin $http_origin;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-Host $host;\n    proxy_set_header X-Forwarded-Proto https;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_cache off;\n    proxy_buffering off;\n    proxy_request_buffering off;\n    proxy_read_timeout 3600s;\n    proxy_send_timeout 3600s;\n}\n`;
}

function installNginxSnippet(filePath) {
  if (!path.isAbsolute(filePath) || !filePath.endsWith(".conf")) throw new Error("--nginx-include must be an absolute .conf path included by the HTTPS server block.");
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.lstatSync(parent).isDirectory()) throw new Error(`Nginx include directory does not exist: ${parent}`);
  if (fs.lstatSync(parent).isSymbolicLink()) throw new Error(`Refusing symbolic-link Nginx include directory: ${parent}`);
  const backup = fs.existsSync(filePath) ? `${filePath}.backup-${Date.now()}` : "";
  if (backup) fs.copyFileSync(filePath, backup, fs.constants.COPYFILE_EXCL);
  atomicWrite(filePath, nginxSnippet(), 0o644);
  const binary = nginxBinary();
  if (!binary) throw new Error("Nginx executable was not found in PATH or the standard BT Panel path.");
  const test = command(binary, ["-t"]);
  if (test.status !== 0) {
    if (backup) fs.copyFileSync(backup, filePath); else fs.rmSync(filePath, { force: true });
    throw new Error(`nginx -t failed and the snippet was rolled back: ${output(test)}`);
  }
  reloadNginx(binary);
}

function createRepairSnapshot(context, nginxInclude) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshot = path.join(root, "data", "production-repairs", stamp);
  fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
  const sources = [
    [path.join(root, "webman-backend", ".env"), "webman.env"],
    [path.join(root, "config", "site.config.json"), "site.config.json"],
    [path.join(root, "data", "wikist-stack.json"), "wikist-stack.json"],
    [path.join(root, "data", "centrifugo", "config.json"), "centrifugo-config.json"],
    [context.systemEnvPath, "systemd-wikist.env"],
  ];
  if (nginxInclude) sources.push([nginxInclude, "nginx-realtime.conf"]);
  for (const [source, name] of sources) {
    if (!fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink()) continue;
    const destination = path.join(snapshot, name);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
  }
  fs.writeFileSync(path.join(snapshot, "README.txt"), `Wikist production repair snapshot\nCreated: ${new Date().toISOString()}\nPublic URL: ${context.publicUrl}\n`, { mode: 0o600 });
  return snapshot;
}

function resolveContext(options) {
  const site = readJson(path.join(root, "config", "site.config.json"), {});
  const localEnv = readEnvironment(path.join(root, "webman-backend", ".env"));
  const systemEnvPath = "/etc/wikist/wikist.env";
  const systemEnv = readEnvironment(systemEnvPath);
  const publicUrl = canonicalPublicUrl(options.publicUrl || systemEnv.WIKIST_PUBLIC_URL || site.publicUrl || localEnv.WIKIST_PUBLIC_URL || localEnv.APP_URL);
  const configuredUser = serviceProperty(options.service, "User") || "wikist";
  const account = identity(configuredUser);
  return { site, localEnv, systemEnv, systemEnvPath, publicUrl, realtimeUrl: realtimeUrl(publicUrl), account };
}

function synchronizeConfiguration(context) {
  const { account, publicUrl, realtimeUrl: publicRealtime, systemEnvPath } = context;
  for (const relative of runtimeDirectories) repairTree(safeRuntimePath(relative), account);
  for (const relative of sensitiveFiles) {
    const target = safeRuntimePath(relative);
    if (!fs.existsSync(target)) continue;
    fs.chownSync(target, account.uid, account.gid);
    fs.chmodSync(target, 0o600);
  }

  const stackPath = path.join(root, "data", "wikist-stack.json");
  const centrifugoPath = path.join(root, "data", "centrifugo", "config.json");
  const stack = readJson(stackPath, {});
  const centrifugo = stack.centrifugo || {};
  if (centrifugo.enabled === true && (!centrifugo.apiKey || !centrifugo.tokenHmacSecret)) {
    throw new Error("Centrifugo stack secrets are missing; run npm run setup:stack before repair.");
  }
  if (fs.existsSync(centrifugoPath)) {
    const config = readJson(centrifugoPath, {});
    config.health = { enabled: true };
    atomicWrite(centrifugoPath, `${JSON.stringify(config, null, 2)}\n`, 0o600, account.uid, account.gid);
  }

  if (fs.existsSync(systemEnvPath)) {
    const current = fs.readFileSync(systemEnvPath, "utf8");
    const updates = {
      APP_URL: publicUrl,
      WIKIST_PUBLIC_URL: publicUrl,
      TRUSTED_ORIGINS: publicUrl,
      CENTRIFUGO_ENABLED: String(centrifugo.enabled === true),
      CENTRIFUGO_PUBLIC_URL: publicRealtime,
      CENTRIFUGO_API_URL: `http://${centrifugo.host || "127.0.0.1"}:${centrifugo.port || 8902}/api`,
    };
    if (centrifugo.apiKey) updates.CENTRIFUGO_API_KEY = centrifugo.apiKey;
    if (centrifugo.tokenHmacSecret) updates.CENTRIFUGO_TOKEN_HMAC_SECRET = centrifugo.tokenHmacSecret;
    atomicWrite(systemEnvPath, environmentText(current, updates), 0o640, 0, account.gid);
  }

  const localEnvPath = path.join(root, "webman-backend", ".env");
  if (fs.existsSync(localEnvPath)) {
    const current = fs.readFileSync(localEnvPath, "utf8");
    atomicWrite(localEnvPath, environmentText(current, {
      APP_URL: publicUrl,
      WIKIST_PUBLIC_URL: publicUrl,
      TRUSTED_ORIGINS: publicUrl,
      CENTRIFUGO_PUBLIC_URL: publicRealtime,
    }), 0o600, account.uid, account.gid);
  }
}

async function diagnose(options, context) {
  const checks = [];
  const record = (name, ok, detail, severity = "error") => checks.push({ name, ok, detail, severity: ok ? "ok" : severity });
  const stack = readJson(path.join(root, "data", "wikist-stack.json"), {});
  const centrifugo = stack.centrifugo || {};
  const config = readJson(path.join(root, "data", "centrifugo", "config.json"), {});
  const systemEnv = readEnvironment(context.systemEnvPath);

  record("systemd.service", command("systemctl", ["status", options.service, "--no-pager"]).status === 0, serviceProperty(options.service, "ActiveState") || "not installed");
  record("systemd.account", Boolean(context.account.user && context.account.group), `${context.account.user}:${context.account.group}`);
  for (const relative of runtimeDirectories) {
    const target = safeRuntimePath(relative);
    record(`filesystem.${relative}`, fs.existsSync(target) && canAccess(context.account, target, "r") && canAccess(context.account, target, "w"), target);
  }
  for (const relative of sensitiveFiles) {
    const target = safeRuntimePath(relative);
    record(`filesystem.${relative}`, !fs.existsSync(target) || canAccess(context.account, target, "r"), fs.existsSync(target) ? target : "not present", "warning");
  }
  record("realtime.enabled", centrifugo.enabled === true && systemEnv.CENTRIFUGO_ENABLED === "true", String(centrifugo.enabled === true));
  record("realtime.health_config", config.health?.enabled === true, config.health?.enabled === true ? "enabled on loopback" : "disabled", "warning");
  record("realtime.token_secret", Boolean(centrifugo.tokenHmacSecret) && centrifugo.tokenHmacSecret === config.client?.token?.hmac_secret_key && centrifugo.tokenHmacSecret === systemEnv.CENTRIFUGO_TOKEN_HMAC_SECRET, "stack/config/systemd match");
  record("realtime.api_key", Boolean(centrifugo.apiKey) && centrifugo.apiKey === config.http_api?.key && centrifugo.apiKey === systemEnv.CENTRIFUGO_API_KEY, "stack/config/systemd match");
  record("realtime.public_url", systemEnv.CENTRIFUGO_PUBLIC_URL === context.realtimeUrl, systemEnv.CENTRIFUGO_PUBLIC_URL || "missing");

  for (const port of [8899, 8900, Number(centrifugo.port || 8902)]) {
    const probe = await tcpProbe("127.0.0.1", port);
    record(`listener.${port}`, probe.ok, probe.detail);
  }
  const health = await httpProbe(`http://127.0.0.1:${Number(centrifugo.port || 8902)}/health`);
  record("realtime.health_endpoint", health.ok, health.detail);
  const localWebsocket = await websocketProbe(`ws://127.0.0.1:${Number(centrifugo.port || 8902)}/connection/websocket`, context.publicUrl);
  record("realtime.websocket_local", localWebsocket.ok, localWebsocket.detail);
  const publicWebsocket = await websocketProbe(context.realtimeUrl, context.publicUrl);
  record("realtime.websocket_public", publicWebsocket.ok, publicWebsocket.detail + (publicWebsocket.detail.includes("Wikist backend") ? "; Nginx route is missing or shadowed" : ""));

  const binary = nginxBinary();
  const nginx = binary ? command(binary, ["-T"]) : { status: 1, stdout: "", stderr: "" };
  if (nginx.status === 0) {
    const source = `${nginx.stdout || ""}${nginx.stderr || ""}`;
    const hasRoute = /location\s+(?:=\s*)?\/connection\/websocket\s*\{[\s\S]*?proxy_pass\s+http:\/\/127\.0\.0\.1:8902\s*;/m.test(source);
    record("nginx.websocket_route", hasRoute, hasRoute ? "127.0.0.1:8902" : "missing from active configuration");
  } else {
    record("nginx.websocket_route", false, "nginx -T unavailable", "warning");
  }
  return checks;
}

function printChecks(checks) {
  for (const check of checks) {
    const mark = check.ok ? "OK" : check.severity === "warning" ? "WARN" : "FAIL";
    console.log(`${mark.padEnd(4)} ${check.name.padEnd(38)} ${check.detail}`);
  }
  const failed = checks.filter((check) => !check.ok && check.severity === "error").length;
  const warnings = checks.filter((check) => !check.ok && check.severity === "warning").length;
  console.log(`\nProduction diagnostics: ${failed} failure(s), ${warnings} warning(s).`);
  return failed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (process.platform !== "linux") throw new Error("Production doctor currently supports Linux/systemd deployments.");
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("Production diagnostics must run as root so checks use the actual systemd service account.");
  }
  let context = resolveContext(options);
  if (options.repair) {
    const snapshot = createRepairSnapshot(context, options.nginxInclude);
    console.log(`Repair snapshot: ${snapshot}`);
    command("systemctl", ["stop", options.service]);
    synchronizeConfiguration(context);
    if (options.nginxInclude) installNginxSnippet(options.nginxInclude);
    const reset = command("systemctl", ["reset-failed", options.service]);
    if (reset.status !== 0) throw new Error(output(reset));
    const start = command("systemctl", ["start", options.service]);
    if (start.status !== 0) throw new Error(output(start));
    await new Promise((resolve) => setTimeout(resolve, 5000));
    context = resolveContext(options);
  }
  const failed = printChecks(await diagnose(options, context));
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`Wikist production doctor failed: ${error.message}`);
  process.exitCode = 1;
});
