const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const webman = path.join(root, "webman-backend");
const pidFile = path.join(root, "data", "wikist-hybrid.pid.json");
const stackFile = path.join(root, "data", "wikist-stack.json");
const publicPort = Number(process.env.WIKIST_PORT || 8899);
const internalPort = Number(process.env.WIKIST_NODE_PORT || publicPort + 1);

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

function stopProcessTree(pid, force = false) {
  pid = Number(pid || 0);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try { process.kill(pid, force ? "SIGKILL" : "SIGTERM"); } catch (_) {}
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
  for (const pid of pids) stopProcessTree(pid, true);
  removePidFile(running?.pid || 0);
  return pids;
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
  const pids = stopRecordedStack();
  if (pids.length > 0) {
    console.log(`Stopped Wikist stack (${pids.length} recorded processes).`);
  } else {
    console.log("No Wikist stack PID record was found.");
  }
  process.exit(0);
}

if (process.argv.includes("--restart")) {
  const pids = stopRecordedStack();
  if (pids.length > 0) console.log(`Stopped previous Wikist stack (${pids.length} recorded processes).`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
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
    const result = spawnSync(candidate, ["-r", "echo PHP_VERSION;"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0 && Number(String(result.stdout).split(".")[0]) >= 8) return candidate;
  }
  throw new Error("Wikist Webman 需要 PHP 8.1 或更高版本。请安装 PHP，或设置 WIKIST_PHP。 ");
}

function ensurePhpExtensions(php) {
  const probe = spawnSync(php, ["-r", "$r=['pdo','mbstring','openssl','json','curl','gd'];$m=array_values(array_filter($r,fn($e)=>!extension_loaded($e)));echo implode(',', $m);exit($m?1:0);"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status !== 0) {
    const missing = String(probe.stdout || "unknown").trim();
    throw new Error(`Wikist Webman 缺少 PHP 扩展：${missing}。行为验证码需要 GD；请启用扩展后重启。`);
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
ensurePhpExtensions(php);
ensureWebmanDependencies(php);
const internalToken = process.env.WIKIST_INTERNAL_TOKEN || crypto.randomBytes(32).toString("hex");
const database = configuredDatabase();
if (String(process.env.WIKIST_DB_DRIVER || "sqlite").toLowerCase() !== "sqlite") {
  throw new Error("Node 兼容层启用期间必须使用 Wikist SQLite 数据库；待普通 API 全部迁入 Webman 后即可切换 MySQL。 ");
}
const nodeDatabase = path.relative(root, database).replace(/\\/g, "/");
const publicHost = process.env.WIKIST_HOST || "127.0.0.1";
const appUrl = process.env.APP_URL || `http://${publicHost}:${publicPort}`;
const stack = ensureStackConfig();
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
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS || appUrl,
  SESSION_SECURE: process.env.SESSION_SECURE || String(appUrl.toLowerCase().startsWith("https://")),
  WIKIST_DB_DRIVER: process.env.WIKIST_DB_DRIVER || "sqlite",
  WIKIST_DB_DATABASE: process.env.WIKIST_DB_DATABASE || database,
  WIKIST_PASSPORT_DATABASE: nodeDatabase,
  WEBMAN_HOST: publicHost,
  WEBMAN_PORT: String(publicPort),
  LEGACY_NODE_PROXY: "true",
  LEGACY_NODE_URL: `http://127.0.0.1:${internalPort}`,
  LEGACY_NODE_TOKEN: internalToken,
  WIKIST_INTERNAL_TOKEN: internalToken,
  MESSAGING_ENABLED: process.env.MESSAGING_ENABLED || "true",
  CENTRIFUGO_ENABLED: String(centrifugoEnabled),
  CENTRIFUGO_PUBLIC_URL: process.env.CENTRIFUGO_PUBLIC_URL || stack?.centrifugo?.publicUrl || `ws://${centrifugoHost}:${centrifugoPort}/connection/websocket`,
  CENTRIFUGO_API_URL: process.env.CENTRIFUGO_API_URL || `http://${centrifugoHost}:${centrifugoPort}/api`,
  CENTRIFUGO_API_KEY: process.env.CENTRIFUGO_API_KEY || stack?.centrifugo?.apiKey || "",
  CENTRIFUGO_TOKEN_HMAC_SECRET: process.env.CENTRIFUGO_TOKEN_HMAC_SECRET || stack?.centrifugo?.tokenHmacSecret || "",
};

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
node.once("exit", (code) => shutdown(code || 0));
webmanProcess.once("exit", (code) => shutdown(code || 0));
centrifugoProcess?.once("exit", (code) => shutdown(code || 0));
process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.once("exit", () => removePidFile(process.pid));
