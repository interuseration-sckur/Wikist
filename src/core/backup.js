const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bufferForEntry(entry = {}) {
  return String(entry.encoding || "utf8").toLowerCase() === "base64"
    ? Buffer.from(String(entry.content || ""), "base64")
    : Buffer.from(String(entry.content || ""), "utf8");
}

function textFileEntry(rootDir, filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    path: safeRelative(rootDir, filePath),
    encoding: "utf8",
    bytes: buffer.length,
    sha256: sha256(buffer),
    content: buffer.toString("utf8"),
  };
}

function binaryFileEntry(rootDir, filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    path: safeRelative(rootDir, filePath),
    encoding: "base64",
    bytes: buffer.length,
    sha256: sha256(buffer),
    content: buffer.toString("base64"),
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

function sqliteBackupFiles(rootDir, database = "data/wikist.sqlite", snapshot = null) {
  if (Buffer.isBuffer(snapshot)) {
    return [{
      path: normalizeBackupPath(database),
      encoding: "base64",
      bytes: snapshot.length,
      sha256: sha256(snapshot),
      content: snapshot.toString("base64"),
    }];
  }
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
  if (normalized.startsWith("content/reviewed/")) return normalized.endsWith(".md");
  if (normalized.startsWith("content/deleted/")) return normalized.endsWith(".md") || normalized.endsWith(".json");
  if (normalized.startsWith("config/")) return normalized.endsWith(".json");
  if (normalized.startsWith("plugins/")) return path.basename(normalized).toLowerCase() === "plugin.json";
  return false;
}

function isRestorableUserDataPath(relativePath, database = "data/wikist.sqlite") {
  const normalized = normalizeBackupPath(relativePath);
  const expected = normalizeBackupPath(database) || "data/wikist.sqlite";
  return normalized === expected || normalized === `${expected}-wal` || normalized === `${expected}-shm`;
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

function validateEntry(entry, options = {}) {
  const relativePath = normalizeBackupPath(entry?.path);
  const allowed = options.userData ? isRestorableUserDataPath(relativePath, options.database) : isRestorableTextPath(relativePath);
  const issues = [];
  if (!relativePath) issues.push("路径无效");
  if (!allowed) issues.push("路径不在备份白名单");
  const encoding = String(entry?.encoding || "utf8").toLowerCase();
  if (!["utf8", "base64"].includes(encoding)) issues.push("编码不受支持");
  let buffer = Buffer.alloc(0);
  try {
    buffer = bufferForEntry(entry);
  } catch (_error) {
    issues.push("内容无法解码");
  }
  if (Number(entry?.bytes || 0) !== buffer.length) issues.push("文件大小校验失败");
  if (entry?.sha256 && !/^[a-f0-9]{64}$/i.test(String(entry.sha256))) issues.push("校验和格式无效");
  if (entry?.sha256 && sha256(buffer) !== String(entry.sha256).toLowerCase()) issues.push("SHA-256 校验失败");
  return { path: relativePath, issues };
}

function validateBackupPackage(input = {}, options = {}) {
  let payload;
  try {
    payload = readBackupPackage(input);
  } catch (error) {
    return { valid: false, issues: [error.message || "备份包无法读取"], payload: null, counts: {} };
  }
  const issues = [];
  const seen = new Set();
  const entries = [
    ...(payload.files || []).map((entry) => ({ entry, userData: false })),
    ...(payload.userData || []).map((entry) => ({ entry, userData: true })),
  ];
  const database = options.database || payload.database || "data/wikist.sqlite";
  for (const { entry, userData } of entries) {
    const result = validateEntry(entry, { userData, database });
    if (seen.has(result.path)) result.issues.push("备份内存在重复路径");
    seen.add(result.path);
    for (const issue of result.issues) issues.push(`${result.path || "未知路径"}：${issue}`);
  }
  if (payload.integrity?.algorithm && payload.integrity.algorithm !== "sha256") issues.push("不支持的备份校验算法");
  if (payload.integrity?.manifestSha256) {
    const manifest = JSON.stringify({ files: payload.files || [], userData: payload.userData || [] });
    if (sha256(Buffer.from(manifest, "utf8")) !== payload.integrity.manifestSha256) issues.push("备份清单校验失败");
  }
  return { valid: issues.length === 0, issues: issues.slice(0, 80), payload, counts: backupCounts(payload) };
}

function backupCounts(payload) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const userData = Array.isArray(payload.userData) ? payload.userData : [];
  return {
    pages: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/pages/")).length,
    revisions: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/revisions/")).length,
    reviewed: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/reviewed/")).length,
    deleted: files.filter((file) => normalizeBackupPath(file.path).startsWith("content/deleted/")).length,
    config: files.filter((file) => normalizeBackupPath(file.path).startsWith("config/")).length,
    plugins: files.filter((file) => normalizeBackupPath(file.path).startsWith("plugins/")).length,
    userDataFiles: userData.length,
    totalBytes: [...files, ...userData].reduce((sum, file) => sum + Number(file.bytes || 0), 0),
  };
}

function inspectBackupPackage(input = {}, options = {}) {
  const validation = validateBackupPackage(input, options);
  if (!validation.payload) throw new Error(validation.issues[0] || "备份包无法读取");
  const payload = validation.payload;
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
    validation: {
      valid: validation.valid,
      issues: validation.issues,
      algorithm: payload.integrity?.algorithm || "legacy",
    },
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
  fs.writeFileSync(target, bufferForEntry({ ...entry, encoding }));
  return {
    path: normalizeBackupPath(entry.path),
    bytes: fs.statSync(target).size,
    encoding,
  };
}

function restoreBackupPackage(rootDir, input = {}, options = {}) {
  const validation = validateBackupPackage(input, options);
  if (!validation.valid || !validation.payload) {
    const error = new Error(`备份校验失败：${validation.issues.slice(0, 3).join("；") || "无法读取备份包"}`);
    error.statusCode = 400;
    throw error;
  }
  const payload = validation.payload;
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
    if (!isRestorableUserDataPath(relativePath, options.database || payload.database || "data/wikist.sqlite")) {
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
    needsRestart: includeUserData && (payload.userData || []).some((entry) => isRestorableUserDataPath(entry.path, options.database || payload.database || "data/wikist.sqlite")),
    validation: { valid: true, algorithm: payload.integrity?.algorithm || "legacy" },
  };
}

function exerciseBackupPackage(input = {}, options = {}) {
  const validation = validateBackupPackage(input, options);
  if (!validation.valid || !validation.payload) {
    const error = new Error(`备份校验失败：${validation.issues.slice(0, 3).join("；") || "无法读取备份包"}`);
    error.statusCode = 400;
    throw error;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wikist-restore-drill-"));
  try {
    const packageBase64 = bufferFromBackupInput(input).toString("base64");
    const restored = restoreBackupPackage(root, { packageBase64 }, {
      database: options.database || "data/wikist.sqlite",
      includeUserData: options.includeUserData === true,
    });
    const replay = inspectBackupPackage({ packageBase64 }, options);
    return {
      ok: true,
      rehearsedAt: new Date().toISOString(),
      restored: restored.restored.length,
      skipped: restored.skipped.length,
      counts: replay.counts,
      validation: replay.validation,
      scope: options.includeUserData === true ? "content-and-user-data" : "content-only",
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
  }
}

function createBackupPackage(rootDir, options = {}) {
  const generatedAt = new Date().toISOString();
  const database = options.database || "data/wikist.sqlite";
  const files = [
    ...collectTextDirectory(rootDir, "content/pages"),
    ...collectTextDirectory(rootDir, "content/revisions"),
    ...collectTextDirectory(rootDir, "content/reviewed"),
    ...collectTextDirectory(rootDir, "content/deleted"),
    ...collectTextDirectory(rootDir, "config", new Set([".json"])),
    ...collectPluginManifests(rootDir),
  ];
  const userData = options.includeUserData === false ? [] : sqliteBackupFiles(rootDir, database, options.databaseSnapshot || null);
  const packageData = {
    format: "wikist-site-backup",
    version: 2,
    generatedAt,
    generator: "Wikist backup",
    database: normalizeBackupPath(database),
    restoreHint: "解压 gzip 后得到 JSON；content/* 可直接还原，data/wikist.sqlite* 为用户与评论等通行证数据。",
    counts: {
      textFiles: files.length,
      userDataFiles: userData.length,
      totalBytes: [...files, ...userData].reduce((sum, file) => sum + Number(file.bytes || 0), 0),
    },
    files,
    userData,
  };
  packageData.integrity = {
    algorithm: "sha256",
    manifestSha256: sha256(Buffer.from(JSON.stringify({ files, userData }), "utf8")),
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
  validateBackupPackage,
  readBackupPackage,
  restoreBackupPackage,
  exerciseBackupPackage,
};
