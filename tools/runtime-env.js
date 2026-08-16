"use strict";

const fs = require("fs");
const path = require("path");
const { loadConfig } = require("../src/core/config");

function readEnvironmentFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  return /^(?:1|true|yes|on)$/i.test(String(value));
}

function canonicalPublicUrl(value) {
  const candidate = String(value || "http://127.0.0.1:8899").trim().replace(/\/+$/, "");
  const parsed = new URL(candidate);
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Wikist public URL must be an absolute HTTP(S) origin without credentials, query, or fragment.");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

function resolvedRealtimePublicUrl(configured, publicUrl, centrifugo) {
  const host = String(centrifugo.host || "127.0.0.1");
  const port = Number(centrifugo.port || 8902);
  const fallback = `ws://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/connection/websocket`;
  const candidate = String(configured || "").trim();
  if (!candidate) return fallback;
  try {
    const site = new URL(publicUrl);
    const realtime = new URL(candidate);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    const sitePort = Number(site.port || (site.protocol === "https:" ? 443 : 80));
    const realtimePort = Number(realtime.port || (realtime.protocol === "wss:" ? 443 : 80));
    if (localHosts.has(site.hostname.toLowerCase())
      && localHosts.has(realtime.hostname.toLowerCase())
      && realtimePort === sitePort) return fallback;
    return candidate;
  } catch (_error) {
    return fallback;
  }
}

function buildRuntimeEnvironment(root, inherited = process.env) {
  const site = loadConfig(root);
  const stack = readJson(path.join(root, "data", "wikist-stack.json"));
  const fileValues = readEnvironmentFile(path.join(root, "webman-backend", ".env"));
  const source = { ...fileValues, ...inherited };
  const publicUrl = canonicalPublicUrl(source.WIKIST_PUBLIC_URL || site.publicUrl || source.APP_URL || "http://127.0.0.1:8899");
  const centrifugo = stack.centrifugo || {};
  const realtimeEnabled = enabled(source.CENTRIFUGO_ENABLED, centrifugo.enabled === true);
  const realtimePublicUrl = resolvedRealtimePublicUrl(source.CENTRIFUGO_PUBLIC_URL, publicUrl, centrifugo);
  const centrifugoApiUrl = source.CENTRIFUGO_API_URL
    || `http://${centrifugo.host || "127.0.0.1"}:${centrifugo.port || 8902}/api`;
  const configuredDatabase = source.WIKIST_DB_DATABASE || site.passport?.database || path.join(root, "data", "wikist.sqlite");
  const database = path.isAbsolute(configuredDatabase)
    ? configuredDatabase
    : path.resolve(root, configuredDatabase);

  return {
    site,
    stack,
    env: {
      ...source,
      APP_URL: publicUrl,
      WIKIST_PUBLIC_URL: publicUrl,
      TRUSTED_ORIGINS: source.TRUSTED_ORIGINS || publicUrl,
      SESSION_SECURE: source.SESSION_SECURE || String(publicUrl.startsWith("https://")),
      WIKIST_DB_DRIVER: source.WIKIST_DB_DRIVER || "sqlite",
      WIKIST_DB_PROFILE: source.WIKIST_DB_PROFILE || "sqlite-single-host",
      WIKIST_DB_DATABASE: database,
      WEBMAN_HOST: source.WEBMAN_HOST || "127.0.0.1",
      WEBMAN_PORT: source.WEBMAN_PORT || "8899",
      WEBMAN_WORKERS: source.WEBMAN_WORKERS || "1",
      LEGACY_NODE_URL: source.LEGACY_NODE_URL || "http://127.0.0.1:8900",
      CENTRIFUGO_ENABLED: String(realtimeEnabled),
      CENTRIFUGO_PUBLIC_URL: realtimePublicUrl,
      CENTRIFUGO_API_URL: centrifugoApiUrl,
      CENTRIFUGO_API_KEY: source.CENTRIFUGO_API_KEY || centrifugo.apiKey || "",
      CENTRIFUGO_TOKEN_HMAC_SECRET: source.CENTRIFUGO_TOKEN_HMAC_SECRET || centrifugo.tokenHmacSecret || "",
    },
  };
}

module.exports = { buildRuntimeEnvironment, canonicalPublicUrl, enabled, readEnvironmentFile };
