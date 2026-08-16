const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const webman = path.join(root, "webman-backend");

function loadEnvironmentFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value.replace(/\\n/g, "\n");
  }
}

loadEnvironmentFile(path.join(webman, ".env"));

function persistLegacyAppSecret() {
  if (process.env.APP_SECRET || !process.env.WIKIST_PASSPORT_SECRET) return;
  const secret = String(process.env.WIKIST_PASSPORT_SECRET);
  if (/[\r\n\0]/.test(secret)) throw new Error("旧 Passport 密钥格式无效，无法自动迁移。");
  if (/^(?:production|prod)$/i.test(String(process.env.APP_ENV || "development")) && secret.length < 32) {
    throw new Error("旧 Passport 密钥不足 32 字节；请设置新的 APP_SECRET 后再执行升级。");
  }
  process.env.APP_SECRET = secret;
  const envPath = path.join(webman, ".env");
  if (!fs.existsSync(envPath) || fs.lstatSync(envPath).isSymbolicLink()) return;
  const current = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").replace(/\s*$/, "");
  const escaped = secret.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const temporary = `${envPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${current}\nAPP_SECRET="${escaped}"\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, envPath);
  try { fs.chmodSync(envPath, 0o600); } catch (_) {}
  console.log("Wikist 已将旧 Passport 密钥迁移到 APP_SECRET。");
}

function persistEnvironmentValue(name, value) {
  const envPath = path.join(webman, ".env");
  if (!fs.existsSync(envPath) || fs.lstatSync(envPath).isSymbolicLink()) return;
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const line = `${name}="${escaped}"`;
  const current = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = `${(pattern.test(current) ? current.replace(pattern, line) : `${current.replace(/\s*$/, "")}\n${line}`).replace(/\s*$/, "")}\n`;
  if (next === current) return;
  const temporary = `${envPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, next, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, envPath);
  try { fs.chmodSync(envPath, 0o600); } catch (_) {}
}

persistLegacyAppSecret();
const pidFile = path.join(root, "data", "wikist-hybrid.pid.json");
const stackFile = path.join(root, "data", "wikist-stack.json");
const publicPort = Number(process.env.WIKIST_PORT || 8899);
const internalPort = Number(process.env.WIKIST_NODE_PORT || publicPort + 1);
const installBootstrapSecret = process.env.WIKIST_INSTALL_BOOTSTRAP_SECRET || crypto.randomBytes(32).toString("base64url");

function readPidFile() {
  try {
    const value = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    return path.resolve(value.root || "") === root ? value : null;
  } catch (_) {
    return null;
  }
}

function removePidFile(expectedPid = 0) {
  try {
    const current = readPidFile();
    if (!current || !expectedPid || Number(current.pid) === Number(expectedPid)) fs.rmSync(pidFile, { force: true });
  } catch (_) {}
}

function processExists(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function stopProcessTree(pid, force = false) {
  pid = Number(pid || 0);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return true;
  if (!processExists(pid)) return true;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
      windowsHide: true,
      encoding: "utf8",
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    return result.status === 0 || !processExists(pid) || /not found|找不到|不存在/i.test(output);
  }
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function recordedPids(running) {
  return Array.from(new Set([
    running?.pid,
    running?.nodePid,
    running?.webmanPid,
    running?.centrifugoPid,
  ].map(Number).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)));
}

function stopRecordedStack() {
  const running = readPidFile();
  const pids = recordedPids(running);
  const failedPids = pids.filter((pid) => !stopProcessTree(pid, true));
  removePidFile(running?.pid || 0);
  return { pids, failedPids };
}

function canBindPort(host, port) {
  const probe = `const net=require("net");const server=net.createServer();server.once("error",()=>process.exit(1));server.listen(${Number(port)},${JSON.stringify(host)},()=>server.close(()=>process.exit(0)));`;
  const result = spawnSync(process.execPath, ["-e", probe], {
    timeout: 3000,
    windowsHide: true,
    stdio: "ignore",
  });
  return result.status === 0;
}

function waitForPortRelease(host, port, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (canBindPort(host, port)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  return canBindPort(host, port);
}

function canConnectPort(host, port) {
  const probe = `const net=require("net");const socket=net.connect(${Number(port)},${JSON.stringify(host)});socket.setTimeout(800);socket.once("connect",()=>{socket.destroy();process.exit(0)});socket.once("timeout",()=>{socket.destroy();process.exit(1)});socket.once("error",()=>process.exit(1));`;
  const result = spawnSync(process.execPath, ["-e", probe], {
    timeout: 1500,
    windowsHide: true,
    stdio: "ignore",
  });
  return result.status === 0;
}

function waitForPort(label, host, port, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (canConnectPort(host, port)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`${label} did not begin listening on ${host}:${port} within ${timeout}ms.`);
}

function readStackConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(stackFile, "utf8").replace(/^\uFEFF/, ""));
    return Number(value.version) >= 2 && value.centrifugo ? value : null;
  } catch (_) {
    return null;
  }
}

function readSiteConfiguration() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, "config", "site.config.json"), "utf8").replace(/^\uFEFF/, ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function canonicalPublicUrl(value, production) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch (_) { parsed = null; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password
    || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw new Error("Wikist 站点公开地址必须是完整的 http(s) Origin，且不能包含路径、账号、查询参数或片段。");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  if (production && (parsed.protocol !== "https:" || local)) {
    throw new Error("生产环境必须配置公开的 HTTPS 站点地址；可在安装页设置 publicUrl，或使用 WIKIST_PUBLIC_URL 显式覆盖。");
  }
  return parsed.origin;
}

function realtimePublicUrl(publicUrl) {
  const parsed = new URL(publicUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/connection/websocket";
  return parsed.toString();
}

function runtimeRealtimePublicUrl(publicUrl, host, port) {
  const parsed = new URL(publicUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) {
    return realtimePublicUrl(publicUrl);
  }
  const normalizedHost = ["0.0.0.0", "::"].includes(String(host)) ? "127.0.0.1" : String(host || "127.0.0.1");
  const browserHost = normalizedHost.includes(":") && !normalizedHost.startsWith("[") ? `[${normalizedHost}]` : normalizedHost;
  return `ws://${browserHost}:${Number(port)}/connection/websocket`;
}

function resolvedRealtimePublicUrl(configuredUrl, publicUrl, host, port) {
  const fallback = runtimeRealtimePublicUrl(publicUrl, host, port);
  const configured = String(configuredUrl || "").trim();
  if (!configured) return fallback;
  try {
    const site = new URL(publicUrl);
    const realtime = new URL(configured);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    const sitePort = Number(site.port || (site.protocol === "https:" ? 443 : 80));
    const realtimePort = Number(realtime.port || (realtime.protocol === "wss:" ? 443 : 80));
    if (localHosts.has(site.hostname.toLowerCase())
      && localHosts.has(realtime.hostname.toLowerCase())
      && realtimePort === sitePort) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return configured;
}

function trustedOrigins(publicUrl) {
  const explicit = String(process.env.TRUSTED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set([publicUrl, ...explicit])).join(",");
}

function refreshRealtimeConfiguration(appUrl, origins) {
  const result = spawnSync(process.execPath, [path.join(root, "tools", "setup-community-stack.js")], {
    cwd: root,
    env: { ...process.env, APP_URL: appUrl, WIKIST_PUBLIC_URL: appUrl, TRUSTED_ORIGINS: origins },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Wikist 实时通信配置刷新失败：${String(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return readStackConfig();
}

function ensureStackConfig() {
  const configured = readStackConfig();
  if (configured) return configured;
  console.log("正在初始化 Wikist 实时通信配置...");
  const setup = spawnSync(process.execPath, [path.join(root, "tools", "setup-community-stack.js")], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (setup.status !== 0) {
    throw new Error(`Wikist 实时通信配置初始化失败：${String(setup.stderr || setup.stdout || "unknown error").trim()}`);
  }
  if (setup.stdout) process.stdout.write(setup.stdout);
  const created = readStackConfig();
  if (!created) throw new Error("Wikist 实时通信配置未能生成。");
  return created;
}

function stackPath(relativePath) {
  const target = path.resolve(root, String(relativePath || ""));
  if (!target.startsWith(root + path.sep)) throw new Error("Wikist stack paths must stay inside the project directory.");
  return target;
}

function enabledByEnvironment(name, configured) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(configured);
}

if (process.argv.includes("--stop")) {
  const { pids, failedPids } = stopRecordedStack();
  if (failedPids.length > 0) {
    throw new Error(`无法停止 Wikist 进程：${failedPids.join(", ")}。请使用相同用户权限重新运行停止命令。`);
  }
  if (pids.length > 0) {
    console.log(`Stopped Wikist stack (${pids.length} recorded processes).`);
  } else {
    console.log("No Wikist stack PID record was found.");
  }
  process.exit(0);
}

if (process.argv.includes("--restart")) {
  const { pids, failedPids } = stopRecordedStack();
  if (failedPids.length > 0) {
    throw new Error(`无法停止旧 Wikist 进程：${failedPids.join(", ")}。请使用相同用户权限重新运行重启命令。`);
  }
  if (pids.length > 0) console.log(`Stopped previous Wikist stack (${pids.length} recorded processes).`);
  const publicReleased = waitForPortRelease("127.0.0.1", publicPort);
  const internalReleased = waitForPortRelease("127.0.0.1", internalPort);
  if (!publicReleased || !internalReleased) {
    const occupied = [
      !publicReleased ? `127.0.0.1:${publicPort}` : "",
      !internalReleased ? `127.0.0.1:${internalPort}` : "",
    ].filter(Boolean).join(", ");
    throw new Error(`旧 Wikist 进程未能释放端口 ${occupied}。请确认服务由同一用户启动后再重试。`);
  }
}

if (process.argv.includes("--status")) {
  const running = readPidFile();
  if (!running?.pid) {
    console.log("Wikist stack is not running.");
    process.exit(1);
  }
  console.log(JSON.stringify(running, null, 2));
  process.exit(0);
}

function resolvePhp() {
  const candidates = [
    process.env.WIKIST_PHP,
    process.platform === "win32" ? path.join(root, ".runtime", "php", "php.exe") : "",
    process.platform === "win32" ? path.join(root, "runtime", "php", "php.exe") : "",
    process.platform === "win32" ? "php.exe" : "php",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0 && Number(result.stdout) >= 80401) return candidate;
  }
  throw new Error("Wikist Webman 需要 PHP 8.4.1 或更高版本。请安装 PHP，或设置 WIKIST_PHP。 ");
}

function ensurePhpExtensions(php) {
  const sqlite = String(process.env.WIKIST_DB_DRIVER || "sqlite").toLowerCase() === "sqlite";
  const production = /^(?:production|prod)$/i.test(String(process.env.APP_ENV || "development"));
  const required = ["pdo", "mbstring", "openssl", "json", "curl", "gd", "intl", "xml", "zip", ...(production ? ["Zend OPcache"] : []), ...(sqlite ? ["pdo_sqlite", "sqlite3"] : [])];
  const phpCode = `$r=${JSON.stringify(required).replace(/\[/, "[").replace(/\]/, "]")};$m=array_values(array_filter($r,fn($e)=>!extension_loaded($e)));echo implode(',', $m);exit($m?1:0);`;
  const probe = spawnSync(php, ["-r", phpCode], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status !== 0) {
    const missing = String(probe.stdout || "unknown").trim();
    const identity = spawnSync(php, ["-r", "echo PHP_BINARY . ' ' . PHP_VERSION;"], { encoding: "utf8", windowsHide: true });
    throw new Error(`Wikist Webman 缺少 PHP 扩展：${missing}。当前 CLI：${String(identity.stdout || php).trim()}。Ubuntu 可安装 php8.4-mbstring php8.4-curl php8.4-gd php8.4-intl php8.4-xml php8.4-zip php8.4-opcache php8.4-sqlite3，然后重启 Wikist。`);
  }
}

function resolveComposer(php) {
  const pharCandidates = [
    process.env.WIKIST_COMPOSER,
    path.join(root, ".runtime", "composer", "composer.phar"),
    path.join(root, "runtime", "composer", "composer.phar"),
  ].filter(Boolean).filter((candidate) => candidate.endsWith(".phar") && fs.existsSync(candidate));
  if (pharCandidates[0]) return { command: php, args: [pharCandidates[0]] };
  for (const command of process.platform === "win32" ? ["composer.bat", "composer"] : ["composer"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0) return { command, args: [] };
  }
  return null;
}

function ensureWebmanDependencies(php) {
  if (fs.existsSync(path.join(webman, "vendor", "autoload.php"))) return;
  const composer = resolveComposer(php);
  if (!composer) {
    throw new Error("未找到 Composer。请安装 Composer，或通过 WIKIST_COMPOSER 指定 composer.phar。 ");
  }
  const composerIdentity = spawnSync(composer.command, [...composer.args, "--version"], { encoding: "utf8", windowsHide: true });
  console.log(`Composer runtime: ${[composer.command, ...composer.args].join(" ")} (${String(composerIdentity.stdout || "unknown version").trim()})`);
  console.log("正在安装 Wikist Webman 依赖...");
  const result = spawnSync(composer.command, [
    ...composer.args,
    "install",
    "--no-dev",
    "--optimize-autoloader",
    "--no-interaction",
  ], { cwd: webman, stdio: "inherit", windowsHide: true });
  if (result.status !== 0 || !fs.existsSync(path.join(webman, "vendor", "autoload.php"))) {
    throw new Error("Webman 依赖安装失败，请检查 Composer 输出。 ");
  }
}

function configuredDatabase() {
  const configured = String(process.env.WIKIST_DB_DATABASE || "").trim();
  if (configured) {
    const absolute = path.resolve(root, configured);
    if (!absolute.startsWith(root + path.sep)) {
      throw new Error("混合迁移阶段的 SQLite 数据库必须位于 Wikist 项目目录内，以便 Webman 与 Node 共享同一数据源。 ");
    }
    return absolute;
  }
  const sitePath = path.join(root, "config", "site.config.json");
  let relative = "data/wikist.sqlite";
  if (fs.existsSync(sitePath)) {
    const site = JSON.parse(fs.readFileSync(sitePath, "utf8").replace(/^\uFEFF/, ""));
    relative = String(site.passport?.database || relative).replace(/\\/g, "/");
  }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Wikist 数据库必须位于项目目录内。");
  return absolute;
}

function stop(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    stopProcessTree(child.pid, true);
  } else {
    try { child.kill("SIGTERM"); } catch (_) {}
  }
}

if (internalPort === publicPort) {
  throw new Error("WIKIST_NODE_PORT 不能与 WIKIST_PORT 相同。");
}
const php = resolvePhp();
const phpIdentity = spawnSync(php, ["-r", "echo PHP_BINARY . ' ' . PHP_VERSION;"], { encoding: "utf8", windowsHide: true });
console.log(`PHP runtime: ${String(phpIdentity.stdout || php).trim()}`);
ensurePhpExtensions(php);
ensureWebmanDependencies(php);
const internalToken = process.env.WIKIST_INTERNAL_TOKEN || crypto.randomBytes(32).toString("hex");
const database = configuredDatabase();
if (String(process.env.WIKIST_DB_DRIVER || "sqlite").toLowerCase() !== "sqlite") {
  throw new Error("Node 兼容层启用期间必须使用 Wikist SQLite 数据库；待普通 API 全部迁入 Webman 后即可切换 MySQL。 ");
}
const nodeDatabase = path.relative(root, database).replace(/\\/g, "/");
const publicHost = process.env.WIKIST_HOST || "127.0.0.1";
const production = /^(?:production|prod)$/i.test(String(process.env.APP_ENV || "development"));
const siteConfiguration = readSiteConfiguration();
const sitePublicUrl = String(siteConfiguration.publicUrl || siteConfiguration.mail?.baseUrl || "").trim();
const legacyAppUrl = String(process.env.APP_URL || "").trim();
const appUrl = canonicalPublicUrl(process.env.WIKIST_PUBLIC_URL || sitePublicUrl || legacyAppUrl || `http://${publicHost}:${publicPort}`, production);
if (sitePublicUrl && legacyAppUrl) {
  try {
    if (canonicalPublicUrl(sitePublicUrl, false) !== canonicalPublicUrl(legacyAppUrl, false)) {
      console.warn(`Wikist 已忽略与 site.publicUrl 不一致的 APP_URL：${legacyAppUrl}`);
    }
  } catch (_) {
    console.warn("Wikist 已忽略格式无效或过期的 APP_URL，当前使用 site.publicUrl。");
  }
}
const originList = trustedOrigins(appUrl);
ensureStackConfig();
const stack = refreshRealtimeConfiguration(appUrl, originList);
const centrifugoEnabled = enabledByEnvironment("CENTRIFUGO_ENABLED", stack?.centrifugo?.enabled);
const centrifugoHost = String(stack?.centrifugo?.host || "127.0.0.1");
const centrifugoPort = Number(stack?.centrifugo?.port || 8902);

if (!canBindPort(publicHost, publicPort)) {
  throw new Error(`Wikist public port ${publicHost}:${publicPort} is already in use. Stop the existing service or run run-wikist-server.cmd --restart.`);
}
if (!canBindPort("127.0.0.1", internalPort)) {
  throw new Error(`Wikist compatibility port 127.0.0.1:${internalPort} is already in use. Stop the existing service before starting another instance.`);
}
if (centrifugoEnabled && !canBindPort(centrifugoHost, centrifugoPort)) {
  throw new Error(`Centrifugo port ${centrifugoHost}:${centrifugoPort} is already in use.`);
}

const centrifugoBinary = centrifugoEnabled ? stackPath(stack.centrifugo.binary) : "";
const centrifugoConfigPath = centrifugoEnabled ? stackPath(stack.centrifugo.configPath) : "";
if (centrifugoBinary && !fs.existsSync(centrifugoBinary)) throw new Error(`Centrifugo runtime is missing: ${centrifugoBinary}`);
const common = {
  ...process.env,
  APP_URL: appUrl,
  WIKIST_PUBLIC_URL: appUrl,
  APP_SECRET: process.env.APP_SECRET || process.env.WIKIST_PASSPORT_SECRET || "",
  WIKIST_PASSPORT_SECRET: process.env.APP_SECRET || process.env.WIKIST_PASSPORT_SECRET || "",
  TRUSTED_ORIGINS: originList,
  SESSION_SECURE: process.env.SESSION_SECURE || String(appUrl.toLowerCase().startsWith("https://")),
  WIKIST_DB_DRIVER: process.env.WIKIST_DB_DRIVER || "sqlite",
  WIKIST_DB_PROFILE: process.env.WIKIST_DB_PROFILE || "sqlite-single-host",
  WIKIST_DB_DATABASE: process.env.WIKIST_DB_DATABASE || database,
  WIKIST_PASSPORT_DATABASE: nodeDatabase,
  WEBMAN_HOST: publicHost,
  WEBMAN_PORT: String(publicPort),
  WEBMAN_WORKERS: process.env.WEBMAN_WORKERS || "1",
  LEGACY_NODE_PROXY: "true",
  LEGACY_NODE_URL: `http://127.0.0.1:${internalPort}`,
  LEGACY_NODE_TOKEN: internalToken,
  WIKIST_INTERNAL_TOKEN: internalToken,
  WIKIST_COMPATIBILITY_MODE: "1",
  WIKIST_INSTALL_BOOTSTRAP_SECRET: installBootstrapSecret,
  MESSAGING_ENABLED: process.env.MESSAGING_ENABLED || "true",
  CENTRIFUGO_ENABLED: String(centrifugoEnabled),
  CENTRIFUGO_PUBLIC_URL: resolvedRealtimePublicUrl(process.env.CENTRIFUGO_PUBLIC_URL, appUrl, centrifugoHost, centrifugoPort),
  CENTRIFUGO_API_URL: process.env.CENTRIFUGO_API_URL || `http://${centrifugoHost}:${centrifugoPort}/api`,
  CENTRIFUGO_API_KEY: process.env.CENTRIFUGO_API_KEY || stack?.centrifugo?.apiKey || "",
  CENTRIFUGO_TOKEN_HMAC_SECRET: process.env.CENTRIFUGO_TOKEN_HMAC_SECRET || stack?.centrifugo?.tokenHmacSecret || "",
};

// Webman's bootstrap reloads .env, so keep the browser endpoint aligned with
// the resolved runtime endpoint before any PHP process starts.
persistEnvironmentValue("CENTRIFUGO_PUBLIC_URL", common.CENTRIFUGO_PUBLIC_URL);

console.log(`Public site URL: ${appUrl}`);
console.log(`Realtime public URL: ${common.CENTRIFUGO_PUBLIC_URL}`);
console.log(`Webman listen: ${publicHost}:${publicPort}`);
console.log(`Node compatibility (internal): 127.0.0.1:${internalPort}`);
console.log(`Centrifugo API (internal): ${common.CENTRIFUGO_API_URL}`);

const migration = spawnSync(php, [path.join(webman, "tools", "migrate.php")], {
  cwd: webman,
  env: common,
  encoding: "utf8",
  windowsHide: true,
});
if (migration.status !== 0) {
  throw new Error(`Webman 数据迁移失败：${String(migration.stderr || migration.stdout || "unknown error").trim()}`);
}
if (migration.stdout) process.stdout.write(migration.stdout);
const secretMigration = spawnSync(php, [path.join(webman, "tools", "migrate-secrets.php")], {
  cwd: webman,
  env: common,
  encoding: "utf8",
  windowsHide: true,
});
if (secretMigration.status !== 0) {
  throw new Error(`Wikist 密钥迁移失败：${String(secretMigration.stderr || secretMigration.stdout || "unknown error").trim()}`);
}
if (secretMigration.stdout) process.stdout.write(secretMigration.stdout);
const adminProbe = spawnSync(php, ["-r", "$p=new PDO('sqlite:'.getenv('WIKIST_DB_DATABASE'));echo json_encode(['users'=>(int)$p->query(\"SELECT COUNT(*) FROM users\")->fetchColumn(),'admins'=>(int)$p->query(\"SELECT COUNT(*) FROM users WHERE role='admin' AND status='active'\")->fetchColumn()]);"], {
  cwd: webman,
  env: common,
  encoding: "utf8",
  windowsHide: true,
});
if (adminProbe.status === 0) {
  const adminState = JSON.parse(String(adminProbe.stdout || "{}").trim() || "{}");
  if (Number(adminState.users || 0) === 0) {
    console.log(`Wikist 初始管理员安装密钥：${installBootstrapSecret}`);
    console.log("请在创建首位管理员时输入该密钥；创建完成后它将不再有效。");
  } else if (Number(adminState.admins || 0) === 0) {
    console.warn("Wikist 检测到已有用户但没有有效管理员。请在服务器终端执行：npm run admin:recover -- --username=<用户名> --yes");
  }
}

let centrifugoProcess = null;
try {
  if (centrifugoEnabled) {
    const centrifugoEnv = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !name.toUpperCase().startsWith("CENTRIFUGO_")));
    centrifugoProcess = spawn(centrifugoBinary, ["-c", centrifugoConfigPath], {
      cwd: path.dirname(centrifugoConfigPath),
      env: centrifugoEnv,
      stdio: "inherit",
      windowsHide: true,
    });
    waitForPort("Centrifugo", centrifugoHost, centrifugoPort);
  }
} catch (error) {
  stop(centrifugoProcess);
  throw error;
}

const node = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd: root,
  env: { ...common, WIKIST_HOST: "127.0.0.1", WIKIST_PORT: String(internalPort) },
  stdio: "inherit",
  windowsHide: true,
});
const phpEntry = process.platform === "win32" ? "windows.php" : "start.php";
const webmanProcess = spawn(php, [path.join(webman, phpEntry), "start"], {
  cwd: webman,
  env: common,
  stdio: "inherit",
  windowsHide: true,
});

try {
  waitForPort("Node compatibility service", "127.0.0.1", internalPort, 20000);
  waitForPort("Wikist Webman", publicHost, publicPort, 20000);
} catch (error) {
  stop(node);
  stop(webmanProcess);
  stop(centrifugoProcess);
  throw error;
}

try {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${JSON.stringify({
    pid: process.pid,
    nodePid: node.pid,
    webmanPid: webmanProcess.pid,
    centrifugoPid: centrifugoProcess?.pid || null,
    root,
    publicPort,
    internalPort,
    centrifugoPort: centrifugoEnabled ? centrifugoPort : null,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
} catch (error) {
  console.warn(`Unable to write hybrid PID record: ${error.message}`);
}

console.log(`Wikist Webman: http://${publicHost}:${publicPort}`);
console.log(`Node compatibility service: http://127.0.0.1:${internalPort}`);
if (centrifugoEnabled) console.log(`Centrifugo realtime transport: ws://${centrifugoHost}:${centrifugoPort}/connection/websocket`);

let exiting = false;
function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  stop(node);
  stop(webmanProcess);
  stop(centrifugoProcess);
  removePidFile(process.pid);
  setTimeout(() => process.exit(code), 800).unref();
}
function criticalExit(name, code, signal) {
  if (exiting) return;
  const exitCode = Number.isInteger(code) && code !== 0 ? code : 1;
  console.error(`${name} exited unexpectedly (${signal || code || "no status"}).`);
  shutdown(exitCode);
}
node.once("exit", (code, signal) => criticalExit("Node compatibility service", code, signal));
webmanProcess.once("exit", (code, signal) => criticalExit("Wikist Webman", code, signal));
centrifugoProcess?.once("exit", (code, signal) => criticalExit("Centrifugo", code, signal));
process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.once("exit", () => removePidFile(process.pid));
