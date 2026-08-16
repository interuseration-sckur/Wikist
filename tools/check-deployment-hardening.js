#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const project = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wikist-deployment-"));
let passed = 0;

function check(name, callback) {
  callback();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

function write(relative, content) {
  const target = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

try {
  write("config/site.config.json", `${JSON.stringify({ publicUrl: "http://127.0.0.1:8899", mail: { baseUrl: "http://127.0.0.1:8899" } }, null, 2)}\n`);
  write("webman-backend/.env", "APP_URL=http://127.0.0.1:8899\nWIKIST_PUBLIC_URL=http://127.0.0.1:8899\nTRUSTED_ORIGINS=http://127.0.0.1:8899\nSESSION_SECURE=false\nCENTRIFUGO_PUBLIC_URL=ws://127.0.0.1:8902/connection/websocket\nLEGACY_NODE_URL=http://127.0.0.1:8900\nCENTRIFUGO_API_URL=http://127.0.0.1:8902/api\n");
  write("etc/wikist/wikist.env", "APP_URL=http://127.0.0.1:8899\nWIKIST_PUBLIC_URL=http://127.0.0.1:8899\nTRUSTED_ORIGINS=http://127.0.0.1:8899\nSESSION_SECURE=false\nCENTRIFUGO_PUBLIC_URL=ws://127.0.0.1:8902/connection/websocket\n");
  write("data/wikist-stack.json", `${JSON.stringify({ version: 2, centrifugo: { enabled: true, port: 8902, publicUrl: "ws://127.0.0.1:8902/connection/websocket" } }, null, 2)}\n`);
  write("data/centrifugo/config.json", `${JSON.stringify({ client: { allowed_origins: ["http://127.0.0.1:8899"] } }, null, 2)}\n`);
  write("data/wikist.sqlite", "database-sentinel");

  const result = childProcess.spawnSync(process.execPath, [path.join(project, "tools", "migrate-server.js"), "--public-url=https://new.example", "--mode=advanced", "--yes"], {
    env: { ...process.env, WIKIST_MIGRATION_ROOT: fixture }, encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  const site = JSON.parse(fs.readFileSync(path.join(fixture, "config/site.config.json"), "utf8"));
  const env = fs.readFileSync(path.join(fixture, "webman-backend/.env"), "utf8");
  const stack = JSON.parse(fs.readFileSync(path.join(fixture, "data/wikist-stack.json"), "utf8"));
  const systemEnv = fs.readFileSync(path.join(fixture, "etc/wikist/wikist.env"), "utf8");

  check("canonical public URL reaches site and mail", () => {
    assert.equal(site.publicUrl, "https://new.example");
    assert.equal(site.mail.baseUrl, "https://new.example");
    assert.equal(site.deploymentMode, "advanced");
  });
  check("environment derives browser-facing origins", () => {
    assert.match(env, /^WIKIST_PUBLIC_URL=https:\/\/new\.example$/m);
    assert.match(env, /^APP_URL=https:\/\/new\.example$/m);
    assert.match(env, /^CENTRIFUGO_PUBLIC_URL=wss:\/\/new\.example\/connection\/websocket$/m);
    assert.match(env, /^WIKIST_DB_PROFILE=sqlite-single-host$/m);
    assert.match(env, /^WEBMAN_WORKERS=1$/m);
  });
  check("internal services remain loopback", () => {
    assert.match(env, /^LEGACY_NODE_URL=http:\/\/127\.0\.0\.1:8900$/m);
    assert.match(env, /^CENTRIFUGO_API_URL=http:\/\/127\.0\.0\.1:8902\/api$/m);
  });
  check("systemd environment and secure cookie follow the canonical URL", () => {
    assert.match(systemEnv, /^APP_URL=https:\/\/new\.example$/m);
    assert.match(systemEnv, /^SESSION_SECURE=true$/m);
    assert.match(systemEnv, /^CENTRIFUGO_PUBLIC_URL=wss:\/\/new\.example\/connection\/websocket$/m);
  });
  check("runtime stack contains no browser public URL", () => {
    assert.equal(stack.version, 3);
    assert.equal(stack.centrifugo.publicUrl, undefined);
  });
  check("migration creates rollback material and a clean report", () => {
    assert.equal(report.ok, true);
    assert.ok(report.backup.files.length >= 3);
    assert.ok(fs.existsSync(path.join(fixture, report.backup.directory)));
  });
  check("migration preserves application data and removes public localhost values", () => {
    assert.equal(fs.readFileSync(path.join(fixture, "data/wikist.sqlite"), "utf8"), "database-sentinel");
    for (const content of [JSON.stringify(site), env, systemEnv, JSON.stringify(stack)]) {
      assert.doesNotMatch(content, /(?:APP_URL|WIKIST_PUBLIC_URL|TRUSTED_ORIGINS|CENTRIFUGO_PUBLIC_URL)[^\n]*127\.0\.0\.1/);
    }
  });

  const setupSource = fs.readFileSync(path.join(project, "tools", "setup-community-stack.js"), "utf8");
  check("Centrifugo download is pinned and checksum verified", () => {
    assert.match(setupSource, /CENTRIFUGO_VERSION = "6\.8\.1"/);
    assert.match(setupSource, /CHECKSUM_MANIFEST_SHA256 = "[a-f0-9]{64}"/);
    assert.match(setupSource, /Centrifugo archive verification failed/);
  });
  check("Centrifugo exposes an internal health probe", () => {
    assert.match(setupSource, /health: \{ enabled: true \}/);
  });
  const serverSource = fs.readFileSync(path.join(project, "src", "server", "app.js"), "utf8");
  const appSource = fs.readFileSync(path.join(project, "public", "assets", "app.js"), "utf8");
  check("admin deployment changes require an explicit migration and restart", () => {
    assert.match(serverSource, /restartRequired/);
    assert.match(serverSource, /npm run migrate:server/);
    assert.match(appSource, /公开地址或部署模式已改变/);
  });
  const updaterSource = fs.readFileSync(path.join(project, "tools", "update.js"), "utf8");
  const installerSource = fs.readFileSync(path.join(project, "public", "assets", "install.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(project, "tools", "install-service.js"), "utf8");
  check("update precheck blocks URL drift before stopping services", () => {
    assert.ok(updaterSource.indexOf("deploymentPrecheck(options)") < updaterSource.indexOf('service("stop", options)'));
    assert.match(updaterSource, /deployment URLs disagree/);
  });
  check("installer confirms a public origin different from the browser origin", () => {
    assert.match(installerSource, /origin !== window\.location\.origin/);
    assert.match(installerSource, /confirmation\.required = differs/);
  });
  check("Ubuntu generator keeps compatibility and Centrifugo API ports internal", () => {
    assert.match(serviceSource, /LEGACY_NODE_URL=http:\/\/127\.0\.0\.1:8900/);
    assert.match(serviceSource, /CENTRIFUGO_API_URL=http:\/\/127\.0\.0\.1:8902\/api/);
    assert.match(serviceSource, /proxy_pass http:\/\/127\.0\.0\.1:8899/);
  });
  check("the updater performs a complete preflight before stopping writers", () => {
    assert.match(updaterSource, /preflight-only/);
    assert.match(updaterSource, /doctor\.php/);
    assert.match(updaterSource, /check-platform-reqs/);
    assert.match(updaterSource, /insufficient free disk space/);
  });
  check("the updater can hand off to a newly fetched updater", () => {
    assert.match(updaterSource, /UPDATER_PROTOCOL_VERSION = 2/);
    assert.match(updaterSource, /resume-/);
    assert.match(updaterSource, /reexecuteUpdatedUpdater/);
  });
  const backupSource = fs.readFileSync(path.join(project, "src", "core", "backup.js"), "utf8");
  check("pre-update streaming backups create and clean a redacted database snapshot", () => {
    assert.match(backupSource, /createRedactedDatabaseSnapshotFile/);
    assert.match(backupSource, /ownedSnapshot = createRedactedDatabaseSnapshotFile/);
    assert.match(backupSource, /ownedSnapshot\?\.cleanup\(\)/);
    assert.match(updaterSource, /service restarted automatically because no code was fetched or changed/);
  });
  check("the generated systemd unit uses a dedicated account and narrow writable paths", () => {
    assert.match(serviceSource, /User=\$\{options\.user\}/);
    assert.match(serviceSource, /ProtectSystem=strict/);
    assert.match(serviceSource, /NoNewPrivileges=true/);
    assert.match(serviceSource, /ReadWritePaths=/);
    assert.doesNotMatch(serviceSource, /chmod[^\n]*777/);
  });
  check("the service installer repairs ownership of generated runtime secrets", () => {
    assert.match(serviceSource, /serviceOwnedSecrets/);
    assert.match(serviceSource, /run\("chown", \["-R", "-h"/);
    assert.match(serviceSource, /run\("chmod", \["-R", "u\+rwX"/);
    assert.match(serviceSource, /webman-backend", "\.env/);
    assert.match(serviceSource, /centrifugo", "config\.json/);
    assert.match(serviceSource, /run\("chmod", \["0600", filePath\]\)/);
  });
  const hybridSource = fs.readFileSync(path.join(project, "tools", "start-hybrid.js"), "utf8");
  check("the hybrid launcher survives stale local env ownership under systemd", () => {
    assert.match(hybridSource, /serviceEnvironmentActive/);
    assert.match(hybridSource, /managedServiceEnvironment/);
    assert.match(hybridSource, /process\.env\.INVOCATION_ID/);
    assert.match(hybridSource, /if \(managedServiceEnvironment\) return/);
    assert.match(hybridSource, /skipped unreadable local environment file/);
    assert.match(hybridSource, /error\?\.code === "EACCES"/);
  });
  const ubuntuInstaller = fs.readFileSync(path.join(project, "tools", "install-ubuntu.sh"), "utf8");
  check("Ubuntu installation pins runtimes and verifies downloads", () => {
    assert.match(ubuntuInstaller, /NODE_VERSION="22\.18\.0"/);
    assert.match(ubuntuInstaller, /php8\.4-cli/);
    assert.match(ubuntuInstaller, /composer-setup\.php/);
    assert.match(ubuntuInstaller, /sha(256|384)sum/);
    assert.doesNotMatch(ubuntuInstaller, /chmod[^\n]*777/);
  });
  check("offline Centrifugo installation remains available", () => {
    assert.match(setupSource, /--centrifugo=/);
    assert.ok(setupSource.includes('spawnSync(resolved, ["version"]'));
    assert.match(ubuntuInstaller, /--no-realtime/);
  });
  const productionDoctor = fs.readFileSync(path.join(project, "tools", "production-doctor.js"), "utf8");
  const installGuide = fs.readFileSync(path.join(project, "docs", "INSTALL.md"), "utf8");
  const troubleshootingGuide = fs.readFileSync(path.join(project, "docs", "PRODUCTION_TROUBLESHOOTING.md"), "utf8");
  check("production doctor checks the actual service account and both WebSocket paths", () => {
    assert.match(productionDoctor, /Production diagnostics must run as root/);
    assert.match(productionDoctor, /runuser/);
    assert.match(productionDoctor, /realtime\.websocket_local/);
    assert.match(productionDoctor, /realtime\.websocket_public/);
    assert.match(productionDoctor, /realtime\.health_endpoint/);
    assert.match(productionDoctor, /nginx\.websocket_route/);
  });
  check("production repair snapshots configuration and rolls back invalid Nginx changes", () => {
    assert.match(productionDoctor, /data", "production-repairs/);
    assert.match(productionDoctor, /nginx -t failed and the snippet was rolled back/);
    assert.match(productionDoctor, /\/www\/server\/nginx\/sbin\/nginx/);
    assert.match(productionDoctor, /command\(binary, \["-s", "reload"\]\)/);
    assert.match(productionDoctor, /config\.health = \{ enabled: true \}/);
    assert.doesNotMatch(productionDoctor, /chmod[^\n]*777/);
  });
  check("deployment documentation covers the recovered permission and proxy failures", () => {
    assert.match(installGuide, /doctor:production/);
    assert.match(installGuide, /location = \/connection\/websocket/);
    assert.match(troubleshootingGuide, /EACCES/);
    assert.match(troubleshootingGuide, /EROFS/);
    assert.match(troubleshootingGuide, /X-Wikist-Backend: webman/);
    assert.match(troubleshootingGuide, /101 Switching Protocols/);
  });
  console.log(`Deployment hardening checks passed: ${passed}`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
