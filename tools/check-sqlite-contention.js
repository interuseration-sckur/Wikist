#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wikist-contention-"));
const databasePath = path.join(temporary, "contention.sqlite");
const phpCandidates = [process.env.WIKIST_PHP, path.join(root, ".runtime", "php", "php.exe"), process.platform === "win32" ? "php.exe" : "php"].filter(Boolean);
const php = phpCandidates.find((candidate) => {
  const result = childProcess.spawnSync(candidate, ["-r", "exit(extension_loaded('pdo_sqlite')?0:1);"], { windowsHide: true });
  return !result.error && result.status === 0;
});
if (!php) throw new Error("SQLite contention check requires PHP with pdo_sqlite.");

async function main() {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE contention_members(worker_id INTEGER PRIMARY KEY, value INTEGER NOT NULL, updated_at TEXT NOT NULL);");
  database.close();
  const workers = 6;
  const loops = 80;
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: workers }, (_, worker) => new Promise((resolve, reject) => {
    const processHandle = childProcess.spawn(php, [path.join(root, "webman-backend", "tools", "contention-worker.php"), databasePath, String(worker + 1), String(loops)], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
    processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
    processHandle.once("error", reject);
    processHandle.once("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || stdout || `worker exited ${code}`)));
  })));
  const verified = new DatabaseSync(databasePath, { readOnly: true });
  const total = Number(verified.prepare("SELECT SUM(value) AS total FROM contention_members").get().total);
  const integrity = String(verified.prepare("PRAGMA quick_check").get().quick_check);
  verified.close();
  assert.equal(total, workers * loops);
  assert.equal(integrity, "ok");

  const messaging = fs.readFileSync(path.join(root, "webman-backend", "app", "service", "MessagingService.php"), "utf8");
  const permissions = fs.readFileSync(path.join(root, "webman-backend", "app", "service", "MessagingPermissionService.php"), "utf8");
  const achievements = fs.readFileSync(path.join(root, "webman-backend", "app", "service", "AchievementService.php"), "utf8");
  const bootstrap = messaging.match(/public function bootstrap\([\s\S]*?\n    }\n\n    public function conversations/)?.[0] || "";
  assert.ok(!bootstrap.includes("synchronize("), "Messaging bootstrap must remain read-only.");
  const access = permissions.match(/public function assertConversationAccess\([\s\S]*?\n    }\n\n    public function assertCanSend/)?.[0] || "";
  assert.ok(!/syncOrganizationMember|upsertMember/.test(access), "Permission reads must not repair memberships.");
  const publicSummary = achievements.match(/public function publicSummary\([\s\S]*?\n    }\n\n    private function stats/)?.[0] || "";
  assert.ok(!/updateOrInsert|->sync\(/.test(publicSummary), "Achievement summaries must remain read-only.");
  console.log(JSON.stringify({ ok: true, workers, writes: total, busyRetries: results.reduce((sum, item) => sum + item.busyRetries, 0), durationMs: Date.now() - started, integrity }));
}

main().finally(() => fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
