const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");
const { PersistentFtsIndex } = require("../src/core/fts-index");
const { RuntimeMetrics, RequestFirewall } = require("../src/core/runtime-ops");
const { cleanManifest, pluginRuntimeStatus, validatePluginConfiguration } = require("../src/core/plugin-registry");

const root = path.join(process.cwd(), "data", "wikist-runtime-reliability-test");
fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
fs.mkdirSync(root, { recursive: true });

const page = {
  slug: "runtime-test",
  title: "Runtime Test",
  summary: "SQLite reliability test page.",
  body: "A durable index should recover after a controlled failure.",
  categories: ["Testing"],
  quality: "A",
  difficulty: "basic",
  author: "tester",
  updatedAt: new Date().toISOString(),
};

let passport;
try {
  passport = new PassportStore(root, { database: "data/runtime.sqlite", sqliteBusyTimeoutMs: 9000 });
  const dbHealth = passport.databaseHealth();
  const snapshot = passport.createDatabaseSnapshot();
  assert.strictEqual(snapshot.subarray(0, 16).toString("utf8"), "SQLite format 3\u0000", "snapshot must be a consistent SQLite database");
  assert.strictEqual(dbHealth.journalMode, "wal", "SQLite must run in WAL mode");
  assert(dbHealth.busyTimeoutMs >= 8000, "SQLite busy timeout must protect concurrent writes");
  assert(dbHealth.integrityOk, "SQLite quick_check must pass");

  const persistent = new PersistentFtsIndex(passport, () => ({ plugins: { advancedSearch: { enabled: true, fts5: true } } }));
  persistent.rebuild([page]);
  persistent.db.exec("DROP TABLE wikist_page_fts");
  const failedStatus = persistent.syncPage(page);
  assert(failedStatus.recoveryNeeded, "index failure must be visible without breaking page writes");
  const recovered = persistent.recover([page]);
  assert(recovered.ready && !recovered.recoveryNeeded, "manual recovery must recreate the persistent FTS index");

  const metrics = new RuntimeMetrics();
  metrics.observeRequest({ method: "GET", pathname: "/api/page/very-private-token-123456789012345678901234", statusCode: 200, durationMs: 12 });
  metrics.observeSearch({ durationMs: 7, engine: "sqlite-fts5", cacheHit: true });
  metrics.observePluginFailure({ pluginId: "samplePlugin", hook: "client.module" });
  const firewallConfig = () => ({ security: { firewall: { general: { points: 2, windowSeconds: 60, blockSeconds: 30 }, api: { points: 2, windowSeconds: 60, blockSeconds: 30 }, write: { points: 2, windowSeconds: 60, blockSeconds: 30 }, auth: { points: 2, windowSeconds: 60, blockSeconds: 30 }, install: { points: 2, windowSeconds: 60, blockSeconds: 30 } } } });
  const firewall = new RequestFirewall(firewallConfig, metrics);
  const request = { method: "GET", headers: {}, socket: { remoteAddress: "203.0.113.42" } };
  assert(firewall.evaluate(request, "/api/search").allowed, "first request should pass");
  assert(firewall.evaluate(request, "/api/search").allowed, "second request should pass");
  assert(firewall.evaluate(request, "/api/search").allowed, "third request should pass");
  assert(firewall.evaluate(request, "/api/search").allowed, "fourth request should pass");
  assert(!firewall.evaluate(request, "/api/search").allowed, "fifth request should be rate limited");
  const ticket = firewall.issueInstallToken(request);
  const installRequest = { method: "POST", headers: { "x-wikist-install-token": ticket.token }, socket: request.socket };
  assert(firewall.verifyInstallRequest(installRequest, "localhost:8899").ok, "installer challenge must validate");
  assert(!JSON.stringify(metrics.snapshot()).includes("203.0.113.42"), "metrics must not retain client address data");

  const manifest = cleanManifest({
    id: "schemaDemo",
    configVersion: 2,
    configSchema: { type: "object", properties: { enabled: { type: "boolean", default: true }, interval: { type: "integer", minimum: 1, maximum: 30, default: 5 } }, additionalProperties: false },
    configMigrations: [{ from: 1, to: 2, rename: { oldInterval: "interval" } }],
    entry: "serverModule",
    serverModule: "server.js",
  }, "schema-demo");
  const validated = validatePluginConfiguration(manifest, { enabled: false, oldInterval: 9 });
  assert(validated.valid && validated.value.interval === 9 && validated.value.__wikistConfigVersion === 2, "declarative plugin migration and schema validation must apply");
  assert.strictEqual(pluginRuntimeStatus(manifest).executable, false, "declared server modules must remain non-executable");

  console.log(JSON.stringify({ ok: true, checks: 14, wal: dbHealth.journalMode, fts: recovered.documents, metrics: metrics.snapshot().search.count }, null, 2));
} finally {
  try { passport?.closeDatabase(); } catch (_error) {}
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
}
