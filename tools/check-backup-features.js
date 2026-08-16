const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DatabaseSync } = require("node:sqlite");
const { createBackupPackage, createBackupPackageFile, inspectBackupPackage, validateBackupPackage, restoreBackupPackage, exerciseBackupPackage } = require("../src/core/backup");

async function main() {
const root = path.join(process.cwd(), "data", "wikist-backup-test");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, "content", "pages"), { recursive: true });
fs.mkdirSync(path.join(root, "content", "reviewed", "home"), { recursive: true });
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "content", "pages", "home.md"), "---\ntitle: Home\n---\nBody\n", "utf8");
fs.writeFileSync(path.join(root, "content", "reviewed", "home", "2026-07-11T08-00-00-000Z.md"), "---\ntitle: Home\n---\nReviewed body\n", "utf8");
fs.writeFileSync(path.join(root, "config", "site.config.json"), JSON.stringify({ name: "Wikist" }), "utf8");
const databasePath = path.join(root, "data", "wikist.sqlite");
const database = new DatabaseSync(databasePath);
database.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, pending_email TEXT, pending_two_factor_secret TEXT);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER);
  CREATE TABLE passport_tokens (id TEXT PRIMARY KEY);
  INSERT INTO users (id, email, pending_email, pending_two_factor_secret) VALUES (1, 'reader@example.test', 'pending@example.test', 'TOTP-SECRET');
  INSERT INTO sessions (id, user_id) VALUES ('session-secret', 1);
  INSERT INTO passport_tokens (id) VALUES ('token-secret');
`);
database.close();
const originalDatabase = fs.readFileSync(databasePath);

const backup = createBackupPackage(root, { database: "data/wikist.sqlite" });
const payload = JSON.parse(zlib.gunzipSync(backup.buffer).toString("utf8"));
const packageBase64 = backup.buffer.toString("base64");
const inspected = inspectBackupPackage({ packageBase64 });
const validated = validateBackupPackage({ packageBase64 });
const tampered = JSON.parse(zlib.gunzipSync(backup.buffer).toString("utf8"));
tampered.files[0].content = "tampered";
const tamperedValidation = validateBackupPackage({ package: tampered });
const drill = exerciseBackupPackage({ packageBase64 }, { database: "data/wikist.sqlite", includeUserData: true });
const streamed = await createBackupPackageFile(root, {
  database: "data/wikist.sqlite",
});
const streamedBuffer = fs.readFileSync(streamed.filePath);
const streamedPayload = JSON.parse(zlib.gunzipSync(streamedBuffer).toString("utf8"));
const streamedValidation = validateBackupPackage(streamedBuffer);
const streamedDatabaseEntry = streamedPayload.userData.find((file) => file.path === "data/wikist.sqlite");
const streamedDatabasePath = path.join(root, "data", "streamed-snapshot.sqlite");
fs.writeFileSync(streamedDatabasePath, Buffer.from(streamedDatabaseEntry?.content || "", "base64"));
const streamedDatabase = new DatabaseSync(streamedDatabasePath, { readOnly: true });
const snapshotUser = streamedDatabase.prepare("SELECT email, pending_email, pending_two_factor_secret FROM users WHERE id = 1").get();
const snapshotSessions = streamedDatabase.prepare("SELECT COUNT(*) AS count FROM sessions").get().count;
const snapshotTokens = streamedDatabase.prepare("SELECT COUNT(*) AS count FROM passport_tokens").get().count;
streamedDatabase.close();
fs.rmSync(streamedDatabasePath, { force: true });
streamed.cleanup();

fs.writeFileSync(path.join(root, "content", "pages", "home.md"), "---\ntitle: Broken\n---\nChanged\n", "utf8");
fs.writeFileSync(path.join(root, "content", "reviewed", "home", "2026-07-11T08-00-00-000Z.md"), "---\ntitle: Broken\n---\nChanged review\n", "utf8");
fs.writeFileSync(path.join(root, "config", "site.config.json"), JSON.stringify({ name: "Changed" }), "utf8");
fs.writeFileSync(path.join(root, "data", "wikist.sqlite"), Buffer.from("changed-db"));
const restored = restoreBackupPackage(root, { packageBase64 }, { database: "data/wikist.sqlite", includeUserData: true });

const checks = {
  format: payload.format === "wikist-site-backup",
  pages: payload.files.some((file) => file.path === "content/pages/home.md" && file.content.includes("Body")),
  reviewed: payload.files.some((file) => file.path === "content/reviewed/home/2026-07-11T08-00-00-000Z.md" && file.content.includes("Reviewed body")),
  config: payload.files.some((file) => file.path === "config/site.config.json"),
  users: payload.userData.some((file) => file.path === "data/wikist.sqlite" && file.encoding === "base64"),
  manifest: backup.manifest.textFiles >= 2 && backup.manifest.userDataFiles === 1,
  inspect: inspected.counts.pages === 1 && inspected.counts.reviewed === 1 && inspected.counts.config === 1 && inspected.counts.userDataFiles === 1,
  checksums: validated.valid && inspected.validation.valid && !tamperedValidation.valid,
  restoreDrill: drill.ok && drill.restored >= 4 && drill.validation.valid,
  restorePage: fs.readFileSync(path.join(root, "content", "pages", "home.md"), "utf8").includes("Body"),
  restoreReviewed: fs.readFileSync(path.join(root, "content", "reviewed", "home", "2026-07-11T08-00-00-000Z.md"), "utf8").includes("Reviewed body"),
  restoreConfig: JSON.parse(fs.readFileSync(path.join(root, "config", "site.config.json"), "utf8")).name === "Wikist",
  restoreUsers: fs.readFileSync(path.join(root, "data", "wikist.sqlite")).equals(originalDatabase),
  safetyBackup: restored.safetyBackup?.path && fs.existsSync(path.join(root, restored.safetyBackup.path)),
  streamingBackup: streamedPayload.version === 3
    && streamedValidation.valid
    && Buffer.from(streamedPayload.files.find((file) => file.path === "content/pages/home.md")?.content || "", "base64").toString("utf8").includes("Body")
    && !fs.existsSync(streamed.filePath),
  streamingSnapshotSanitized: snapshotUser.email === "reader@example.test"
    && snapshotUser.pending_email === ""
    && snapshotUser.pending_two_factor_secret === ""
    && snapshotSessions === 0
    && snapshotTokens === 0
    && !fs.readdirSync(path.join(root, "data")).some((name) => name.startsWith(".wikist-backup-")),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, manifest: backup.manifest, payload }, null, 2));
  process.exit(1);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, compressedBytes: backup.buffer.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
