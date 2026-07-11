const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { createBackupPackage, inspectBackupPackage, restoreBackupPackage } = require("../src/core/backup");

const root = path.join(process.cwd(), "data", "wikist-backup-test");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, "content", "pages"), { recursive: true });
fs.mkdirSync(path.join(root, "content", "reviewed", "home"), { recursive: true });
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "content", "pages", "home.md"), "---\ntitle: Home\n---\nBody\n", "utf8");
fs.writeFileSync(path.join(root, "content", "reviewed", "home", "2026-07-11T08-00-00-000Z.md"), "---\ntitle: Home\n---\nReviewed body\n", "utf8");
fs.writeFileSync(path.join(root, "config", "site.config.json"), JSON.stringify({ name: "Wikist" }), "utf8");
fs.writeFileSync(path.join(root, "data", "wikist.sqlite"), Buffer.from("sqlite-placeholder"));

const backup = createBackupPackage(root, { database: "data/wikist.sqlite" });
const payload = JSON.parse(zlib.gunzipSync(backup.buffer).toString("utf8"));
const packageBase64 = backup.buffer.toString("base64");
const inspected = inspectBackupPackage({ packageBase64 });

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
  restorePage: fs.readFileSync(path.join(root, "content", "pages", "home.md"), "utf8").includes("Body"),
  restoreReviewed: fs.readFileSync(path.join(root, "content", "reviewed", "home", "2026-07-11T08-00-00-000Z.md"), "utf8").includes("Reviewed body"),
  restoreConfig: JSON.parse(fs.readFileSync(path.join(root, "config", "site.config.json"), "utf8")).name === "Wikist",
  restoreUsers: fs.readFileSync(path.join(root, "data", "wikist.sqlite")).toString() === "sqlite-placeholder",
  safetyBackup: restored.safetyBackup?.path && fs.existsSync(path.join(root, restored.safetyBackup.path)),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, manifest: backup.manifest, payload }, null, 2));
  process.exit(1);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, compressedBytes: backup.buffer.length }, null, 2));
