#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const path = require("path");
const { buildRuntimeEnvironment } = require("./runtime-env");

const root = path.resolve(__dirname, "..");
const command = process.argv[2] || "show";

function phpBinary() {
  const candidates = [
    process.env.WIKIST_PHP,
    process.platform === "win32" ? path.join(root, ".runtime", "php", "php.exe") : "",
    process.platform === "win32" ? "php.exe" : "php",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    const probe = childProcess.spawnSync(candidate, ["-r", "exit(PHP_VERSION_ID >= 80401 ? 0 : 1);"], { windowsHide: true });
    return !probe.error && probe.status === 0;
  }) || "";
}

function effective() {
  const runtime = buildRuntimeEnvironment(root);
  const { site, stack, env } = runtime;
  const centrifugo = stack.centrifugo || {};
  const publicUrl = env.WIKIST_PUBLIC_URL;
  const realtime = env.CENTRIFUGO_PUBLIC_URL;
  return {
    site: {
      name: String(site.name || "Wikist"),
      publicUrl,
      deploymentMode: String(site.deploymentMode || "development"),
    },
    database: {
      driver: String(env.WIKIST_DB_DRIVER || "sqlite"),
      profile: String(env.WIKIST_DB_PROFILE || "sqlite-single-host"),
      path: String(env.WIKIST_DB_DATABASE || site.passport?.database || "data/wikist.sqlite"),
      workers: Number(env.WEBMAN_WORKERS || 1),
    },
    listeners: {
      webman: `${env.WEBMAN_HOST || "127.0.0.1"}:${env.WEBMAN_PORT || 8899}`,
      nodeCompatibility: String(env.LEGACY_NODE_URL || "http://127.0.0.1:8900"),
      centrifugoApi: String(env.CENTRIFUGO_API_URL || `http://${centrifugo.host || "127.0.0.1"}:${centrifugo.port || 8902}/api`),
      realtimePublicUrl: realtime,
    },
    security: {
      trustedOrigins: String(env.TRUSTED_ORIGINS || publicUrl).split(",").map((item) => item.trim()).filter(Boolean),
      secureCookie: /^(?:1|true|yes|on)$/i.test(String(env.SESSION_SECURE || publicUrl.startsWith("https://"))),
      appSecret: env.APP_SECRET ? "[configured]" : "[missing]",
      legacyNodeToken: env.LEGACY_NODE_TOKEN ? "[configured]" : "[missing]",
      realtimeEnabled: /^(?:1|true|yes|on)$/i.test(String(env.CENTRIFUGO_ENABLED)),
      centrifugoApiKey: env.CENTRIFUGO_API_KEY || centrifugo.apiKey ? "[configured]" : "[missing]",
      centrifugoTokenSecret: env.CENTRIFUGO_TOKEN_HMAC_SECRET || centrifugo.tokenHmacSecret ? "[configured]" : "[missing]",
    },
  };
}

if (command === "show") {
  console.log(JSON.stringify(effective(), null, 2));
} else if (command === "validate") {
  const php = phpBinary();
  if (!php) throw new Error("PHP 8.4.1 or newer is required to validate Wikist configuration.");
  const runtime = buildRuntimeEnvironment(root);
  const result = childProcess.spawnSync(php, [path.join(root, "webman-backend", "tools", "doctor.php"), "--urls"], {
    cwd: path.join(root, "webman-backend"),
    env: runtime.env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
} else {
  throw new Error("Usage: node tools/config.js [show|validate]");
}
