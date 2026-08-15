const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "data");
const stackPath = path.join(dataRoot, "wikist-stack.json");
const centrifugoDataPath = path.join(dataRoot, "centrifugo");
const centrifugoConfigPath = path.join(centrifugoDataPath, "config.json");

function relative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

function booleanEnvironment(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(process.env[name]).trim().toLowerCase());
}

function centrifugoBinary() {
  const extension = process.platform === "win32" ? ".exe" : "";
  return path.join(root, ".runtime", "centrifugo", `centrifugo${extension}`);
}

function ensureStackConfig() {
  const current = readJson(stackPath, {});
  const binary = centrifugoBinary();
  if (!fs.existsSync(binary)) throw new Error(`Centrifugo runtime is missing: ${binary}`);

  const stack = {
    version: 2,
    centrifugo: {
      enabled: booleanEnvironment("CENTRIFUGO_ENABLED", current?.centrifugo?.enabled !== false),
      version: String(current?.centrifugo?.version || "6.8.1"),
      binary: relative(binary),
      configPath: relative(centrifugoConfigPath),
      host: String(current?.centrifugo?.host || "127.0.0.1"),
      port: Number(current?.centrifugo?.port || 8902),
      apiKey: String(current?.centrifugo?.apiKey || randomSecret()),
      tokenHmacSecret: String(current?.centrifugo?.tokenHmacSecret || randomSecret()),
      publicUrl: String(current?.centrifugo?.publicUrl || "ws://127.0.0.1:8902/connection/websocket"),
    },
  };
  writeJson(stackPath, stack);
  return stack;
}

function ensureCentrifugoConfig(stack, appUrl) {
  const config = {
    http_server: { address: stack.centrifugo.host, port: stack.centrifugo.port },
    client: {
      token: { hmac_secret_key: stack.centrifugo.tokenHmacSecret },
      allowed_origins: Array.from(new Set([appUrl, "http://127.0.0.1:8899", "http://localhost:8899"])),
      user_connection_limit: 8,
      channel_limit: 32,
    },
    channel: {
      history_meta_ttl: "24h",
      namespaces: [
        { name: "conversation", presence: true, join_leave: true, force_push_join_leave: true, history_size: 100, history_ttl: "5m", force_recovery: true },
        { name: "personal", history_size: 30, history_ttl: "2m", force_recovery: true },
        { name: "organization", history_size: 30, history_ttl: "2m", force_recovery: true },
        { name: "system", history_size: 30, history_ttl: "2m", force_recovery: true },
      ],
    },
    http_api: { key: stack.centrifugo.apiKey },
    log: { level: "info" },
  };
  writeJson(centrifugoConfigPath, config);
}

function main() {
  fs.mkdirSync(dataRoot, { recursive: true });
  const stack = ensureStackConfig();
  const appUrl = process.env.APP_URL || "http://127.0.0.1:8899";
  ensureCentrifugoConfig(stack, appUrl);
  console.log(`Wikist realtime configuration: ${stackPath}`);
  console.log(`Centrifugo configuration: ${centrifugoConfigPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
