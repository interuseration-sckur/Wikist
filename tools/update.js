#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { createBackupPackageFile } = require("../src/core/backup");
const { loadConfig } = require("../src/core/config");

const rootDir = path.resolve(__dirname, "..");
const reportDir = path.join(rootDir, "data", "updates");
const backupDir = path.join(rootDir, "data", "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const UPDATER_PROTOCOL_VERSION = 2;
const pluginRoot = path.join(rootDir, "plugins");
const CORE_PLUGIN_PATHS = fs.existsSync(pluginRoot)
  ? fs.readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "vendor" && /^(?:wikist|upstream)-/.test(entry.name))
    .map((entry) => `plugins/${entry.name}`)
    .sort()
  : [];

const CODE_PATHS = [
  ".gitignore",
  "CHANGELOG.md",
  "README.md",
  "SECURITY.md",
  "release-manifest.json",
  "docs",
  "package-lock.json",
  "package.json",
  "public/assets",
  "public/passport",
  "public/index.html",
  "public/install.html",
  "server.js",
  "update.php",
  "src",
  "tools",
  "webman-backend/.gitignore",
  "webman-backend/.env.example",
  "webman-backend/README.md",
  "webman-backend/app",
  "webman-backend/config",
  "webman-backend/database/migrations",
  "webman-backend/database/schema",
  "webman-backend/public",
  "webman-backend/support",
  "webman-backend/tools",
  "webman-backend/composer.json",
  "webman-backend/composer.lock",
  "webman-backend/start.php",
  "webman-backend/webman",
  "webman-backend/windows.bat",
  "webman-backend/windows.php",
  ...CORE_PLUGIN_PATHS,
];

const PROTECTED_PATHS = [
  "config/site.config.json",
  "content/deleted",
  "content/pages",
  "content/reviewed",
  "content/revisions",
  "data",
  "logs",
  "node_modules",
  "plugins/vendor",
  "public/uploads",
];

function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const candidates = [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  try {
    const npmCommand = childProcess.execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).map((item) => item.trim()).find(Boolean);
    if (npmCommand) candidates.push(path.join(path.dirname(npmCommand), "node_modules", "npm", "bin", "npm-cli.js"));
  } catch (_error) {}
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (!npmCli) throw new Error("Unable to locate npm-cli.js beside the active Windows Node.js installation.");
  return { command: process.execPath, args: [npmCli, ...args] };
}

function gitArgs(args) {
  return ["-c", `safe.directory=${rootDir}`, ...args];
}

function parseArgs(argv) {
  const options = {
    strategy: "git",
    remote: "origin",
    branch: "main",
    source: "",
    service: "",
    dryRun: false,
    yes: false,
    backup: true,
    install: true,
    check: true,
    allowDirty: false,
    stashDirty: false,
    publicUrl: "",
    deploymentMode: "",
    preflightOnly: false,
    resumeFile: "",
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--no-backup") options.backup = false;
    else if (arg === "--skip-install") options.install = false;
    else if (arg === "--skip-check") options.check = false;
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg === "--stash-dirty") options.stashDirty = true;
    else if (arg === "--preflight-only") options.preflightOnly = true;
    else if (arg.startsWith("--resume=")) options.resumeFile = arg.slice("--resume=".length);
    else if (arg.startsWith("--strategy=")) options.strategy = arg.slice("--strategy=".length);
    else if (arg.startsWith("--source=")) options.source = arg.slice("--source=".length);
    else if (arg.startsWith("--remote=")) options.remote = arg.slice("--remote=".length);
    else if (arg.startsWith("--branch=")) options.branch = arg.slice("--branch=".length);
    else if (arg.startsWith("--service=")) options.service = arg.slice("--service=".length);
    else if (arg.startsWith("--public-url=")) options.publicUrl = arg.slice("--public-url=".length);
    else if (arg.startsWith("--deployment-mode=")) options.deploymentMode = arg.slice("--deployment-mode=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[A-Za-z0-9._/-]{1,180}$/.test(options.remote)) throw new Error("Invalid Git remote name.");
  if (!/^[A-Za-z0-9._/-]{1,240}$/.test(options.branch) || options.branch.startsWith("-")) throw new Error("Invalid Git branch name.");
  if (options.service && !/^[A-Za-z0-9@_.-]{1,180}$/.test(options.service)) throw new Error("Invalid service name.");
  if (options.deploymentMode && !/^(?:development|single-production|advanced|local-development|reverse-proxy|cluster)$/.test(options.deploymentMode)) throw new Error("Invalid deployment mode.");
  return options;
}

function usage() {
  return `
Wikist update

Usage:
  node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --yes
  node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --stash-dirty --yes
  node tools/update.js --strategy=local --source=...your-path.../wikist-release --service=wikist --yes
  node tools/update.js --strategy=git --public-url=https://wiki.example.com --service=wikist --yes
  node tools/update.js --preflight-only
  node tools/update.js --dry-run

Strategies:
  git     Fetch and fast-forward merge from the configured remote branch.
  local   Copy core code from an extracted release directory while preserving runtime data.

Protected paths are never overwritten by the local strategy:
  ${PROTECTED_PATHS.join(", ")}
`.trim();
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function readEnvironment(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (_error) {
    return fallback;
  }
}

function fileDigest(filePath) {
  return fs.existsSync(filePath) ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") : "";
}

function writeAtomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
}

function resumeState(filePath) {
  const resolved = path.resolve(filePath);
  if (!safeInside(reportDir, resolved) || !/^resume-[A-Za-z0-9-]+\.json$/.test(path.basename(resolved))) {
    throw new Error("Invalid updater resume state path.");
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Unsafe updater resume state.");
  const state = readJsonFile(resolved, null);
  if (!state || state.protocol !== UPDATER_PROTOCOL_VERSION || path.resolve(state.root || "") !== rootDir || !state.options || !state.report) {
    throw new Error("Updater resume state is incompatible or invalid.");
  }
  return { ...state, filePath: resolved };
}

function reexecuteUpdatedUpdater(options, report, stopped, digestBefore) {
  if (options.dryRun || options.resumeFile) return null;
  const updaterPath = path.join(rootDir, "tools", "update.js");
  const digestAfter = fileDigest(updaterPath);
  report.updaterProtocolVersion = UPDATER_PROTOCOL_VERSION;
  report.updaterDigestBefore = digestBefore;
  report.updaterDigestAfter = digestAfter;
  if (!digestBefore || digestBefore === digestAfter) return null;
  const statePath = path.join(reportDir, `resume-${stamp}.json`);
  writeAtomicJson(statePath, {
    protocol: UPDATER_PROTOCOL_VERSION,
    root: rootDir,
    createdAt: new Date().toISOString(),
    stopped,
    options: { ...options, resumeFile: statePath, yes: true, preflightOnly: false },
    report,
  });
  log(`Updater changed on disk; continuing with protocol ${UPDATER_PROTOCOL_VERSION}.`);
  const child = childProcess.spawnSync(process.execPath, [updaterPath, `--resume=${statePath}`], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  return child.status ?? 1;
}

function canonicalOrigin(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch (_) { parsed = null; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password
    || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) return "";
  return parsed.origin;
}

function expectedRealtime(publicUrl) {
  return String(publicUrl).replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/connection/websocket";
}

function deploymentPrecheck(options) {
  const site = loadConfig(rootDir);
  const env = { ...readEnvironment(path.join(rootDir, "webman-backend", ".env")), ...process.env };
  const configured = canonicalOrigin(site.publicUrl || "");
  const requested = canonicalOrigin(options.publicUrl || "");
  if (options.publicUrl && !requested) throw new Error("--public-url must be a complete HTTP(S) origin without a path.");
  const expected = requested || configured;
  if (!expected) {
    throw new Error("PRECHECK: canonical publicUrl is missing. Safe fix: rerun with --public-url=https://wiki.example.com.");
  }
  const production = /^(?:production|prod)$/i.test(String(env.APP_ENV || "development"));
  const parsed = new URL(expected);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  if (production && (parsed.protocol !== "https:" || local) && !requested) {
    throw new Error(`PRECHECK: production publicUrl is unsafe. Expected public HTTPS origin; actual ${expected}. Safe fix: rerun with --public-url=https://wiki.example.com.`);
  }
  const actual = {
    sitePublicUrl: configured,
    appUrl: canonicalOrigin(env.APP_URL || ""),
    publicUrlOverride: canonicalOrigin(env.WIKIST_PUBLIC_URL || ""),
    trustedOrigins: String(env.TRUSTED_ORIGINS || "").split(",").map((item) => canonicalOrigin(item.trim())).filter(Boolean),
    realtimePublicUrl: String(env.CENTRIFUGO_PUBLIC_URL || "").replace(/\/+$/, ""),
  };
  const mismatches = [];
  if (configured && configured !== expected) mismatches.push(`site.publicUrl=${configured}`);
  if (actual.appUrl && actual.appUrl !== expected) mismatches.push(`APP_URL=${actual.appUrl}`);
  if (actual.publicUrlOverride && actual.publicUrlOverride !== expected) mismatches.push(`WIKIST_PUBLIC_URL=${actual.publicUrlOverride}`);
  if (actual.trustedOrigins.length && !actual.trustedOrigins.includes(expected)) mismatches.push(`TRUSTED_ORIGINS=${actual.trustedOrigins.join(",")}`);
  if (actual.realtimePublicUrl && actual.realtimePublicUrl !== expectedRealtime(expected)) mismatches.push(`CENTRIFUGO_PUBLIC_URL=${actual.realtimePublicUrl}`);
  if (mismatches.length && !requested) {
    throw new Error(`PRECHECK: deployment URLs disagree. Expected ${expected}; actual ${mismatches.join("; ")}. Safe fix: rerun with --public-url=${expected}.`);
  }
  return { expected, production, migrationPlanned: Boolean(requested), mismatches };
}

function fullPreflight(options) {
  const deployment = deploymentPrecheck(options);
  const php = resolvePhp();
  if (!php) throw new Error("PRECHECK: PHP 8.4.1 or newer is required. Set WIKIST_PHP to the correct CLI binary.");
  const phpIdentity = capture(php, ["-r", "echo PHP_BINARY . '|' . PHP_VERSION;"], { cwd: rootDir });
  const composer = resolveComposer(php);
  if (!composer) throw new Error("PRECHECK: Composer is missing. Install the project-local .runtime/composer/composer.phar or set WIKIST_COMPOSER.");
  run(composer.command, [...composer.args, "validate", "--strict", "--no-interaction"], { cwd: path.join(rootDir, "webman-backend") });
  if (fs.existsSync(path.join(rootDir, "webman-backend", "vendor", "autoload.php"))) {
    run(composer.command, [...composer.args, "check-platform-reqs", "--no-dev"], { cwd: path.join(rootDir, "webman-backend") });
  }
  const doctorResult = childProcess.spawnSync(php, [path.join(rootDir, "webman-backend", "tools", "doctor.php"), "--all"], {
    cwd: path.join(rootDir, "webman-backend"),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  let doctor;
  try { doctor = JSON.parse(String(doctorResult.stdout || "")); } catch (_error) {
    throw new Error(`PRECHECK: doctor did not return a valid report: ${String(doctorResult.stderr || doctorResult.stdout || "unknown error").trim()}`);
  }
  const serviceState = inspectServiceUnit(options);
  const blockingChecks = (doctor.checks || []).filter((check) => check.severity === "error"
    && !(check.name === "deployment.systemd_hybrid" && serviceState.migrationNeeded));
  if (blockingChecks.length > 0) {
    throw new Error(`PRECHECK: doctor found blocking issues (${blockingChecks.map((check) => check.name).join(", ")}). Run npm run doctor -- --all.`);
  }
  let freeBytes = null;
  if (typeof fs.statfsSync === "function") {
    const stats = fs.statfsSync(rootDir);
    freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const database = path.resolve(rootDir, loadConfig(rootDir).passport?.database || "data/wikist.sqlite");
    const databaseBytes = fs.existsSync(database) ? fs.statSync(database).size : 0;
    const required = Math.max(512 * 1024 * 1024, databaseBytes * 4);
    if (freeBytes < required) throw new Error(`PRECHECK: insufficient free disk space (${freeBytes} bytes available; ${required} required).`);
  }
  fs.mkdirSync(reportDir, { recursive: true });
  const probe = path.join(reportDir, `.write-probe-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, "ok", { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.rmSync(probe, { force: true });
  if (options.strategy === "git") {
    const dirty = gitStatusLines();
    if (dirty.length && !options.allowDirty && !options.stashDirty) {
      throw new Error(`PRECHECK: tracked working tree changes exist. Commit them or use --stash-dirty. Dirty files: ${dirty.join("; ")}`);
    }
  }
  return {
    ...deployment,
    php: phpIdentity,
    composer: [composer.command, ...composer.args].join(" "),
    doctorWarnings: doctor.warnings || 0,
    freeBytes,
    service: serviceState,
  };
}

function inspectServiceUnit(options) {
  if (process.platform === "win32" || !options.service) return { checked: false, migrationNeeded: false, user: "" };
  const unitPath = `/etc/systemd/system/${options.service}.service`;
  if (!fs.existsSync(unitPath)) return { checked: true, unitPath, migrationNeeded: true, user: "wikist", reason: "unit missing" };
  const unit = fs.readFileSync(unitPath, "utf8");
  const user = unit.match(/^User=(.+)$/m)?.[1]?.trim() || "wikist";
  const dropInRoot = `${unitPath}.d`;
  const dropIns = fs.existsSync(dropInRoot)
    ? fs.readdirSync(dropInRoot).filter((name) => name.endsWith(".conf")).map((name) => path.join(dropInRoot, name))
    : [];
  const conflictingDropIns = dropIns.filter((file) => /ExecStart\s*=/.test(fs.readFileSync(file, "utf8")));
  if (conflictingDropIns.length > 0) {
    throw new Error(`PRECHECK: systemd ExecStart is overridden by drop-ins (${conflictingDropIns.join(", ")}). Review and remove the obsolete override before updating.`);
  }
  const hybrid = /ExecStart=.*tools\/start-hybrid\.js/m.test(unit.replace(/\\/g, "/"));
  return { checked: true, unitPath, migrationNeeded: !hybrid, user, reason: hybrid ? "current" : "legacy ExecStart", dropIns };
}

function migrateServiceUnit(options, preflight) {
  const serviceState = preflight?.service || {};
  if (!serviceState.migrationNeeded || options.dryRun) return { required: Boolean(serviceState.migrationNeeded), applied: false };
  if (options.service !== "wikist" && options.service !== "wikist.service") {
    throw new Error(`SERVICE: automatic migration currently supports the wikist service name; received ${options.service}.`);
  }
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error(`SERVICE: the legacy unit needs migration. Rerun the update with sudo, or execute npm run service:install -- --public-url=${preflight.expected} --user=${serviceState.user || "wikist"} --apply --yes.`);
  }
  run(process.execPath, [
    path.join(rootDir, "tools", "install-service.js"),
    `--public-url=${preflight.expected}`,
    `--user=${serviceState.user || "wikist"}`,
    "--apply",
    "--yes",
    "--no-start",
  ], options);
  return { required: true, applied: true, oldUnit: serviceState.unitPath, user: serviceState.user || "wikist" };
}

function run(command, args, options = {}) {
  const display = [command, ...args].join(" ");
  if (options.dryRun) {
    log(`[dry-run] ${display}`);
    return "";
  }
  log(`$ ${display}`);
  return childProcess.execFileSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: options.timeoutMs || 15 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  }) || "";
}

function capture(command, args, options = {}) {
  return childProcess.execFileSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs || 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function safeInside(parent, target) {
  const root = path.resolve(parent);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function ensureProjectRoot(dir) {
  const packagePath = path.join(dir, "package.json");
  const serverPath = path.join(dir, "server.js");
  if (!fs.existsSync(packagePath) || !fs.existsSync(serverPath)) {
    throw new Error(`${dir} does not look like a Wikist project root.`);
  }
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (pkg.name !== "wikist") throw new Error(`${dir} package.json is not Wikist.`);
}

function assertNoSymlinkTree(source, budget = { files: 0, bytes: 0 }) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Release source contains a symbolic link: ${source}`);
  if (stat.isFile()) {
    budget.files += 1;
    budget.bytes += stat.size;
  } else if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) assertNoSymlinkTree(path.join(source, entry), budget);
  } else {
    throw new Error(`Release source contains an unsupported filesystem entry: ${source}`);
  }
  if (budget.files > 100000 || budget.bytes > 2 * 1024 * 1024 * 1024) {
    throw new Error("Release source exceeds the updater file or byte budget.");
  }
  return budget;
}

function assertSafeTargetAncestors(target) {
  const relative = path.relative(rootDir, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe target path: ${target}`);
  let current = rootDir;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Updater target traverses a symbolic link: ${current}`);
    }
  }
}

function versionInfo(dir = rootDir) {
  const packagePath = path.join(dir, "package.json");
  const appPath = path.join(dir, "public", "assets", "app.js");
  let packageVersion = "";
  let assetVersion = "";
  try {
    packageVersion = String(JSON.parse(fs.readFileSync(packagePath, "utf8")).version || "");
  } catch (_error) {}
  try {
    const source = fs.readFileSync(appPath, "utf8");
    assetVersion = source.match(/CORE_ASSET_VERSION\s*=\s*["']([^"']+)["']/)?.[1] || "";
  } catch (_error) {}
  return { packageVersion, assetVersion };
}

function collectReleaseFiles(sourceRoot) {
  const files = [];
  const visit = (absolute, relative) => {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Release source contains a symbolic link: ${relative}`);
    if (stat.isFile()) {
      if (relative !== "release-manifest.json") files.push(relative.replace(/\\/g, "/"));
      return;
    }
    if (!stat.isDirectory()) throw new Error(`Unsupported release entry: ${relative}`);
    for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), path.join(relative, name));
  };
  for (const relative of CODE_PATHS.filter((item) => item !== "release-manifest.json")) {
    visit(path.join(sourceRoot, relative), relative);
  }
  const plugins = path.join(sourceRoot, "plugins");
  if (fs.existsSync(plugins)) {
    for (const entry of fs.readdirSync(plugins, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name === "vendor") continue;
      if (entry.name.startsWith("wikist-") || entry.name.startsWith("upstream-")) visit(path.join(plugins, entry.name), path.join("plugins", entry.name));
    }
  }
  return [...new Set(files)].sort();
}

function verifyReleaseManifest(sourceRoot) {
  const manifestPath = path.join(sourceRoot, "release-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    if (/^(?:1|true|yes)$/i.test(String(process.env.WIKIST_ALLOW_UNSIGNED_RELEASE || ""))) return { verified: false, bypassed: true };
    throw new Error("Local release has no release-manifest.json. Refusing an unverifiable update.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== "wikist-release-v1" || manifest.product !== "wikist" || !Array.isArray(manifest.files)) {
    throw new Error("Invalid Wikist release manifest.");
  }
  const expectedFiles = collectReleaseFiles(sourceRoot);
  const declared = new Map(manifest.files.map((item) => [String(item.path || ""), item]));
  if (declared.size !== expectedFiles.length || expectedFiles.some((file) => !declared.has(file))) {
    throw new Error("Release manifest does not cover the complete code payload.");
  }
  for (const relative of expectedFiles) {
    const item = declared.get(relative);
    const absolute = path.resolve(sourceRoot, relative);
    if (!safeInside(sourceRoot, absolute) || !fs.lstatSync(absolute).isFile()) throw new Error(`Unsafe release manifest path: ${relative}`);
    const digest = require("crypto").createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    if (digest !== String(item.sha256 || "") || fs.statSync(absolute).size !== Number(item.bytes)) {
      throw new Error(`Release checksum mismatch: ${relative}`);
    }
  }
  const signingKey = String(process.env.WIKIST_RELEASE_SIGNING_KEY || "");
  const requireSignature = /^(?:1|true|yes)$/i.test(String(process.env.WIKIST_REQUIRE_SIGNED_RELEASE || ""));
  if (requireSignature && signingKey.length < 32) throw new Error("Signed releases are required but WIKIST_RELEASE_SIGNING_KEY is missing or weak.");
  if (manifest.signature) {
    if (signingKey.length < 32) {
      if (requireSignature) throw new Error("Cannot verify the release signature.");
    } else {
      const payload = JSON.stringify({ schema: manifest.schema, product: manifest.product, version: manifest.version, gitCommit: manifest.gitCommit, generatedAt: manifest.generatedAt, files: manifest.files });
      const actual = require("crypto").createHmac("sha256", signingKey).update(payload).digest("base64url");
      const expected = String(manifest.signature.value || "");
      if (actual.length !== expected.length || !require("crypto").timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new Error("Release signature verification failed.");
    }
  } else if (requireSignature) {
    throw new Error("This installation requires a signed release manifest.");
  }
  return { verified: true, version: String(manifest.version || ""), files: expectedFiles.length, signed: Boolean(manifest.signature) };
}

function writeReport(report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const filePath = path.join(reportDir, `update-${stamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

async function createPreUpdateBackup(options) {
  if (!options.backup) return null;
  const config = loadConfig(rootDir);
  const database = config.passport?.database || "data/wikist.sqlite";
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `wikist-pre-update-${stamp}.json.gz`;
  const filePath = path.join(backupDir, filename);
  if (options.dryRun) return { path: path.relative(rootDir, filePath).replace(/\\/g, "/"), database, scope: "full-site", dryRun: true };
  const backup = await createBackupPackageFile(rootDir, { database, includeUserData: true });
  try {
    fs.renameSync(backup.filePath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  } catch (error) {
    backup.cleanup();
    throw error;
  }
  return {
    path: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    database,
    scope: "full-site",
    compressedBytes: backup.manifest.compressedBytes,
    generatedAt: backup.manifest.generatedAt,
  };
}

function migrateDeployment(options) {
  if (!options.publicUrl) return null;
  const args = [path.join(rootDir, "tools", "migrate-server.js"), `--public-url=${options.publicUrl}`];
  if (options.deploymentMode) args.push(`--mode=${options.deploymentMode}`);
  args.push(options.dryRun ? "--dry-run" : "--yes");
  run(process.execPath, args, options);
  return { publicUrl: options.publicUrl, deploymentMode: options.deploymentMode || "automatic" };
}

function portReady(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function smokeCheck(options) {
  if (!options.service || options.dryRun) return { skipped: true };
  const port = Number(process.env.WEBMAN_PORT || process.env.WIKIST_PORT || 8899);
  const endpoints = [
    "/api/health",
    "/api/health/live",
    "/api/health/ready",
    "/api/site",
    "/api/passport/captcha/behavior",
    "/api/passport/me",
    "/api/community/qa/bootstrap",
    "/api/messaging/bootstrap",
  ];
  const deadline = Date.now() + 30000;
  let lastError = "service did not respond";
  while (Date.now() < deadline) {
    try {
      const results = [];
      for (const endpoint of endpoints) {
        const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { redirect: "manual", signal: AbortSignal.timeout(2500) });
        if (response.status >= 500) throw new Error(`${endpoint} returned ${response.status}`);
        if (response.status === 404) throw new Error(`${endpoint} is missing`);
        if (["/api/health", "/api/health/live", "/api/health/ready", "/api/site", "/api/passport/captcha/behavior"].includes(endpoint) && response.status !== 200) {
          throw new Error(`${endpoint} returned ${response.status}; expected 200`);
        }
        if (["/api/passport/me", "/api/messaging/bootstrap"].includes(endpoint) && ![200, 401].includes(response.status)) {
          throw new Error(`${endpoint} returned ${response.status}; expected 200 or 401`);
        }
        const payload = await response.json().catch(() => ({}));
        if (endpoint === "/api/health" && response.status === 200 && payload.service !== "wikist-webman") {
          throw new Error("/api/health is not served by Wikist Webman");
        }
        if (endpoint === "/api/site") {
          const publicUrl = String(payload.publicUrl || "");
          if (/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[?::1\]?)/i.test(publicUrl) && /^(?:production|prod)$/i.test(String(process.env.APP_ENV || ""))) {
            throw new Error("/api/site exposed a localhost production publicUrl");
          }
          if (publicUrl.startsWith("https://") && String(payload.realtimeUrl || "").startsWith("ws://")) {
            throw new Error("HTTPS site exposed an insecure realtime URL");
          }
        }
        results.push({ endpoint, status: response.status });
      }
      const nodePort = Number(process.env.WIKIST_NODE_PORT || 8900);
      if (!await portReady("127.0.0.1", nodePort)) throw new Error(`Node compatibility port ${nodePort} is not ready`);
      const stack = readJsonFile(path.join(rootDir, "data", "wikist-stack.json"), {});
      if (stack?.centrifugo?.enabled === true) {
        const realtimePort = Number(stack.centrifugo.port || 8902);
        if (!await portReady("127.0.0.1", realtimePort)) throw new Error(`Centrifugo port ${realtimePort} is not ready`);
      }
      let databaseLockEvents = 0;
      if (process.platform !== "win32" && options.service) {
        const journal = childProcess.spawnSync("journalctl", ["-u", options.service, "--since", "2 minutes ago", "--no-pager", "-n", "300"], { encoding: "utf8", windowsHide: true });
        if (!journal.error && journal.status === 0) {
          databaseLockEvents = (String(journal.stdout || "").match(/(?:SQLITE_BUSY|database is locked|database table is locked)/gi) || []).length;
          if (databaseLockEvents >= 3) throw new Error(`post-update log contains a database lock burst (${databaseLockEvents} events)`);
        }
      }
      return { ok: true, results, databaseLockEvents };
    } catch (error) {
      lastError = error.message;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error(`Post-update smoke check failed: ${lastError}`);
}

function service(command, options) {
  if (!options.service) return;
  run("systemctl", [command, options.service], options);
}

function checkpointDatabase(options) {
  const driver = String(process.env.WIKIST_DB_DRIVER || "sqlite").toLowerCase();
  if (driver !== "sqlite" || options.dryRun) return { skipped: driver !== "sqlite", driver };
  const { DatabaseSync } = require("node:sqlite");
  const config = loadConfig(rootDir);
  const configured = process.env.WIKIST_DB_DATABASE || config.passport?.database || "data/wikist.sqlite";
  const databasePath = path.resolve(path.join(rootDir, "webman-backend"), configured);
  const fallbackPath = path.resolve(rootDir, config.passport?.database || "data/wikist.sqlite");
  const selected = fs.existsSync(databasePath) ? databasePath : fallbackPath;
  if (!safeInside(rootDir, selected) || !fs.existsSync(selected)) throw new Error("SQLite database is missing or outside the Wikist project.");
  const database = new DatabaseSync(selected, { timeout: 10000 });
  try {
    database.exec("PRAGMA busy_timeout=10000");
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const integrity = String(database.prepare("PRAGMA quick_check").get()?.quick_check || "");
    if (integrity !== "ok") throw new Error(`SQLite quick_check failed before backup: ${integrity || "unknown"}`);
    return { driver, database: path.relative(rootDir, selected).replace(/\\/g, "/"), integrity };
  } finally {
    database.close();
  }
}

function gitStatusLines() {
  if (!fs.existsSync(path.join(rootDir, ".git"))) throw new Error("Git strategy requires a .git directory.");
  const status = capture("git", gitArgs(["status", "--porcelain"]), { cwd: rootDir });
  return status ? status.split(/\r?\n/).filter(Boolean) : [];
}

function stashDirtyGit(options, dirtyFiles) {
  if (!dirtyFiles.length || !options.stashDirty) return null;
  const message = `wikist-update-${stamp}`;
  run("git", gitArgs(["stash", "push", "--include-untracked", "-m", message]), options);
  return { message, files: dirtyFiles };
}

function ensureCleanGit(options, report) {
  const dirtyFiles = gitStatusLines();
  if (dirtyFiles.length) {
    report.dirtyFiles = dirtyFiles;
    if (options.stashDirty) {
      report.stash = stashDirtyGit(options, dirtyFiles);
      return;
    }
    if (!options.allowDirty) {
      throw new Error(`Tracked working tree changes exist. Review git status, commit/stash them, or rerun with --stash-dirty. Dirty files: ${dirtyFiles.join("; ")}`);
    }
  }
}

function currentGitSha() {
  try {
    return capture("git", gitArgs(["rev-parse", "HEAD"]), { cwd: rootDir });
  } catch (_error) {
    return "";
  }
}

function updateFromGit(options, report) {
  ensureCleanGit(options, report);
  const before = currentGitSha();
  run("git", gitArgs(["fetch", options.remote, options.branch]), options);
  const target = capture("git", gitArgs(["rev-parse", `${options.remote}/${options.branch}`]), { cwd: rootDir });
  const ancestor = childProcess.spawnSync("git", gitArgs(["merge-base", "--is-ancestor", "HEAD", `${options.remote}/${options.branch}`]), { cwd: rootDir });
  if (ancestor.status !== 0) {
    throw new Error(`Current HEAD is not an ancestor of ${options.remote}/${options.branch}. Refusing non-fast-forward update.`);
  }
  run("git", gitArgs(["merge", "--ff-only", `${options.remote}/${options.branch}`]), options);
  return { before, target, after: options.dryRun ? before : currentGitSha() };
}

function copyPath(source, target, options) {
  if (!safeInside(rootDir, target)) throw new Error(`Unsafe target path: ${target}`);
  if (!fs.existsSync(source)) return { path: path.relative(rootDir, target).replace(/\\/g, "/"), copied: false, missing: true };
  assertNoSymlinkTree(source);
  assertSafeTargetAncestors(target);
  if (options.dryRun) return { path: path.relative(rootDir, target).replace(/\\/g, "/"), copied: true, dryRun: true };
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  return { path: path.relative(rootDir, target).replace(/\\/g, "/"), copied: true };
}

function copyLocalPlugins(sourceRoot, options) {
  const sourcePlugins = path.join(sourceRoot, "plugins");
  const targetPlugins = path.join(rootDir, "plugins");
  const copied = [];
  if (!fs.existsSync(sourcePlugins)) return copied;
  fs.mkdirSync(targetPlugins, { recursive: true });
  for (const entry of fs.readdirSync(sourcePlugins, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "vendor") continue;
    if (!entry.name.startsWith("wikist-") && !entry.name.startsWith("upstream-")) continue;
    copied.push(copyPath(path.join(sourcePlugins, entry.name), path.join(targetPlugins, entry.name), options));
  }
  return copied;
}

function updateFromLocal(options) {
  if (!options.source) throw new Error("Local strategy requires --source=...your-path.../wikist-release");
  const sourceRoot = path.resolve(options.source);
  if (sourceRoot === rootDir || safeInside(rootDir, sourceRoot)) throw new Error("Local release source must be outside the active Wikist installation.");
  if (fs.lstatSync(sourceRoot).isSymbolicLink()) throw new Error("Local release source cannot be a symbolic link.");
  ensureProjectRoot(sourceRoot);
  const provenance = verifyReleaseManifest(sourceRoot);

  const copied = [];
  for (const relativePath of CODE_PATHS) {
    if (relativePath === "package-lock.json" && !fs.existsSync(path.join(sourceRoot, relativePath))) continue;
    if (relativePath === "docs" && !fs.existsSync(path.join(sourceRoot, relativePath))) continue;
    copied.push(copyPath(path.join(sourceRoot, relativePath), path.join(rootDir, relativePath), options));
  }

  const configExample = path.join(sourceRoot, "config", "site.config.example.json");
  if (fs.existsSync(configExample)) {
    copied.push(copyPath(configExample, path.join(rootDir, "config", "site.config.example.json"), options));
  }
  copied.push(...copyLocalPlugins(sourceRoot, options));
  if (!options.dryRun) fs.mkdirSync(path.join(rootDir, "public", "uploads"), { recursive: true });
  return { source: sourceRoot, provenance, copied };
}

function installDependencies(options) {
  if (!options.install) return;
  if (!fs.existsSync(path.join(rootDir, "package.json"))) return;
  const npmCommand = fs.existsSync(path.join(rootDir, "package-lock.json")) ? "ci" : "install";
  const invocation = npmInvocation([npmCommand, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  run(invocation.command, invocation.args, options);
  installWebmanDependencies(options);
}

function resolvePhp() {
  const candidates = [
    process.env.WIKIST_PHP,
    process.platform === "win32" ? path.join(rootDir, ".runtime", "php", "php.exe") : "",
    process.platform === "win32" ? path.join(rootDir, "runtime", "php", "php.exe") : "",
    process.platform === "win32" ? "php.exe" : "php",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    const result = childProcess.spawnSync(candidate, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8", windowsHide: true });
    return !result.error && result.status === 0 && Number(result.stdout) >= 80401;
  }) || "";
}

function resolveComposer(php) {
  const pharCandidates = [
    process.env.WIKIST_COMPOSER,
    path.join(rootDir, ".runtime", "composer", "composer.phar"),
    path.join(rootDir, "runtime", "composer", "composer.phar"),
  ].filter(Boolean).filter((candidate) => candidate.endsWith(".phar") && fs.existsSync(candidate));
  if (pharCandidates[0]) return { command: php, args: [pharCandidates[0]] };
  for (const command of process.platform === "win32" ? ["composer.bat", "composer"] : ["composer"]) {
    const result = childProcess.spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0) return { command, args: [] };
  }
  return null;
}

function installWebmanDependencies(options) {
  const backend = path.join(rootDir, "webman-backend");
  if (!fs.existsSync(path.join(backend, "composer.json"))) return;
  const php = resolvePhp();
  if (!php) throw new Error("Webman 更新需要 PHP 8.4.1 或更高版本；可通过 WIKIST_PHP 指定路径。");
  const composer = resolveComposer(php);
  if (!composer) throw new Error("未找到 Composer；请安装 Composer 或通过 WIKIST_COMPOSER 指定 composer.phar。");
  run(composer.command, [
    ...composer.args,
    "install",
    "--no-dev",
    "--optimize-autoloader",
    "--no-interaction",
    "--no-scripts",
    "--no-plugins",
  ], { ...options, cwd: backend });
  run(composer.command, [...composer.args, "check-platform-reqs", "--no-dev"], { ...options, cwd: backend });

  const site = loadConfig(rootDir);
  const database = path.resolve(rootDir, site.passport?.database || "data/wikist.sqlite");
  if (!safeInside(rootDir, database)) throw new Error("Wikist 数据库路径越出项目目录。");
  const updateScript = path.join(rootDir, "update.php");
  if (!options.dryRun) {
    childProcess.execFileSync(php, [updateScript, "--no-backup", "--skip-check"], {
      cwd: rootDir,
      env: { ...process.env, WIKIST_DB_DRIVER: process.env.WIKIST_DB_DRIVER || "sqlite", WIKIST_DB_DATABASE: process.env.WIKIST_DB_DATABASE || database },
      stdio: "inherit",
    });
  } else {
    log(`[dry-run] ${php} update.php --no-backup --skip-check`);
  }
}

function runChecks(options) {
  if (!options.check) return;
  for (const script of ["check", "check:performance", "check:search", "check:hooks", "check:knowledge", "check:citations", "check:reviews", "check:v08", "check:v09", "check:v10"]) {
    const invocation = npmInvocation(["run", script]);
    run(invocation.command, invocation.args, options);
  }
}

function assertConfirmation(options) {
  if (options.yes || options.dryRun) return;
  if (!process.stdin.isTTY) throw new Error("Refusing to run without --yes in a non-interactive shell.");
  log("This will update Wikist code while preserving runtime data.");
  log(`Protected paths: ${PROTECTED_PATHS.join(", ")}`);
  throw new Error("Re-run with --yes after confirming the backup and strategy.");
}

async function main() {
  let options = parseArgs(process.argv.slice(2));
  let resumed = null;
  if (options.resumeFile) {
    resumed = resumeState(options.resumeFile);
    options = { ...resumed.options, resumeFile: resumed.filePath };
  }
  if (options.help) {
    log(usage());
    return;
  }
  if (!["git", "local"].includes(options.strategy)) throw new Error(`Unsupported strategy: ${options.strategy}`);
  ensureProjectRoot(rootDir);
  assertConfirmation(options);

  const report = resumed?.report || {
    status: "running",
    startedAt: new Date().toISOString(),
    strategy: options.strategy,
    dryRun: options.dryRun,
    service: options.service || "",
    backup: null,
    result: null,
    dirtyFiles: [],
    stash: null,
    protectedPaths: PROTECTED_PATHS,
    versionBefore: versionInfo(),
    versionAfter: null,
    deploymentMigration: null,
    serviceMigration: null,
    smoke: null,
    databaseCheckpoint: null,
    deploymentPrecheck: null,
  };

  let stopped = Boolean(resumed?.stopped);
  try {
    if (!resumed) {
      report.stage = "PRECHECK";
      log("[1/9] PRECHECK");
      report.deploymentPrecheck = fullPreflight(options);
      if (options.preflightOnly) {
        report.status = "ok";
        report.finishedAt = new Date().toISOString();
        log(JSON.stringify({ ok: true, preflight: report.deploymentPrecheck }, null, 2));
        return;
      }
      report.stage = "STOP";
      log("[2/9] STOP");
      service("stop", options);
      stopped = Boolean(options.service && !options.dryRun);
      report.stage = "BACKUP";
      log("[3/9] CHECKPOINT + BACKUP");
      report.databaseCheckpoint = checkpointDatabase(options);
      report.backup = await createPreUpdateBackup(options);
      if (report.backup) log(options.dryRun ? `Backup would be: ${report.backup.path}` : `Backup: ${report.backup.path}`);

      report.stage = "FETCH";
      log("[4/9] FETCH + VERIFY");
      const updaterDigest = fileDigest(path.join(rootDir, "tools", "update.js"));
      report.result = options.strategy === "git" ? updateFromGit(options, report) : updateFromLocal(options);
      const reexecStatus = reexecuteUpdatedUpdater(options, report, stopped, updaterDigest);
      if (reexecStatus !== null) {
        process.exitCode = reexecStatus;
        return;
      }
    } else {
      log(`Resumed update transaction with protocol ${UPDATER_PROTOCOL_VERSION}.`);
    }
    report.stage = "DEPENDENCIES";
    log("[5/9] DEPENDENCIES + MIGRATIONS");
    installDependencies(options);
    report.deploymentMigration = migrateDeployment(options);
    report.stage = "TEST";
    log("[6/9] REGRESSION TESTS");
    runChecks(options);
    report.serviceMigration = migrateServiceUnit(options, report.deploymentPrecheck);
    report.versionAfter = versionInfo();

    if (stopped) {
      report.stage = "START";
      log("[7/9] START");
      service("start", options);
      stopped = false;
      report.stage = "HEALTHCHECK";
      log("[8/9] HEALTHCHECK");
      report.smoke = await smokeCheck(options);
    }

    report.stage = "COMMIT";
    log("[9/9] COMMIT");
    report.status = "ok";
    report.finishedAt = new Date().toISOString();
    if (options.dryRun) log(`Dry-run report:\n${JSON.stringify(report, null, 2)}`);
    else {
      const reportPath = writeReport(report);
      log(`Update report: ${reportPath}`);
      if (resumed?.filePath) fs.rmSync(resumed.filePath, { force: true });
    }
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    report.serviceRecovery = stopped ? "service remains stopped; inspect the report, restore if needed, then start it explicitly" : "not required";
    report.finishedAt = new Date().toISOString();
    if (options.dryRun) log(`Dry-run failed:\n${JSON.stringify(report, null, 2)}`);
    else {
      const reportPath = writeReport(report);
      log(`Update failed. Report: ${reportPath}`);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`Wikist update error: ${error.message}`);
  process.exit(1);
});
