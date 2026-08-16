#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.env.WIKIST_MIGRATION_ROOT || path.resolve(__dirname, ".."));
const sitePath = path.join(root, "config", "site.config.json");
const envPath = path.join(root, "webman-backend", ".env");
const stackPath = path.join(root, "data", "wikist-stack.json");
const centrifugoPath = path.join(root, "data", "centrifugo", "config.json");
const systemEnvPath = process.env.WIKIST_SYSTEM_ENV
  || (process.env.WIKIST_MIGRATION_ROOT ? path.join(root, "etc", "wikist", "wikist.env") : (process.platform === "win32" ? "" : "/etc/wikist/wikist.env"));

function options(argv) {
  const value = { publicUrl: "", mode: "", yes: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") value.yes = true;
    else if (arg === "--dry-run") value.dryRun = true;
    else if (arg.startsWith("--public-url=")) value.publicUrl = arg.slice(13);
    else if (arg.startsWith("--mode=")) value.mode = arg.slice(7);
    else if (arg === "--help" || arg === "-h") value.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return value;
}

function canonicalPublicUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch (_) { parsed = null; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password
    || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw new Error("--public-url must be one complete HTTP(S) origin without a path, credentials, query, or fragment.");
  }
  return parsed.origin;
}

function readJson(filePath, fallback = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

function atomicWrite(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, mode); } catch (_) {}
}

function backup(files, dryRun) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(root, "data", "migrations", `server-${stamp}`);
  const copied = [];
  if (!dryRun) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const filePath of files) {
    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) continue;
    const relative = path.relative(root, filePath).replace(/\\/g, "/");
    const target = path.join(directory, relative.replace(/\//g, "__"));
    if (!dryRun) fs.copyFileSync(filePath, target, fs.constants.COPYFILE_EXCL);
    copied.push(relative);
  }
  return { directory: path.relative(root, directory).replace(/\\/g, "/"), files: copied };
}

function envValue(content, name) {
  const match = content.match(new RegExp(`^${name}=([^\\r\\n]*)$`, "m"));
  return match ? match[1].trim().replace(/^(["'])(.*)\1$/, "$2") : "";
}

function setEnv(content, name, value) {
  if (/\r|\n|\0/.test(value)) throw new Error(`Unsafe value for ${name}.`);
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.replace(/\s*$/, "")}\n${line}\n`;
}

function wsUrl(publicUrl) {
  const parsed = new URL(publicUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/connection/websocket";
  return parsed.toString();
}

function originList(current, publicUrl, excluded = []) {
  const removed = new Set(excluded.map((item) => String(item || "").replace(/\/$/, "")));
  const values = String(current || "").split(",").map((item) => item.trim()).filter(Boolean);
  const publicHosts = values.filter((item) => {
    if (removed.has(item.replace(/\/$/, ""))) return false;
    try {
      const url = new URL(item);
      return !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
    } catch (_) { return false; }
  });
  return Array.from(new Set([publicUrl, ...publicHosts])).join(",");
}

function scanResidues(previousUrls, files) {
  const needles = Array.from(new Set(previousUrls.filter(Boolean).map((item) => String(item).replace(/\/$/, ""))))
    .filter((item) => !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(item));
  const found = [];
  for (const filePath of files) {
    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const needle of needles) if (content.includes(needle)) found.push({ file: path.relative(root, filePath).replace(/\\/g, "/"), value: needle });
  }
  return found;
}

function migrate(input) {
  const publicUrl = canonicalPublicUrl(input.publicUrl);
  const requestedMode = input.mode || (new URL(publicUrl).protocol === "https:" ? "single-production" : "development");
  const mode = ({ "local-development": "development", "reverse-proxy": "advanced", cluster: "advanced" })[requestedMode] || requestedMode;
  if (!/^(?:development|single-production|advanced)$/.test(mode)) throw new Error("Unsupported deployment mode.");
  const parsedPublicUrl = new URL(publicUrl);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsedPublicUrl.hostname.toLowerCase());
  if (mode === "single-production" && (parsedPublicUrl.protocol !== "https:" || localHost)) {
    throw new Error("single-production mode requires a public HTTPS origin.");
  }
  if (!input.yes && !input.dryRun) throw new Error("Refusing to change deployment configuration without --yes. Use --dry-run to inspect it first.");

  const site = readJson(sitePath, {});
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "") : "";
  const stack = readJson(stackPath, {});
  const centrifugo = readJson(centrifugoPath, {});
  const systemEnv = systemEnvPath && fs.existsSync(systemEnvPath) ? fs.readFileSync(systemEnvPath, "utf8").replace(/^\uFEFF/, "") : "";
  const previousUrls = [site.publicUrl, site.mail?.baseUrl, envValue(env, "WIKIST_PUBLIC_URL"), envValue(env, "APP_URL")];
  const snapshot = backup([sitePath, envPath, stackPath, centrifugoPath, ...(systemEnvPath ? [systemEnvPath] : [])], input.dryRun);

  site.publicUrl = publicUrl;
  site.deploymentMode = mode;
  site.mail = { ...(site.mail || {}), baseUrl: publicUrl };
  let nextEnv = env;
  nextEnv = setEnv(nextEnv, "WIKIST_PUBLIC_URL", publicUrl);
  nextEnv = setEnv(nextEnv, "APP_URL", publicUrl);
  nextEnv = setEnv(nextEnv, "TRUSTED_ORIGINS", originList(envValue(nextEnv, "TRUSTED_ORIGINS"), publicUrl, previousUrls));
  nextEnv = setEnv(nextEnv, "SESSION_SECURE", new URL(publicUrl).protocol === "https:" ? "true" : "false");
  nextEnv = setEnv(nextEnv, "CENTRIFUGO_PUBLIC_URL", wsUrl(publicUrl));
  nextEnv = setEnv(nextEnv, "WIKIST_DB_PROFILE", "sqlite-single-host");
  nextEnv = setEnv(nextEnv, "WEBMAN_WORKERS", "1");
  let nextSystemEnv = systemEnv;
  if (systemEnv) {
    nextSystemEnv = setEnv(nextSystemEnv, "WIKIST_PUBLIC_URL", publicUrl);
    nextSystemEnv = setEnv(nextSystemEnv, "APP_URL", publicUrl);
    nextSystemEnv = setEnv(nextSystemEnv, "TRUSTED_ORIGINS", originList(envValue(nextSystemEnv, "TRUSTED_ORIGINS"), publicUrl, previousUrls));
    nextSystemEnv = setEnv(nextSystemEnv, "SESSION_SECURE", parsedPublicUrl.protocol === "https:" ? "true" : "false");
    nextSystemEnv = setEnv(nextSystemEnv, "CENTRIFUGO_PUBLIC_URL", wsUrl(publicUrl));
    nextSystemEnv = setEnv(nextSystemEnv, "WIKIST_DB_PROFILE", "sqlite-single-host");
    nextSystemEnv = setEnv(nextSystemEnv, "WEBMAN_WORKERS", "1");
  }

  if (stack.centrifugo && typeof stack.centrifugo === "object") delete stack.centrifugo.publicUrl;
  stack.version = Math.max(3, Number(stack.version || 0));
  if (centrifugo.client && typeof centrifugo.client === "object") {
    centrifugo.client.allowed_origins = originList((centrifugo.client.allowed_origins || []).join(","), publicUrl, previousUrls).split(",");
  }

  if (!input.dryRun) {
    atomicWrite(sitePath, `${JSON.stringify(site, null, 2)}\n`);
    atomicWrite(envPath, nextEnv);
    if (systemEnv && systemEnvPath) atomicWrite(systemEnvPath, nextSystemEnv, 0o640);
    if (Object.keys(stack).length) atomicWrite(stackPath, `${JSON.stringify(stack, null, 2)}\n`);
    if (Object.keys(centrifugo).length) atomicWrite(centrifugoPath, `${JSON.stringify(centrifugo, null, 2)}\n`);
  }
  const scanFiles = input.dryRun ? [] : [sitePath, envPath, stackPath, centrifugoPath, ...(systemEnv && systemEnvPath ? [systemEnvPath] : [])];
  const residues = scanResidues(previousUrls.filter((item) => item && item !== publicUrl), scanFiles);
  const report = { ok: residues.length === 0, dryRun: input.dryRun, publicUrl, deploymentMode: mode, realtimePublicUrl: wsUrl(publicUrl), backup: snapshot, residues };
  if (!input.dryRun) atomicWrite(path.join(root, "data", "migrations", "server-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main() {
  const input = options(process.argv.slice(2));
  if (input.help) {
    console.log("Usage: npm run migrate:server -- --public-url=https://wiki.example.com [--mode=single-production] [--dry-run|--yes]");
    return;
  }
  if (!input.publicUrl) throw new Error("Missing required --public-url option.");
  const report = migrate(input);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`Wikist server migration failed: ${error.message}`); process.exit(1); }
}

module.exports = { canonicalPublicUrl, migrate, setEnv, wsUrl };
