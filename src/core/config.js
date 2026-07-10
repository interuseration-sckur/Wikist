const fs = require("fs");
const path = require("path");
const { DEFAULT_PLUGINS } = require("./plugin-registry");

const defaults = {
  name: "Wikist",
  tagline: "Open mathematical knowledge",
  language: "zh-CN",
  defaultPage: "home",
  license: "CC BY-SA 4.0",
  math: {
    provider: "mathjax",
    cdn: "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js",
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

function hasSiteConfig(rootDir) {
  return fs.existsSync(siteConfigPath(rootDir));
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
    language,
    languages: ["zh-CN", "zh-TW", "en"],
    license: cleanText(input.license || "CC BY-SA 4.0", 80),
    assets: {
      cdnBase: cleanText(input.cdnBase, 500),
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
      baseUrl: cleanText(input.baseUrl, 500).replace(/\/$/, ""),
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
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { config, configPath };
}

function loadConfig(rootDir) {
  const configPath = siteConfigPath(rootDir);
  if (!fs.existsSync(configPath)) return defaults;
  const userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return mergeDeep(defaults, userConfig);
}

module.exports = {
  createInitialConfig,
  hasSiteConfig,
  loadConfig,
  siteConfigPath,
  writeInitialConfig,
};