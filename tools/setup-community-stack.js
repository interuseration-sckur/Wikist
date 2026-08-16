const crypto = require("crypto");
const childProcess = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "data");
const stackPath = path.join(dataRoot, "wikist-stack.json");
const centrifugoDataPath = path.join(dataRoot, "centrifugo");
const centrifugoConfigPath = path.join(centrifugoDataPath, "config.json");
const CENTRIFUGO_VERSION = "6.8.1";
const CHECKSUM_MANIFEST_SHA256 = "33b38af9540e1b73853407a28688a1fdf9bf3ee904499dd3d477f98976758b1f";

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

function platformAsset() {
  const os = { win32: "windows", linux: "linux", darwin: "darwin" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64", ia32: "386" }[process.arch];
  if (!os || !arch || (os === "windows" && arch !== "amd64")) throw new Error(`Unsupported Centrifugo platform: ${process.platform}/${process.arch}`);
  return `centrifugo_${CENTRIFUGO_VERSION}_${os}_${arch}.${os === "windows" ? "zip" : "tar.gz"}`;
}

function download(url, filePath, maxBytes, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many Centrifugo download redirects."));
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(parsed.hostname)) {
      return reject(new Error(`Untrusted Centrifugo download host: ${parsed.hostname}`));
    }
    const request = https.get(parsed, { headers: { "User-Agent": "Wikist-runtime-installer", Accept: "application/octet-stream" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, parsed).toString(), filePath, maxBytes, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Centrifugo download returned HTTP ${response.statusCode}.`));
      }
      let bytes = 0;
      const output = fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 });
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) request.destroy(new Error("Centrifugo download exceeds the safety limit."));
      });
      response.once("error", reject);
      output.once("error", reject);
      output.once("close", () => resolve(bytes));
      response.pipe(output);
    });
    request.setTimeout(30000, () => request.destroy(new Error("Centrifugo download timed out.")));
    request.once("error", reject);
  });
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function findBinary(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const nested = findBinary(candidate);
      if (nested) return nested;
    } else if (entry.isFile() && /^centrifugo(?:\.exe)?$/i.test(entry.name)) return candidate;
  }
  return "";
}

async function installCentrifugo(binary) {
  const runtimeRoot = path.dirname(binary);
  const temporary = path.join(runtimeRoot, `.install-${process.pid}-${crypto.randomBytes(5).toString("hex")}`);
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const asset = platformAsset();
  const base = `https://github.com/centrifugal/centrifugo/releases/download/v${CENTRIFUGO_VERSION}`;
  const manifestPath = path.join(temporary, "checksums.txt");
  const archivePath = path.join(temporary, asset);
  try {
    await download(`${base}/centrifugo_${CENTRIFUGO_VERSION}_checksums.txt`, manifestPath, 64 * 1024);
    if (digest(manifestPath) !== CHECKSUM_MANIFEST_SHA256) throw new Error("Centrifugo checksum manifest verification failed.");
    const manifest = fs.readFileSync(manifestPath, "utf8");
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expected = manifest.match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${escaped}$`, "mi"))?.[1]?.toLowerCase();
    if (!expected) throw new Error(`Centrifugo checksum is missing for ${asset}.`);
    await download(`${base}/${asset}`, archivePath, 80 * 1024 * 1024);
    if (digest(archivePath) !== expected) throw new Error("Centrifugo archive verification failed.");
    const extraction = path.join(temporary, "extracted");
    fs.mkdirSync(extraction, { recursive: true, mode: 0o700 });
    const result = childProcess.spawnSync("tar", ["-xf", archivePath, "-C", extraction], { windowsHide: true, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Unable to extract Centrifugo: ${String(result.stderr || result.stdout || "tar failed").trim()}`);
    const extracted = findBinary(extraction);
    if (!extracted || fs.lstatSync(extracted).isSymbolicLink()) throw new Error("Verified Centrifugo archive did not contain a regular executable.");
    fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
    const staging = `${binary}.${process.pid}.tmp`;
    fs.copyFileSync(extracted, staging, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(staging, 0o700);
    fs.renameSync(staging, binary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function installLocalCentrifugo(source, binary) {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`Offline Centrifugo runtime does not exist: ${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 150 * 1024 * 1024) {
    throw new Error("Offline Centrifugo runtime must be a regular executable below 150 MiB.");
  }
  const probe = childProcess.spawnSync(resolved, ["version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (probe.error || probe.status !== 0 || !/centrifugo/i.test(String(probe.stdout || probe.stderr || ""))) {
    throw new Error("The supplied offline runtime is not a working Centrifugo executable.");
  }
  fs.mkdirSync(path.dirname(binary), { recursive: true, mode: 0o700 });
  const staging = `${binary}.${process.pid}.tmp`;
  fs.copyFileSync(resolved, staging, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(staging, 0o700);
  fs.renameSync(staging, binary);
}

async function ensureStackConfig() {
  const current = readJson(stackPath, {});
  const binary = centrifugoBinary();
  const disabledByCli = process.argv.includes("--no-realtime");
  const offlineSource = process.argv.find((arg) => arg.startsWith("--centrifugo="))?.slice("--centrifugo=".length) || "";
  const enabled = disabledByCli ? false : booleanEnvironment("CENTRIFUGO_ENABLED", current?.centrifugo?.enabled !== false);
  if (enabled && !fs.existsSync(binary)) {
    if (offlineSource) {
      console.log(`Installing offline Centrifugo runtime from ${path.resolve(offlineSource)}...`);
      installLocalCentrifugo(offlineSource, binary);
    } else {
      if (process.argv.includes("--no-download")) throw new Error(`Centrifugo runtime is missing: ${binary}. Supply --centrifugo=/path/to/binary or remove --no-download.`);
      console.log(`Downloading and verifying Centrifugo ${CENTRIFUGO_VERSION} for ${process.platform}/${process.arch}...`);
      await installCentrifugo(binary);
    }
  }

  const stack = {
    version: 3,
    centrifugo: {
      enabled,
      version: CENTRIFUGO_VERSION,
      binary: relative(binary),
      configPath: relative(centrifugoConfigPath),
      host: String(current?.centrifugo?.host || "127.0.0.1"),
      port: Number(current?.centrifugo?.port || 8902),
      apiKey: String(current?.centrifugo?.apiKey || randomSecret()),
      tokenHmacSecret: String(current?.centrifugo?.tokenHmacSecret || randomSecret()),
    },
  };
  writeJson(stackPath, stack);
  return stack;
}

function ensureCentrifugoConfig(stack, appUrl) {
  const production = /^(?:production|prod)$/i.test(String(process.env.APP_ENV || "development"));
  const configuredOrigins = String(process.env.TRUSTED_ORIGINS || appUrl).split(",").map((item) => item.trim()).filter(Boolean);
  const allowedOrigins = Array.from(new Set(production
    ? configuredOrigins
    : [...configuredOrigins, "http://127.0.0.1:8899", "http://localhost:8899"]));
  const config = {
    http_server: { address: stack.centrifugo.host, port: stack.centrifugo.port },
    client: {
      token: { hmac_secret_key: stack.centrifugo.tokenHmacSecret },
      allowed_origins: allowedOrigins,
      user_connection_limit: 8,
      channel_limit: 32,
    },
    channel: {
      history_meta_ttl: "24h",
      namespaces: [
        { name: "conversation", presence: true, join_leave: true, force_push_join_leave: true, history_size: 100, history_ttl: "5m", force_recovery: true, allow_publish_for_client: false, allow_publish_for_subscriber: false, allow_publish_for_anonymous: false },
        { name: "personal", history_size: 30, history_ttl: "2m", force_recovery: true, allow_publish_for_client: false, allow_publish_for_subscriber: false, allow_publish_for_anonymous: false },
        { name: "organization", history_size: 30, history_ttl: "2m", force_recovery: true, allow_publish_for_client: false, allow_publish_for_subscriber: false, allow_publish_for_anonymous: false },
        { name: "system", history_size: 30, history_ttl: "2m", force_recovery: true, allow_publish_for_client: false, allow_publish_for_subscriber: false, allow_publish_for_anonymous: false },
      ],
    },
    http_api: { key: stack.centrifugo.apiKey },
    health: { enabled: true },
    log: { level: "info" },
  };
  writeJson(centrifugoConfigPath, config);
}

async function main() {
  fs.mkdirSync(dataRoot, { recursive: true });
  const stack = await ensureStackConfig();
  const appUrl = process.env.WIKIST_PUBLIC_URL || process.env.APP_URL || "http://127.0.0.1:8899";
  ensureCentrifugoConfig(stack, appUrl);
  console.log(`Wikist realtime configuration: ${stackPath}`);
  console.log(`Centrifugo configuration: ${centrifugoConfigPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
