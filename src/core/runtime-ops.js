const crypto = require("crypto");

const DEFAULT_FIREWALL = Object.freeze({
  enabled: true,
  trustedProxy: false,
  maxBodyBytes: 2 * 1024 * 1024,
  maxEntries: 12000,
  general: { points: 240, windowSeconds: 60, blockSeconds: 60 },
  api: { points: 120, windowSeconds: 60, blockSeconds: 90 },
  write: { points: 48, windowSeconds: 60, blockSeconds: 120 },
  auth: { points: 16, windowSeconds: 60, blockSeconds: 300 },
  install: { points: 8, windowSeconds: 600, blockSeconds: 900 },
});

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(Math.round(number), max)) : fallback;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "1" || value === 1 || value === "on";
}

function cleanFirewallConfig(input = {}, current = DEFAULT_FIREWALL) {
  const source = input && typeof input === "object" ? input : {};
  const base = current && typeof current === "object" ? current : DEFAULT_FIREWALL;
  const bucket = (name, defaults) => {
    const incoming = source[name] && typeof source[name] === "object" ? source[name] : {};
    const previous = base[name] && typeof base[name] === "object" ? base[name] : defaults;
    return {
      points: clampInteger(incoming.points ?? previous.points, defaults.points, 4, 20000),
      windowSeconds: clampInteger(incoming.windowSeconds ?? previous.windowSeconds, defaults.windowSeconds, 1, 86400),
      blockSeconds: clampInteger(incoming.blockSeconds ?? previous.blockSeconds, defaults.blockSeconds, 1, 86400),
    };
  };
  return {
    enabled: cleanBoolean(source.enabled, base.enabled !== false),
    trustedProxy: cleanBoolean(source.trustedProxy, Boolean(base.trustedProxy)),
    maxBodyBytes: clampInteger(source.maxBodyBytes ?? base.maxBodyBytes, DEFAULT_FIREWALL.maxBodyBytes, 16 * 1024, 32 * 1024 * 1024),
    maxEntries: clampInteger(source.maxEntries ?? base.maxEntries, DEFAULT_FIREWALL.maxEntries, 200, 100000),
    general: bucket("general", DEFAULT_FIREWALL.general),
    api: bucket("api", DEFAULT_FIREWALL.api),
    write: bucket("write", DEFAULT_FIREWALL.write),
    auth: bucket("auth", DEFAULT_FIREWALL.auth),
    install: bucket("install", DEFAULT_FIREWALL.install),
  };
}

function normalizeRoute(pathname) {
  const raw = String(pathname || "/").split("?")[0] || "/";
  return raw
    .replace(/\b\d{2,}\b/g, ":id")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, ":id")
    .replace(/\/(?:[A-Za-z0-9_-]{28,})\b/g, "/:token")
    .slice(0, 180);
}

function requestClientAddress(req, trustedProxy = false) {
  if (trustedProxy) {
    const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return String(req?.socket?.remoteAddress || "unknown");
}

function networkPrefix(address) {
  const raw = String(address || "unknown").trim();
  const v4 = raw.match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0];
  if (v4) return v4.split(".").slice(0, 3).join(".") + ".0/24";
  const v6 = raw.replace(/^::ffff:/i, "");
  if (v6.includes(":")) return `${v6.split(":").slice(0, 4).join(":")}::/64`;
  return "unknown";
}

function shortHash(value, secret) {
  return crypto.createHash("sha256").update(`${secret}:${value}`).digest("base64url").slice(0, 18);
}

class RuntimeMetrics {
  constructor(options = {}) {
    this.startedAt = new Date().toISOString();
    this.maxRoutes = clampInteger(options.maxRoutes, 160, 20, 1000);
    this.routes = new Map();
    this.requestTotal = 0;
    this.requestErrors = 0;
    this.search = { count: 0, totalMs: 0, maxMs: 0, fts: 0, fallback: 0, cacheHits: 0 };
    this.plugins = new Map();
    this.firewall = { blocked: 0, bodyRejected: 0, installRejected: 0 };
  }

  observeRequest(input = {}) {
    const route = `${String(input.method || "GET").toUpperCase()} ${normalizeRoute(input.pathname)}`;
    const current = this.routes.get(route) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, status: {} };
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    const status = Math.max(0, Number(input.statusCode) || 0);
    this.requestTotal += 1;
    if (status >= 500) this.requestErrors += 1;
    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    if (status >= 500) current.errors += 1;
    current.status[String(status || 0)] = (current.status[String(status || 0)] || 0) + 1;
    this.routes.set(route, current);
    if (this.routes.size > this.maxRoutes) {
      const first = this.routes.keys().next().value;
      if (first) this.routes.delete(first);
    }
  }

  observeSearch(input = {}) {
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    this.search.count += 1;
    this.search.totalMs += durationMs;
    this.search.maxMs = Math.max(this.search.maxMs, durationMs);
    if (input.cacheHit) this.search.cacheHits += 1;
    if (String(input.engine || "").startsWith("sqlite-fts5")) this.search.fts += 1;
    else this.search.fallback += 1;
  }

  observePluginFailure(input = {}) {
    const pluginId = String(input.pluginId || "unknown").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "unknown";
    const hook = String(input.hook || "runtime").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "runtime";
    const key = `${pluginId}:${hook}`;
    const item = this.plugins.get(key) || { pluginId, hook, failures: 0, lastAt: "" };
    item.failures += 1;
    item.lastAt = new Date().toISOString();
    this.plugins.set(key, item);
  }

  observeFirewall(kind = "blocked") {
    if (Object.prototype.hasOwnProperty.call(this.firewall, kind)) this.firewall[kind] += 1;
  }

  snapshot() {
    const routes = [...this.routes.entries()]
      .map(([route, item]) => ({
        route,
        count: item.count,
        errors: item.errors,
        avgMs: item.count ? Math.round((item.totalMs / item.count) * 10) / 10 : 0,
        maxMs: Math.round(item.maxMs * 10) / 10,
        status: item.status,
      }))
      .sort((a, b) => b.count - a.count || b.avgMs - a.avgMs)
      .slice(0, 20);
    const pluginFailures = [...this.plugins.values()].sort((a, b) => b.failures - a.failures || b.lastAt.localeCompare(a.lastAt)).slice(0, 20);
    return {
      startedAt: this.startedAt,
      requests: {
        total: this.requestTotal,
        errors: this.requestErrors,
        routes,
      },
      cache: {
        searchHits: this.search.cacheHits,
        searchRequests: this.search.count,
        hitRate: this.search.count ? Math.round((this.search.cacheHits / this.search.count) * 1000) / 10 : 0,
      },
      search: {
        count: this.search.count,
        avgMs: this.search.count ? Math.round((this.search.totalMs / this.search.count) * 10) / 10 : 0,
        maxMs: Math.round(this.search.maxMs * 10) / 10,
        fts: this.search.fts,
        fallback: this.search.fallback,
      },
      pluginFailures,
      firewall: { ...this.firewall },
      privacy: "仅保留进程内聚合指标；不记录 IP、账号、查询词、正文或 User-Agent。",
    };
  }
}

class RequestFirewall {
  constructor(configProvider, metrics = null) {
    this.configProvider = typeof configProvider === "function" ? configProvider : () => ({});
    this.metrics = metrics;
    this.secret = crypto.randomBytes(24).toString("base64url");
    this.buckets = new Map();
    this.installTokens = new Map();
  }

  config() {
    return cleanFirewallConfig(this.configProvider()?.security?.firewall || this.configProvider()?.firewall || {}, DEFAULT_FIREWALL);
  }

  scopeFor(req, pathname) {
    const method = String(req?.method || "GET").toUpperCase();
    if (pathname === "/api/install" || pathname.startsWith("/api/install/") || pathname === "/install.html") return "install";
    if (pathname.startsWith("/api/passport/") && /(login|register|forgot|captcha|reset)/.test(pathname)) return "auth";
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return pathname.startsWith("/api/") ? "write" : "general";
    return pathname.startsWith("/api/") ? "api" : "general";
  }

  clientKey(req, config) {
    return shortHash(networkPrefix(requestClientAddress(req, config.trustedProxy)), this.secret);
  }

  prune(config, now = Date.now()) {
    const expiry = now - 24 * 60 * 60 * 1000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAt < expiry && bucket.blockedUntil < now) this.buckets.delete(key);
    }
    for (const [key, ticket] of this.installTokens) {
      if (ticket.expiresAt < now) this.installTokens.delete(key);
    }
    while (this.buckets.size > config.maxEntries) {
      const first = this.buckets.keys().next().value;
      if (!first) break;
      this.buckets.delete(first);
    }
  }

  evaluate(req, pathname) {
    const config = this.config();
    const bodyLength = Number(req?.headers?.["content-length"] || 0);
    if (bodyLength > config.maxBodyBytes) {
      this.metrics?.observeFirewall("bodyRejected");
      return { allowed: false, statusCode: 413, reason: "请求体超过站点防护上限。", retryAfter: 0, scope: "body" };
    }
    if (!config.enabled || ["OPTIONS"].includes(String(req?.method || "").toUpperCase())) return { allowed: true, scope: "disabled" };
    const scope = this.scopeFor(req, pathname);
    const policy = config[scope] || config.general;
    const now = Date.now();
    this.prune(config, now);
    const client = this.clientKey(req, config);
    const key = `${scope}:${client}`;
    const current = this.buckets.get(key) || { count: 0, windowStartedAt: now, blockedUntil: 0, updatedAt: now };
    if (current.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((current.blockedUntil - now) / 1000));
      this.metrics?.observeFirewall("blocked");
      return { allowed: false, statusCode: 429, reason: "请求过于频繁，请稍后再试。", retryAfter, scope };
    }
    if (now - current.windowStartedAt >= policy.windowSeconds * 1000) {
      current.count = 0;
      current.windowStartedAt = now;
    }
    current.count += 1;
    current.updatedAt = now;
    if (current.count > policy.points) {
      current.blockedUntil = now + policy.blockSeconds * 1000;
      this.buckets.set(key, current);
      this.metrics?.observeFirewall("blocked");
      return { allowed: false, statusCode: 429, reason: "请求频率已触发站点防护，请稍后再试。", retryAfter: policy.blockSeconds, scope };
    }
    this.buckets.set(key, current);
    return {
      allowed: true,
      scope,
      limit: policy.points,
      remaining: Math.max(0, policy.points - current.count),
      resetAt: current.windowStartedAt + policy.windowSeconds * 1000,
    };
  }

  applyHeaders(res, result) {
    if (!res || !result) return;
    if (Number.isFinite(result.limit)) {
      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    }
    if (!result.allowed && result.retryAfter) res.setHeader("Retry-After", String(result.retryAfter));
  }

  applySecurityHeaders(res) {
    if (!res) return;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  }

  issueInstallToken(req) {
    const config = this.config();
    const client = this.clientKey(req, config);
    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.installTokens.set(client, { token, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  verifyInstallRequest(req, host) {
    const config = this.config();
    if (!config.enabled) return { ok: true };
    const origin = String(req?.headers?.origin || "").trim();
    if (origin) {
      try {
        if (new URL(origin).host !== String(host || "").replace(/^https?:\/\//, "")) {
          this.metrics?.observeFirewall("installRejected");
          return { ok: false, reason: "安装请求来源不受信任。" };
        }
      } catch (_error) {
        this.metrics?.observeFirewall("installRejected");
        return { ok: false, reason: "安装请求来源无效。" };
      }
    }
    const client = this.clientKey(req, config);
    const ticket = this.installTokens.get(client);
    const token = String(req?.headers?.["x-wikist-install-token"] || "");
    const expected = Buffer.from(ticket?.token || "");
    const actual = Buffer.from(token);
    const tokenMatches = expected.length === actual.length && expected.length > 0 && crypto.timingSafeEqual(expected, actual);
    if (!ticket || ticket.expiresAt < Date.now() || !tokenMatches) {
      this.metrics?.observeFirewall("installRejected");
      return { ok: false, reason: "安装防护校验已失效，请刷新安装页面后重试。" };
    }
    return { ok: true };
  }

  status() {
    const config = this.config();
    return {
      enabled: config.enabled,
      trustedProxy: config.trustedProxy,
      maxBodyBytes: config.maxBodyBytes,
      policies: ["general", "api", "write", "auth", "install"].reduce((result, key) => ({ ...result, [key]: { ...config[key] } }), {}),
      activeBuckets: this.buckets.size,
      installChallenges: this.installTokens.size,
      privacy: "限流键仅使用进程随机盐散列的网段摘要，不持久化原始地址。",
    };
  }
}

module.exports = {
  DEFAULT_FIREWALL,
  RuntimeMetrics,
  RequestFirewall,
  cleanFirewallConfig,
  normalizeRoute,
};
