const fs = require("fs");
const http = require("http");
const path = require("path");
const { createBackupPackage, inspectBackupPackage, restoreBackupPackage } = require("../core/backup");
const { normalizeArxiv, normalizeCitationId, normalizeDoi, normalizeUrl } = require("../core/citations");
const { hasSiteConfig, loadConfig, uninstallSiteConfig, writeInitialConfig } = require("../core/config");
const { readJsonBody, safeJoin, sendJson, sendText, serveStatic } = require("../core/http");
const { fetchWikipediaPage, parseWikistImport } = require("../core/import-export");
const { publicMailSettings, sendWikistMail, siteBaseUrl } = require("../core/mailer");
const { renderMarkdown } = require("../core/markdown");
const { pluginCatalog, pluginSettings, syncVendorPlugin } = require("../core/plugin-registry");
const { PageStore } = require("../core/page-store");
const { PassportStore, clearSessionCookie, sessionCookie } = require("../core/passport-store");
const { SearchIndex } = require("../core/search-index");
const { decodePathPart, normalizeSlug } = require("../core/slug");

function isEditAllowed(req, config, session) {
  if (!config.editing?.open) return false;
  if (config.editing?.requireLogin && !session?.user) return false;

  const tokenEnv = config.editing?.requireTokenEnv;
  const expected = tokenEnv ? process.env[tokenEnv] : "";
  if (!expected) return true;

  const header = req.headers.authorization || "";
  return header === `Bearer ${expected}` || req.headers["x-wikist-token"] === expected;
}

function stripPrefix(pathname, prefix) {
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

function setCookieHeader(res, value) {
  if (!value) return;
  const existing = res.getHeader("set-cookie");
  if (!existing) res.setHeader("set-cookie", value);
  else if (Array.isArray(existing)) res.setHeader("set-cookie", [...existing, value]);
  else res.setHeader("set-cookie", [existing, value]);
}

function userPayloadWithHtml(profile) {
  if (!profile) return null;
  const rendered = renderMarkdown(profile.pageMd || "");
  return { ...profile, pageHtml: rendered.html, toc: rendered.toc };
}

function commentPayload(comment) {
  const rendered = renderMarkdown(comment.contentMd || "");
  return { ...comment, contentHtml: rendered.html, toc: rendered.toc };
}

function passportSecurityPayload(config) {
  return {
    requireEmailVerification: config.passport?.requireEmailVerification === true,
    emailVerificationTTLSeconds: Math.max(60, Number(config.passport?.emailVerificationTTLSeconds) || 1800),
    passwordResetTTLSeconds: Math.max(60, Number(config.passport?.passwordResetTTLSeconds) || 1200),
    twoFactorIssuer: String(config.passport?.twoFactorIssuer || config.name || "Wikist").slice(0, 80),
  };
}

function authMailHtml(title, body, url) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.7;color:#15211d"><h2>${title}</h2><p>${body}</p><p><a href="${url}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0f8a6c;color:#fff;text-decoration:none;font-weight:700">打开 Wikist 验证链接</a></p><p style="color:#6b7b75;font-size:13px">如果按钮无法打开，请复制链接：<br>${url}</p></div>`;
}

async function sendEmailVerification(config, req, ticket) {
  const url = `${siteBaseUrl(config, req)}/#/verify-email/${encodeURIComponent(ticket.token)}`;
  return sendWikistMail(config, {
    to: ticket.user.email,
    subject: `${config.name || "Wikist"} 邮箱验证`,
    text: `请打开以下链接完成 Wikist 邮箱验证：\n${url}\n\n如果不是你本人操作，请忽略这封邮件。`,
    html: authMailHtml("验证你的 Wikist 邮箱", "完成验证后，你可以更安全地找回密码并保护贡献身份。", url),
  });
}

async function sendPasswordReset(config, req, ticket) {
  const url = `${siteBaseUrl(config, req)}/#/reset-password/${encodeURIComponent(ticket.token)}`;
  return sendWikistMail(config, {
    to: ticket.user.email,
    subject: `${config.name || "Wikist"} 找回密码`,
    text: `请打开以下链接重置 Wikist 密码：\n${url}\n\n如果不是你本人操作，请忽略这封邮件。`,
    html: authMailHtml("重置 Wikist 密码", "链接短时间内有效。重置成功后，旧会话会自动失效。", url),
  });
}

function slugFromNestedPath(pathname, prefix, suffix = "") {
  let value = stripPrefix(pathname, prefix);
  if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length);
  return normalizeSlug(decodePathPart(value));
}

function readPagination(url, defaultLimit = 12, maxLimit = 100) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || defaultLimit, maxLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function requireDashboard(passport, session) {
  if (!passport) {
    const error = new Error("Wikist \u901a\u884c\u8bc1\u672a\u542f\u7528\u3002");
    error.statusCode = 404;
    throw error;
  }
  passport.assertCanAccessDashboard(session);
}

function requireUserAdmin(passport, session) {
  if (!passport) {
    const error = new Error("Wikist \u901a\u884c\u8bc1\u672a\u542f\u7528\u3002");
    error.statusCode = 404;
    throw error;
  }
  passport.assertCanManageUsers(session);
}

function requireImportAccount(passport, session) {
  if (!passport || !session?.user) {
    const error = new Error("请先登录后再导入或同步词条。");
    error.statusCode = 401;
    throw error;
  }
}

function sessionAuthor(session, fallback = "Wikist Importer") {
  return session?.user?.displayName || session?.user?.username || fallback;
}

function sendDownload(res, backup) {
  res.writeHead(200, {
    "content-type": backup.contentType || "application/octet-stream",
    "content-length": backup.buffer.length,
    "content-disposition": `attachment; filename="${backup.filename}"`,
    "cache-control": "no-store",
    "x-wikist-backup-manifest": encodeURIComponent(JSON.stringify(backup.manifest || {})),
  });
  res.end(backup.buffer);
}

function citationInputError(references) {
  if (references === undefined) return "";
  if (!Array.isArray(references)) return "引用记录必须是数组。";
  if (references.length > 120) return "单个词条最多保存 120 条引用记录。";
  const ids = new Set();
  for (const [index, reference] of references.entries()) {
    if (!reference || typeof reference !== "object") return `第 ${index + 1} 条引用记录格式无效。`;
    const id = String(reference.id || reference.key || "").trim();
    if (id && !normalizeCitationId(id)) return `第 ${index + 1} 条引用键格式无效。`;
    const normalizedId = normalizeCitationId(id);
    if (normalizedId && ids.has(normalizedId)) return `引用键 ${normalizedId} 重复。`;
    if (normalizedId) ids.add(normalizedId);
    const doi = String(reference.doi || "").trim();
    const arxiv = String(reference.arxiv || reference.arXiv || "").trim();
    const url = String(reference.url || reference.link || "").trim();
    if (doi && !normalizeDoi(doi)) return `引用 ${id || index + 1} 的 DOI 格式无效。`;
    if (arxiv && !normalizeArxiv(arxiv)) return `引用 ${id || index + 1} 的 arXiv 编号格式无效。`;
    if (url && !normalizeUrl(url)) return `引用 ${id || index + 1} 的链接必须是 http 或 https 地址。`;
    const year = String(reference.year || "").trim();
    if (year && !/^\d{4}$/.test(year)) return `引用 ${id || index + 1} 的年份应为四位数字。`;
  }
  return "";
}

function assertCitationInput(references) {
  const message = citationInputError(references);
  if (!message) return;
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function assetUrl(config, urlPath) {
  const value = String(urlPath || "");
  const base = String(config.assets?.cdnBase || "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\/[^\s"'<>]+$/i.test(base) || !/^\/(?:assets|plugins)\//.test(value)) return value;
  return `${base}${value}`;
}

function siteIconUrl(config) {
  const icon = cleanAssetUrl(config.assets?.siteIcon || "/assets/wikist-emblem.svg", "/assets/wikist-emblem.svg");
  return icon.startsWith("/") ? assetUrl(config, icon) : icon;
}

function serveIndexHtml(req, res, indexPath, config) {
  const icon = siteIconUrl(config);
  const html = fs.readFileSync(indexPath, "utf8")
    .replace(/href="\/assets\/styles\.css\?v=wikist-core-20260711-65"/g, `href="${escapeHtml(assetUrl(config, "/assets/styles.css?v=wikist-core-20260711-65"))}"`)
    .replace(/src="\/assets\/app\.js\?v=wikist-core-20260711-65"/g, `src="${escapeHtml(assetUrl(config, "/assets/app.js?v=wikist-core-20260711-65"))}"`)
    .replace(/href="\/assets\/wikist-emblem\.svg"/g, `href="${escapeHtml(icon)}"`)
    .replace(/src="\/assets\/wikist-emblem\.svg"/g, `src="${escapeHtml(icon)}"`)
    .replace(/<title>Wikist<\/title>/, `<title>${escapeHtml(config.name || "Wikist")}</title>`);
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else res.end(html);
}

function pagePreviewPayload(page) {
  if (!page) return null;
  return {
    exists: true,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    heroImage: page.heroImage || "",
    categories: page.categories || [],
    aliases: page.aliases || [],
    redirectTarget: page.redirectTarget || "",
    isDisambiguation: Boolean(page.isDisambiguation),
    disambiguationTargets: page.disambiguationTargets || [],
    citationStats: page.citationStats || { total: 0, cited: 0, verifiable: 0, completeness: 0, qualityScore: 0, unresolved: [], citationNeeded: 0, issues: [] },
    quality: page.quality || "C",
    status: page.status || "draft",
    updatedAt: page.updatedAt,
  };
}

const HOME_MODULE_DEFAULTS = {
  showFeatured: true,
  showNews: true,
  showPath: true,
  showProgress: true,
  showStable: true,
  showOriginal: true,
  showCategories: true,
  showActions: true,
};

const HOME_CONTENT_DEFAULTS = {
  heroKicker: "Wikist Knowledge Core",
  heroTitle: "欢迎来到 Wikist",
  heroSummary: "开放、严谨、可验证的中文数学知识共同体。定义、证明、引用、讨论、权限与归档共同构成可审计的知识网络。",
  heroSearch: "搜索数学概念",
  heroContribute: "开始贡献",
  heroNews: "查看资讯",
  newsTitle: "资讯雷达",
  newsEmpty: "资讯页尚未创建。",
  newsItems: [],
  pathTitle: "入门路径",
  progressTitle: "全球数学进展",
  actionsTitle: "协作控制台",
  actionsSummary: "Wikist 正在建立可审计的知识协作体系。",
  progressItems: [
    { tag: "国际会议", title: "ICM 2026", body: "国际数学家大会继续作为全球数学共同体的核心交流节点。", href: "https://www.mathunion.org/icm/icm-2026" },
    { tag: "形式化数学", title: "Lean / mathlib", body: "定理证明、形式化库与可验证证明正在进入更多数学工作流。", href: "https://github.com/leanprover-community/mathlib4" },
    { tag: "开放预印本", title: "arXiv Mathematics", body: "数学预印本持续推动开放传播、同行讨论与跨领域引用。", href: "https://arxiv.org/archive/math" },
  ],
};

function homeSettingsPayload(config) {
  return { ...HOME_MODULE_DEFAULTS, ...(config.home || {}) };
}

function homeContentPayload(config) {
  return { ...HOME_CONTENT_DEFAULTS, ...(config.homeContent || {}) };
}

function sanitizeHomeSettings(input, current = {}) {
  const source = input && typeof input === "object" ? input : {};
  const next = { ...HOME_MODULE_DEFAULTS, ...current };
  for (const key of Object.keys(HOME_MODULE_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) next[key] = Boolean(source[key]);
  }
  return next;
}

function sanitizeHomeContent(input, current = {}) {
  const source = input && typeof input === "object" ? input : {};
  const next = { ...HOME_CONTENT_DEFAULTS, ...current };
  for (const key of Object.keys(HOME_CONTENT_DEFAULTS)) {
    if (key === "progressItems" || key === "newsItems") continue;
    if (Object.prototype.hasOwnProperty.call(source, key)) next[key] = cleanSettingText(source[key], 800);
  }
  if (Object.prototype.hasOwnProperty.call(source, "newsItems")) {
    const raw = Array.isArray(source.newsItems) ? source.newsItems : [];
    next.newsItems = raw.slice(0, 8).map((item) => ({
      tag: cleanSettingText(item?.tag, 60),
      title: cleanSettingText(item?.title, 120),
      body: cleanSettingText(item?.body, 300),
      href: cleanSettingText(item?.href, 500),
      date: cleanSettingText(item?.date, 80),
    })).filter((item) => item.title);
  }
  if (Object.prototype.hasOwnProperty.call(source, "progressItems")) {
    const raw = Array.isArray(source.progressItems) ? source.progressItems : [];
    next.progressItems = raw.slice(0, 8).map((item) => ({
      tag: cleanSettingText(item?.tag, 60),
      title: cleanSettingText(item?.title, 120),
      body: cleanSettingText(item?.body, 300),
      href: cleanSettingText(item?.href, 500),
    })).filter((item) => item.title);
  }
  return next;
}

function saveSiteConfig(rootDir, runtimeConfig, changes) {
  const configPath = path.join(rootDir, "config", "site.config.json");
  const disk = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")) : {};
  const next = { ...disk, ...changes };
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  Object.assign(runtimeConfig, changes);
  return changes;
}

function recordAudit(passport, req, session, input) {
  if (!passport) return null;
  try {
    return passport.recordAuditLog(req, session, input);
  } catch (error) {
    console.warn("Wikist audit log failed:", error.message);
    return null;
  }
}

function reloadRuntimeConfig(rootDir, runtimeConfig, pages) {
  const next = loadConfig(rootDir);
  for (const key of Object.keys(runtimeConfig)) delete runtimeConfig[key];
  Object.assign(runtimeConfig, next);
  pages.config = runtimeConfig;
  pages.hiddenPages = new Set((runtimeConfig.hiddenPages || []).map((slug) => normalizeSlug(slug)));
  pages.clearCache();
  return runtimeConfig;
}

function sanitizePluginSettings(input, current = {}, rootDir = process.cwd()) {
  const next = pluginSettings({ plugins: current }, rootDir);
  const source = input && typeof input === "object" ? input : {};
  for (const plugin of pluginCatalog(rootDir)) {
    const incoming = source[plugin.id];
    if (!incoming || typeof incoming !== "object") continue;
    next[plugin.id] = { ...next[plugin.id] };
    for (const key of plugin.configKeys) {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
      if (["enabled", "grid", "axis", "fuzzy", "prefix", "autoConvert"].includes(key)) next[plugin.id][key] = Boolean(incoming[key]);
      else if (key === "defaultHeight") next[plugin.id][key] = Math.max(220, Math.min(Number(incoming[key]) || 360, 760));
      else if (key === "samples") next[plugin.id][key] = Math.max(160, Math.min(Number(incoming[key]) || 720, 1800));
      else if (key === "custom" && incoming[key] && typeof incoming[key] === "object") next[plugin.id][key] = incoming[key];
      else next[plugin.id][key] = String(incoming[key] || "").slice(0, 1000);
    }
  }
  return next;
}

function siteSettingsPayload(config) {
  return {
    name: config.name || "Wikist",
    tagline: config.tagline || "",
    language: normalizeLanguageCode(config.language || "zh-CN", "zh-CN"),
    languages: normalizeLanguageList(config.languages || ["zh-CN", "zh-TW", "en"], []),
    defaultPage: config.defaultPage || "home",
    license: config.license || "CC BY-SA 4.0",
    mathCdn: config.math?.cdn || "",
    cdnBase: config.assets?.cdnBase || "",
    siteIcon: config.assets?.siteIcon || "/assets/wikist-emblem.svg",
    customCss: config.assets?.customCss || "",
    customJs: config.assets?.customJs || "",
    mail: {
      ...publicMailSettings(config),
      smtpPassSet: Boolean(config.mail?.smtp?.pass),
    },
    passportSecurity: passportSecurityPayload(config),
  };
}

function cleanSettingText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function cleanAssetUrl(value, fallback = "") {
  const text = cleanSettingText(value, 500);
  if (!text) return fallback;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(text)) return text;
  if (/^\/[^\s"'<>\\]+$/.test(text) && !text.startsWith("//")) return text;
  return fallback;
}

function normalizeLanguageCode(value, fallback = "") {
  const raw = String(value || "").trim().replace(/_/g, "-");
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower === "zh" || lower === "zh-hans" || lower === "zh-cn" || lower === "cn") return "zh-CN";
  if (lower === "zh-hant" || lower === "zh-tw" || lower === "tw" || lower === "zh-hk") return "zh-TW";
  const parts = lower.split("-").filter(Boolean);
  if (!parts.length || !/^[a-z]{2,3}$/.test(parts[0])) return fallback;
  const normalized = [parts[0]];
  for (const part of parts.slice(1, 3)) {
    if (/^[a-z]{4}$/.test(part)) normalized.push(part[0].toUpperCase() + part.slice(1));
    else if (/^([a-z]{2}|\d{3})$/.test(part)) normalized.push(part.toUpperCase());
    else if (/^[a-z0-9]{2,8}$/.test(part)) normalized.push(part);
    else return fallback;
  }
  return normalized.join("-");
}

function normalizeLanguageList(value, current = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\n，、]/);
  const languages = raw.map((item) => normalizeLanguageCode(item, "")).filter(Boolean);
  const merged = Array.from(new Set(["zh-CN", "zh-TW", "en", ...(Array.isArray(current) ? current : []), ...languages]
    .map((item) => normalizeLanguageCode(item, "")).filter(Boolean)));
  return merged.slice(0, 40);
}

function sanitizeSiteSettings(input, current = {}) {
  const source = input && typeof input === "object" ? input : {};
  const languages = normalizeLanguageList(source.languages ?? current.languages, current.languages || []);
  const language = normalizeLanguageCode(source.language ?? current.language ?? "zh-CN", "zh-CN");
  if (!languages.includes(language)) languages.push(language);
  const currentMail = current.mail || {};
  const incomingMail = source.mail && typeof source.mail === "object" ? source.mail : source;
  const smtpPass = Object.prototype.hasOwnProperty.call(incomingMail, "smtpPass") ? String(incomingMail.smtpPass || "") : "";
  const mail = {
    ...(currentMail || {}),
    enabled: incomingMail.mailEnabled === true || incomingMail.enabled === true,
    fromName: cleanSettingText(incomingMail.fromName ?? currentMail.fromName ?? current.name ?? "Wikist", 120),
    fromAddress: cleanSettingText(incomingMail.fromAddress ?? currentMail.fromAddress ?? "", 220),
    baseUrl: cleanSettingText(incomingMail.baseUrl ?? currentMail.baseUrl ?? "", 500),
    smtp: {
      ...(currentMail.smtp || {}),
      host: cleanSettingText(incomingMail.smtpHost ?? incomingMail.host ?? currentMail.smtp?.host ?? "", 220),
      port: Math.max(1, Math.min(Number(incomingMail.smtpPort ?? incomingMail.port ?? currentMail.smtp?.port) || 587, 65535)),
      secure: incomingMail.smtpSecure === true || incomingMail.secure === true,
      user: cleanSettingText(incomingMail.smtpUser ?? incomingMail.user ?? currentMail.smtp?.user ?? "", 220),
      pass: smtpPass ? smtpPass.slice(0, 1000) : (currentMail.smtp?.pass || ""),
    },
  };
  const securitySource = source.passportSecurity && typeof source.passportSecurity === "object" ? source.passportSecurity : source;
  const passport = {
    ...(current.passport || {}),
    requireEmailVerification: securitySource.requireEmailVerification === true,
    emailVerificationTTLSeconds: Math.max(60, Math.min(Number(securitySource.emailVerificationTTLSeconds ?? current.passport?.emailVerificationTTLSeconds) || 1800, 86400)),
    passwordResetTTLSeconds: Math.max(60, Math.min(Number(securitySource.passwordResetTTLSeconds ?? current.passport?.passwordResetTTLSeconds) || 1200, 86400)),
    twoFactorIssuer: cleanSettingText(securitySource.twoFactorIssuer ?? current.passport?.twoFactorIssuer ?? current.name ?? "Wikist", 80) || "Wikist",
  };
  return {
    name: cleanSettingText(source.name ?? current.name ?? "Wikist", 80) || "Wikist",
    tagline: cleanSettingText(source.tagline ?? current.tagline ?? "", 220),
    language,
    defaultPage: cleanSettingText(source.defaultPage ?? current.defaultPage ?? "home", 120) || "home",
    license: cleanSettingText(source.license ?? current.license ?? "CC BY-SA 4.0", 120),
    languages,
    math: { ...(current.math || {}), cdn: cleanSettingText(source.mathCdn ?? current.math?.cdn ?? "", 500) },
    assets: {
      ...(current.assets || {}),
      cdnBase: cleanSettingText(source.cdnBase ?? current.assets?.cdnBase ?? "", 500),
      siteIcon: cleanAssetUrl(source.siteIcon ?? current.assets?.siteIcon ?? "/assets/wikist-emblem.svg", "/assets/wikist-emblem.svg"),
      customCss: String(source.customCss ?? current.assets?.customCss ?? "").slice(0, 20000),
      customJs: String(source.customJs ?? current.assets?.customJs ?? "").slice(0, 20000),
    },
    mail,
    passport,
  };
}

function cleanPluginId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,60}$/.test(id)) throw new Error("插件 ID 只能使用字母、数字、下划线和短横线，并且必须以字母开头。");
  return id;
}

function createPluginManifest(rootDir, input = {}) {
  const id = cleanPluginId(input.id);
  const dirName = id.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const pluginsDir = path.join(rootDir, "plugins");
  const pluginDir = path.join(pluginsDir, dirName);
  const manifestPath = path.join(pluginDir, "plugin.json");
  if (fs.existsSync(manifestPath)) {
    const error = new Error("插件已经存在。");
    error.statusCode = 409;
    throw error;
  }
  fs.mkdirSync(pluginDir, { recursive: true });
  const configKeys = Array.isArray(input.configKeys) ? input.configKeys : String(input.configKeys || "enabled").split(",").map((item) => item.trim()).filter(Boolean);
  const syntax = Array.isArray(input.syntax) ? input.syntax : String(input.syntax || "").split("\n").map((item) => item.trim()).filter(Boolean);
  const manifest = {
    id,
    name: cleanSettingText(input.name || id, 80) || id,
    type: cleanSettingText(input.type || "extension", 40) || "extension",
    version: cleanSettingText(input.version || "1.0.0", 30) || "1.0.0",
    source: cleanSettingText(input.source || `local:${dirName}`, 220),
    repository: cleanSettingText(input.repository || "", 240),
    vendorDirectory: cleanSettingText(input.vendorDirectory || "", 120),
    description: cleanSettingText(input.description || "", 500),
    syntax,
    configKeys: configKeys.length ? configKeys : ["enabled"],
    defaultConfig: input.defaultConfig && typeof input.defaultConfig === "object" ? input.defaultConfig : { enabled: true },
    entry: cleanSettingText(input.entry || "manifest-only", 120) || "manifest-only",
    serverModule: cleanSettingText(input.serverModule || "", 180),
    clientModule: cleanSettingText(input.clientModule || "", 180),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
function paginationPayload(items, total, pagination) {
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));
  return {
    items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.limit,
      total,
      totalPages,
      hasPrev: pagination.page > 1,
      hasNext: pagination.page < totalPages,
    },
  };
}

function assertImportOverwriteAllowed(pages, slug, overwrite) {
  if (!overwrite && pages.getPage(slug)) {
    const error = new Error("目标词条已经存在。请开启覆盖导入，或换一个 slug。");
    error.statusCode = 409;
    throw error;
  }
}

function resolveLivePage(pages, passport, slug) {
  const requestedSlug = normalizeSlug(slug);
  const direct = pages.getPage(requestedSlug);
  if (direct?.redirectTarget) {
    const targetSlug = normalizeSlug(direct.redirectTarget);
    const target = targetSlug !== requestedSlug ? pages.getPage(targetSlug) : null;
    if (target) return { page: target, requestedSlug, alias: { aliasSlug: requestedSlug, targetSlug, sourcePageSlug: requestedSlug, kind: "redirect" } };
  }
  if (direct) return { page: direct, requestedSlug, alias: null };
  const alias = passport?.resolvePageAlias(requestedSlug);
  if (!alias) return { page: null, requestedSlug, alias: null };
  const page = pages.getPage(alias.targetSlug);
  if (page?.redirectTarget) {
    const targetSlug = normalizeSlug(page.redirectTarget);
    const target = targetSlug !== page.slug ? pages.getPage(targetSlug) : null;
    if (target) return { page: target, requestedSlug, alias: { ...alias, targetSlug, kind: "redirect" } };
  }
  return { page, requestedSlug, alias: page ? alias : null };
}

function pageWithAlias(page, requestedSlug, alias) {
  if (!page) return null;
  return alias
    ? { ...page, redirectedFrom: requestedSlug, canonicalSlug: page.slug, alias: alias.aliasSlug }
    : page;
}

function knowledgeSnapshot(passport, pages, config) {
  return passport.knowledgeSnapshot(pages.listPages(), { defaultSlug: config.defaultPage || "home" });
}

function knowledgeWrite(passport, page, session, options = {}) {
  if (!passport || !page) return { links: [], notifications: 0 };
  const linkSync = passport.syncPageLinks(page);
  const input = {
    action: options.action || "update",
    language: options.language || "",
    actorUserId: session?.user?.id || null,
    senderName: session?.user?.displayName || session?.user?.username || options.senderName || "Wikist",
  };
  const notifications = passport.notifyKnowledgeWatchers(page, input);
  const followerNotifications = passport.notifyUserFollowers(page, input);
  return { links: linkSync.links, notifications, followerNotifications };
}

function createWikistServer(options) {
  const rootDir = options.rootDir;
  const publicDir = path.join(rootDir, "public");
  const configuredAtStartup = hasSiteConfig(rootDir);
  const config = loadConfig(rootDir);
  const installerForceMode = process.env.WIKIST_INSTALL_MODE === "1";
  let installWroteConfig = false;
  let installRemovedConfig = false;
  const installerStatus = () => {
    const configured = hasSiteConfig(rootDir);
    const installedConfig = configured ? loadConfig(rootDir) : config;
    return {
      configured,
      setupAllowed: !configured || installerForceMode,
      forceMode: installerForceMode,
      uninstallAllowed: configured && installerForceMode,
      restartRequired: installWroteConfig || installRemovedConfig || (configured && !configuredAtStartup),
      database: String(installedConfig.passport?.database || "data/wikist.sqlite"),
    };
  };
  const pages = new PageStore(rootDir, config);
  const search = new SearchIndex(pages, () => ({ plugins: pluginSettings(config, rootDir) }));
  const passport = configuredAtStartup && config.passport?.enabled ? new PassportStore(rootDir, config.passport) : null;
  if (passport) passport.rebuildPageLinks(pages.listPages());

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(url.pathname);
      const session = passport ? passport.authenticate(req) : null;
      const installerAsset = pathname === "/assets/install.css" || pathname === "/assets/install.js" || pathname === "/assets/wikist-emblem.svg";
      const installerRequest = pathname === "/install.html" || pathname.startsWith("/api/install/") || pathname === "/api/install" || installerAsset;

      if (pathname === "/api/install/status" && req.method === "GET") {
        sendJson(res, 200, installerStatus());
        return;
      }

      if (pathname === "/api/install" && req.method === "POST") {
        const status = installerStatus();
        if (!status.setupAllowed) {
          sendJson(res, 409, { error: "当前站点已经配置完成。如需重新生成配置，请以 WIKIST_INSTALL_MODE=1 重启服务后再操作。" });
          return;
        }
        const result = writeInitialConfig(rootDir, await readJsonBody(req), { force: installerForceMode });
        installWroteConfig = true;
        sendJson(res, 200, {
          ok: true,
          restartRequired: true,
          site: {
            name: result.config.name,
            language: result.config.language,
            database: result.config.passport.database,
            mailEnabled: result.config.mail.enabled,
          },
        });
        return;
      }

      if (pathname === "/api/install/uninstall" && req.method === "POST") {
        if (!installerForceMode) {
          sendJson(res, 403, { error: "卸载安装配置必须先以 WIKIST_INSTALL_MODE=1 重启服务。" });
          return;
        }
        const body = await readJsonBody(req);
        if (body.confirm !== "UNINSTALL_CONFIG") {
          sendJson(res, 400, { error: "请确认输入 UNINSTALL_CONFIG 后再卸载安装配置。" });
          return;
        }
        const result = uninstallSiteConfig(rootDir);
        installRemovedConfig = true;
        sendJson(res, 200, {
          ...result,
          note: "仅移除了安装配置文件；content/、data/、用户、评论和词条不会被删除。请重启服务后重新进入安装器。",
        });
        return;
      }

      if (!configuredAtStartup && !installerRequest) {
        if (req.method === "GET" || req.method === "HEAD") {
          res.writeHead(302, { location: "/install.html", "cache-control": "no-store" });
          res.end();
        } else {
          sendJson(res, 428, { error: "Wikist has not been initialized. Open /install.html first.", installUrl: "/install.html" });
        }
        return;
      }

      if (pathname === "/api/site" && req.method === "GET") {
        sendJson(res, 200, {
          ...config,
          language: normalizeLanguageCode(config.language || "zh-CN", "zh-CN"),
          languages: normalizeLanguageList(config.languages || ["zh-CN", "zh-TW", "en"], []),
          home: homeSettingsPayload(config),
          homeContent: homeContentPayload(config),
          plugins: pluginSettings(config, rootDir),
          pluginCatalog: pluginCatalog(rootDir),
          mail: publicMailSettings(config),
          editing: {
            open: Boolean(config.editing?.open),
            requireLogin: Boolean(config.editing?.requireLogin),
            tokenRequired: Boolean(config.editing?.requireTokenEnv && process.env[config.editing.requireTokenEnv]),
          },
          passport: {
            enabled: Boolean(passport),
            captcha: Boolean(passport),
            sessionDays: config.passport?.sessionDays || 7,
          },
          setup: {
            configured: configuredAtStartup,
            needsAdmin: Boolean(passport?.needsInitialAdmin()),
            users: passport ? passport.countUsers() : 0,
            admins: passport ? passport.countAdmins() : 0,
          },
          comments: {
            provider: "wikist-local",
            compatibleWith: "Waline-style Markdown comments",
          },
        });
        return;
      }

      if (pathname === "/api/passport/captcha" && req.method === "GET") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist 通行证未启用。" });
          return;
        }
        sendJson(res, 200, passport.createCaptcha());
        return;
      }

      if (pathname === "/api/passport/me" && req.method === "GET") {
        const profile = session?.user ? passport.getUserProfile(session.user.id) : null;
        sendJson(res, 200, { user: profile });
        return;
      }

      if (pathname === "/api/passport/email/verification" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再发送邮箱验证邮件。" });
          return;
        }
        const ticket = passport.createEmailVerificationToken(session.user.id);
        const mail = await sendEmailVerification(config, req, ticket);
        sendJson(res, 200, { ok: true, mail, expiresAt: ticket.expiresAt });
        return;
      }

      if (pathname === "/api/passport/email/verify" && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist 通行证未启用。" });
          return;
        }
        const body = await readJsonBody(req);
        const user = passport.verifyEmailToken(body.token);
        sendJson(res, 200, { ok: true, user });
        return;
      }

      if (pathname === "/api/passport/password/forgot" && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist 通行证未启用。" });
          return;
        }
        const body = await readJsonBody(req);
        passport.verifyCaptcha(body.captchaId, body.captchaAnswer);
        const ticket = passport.createPasswordResetToken(body.identifier || body.email);
        if (ticket) await sendPasswordReset(config, req, ticket);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/passport/password/reset" && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist 通行证未启用。" });
          return;
        }
        const body = await readJsonBody(req);
        passport.resetPasswordWithToken(body.token, body.newPassword);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/passport/security" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再查看安全状态。" });
          return;
        }
        sendJson(res, 200, { security: passport.twoFactorStatus(session.user.id) });
        return;
      }

      if (pathname === "/api/passport/security/2fa/setup" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再设置二次验证。" });
          return;
        }
        sendJson(res, 200, passport.setupTwoFactor(session.user.id));
        return;
      }

      if (pathname === "/api/passport/security/2fa/enable" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再启用二次验证。" });
          return;
        }
        const body = await readJsonBody(req);
        sendJson(res, 200, { security: passport.enableTwoFactor(session.user.id, body.code) });
        return;
      }

      if (pathname === "/api/passport/security/2fa/disable" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再关闭二次验证。" });
          return;
        }
        const body = await readJsonBody(req);
        sendJson(res, 200, { security: passport.disableTwoFactor(session.user.id, body) });
        return;
      }

      if (pathname === "/api/passport/favorites" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后查看收藏词条。" });
          return;
        }
        const pagination = readPagination(url, 12, 50);
        const items = passport.listUserFavorites(session.user.id, { limit: pagination.limit, offset: pagination.offset }).map((favorite) => {
          const page = pages.getPage(favorite.pageSlug);
          return {
            ...(page ? pagePreviewPayload(page) : {
              exists: false,
              slug: favorite.pageSlug,
              title: favorite.pageTitle || favorite.pageSlug,
              summary: "该词条已归档或尚未恢复。",
              heroImage: "",
              categories: [],
              quality: "-",
              status: "archived",
              updatedAt: favorite.createdAt,
            }),
            favoriteId: favorite.id,
            favoritedAt: favorite.createdAt,
          };
        });
        sendJson(res, 200, paginationPayload(items, passport.countUserFavorites(session.user.id), pagination));
        return;
      }

      if (pathname === "/api/passport/watches" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后查看关注列表。" });
          return;
        }
        const pagination = readPagination(url, 12, 60);
        const type = url.searchParams.get("type") || "all";
        const items = passport.listUserWatches(session.user.id, {
          type,
          limit: pagination.limit,
          offset: pagination.offset,
        });
        const allPages = pages.listPages();
        const pageMap = new Map(allPages.map((page) => [page.slug, page]));
        const enriched = items.map((watch) => {
          const page = watch.targetType === "page" ? pageMap.get(watch.targetKey) : null;
          return {
            ...watch,
            page: page ? pagePreviewPayload(page) : null,
            exists: watch.targetType !== "page" || Boolean(page),
          };
        });
        const total = passport.countUserWatches(session.user.id, type);
        sendJson(res, 200, paginationPayload(enriched, total, pagination));
        return;
      }

      if (pathname === "/api/passport/watches" && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后管理关注列表。" });
          return;
        }
        const body = await readJsonBody(req);
        const watch = passport.setWatch(session, body.targetType || body.type, body.targetKey || body.key || body.value, body.enabled !== false);
        sendJson(res, 200, { watch });
        return;
      }

      if (pathname === "/api/passport/follows" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后查看社交关系。" });
          return;
        }
        const pagination = readPagination(url, 12, 60);
        const direction = url.searchParams.get("direction") === "followers" ? "followers" : "following";
        const items = passport.listUserFollows(session.user.id, direction, { limit: pagination.limit, offset: pagination.offset });
        const total = passport.countUserFollows(session.user.id, direction);
        sendJson(res, 200, { direction, ...paginationPayload(items, total, pagination) });
        return;
      }

      if (pathname === "/api/passport/profile" && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录。" });
          return;
        }
        const body = await readJsonBody(req);
        const profile = passport.updateProfile(session.user.id, body);
        recordAudit(passport, req, session, { action: "user.profile", targetType: "user", targetId: String(session.user.id), targetLabel: session.user.username, summary: "更新个人资料" });
        sendJson(res, 200, { user: profile });
        return;
      }

      if (pathname === "/api/passport/translation/join" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后加入翻译社区。" });
          return;
        }
        const translator = passport.joinTranslatorCommunity(session, await readJsonBody(req));
        sendJson(res, 200, { translator });
        return;
      }

      if (pathname === "/api/passport/register" && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist \u901a\u884c\u8bc1\u672a\u542f\u7528\u3002" });
          return;
        }
        const created = passport.register(await readJsonBody(req), req);
        recordAudit(passport, req, { user: created.user }, { action: "user.register", targetType: "user", targetId: String(created.user.id), targetLabel: created.user.username, summary: "\u6ce8\u518c\u901a\u884c\u8bc1" });
        let verification = { sent: false, skipped: Boolean(created.initialAdmin) };
        if (created.user.email && !created.initialAdmin) {
          try {
            const ticket = passport.createEmailVerificationToken(created.user.id);
            verification = { sent: true, expiresAt: ticket.expiresAt, mail: await sendEmailVerification(config, req, ticket) };
          } catch (error) {
            verification = { sent: false, error: error.message };
          }
        }
        setCookieHeader(res, sessionCookie(created.token, created.maxAgeSeconds));
        sendJson(res, 200, { user: created.user, verification, initialAdmin: Boolean(created.initialAdmin) });
        return;
      }
      if (pathname === "/api/passport/login" && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist 通行证未启用。" });
          return;
        }
        const loggedIn = passport.login(await readJsonBody(req), req);
        setCookieHeader(res, sessionCookie(loggedIn.token, loggedIn.maxAgeSeconds));
        sendJson(res, 200, { user: loggedIn.user });
        return;
      }

      if (pathname === "/api/passport/logout" && req.method === "POST") {
        if (passport) passport.logout(req);
        setCookieHeader(res, clearSessionCookie());
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/passport/messages/unread-count" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 200, { unread: 0 });
          return;
        }
        sendJson(res, 200, { unread: passport.unreadMessageCount(session.user.id) });
        return;
      }

      if (pathname === "/api/passport/messages" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后查看消息。" });
          return;
        }
        const pagination = readPagination(url, 12, 80);
        const options = {
          status: url.searchParams.get("status") || "all",
          priority: url.searchParams.get("priority") || "all",
          limit: pagination.limit,
          offset: pagination.offset,
        };
        const messages = passport.listMessages(session.user.id, options);
        const payload = paginationPayload(messages, passport.countMessages(session.user.id, options), pagination);
        sendJson(res, 200, { ...payload, messages, unread: passport.unreadMessageCount(session.user.id) });
        return;
      }

      if (pathname === "/api/passport/messages/urgent" && req.method === "GET") {
        if (!passport || !session?.user) {
          sendJson(res, 200, { messages: [], unread: 0 });
          return;
        }
        const messages = passport.listMessages(session.user.id, { status: "unread", priority: "urgent", limit: 5, offset: 0 });
        sendJson(res, 200, { messages, unread: passport.unreadMessageCount(session.user.id) });
        return;
      }

      if (pathname === "/api/passport/messages/read-all" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后操作消息。" });
          return;
        }
        const result = passport.markAllMessagesRead(session.user.id);
        sendJson(res, 200, { ...result, unread: passport.unreadMessageCount(session.user.id) });
        return;
      }

      const messageReadMatch = pathname.match(/^\/api\/passport\/messages\/(-?\d+)\/read$/);
      if (messageReadMatch && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后操作消息。" });
          return;
        }
        const message = passport.markMessageRead(session.user.id, Number(messageReadMatch[1]));
        sendJson(res, 200, { message, unread: passport.unreadMessageCount(session.user.id) });
        return;
      }

      const messageDeleteMatch = pathname.match(/^\/api\/passport\/messages\/(-?\d+)$/);
      if (messageDeleteMatch && req.method === "DELETE") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后删除消息。" });
          return;
        }
        passport.deleteMessage(session.user.id, Number(messageDeleteMatch[1]));
        sendJson(res, 200, { ok: true, unread: passport.unreadMessageCount(session.user.id) });
        return;
      }

      if (pathname === "/api/passport/password" && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录。" });
          return;
        }
        passport.changePassword(session.user.id, await readJsonBody(req));
        recordAudit(passport, req, session, { action: "user.password", targetType: "user", targetId: String(session.user.id), targetLabel: session.user.username, summary: "修改密码" });
        setCookieHeader(res, clearSessionCookie());
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/pages/export" && req.method === "GET") {
        const slug = normalizeSlug(url.searchParams.get("slug") || "");
        const format = String(url.searchParams.get("format") || "json").toLowerCase();
        if (format === "markdown" || format === "md") {
          const raw = pages.rawMarkdown(slug);
          if (!raw) {
            sendJson(res, 404, { error: "词条不存在。" });
            return;
          }
          sendText(res, 200, raw, "text/markdown; charset=utf-8");
          return;
        }
        const exported = pages.exportPage(slug);
        if (!exported) {
          sendJson(res, 404, { error: "词条不存在。" });
          return;
        }
        sendJson(res, 200, exported);
        return;
      }

      if (pathname === "/api/pages/import/wikist" && req.method === "POST") {
        requireImportAccount(passport, session);
        const body = await readJsonBody(req, 8 * 1024 * 1024);
        const pageInput = parseWikistImport({ ...body, author: sessionAuthor(session) });
        assertCitationInput(pageInput.references);
        if (passport) passport.assertCanEdit(pageInput.slug, session);
        assertImportOverwriteAllowed(pages, pageInput.slug, body.overwrite === true);
        const existing = pages.getPage(pageInput.slug);
        const page = pages.savePage(pageInput.slug, pageInput);
        const audit = passport.recordPageEdit(req, session, page, { action: existing ? "update" : "create" });
        knowledgeWrite(passport, page, session, { action: existing ? "update" : "create" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { page, editEvent: audit.event });
        return;
      }

      if (pathname === "/api/pages/import/wikipedia" && req.method === "POST") {
        requireImportAccount(passport, session);
        const body = await readJsonBody(req, 1024 * 1024);
        const pageInput = await fetchWikipediaPage({ ...body, author: sessionAuthor(session) });
        assertCitationInput(pageInput.references);
        if (passport) passport.assertCanEdit(pageInput.slug, session);
        assertImportOverwriteAllowed(pages, pageInput.slug, body.overwrite === true);
        const existing = pages.getPage(pageInput.slug);
        const page = pages.savePage(pageInput.slug, pageInput);
        const audit = passport.recordPageEdit(req, session, page, { action: existing ? "update" : "create" });
        knowledgeWrite(passport, page, session, { action: existing ? "update" : "create" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { page, editEvent: audit.event });
        return;
      }

      const publicPageSyncMatch = pathname.match(/^\/api\/pages\/(.+)\/sync$/);
      if (publicPageSyncMatch && req.method === "POST") {
        requireImportAccount(passport, session);
        const slug = normalizeSlug(decodePathPart(publicPageSyncMatch[1]));
        if (passport) passport.assertCanEdit(slug, session);
        const current = pages.getPage(slug);
        if (!current) {
          sendJson(res, 404, { error: "词条不存在。" });
          return;
        }
        if (current.importSource !== "wikipedia" || !current.importTitle) {
          sendJson(res, 400, { error: "该词条没有 Wikipedia 导入元信息，无法同步。" });
          return;
        }
        const synced = await fetchWikipediaPage({
          lang: current.importLang || "zh",
          title: current.importTitle,
          slug: current.slug,
          status: current.status,
          quality: current.quality,
          difficulty: current.difficulty,
          author: sessionAuthor(session, "Wikist Sync"),
        });
        assertCitationInput(synced.references);
        const page = pages.savePage(slug, { ...synced, title: current.title || synced.title, heroImage: current.heroImage || synced.heroImage || "" });
        const audit = passport.recordPageEdit(req, session, page, { action: "update" });
        knowledgeWrite(passport, page, session, { action: "update" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { page, editEvent: audit.event });
        return;
      }

      if (pathname === "/api/admin/messages" && req.method === "GET") {
        requireDashboard(passport, session);
        const pagination = readPagination(url, 20, 100);
        const options = {
          query: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") || "all",
          limit: pagination.limit,
          offset: pagination.offset,
        };
        const messages = passport.listAdminMessages(options);
        const payload = paginationPayload(messages, passport.countAdminMessages(options), pagination);
        sendJson(res, 200, { ...payload, messages });
        return;
      }

      if (pathname === "/api/admin/messages/broadcast" && req.method === "POST") {
        requireDashboard(passport, session);
        const result = passport.broadcastMessage(session, await readJsonBody(req));
        sendJson(res, 200, result);
        return;
      }

      const adminMessageRevokeMatch = pathname.match(/^\/api\/admin\/messages\/(\d+)\/revoke$/);
      if (adminMessageRevokeMatch && req.method === "POST") {
        requireDashboard(passport, session);
        const result = passport.revokeBroadcastMessage(session, Number(adminMessageRevokeMatch[1]));
        sendJson(res, 200, result);
        return;
      }

      if (pathname === "/api/admin/logs" && req.method === "GET") {
        requireDashboard(passport, session);
        const pagination = readPagination(url, 30, 200);
        const options = {
          query: url.searchParams.get("q") || "",
          action: url.searchParams.get("action") || "all",
          targetType: url.searchParams.get("targetType") || "all",
          limit: pagination.limit,
          offset: pagination.offset,
        };
        const logs = passport.listAuditLogs(options);
        const payload = paginationPayload(logs, passport.countAuditLogs(options), pagination);
        sendJson(res, 200, { ...payload, logs });
        return;
      }

      if (pathname === "/api/admin/backup" && req.method === "GET") {
        requireDashboard(passport, session);
        const backup = createBackupPackage(rootDir, { database: config.passport?.database || "data/wikist.sqlite" });
        sendDownload(res, backup);
        return;
      }

      if (pathname === "/api/admin/backup/inspect" && req.method === "POST") {
        requireDashboard(passport, session);
        const body = await readJsonBody(req, 128 * 1024 * 1024);
        sendJson(res, 200, { backup: inspectBackupPackage(body) });
        return;
      }

      if (pathname === "/api/admin/backup/restore" && req.method === "POST") {
        requireDashboard(passport, session);
        const body = await readJsonBody(req, 128 * 1024 * 1024);
        const result = restoreBackupPackage(rootDir, body, {
          database: config.passport?.database || "data/wikist.sqlite",
          includeUserData: body.includeUserData === true,
        });
        reloadRuntimeConfig(rootDir, config, pages);
        passport.rebuildPageLinks(pages.listPages());
        search.cacheKey = "";
        recordAudit(passport, req, session, { action: "backup.restore", targetType: "site", targetId: "backup", targetLabel: body.filename || "backup", summary: "执行备份回档", metadata: { includeUserData: body.includeUserData === true, restored: result.restored?.length || 0, skipped: result.skipped?.length || 0 } });
        sendJson(res, 200, result);
        return;
      }

      if (pathname === "/api/admin/pages/export" && req.method === "GET") {
        requireDashboard(passport, session);
        const slug = normalizeSlug(url.searchParams.get("slug") || "");
        const format = String(url.searchParams.get("format") || "json").toLowerCase();
        if (format === "markdown" || format === "md") {
          const raw = pages.rawMarkdown(slug);
          if (!raw) {
            sendJson(res, 404, { error: "词条不存在。" });
            return;
          }
          sendText(res, 200, raw, "text/markdown; charset=utf-8");
          return;
        }
        const exported = pages.exportPage(slug);
        if (!exported) {
          sendJson(res, 404, { error: "词条不存在。" });
          return;
        }
        sendJson(res, 200, exported);
        return;
      }

      if (pathname === "/api/admin/pages/import/wikist" && req.method === "POST") {
        requireDashboard(passport, session);
        const body = await readJsonBody(req, 8 * 1024 * 1024);
        const pageInput = parseWikistImport(body);
        assertCitationInput(pageInput.references);
        if (passport) passport.assertCanEdit(pageInput.slug, session);
        assertImportOverwriteAllowed(pages, pageInput.slug, body.overwrite === true);
        const existing = pages.getPage(pageInput.slug);
        const page = pages.savePage(pageInput.slug, pageInput);
        const audit = passport.recordPageEdit(req, session, page, { action: existing ? "update" : "create" });
        knowledgeWrite(passport, page, session, { action: existing ? "update" : "create" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { page, editEvent: audit.event });
        return;
      }

      if (pathname === "/api/admin/pages/import/wikipedia" && req.method === "POST") {
        requireDashboard(passport, session);
        const body = await readJsonBody(req, 1024 * 1024);
        const pageInput = await fetchWikipediaPage({ ...body, author: session.user.displayName || session.user.username || "Wikist Importer" });
        assertCitationInput(pageInput.references);
        if (passport) passport.assertCanEdit(pageInput.slug, session);
        assertImportOverwriteAllowed(pages, pageInput.slug, body.overwrite === true);
        const existing = pages.getPage(pageInput.slug);
        const page = pages.savePage(pageInput.slug, pageInput);
        const audit = passport.recordPageEdit(req, session, page, { action: existing ? "update" : "create" });
        knowledgeWrite(passport, page, session, { action: existing ? "update" : "create" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { page, editEvent: audit.event });
        return;
      }

      const adminPageSyncMatch = pathname.match(/^\/api\/admin\/pages\/(.+)\/sync$/);
      if (adminPageSyncMatch && req.method === "POST") {
        requireDashboard(passport, session);
        const slug = normalizeSlug(decodePathPart(adminPageSyncMatch[1]));
        if (passport) passport.assertCanEdit(slug, session);
        const current = pages.getPage(slug);
        if (!current) {
          sendJson(res, 404, { error: "词条不存在。" });
          return;
        }
        if (current.importSource !== "wikipedia" || !current.importTitle) {
          sendJson(res, 400, { error: "该词条没有 Wikipedia 导入元信息，无法同步。" });
          return;
        }
        const synced = await fetchWikipediaPage({
          lang: current.importLang || "zh",
          title: current.importTitle,
          slug: current.slug,
          status: current.status,
          quality: current.quality,
          difficulty: current.difficulty,
          author: session.user.displayName || session.user.username || "Wikist Sync",
        });
        assertCitationInput(synced.references);
        const page = pages.savePage(slug, { ...synced, title: current.title || synced.title, heroImage: current.heroImage || synced.heroImage || "" });
        const audit = passport.recordPageEdit(req, session, page, { action: "update" });
        knowledgeWrite(passport, page, session, { action: "update" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { page, editEvent: audit.event });
        return;
      }

      if (pathname === "/api/admin/users" && req.method === "GET") {
        requireUserAdmin(passport, session);
        const pagination = readPagination(url, 20, 100);
        const query = url.searchParams.get("q") || "";
        const users = passport.listUsers({ query, limit: pagination.limit, offset: pagination.offset });
        const payload = paginationPayload(users, passport.countUsers(query), pagination);
        sendJson(res, 200, { ...payload, users });
        return;
      }

      if (pathname.startsWith("/api/admin/users/") && req.method === "PUT") {
        requireUserAdmin(passport, session);
        const id = Number(stripPrefix(pathname, "/api/admin/users/"));
        const user = passport.updateUserById(id, await readJsonBody(req));
        recordAudit(passport, req, session, { action: "user.adminUpdate", targetType: "user", targetId: String(id), targetLabel: user.username, summary: "后台编辑用户资料", metadata: { role: user.role, status: user.status } });
        sendJson(res, 200, { user });
        return;
      }

      if (pathname === "/api/admin/pages" && req.method === "GET") {
        requireDashboard(passport, session);
        const pagination = readPagination(url, 20, 100);
        const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
        const allPages = pages.listPages().map((page) => ({
          slug: page.slug, title: page.title, summary: page.summary, categories: page.categories,
          difficulty: page.difficulty, status: page.status, quality: page.quality, author: page.author,
          updatedAt: page.updatedAt, bytes: page.bytes, permissions: passport.getPagePermissions(page.slug),
          rating: passport.getPageRatingStats(page.slug),
          citationStats: page.citationStats,
        }));
        const filtered = query ? allPages.filter((page) => [page.slug, page.title, page.summary, page.author, ...(page.categories || [])].join(" ").toLowerCase().includes(query)) : allPages;
        const pageItems = filtered.slice(pagination.offset, pagination.offset + pagination.limit);
        const payload = paginationPayload(pageItems, filtered.length, pagination);
        sendJson(res, 200, { ...payload, pages: pageItems });
        return;
      }

      if (pathname === "/api/admin/citations" && req.method === "GET") {
        requireDashboard(passport, session);
        const pagination = readPagination(url, 20, 100);
        const mode = String(url.searchParams.get("mode") || "needs-review");
        const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
        const all = pages.listPages().map((page) => ({
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          categories: page.categories,
          updatedAt: page.updatedAt,
          quality: page.quality,
          citationStats: page.citationStats || {},
          references: page.references || [],
        }));
        const filtered = all.filter((page) => {
          const stats = page.citationStats || {};
          const review = Number(stats.total || 0) === 0 || Number(stats.citationNeeded || 0) > 0 || Number(stats.uncited || 0) > 0 || (stats.unresolved || []).length > 0 || Number(stats.completeness || 0) < 100;
          if (mode === "missing" && Number(stats.total || 0) !== 0) return false;
          if (mode === "unresolved" && !(stats.unresolved || []).length) return false;
          if (mode === "needs-review" && !review) return false;
          if (query && ![page.slug, page.title, page.summary, ...(page.references || []).flatMap((reference) => [reference.id, reference.title, ...(reference.authors || []), reference.doi, reference.arxiv])].join(" ").toLowerCase().includes(query)) return false;
          return true;
        });
        const items = filtered.slice(pagination.offset, pagination.offset + pagination.limit);
        const totals = all.reduce((result, page) => {
          const stats = page.citationStats || {};
          result.pages += 1;
          result.references += Number(stats.total || 0);
          result.verifiable += Number(stats.verifiable || 0);
          if (Number(stats.total || 0) === 0) result.withoutSources += 1;
          if (Number(stats.citationNeeded || 0) || Number(stats.uncited || 0) || (stats.unresolved || []).length || Number(stats.completeness || 0) < 100) result.needsReview += 1;
          return result;
        }, { pages: 0, references: 0, verifiable: 0, withoutSources: 0, needsReview: 0 });
        sendJson(res, 200, { mode, stats: totals, ...paginationPayload(items, filtered.length, pagination) });
        return;
      }

      if (pathname === "/api/admin/knowledge" && req.method === "GET") {
        requireDashboard(passport, session);
        const snapshot = knowledgeSnapshot(passport, pages, config);
        sendJson(res, 200, {
          stats: snapshot.stats,
          missing: snapshot.missing.slice(0, 80),
          orphans: snapshot.orphans.slice(0, 80).map(pagePreviewPayload),
          aliases: snapshot.aliases.slice(0, 160),
          categories: snapshot.categories.slice(0, 80),
        });
        return;
      }

      if (pathname === "/api/admin/knowledge/rebuild" && req.method === "POST") {
        requireDashboard(passport, session);
        const result = passport.rebuildPageLinks(pages.listPages());
        recordAudit(passport, req, session, { action: "knowledge.rebuild", targetType: "knowledge", targetId: "link-index", targetLabel: "词条链接索引", summary: "重建词条链接索引", metadata: result });
        sendJson(res, 200, { result, knowledge: knowledgeSnapshot(passport, pages, config).stats });
        return;
      }

      if (pathname === "/api/admin/aliases" && req.method === "POST") {
        requireDashboard(passport, session);
        const body = await readJsonBody(req);
        const aliasInput = String(body.aliasSlug || body.alias || "").trim();
        const targetInput = String(body.targetSlug || body.target || "").trim();
        if (!aliasInput || !targetInput) {
          sendJson(res, 400, { error: "别名和目标词条 slug 都不能为空。" });
          return;
        }
        const aliasSlug = normalizeSlug(aliasInput);
        const targetSlug = normalizeSlug(targetInput);
        if (pages.getPage(aliasSlug)) {
          sendJson(res, 409, { error: "别名与现有词条 slug 冲突。" });
          return;
        }
        if (!pages.getPage(targetSlug)) {
          sendJson(res, 404, { error: "目标词条不存在，不能创建重定向。" });
          return;
        }
        const alias = passport.setPageAlias(session, { aliasSlug, targetSlug });
        recordAudit(passport, req, session, { action: "knowledge.alias.save", targetType: "alias", targetId: alias.aliasSlug, targetLabel: alias.targetSlug, summary: "保存词条别名", metadata: alias });
        sendJson(res, 200, { alias });
        return;
      }

      const adminAliasDeleteMatch = pathname.match(/^\/api\/admin\/aliases\/(.+)$/);
      if (adminAliasDeleteMatch && req.method === "DELETE") {
        requireDashboard(passport, session);
        const aliasSlug = normalizeSlug(decodePathPart(adminAliasDeleteMatch[1]));
        const result = passport.removePageAlias(session, aliasSlug);
        recordAudit(passport, req, session, { action: "knowledge.alias.delete", targetType: "alias", targetId: aliasSlug, targetLabel: aliasSlug, summary: "删除词条别名" });
        sendJson(res, 200, result);
        return;
      }

      if (pathname === "/api/admin/comments" && req.method === "GET") {
        requireDashboard(passport, session);
        const pagination = readPagination(url, 20, 100);
        const options = {
          query: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") || "all",
          limit: pagination.limit,
          offset: pagination.offset,
        };
        const comments = passport.listAllComments(options).map(commentPayload);
        const payload = paginationPayload(comments, passport.countAllComments(options), pagination);
        sendJson(res, 200, { ...payload, comments });
        return;
      }

      const adminCommentRepliesMatch = pathname.match(/^\/api\/admin\/comments\/(\d+)\/replies$/);
      if (adminCommentRepliesMatch && req.method === "GET") {
        requireDashboard(passport, session);
        const parentId = Number(adminCommentRepliesMatch[1]);
        const pagination = readPagination(url, 20, 100);
        const options = {
          query: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") || "all",
          limit: pagination.limit,
          offset: pagination.offset,
        };
        const rootComment = passport.getComment(parentId);
        if (!rootComment || rootComment.parentId) {
          sendJson(res, 404, { error: "一级评论不存在。" });
          return;
        }
        const root = commentPayload(rootComment);
        const replies = passport.listAllCommentReplies(parentId, options).map(commentPayload);
        const payload = paginationPayload(replies, passport.countAllCommentReplies(parentId, options), pagination);
        sendJson(res, 200, { ...payload, root, comments: replies });
        return;
      }

      if (pathname.startsWith("/api/admin/comments/") && req.method === "DELETE") {
        requireDashboard(passport, session);
        const id = Number(stripPrefix(pathname, "/api/admin/comments/"));
        const deleted = passport.deleteComment(req, session, id);
        recordAudit(passport, req, session, { action: "comment.delete", targetType: "comment", targetId: String(id), targetLabel: deleted.pageSlug, summary: "删除评论", metadata: { pageSlug: deleted.pageSlug, parentId: deleted.parentId || null } });
        sendJson(res, 200, { comment: commentPayload(deleted) });
        return;
      }

      if (pathname.startsWith("/api/admin/comments/") && req.method === "PUT") {
        requireDashboard(passport, session);
        const id = Number(stripPrefix(pathname, "/api/admin/comments/"));
        const body = await readJsonBody(req);
        const updated = passport.updateCommentStatus(id, body.status);
        recordAudit(passport, req, session, { action: "comment.status", targetType: "comment", targetId: String(id), targetLabel: updated.pageSlug, summary: `更新评论状态为 ${updated.status}`, metadata: { pageSlug: updated.pageSlug, status: updated.status } });
        sendJson(res, 200, { comment: commentPayload(updated) });
        return;
      }

      if (pathname === "/api/admin/plugins" && req.method === "POST") {
        requireDashboard(passport, session);
        const manifest = createPluginManifest(rootDir, await readJsonBody(req));
        recordAudit(passport, req, session, { action: "plugin.create", targetType: "plugin", targetId: manifest.id, targetLabel: manifest.name, summary: "创建插件 Manifest" });
        sendJson(res, 200, { plugin: manifest, pluginCatalog: pluginCatalog(rootDir), plugins: pluginSettings(config, rootDir) });
        return;
      }

      if (pathname === "/api/admin/plugins/vendor" && req.method === "POST") {
        requireDashboard(passport, session);
        const vendor = syncVendorPlugin(rootDir, await readJsonBody(req));
        recordAudit(passport, req, session, { action: "plugin.vendor", targetType: "plugin", targetId: vendor.pluginId || vendor.id || "", targetLabel: vendor.repository || "vendor", summary: "同步插件上游仓库", metadata: vendor });
        sendJson(res, 200, { vendor, pluginCatalog: pluginCatalog(rootDir), plugins: pluginSettings(config, rootDir) });
        return;
      }

      if (pathname === "/api/admin/settings" && req.method === "GET") {
        requireDashboard(passport, session);
        sendJson(res, 200, { site: siteSettingsPayload(config), home: homeSettingsPayload(config), homeContent: homeContentPayload(config), plugins: pluginSettings(config, rootDir), pluginCatalog: pluginCatalog(rootDir) });
        return;
      }

      if (pathname === "/api/admin/settings" && req.method === "PUT") {
        requireDashboard(passport, session);
        const body = await readJsonBody(req);
        const changes = {};
        if (Object.prototype.hasOwnProperty.call(body, "site")) Object.assign(changes, sanitizeSiteSettings(body.site, config));
        if (Object.prototype.hasOwnProperty.call(body, "home")) changes.home = sanitizeHomeSettings(body.home, config.home);
        if (Object.prototype.hasOwnProperty.call(body, "homeContent")) changes.homeContent = sanitizeHomeContent(body.homeContent, config.homeContent);
        if (Object.prototype.hasOwnProperty.call(body, "plugins")) changes.plugins = sanitizePluginSettings(body.plugins, config.plugins, rootDir);
        saveSiteConfig(rootDir, config, changes);
        pages.clearCache();
        recordAudit(passport, req, session, { action: "settings.update", targetType: "site", targetId: "site.config", targetLabel: "站点设置", summary: "更新站点设置", metadata: { keys: Object.keys(changes) } });
        sendJson(res, 200, { site: siteSettingsPayload(config), home: homeSettingsPayload(config), homeContent: homeContentPayload(config), plugins: pluginSettings(config, rootDir), pluginCatalog: pluginCatalog(rootDir) });
        return;
      }

      if (pathname.startsWith("/api/admin/archives/") && pathname.endsWith("/restore") && req.method === "POST") {
        requireDashboard(passport, session);
        const parts = stripPrefix(pathname, "/api/admin/archives/").split("/").filter(Boolean).map(decodePathPart);
        const last = parts.pop();
        const archiveId = parts.pop();
        const slug = normalizeSlug(parts.join("/"));
        if (last !== "restore") {
          sendJson(res, 404, { error: "恢复接口不存在。" });
          return;
        }
        const restored = pages.restoreDeletedPage(slug, archiveId);
        if (!restored) {
          sendJson(res, 404, { error: "归档不存在。" });
          return;
        }
        const audit = passport.recordPageEdit(req, session, restored, { action: "restore" });
        knowledgeWrite(passport, restored, session, { action: "restore" });
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { ok: true, restored, editEvent: audit.event });
        return;
      }

      if (pathname === "/api/admin/archives" && req.method === "GET") {
        requireDashboard(passport, session);
        const pagination = readPagination(url, 20, 100);
        const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
        const allArchives = pages.listDeletedPages();
        const filtered = query ? allArchives.filter((item) => [item.slug, item.title, item.summary, item.author, item.archiveId].join(" ").toLowerCase().includes(query)) : allArchives;
        const items = filtered.slice(pagination.offset, pagination.offset + pagination.limit);
        sendJson(res, 200, { ...paginationPayload(items, filtered.length, pagination), archives: items });
        return;
      }

      if (pathname.startsWith("/api/admin/archives/") && req.method === "GET") {
        requireDashboard(passport, session);
        const parts = stripPrefix(pathname, "/api/admin/archives/").split("/").filter(Boolean).map(decodePathPart);
        const archiveId = parts.pop();
        const slug = normalizeSlug(parts.join("/"));
        const archive = pages.getDeletedPage(slug, archiveId);
        if (!archive) {
          sendJson(res, 404, { error: "\u5f52\u6863\u4e0d\u5b58\u5728\u3002" });
          return;
        }
        sendJson(res, 200, archive);
        return;
      }

      if (pathname.startsWith("/api/archives/") && req.method === "GET") {
        const parts = stripPrefix(pathname, "/api/archives/").split("/").filter(Boolean).map(decodePathPart);
        const archiveId = parts.pop();
        const slug = normalizeSlug(parts.join("/"));
        const archive = pages.getDeletedPage(slug, archiveId);
        if (!archive) {
          sendJson(res, 404, { error: "归档不存在。" });
          return;
        }
        sendJson(res, 200, archive);
        return;
      }
      const userFollowMatch = pathname.match(/^\/api\/users\/([^/]+)\/follow$/);
      if (userFollowMatch && req.method === "GET") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist Passport is not enabled." });
          return;
        }
        const username = decodePathPart(userFollowMatch[1]);
        const target = passport.getPublicUser(username);
        if (!target) {
          sendJson(res, 404, { error: "User not found." });
          return;
        }
        sendJson(res, 200, { follow: passport.userFollowState(session?.user?.id, target.id) });
        return;
      }

      if (userFollowMatch && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "Please sign in before following users." });
          return;
        }
        const body = await readJsonBody(req);
        const username = decodePathPart(userFollowMatch[1]);
        const follow = passport.setUserFollow(session, username, body.enabled !== false);
        sendJson(res, 200, { follow });
        return;
      }

      if (pathname.startsWith("/api/users/") && req.method === "GET") {
        if (!passport) {
          sendJson(res, 404, { error: "Wikist 通行证未启用。" });
          return;
        }
        const username = decodePathPart(stripPrefix(pathname, "/api/users/"));
        const profile = passport.getPublicUser(username);
        if (!profile) {
          sendJson(res, 404, { error: "用户不存在。" });
          return;
        }
        const user = userPayloadWithHtml(profile, config);
        user.follow = passport.userFollowState(session?.user?.id, profile.id);
        sendJson(res, 200, { user });
        return;
      }

      if (pathname === "/api/knowledge" && req.method === "GET") {
        if (!passport) {
          sendJson(res, 200, { stats: { pages: pages.listPages().length, links: 0, backlinks: 0, missing: 0, orphans: 0, aliases: 0, categories: 0 }, missing: [], orphans: [], categories: [] });
          return;
        }
        const snapshot = knowledgeSnapshot(passport, pages, config);
        sendJson(res, 200, {
          stats: snapshot.stats,
          missing: snapshot.missing.slice(0, 12),
          orphans: snapshot.orphans.slice(0, 12).map(pagePreviewPayload),
          categories: snapshot.categories.slice(0, 20),
          aliases: snapshot.aliases.slice(0, 20),
        });
        return;
      }

      if (pathname === "/api/knowledge/missing" && req.method === "GET") {
        const pagination = readPagination(url, 15, 80);
        const items = passport ? knowledgeSnapshot(passport, pages, config).missing : [];
        sendJson(res, 200, paginationPayload(items.slice(pagination.offset, pagination.offset + pagination.limit), items.length, pagination));
        return;
      }

      if (pathname === "/api/knowledge/orphans" && req.method === "GET") {
        const pagination = readPagination(url, 15, 80);
        const items = passport ? knowledgeSnapshot(passport, pages, config).orphans.map(pagePreviewPayload) : [];
        sendJson(res, 200, paginationPayload(items.slice(pagination.offset, pagination.offset + pagination.limit), items.length, pagination));
        return;
      }

      if (pathname === "/api/knowledge/aliases" && req.method === "GET") {
        const pagination = readPagination(url, 20, 100);
        const aliases = passport ? passport.listPageAliases({ limit: pagination.limit, offset: pagination.offset }) : [];
        const total = passport ? passport.countPageAliases() : 0;
        sendJson(res, 200, paginationPayload(aliases, total, pagination));
        return;
      }

      if (pathname === "/api/pages" && req.method === "GET") {
        sendJson(res, 200, pages.listPages().map((page) => ({
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          categories: page.categories,
          difficulty: page.difficulty,
          status: page.status,
          quality: page.quality,
          author: page.author,
          citationStats: page.citationStats,
          updatedAt: page.updatedAt,
          bytes: page.bytes,
        })));
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/preview") && req.method === "GET") {
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/preview");
        const resolved = resolveLivePage(pages, passport, slug);
        const page = pageWithAlias(resolved.page, resolved.requestedSlug, resolved.alias);
        sendJson(res, 200, page ? pagePreviewPayload(page) : { exists: false, slug });
        return;
      }

      const pageLinksMatch = pathname.match(/^\/api\/pages\/(.+)\/links$/);
      if (pageLinksMatch && req.method === "GET") {
        const resolved = resolveLivePage(pages, passport, decodePathPart(pageLinksMatch[1]));
        if (!resolved.page) {
          sendJson(res, 404, { error: "词条不存在。", slug: resolved.requestedSlug });
          return;
        }
        const knowledge = passport
          ? passport.pageKnowledge(resolved.page.slug, pages.listPages(), { defaultSlug: config.defaultPage || "home" })
          : { pageSlug: resolved.page.slug, outgoing: [], backlinks: [], aliases: [], stats: {} };
        sendJson(res, 200, knowledge);
        return;
      }

      const pageWatchMatch = pathname.match(/^\/api\/pages\/(.+)\/watch$/);
      if (pageWatchMatch && req.method === "GET") {
        const resolved = resolveLivePage(pages, passport, decodePathPart(pageWatchMatch[1]));
        if (!resolved.page) {
          sendJson(res, 404, { error: "词条不存在。", slug: resolved.requestedSlug });
          return;
        }
        sendJson(res, 200, {
          watch: passport
            ? passport.watchState(session?.user?.id, "page", resolved.page.slug)
            : { targetType: "page", targetKey: resolved.page.slug, watched: false, count: 0 },
        });
        return;
      }

      if (pageWatchMatch && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后关注词条。" });
          return;
        }
        const resolved = resolveLivePage(pages, passport, decodePathPart(pageWatchMatch[1]));
        if (!resolved.page) {
          sendJson(res, 404, { error: "词条不存在。", slug: resolved.requestedSlug });
          return;
        }
        const body = await readJsonBody(req);
        sendJson(res, 200, { watch: passport.setWatch(session, "page", resolved.page.slug, body.enabled !== false) });
        return;
      }

      const pageFavoriteMatch = pathname.match(/^\/api\/pages\/(.+)\/favorite$/);
      if (pageFavoriteMatch && req.method === "GET") {
        const resolved = resolveLivePage(pages, passport, decodePathPart(pageFavoriteMatch[1]));
        if (!resolved.page) {
          sendJson(res, 404, { error: "词条不存在。", slug: resolved.requestedSlug });
          return;
        }
        sendJson(res, 200, { favorite: passport ? passport.pageFavoriteState(session?.user?.id, resolved.page.slug) : { pageSlug: resolved.page.slug, favorited: false, count: 0 } });
        return;
      }

      if (pageFavoriteMatch && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后收藏词条。" });
          return;
        }
        const resolved = resolveLivePage(pages, passport, decodePathPart(pageFavoriteMatch[1]));
        const page = resolved.page;
        if (!page) {
          sendJson(res, 404, { error: "词条不存在。", slug: resolved.requestedSlug });
          return;
        }
        const body = await readJsonBody(req);
        sendJson(res, 200, { favorite: passport.setPageFavorite(session, page, body.favorited !== false) });
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/permissions") && req.method === "GET") {
        if (!passport) {
          sendJson(res, 200, { pageSlug: slugFromNestedPath(pathname, "/api/pages/", "/permissions"), editPolicy: "guest", commentPolicy: "guest", deletePolicy: "user" });
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/permissions");
        sendJson(res, 200, passport.getPagePermissions(slug));
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/permissions") && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再修改词条权限。" });
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/permissions");
        passport.assertCanManagePermissions(session);
        const body = await readJsonBody(req);
        const updated = passport.updatePagePermissions(slug, body, session.user.id);
        recordAudit(passport, req, session, { action: "page.permissions", targetType: "page", targetId: slug, targetLabel: slug, summary: "更新词条权限", metadata: updated });
        sendJson(res, 200, updated);
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/translations") && req.method === "GET") {
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/translations");
        const page = pages.getPage(slug);
        if (!page) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        sendJson(res, 200, {
          page: pagePreviewPayload(page),
          translations: passport ? passport.translationSummary(slug, page.body, config.languages || []) : [],
          translator: session?.user && passport ? passport.getTranslatorProfile(session.user.id) : null,
        });
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/translation/auto") && req.method === "POST") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后自动生成翻译初稿。" });
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/translation/auto");
        const page = pages.getPage(slug);
        if (!page) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        const draft = passport.autoTranslationDraft(session, slug, page, await readJsonBody(req));
        sendJson(res, 200, { draft });
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/translation") && req.method === "GET") {
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/translation");
        const page = pages.getPage(slug);
        if (!page) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        const language = url.searchParams.get("lang") || "en";
        const translation = passport ? passport.getTranslation(slug, language) : null;
        const renderedTranslation = translation?.translatedMd ? renderMarkdown(translation.translatedMd || "") : null;
        sendJson(res, 200, {
          source: { slug: page.slug, title: page.title, summary: page.summary, body: page.body, html: page.html, toc: page.toc, language: "zh-CN", updatedAt: page.updatedAt },
          translation: translation && renderedTranslation ? { ...translation, html: renderedTranslation.html, toc: renderedTranslation.toc } : translation,
          translations: passport ? passport.translationSummary(slug, page.body, config.languages || []) : [],
          translator: session?.user && passport ? passport.getTranslatorProfile(session.user.id) : null,
        });
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/translation") && req.method === "PUT") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后保存译文。" });
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/translation");
        const page = pages.getPage(slug);
        if (!page) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        const translation = passport.saveTranslation(session, slug, page, await readJsonBody(req, 2 * 1024 * 1024));
        recordAudit(passport, req, session, { action: "translation.save", targetType: "page", targetId: slug, targetLabel: page.title, summary: `保存 ${translation.language} 译文`, metadata: { language: translation.language, progress: translation.progress, status: translation.status } });
        knowledgeWrite(passport, page, session, {
          action: "translation",
          language: translation.language,
          senderName: session.user.displayName || session.user.username || "Wikist",
        });
        const renderedTranslation = renderMarkdown(translation.translatedMd || "");
        sendJson(res, 200, { translation: { ...translation, html: renderedTranslation.html, toc: renderedTranslation.toc }, translations: passport.translationSummary(slug, page.body, config.languages || []) });
        return;
      }

      const commentRepliesMatch = pathname.match(/^\/api\/pages\/(.+)\/comments\/(\d+)\/replies$/);
      if (commentRepliesMatch && req.method === "GET") {
        const pagination = readPagination(url, 6, 40);
        if (!passport) {
          sendJson(res, 200, paginationPayload([], 0, pagination));
          return;
        }
        const slug = normalizeSlug(decodePathPart(commentRepliesMatch[1]));
        const parentId = Number(commentRepliesMatch[2]);
        const replies = passport.listCommentReplies(slug, parentId, { limit: pagination.limit, offset: pagination.offset }).map(commentPayload);
        sendJson(res, 200, paginationPayload(replies, passport.countCommentReplies(slug, parentId), pagination));
        return;
      }

      const publicCommentDeleteMatch = pathname.match(/^\/api\/pages\/(.+)\/comments\/(\d+)$/);
      if (publicCommentDeleteMatch && req.method === "DELETE") {
        if (!passport) {
          sendJson(res, 404, { error: "评论系统未启用。" });
          return;
        }
        const slug = normalizeSlug(decodePathPart(publicCommentDeleteMatch[1]));
        const id = Number(publicCommentDeleteMatch[2]);
        const deleted = passport.deleteComment(req, session, id);
        if (deleted.pageSlug !== slug) {
          sendJson(res, 400, { error: "评论不属于当前词条。" });
          return;
        }
        recordAudit(passport, req, session, { action: "comment.delete", targetType: "comment", targetId: String(id), targetLabel: slug, summary: "删除自己的评论", metadata: { pageSlug: slug, parentId: deleted.parentId || null } });
        sendJson(res, 200, { comment: commentPayload(deleted) });
        return;
      }

      const pageRatingMatch = pathname.match(/^\/api\/pages\/(.+)\/rating$/);
      if (pageRatingMatch && req.method === "GET") {
        const slug = normalizeSlug(decodePathPart(pageRatingMatch[1]));
        if (!pages.getPage(slug)) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        sendJson(res, 200, { rating: passport ? passport.getPageRatingStats(slug, session) : { pageSlug: slug, average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, myRating: 0 } });
        return;
      }

      if (pageRatingMatch && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "评分系统未启用。" });
          return;
        }
        const slug = normalizeSlug(decodePathPart(pageRatingMatch[1]));
        if (!pages.getPage(slug)) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        const rated = passport.ratePage(req, session, slug, await readJsonBody(req));
        setCookieHeader(res, rated.cookie);
        sendJson(res, 200, { rating: rated.rating });
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/comments") && req.method === "GET") {
        const pagination = readPagination(url, 8, 50);
        if (!passport) {
          sendJson(res, 200, paginationPayload([], 0, pagination));
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/comments");
        const comments = passport.listComments(slug, { limit: pagination.limit, offset: pagination.offset }).map(commentPayload);
        sendJson(res, 200, paginationPayload(comments, passport.countComments(slug), pagination));
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/comments") && req.method === "POST") {
        if (!passport) {
          sendJson(res, 404, { error: "评论系统未启用。" });
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/comments");
        const created = passport.createComment(req, session, slug, await readJsonBody(req));
        setCookieHeader(res, created.cookie);
        sendJson(res, 200, commentPayload(created.comment));
        return;
      }

      if (pathname.startsWith("/api/pages/") && pathname.endsWith("/edits") && req.method === "GET") {
        const pagination = readPagination(url, 12, 80);
        if (!passport) {
          sendJson(res, 200, paginationPayload([], 0, pagination));
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/", "/edits");
        const edits = passport.listPageEdits(slug, { limit: pagination.limit, offset: pagination.offset });
        sendJson(res, 200, paginationPayload(edits, passport.countPageEdits(slug), pagination));
        return;
      }

      if (pathname.startsWith("/api/pages/") && req.method === "DELETE") {
        if (!passport || !session?.user) {
          sendJson(res, 401, { error: "请先登录后再删除词条。" });
          return;
        }
        const slug = slugFromNestedPath(pathname, "/api/pages/");
        passport.assertCanDelete(slug, session);
        const body = await readJsonBody(req);
        if (body.confirmSlug !== slug) {
          sendJson(res, 400, { error: "请确认要删除的词条 slug。" });
          return;
        }
        const deleted = pages.deletePage(slug);
        if (!deleted) {
          sendJson(res, 404, { error: "词条不存在。", slug });
          return;
        }
        const audit = passport.recordPageEdit(req, session, deleted, { action: "delete" });
        passport.removePageLinks(deleted.slug);
        passport.removePageAliasesForPage(deleted.slug);
        const notice = {
          action: "delete",
          actorUserId: session.user.id,
          senderName: session.user.displayName || session.user.username || "Wikist",
        };
        passport.notifyKnowledgeWatchers(deleted, notice);
        passport.notifyUserFollowers(deleted, notice);
        setCookieHeader(res, audit.cookie);
        sendJson(res, 200, { ok: true, deleted: { slug: deleted.slug, title: deleted.title, archiveId: deleted.archiveId, deletedAt: deleted.deletedAt }, editEvent: audit.event });
        return;
      }

      if (pathname.startsWith("/api/pages/") && req.method === "GET") {
        const slug = slugFromNestedPath(pathname, "/api/pages/");
        const resolved = resolveLivePage(pages, passport, slug);
        const page = pageWithAlias(resolved.page, resolved.requestedSlug, resolved.alias);
        if (!page) {
          sendJson(res, 404, { error: "词条不存在。", slug: resolved.requestedSlug });
          return;
        }
        sendJson(res, 200, page);
        return;
      }

      if (pathname.startsWith("/api/pages/") && (req.method === "POST" || req.method === "PUT")) {
        const slug = slugFromNestedPath(pathname, "/api/pages/");
        if (!isEditAllowed(req, config, session)) {
          sendJson(res, 403, { error: "编辑已关闭，或需要登录/有效令牌。" });
          return;
        }
        if (passport) passport.assertCanEdit(slug, session);

        const existing = pages.getPage(slug);
        const reservedAlias = !existing && passport?.resolvePageAlias(slug);
        if (reservedAlias) {
          sendJson(res, 409, { error: "该 slug 已作为别名指向其他词条，请先在后台调整别名。", slug, targetSlug: reservedAlias.targetSlug });
          return;
        }
        const body = await readJsonBody(req);
        const referencesError = citationInputError(body.references);
        if (referencesError) {
          sendJson(res, 400, { error: referencesError });
          return;
        }
        const managesAliases = Object.prototype.hasOwnProperty.call(body, "aliases") || Object.prototype.hasOwnProperty.call(body, "redirectTarget");
        if (managesAliases) {
          if (!passport?.userFollowState || !session?.user || !["creator", "editor", "senior_editor", "admin"].includes(session.user.role)) {
            sendJson(res, 403, { error: "只有创作组、资深编辑和管理员可以设置别名或重定向。" });
            return;
          }
          const aliases = Array.isArray(body.aliases)
            ? body.aliases
            : String(body.aliases || "").split(/[\n,]/);
          try {
            body.aliases = [...new Set(aliases.map((value) => normalizeSlug(String(value || "").trim())).filter(Boolean))];
          } catch (_error) {
            sendJson(res, 400, { error: "别名 slug 格式无效。" });
            return;
          }
          for (const aliasSlug of body.aliases) {
            if (aliasSlug !== slug && pages.getPage(aliasSlug)) {
              sendJson(res, 409, { error: `别名 ${aliasSlug} 与现有词条冲突。` });
              return;
            }
          }
          const redirectValue = String(body.redirectTarget || "").trim();
          if (redirectValue) {
            let redirectTarget;
            try { redirectTarget = normalizeSlug(redirectValue); } catch (_error) {
              sendJson(res, 400, { error: "重定向目标 slug 格式无效。" });
              return;
            }
            if (redirectTarget === slug || !pages.getPage(redirectTarget)) {
              sendJson(res, 409, { error: "重定向目标必须是另一个已存在的词条。" });
              return;
            }
            body.redirectTarget = redirectTarget;
          } else {
            body.redirectTarget = "";
          }
        }
        if (session?.user && !body.author) {
          const profile = passport?.getUserProfile(session.user.id);
          body.author = profile?.displayName || session.user.displayName || session.user.username;
        } else if (!session?.user && !body.author) {
          body.author = body.guestName ? `${body.guestName} · 访客` : "访客";
        }

        const page = pages.savePage(slug, body);
        let editEvent = null;
        if (passport) {
          const audit = passport.recordPageEdit(req, session, page, {
            action: existing ? "update" : "create",
            guest: {
              guestName: body.guestName,
              guestEmail: body.guestEmail,
              guestWebsite: body.guestWebsite,
            },
          });
          editEvent = audit.event;
          setCookieHeader(res, audit.cookie);
          if (managesAliases) passport.syncPageAliases(session, page, body.aliases, pages.listPages().map((item) => item.slug));
          knowledgeWrite(passport, page, session, {
            action: existing ? "update" : "create",
            senderName: body.author || "",
          });
        }
        sendJson(res, 200, { ...page, editEvent });
        return;
      }

      if (pathname === "/api/search" && req.method === "GET") {
        const searchSettings = pluginSettings(config, rootDir).advancedSearch || {};
        const pagination = readPagination(url, Number(searchSettings.pageSize) || 10, 50);
        sendJson(res, 200, search.search(url.searchParams.get("q") || "", {
          page: pagination.page,
          limit: pagination.limit,
          mode: url.searchParams.get("mode") || "balanced",
          category: url.searchParams.get("category") || "",
          quality: url.searchParams.get("quality") || "",
          difficulty: url.searchParams.get("difficulty") || "",
        }));
        return;
      }

      if (pathname === "/api/recent" && req.method === "GET") {
        sendJson(res, 200, pages.getRecent(12));
        return;
      }

      if (pathname.startsWith("/api/revisions/") && req.method === "GET") {
        const slug = normalizeSlug(decodePathPart(stripPrefix(pathname, "/api/revisions/")));
        sendJson(res, 200, pages.listRevisions(slug));
        return;
      }


      if (pathname.startsWith("/plugins/")) {
        const pluginAssetPath = safeJoin(path.join(rootDir, "plugins"), stripPrefix(pathname, "/plugins/"));
        const ext = pluginAssetPath ? path.extname(pluginAssetPath).toLowerCase() : "";
        const allowed = new Set([".js", ".mjs", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp"]);
        if (!pluginAssetPath || !allowed.has(ext)) {
          sendText(res, 403, "禁止访问");
          return;
        }
        const pluginCache = /\.(css|m?js)$/i.test(pluginAssetPath)
          ? "public, max-age=300, must-revalidate"
          : "public, max-age=86400";
        serveStatic(res, pluginAssetPath, { req, cacheControl: pluginCache });
        return;
      }

      if (pathname === "/install.html") {
        const installerPath = path.join(publicDir, "install.html");
        if (fs.existsSync(installerPath)) {
          serveStatic(res, installerPath, { req, cacheControl: "no-store" });
          return;
        }
      }

      if (pathname.startsWith("/uploads/")) {
        const uploadPath = safeJoin(path.join(publicDir, "uploads"), stripPrefix(pathname, "/uploads/"));
        const ext = uploadPath ? path.extname(uploadPath).toLowerCase() : "";
        const allowed = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico"]);
        if (!uploadPath || !allowed.has(ext)) {
          sendText(res, 403, "禁止访问");
          return;
        }
        serveStatic(res, uploadPath, { req, cacheControl: "public, max-age=86400, must-revalidate" });
        return;
      }

      if (pathname.startsWith("/assets/")) {
        const assetPath = safeJoin(publicDir, pathname);
        if (!assetPath) {
          sendText(res, 403, "禁止访问");
          return;
        }
        const versioned = url.searchParams.has("v");
        const mutableCore = /\/assets\/(?:app|styles|install)\.(?:css|js)$/i.test(pathname);
        const assetCache = versioned
          ? "public, max-age=31536000, immutable"
          : mutableCore
            ? "public, max-age=300, must-revalidate"
            : "public, max-age=86400, must-revalidate";
        serveStatic(res, assetPath, { req, cacheControl: assetCache });
        return;
      }

      const indexPath = path.join(publicDir, "index.html");
      if (fs.existsSync(indexPath)) {
        serveIndexHtml(req, res, indexPath, config);
        return;
      }

      sendText(res, 404, "Wikist 缺少 public/index.html。");
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "服务器内部错误。" });
    }
  });
}

module.exports = { createWikistServer };
