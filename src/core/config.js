const fs = require("fs");
const path = require("path");
const { DEFAULT_PLUGINS } = require("./plugin-registry");

const defaults = {
  name: "Wikist",
  tagline: "Open mathematical knowledge",
  publicUrl: "",
  deploymentMode: "development",
  language: "zh-CN",
  defaultPage: "home",
  license: "CC BY-SA 4.0",
  seo: {
    enabled: true,
    indexDrafts: false,
    sitemapPageSize: 500,
    brandAliases: [],
  },
  math: {
    provider: "mathjax",
    cdn: "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js",
  },
  assets: {
    cdnBase: "",
    customCss: "",
    customJs: "",
    siteIcon: "/assets/wikist-icon.png",
  },
  editing: {
    open: true,
    requireLogin: false,
    requireTokenEnv: "WIKIST_EDIT_TOKEN",
  },
  passport: {
    enabled: true,
    database: "data/wikist.sqlite",
    sessionDays: 7,
    captchaTTLSeconds: 300,
    requireEmailVerification: false,
    emailVerificationTTLSeconds: 1800,
    passwordResetTTLSeconds: 1200,
    twoFactorIssuer: "Wikist",
    twoFactorWindow: 1,
    sqliteBusyTimeoutMs: 10000,
  },
  security: {
    firewall: {
      enabled: true,
      trustedProxy: false,
      maxBodyBytes: 2097152,
      maxEntries: 12000,
      general: { points: 240, windowSeconds: 60, blockSeconds: 60 },
      health: { points: 600, windowSeconds: 60, blockSeconds: 20 },
      api: { points: 120, windowSeconds: 60, blockSeconds: 90 },
      write: { points: 48, windowSeconds: 60, blockSeconds: 120 },
      auth: { points: 16, windowSeconds: 60, blockSeconds: 300 },
      install: { points: 60, windowSeconds: 600, blockSeconds: 60 },
    },
  },
  mail: {
    enabled: false,
    fromName: "Wikist",
    fromAddress: "",
    baseUrl: "",
    smtp: {
      host: "",
      port: 587,
      secure: false,
      user: "",
      pass: "",
    },
  },
  hiddenPages: [],
  navigation: [],
};

function mergeDeep(base, incoming) {
  const output = { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = mergeDeep(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function siteConfigPath(rootDir) {
  return path.join(rootDir, "config", "site.config.json");
}

function writeSiteConfigFile(rootDir, value) {
  const configPath = siteConfigPath(rootDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (fs.existsSync(configPath) && fs.lstatSync(configPath).isSymbolicLink()) {
    throw new Error("站点配置文件不能是符号链接。");
  }
  const temporary = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, configPath);
    try { fs.chmodSync(configPath, 0o600); } catch (_) {}
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return configPath;
}

function hasSiteConfig(rootDir) {
  return fs.existsSync(siteConfigPath(rootDir));
}

function uninstallSiteConfig(rootDir) {
  const configPath = siteConfigPath(rootDir);
  if (!fs.existsSync(configPath)) {
    const error = new Error("当前站点没有可卸载的安装配置。");
    error.statusCode = 404;
    throw error;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(rootDir, "data", "backups", "config-uninstall");
  const backupPath = path.join(backupDir, `site.config.${stamp}.json`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.renameSync(configPath, backupPath);
  return {
    ok: true,
    removed: path.relative(rootDir, configPath).replace(/\\/g, "/"),
    backupPath: path.relative(rootDir, backupPath).replace(/\\/g, "/"),
    restartRequired: true,
  };
}

function cleanText(value, max = 240) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function cleanBoolean(value) {
  return value === true || value === "true" || value === "1" || value === 1 || value === "on";
}

function cleanInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(Math.round(number), max)) : fallback;
}

function cleanLanguage(value) {
  const language = cleanText(value, 20);
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language) ? language : "zh-CN";
}

function cleanAssetUrl(value, fallback = "") {
  const text = cleanText(value, 500);
  if (!text) return fallback;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(text)) return text;
  if (/^\/[^\s"'<>\\]+$/.test(text) && !text.startsWith("//")) return text;
  return fallback;
}

function cleanPublicUrl(value, deploymentMode = "development") {
  const text = cleanText(value, 500).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    parsed = null;
  }
  const mode = ["development", "single-production", "advanced"].includes(deploymentMode)
    ? deploymentMode
    : "development";
  const localHost = parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  const valid = parsed
    && ["http:", "https:"].includes(parsed.protocol)
    && parsed.host
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash
    && ["", "/"].includes(parsed.pathname);
  if (!valid || (mode === "single-production" && parsed.protocol !== "https:") || (mode !== "development" && localHost)) {
    const error = new Error(mode === "single-production"
      ? "单机生产模式必须填写公开的 HTTPS 站点地址。"
      : "站点公开地址必须是完整的 http(s) Origin，且不能包含路径、账号、查询参数或片段。");
    error.statusCode = 400;
    throw error;
  }
  return parsed.origin;
}

function cleanDatabasePath(value) {
  const database = cleanText(value || "data/wikist.sqlite", 260).replace(/\\/g, "/");
  if (!database || database.startsWith("/") || database.includes(":") || database.split("/").some((part) => part === ".." || !part)) {
    const error = new Error("数据库路径必须是项目内的相对 SQLite 文件，例如 data/wikist.sqlite。");
    error.statusCode = 400;
    throw error;
  }
  if (!/\.(sqlite|sqlite3|db)$/i.test(database)) {
    const error = new Error("数据库文件请使用 .sqlite、.sqlite3 或 .db 后缀。");
    error.statusCode = 400;
    throw error;
  }
  return database;
}

function createInitialConfig(input = {}) {
  const name = cleanText(input.name || "Wikist", 80) || "Wikist";
  const language = cleanLanguage(input.language);
  const deploymentMode = ["development", "single-production", "advanced"].includes(String(input.deploymentMode || ""))
    ? String(input.deploymentMode)
    : "development";
  const publicUrl = cleanPublicUrl(input.publicUrl || input.baseUrl, deploymentMode);
  const mailEnabled = cleanBoolean(input.mailEnabled);
  const smtpHost = cleanText(input.smtpHost, 180);
  if (mailEnabled && !smtpHost) {
    const error = new Error("启用 SMTP 时请填写 SMTP 主机地址。");
    error.statusCode = 400;
    throw error;
  }
  return mergeDeep(defaults, {
    name,
    tagline: cleanText(input.tagline || "Open mathematical knowledge", 240),
    publicUrl,
    deploymentMode,
    language,
    languages: ["zh-CN", "zh-TW", "en"],
    license: cleanText(input.license || "CC BY-SA 4.0", 80),
    seo: {
      enabled: true,
      indexDrafts: false,
      sitemapPageSize: 500,
      brandAliases: [],
    },
    assets: {
      cdnBase: cleanText(input.cdnBase, 500),
      siteIcon: cleanAssetUrl(input.siteIcon, defaults.assets.siteIcon),
      customCss: "",
      customJs: "",
    },
    editing: {
      open: cleanBoolean(input.openEditing),
      requireLogin: cleanBoolean(input.requireLogin),
    },
    passport: {
      enabled: true,
      database: cleanDatabasePath(input.database),
      sessionDays: cleanInteger(input.sessionDays, 7, 1, 90),
      requireEmailVerification: cleanBoolean(input.requireEmailVerification),
      twoFactorIssuer: name,
    },
    mail: {
      enabled: mailEnabled,
      fromName: cleanText(input.fromName || name, 80),
      fromAddress: cleanText(input.fromAddress, 160),
      baseUrl: publicUrl,
      smtp: {
        host: smtpHost,
        port: cleanInteger(input.smtpPort, 587, 1, 65535),
        secure: cleanBoolean(input.smtpSecure),
        user: cleanText(input.smtpUser, 180),
        pass: cleanText(input.smtpPass, 500),
      },
    },
    plugins: {
      ...DEFAULT_PLUGINS,
    },
    installation: {
      completedAt: new Date().toISOString(),
      channel: "web-installer",
    },
  });
}

function writeInitialConfig(rootDir, input = {}, options = {}) {
  const configPath = siteConfigPath(rootDir);
  if (fs.existsSync(configPath) && !options.force) {
    const error = new Error("当前站点已经配置完成。如需重新生成配置，请使用 WIKIST_INSTALL_MODE=1 启动后再操作。");
    error.statusCode = 409;
    throw error;
  }
  const config = createInitialConfig(input);
  writeSiteConfigFile(rootDir, config);
  return { config, configPath };
}

function loadConfig(rootDir) {
  const configPath = siteConfigPath(rootDir);
  const userConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""))
    : {};
  const config = mergeDeep(defaults, userConfig);
  const legacyPublicUrl = userConfig.publicUrl || userConfig.mail?.baseUrl || process.env.WIKIST_PUBLIC_URL || process.env.APP_URL || "";
  if (legacyPublicUrl) {
    try {
      config.publicUrl = cleanPublicUrl(legacyPublicUrl, userConfig.deploymentMode || "development");
    } catch (_) {
      config.publicUrl = "";
    }
  }
  config.deploymentMode = ["development", "single-production", "advanced"].includes(userConfig.deploymentMode)
    ? userConfig.deploymentMode
    : "development";
  if (!config.mail.baseUrl && config.publicUrl) config.mail.baseUrl = config.publicUrl;
  if (config.math?.cdn === "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js") {
    config.math.cdn = defaults.math.cdn;
  }
  if (process.env.WIKIST_PASSPORT_DATABASE) {
    config.passport.database = cleanDatabasePath(process.env.WIKIST_PASSPORT_DATABASE);
  }
  const legacyInstallPolicy = userConfig.security?.firewall?.install;
  if (
    Number(legacyInstallPolicy?.points) === 8
    && Number(legacyInstallPolicy?.windowSeconds) === 600
    && Number(legacyInstallPolicy?.blockSeconds) === 900
  ) {
    config.security.firewall.install = { ...defaults.security.firewall.install };
  }
  return config;
}

module.exports = {
  cleanPublicUrl,
  createInitialConfig,
  hasSiteConfig,
  loadConfig,
  siteConfigPath,
  writeSiteConfigFile,
  uninstallSiteConfig,
  writeInitialConfig,
};
