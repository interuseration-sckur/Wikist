const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function walkFiles(rootDir, currentDir = rootDir, results = []) {
  if (!fs.existsSync(currentDir)) return results;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) walkFiles(rootDir, fullPath, results);
    else if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

function safeRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function textFileEntry(rootDir, filePath) {
  return {
    path: safeRelative(rootDir, filePath),
    encoding: "utf8",
    bytes: fs.statSync(filePath).size,
    content: fs.readFileSync(filePath, "utf8"),
  };
}

function binaryFileEntry(rootDir, filePath) {
  return {
    path: safeRelative(rootDir, filePath),
    encoding: "base64",
    bytes: fs.statSync(filePath).size,
    content: fs.readFileSync(filePath).toString("base64"),
  };
}

function collectTextDirectory(rootDir, relativeDir, extensions = new Set([".md", ".json", ".txt"])) {
  const dir = path.join(rootDir, relativeDir);
  return walkFiles(dir)
    .filter((filePath) => extensions.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => textFileEntry(rootDir, filePath));
}

function collectPluginManifests(rootDir) {
  const pluginsDir = path.join(rootDir, "plugins");
  return walkFiles(pluginsDir)
    .filter((filePath) => path.basename(filePath).toLowerCase() === "plugin.json")
    .map((filePath) => textFileEntry(rootDir, filePath));
}

function sqliteBackupFiles(rootDir, database = "data/wikist.sqlite") {
  const dbPath = path.resolve(rootDir, database);
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => binaryFileEntry(rootDir, filePath));
}

function normalizeBackupPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").some((part) => part === "..")) return "";
  return normalized;
}

function safeTarget(rootDir, relativePath) {
  const normalized = normalizeBackupPath(relativePath);
  if (!normalized) return null;
  const root = path.resolve(rootDir);
  const target = path.resolve(root, ...normalized.split("/"));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function isRestorableTextPath(relativePath) {
  const normalized = normalizeBackupPath(relativePath);
  if (!normalized) return false;
  if (normalized.startsWith("content/pages/")) return normalized.endsWith(".md");
  if (normalized.startsWith("content/revisions/")) return normalized.endsWith(".md") || normalized.endsWith(".json");
  if (normalized.startsWith("content/deleted/")) return normalized.endsWith(".md") || normalized.endsWith(".json");
  if (normalized.startsWith("config/")) return normalized.endsWith(".json");
  if (normalized.startsWith("plugins/")) return path.basename(normalized).toLowerCase() === "plugin.json";
  return false;
}

function isRestorableUserDataPath(relativePath) {
  return /^data\/wikist\.sqlite(?:-wal|-shm)?$/.test(normalizeBackupPath(relativePath));
}

function bufferFromBackupInput(input = {}) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) return Buffer.from(trimmed, "utf8");
    return Buffer.from(trimmed.replace(/^data:[^,]+,/, ""), "base64");
  }
  if (input.package && typeof input.package === "object") return Buffer.from(JSON.stringify(input.package), "utf8");
  if (input.content) return Buffer.from(String(input.content), "utf8");
  if (input.packageBase64) return Buffer.from(String(input.packageBase64).replace(/^data:[^,]+,/, ""), "base64");
  throw new Error("未提供可读取的备份包。");
}

function readBackupPackage(input = {}) {
  const buffer = bufferFromBackupInput(input);
  let text = "";
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    text = zlib.gunzipSync(buffer).toString("utf8");
  } else {
    const raw = buffer.toString("utf8").trim();
    text = raw.startsWith("{") ? raw : zlib.gunzipSync(buffer).toString("utf8");
  }
  const payload = JSON.parse(text);
  if (payload.format !== "wikist-site-backup") throw new Error("备份格式不匹配：只支持 wikist-site-backup。");
  if (!Array.isArray(payload.files)) throw new Error("备份包缺少 files 清单。");
  if (!Array.isArray(payload.userData)) payload.userData = [];
  return payload;
}

function backupCounts(payload) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const userData = Array.isArray(payload.userData) ? payload.userData : [];
  return {
    pages: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/pages/")).length,
    revisions: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/revisions/")).length,
    deleted: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/deleted/")).length,
    config: files.filter((file) => normalizeBackupPath(file.path).startsWith("config/")).length,
    plugins: files.filter((file) => normalizeBackupPath(file.path).startsWith("plugins/")).length,
    userDataFiles: userData.length,
    totalBytes: [...files, ...userData].reduce((sum, file) => sum + Number(file.bytes || 0), 0),
  };
}

function inspectBackupPackage(input = {}) {
  const payload = readBackupPackage(input);
  return {
    format: payload.format,
    version: payload.version || 1,
    generatedAt: payload.generatedAt || "",
    generator: payload.generator || "Wikist backup",
    counts: backupCounts(payload),
    files: payload.files.slice(0, 30).map((file) => ({
      path: normalizeBackupPath(file.path),
      bytes: Number(file.bytes || 0),
      encoding: file.encoding || "utf8",
    })),
    userData: payload.userData.map((file) => ({
      path: normalizeBackupPath(file.path),
      bytes: Number(file.bytes || 0),
      encoding: file.encoding || "base64",
    })),
  };
}

function storeSafetyBackup(rootDir, options = {}) {
  const backup = createBackupPackage(rootDir, options);
  const dir = path.join(rootDir, "data", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, backup.filename);
  fs.writeFileSync(filePath, backup.buffer);
  return {
    filename: backup.filename,
    path: safeRelative(rootDir, filePath),
    generatedAt: backup.manifest.generatedAt,
    compressedBytes: backup.manifest.compressedBytes,
  };
}

function writeRestoredEntry(rootDir, entry) {
  const target = safeTarget(rootDir, entry.path);
  if (!target) throw new Error(`备份路径不安全：${entry.path || ""}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const encoding = String(entry.encoding || "utf8").toLowerCase();
  if (encoding === "base64") fs.writeFileSync(target, Buffer.from(String(entry.content || ""), "base64"));
  else fs.writeFileSync(target, String(entry.content || ""), "utf8");
  return {
    path: normalizeBackupPath(entry.path),
    bytes: fs.statSync(target).size,
    encoding,
  };
}

function restoreBackupPackage(rootDir, input = {}, options = {}) {
  const payload = readBackupPackage(input);
  const includeUserData = options.includeUserData === true;
  const dryRun = options.dryRun === true;
  const restored = [];
  const skipped = [];
  let safetyBackup = null;

  if (!dryRun) safetyBackup = storeSafetyBackup(rootDir, { database: options.database || "data/wikist.sqlite" });

  for (const entry of payload.files || []) {
    const relativePath = normalizeBackupPath(entry.path);
    if (!isRestorableTextPath(relativePath)) {
      skipped.push({ path: relativePath || entry.path || "", reason: "不在可回档目录白名单内" });
      continue;
    }
    if (dryRun) restored.push({ path: relativePath, bytes: Number(entry.bytes || 0), encoding: entry.encoding || "utf8" });
    else restored.push(writeRestoredEntry(rootDir, { ...entry, path: relativePath, encoding: entry.encoding || "utf8" }));
  }

  for (const entry of payload.userData || []) {
    const relativePath = normalizeBackupPath(entry.path);
    if (!includeUserData) {
      skipped.push({ path: relativePath, reason: "未勾选恢复用户、评论、消息与评分数据" });
      continue;
    }
    if (!isRestorableUserDataPath(relativePath)) {
      skipped.push({ path: relativePath || entry.path || "", reason: "用户数据路径不在白名单内" });
      continue;
    }
    if (dryRun) restored.push({ path: relativePath, bytes: Number(entry.bytes || 0), encoding: "base64" });
    else restored.push(writeRestoredEntry(rootDir, { ...entry, path: relativePath, encoding: "base64" }));
  }

  return {
    ok: true,
    restoredFrom: payload.generatedAt || "",
    counts: backupCounts(payload),
    restored,
    skipped,
    safetyBackup,
    needsRestart: includeUserData && (payload.userData || []).some((entry) => isRestorableUserDataPath(entry.path)),
  };
}

function createBackupPackage(rootDir, options = {}) {
  const generatedAt = new Date().toISOString();
  const database = options.database || "data/wikist.sqlite";
  const files = [
    ...collectTextDirectory(rootDir, "content/pages"),
    ...collectTextDirectory(rootDir, "content/revisions"),
    ...collectTextDirectory(rootDir, "content/deleted"),
    ...collectTextDirectory(rootDir, "config", new Set([".json"])),
    ...collectPluginManifests(rootDir),
  ];
  const userData = sqliteBackupFiles(rootDir, database);
  const packageData = {
    format: "wikist-site-backup",
    version: 1,
    generatedAt,
    generator: "Wikist backup",
    restoreHint: "解压 gzip 后得到 JSON；content/* 可直接还原，data/wikist.sqlite* 为用户与评论等通行证数据。",
    counts: {
      textFiles: files.length,
      userDataFiles: userData.length,
      totalBytes: [...files, ...userData].reduce((sum, file) => sum + Number(file.bytes || 0), 0),
    },
    files,
    userData,
  };
  const json = Buffer.from(JSON.stringify(packageData, null, 2), "utf8");
  const buffer = zlib.gzipSync(json, { level: 9 });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  return {
    filename: `wikist-backup-${stamp}.json.gz`,
    contentType: "application/gzip",
    buffer,
    manifest: {
      generatedAt,
      compressedBytes: buffer.length,
      rawBytes: json.length,
      ...packageData.counts,
    },
  };
}

module.exports = {
  createBackupPackage,
  inspectBackupPackage,
  readBackupPackage,
  restoreBackupPackage,
};
