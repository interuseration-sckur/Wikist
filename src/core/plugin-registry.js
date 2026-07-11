const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const VENDOR_STATUS_TTL_MS = 30000;
const vendorStatusCache = new Map();
const HOOK_API_VERSION = "1.0";
const HOOK_DEFINITIONS = Object.freeze({
  "markdown.preprocess": {
    side: "server",
    permission: "content:transform",
    label: "Markdown 预处理",
    description: "在 Markdown 解析前转换受控文本。",
  },
  "markdown.block": {
    side: "server",
    permission: "content:render",
    label: "块渲染",
    description: "把声明的围栏块转换为受控 HTML 占位结构。",
  },
  "search.enhance": {
    side: "server",
    permission: "search:enhance",
    label: "搜索增强",
    description: "在结果返回前整理受控搜索元数据。",
  },
  "admin.panel": {
    side: "client",
    permission: "ui:admin-panel",
    label: "后台面板",
    description: "注册一个受后台权限保护的前端管理面板。",
  },
});
const HOOK_NAMES = new Set(Object.keys(HOOK_DEFINITIONS));
const HOOK_PERMISSIONS = new Set(Object.values(HOOK_DEFINITIONS).map((item) => item.permission));
const coreHookHandlers = new Map(Object.keys(HOOK_DEFINITIONS).map((name) => [name, []]));
const DEFAULT_PLUGINS = {
  magicWords: {
    enabled: true,
    custom: {},
  },
  functionPlot: {
    enabled: true,
    d3Cdn: "",
    cdn: "https://cdn.jsdelivr.net/npm/function-plot@1.25.4/dist/function-plot.js",
    mathCdn: "https://cdn.jsdelivr.net/npm/mathjs@14.0.1/lib/browser/math.js",
    defaultHeight: 360,
    samples: 720,
    grid: true,
  },
  advancedSearch: {
    enabled: true,
    engine: "wikist-mini",
    fts5: true,
    fuzzy: true,
    prefix: true,
    pageSize: 10,
    titleWeight: 9,
    summaryWeight: 4,
    bodyWeight: 1,
    categoryWeight: 6,
  },
  openccChinese: {
    enabled: true,
    cdn: "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js",
    autoConvert: true,
  },
};

const PLUGIN_CATALOG = [
  {
    id: "magicWords",
    name: "Wikist 魔法词",
    type: "parser",
    source: "Wikist Core / MediaWiki-style magic words",
    description: "在渲染前替换 {{SITENAME}}、{{PAGENAME}}、{{CURRENTYEAR}} 等变量，并支持轻量解析函数。",
    syntax: [
      "{{SITENAME}}",
      "{{PAGENAME}}",
      "{{CURRENTYEAR}}",
      "{{#if: 条件 | 有内容 | 无内容 }}",
      "{{#ifeq: A | B | 相等 | 不相等 }}",
    ],
    configKeys: ["enabled", "custom"],
    hooks: ["markdown.preprocess"],
    permissions: ["content:transform"],
  },
  {
    id: "functionPlot",
    name: "函数图像渲染",
    type: "render-block",
    source: "mauriciopoppe/function-plot · MIT · D3.js",
    description: "把 Wikist 自制函数语法渲染为交互式二维函数图像。",
    syntax: [
      "::: function-plot",
      "```function-plot",
      "title: 正弦与余弦",
      "xDomain: -6.28, 6.28",
      "yDomain: -1.5, 1.5",
      "sin(x)",
      "cos(x)",
      ":::",
    ],
    configKeys: ["enabled", "d3Cdn", "cdn", "defaultHeight", "grid"],
    hooks: ["markdown.block"],
    permissions: ["content:render"],
  },
  {
    id: "advancedSearch",
    name: "Wikist 高级搜索",
    type: "search-engine",
    source: "Wikist Core / SQLite FTS5 + MiniSearch-style fallback",
    repository: "https://github.com/lucaong/minisearch",
    vendorDirectory: "minisearch",
    description: "优先使用可选 SQLite FTS5 持久索引，并保留轻量字段索引回退；支持分页、字段权重、前缀匹配、模糊匹配与分类/质量/难度过滤。",
    syntax: [
      "title:群 category:代数",
      "\"Lagrange theorem\" quality:A",
      "difficulty:本科 群论",
    ],
    configKeys: ["enabled", "engine", "fts5", "fuzzy", "prefix", "pageSize", "titleWeight", "summaryWeight", "bodyWeight", "categoryWeight"],
    defaultConfig: {
      enabled: true,
      engine: "wikist-mini",
      fts5: true,
      fuzzy: true,
      prefix: true,
      pageSize: 10,
      titleWeight: 9,
      summaryWeight: 4,
      bodyWeight: 1,
      categoryWeight: 6,
    },
    hooks: ["search.enhance"],
    permissions: ["search:enhance"],
  },
  {
    id: "openccChinese",
    name: "OpenCC 简繁转换",
    type: "i18n",
    source: "BYVoid/OpenCC / nk2028/opencc-js",
    repository: "https://github.com/nk2028/opencc-js",
    vendorDirectory: "opencc-js",
    description: "基于 opencc-js 的简体/繁体中文转换插件，用于 Wikist 前端显示层的 zh-CN / zh-TW 互换。",
    syntax: [
      "zh-CN -> zh-TW",
      "zh-TW -> zh-CN",
      "后台插件配置 openccChinese.cdn",
    ],
    configKeys: ["enabled", "cdn", "autoConvert"],
    defaultConfig: {
      enabled: true,
      cdn: "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js",
      autoConvert: true,
    },
  },
];

function manifestList(value, max = 40) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, max);
}

function normalizePluginHooks(value) {
  return manifestList(value).filter((name) => HOOK_NAMES.has(name));
}

function normalizePluginPermissions(value) {
  return manifestList(value).filter((name) => HOOK_PERMISSIONS.has(name));
}

function pluginHookCapabilities(manifest = {}) {
  const permissions = new Set(normalizePluginPermissions(manifest.permissions));
  return normalizePluginHooks(manifest.hooks).map((name) => {
    const definition = HOOK_DEFINITIONS[name];
    const granted = permissions.has(definition.permission);
    return {
      name,
      side: definition.side,
      permission: definition.permission,
      label: definition.label,
      description: definition.description,
      granted,
      state: granted ? "declared" : "blocked",
      detail: granted
        ? `${definition.permission} 已在 manifest 中声明。`
        : `缺少 ${definition.permission} 权限声明，Hook 不可注册。`,
    };
  });
}

function registerCoreHook(pluginId, hookName, handler) {
  const definition = HOOK_DEFINITIONS[hookName];
  if (!definition || definition.side !== "server" || typeof handler !== "function") return false;
  const handlers = coreHookHandlers.get(hookName);
  if (!handlers || handlers.some((item) => item.pluginId === pluginId && item.handler === handler)) return false;
  handlers.push({ pluginId: String(pluginId || "core"), handler });
  return true;
}

function runCoreHook(hookName, value, context = {}) {
  const handlers = coreHookHandlers.get(hookName) || [];
  return handlers.reduce((current, item) => {
    try {
      const next = item.handler(current, context);
      return next === undefined || next === null ? current : next;
    } catch (error) {
      console.warn(`Wikist core hook failed (${item.pluginId}:${hookName}):`, error.message);
      return current;
    }
  }, value);
}

function cleanManifest(manifest, directory = "core") {
  if (!manifest || typeof manifest !== "object" || !manifest.id) return null;
  const id = String(manifest.id || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,60}$/.test(id)) return null;
  return {
    id,
    name: String(manifest.name || id).slice(0, 80),
    type: String(manifest.type || "extension").slice(0, 40),
    version: String(manifest.version || "1.0.0").slice(0, 30),
    source: String(manifest.source || directory).slice(0, 220),
    description: String(manifest.description || "").slice(0, 500),
    syntax: Array.isArray(manifest.syntax) ? manifest.syntax.map((item) => String(item).slice(0, 500)).slice(0, 40) : [],
    configKeys: Array.isArray(manifest.configKeys) ? manifest.configKeys.map((item) => String(item).slice(0, 60)).slice(0, 40) : ["enabled"],
    hooks: normalizePluginHooks(manifest.hooks),
    permissions: normalizePluginPermissions(manifest.permissions),
    defaultConfig: manifest.defaultConfig && typeof manifest.defaultConfig === "object" ? manifest.defaultConfig : { enabled: true },
    entry: String(manifest.entry || "manifest-only").slice(0, 120),
    serverModule: cleanModulePath(manifest.serverModule),
    clientModule: cleanModulePath(manifest.clientModule),
    repository: String(manifest.repository || "").slice(0, 240),
    vendorDirectory: String(manifest.vendorDirectory || "").slice(0, 120),
    license: String(manifest.license || "").slice(0, 80),
    directory,
  };
}


function cleanModulePath(value) {
  const text = String(value || "").trim().replace(/\\/g, "/");
  if (!text || text.length > 180 || text.startsWith("/") || text.includes(":")) return "";
  const parts = text.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || !/^[\w.-]+$/.test(part))) return "";
  if (!/\.m?js$/i.test(parts[parts.length - 1])) return "";
  return parts.join("/");
}

function cleanRepositoryUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.endsWith(".git") ? text : `${text}.git`;
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/i.test(normalized) ? normalized : "";
}

function vendorDirectoryFromUrl(url) {
  const repo = String(url || "").replace(/\.git$/i, "").split("/").pop() || "";
  return /^[\w.-]{2,120}$/.test(repo) ? repo : "";
}

function safeVendorDirectory(value) {
  const text = String(value || "").trim();
  return /^[\w.-]{2,120}$/.test(text) ? text : "";
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (_error) {
    return "";
  }
}

function readPackedRef(gitDir, ref) {
  const packed = readTextFile(path.join(gitDir, "packed-refs"));
  if (!packed) return "";
  const line = packed.split(/\r?\n/).find((item) => item.endsWith(` ${ref}`));
  return line ? line.split(" ")[0].slice(0, 12) : "";
}

function readGitHeadMeta(vendorPath) {
  const gitDir = path.join(vendorPath, ".git");
  const head = readTextFile(path.join(gitDir, "HEAD"));
  if (!head) return { branch: "", commit: "" };
  if (!head.startsWith("ref:")) return { branch: "detached", commit: head.slice(0, 12) };
  const ref = head.replace(/^ref:\s*/, "").trim();
  const branch = ref.split("/").pop() || "";
  const commit = readTextFile(path.join(gitDir, ...ref.split("/"))).slice(0, 12) || readPackedRef(gitDir, ref);
  return { branch, commit };
}

function readGitRemote(vendorPath, fallback = "") {
  const config = readTextFile(path.join(vendorPath, ".git", "config"));
  const match = config.match(/\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/);
  return match ? match[1].trim() : fallback;
}
function gitOutput(args, cwd, timeout = 5000) {
  try {
    return childProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    }).trim();
  } catch (_error) {
    return "";
  }
}

function readPackageMeta(vendorPath) {
  const packagePath = path.join(vendorPath, "package.json");
  if (!fs.existsSync(packagePath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return {
      packageName: String(pkg.name || "").slice(0, 120),
      packageVersion: String(pkg.version || "").slice(0, 60),
      packageLicense: String(pkg.license || "").slice(0, 80),
    };
  } catch (_error) {
    return {};
  }
}

function pluginVendorStatus(rootDir, manifest, options = {}) {
  const repository = cleanRepositoryUrl(manifest.repository || manifest.source);
  const directory = safeVendorDirectory(manifest.vendorDirectory) || vendorDirectoryFromUrl(repository);
  if (!repository || !directory) return null;
  const cacheKey = `${rootDir}|${manifest.id}|${repository}|${directory}`;
  const cached = vendorStatusCache.get(cacheKey);
  if (!options.refresh && cached && Date.now() - cached.at < VENDOR_STATUS_TTL_MS) return { ...cached.value };
  const vendorRoot = path.join(rootDir, "plugins", "vendor");
  const vendorPath = path.join(vendorRoot, directory);
  const installed = fs.existsSync(path.join(vendorPath, ".git"));
  const packageMeta = installed || fs.existsSync(vendorPath) ? readPackageMeta(vendorPath) : {};
  const gitMeta = installed ? readGitHeadMeta(vendorPath) : { branch: "", commit: "" };
  const status = {
    supported: true,
    installed,
    repository,
    directory,
    path: `plugins/vendor/${directory}`,
    branch: gitMeta.branch,
    commit: gitMeta.commit,
    remote: installed ? readGitRemote(vendorPath, repository) : repository,
    ...packageMeta,
  };
  vendorStatusCache.set(cacheKey, { at: Date.now(), value: status });
  return { ...status };
}

function pluginRuntimeStatus(manifest, vendor = null) {
  const entry = String(manifest.entry || "manifest-only").trim();
  if (entry.startsWith("core:")) {
    return {
      state: "core-active",
      label: "核心执行中",
      executable: true,
      detail: "由 Wikist 核心渲染链直接执行。",
    };
  }
  if (manifest.clientModule && /^(clientModule|client-module|client:)$/i.test(entry)) {
    return {
      state: "client-active",
      label: "客户端模块执行中",
      executable: true,
      detail: "已通过 manifest 显式启用，页面会按需加载客户端模块。",
    };
  }
  if (manifest.serverModule && /^(serverModule|server-module|server:)$/i.test(entry)) {
    return {
      state: "server-declared",
      label: "服务端模块已声明",
      executable: false,
      detail: "服务端模块需要进入核心启动流程后才会执行。",
    };
  }
  if (manifest.serverModule || manifest.clientModule) {
    return {
      state: "module-ready",
      label: "模块待审查",
      executable: false,
      detail: "已声明模块入口，改为 clientModule 后才会在前台执行。",
    };
  }
  if (entry === "clone-ready") {
    return {
      state: vendor?.installed ? "vendor-ready" : "vendor-missing",
      label: vendor?.installed ? "源码已接入" : "等待拉取源码",
      executable: false,
      detail: vendor?.installed
        ? "GitHub 源码已缓存到 plugins/vendor，可审查后升级为 core 或模块入口。"
        : "已登记 GitHub 仓库，可在后台拉取到 plugins/vendor。",
    };
  }
  return {
    state: "manifest-only",
    label: "仅清单管理",
    executable: false,
    detail: "当前插件只参与后台登记、配置和文档展示。",
  };
}
function enrichPlugin(rootDir, manifest) {
  const vendor = pluginVendorStatus(rootDir, manifest);
  const runtime = pluginRuntimeStatus(manifest, vendor);
  const hookCapabilities = pluginHookCapabilities(manifest);
  return vendor ? { ...manifest, hookApiVersion: HOOK_API_VERSION, hookCapabilities, vendor, runtime } : { ...manifest, hookApiVersion: HOOK_API_VERSION, hookCapabilities, runtime };
}

function readPluginManifests(rootDir = process.cwd()) {
  const pluginsDir = path.join(rootDir, "plugins");
  if (!fs.existsSync(pluginsDir)) return [];
  return fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(pluginsDir, entry.name, "plugin.json");
      if (!fs.existsSync(manifestPath)) return null;
      try {
        return cleanManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")), entry.name);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);
}

function basePluginCatalog(rootDir = process.cwd()) {
  const byId = new Map(PLUGIN_CATALOG.map((plugin) => [plugin.id, cleanManifest(plugin, "core") || plugin]));
  for (const manifest of readPluginManifests(rootDir)) byId.set(manifest.id, manifest);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function pluginCatalog(rootDir = process.cwd()) {
  return basePluginCatalog(rootDir)
    .map((plugin) => enrichPlugin(rootDir, plugin))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function defaultPluginSettings(rootDir = process.cwd()) {
  const defaults = { ...DEFAULT_PLUGINS };
  for (const plugin of basePluginCatalog(rootDir)) {
    if (!defaults[plugin.id]) defaults[plugin.id] = plugin.defaultConfig || { enabled: true };
  }
  return defaults;
}
function mergeDeep(base, incoming) {
  const output = { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      output[key] = mergeDeep(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function pluginSettings(config = {}, rootDir = process.cwd()) {
  return mergeDeep(defaultPluginSettings(rootDir), config.plugins || {});
}

function syncVendorPlugin(rootDir, input = {}) {
  const catalog = pluginCatalog(rootDir);
  const plugin = input.id ? catalog.find((item) => item.id === String(input.id)) : cleanManifest(input, "manual");
  if (!plugin) {
    const error = new Error("插件不存在。");
    error.statusCode = 404;
    throw error;
  }
  const vendor = pluginVendorStatus(rootDir, plugin, { refresh: true });
  if (!vendor?.supported) {
    const error = new Error("该插件没有可拉取的 GitHub 仓库。");
    error.statusCode = 400;
    throw error;
  }
  const vendorRoot = path.join(rootDir, "plugins", "vendor");
  const vendorPath = path.join(vendorRoot, vendor.directory);
  fs.mkdirSync(vendorRoot, { recursive: true });
  let lastSyncWarning = "";
  if (fs.existsSync(path.join(vendorPath, ".git"))) {
    try {
      childProcess.execFileSync("git", ["-C", vendorPath, "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=8", "pull", "--ff-only"], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20000,
      });
    } catch (error) {
      lastSyncWarning = `仓库已安装，但更新检查失败：${error.message}`;
    }
  } else if (fs.existsSync(vendorPath) && fs.readdirSync(vendorPath).length) {
    const error = new Error(`vendor 目录已存在但不是 Git 仓库：plugins/vendor/${vendor.directory}`);
    error.statusCode = 409;
    throw error;
  } else {
    childProcess.execFileSync("git", ["-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=15", "clone", "--depth", "1", vendor.repository, vendorPath], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20000,
    });
  }
  return { ...pluginVendorStatus(rootDir, plugin, { refresh: true }), lastSyncWarning };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitArgs(value) {
  return String(value || "").split("|").map((item) => item.trim());
}

function safeExpr(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 160) return "";
  if (!/^[\w\s.+\-*/^(),=<>![\]:]+$/.test(text)) return "";
  return text;
}

function parseRange(value, fallback) {
  const parts = String(value || "").replace(/[\[\]]/g, "").split(",").map((item) => Number(item.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts : fallback;
}

function parseBox(value, fallback) {
  const parts = String(value || "").replace(/[\[\]]/g, "").split(",").map((item) => Number(item.trim()));
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : fallback;
}

function normalizeImplicitExpr(value) {
  const text = String(value || "").trim();
  const parts = text.split(/(?<![<>=!])=(?![=>])/);
  if (parts.length === 2) return safeExpr(`(${parts[0]}) - (${parts[1]})`);
  return safeExpr(text);
}

function needsMathEngine(expression) {
  return /\b(gamma|lgamma|erf|erfc|zeta|beta|factorial|combinations|permutations|sinc|besselj|besseli)\s*\(/i.test(String(expression || ""));
}

function parseFunctionPlotBlock(lines) {
  const options = {};
  const data = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const pair = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.+)$/);
    if (/^implicit\s*:/i.test(line)) {
      const fn = normalizeImplicitExpr(line.replace(/^implicit\s*:/i, ""));
      if (fn) data.push({ fn, fnType: "implicit", graphType: "interval", title: "隐函数" });
      continue;
    }
    if (pair && ["title", "xDomain", "yDomain", "height", "width", "grid", "engine", "samples"].includes(pair[1])) {
      options[pair[1]] = pair[2].trim();
      continue;
    }
    const labelled = line.match(/^([^:=]+)\s*:=\s*(.+)$/) || line.match(/^([^:=]+)\s*=\s*(.+)$/);
    if (labelled) {
      const label = labelled[1].replace(/^y\s*/i, "").trim();
      const fn = safeExpr(labelled[2]);
      if (fn) data.push({ fn, graphType: "polyline", title: label || fn });
      continue;
    }
    const fn = safeExpr(line.replace(/^y\s*=\s*/i, ""));
    if (fn) data.push({ fn, graphType: "polyline" });
  }
  return { options, data };
}

function functionPlotHtml(blockLines, settings) {
  const parsed = parseFunctionPlotBlock(blockLines);
  const height = Math.max(220, Math.min(Number(parsed.options.height) || Number(settings.defaultHeight) || 360, 760));
  const payload = {
    title: parsed.options.title || "函数图像",
    height,
    width: Number(parsed.options.width) || null,
    grid: String(parsed.options.grid || settings.grid) !== "false",
    xAxis: { domain: parseRange(parsed.options.xDomain, [-10, 10]) },
    yAxis: { domain: parseRange(parsed.options.yDomain, [-10, 10]) },
    data: parsed.data.length ? parsed.data.slice(0, 8) : [{ fn: "x", graphType: "polyline" }],
    engine: String(parsed.options.engine || "").toLowerCase() === "mathjs" ? "mathjs" : "",
    samples: Math.max(160, Math.min(Number(parsed.options.samples) || Number(settings.samples) || 720, 1800)),
  };
  payload.requiresMathjs = payload.engine === "mathjs" || payload.data.some((series) => needsMathEngine(series.fn));
  const json = JSON.stringify(payload);
  const encodedAttr = escapeHtml(json);
  const scriptJson = json.replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<figure class="wikist-plugin wikist-function-plot" data-plugin="functionPlot" data-config="${encodedAttr}"><figcaption>${escapeHtml(payload.title)}</figcaption><div class="function-plot-target" style="min-height:${height}px"></div><script type="application/json" class="function-plot-config">${scriptJson}</script><noscript>需要启用 JavaScript 才能渲染函数图像。</noscript></figure>`;
}

function parseGeometryBlock(lines) {
  const options = {};
  const points = [];
  const shapes = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const pair = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.+)$/);
    if (pair && ["title", "bbox", "height", "axis", "grid"].includes(pair[1])) {
      options[pair[1]] = pair[2].trim();
      continue;
    }
    const point = line.match(/^point\s+([a-zA-Z][\w-]{0,30})\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*\|\s*(.+))?$/i);
    if (point) {
      points.push({ id: point[1], x: Number(point[2]), y: Number(point[3]), label: String(point[4] || point[1]).slice(0, 40) });
      continue;
    }
    const shape = line.match(/^(segment|line|circle|polygon)\s+([a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*){1,7})$/i);
    if (shape) shapes.push({ type: shape[1].toLowerCase(), points: shape[2].trim().split(/\s+/).slice(0, 8) });
  }
  return { options, points: points.slice(0, 24), shapes: shapes.slice(0, 24) };
}

function geometryHtml(blockLines, settings) {
  const parsed = parseGeometryBlock(blockLines);
  const height = Math.max(220, Math.min(Number(parsed.options.height) || Number(settings.defaultHeight) || 380, 760));
  const payload = {
    title: parsed.options.title || "交互几何",
    height,
    bbox: parseBox(parsed.options.bbox, [-6, 6, 6, -6]),
    axis: String(parsed.options.axis || settings.axis) !== "false",
    grid: String(parsed.options.grid || settings.grid) !== "false",
    points: parsed.points,
    shapes: parsed.shapes,
  };
  const json = JSON.stringify(payload);
  const scriptJson = json.replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<figure class="wikist-plugin wikist-geometry-board" data-plugin="geometryBoard"><figcaption>${escapeHtml(payload.title)}</figcaption><div class="geometry-board-target" style="min-height:${height}px"></div><script type="application/json" class="geometry-board-config">${scriptJson}</script></figure>`;
}

function parseChartValues(value) {
  return String(value || "").split(",").map((item) => Number(item.trim())).filter(Number.isFinite).slice(0, 240);
}

function parseMathChartBlock(lines) {
  const options = {};
  const datasets = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const series = line.match(/^series\s*:\s*([^|]+)\|\s*([^|]+)(?:\|\s*(#[0-9a-fA-F]{3,8}))?$/i);
    if (series) {
      const values = parseChartValues(series[2]);
      if (values.length) datasets.push({ label: String(series[1]).trim().slice(0, 80), values, color: series[3] || "" });
      continue;
    }
    const pair = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.+)$/);
    if (pair && ["title", "type", "height", "labels", "xLabel", "yLabel", "grid"].includes(pair[1])) options[pair[1]] = pair[2].trim();
  }
  return { options, datasets: datasets.slice(0, 12) };
}

function mathChartHtml(blockLines, settings) {
  const parsed = parseMathChartBlock(blockLines);
  const height = Math.max(220, Math.min(Number(parsed.options.height) || Number(settings.defaultHeight) || 340, 720));
  const maxLength = Math.max(0, ...parsed.datasets.map((item) => item.values.length));
  const labels = String(parsed.options.labels || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 240);
  const payload = {
    title: parsed.options.title || "数据建模",
    type: ["line", "scatter", "bar"].includes(String(parsed.options.type || "").toLowerCase()) ? String(parsed.options.type).toLowerCase() : "line",
    height,
    grid: String(parsed.options.grid || settings.grid) !== "false",
    xLabel: String(parsed.options.xLabel || "").slice(0, 60),
    yLabel: String(parsed.options.yLabel || "").slice(0, 60),
    labels: labels.length ? labels : Array.from({ length: maxLength }, (_, index) => String(index + 1)),
    datasets: parsed.datasets,
  };
  const json = JSON.stringify(payload);
  const scriptJson = json.replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<figure class="wikist-plugin wikist-math-chart" data-plugin="mathChart"><figcaption>${escapeHtml(payload.title)}</figcaption><div class="math-chart-target" style="min-height:${height}px"><canvas></canvas></div><script type="application/json" class="math-chart-config">${scriptJson}</script></figure>`;
}

function magicValue(name, context, settings) {
  const now = new Date();
  const page = context.page || {};
  const config = context.config || {};
  const custom = settings.custom || {};
  const key = String(name || "").trim();
  if (Object.prototype.hasOwnProperty.call(custom, key)) return custom[key];
  const values = {
    SITENAME: config.name || "Wikist",
    TAGLINE: config.tagline || "",
    PAGENAME: page.title || page.slug || "",
    PAGESLUG: page.slug || "",
    CURRENTYEAR: String(now.getFullYear()),
    CURRENTMONTH: String(now.getMonth() + 1).padStart(2, "0"),
    CURRENTDAY: String(now.getDate()).padStart(2, "0"),
    CURRENTDATE: now.toISOString().slice(0, 10),
  };
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
}

function renderParserFunction(raw, context) {
  const [namePart, ...rest] = splitArgs(raw);
  const [name, first = ""] = namePart.split(":");
  const fn = String(name || "").trim().toLowerCase();
  const firstArg = [first.trim(), ...rest].filter((item, index) => item || index > 0);
  if (fn === "#if") return firstArg[0] ? (firstArg[1] || "") : (firstArg[2] || "");
  if (fn === "#ifeq") return firstArg[0] === firstArg[1] ? (firstArg[2] || "") : (firstArg[3] || "");
  if (fn === "#ifexpr") {
    const expr = safeExpr(firstArg[0]);
    if (!expr) return firstArg[2] || "";
    try {
      const ok = Function(`"use strict"; return (${expr});`)();
      return ok ? (firstArg[1] || "") : (firstArg[2] || "");
    } catch (_error) {
      return firstArg[2] || "";
    }
  }
  return null;
}

function applyMagicWords(source, context = {}, settings = DEFAULT_PLUGINS.magicWords) {
  if (!settings?.enabled) return String(source || "");
  return String(source || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, raw) => {
    const parserValue = raw.trim().startsWith("#") ? renderParserFunction(raw, context) : null;
    if (parserValue !== null) return parserValue;
    const value = magicValue(raw, context, settings);
    return value === null ? match : String(value);
  });
}

function runMarkdownPreprocessHooks(source, context = {}) {
  return runCoreHook("markdown.preprocess", String(source || ""), context);
}

function runMarkdownBlockHooks(input, context = {}) {
  const result = runCoreHook("markdown.block", { ...input, settings: pluginSettings(context.config || {}) }, context);
  return result?.handled ? result : null;
}

function runSearchEnhancementHooks(result, context = {}) {
  return runCoreHook("search.enhance", result, context);
}

registerCoreHook("magicWords", "markdown.preprocess", (source, context) => {
  const settings = pluginSettings(context.config || {});
  return applyMagicWords(source, context, settings.magicWords);
});

function matchesBlock(name, aliases) {
  return aliases.test(String(name || "").trim());
}

registerCoreHook("functionPlot", "markdown.block", (input) => {
  if (!matchesBlock(input.name, /^(function-plot|functionPlot|plot)$/i)) return null;
  const settings = input.settings.functionPlot || {};
  return { handled: true, html: settings.enabled === false ? "" : functionPlotHtml(input.lines || [], settings) };
});

registerCoreHook("geometryBoard", "markdown.block", (input) => {
  if (!matchesBlock(input.name, /^(geometry|jsxgraph|math-geometry)$/i)) return null;
  const settings = input.settings.geometryBoard || {};
  return { handled: true, html: settings.enabled === false ? "" : geometryHtml(input.lines || [], settings) };
});

registerCoreHook("mathChart", "markdown.block", (input) => {
  if (!matchesBlock(input.name, /^(math-chart|chart|model-chart)$/i)) return null;
  const settings = input.settings.mathChart || {};
  return { handled: true, html: settings.enabled === false ? "" : mathChartHtml(input.lines || [], settings) };
});

registerCoreHook("advancedSearch", "search.enhance", (result) => result);

function renderPluginFence(lang, blockLines, context = {}) {
  const result = runMarkdownBlockHooks({ style: "fence", name: lang, lines: blockLines }, context);
  return result ? result.html : null;
}

function matchPluginColonFence(line) {
  const match = String(line || "").trim().match(/^(:{3,})\s*([\w-]+)\b\s*(.*)$/);
  if (!match) return null;
  return { marker: match[1], name: match[2], meta: match[3] || "" };
}

function isPluginColonFenceClose(line, marker) {
  const size = Math.max(3, String(marker || ":::").length);
  return new RegExp(`^:{${size},}\\s*$`).test(String(line || "").trim());
}

function renderPluginBlock(lines, start, context = {}) {
  const trimmed = lines[start].trim();
  const fence = matchPluginColonFence(trimmed);
  if (!fence) return null;
  const block = [];
  let index = start + 1;
  while (index < lines.length && !isPluginColonFenceClose(lines[index], fence.marker)) {
    block.push(lines[index]);
    index += 1;
  }
  if (index < lines.length) index += 1;
  const result = runMarkdownBlockHooks({ style: "colon", name: fence.name, meta: fence.meta, lines: block }, context);
  if (result) return { html: result.html, next: index };
  return null;
}
module.exports = {
  HOOK_API_VERSION,
  HOOK_DEFINITIONS,
  DEFAULT_PLUGINS,
  PLUGIN_CATALOG,
  cleanManifest,
  basePluginCatalog,
  pluginCatalog,
  readPluginManifests,
  pluginVendorStatus,
  pluginRuntimeStatus,
  pluginHookCapabilities,
  normalizePluginHooks,
  normalizePluginPermissions,
  registerCoreHook,
  syncVendorPlugin,
  applyMagicWords,
  runMarkdownPreprocessHooks,
  runSearchEnhancementHooks,
  pluginSettings,
  renderPluginBlock,
  renderPluginFence,
};
