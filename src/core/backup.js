const fs = require("fs");
const crypto = require("crypto");
const { once } = require("events");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const MAX_BACKUP_INPUT_BYTES = 96 * 1024 * 1024;
const MAX_BACKUP_RAW_BYTES = 384 * 1024 * 1024;
const MAX_BACKUP_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_TOTAL_BYTES = 320 * 1024 * 1024;
const MAX_BACKUP_FILES = 20000;
const REDACTED = "__WIKIST_REDACTED__";

function backupSigningKey(options = {}) {
  return String(options.signingKey || process.env.WIKIST_BACKUP_SIGNING_KEY || "");
}

function backupSignaturePayload(payload) {
  return JSON.stringify({
    format: payload.format || "",
    version: Number(payload.version || 0),
    generatedAt: payload.generatedAt || "",
    generator: payload.generator || "",
    siteId: payload.siteId || "",
    wikistVersion: payload.wikistVersion || "",
    database: payload.database || "",
    manifestSha256: payload.integrity?.manifestSha256 || "",
  });
}

function backupSignature(payload, key) {
  return crypto.createHmac("sha256", key).update(backupSignaturePayload(payload)).digest("hex");
}

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

function redactConfigValue(value, key = "") {
  if (/pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential/i.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactConfigValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactConfigValue(item, name)]));
  }
  return value;
}

function restoreRedactedValue(incoming, current) {
  if (incoming === REDACTED) return current ?? "";
  if (Array.isArray(incoming)) return incoming.map((item, index) => restoreRedactedValue(item, current?.[index]));
  if (incoming && typeof incoming === "object") {
    return Object.fromEntries(Object.entries(incoming).map(([name, item]) => [name, restoreRedactedValue(item, current?.[name])]));
  }
  return incoming;
}

function collectSafeConfig(rootDir) {
  const configDir = path.join(rootDir, "config");
  return walkFiles(configDir)
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".json")
    .map((filePath) => {
      const relative = safeRelative(rootDir, filePath);
      if (path.basename(filePath).toLowerCase() !== "site.config.json") return textFileEntry(rootDir, filePath);
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
      const buffer = Buffer.from(`${JSON.stringify(redactConfigValue(parsed), null, 2)}\n`, "utf8");
      return { path: relative, encoding: "utf8", bytes: buffer.length, sha256: sha256(buffer), content: buffer.toString("utf8") };
    });
}

function collectBinaryDirectory(rootDir, relativeDir) {
  const dir = path.join(rootDir, relativeDir);
  return walkFiles(dir).map((filePath) => binaryFileEntry(rootDir, filePath));
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
  let cursor = root;
  for (const part of normalized.split("/")) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) return null;
  }
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
  if (normalized === expected || normalized === `${expected}-wal` || normalized === `${expected}-shm`) return true;
  return normalized.startsWith("data/uploads/") && !normalized.endsWith("/");
}

function assertBufferLimit(buffer, limit, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length > limit) throw new Error(`${label}超过允许大小。`);
  return buffer;
}

function bufferFromBackupInput(input = {}) {
  if (Buffer.isBuffer(input)) return assertBufferLimit(input, MAX_BACKUP_INPUT_BYTES, "备份包");
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) return assertBufferLimit(Buffer.from(trimmed, "utf8"), MAX_BACKUP_RAW_BYTES, "备份包");
    return assertBufferLimit(Buffer.from(trimmed.replace(/^data:[^,]+,/, ""), "base64"), MAX_BACKUP_INPUT_BYTES, "备份包");
  }
  if (input.package && typeof input.package === "object") return assertBufferLimit(Buffer.from(JSON.stringify(input.package), "utf8"), MAX_BACKUP_RAW_BYTES, "备份包");
  if (input.content) return assertBufferLimit(Buffer.from(String(input.content), "utf8"), MAX_BACKUP_RAW_BYTES, "备份包");
  if (input.packageBase64) return assertBufferLimit(Buffer.from(String(input.packageBase64).replace(/^data:[^,]+,/, ""), "base64"), MAX_BACKUP_INPUT_BYTES, "备份包");
  throw new Error("未提供可读取的备份包。");
}

function readBackupPackage(input = {}) {
  const buffer = bufferFromBackupInput(input);
  let text = "";
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    text = zlib.gunzipSync(buffer, { maxOutputLength: MAX_BACKUP_RAW_BYTES }).toString("utf8");
  } else {
    const raw = buffer.toString("utf8").trim();
    text = raw.startsWith("{") ? raw : zlib.gunzipSync(buffer, { maxOutputLength: MAX_BACKUP_RAW_BYTES }).toString("utf8");
  }
  const payload = JSON.parse(text);
  if (payload.format !== "wikist-site-backup") throw new Error("备份格式不匹配：只支持 wikist-site-backup。");
  if (!Array.isArray(payload.files)) throw new Error("备份包缺少 files 清单。");
  if (!Array.isArray(payload.userData)) payload.userData = [];
  if (payload.files.length + payload.userData.length > MAX_BACKUP_FILES) throw new Error("备份文件数量超过限制。");
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
  if (buffer.length > MAX_BACKUP_ENTRY_BYTES) issues.push("单个文件超过恢复限制");
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
  const totalBytes = entries.reduce((sum, item) => sum + Math.max(0, Number(item.entry?.bytes || 0)), 0);
  if (totalBytes > MAX_BACKUP_TOTAL_BYTES) issues.push("备份展开后的总大小超过恢复限制");
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
  const key = backupSigningKey(options);
  const requireSignature = options.requireSignature === true
    || /^(?:1|true|yes)$/i.test(String(process.env.WIKIST_REQUIRE_SIGNED_BACKUPS || ""));
  const signature = String(payload.integrity?.signature || "");
  let signatureStatus = "unsigned";
  if (signature) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      issues.push("备份签名格式无效");
      signatureStatus = "invalid";
    } else if (!key) {
      signatureStatus = "unverified";
      if (requireSignature) issues.push("备份已签名，但当前站点未配置签名密钥");
    } else {
      const expected = backupSignature(payload, key);
      signatureStatus = crypto.timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected)) ? "valid" : "invalid";
      if (signatureStatus === "invalid") issues.push("备份来源签名校验失败");
    }
  } else if (requireSignature) {
    issues.push("当前站点要求使用已签名的备份包");
  }
  return { valid: issues.length === 0, issues: issues.slice(0, 80), payload, counts: backupCounts(payload), signatureStatus };
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
      signature: validation.signatureStatus || "unsigned",
    },
  };
}

function storeSafetyBackup(rootDir, options = {}) {
  const backup = createBackupPackage(rootDir, options);
  const dir = safeTarget(rootDir, "data/backups");
  if (!dir) throw new Error("安全备份目录不安全。");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = safeTarget(rootDir, `data/backups/${backup.filename}`);
  if (!filePath) throw new Error("安全备份路径不安全。");
  const temporary = `${filePath}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(temporary, flags, 0o600);
  try {
    fs.writeFileSync(fd, backup.buffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filePath);
  return {
    filename: backup.filename,
    path: safeRelative(rootDir, filePath),
    generatedAt: backup.manifest.generatedAt,
    compressedBytes: backup.manifest.compressedBytes,
  };
}

function createRestoreTransaction(rootDir) {
  const dataDir = safeTarget(rootDir, "data");
  if (!dataDir) throw new Error("恢复暂存目录不安全。");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!safeTarget(rootDir, "data")) throw new Error("恢复暂存目录包含符号链接。");
  const stagingDir = fs.mkdtempSync(path.join(dataDir, ".wikist-restore-"));
  const originalsDir = path.join(stagingDir, "originals");
  fs.mkdirSync(originalsDir, { recursive: true });
  return { stagingDir, originalsDir, journal: [], seen: new Set() };
}

function rememberOriginal(rootDir, relativePath, transaction) {
  if (!transaction || transaction.seen.has(relativePath)) return;
  const target = safeTarget(rootDir, relativePath);
  if (!target) throw new Error(`备份路径不安全：${relativePath}`);
  const existed = fs.existsSync(target);
  const record = { relativePath, existed, backupPath: "" };
  if (existed) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`恢复目标不是普通文件：${relativePath}`);
    record.backupPath = path.join(transaction.originalsDir, sha256(Buffer.from(relativePath, "utf8")));
    fs.copyFileSync(target, record.backupPath, fs.constants.COPYFILE_EXCL);
  }
  transaction.seen.add(relativePath);
  transaction.journal.push(record);
}

function replaceFile(target, buffer) {
  const temporary = `${target}.${crypto.randomBytes(8).toString("hex")}.restore`;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(temporary, flags, 0o640);
  try {
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function rollbackRestore(rootDir, transaction) {
  const failures = [];
  for (const record of [...transaction.journal].reverse()) {
    try {
      const target = safeTarget(rootDir, record.relativePath);
      if (!target) throw new Error("回滚路径不安全");
      if (!record.existed) {
        fs.rmSync(target, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      replaceFile(target, fs.readFileSync(record.backupPath));
    } catch (error) {
      failures.push(`${record.relativePath}: ${error.message}`);
    }
  }
  return failures;
}

function writeRestoredEntry(rootDir, entry, transaction = null) {
  const target = safeTarget(rootDir, entry.path);
  if (!target) throw new Error(`备份路径不安全：${entry.path || ""}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!safeTarget(rootDir, entry.path)) throw new Error(`备份目录包含符号链接：${entry.path || ""}`);
  const relativePath = normalizeBackupPath(entry.path);
  rememberOriginal(rootDir, relativePath, transaction);
  const encoding = String(entry.encoding || "utf8").toLowerCase();
  let buffer = bufferForEntry({ ...entry, encoding });
  if (normalizeBackupPath(entry.path) === "config/site.config.json" && encoding === "utf8") {
    const incoming = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "")) : {};
    buffer = Buffer.from(`${JSON.stringify(restoreRedactedValue(incoming, current), null, 2)}\n`, "utf8");
  }
  replaceFile(target, buffer);
  return {
    path: relativePath,
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
  let transaction = null;

  try {
    if (!dryRun) {
      safetyBackup = storeSafetyBackup(rootDir, { database: options.database || "data/wikist.sqlite" });
      transaction = createRestoreTransaction(rootDir);
    }

    for (const entry of payload.files || []) {
      const relativePath = normalizeBackupPath(entry.path);
      if (!isRestorableTextPath(relativePath)) {
        skipped.push({ path: relativePath || entry.path || "", reason: "不在可回档目录白名单内" });
        continue;
      }
      if (dryRun) restored.push({ path: relativePath, bytes: Number(entry.bytes || 0), encoding: entry.encoding || "utf8" });
      else restored.push(writeRestoredEntry(rootDir, { ...entry, path: relativePath, encoding: entry.encoding || "utf8" }, transaction));
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
      else restored.push(writeRestoredEntry(rootDir, { ...entry, path: relativePath, encoding: "base64" }, transaction));
    }
  } catch (error) {
    const rollbackFailures = transaction ? rollbackRestore(rootDir, transaction) : [];
    if (rollbackFailures.length > 0) error.message += `；自动回滚存在异常：${rollbackFailures.slice(0, 3).join("；")}`;
    throw error;
  } finally {
    if (transaction?.stagingDir) fs.rmSync(transaction.stagingDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
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
    ...collectSafeConfig(rootDir),
    ...collectPluginManifests(rootDir),
  ];
  const userData = options.includeUserData === false ? [] : [
    ...sqliteBackupFiles(rootDir, database, options.databaseSnapshot || null),
    ...collectBinaryDirectory(rootDir, "data/uploads"),
  ];
  const totalBytes = [...files, ...userData].reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  if (files.length + userData.length > MAX_BACKUP_FILES || totalBytes > MAX_BACKUP_TOTAL_BYTES) {
    throw new Error("站点备份超过当前安全打包上限，请先归档大型附件或使用文件系统快照。 ");
  }
  const packageData = {
    format: "wikist-site-backup",
    version: 2,
    generatedAt,
    generator: "Wikist backup",
    siteId: String(options.siteId || process.env.WIKIST_SITE_ID || ""),
    wikistVersion: String(options.wikistVersion || (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version || "";
      } catch (_error) {
        return "";
      }
    })()),
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
  const signingKey = backupSigningKey(options);
  if (signingKey) {
    if (Buffer.byteLength(signingKey, "utf8") < 32) throw new Error("备份签名密钥至少需要 32 字节。 ");
    packageData.integrity.signatureAlgorithm = "hmac-sha256";
    packageData.integrity.signature = backupSignature(packageData, signingKey);
  }
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

function assertStreamSource(rootDir, filePath, relativePath) {
  const root = fs.realpathSync(rootDir);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`备份源不是普通文件：${relativePath}`);
  const real = fs.realpathSync(filePath);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error(`备份源越出站点目录：${relativePath}`);
  if (stat.size > MAX_BACKUP_ENTRY_BYTES) throw new Error(`备份文件超过单文件上限：${relativePath}`);
  return { real, stat };
}

async function fileDigest(filePath) {
  const digest = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest("hex") };
}

async function streamDescriptor(rootDir, filePath, relativePath = safeRelative(rootDir, filePath)) {
  const normalized = normalizeBackupPath(relativePath);
  if (!normalized) throw new Error(`备份路径无效：${relativePath}`);
  const source = assertStreamSource(rootDir, filePath, normalized);
  const digest = await fileDigest(source.real);
  if (digest.bytes !== source.stat.size) throw new Error(`备份源在读取期间发生变化：${normalized}`);
  return { path: normalized, encoding: "base64", bytes: digest.bytes, sha256: digest.sha256, sourcePath: source.real };
}

function bufferDescriptor(relativePath, buffer) {
  const normalized = normalizeBackupPath(relativePath);
  if (!normalized || !Buffer.isBuffer(buffer) || buffer.length > MAX_BACKUP_ENTRY_BYTES) {
    throw new Error(`备份内存条目无效：${relativePath}`);
  }
  return { path: normalized, encoding: "base64", bytes: buffer.length, sha256: sha256(buffer), buffer };
}

async function collectStreamingEntries(rootDir, options = {}) {
  const files = [];
  const userData = [];
  const addFiles = async (paths) => {
    for (const filePath of paths) files.push(await streamDescriptor(rootDir, filePath));
  };
  await addFiles(walkFiles(path.join(rootDir, "content/pages")).filter((item) => [".md", ".json", ".txt"].includes(path.extname(item).toLowerCase())));
  await addFiles(walkFiles(path.join(rootDir, "content/revisions")).filter((item) => [".md", ".json", ".txt"].includes(path.extname(item).toLowerCase())));
  await addFiles(walkFiles(path.join(rootDir, "content/reviewed")).filter((item) => [".md", ".json", ".txt"].includes(path.extname(item).toLowerCase())));
  await addFiles(walkFiles(path.join(rootDir, "content/deleted")).filter((item) => [".md", ".json", ".txt"].includes(path.extname(item).toLowerCase())));

  for (const filePath of walkFiles(path.join(rootDir, "config")).filter((item) => path.extname(item).toLowerCase() === ".json")) {
    if (path.basename(filePath).toLowerCase() !== "site.config.json") {
      files.push(await streamDescriptor(rootDir, filePath));
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    files.push(bufferDescriptor(safeRelative(rootDir, filePath), Buffer.from(`${JSON.stringify(redactConfigValue(parsed), null, 2)}\n`, "utf8")));
  }
  for (const filePath of walkFiles(path.join(rootDir, "plugins")).filter((item) => path.basename(item).toLowerCase() === "plugin.json")) {
    files.push(await streamDescriptor(rootDir, filePath));
  }

  if (options.includeUserData !== false) {
    if (!options.databaseSnapshotPath) throw new Error("流式全站备份需要脱敏数据库快照。 ");
    userData.push(await streamDescriptor(rootDir, options.databaseSnapshotPath, options.database || "data/wikist.sqlite"));
    for (const filePath of walkFiles(path.join(rootDir, "data/uploads"))) userData.push(await streamDescriptor(rootDir, filePath));
  }
  const totalBytes = [...files, ...userData].reduce((sum, item) => sum + item.bytes, 0);
  if (files.length + userData.length > MAX_BACKUP_FILES || totalBytes > MAX_BACKUP_TOTAL_BYTES) {
    throw new Error("站点备份超过当前安全打包上限，请先归档大型附件或使用文件系统快照。 ");
  }
  return { files, userData, totalBytes };
}

async function writeBase64Entry(writeManifest, entry) {
  const head = JSON.stringify({
    path: entry.path,
    encoding: "base64",
    bytes: entry.bytes,
    sha256: entry.sha256,
  }).replace(/}$/, ',"content":"');
  await writeManifest(head);
  const digest = crypto.createHash("sha256");
  let bytes = 0;
  let carry = Buffer.alloc(0);
  const writeBuffer = async (chunk) => {
    bytes += chunk.length;
    digest.update(chunk);
    const joined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const complete = joined.length - (joined.length % 3);
    if (complete) await writeManifest(joined.subarray(0, complete).toString("base64"));
    carry = complete < joined.length ? joined.subarray(complete) : Buffer.alloc(0);
  };
  if (entry.buffer) {
    await writeBuffer(entry.buffer);
  } else {
    for await (const chunk of fs.createReadStream(entry.sourcePath, { highWaterMark: 64 * 1024 })) await writeBuffer(chunk);
  }
  if (carry.length) await writeManifest(carry.toString("base64"));
  if (bytes !== entry.bytes || digest.digest("hex") !== entry.sha256) throw new Error(`备份源在打包期间发生变化：${entry.path}`);
  await writeManifest('"}');
}

async function createBackupPackageFile(rootDir, options = {}) {
  const generatedAt = new Date().toISOString();
  const database = normalizeBackupPath(options.database || "data/wikist.sqlite");
  const entries = await collectStreamingEntries(rootDir, { ...options, database });
  const stagingDir = safeTarget(rootDir, "data/backups/.staging");
  if (!stagingDir) throw new Error("备份暂存目录不安全。 ");
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const filename = `wikist-backup-${stamp}.json.gz`;
  const filePath = path.join(stagingDir, `${filename}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  const output = fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  const gzip = zlib.createGzip({ level: 9 });
  const completed = new Promise((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    gzip.once("error", reject);
  });
  gzip.pipe(output);
  let rawBytes = 0;
  const write = async (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    rawBytes += buffer.length;
    if (!gzip.write(buffer)) await once(gzip, "drain");
  };
  const manifestHash = crypto.createHash("sha256");
  const writeBoth = async (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    manifestHash.update(buffer);
    await write(buffer);
  };
  const header = {
    format: "wikist-site-backup",
    version: 3,
    generatedAt,
    generator: "Wikist streaming backup",
    siteId: String(options.siteId || process.env.WIKIST_SITE_ID || ""),
    wikistVersion: String(options.wikistVersion || (() => {
      try { return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version || ""; } catch (_error) { return ""; }
    })()),
    database,
    restoreHint: "Wikist 流式 gzip JSON 备份；请通过后台校验后执行恢复。",
    counts: { textFiles: entries.files.length, userDataFiles: entries.userData.length, totalBytes: entries.totalBytes },
  };
  try {
    await write(`${JSON.stringify(header).slice(0, -1)},"files":`);
    manifestHash.update('{"files":');
    await writeBoth("[");
    for (let index = 0; index < entries.files.length; index += 1) {
      if (index) await writeBoth(",");
      await writeBase64Entry(writeBoth, entries.files[index]);
    }
    await writeBoth("]");
    await write(',"userData":');
    manifestHash.update(',"userData":');
    await writeBoth("[");
    for (let index = 0; index < entries.userData.length; index += 1) {
      if (index) await writeBoth(",");
      await writeBase64Entry(writeBoth, entries.userData[index]);
    }
    await writeBoth("]");
    manifestHash.update("}");
    const manifestSha256 = manifestHash.digest("hex");
    const packageData = { ...header, integrity: { algorithm: "sha256", manifestSha256 } };
    const signingKey = backupSigningKey(options);
    if (signingKey) {
      if (Buffer.byteLength(signingKey, "utf8") < 32) throw new Error("备份签名密钥至少需要 32 字节。 ");
      packageData.integrity.signatureAlgorithm = "hmac-sha256";
      packageData.integrity.signature = backupSignature(packageData, signingKey);
    }
    await write(`,"integrity":${JSON.stringify(packageData.integrity)}}`);
    gzip.end();
    await completed;
    const stat = fs.statSync(filePath);
    return {
      filename,
      contentType: "application/gzip",
      filePath,
      manifest: { generatedAt, compressedBytes: stat.size, rawBytes, ...header.counts },
      cleanup() { try { fs.rmSync(filePath, { force: true }); } catch (_error) {} },
    };
  } catch (error) {
    gzip.destroy();
    output.destroy();
    try { await completed; } catch (_streamError) {}
    try { fs.rmSync(filePath, { force: true }); } catch (_cleanupError) {}
    throw error;
  }
}

module.exports = {
  createBackupPackage,
  createBackupPackageFile,
  inspectBackupPackage,
  validateBackupPackage,
  readBackupPackage,
  restoreBackupPackage,
  exerciseBackupPackage,
};
