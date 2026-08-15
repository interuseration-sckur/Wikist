const THEME_KEY = "wikist-theme";
const LANG_KEY = "wikist-language";
const CORE_ASSET_VERSION = "wikist-core-20260815-191";
const RAIL_RECOMMENDATION_LIMIT = 5;
const RAIL_RECENT_LIMIT = 5;
const PAGE_SHARE_RECENT_DIRECT_LIMIT = 6;
const VDITOR_VERSION = "3.11.2";
const VDITOR_CDN = `https://cdn.jsdelivr.net/npm/vditor@${VDITOR_VERSION}`;
const SWEETALERT_VERSION = "11.26.25";
let activeEditor = null;
let vditorAssetsPromise = null;
let functionPlotAssetsPromise = null;
let functionPlotAssetsKey = "";
let functionPlotResizeObserver = null;
let mathJsAssetsPromise = null;
let mathJsAssetsKey = "";
let sweetAlertAssetsPromise = null;
let messagePopoverRequestId = 0;
const urgentMessagePopupIds = new Set();
let openccAssetsPromise = null;
let openccConverter = null;
let pluginModulePromises = new Map();
const pluginAdminPanels = new Map();
let hydrationTask = null;
let hydrationRoot = null;
let routeGeneration = 0;
let routePendingTimer = 0;
let userRefreshPromise = null;
let userLastFetchedAt = 0;
let firewallNoticeTimer = 0;
let firewallNoticeUntil = 0;
let suggestionInstanceId = 0;
const suggestionResponseCache = new Map();
const boundSuggestionInputs = new WeakSet();
let messagingBootstrap = null;
let messagingClient = null;
let messagingClientUserId = 0;
let messagingConversationSubscription = null;
let messagingActiveConversationId = "";
let messagingScrollFrame = 0;
let messagingPollTimer = 0;
let messagingPresenceTimer = 0;
let messagingHeartbeatTimer = 0;
let messagingBadgeTimer = 0;
let messagingEventTimer = 0;
let messagingReadReceiptTimer = 0;
let messagingTypingTimer = 0;
let messagingTypingIdleTimer = 0;
let messagingComposerState = { attachments: [], references: [], replyTo: null };
let messagingPresenceCache = new Map();
let messagingPresenceTtlMs = 40000;
let messagingPresenceClientId = "";
let messagingPresenceEventTimer = 0;
let messagingModerationRefreshPromise = null;
let messagingMentionState = { query: "", start: 0, end: 0, items: [], activeIndex: 0, timer: 0, requestId: 0 };
let messagingPreferences = { openMode: false, autoReplyEnabled: false, autoReplyText: "" };
let messagingWorkspaceState = {
  conversations: [],
  pagination: { page: 1, pages: 1, total: 0, limit: 24 },
  activeConversation: null,
  messages: [],
  hasMore: false,
  nextCursor: null,
  typingUsers: new Map(),
  presenceUsers: new Map(),
  memberPage: { items: [], page: 1, pages: 1, total: 0, limit: 12, private: false },
};
let completedRoute = null;
let selectionApiClient = null;
let selectionToolbar = null;
let focusedSelectionRouteKey = "";
const SELECTION_DRAFT_KEY = "wikist.selection.draft";

const state = {
  site: null,
  user: null,
  pages: [],
  pageTotal: 0,
  pagesComplete: true,
  recent: [],
  recentSeed: 0,
  recommendationPool: [],
  recommendationSeed: 0,
  recommendationSlug: "",
  homeDiscoverySeed: 0,
  currentSlug: "home",
  unreadMessages: 0,
  messagePopoverOpen: false,
  uiLanguage: "zh-CN",
  pageLanguage: "zh-CN",
};

function currentSiteName() {
  return String(state.site?.name || "Wikist").trim() || "Wikist";
}

function currentMessagingPresenceClientId() {
  if (messagingPresenceClientId) return messagingPresenceClientId;
  try {
    messagingPresenceClientId = sessionStorage.getItem("wikist.messaging.clientId") || "";
    if (!messagingPresenceClientId) {
      const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      messagingPresenceClientId = `web:${random}`;
      sessionStorage.setItem("wikist.messaging.clientId", messagingPresenceClientId);
    }
  } catch (_error) {
    messagingPresenceClientId = `web:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return messagingPresenceClientId;
}

function currentPassportName() {
  return `${currentSiteName()} 通行证`;
}

function passportUrl(mode = "login", token = "") {
  const query = new URLSearchParams({ mode });
  if (token) query.set("token", token);
  return `/passport?${query.toString()}`;
}

function redirectToPassport(mode = "login", token = "") {
  location.replace(passportUrl(mode, token));
}

const el = {
  siteName: document.querySelector("#siteName"),
  siteTagline: document.querySelector("#siteTagline"),
  sidebarAccount: document.querySelector("#sidebarAccount"),
  primaryNav: document.querySelector("#primaryNav"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  topSearchForm: document.querySelector("#topSearchForm"),
  topSearchInput: document.querySelector("#topSearchInput"),
  languageSelect: document.querySelector("#languageSelect"),
  breadcrumbs: document.querySelector("#breadcrumbs"),
  topQuickNav: document.querySelector("#topQuickNav"),
  passportLink: document.querySelector("#passportLink"),
  passportIcon: document.querySelector("#passportIcon"),
  passportText: document.querySelector("#passportText"),
  sidebarPassportLink: document.querySelector("#sidebarPassportLink"),
  themeToggle: document.querySelector("#themeToggle"),
  siteIconLink: document.querySelector("#siteIconLink"),
  siteBrandIcon: document.querySelector("#siteBrandIcon"),
  messageMenu: document.querySelector("#messageMenu"),
  messageLink: document.querySelector("#messageLink"),
  messageBadge: document.querySelector("#messageBadge"),
  messagePopover: document.querySelector("#messagePopover"),
  editLink: document.querySelector("#editLink"),
  topbarLogout: document.querySelector("#topbarLogout"),
  main: document.querySelector("#mainContent"),
  toc: document.querySelector("#tocList"),
  tocRailBlock: document.querySelector("#tocRailBlock"),
  recommendationRailBlock: document.querySelector("#recommendationRailBlock"),
  recommendationList: document.querySelector("#recommendationList"),
  recommendationLimit: document.querySelector("#recommendationLimit"),
  recommendationRefresh: document.querySelector("#recommendationRefresh"),
  recent: document.querySelector("#recentList"),
  recentLimit: document.querySelector("#recentLimit"),
  recentRefresh: document.querySelector("#recentRefresh"),
  footerSiteName: document.querySelector("#footerSiteName"),
  footerCopyright: document.querySelector("#footerCopyright"),
};

function renderSiteFooter() {
  if (el.footerSiteName) el.footerSiteName.textContent = currentSiteName();
  if (el.footerCopyright) {
    const license = String(state.site?.license || "CC BY-SA 4.0").trim() || "CC BY-SA 4.0";
    el.footerCopyright.textContent = `© ${new Date().getFullYear()} ${currentSiteName()}。除另有声明外，本站内容采用 ${license} 许可。`;
  }
}

function encodeSlug(slug) {
  return String(slug || "home").split("/").map(encodeURIComponent).join("/");
}

function selectionContentAttributes({ type, id, label, url, organizationSlug = "", pageSlug = "" }) {
  const attributes = [
    "data-selection-content",
    `data-selection-object-type="${escapeHtml(type)}"`,
    `data-selection-object-id="${escapeHtml(String(id))}"`,
    `data-selection-object-label="${escapeHtml(label)}"`,
    `data-selection-object-url="${escapeHtml(url)}"`,
  ];
  if (organizationSlug) attributes.push(`data-selection-organization-slug="${escapeHtml(organizationSlug)}"`);
  if (pageSlug) attributes.push(`data-selection-page-slug="${escapeHtml(pageSlug)}"`);
  return attributes.join(" ");
}

async function api(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: isFormData ? { ...(options.headers || {}) } : { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Math.max(0, Number(payload.retryAfter || response.headers.get("retry-after") || 0));
    if (response.status === 429) {
      showFirewallNotice(retryAfter);
      const error = new Error(retryAfter > 0 ? `请求过于频繁，请在 ${retryAfter} 秒后重试。` : "请求过于频繁，请稍后再试。");
      error.code = "rate_limited";
      error.retryAfter = retryAfter;
      error.statusCode = response.status;
      throw error;
    }
    if (response.status === 413) {
      const error = new Error("提交内容超过本站当前允许的大小，请精简后重试。");
      error.code = "body_too_large";
      error.statusCode = response.status;
      throw error;
    }
    const error = new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    error.code = payload.code || "request_failed";
    error.details = payload.details || null;
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function firewallNoticeNode() {
  let node = document.querySelector("#wikistFirewallNotice");
  if (node) return node;
  node = document.createElement("section");
  node.id = "wikistFirewallNotice";
  node.className = "wikist-system-overlay";
  node.hidden = true;
  node.setAttribute("role", "alertdialog");
  node.setAttribute("aria-modal", "true");
  node.setAttribute("aria-live", "assertive");
  document.body.appendChild(node);
  return node;
}

function showFirewallNotice(retryAfter = 0) {
  const seconds = Math.max(1, Math.ceil(Number(retryAfter) || 1));
  firewallNoticeUntil = Math.max(firewallNoticeUntil, Date.now() + seconds * 1000);
  const node = firewallNoticeNode();
  const render = () => {
    const remaining = Math.max(0, Math.ceil((firewallNoticeUntil - Date.now()) / 1000));
    const ready = remaining === 0;
    node.innerHTML = `<div class="wikist-system-grid" aria-hidden="true"></div><article class="wikist-system-card ${ready ? "is-ready" : ""}"><span class="wikist-system-mark" aria-hidden="true">&#9670;</span><p class="wikist-system-kicker">WIKIST REQUEST PROTECTION</p><h1>${ready ? "可以重新连接" : "请求保护已启用"}</h1><p class="wikist-system-copy">${ready ? "冷却窗口已结束。重新连接后将恢复正常浏览与编辑。" : "为保持知识库稳定，当前页面已暂时锁定；请在冷却结束后继续操作。"}</p><div class="wikist-system-countdown"><span>冷却时间</span><strong>${remaining}s</strong></div><button type="button" class="command-button wikist-system-retry" ${ready ? "" : "disabled"}>${ready ? "重新连接" : "等待冷却结束"}</button>${ready ? `<a href="#/page/${encodeSlug(state.site?.defaultPage || "home")}" class="wikist-system-home">返回首页</a>` : ""}</article>`;
    node.hidden = false;
    document.body.classList.toggle("wikist-protection-active", !ready);
    node.querySelector(".wikist-system-retry")?.addEventListener("click", () => window.location.reload(), { once: true });
    node.querySelector(".wikist-system-home")?.addEventListener("click", () => {
      window.clearInterval(firewallNoticeTimer);
      firewallNoticeTimer = 0;
      document.body.classList.remove("wikist-protection-active");
      node.hidden = true;
    }, { once: true });
    if (ready) window.clearInterval(firewallNoticeTimer);
  };
  window.clearInterval(firewallNoticeTimer);
  render();
  firewallNoticeTimer = window.setInterval(render, 1000);
}

function sweetAlertOptions(options = {}) {
  const classes = options.customClass || {};
  return {
    ...options,
    buttonsStyling: false,
    customClass: {
      popup: `wikist-swal-popup ${classes.popup || ""}`.trim(),
      title: `wikist-swal-title ${classes.title || ""}`.trim(),
      htmlContainer: `wikist-swal-copy ${classes.htmlContainer || ""}`.trim(),
      input: `wikist-swal-input ${classes.input || ""}`.trim(),
      actions: `wikist-swal-actions ${classes.actions || ""}`.trim(),
      confirmButton: `wikist-swal-confirm ${classes.confirmButton || ""}`.trim(),
      cancelButton: `wikist-swal-cancel ${classes.cancelButton || ""}`.trim(),
    },
  };
}

function siteAssetValue(key) {
  if (Object.prototype.hasOwnProperty.call(state.site || {}, key)) return state.site[key] || "";
  return state.site?.assets?.[key] || "";
}

function withCdnBase(path) {
  const value = String(path || "").trim();
  const configuredBase = String(siteAssetValue("cdnBase") || "").replace(/\/+$/, "");
  const base = /^https?:\/\//i.test(configuredBase) ? configuredBase : "";
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return value;
  const jsdelivr = value.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(.+)$/i);
  if (base && jsdelivr) return `${base}/npm/${jsdelivr[1]}`;
  if (/^(?:https?:)?\/\//i.test(value)) return value;
  if (!base || !/^\/(?:assets|plugins)\//.test(value)) return value;
  return `${base}${value}`;
}

function safeSiteIconUrl(value) {
  const fallback = "/assets/wikist-icon.png";
  const raw = String(value || fallback).trim();
  if (raw === "/assets/wikist-emblem.svg") return withCdnBase(fallback);
  if (/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
  if (/^\/[^\s"'<>\\]+$/.test(raw) && !raw.startsWith("//")) return withCdnBase(raw);
  return withCdnBase(fallback);
}

function applySiteIcon() {
  const icon = safeSiteIconUrl(siteAssetValue("siteIcon"));
  const link = el.siteIconLink || document.querySelector("link[rel~='icon']");
  if (link) link.href = icon;
  if (el.siteBrandIcon) el.siteBrandIcon.src = icon;
}

function ensureStylesheet(href, marker) {
  if (!href) return;
  const selector = marker ? `link[data-wikist-style="${marker}"]` : `link[href="${href}"]`;
  if (document.querySelector(selector)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  if (marker) link.dataset.wikistStyle = marker;
  document.head.appendChild(link);
}

async function ensureSweetAlert() {
  if (window.Swal?.fire) return window.Swal;
  if (!sweetAlertAssetsPromise) {
    sweetAlertAssetsPromise = (async () => {
      ensureStylesheet(withCdnBase(`/assets/vendor/sweetalert2/sweetalert2.min.css?v=${SWEETALERT_VERSION}`), "sweetalert2");
      await loadScript(withCdnBase(`/assets/vendor/sweetalert2/sweetalert2.all.min.js?v=${SWEETALERT_VERSION}`), "Swal", "弹窗资源加载失败。");
      await loadScript(withCdnBase(`/assets/vendor/sweetalert2/wikist-adapter.js?v=${SWEETALERT_VERSION}`), "", "弹窗适配器加载失败。");
      if (!window.Swal?.fire) throw new Error("弹窗资源已加载，但没有暴露 window.Swal。");
      return window.Swal;
    })();
  }
  return sweetAlertAssetsPromise;
}

async function uiAlert(title, text = "", icon = "info") {
  const Swal = await ensureSweetAlert().catch(() => null);
  if (!Swal) return undefined;
  return Swal.fire(sweetAlertOptions({ title, text, icon, confirmButtonText: "知道了" }));
}

async function uiConfirm({ title, text = "", icon = "question", confirmText = "确认", cancelText = "取消", danger = false } = {}) {
  const Swal = await ensureSweetAlert().catch(() => null);
  if (!Swal) return false;
  const result = await Swal.fire(sweetAlertOptions({
    title,
    text,
    icon,
    showCancelButton: true,
    focusCancel: danger,
    reverseButtons: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    customClass: { confirmButton: danger ? "is-danger" : "" },
  }));
  return Boolean(result.isConfirmed);
}

async function uiPrompt({ title, text = "", value = "", placeholder = "", confirmText = "确定", validator } = {}) {
  const Swal = await ensureSweetAlert().catch(() => null);
  if (!Swal) return null;
  const result = await Swal.fire(sweetAlertOptions({
    title,
    text,
    input: "text",
    inputValue: value,
    inputPlaceholder: placeholder,
    showCancelButton: true,
    reverseButtons: true,
    confirmButtonText: confirmText,
    cancelButtonText: "取消",
    inputValidator: validator,
  }));
  return result.isConfirmed ? String(result.value || "").trim() : null;
}

async function uiToast(title, icon = "success") {
  const Swal = await ensureSweetAlert().catch(() => null);
  if (!Swal) return undefined;
  return Swal.fire(sweetAlertOptions({
    title,
    icon,
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 2200,
    timerProgressBar: true,
    customClass: { popup: "wikist-swal-toast" },
  }));
}

function fmtDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function suggestionCacheKey(query, limit) {
  return `${String(query || "").normalize("NFKC").toLocaleLowerCase().trim()}|${limit}`;
}

async function fetchPageSuggestions(query, limit, signal) {
  const key = suggestionCacheKey(query, limit);
  const cached = suggestionResponseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  if (cached) suggestionResponseCache.delete(key);
  const payload = await api(`/api/search/suggest?q=${encodeURIComponent(query)}&limit=${limit}`, { signal });
  suggestionResponseCache.set(key, { payload, expiresAt: Date.now() + 30000 });
  if (suggestionResponseCache.size > 96) suggestionResponseCache.delete(suggestionResponseCache.keys().next().value);
  return payload;
}

function pageSuggestionOptionHtml(item, index, optionId) {
  const summary = String(item.summary || "").replace(/\s+/g, " ").trim();
  const meta = [item.matchedBy, item.quality ? `质量 ${item.quality}` : "", item.status === "stable" ? "稳定版本" : ""].filter(Boolean).join(" · ");
  return `<div class="async-suggest-option" id="${optionId}-${index}" role="option" aria-selected="false" data-suggestion-index="${index}"><span class="async-suggest-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m21 21-4.7-4.7m2-5.3a7.3 7.3 0 1 1-14.6 0 7.3 7.3 0 0 1 14.6 0Z"/></svg></span><span class="async-suggest-main"><span class="async-suggest-heading"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.slug)}</small></span>${summary ? `<span class="async-suggest-summary">${escapeHtml(summary)}</span>` : ""}</span><span class="async-suggest-meta">${escapeHtml(meta || "词条")}</span></div>`;
}

function bindPageSuggestions(input, options = {}) {
  if (!input || boundSuggestionInputs.has(input)) return;
  boundSuggestionInputs.add(input);
  const limit = Math.max(4, Math.min(Number(options.limit) || 8, 12));
  const selectionMode = options.selectionMode === "value" ? "value" : "navigate";
  const shell = document.createElement("div");
  const menu = document.createElement("div");
  const instanceId = `wikist-suggest-${++suggestionInstanceId}`;
  shell.className = "async-suggest-shell";
  menu.className = "async-suggest-menu";
  menu.id = instanceId;
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", selectionMode === "value" ? "选择关联词条" : "词条搜索建议");
  input.parentNode.insertBefore(shell, input);
  shell.append(input, menu);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", instanceId);
  input.setAttribute("aria-expanded", "false");

  let timer = 0;
  let requestId = 0;
  let controller = null;
  let activeIndex = -1;
  let items = [];

  const optionNodes = () => [...menu.querySelectorAll("[data-suggestion-index]")];
  const setActive = (next) => {
    const optionsList = optionNodes();
    if (!optionsList.length) { activeIndex = -1; return; }
    activeIndex = Math.max(0, Math.min(next, optionsList.length - 1));
    optionsList.forEach((node, index) => node.setAttribute("aria-selected", String(index === activeIndex)));
    const active = optionsList[activeIndex];
    input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    window.clearTimeout(timer);
    requestId += 1;
    controller?.abort();
    controller = null;
    menu.hidden = true;
    shell.classList.remove("open", "loading");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  };
  const choose = (index) => {
    const item = items[index];
    if (!item) return;
    if (selectionMode === "value") {
      input.value = item.slug;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
      close();
      return;
    }
    input.value = item.title;
    close();
    location.hash = `#/page/${encodeSlug(item.slug)}`;
  };
  const render = (payload, expectedQuery) => {
    if (!input.isConnected || input.value.trim() !== expectedQuery) return;
    items = Array.isArray(payload?.items) ? payload.items : [];
    activeIndex = -1;
    shell.classList.remove("loading");
    menu.innerHTML = items.length
      ? items.map((item, index) => pageSuggestionOptionHtml(item, index, instanceId)).join("")
      : '<div class="async-suggest-empty" role="status">没有匹配词条，按 Enter 搜索全文</div>';
    menu.hidden = false;
    shell.classList.add("open");
    input.setAttribute("aria-expanded", "true");
  };
  const requestSuggestions = () => {
    const query = input.value.trim();
    window.clearTimeout(timer);
    controller?.abort();
    controller = null;
    if (!query) { items = []; close(); return; }
    const currentRequest = ++requestId;
    timer = window.setTimeout(async () => {
      controller = new AbortController();
      shell.classList.add("loading");
      try {
        const payload = await fetchPageSuggestions(query, limit, controller.signal);
        if (currentRequest === requestId) render(payload, query);
      } catch (error) {
        if (error?.name !== "AbortError" && currentRequest === requestId) close();
      } finally {
        if (currentRequest === requestId) shell.classList.remove("loading");
      }
    }, 140);
  };

  input.addEventListener("input", (event) => { if (!event.isComposing) requestSuggestions(); });
  input.addEventListener("compositionend", requestSuggestions);
  input.addEventListener("focus", () => { if (input.value.trim()) requestSuggestions(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && !menu.hidden) { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === "ArrowUp" && !menu.hidden) { event.preventDefault(); setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1); }
    else if (event.key === "Enter" && !menu.hidden && activeIndex >= 0) { event.preventDefault(); choose(activeIndex); }
    else if (event.key === "Escape") close();
  });
  input.addEventListener("blur", () => window.setTimeout(() => {
    if (!shell.contains(document.activeElement)) close();
  }, 100));
  menu.addEventListener("pointerdown", (event) => event.preventDefault());
  menu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-suggestion-index]");
    if (option) choose(Number(option.dataset.suggestionIndex));
  });
  menu.addEventListener("mousemove", (event) => {
    const option = event.target.closest("[data-suggestion-index]");
    if (option) setActive(Number(option.dataset.suggestionIndex));
  });
}

const GROUP_LABELS = {
  member: "普通用户",
  creator: "创作者",
  editor: "编辑",
  senior_editor: "资深编辑",
  admin: "管理员",
};
const GROUP_RANK = { member: 0, creator: 1, editor: 2, senior_editor: 3, admin: 4 };
function normalizeRole(role) {
  const value = String(role || "member").trim();
  if (value === "senior" || value === "senior-editor") return "senior_editor";
  return GROUP_RANK[value] === undefined ? "member" : value;
}
function groupRank(role) { return GROUP_RANK[normalizeRole(role)] ?? 0; }
function userCan(minRole) { return Boolean(state.user) && groupRank(state.user.role) >= groupRank(minRole); }
function canAccessAdmin() { return Boolean(state.user?.capabilities?.staff || userCan("senior_editor")); }
function canManageUsers() { return Boolean(state.user?.capabilities?.manageUsers || userCan("admin")); }
function canManageContent() { return Boolean(state.user?.capabilities?.manageContent || userCan("senior_editor")); }
function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "dark" || value === "light") return value;
  } catch (_error) {}
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function themeIcon(theme) {
  if (theme === "dark") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/></svg>';
}

function vditorThemeName(theme = document.documentElement.dataset.theme) {
  return theme === "light" ? "classic" : "dark";
}

function vditorCodeThemeName(theme = document.documentElement.dataset.theme) {
  return theme === "light" ? "github" : "monokai";
}

function syncVisualEditorTheme(theme) {
  if (!activeEditor?.setTheme) return;
  try {
    const editorTheme = vditorThemeName(theme);
    activeEditor.setTheme(editorTheme, editorTheme, vditorCodeThemeName(theme));
  } catch (_error) {}
}

function applyTheme(theme, persist = true) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f6fbfa" : "#090d0d");
  if (persist) {
    try { localStorage.setItem(THEME_KEY, next); } catch (_error) {}
  }
  if (el.themeToggle) {
    el.themeToggle.innerHTML = themeIcon(next);
    el.themeToggle.title = next === "dark" ? "切换浅色主题" : "切换暗黑主题";
    el.themeToggle.setAttribute("aria-label", el.themeToggle.title);
  }
  syncVisualEditorTheme(next);
  refreshFunctionPlots();
  document.dispatchEvent(new CustomEvent("wikist:theme-change", { detail: { theme: next } }));
}

const UI_LABELS = {
  "zh-CN": {
    search: "搜索",
    searchPlaceholder: "搜索 Wikist",
    login: "登录",
    messages: "消息",
    newPage: "新建词条",
    editPage: "编辑词条",
    admin: "后台",
  },
  "zh-TW": {
    search: "搜尋",
    searchPlaceholder: "搜尋 Wikist",
    login: "登入",
    messages: "訊息",
    newPage: "新增詞條",
    editPage: "編輯詞條",
    admin: "後台",
  },
  en: {
    search: "Search",
    searchPlaceholder: "Search Wikist",
    login: "Sign in",
    messages: "Messages",
    newPage: "New page",
    editPage: "Edit page",
    admin: "Admin",
  },
};

const COMMON_LANGUAGE_LABELS = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  ar: "العربية",
  pt: "Português",
  it: "Italiano",
  vi: "Tiếng Việt",
};
const DEFAULT_LANGUAGE_CODES = ["zh-CN", "zh-TW", "en"];

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

function uniqueLanguages(list = []) {
  return Array.from(new Set(list.map((item) => normalizeLanguageCode(item, "")).filter(Boolean)));
}

function supportedLanguages(extra = []) {
  const languages = state.site?.languages || state.site?.site?.languages || DEFAULT_LANGUAGE_CODES;
  return uniqueLanguages([...DEFAULT_LANGUAGE_CODES, ...languages, state.site?.language, state.uiLanguage, ...extra]);
}

function languageLabel(lang) {
  const normalized = normalizeLanguageCode(lang, lang);
  if (COMMON_LANGUAGE_LABELS[normalized]) return COMMON_LANGUAGE_LABELS[normalized];
  try {
    const label = new Intl.DisplayNames([state.uiLanguage || "zh-CN", "zh-CN"], { type: "language" }).of(normalized);
    if (label) return `${label} · ${normalized}`;
  } catch (_error) {}
  return normalized;
}

function savedLanguage() {
  try {
    const value = localStorage.getItem(LANG_KEY);
    const normalized = normalizeLanguageCode(value, "");
    if (normalized) return normalized;
  } catch (_error) {}
  return normalizeLanguageCode(state.site?.language, "zh-CN");
}

function updateLanguageChrome() {
  const lang = state.uiLanguage || "zh-CN";
  const labels = UI_LABELS[lang] || UI_LABELS["zh-CN"];
  document.documentElement.lang = lang;
  document.documentElement.dataset.uiLanguage = lang;
  if (el.languageSelect) {
    const options = supportedLanguages([lang]);
    el.languageSelect.innerHTML = options.map((item) => `<option value="${item}" ${item === lang ? "selected" : ""}>${languageLabel(item)}</option>`).join("");
    el.languageSelect.insertAdjacentHTML("beforeend", '<option value="__custom">添加语言...</option>');
    el.languageSelect.value = lang;
    el.languageSelect.title = lang === "en" ? "Language" : "语言";
  }
  const searchPlaceholder = String(labels.searchPlaceholder || "").replace(/Wikist/g, currentSiteName());
  if (el.searchInput) el.searchInput.placeholder = lang === "en" ? "Search concepts, theorems, symbols or English terms" : searchPlaceholder;
  if (el.topSearchInput) el.topSearchInput.placeholder = searchPlaceholder;
  document.querySelectorAll("[data-i18n-title='search']").forEach((node) => {
    node.title = labels.search;
    node.setAttribute("aria-label", labels.search);
  });
  const messageLink = el.messageLink;
  if (messageLink) {
    messageLink.title = labels.messages;
    messageLink.setAttribute("aria-label", labels.messages);
  }
  const passportText = el.passportText;
  if (passportText && !state.user) passportText.textContent = labels.login;
  if (el.sidebarPassportLink && !state.user) el.sidebarPassportLink.textContent = currentPassportName();
  document.dispatchEvent(new CustomEvent("wikist:language-change", { detail: { language: lang, state } }));
}

const EN_UI_REPLACEMENTS = [
  ["导入、同步或导出词条，并保留可继续编辑的内容与词条链接。", "Import, sync, or export pages while keeping editable content and page links."],
  ["开放知识应该能自由迁移", "Open knowledge should move freely"],
  ["登录后可导入和同步词条；导出可直接使用，操作会记录到贡献。", "Sign in to import and sync pages. Export is available directly, and your actions are recorded as contributions."],
  ["导入前请先登录通行证", "Sign in before importing"],
  ["已登录", "Signed in"],
  ["未登录", "Signed out"],
  ["中文 Wikipedia", "Chinese Wikipedia"],
  ["中文源 · 简体显示", "Chinese source · Simplified"],
  ["中文源 · 繁体显示", "Chinese source · Traditional"],
  ["粘贴 Wikist JSON，或 Markdown 正文", "Paste Wikist JSON or Markdown body"],
  ["留空则自动生成", "Leave blank to generate automatically"],
  ["选择已导入词条并同步；本地标题、slug 与顶部大图会保留。", "Select an imported page to sync. Its local title, slug, and hero image are preserved."],
  ["后台控制台", "Admin"],
  ["Wikist 通行证", "Passport"],
  ["贡献规范", "Contributing"],
  ["首页", "Home"],
  ["资讯", "News"],
  ["标记规范", "Markup"],
  ["语法文档", "Syntax"],
  ["插件生态", "Plugin Ecosystem"],
  ["语法测试", "Syntax Lab"],
  ["协议", "Protocol"],
  ["教程", "Tutorial"],
  ["Wikist 起源", "Origin"],
  ["导入导出", "Import / Export"],
  ["导出词条", "Export Page"],
  ["导入 Wikist 文件", "Import Wikist File"],
  ["导入 Wikipedia", "Import Wikipedia"],
  ["同步 Wikipedia 导入词条", "Sync Wikipedia Page"],
  ["全站备份", "Site Backup"],
  ["后台概览", "Overview"],
  ["用户管理", "Users"],
  ["词条管理", "Pages"],
  ["评论管理", "Comments"],
  ["消息管理", "Messages"],
  ["归档页面", "Archives"],
  ["站点设置", "Site Settings"],
  ["插件管理", "Plugins"],
  ["正文", "Page"],
  ["编辑记录", "History"],
  ["评论", "Comments"],
  ["权限", "Permissions"],
  ["编辑", "Edit"],
  ["查询", "Search"],
  ["搜索", "Search"],
  ["导出", "Export"],
  ["导入", "Import"],
  ["同步", "Sync"],
  ["保存", "Save"],
  ["登录", "Sign in"],
  ["注册", "Sign up"],
  ["返回首页", "Back Home"],
  ["返回 wiki", "Back to Wiki"],
  ["最近更新", "Recent"],
  ["目录", "Contents"],
  ["词条", "Page"],
  ["标题", "Title"],
  ["摘要", "Summary"],
  ["格式", "Format"],
  ["语言", "Language"],
  ["目标 slug", "Target slug"],
  ["允许覆盖已有词条", "Allow overwrite"],
  ["从 Wikipedia 导入", "Import from Wikipedia"],
];

function openccSource() {
  return withCdnBase(state.site?.plugins?.openccChinese?.cdn || "/plugins/vendor/opencc-js/full.js");
}

async function ensureOpenCC() {
  if (window.OpenCC?.Converter) return window.OpenCC;
  if (!openccAssetsPromise) openccAssetsPromise = loadScript(openccSource(), "OpenCC", "OpenCC 简繁转换插件加载失败。");
  await openccAssetsPromise;
  return window.OpenCC;
}

function textNodesUnder(root, options = {}) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script,style,textarea,input,select,code,pre,.vditor")) return NodeFilter.FILTER_REJECT;
      if (options.skipArticle && parent.closest(".article-body,.comment-body,.math-block,.footnotes")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function hydrateEnglishUi(root = document.body) {
  textNodesUnder(root, { skipArticle: true }).forEach((node) => {
    if (!node._wikistOriginalText) node._wikistOriginalText = node.nodeValue;
    let text = node._wikistOriginalText;
    for (const [from, to] of EN_UI_REPLACEMENTS) {
      text = text.split(from).join(to);
    }
    node.nodeValue = text;
  });
}

async function hydrateLanguageConversion(root = document.body) {
  const lang = state.uiLanguage || "zh-CN";
  if (lang === "en") {
    hydrateEnglishUi(root);
    return;
  }
  if (lang !== "zh-TW") return;
  const settings = state.site?.plugins?.openccChinese || {};
  if (settings.enabled === false || settings.autoConvert === false) return;
  try {
    const OpenCC = await ensureOpenCC();
    if (!openccConverter) openccConverter = OpenCC.Converter({ from: "cn", to: "tw" });
    textNodesUnder(root).forEach((node) => {
      if (!node._wikistOriginalText) node._wikistOriginalText = node.nodeValue;
      node.nodeValue = openccConverter(node._wikistOriginalText);
    });
  } catch (error) {
    console.warn("OpenCC conversion failed:", error);
  }
}

function restoreLanguageConversion(root = document.body) {
  textNodesUnder(root).forEach((node) => {
    if (node._wikistOriginalText) node.nodeValue = node._wikistOriginalText;
  });
}

function setUiLanguage(lang, persist = true) {
  state.uiLanguage = normalizeLanguageCode(lang, "zh-CN");
  if (persist) {
    try { localStorage.setItem(LANG_KEY, state.uiLanguage); } catch (_error) {}
  }
  restoreLanguageConversion(document.body);
  updateLanguageChrome();
  hydrateLanguageConversion(document.body).catch(() => {});
}

function applySiteCustomizations() {
  const css = siteAssetValue("customCss");
  let style = document.querySelector("style[data-wikist-custom-css]");
  if (!style) {
    style = document.createElement("style");
    style.dataset.wikistCustomCss = "true";
    document.head.appendChild(style);
  }
  style.textContent = css;

  const js = siteAssetValue("customJs");
  if (!js.trim()) return;
  try {
    window.WikistCustom = { site: state.site, api, route };
    Function("window", "document", "Wikist", `"use strict";\n${js}`)(window, document, window.WikistCustom);
  } catch (error) {
    console.warn("Wikist custom JS failed:", error);
  }
}
applyTheme(savedTheme(), false);

function destroyVisualEditor() {
  if (activeEditor?.destroy) {
    try { activeEditor.destroy(); } catch (_error) {}
  }
  activeEditor = null;
}

function loadScript(src, globalName = "", errorMessage = "资源加载失败。") {
  return new Promise((resolve, reject) => {
    src = withCdnBase(src);
    if (globalName && window[globalName]) { resolve(); return; }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") { resolve(); return; }
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error(errorMessage)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new Error(errorMessage));
    document.head.appendChild(script);
  });
}

function ensureVisualEditorAssets() {
  if (window.Vditor) return Promise.resolve();
  if (!document.querySelector("link[data-vditor-css]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = withCdnBase(`${VDITOR_CDN}/dist/index.css`);
    link.dataset.vditorCss = "true";
    document.head.appendChild(link);
  }
  if (!vditorAssetsPromise) vditorAssetsPromise = loadScript(`${VDITOR_CDN}/dist/index.min.js`, "Vditor", "可视化编辑器资源加载失败。");
  return vditorAssetsPromise;
}

async function mountVisualEditor(value) {
  destroyVisualEditor();
  const host = document.querySelector("#visualEditor");
  const fallback = document.querySelector("#editorBodyFallback");
  if (!host || !fallback) return null;
  host.innerHTML = '<div class="visual-editor-loading">正在加载可视化编辑器...</div>';
  try {
    await ensureVisualEditorAssets();
    host.innerHTML = "";
    activeEditor = new Vditor(host, {
      value: value || "",
      mode: "wysiwyg",
      height: 560,
      minHeight: 420,
      lang: "zh_CN",
      cdn: withCdnBase(VDITOR_CDN),
      theme: vditorThemeName(),
      cache: { enable: false },
      toolbarConfig: { pin: true },
      customWysiwygToolbar: () => {},
      counter: { enable: true, type: "markdown" },
      placeholder: "写下定义、定理、证明与公式；可直接用可视化工具插入数学表达式。",
      preview: { markdown: { codeBlockPreview: true }, math: { inlineDigit: true }, hljs: { enable: true, lineNumber: true, style: vditorCodeThemeName() } },
      after: () => {
        fallback.classList.add("textarea-hidden");
        host.classList.add("ready");
        syncVisualEditorTheme(document.documentElement.dataset.theme);
      },
    });
    return activeEditor;
  } catch (error) {
    host.innerHTML = `<p class="muted-line">${escapeHtml(error.message)} 已切换为 Markdown 源码编辑。</p>`;
    fallback.classList.remove("textarea-hidden");
    return null;
  }
}

function readEditorBody(form) {
  if (activeEditor?.getValue) return activeEditor.getValue();
  return form.elements.body?.value || "";
}
function setChromeTitle(title) {
  const siteName = currentSiteName();
  document.title = title ? `${title} - ${siteName}` : siteName;
  el.breadcrumbs.textContent = title ? `${siteName} / ${title}` : siteName;
}

function renderPassportLink() {
  if (!el.passportLink || !el.passportText) return;
  if (state.user) {
    el.passportLink.href = "#/account";
    el.passportText.textContent = state.user.displayName || state.user.username;
    el.passportLink.setAttribute("aria-label", "账户中心");
    el.passportLink.setAttribute("title", "进入账户中心");
    el.passportLink.classList.add("signed-in");
    if (el.passportIcon) el.passportIcon.innerHTML = avatarHtml(state.user, "small");
    if (el.topbarLogout) el.topbarLogout.hidden = false;
    if (el.sidebarPassportLink) {
      el.sidebarPassportLink.href = "#/account";
      el.sidebarPassportLink.textContent = "账户中心";
    }
    if (el.sidebarAccount) {
      const group = state.user.groupLabel || GROUP_LABELS[state.user.role] || state.user.role || "成员";
      el.sidebarAccount.innerHTML = `<a class="sidebar-account-link" href="#/account">${avatarHtml(state.user, "small")}<span><strong>${escapeHtml(state.user.displayName || state.user.username)}</strong><small>${escapeHtml(group)} · ${Number(state.user.stats?.edits || 0)} 次编辑</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>`;
    }
  } else {
    el.passportLink.href = passportUrl("login");
    const labels = UI_LABELS[state.uiLanguage] || UI_LABELS["zh-CN"];
    el.passportText.textContent = labels.login;
    el.passportLink.setAttribute("aria-label", `${labels.login} ${currentPassportName()}`);
    el.passportLink.setAttribute("title", `${labels.login} ${currentPassportName()}`);
    el.passportLink.classList.remove("signed-in");
    if (el.passportIcon) el.passportIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>';
    if (el.topbarLogout) el.topbarLogout.hidden = true;
    if (el.sidebarPassportLink) {
      el.sidebarPassportLink.href = passportUrl("login");
      el.sidebarPassportLink.textContent = currentPassportName();
    }
    if (el.sidebarAccount) {
      el.sidebarAccount.innerHTML = `<a class="sidebar-account-link guest" href="${passportUrl("login")}"><span class="sidebar-account-guest" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 7a7 7 0 0 1 14 0"/></svg></span><span><strong>访客模式</strong><small>登录后同步贡献身份</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>`;
    }
  }
}

async function logoutSiteSession(destination = `#/page/${encodeSlug(state.site?.defaultPage || "home")}`) {
  if (state.user) {
    await api("/api/messaging/presence/offline", {
      method: "POST",
      body: JSON.stringify({ clientId: currentMessagingPresenceClientId() }),
    }).catch(() => {});
  }
  await api("/api/passport/logout", { method: "POST", body: "{}" }).catch(() => {});
  stopMessagingHeartbeat();
  disconnectMessagingRealtime();
  stopMessagingWorkspacePolling();
  state.user = null;
  userLastFetchedAt = 0;
  renderPassportLink();
  renderNav();
  renderTopQuickNav();
  renderMessageBadge();
  if (String(destination).startsWith("#")) {
    if (location.hash === destination) await route();
    else location.hash = destination;
    return;
  }
  location.assign(destination);
}

function renderMessageBadge() {
  if (!el.messageMenu || !el.messageLink || !el.messageBadge) return;
  if (!state.user) {
    el.messageMenu.hidden = true;
    el.messageBadge.hidden = true;
    state.unreadMessages = 0;
    closeMessagePopover();
    return;
  }
  el.messageMenu.hidden = false;
  const unread = Number(state.unreadMessages || 0);
  el.messageBadge.hidden = unread <= 0;
  el.messageBadge.textContent = unread > 99 ? "99+" : String(unread);
  el.messageLink.classList.toggle("has-unread", unread > 0);
}

function messagePriorityMeta(priority) {
  return ({ urgent: { label: "\u6700\u9ad8\u4f18\u5148\u7ea7", tone: "urgent" }, high: { label: "\u9ad8\u4f18\u5148\u7ea7", tone: "high" }, low: { label: "\u4f4e\u4f18\u5148\u7ea7", tone: "low" }, normal: { label: "\u666e\u901a", tone: "normal" } })[String(priority || "normal").toLowerCase()] || { label: "\u666e\u901a", tone: "normal" };
}

function closeMessagePopover() {
  state.messagePopoverOpen = false;
  if (el.messagePopover) el.messagePopover.hidden = true;
  if (el.messageLink) el.messageLink.setAttribute("aria-expanded", "false");
}

async function showUrgentMessage(message) {
  const Swal = await ensureSweetAlert().catch(() => null);
  if (!Swal) return;
  const result = await Swal.fire(sweetAlertOptions({
    title: message.title || "\u6700\u9ad8\u4f18\u5148\u7ea7\u6d88\u606f",
    text: message.body || "\u4f60\u6709\u4e00\u6761\u9700\u8981\u53ca\u65f6\u67e5\u770b\u7684\u7ad9\u5185\u6d88\u606f\u3002",
    icon: "warning",
    toast: true,
    position: "top-end",
    showCloseButton: true,
    showConfirmButton: Boolean(message.sourceUrl),
    confirmButtonText: message.sourceLabel || "\u67e5\u770b",
    timer: Math.max(3000, Math.min(Number(message.displaySeconds || 7) * 1000, 60000)),
    timerProgressBar: true,
    customClass: { popup: "wikist-swal-toast wikist-priority-toast" },
  }));
  if (result.isConfirmed && message.sourceUrl) location.hash = message.sourceUrl;
}

async function refreshUnifiedMessageBadge() {
  if (!state.user) {
    renderMessageBadge();
    return;
  }
  const payload = await api("/api/messaging/inbox?limit=1").catch(() => null);
  if (!payload) return;
  state.unreadMessages = Number(payload.unreadCount || 0);
  renderMessageBadge();
  const urgent = (payload.items || []).find((conversation) => Number(conversation.unreadCount || 0) > 0 && conversation.lastMessage?.priority === "urgent");
  if (urgent) showUnifiedUrgentConversation(urgent);
}

function showUnifiedUrgentConversation(conversation, message = conversation?.lastMessage) {
  if (!conversation || !message || message.priority !== "urgent" || message.mine) return;
  const key = `${state.user?.id || "user"}:${message.id}`;
  if (urgentMessagePopupIds.has(key)) return;
  urgentMessagePopupIds.add(key);
  showUrgentMessage({
    id: message.id,
    title: conversation.title || "最高优先级消息",
    body: message.preview || message.bodyPlain || message.bodyMd || "你有一条需要及时查看的站内消息。",
    sourceUrl: `#/messages/${encodeURIComponent(conversation.id)}`,
    sourceLabel: "打开会话",
    displaySeconds: Number(message.metadata?.displaySeconds || 9),
  }).catch(() => {});
}

function messagingConversationPreviewHtml(conversation) {
  const unread = Number(conversation.unreadCount || 0);
  const last = conversation.lastMessage || {};
  const preview = last.preview || conversation.description || "暂无消息";
  return `<button class="message-preview-item messaging-preview-item ${unread ? "unread" : ""}" type="button" data-messaging-preview="${escapeHtml(conversation.id)}"><span class="messaging-preview-avatar">${avatarHtml({ displayName: conversation.title, username: conversation.title, avatarUrl: conversation.avatarUrl }, "small")}</span><span class="messaging-preview-copy"><span class="message-preview-top"><strong>${escapeHtml(conversation.title || "未命名会话")}</strong>${unread ? `<span class="message-unread-count">${unread > 99 ? "99+" : unread}</span>` : ""}</span><span>${escapeHtml(shortText(preview, 92))}</span><small>${last.createdAt ? fmtDate(last.createdAt) : conversation.kind === "organization" ? "组织群聊" : conversation.kind === "system" ? "系统通知" : "私信"}</small></span></button>`;
}

async function renderUnifiedMessagePopover() {
  if (!state.user || !el.messagePopover || !state.messagePopoverOpen) return;
  const requestId = ++messagePopoverRequestId;
  el.messagePopover.hidden = false;
  el.messagePopover.innerHTML = `<div class="message-popover-loading">正在同步通信数据...</div>`;
  try {
    const payload = await api("/api/messaging/inbox?limit=10");
    if (!state.messagePopoverOpen || requestId !== messagePopoverRequestId) return;
    state.unreadMessages = Number(payload.unreadCount || 0);
    renderMessageBadge();
    const conversations = payload.items || [];
    const visible = conversations.slice(0, 4);
    const folded = conversations.slice(4);
    el.messagePopover.innerHTML = `<header class="message-popover-head"><div><strong>通信中心</strong><small>${state.unreadMessages ? `${state.unreadMessages} 条未读消息` : "已全部阅读"}</small></div><button class="mini-button ghost" type="button" data-messaging-read-all ${state.unreadMessages ? "" : "disabled"}>全部已读</button></header><div class="message-popover-scroll"><div class="message-preview-list">${visible.length ? visible.map(messagingConversationPreviewHtml).join("") : `<p class="muted-line">暂无会话，去用户主页发起一条私信吧。</p>`}</div>${folded.length ? `<details class="message-popover-fold"><summary>展开其余 ${folded.length} 个会话</summary><div class="message-preview-list">${folded.map(messagingConversationPreviewHtml).join("")}</div></details>` : ""}</div><a class="message-popover-more" href="#/messages">打开通信工作台</a>`;
  } catch (error) {
    if (state.messagePopoverOpen && requestId === messagePopoverRequestId) {
      el.messagePopover.innerHTML = `<p class="muted-line">${escapeHtml(error.message)}</p>`;
    }
  }
}

function setupUnifiedMessageMenu() {
  el.messageLink?.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (state.messagePopoverOpen) {
      closeMessagePopover();
      return;
    }
    state.messagePopoverOpen = true;
    el.messageLink.setAttribute("aria-expanded", "true");
    await renderUnifiedMessagePopover();
  });
  el.messagePopover?.addEventListener("click", async (event) => {
    const readAll = event.target.closest("[data-messaging-read-all]");
    if (readAll) {
      readAll.disabled = true;
      const result = await api("/api/messaging/read-all", { method: "PUT", body: "{}" }).catch(() => null);
      if (result) state.unreadMessages = Number(result.unreadCount || 0);
      renderMessageBadge();
      await renderUnifiedMessagePopover();
      return;
    }
    const preview = event.target.closest("[data-messaging-preview]");
    if (!preview) return;
    closeMessagePopover();
    location.hash = `#/messages/${encodeURIComponent(preview.dataset.messagingPreview)}`;
  });
  document.addEventListener("click", (event) => {
    if (state.messagePopoverOpen && !el.messageMenu?.contains(event.target)) closeMessagePopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMessagePopover();
  });
}

function messagingPresenceWatchUserIds() {
  const ids = new Set();
  (messagingWorkspaceState.conversations || []).forEach((conversation) => {
    const peerId = Number(conversation.peer?.id || 0);
    if (peerId > 0) ids.add(peerId);
  });
  const activePeerId = Number(messagingWorkspaceState.activeConversation?.peer?.id || 0);
  if (activePeerId > 0) ids.add(activePeerId);
  (messagingWorkspaceState.memberPage?.items || []).forEach((member) => {
    const id = Number(member.id || 0);
    if (id > 0) ids.add(id);
  });
  document.querySelectorAll("[data-profile-presence-user]").forEach((node) => {
    const id = Number(node.dataset.profilePresenceUser || 0);
    if (id > 0) ids.add(id);
  });
  return [...ids].slice(0, 80);
}

async function refreshMessagingHeartbeat(context = "") {
  if (!state.user) return null;
  const routeInfo = parseRoute();
  const heartbeatContext = context || (messagingActiveConversationId
    ? `conversation:${messagingActiveConversationId}`
    : `route:${routeInfo.name || "page"}`);
  const payload = await api("/api/messaging/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify({ userIds: messagingPresenceWatchUserIds(), context: heartbeatContext, clientId: currentMessagingPresenceClientId() }),
  });
  applyMessagingPresence(payload);
  return payload;
}

function releaseMessagingPresence() {
  if (!state.user) return;
  const body = JSON.stringify({ clientId: currentMessagingPresenceClientId() });
  if (typeof navigator.sendBeacon === "function") {
    const queued = navigator.sendBeacon("/api/messaging/presence/offline", new Blob([body], { type: "application/json" }));
    if (queued) return;
  }
  fetch("/api/messaging/presence/offline", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function stopMessagingHeartbeat() {
  if (messagingHeartbeatTimer) window.clearInterval(messagingHeartbeatTimer);
  messagingHeartbeatTimer = 0;
}

function startMessagingHeartbeat() {
  if (!state.user) { stopMessagingHeartbeat(); return; }
  const seconds = Math.max(15, Math.min(60, Number(messagingBootstrap?.presence?.heartbeatSeconds || 20)));
  if (!messagingHeartbeatTimer) {
    messagingHeartbeatTimer = window.setInterval(() => refreshMessagingHeartbeat().catch(() => {}), seconds * 1000);
  }
  refreshMessagingHeartbeat().catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (!state.user) return;
  if (document.visibilityState === "visible") refreshMessagingHeartbeat().catch(() => {});
});
window.addEventListener("pagehide", releaseMessagingPresence);
window.addEventListener("beforeunload", releaseMessagingPresence);

async function ensureMessagingRealtime() {
  if (!state.user) {
    stopMessagingHeartbeat();
    disconnectMessagingRealtime();
    return null;
  }
  if (messagingClient && messagingClientUserId === Number(state.user.id)) {
    startMessagingHeartbeat();
    return messagingClient;
  }
  messagingBootstrap = await api("/api/messaging/bootstrap").catch(() => null);
  if (messagingBootstrap) {
    state.unreadMessages = Number(messagingBootstrap.unreadCount || 0);
    messagingPreferences = { openMode: false, autoReplyEnabled: false, autoReplyText: "", ...(messagingBootstrap.preferences || {}) };
    if (messagingBootstrap.presence) applyMessagingPresence(messagingBootstrap.presence);
    renderMessageBadge();
  }
  startMessagingHeartbeat();
  const CentrifugeClient = typeof window.Centrifuge === "function" ? window.Centrifuge : window.Centrifuge?.Centrifuge;
  if (!messagingBootstrap?.realtime?.enabled || typeof CentrifugeClient !== "function") {
    if (!messagingBadgeTimer) messagingBadgeTimer = window.setInterval(() => refreshUnifiedMessageBadge().catch(() => {}), 15000);
    return null;
  }
  const activeConversationId = messagingActiveConversationId;
  disconnectMessagingRealtime();
  messagingActiveConversationId = activeConversationId;
  if (messagingBadgeTimer) window.clearInterval(messagingBadgeTimer);
  messagingBadgeTimer = 0;
  const credential = await api("/api/messaging/realtime/token", { method: "POST", body: "{}" });
  const getToken = async () => (await api("/api/messaging/realtime/token", { method: "POST", body: "{}" })).token;
  const client = new CentrifugeClient(credential.url || messagingBootstrap.realtime.url, {
    token: credential.token,
    getToken,
    timeout: 5000,
    name: "wikist-web",
    version: CORE_ASSET_VERSION,
  });
  client.on("publication", (context) => handleUnifiedMessagingEvent(context.data));
  client.on("connected", () => {
    document.body.classList.add("messaging-realtime-connected");
    refreshMessagingPresence().catch(() => {});
  });
  client.on("disconnected", () => document.body.classList.remove("messaging-realtime-connected"));
  client.on("error", () => document.body.classList.remove("messaging-realtime-connected"));
  messagingClient = client;
  messagingClientUserId = Number(state.user.id);
  client.connect();
  return client;
}

function disconnectMessagingRealtime() {
  if (messagingConversationSubscription) {
    try { messagingConversationSubscription.unsubscribe(); } catch (_error) {}
    try { messagingConversationSubscription.removeAllListeners(); } catch (_error) {}
  }
  messagingConversationSubscription = null;
  if (messagingClient) {
    try { messagingClient.disconnect(); } catch (_error) {}
  }
  messagingClient = null;
  messagingClientUserId = 0;
  messagingActiveConversationId = "";
  if (messagingBadgeTimer) window.clearInterval(messagingBadgeTimer);
  messagingBadgeTimer = 0;
  document.body.classList.remove("messaging-realtime-connected");
}

async function subscribeMessagingConversation(conversationId) {
  messagingActiveConversationId = String(conversationId || "");
  if (messagingConversationSubscription) {
    try { messagingConversationSubscription.unsubscribe(); } catch (_error) {}
    try { messagingConversationSubscription.removeAllListeners(); } catch (_error) {}
    messagingConversationSubscription = null;
  }
  const client = await ensureMessagingRealtime();
  if (!client || !messagingActiveConversationId) return;
  const channel = `conversation:${messagingActiveConversationId}`;
  const subscription = client.newSubscription(channel, {
    getToken: async () => (await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/subscription-token`, { method: "POST", body: "{}" })).token,
  });
  subscription.on("publication", (context) => handleUnifiedMessagingEvent(context.data));
  const refreshChannelPresence = () => {
    window.clearTimeout(messagingPresenceEventTimer);
    messagingPresenceEventTimer = window.setTimeout(() => refreshMessagingPresence().catch(() => {}), 80);
  };
  subscription.on("subscribed", refreshChannelPresence);
  subscription.on("join", refreshChannelPresence);
  subscription.on("leave", refreshChannelPresence);
  subscription.subscribe();
  messagingConversationSubscription = subscription;
}

function handleUnifiedMessagingEvent(event) {
  if (!event || typeof event !== "object") return;
  const type = String(event.type || "");
  const data = event.data || {};
  window.clearTimeout(messagingEventTimer);
  messagingEventTimer = window.setTimeout(() => {
    refreshUnifiedMessageBadge().catch(() => {});
    refreshMessagingConversationList().catch(() => {});
  }, 120);
  if (type === "presence.changed" && data.user?.id) {
    applyMessagingPresence({
      online: data.online === false ? [] : [data.user],
      observed: [Number(data.user.id)],
      private: false,
    });
  }
  if (String(data.conversationId || "") !== messagingActiveConversationId) return;
  if (type === "message.created" && data.message) {
    const actorId = Number(data.actor?.id || data.message.sender?.id || 0);
    const incoming = actorId > 0 && actorId !== Number(state.user?.id || 0);
    const message = { ...data.message, mine: !incoming };
    appendMessagingMessage(message);
    showUnifiedUrgentConversation({ id: data.conversationId, title: message.sender?.displayName || "最高优先级消息" }, message);
    if (incoming && messagingWorkspaceState.activeConversation?.kind === "direct") {
      window.setTimeout(() => refreshActiveMessagingDirectPolicy().catch(() => {}), 40);
    }
  }
  if (type === "message.withdrawn") markMessagingMessageWithdrawn(data.messageId);
  if (type === "conversation.read") updateMessagingReadReceipts(Number(data.cursor || 0), Number(data.userId || 0));
  if (["conversation.moderation.updated", "conversation.member.role.updated", "conversation.member.mute.updated"].includes(type)) {
    window.setTimeout(() => refreshActiveMessagingModeration().catch(() => {}), 80);
  }
  if (type === "presence.typing") updateMessagingTyping(data.user, Boolean(data.active));
}
function functionPlotTheme() {
  const light = document.documentElement.dataset.theme === "light";
  return light ? {
    name: "light",
    palette: ["#0969da", "#d1246f", "#238636", "#9a6700", "#8250df", "#1b7c83"],
  } : {
    name: "dark",
    palette: ["#38e8ff", "#7cffb4", "#ffd166", "#ff5f8a", "#b88cff", "#5ed1ff"],
  };
}

function ensureFunctionPlotAssets(settings) {
  const cdn = withCdnBase(settings.cdn || "https://cdn.jsdelivr.net/npm/function-plot@1.25.4/dist/function-plot.js");
  const d3 = settings.d3Cdn ? withCdnBase(settings.d3Cdn) : "";
  const key = `${d3}|${cdn}`;
  if (!functionPlotAssetsPromise || functionPlotAssetsKey !== key) {
    functionPlotAssetsKey = key;
    functionPlotAssetsPromise = (async () => {
      if (d3) await loadScript(d3, "d3", "D3 图形库加载失败。");
      await loadScript(cdn, "functionPlot", "函数图插件加载失败。");
      if (typeof window.functionPlot !== "function") throw new Error("function-plot 已加载，但没有暴露 window.functionPlot。请检查 CDN 地址。");
    })();
  }
  return functionPlotAssetsPromise;
}

function ensureMathJsAssets(settings) {
  const cdn = withCdnBase(settings.mathCdn || "https://cdn.jsdelivr.net/npm/mathjs@14.0.1/lib/browser/math.js");
  if (!mathJsAssetsPromise || mathJsAssetsKey !== cdn) {
    mathJsAssetsKey = cdn;
    mathJsAssetsPromise = (async () => {
      await loadScript(cdn, "math", "mathjs 表达式库加载失败。");
      if (!window.math?.compile) throw new Error("mathjs 已加载，但没有暴露表达式编译器。请检查 mathCdn 配置。");
    })();
  }
  return mathJsAssetsPromise;
}


function functionPlotExpressionNeedsMath(expression) {
  return /\b(gamma|lgamma|erf|erfc|zeta|beta|factorial|combinations|permutations|sinc|besselj|besseli)\s*\(/i.test(String(expression || ""));
}

function functionPlotMathScope() {
  const math = window.math;
  if (!math) return {};
  const aliases = {
    gamma: ["gamma"], lgamma: ["lgamma"], erf: ["erf"], erfc: ["erfc"],
    zeta: ["zeta"], beta: ["beta"], factorial: ["factorial"],
    combinations: ["combinations"], permutations: ["permutations"], sinc: ["sinc"],
    besselj: ["besselj", "besselJ"], besseli: ["besseli", "besselI"],
  };
  return Object.entries(aliases).reduce((scope, [name, candidates]) => {
    const candidate = candidates.map((key) => math[key]).find((fn) => typeof fn === "function");
    if (candidate) scope[name] = (...args) => candidate.apply(math, args);
    return scope;
  }, {});
}

function functionPlotNeedsMathJs(config = {}) {
  return config.requiresMathjs === true || config.engine === "mathjs" || (config.data || []).some((item) => {
    if (item.fnType === "implicit" && functionPlotExpressionNeedsMath(item.fn)) return true;
    return functionPlotExpressionNeedsMath(item.fn) || functionPlotExpressionNeedsMath(item.x) || functionPlotExpressionNeedsMath(item.y) || functionPlotExpressionNeedsMath(item.r);
  });
}

function readFunctionPlotConfig(figure) {
  const scriptText = figure.querySelector(".function-plot-config")?.textContent?.trim();
  const fallbackText = figure.dataset.config || "{}";
  try {
    return JSON.parse(scriptText || fallbackText);
  } catch (_error) {
    return JSON.parse(fallbackText);
  }
}

function functionPlotSize(figure, box, config, settings) {
  const rect = box.getBoundingClientRect();
  const figureRect = figure.getBoundingClientRect();
  const rawWidth = rect.width || box.clientWidth || Math.max(0, figureRect.width - 28) || 680;
  const width = Math.max(240, Math.min(1400, Math.floor(rawWidth)));
  const configuredHeight = Number(config.height || settings.defaultHeight || 360) || 360;
  const responsiveLimit = Math.max(240, Math.round(width * (width < 520 ? 0.74 : 0.58)));
  const height = Math.max(220, Math.min(760, Math.min(configuredHeight, responsiveLimit)));
  return { width, height };
}

function themedFunctionPlotData(config, theme, settings = {}) {
  const source = Array.isArray(config.data) && config.data.length ? config.data : [{ fn: "x", graphType: "polyline" }];
  const samples = Math.max(160, Math.min(Number(config.samples || settings.samples) || 720, 1800));
  const needsMath = functionPlotNeedsMathJs(config);
  const mathScope = needsMath ? functionPlotMathScope() : {};
  return source.map((series, index) => {
    const next = {
      ...series,
      color: series.color || theme.palette[index % theme.palette.length],
    };
    if (needsMath || functionPlotExpressionNeedsMath(next.fn) || functionPlotExpressionNeedsMath(next.x) || functionPlotExpressionNeedsMath(next.y) || functionPlotExpressionNeedsMath(next.r)) {
      // function-plot uses built-in-math-eval; special functions must be supplied in its scope.
      next.scope = { ...(next.scope || {}), ...mathScope };
    }
    if (next.fnType === "implicit") {
      next.graphType = next.graphType || "interval";
    } else {
      next.graphType = next.graphType || "polyline";
      next.nSamples = Number(next.nSamples || samples);
      if (needsMath || functionPlotExpressionNeedsMath(next.fn)) next.sampler = "builtIn";
    }
    return next;
  });
}

function ensureFunctionPlotObserver() {
  if (functionPlotResizeObserver || !("ResizeObserver" in window)) return;
  functionPlotResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const figure = entry.target.closest?.(".wikist-function-plot");
      if (!figure || figure.dataset.rendered !== "true") return;
      const width = Math.round(entry.contentRect.width || 0);
      const previous = Number(figure.dataset.plotWidth || 0);
      if (!width || Math.abs(width - previous) < 12) return;
      clearTimeout(figure._wikistPlotResizeTimer);
      figure._wikistPlotResizeTimer = setTimeout(() => {
        delete figure.dataset.rendered;
        hydrateFunctionPlots().catch(() => {});
      }, 140);
    });
  });
}

function observeFunctionPlot(figure) {
  const box = figure.querySelector(".function-plot-target");
  if (!box) return;
  ensureFunctionPlotObserver();
  if (functionPlotResizeObserver && box.dataset.plotObserved !== "true") {
    functionPlotResizeObserver.observe(box);
    box.dataset.plotObserved = "true";
  }
}

async function renderFunctionPlotFigure(figure, settings, index) {
  const box = figure.querySelector(".function-plot-target");
  if (!box) {
    figure.dataset.rendered = "error";
    return;
  }
  const config = readFunctionPlotConfig(figure);
  const theme = functionPlotTheme();
  const plotId = box.id || `wikist-function-plot-${Date.now()}-${index}`;
  box.id = plotId;
  const { width, height } = functionPlotSize(figure, box, config, settings);
  box.style.height = `${height}px`;
  box.style.minHeight = `${height}px`;
  box.innerHTML = "";
  const plot = window.functionPlot({
    target: `#${plotId}`,
    width,
    height,
    grid: config.grid !== false,
    xAxis: config.xAxis,
    yAxis: config.yAxis,
    data: themedFunctionPlotData(config, theme, settings),
  });
  const svg = box.querySelector("svg");
  if (!svg) throw new Error("function-plot 未生成 SVG。请检查函数表达式或 CDN 包。");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  figure.dataset.rendered = "true";
  figure.dataset.plotWidth = String(width);
  figure.dataset.plotTheme = theme.name;
  figure._wikistPlot = plot;
  observeFunctionPlot(figure);
}

async function hydrateFunctionPlots(root = el.main) {
  const settings = state.site?.plugins?.functionPlot || {};
  const scope = root || document;
  const targets = [
    ...(scope.matches?.(".wikist-function-plot:not([data-rendered])") ? [scope] : []),
    ...scope.querySelectorAll(".wikist-function-plot:not([data-rendered])"),
  ];
  if (!targets.length) return;
  if (settings.enabled === false) {
    targets.forEach((item) => { item.dataset.rendered = "disabled"; });
    return;
  }
  try {
    if (targets.some((figure) => functionPlotNeedsMathJs(readFunctionPlotConfig(figure)))) await ensureMathJsAssets(settings);
    await ensureFunctionPlotAssets(settings);
    await Promise.all(targets.map(async (figure, index) => {
      try {
        await renderFunctionPlotFigure(figure, settings, index);
      } catch (error) {
        figure.dataset.rendered = "error";
        const box = figure.querySelector(".function-plot-target");
        if (box) box.innerHTML = `<p class="muted-line">函数图渲染失败：${escapeHtml(error.message)}</p>`;
      }
    }));
  } catch (error) {
    targets.forEach((figure) => {
      figure.dataset.rendered = "error";
      const box = figure.querySelector(".function-plot-target");
      if (box) box.innerHTML = `<p class="muted-line">${escapeHtml(error.message)}</p>`;
    });
  }
}

function refreshFunctionPlots() {
  document.querySelectorAll(".wikist-function-plot[data-rendered='true']").forEach((figure) => {
    if (figure.dataset.plotTheme === functionPlotTheme().name) return;
    delete figure.dataset.rendered;
  });
  hydrateFunctionPlots().catch(() => {});
}


function pluginClientModuleUrl(plugin) {
  const modulePath = String(plugin.clientModule || "").trim().replace(/\\/g, "/");
  if (!modulePath || modulePath.startsWith("/") || modulePath.includes(":") || modulePath.includes("..")) return "";
  const directory = String(plugin.directory || "").trim();
  if (!/^[\w.-]{2,120}$/.test(directory)) return "";
  const parts = modulePath.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => !/^[\w.-]+$/.test(part))) return "";
  if (!/\.m?js$/i.test(parts[parts.length - 1])) return "";
  return `/plugins/${encodeURIComponent(directory)}/${parts.map(encodeURIComponent).join("/")}?v=${encodeURIComponent(CORE_ASSET_VERSION)}`;
}

function pluginHookAllowed(plugin, hookName) {
  const permission = { "admin.panel": "ui:admin-panel" }[hookName];
  return Boolean(permission && plugin?.hooks?.includes(hookName) && plugin?.permissions?.includes(permission));
}

function activePluginAdminPanels() {
  return [...pluginAdminPanels.values()]
    .filter((panel) => state.site?.plugins?.[panel.pluginId]?.enabled !== false)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh-CN"));
}

function createPluginHookApi(plugin) {
  const registerAdminPanel = (definition = {}) => {
    if (!pluginHookAllowed(plugin, "admin.panel")) throw new Error("manifest 未声明 admin.panel Hook 或 ui:admin-panel 权限。");
    const id = String(definition.id || "").trim();
    if (!/^[a-z][a-z0-9-]{1,40}$/i.test(id)) throw new Error("后台面板 ID 只能使用字母、数字和短横线。");
    if (typeof definition.render !== "function") throw new Error("后台面板必须提供 render 函数。");
    const routeId = `plugin-${String(plugin.id || "plugin").toLowerCase()}-${id.toLowerCase()}`;
    const title = String(definition.title || plugin.name || plugin.id || "插件面板").trim().slice(0, 80);
    const panel = {
      routeId,
      pluginId: plugin.id,
      title: title || "插件面板",
      description: String(definition.description || plugin.description || "").trim().slice(0, 300),
      order: Math.max(0, Math.min(Number(definition.order) || 900, 9999)),
      render: definition.render,
    };
    pluginAdminPanels.set(routeId, panel);
    document.dispatchEvent(new CustomEvent("wikist:plugin-admin-panels", { detail: { pluginId: plugin.id, routeId } }));
    return () => pluginAdminPanels.delete(routeId);
  };
  return Object.freeze({
    version: "1.0",
    allows: (hookName) => pluginHookAllowed(plugin, hookName),
    register: (hookName, definition) => {
      if (hookName !== "admin.panel") throw new Error(`客户端 Hook 不支持：${hookName}`);
      return registerAdminPanel(definition);
    },
    registerAdminPanel,
  });
}

async function loadClientPluginModules(root = el.main) {
  const catalog = state.site?.pluginCatalog || [];
  const settings = state.site?.plugins || {};
  const pending = [];
  catalog.forEach((plugin) => {
    if (settings?.[plugin.id]?.enabled === false) return;
    if (!plugin.runtime?.executable || plugin.runtime?.state !== "client-active") return;
    const src = pluginClientModuleUrl(plugin);
    if (!src) return;
    if (pluginModulePromises.has(src)) {
      pending.push(pluginModulePromises.get(src));
      return;
    }
    const context = { api, route, state, root: root || el.main, plugin, hooks: createPluginHookApi(plugin), hydratePlugins };
    const promise = import(src)
      .then((module) => {
        const activate = module.activate || module.default;
        if (typeof activate === "function") return activate(context);
        return null;
      })
      .catch((error) => {
        console.warn(`Wikist plugin module failed: ${plugin.id}`, error);
        fetch("/api/runtime/plugin-failure", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pluginId: plugin.id, hook: "client.module" }),
        }).catch(() => {});
        return null;
      });
    pluginModulePromises.set(src, promise);
    pending.push(promise);
  });
  await Promise.all(pending);
}

function hydratePlugins(root = el.main) {
  const targetRoot = root || el.main;
  hydrateFunctionPlots(targetRoot).catch(() => {});
  enhanceWikiLinks(targetRoot);
  enhanceKnowledgeObjectLinks(targetRoot);
  hydrateCosmicScenes(targetRoot);
  hydrateAuthMetrics(targetRoot);
  loadClientPluginModules(targetRoot);
  document.dispatchEvent(new CustomEvent("wikist:plugins-hydrate", { detail: { root: targetRoot, state } }));
}
function rootNeedsMath(root = el.main) {
  if (!root) return false;
  if (root.querySelector(".math-inline,.math-display,.math-block,script[type^='math/tex']")) return true;
  return /(?:\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/.test(root.textContent || "");
}

function injectMathJax(root = el.main) {
  const source = withCdnBase(state.site?.math?.cdn || "");
  if (!source || document.querySelector("script[data-wikist-math]")) return;
  if (!rootNeedsMath(root)) return;
  window.MathJax = {
    tex: {
      inlineMath: [["\\(", "\\)"], ["$", "$"]],
      displayMath: [["\\[", "\\]"], ["$$", "$$"]],
      processEscapes: true,
    },
  };
  const script = document.createElement("script");
  script.src = source;
  script.async = true;
  script.dataset.wikistMath = "true";
  document.head.appendChild(script);
}

function clearHydrationTask() {
  if (!hydrationTask) return;
  if (hydrationTask.type === "idle" && window.cancelIdleCallback) window.cancelIdleCallback(hydrationTask.id);
  else window.clearTimeout(hydrationTask.id);
  hydrationTask = null;
}

function scheduleIdleWork(callback) {
  if (window.requestIdleCallback) return { type: "idle", id: window.requestIdleCallback(callback, { timeout: 900 }) };
  return { type: "timeout", id: window.setTimeout(callback, 32) };
}

function runPostRenderHydration(root = el.main, generation = routeGeneration) {
  if (generation !== routeGeneration || !root?.isConnected) return;
  injectMathJax(root);
  const mathTask = window.MathJax?.typesetPromise && rootNeedsMath(root)
    ? window.MathJax.typesetPromise([root]).catch(() => {})
    : Promise.resolve();
  hydratePlugins(root);
  hydrateLanguageConversion(root).catch(() => {});
  mathTask.finally(async () => {
    await selectionToolbar?.refresh(root);
    revealRequestedSelection();
  });
}

function revealRequestedSelection() {
  if (!selectionToolbar) return false;
  const current = parseRoute();
  if (current.name !== "page") return false;
  const selectionId = Number(splitValueQuery(current.value).params.get("selection") || 0);
  if (!selectionId) return false;
  const routeKey = `${location.hash}|${selectionId}`;
  if (focusedSelectionRouteKey === routeKey) return true;
  const focused = selectionToolbar.focus(selectionId, { behavior: "auto" });
  if (focused) focusedSelectionRouteKey = routeKey;
  return focused;
}

function schedulePostRenderHydration(root = el.main) {
  hydrationRoot = root || el.main;
  const generation = routeGeneration;
  clearHydrationTask();
  hydrationTask = scheduleIdleWork(() => {
    hydrationTask = null;
    runPostRenderHydration(hydrationRoot || el.main, generation);
  });
}

function typesetMath(root = el.main) {
  schedulePostRenderHydration(root);
}

const cosmicScenes = new Map();

function createCosmicScene(canvas) {
  const context = canvas.getContext("2d");
  const scene = canvas.dataset.cosmicScene || "home";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const stars = [];
  const comets = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let animation = 0;

  function lightTheme() {
    return document.documentElement.dataset.theme === "light";
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    stars.length = 0;
    comets.length = 0;
    const count = Math.round((scene === "auth" ? 140 : 210) * Math.min(1.4, Math.max(.72, width / 920)));
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.pow(Math.random(), .62);
      stars.push({
        x: width * (.5 + Math.cos(angle) * distance * .58),
        y: height * (.5 + Math.sin(angle) * distance * .45),
        r: Math.random() * 1.7 + .25,
        a: Math.random() * .62 + .18,
        drift: Math.random() * .55 + .12,
        hue: Math.random() > .7 ? 180 : Math.random() > .48 ? 145 : 42,
      });
    }
    const cometCount = scene === "auth" ? 6 : 9;
    for (let index = 0; index < cometCount; index += 1) {
      comets.push({
        x: Math.random() * width,
        y: Math.random() * height,
        speed: Math.random() * .9 + .35,
        length: Math.random() * 110 + 70,
        delay: Math.random() * 240,
      });
    }
  }

  function nebula(time) {
    const light = lightTheme();
    const cx = width * (scene === "auth" ? .68 : .58);
    const cy = height * (scene === "auth" ? .42 : .48);
    const radius = Math.max(width, height) * .62;
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, light ? "rgba(0, 126, 167, .18)" : "rgba(56, 232, 255, .34)");
    gradient.addColorStop(.28, light ? "rgba(0, 139, 95, .10)" : "rgba(124, 255, 180, .14)");
    gradient.addColorStop(.52, light ? "rgba(163, 107, 0, .055)" : "rgba(255, 209, 102, .055)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(cx, cy);
    context.rotate(time * .000045);
    for (let arm = 0; arm < 3; arm += 1) {
      context.beginPath();
      for (let step = 0; step < 120; step += 1) {
        const t = step / 119;
        const angle = arm * Math.PI * 2 / 3 + t * Math.PI * 2.2;
        const r = t * radius * .58;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * .34;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = light ? `rgba(0, 126, 167, ${scene === "auth" ? .13 : .16})` : `rgba(56, 232, 255, ${scene === "auth" ? .18 : .22})`;
      context.lineWidth = 1.4;
      context.stroke();
    }
    context.restore();
  }

  function draw(time = 0) {
    const light = lightTheme();
    frame += 1;
    context.clearRect(0, 0, width, height);
    context.fillStyle = light ? "#f7fcfb" : "#03070b";
    context.fillRect(0, 0, width, height);
    nebula(time);

    stars.forEach((star, index) => {
      const pulse = Math.sin(time * .0015 * star.drift + index) * .22 + .78;
      context.beginPath();
      context.fillStyle = light
        ? `hsla(${star.hue}, 70%, 36%, ${star.a * pulse * .62})`
        : `hsla(${star.hue}, 95%, 78%, ${star.a * pulse})`;
      context.arc(star.x, star.y, star.r * pulse, 0, Math.PI * 2);
      context.fill();
      if (!reducedMotion) {
        star.x += Math.cos(index) * .012 * star.drift;
        star.y += Math.sin(index * 1.7) * .010 * star.drift;
      }
    });

    comets.forEach((comet) => {
      if (reducedMotion) return;
      const phase = (frame + comet.delay) % 360;
      if (phase > 120) return;
      comet.x += comet.speed * 2.8;
      comet.y += comet.speed * 1.1;
      if (comet.x > width + comet.length || comet.y > height + comet.length) {
        comet.x = -comet.length;
        comet.y = Math.random() * height * .55;
      }
      const gradient = context.createLinearGradient(comet.x - comet.length, comet.y - comet.length * .35, comet.x, comet.y);
      gradient.addColorStop(0, light ? "rgba(0, 126, 167, 0)" : "rgba(56, 232, 255, 0)");
      gradient.addColorStop(1, light ? "rgba(0, 126, 167, .35)" : "rgba(255, 255, 255, .74)");
      context.strokeStyle = gradient;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(comet.x - comet.length, comet.y - comet.length * .35);
      context.lineTo(comet.x, comet.y);
      context.stroke();
    });

    if (!reducedMotion && canvas.isConnected) animation = requestAnimationFrame(draw);
  }

  resize();
  draw(0);
  if (!reducedMotion) animation = requestAnimationFrame(draw);
  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  return {
    refresh() {
      resize();
      if (reducedMotion) draw(performance.now());
    },
    destroy() {
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", onResize);
    },
  };
}

function hydrateCosmicScenes(root = el.main) {
  const scope = root || document;
  cosmicScenes.forEach((scene, canvas) => {
    if (!canvas.isConnected) {
      scene.destroy?.();
      cosmicScenes.delete(canvas);
    }
  });
  const canvases = [
    ...(scope.matches?.("canvas[data-cosmic-scene]") ? [scope] : []),
    ...Array.from(scope.querySelectorAll?.("canvas[data-cosmic-scene]") || []),
  ];
  canvases.forEach((canvas) => {
    if (cosmicScenes.has(canvas)) return;
    cosmicScenes.set(canvas, createCosmicScene(canvas));
  });
}

document.addEventListener("wikist:theme-change", () => {
  cosmicScenes.forEach((scene) => scene.refresh?.());
});

function hydrateAuthMetrics(root = el.main) {
  const scope = root || document;
  const metrics = [
    ...(scope.matches?.("[data-auth-metric]") ? [scope] : []),
    ...Array.from(scope.querySelectorAll?.("[data-auth-metric]") || []),
  ];
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  metrics.forEach((metric) => {
    if (metric.dataset.metricHydrated === "true") return;
    metric.dataset.metricHydrated = "true";
    const target = Number(metric.dataset.authMetric || 0);
    if (!Number.isFinite(target)) return;
    if (reducedMotion || target <= 0) {
      metric.textContent = String(Math.max(0, Math.round(target)));
      return;
    }
    metric.textContent = "0";
    const start = performance.now();
    const duration = Math.min(1680, 720 + target * 28);
    const easeOut = (value) => 1 - Math.pow(1 - value, 3);
    const tick = (now) => {
      if (!metric.isConnected) return;
      const progress = Math.min(1, (now - start) / duration);
      metric.textContent = String(Math.round(target * easeOut(progress)));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function renderTopQuickNav() {
  if (!el.topQuickNav) return;
  const links = functionalNavigationLinks();
  if (state.user) links.push({ label: "通信", href: "#/messages" }, { label: "我的协作", href: "#/organizations" });
  const seen = new Set();
  el.topQuickNav.innerHTML = links.filter((item) => {
    const key = item.label + item.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => {
    const current = location.hash.split("?")[0] || "#/page/home";
    const communityActive = item.href === "#/community" && /^#\/(community|organization)(?:\/|$)/.test(current);
    const active = current === item.href || current.startsWith(`${item.href}/`) || communityActive;
    return `<a class="${active ? "active" : ""}" href="${item.href}" ${active ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
  }).join("");
}

function functionalNavigationLinks() {
  return [
    { label: "资讯", href: "#/page/news", icon: "pulse" },
    { label: "知识网络", href: "#/knowledge", icon: "network" },
    { label: "分类目录", href: "#/category", icon: "category" },
    { label: "问答", href: "#/questions", icon: "forum" },
    { label: "协作社区", href: "#/community", icon: "community" },
    { label: "导入导出", href: "#/import-export", icon: "transfer" },
  ];
}

function navigationIconSvg(icon) {
  const paths = {
    pulse: '<path d="M3 12h4l2.2-5 4.1 10 2.1-5H21"/>',
    network: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="m7.8 7 3 9m5.4-7.8-3 8.1M8 6.2l8 .6"/>',
    category: '<path d="M4 5.5h6l2 2H20v11H4v-13Z"/><path d="M4 9h16"/>',
    community: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0m.5-4a4 4 0 0 1 5.5 3.7"/>',
    transfer: '<path d="M4 7h13m-3-3 3 3-3 3M20 17H7m3 3-3-3 3-3"/>',
    workspace: '<path d="M4 5h16v14H4zM8 9h8M8 13h5"/>',
    article: '<path d="M5 3h10l4 4v14H5V3Z"/><path d="M15 3v5h5M8 12h8M8 16h6"/>',
    review: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 8.5"/>',
    translate: '<path d="M4 5h9M8.5 3v2m-2 0c.4 4 2.8 7 6.5 8.5M11 5c-.4 4-2.5 7-6.5 9"/><path d="m14 20 3.5-9 3.5 9m-5.8-3h4.6"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v5l3 2"/>',
    comments: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/>',
    permissions: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"/>',
    tasks: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
    forum: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h6"/>',
    members: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0m1-5a4 4 0 0 1 5 4"/>',
    chat: '<path d="M4 4.5h13v10H9l-5 3v-13Z"/><path d="M9 18h6l5 3V9h-3"/><path d="M8 8h5M8 11h4"/>',
    bookmark: '<path d="M6 4h12v17l-6-3.7L6 21V4Z"/>',
    favorite: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.5-4.4M8.2 13.2l7.5 4.4"/>',
    more: '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
  };
  return `<svg class="nav-link-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[icon] || paths.workspace}</svg>`;
}

function renderNav() {
  const nav = functionalNavigationLinks();
  if (state.user) nav.push({ label: "通信", href: "#/messages", icon: "chat" }, { label: "我的协作", href: "#/organizations", icon: "workspace" });
  const current = location.hash.split("?")[0] || "#/page/home";
  el.primaryNav.innerHTML = nav.map((item) => {
    const communityActive = item.href === "#/community" && /^#\/(community|organization)(?:\/|$)/.test(current);
    const active = current === item.href || current.startsWith(`${item.href}/`) || communityActive;
    return `<a class="nav-link ${active ? "active" : ""}" href="${item.href}" ${active ? 'aria-current="page"' : ""}>${navigationIconSvg(item.icon)}<span>${escapeHtml(item.label)}</span></a>`;
  }).join("");
}

function railQualityRank(value) {
  return ({ A: 4, B: 3, C: 2, D: 1 })[String(value || "").toUpperCase()] || 0;
}

function railRandomUnit(seed, key, index = 0) {
  let hash = (Number(seed) || 1) >>> 0;
  const input = `${key || "item"}:${index}`;
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    hash ^= input.charCodeAt(cursor);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return ((hash >>> 0) + 1) / 4294967297;
}

function selectRailItems(items, limit, seed = 0, mode = "recent") {
  const unique = [...new Map((Array.isArray(items) ? items : []).filter((item) => item?.slug).map((item) => [String(item.slug), item])).values()];
  const ranked = unique.map((item, index) => {
    const quality = railQualityRank(item.quality);
    const stable = String(item.status || "") === "stable" ? 1 : 0;
    const relevance = Math.max(0, Number(item.score || 0));
    const freshness = Math.max(0, unique.length - index);
    if (!seed) {
      const score = mode === "recommendation"
        ? relevance * 100 + quality * 10 + stable * 4 + freshness
        : freshness * 100 + quality * 4 + stable;
      return { item, score };
    }
    const weight = mode === "recommendation"
      ? 1 + relevance + quality * quality * 1.6 + stable * 2
      : 1 + quality * quality * 1.4 + stable * 2 + freshness * .7;
    const randomKey = -Math.log(railRandomUnit(seed, item.slug, index)) / weight;
    return { item, score: -randomKey };
  });
  return ranked.sort((left, right) => right.score - left.score).slice(0, Math.max(1, limit)).map((entry) => entry.item);
}

function updateRailControl(label, button, total, limit) {
  if (label) label.textContent = total > limit ? `显示 ${limit} / ${total}` : `显示 ${total} 条`;
  if (button) button.disabled = total < 2;
}

function renderRecent() {
  const pool = Array.isArray(state.recent) ? state.recent : [];
  const items = selectRailItems(pool, RAIL_RECENT_LIMIT, state.recentSeed, "recent");
  el.recent.innerHTML = items.length
    ? items.map((item) => `<a class="recent-item" href="#/page/${encodeSlug(item.slug)}"><strong>${escapeHtml(item.title)}</strong><small>${fmtDate(item.updatedAt)} · ${escapeHtml(item.quality || "C")}</small></a>`).join("")
    : '<span class="chip">暂无更新</span>';
  updateRailControl(el.recentLimit, el.recentRefresh, pool.length, RAIL_RECENT_LIMIT);
}

function renderToc(toc) {
  const items = Array.isArray(toc) ? toc : [];
  el.toc.innerHTML = items.map((item) => `<a class="toc-level-${item.level}" href="#${escapeHtml(item.id)}" data-wikist-scroll="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a>`).join("");
  if (el.tocRailBlock) el.tocRailBlock.hidden = items.length === 0;
  clearRailRecommendations();
}

function clearRailRecommendations() {
  state.recommendationPool = [];
  state.recommendationSeed = 0;
  state.recommendationSlug = "";
  if (el.recommendationList) el.recommendationList.innerHTML = "";
  if (el.recommendationRailBlock) el.recommendationRailBlock.hidden = true;
  updateRailControl(el.recommendationLimit, el.recommendationRefresh, 0, RAIL_RECOMMENDATION_LIMIT);
}

function recommendationReason(item) {
  const reasons = Array.isArray(item?.reasons) ? item.reasons.filter(Boolean) : [];
  return reasons.slice(0, 2).join(" · ") || "知识网络推荐";
}

function renderRecommendationItems(items, expectedSlug = "", options = {}) {
  if (!el.recommendationList || !el.recommendationRailBlock) return;
  if (expectedSlug && String(state.currentSlug || "") !== String(expectedSlug)) return;
  const incoming = Array.isArray(items) ? items : [];
  const samePage = String(state.recommendationSlug || "") === String(expectedSlug || "");
  if (!options.preservePool && (!samePage || incoming.length >= state.recommendationPool.length)) {
    state.recommendationPool = incoming;
    state.recommendationSeed = 0;
    state.recommendationSlug = String(expectedSlug || "");
  }
  const recommendations = selectRailItems(state.recommendationPool, RAIL_RECOMMENDATION_LIMIT, state.recommendationSeed, "recommendation");
  el.recommendationList.innerHTML = recommendations.map((item) => `
    <a class="recommendation-item" href="#/page/${encodeSlug(item.slug)}">
      ${item.heroImage ? `<img src="${escapeHtml(item.heroImage)}" alt="" loading="lazy" />` : `<span class="recommendation-mark" aria-hidden="true">${escapeHtml(String(item.title || item.slug || "W").slice(0, 1))}</span>`}
      <span class="recommendation-copy"><strong>${escapeHtml(item.title || item.slug)}</strong><small>${escapeHtml(recommendationReason(item))}</small></span>
    </a>`).join("");
  el.recommendationRailBlock.hidden = recommendations.length === 0;
  updateRailControl(el.recommendationLimit, el.recommendationRefresh, state.recommendationPool.length, RAIL_RECOMMENDATION_LIMIT);
}

async function renderRailRecommendations(slug) {
  const expectedSlug = String(slug || "");
  if (!expectedSlug) return clearRailRecommendations();
  try {
    const payload = await api(`/api/pages/${encodeSlug(expectedSlug)}/recommendations?limit=12`);
    renderRecommendationItems(payload.items || [], expectedSlug);
  } catch (_error) {
    if (String(state.currentSlug || "") === expectedSlug) clearRailRecommendations();
  }
}

async function refreshChrome() {
  const [pagePayload, recent] = await Promise.all([api("/api/pages?page=1&limit=200"), api("/api/recent")]);
  const pages = Array.isArray(pagePayload) ? pagePayload : (pagePayload.items || []);
  state.pages = pages;
  state.pageTotal = Number(pagePayload?.pagination?.total ?? pages.length);
  state.pagesComplete = state.pageTotal <= pages.length;
  state.recent = recent;
  state.recentSeed = 0;
  renderNav();
  renderTopQuickNav();
  renderRecent();
}

async function reloadSiteChrome() {
  state.site = await api("/api/site");
  el.siteName.textContent = state.site.name;
  el.siteTagline.textContent = state.site.tagline;
  renderSiteFooter();
  applySiteIcon();
  updateLanguageChrome();
  applySiteCustomizations();
  await refreshChrome();
}

async function refreshUser(options = {}) {
  const force = options.force === true;
  const ttlMs = Number(options.ttlMs || 0);
  if (!force && ttlMs > 0 && userLastFetchedAt && Date.now() - userLastFetchedAt < ttlMs) {
    renderPassportLink();
    renderTopQuickNav();
    return state.user;
  }
  if (!force && userRefreshPromise) return userRefreshPromise;
  const refreshPromise = (async () => {
    const payload = await api("/api/passport/me").catch(() => ({ user: null }));
    state.user = payload.user || null;
    userLastFetchedAt = Date.now();
    renderPassportLink();
    renderTopQuickNav();
    refreshUnifiedMessageBadge().catch(() => {});
    ensureMessagingRealtime().catch(() => {});
    return state.user;
  })();
  if (!force) userRefreshPromise = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (userRefreshPromise === refreshPromise) userRefreshPromise = null;
  }
}

function pageToolNav(slug, active) {
  const links = [
    ["page", "正文", `#/page/${encodeSlug(slug)}`, "article"],
    ["review", "审阅", `#/review/${encodeSlug(slug)}`, "review"],
    ["translate", "翻译", `#/translate/${encodeSlug(slug)}`, "translate"],
    ["history", "编辑记录", `#/history/${encodeSlug(slug)}`, "history"],
    ["comments", "评论", `#/comments/${encodeSlug(slug)}`, "comments"],
    ["permissions", "权限", `#/permissions/${encodeSlug(slug)}`, "permissions"],
    ["edit", "编辑", `#/edit/${encodeSlug(slug)}`, "edit"],
  ];
  const linkHtml = links.map(([id, label, href, icon]) => `<a class="${id === active ? "active" : ""}" href="${href}" ${id === active ? 'aria-current="page"' : ""}>${navigationIconSvg(icon)}<span>${label}</span></a>`).join("");
  return `<nav class="page-tool-nav" aria-label="&#35789;&#26465;&#39029;&#38754;&#24037;&#20855;"><div class="page-tool-nav-list">${linkHtml}</div><details class="page-tool-nav-mobile"><summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>&#39029;&#38754;&#24037;&#20855;</span><svg class="page-tool-nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary><div class="page-tool-nav-mobile-list">${linkHtml}</div></details></nav>`;
}

function editorLink(event) {
  if (event.editorType === "user" && event.editorLabel?.startsWith("@")) {
    const username = event.editorLabel.slice(1);
    return `<a href="#/user/${encodeURIComponent(username)}">${escapeHtml(event.editorName)}</a>`;
  }
  return `<span>${escapeHtml(event.editorName || "访客")}</span>`;
}

function editEventHtml(event) {
  const labels = { create: "创建", update: "编辑", delete: "删除", restore: "恢复" };
  const action = labels[event.action] || "编辑";
  return `<article class="edit-event"><div><strong>${editorLink(event)}</strong><span>${action}了词条</span></div><small>${fmtDate(event.createdAt)} · ${escapeHtml(event.editorLabel || event.editorType)} · ${event.pageBytes || 0} 字节</small></article>`;
}

function normalizedPaged(payload, page, limit) {
  if (Array.isArray(payload)) {
    return { items: payload, pagination: { page, pageSize: limit, total: payload.length, totalPages: 1, hasPrev: false, hasNext: false } };
  }
  const pagination = payload.pagination || {};
  return {
    items: payload.items || [],
    pagination: {
      page: Number(pagination.page) || page,
      pageSize: Number(pagination.pageSize) || limit,
      total: Number(pagination.total) || 0,
      totalPages: Math.max(1, Number(pagination.totalPages) || 1),
      hasPrev: Boolean(pagination.hasPrev),
      hasNext: Boolean(pagination.hasNext),
    },
  };
}

function paginationHtml(pagination, label) {
  const total = Number(pagination.total) || 0;
  const totalPages = Math.max(1, Number(pagination.totalPages) || 1);
  const page = Math.min(totalPages, Math.max(1, Number(pagination.page) || 1));
  if (!total || totalPages <= 1) return total ? `<div class="pager pager-single"><span>共 ${total} 条</span></div>` : "";
  return `
    <nav class="pager" aria-label="${escapeHtml(label)}分页">
      <button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <span>第 ${page} / ${totalPages} 页 · 共 ${total} 条</span>
      <button type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    </nav>
  `;
}

function bindPagination(container, callback) {
  container.querySelectorAll(".pager button[data-page]").forEach((button) => {
    button.addEventListener("click", () => callback(Number(button.dataset.page)));
  });
}

function avatarHtml(user, size = "small") {
  const name = user?.displayName || user?.username || "W";
  const initial = escapeHtml(name.trim().slice(0, 1).toUpperCase() || "W");
  if (user?.avatarUrl) return `<img class="user-avatar ${size}" src="${escapeHtml(user.avatarUrl)}" alt="" loading="lazy" />`;
  return `<span class="user-avatar ${size}">${initial}</span>`;
}

function organizationAvatarHtml(organization, size = "medium") {
  const name = organization?.name || organization?.slug || "W";
  const initial = escapeHtml(name.trim().slice(0, 1).toUpperCase() || "W");
  if (organization?.avatarImage) return `<img class="organization-avatar ${size}" src="${escapeHtml(organization.avatarImage)}" alt="" loading="lazy" />`;
  return `<span class="organization-avatar ${size}">${initial}</span>`;
}
const SOCIAL_PROFILE_TYPES = [
  { key: "website", label: "个人网站", mark: "WEB", placeholder: "https://example.com" },
  { key: "blog", label: "个人博客", mark: "BLOG", placeholder: "https://blog.example.com" },
  { key: "github", label: "GitHub", mark: "GH", placeholder: "https://github.com/username" },
  { key: "zhihu", label: "知乎", mark: "ZH", placeholder: "https://www.zhihu.com/people/..." },
  { key: "bilibili", label: "哔哩哔哩", mark: "B", placeholder: "https://space.bilibili.com/..." },
  { key: "x", label: "X", mark: "X", placeholder: "https://x.com/username" },
  { key: "mastodon", label: "Mastodon", mark: "M", placeholder: "https://mastodon.social/@username" },
];

function socialLinksHtml(links = {}, variant = "card") {
  const entries = SOCIAL_PROFILE_TYPES.filter(({ key }) => /^https?:\/\//i.test(String(links?.[key] || "")));
  if (!entries.length) {
    return variant === "card" ? `<p class="social-links-empty">添加个人网站或社交资料，让协作者更容易找到你。</p>` : "";
  }
  const variantClass = variant === "public" ? "public-social-links" : variant === "context" ? "messaging-context-social-links" : "";
  return `<div class="profile-social-links ${variantClass}" aria-label="外部资料">${entries.map(({ key, label, mark }) => `
    <a class="profile-social-link is-${key}" href="${escapeHtml(links[key])}" target="_blank" rel="noopener noreferrer" title="打开 ${escapeHtml(label)}">
      <span class="profile-social-mark" aria-hidden="true">${mark}</span><span>${escapeHtml(label)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
    </a>`).join("")}</div>`;
}

function profileSocialFields(links = {}) {
  return `<fieldset class="profile-social-fields"><legend>外部资料</legend><p class="muted-line">填写后将显示在公开主页。</p><div class="profile-social-grid">${SOCIAL_PROFILE_TYPES.map(({ key, label, placeholder }) => `<label>${label}<input name="social_${key}" value="${escapeHtml(links?.[key] || "")}" placeholder="${escapeHtml(placeholder)}" inputmode="url" /></label>`).join("")}</div></fieldset>`;
}

function readProfileSocialLinks(form) {
  return Object.fromEntries(SOCIAL_PROFILE_TYPES.map(({ key }) => [key, String(form.elements[`social_${key}`]?.value || "").trim()]));
}

const pagePreviewCache = new Map();
const knowledgeObjectPreviewCache = new Map();
let pagePreviewTimer = null;
let pagePreviewHideTimer = null;

function normalizeClientSlug(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
}

function slugFromPageHref(href) {
  const raw = String(href || "");
  const match = raw.match(/^#\/page\/(.+)$/);
  if (!match) return "";
  return normalizeClientSlug(match[1].split(/[?#]/)[0]).trim().replace(/\s+/g, "-").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function knownPageSlugs() {
  return new Set((state.pages || []).map((page) => String(page.slug || "").toLowerCase()));
}

function ensurePagePreviewCard() {
  let card = document.querySelector("#pageLinkPreview");
  if (card) return card;
  card = document.createElement("aside");
  card.id = "pageLinkPreview";
  card.className = "page-link-preview";
  card.setAttribute("role", "status");
  card.addEventListener("mouseenter", () => {
    if (pagePreviewHideTimer) window.clearTimeout(pagePreviewHideTimer);
  });
  card.addEventListener("mouseleave", hidePagePreview);
  document.body.appendChild(card);
  return card;
}

function positionPagePreview(card, link) {
  const rect = link.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 24);
  card.style.width = `${width}px`;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  card.style.left = `${left}px`;
  card.style.top = `${Math.min(rect.bottom + 10, window.innerHeight - 170)}px`;
}

function hidePagePreview() {
  if (pagePreviewTimer) window.clearTimeout(pagePreviewTimer);
  pagePreviewHideTimer = window.setTimeout(() => {
    document.querySelector("#pageLinkPreview")?.classList.remove("active");
  }, 120);
}

async function fetchPagePreview(slug) {
  if (pagePreviewCache.has(slug)) return pagePreviewCache.get(slug);
  const payload = await api(`/api/pages/${encodeSlug(slug)}/preview`).catch(() => ({ exists: false, slug }));
  pagePreviewCache.set(slug, payload);
  return payload;
}

function previewHtml(payload, fallbackSlug) {
  if (!payload?.exists) {
    return `<div class="preview-missing"><strong>词条尚未创建</strong><p>${escapeHtml(fallbackSlug)}</p><a href="#/edit/${encodeSlug(fallbackSlug)}">创建该词条</a></div>`;
  }
  const image = payload.heroImage ? `<img src="${escapeHtml(payload.heroImage)}" alt="" loading="lazy" />` : "";
  const cats = (payload.categories || []).slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  return `${image}<div class="preview-copy"><strong>${escapeHtml(payload.title)}</strong><p>${escapeHtml(payload.summary || "暂无摘要。")}</p><div>${cats}<span>${escapeHtml(payload.quality || "C")}</span></div></div>`;
}

async function fetchKnowledgeObjectPreview(type, id) {
  const key = `${type}:${id}`;
  if (knowledgeObjectPreviewCache.has(key)) return knowledgeObjectPreviewCache.get(key);
  const payload = await api(`/api/community/qa/object-preview?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`).catch(() => null);
  knowledgeObjectPreviewCache.set(key, payload);
  return payload;
}

function knowledgeObjectPreviewHtml(payload, type, id) {
  const object = payload?.object;
  if (!object) return `<div class="preview-missing"><strong>对象暂不可预览</strong><p>${escapeHtml(id)}</p></div>`;
  const labels = { question: "社区问题", answer: "社区回答", comment: "社区评论", organization: "协作组织", user: "用户", revision: "词条修订", selection: "正文划词" };
  return `<div class="preview-copy knowledge-object-preview-copy"><span>${escapeHtml(labels[type] || type)}</span><strong>${escapeHtml(object.title || object.key)}</strong><p>${escapeHtml(object.summary || "暂无摘要。")}</p><div><span>${Number(payload.relationCount || 0)} 项知识关联</span><span>${escapeHtml(object.source || "wikist")}</span></div></div>`;
}

function showPagePreview(link, slug) {
  if (pagePreviewTimer) window.clearTimeout(pagePreviewTimer);
  if (pagePreviewHideTimer) window.clearTimeout(pagePreviewHideTimer);
  pagePreviewTimer = window.setTimeout(async () => {
    const card = ensurePagePreviewCard();
    card.innerHTML = `<div class="preview-loading">正在读取词条概要...</div>`;
    positionPagePreview(card, link);
    card.classList.add("active");
    const payload = await fetchPagePreview(slug);
    link.classList.toggle("wiki-link-existing", Boolean(payload.exists));
    link.classList.toggle("wiki-link-missing", !payload.exists);
    card.innerHTML = previewHtml(payload, slug);
    positionPagePreview(card, link);
  }, 120);
}

function showKnowledgeObjectPreview(link, type, id) {
  if (pagePreviewTimer) window.clearTimeout(pagePreviewTimer);
  if (pagePreviewHideTimer) window.clearTimeout(pagePreviewHideTimer);
  pagePreviewTimer = window.setTimeout(async () => {
    const card = ensurePagePreviewCard();
    card.innerHTML = '<div class="preview-loading">正在读取知识对象...</div>';
    positionPagePreview(card, link);
    card.classList.add("active");
    const payload = await fetchKnowledgeObjectPreview(type, id);
    card.innerHTML = knowledgeObjectPreviewHtml(payload, type, id);
    positionPagePreview(card, link);
  }, 120);
}

function enhanceWikiLinks(root = el.main) {
  if (!root) return;
  const existing = knownPageSlugs();
  const scopeSelector = ".article-body,.comment-body,.search-results,.refined-search-results,.user-profile-body,.archived-body,.qa-prose";
  const scopes = root.matches?.(scopeSelector) ? [root] : [...root.querySelectorAll(scopeSelector)];
  scopes.forEach((scope) => {
    scope.querySelectorAll('a[href^="#/page/"]').forEach((link) => {
      if (link.closest(".editor-actions,.page-tool-nav,.topbar,.nav-section,.sidebar-footer,.transfer-hub,.wiki-link-grid,.article-head,.admin-layout,.admin-shell,.recent-list")) return;
      if (link.dataset.wikiPreviewBound === "1") return;
      const slug = slugFromPageHref(link.getAttribute("href"));
      if (!slug) return;
      const language = normalizeLanguageCode(state.pageLanguage || "zh-CN", "zh-CN");
      if (language !== "zh-CN" && !link.dataset.languageAware) {
        link.dataset.languageAware = "true";
        link.setAttribute("href", `#/page/${encodeSlug(slug)}?lang=${encodeURIComponent(language)}`);
      }
      link.dataset.wikiPreviewBound = "1";
      link.dataset.pageSlug = slug;
      link.classList.add("wiki-page-link");
      const exists = existing.has(slug);
      link.classList.toggle("wiki-link-existing", exists);
      link.classList.toggle("wiki-link-missing", state.pagesComplete && !exists);
      link.addEventListener("mouseenter", () => showPagePreview(link, slug));
      link.addEventListener("focus", () => showPagePreview(link, slug));
      link.addEventListener("mouseleave", hidePagePreview);
      link.addEventListener("blur", hidePagePreview);
    });
  });
}

function enhanceKnowledgeObjectLinks(root = el.main) {
  if (!root) return;
  root.querySelectorAll("a[data-object-type][data-object-id]").forEach((link) => {
    if (link.dataset.objectPreviewBound === "1") return;
    const type = String(link.dataset.objectType || "").toLowerCase();
    const id = String(link.dataset.objectId || "").trim();
    if (!id || ["wiki_entry", "page", "chat_message"].includes(type)) return;
    link.dataset.objectPreviewBound = "1";
    link.addEventListener("mouseenter", () => showKnowledgeObjectPreview(link, type, id));
    link.addEventListener("focus", () => showKnowledgeObjectPreview(link, type, id));
    link.addEventListener("mouseleave", hidePagePreview);
    link.addEventListener("blur", hidePagePreview);
  });
}

function favoriteButtonHtml(page) {
  if (!page?.slug) return "";
  return `
    <button class="article-favorite-button" id="pageFavoriteButton" type="button" data-page-favorite="${escapeHtml(page.slug)}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z"/></svg>
      <span data-favorite-label>收藏</span>
    </button>`;
}

function updateFavoriteButton(button, favorite = {}) {
  if (!button) return;
  const active = Boolean(favorite.favorited);
  const count = Number(favorite.count || 0);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.title = active ? "取消收藏" : "收藏词条";
  const label = button.querySelector("[data-favorite-label]");
  if (label) label.textContent = active ? `已收藏${count ? ` · ${count}` : ""}` : count ? `收藏 · ${count}` : "收藏";
}

async function loadPageFavorite(slug) {
  const button = document.querySelector("#pageFavoriteButton");
  if (!button) return;
  const payload = await api(`/api/pages/${encodeSlug(slug)}/favorite`).catch(() => ({ favorite: { favorited: false, count: 0 } }));
  updateFavoriteButton(button, payload.favorite);
  button.addEventListener("click", async () => {
    if (!state.user) {
      const goLogin = await uiConfirm({ title: "登录后收藏词条", text: `收藏会同步到你的 ${currentPassportName()}。`, confirmText: "去登录" });
      if (goLogin) location.hash = "#/login";
      return;
    }
    const favorited = button.getAttribute("aria-pressed") !== "true";
    button.disabled = true;
    try {
      const result = await api(`/api/pages/${encodeSlug(slug)}/favorite`, { method: "PUT", body: JSON.stringify({ favorited }) });
      updateFavoriteButton(button, result.favorite);
      await refreshUser();
      uiToast(result.favorite.favorited ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      await uiAlert("收藏失败", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

function pageWatchButtonHtml(page) {
  if (!page?.slug) return "";
  return `
    <button class="article-watch-button" id="pageWatchButton" type="button" data-page-watch="${escapeHtml(page.slug)}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5c0 2.1-.88 4-2.3 5.36L18.5 21H5.5l1.3-3.64A7.46 7.46 0 0 1 4.5 12 7.5 7.5 0 0 1 12 4.5Zm0 3a4.5 4.5 0 0 0-4.5 4.5c0 1.36.6 2.58 1.55 3.4l.44.38-.58 1.62h6.18l-.58-1.62.44-.38A4.47 4.47 0 0 0 16.5 12 4.5 4.5 0 0 0 12 7.5Z"/></svg>
      <span data-watch-label>关注更新</span>
    </button>`;
}

function updatePageWatchButton(button, watch = {}) {
  if (!button) return;
  const active = Boolean(watch.watched);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.title = active ? "取消关注词条更新" : "关注词条更新";
  const label = button.querySelector("[data-watch-label]");
  if (label) label.textContent = active ? "已关注更新" : "关注更新";
}

async function loadPageWatch(slug) {
  const button = document.querySelector("#pageWatchButton");
  if (!button) return;
  const payload = await api(`/api/pages/${encodeSlug(slug)}/watch`).catch(() => ({ watch: { watched: false } }));
  updatePageWatchButton(button, payload.watch);
  button.addEventListener("click", async () => {
    if (!state.user) {
      const goLogin = await uiConfirm({ title: "登录后关注词条", text: "关注后，词条、分类和译文更新会进入你的消息中心。", confirmText: "去登录" });
      if (goLogin) location.hash = "#/login";
      return;
    }
    button.disabled = true;
    try {
      const enabled = button.getAttribute("aria-pressed") !== "true";
      const result = await api(`/api/pages/${encodeSlug(slug)}/watch`, { method: "PUT", body: JSON.stringify({ enabled }) });
      updatePageWatchButton(button, result.watch);
      await refreshUser();
      uiToast(result.watch.watched ? "已关注词条更新" : "已取消关注");
    } catch (error) {
      await uiAlert("关注失败", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

function knowledgeLinkRow(item, label) {
  const title = item.title || item.slug;
  if (!item.exists) return `<div class="knowledge-list-item is-missing"><span>${escapeHtml(label)}</span><strong>${escapeHtml(title)}</strong><small>词条尚未创建</small></div>`;
  return `<a class="knowledge-list-item" href="#/page/${encodeSlug(item.slug)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(item.summary || item.slug)}</small></a>`;
}

function knowledgeLinkPagerHtml(pagination, kind, pages = {}) {
  const info = pagination || { page: 1, total: 0, totalPages: 1, hasPrevious: false, hasNext: false };
  if (!info.total) return "";
  if (Number(info.totalPages) <= 1) return `<div class="knowledge-link-pager single"><span>共 ${Number(info.total)} 条</span></div>`;
  const previous = Math.max(1, Number(info.page) - 1);
  const next = Math.min(Number(info.totalPages), Number(info.page) + 1);
  const button = (label, targetPage, disabled) => `<button class="mini-link knowledge-pagination-button" type="button" data-knowledge-link-page="1" data-knowledge-link-kind="${kind}" data-backlinks-page="${kind === "backlinks" ? targetPage : Number(pages.backlinksPage || 1)}" data-outgoing-page="${kind === "outgoing" ? targetPage : Number(pages.outgoingPage || 1)}" ${disabled ? "disabled" : ""}>${label}</button>`;
  return `<nav class="knowledge-link-pager" aria-label="${kind === "backlinks" ? "反向链接" : "正文链接"}分页">${button("上一页", previous, !info.hasPrevious)}<span>第 ${Number(info.page)} / ${Number(info.totalPages)} 页 · 共 ${Number(info.total)} 条</span>${button("下一页", next, !info.hasNext)}</nav>`;
}

async function loadPageKnowledge(slug, pages = {}) {
  const target = document.querySelector("#pageKnowledgePanel");
  if (!target) return;
  const backlinksPage = Math.max(1, Number(pages.backlinksPage) || 1);
  const outgoingPage = Math.max(1, Number(pages.outgoingPage) || 1);
  const payload = await api(`/api/pages/${encodeSlug(slug)}/links?backlinksPage=${backlinksPage}&outgoingPage=${outgoingPage}&limit=8`).catch(() => null);
  if (!payload) return;
  renderRecommendationItems(payload.recommendations || [], slug);
  const aliases = (payload.aliases || []).map((item) => `<span class="chip">别名 ${escapeHtml(item.aliasSlug)}</span>`).join("");
  const backlinks = payload.backlinks || [];
  const outgoing = payload.outgoing || [];
  const backlinksPagination = payload.backlinksPagination || { page: backlinksPage, total: backlinks.length, totalPages: 1, hasPrevious: false, hasNext: false };
  const outgoingPagination = payload.outgoingPagination || { page: outgoingPage, total: outgoing.length, totalPages: 1, hasPrevious: false, hasNext: false };
  target.innerHTML = `
    <section class="knowledge-panel">
      <div class="section-title-row"><div><h2>知识链接</h2><p class="muted-line">查看引用本词条及正文指向的词条。</p></div><a class="mini-link" href="#/knowledge">浏览知识网络</a></div>
      ${aliases ? `<div class="chip-row knowledge-aliases">${aliases}</div>` : ""}
      <div class="knowledge-grid compact">
        <div><h3>反向链接 <span>${Number(backlinksPagination.total || 0)}</span></h3>${backlinks.length ? backlinks.map((item) => knowledgeLinkRow(item, "来自")).join("") : '<p class="muted-line">暂无其他词条链接到这里。</p>'}${knowledgeLinkPagerHtml(backlinksPagination, "backlinks", { backlinksPage, outgoingPage })}</div>
        <div><h3>正文链接 <span>${Number(outgoingPagination.total || 0)}</span></h3>${outgoing.length ? outgoing.map((item) => knowledgeLinkRow(item, "指向")).join("") : '<p class="muted-line">正文中尚未建立 Wiki 链接。</p>'}${knowledgeLinkPagerHtml(outgoingPagination, "outgoing", { backlinksPage, outgoingPage })}</div>
      </div>
    </section>`;
  target.querySelectorAll("[data-knowledge-link-page]").forEach((button) => {
    button.addEventListener("click", () => loadPageKnowledge(slug, {
      backlinksPage: Number(button.dataset.backlinksPage) || 1,
      outgoingPage: Number(button.dataset.outgoingPage) || 1,
    }));
  });
  enhanceWikiLinks(target);
}

async function loadPageQuestions(page, currentPage = 1) {
  const target = document.querySelector("#pageQaPanel");
  if (!target || !page?.slug) return;
  const pageNumber = Math.max(1, Number(currentPage) || 1);
  const payload = await api(`/api/community/qa/related?type=wiki_entry&id=${encodeURIComponent(page.slug)}&page=${pageNumber}&limit=6`).catch(() => ({ items: [], page: 1, limit: 6, total: 0, pages: 1 }));
  const items = Array.isArray(payload.items) ? payload.items : [];
  const info = {
    page: Math.max(1, Number(payload.page) || pageNumber),
    pages: Math.max(1, Number(payload.pages) || 1),
    total: Math.max(0, Number(payload.total) || 0),
  };
  const renderer = communityQaController(target, { embedded: true });
  const pager = info.total > 0
    ? `<nav class="qa-pager page-qa-pager" aria-label="相关问题分页"><button type="button" data-page-qa-page="${Math.max(1, info.page - 1)}" ${info.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${info.page} / ${info.pages} 页 · 共 ${info.total} 条</span><button type="button" data-page-qa-page="${Math.min(info.pages, info.page + 1)}" ${info.page >= info.pages ? "disabled" : ""}>下一页</button></nav>`
    : "";
  target.innerHTML = `<section class="page-qa-panel"><header class="section-title-row"><div><span class="system-kicker">Wikist Community</span><h2>相关问答</h2><p class="muted-line">围绕本词条提出问题，并让成熟结论回流正文。</p></div><button class="qa-secondary-action" type="button" data-page-ask-question>${navigationIconSvg("forum")}<span>围绕本词条提问</span></button></header><div class="qa-question-list ${items.length ? "" : "is-empty"}">${items.length ? items.map((item) => renderer.questionRow(item)).join("") : '<div class="qa-empty-state compact"><h2>还没有相关问题</h2><p>提出第一个可追踪的问题。</p></div>'}</div>${pager}</section>`;
  target.querySelector("[data-page-ask-question]")?.addEventListener("click", () => {
    window.WikistCommunityQA.questionDraftFromSource({
      type: "wiki_entry",
      id: page.slug,
      label: page.title || page.slug,
      url: `#/page/${encodeSlug(page.slug)}`,
      pageSlug: page.slug,
    });
    location.hash = "#/questions?compose=1";
  });
  target.querySelectorAll("[data-page-qa-page]").forEach((button) => button.addEventListener("click", () => {
    if (!button.disabled) loadPageQuestions(page, Number(button.dataset.pageQaPage) || 1);
  }));
}

function articleHeader(page) {
  const categories = page.categories?.length ? page.categories.map((item) => `<a class="chip category-chip" href="#/category/${encodeURIComponent(item)}">${escapeHtml(item)}</a>`).join("") : '<span class="chip">未分类</span>';
  const hero = page.heroImage ? `<figure class="article-hero-image"><img src="${escapeHtml(page.heroImage)}" alt="" loading="lazy" /></figure>` : "";
  const languageChip = page.language && page.language !== "zh-CN"
    ? `<span class="chip">语言 ${escapeHtml(languageLabel(page.language))}${page.translationProgress !== undefined ? ` · ${Number(page.translationProgress || 0)}%` : ""}</span>`
    : "";
  const authorLabel = page.authorDisplayName || page.author || "Wikist";
  const authorChip = page.authorUsername
    ? `<a class="chip article-author-chip" href="#/user/${encodeURIComponent(page.authorUsername)}" aria-label="查看 ${escapeHtml(authorLabel)} 的用户主页">作者 ${escapeHtml(authorLabel)}</a>`
    : `<span class="chip">作者 ${escapeHtml(authorLabel)}</span>`;
  const sectionShortcuts = `<nav class="article-section-shortcuts" aria-label="词条扩展功能"><button type="button" data-article-section="pageKnowledgePanel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2.1-2.1a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 11a5 5 0 0 0-7.1-.1l-2.1 2.1a5 5 0 0 0 7.1 7.1l1.2-1.2"/></svg><span>知识链接</span></button><button type="button" data-article-section="pageQaPanel">${navigationIconSvg("forum")}<span>问答讨论</span></button><button type="button" data-article-section="pageCommunityPanel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-1v6m3-3h-6"/></svg><span>组织协作</span></button><button type="button" data-article-section="pageRatingPanel" data-rating-shortcut><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z"/></svg><span>${escapeHtml(articleRatingShortcutLabel(page.rating))}</span></button></nav>`;
  return `
    <header class="article-head article-entry-head ${page.heroImage ? "article-head-with-image" : ""}">
      ${hero}
      <div class="article-title-row">
        <h1>${escapeHtml(page.title)}</h1>
        <div class="article-title-actions"><div class="article-title-primary-actions"><span class="quality-badge">质量 ${escapeHtml(page.quality || "C")}</span>${favoriteButtonHtml(page)}${pageWatchButtonHtml(page)}${pageShareButtonHtml(page)}</div>${sectionShortcuts}</div>
      </div>
      <p class="article-summary">${escapeHtml(page.summary || "")}</p>
      <div class="meta-row">
        <span class="chip">${escapeHtml(page.difficulty || "未分级")}</span>
        <span class="chip">${escapeHtml(page.status || "draft")}</span>
        ${authorChip}
        <span class="chip">更新 ${fmtDate(page.updatedAt)}</span>
        <span class="chip">${escapeHtml(state.site?.license || "CC BY-SA 4.0")}</span>
        ${languageChip}
        ${categories}
      </div>
    </header>
  `;
}

function pageShareButtonHtml(page) {
  return `<button class="article-share-button page-share-button" type="button" data-share-page data-page-slug="${escapeHtml(page.slug)}" data-page-title="${escapeHtml(page.title)}" aria-label="转发词条">${navigationIconSvg("share")}<span>转发词条</span></button>`;
}

function closePageShareDialog() {
  const layer = document.querySelector("#pageShareLayer");
  if (!layer) return;
  if (layer._escapeHandler) document.removeEventListener("keydown", layer._escapeHandler);
  layer.remove();
}

function pageShareUserResult(user) {
  const context = user.shareContext ? ` · ${user.shareContext}` : "";
  return `<button class="page-share-target" type="button" data-share-user="${Number(user.id)}">${avatarHtml(user, "small")}<span><strong>${escapeHtml(user.displayName || user.username)}</strong><small>@${escapeHtml(user.username)}${escapeHtml(context)}</small></span><em>转发</em></button>`;
}

function pageShareOrganizationResult(item) {
  const slug = item.organizationSlug || item.metadata?.organizationSlug || item.slug || "";
  const name = item.organizationName || item.name || item.title || slug;
  const context = item.shareContext ? ` · ${item.shareContext}` : "";
  return `<button class="page-share-target" type="button" data-share-organization="${escapeHtml(slug)}"><span class="page-share-organization-mark">${escapeHtml(String(name || "W").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(slug)} · ${escapeHtml(organizationRoleLabel(item.role))}${escapeHtml(context)}</small></span><em>转发</em></button>`;
}

function pageShareTargetList(items, renderer, heading, emptyText) {
  if (!items.length) return `<p class="muted-line page-share-empty">${escapeHtml(emptyText)}</p>`;
  return `<div class="page-share-results-heading"><strong>${escapeHtml(heading)}</strong><span>${items.length} 个</span></div>${items.map(renderer).join("")}`;
}

async function openPageShareDialog(page, options = {}) {
  const selection = options.selection || null;
  const shareNoun = selection ? "划词" : "词条";
  const shareTitle = selection ? `划词 · ${selection.objectLabel || page.title}` : page.title;
  if (!state.user) {
    const accepted = await uiConfirm({ title: `登录后转发${shareNoun}`, text: "登录后可转发给私信联系人或协作组织。", confirmText: "去登录" });
    if (accepted) location.hash = "#/login";
    return;
  }
  closePageShareDialog();
  const layer = document.createElement("section");
  layer.id = "pageShareLayer";
  layer.className = "wikist-modal-layer page-share-layer";
  layer.innerHTML = `<article class="wikist-modal page-share-dialog" role="dialog" aria-modal="true" aria-labelledby="pageShareTitle"><header><div><span class="system-kicker">Share Knowledge</span><h2 id="pageShareTitle">转发 ${escapeHtml(shareTitle)}</h2></div><button type="button" data-close-page-share aria-label="关闭">×</button></header>${selection ? `<blockquote class="page-share-selection-preview">${escapeHtml(shortText(selection.selectedText || "", 260))}</blockquote>` : ""}<nav class="page-share-tabs" aria-label="转发目标"><button class="active" type="button" data-share-tab="direct">私信</button><button type="button" data-share-tab="organization">组织</button></nav><section class="page-share-panel active" data-share-panel="direct"><label class="page-share-search wikist-field"><span>查找用户</span><input class="wikist-input" id="pageShareUserSearch" autocomplete="off" placeholder="输入用户名或显示名称" /></label><div class="page-share-results" id="pageShareUserResults"><p class="muted-line page-share-empty">正在读取最近联系人...</p></div></section><section class="page-share-panel" data-share-panel="organization" hidden><div class="page-share-results" id="pageShareOrganizationResults"><p class="muted-line page-share-empty">正在读取你的组织...</p></div></section><label class="page-share-note wikist-field"><span>附言</span><textarea class="wikist-input" id="pageShareNote" rows="3" maxlength="500" placeholder="补充推荐理由或需要关注的内容（可选）"></textarea></label><p class="status-line" id="pageShareStatus"></p></article>`;
  document.body.appendChild(layer);
  const close = () => closePageShareDialog();
  layer._escapeHandler = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", layer._escapeHandler);
  layer.addEventListener("click", async (event) => {
    if (event.target === layer || event.target.closest("[data-close-page-share]")) { close(); return; }
    const tab = event.target.closest("[data-share-tab]");
    if (tab) {
      layer.querySelectorAll("[data-share-tab]").forEach((button) => button.classList.toggle("active", button === tab));
      layer.querySelectorAll("[data-share-panel]").forEach((panel) => { const active = panel.dataset.sharePanel === tab.dataset.shareTab; panel.hidden = !active; panel.classList.toggle("active", active); });
      if (tab.dataset.shareTab === "direct") layer.querySelector("#pageShareUserSearch")?.focus();
      return;
    }
    const userTarget = event.target.closest("[data-share-user]");
    const organizationTarget = event.target.closest("[data-share-organization]");
    if (!userTarget && !organizationTarget) return;
    const status = layer.querySelector("#pageShareStatus");
    const target = userTarget || organizationTarget;
    target.disabled = true;
    status.textContent = "正在转发...";
    try {
      const started = userTarget
        ? await api("/api/messaging/conversations/direct", { method: "POST", body: JSON.stringify({ userId: Number(userTarget.dataset.shareUser) }) })
        : await api("/api/messaging/conversations/organization", { method: "POST", body: JSON.stringify({ organizationSlug: organizationTarget.dataset.shareOrganization }) });
      const note = layer.querySelector("#pageShareNote")?.value.trim() || "";
      const reference = selection
        ? { type: "selection", id: String(selection.id), label: `划词 · ${selection.objectLabel || page.title}`, relation: "quote" }
        : { type: "wiki_entry", id: page.slug, label: page.title, relation: "share" };
      const token = messagingReferenceToken(reference);
      const quote = selection ? String(selection.selectedText || "").split("\n").map((line) => `> ${line}`).join("\n") : "";
      const bodyMd = selection
        ? `${note ? `${note}\n\n` : ""}${quote}\n\n${token}`
        : `${note ? `${note}\n\n` : ""}转发词条：${token}`;
      await api(`/api/messaging/conversations/${encodeURIComponent(started.conversation.id)}/messages`, { method: "POST", body: JSON.stringify({ bodyMd, references: [reference], clientNonce: `share-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) });
      if (selection) {
        await recordSelectionQuote(
          selection,
          "chat",
          String(started.conversation.id),
          target.querySelector("strong")?.textContent?.trim() || (userTarget ? "私信" : "组织群聊"),
          { conversationKind: userTarget ? "direct" : "organization" },
        );
      }
      close();
      uiToast(`${shareNoun}已转发`);
    } catch (error) {
      target.disabled = false;
      status.textContent = error.message || "转发失败";
    }
  });
  let searchTimer = 0;
  let recentUsers = [];
  const search = layer.querySelector("#pageShareUserSearch");
  search?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    const query = search.value.trim();
    const results = layer.querySelector("#pageShareUserResults");
    if (!query) {
      results.innerHTML = pageShareTargetList(recentUsers, pageShareUserResult, "最近私信", "还没有可推荐的私信联系人。");
      return;
    }
    searchTimer = window.setTimeout(async () => {
      results.innerHTML = '<p class="muted-line page-share-empty">正在查找...</p>';
      const payload = await api(`/api/messaging/users/suggest?q=${encodeURIComponent(query)}&limit=12`).catch(() => ({ items: [] }));
      const recentRank = new Map(recentUsers.map((item, index) => [Number(item.id), index]));
      const items = [...(payload.items || [])].sort((left, right) => (recentRank.get(Number(left.id)) ?? 999) - (recentRank.get(Number(right.id)) ?? 999));
      results.innerHTML = pageShareTargetList(items, pageShareUserResult, "匹配用户", "没有匹配用户。");
    }, 160);
  });
  const organizationResults = layer.querySelector("#pageShareOrganizationResults");
  const [conversationPayload, organizations] = await Promise.all([
    api("/api/messaging/conversations?page=1&limit=24").catch(() => ({ items: [] })),
    api("/api/passport/organizations?page=1&limit=30&pending=false").catch(() => ({ items: [] })),
  ]);
  if (!layer.isConnected) return;
  recentUsers = (conversationPayload.items || [])
    .filter((item) => item.kind === "direct" && Number(item.messageCount || 0) > 0 && item.peer && ["active", "ok"].includes(String(item.peer.status || "active")))
    .slice(0, PAGE_SHARE_RECENT_DIRECT_LIMIT)
    .map((item) => ({ ...item.peer, shareContext: "最近私信" }));
  if (!search?.value.trim()) {
    layer.querySelector("#pageShareUserResults").innerHTML = pageShareTargetList(recentUsers, pageShareUserResult, "最近私信", "还没有可推荐的私信联系人。");
  }
  const organizationMap = new Map();
  (conversationPayload.items || [])
    .filter((item) => item.kind === "organization" && Number(item.messageCount || 0) > 0 && item.metadata?.organizationSlug)
    .forEach((item) => organizationMap.set(item.metadata.organizationSlug, { ...item, shareContext: "最近群聊" }));
  (organizations.items || []).forEach((item) => {
    const slug = item.organizationSlug || item.slug || "";
    if (slug && !organizationMap.has(slug)) organizationMap.set(slug, item);
  });
  const organizationItems = [...organizationMap.values()];
  organizationResults.innerHTML = pageShareTargetList(organizationItems, pageShareOrganizationResult, "可转发组织", "你还没有可转发的协作组织。");
  search?.focus();
}

function selectionQuoteMarkdown(selection) {
  const quote = String(selection?.selectedText || "").trim().split("\n").map((line) => `> ${line}`).join("\n");
  const label = String(selection?.objectLabel || "正文来源").replace(/[\[\]\n\r]/g, " ");
  const url = String(selection?.objectUrl || "").startsWith("#/") ? selection.objectUrl : "";
  const source = url ? `[${label}](${url})` : label;
  return `${quote}\n\n来源：${source}`;
}

function saveSelectionDraft(kind, selection) {
  try {
    sessionStorage.setItem(SELECTION_DRAFT_KEY, JSON.stringify({
      kind,
      selection,
      markdown: selectionQuoteMarkdown(selection),
      createdAt: Date.now(),
    }));
  } catch (_error) {}
}

async function recordSelectionQuote(selection, targetType, targetId = "", targetLabel = "", metadata = {}) {
  const result = await selectionApiClient.activity(selection.id, {
    activityType: "quote",
    targetType,
    targetId,
    targetLabel,
    metadata,
  });
  await selectionToolbar?.refresh(el.main);
  return result.activity;
}

function consumeSelectionDraft(kind, textarea, options = {}) {
  if (!textarea) return null;
  let draft = null;
  try { draft = JSON.parse(sessionStorage.getItem(SELECTION_DRAFT_KEY) || "null"); } catch (_error) {}
  if (!draft || draft.kind !== kind || Date.now() - Number(draft.createdAt || 0) > 30 * 60 * 1000) return null;
  const markdown = String(draft.markdown || "").trim();
  if (!markdown) return null;
  const current = textarea.value.trim();
  textarea.value = `${current ? `${current}\n\n` : ""}${markdown}${options.suffix || ""}`;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  try { sessionStorage.removeItem(SELECTION_DRAFT_KEY); } catch (_error) {}
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  return draft;
}

async function copySelectionText(text) {
  const value = String(text || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function closeSelectionAnnotationDialog() {
  const layer = document.querySelector("#selectionAnnotationLayer");
  if (!layer) return;
  if (layer._escapeHandler) document.removeEventListener("keydown", layer._escapeHandler);
  layer.remove();
  document.body.classList.remove("selection-annotation-open");
}

function selectionAnnotationCommentHtml(comment) {
  const author = comment.author || {};
  const replyTo = comment.replyTo || null;
  const canDelete = Boolean(state.user && (Number(state.user.id) === Number(comment.userId) || state.user.role === "admin"));
  const replyTarget = replyTo?.username
    ? `<p class="selection-comment-reply-label">回复 <a href="#/user/${encodeURIComponent(replyTo.username)}">@${escapeHtml(replyTo.username)}</a></p>`
    : "";
  const replyButton = state.user
    ? `<button class="text-action" type="button" data-reply-selection-comment="${Number(comment.id)}" data-reply-selection-username="${escapeHtml(author.username || "")}">回复</button>`
    : "";
  const deleteButton = canDelete ? '<button class="text-action danger" type="button" data-delete-selection-comment>删除</button>' : "";
  const body = linkCommentMentions(escapeHtml(comment.bodyPlain || comment.bodyMd || "").replace(/\n/g, "<br>"));
  return `<article class="comment-item selection-annotation-comment" data-selection-comment-id="${Number(comment.id)}"><header><a class="selection-annotation-author" href="#/user/${encodeURIComponent(author.username || "")}">${avatarHtml(author, "small")}<span><strong>${escapeHtml(author.displayName || author.username || "用户")}</strong><small>@${escapeHtml(author.username || "user")}</small></span></a><small>${fmtDate(comment.createdAt)}</small></header>${replyTarget}<div class="comment-body">${body}</div>${replyButton || deleteButton ? `<footer class="selection-comment-actions">${replyButton}${deleteButton}</footer>` : ""}</article>`;
}

async function openSelectionAnnotationDialog(snapshot, initialPayload = null) {
  closeSelectionAnnotationDialog();
  selectionToolbar?.hide();
  const layer = document.createElement("section");
  layer.id = "selectionAnnotationLayer";
  layer.className = "wikist-modal-layer selection-annotation-layer";
  layer.innerHTML = `<article class="wikist-modal selection-annotation-dialog" role="dialog" aria-modal="true" aria-labelledby="selectionAnnotationTitle"><header><div><span class="system-kicker">Text Annotation</span><h2 id="selectionAnnotationTitle">正文批注</h2></div><button type="button" data-close-selection-annotation aria-label="关闭">×</button></header><div class="selection-annotation-loading"><span class="selection-annotation-pulse" aria-hidden="true"></span><p>正在读取批注...</p></div></article>`;
  document.body.appendChild(layer);
  document.body.classList.add("selection-annotation-open");
  layer._escapeHandler = (event) => { if (event.key === "Escape") closeSelectionAnnotationDialog(); };
  document.addEventListener("keydown", layer._escapeHandler);

  let payload;
  try {
    payload = initialPayload || await selectionApiClient.resolve(snapshot, 1, Boolean(state.user && snapshot.selection?.id));
  } catch (error) {
    layer.querySelector(".selection-annotation-dialog").innerHTML = `<header><div><span class="system-kicker">Text Annotation</span><h2>批注加载失败</h2></div><button type="button" data-close-selection-annotation aria-label="关闭">×</button></header><section class="empty-state selection-annotation-error"><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }
  if (!layer.isConnected) return;
  let selection = payload.selection;
  let commentsPayload = payload.comments || { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
  let replyTarget = null;
  const quoteText = selection?.selectedText || snapshot.selector.exact;
  const objectLabel = selection?.objectLabel || snapshot.object.label;
  const ensureSelection = async () => {
    if (selection) return selection;
    const resolved = await selectionApiClient.resolve(snapshot, 1, true);
    selection = resolved.selection;
    if (!selection) throw new Error("无法创建划词，请重新选择正文后再试。");
    return selection;
  };

  const renderComments = async (page = 1) => {
    if (selection && page !== Number(commentsPayload.pagination?.page || 1)) {
      commentsPayload = await selectionApiClient.comments(selection.id, page, 20);
    }
    const { items, pagination } = normalizedPaged(commentsPayload, page, 20);
    const list = layer.querySelector("#selectionAnnotationComments");
    if (!list) return;
    list.classList.toggle("is-empty", items.length === 0);
    list.innerHTML = items.length ? items.map(selectionAnnotationCommentHtml).join("") : '<div class="selection-annotation-empty"><strong>还没有批注</strong><span>提出问题、补充来源或分享你的理解。</span></div>';
    const pager = layer.querySelector("#selectionAnnotationPager");
    if (pager) {
      pager.innerHTML = paginationHtml(pagination, "划词批注") || '<div class="pager pager-single"><span>共 0 条</span></div>';
      bindPagination(pager, (nextPage) => renderComments(nextPage).catch((error) => uiAlert("加载失败", error.message, "error")));
    }
    layer.querySelector("#selectionAnnotationCount").textContent = `${Number(pagination.total || 0)} 条批注`;
  };

  layer.querySelector(".selection-annotation-dialog").innerHTML = `
    <header><div><span class="system-kicker">Text Annotation</span><h2 id="selectionAnnotationTitle">正文批注</h2></div><button type="button" data-close-selection-annotation aria-label="关闭">×</button></header>
    <blockquote class="page-share-selection-preview selection-annotation-quote"><p>${escapeHtml(quoteText)}</p><footer><a href="${escapeHtml(selection?.objectUrl || snapshot.object.url || "#/")}">${escapeHtml(objectLabel)}</a><span id="selectionAnnotationCount">${Number(commentsPayload.pagination?.total || 0)} 条批注</span></footer></blockquote>
    <section class="selection-annotation-comments" id="selectionAnnotationComments" aria-live="polite"></section>
    <div id="selectionAnnotationPager"></div>
    ${state.user ? `<form class="selection-annotation-form" id="selectionAnnotationForm"><div class="selection-reply-context" id="selectionReplyContext" hidden><span>回复 <a href="#/" id="selectionReplyUser"></a></span><button type="button" data-cancel-selection-reply aria-label="取消回复">×</button></div><label class="wikist-field"><span>添加批注</span><textarea class="wikist-input" name="bodyMd" rows="4" maxlength="4000" required placeholder="补充观点、问题或来源"></textarea></label><footer><button class="selection-like-button ${selection?.liked ? "active" : ""}" type="button" id="selectionAnnotationLike" aria-pressed="${selection?.liked ? "true" : "false"}">${navigationIconSvg("favorite")}<span>${selection?.liked ? "已喜欢" : "喜欢"}</span><em>${Number(selection?.likeCount || 0)} 人喜欢</em></button><span class="status-line"></span><button class="command-button" type="submit">发布批注</button></footer></form>` : `<aside class="selection-annotation-login"><p>登录后可以添加批注或喜欢这段正文。</p><a class="command-button" href="#/login">登录通行证</a></aside>`}`;
  await renderComments(1);

  const setReplyTarget = (target = null) => {
    replyTarget = target;
    const context = layer.querySelector("#selectionReplyContext");
    const user = layer.querySelector("#selectionReplyUser");
    if (!context || !user) return;
    context.hidden = !target;
    user.textContent = target ? `@${target.username}` : "";
    user.href = target ? `#/user/${encodeURIComponent(target.username)}` : "#/";
  };

  layer.addEventListener("click", async (event) => {
    if (event.target === layer || event.target.closest("[data-close-selection-annotation]")) {
      closeSelectionAnnotationDialog();
      return;
    }
    if (event.target.closest("[data-cancel-selection-reply]")) {
      setReplyTarget(null);
      layer.querySelector("#selectionAnnotationForm textarea")?.focus();
      return;
    }
    const replyButton = event.target.closest("[data-reply-selection-comment]");
    if (replyButton) {
      setReplyTarget({
        commentId: Number(replyButton.dataset.replySelectionComment),
        username: String(replyButton.dataset.replySelectionUsername || "user"),
      });
      layer.querySelector("#selectionAnnotationForm textarea")?.focus();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-selection-comment]");
    if (deleteButton && selection) {
      const comment = deleteButton.closest("[data-selection-comment-id]");
      deleteButton.disabled = true;
      try {
        await selectionApiClient.deleteComment(selection.id, Number(comment.dataset.selectionCommentId));
        commentsPayload = await selectionApiClient.comments(selection.id, 1, 20);
        await renderComments(1);
        await selectionToolbar?.refresh(el.main);
        uiToast("批注已删除");
      } catch (error) {
        deleteButton.disabled = false;
        await uiAlert("删除失败", error.message, "error");
      }
      return;
    }
    const likeButton = event.target.closest("#selectionAnnotationLike");
    if (likeButton) {
      likeButton.disabled = true;
      try {
        await ensureSelection();
        const result = await selectionApiClient.like(selection.id, !selection.liked);
        selection = { ...selection, liked: result.liked, likeCount: result.likeCount };
        if (result.deleted) {
          await selectionToolbar?.refresh(el.main);
          closeSelectionAnnotationDialog();
          uiToast("已取消喜欢，划词已自动清理");
          return;
        }
        likeButton.classList.toggle("active", selection.liked);
        likeButton.setAttribute("aria-pressed", String(selection.liked));
        likeButton.querySelector("span").textContent = selection.liked ? "已喜欢" : "喜欢";
        likeButton.querySelector("em").textContent = `${selection.likeCount} 人喜欢`;
        await selectionToolbar?.refresh(el.main);
      } catch (error) {
        await uiAlert("操作失败", error.message, "error");
      } finally {
        likeButton.disabled = false;
      }
    }
  });
  layer.querySelector("#selectionAnnotationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector(".status-line");
    const bodyMd = String(new FormData(form).get("bodyMd") || "").trim();
    if (!bodyMd) return;
    status.textContent = "正在发布...";
    try {
      await ensureSelection();
      await selectionApiClient.comment(selection.id, bodyMd, replyTarget?.commentId || 0);
      form.reset();
      setReplyTarget(null);
      commentsPayload = await selectionApiClient.comments(selection.id, 1, 20);
      await renderComments(1);
      await selectionToolbar?.refresh(el.main);
      status.textContent = "批注已发布。";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  layer.querySelector(".selection-annotation-form textarea")?.focus();
}

async function resolveSelectionForWrite(snapshot) {
  if (!state.user) {
    const accepted = await uiConfirm({ title: "登录后继续", text: "登录后可以喜欢、批注或引用这段正文。", confirmText: "去登录" });
    if (accepted) location.hash = "#/login";
    return null;
  }
  const payload = await selectionApiClient.resolve(snapshot, 1, true);
  return payload.selection || null;
}

function closeSelectionPostDialog() {
  document.querySelector("#selectionPostLayer")?.remove();
}

async function openSelectionPostDialog(selection) {
  closeSelectionPostDialog();
  const layer = document.createElement("section");
  layer.id = "selectionPostLayer";
  layer.className = "wikist-modal-layer page-share-layer selection-post-layer";
  layer.innerHTML = `<article class="wikist-modal page-share-dialog" role="dialog" aria-modal="true"><header><div><span class="system-kicker">Quote To Forum</span><h2>引用到帖子</h2></div><button type="button" data-close-selection-post aria-label="关闭">×</button></header><blockquote class="page-share-selection-preview">${escapeHtml(shortText(selection.selectedText, 260))}</blockquote><div class="page-share-results" id="selectionPostTargets"><p class="muted-line page-share-empty">正在读取协作组织...</p></div></article>`;
  document.body.appendChild(layer);
  layer.addEventListener("click", async (event) => {
    if (event.target === layer || event.target.closest("[data-close-selection-post]")) closeSelectionPostDialog();
    const target = event.target.closest("[data-selection-post-organization]");
    if (!target) return;
    target.disabled = true;
    try {
      const organizationSlug = target.dataset.selectionPostOrganization;
      await recordSelectionQuote(selection, "post", organizationSlug, target.querySelector("strong")?.textContent?.trim() || organizationSlug);
      saveSelectionDraft("post", selection);
      closeSelectionPostDialog();
      location.hash = organizationForumHref(organizationSlug);
    } catch (error) {
      target.disabled = false;
      await uiAlert("引用失败", error.message, "error");
    }
  });
  const payload = await api("/api/passport/organizations?page=1&limit=30&pending=false").catch(() => ({ items: [] }));
  if (!layer.isConnected) return;
  const items = [...(payload.items || [])];
  items.sort((left, right) => Number((right.organizationSlug || right.slug) === selection.organizationSlug) - Number((left.organizationSlug || left.slug) === selection.organizationSlug));
  layer.querySelector("#selectionPostTargets").innerHTML = items.length
    ? `<div class="page-share-results-heading"><strong>选择组织</strong><span>${items.length} 个</span></div>${items.map((item) => {
      const slug = item.organizationSlug || item.slug || "";
      const name = item.organizationName || item.name || slug;
      return `<button class="page-share-target" type="button" data-selection-post-organization="${escapeHtml(slug)}">${organizationAvatarHtml({ name, avatarImage: item.avatarImage }, "small")}<span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(slug)} · ${escapeHtml(organizationRoleLabel(item.role))}</small></span><em>选择</em></button>`;
    }).join("")}`
    : '<div class="selection-annotation-empty"><strong>暂无可发布的组织</strong><span>加入协作组织后即可把划词引用到帖子。</span></div>';
}

async function handleSelectionQuote(kind, snapshot) {
  const selection = await resolveSelectionForWrite(snapshot);
  if (!selection) return;
  selection.organizationSlug = snapshot.object.organizationSlug || "";
  selection.pageSlug = snapshot.object.pageSlug || (snapshot.object.type === "wiki_entry" ? snapshot.object.id : "");
  if (kind === "answer") {
    if (!window.WikistCommunityQA) throw new Error("问答组件尚未加载，请刷新页面后重试。");
    const reference = `{{ref:selection|${selection.id}|${selection.objectLabel || "正文划词"}}}`;
    const markdown = `${selectionQuoteMarkdown(selection)}\n\n${reference}`;
    const answerForm = document.querySelector("#qaAnswerForm[data-question-id]");
    if (answerForm) {
      window.WikistCommunityQA.answerDraft(answerForm.dataset.questionId, markdown, selection);
      uiToast("已引用到回答编辑框");
      return;
    }
    window.WikistCommunityQA.answerDraft("", markdown, selection);
    location.hash = "#/questions";
    return;
  }
  if (kind === "chat") {
    await openPageShareDialog({ title: selection.objectLabel, slug: selection.pageSlug || selection.objectId }, { selection });
    return;
  }
  if (kind === "post") {
    await openSelectionPostDialog(selection);
    return;
  }
  const currentComment = document.querySelector("#commentForm textarea[name='content']");
  if (currentComment) {
    currentComment.value = `${currentComment.value.trim() ? `${currentComment.value.trim()}\n\n` : ""}${selectionQuoteMarkdown(selection)}`;
    currentComment.dispatchEvent(new Event("input", { bubbles: true }));
    currentComment.focus();
    currentComment.scrollIntoView({ behavior: "smooth", block: "center" });
    await recordSelectionQuote(selection, "comment", location.hash, document.querySelector("h1")?.textContent?.trim() || "当前评论区");
    uiToast("已引用到评论");
    return;
  }
  const pageSlug = selection.pageSlug || (selection.objectType === "wiki_entry" ? selection.objectId : "");
  if (pageSlug) {
    await recordSelectionQuote(selection, "comment", pageSlug, selection.objectLabel || pageSlug);
    saveSelectionDraft("comment", selection);
    location.hash = `#/comments/${encodeSlug(String(pageSlug).split(":")[0])}`;
    return;
  }
  await copySelectionText(selectionQuoteMarkdown(selection));
  await recordSelectionQuote(selection, "comment", "", "剪贴板草稿");
  uiToast("引用已复制，可粘贴到评论");
}

async function handleSelectionToolbarAction(action, context) {
  const snapshot = context.snapshot;
  if (action === "copy") {
    await copySelectionText(snapshot.selector.exact);
    uiToast("已复制选中文本");
    return null;
  }
  if (action === "search") {
    location.hash = searchHash({ q: snapshot.selector.exact.slice(0, 240), page: 1 });
    return null;
  }
  if (action === "question") {
    if (!window.WikistCommunityQA) throw new Error("问答组件尚未加载，请刷新页面后重试。");
    const selection = await resolveSelectionForWrite(snapshot);
    if (!selection) return null;
    window.WikistCommunityQA.questionDraftFromSource({
      type: "selection",
      id: String(selection.id),
      label: selection.objectLabel || snapshot.object.label || "正文划词",
      url: selection.objectUrl || snapshot.object.url || location.hash,
      selectedText: selection.selectedText || snapshot.selector.exact,
      pageSlug: snapshot.object.pageSlug || (snapshot.object.type === "wiki_entry" ? snapshot.object.id : ""),
    });
    selectionToolbar?.hide();
    location.hash = "#/questions?compose=1";
    return null;
  }
  if (action === "comment") {
    await openSelectionAnnotationDialog(snapshot);
    return null;
  }
  if (action === "like") {
    const selection = await resolveSelectionForWrite(snapshot);
    if (!selection) return null;
    const result = await selectionApiClient.like(selection.id, !selection.liked);
    await selectionToolbar?.refresh(el.main);
    uiToast(result.liked ? "已加入我的划词" : "已取消喜欢");
    return { ...result, canDelete: Boolean(selection.owned && (result.liked || selection.commented)) };
  }
  if (action === "delete") {
    const selection = snapshot.selection;
    if (!selection?.canDelete) return null;
    const confirmed = await uiConfirm({
      title: "删除划词？",
      text: "你的喜欢和批注会一并移除；其他用户已经参与时，他们的内容仍会保留。",
      confirmText: "删除划词",
      danger: true,
    });
    if (!confirmed) return null;
    const result = await selectionApiClient.delete(selection.id);
    await selectionToolbar?.refresh(el.main);
    uiToast(result.preserved ? "你的划词已删除，其他用户的内容仍保留" : "划词已删除");
    return result;
  }
  if (action === "quote") {
    selectionToolbar?.hide();
    await handleSelectionQuote(context.kind, snapshot);
  }
  return null;
}

function initSelectionInteractions() {
  if (selectionToolbar || !window.WikistSelection) return;
  selectionApiClient = new window.WikistSelection.SelectionApiClient(api);
  selectionToolbar = new window.WikistSelection.SelectionToolbar({
    contentSelector: "[data-selection-content]",
    loadMarkers: (object) => selectionApiClient.markers(object),
    onAction: async (action, context) => {
      try {
        return await handleSelectionToolbarAction(action, context);
      } catch (error) {
        await uiAlert("划词操作失败", error.message, "error");
        return null;
      }
    },
  });
  window.WikistSelectionAPI = selectionApiClient;
  window.WikistSelectionDraft = Object.freeze({ save: saveSelectionDraft, consume: consumeSelectionDraft });
}

function articleRatingShortcutLabel(rating = {}) {
  const count = Number(rating.count || 0);
  const average = Number(rating.average || 0);
  return count ? `词条评分 ${average.toFixed(1)}` : "词条评分";
}

function updateArticleRatingShortcut(rating = {}) {
  document.querySelectorAll("[data-rating-shortcut] span").forEach((label) => {
    label.textContent = articleRatingShortcutLabel(rating);
  });
}

function bindArticleSectionShortcuts() {
  document.querySelectorAll("[data-article-section]").forEach((button) => button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.articleSection);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("anchor-pulse");
    window.setTimeout(() => target.classList.remove("anchor-pulse"), 1200);
  }));
  document.querySelectorAll("[data-share-page]").forEach((button) => button.addEventListener("click", () => openPageShareDialog({
    slug: button.dataset.pageSlug,
    title: button.dataset.pageTitle,
  })));
}

function mathematicalMetadataHtml(page) {
  const prerequisites = page.prerequisites || [];
  const related = page.relatedPages || [];
  const canonicalNames = page.canonicalNames || [];
  const notation = page.notation || [];
  const classifications = page.classifications || [];
  if (!prerequisites.length && !related.length && !canonicalNames.length && !notation.length && !classifications.length && !page.topic) return "";
  const linkList = (items) => items.map((slug) => `<a href="#/page/${encodeSlug(slug)}">${escapeHtml(slug)}</a>`).join("");
  return `<section class="math-metadata-panel"><div class="math-metadata-head"><div><span class="system-kicker">Mathematical Context</span><h2>知识上下文</h2></div>${page.topic ? `<a class="topic-chip" href="#/topic/${encodeURIComponent(page.topic)}">${escapeHtml(page.topic)}</a>` : ""}</div><div class="math-metadata-grid">${canonicalNames.length ? `<section><small>规范名称</small><div class="chip-row">${canonicalNames.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div></section>` : ""}${classifications.length ? `<section><small>分类标识</small><div class="chip-row">${classifications.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div></section>` : ""}${prerequisites.length ? `<section><small>前置知识</small><div class="metadata-link-list">${linkList(prerequisites)}</div></section>` : ""}${related.length ? `<section><small>相关词条</small><div class="metadata-link-list">${linkList(related)}</div></section>` : ""}${notation.length ? `<section class="notation-section"><small>记号约定</small><div class="notation-list">${notation.map((item) => `<div><strong>${escapeHtml(item.symbol)}</strong><span>${escapeHtml(item.meaning || "未说明")}</span>${item.scope ? `<em>${escapeHtml(item.scope)}</em>` : ""}</div>`).join("")}</div></section>` : ""}</div></section>`;
}

function disambiguationPanelHtml(page) {
  if (!page?.isDisambiguation) return "";
  const targets = page.disambiguationTargets || [];
  return `
    <section class="disambiguation-panel" aria-label="词条消歧">
      <div><span class="system-kicker">Wikist Disambiguation</span><h2>这个名称可能指向多个概念</h2><p>请选择与当前阅读意图对应的词条。</p></div>
      <div class="disambiguation-targets">${targets.length ? targets.map((target) => `<a href="#/page/${encodeSlug(target.slug)}"><strong>${escapeHtml(target.label || target.slug)}</strong><span>${escapeHtml(target.summary || target.slug)}</span></a>`).join("") : '<p class="muted-line">尚未添加消歧指向。</p>'}</div>
    </section>`;
}

function citationQualityPanelHtml(page) {
  const stats = page?.citationStats || {};
  const total = Number(stats.total || 0);
  const unresolved = stats.unresolved || [];
  const issues = stats.issues || [];
  const needsSource = Number(stats.citationNeeded || 0);
  const attention = !total || unresolved.length || needsSource || Number(stats.uncited || 0) > 0 || Number(stats.completeness || 0) < 100;
  const summary = !total
    ? "该词条尚未添加结构化来源。"
    : `已记录 ${total} 条来源，其中 ${Number(stats.verifiable || 0)} 条带 DOI、arXiv 或可核验链接。`;
  const details = [
    unresolved.length ? `未解析引用：${unresolved.map((item) => `@${item}`).join("、")}` : "",
    needsSource ? `${needsSource} 处标记为需要来源` : "",
    Number(stats.uncited || 0) ? `${stats.uncited} 条来源尚未在正文引用` : "",
    issues.length ? `${issues.length} 条来源字段不完整` : "",
  ].filter(Boolean);
  return `<section class="citation-quality-panel ${attention ? "needs-attention" : ""}"><div><span class="system-kicker">Source Quality</span><h2>${attention ? "来源质量需要补充" : "来源记录完整"}</h2><p>${escapeHtml(summary)}</p>${details.length ? `<small>${escapeHtml(details.join("；"))}</small>` : ""}</div><div class="citation-quality-metrics"><span><strong>${total}</strong>来源</span><span><strong>${Number(stats.completeness || 0)}%</strong>完整</span><span><strong>${Number(stats.qualityScore || 0)}</strong>质量分</span></div><a class="mini-link" href="#/edit/${encodeSlug(page.slug)}">管理引用</a></section>`;
}
function ratingPanelHtml(rating = {}) {
  const count = Number(rating.count || 0);
  const average = Number(rating.average || 0);
  const myRating = Number(rating.myRating || 0);
  const score = count ? `${average.toFixed(1)} / 5` : "暂无评分";
  const stars = [1, 2, 3, 4, 5].map((value) => `<button type="button" class="rating-star ${myRating >= value ? "active" : ""}" data-rate-page="${value}" aria-label="给词条 ${value} 分">&#9733;</button>`).join("");
  const distribution = [5, 4, 3, 2, 1].map((value) => {
    const amount = Number(rating.distribution?.[value] || 0);
    const width = count ? Math.round((amount / count) * 100) : 0;
    return `<div class="rating-row"><span>${value}分</span><i><b style="width:${width}%"></b></i><em>${amount}</em></div>`;
  }).join("");
  return `
    <div class="rating-card">
      <div class="rating-summary"><span>词条评分</span><strong>${score}</strong><small>${count ? `${count} 次评分` : "成为第一个评分者"}</small></div>
      <div class="rating-control" aria-label="词条评分">${stars}</div>
      <div class="rating-distribution">${distribution}</div>
    </div>`;
}

async function loadPageRating(slug) {
  const target = document.querySelector("#pageRatingPanel");
  if (!target) return;
  target.innerHTML = '<p class="muted-line">正在加载评分...</p>';
  const payload = await api(`/api/pages/${encodeSlug(slug)}/rating`).catch(() => ({ rating: { average: 0, count: 0, distribution: {}, myRating: 0 } }));
  target.innerHTML = ratingPanelHtml(payload.rating || {});
  updateArticleRatingShortcut(payload.rating || {});
  target.querySelectorAll("[data-rate-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rating = Number(button.dataset.ratePage);
      target.classList.add("is-loading");
      try {
        const updated = await api(`/api/pages/${encodeSlug(slug)}/rating`, { method: "POST", body: JSON.stringify({ rating }) });
        target.innerHTML = ratingPanelHtml(updated.rating || {});
        updateArticleRatingShortcut(updated.rating || {});
        await loadPageRating(slug);
      } catch (error) {
        target.innerHTML = `<p class="muted-line">${escapeHtml(error.message)}</p>`;
      } finally {
        target.classList.remove("is-loading");
      }
    });
  });
}

async function loadPageTranslations(slug, activeLang = "zh-CN") {
  const target = document.querySelector("#pageTranslationPanel");
  if (!target) return;
  const payload = await api(`/api/pages/${encodeSlug(slug)}/translations`).catch(() => ({ translations: [] }));
  const translations = payload.translations || [];
  const active = normalizeLanguageCode(activeLang, "zh-CN");
  const activeInfo = translationInfo(translations, active);
  const editHref = `#/translate/${encodeSlug(slug)}`;
  target.innerHTML = translations.length ? `
    <div class="translation-strip">
      <div class="translation-strip-head">
        <strong>词条语言</strong>
        <span>${escapeHtml(languageLabel(active))} · ${activeInfo.status === "missing" ? "未翻译" : `${Number(activeInfo.progress || 0)}%`}</span>
      </div>
      ${translationBadges(translations, active, slug, "read")}
      ${languageJumpForm(slug, "read")}
      <a class="mini-link" href="${editHref}">选择语言并参与翻译</a>
    </div>` : "";
  bindLanguageJumpForms(target);
}

async function loadPageCommunity(slug, taskPage = 1) {
  const target = document.querySelector("#pageCommunityPanel");
  if (!target) return;
  const payload = await api(`/api/pages/${encodeSlug(slug)}/community?page=${taskPage}&limit=6`).catch(() => ({ tasks: [], organizations: [], pagination: {} }));
  const tasks = payload.tasks || [];
  const pagination = payload.pagination || { page: taskPage, total: 0, totalPages: 1, hasPrev: false, hasNext: false };
  if (!tasks.length) {
    target.innerHTML = '<section class="page-community-brief"><div class="page-community-brief-head"><div><span class="system-kicker">Collaboration Commons</span><h2>组织协作</h2><p>尚未有组织认领这条词条。可以在协作社区建立撰写、翻译或审阅任务。</p></div><a class="mini-link page-community-brief-link" href="#/community">进入协作社区</a></div></section>';
    return;
  }
  target.innerHTML = `<section class="page-community-brief"><header><div><span class="system-kicker">Collaboration Commons</span><h2>组织协作</h2><p>查看关联任务，或进入组织继续协作。</p></div><a class="mini-link" href="#/community">组织广场</a></header><div class="page-community-task-list">${tasks.map((task) => `<a href="#/organization/${encodeURIComponent(task.organizationSlug)}"><span>${escapeHtml(task.organizationName)}</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(ORGANIZATION_TASK_LABELS[task.taskType] || "协作")} · ${escapeHtml(task.status === "open" ? "待认领" : task.status === "claimed" ? "进行中" : task.status === "ready" ? "待审阅" : "已完成")}</small></a>`).join("")}</div>${paginationHtml(pagination, "关联协作任务")}${(payload.organizations || []).length ? `<a class="community-review-link" href="#/review/${encodeSlug(slug)}">进入社区审阅</a>` : ""}</section>`;
  bindPagination(target, (nextPage) => loadPageCommunity(slug, nextPage));
}

async function loadPageEdits(slug, targetId = "pageEditTimeline", options = {}) {
  const target = document.querySelector(`#${targetId}`);
  if (!target) return;
  const settings = typeof options === "number" ? { limit: options } : options;
  const page = Math.max(1, Number(settings.page) || 1);
  const limit = Math.max(1, Number(settings.limit) || 8);
  const payload = await api(`/api/pages/${encodeSlug(slug)}/edits?page=${page}&limit=${limit}`).catch(() => ({ items: [], pagination: { page, pageSize: limit, total: 0, totalPages: 1 } }));
  const { items, pagination } = normalizedPaged(payload, page, limit);
  target.innerHTML = items.length
    ? `${items.map(editEventHtml).join("")}${settings.paginate === false ? "" : paginationHtml(pagination, "编辑记录")}`
    : '<p class="muted-line">暂无编辑记录。</p>';
  if (settings.paginate !== false) bindPagination(target, (nextPage) => loadPageEdits(slug, targetId, { ...settings, page: nextPage }));
}
function pageCard(page, label = "词条") {
  return `<a class="wiki-mini-card" href="#/page/${encodeSlug(page.slug)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.summary || page.slug)}</small></a>`;
}

function chartSparklineSvg(values = [], title = "趋势") {
  const series = (Array.isArray(values) && values.length ? values : [0]).map((value) => Math.max(0, Number(value) || 0));
  const width = 360;
  const height = 92;
  const inset = 6;
  const max = Math.max(1, ...series);
  const step = series.length > 1 ? (width - inset * 2) / (series.length - 1) : 0;
  const points = series.map((value, index) => {
    const x = inset + step * index;
    const y = height - inset - (value / max) * (height - inset * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${inset},${height - inset} ${points} ${width - inset},${height - inset}`;
  return `<svg class="wikist-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title><line x1="${inset}" y1="${height - inset}" x2="${width - inset}" y2="${height - inset}" class="chart-axis"/><polygon points="${area}" class="chart-area"/><polyline points="${points}" class="chart-line"/><circle cx="${(inset + step * (series.length - 1)).toFixed(1)}" cy="${(height - inset - (series[series.length - 1] / max) * (height - inset * 2)).toFixed(1)}" r="4" class="chart-point"/></svg>`;
}

function recentTrendSeries(items = [], days = 7) {
  const timestamps = items.map((item) => new Date(item.updatedAt || item.createdAt || 0).getTime()).filter(Number.isFinite);
  const anchor = timestamps.length ? Math.max(...timestamps) : Date.now();
  const anchorDate = new Date(anchor);
  anchorDate.setHours(0, 0, 0, 0);
  const values = Array.from({ length: days }, () => 0);
  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const offset = Math.round((anchorDate.getTime() - date.getTime()) / 86400000);
    if (offset >= 0 && offset < days) values[days - 1 - offset] += 1;
  }
  return values;
}

function normalizedQualityCounts(source = {}) {
  if (Array.isArray(source)) {
    return source.reduce((counts, page) => {
      const key = ["A", "B", "C"].includes(String(page.quality || "").toUpperCase()) ? String(page.quality).toUpperCase() : "draft";
      counts[key] += 1;
      return counts;
    }, { A: 0, B: 0, C: 0, draft: 0 });
  }
  return { A: Number(source.A || 0), B: Number(source.B || 0), C: Number(source.C || 0), draft: Number(source.draft || 0) };
}

function qualityDonutHtml(source, label = "词条") {
  const counts = normalizedQualityCounts(source);
  const total = Math.max(1, counts.A + counts.B + counts.C + counts.draft);
  const a = counts.A / total * 100;
  const b = a + counts.B / total * 100;
  const c = b + counts.C / total * 100;
  return `<div class="quality-chart"><div class="quality-donut" style="--quality-a:${a.toFixed(2)}%;--quality-b:${b.toFixed(2)}%;--quality-c:${c.toFixed(2)}%"><span><strong>${counts.A + counts.B + counts.C + counts.draft}</strong><small>${escapeHtml(label)}</small></span></div><div class="quality-chart-legend"><span class="quality-a"><i></i>A 级<strong>${counts.A}</strong></span><span class="quality-b"><i></i>B 级<strong>${counts.B}</strong></span><span class="quality-c"><i></i>C 级<strong>${counts.C}</strong></span><span class="quality-draft"><i></i>草稿<strong>${counts.draft}</strong></span></div></div>`;
}

function homepageInsightHtml(pages = [], recent = []) {
  const categoryCounts = new Map();
  for (const page of pages) for (const category of page.categories || []) categoryCounts.set(category, Number(categoryCounts.get(category) || 0) + 1);
  const topCategories = [...categoryCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN")).slice(0, 5);
  const categoryMax = Math.max(1, ...topCategories.map((item) => item[1]));
  const trend = recentTrendSeries(recent, 7);
  return `<section class="home-insight-grid" aria-label="知识库数据图表"><article class="home-insight-card home-quality-insight"><header><div><span class="system-kicker">Quality Map</span><h2>内容成熟度</h2></div><small>实时摘要</small></header>${qualityDonutHtml(pages, "词条")}</article><article class="home-insight-card home-trend-insight"><header><div><span class="system-kicker">Update Pulse</span><h2>更新趋势</h2></div><strong>${trend.reduce((sum, value) => sum + value, 0)}</strong></header>${chartSparklineSvg(trend, "最近七日词条更新趋势")}<footer><span>较早</span><span>最近</span></footer></article><article class="home-insight-card home-category-insight"><header><div><span class="system-kicker">Field Coverage</span><h2>领域覆盖</h2></div><small>Top ${topCategories.length}</small></header><div class="category-chart">${topCategories.length ? topCategories.map(([name, value]) => `<a href="#/category/${encodeURIComponent(name)}"><span><strong>${escapeHtml(name)}</strong><small>${value}</small></span><i><b style="width:${Math.max(8, value / categoryMax * 100).toFixed(1)}%"></b></i></a>`).join("") : '<p class="muted-line">等待词条分类。</p>'}</div></article></section>`;
}

function cosmicHeroTitleHtml(title) {
  const raw = String(title || "首页").trim();
  const brand = currentSiteName();
  const match = brand ? raw.match(new RegExp(`^(.*?)(${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(.*)$`, "i")) : null;
  if (!match) return `<h1>${escapeHtml(raw)}</h1>`;
  const label = match[1].trim() || "欢迎来到";
  const suffix = match[3].trim();
  return `<h1 class="cosmic-title-split"><span class="cosmic-title-label">${escapeHtml(label)}</span><span class="cosmic-title-brand" data-cosmic-title>${escapeHtml(match[2])}</span>${suffix ? `<span class="cosmic-title-label">${escapeHtml(suffix)}</span>` : ""}</h1>`;
}

function homeDiscoveryItemsHtml(pages = state.pages, seed = state.homeDiscoverySeed) {
  const pool = (Array.isArray(pages) ? pages : [])
    .filter((item) => item?.slug && ![state.site?.defaultPage || "home", "news"].includes(item.slug))
    .sort((left, right) => railQualityRank(right.quality) - railQualityRank(left.quality)
      || Number(right.status === "stable") - Number(left.status === "stable")
      || new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  const items = selectRailItems(pool, 5, seed, "recommendation");
  return items.length ? items.map((item) => pageCard(item, item.status === "stable" ? "稳定" : `质量 ${item.quality || "C"}`)).join("") : "<p>暂无可推荐词条。</p>";
}

function renderKnowledgePortal() {
  state.currentSlug = "";
  setChromeTitle("知识检索");
  renderToc([]);
  const siteName = currentSiteName();
  const pageCount = Number(state.pageTotal || state.pages.length || 0);
  const qualityCount = state.pages.filter((item) => item.quality === "A" || item.status === "stable").length;
  el.main.innerHTML = `<section class="knowledge-portal" aria-labelledby="knowledgePortalTitle">
    <div class="knowledge-portal-core">
      <img src="${escapeHtml(safeSiteIconUrl(siteAssetValue("siteIcon")))}" alt="" width="112" height="112" />
      <span class="system-kicker">Knowledge Commons</span>
      <h1 id="knowledgePortalTitle">${escapeHtml(siteName)}</h1>
      <p>${escapeHtml(state.site?.tagline || "开放、严谨、可验证的数学知识共同体")}</p>
      <form class="knowledge-portal-search" id="knowledgePortalSearch" role="search">
        <input name="q" type="search" autocomplete="off" autofocus placeholder="搜索概念、定理、证明、符号或英文术语" aria-label="搜索 ${escapeHtml(siteName)}" required />
        <button type="submit" title="搜索" aria-label="搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.7-4.7m2-5.3a7.3 7.3 0 1 1-14.6 0 7.3 7.3 0 0 1 14.6 0Z"/></svg></button>
      </form>
      <nav class="knowledge-portal-links" aria-label="知识入口"><a class="primary" href="#/page/${encodeSlug(state.site?.defaultPage || "home")}">进入知识首页</a><a href="#/category">分类目录</a><a href="#/knowledge">知识网络</a><a href="#/community">协作社区</a></nav>
      <div class="knowledge-portal-stats"><span><strong>${pageCount}</strong> 个公开词条</span><span><strong>${qualityCount}</strong> 个优质或稳定版本</span><span><strong>${Number(state.recent.length || 0)}</strong> 条近期更新</span></div>
    </div>
  </section>`;
  bindPageSuggestions(document.querySelector("#knowledgePortalSearch input[name='q']"), { limit: 10 });
  document.querySelector("#knowledgePortalSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") || "").trim();
    if (query) location.hash = `#/search/${encodeURIComponent(query)}`;
  });
}

function renderHomePortal(page) {
  const homeSlug = page?.slug || state.site?.defaultPage || "home";
  const homeBodyHtml = page?.html || `<div class="empty-state home-empty-body"><h2>无相关内容</h2><p>请创建词条。</p><div class="editor-actions"><a class="command-button" href="#/edit/${encodeSlug(homeSlug)}">创建首页词条</a></div></div>`;
  const homeConfig = {
    showFeatured: true,
    showNews: true,
    showPath: true,
    showProgress: true,
    showStable: true,
    showOriginal: true,
    showCategories: true,
    showActions: true,
    ...(state.site?.home || {}),
  };
  const homeText = {
    heroKicker: `${currentSiteName()} Knowledge Core`,
    heroTitle: "欢迎来到",
    heroSummary: "开放、严谨、可验证的中文数学知识共同体。查找定义、证明与引用，也欢迎参与完善。",
    heroSearch: "搜索数学概念",
    heroContribute: "开始贡献",
    heroNews: "查看资讯",
    newsTitle: "资讯雷达",
    newsEmpty: "资讯页尚未创建。",
    newsItems: [],
    pathTitle: "入门路径",
    progressTitle: "全球数学进展",
    actionsTitle: "协作控制台",
    actionsSummary: "查找词条、参与协作或开始新的贡献。",
    progressItems: [
      { tag: "国际会议", title: "ICM 2026", body: "国际数学家大会将继续作为全球数学共同体的核心交流节点。", href: "https://www.mathunion.org/icm/icm-2026" },
      { tag: "形式化数学", title: "Lean / mathlib", body: "定理证明、形式化库与可验证证明正在进入更多数学工作流。", href: "https://github.com/leanprover-community/mathlib4" },
      { tag: "开放预印本", title: "arXiv Mathematics", body: "数学预印本持续推动公开传播、同行讨论与跨领域引用。", href: "https://arxiv.org/archive/math" },
    ],
    ...(state.site?.homeContent || {}),
  };
  const activeLanguage = normalizeLanguageCode(state.uiLanguage || state.site?.language, "zh-CN");
  const defaultHeroPrefix = activeLanguage === "en" ? "Welcome to" : (activeLanguage === "zh-TW" ? "歡迎來到" : "欢迎来到");
  const savedHeroTitle = String(homeText.heroTitle || "").trim();
  const legacyHeroTitle = /^(首页|home|欢迎来到\s*wikist|歡迎來到\s*wikist|welcome to\s*wikist)$/i.test(savedHeroTitle);
  const heroPrefix = (legacyHeroTitle || !savedHeroTitle ? defaultHeroPrefix : savedHeroTitle)
    .replace(new RegExp(currentSiteName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
    .trim() || defaultHeroPrefix;
  const homeHeroTitle = `${heroPrefix} ${currentSiteName()}`.trim();
  homeText.heroKicker = String(homeText.heroKicker || `${currentSiteName()} Knowledge Core`).replace(/Wikist/g, currentSiteName());
  homeText.actionsSummary = String(homeText.actionsSummary || "查找词条、参与协作或开始新的贡献。").replace(/Wikist/g, currentSiteName());
  const homeLabels = (normalizeLanguageCode(state.uiLanguage || state.site?.language, "zh-CN") === "en")
    ? { pages: "pages", fields: "active fields", signals: "recent signals" }
    : normalizeLanguageCode(state.uiLanguage || state.site?.language, "zh-CN") === "zh-TW"
      ? { pages: "詞條", fields: "活躍領域", signals: "最近信號" }
      : { pages: "词条", fields: "活跃领域", signals: "最近信号" };
  const featured = state.pages
    .filter((item) => !["home", "news"].includes(item.slug))
    .sort((left, right) => railQualityRank(right.quality) - railQualityRank(left.quality)
      || Number(right.status === "stable") - Number(left.status === "stable")
      || new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0))
    .slice(0, 5);
  const stable = state.pages.filter((item) => item.quality === "A" || item.status === "stable").slice(0, 6);
  const categories = [...new Set(state.pages.flatMap((item) => item.categories || []))].slice(0, 14);
  const news = state.pages.find((item) => item.slug === "news");
  const newsItems = Array.isArray(homeText.newsItems) ? homeText.newsItems : [];
  const progress = Array.isArray(homeText.progressItems) ? homeText.progressItems : [];
  const featuredModule = homeConfig.showFeatured ? `<article class="wiki-box sci-box sci-box-feature"><h2>特色词条</h2>${featured.length ? featured.map((item) => pageCard(item, item.quality || "词条")).join("") : "<p>暂无特色词条。</p>"}</article>` : "";
  const newsModule = homeConfig.showNews ? `<article class="wiki-box sci-box sci-box-news"><h2>${escapeHtml(homeText.newsTitle)}</h2>${newsItems.length ? `<div class="wiki-news-list">${newsItems.map((item) => `<a href="${escapeHtml(item.href || "#/page/news")}"><span>${escapeHtml(item.date || item.tag || "资讯")}</span>${escapeHtml(item.title)}${item.body ? `<small>${escapeHtml(item.body)}</small>` : ""}</a>`).join("")}</div>` : (news ? `<a class="wiki-news-link" href="#/page/news"><strong>${escapeHtml(news.title)}</strong><span>${escapeHtml(news.summary)}</span></a>` : `<p>${escapeHtml(homeText.newsEmpty)}</p>`)}<div class="wiki-news-list">${state.recent.slice(0, 4).map((item) => `<a href="#/page/${encodeSlug(item.slug)}"><span>${fmtDate(item.updatedAt)}</span>${escapeHtml(item.title)}</a>`).join("")}</div></article>` : "";
  const pathModule = homeConfig.showPath ? `<article class="wiki-box sci-box sci-box-path"><h2>${escapeHtml(homeText.pathTitle)}</h2><div class="wiki-link-grid"><a href="#/page/markup-guide">标记规范</a><a href="#/page/tutorial">教程</a><a href="#/page/protocol">协议</a><a href="#/page/contribution-guide">贡献规范</a></div></article>` : "";
  const progressModule = homeConfig.showProgress ? `<article class="wiki-box sci-box sci-box-progress"><h2>${escapeHtml(homeText.progressTitle)}</h2>${progress.map((item) => `<a class="progress-item" href="${escapeHtml(item.href)}" target="_blank" rel="noreferrer"><span>${escapeHtml(item.tag)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small></a>`).join("")}</article>` : "";
  const stableModule = homeConfig.showStable ? `<article class="wiki-box sci-box sci-box-stable"><h2>稳定内容</h2>${stable.length ? stable.map((item) => pageCard(item, item.quality || "稳定")).join("") : "<p>暂无稳定词条。</p>"}</article>` : "";
  const categoriesModule = homeConfig.showCategories ? `<article class="wiki-box sci-box sci-box-categories"><h2>分类索引</h2><div class="wiki-category-cloud">${categories.length ? categories.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : "<span>等待分类</span>"}</div></article>` : "";
  const discoveryModule = `<article class="wiki-box sci-box sci-box-discovery"><h2 class="home-module-heading"><span>知识发现</span><button class="rail-refresh-button" id="homeDiscoveryRefresh" type="button" title="换一批优质词条" aria-label="换一批知识发现"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg></button></h2><div id="homeDiscoveryList">${homeDiscoveryItemsHtml()}</div></article>`;
  const actionsModule = homeConfig.showActions ? `<article class="wiki-box sci-box sci-box-actions"><h2>${escapeHtml(homeText.actionsTitle)}</h2><p>${escapeHtml(page.summary || homeText.actionsSummary)}</p><div class="wiki-link-grid"><a href="#/community">协作社区</a><a href="#/organizations">我的协作</a><a href="#/new">新建词条</a><a href="#/search/群">搜索词条</a>${state.user ? '<a href="#/account">账户中心</a>' : '<a href="#/login">登录通行证</a>'}</div></article>` : "";
  const originalModule = homeConfig.showOriginal ? `<article class="wiki-box sci-box sci-box-origin"><h2>首页正文</h2><article class="article-body home-original-body" ${selectionContentAttributes({ type: "wiki_entry", id: homeSlug, label: page?.title || "首页", url: `#/page/${encodeSlug(homeSlug)}`, pageSlug: homeSlug })}>${homeBodyHtml}</article></article>` : "";
  const primaryModules = [featuredModule, progressModule, stableModule].filter(Boolean).join("");
  const secondaryModules = [newsModule, pathModule, actionsModule, categoriesModule, discoveryModule].filter(Boolean).join("");
  const columns = [primaryModules, secondaryModules].filter(Boolean).map((content) => `<div class="home-dashboard-column">${content}</div>`).join("");
  const modules = `${originalModule ? `<div class="home-dashboard-wide home-dashboard-introduction">${originalModule}</div>` : ""}${columns ? `<div class="home-dashboard-columns ${primaryModules && secondaryModules ? "has-two-columns" : ""}">${columns}</div>` : ""}`;
  setChromeTitle("首页");
  renderToc([]);
  el.main.innerHTML = `
    <section class="wiki-home sci-home">
      <header class="wiki-welcome sci-hero cosmic-hero">
        <canvas class="cosmic-canvas" data-cosmic-scene="home" aria-hidden="true"></canvas>
        <div class="cosmic-vignette" aria-hidden="true"></div>
        <div class="sci-hero-copy">
          <span class="system-kicker">${escapeHtml(homeText.heroKicker)}</span>
          ${cosmicHeroTitleHtml(homeHeroTitle)}
          <p>${escapeHtml(homeText.heroSummary)}</p>
          <div class="sci-hero-actions"><a href="#/search/群">${escapeHtml(homeText.heroSearch)}</a><a href="#/community">${escapeHtml(homeText.heroContribute)}</a><a href="#/page/news">${escapeHtml(homeText.heroNews)}</a></div>
        </div>
        <aside class="cosmic-orbital-stage" aria-label="Wikist 宇宙数据概览">
          <div class="cosmic-ring ring-1" aria-hidden="true"></div>
          <div class="cosmic-ring ring-2" aria-hidden="true"></div>
          <div class="cosmic-ring ring-3" aria-hidden="true"></div>
          <div class="cosmic-core"><strong>${state.pageTotal || state.pages.length}</strong><span>${escapeHtml(homeLabels.pages)}</span></div>
          <div class="cosmic-readout readout-a"><span>${categories.length}</span><small>${escapeHtml(homeLabels.fields)}</small></div>
          <div class="cosmic-readout readout-b"><span>${state.recent.length || 0}</span><small>${escapeHtml(homeLabels.signals)}</small></div>
        </aside>
      </header>

      <section class="portal-stat-grid" aria-label="站点概览">
        <article class="portal-stat"><span class="portal-stat-icon">${navigationIconSvg("workspace")}</span><div><small>知识规模</small><strong>${Number(state.pageTotal || state.pages.length)}</strong><span>公开词条</span></div></article>
        <article class="portal-stat"><span class="portal-stat-icon">${navigationIconSvg("category")}</span><div><small>领域索引</small><strong>${categories.length}</strong><span>活跃分类</span></div></article>
        <article class="portal-stat"><span class="portal-stat-icon">${navigationIconSvg("pulse")}</span><div><small>近期活动</small><strong>${state.recent.length}</strong><span>更新信号</span></div></article>
        <article class="portal-stat"><span class="portal-stat-icon">${navigationIconSvg("community")}</span><div><small>当前身份</small><strong class="portal-stat-identity">${state.user ? escapeHtml(state.user.groupLabel || GROUP_LABELS[state.user.role] || state.user.role) : "访客"}</strong><span>${state.user ? "贡献已同步" : "可自由浏览"}</span></div></article>
      </section>

      ${homepageInsightHtml(state.pages, state.recent)}
      <section class="home-dashboard">${modules || '<article class="wiki-box sci-box"><h2>首页模块</h2><p>后台已关闭所有首页模块。</p></article>'}</section>
    </section>`;
  void renderRailRecommendations(page.slug);
}
async function renderNews() {
  const page = await api("/api/pages/news").catch(() => null);
  setChromeTitle("资讯");
  renderToc(page?.toc || []);
  el.editLink.href = "#/edit/news";
  el.main.innerHTML = `${page ? pageToolNav("news", "page") + articleHeader(page) + `<article class="article-body" ${selectionContentAttributes({ type: "wiki_entry", id: page.slug || "news", label: page.title || "资讯", url: "#/page/news", pageSlug: page.slug || "news" })}>${page.html}</article>` : '<section class="empty-state"><h1>资讯页尚未创建</h1><a class="command-button" href="#/edit/news">创建资讯页</a></section>'}<section class="wiki-box news-feed-box"><h2>最近更新</h2>${state.recent.map((item) => `<a class="recent-item" href="#/page/${encodeSlug(item.slug)}"><strong>${escapeHtml(item.title)}</strong><small>${fmtDate(item.updatedAt)} · ${escapeHtml(item.quality || "C")}</small></a>`).join("")}</section>`;
  if (page) await loadPageFavorite(page.slug);
  typesetMath();
}
function canReviewContent() {
  return Boolean(state.user?.capabilities?.reviewContent || userCan("senior_editor"));
}

function pageReviewStatusHtml(page) {
  const review = page?.review;
  if (!review) return "";
  const stableText = review.hasStable
    ? `${review.isCurrentStable ? "当前版本已审阅稳定" : "当前版本有待审改动"}`
    : "尚未建立稳定版本";
  const detail = review.hasStable
    ? `${review.reviewerName || "审核者"} · ${fmtDate(review.reviewedAt)}`
    : "提交后由资深编辑或管理员审核";
  const note = review.latestNote?.decision === "changes_requested" ? `最近意见：${shortText(review.latestNote.comment || "需要修改", 72)}` : "";
  const actionLabel = canReviewContent() && review.pending ? "立即审阅" : "查看审阅";
  return `<section class="page-review-status ${review.pending ? "pending" : "stable"}"><div><span class="system-kicker">Version Review</span><h2>${stableText}</h2><p>${escapeHtml(detail)}</p>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div><div class="page-review-status-actions"><span class="review-version-chip current">当前</span>${review.hasStable ? '<span class="review-version-chip stable">已审阅</span>' : ""}<a class="review-status-action" href="#/review/${encodeSlug(page.slug)}">${actionLabel}</a></div></section>`;
}

function reviewNoteHtml(note) {
  const decision = note.decision === "approve" ? "已通过" : "要求修改";
  const tone = note.decision === "approve" ? "stable" : "pending";
  const ownNote = Number(note.reviewerUserId || 0) === Number(state.user?.id || 0) && canReviewContent();
  const withdraw = ownNote ? `<button class="review-note-withdraw" type="button" data-withdraw-review-note="${Number(note.id)}">撤回意见</button>` : "";
  return `<article class="review-note"><div class="review-note-head"><div><span class="review-version-chip ${tone}">${decision}</span><strong>${escapeHtml(note.reviewerName || "Wikist Reviewer")}</strong><small>${fmtDate(note.createdAt)}</small></div>${withdraw}</div><p>${escapeHtml(note.comment || "未填写文字意见。")}</p></article>`;
}

function reviewDiffHtml(changes = []) {
  const parts = [];
  let unchanged = [];
  const flushUnchanged = () => {
    if (!unchanged.length) return;
    const lines = unchanged.map((change) => `<div class="review-diff-line equal"><code> ${escapeHtml(change.text || " ")}</code></div>`).join("");
    parts.push(unchanged.length > 4 ? `<details class="review-diff-unchanged"><summary>展开 ${unchanged.length} 行未变内容</summary>${lines}</details>` : lines);
    unchanged = [];
  };
  for (const change of changes) {
    if (change.type === "equal") {
      unchanged.push(change);
      continue;
    }
    flushUnchanged();
    const marker = change.type === "add" ? "+" : "-";
    parts.push(`<div class="review-diff-line ${change.type}"><code>${marker} ${escapeHtml(change.text || " ")}</code></div>`);
  }
  flushUnchanged();
  return parts.join("") || '<p class="muted-line">当前版本与稳定版本没有内容差异。</p>';
}

const ORGANIZATION_ROLE_LABELS = {
  member: "成员",
  writer: "写作者",
  translator: "译者",
  reviewer: "审阅者",
  coordinator: "协调者",
  owner: "所有者",
};

const ORGANIZATION_TASK_LABELS = { write: "撰写", translate: "翻译", review: "审阅" };

function organizationRoleLabel(role) {
  return ORGANIZATION_ROLE_LABELS[role] || "成员";
}

function organizationIdentityCardHtml(member) {
  const status = member.status === "pending" ? "申请待批准" : organizationRoleLabel(member.role);
  const taskText = member.assignedTaskCount ? `我认领 ${member.assignedTaskCount} 项` : `${member.openTaskCount || 0} 项开放任务`;
  return `<a class="organization-identity-card" href="#/organization/${encodeURIComponent(member.organizationSlug)}"><span class="system-kicker">${escapeHtml(member.organizationSlug)}</span><strong>${escapeHtml(member.organizationName)}</strong><small>${escapeHtml(status)} · ${escapeHtml(taskText)}</small>${member.organizationFocus?.length ? `<em>${member.organizationFocus.slice(0, 2).map((item) => escapeHtml(item)).join(" · ")}</em>` : ""}</a>`;
}

function organizationIdentityPanelHtml(members = [], total = 0, options = {}) {
  const publicUsername = options.username ? `?user=${encodeURIComponent(options.username)}` : "";
  const heading = options.public ? "组织身份" : "我的组织身份";
  const summary = options.public ? "查看该贡献者参与的协作组织。" : "查看组织身份、任务与讨论贡献。";
  return `<section class="organization-identity-panel"><header><div><span class="system-kicker">Academic Identity</span><h2>${heading}</h2><p>${summary}</p></div><a class="mini-link" href="#/organizations${publicUsername}">查看全部 ${Number(total || 0)}</a></header><div class="organization-identity-list">${members.length ? members.map(organizationIdentityCardHtml).join("") : `<p class="muted-line">${options.public ? "尚未公开加入协作组织。" : "还没有组织身份。进入协作社区加入或创建一个组织。"}</p>`}</div>${!options.public && !members.length ? '<a class="command-button secondary" href="#/community">进入协作社区</a>' : ""}</section>`;
}

function organizationTaskHtml(task, options = {}) {
  const pageHref = `#/page/${encodeSlug(task.pageSlug)}`;
  const taskLabel = ORGANIZATION_TASK_LABELS[task.taskType] || "协作";
  const meta = [taskLabel, task.language ? languageLabel(task.language) : "源文", task.priority === "urgent" ? "紧急" : task.priority === "high" ? "高优先" : "常规"].join(" · ");
  const actions = [];
  if (task.canClaim) actions.push(`<button class="mini-button" type="button" data-community-claim="${task.id}">${task.assigneeUserId ? "继续认领" : "认领任务"}</button>`);
  if (task.assigneeUserId && state.user && Number(task.assigneeUserId) === Number(state.user.id) && task.status !== "closed") actions.push(`<button class="mini-button" type="button" data-community-task-status="ready" data-community-task-id="${task.id}">提交待审</button>`);
  if (options.manage && task.status !== "closed") actions.push(`<button class="mini-button secondary" type="button" data-community-task-status="closed" data-community-task-id="${task.id}">关闭</button>`);
  return `<article class="community-task-card ${task.status === "closed" ? "closed" : ""}"><div class="community-task-top"><span class="community-task-type">${escapeHtml(taskLabel)}</span><span class="community-task-status">${escapeHtml(task.status === "open" ? "待认领" : task.status === "claimed" ? "进行中" : task.status === "ready" ? "待审阅" : "已完成")}</span></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.summary || "等待组织成员接手。")}</p><footer><a href="${pageHref}">${escapeHtml(task.pageSlug)}</a><span>${escapeHtml(meta)}</span>${task.assigneeUsername ? `<a href="#/user/${encodeURIComponent(task.assigneeUsername)}">@${escapeHtml(task.assigneeUsername)}</a>` : ""}${actions.join("")}</footer></article>`;
}

function communityReviewPanel(snapshot, subjectType, slug, language = "") {
  const organizations = snapshot?.organizations || [];
  if (!organizations.length) return `<section class="community-review-panel empty"><div><span class="system-kicker">Community Review</span><h2>社区审阅</h2><p>尚未有协作组织为当前${subjectType === "translation" ? "译文" : "词条"}建立审阅任务。</p></div><a class="mini-link" href="#/community">进入协作社区</a></section>`;
  return `<section class="community-review-panel"><header><div><span class="system-kicker">Community Review</span><h2>组织社区审阅</h2><p>组织审阅通过后，将发布稳定版本或译文结论。</p></div><a class="mini-link" href="#/community">组织广场</a></header><div class="community-review-grid">${organizations.map((group) => {
    const stateLabel = group.finalized ? (group.finalized.decision === "approve" ? "已形成通过共识" : "已形成修改共识") : `${group.approve} 通过 / ${group.changesRequested} 修改 · 阈值 ${group.threshold}`;
    const form = group.canReview && !group.finalized ? `<form class="community-review-form" data-community-review data-community-subject="${subjectType}" data-community-slug="${escapeHtml(slug)}" data-community-language="${escapeHtml(language)}" data-community-organization="${group.organizationId}"><textarea name="comment" rows="3" placeholder="写下可核验的审阅理由或需要修改的事项"></textarea><div><button class="mini-button" type="submit" data-community-decision="approve">支持通过</button><button class="mini-button secondary" type="submit" data-community-decision="changes_requested">要求修改</button></div><p class="status-line"></p></form>` : "";
    return `<article class="community-review-card ${group.finalized ? "finalized" : ""}"><a href="#/organization/${encodeURIComponent(group.organizationSlug)}"><strong>${escapeHtml(group.organizationName)}</strong></a><span>${escapeHtml(stateLabel)}</span><small>${group.votes?.length ? group.votes.map((vote) => escapeHtml(vote.reviewerName || vote.reviewerUsername)).join("、") : "等待审阅者参与"}</small>${form}</article>`;
  }).join("")}</div></section>`;
}

function bindCommunityReviewForms(root, refresh) {
  root.querySelectorAll("form[data-community-review]").forEach((form) => {
    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-community-decision]");
      if (button) form.dataset.decision = button.dataset.communityDecision;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const decision = form.dataset.decision || "approve";
      const subject = form.dataset.communitySubject;
      const slug = form.dataset.communitySlug;
      const language = form.dataset.communityLanguage || "";
      const endpoint = subject === "translation"
        ? `/api/pages/${encodeSlug(slug)}/translation/${encodeURIComponent(language)}/community-review`
        : `/api/pages/${encodeSlug(slug)}/community-review`;
      const status = form.querySelector(".status-line");
      status.textContent = "正在记录社区审阅...";
      try {
        const result = await api(endpoint, { method: "POST", body: JSON.stringify({ organizationId: Number(form.dataset.communityOrganization), decision, comment: new FormData(form).get("comment") || "" }) });
        uiToast(result.finalized?.finalized ? "组织共识已形成并已同步发布状态" : "社区审阅已记录");
        await refresh();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  });
}

async function renderPageReview(slug) {
  const parsed = splitValueQuery(slug);
  const normalizedSlug = parsed.pathValue || state.site.defaultPage || "home";
  const notesPage = Math.max(1, Number(parsed.params.get("page")) || 1);
  const [current, reviewPayload, community] = await Promise.all([
    api(`/api/pages/${encodeSlug(normalizedSlug)}`),
    api(`/api/pages/${encodeSlug(normalizedSlug)}/review?page=${notesPage}&limit=10`),
    api(`/api/pages/${encodeSlug(normalizedSlug)}/community`).catch(() => ({ organizations: [] })),
  ]);
  const review = reviewPayload.review || current.review || {};
  const [stable, diff] = review.hasStable
    ? await Promise.all([
      api(`/api/pages/${encodeSlug(normalizedSlug)}/stable`).catch(() => null),
      api(`/api/pages/${encodeSlug(normalizedSlug)}/diff`).catch(() => null),
    ])
    : [null, null];
  state.currentSlug = current.slug;
  setChromeTitle(`${current.title} · 版本审阅`);
  renderToc([]);
  el.editLink.href = `#/edit/${encodeSlug(current.slug)}`;
  const notes = (reviewPayload.items || []).map(reviewNoteHtml).join("") || '<p class="muted-line">尚无审核意见。</p>';
  const notePagination = paginationHtml(reviewPayload.pagination || {}, "审核意见");
  const reviewerControls = canReviewContent()
    ? `<form class="review-decision-form" id="pageReviewForm"><div class="review-decision-head"><span class="system-kicker">Decision Console</span><h2>审阅当前版本</h2><p>通过后设为稳定版；要求修改会把意见发送给编辑者。</p></div><label class="review-decision-field"><span>审核意见 <small>写明核查范围、来源问题或待补内容</small></span><textarea name="comment" rows="4" placeholder="说明通过理由，或列出需要修改的内容。"></textarea></label><div class="review-decision-actions"><button class="review-decision-button approve" type="submit" data-decision="approve"><span>通过并设为稳定版</span><small>发布当前版本</small></button><button class="review-decision-button changes" type="submit" data-decision="changes_requested"><span>要求修改</span><small>提交审核意见</small></button></div><p class="status-line" id="pageReviewStatus"></p></form>`
    : "";
  const stableCard = stable
    ? `<article class="review-version-card stable"><span>已审阅稳定版本</span><strong>${fmtDate(review.reviewedAt)}</strong><small>${escapeHtml(review.reviewerName || "Wikist Reviewer")}</small></article>`
    : '<article class="review-version-card empty"><span>已审阅稳定版本</span><strong>尚未建立</strong><small>通过审阅后将在此显示。</small></article>';
  const diffPanel = diff
    ? `<section class="review-panel"><div class="review-panel-head"><div><span class="system-kicker">Current vs Stable</span><h2>差异比较</h2></div><span class="review-diff-summary">+${diff.summary?.added || 0} / -${diff.summary?.removed || 0}</span></div><div class="review-diff">${reviewDiffHtml(diff.changes || [])}</div></section>`
    : '<section class="review-panel"><div class="review-panel-head"><div><span class="system-kicker">Current vs Stable</span><h2>差异比较</h2></div></div><p class="muted-line">通过审阅后，可在这里比较当前版本与稳定版本。</p></section>';
  el.main.innerHTML = `${pageToolNav(current.slug, "review")}<header class="article-head review-page-head"><div class="article-title-row"><h1>版本审阅</h1><span class="quality-badge">${review.pending ? "待审" : "稳定"}</span></div><p class="article-summary">比较 ${escapeHtml(current.title)} 的当前版本与稳定版本，查看意见并提交审阅。</p></header><section class="review-version-grid"><article class="review-version-card current"><span>当前版本</span><strong>${fmtDate(current.updatedAt)}</strong><small>${escapeHtml(current.author || "Wikist")}</small></article>${stableCard}</section>${diffPanel}${communityReviewPanel(community, "page", current.slug)}<section class="review-panel"><div class="review-panel-head"><div><span class="system-kicker">Review Notes</span><h2>审核意见</h2></div><span>${Number(reviewPayload.pagination?.total || 0)} 条</span></div><div class="review-note-list">${notes}</div><div class="review-notes-pagination">${notePagination}</div></section>${reviewerControls}`;
  document.querySelector("#pageReviewForm")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-decision]");
    if (button) event.currentTarget.dataset.decision = button.dataset.decision;
  });
  bindCommunityReviewForms(el.main, () => renderPageReview(`${current.slug}?page=${notesPage}`));
  document.querySelector("#pageReviewForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const decision = form.dataset.decision || "approve";
    const status = document.querySelector("#pageReviewStatus");
    const title = decision === "approve" ? "设为稳定版本" : "提交修改意见";
    if (!await uiConfirm({ title, text: decision === "approve" ? "当前版本将发布为已审阅稳定版。" : "审核意见将发送给编辑者。", confirmText: "确认" })) return;
    status.textContent = "提交中...";
    try {
      await api(`/api/pages/${encodeSlug(current.slug)}/review`, { method: "POST", body: JSON.stringify({ decision, comment: new FormData(form).get("comment") || "" }) });
      await renderPageReview(current.slug);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  bindPagination(el.main.querySelector(".review-notes-pagination"), (nextPage) => {
    location.hash = `#/review/${encodeSlug(current.slug)}?page=${nextPage}`;
  });
  document.querySelectorAll("[data-withdraw-review-note]").forEach((button) => {
    button.addEventListener("click", async () => {
      const accepted = await uiConfirm({
        title: "撤回审核意见",
        text: "撤回后将删除这条意见；若当前稳定版由该意见通过，稳定状态会同时撤销。",
        confirmText: "撤回",
        danger: true,
      });
      if (!accepted) return;
      button.disabled = true;
      try {
        const result = await api(`/api/pages/${encodeSlug(current.slug)}/review/${Number(button.dataset.withdrawReviewNote)}`, { method: "DELETE" });
        uiToast(result.stableChanged ? "意见已撤回，稳定版本已安全回退" : "审核意见已撤回");
        const nextPage = (reviewPayload.items || []).length === 1 && notesPage > 1 ? notesPage - 1 : notesPage;
        await renderPageReview(`${current.slug}?page=${nextPage}`);
      } catch (error) {
        button.disabled = false;
        await uiAlert("撤回失败", error.message, "error");
      }
    });
  });
}

function communityPostHtml(post, options = {}) {
  const type = { announcement: "公告", decision: "社区决议", discussion: "讨论" }[post.postType] || "讨论";
  const author = post.authorUsername ? `<a href="#/user/${encodeURIComponent(post.authorUsername)}">${avatarHtml({ displayName: post.authorName, username: post.authorUsername, avatarUrl: post.authorAvatarUrl }, "small")}<span>${escapeHtml(post.authorName || post.authorUsername)}</span></a>` : escapeHtml(post.authorName || "组织成员");
  const replyForm = options.canParticipate ? `<form class="community-post-reply-form" data-community-post-reply="${post.id}"><textarea name="content" data-forum-reference-body rows="3" placeholder="回复这条组织讨论"></textarea><div class="qa-answer-editor-tools forum-reference-tools">${forumReferencePickerHtml()}</div><footer><span class="status-line"></span><button class="mini-button" type="submit">回复</button></footer></form>` : "";
  return `<article class="community-post-card ${post.pinned ? "pinned" : ""}"><header><div><span class="community-post-type">${escapeHtml(type)}</span>${post.pageSlug ? `<a class="community-post-page" href="#/page/${encodeSlug(post.pageSlug)}">${escapeHtml(post.pageSlug)}</a>` : ""}</div><span>${fmtDate(post.updatedAt)}</span></header><h3>${escapeHtml(post.title)}</h3><article class="article-body community-post-body" ${selectionContentAttributes({ type: "organization_post", id: post.id, label: post.title || `组织讨论 #${post.id}`, url: post.organizationSlug ? organizationForumHref(post.organizationSlug, { topic: post.id }) : location.hash, organizationSlug: post.organizationSlug || "", pageSlug: post.pageSlug || "" })}>${decorateForumKnowledgeHtml(post.bodyHtml || `<p>${escapeHtml(post.bodyMd || "")}</p>`)}</article><footer><span class="community-post-author">${author}</span><button class="text-action" type="button" data-community-load-replies="${post.id}">回复 ${post.replyCount || 0}</button>${options.canManage ? `<button class="text-action" type="button" data-community-post-status="${post.status === "open" ? "resolved" : "open"}" data-community-post-id="${post.id}">${post.status === "open" ? "标记已结论" : "重新打开"}</button>` : ""}</footer><div class="community-post-replies" id="communityPostReplies-${post.id}"></div>${replyForm}</article>`;
}

function communityObjectTypeLabel(type) {
  return ({ question: "问题", answer: "回答", comment: "评论", question_revision: "问题修订", revision: "修订" })[String(type || "")] || "社区内容";
}

function communityModerationObjectHtml(item) {
  const object = item?.object || {};
  const label = communityObjectTypeLabel(object.type || item?.objectType);
  const title = object.title || `${label} #${Number(item?.objectId || 0)}`;
  const summary = object.summary || (object.status === "deleted" ? "该内容已删除。" : "打开内容查看完整上下文。");
  const content = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(summary)}</small>`;
  return object.url
    ? `<a class="community-moderation-object" href="${escapeHtml(object.url)}">${content}</a>`
    : `<div class="community-moderation-object is-unavailable">${content}</div>`;
}

function canModerateOrganizationCommunity(membership) {
  return canReviewContent() || Boolean(membership?.status === "active" && ["owner", "coordinator", "reviewer", "admin", "moderator"].includes(membership.role));
}

function communityQaController(root = el.main, options = {}) {
  if (!window.WikistCommunityQA?.Controller) throw new Error("Wikist Community 问答组件未加载。");
  return new window.WikistCommunityQA.Controller({
    root,
    api,
    state,
    escapeHtml,
    avatarHtml,
    iconHtml: navigationIconSvg,
    selectionAttributes: selectionContentAttributes,
    setTitle: setChromeTitle,
    renderToc,
    typeset: typesetMath,
    toast: uiToast,
    alert: uiAlert,
    confirm: uiConfirm,
    prompt: uiPrompt,
    ...options,
  });
}

async function renderCommunityQuestions(value = "") {
  renderToc([]);
  el.editLink.href = "#/new";
  await communityQaController(el.main).render(value);
}

async function renderCommunity(value = "") {
  const parsed = splitValueQuery(value);
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const query = parsed.params.get("q") || "";
  const payload = await api(`/api/community/organizations?page=${page}&limit=12&q=${encodeURIComponent(query)}`);
  const { items, pagination } = normalizedPaged(payload, page, 12);
  const quota = payload.quota || null;
  const quotaBlocked = Boolean(quota && !quota.canCreate);
  const quotaSummary = quota
    ? `已创建 ${Number(quota.created || 0)}/${Number(quota.createLimit || 3)} 个，已加入 ${Number(quota.memberships || 0)}/${Number(quota.membershipLimit || 5)} 个。`
    : "填写组织资料，并设置加入方式与审阅人数。";
  setChromeTitle("协作社区");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `
    <header class="article-head community-head"><span class="system-kicker">${escapeHtml(currentSiteName())} Collaboration Commons</span><div class="article-title-row"><h1>协作社区</h1><span class="quality-badge">组织协作</span></div><p class="article-summary">查找或创建组织，参与词条写作、翻译、讨论与审阅。</p></header>
    <section class="community-toolbar"><form id="communitySearchForm"><input name="q" value="${escapeHtml(query)}" placeholder="搜索组织、研究方向或简介" /><button class="command-button" type="submit">搜索组织</button></form><div class="community-reference"><span>开源治理参考</span><a href="https://github.com/discourse/discourse" target="_blank" rel="noreferrer">Discourse</a><a href="https://github.com/flarum/flarum" target="_blank" rel="noreferrer">Flarum</a><a href="https://www.mediawiki.org/wiki/Extension:PageAssessments" target="_blank" rel="noreferrer">WikiProject</a></div></section>
    <section class="community-hub-grid"><div class="community-organization-column ${items.length ? "" : "is-empty"}"><div class="community-organization-list">${items.length ? items.map((organization) => `<a class="community-organization-card" href="#/organization/${encodeURIComponent(organization.slug)}"><header class="community-organization-card-head">${organizationAvatarHtml(organization, "medium")}<div><span class="system-kicker">${escapeHtml(organization.slug)}</span><h2>${escapeHtml(organization.name)}</h2></div></header><p>${escapeHtml(organization.description || "暂未填写组织简介。")}</p><div>${(organization.focus || []).map((item) => `<em>${escapeHtml(item)}</em>`).join("") || "<em>开放协作</em>"}</div><footer><span>${organization.memberCount} 成员</span><span>${organization.taskCount} 项进行中任务</span><span>${organization.discussionCount} 条讨论</span></footer></a>`).join("") : '<p class="muted-line community-empty">还没有匹配的协作组织。</p>'}</div>${paginationHtml(pagination, "协作组织")}</div>${state.user ? `<form class="community-create-panel" id="communityCreateForm"><header><span class="system-kicker">Start A Commons</span><h2>创建协作组织</h2><p>${escapeHtml(quotaSummary)}</p></header><label><span>组织标识</span><input name="slug" required maxlength="80" placeholder="例如：algebra-workshop" ${quotaBlocked ? "disabled" : ""} /></label><label><span>组织名称</span><input name="name" required maxlength="90" placeholder="例如：代数协作工坊" ${quotaBlocked ? "disabled" : ""} /></label><label><span>&#32452;&#32455;&#22836;&#20687; URL</span><input name="avatarImage" inputmode="url" maxlength="500" placeholder="https://... &#25110; /uploads/..." ${quotaBlocked ? "disabled" : ""} /></label><label><span>研究方向</span><input name="focus" maxlength="500" placeholder="例如：抽象代数，群论，英文翻译" ${quotaBlocked ? "disabled" : ""} /></label><label><span>组织简介</span><textarea name="description" rows="4" maxlength="900" placeholder="说明组织要共同维护的知识领域与协作方式" ${quotaBlocked ? "disabled" : ""}></textarea></label><div class="community-create-options"><label><span>加入方式</span><select name="visibility" ${quotaBlocked ? "disabled" : ""}><option value="public">直接加入</option><option value="request">申请后加入</option></select></label><label><span>审阅阈值</span><select name="reviewThreshold" ${quotaBlocked ? "disabled" : ""}><option value="2">2 位审阅者</option><option value="3">3 位审阅者</option><option value="4">4 位审阅者</option></select></label></div><button class="command-button" type="submit" ${quotaBlocked ? "disabled" : ""}>${quotaBlocked ? "已达到组织配额" : "创建协作组织"}</button><p class="status-line"></p></form>` : '<aside class="community-create-panel community-login-panel"><h2>加入协作</h2><p>登录后可创建或加入协作组织，认领词条、翻译和审阅任务。</p><a class="command-button" href="#/login">登录 Wikist Passport</a></aside>'}</section>`;
  document.querySelector("#communitySearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = new FormData(event.currentTarget).get("q") || "";
    location.hash = `#/community?q=${encodeURIComponent(next)}`;
  });
  bindPagination(document.querySelector(".community-organization-column"), (next) => { location.hash = `#/community?q=${encodeURIComponent(query)}&page=${next}`; });
  document.querySelector("#communityCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector(".status-line");
    status.textContent = "正在创建组织...";
    try {
      const result = await api("/api/community/organizations", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      uiToast("协作组织已创建");
      location.hash = `#/organization/${encodeURIComponent(result.organization.slug)}`;
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function organizationForumHref(slug, values = {}) {
  const params = new URLSearchParams();
  params.set("tab", "forum");
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "" && !(key === "page" && Number(value) === 1) && !(key === "replies" && Number(value) === 1)) params.set(key, String(value));
  });
  return `#/organization/${encodeURIComponent(slug)}?${params.toString()}`;
}

function forumReferencePickerHtml() {
  return `<div class="qa-reference-control forum-reference-control"><button class="qa-reference-trigger" type="button" data-forum-reference-toggle aria-expanded="false">${navigationIconSvg("network")}<span>引用知识</span></button><section class="qa-reference-picker" data-forum-reference-picker hidden><header><div><span class="system-kicker">Knowledge Reference</span><strong>插入知识引用</strong></div><button class="qa-icon-button" type="button" data-forum-reference-close aria-label="关闭引用选择器">×</button></header><div class="qa-reference-fields"><label class="wikist-field"><span>类型</span><select class="wikist-input" data-forum-reference-type><option value="wiki_entry">词条</option><option value="revision">词条修订</option><option value="question">问题</option><option value="answer">回答</option><option value="organization">协作组织</option><option value="user">用户</option></select></label><label class="wikist-field qa-reference-search-field"><span>查找</span><input class="wikist-input" data-forum-reference-search type="search" autocomplete="off" placeholder="搜索标题或标识" /></label><label class="wikist-field" data-forum-reference-revision hidden><span>修订版本</span><input class="wikist-input" data-forum-reference-revision-input placeholder="版本标识" /></label></div><div class="qa-reference-results" data-forum-reference-results><p class="muted-line">搜索并选择要引用的内容。</p></div></section></div>`;
}

function forumKnowledgeReferenceHtml(type, rawId, label) {
  const reference = messagingReferenceFromToken(type, rawId, label, []);
  const normalized = reference.type === "page" ? "wiki_entry" : String(reference.type || "wiki_entry").toLowerCase();
  const labels = { wiki_entry: "Wikist 词条", revision: "词条修订", question: "社区问题", answer: "社区回答", organization: "协作组织", user: "用户", selection: "正文划词" };
  const icon = normalized === "user" ? "members" : normalized === "organization" ? "community" : ["question", "answer"].includes(normalized) ? "forum" : "network";
  return `<a class="qa-knowledge-reference forum-knowledge-reference" href="${escapeHtml(messagingSafeUrl(reference.url, "#/knowledge"))}" data-object-type="${escapeHtml(normalized)}" data-object-id="${escapeHtml(reference.id || rawId)}"><span class="qa-knowledge-reference-icon">${navigationIconSvg(icon)}</span><span class="qa-knowledge-reference-copy"><small>${escapeHtml(labels[normalized] || "知识对象")}</small><strong>${escapeHtml(reference.label || label || reference.id || rawId)}</strong><em>${escapeHtml(reference.id || rawId)}</em></span><span class="qa-knowledge-reference-open">查看</span></a>`;
}

function decorateForumKnowledgeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!node.nodeValue || node.parentElement?.closest("a,code,pre,script,style,textarea")) return;
    const source = node.nodeValue;
    const pattern = /\{\{ref:([a-z_]+)\|([^|{}]+)\|([^{}]+)\}\}|\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/gi;
    let cursor = 0;
    let match;
    const fragment = document.createDocumentFragment();
    while ((match = pattern.exec(source))) {
      fragment.append(document.createTextNode(source.slice(cursor, match.index)));
      const shell = document.createElement("template");
      shell.innerHTML = match[1]
        ? forumKnowledgeReferenceHtml(match[1], String(match[2]).trim(), String(match[3]).trim())
        : forumKnowledgeReferenceHtml("wiki_entry", String(match[4]).trim(), String(match[5] || match[4]).trim());
      fragment.append(shell.content.cloneNode(true));
      cursor = pattern.lastIndex;
    }
    if (cursor === 0) return;
    fragment.append(document.createTextNode(source.slice(cursor)));
    node.replaceWith(fragment);
  });
  return template.innerHTML;
}

function forumReferenceSummary(markdown) {
  return String(markdown || "")
    .replace(/\{\{ref:[a-z_]+\|[^|{}]+\|([^{}]+)\}\}/gi, "$1")
    .replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_match, slug, label) => label || slug);
}

function bindForumReferencePicker(form) {
  if (!form) return;
  const panel = form.querySelector("[data-forum-reference-picker]");
  const toggle = form.querySelector("[data-forum-reference-toggle]");
  const close = form.querySelector("[data-forum-reference-close]");
  const type = form.querySelector("[data-forum-reference-type]");
  const search = form.querySelector("[data-forum-reference-search]");
  const results = form.querySelector("[data-forum-reference-results]");
  const revisionField = form.querySelector("[data-forum-reference-revision]");
  const revisionInput = form.querySelector("[data-forum-reference-revision-input]");
  const textarea = form.querySelector("textarea[data-forum-reference-body]");
  if (!panel || !toggle || !search || !results || !textarea) return;
  let timer = 0;
  let requestId = 0;
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) search.focus();
  };
  const load = () => {
    window.clearTimeout(timer);
    const query = String(search.value || "").trim();
    if (!query) {
      results.innerHTML = '<p class="muted-line">搜索并选择要引用的内容。</p>';
      return;
    }
    const current = ++requestId;
    results.innerHTML = '<p class="muted-line">正在查找知识对象...</p>';
    timer = window.setTimeout(async () => {
      const payload = await api(`/api/messaging/objects/suggest?type=${encodeURIComponent(type?.value || "wiki_entry")}&q=${encodeURIComponent(query)}&limit=12`).catch(() => ({ items: [] }));
      if (current !== requestId || String(search.value || "").trim() !== query) return;
      const items = payload.items || [];
      results.innerHTML = items.length
        ? items.map((item) => `<button type="button" data-forum-reference-item="${escapeHtml(encodeURIComponent(JSON.stringify(item)))}"><span class="qa-reference-result-icon">${navigationIconSvg(item.type === "user" ? "members" : "network")}</span><span><strong>${escapeHtml(item.label || item.displayName || item.id || "知识对象")}</strong><small>${escapeHtml(item.summary || item.id || "")}</small></span><em>引用</em></button>`).join("")
        : '<p class="muted-line">没有找到匹配结果。</p>';
    }, 180);
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  close?.addEventListener("click", () => setOpen(false));
  type?.addEventListener("change", () => {
    revisionField?.toggleAttribute("hidden", type.value !== "revision");
    load();
  });
  search.addEventListener("input", load);
  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-forum-reference-item]");
    if (!button) return;
    let item;
    try { item = JSON.parse(decodeURIComponent(button.dataset.forumReferenceItem || "")); } catch (_error) { return; }
    if (type?.value === "revision") {
      const revision = String(revisionInput?.value || "").trim();
      if (!revision) {
        revisionInput?.focus();
        return;
      }
      item.type = "revision";
      item.revision = revision;
    }
    const token = messagingReferenceToken(item);
    const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
    const prefix = start > 0 && !/\s$/.test(textarea.value.slice(0, start)) ? "\n\n" : "";
    const suffix = end < textarea.value.length && !/^\s/.test(textarea.value.slice(end)) ? "\n\n" : "";
    textarea.setRangeText(`${prefix}${token}${suffix}`, start, end, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    setOpen(false);
  });
}

function forumTopicTypeLabel(type) {
  return ({ announcement: "公告", decision: "社区决议", discussion: "学术讨论" })[type] || "学术讨论";
}

function forumTopicStatusLabel(status) {
  return ({ open: "开放讨论", resolved: "已形成结论", locked: "已锁定" })[status] || "开放讨论";
}

function forumTopicRowHtml(post) {
  const href = organizationForumHref(post.organizationSlug, { topic: post.id });
  const summary = shortText(forumReferenceSummary(post.bodyMd || ""), 180) || "该主题暂未提供摘要。";
  return `<article class="forum-topic-row ${post.pinned ? "pinned" : ""}"><div class="forum-topic-signals"><span class="forum-topic-type">${escapeHtml(forumTopicTypeLabel(post.postType))}</span>${post.pinned ? '<span class="forum-topic-pin">置顶</span>' : ""}</div><div class="forum-topic-copy"><a href="${href}"><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(summary)}</p></a><footer><a href="#/user/${encodeURIComponent(post.authorUsername)}">${avatarHtml({ displayName: post.authorName, username: post.authorUsername, avatarUrl: post.authorAvatarUrl }, "small")}<span>${escapeHtml(post.authorName || post.authorUsername)}</span></a>${post.pageSlug ? `<a class="forum-topic-page" href="#/page/${encodeSlug(post.pageSlug)}">${escapeHtml(post.pageSlug)}</a>` : ""}<span>${fmtDate(post.updatedAt)}</span></footer></div><aside class="forum-topic-metrics"><strong>${Number(post.replyCount || 0)}</strong><small>回复</small><span>${escapeHtml(forumTopicStatusLabel(post.status))}</span></aside></article>`;
}

function forumComposerHtml(canManage) {
  return `<form class="forum-composer" id="organizationForumComposer"><header><span class="system-kicker">New Topic</span><h2>发起主题</h2><p>关联词条并填写主题内容。</p></header><div class="forum-composer-meta"><label><span>主题类别</span><select name="postType"><option value="discussion">学术讨论</option>${canManage ? '<option value="announcement">组织公告</option><option value="decision">社区决议</option>' : ""}</select></label><label><span>关联词条</span><input name="pageSlug" placeholder="可选 slug" /></label><label><span>语言</span><input name="language" placeholder="可选，如 en" /></label></div><label><span>标题</span><input name="title" maxlength="180" required placeholder="提出一个可讨论、可归档的问题" /></label><label><span>正文</span><textarea name="bodyMd" data-forum-reference-body rows="7" required placeholder="支持 Markdown、公式、引用和 Wikist 扩展语法"></textarea></label><div class="qa-answer-editor-tools forum-reference-tools">${forumReferencePickerHtml()}</div><footer class="forum-composer-actions"><p class="status-line"></p><button class="command-button" type="submit">发布主题</button></footer></form>`;
}

function forumActionButton(kind, label, active, dataset) {
  const icon = kind === "favorite"
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5c0 2.1-.88 4-2.3 5.36L18.5 21H5.5l1.3-3.64A7.46 7.46 0 0 1 4.5 12 7.5 7.5 0 0 1 12 4.5Zm0 3a4.5 4.5 0 0 0-4.5 4.5c0 1.36.6 2.58 1.55 3.4l.44.38-.58 1.62h6.18l-.58-1.62.44-.38A4.47 4.47 0 0 0 16.5 12 4.5 4.5 0 0 0 12 7.5Z"/></svg>';
  return `<button class="article-${kind === "favorite" ? "favorite" : "watch"}-button forum-action-button ${active ? "active" : ""}" type="button" ${dataset} aria-pressed="${active ? "true" : "false"}">${icon}<span>${escapeHtml(label)}</span></button>`;
}

function forumReplyHtml(reply, index, options = {}) {
  const floor = (Number(options.offset || 0) + index + 1);
  const canDelete = Boolean(state.user && (Number(reply.authorUserId) === Number(state.user.id) || options.canManage || state.user.role === "admin"));
  const body = linkCommentMentions(decorateForumKnowledgeHtml(reply.contentHtml || `<p>${escapeHtml(reply.contentMd || "")}</p>`));
  return `<article class="forum-reply"><div class="forum-reply-marker"><span class="forum-reply-floor">#${floor}</span><a href="#/user/${encodeURIComponent(reply.authorUsername)}">${avatarHtml({ displayName: reply.authorName, username: reply.authorUsername, avatarUrl: reply.authorAvatarUrl }, "small")}</a></div><div class="forum-reply-content"><header><a href="#/user/${encodeURIComponent(reply.authorUsername)}"><strong>${escapeHtml(reply.authorName || reply.authorUsername)}</strong></a><small>${fmtDate(reply.createdAt)}</small></header><article class="article-body" ${selectionContentAttributes({ type: "answer", id: reply.id, label: `回复 · ${options.topicTitle || `#${reply.id}`}`, url: options.topicUrl || location.hash, organizationSlug: options.organizationSlug || "", pageSlug: options.pageSlug || "" })}>${body}</article><footer><button class="text-action" type="button" data-forum-reply-to="${escapeHtml(reply.authorUsername)}">回复</button>${canDelete ? `<button class="text-action danger" type="button" data-forum-delete-reply="${reply.id}">删除</button>` : ""}</footer></div></article>`;
}

async function renderOrganizationForum(value) {
  const parsed = splitValueQuery(value);
  const slug = parsed.pathValue;
  const topicId = Number(parsed.params.get("topic") || 0);
  const detail = await api(`/api/community/organizations/${encodeURIComponent(slug)}`);
  if (topicId > 0) {
    await renderOrganizationForumTopic(value, detail, topicId);
    return;
  }
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const query = parsed.params.get("q") || "";
  const postType = parsed.params.get("type") || "all";
  const status = parsed.params.get("status") || "all";
  const sort = parsed.params.get("sort") || "latest";
  const postsPayload = await api(`/api/community/organizations/${encodeURIComponent(slug)}/posts?page=${page}&limit=12&q=${encodeURIComponent(query)}&type=${encodeURIComponent(postType)}&status=${encodeURIComponent(status)}&sort=${encodeURIComponent(sort)}`);
  const organization = detail.organization;
  const membership = detail.membership;
  const activeMember = membership?.status === "active";
  const canManage = activeMember && ["owner", "coordinator"].includes(membership.role);
  const { items: posts, pagination } = normalizedPaged(postsPayload, page, 12);
  setChromeTitle(`${organization.name} · 学术论坛`);
  renderToc([]);
  el.editLink.href = "#/new";
  const href = (nextPage = 1, overrides = {}) => organizationForumHref(organization.slug, { page: nextPage, q: query, type: postType, status, sort, ...overrides });
  el.main.innerHTML = `${organizationWorkspaceHeader(organization, membership, "forum", "搜索主题、回复讨论，并把结论转为协作任务。")}<section class="forum-workbench"><div class="forum-main-column"><form class="forum-filters" id="organizationForumFilters"><input name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索主题标题、正文或关联词条" /><select name="type"><option value="all" ${postType === "all" ? "selected" : ""}>全部类别</option><option value="discussion" ${postType === "discussion" ? "selected" : ""}>学术讨论</option><option value="announcement" ${postType === "announcement" ? "selected" : ""}>组织公告</option><option value="decision" ${postType === "decision" ? "selected" : ""}>社区决议</option></select><select name="status"><option value="all" ${status === "all" ? "selected" : ""}>全部状态</option><option value="open" ${status === "open" ? "selected" : ""}>开放讨论</option><option value="resolved" ${status === "resolved" ? "selected" : ""}>已形成结论</option><option value="locked" ${status === "locked" ? "selected" : ""}>已锁定</option></select><select name="sort"><option value="latest" ${sort === "latest" ? "selected" : ""}>最近更新</option><option value="active" ${sort === "active" ? "selected" : ""}>回复最多</option><option value="unresolved" ${sort === "unresolved" ? "selected" : ""}>优先未结论</option></select><button class="command-button" type="submit">筛选</button></form><section class="forum-topic-list">${posts.length ? posts.map(forumTopicRowHtml).join("") : '<section class="empty-state"><h2>没有匹配主题</h2><p>调整筛选条件，或由组织成员发起第一条学术讨论。</p></section>'}</section>${paginationHtml(pagination, "论坛主题")}</div><aside class="forum-side-column">${activeMember ? forumComposerHtml(canManage) : '<section class="forum-side-note"><h2>参与讨论</h2><p>加入组织后即可发布和回复主题。</p><a class="command-button" href="#/community">发现组织</a></section>'}<section class="forum-side-note"><span class="system-kicker">Academic Workflow</span><h2>从讨论到词条</h2><p>把讨论结论转为任务，并在关联词条中继续协作。</p><a class="mini-link" href="${organizationWorkspaceHref(organization.slug, "tasks")}">查看协作任务</a></section></aside></section>`;
  const postDraft = consumeSelectionDraft("post", document.querySelector("#organizationForumComposer textarea[name='bodyMd']"));
  if (postDraft?.selection?.pageSlug) {
    const pageInput = document.querySelector("#organizationForumComposer input[name='pageSlug']");
    if (pageInput && !pageInput.value) pageInput.value = String(postDraft.selection.pageSlug).split(":")[0];
  }
  bindForumReferencePicker(document.querySelector("#organizationForumComposer"));
  document.querySelector("#organizationForumFilters")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    location.hash = href(1, { q: form.get("q") || "", type: form.get("type") || "all", status: form.get("status") || "all", sort: form.get("sort") || "latest" });
  });
  document.querySelector("#organizationForumComposer")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const statusLine = form.querySelector(".status-line");
    statusLine.textContent = "正在发布主题...";
    try { const result = await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/posts`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); location.hash = organizationForumHref(organization.slug, { topic: result.post.id }); } catch (error) { statusLine.textContent = error.message; }
  });
  bindPagination(el.main, (next) => { location.hash = href(next); });
}

async function renderOrganizationForumTopic(value, detail, topicId) {
  const parsed = splitValueQuery(value);
  const slug = detail.organization.slug;
  const replyPage = Math.max(1, Number(parsed.params.get("replies")) || 1);
  const [postPayload, repliesPayload] = await Promise.all([
    api(`/api/community/posts/${topicId}`),
    api(`/api/community/posts/${topicId}/replies?page=${replyPage}&limit=12`),
  ]);
  const post = postPayload.post;
  if (post.organizationSlug !== slug) throw new Error("该讨论主题不属于当前组织。");
  const membership = detail.membership;
  const activeMember = membership?.status === "active";
  const canManage = activeMember && ["owner", "coordinator"].includes(membership.role);
  const { items: replies, pagination } = normalizedPaged(repliesPayload, replyPage, 12);
  setChromeTitle(`${post.title} · ${detail.organization.name}`);
  renderToc([]);
  el.editLink.href = "#/new";
  const forumHref = organizationForumHref(slug);
  const replyHref = (next) => organizationForumHref(slug, { topic: post.id, replies: next });
  const author = `<a href="#/user/${encodeURIComponent(post.authorUsername)}">${avatarHtml({ displayName: post.authorName, username: post.authorUsername, avatarUrl: post.authorAvatarUrl }, "small")}<span>${escapeHtml(post.authorName || post.authorUsername)}</span></a>`;
  const canDeletePost = Boolean(state.user && (Number(post.authorUserId) === Number(state.user.id) || canManage || state.user.role === "admin"));
  const managementActions = (canManage || canDeletePost) ? `<div class="forum-topic-actions">${canManage ? `<button class="mini-button" type="button" data-forum-post-status="${post.status === "open" ? "resolved" : "open"}">${post.status === "open" ? "标记已结论" : "重新开放"}</button><button class="mini-button secondary" type="button" data-forum-post-pin="${post.pinned ? "false" : "true"}">${post.pinned ? "取消置顶" : "置顶主题"}</button>` : ""}${canDeletePost ? '<button class="mini-button danger" type="button" data-forum-delete-post>删除主题</button>' : ""}</div>` : "";
  const socialActions = activeMember ? `<div class="forum-topic-social">${forumActionButton("watch", post.following ? "已关注讨论" : "关注讨论", post.following, `data-forum-follow="${post.following ? "false" : "true"}"`)}${forumActionButton("favorite", post.favorited ? `已收藏 · ${Number(post.favoriteCount || 0)}` : `收藏讨论${Number(post.favoriteCount || 0) ? ` · ${Number(post.favoriteCount)}` : ""}`, post.favorited, `data-forum-favorite="${post.favorited ? "false" : "true"}"`)}</div>` : "";
  const topicToolbar = socialActions || managementActions ? `<div class="forum-topic-toolbar">${socialActions}${managementActions}</div>` : "";
  const replyForm = activeMember && post.status !== "locked" ? `<form class="forum-reply-form" id="forumReplyForm"><div class="forum-reply-form-head"><label><span id="forumReplyLabel">回复主题</span><textarea name="contentMd" data-forum-reference-body rows="5" required placeholder="支持 Markdown、公式与来源链接"></textarea></label><button class="text-action" type="button" id="forumReplyCancel" hidden>取消 @ 回复</button></div><div class="qa-answer-editor-tools forum-reference-tools">${forumReferencePickerHtml()}</div><footer class="forum-reply-actions"><p class="status-line"></p><button class="command-button" type="submit">发布回复</button></footer></form>` : `<p class="muted-line">${post.status === "locked" ? "该主题已锁定。" : "加入组织后可以参与回复。"}</p>`;
  const topicSelectionUrl = organizationForumHref(slug, { topic: post.id });
  el.main.innerHTML = `<header class="forum-topic-head"><div class="forum-breadcrumbs"><a href="${forumHref}">${escapeHtml(detail.organization.name)} 论坛</a><span>/</span><strong>${escapeHtml(forumTopicTypeLabel(post.postType))}</strong></div><div class="article-title-row"><h1>${escapeHtml(post.title)}</h1><span class="quality-badge">${escapeHtml(forumTopicStatusLabel(post.status))}</span></div><div class="forum-topic-author">${author}<span>发起于 ${fmtDate(post.createdAt)}</span>${post.pageSlug ? `<a href="#/page/${encodeSlug(post.pageSlug)}">关联词条：${escapeHtml(post.pageSlug)}</a>` : ""}</div>${topicToolbar}</header><section class="forum-topic-body article-body" ${selectionContentAttributes({ type: "question", id: post.id, label: post.title, url: topicSelectionUrl, organizationSlug: slug, pageSlug: post.pageSlug || "" })}>${decorateForumKnowledgeHtml(post.bodyHtml || `<p>${escapeHtml(post.bodyMd || "")}</p>`)}</section><section class="forum-replies"><header><div><span class="system-kicker">Reply Thread</span><h2>回复</h2><p class="muted-line">回复成员以 @ 提及，并同步到站内信。</p></div><span>${Number(pagination.total || 0)} 条</span></header><div class="forum-reply-list">${replies.length ? replies.map((reply, index) => forumReplyHtml(reply, index, { offset: (replyPage - 1) * 12, canManage, organizationSlug: slug, pageSlug: post.pageSlug || "", topicTitle: post.title, topicUrl: topicSelectionUrl })).join("") : '<p class="muted-line">还没有回复。</p>'}</div>${paginationHtml(pagination, "主题回复")}${replyForm}</section>`;
  const topicContent = el.main.innerHTML;
  const topicContext = `<aside class="forum-topic-sidebar"><section><span class="system-kicker">Discussion Context</span><h2>主题信息</h2><dl><div><dt>主题状态</dt><dd>${escapeHtml(forumTopicStatusLabel(post.status))}</dd></div><div><dt>讨论类型</dt><dd>${escapeHtml(forumTopicTypeLabel(post.postType))}</dd></div><div><dt>关联词条</dt><dd>${post.pageSlug ? `<a href="#/page/${encodeSlug(post.pageSlug)}">${escapeHtml(post.pageSlug)}</a>` : "未关联"}</dd></div><div><dt>最后更新</dt><dd>${fmtDate(post.updatedAt)}</dd></div></dl></section><section class="forum-topic-sidebar-note"><span class="system-kicker">Academic Record</span><p>关注或收藏此主题后，后续回复与状态更新会进入站内消息。</p></section></aside>`;
  el.main.innerHTML = `${organizationWorkspaceHeader(detail.organization, membership, "forum", "查看主题内容、回复与关联词条。")}<section class="organization-forum-topic-layout"><main class="forum-topic-main">${topicContent}</main>${topicContext}</section>`;
  bindForumReferencePicker(document.querySelector("#forumReplyForm"));
  document.querySelector("#forumReplyForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const statusLine = form.querySelector(".status-line"); statusLine.textContent = "正在发布回复...";
    try { await api(`/api/community/posts/${post.id}/replies`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); location.hash = replyHref(1); await renderOrganizationForumTopic(value, detail, topicId); } catch (error) { statusLine.textContent = error.message; }
  });
  document.querySelectorAll("[data-forum-reply-to]").forEach((button) => button.addEventListener("click", () => {
    const username = button.dataset.forumReplyTo;
    const form = document.querySelector("#forumReplyForm");
    const textarea = form?.querySelector("textarea[name='contentMd']");
    if (!form || !textarea) return;
    const prefix = `@${username} `;
    if (!textarea.value.startsWith(prefix)) textarea.value = `${prefix}${textarea.value}`;
    form.dataset.replyTo = username;
    const label = form.querySelector("#forumReplyLabel");
    if (label) label.textContent = `回复 @${username}`;
    const cancel = form.querySelector("#forumReplyCancel");
    if (cancel) cancel.hidden = false;
    textarea.focus();
  }));
  document.querySelector("#forumReplyCancel")?.addEventListener("click", (event) => {
    const form = event.currentTarget.closest("form");
    const textarea = form?.querySelector("textarea[name='contentMd']");
    if (textarea) textarea.value = "";
    if (form) delete form.dataset.replyTo;
    const label = form?.querySelector("#forumReplyLabel");
    if (label) label.textContent = "回复主题";
    event.currentTarget.hidden = true;
  });
  document.querySelector("[data-forum-post-status]")?.addEventListener("click", async (event) => {
    try { await api(`/api/community/posts/${post.id}`, { method: "PUT", body: JSON.stringify({ status: event.currentTarget.dataset.forumPostStatus }) }); await renderOrganizationForumTopic(value, detail, topicId); } catch (error) { await uiAlert("更新失败", error.message, "error"); }
  });
  document.querySelector("[data-forum-post-pin]")?.addEventListener("click", async (event) => {
    try { await api(`/api/community/posts/${post.id}`, { method: "PUT", body: JSON.stringify({ pinned: event.currentTarget.dataset.forumPostPin === "true" }) }); await renderOrganizationForumTopic(value, detail, topicId); } catch (error) { await uiAlert("更新失败", error.message, "error"); }
  });
  document.querySelector("[data-forum-follow]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const enabled = button.dataset.forumFollow === "true";
    button.disabled = true;
    try { await api(`/api/community/posts/${post.id}/follow`, { method: "PUT", body: JSON.stringify({ enabled }) }); uiToast(enabled ? "已关注讨论" : "已取消关注"); await renderOrganizationForumTopic(value, detail, topicId); } catch (error) { button.disabled = false; await uiAlert("操作失败", error.message, "error"); }
  });
  document.querySelector("[data-forum-favorite]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const favorited = button.dataset.forumFavorite === "true";
    button.disabled = true;
    try { await api(`/api/community/posts/${post.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorited }) }); uiToast(favorited ? "已收藏讨论" : "已取消收藏"); await renderOrganizationForumTopic(value, detail, topicId); } catch (error) { button.disabled = false; await uiAlert("操作失败", error.message, "error"); }
  });
  document.querySelector("[data-forum-delete-post]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const accepted = await uiConfirm({ title: "删除讨论主题", text: "主题及其回复将从公开论坛隐藏。", confirmText: "删除", danger: true });
    if (!accepted) return;
    button.disabled = true;
    try { await api(`/api/community/posts/${post.id}`, { method: "DELETE", body: "{}" }); uiToast("讨论主题已删除"); location.hash = forumHref; } catch (error) { button.disabled = false; await uiAlert("删除失败", error.message, "error"); }
  });
  document.querySelectorAll("[data-forum-delete-reply]").forEach((button) => button.addEventListener("click", async () => {
    const accepted = await uiConfirm({ title: "删除讨论回复", text: "回复会从公开讨论中隐藏，并保留审计记录。", confirmText: "删除", danger: true });
    if (!accepted) return;
    button.disabled = true;
    try { await api(`/api/community/posts/${post.id}/replies/${Number(button.dataset.forumDeleteReply)}`, { method: "DELETE", body: "{}" }); uiToast("讨论回复已删除"); await renderOrganizationForumTopic(value, detail, topicId); } catch (error) { button.disabled = false; await uiAlert("删除失败", error.message, "error"); }
  }));
  bindPagination(el.main, (next) => { location.hash = replyHref(next); });
}

async function loadCommunityPostReplies(postId) {
  const target = document.querySelector(`#communityPostReplies-${postId}`);
  if (!target) return;
  target.innerHTML = '<p class="muted-line">正在加载回复...</p>';
  const payload = await api(`/api/community/posts/${postId}/replies?page=1&limit=12`).catch(() => ({ items: [] }));
  target.innerHTML = (payload.items || []).length ? `<div class="community-reply-stack">${payload.items.map((reply) => `<article class="community-reply"><a href="#/user/${encodeURIComponent(reply.authorUsername)}">${avatarHtml({ displayName: reply.authorName, username: reply.authorUsername, avatarUrl: reply.authorAvatarUrl }, "small")}</a><div><strong>${escapeHtml(reply.authorName)}</strong><article class="article-body">${reply.contentHtml || `<p>${escapeHtml(reply.contentMd || "")}</p>`}</article><small>${fmtDate(reply.createdAt)}</small></div></article>`).join("")}</div>` : '<p class="muted-line">暂无回复。</p>';
}

async function renderOrganizationLegacy(value) {
  const parsed = splitValueQuery(value);
  if (parsed.params.get("tab") === "forum") {
    await renderOrganizationForum(value);
    return;
  }
  const slug = parsed.pathValue;
  const taskPage = Math.max(1, Number(parsed.params.get("tasks")) || 1);
  const postPage = Math.max(1, Number(parsed.params.get("posts")) || 1);
  const memberPage = Math.max(1, Number(parsed.params.get("members")) || 1);
  const [detail, tasksPayload, postsPayload, membersPayload] = await Promise.all([
    api(`/api/community/organizations/${encodeURIComponent(slug)}`),
    api(`/api/community/organizations/${encodeURIComponent(slug)}/tasks?page=${taskPage}&limit=8`),
    api(`/api/community/organizations/${encodeURIComponent(slug)}/posts?page=${postPage}&limit=6`),
    api(`/api/community/organizations/${encodeURIComponent(slug)}/members?page=${memberPage}&limit=12`),
  ]);
  const organization = detail.organization;
  const membership = detail.membership;
  const activeMember = membership?.status === "active";
  const canManage = activeMember && ["owner", "coordinator"].includes(membership.role);
  const { items: tasks, pagination: taskPagination } = normalizedPaged(tasksPayload, taskPage, 8);
  const { items: posts, pagination: postPagination } = normalizedPaged(postsPayload, postPage, 6);
  const { items: members, pagination: memberPagination } = normalizedPaged(membersPayload, memberPage, 12);
  setChromeTitle(`${organization.name} · 协作组织`);
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `
    <header class="organization-hero"><span class="system-kicker">Collaboration Organization</span><div class="article-title-row"><h1>${escapeHtml(organization.name)}</h1><span class="quality-badge">${escapeHtml(organization.visibility === "request" ? "申请加入" : "开放加入")}</span></div><p>${escapeHtml(organization.description || "该组织尚未填写简介。")}</p><div class="organization-focus">${(organization.focus || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div><footer><span>${organization.memberCount} 成员</span><span>${organization.taskCount} 项任务</span><span>审阅阈值 ${organization.reviewThreshold}</span>${membership ? `<span>你的角色：${escapeHtml(organizationRoleLabel(membership.role))}${membership.status !== "active" ? "（待批准）" : ""}</span>` : ""}</footer><div class="organization-hero-actions">${!membership && state.user ? '<button class="command-button" id="organizationJoinButton" type="button">加入组织</button>' : ""}${!state.user ? '<a class="command-button" href="#/login">登录后加入</a>' : ""}</div></header>
    <section class="organization-workbench"><div class="organization-main-column"><section class="organization-section"><header class="organization-section-head"><div><span class="system-kicker">Task Board</span><h2>协作任务</h2></div><span>${taskPagination.total || 0} 项</span></header><div class="community-task-list">${tasks.length ? tasks.map((task) => organizationTaskHtml(task, { manage: canManage })).join("") : '<p class="muted-line">尚无协作任务。</p>'}</div>${paginationHtml(taskPagination, "协作任务")}${canManage ? `<form class="organization-task-form" id="organizationTaskForm"><h3>发布协作任务</h3><div class="organization-task-fields"><label><span>类型</span><select name="taskType"><option value="write">撰写词条</option><option value="translate">翻译词条</option><option value="review">社区审阅</option></select></label><label><span>词条 slug</span><input name="pageSlug" required placeholder="例如：abstract-algebra" /></label><label><span>语言</span><input name="language" placeholder="翻译/审阅时填写，如 en" /></label><label><span>优先级</span><select name="priority"><option value="normal">常规</option><option value="high">高</option><option value="urgent">紧急</option></select></label></div><label><span>任务标题</span><input name="title" required placeholder="说明需要完成的工作" /></label><label><span>任务说明</span><textarea name="summary" rows="3" placeholder="列出范围、来源、审阅要求或交付标准"></textarea></label><button class="command-button" type="submit">发布任务</button><p class="status-line"></p></form>` : ""}</section><section class="organization-section"><header class="organization-section-head"><div><span class="system-kicker">Discussion Stream</span><h2>组织讨论</h2></div><span>${postPagination.total || 0} 条</span></header><div class="community-post-list">${posts.length ? posts.map((post) => communityPostHtml(post, { canParticipate: activeMember, canManage })).join("") : '<p class="muted-line">尚无组织讨论。</p>'}</div>${paginationHtml(postPagination, "组织讨论")}${activeMember ? `<form class="organization-post-form" id="organizationPostForm"><h3>发起讨论</h3><div class="organization-post-head-fields"><label><span>类型</span><select name="postType"><option value="discussion">讨论</option>${canManage ? '<option value="announcement">公告</option><option value="decision">社区决议</option>' : ""}</select></label><label><span>关联词条</span><input name="pageSlug" placeholder="可选 slug" /></label><label><span>语言</span><input name="language" placeholder="可选，例如 en" /></label></div><label><span>标题</span><input name="title" required placeholder="提出一个可讨论、可归档的问题" /></label><label><span>内容</span><textarea name="bodyMd" rows="5" required placeholder="支持 Markdown 与数学公式"></textarea></label><button class="command-button" type="submit">发布讨论</button><p class="status-line"></p></form>` : ""}</section></div><aside class="organization-side-column"><section class="organization-section organization-members-section"><header class="organization-section-head"><div><span class="system-kicker">People</span><h2>组织成员</h2></div><span>${memberPagination.total || 0}</span></header><div class="organization-member-list">${members.map((member) => `<article><a href="#/user/${encodeURIComponent(member.username)}">${avatarHtml({ displayName: member.displayName, username: member.username, avatarUrl: member.avatarUrl }, "small")}<span><strong>${escapeHtml(member.displayName)}</strong><small>@${escapeHtml(member.username)}</small></span></a><em>${escapeHtml(organizationRoleLabel(member.role))}${member.status === "pending" ? "（待批准）" : ""}</em>${canManage && member.status === "pending" ? `<button class="mini-button" type="button" data-community-member-approve="${member.userId}">批准</button>` : ""}${canManage && member.status === "active" && member.userId !== state.user?.id ? `<select data-community-member-role="${member.userId}"><option value="member" ${member.role === "member" ? "selected" : ""}>成员</option><option value="writer" ${member.role === "writer" ? "selected" : ""}>写作者</option><option value="translator" ${member.role === "translator" ? "selected" : ""}>译者</option><option value="reviewer" ${member.role === "reviewer" ? "selected" : ""}>审阅者</option><option value="coordinator" ${member.role === "coordinator" ? "selected" : ""}>协调者</option></select>` : ""}</article>`).join("")}</div>${paginationHtml(memberPagination, "组织成员")}</section><section class="organization-section organization-guidance"><span class="system-kicker">Community Contract</span><h2>协作约定</h2><p>查看贡献规范，并按组织约定推进任务与审阅。</p><a href="#/page/contribution-guide">贡献规范</a></section></aside></section>`;
  document.querySelector(".organization-hero-actions")?.insertAdjacentHTML("afterbegin", `<a class="command-button secondary" href="${organizationForumHref(organization.slug)}">进入学术论坛</a>`);
  document.querySelectorAll(".organization-section-head").forEach((head) => {
    if (head.querySelector("h2")?.textContent === "组织讨论") head.insertAdjacentHTML("beforeend", `<a class="mini-link" href="${organizationForumHref(organization.slug)}">主题论坛</a>`);
  });
  document.querySelector("#organizationJoinButton")?.addEventListener("click", async () => {
    try {
      const result = await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/join`, { method: "POST", body: "{}" });
      uiToast(result.membership.status === "active" ? "已加入协作组织" : "申请已提交，等待协调者批准");
      await renderOrganization(value);
    } catch (error) { uiAlert("无法加入", error.message, "error"); }
  });
  document.querySelectorAll("[data-community-claim]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/tasks/${button.dataset.communityClaim}/claim`, { method: "POST", body: "{}" }); uiToast("任务已认领"); await renderOrganization(value); } catch (error) { uiAlert("认领失败", error.message, "error"); }
  }));
  document.querySelectorAll("[data-community-task-status]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/tasks/${button.dataset.communityTaskId}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.communityTaskStatus }) }); await renderOrganization(value); } catch (error) { uiAlert("更新失败", error.message, "error"); }
  }));
  document.querySelector("#organizationTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector(".status-line"); status.textContent = "正在发布任务...";
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/tasks`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); uiToast("协作任务已发布"); await renderOrganization(value); } catch (error) { status.textContent = error.message; }
  });
  bindForumReferencePicker(document.querySelector("#organizationPostForm"));
  document.querySelectorAll("[data-community-post-reply]").forEach(bindForumReferencePicker);
  document.querySelector("#organizationPostForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector(".status-line"); status.textContent = "正在发布讨论...";
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/posts`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); uiToast("组织讨论已发布"); await renderOrganization(value); } catch (error) { status.textContent = error.message; }
  });
  document.querySelectorAll("[data-community-load-replies]").forEach((button) => button.addEventListener("click", () => loadCommunityPostReplies(button.dataset.communityLoadReplies)));
  document.querySelectorAll("[data-community-post-reply]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault(); const status = form.querySelector(".status-line"); status.textContent = "发送中...";
    try { await api(`/api/community/posts/${form.dataset.communityPostReply}/replies`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); form.reset(); status.textContent = "回复已发布。"; await loadCommunityPostReplies(form.dataset.communityPostReply); } catch (error) { status.textContent = error.message; }
  }));
  document.querySelectorAll("[data-community-post-status]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/posts/${button.dataset.communityPostId}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.communityPostStatus }) }); await renderOrganization(value); } catch (error) { uiAlert("更新失败", error.message, "error"); }
  }));
  document.querySelectorAll("[data-community-member-role]").forEach((select) => select.addEventListener("change", async () => {
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/members/${select.dataset.communityMemberRole}`, { method: "PUT", body: JSON.stringify({ role: select.value }) }); uiToast("成员角色已更新"); await renderOrganization(value); } catch (error) { uiAlert("更新失败", error.message, "error"); }
  }));
  document.querySelectorAll("[data-community-member-approve]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/members/${button.dataset.communityMemberApprove}`, { method: "PUT", body: JSON.stringify({ status: "active" }) }); uiToast("成员申请已批准"); await renderOrganization(value); } catch (error) { uiAlert("更新失败", error.message, "error"); }
  }));
  const changePage = (kind, next) => { const params = new URLSearchParams(parsed.params); params.set(kind, String(next)); location.hash = `#/organization/${encodeURIComponent(organization.slug)}?${params.toString()}`; };
  bindPagination(document.querySelector(".community-task-list")?.parentElement, (next) => changePage("tasks", next));
  bindPagination(document.querySelector(".community-post-list")?.parentElement, (next) => changePage("posts", next));
  bindPagination(document.querySelector(".organization-members-section"), (next) => changePage("members", next));
}

function organizationWorkspaceHref(slug, tab = "home", params = {}) {
  const query = new URLSearchParams();
  if (tab !== "home") query.set("tab", tab);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "" && !(key === "page" && Number(value) === 1)) query.set(key, String(value));
  });
  return `#/organization/${encodeURIComponent(slug)}${query.toString() ? `?${query.toString()}` : ""}`;
}

function organizationWorkspaceTabs(organization, active = "home", membership = null) {
  const tabs = [["home", "组织首页", "workspace"], ["tasks", "协作任务", "tasks"], ["forum", "学术论坛", "forum"], ["qa", "组织问答", "comments"], ["members", "成员", "members"]];
  if (canModerateOrganizationCommunity(membership)) tabs.push(["governance", "社区治理", "review"]);
  return `<nav class="organization-workspace-tabs" aria-label="组织工作区">${tabs.map(([id, label, icon]) => `<a class="${id === active ? "active" : ""}" href="${organizationWorkspaceHref(organization.slug, id)}" ${id === active ? 'aria-current="page"' : ""}>${navigationIconSvg(icon)}<span>${label}</span></a>`).join("")}</nav>`;
}

function organizationWorkspaceHeader(organization, membership, active, summary) {
  const membershipLabel = membership ? `你的身份：${organizationRoleLabel(membership.role)}${membership.status !== "active" ? "（待批准）" : ""}` : "公开浏览";
  const cover = organization.heroImage ? `<figure class="organization-cover"><img src="${escapeHtml(organization.heroImage)}" alt="${escapeHtml(organization.name)} 顶部图" /></figure>` : "";
  const chat = membership?.status === "active" ? `<a class="organization-chat-link" href="#/messages?organization=${encodeURIComponent(organization.slug)}">${navigationIconSvg("chat")}<span>组织群聊</span></a>` : "";
  return `<section class="organization-workspace-head">${cover}<header class="article-head organization-workspace-title"><div class="organization-workspace-kicker"><span class="system-kicker">Academic Workspace</span><span class="organization-workspace-actions"><span class="quality-badge">${escapeHtml(organization.visibility === "request" ? "申请加入" : "开放加入")}</span>${chat}</span></div><div class="article-title-row"><div class="organization-title-with-avatar">${organizationAvatarHtml(organization, "large")}<h1>${escapeHtml(organization.name)}</h1></div></div><p class="article-summary">${escapeHtml(summary || organization.description || "面向可持续维护的知识领域开展协作。")}</p><div class="organization-workspace-stats"><span>${organization.memberCount} 成员</span><span>${organization.taskCount} 项任务</span><span>${organization.discussionCount} 个主题</span><span>${escapeHtml(membershipLabel)}</span></div></header>${organizationWorkspaceTabs(organization, active, membership)}</section>`;
}

function organizationMemberCardHtml(member, options = {}) {
  const controls = options.canManage && member.status === "pending"
    ? `<button class="mini-button" type="button" data-workspace-member-approve="${member.userId}">批准加入</button>`
    : options.canManage && member.status === "active" && member.userId !== state.user?.id
      ? `<select data-workspace-member-role="${member.userId}"><option value="member" ${member.role === "member" ? "selected" : ""}>成员</option><option value="writer" ${member.role === "writer" ? "selected" : ""}>写作者</option><option value="translator" ${member.role === "translator" ? "selected" : ""}>译者</option><option value="reviewer" ${member.role === "reviewer" ? "selected" : ""}>审阅者</option><option value="coordinator" ${member.role === "coordinator" ? "selected" : ""}>协调者</option></select>`
      : "";
  const stateLabel = member.status === "pending" ? "待审核" : `加入 ${fmtDate(member.joinedAt)}`;
  return `<article class="workspace-member-card"><a href="#/user/${encodeURIComponent(member.username)}">${avatarHtml({ displayName: member.displayName, username: member.username, avatarUrl: member.avatarUrl }, "small")}<span><strong>${escapeHtml(member.displayName)}</strong><small>@${escapeHtml(member.username)}</small></span></a><div class="member-meta"><em>${escapeHtml(organizationRoleLabel(member.role))}</em><small>${stateLabel}</small></div><div class="member-controls">${controls || `<span class="member-state">${member.status === "pending" ? "等待审核" : "已激活"}</span>`}</div></article>`;
}

function bindOrganizationTaskWorkspace(organization, rerender) {
  bindPageSuggestions(document.querySelector("#organizationWorkspaceTaskForm input[name='pageSlug']"), { selectionMode: "value", limit: 8 });
  document.querySelectorAll("[data-community-claim]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/tasks/${button.dataset.communityClaim}/claim`, { method: "POST", body: "{}" }); uiToast("已认领协作任务"); await rerender(); } catch (error) { await uiAlert("认领失败", error.message, "error"); }
  }));
  document.querySelectorAll("[data-community-task-status]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/tasks/${button.dataset.communityTaskId}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.communityTaskStatus }) }); uiToast("任务状态已更新"); await rerender(); } catch (error) { await uiAlert("更新失败", error.message, "error"); }
  }));
  document.querySelector("#organizationWorkspaceTaskForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector(".status-line"); status.textContent = "正在发布任务...";
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/tasks`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); uiToast("协作任务已发布"); await rerender(); } catch (error) { status.textContent = error.message; }
  });
}

async function renderOrganizationHome(value) {
  const parsed = splitValueQuery(value);
  const detail = await api(`/api/community/organizations/${encodeURIComponent(parsed.pathValue)}`);
  const organization = detail.organization;
  const membership = detail.membership;
  const joinBlocked = Boolean(detail.quota && !detail.quota.canJoin);
  const activeMember = membership?.status === "active";
  const canManage = activeMember && ["owner", "coordinator"].includes(membership.role);
  setChromeTitle(organization.name);
  renderToc(organization.descriptionToc || []);
  el.editLink.href = "#/new";
  const about = organization.descriptionHtml || `<p>${escapeHtml(organization.description || "该组织尚未撰写介绍。")}</p>`;
  const ownerSettings = membership?.role === "owner" ? `<div class="organization-profile-options"><label class="organization-field"><span>加入方式</span><select name="visibility"><option value="public" ${organization.visibility === "public" ? "selected" : ""}>直接加入</option><option value="request" ${organization.visibility === "request" ? "selected" : ""}>申请加入</option></select></label><label class="organization-field"><span>审阅阈值</span><select name="reviewThreshold">${[2, 3, 4, 5].map((item) => `<option value="${item}" ${Number(organization.reviewThreshold) === item ? "selected" : ""}>${item} 位审阅者</option>`).join("")}</select></label></div>` : "";
  const editor = canManage ? `<details class="organization-management-panel"><summary><span><strong>管理组织资料</strong><small>编辑名称、图片、研究方向与公开介绍</small></span><span class="mini-link">展开编辑</span></summary><form class="organization-profile-editor" id="organizationProfileEditor"><div class="organization-editor-head"><span class="system-kicker">Coordinator Tools</span><h2>编辑组织首页</h2><p>填写组织资料并保存。</p></div><label class="organization-field"><span>组织名称</span><input name="name" maxlength="90" value="${escapeHtml(organization.name)}" required /></label><label class="organization-field"><span>简短说明</span><input name="description" maxlength="900" value="${escapeHtml(organization.description || "")}" placeholder="用于组织列表和搜索结果" /></label><label class="organization-field"><span>&#32452;&#32455;&#22836;&#20687; URL</span><input name="avatarImage" inputmode="url" maxlength="500" value="${escapeHtml(organization.avatarImage || "")}" placeholder="https://... &#25110; /uploads/..." /></label><label class="organization-field organization-field-wide"><span>组织顶部大图</span><input name="heroImage" type="url" maxlength="1000" value="${escapeHtml(organization.heroImage || "")}" placeholder="https://… 或 /uploads/…" /></label><label class="organization-field organization-field-wide"><span>研究方向</span><input name="focus" value="${escapeHtml((organization.focus || []).join(", "))}" placeholder="例如：抽象代数，群论，英文翻译" /></label><label class="organization-field organization-field-wide"><span>组织介绍 Markdown</span><textarea name="descriptionMd" rows="12" spellcheck="false">${escapeHtml(organization.descriptionMd || "")}</textarea></label>${ownerSettings}<div class="organization-editor-actions"><button class="command-button" type="submit">保存组织首页</button><p class="status-line"></p></div></form></details>` : "";
  el.main.innerHTML = `${organizationWorkspaceHeader(organization, membership, "home", organization.description || "组织介绍、成员身份与协作边界在这里公开维护。")}<section class="organization-home-layout"><article class="organization-home-intro"><header><span class="system-kicker">Organization Charter</span><h2>组织介绍</h2></header><article class="article-body" ${selectionContentAttributes({ type: "organization", id: organization.id || organization.slug, label: organization.name, url: organizationWorkspaceHref(organization.slug), organizationSlug: organization.slug })}>${about}</article></article><aside class="organization-basic-facts"><span class="system-kicker">Organization Facts</span><h2>基本信息</h2><dl><div><dt>创建者</dt><dd>${organization.founderUsername ? `<a href="#/user/${encodeURIComponent(organization.founderUsername)}">${escapeHtml(organization.founderName || organization.founderUsername)}</a>` : "未记录"}</dd></div><div><dt>研究方向</dt><dd>${(organization.focus || []).length ? organization.focus.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : "未设置"}</dd></div><div><dt>共识阈值</dt><dd>${organization.reviewThreshold} 位审阅者</dd></div><div><dt>创建时间</dt><dd>${fmtDate(organization.createdAt)}</dd></div></dl><div class="organization-primary-actions">${!membership && state.user ? `<button class="command-button" type="button" id="organizationHomeJoin" ${joinBlocked ? "disabled" : ""}>${joinBlocked ? "已达到 5 个组织上限" : "加入组织"}</button>` : ""}${!state.user ? '<a class="command-button" href="#/login">登录后加入</a>' : ""}<a class="command-button secondary" href="${organizationWorkspaceHref(organization.slug, "forum")}">进入学术论坛</a></div></aside></section>${editor}`;
  document.querySelector("#organizationHomeJoin")?.addEventListener("click", async () => {
    try { const joined = await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/join`, { method: "POST", body: "{}" }); uiToast(joined.membership.status === "active" ? "已加入组织" : "申请已提交，等待审核"); await renderOrganizationHome(value); } catch (error) { await uiAlert("加入失败", error.message, "error"); }
  });
  document.querySelector("#organizationProfileEditor")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector(".status-line"); status.textContent = "正在保存组织首页...";
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); uiToast("组织首页已保存"); await renderOrganizationHome(value); } catch (error) { status.textContent = error.message; }
  });
}

async function renderOrganizationTasks(value) {
  const parsed = splitValueQuery(value);
  const slug = parsed.pathValue;
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const query = parsed.params.get("q") || "";
  const status = parsed.params.get("status") || "all";
  const [detail, payload] = await Promise.all([
    api(`/api/community/organizations/${encodeURIComponent(slug)}`),
    api(`/api/community/organizations/${encodeURIComponent(slug)}/tasks?page=${page}&limit=10&q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`),
  ]);
  const organization = detail.organization; const membership = detail.membership;
  const canManage = membership?.status === "active" && ["owner", "coordinator"].includes(membership.role);
  const { items, pagination } = normalizedPaged(payload, page, 10);
  const href = (next = 1, values = {}) => organizationWorkspaceHref(organization.slug, "tasks", { page: next, q: query, status, ...values });
  setChromeTitle(`${organization.name} · 协作任务`); renderToc([]); el.editLink.href = "#/new";
  el.main.innerHTML = `${organizationWorkspaceHeader(organization, membership, "tasks", "筛选、认领并提交撰写、翻译或审阅任务。")}<section class="organization-workspace-grid organization-task-workspace"><section class="organization-tab-layout${items.length ? "" : " is-empty"}"><header class="workspace-section-head"><div><span class="system-kicker">Collaboration Queue</span><h2>协作任务</h2><p>筛选任务并跟进认领、审阅与完成状态。</p></div><span>${Number(pagination.total || 0)} 项</span></header><form class="organization-tab-filters" id="organizationTaskFilters"><label><span>检索任务</span><input name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索任务、词条或说明" /></label><label><span>状态</span><select name="status"><option value="all" ${status === "all" ? "selected" : ""}>全部状态</option><option value="open" ${status === "open" ? "selected" : ""}>待认领</option><option value="claimed" ${status === "claimed" ? "selected" : ""}>进行中</option><option value="ready" ${status === "ready" ? "selected" : ""}>待审阅</option><option value="closed" ${status === "closed" ? "selected" : ""}>已完成</option></select></label><button class="command-button" type="submit">筛选</button></form><div class="community-task-list workspace-task-list${items.length ? "" : " is-empty"}">${items.length ? items.map((task) => organizationTaskHtml(task, { manage: canManage })).join("") : '<section class="empty-state"><h2>暂无匹配任务</h2><p>协调者可在右侧发布首个任务。</p></section>'}</div>${paginationHtml(pagination, "协作任务")}</section><aside class="organization-side-stack">${canManage ? organizationTaskComposerHtml() : '<section class="organization-tab-note"><span class="system-kicker">Join The Work</span><h2>任务协作</h2><p>加入组织后即可认领开放任务。</p></section>'}</aside></section>`;
  document.querySelector("#organizationTaskFilters")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); location.hash = href(1, { q: form.get("q") || "", status: form.get("status") || "all" }); });
  bindOrganizationTaskWorkspace(organization, () => renderOrganizationTasks(value));
  bindPagination(el.main, (next) => { location.hash = href(next); });
}

function organizationTaskComposerHtml() {
  return `<form class="organization-task-form" id="organizationWorkspaceTaskForm"><header><span class="system-kicker">Coordinator Tool</span><h2>发布协作任务</h2><p>选择词条，填写任务目标并发布。</p></header><div class="organization-task-fields"><label class="organization-task-type-field"><span>类型</span><select name="taskType"><option value="write">撰写词条</option><option value="translate">翻译词条</option><option value="review">社区审阅</option></select></label><label class="organization-task-priority-field"><span>优先级</span><select name="priority"><option value="normal">常规</option><option value="high">高</option><option value="urgent">紧急</option></select></label><label class="organization-task-page-field"><span>关联词条</span><input name="pageSlug" required autocomplete="off" placeholder="输入标题或 slug 搜索词条" /></label><label class="organization-task-language-field"><span>目标语言</span><input name="language" placeholder="仅翻译任务填写，如 en" /></label></div><label><span>任务标题</span><input name="title" required placeholder="说明需要完成的工作" /></label><label><span>任务说明</span><textarea name="summary" rows="5" placeholder="列出范围、来源、审阅要求或交付标准"></textarea></label><button class="command-button" type="submit">发布任务</button><p class="status-line"></p></form>`;
}

async function renderOrganizationMembers(value) {
  const parsed = splitValueQuery(value); const slug = parsed.pathValue;
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const query = parsed.params.get("q") || "";
  const [detail, payload] = await Promise.all([
    api(`/api/community/organizations/${encodeURIComponent(slug)}`),
    api(`/api/community/organizations/${encodeURIComponent(slug)}/members?page=${page}&limit=16&q=${encodeURIComponent(query)}`),
  ]);
  const organization = detail.organization; const membership = detail.membership;
  const canManage = membership?.status === "active" && ["owner", "coordinator"].includes(membership.role);
  const { items, pagination } = normalizedPaged(payload, page, 16);
  setChromeTitle(`${organization.name} · 成员`); renderToc([]); el.editLink.href = "#/new";
  const href = (next, values = {}) => organizationWorkspaceHref(organization.slug, "members", { page: next, q: query, ...values });
  el.main.innerHTML = `${organizationWorkspaceHeader(organization, membership, "members", "搜索成员、查看申请并调整组织身份。")}<section class="organization-members-workspace"><header class="workspace-section-head"><div><span class="system-kicker">People</span><h2>成员与申请</h2><p>搜索成员并管理申请与身份。</p></div><span>${Number(pagination.total || 0)} 人</span></header><form class="organization-member-search" id="organizationMemberSearch"><label><span>检索成员</span><input name="q" type="search" value="${escapeHtml(query)}" placeholder="用户名、显示名或组织身份" /></label><button class="command-button" type="submit">搜索</button></form><div class="workspace-member-list">${items.length ? items.map((member) => organizationMemberCardHtml(member, { canManage })).join("") : '<section class="empty-state"><h2>没有匹配成员</h2><p>尝试使用用户名、显示名或组织身份重新搜索。</p></section>'}</div>${paginationHtml(pagination, "组织成员")}</section>`;
  document.querySelector("#organizationMemberSearch")?.addEventListener("submit", (event) => { event.preventDefault(); location.hash = href(1, { q: new FormData(event.currentTarget).get("q") || "" }); });
  document.querySelectorAll("[data-workspace-member-approve]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/members/${button.dataset.workspaceMemberApprove}`, { method: "PUT", body: JSON.stringify({ status: "active" }) }); uiToast("成员申请已批准，身份已同步通知"); await renderOrganizationMembers(value); } catch (error) { await uiAlert("审批失败", error.message, "error"); }
  }));
  document.querySelectorAll("[data-workspace-member-role]").forEach((select) => select.addEventListener("change", async () => {
    try { await api(`/api/community/organizations/${encodeURIComponent(organization.slug)}/members/${select.dataset.workspaceMemberRole}`, { method: "PUT", body: JSON.stringify({ role: select.value }) }); uiToast("组织身份已更新并通知成员"); await renderOrganizationMembers(value); } catch (error) { await uiAlert("更新失败", error.message, "error"); }
  }));
  bindPagination(el.main, (next) => { location.hash = href(next); });
}

async function renderOrganizationQa(value) {
  const parsed = splitValueQuery(value);
  const detail = await api(`/api/community/organizations/${encodeURIComponent(parsed.pathValue)}`);
  const organization = detail.organization;
  const membership = detail.membership;
  setChromeTitle(`${organization.name} · 组织问答`);
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `${organizationWorkspaceHeader(organization, membership, "qa", "围绕组织维护的知识领域提问、回答并沉淀结论。")}<section id="organizationQaWorkspace"></section>`;
  const params = new URLSearchParams(parsed.params);
  params.delete("tab");
  params.set("organization", organization.slug);
  await communityQaController(document.querySelector("#organizationQaWorkspace"), {
    embedded: true,
    organization,
    routeBase: organizationWorkspaceHref(organization.slug, "qa"),
  }).render(`?${params.toString()}`);
}

async function renderOrganizationGovernance(value) {
  const parsed = splitValueQuery(value);
  const detail = await api(`/api/community/organizations/${encodeURIComponent(parsed.pathValue)}`);
  const organization = detail.organization;
  const membership = detail.membership;
  if (!canModerateOrganizationCommunity(membership)) {
    const error = new Error("需要本组织的社区审核权限。");
    error.statusCode = 403;
    throw error;
  }
  const queue = parsed.params.get("queue") === "reviews" ? "reviews" : "reports";
  const status = parsed.params.get("status") || "pending";
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const limit = 12;
  const payload = await api(`/api/community/qa/moderation/${queue}?organizationId=${Number(organization.id)}&status=${encodeURIComponent(status)}&page=${page}&limit=${limit}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const isReports = queue === "reports";
  const statuses = isReports
    ? [["pending", "待处理"], ["resolved", "已处理"], ["dismissed", "已驳回"]]
    : [["pending", "待审核"], ["approved", "已通过"], ["rejected", "已拒绝"]];
  const queueHref = (nextQueue, nextPage = 1, nextStatus = "pending") => organizationWorkspaceHref(organization.slug, "governance", { queue: nextQueue, page: nextPage, status: nextStatus });
  const cards = items.length ? items.map((item) => {
    const actor = isReports ? item.reporter : item.requester;
    const stateLabel = ({ pending: "待处理", resolved: "已处理", dismissed: "已驳回", approved: "已通过", rejected: "已拒绝" })[item.status] || item.status;
    const actions = item.status === "pending"
      ? isReports
        ? `<button class="mini-button" type="button" data-organization-report-decision="resolved">确认处理</button><button class="mini-button danger" type="button" data-organization-report-decision="dismissed">驳回</button>`
        : `<button class="mini-button" type="button" data-organization-review-decision="approved">通过</button><button class="mini-button danger" type="button" data-organization-review-decision="rejected">拒绝</button>`
      : `<span class="community-moderation-resolution">${escapeHtml(item.resolution || item.reason || stateLabel)}</span>`;
    return `<article class="community-moderation-card" data-community-report-id="${isReports ? escapeHtml(item.id) : ""}" data-community-review-id="${isReports ? "" : escapeHtml(item.id)}"><div class="community-moderation-card-main">${communityModerationObjectHtml(item)}<dl><div><dt>${isReports ? "举报原因" : "审核类型"}</dt><dd>${escapeHtml(isReports ? item.reason : item.queueType || "内容修订")}</dd></div><div><dt>提交者</dt><dd>${escapeHtml(actor?.displayName || actor?.username || "社区成员")}</dd></div><div><dt>状态</dt><dd>${escapeHtml(stateLabel)}</dd></div><div><dt>提交时间</dt><dd>${fmtDate(item.createdAt)}</dd></div></dl>${item.details ? `<p>${escapeHtml(item.details)}</p>` : ""}</div><footer>${actions}</footer></article>`;
  }).join("") : `<section class="empty-state"><h2>${isReports ? "没有符合条件的举报" : "没有符合条件的修订"}</h2><p>新的治理事项会进入这里。</p></section>`;
  setChromeTitle(`${organization.name} · 社区治理`);
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `${organizationWorkspaceHeader(organization, membership, "governance", "处理本组织问答的举报与社区修订。")}
    <section class="organization-governance-workspace">
      <nav class="organization-governance-tabs" aria-label="社区治理队列"><a class="${isReports ? "active" : ""}" href="${queueHref("reports")}">举报队列</a><a class="${!isReports ? "active" : ""}" href="${queueHref("reviews")}">修订审核</a></nav>
      <form class="organization-governance-filter" id="organizationGovernanceFilter"><label><span>状态</span><select name="status">${statuses.map(([id, label]) => `<option value="${id}" ${status === id ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="command-button" type="submit">筛选</button></form>
      <div class="community-moderation-list">${cards}</div>${paginationHtml(pagination, isReports ? "组织举报" : "组织修订")}
    </section>`;
  document.querySelector("#organizationGovernanceFilter")?.addEventListener("submit", (event) => {
    event.preventDefault();
    location.hash = queueHref(queue, 1, String(new FormData(event.currentTarget).get("status") || "pending"));
  });
  document.querySelectorAll("[data-organization-report-decision]").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest("[data-community-report-id]");
    const resolution = await uiPrompt({ title: button.dataset.organizationReportDecision === "resolved" ? "确认处理举报" : "驳回举报", text: "填写处理结论并通知举报者。", placeholder: "处理结论", confirmText: "提交决定" });
    if (resolution === null) return;
    try { await api(`/api/community/qa/moderation/reports/${encodeURIComponent(card.dataset.communityReportId)}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.organizationReportDecision, resolution }) }); await uiToast("举报已处理"); await renderOrganizationGovernance(value); } catch (error) { await uiAlert("处理失败", error.message, "error"); }
  }));
  document.querySelectorAll("[data-organization-review-decision]").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest("[data-community-review-id]");
    const opinion = await uiPrompt({ title: button.dataset.organizationReviewDecision === "approved" ? "通过修订" : "拒绝修订", text: "填写审核意见并通知提交者。", placeholder: "审核意见", confirmText: "提交决定" });
    if (opinion === null) return;
    try { await api(`/api/community/qa/moderation/reviews/${encodeURIComponent(card.dataset.communityReviewId)}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.organizationReviewDecision, opinion }) }); await uiToast("审核决定已保存"); await renderOrganizationGovernance(value); } catch (error) { await uiAlert("审核失败", error.message, "error"); }
  }));
  bindPagination(el.main, (next) => { location.hash = queueHref(queue, next, status); });
}

async function renderOrganization(value) {
  const parsed = splitValueQuery(value);
  const tab = parsed.params.get("tab") || "home";
  if (tab === "forum") return renderOrganizationForum(value);
  if (tab === "tasks") return renderOrganizationTasks(value);
  if (tab === "qa") return renderOrganizationQa(value);
  if (tab === "members") return renderOrganizationMembers(value);
  if (tab === "governance") return renderOrganizationGovernance(value);
  return renderOrganizationHome(value);
}

async function renderPage(value) {
  const parsed = splitValueQuery(value);
  const requestedLang = normalizeLanguageCode(parsed.params.get("lang"), "");
  const preferredLang = requestedLang || normalizeLanguageCode(state.uiLanguage || state.site?.language, "zh-CN");
  state.currentSlug = parsed.pathValue || state.site.defaultPage || "home";
  renderNav();
  el.editLink.href = `#/edit/${encodeSlug(state.currentSlug)}`;
  try {
    const page = await api(`/api/pages/${encodeSlug(state.currentSlug)}`);
    if (!page || typeof page !== "object" || !page.slug || typeof page.html !== "string") {
      const missingPage = new Error(`未找到词条“${state.currentSlug}”。`);
      missingPage.statusCode = 404;
      missingPage.code = "page_not_found";
      throw missingPage;
    }
    state.currentSlug = page.slug;
    el.editLink.href = `#/edit/${encodeSlug(page.slug)}`;
    renderNav();
    if (page.slug === (state.site.defaultPage || "home")) {
      renderHomePortal(page);
      typesetMath();
      return;
    }
    let displayPage = page;
    let activeLang = "zh-CN";
    let translationNotice = "";
    if (preferredLang && preferredLang !== "zh-CN") {
      activeLang = preferredLang;
      const payload = await api(`/api/pages/${encodeSlug(page.slug)}/translation?lang=${encodeURIComponent(preferredLang)}`).catch(() => null);
      const translation = payload?.translation;
      if (translation?.html) {
        activeLang = translation.language || preferredLang;
        displayPage = {
          ...page,
          title: translation.title || page.title,
          summary: translation.summary || page.summary,
          html: translation.html,
          toc: translation.toc || [],
          language: activeLang,
          translationProgress: translation.progress,
          status: translation.status || page.status,
          author: translation.translatorName || page.author,
          authorDisplayName: translation.translatorName || page.authorDisplayName || page.author,
          authorUsername: translation.translatorUsername || page.authorUsername || "",
          updatedAt: translation.updatedAt || page.updatedAt,
        };
      } else {
        translationNotice = `<section class="translation-missing-note"><strong>${escapeHtml(languageLabel(preferredLang))} 译文尚未发布。</strong><span>当前显示源词条。你可以进入翻译工作台创建该语言版本。</span><a href="#/translate/${encodeSlug(page.slug)}?lang=${encodeURIComponent(preferredLang)}">创建译文</a></section>`;
      }
    }
    state.pageLanguage = activeLang;
    setChromeTitle(displayPage.title);
    renderToc(displayPage.toc);
    const aliasNotice = page.redirectedFrom ? `<aside class="knowledge-alias-notice"><strong>已通过别名跳转</strong><span>${escapeHtml(page.redirectedFrom)} → ${escapeHtml(page.slug)}</span></aside>` : "";
    const selectionObjectType = activeLang === "zh-CN" ? "wiki_entry" : "translation";
    const selectionObjectId = activeLang === "zh-CN" ? page.slug : `${page.slug}:${activeLang}`;
    const selectionObjectUrl = `#/page/${encodeSlug(page.slug)}${activeLang !== "zh-CN" ? `?lang=${encodeURIComponent(activeLang)}` : ""}`;
    el.main.innerHTML = `${pageToolNav(page.slug, "page")}${aliasNotice}${articleHeader(displayPage)}${disambiguationPanelHtml(page)}${pageReviewStatusHtml(page)}${citationQualityPanelHtml(page)}${mathematicalMetadataHtml(page)}${translationNotice}<section class="page-translation-panel" id="pageTranslationPanel"></section><article class="article-body" ${selectionContentAttributes({ type: selectionObjectType, id: selectionObjectId, label: displayPage.title, url: selectionObjectUrl, pageSlug: page.slug })}>${displayPage.html}</article><section id="pageKnowledgePanel"></section><section id="pageQaPanel"></section><section id="pageCommunityPanel"></section><section class="page-rating-panel" id="pageRatingPanel"></section><section class="edit-timeline-section"><div class="section-title-row"><h2>最近编辑</h2><a class="mini-link" href="#/history/${encodeSlug(page.slug)}">查看全部</a></div><div class="edit-timeline" id="pageEditTimeline"></div></section>`;
    bindArticleSectionShortcuts();
    await Promise.all([loadPageTranslations(page.slug, activeLang), loadPageFavorite(page.slug), loadPageWatch(page.slug), loadPageKnowledge(page.slug), loadPageQuestions(page), loadPageCommunity(page.slug), loadPageRating(page.slug), loadPageEdits(page.slug, "pageEditTimeline", { limit: 6, page: 1 })]);
    typesetMath();
  } catch (error) {
    if (state.currentSlug === (state.site.defaultPage || "home")) {
      renderHomePortal({
        slug: state.currentSlug,
        title: state.site.name || "Wikist",
        summary: "",
        html: "",
        toc: [],
      });
      typesetMath();
      return;
    }
    if (Number(error?.statusCode || 0) === 404) {
      renderToc([]);
      setChromeTitle("404");
      error.code = "page_not_found";
      error.message = `未找到词条“${state.currentSlug}”。`;
      renderError(error);
      return;
    }
    throw error;
  }
}

async function renderHistory(slug) {
  const page = await api(`/api/pages/${encodeSlug(slug)}`).catch(() => ({ slug, title: slug, summary: "" }));
  state.currentSlug = page.slug || slug;
  setChromeTitle(`${page.title} 的编辑记录`);
  renderToc([]);
  el.editLink.href = `#/edit/${encodeSlug(state.currentSlug)}`;
  el.main.innerHTML = `${pageToolNav(state.currentSlug, "history")}<header class="article-head"><h1>编辑记录</h1><p class="article-summary">查看 ${escapeHtml(page.title)} 的编辑者、时间与变更记录。</p></header><section class="edit-timeline history-timeline" id="historyTimeline"></section>`;
  await loadPageEdits(state.currentSlug, "historyTimeline", { limit: 12, page: 1 });
}

function linkCommentMentions(html) {
  return String(html || "").replace(/(^|[\s>])@([a-z0-9_-]{3,30})(?=\b)/g, (match, prefix, username) => {
    return `${prefix}<a class="mention-link" href="#/user/${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`;
  });
}

function commentAvatarHtml(comment) {
  const user = {
    displayName: comment.authorName || "访客",
    username: comment.authorUsername || "guest",
    avatarUrl: comment.authorAvatarUrl || "",
  };
  const avatar = avatarHtml(user, "small");
  if (comment.authorType === "user" && comment.authorUsername) {
    return `<a class="comment-avatar-link" href="#/user/${encodeURIComponent(comment.authorUsername)}" aria-label="查看 ${escapeHtml(comment.authorName || comment.authorUsername)} 的用户主页">${avatar}</a>`;
  }
  return `<span class="comment-avatar-link is-guest">${avatar}</span>`;
}

function commentAuthorHtml(comment) {
  const authorName = comment.authorName || "访客";
  if (comment.authorType === "user" && comment.authorUsername) {
    const href = `#/user/${encodeURIComponent(comment.authorUsername)}`;
    return `<span class="comment-author-link"><a href="${href}"><strong>${escapeHtml(authorName)}</strong></a><a href="${href}"><small>@${escapeHtml(comment.authorUsername)}</small></a></span>`;
  }
  return `<span class="comment-author-link"><strong>${escapeHtml(authorName)} · 访客</strong></span>`;
}

function canDeleteCommentClient(comment) {
  if (canAccessAdmin()) return true;
  return Boolean(state.user && comment.authorType === "user" && Number(comment.userId || 0) === Number(state.user.id || 0));
}

function commentHtml(comment, options = {}) {
  const isReply = Boolean(options.reply);
  const locked = Boolean(options.locked);
  const rootId = Number(options.rootId || comment.parentId || comment.id);
  const authorName = comment.authorName || "访客";
  const replyCount = Number(comment.replyCount || 0);
  const replyButton = locked ? "" : `<button type="button" class="mini-button ghost" data-reply-comment="${comment.id}" data-root-comment="${rootId}" data-reply-author="${escapeHtml(authorName)}">${isReply ? `回复 @${escapeHtml(authorName)}` : "回复"}</button>`;
  const deleteButton = canDeleteCommentClient(comment) ? `<button type="button" class="mini-button danger ghost" data-delete-comment="${comment.id}" data-root-comment="${rootId}" data-comment-reply="${isReply ? "1" : "0"}">删除</button>` : "";
  const loadReplies = !isReply && replyCount > 0 ? `<button type="button" class="mini-button ghost" data-load-replies="${comment.id}" data-reply-count="${replyCount}">展开 ${replyCount} 条回复</button>` : "";
  return `
    <article class="comment-item ${isReply ? "comment-reply" : ""}" data-comment-id="${comment.id}" data-root-id="${rootId}" data-author="${escapeHtml(authorName)}">
      <div class="comment-shell">
        ${commentAvatarHtml(comment)}
        <div class="comment-main">
          <header><span>${commentAuthorHtml(comment)}<small class="comment-depth-label">${isReply ? "二级回复" : "一级评论"}</small></span><small>${fmtDate(comment.createdAt)}</small></header>
          <div class="article-body comment-body">${linkCommentMentions(comment.contentHtml || "")}</div>
          <div class="comment-actions">${replyButton}${deleteButton}${loadReplies}</div>
          <div class="comment-reply-slot"></div>
          ${isReply ? "" : `<div class="comment-replies" id="commentReplies-${comment.id}" data-replies-for="${comment.id}"></div>`}
        </div>
      </div>
    </article>`;
}

function commentReplyFormHtml({ rootId, parentId, authorName }) {
  return `
    <form class="auth-panel compact comment-form inline-comment-form" data-comment-reply-form data-root-id="${rootId}">
      <input type="hidden" name="parentId" value="${parentId}" />
      ${guestFields("回复")}
      <label>回复 @${escapeHtml(authorName || "访客")}<textarea name="content" class="profile-markdown" required placeholder="输入回复内容；@ 成员会收到站内信。"></textarea></label>
      <div class="editor-actions"><button class="command-button" type="submit">发布回复</button><button class="command-button secondary" type="button" data-cancel-reply>取消</button></div>
      <div class="status-line"></div>
    </form>`;
}

async function submitCommentForm(form, slug, rootId = null) {
  const status = form.querySelector(".status-line") || document.querySelector("#commentStatus");
  const payload = Object.fromEntries(new FormData(form).entries());
  if (status) status.textContent = "正在发布...";
  try {
    await api(`/api/pages/${encodeSlug(slug)}/comments`, { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    if (status) status.textContent = rootId ? "回复已发布。" : "评论已发布。";
    if (rootId) await loadCommentReplies(slug, rootId, 1);
    else await loadComments(slug, 1);
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

function bindCommentInteractions(slug) {
  const target = document.querySelector("#commentList");
  if (!target || target.dataset.bound === "1") return;
  target.dataset.bound = "1";
  target.addEventListener("click", async (event) => {
    const userLink = event.target.closest(".comment-author-link a, a.comment-avatar-link, a.mention-link");
    const href = userLink?.getAttribute("href") || "";
    if (href.startsWith("#/user/")) {
      event.preventDefault();
      location.hash = href;
      return;
    }
    const deleteButton = event.target.closest("[data-delete-comment]");
    if (deleteButton) {
      const id = Number(deleteButton.dataset.deleteComment);
      const rootId = Number(deleteButton.dataset.rootComment || id);
      const isReply = deleteButton.dataset.commentReply === "1";
      deleteButton.disabled = true;
      deleteButton.textContent = "删除中...";
      try {
        await api(`/api/pages/${encodeSlug(slug)}/comments/${id}`, { method: "DELETE", body: "{}" });
        if (isReply) await loadCommentReplies(slug, rootId, 1);
        else await loadComments(slug, 1);
      } catch (error) {
        deleteButton.disabled = false;
        deleteButton.textContent = error.message;
      }
      return;
    }
    const cancel = event.target.closest("[data-cancel-reply]");
    if (cancel) {
      cancel.closest(".comment-reply-slot").innerHTML = "";
      return;
    }
    const loadButton = event.target.closest("[data-load-replies]");
    if (loadButton) {
      const rootId = Number(loadButton.dataset.loadReplies);
      const box = document.querySelector(`#commentReplies-${rootId}`);
      const count = Number(loadButton.dataset.replyCount || 0);
      if (box?.dataset.loaded === "1") {
        const collapsed = box.classList.toggle("is-collapsed");
        loadButton.textContent = collapsed ? `展开 ${count} 条回复` : "折叠回复";
        return;
      }
      loadButton.textContent = "正在展开...";
      await loadCommentReplies(slug, rootId, 1);
      loadButton.textContent = "折叠回复";
      return;
    }
    const replyButton = event.target.closest("[data-reply-comment]");
    if (replyButton) {
      if (target.dataset.commentsLocked === "1") return;
      const item = replyButton.closest(".comment-item");
      const slot = item.querySelector(".comment-reply-slot");
      if (slot.innerHTML.trim()) {
        slot.innerHTML = "";
        return;
      }
      target.querySelectorAll(".comment-reply-slot").forEach((otherSlot) => { otherSlot.innerHTML = ""; });
      const rootId = Number(replyButton.dataset.rootComment || item.dataset.rootId || replyButton.dataset.replyComment);
      const parentId = Number(replyButton.dataset.replyComment);
      const authorName = replyButton.dataset.replyAuthor || item.dataset.author || "访客";
      slot.innerHTML = commentReplyFormHtml({ rootId, parentId, authorName });
      slot.querySelector("textarea")?.focus();
    }
  });
  target.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-comment-reply-form]");
    if (!form) return;
    event.preventDefault();
    await submitCommentForm(form, slug, Number(form.dataset.rootId));
  });
}

function guestFields(kind) {
  if (state.user) return "";
  return `
    <div class="guest-fields">
      <label>访客昵称<input name="guestName" required placeholder="例如：Sean" /></label>
      <label>邮箱<input name="guestEmail" type="email" required placeholder="仅用于记录与反滥用" /></label>
      <label>网站<input name="guestWebsite" placeholder="可选" /></label>
    </div>
    <p class="muted-line">访客${kind}需填写昵称与邮箱，提交后将记录基本访问信息。</p>
  `;
}

async function renderComments(slug) {
  const page = await api(`/api/pages/${encodeSlug(slug)}`).catch(() => ({ slug, title: slug, summary: "" }));
  const permissions = await api(`/api/pages/${encodeSlug(slug)}/permissions`).catch(() => ({ commentPolicy: "guest" }));
  state.currentSlug = page.slug || slug;
  setChromeTitle(`${page.title} 的评论`);
  renderToc([]);
  el.editLink.href = `#/edit/${encodeSlug(state.currentSlug)}`;
  const locked = permissions.commentPolicy === "locked" || (permissions.commentPolicy === "user" && !state.user);
  el.main.innerHTML = `
    ${pageToolNav(state.currentSlug, "comments")}
    <header class="article-head"><h1>评论</h1><p class="article-summary">查看 ${escapeHtml(page.title)} 的讨论，并按当前权限参与评论。</p></header>
    <section class="comments-layout">
      <div class="comment-list" id="commentList" data-comments-locked="${locked ? "1" : "0"}"></div>
      <form class="auth-panel compact comment-form" id="commentForm">
        <h2>发表评论</h2>
        ${locked ? '<p class="muted-line">当前权限不允许你发表评论。</p>' : `${guestFields("评论")}<label>内容<textarea name="content" class="profile-markdown" required placeholder="支持 Markdown 与数学公式"></textarea></label><button class="command-button" type="submit">发布评论</button>`}
        <div class="status-line" id="commentStatus"></div>
      </form>
    </section>
  `;
  consumeSelectionDraft("comment", document.querySelector("#commentForm textarea[name='content']"));
  bindCommentInteractions(state.currentSlug);
  await loadComments(state.currentSlug, 1);
  if (!locked) {
    document.querySelector("#commentForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitCommentForm(event.currentTarget, state.currentSlug, null);
    });
  }
}

async function loadCommentReplies(slug, rootId, page = 1, limit = 6) {
  const box = document.querySelector(`#commentReplies-${rootId}`);
  if (!box) return;
  const locked = document.querySelector("#commentList")?.dataset.commentsLocked === "1";
  box.classList.remove("is-collapsed");
  box.innerHTML = '<p class="muted-line">正在加载回复...</p>';
  const payload = await api(`/api/pages/${encodeSlug(slug)}/comments/${rootId}/replies?page=${page}&limit=${limit}`).catch(() => ({ items: [], pagination: { page, pageSize: limit, total: 0, totalPages: 1 } }));
  const { items, pagination } = normalizedPaged(payload, page, limit);
  box.dataset.loaded = "1";
  box.innerHTML = items.length
    ? `<div class="reply-stack">${items.map((item) => commentHtml(item, { reply: true, rootId, locked })).join("")}</div>${paginationHtml(pagination, "回复")}`
    : '<p class="muted-line">暂无回复。</p>';
  bindPagination(box, (nextPage) => loadCommentReplies(slug, rootId, nextPage, limit));
  typesetMath();
}

async function loadComments(slug, page = 1, limit = 8) {
  const target = document.querySelector("#commentList");
  if (!target) return;
  const locked = target.dataset.commentsLocked === "1";
  const payload = await api(`/api/pages/${encodeSlug(slug)}/comments?page=${page}&limit=${limit}`).catch(() => ({ items: [], pagination: { page, pageSize: limit, total: 0, totalPages: 1 } }));
  const { items, pagination } = normalizedPaged(payload, page, limit);
  target.innerHTML = items.length
    ? `${items.map((item) => commentHtml(item, { locked })).join("")}${paginationHtml(pagination, "评论")}`
    : '<p class="muted-line">暂无评论。</p>';
  bindPagination(target, (nextPage) => loadComments(slug, nextPage, limit));
  typesetMath();
}

const TRANSLATION_LABELS = COMMON_LANGUAGE_LABELS;

function splitValueQuery(value) {
  const raw = String(value || "");
  const [pathValue, query = ""] = raw.split("?");
  return { pathValue, params: new URLSearchParams(query) };
}

function translationInfo(translations = [], lang = "zh-CN") {
  const normalized = normalizeLanguageCode(lang, "zh-CN");
  const found = (translations || []).find((item) => normalizeLanguageCode(item.language, "") === normalized);
  if (found) return found;
  if (normalized === "zh-CN") return { language: "zh-CN", status: "source", progress: 100 };
  return { language: normalized, status: "missing", progress: 0 };
}

function translationLanguageItems(translations = [], activeLang = "zh-CN") {
  const byLang = new Map((translations || []).map((item) => [normalizeLanguageCode(item.language, ""), item]));
  return supportedLanguages([activeLang, ...(translations || []).map((item) => item.language)])
    .map((lang) => byLang.get(lang) || translationInfo(translations, lang));
}

function languageModeHref(slug, lang, mode = "read") {
  const normalized = normalizeLanguageCode(lang, "zh-CN");
  if (mode === "edit" && normalized === "zh-CN") return `#/page/${encodeSlug(slug)}`;
  if (mode === "edit") return `#/translate/${encodeSlug(slug)}?lang=${encodeURIComponent(normalized)}`;
  return `#/page/${encodeSlug(slug)}${normalized !== "zh-CN" ? `?lang=${encodeURIComponent(normalized)}` : ""}`;
}

function translationBadges(translations = [], activeLang = "en", slug = state.currentSlug, mode = "edit") {
  const active = normalizeLanguageCode(activeLang, "zh-CN");
  return `<div class="translation-badges">${translationLanguageItems(translations, active).map((item) => {
    const lang = normalizeLanguageCode(item.language, "");
    const status = item.status === "missing" ? "未翻译" : `${Number(item.progress || 0)}%`;
    return `<a class="${lang === active ? "active" : ""} ${item.status === "missing" ? "missing" : ""}" href="${languageModeHref(slug, lang, mode)}"><strong>${escapeHtml(languageLabel(lang))}</strong><span>${escapeHtml(status)}</span></a>`;
  }).join("")}</div>`;
}

function languageJumpForm(slug, mode = "read") {
  return `<form class="language-add-form" data-language-jump="${escapeHtml(mode)}" data-language-slug="${escapeHtml(slug)}"><input name="language" placeholder="添加语言：fr / ja / de-DE" autocomplete="off" /><button class="mini-button" type="submit">打开</button></form>`;
}

function bindLanguageJumpForms(root = document) {
  root.querySelectorAll("form[data-language-jump]").forEach((form) => {
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const language = normalizeLanguageCode(new FormData(form).get("language"), "");
      if (!language) {
        form.querySelector("input")?.focus();
        return;
      }
      location.hash = languageModeHref(form.dataset.languageSlug || state.currentSlug, language, form.dataset.languageJump || "read");
    });
  });
}

function updateTranslationProgress(value) {
  const progress = Math.max(0, Math.min(100, Number(value) || 0));
  const textTarget = document.querySelector("#translationProgressText");
  const barTarget = document.querySelector("#translationProgressBar");
  if (textTarget) textTarget.textContent = `${progress}%`;
  if (barTarget) barTarget.style.width = `${progress}%`;
}

function translationQualityPanel(assistant, activeLang) {
  if (!assistant) return "";
  const changes = assistant.sourceChanges || {};
  const status = changes.hasChanges
    ? `<strong>源文已更新</strong><span>有 ${Number(changes.changedCount || 0)} 个段落差异，建议复核后再提交译文。</span>`
    : `<strong>${changes.previousSegmentCount ? "源文保持一致" : "首次建立译文"}</strong><span>${changes.previousSegmentCount ? "当前源文与译文一致。" : "发布译文后可用于术语建议。"}</span>`;
  const memory = (assistant.memory || []).map((item) => `
    <button class="translation-suggestion" type="button" data-translation-insert="memory" data-translation-text="${escapeHtml(item.targetText)}">
      <span class="translation-suggestion-kicker">已审阅记忆 · ${escapeHtml(item.pageSlug)}</span>
      <strong>${escapeHtml(item.targetText)}</strong>
      <small>${escapeHtml(item.sourceText)}</small>
    </button>`).join("");
  const glossary = (assistant.glossary || []).map((item) => `
    <button class="translation-suggestion glossary" type="button" data-translation-insert="glossary" data-translation-text="${escapeHtml(item.targetTerm)}">
      <span class="translation-suggestion-kicker">术语 · ${escapeHtml(item.sourceTerm)}</span>
      <strong>${escapeHtml(item.targetTerm)}${item.notation ? ` <em>${escapeHtml(item.notation)}</em>` : ""}</strong>
      ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
    </button>`).join("");
  const changed = (changes.changedSegments || []).map((item) => `<li><b>段落 ${item.index}</b>${escapeHtml(item.preview)}</li>`).join("");
  return `
    <aside class="translation-quality-panel ${changes.hasChanges ? "has-changes" : "is-current"}">
      <header><div><span class="system-kicker">Translation Quality</span><h2>译文辅助</h2></div><a class="mini-link" href="#/translation-glossary?source=${encodeURIComponent(assistant.sourceLanguage || "zh-CN")}&target=${encodeURIComponent(activeLang)}">术语表</a></header>
      <div class="translation-quality-status">${status}</div>
      ${changed ? `<details class="translation-change-details"><summary>查看源文变更</summary><ul>${changed}</ul></details>` : ""}
      ${memory ? `<section class="translation-suggestion-group"><h3>翻译记忆</h3>${memory}</section>` : ""}
      ${glossary ? `<section class="translation-suggestion-group"><h3>命中术语</h3>${glossary}</section>` : ""}
      ${!memory && !glossary ? '<p class="muted-line quality-empty">尚无可用建议；通过审核的译文会在这里逐步积累。</p>' : ""}
    </aside>`;
}

function insertTranslationSuggestion(value) {
  const textarea = document.querySelector("#translationForm textarea[name=translatedMd]");
  if (!textarea || !value) return;
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const insert = `${before && !/\s$/.test(before) ? " " : ""}${value}`;
  textarea.value = `${before}${insert}${after}`;
  textarea.focus();
  textarea.setSelectionRange(start + insert.length, start + insert.length);
  document.querySelector("#translationStatus").textContent = "已插入建议，请结合上下文校订后保存。";
}

async function renderTranslationStart(slug) {
  const page = await api(`/api/pages/${encodeSlug(slug)}`);
  const payload = await api(`/api/pages/${encodeSlug(page.slug)}/translations`).catch(() => ({ translations: [], translator: null }));
  const languages = supportedLanguages([
    ...(payload.translations || []).map((item) => item.language),
    ...(payload.translator?.languages || []),
    state.uiLanguage,
    "en",
    "zh-TW",
  ]).filter((language) => normalizeLanguageCode(language, "") !== "zh-CN");
  state.currentSlug = page.slug;
  setChromeTitle(`${page.title} · 选择翻译语言`);
  renderToc([]);
  el.editLink.href = `#/edit/${encodeSlug(page.slug)}`;
  el.main.innerHTML = `
    ${pageToolNav(page.slug, "translate")}
    <header class="article-head translation-select-head"><span class="system-kicker">Translation Community</span><div class="article-title-row"><h1>选择翻译语言</h1><span class="quality-badge">${escapeHtml(page.title)}</span></div><p class="article-summary">选择语言后查看译文，或进入翻译工作台。</p></header>
    <section class="translation-language-chooser">
      <div class="translation-language-chooser-grid">
        ${languages.map((language) => {
          const item = translationInfo(payload.translations || [], language);
          const status = item.status === "missing" ? "新建译文" : item.sourceChanged ? "源文已变更" : `${Number(item.progress || 0)}%`;
          return `<a class="translation-language-choice ${item.status === "missing" ? "missing" : ""}" href="#/translate/${encodeSlug(page.slug)}?lang=${encodeURIComponent(language)}"><span>${escapeHtml(languageLabel(language))}</span><strong>${escapeHtml(status)}</strong><small>${item.status === "published" ? "已发布版本" : item.status === "review" ? "等待审阅" : item.status === "changes_requested" ? "需要修改" : "进入工作台"}</small></a>`;
        }).join("")}
      </div>
      <form class="translation-language-custom" id="translationLanguageCustom"><label><span>其他语言</span><input name="language" placeholder="例如：fr / ja / de-DE" autocomplete="off" /></label><button class="command-button" type="submit">进入翻译</button></form>
    </section>`;
  document.querySelector("#translationLanguageCustom")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const language = normalizeLanguageCode(new FormData(event.currentTarget).get("language"), "");
    if (!language || language === "zh-CN") { event.currentTarget.querySelector("input")?.focus(); return; }
    location.hash = `#/translate/${encodeSlug(page.slug)}?lang=${encodeURIComponent(language)}`;
  });
}

async function renderTranslation(value) {
  const parsed = splitValueQuery(value);
  const slug = parsed.pathValue || state.currentSlug || state.site.defaultPage || "home";
  if (!parsed.params.get("lang")) {
    await renderTranslationStart(slug);
    return;
  }
  const lang = parsed.params.get("lang") || "en";
  const payload = await api(`/api/pages/${encodeSlug(slug)}/translation?lang=${encodeURIComponent(lang)}&workspace=1`);
  const source = payload.source || {};
  const translation = payload.translation || {};
  state.currentSlug = source.slug || slug;
  setChromeTitle(`${source.title || slug} 翻译`);
  renderToc([]);
  el.editLink.href = `#/edit/${encodeSlug(state.currentSlug)}`;
  const activeLang = normalizeLanguageCode(translation.language || lang, "en");
  const translatedMd = translation.translatedMd || "";
  const qualityPanel = translationQualityPanel(payload.assistant, activeLang);
  const communityPanel = translation.id ? communityReviewPanel(payload.community, "translation", state.currentSlug, activeLang) : "";
  const joinNotice = payload.translator ? "" : `<div class="translation-join-box"><p>加入翻译社区后可以保存译文和生成自动初稿。</p><button class="command-button" type="button" id="joinTranslationFromPage">加入翻译社区</button></div>`;
  const editorReadOnly = !payload.translator;
  const editorDisabled = editorReadOnly ? "disabled" : "";
  const progress = Math.max(0, Math.min(100, Number(translation.progress || 0)));
  const translationState = ({ published: "已发布", review: "待审", changes_requested: "待修改", draft: "草稿" })[translation.status] || "草稿";
  const reviewControls = canReviewContent() && translation.id ? `<div class="translation-review-actions"><button class="command-button" type="button" data-translation-review="approve">通过并发布</button><button class="command-button secondary" type="button" data-translation-review="changes_requested">要求修改</button></div>` : "";
  el.main.innerHTML = `
    ${pageToolNav(state.currentSlug, "translate")}
    <header class="article-head translation-head">
      <div class="article-title-row"><h1>${escapeHtml(source.title || state.currentSlug)} · 翻译</h1><span class="quality-badge">${escapeHtml(languageLabel(activeLang))}</span></div>
      <p class="article-summary">对照源文编辑译文，并保存当前进度。</p>
      <div class="translation-route-controls">
        ${translationBadges(payload.translations || [], activeLang, state.currentSlug, "edit")}
        ${languageJumpForm(state.currentSlug, "edit")}
      </div>
    </header>
    ${joinNotice}
    <section class="translation-workspace-shell ${qualityPanel ? "has-quality" : ""}">
      <header class="translation-workspace-bar">
        <div><span class="system-kicker">Translation Workspace</span><strong>双栏翻译工作台</strong><small>同步校订标题、摘要与正文</small></div>
        <div class="translation-progress" aria-label="翻译完成度">
          <span>完成度</span><strong id="translationProgressText">${progress}%</strong>
          <i><b id="translationProgressBar" style="width:${progress}%"></b></i>
        </div>
      </header>
      <div class="translation-workbench">
        <article class="translation-pane translation-source-pane">
          <header class="translation-pane-head">
            <div><span class="translation-language-dot source"></span><div><strong>源词条</strong><small>简体中文 · ${fmtDate(source.updatedAt)}</small></div></div>
            <div class="segmented-control" role="group" aria-label="源文显示方式">
              <button class="active" type="button" data-source-view="preview">阅读</button>
              <button type="button" data-source-view="markdown">Markdown</button>
            </div>
          </header>
          <div class="translation-source-scroll">
            <article class="article-body translation-source-preview" id="translationSourcePreview" ${selectionContentAttributes({ type: "wiki_entry", id: source.slug || state.currentSlug, label: source.title || state.currentSlug, url: `#/page/${encodeSlug(source.slug || state.currentSlug)}`, pageSlug: source.slug || state.currentSlug })}>${source.html || "<p>" + escapeHtml(source.body || "") + "</p>"}</article>
            <pre class="translation-source-code" id="translationSourceCode" hidden>${escapeHtml(source.body || "")}</pre>
          </div>
        </article>
        <form class="translation-pane translation-editor" id="translationForm">
          <header class="translation-pane-head">
            <div><span class="translation-language-dot target"></span><div><strong>译文 · ${escapeHtml(languageLabel(activeLang))}</strong><small>${translationState}</small></div></div>
          </header>
          <input type="hidden" name="language" value="${escapeHtml(activeLang)}" />
          <div class="translation-meta-fields">
            <label class="translation-field"><span>译文标题</span><input name="title" value="${escapeHtml(translation.title || source.title || "")}" ${editorDisabled} /></label>
            <label class="translation-field"><span>译文摘要</span><textarea name="summary" rows="3" ${editorDisabled}>${escapeHtml(translation.summary || source.summary || "")}</textarea></label>
          </div>
          <label class="translation-field translation-body-field"><span>正文 Markdown</span><textarea name="translatedMd" class="profile-markdown translation-textarea" spellcheck="false" placeholder="输入译文正文" ${editorDisabled}>${escapeHtml(translatedMd)}</textarea></label>
          <footer class="translation-editor-footer">
            <div class="status-line" id="translationStatus" aria-live="polite"></div>
            <div class="editor-actions">
              ${editorReadOnly ? '<span class="translation-readonly-note">当前以审阅身份查看草稿，可提交投票与意见。</span>' : '<button class="command-button secondary" type="button" id="autoTranslateButton">自动生成初稿</button><button class="command-button" type="submit">保存译文</button>'}
            </div>
          </footer>
          ${translation.reviewComment ? `<aside class="translation-review-note"><strong>${escapeHtml(translation.reviewerName || "审核意见")}</strong><span>${escapeHtml(translation.reviewComment)}</span></aside>` : ""}
          ${reviewControls}
        </form>
      </div>
      ${qualityPanel}
    </section>
    ${communityPanel}`;

  document.querySelectorAll("[data-source-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const showMarkdown = button.dataset.sourceView === "markdown";
      document.querySelector("#translationSourcePreview").hidden = showMarkdown;
      document.querySelector("#translationSourceCode").hidden = !showMarkdown;
      document.querySelectorAll("[data-source-view]").forEach((item) => item.classList.toggle("active", item === button));
    });
  });
  document.querySelector("#joinTranslationFromPage")?.addEventListener("click", async () => {
    try {
      await api("/api/passport/translation/join", { method: "POST", body: JSON.stringify({ languages: [activeLang] }) });
      await refreshUser();
      await renderTranslation(`${state.currentSlug}?lang=${activeLang}`);
    } catch (error) {
      document.querySelector(".translation-join-box p").textContent = error.message;
    }
  });
  document.querySelector("#autoTranslateButton")?.addEventListener("click", async () => {
    const status = document.querySelector("#translationStatus");
    status.textContent = "正在生成初稿...";
    try {
      const result = await api(`/api/pages/${encodeSlug(state.currentSlug)}/translation/auto`, { method: "POST", body: JSON.stringify({ language: activeLang }) });
      const draft = result.draft || {};
      const form = document.querySelector("#translationForm");
      form.elements.title.value = draft.title || form.elements.title.value;
      form.elements.summary.value = draft.summary || form.elements.summary.value;
      form.elements.translatedMd.value = draft.translatedMd || "";
      updateTranslationProgress(draft.progress);
      status.textContent = "初稿已生成，请校订后保存。";
      uiToast("初稿已生成", "info");
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelectorAll("[data-translation-insert]").forEach((button) => {
    button.addEventListener("click", () => {
      insertTranslationSuggestion(button.dataset.translationText || "");
      uiToast("已插入翻译建议", "info");
    });
  });
  document.querySelector("#translationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#translationStatus");
    status.textContent = "正在保存译文...";
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const saved = await api(`/api/pages/${encodeSlug(state.currentSlug)}/translation`, { method: "PUT", body: JSON.stringify(body) });
      status.textContent = `译文已保存，翻译度 ${saved.translation.progress}%。`;
      uiToast("译文已保存");
      updateTranslationProgress(saved.translation.progress);
      document.querySelector(".translation-head .translation-badges").outerHTML = translationBadges(saved.translations || [], saved.translation.language, state.currentSlug, "edit");
      bindLanguageJumpForms(document.querySelector(".translation-head"));
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelectorAll("[data-translation-review]").forEach((button) => {
    button.addEventListener("click", async () => {
      const decision = button.dataset.translationReview;
      const comment = await uiPrompt({ title: decision === "approve" ? "通过译文" : "要求修改", text: "可填写简短审核意见。", placeholder: "审核意见", confirmText: decision === "approve" ? "通过并发布" : "提交意见" });
      if (comment === null) return;
      const status = document.querySelector("#translationStatus");
      status.textContent = "正在提交译文审核...";
      try {
        const reviewed = await api(`/api/pages/${encodeSlug(state.currentSlug)}/translation/${encodeURIComponent(activeLang)}/review`, { method: "POST", body: JSON.stringify({ decision, comment }) });
        status.textContent = reviewed.translation.status === "published" ? "译文已审核通过并发布。" : "已要求译者修改。";
        uiToast(status.textContent);
        window.setTimeout(() => renderTranslation(`${state.currentSlug}?lang=${encodeURIComponent(activeLang)}`).catch(renderError), 250);
      } catch (error) {
        status.textContent = error.message;
      }
    });
  });
  bindCommunityReviewForms(el.main, () => renderTranslation(`${state.currentSlug}?lang=${encodeURIComponent(activeLang)}`));
  typesetMath();
  bindLanguageJumpForms(el.main);
}

async function renderTranslationGlossary(value) {
  const parsed = splitValueQuery(value);
  const sourceLanguage = normalizeLanguageCode(parsed.params.get("source") || "zh-CN", "zh-CN");
  const targetLanguage = normalizeLanguageCode(parsed.params.get("target") || "en", "en");
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const query = parsed.params.get("q") || "";
  const staff = canReviewContent();
  const endpoint = `/api/translation-glossary?source=${encodeURIComponent(sourceLanguage)}&target=${encodeURIComponent(targetLanguage)}&page=${page}&limit=16&q=${encodeURIComponent(query)}${staff ? "&status=all" : ""}`;
  const payload = await api(endpoint);
  const { items, pagination } = normalizedPaged(payload, page, 16);
  const languageOptions = supportedLanguages([sourceLanguage, targetLanguage]).map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(languageLabel(language))}</option>`).join("");
  setChromeTitle("翻译术语表");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `
    <header class="article-head translation-glossary-head">
      <span class="system-kicker">Translation Community</span>
      <div class="article-title-row"><h1>翻译术语表</h1><span class="quality-badge">${pagination.total || 0} 条</span></div>
      <p class="article-summary">查看推荐术语，或维护当前语言方向的术语表。</p>
    </header>
    <section class="translation-glossary-toolbar" aria-label="术语筛选">
      <form id="translationGlossaryFilters">
        <label><span>源语言</span><select name="sourceLanguage">${languageOptions}</select></label>
        <label><span>目标语言</span><select name="targetLanguage">${languageOptions}</select></label>
        <label class="translation-glossary-search"><span>检索术语</span><input name="q" value="${escapeHtml(query)}" placeholder="原词、译法、记法或说明" /></label>
        <button class="command-button" type="submit">筛选</button>
      </form>
    </section>
    <section class="translation-glossary-layout ${staff ? "has-editor" : ""}">
      <div class="translation-glossary-list">
        ${items.length ? items.map((item) => `
          <article class="translation-glossary-item ${item.status === "inactive" ? "is-inactive" : ""}">
            <div class="translation-glossary-term"><span>${escapeHtml(item.sourceTerm)}</span><b>→</b><strong>${escapeHtml(item.targetTerm)}</strong>${item.notation ? `<em>${escapeHtml(item.notation)}</em>` : ""}</div>
            <div class="translation-glossary-copy">${item.note ? escapeHtml(item.note) : "未附加说明。"}</div>
            <footer>${item.discouragedTerms?.length ? `<span>避免：${escapeHtml(item.discouragedTerms.join("、"))}</span>` : "<span>推荐术语</span>"}<small>${item.status === "inactive" ? "已停用" : "当前生效"}</small>${staff ? `<button class="text-action" type="button" data-glossary-edit="${item.id}">编辑</button><button class="text-action danger-text" type="button" data-glossary-delete="${item.id}">删除</button>` : ""}</footer>
          </article>`).join("") : '<p class="muted-line translation-glossary-empty">这个语言方向还没有术语记录。</p>'}
        ${paginationHtml(pagination, "术语表")}
      </div>
      ${staff ? `
        <aside class="translation-glossary-editor">
          <header><span class="system-kicker">Curate Glossary</span><h2>维护术语</h2><p>填写术语与译法并保存。</p></header>
          <form id="translationGlossaryForm">
            <div class="translation-glossary-language-pair">
              <label><span>源语言</span><select name="sourceLanguage">${languageOptions}</select></label>
              <label><span>目标语言</span><select name="targetLanguage">${languageOptions}</select></label>
            </div>
            <label><span>原术语</span><input name="sourceTerm" required maxlength="180" placeholder="例如：群" /></label>
            <label><span>推荐译法</span><input name="targetTerm" required maxlength="180" placeholder="例如：group" /></label>
            <label><span>记法（可选）</span><input name="notation" maxlength="180" placeholder="例如：G" /></label>
            <label><span>说明（可选）</span><textarea name="note" rows="4" maxlength="1200" placeholder="适用的上下文或译法说明"></textarea></label>
            <label><span>避免使用（逗号分隔）</span><input name="discouragedTerms" maxlength="800" placeholder="例如：grouping" /></label>
            <label><span>状态</span><select name="status"><option value="active">生效</option><option value="inactive">停用</option></select></label>
            <div class="translation-glossary-actions"><button class="command-button" type="submit">保存术语</button><button class="command-button secondary" type="reset">清空</button></div>
            <p class="status-line" id="translationGlossaryStatus"></p>
          </form>
        </aside>` : ""}
    </section>`;
  const filterForm = document.querySelector("#translationGlossaryFilters");
  filterForm.elements.sourceLanguage.value = sourceLanguage;
  filterForm.elements.targetLanguage.value = targetLanguage;
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    location.hash = `#/translation-glossary?source=${encodeURIComponent(form.get("sourceLanguage"))}&target=${encodeURIComponent(form.get("targetLanguage"))}&q=${encodeURIComponent(form.get("q") || "")}`;
  });
  bindPagination(el.main, (nextPage) => {
    location.hash = `#/translation-glossary?source=${encodeURIComponent(sourceLanguage)}&target=${encodeURIComponent(targetLanguage)}&q=${encodeURIComponent(query)}&page=${nextPage}`;
  });
  if (staff) {
    const form = document.querySelector("#translationGlossaryForm");
    const status = document.querySelector("#translationGlossaryStatus");
    form.elements.sourceLanguage.value = sourceLanguage;
    form.elements.targetLanguage.value = targetLanguage;
    const itemById = new Map(items.map((item) => [String(item.id), item]));
    document.querySelectorAll("[data-glossary-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = itemById.get(button.dataset.glossaryEdit);
        if (!item) return;
        form.elements.sourceLanguage.value = item.sourceLanguage;
        form.elements.targetLanguage.value = item.targetLanguage;
        form.elements.sourceTerm.value = item.sourceTerm;
        form.elements.targetTerm.value = item.targetTerm;
        form.elements.notation.value = item.notation || "";
        form.elements.note.value = item.note || "";
        form.elements.discouragedTerms.value = (item.discouragedTerms || []).join(", ");
        form.elements.status.value = item.status || "active";
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    document.querySelectorAll("[data-glossary-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = itemById.get(button.dataset.glossaryDelete);
        if (!item || !await uiConfirm({ title: "删除术语", text: `确认删除“${item.sourceTerm} → ${item.targetTerm}”吗？`, danger: true, confirmText: "删除" })) return;
        try {
          await api(`/api/translation-glossary/${item.id}`, { method: "DELETE" });
          uiToast("术语已删除");
          await renderTranslationGlossary(value);
        } catch (error) {
          uiAlert("删除失败", error.message, "error");
        }
      });
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "正在保存术语...";
      try {
        await api("/api/translation-glossary", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        uiToast("术语已保存");
        status.textContent = "术语已保存。";
        await renderTranslationGlossary(`${parsed.pathValue}?source=${encodeURIComponent(form.elements.sourceLanguage.value)}&target=${encodeURIComponent(form.elements.targetLanguage.value)}`);
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
}

async function renderPermissions(slug) {
  const page = await api(`/api/pages/${encodeSlug(slug)}`).catch(() => ({ slug, title: slug }));
  const permissions = await api(`/api/pages/${encodeSlug(slug)}/permissions`);
  state.currentSlug = page.slug || slug;
  setChromeTitle(`${page.title} 的权限`);
  renderToc([]);
  el.editLink.href = `#/edit/${encodeSlug(state.currentSlug)}`;
  const disabled = !canManageContent();
  const deleteLocked = permissions.deletePolicy === "locked" || !canManageContent();
  el.main.innerHTML = `
    ${pageToolNav(state.currentSlug, "permissions")}
    <header class="article-head permission-page-head"><h1>权限</h1><p class="article-summary">控制 ${escapeHtml(page.title)} 的编辑、评论与删除策略。</p></header>
    <section class="permission-workbench">
      <form class="auth-panel permission-panel" id="permissionForm">
        <div class="permission-panel-head"><div><span class="system-kicker">Access Control</span><h2>访问策略</h2></div><span class="permission-panel-state">${disabled ? "只读" : "可管理"}</span></div>
        <p class="muted-line">选择谁可以编辑、评论和删除词条。</p>
        <div class="permission-policy-grid">
          <label><span>编辑权限</span><select name="editPolicy" ${disabled ? "disabled" : ""}>${policyOptions(permissions.editPolicy)}</select></label>
          <label><span>评论权限</span><select name="commentPolicy" ${disabled ? "disabled" : ""}>${policyOptions(permissions.commentPolicy)}</select></label>
          <label><span>删除权限</span><select name="deletePolicy" ${disabled ? "disabled" : ""}>${deletePolicyOptions(permissions.deletePolicy || "user")}</select></label>
        </div>
        <div class="permission-panel-actions">${disabled ? '<p class="muted-line">仅资深编辑和管理员可修改权限。</p>' : '<button class="command-button" type="submit">保存权限</button>'}</div>
        <div class="status-line" id="permissionStatus"></div>
      </form>
      <form class="auth-panel move-page-panel" id="movePageForm">
        <div class="permission-panel-head"><div><span class="system-kicker">Article Identity</span><h2>移动 / 重命名</h2></div><span class="permission-panel-state">${escapeHtml(state.currentSlug)}</span></div>
        <p class="muted-line">移动后将保留相关记录；可让旧地址重定向到新词条。</p>
        ${disabled ? '<p class="muted-line">只有资深编辑和管理员可以移动词条。</p>' : `<div class="move-page-fields"><label>新 slug<input name="targetSlug" placeholder="例如 abstract-algebra/group-theory" autocomplete="off" required /></label><label class="editor-toggle"><input type="checkbox" name="leaveRedirect" checked /><span>保留旧 slug 重定向</span></label></div><div class="permission-panel-actions"><button class="command-button" type="submit">移动词条</button></div>`}
        <div class="status-line" id="movePageStatus"></div>
      </form>
      <form class="auth-panel danger-panel" id="deleteForm">
        <div class="permission-panel-head"><div><span class="system-kicker">Archive Action</span><h2>归档并删除词条</h2></div><span class="permission-panel-state danger">不可逆入口</span></div>
        <p class="muted-line">删除后词条进入归档，可由后台恢复。</p>
        ${disabled ? '<p class="muted-line">只有资深编辑和管理员可以删除词条。</p>' : deleteLocked ? '<p class="muted-line">当前删除权限不允许执行此操作。</p>' : `<div class="delete-page-fields"><label>确认 slug<input name="confirmSlug" placeholder="${escapeHtml(state.currentSlug)}" autocomplete="off" required /></label><button class="command-button danger" type="submit">归档并删除</button></div>`}
        <div class="status-line" id="deleteStatus"></div>
      </form>
    </section>
  `;
  if (!disabled) {
    document.querySelector("#permissionForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#permissionStatus");
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      status.textContent = "正在保存...";
      try {
        await api(`/api/pages/${encodeSlug(state.currentSlug)}/permissions`, { method: "PUT", body: JSON.stringify(payload) });
        status.textContent = "权限已保存。";
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
  if (!disabled && !deleteLocked) {
    document.querySelector("#deleteForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#deleteStatus");
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      status.textContent = "正在归档并删除...";
      try {
        await api(`/api/pages/${encodeSlug(state.currentSlug)}`, { method: "DELETE", body: JSON.stringify(payload) });
        await refreshChrome();
        status.textContent = "词条已归档删除。";
        setTimeout(() => { location.hash = `#/page/${encodeSlug(state.site.defaultPage)}`; }, 450);
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
  if (!disabled) {
    document.querySelector("#movePageForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#movePageStatus");
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.leaveRedirect = form.elements.leaveRedirect?.checked !== false;
      const accepted = await uiConfirm({ title: "移动词条", text: `将 ${state.currentSlug} 移动至 ${payload.targetSlug}，并自动修复受影响的链接与协作数据。`, confirmText: "确认移动" });
      if (!accepted) return;
      status.textContent = "正在迁移词条与知识链接...";
      try {
        const result = await api(`/api/pages/${encodeSlug(state.currentSlug)}/move`, { method: "POST", body: JSON.stringify(payload) });
        await refreshChrome();
        const moved = result.moved || {};
        status.textContent = `已移动至 ${moved.targetSlug}，修复 ${Number(moved.rewritten?.length || 0)} 个词条引用。`;
        await uiAlert("词条已移动", status.textContent, "success");
        location.hash = `#/page/${encodeSlug(moved.targetSlug)}`;
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
}

function policyOptions(active) {
  const labels = { guest: "允许访客", user: "仅登录用户", locked: "锁定" };
  return Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === active ? "selected" : ""}>${label}</option>`).join("");
}
function deletePolicyOptions(active) {
  const safeActive = active === "locked" ? "locked" : "user";
  const labels = { user: "资深编辑可删除", locked: "禁止删除" };
  return Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === safeActive ? "selected" : ""}>${label}</option>`).join("");
}
function parseSearchState(value = "") {
  const raw = String(value || "");
  const splitAt = raw.indexOf("?");
  const term = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  const params = new URLSearchParams(splitAt >= 0 ? raw.slice(splitAt + 1) : "");
  return {
    q: term === "_" ? "" : term.trim(),
    page: Math.max(1, Number(params.get("page")) || 1),
    mode: params.get("mode") || "balanced",
    category: params.get("category") || "",
    quality: params.get("quality") || "",
    difficulty: params.get("difficulty") || "",
  };
}

function searchHash(options = {}) {
  const q = String(options.q || "").trim();
  const params = new URLSearchParams();
  if (Number(options.page || 1) > 1) params.set("page", String(Math.max(1, Number(options.page) || 1)));
  if (options.mode && options.mode !== "balanced") params.set("mode", options.mode);
  if (options.category) params.set("category", options.category);
  if (options.quality) params.set("quality", options.quality);
  if (options.difficulty) params.set("difficulty", options.difficulty);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `#/search/${q ? encodeURIComponent(q) : ""}${suffix}`;
}

function searchSelect(name, current, options) {
  return `<select name="${name}">${options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function searchResultHtml(item, index) {
  const score = Math.max(1, Math.round(Number(item.score || 0)));
  return `<a class="result-item search-result-card" href="#/page/${encodeSlug(item.slug)}" style="--result-index:${index + 1}">
    <div class="search-result-rank">${index + 1}</div>
    <div class="search-result-body">
      <h2>${escapeHtml(item.title)}</h2>
      <p>${escapeHtml(item.snippet || item.summary || "")}</p>
      <div class="chip-row">
        <span class="chip">相关度 ${score}</span>
        <span class="chip">质量 ${escapeHtml(item.quality || "C")}</span>
        ${item.difficulty ? `<span class="chip">${escapeHtml(item.difficulty)}</span>` : ""}
        ${(item.categories || []).slice(0, 4).map((category) => `<span class="chip">${escapeHtml(category)}</span>`).join("")}
      </div>
    </div>
  </a>`;
}

function communitySearchResultHtml(item, index) {
  const labels = { question: "问题", answer: "回答", user: "用户", organization: "组织" };
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const detail = item.type === "user"
    ? `@${metadata.username || item.key || ""}`
    : item.type === "organization"
      ? metadata.slug || "协作组织"
      : item.type === "answer"
        ? (metadata.accepted ? "已采纳回答" : "社区回答")
        : `${Number(metadata.answerCount || 0)} 个回答`;
  return `<a class="result-item search-result-card community-search-result" href="${escapeHtml(item.url || "#/questions")}" style="--result-index:${index + 1}">
    <div class="search-result-rank">${index + 1}</div>
    <div class="search-result-body">
      <h2>${escapeHtml(item.title || item.key || "社区知识")}</h2>
      <p>${escapeHtml(item.summary || detail)}</p>
      <div class="chip-row"><span class="chip">${escapeHtml(labels[item.type] || item.type || "知识对象")}</span><span class="chip">${escapeHtml(detail)}</span></div>
    </div>
  </a>`;
}

function facetLinks(facets, searchState) {
  const categories = facets?.categories || [];
  if (!categories.length) return "";
  return `<div class="search-facets"><strong>快速分类</strong>${categories.map((item) => `<a href="${searchHash({ ...searchState, category: item.name, page: 1 })}">${escapeHtml(item.name)}<small>${item.count}</small></a>`).join("")}</div>`;
}

async function renderSearch(value) {
  const searchState = parseSearchState(value);
  const q = searchState.q;
  setChromeTitle(q ? `搜索 ${q}` : "搜索");
  renderToc([]);
  el.editLink.href = "#/new";

  const params = new URLSearchParams({
    q,
    page: String(searchState.page),
    limit: "10",
    mode: searchState.mode,
    category: searchState.category,
    quality: searchState.quality,
    difficulty: searchState.difficulty,
  });
  const emptySearch = { items: [], total: 0, engine: "wikist-mini", facets: {}, pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasPrev: false, hasNext: false } };
  const [payload, qaPayload] = await Promise.all([
    (q || searchState.category || searchState.quality || searchState.difficulty)
      ? api(`/api/search?${params.toString()}`)
      : Promise.resolve(emptySearch),
    q
      ? api(`/api/community/qa/search?q=${encodeURIComponent(q)}&page=1&limit=8`).catch(() => ({ items: [], total: 0 }))
      : Promise.resolve({ items: [], total: 0 }),
  ]);
  const { items, pagination } = normalizedPaged(payload, searchState.page, 10);
  const qaItems = Array.isArray(qaPayload.items) ? qaPayload.items : [];
  const qaTotal = Math.max(0, Number(qaPayload.total) || 0);
  const combinedTotal = Math.max(0, Number(payload.total) || 0) + qaTotal;
  const activeFilters = [searchState.category, searchState.quality, searchState.difficulty].filter(Boolean);
  el.main.innerHTML = `
    <header class="article-head search-head">
      <div>
        <p class="system-kicker">Wikist Search</p>
        <h1>搜索知识库</h1>
        <p class="article-summary">搜索是 wiki 的入口。支持标题、正文、分类、质量和难度联合检索，并可用 <code>title:</code>、<code>category:</code>、<code>quality:</code> 等高级语法。</p>
      </div>
      <form class="search-page-form" id="searchPageForm">
        <div class="search-page-main">
          <input name="q" type="search" value="${escapeHtml(q)}" autocomplete="off" placeholder="搜索概念、定理、符号或英文术语" autofocus />
          <button class="command-button" type="submit">搜索</button>
        </div>
        <div class="search-advanced-grid">
          <label>模式${searchSelect("mode", searchState.mode, [["balanced", "综合"], ["title", "标题优先"], ["content", "正文优先"]])}</label>
          <label>分类<input name="category" value="${escapeHtml(searchState.category)}" placeholder="例如：代数" /></label>
          <label>质量${searchSelect("quality", searchState.quality, [["", "不限"], ["A", "A"], ["B", "B"], ["C", "C"], ["Draft", "草稿"]])}</label>
          <label>难度<input name="difficulty" value="${escapeHtml(searchState.difficulty)}" placeholder="入门 / 本科 / 专题" /></label>
        </div>
      </form>
    </header>
    <section class="search-overview">
      <div><strong>${combinedTotal}</strong><span>全部结果</span></div>
      <div><strong>${Number(payload.total || 0)}</strong><span>词条与页面</span></div>
      <div><strong>${qaTotal}</strong><span>社区知识</span></div>
      <div><strong>${escapeHtml(payload.engine || "wikist-mini")}</strong><span>搜索引擎</span></div>
      <div><strong>${activeFilters.length || "无"}</strong><span>高级筛选</span></div>
    </section>
    ${facetLinks(payload.facets, searchState)}
    <section class="search-results refined-search-results">
      ${items.length ? items.map(searchResultHtml).join("") : `<div class="empty-state"><h2>${q || activeFilters.length ? (qaItems.length ? "词条中没有匹配结果" : "没有匹配结果") : "输入关键词开始搜索"}</h2><p class="muted-line">可以尝试标题、英文术语、分类名，或使用 title:、category:、quality: 进行高级搜索。</p></div>`}
    </section>
    ${paginationHtml(pagination, "词条搜索结果")}
    ${q ? `<section class="search-qa-results"><header class="section-title-row"><div><span class="system-kicker">Wikist Community</span><h2>社区知识</h2><p class="muted-line">问题、回答、用户和协作组织统一检索。</p></div>${qaTotal > qaItems.length ? `<a class="mini-link" href="#/questions?q=${encodeURIComponent(q)}">查看社区问答</a>` : ""}</header><div class="search-results refined-search-results">${qaItems.length ? qaItems.map((item, index) => communitySearchResultHtml(item, index)).join("") : '<div class="qa-empty-state compact"><h2>没有匹配的社区内容</h2><p>可以围绕这个关键词发起新问题。</p></div>'}</div></section>` : ""}`;
  bindPageSuggestions(document.querySelector("#searchPageForm input[name='q']"), { limit: 10 });
  document.querySelector("#searchPageForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    location.hash = searchHash({
      q: data.get("q") || "",
      mode: data.get("mode") || "balanced",
      category: data.get("category") || "",
      quality: data.get("quality") || "",
      difficulty: data.get("difficulty") || "",
      page: 1,
    });
  });
  bindPagination(el.main, (nextPage) => {
    location.hash = searchHash({ ...searchState, page: nextPage });
  });
}
function canManageEditorAliases() {
  return ["creator", "editor", "senior_editor", "admin"].includes(String(state.user?.role || ""));
}

function disambiguationTargetsText(targets = []) {
  return (targets || []).map((target) => [target.slug, target.label || target.slug, target.summary || ""].join(" | ")).join("\n");
}

function editorKnowledgeFields(page = {}) {
  const aliasFields = canManageEditorAliases() ? `
    <details class="editor-disclosure wide">
      <summary><span><strong>别名与重定向</strong><small>添加别名，或将本页指向另一词条。</small></span></summary>
      <div class="editor-knowledge-body">
        <label>别名 / 可访问入口<input name="aliases" value="${escapeHtml((page.aliases || []).join(", "))}" placeholder="例如：group-theory, groups" /></label>
        <label>重定向目标 slug<input name="redirectTarget" value="${escapeHtml(page.redirectTarget || "")}" placeholder="例如：abstract-algebra/group" /></label>
      </div>
    </details>` : "";
  return `
    ${aliasFields}
    <details class="editor-disclosure wide">
      <summary><span><strong>多义词与消歧</strong><small>一个标题对应多个概念时，读者会看到明确的指向列表。</small></span></summary>
      <div class="editor-knowledge-body">
        <label class="editor-toggle"><input type="checkbox" name="disambiguation" ${page.isDisambiguation ? "checked" : ""} /><span>这是一个消歧页</span></label>
        <label class="editor-field-wide">消歧指向<textarea name="disambiguationTargets" rows="4" placeholder="slug | 显示名称 | 简短说明">${escapeHtml(disambiguationTargetsText(page.disambiguationTargets))}</textarea></label>
      </div>
    </details>
    <details class="editor-disclosure wide">
      <summary><span><strong>数学知识元数据</strong><small>可选字段会写入 Markdown front matter，用于知识导航、前置依赖和专业分类。</small></span></summary>
      <div class="editor-knowledge-body">
      <div class="editor-metadata-grid">
        <label>主题路径<input name="topic" value="${escapeHtml(page.topic || "")}" placeholder="例如：数学/代数/群论" /></label>
        <label>规范名称<input name="canonicalNames" value="${escapeHtml((page.canonicalNames || []).join(", "))}" placeholder="中文名、英文名或常用别称" /></label>
        <label>前置词条 slug<input name="prerequisites" value="${escapeHtml((page.prerequisites || []).join(", "))}" placeholder="例如：set, binary-operation" /></label>
        <label>相关词条 slug<input name="relatedPages" value="${escapeHtml((page.relatedPages || []).join(", "))}" placeholder="例如：group-action, ring-theory" /></label>
        <label>MSC / ACM 等分类<input name="classifications" value="${escapeHtml((page.classifications || []).join(", "))}" placeholder="例如：20A05, 20-XX" /></label>
        <label class="wide">记号约定<textarea name="notation" rows="3" placeholder="G | 群 | 全文&#10;H | G 的子群 | 定理部分">${escapeHtml((page.notation || []).map((item) => [item.symbol, item.meaning, item.scope].filter(Boolean).join(" | ")).join("\n"))}</textarea></label>
      </div>
      </div>
    </details>`;
}

const REFERENCE_TYPES = [["article", "期刊论文"], ["book", "专著"], ["chapter", "书籍章节"], ["preprint", "预印本"], ["conference", "会议论文"], ["thesis", "学位论文"], ["web", "网页"], ["dataset", "数据集"], ["other", "其他"]];

function referenceTypeOptions(type = "article") {
  return REFERENCE_TYPES.map(([value, label]) => `<option value="${value}" ${value === type ? "selected" : ""}>${label}</option>`).join("");
}

function citationReferenceRowLegacy(reference = {}, index = 0) {
  const authors = Array.isArray(reference.authors) ? reference.authors.join("; ") : (reference.authors || "");
  return `<article class="citation-editor-row" data-citation-row="${index}">
    <div class="citation-editor-row-head"><strong>来源记录</strong><div><button class="icon-button" type="button" data-insert-citation title="插入正文引用" aria-label="插入正文引用"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8M8 12h8M8 16h5M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg></button><button class="icon-button danger-icon" type="button" data-remove-citation title="移除来源" aria-label="移除来源"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div></div>
    <label>引用键<input data-citation-field="id" value="${escapeHtml(reference.id || "")}" placeholder="例如 hardy1908" /></label>
    <label>类型<select data-citation-field="type">${referenceTypeOptions(reference.type || "article")}</select></label>
    <label class="citation-span-2">作者<input data-citation-field="authors" value="${escapeHtml(authors)}" placeholder="多个作者用分号分隔" /></label>
    <label class="citation-span-2">题名<input data-citation-field="title" value="${escapeHtml(reference.title || "")}" placeholder="书名、论文名或页面标题" /></label>
    <label class="citation-span-2">期刊 / 书名 / 会议<input data-citation-field="containerTitle" value="${escapeHtml(reference.containerTitle || "")}" placeholder="例如 Annals of Mathematics" /></label>
    <label>年份<input data-citation-field="year" inputmode="numeric" value="${escapeHtml(reference.year || "")}" placeholder="2026" /></label>
    <label>出版社<input data-citation-field="publisher" value="${escapeHtml(reference.publisher || "")}" /></label>
    <label>卷<input data-citation-field="volume" value="${escapeHtml(reference.volume || "")}" /></label>
    <label>期<input data-citation-field="issue" value="${escapeHtml(reference.issue || "")}" /></label>
    <label>页码<input data-citation-field="pages" value="${escapeHtml(reference.pages || "")}" placeholder="15-31" /></label>
    <label class="citation-span-2">DOI<input data-citation-field="doi" value="${escapeHtml(reference.doi || "")}" placeholder="10.1000/example" /></label>
    <label class="citation-span-2">arXiv<input data-citation-field="arxiv" value="${escapeHtml(reference.arxiv || "")}" placeholder="2401.01234" /></label>
    <label class="citation-span-2">链接<input data-citation-field="url" type="url" value="${escapeHtml(reference.url || "")}" placeholder="https://..." /></label>
    <label>访问日期<input data-citation-field="accessed" value="${escapeHtml(reference.accessed || "")}" placeholder="2026-07-11" /></label>
    <label>语言<input data-citation-field="language" value="${escapeHtml(reference.language || "")}" placeholder="zh-CN / en" /></label>
    <label class="citation-span-2">备注<input data-citation-field="note" value="${escapeHtml(reference.note || "")}" placeholder="译本、定理位置或其他核验信息" /></label>
  </article>`;
}

function citationReferenceSummary(reference = {}) {
  const authors = Array.isArray(reference.authors) ? reference.authors.join("; ") : (reference.authors || "");
  const primary = [authors, reference.title].filter(Boolean).join(" · ") || "未命名来源";
  const resolvers = [reference.doi ? "DOI" : "", reference.arxiv ? "arXiv" : "", reference.url ? "链接" : ""].filter(Boolean).join(" · ") || "待补核验信息";
  return { primary, resolvers };
}

function citationReferenceRow(reference = {}, index = 0, options = {}) {
  const authors = Array.isArray(reference.authors) ? reference.authors.join("; ") : (reference.authors || "");
  const summary = citationReferenceSummary(reference);
  return `<details class="citation-editor-row" data-citation-row="${index}" ${options.open ? "open" : ""}>
    <summary class="citation-editor-row-head"><span class="citation-editor-summary"><strong>${escapeHtml(reference.id || "未命名来源")}</strong><small>${escapeHtml(summary.primary)}</small></span><span class="citation-editor-resolvers">${escapeHtml(summary.resolvers)}</span><span class="citation-editor-row-actions"><button class="icon-button" type="button" data-insert-citation title="插入正文引用" aria-label="插入正文引用"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8M8 12h8M8 16h5M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg></button><button class="icon-button danger-icon" type="button" data-remove-citation title="移除来源" aria-label="移除来源"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></span></summary>
    <div class="citation-editor-fields">
      <label>引用键<input data-citation-field="id" value="${escapeHtml(reference.id || "")}" placeholder="例如 hardy1908" /></label>
      <label>类型<select data-citation-field="type">${referenceTypeOptions(reference.type || "article")}</select></label>
      <label class="citation-span-2">作者<input data-citation-field="authors" value="${escapeHtml(authors)}" placeholder="多个作者用分号分隔" /></label>
      <label class="citation-span-2">题名<input data-citation-field="title" value="${escapeHtml(reference.title || "")}" placeholder="书名、论文名或网页标题" /></label>
      <label class="citation-span-2">期刊 / 书名 / 会议<input data-citation-field="containerTitle" value="${escapeHtml(reference.containerTitle || "")}" placeholder="例如 Annals of Mathematics" /></label>
      <label>年份<input data-citation-field="year" inputmode="numeric" value="${escapeHtml(reference.year || "")}" placeholder="2026" /></label>
      <label>出版方<input data-citation-field="publisher" value="${escapeHtml(reference.publisher || "")}" /></label>
      <label>卷<input data-citation-field="volume" value="${escapeHtml(reference.volume || "")}" /></label>
      <label>期<input data-citation-field="issue" value="${escapeHtml(reference.issue || "")}" /></label>
      <label>页码<input data-citation-field="pages" value="${escapeHtml(reference.pages || "")}" placeholder="15-31" /></label>
      <label class="citation-span-2">DOI<input data-citation-field="doi" value="${escapeHtml(reference.doi || "")}" placeholder="10.1000/example" /></label>
      <label class="citation-span-2">arXiv<input data-citation-field="arxiv" value="${escapeHtml(reference.arxiv || "")}" placeholder="2401.01234" /></label>
      <label class="citation-span-2">链接<input data-citation-field="url" type="url" value="${escapeHtml(reference.url || "")}" placeholder="https://..." /></label>
      <label>访问日期<input data-citation-field="accessed" value="${escapeHtml(reference.accessed || "")}" placeholder="2026-07-11" /></label>
      <label>语言<input data-citation-field="language" value="${escapeHtml(reference.language || "")}" placeholder="zh-CN / en" /></label>
      <label class="citation-span-2">备注<input data-citation-field="note" value="${escapeHtml(reference.note || "")}" placeholder="译本、定理位置或其他核验信息" /></label>
    </div>
  </details>`;
}

function citationEditorFieldsLegacy(page = {}) {
  const rows = (page.references || []).map((reference, index) => citationReferenceRow(reference, index)).join("");
  return `<section class="citation-editor-panel wide" id="citationEditorPanel"><div class="citation-editor-intro"><div><span class="system-kicker">Structured Citations</span><h2>参考文献与来源质量</h2><p>正文使用 <code>[@引用键]</code>、<code>[@引用键, p. 42]</code> 或 <code>[@a; @b]</code>。使用 <code>{{cite-needed|原因}}</code> 标记待补来源。</p></div><button class="command-button secondary" type="button" data-add-citation>添加来源</button></div><div class="citation-editor-list" id="citationReferenceRows">${rows || '<div class="citation-editor-empty"><strong>尚未添加结构化来源</strong><span>添加 DOI、arXiv、出版物或权威网页来源后，可直接插入正文。</span></div>'}</div></section>`;
}

function citationEditorFields(page = {}) {
  const rows = (page.references || []).map((reference, index) => citationReferenceRow(reference, index)).join("");
  return `<section class="citation-editor-panel wide" id="citationEditorPanel"><div class="citation-editor-intro"><div><span class="system-kicker">Structured Citations</span><h2>参考文献与来源质量</h2><p>来源默认以摘要折叠。正文使用 <code>[@引用键]</code>、<code>[@引用键, p. 42]</code> 或 <code>[@a; @b]</code>；使用 <code>{{cite-needed|原因}}</code> 标记待补来源。</p></div><div class="citation-editor-toolbar"><button class="mini-button" type="button" data-collapse-citations>收起全部</button><button class="mini-button" type="button" data-expand-citations>展开全部</button><button class="command-button secondary" type="button" data-add-citation>添加来源</button></div></div><div class="citation-editor-list" id="citationReferenceRows">${rows || '<div class="citation-editor-empty"><strong>尚未添加结构化来源</strong><span>添加 DOI、arXiv、出版物或权威网页来源后，可直接插入正文。</span></div>'}</div></section>`;
}

function collectCitationReferences(form) {
  return [...form.querySelectorAll("[data-citation-row]")].map((row) => {
    const data = {};
    row.querySelectorAll("[data-citation-field]").forEach((field) => { data[field.dataset.citationField] = field.value.trim(); });
    data.authors = String(data.authors || "").split(";").map((item) => item.trim()).filter(Boolean);
    return data;
  }).filter((reference) => reference.id || reference.title || reference.doi || reference.arxiv || reference.url);
}

function insertCitationIntoEditor(referenceId) {
  if (!referenceId) { uiToast("请先填写引用键。", "warning"); return; }
  const text = `[@${referenceId}]`;
  if (activeEditor?.insertValue) activeEditor.insertValue(text);
  else {
    const fallback = document.querySelector("#editorBodyFallback");
    if (!fallback) return;
    const start = fallback.selectionStart || fallback.value.length;
    const end = fallback.selectionEnd || start;
    fallback.value = `${fallback.value.slice(0, start)}${text}${fallback.value.slice(end)}`;
    fallback.focus();
  }
  uiToast(`已插入 ${text}`);
}

function bindCitationEditorLegacy(form) {
  const panel = form.querySelector("#citationEditorPanel");
  const list = form.querySelector("#citationReferenceRows");
  if (!panel || !list) return;
  const addRow = (reference = {}) => {
    if (list.querySelector(".citation-editor-empty")) list.innerHTML = "";
    list.insertAdjacentHTML("beforeend", citationReferenceRow(reference, list.querySelectorAll("[data-citation-row]").length));
  };
  panel.querySelector("[data-add-citation]")?.addEventListener("click", () => addRow());
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-citation-row]");
    if (!row) return;
    if (event.target.closest("[data-remove-citation]")) {
      row.remove();
      if (!list.querySelector("[data-citation-row]")) list.innerHTML = '<div class="citation-editor-empty"><strong>尚未添加结构化来源</strong><span>添加 DOI、arXiv、出版物或权威网页来源后，可直接插入正文。</span></div>';
      return;
    }
    if (event.target.closest("[data-insert-citation]")) insertCitationIntoEditor(row.querySelector("[data-citation-field='id']")?.value.trim());
  });
}

function bindCitationEditor(form) {
  const panel = form.querySelector("#citationEditorPanel");
  const list = form.querySelector("#citationReferenceRows");
  if (!panel || !list) return;
  const empty = () => '<div class="citation-editor-empty"><strong>尚未添加结构化来源</strong><span>添加 DOI、arXiv、出版物或权威网页来源后，可直接插入正文。</span></div>';
  const addRow = (reference = {}) => {
    if (list.querySelector(".citation-editor-empty")) list.innerHTML = "";
    list.insertAdjacentHTML("beforeend", citationReferenceRow(reference, list.querySelectorAll("[data-citation-row]").length, { open: true }));
  };
  panel.querySelector("[data-add-citation]")?.addEventListener("click", () => addRow());
  panel.querySelector("[data-collapse-citations]")?.addEventListener("click", () => list.querySelectorAll("[data-citation-row]").forEach((row) => { row.open = false; }));
  panel.querySelector("[data-expand-citations]")?.addEventListener("click", () => list.querySelectorAll("[data-citation-row]").forEach((row) => { row.open = true; }));
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-citation-row]");
    if (!row) return;
    if (event.target.closest("[data-remove-citation]")) {
      event.preventDefault();
      event.stopPropagation();
      row.remove();
      if (!list.querySelector("[data-citation-row]")) list.innerHTML = empty();
      return;
    }
    if (event.target.closest("[data-insert-citation]")) {
      event.preventDefault();
      event.stopPropagation();
      insertCitationIntoEditor(row.querySelector("[data-citation-field='id']")?.value.trim());
    }
  });
}

function editorFields(page = {}) {
  return `
    <form class="editor-form" id="editorForm">
      <label>Slug<input name="slug" value="${escapeHtml(page.slug || "")}" ${page.slug ? "readonly" : ""} required /></label>
      <label>标题<input name="title" value="${escapeHtml(page.title || "")}" required /></label>
      <label class="wide">摘要<input name="summary" value="${escapeHtml(page.summary || "")}" /></label>
      <label class="wide">顶部大图 URL<input name="heroImage" value="${escapeHtml(page.heroImage || "")}" placeholder="https://..." /></label>
      <label>分类<input name="categories" value="${escapeHtml((page.categories || []).join(", "))}" /></label>
      <label>难度<select name="difficulty">${["入门", "本科", "研究生", "专题", "未分级"].map((item) => `<option value="${item}" ${item === page.difficulty ? "selected" : ""}>${item}</option>`).join("")}</select></label>
      <label>质量<select name="quality">${["A", "B", "C", "Draft"].map((item) => `<option value="${item}" ${item === page.quality ? "selected" : ""}>${item}</option>`).join("")}</select></label>
      <label>状态<select name="status">${["stable", "review", "draft"].map((item) => `<option value="${item}" ${item === page.status ? "selected" : ""}>${item}</option>`).join("")}</select></label>
      ${editorKnowledgeFields(page)}
      ${citationEditorFields(page)}
      <div class="wide">${guestFields("编辑")}</div>
      <div class="wide visual-editor-wrap">
        <div class="visual-editor-head"><span>可视化编辑器</span><small>Vditor WYSIWYG · Markdown 源文同步 · 公式可视化</small></div>
        <div id="visualEditor" class="vditor-host"></div>
        <textarea id="editorBodyFallback" name="body" spellcheck="false">${escapeHtml(page.body || "")}</textarea>
      </div>
      <div class="editor-actions wide"><button class="command-button" type="submit">保存</button><a class="command-button secondary" href="#/page/${encodeSlug(page.slug || state.site.defaultPage)}">取消</a></div>
      <div class="status-line wide" id="editorStatus"></div>
    </form>
  `;
}

function applyCommunityWikiDraft(page, requestedSlug = "") {
  const key = window.WikistCommunityQA?.WIKI_DRAFT_KEY;
  if (!key) return page;
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!draft || Date.now() - Number(draft.createdAt || 0) > 30 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return page;
    }
    const targetSlug = String(draft.targetSlug || "").trim();
    const actualSlug = String(page.slug || requestedSlug || "").trim();
    if (targetSlug && actualSlug && targetSlug !== actualSlug) return page;
    const markdown = String(draft.markdown || "").trim();
    if (!markdown) return page;
    const body = String(page.body || "").trim();
    const next = {
      ...page,
      slug: actualSlug || targetSlug,
      title: page.title || String(draft.title || "").trim(),
      summary: page.summary || "由 Wikist Community 问答整理形成，保存前请核验来源与表述。",
      body: body ? `${body}\n\n${markdown}\n` : `${markdown}\n`,
    };
    sessionStorage.removeItem(key);
    uiToast("已载入问答整理草稿");
    return next;
  } catch (_error) {
    sessionStorage.removeItem(key);
    return page;
  }
}

async function renderEditor(slug) {
  let page = {
    slug: slug || "",
    title: "",
    summary: "",
    categories: [],
    difficulty: "未分级",
    quality: "Draft",
    status: "draft",
    heroImage: "",
    body: "# 新词条\n\n::: definition 定义\n写下清晰、可验证的定义。\n:::\n",
  };
  if (slug) page = await api(`/api/pages/${encodeSlug(slug)}`).catch(() => page);
  page = applyCommunityWikiDraft(page, slug);
  state.currentSlug = page.slug || slug || "";
  const permissions = state.currentSlug ? await api(`/api/pages/${encodeSlug(state.currentSlug)}/permissions`).catch(() => ({ editPolicy: "guest" })) : { editPolicy: "guest" };
  const editBlocked = permissions.editPolicy === "locked" || (permissions.editPolicy === "user" && !state.user);
  if (editBlocked) {
    setChromeTitle("不可编辑");
    renderToc([]);
    el.editLink.href = `#/page/${encodeSlug(state.currentSlug || state.site.defaultPage)}`;
    const message = permissions.editPolicy === "locked" ? "该词条已锁定，暂不可编辑。" : "该词条仅允许登录用户编辑。";
    el.main.innerHTML = `${pageToolNav(state.currentSlug || page.slug || "home", "edit")}<section class="empty-state"><h1>不可编辑</h1><p>${escapeHtml(message)}</p><div class="editor-actions"><a class="command-button" href="#/page/${encodeSlug(state.currentSlug || state.site.defaultPage)}">返回词条</a><a class="command-button secondary" href="#/permissions/${encodeSlug(state.currentSlug || page.slug || "home")}">查看权限</a></div></section>`;
    return;
  }
  setChromeTitle(page.title ? `编辑 ${page.title}` : "新词条");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `${pageToolNav(state.currentSlug || page.slug || "home", "edit")}<header class="article-head"><h1>${page.slug ? "编辑词条" : "新词条"}</h1><p class="article-summary">${escapeHtml(state.user ? `将以 ${state.user.displayName || state.user.username} 的身份记录编辑。` : "未登录时需要填写访客昵称和邮箱。")}</p></header>${editorFields(page)}`;
  await mountVisualEditor(page.body || "");
  bindCitationEditor(document.querySelector("#editorForm"));
  document.querySelector("#editorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const status = document.querySelector("#editorStatus");
    payload.body = readEditorBody(form);
    payload.categories = String(payload.categories || "").split(",").map((item) => item.trim()).filter(Boolean);
    payload.prerequisites = String(payload.prerequisites || "").split(",").map((item) => item.trim()).filter(Boolean);
    payload.relatedPages = String(payload.relatedPages || "").split(",").map((item) => item.trim()).filter(Boolean);
    payload.canonicalNames = String(payload.canonicalNames || "").split(",").map((item) => item.trim()).filter(Boolean);
    payload.classifications = String(payload.classifications || "").split(",").map((item) => item.trim()).filter(Boolean);
    payload.notation = String(payload.notation || "").split("\n").map((item) => item.trim()).filter(Boolean);
    payload.disambiguation = Boolean(form.elements.disambiguation?.checked);
    payload.disambiguationTargets = String(payload.disambiguationTargets || "").split("\n").map((item) => item.trim()).filter(Boolean);
    payload.references = collectCitationReferences(form);
    if (form.elements.aliases) payload.aliases = String(payload.aliases || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!form.elements.redirectTarget) delete payload.redirectTarget;
    status.textContent = "保存中...";
    try {
      const saved = await api(`/api/pages/${encodeSlug(payload.slug)}`, { method: "PUT", body: JSON.stringify(payload) });
      await Promise.all([refreshUser(), refreshChrome()]);
      destroyVisualEditor();
      const watchRecipients = Number(saved.knowledge?.notifications || 0);
      const followerRecipients = Number(saved.knowledge?.followerNotifications || 0);
      const notified = watchRecipients + followerRecipients;
      const notificationText = notified ? `已向 ${notified} 位关注者发送词条更新消息。` : "当前没有其他订阅者需要通知。";
      const review = saved.review || {};
      if (canReviewContent() && review.pending) {
        const startReview = await uiConfirm({
          title: "当前版本已保存",
          text: `当前版本已进入待审队列。${notificationText} 现在可以查看差异并开始审阅。`,
          confirmText: "开始审阅",
          cancelText: "查看词条",
        });
        location.hash = startReview ? `#/review/${encodeSlug(saved.slug)}` : `#/page/${encodeSlug(saved.slug)}`;
      } else {
        await uiAlert("当前版本已保存", `当前版本已进入待审队列。${notificationText}`, "success");
        location.hash = `#/page/${encodeSlug(saved.slug)}`;
      }
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function authShell(mode) {
  const isRegister = mode === "register";
  return `<section class="auth-layout"><div class="auth-copy"><span class="system-kicker">Wikist Passport</span><h1>${isRegister ? "加入开放知识网络" : "进入知识通行证"}</h1><p>${isRegister ? "注册后可参与编辑、审阅与组织协作。" : "登录后可管理账户、消息与词条贡献。"}</p><div class="auth-signals"><span>邮箱验证</span><span>密码找回</span><span>二次验证</span><span>贡献署名</span></div></div><form class="auth-panel" id="authForm"><div class="auth-tabs"><a class="${!isRegister ? "active" : ""}" href="#/login">登录</a><a class="${isRegister ? "active" : ""}" href="#/register">注册</a></div>${isRegister ? `<label>用户名<input name="username" autocomplete="username" placeholder="wikist_user" required /></label><label>显示名称<input name="displayName" autocomplete="nickname" placeholder="你的知识署名" required /></label><label>邮箱<input name="email" type="email" autocomplete="email" placeholder="name@example.com" /></label>` : `<label>用户名或邮箱<input name="identifier" autocomplete="username" required /></label>`}<label>密码<input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" required /></label>${isRegister ? '<label>确认密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label>' : ""}<input name="captchaId" type="hidden" /><label>人机验证<span class="captcha-row"><img class="captcha-image" id="captchaImage" alt="验证码" /><button class="icon-button" id="refreshCaptcha" type="button" title="刷新验证码" aria-label="刷新验证码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/></svg></button></span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" placeholder="输入算式结果" required /></label><div class="editor-actions"><button class="command-button" type="submit">${isRegister ? "创建通行证" : "登录"}</button><a class="command-button secondary" href="#/page/${encodeSlug(state.site.defaultPage)}">返回 wiki</a></div><div class="status-line" id="authStatus"></div></form></section>`;
}

function authCosmicText(mode) {
  const isRegister = mode === "register";
  const lang = normalizeLanguageCode(state.uiLanguage || state.site?.language, "zh-CN");
  if (lang === "en") {
    return {
      title: isRegister ? "Create account" : "Wikist Passport",
      intro: isRegister ? "Create an account and verify your email." : "Sign in to continue editing and collaboration.",
      formTitle: isRegister ? "Create account" : "Sign in",
      formIntro: isRegister ? "Start contributing after registration." : "Continue editing, collecting, messaging, and collaboration.",
      formKicker: isRegister ? "Create account" : "Sign in",
      phase: isRegister ? "NEW ACCOUNT" : "SIGN IN",
    signals: ["Email verification", "Password recovery", "Two-factor security", "Contribution identity"],
      users: "Users",
      pages: "Pages",
      recent: "Recent",
      identity: "Identity",
      online: "Online",
      guest: "Guest",
    };
  }
  if (lang === "zh-TW") {
    return {
      title: isRegister ? "建立帳號" : "知識通行證",
      intro: isRegister ? "註冊並完成信箱驗證。" : "登入後繼續編輯與協作。",
      formTitle: isRegister ? "建立 Wikist 通行證" : "登入 Wikist",
      formIntro: isRegister ? "建立帳號後即可參與貢獻。" : "繼續編輯、收藏、訊息與協作。",
      formKicker: isRegister ? "建立帳號" : "身份驗證",
      phase: isRegister ? "新身份接入" : "身份接入",
      signals: ["信箱驗證", "密碼找回", "二次驗證", "貢獻署名"],
      users: "註冊用戶",
      pages: "公開詞條",
      recent: "最近更新",
      identity: "目前身份",
      online: "在線",
      guest: "訪客",
    };
  }
  return {
    title: isRegister ? "创建账号" : "知识通行证",
    intro: isRegister ? "注册并完成邮箱验证。" : "登录后继续编辑与协作。",
    formTitle: isRegister ? "创建 Wikist 通行证" : "登录 Wikist",
    formIntro: isRegister ? "创建账号后即可参与贡献。" : "继续编辑、收藏、消息与协作。",
    formKicker: isRegister ? "创建账号" : "身份验证",
    phase: isRegister ? "新身份接入" : "身份接入",
    signals: ["邮箱验证", "密码找回", "二次验证", "贡献署名"],
    users: "注册用户",
    pages: "公开词条",
    recent: "最近更新",
    identity: "当前身份",
    online: "在线",
    guest: "访客",
  };
}

function secureAuthShell(mode) {
  const isRegister = mode === "register";
  const copy = authCosmicText(mode);
  for (const key of ["formTitle", "formIntro", "intro"]) {
    copy[key] = String(copy[key] || "").replace(/Wikist/g, currentSiteName());
  }
  const authStats = {
    users: Number(state.site?.setup?.users || state.site?.users || 0),
    pages: Number(state.pageTotal || state.pages?.length || 0),
    recent: Number(state.recent?.length || 0),
  };
  const registerFields = `
    <label>用户名<input name="username" autocomplete="username" placeholder="wikist_user" required /></label>
    <label>显示名称<input name="displayName" autocomplete="nickname" placeholder="你的知识署名" required /></label>
    <label>邮箱<input name="email" type="email" autocomplete="email" placeholder="name@example.com" required /></label>`;
  const loginFields = `
    <label>用户名或邮箱<input name="identifier" autocomplete="username" required /></label>
    <label>二次验证码<input name="twoFactorCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="已开启二次验证时填写" /></label>
    <a class="mini-link auth-forgot-link" href="#/forgot-password">忘记密码？</a>`;
  return `<section class="auth-layout auth-cyber-layout">
    <div class="auth-copy auth-cyber-copy">
      <canvas class="cosmic-canvas auth-cosmic-canvas" data-cosmic-scene="auth" aria-hidden="true"></canvas>
      <div class="cosmic-vignette" aria-hidden="true"></div>
      <span class="system-kicker">${escapeHtml(currentPassportName())}</span>
      <h1>${escapeHtml(copy.title)}</h1>
      <p>${escapeHtml(copy.intro)}</p>
      <div class="auth-cosmic-console" aria-label="${escapeHtml(currentPassportName())} 宇宙数据概览">
        <div class="auth-orbit-lock">
          <span>${escapeHtml(copy.phase)}</span>
          <strong data-auth-metric="${authStats.users}">${authStats.users}</strong>
          <small>${escapeHtml(copy.users)}</small>
        </div>
        <div class="auth-stat-pods">
          <div class="auth-stat-pod pod-pages"><strong data-auth-metric="${authStats.pages}">${authStats.pages}</strong><span>${escapeHtml(copy.pages)}</span></div>
          <div class="auth-stat-pod pod-recent"><strong data-auth-metric="${authStats.recent}">${authStats.recent}</strong><span>${escapeHtml(copy.recent)}</span></div>
          <div class="auth-stat-pod pod-secure"><strong>${escapeHtml(state.user ? copy.online : copy.guest)}</strong><span>${escapeHtml(copy.identity)}</span></div>
        </div>
      </div>
      <div class="auth-signals">${copy.signals.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </div>
    <form class="auth-panel auth-passport-panel" id="authForm">
      <div class="auth-tabs"><a class="${!isRegister ? "active" : ""}" href="#/login">登录</a><a class="${isRegister ? "active" : ""}" href="#/register">注册</a></div>
      <div class="auth-form-head"><span>${escapeHtml(copy.formKicker)}</span><h2>${escapeHtml(copy.formTitle)}</h2><p>${escapeHtml(copy.formIntro)}</p></div>
      ${isRegister ? registerFields : loginFields}
      <label>密码<input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" required /></label>
      ${isRegister ? '<label>确认密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label>' : ""}
      <input name="captchaId" type="hidden" />
      <label>人机验证<span class="captcha-row"><img class="captcha-image" id="captchaImage" alt="验证码" /><button class="icon-button" id="refreshCaptcha" type="button" title="刷新验证码" aria-label="刷新验证码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/></svg></button></span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" placeholder="输入算式结果" required /></label>
      <div class="editor-actions"><button class="command-button" type="submit">${isRegister ? "创建通行证" : "登录"}</button><a class="command-button secondary" href="#/page/${encodeSlug(state.site.defaultPage)}">返回 wiki</a></div>
      <div class="auth-trust-line"><span>邮箱验证</span><span>密码找回</span><span>贡献署名</span></div>
      <div class="status-line" id="authStatus"></div>
    </form>
  </section>`;
}

function svgToDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function themedCaptchaSvg(svg, theme = document.documentElement.dataset.theme) {
  if (theme !== "light") return svg;
  return String(svg || "")
    .replace(/fill="#080d0c"/g, 'fill="#f8fffd"')
    .replace(/stroke="rgba\(124,255,180,\.28\)"/g, 'stroke="rgba(0,126,167,.24)"')
    .replace(/stroke="rgba\(56,232,255,\.22\)"/g, 'stroke="rgba(0,126,167,.22)"')
    .replace(/stroke="rgba\(255,209,102,\.42\)"/g, 'stroke="rgba(163,107,0,.32)"')
    .replace(/fill="#7cffb4"/g, 'fill="#008b5f"')
    .replace(/fill="#38e8ff"/g, 'fill="#007ea7"')
    .replace(/fill="#ffd166"/g, 'fill="#a36b00"')
    .replace(/fill="#9bb0a8"/g, 'fill="#4b655d"')
    .replace(/fill="#edf7f2"/g, 'fill="#143129"');
}

function renderCaptchaSvg(svg) {
  const image = document.querySelector("#captchaImage");
  if (!image) return;
  image.dataset.captchaSvg = svg || "";
  image.src = svgToDataUri(themedCaptchaSvg(svg));
}

function refreshCaptchaTheme() {
  document.querySelectorAll(".captcha-image[data-captcha-svg]").forEach((image) => {
    image.src = svgToDataUri(themedCaptchaSvg(image.dataset.captchaSvg || ""));
  });
}

function setupAdminShell() {
  return `<section class="auth-layout setup-admin-layout">
    <div class="auth-copy setup-admin-copy">
      <span class="system-kicker">${escapeHtml(currentSiteName())} Initial Setup</span>
      <h1>创建首位管理员</h1>
      <p>站点配置已经加载完成。为了让后台、用户管理、备份恢复和权限设置真正可用，请先创建第一个管理员账号。</p>
      <div class="auth-signals"><span>首个管理员</span><span>邮箱验证</span><span>安全密码</span><span>创建后进入后台</span></div>
    </div>
    <form class="auth-panel setup-admin-panel" id="authForm">
      <h2>管理员账号</h2>
      <p class="muted-line">这个账号拥有完整后台权限。请使用长期可控的邮箱和强密码。</p>
      <label>用户名<input name="username" autocomplete="username" placeholder="admin" required /></label>
      <label>显示名称<input name="displayName" autocomplete="nickname" placeholder="站点管理员" required /></label>
      <label>邮箱<input name="email" type="email" autocomplete="email" placeholder="name@example.com" required /></label>
      <label>密码<input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
      <label>确认密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
      <input name="captchaId" type="hidden" />
      <label>人机验证<span class="captcha-row"><img class="captcha-image" id="captchaImage" alt="验证码" /><button class="icon-button" id="refreshCaptcha" type="button" title="刷新验证码" aria-label="刷新验证码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/></svg></button></span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" placeholder="输入算式结果" required /></label>
      <div class="editor-actions"><button class="command-button" type="submit">创建管理员并进入后台</button></div>
      <div class="status-line" id="authStatus"></div>
    </form>
  </section>`;
}

async function loadCaptcha() {
  const form = document.querySelector("#authForm");
  if (!form) return;
  const captcha = await api("/api/passport/captcha");
  form.elements.captchaId.value = captcha.id;
  renderCaptchaSvg(captcha.svg);
  form.elements.captchaAnswer.value = "";
}

document.addEventListener("wikist:theme-change", refreshCaptchaTheme);

async function renderAuth(mode) {
  await refreshUser();
  if (state.user && mode !== "register") { location.hash = "#/account"; return; }
  setChromeTitle(mode === "register" ? "注册" : "登录");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = secureAuthShell(mode);
  await loadCaptcha();
  document.querySelector("#refreshCaptcha").addEventListener("click", () => loadCaptcha().catch((error) => { document.querySelector("#authStatus").textContent = error.message; }));
  document.querySelector("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#authStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (mode === "register" && payload.password !== payload.confirmPassword) { status.textContent = "两次输入的密码不一致。"; return; }
    delete payload.confirmPassword;
    status.textContent = mode === "register" ? "正在创建通行证..." : "正在验证身份...";
    try {
      const result = await api(`/api/passport/${mode === "register" ? "register" : "login"}`, { method: "POST", body: JSON.stringify(payload) });
      state.user = result.user;
      renderPassportLink();
      location.hash = "#/account";
    } catch (error) {
      if (error.message === "账号已被禁用。") {
        status.textContent = "";
        await uiAlert("账号已被禁用", `该 ${currentPassportName()} 已被管理员封禁，无法登录或参与新的编辑、评论活动。若认为这是误操作，请联系站点管理员。`, "error");
      } else {
        status.textContent = error.message;
      }
      await loadCaptcha().catch(() => {});
    }
  });
}

async function renderInitialAdmin() {
  if (!state.site?.setup?.needsAdmin) {
    location.hash = "#/page/" + encodeSlug(state.site?.defaultPage || "home");
    return;
  }
  setChromeTitle("创建管理员");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = setupAdminShell();
  await loadCaptcha();
  document.querySelector("#refreshCaptcha")?.addEventListener("click", () => loadCaptcha().catch((error) => { document.querySelector("#authStatus").textContent = error.message; }));
  document.querySelector("#authForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#authStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (payload.password !== payload.confirmPassword) {
      status.textContent = "两次输入的密码不一致。";
      return;
    }
    delete payload.confirmPassword;
    status.textContent = "正在创建首位管理员...";
    try {
      const result = await api("/api/passport/register", { method: "POST", body: JSON.stringify(payload) });
      state.user = result.user;
      state.site.setup = { ...(state.site.setup || {}), needsAdmin: false, users: Math.max(1, Number(state.site.setup?.users || 0) + 1), admins: Math.max(1, Number(state.site.setup?.admins || 0) + 1) };
      renderPassportLink();
      await refreshChrome().catch(() => {});
      location.hash = "#/admin/overview";
    } catch (error) {
      status.textContent = error.message;
      await loadCaptcha().catch(() => {});
    }
  });
}

function forgotPasswordShell() {
  return `<section class="auth-layout"><div class="auth-copy"><span class="system-kicker">Password Recovery</span><h1>找回 Wikist 密码</h1><p>输入用户名或邮箱，接收密码重置链接。</p><div class="auth-signals"><span>邮箱验证</span><span>短时链接</span><span>旧会话失效</span></div></div><form class="auth-panel" id="authForm"><div class="auth-tabs"><a href="#/login">登录</a><a href="#/register">注册</a></div><label>用户名或邮箱<input name="identifier" autocomplete="username" required /></label><input name="captchaId" type="hidden" /><label>人机验证<span class="captcha-row"><img class="captcha-image" id="captchaImage" alt="验证码" /><button class="icon-button" id="refreshCaptcha" type="button" title="刷新验证码" aria-label="刷新验证码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/></svg></button></span><input name="captchaAnswer" inputmode="numeric" autocomplete="off" placeholder="输入算式结果" required /></label><div class="editor-actions"><button class="command-button" type="submit">发送重置邮件</button><a class="command-button secondary" href="#/login">返回登录</a></div><div class="status-line" id="authStatus"></div></form></section>`;
}

async function renderForgotPassword() {
  await refreshUser();
  if (state.user) { location.hash = "#/account"; return; }
  setChromeTitle("找回密码");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = forgotPasswordShell();
  await loadCaptcha();
  document.querySelector("#refreshCaptcha")?.addEventListener("click", () => loadCaptcha().catch((error) => { document.querySelector("#authStatus").textContent = error.message; }));
  document.querySelector("#authForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#authStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    status.textContent = "正在发送邮件...";
    try {
      await api("/api/passport/password/forgot", { method: "POST", body: JSON.stringify(payload) });
      status.textContent = "如果账号存在且邮件系统可用，重置链接已经发送。";
    } catch (error) {
      status.textContent = error.message;
      await loadCaptcha().catch(() => {});
    }
  });
}

async function renderResetPassword(token = "") {
  setChromeTitle("重置密码");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `<section class="auth-layout"><div class="auth-copy"><span class="system-kicker">Password Reset</span><h1>设置新密码</h1><p>重置成功后，所有旧登录会话会自动失效。</p></div><form class="auth-panel" id="resetPasswordForm"><input name="token" type="hidden" value="${escapeHtml(token)}" /><label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required /></label><label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label><div class="editor-actions"><button class="command-button" type="submit">更新密码</button><a class="command-button secondary" href="#/login">返回登录</a></div><div class="status-line" id="resetPasswordStatus"></div></form></section>`;
  document.querySelector("#resetPasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#resetPasswordStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (payload.newPassword !== payload.confirmPassword) { status.textContent = "两次输入的新密码不一致。"; return; }
    delete payload.confirmPassword;
    status.textContent = "正在更新密码...";
    try {
      await api("/api/passport/password/reset", { method: "POST", body: JSON.stringify(payload) });
      await uiToast("密码已更新，请重新登录");
      location.hash = "#/login";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

async function renderVerifyEmail(token = "") {
  setChromeTitle("邮箱验证");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `<section class="empty-state"><h1>正在验证邮箱...</h1><p class="muted-line">${escapeHtml(currentSiteName())} 正在确认这条验证链接。</p></section>`;
  try {
    const result = await api("/api/passport/email/verify", { method: "POST", body: JSON.stringify({ token }) });
    state.user = result.user || state.user;
    await refreshUser();
    el.main.innerHTML = `<section class="empty-state success"><h1>邮箱已验证</h1><p class="muted-line">你的通行证邮箱已经完成验证。</p><a class="command-button" href="#/account">进入账户中心</a></section>`;
  } catch (error) {
    el.main.innerHTML = `<section class="empty-state"><h1>验证失败</h1><p>${escapeHtml(error.message)}</p><a class="command-button secondary" href="#/account">返回账户中心</a></section>`;
  }
}

function translatorLanguageChoices(selected = []) {
  return uniqueLanguages([
    ...selected,
    ...supportedLanguages(),
    "ja",
    "ko",
    "fr",
    "de",
    "es",
    "ru",
    "ar",
    "pt",
    "it",
    "vi",
  ]).filter((lang) => lang !== "zh-CN");
}

function translatorLanguagePicker(selected = []) {
  const selectedSet = new Set(uniqueLanguages(selected));
  return `
    <div class="language-picker" role="group" aria-label="目标语言">
      ${translatorLanguageChoices(selected).map((lang) => `
        <label class="language-choice">
          <input type="checkbox" name="languages" value="${escapeHtml(lang)}" ${selectedSet.has(lang) ? "checked" : ""} />
          <span>${escapeHtml(languageLabel(lang))}</span>
          <small>${escapeHtml(lang)}</small>
        </label>`).join("")}
    </div>
    <label>添加自定义语言<input name="customLanguages" placeholder="例如：fr, ja, de-DE" autocomplete="off" /></label>`;
}

function accountFavoritesHtml(favorites = [], total = 0) {
  const items = favorites.length
    ? favorites.slice(0, 10).map((favorite) => `
      <article class="favorite-list-item">
        <a href="#/page/${encodeSlug(favorite.pageSlug)}">
          <strong>${escapeHtml(favorite.pageTitle || favorite.pageSlug)}</strong>
          <small>${escapeHtml(favorite.pageSlug)} · ${fmtDate(favorite.createdAt)}</small>
        </a>
        <button class="icon-button favorite-remove-button" type="button" data-remove-favorite="${escapeHtml(favorite.pageSlug)}" title="取消收藏" aria-label="取消收藏 ${escapeHtml(favorite.pageTitle || favorite.pageSlug)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
        </button>
      </article>`).join("")
    : '<div class="favorite-empty"><strong>还没有收藏词条</strong><span>在任意词条标题旁点击收藏即可同步到这里。</span></div>';
  const note = total > 10 ? `显示最近 10 条，共 ${total} 条` : `共 ${total} 条`;
  return `
    <section class="auth-panel compact favorites-panel" id="accountFavorites">
      <div class="panel-heading-row"><div><h2>收藏词条</h2><p class="muted-line">${note}</p></div><div class="panel-heading-actions">${total ? '<a class="mini-link" href="#/favorites">查看更多</a>' : ""}<span class="favorite-count-badge">${total}</span></div></div>
      <div class="favorite-list">${items}</div>
    </section>`;
}

function favoriteResultHtml(item, index) {
  const details = `<div class="chip-row"><span class="chip">收藏于 ${fmtDate(item.favoritedAt)}</span><span class="chip">质量 ${escapeHtml(item.quality || "-")}</span>${item.status ? `<span class="chip">${escapeHtml(item.status)}</span>` : ""}${(item.categories || []).slice(0, 4).map((category) => `<span class="chip">${escapeHtml(category)}</span>`).join("")}</div>`;
  if (!item.exists) {
    return `<article class="result-item search-result-card favorite-result-card is-archived" style="--result-index:${index + 1}"><div class="search-result-rank">${index + 1}</div><div class="search-result-body"><h2>${escapeHtml(item.title || item.slug)}</h2><p>${escapeHtml(item.summary || "该词条已归档或尚未恢复。")}</p>${details}</div></article>`;
  }
  return `<article class="result-item search-result-card favorite-result-card" style="--result-index:${index + 1}"><a class="favorite-result-link" href="#/page/${encodeSlug(item.slug)}"><div class="search-result-rank">${index + 1}</div><div class="search-result-body"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary || "")}</p>${details}</div></a><button class="icon-button favorite-result-remove" type="button" data-remove-favorite="${escapeHtml(item.slug)}" title="取消收藏" aria-label="取消收藏 ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></article>`;
}

async function renderFavorites(value = "") {
  const page = Math.max(1, Number(String(value || "").split("/")[0]) || 1);
  await refreshUser();
  if (!state.user) { location.hash = "#/login"; return; }
  setChromeTitle("我的收藏");
  renderToc([]);
  el.editLink.href = "#/new";
  const payload = await api(`/api/passport/favorites?page=${page}&limit=12`);
  const { items, pagination } = normalizedPaged(payload, page, 12);
  el.main.innerHTML = `
    <header class="article-head favorites-page-head">
      <div class="article-title-row"><h1>我的收藏</h1><span class="quality-badge">${Number(pagination.total || 0)} 条</span></div>
      <p class="article-summary">按收藏时间查看并搜索你的词条书签。</p>
      <div class="editor-actions"><a class="command-button secondary" href="#/account">返回账户中心</a></div>
    </header>
    <section class="search-results refined-search-results favorite-results-page">
      ${items.length ? items.map(favoriteResultHtml).join("") : '<div class="empty-state"><h2>还没有收藏词条</h2><p class="muted-line">在任意词条标题旁点击收藏，即可把它加入这里。</p></div>'}
    </section>
    ${paginationHtml(pagination, "收藏词条")}`;
  document.querySelectorAll("[data-remove-favorite]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/pages/${encodeSlug(button.dataset.removeFavorite)}/favorite`, { method: "PUT", body: JSON.stringify({ favorited: false }) });
        await refreshUser();
        uiToast("已取消收藏");
        await renderFavorites(String(page));
      } catch (error) {
        button.disabled = false;
        await uiAlert("操作失败", error.message, "error");
      }
    });
  });
  bindPagination(el.main, (nextPage) => { location.hash = `#/favorites/${nextPage}`; });
}

function watchTargetLabel(watch) {
  if (watch.targetType === "category") return `分类 · ${watch.targetKey}`;
  if (watch.targetType === "language") return `语言 · ${languageLabel(watch.targetKey)}`;
  return watch.page?.title || watch.targetKey;
}

function watchItemHtml(watch, compact = false) {
  const title = watchTargetLabel(watch);
  const meta = watch.targetType === "page"
    ? (watch.page?.summary || (watch.exists ? watch.targetKey : "该词条已归档或尚未创建。"))
    : watch.targetType === "category"
      ? "该分类下的词条创建、保存、归档会通知你。"
      : "该语言的译文保存会通知你。";
  const target = watch.targetType === "page" && watch.exists
    ? `<a href="#/page/${encodeSlug(watch.targetKey)}"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></a>`
    : `<div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></div>`;
  return `<article class="watch-list-item ${compact ? "compact" : ""}">${target}<span class="chip">${escapeHtml(watch.targetType === "page" ? "词条" : watch.targetType === "category" ? "分类" : "语言")}</span><button class="icon-button favorite-result-remove" type="button" data-remove-watch-type="${escapeHtml(watch.targetType)}" data-remove-watch-key="${escapeHtml(watch.targetKey)}" title="取消关注" aria-label="取消关注 ${escapeHtml(title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></article>`;
}

async function saveWatch(targetType, targetKey, enabled) {
  return api("/api/passport/watches", {
    method: "PUT",
    body: JSON.stringify({ targetType, targetKey, enabled }),
  });
}

async function renderWatchlist(value = "") {
  const page = Math.max(1, Number(String(value || "").split("/")[0]) || 1);
  await refreshUser();
  if (!state.user) { location.hash = "#/login"; return; }
  setChromeTitle("关注列表");
  renderToc([]);
  el.editLink.href = "#/new";
  const [payload, knowledge] = await Promise.all([
    api(`/api/passport/watches?page=${page}&limit=12`),
    api("/api/knowledge").catch(() => ({ categories: [] })),
  ]);
  const { items, pagination } = normalizedPaged(payload, page, 12);
  const categories = knowledge.categories || [];
  const languages = uniqueLanguages(state.site?.languages || ["zh-CN", "zh-TW", "en"]);
  el.main.innerHTML = `
    <header class="article-head favorites-page-head">
      <div class="article-title-row"><h1>关注列表</h1><span class="quality-badge">${Number(pagination.total || 0)} 项</span></div>
      <p class="article-summary">关注词条、分类或语言，更新后将在消息中心提醒你。</p>
      <div class="editor-actions"><a class="command-button secondary" href="#/account">返回账户中心</a></div>
    </header>
    <section class="watchlist-controls">
      <form data-watch-form="page"><label>关注词条<input name="targetKey" placeholder="词条 slug，例如 abstract-algebra" required /></label><button class="command-button" type="submit">添加</button></form>
      <form data-watch-form="category"><label>关注分类<select name="targetKey">${categories.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${item.pageCount}</option>`).join("") || '<option value="">暂无分类</option>'}</select></label><button class="command-button secondary" type="submit">添加</button></form>
      <form data-watch-form="language"><label>关注译文语言<select name="targetKey">${languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(languageLabel(language))}</option>`).join("")}</select></label><button class="command-button secondary" type="submit">添加</button></form>
    </section>
    <section class="watch-list refined-search-results">${items.length ? items.map((item) => watchItemHtml(item)).join("") : '<div class="empty-state"><h2>尚未关注任何目标</h2><p class="muted-line">可以在词条标题旁关注，也可以在这里关注分类和译文语言。</p></div>'}</section>
    ${paginationHtml(pagination, "关注目标")}`;
  el.main.querySelectorAll("[data-watch-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const targetType = form.dataset.watchForm;
      const targetKey = new FormData(form).get("targetKey");
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        await saveWatch(targetType, targetKey, true);
        await refreshUser();
        uiToast("已加入关注列表");
        await renderWatchlist(String(page));
      } catch (error) {
        await uiAlert("关注失败", error.message, "error");
        button.disabled = false;
      }
    });
  });
  el.main.querySelectorAll("[data-remove-watch-type]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await saveWatch(button.dataset.removeWatchType, button.dataset.removeWatchKey, false);
        await refreshUser();
        uiToast("已取消关注");
        await renderWatchlist(String(page));
      } catch (error) {
        button.disabled = false;
        await uiAlert("操作失败", error.message, "error");
      }
    });
  });
  bindPagination(el.main, (nextPage) => { location.hash = `#/watchlist/${nextPage}`; });
}

function knowledgeHash(pages = {}) {
  const missing = Math.max(1, Number(pages.missing) || 1);
  const orphans = Math.max(1, Number(pages.orphans) || 1);
  return `#/knowledge?missing=${missing}&orphans=${orphans}`;
}

function knowledgePaginationHtml(pagination, label, pages, key) {
  const total = Number(pagination?.total || 0);
  const totalPages = Math.max(1, Number(pagination?.totalPages || 1));
  const page = Math.min(totalPages, Math.max(1, Number(pagination?.page || 1)));
  if (!total || totalPages <= 1) return total ? `<div class="pager pager-single"><span>共 ${total} 条</span></div>` : "";
  const previous = { ...pages, [key]: page - 1 };
  const next = { ...pages, [key]: page + 1 };
  return `<nav class="pager knowledge-pager" aria-label="${escapeHtml(label)}分页"><a class="${page <= 1 ? "disabled" : ""}" href="${knowledgeHash(previous)}" ${page <= 1 ? 'aria-disabled="true"' : ""}>上一页</a><span>第 ${page} / ${totalPages} 页 · 共 ${total} 条</span><a class="${page >= totalPages ? "disabled" : ""}" href="${knowledgeHash(next)}" ${page >= totalPages ? 'aria-disabled="true"' : ""}>下一页</a></nav>`;
}

async function renderKnowledge(value = "") {
  setChromeTitle("知识网络");
  renderToc([]);
  el.editLink.href = "#/new";
  const parsed = splitValueQuery(value);
  const listPages = {
    missing: Math.max(1, Number(parsed.params.get("missing")) || 1),
    orphans: Math.max(1, Number(parsed.params.get("orphans")) || 1),
  };
  const [payload, missingPayload, orphanPayload] = await Promise.all([
    api("/api/knowledge"),
    api(`/api/knowledge/missing?page=${listPages.missing}&limit=12`),
    api(`/api/knowledge/orphans?page=${listPages.orphans}&limit=12`),
  ]);
  const missing = normalizedPaged(missingPayload, listPages.missing, 12);
  const orphans = normalizedPaged(orphanPayload, listPages.orphans, 12);
  const stats = payload.stats || {};
  el.main.innerHTML = `
    <header class="article-head">
      <div class="article-title-row"><h1>知识网络</h1><span class="quality-badge">索引</span></div>
      <p class="article-summary">浏览反向链接、缺失词条、孤立词条、分类与别名。红色链接表示词条尚未创建。</p>
    </header>
    <section class="knowledge-metrics">
      ${[["词条", stats.pages], ["链接", stats.links], ["反向链接", stats.backlinks], ["缺失词条", stats.missing], ["孤立词条", stats.orphans], ["别名", stats.aliases]].map(([label, value]) => `<div><span>${label}</span><strong>${Number(value || 0)}</strong></div>`).join("")}
    </section>
    <section class="knowledge-directory-links"><a href="#/category">分类目录</a><a href="#/topic">主题树</a></section>
    <section class="knowledge-grid">
      <div class="knowledge-panel"><div class="section-title-row"><h2>缺失词条</h2><a class="mini-link" href="#/search/missing">搜索创建方向</a></div>${missing.items.length ? missing.items.map((item) => `<a class="knowledge-list-item is-missing" href="#/edit/${encodeSlug(item.slug)}"><span>被 ${item.sourceCount} 个词条引用</span><strong>${escapeHtml(item.label || item.slug)}</strong><small>${escapeHtml(item.slug)}</small></a>`).join("") : '<p class="muted-line">没有缺失词条。</p>'}${knowledgePaginationHtml(missing.pagination, "缺失词条", listPages, "missing")}</div>
      <div class="knowledge-panel"><div class="section-title-row"><h2>孤立词条</h2><span class="muted-line">尚无反向链接</span></div>${orphans.items.length ? orphans.items.map((item) => knowledgeLinkRow(item, "待关联")).join("") : '<p class="muted-line">没有孤立词条。</p>'}${knowledgePaginationHtml(orphans.pagination, "孤立词条", listPages, "orphans")}</div>
    </section>`;
}

function navigationPageCard(page) {
  return `<a class="result-item navigation-page-card" href="#/page/${encodeSlug(page.slug)}"><div class="search-result-body"><h2>${escapeHtml(page.title || page.slug)}</h2><p>${escapeHtml(page.summary || "暂无摘要。")}</p><div class="chip-row"><span class="chip">质量 ${escapeHtml(page.quality || "C")}</span><span class="chip">${escapeHtml(page.difficulty || "未分级")}</span>${(page.categories || []).slice(0, 3).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div></div></a>`;
}

function distributionChips(distribution = {}) {
  return Object.entries(distribution).sort(([a], [b]) => a.localeCompare(b)).map(([quality, count]) => `<span class="chip">${escapeHtml(quality)} · ${Number(count)}</span>`).join("") || '<span class="chip">暂无统计</span>';
}

function taxonomyHash(kind, name = "", params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "" && !(key === "page" && Number(value) === 1) && !(key === "childPage" && Number(value) === 1)) query.set(key, String(value));
  });
  return `#/${kind}${name ? `/${encodeURIComponent(name)}` : ""}${query.toString() ? `?${query.toString()}` : ""}`;
}

function taxonomyPaginationHtml(pagination, label, hrefFor) {
  const total = Number(pagination?.total || 0);
  const totalPages = Math.max(1, Number(pagination?.totalPages || 1));
  const page = Math.min(totalPages, Math.max(1, Number(pagination?.page || 1)));
  if (!total || totalPages <= 1) return "";
  return `<nav class="pager taxonomy-pager" aria-label="${escapeHtml(label)}分页"><a class="${page <= 1 ? "disabled" : ""}" href="${page <= 1 ? "#" : hrefFor(page - 1)}" ${page <= 1 ? 'aria-disabled="true"' : ""}>上一页</a><span>第 ${page} / ${totalPages} 页 · 共 ${total} 项</span><a class="${page >= totalPages ? "disabled" : ""}" href="${page >= totalPages ? "#" : hrefFor(page + 1)}" ${page >= totalPages ? 'aria-disabled="true"' : ""}>下一页</a></nav>`;
}

function taxonomyDirectoryResult(item, kind = "category") {
  const label = item.label || item.name;
  const title = kind === "topic" ? "主题" : "分类";
  return `<a class="result-item taxonomy-directory-result" href="${taxonomyHash(kind, item.name)}"><div class="search-result-body"><span class="system-kicker">${title}路径</span><h2>${escapeHtml(label)}</h2><p>${escapeHtml(item.name)} · 直接收录 ${Number(item.directPageCount || 0)} 篇，累计覆盖 ${Number(item.pageCount || 0)} 篇词条。</p><div class="chip-row">${distributionChips(item.qualities || {})}</div></div><span class="taxonomy-result-count"><strong>${Number(item.pageCount || 0)}</strong><small>词条</small></span></a>`;
}

async function renderCategory(value = "") {
  const parsed = splitValueQuery(value);
  const name = parsed.pathValue || "";
  const query = parsed.params.get("q") || "";
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const childPage = Math.max(1, Number(parsed.params.get("childPage")) || 1);
  const request = new URLSearchParams({ q: query, page: String(page), limit: "12" });
  if (name) request.set("name", name);
  if (name) { request.set("childPage", String(childPage)); request.set("childLimit", "12"); }
  const payload = await api(`/api/categories?${request.toString()}`);
  setChromeTitle(name ? `分类：${name}` : "分类目录");
  renderToc([]);
  el.editLink.href = "#/new";
  if (!name) {
    const items = payload.categories || [];
    const pagination = payload.pagination || {};
    const href = (next, values = {}) => taxonomyHash("category", "", { q: query, page: next, ...values });
    el.main.innerHTML = `<header class="article-head taxonomy-head"><div class="article-title-row"><h1>分类目录</h1><span class="quality-badge">Knowledge Map</span></div><p class="article-summary">按学科浏览词条，或搜索分类路径。</p></header><section class="taxonomy-workbench"><form class="taxonomy-filter-form" id="categoryDirectorySearch"><label><span>检索分类</span><input name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索分类路径" /></label><button class="command-button" type="submit">筛选目录</button></form><div class="taxonomy-result-meta"><span>根分类</span><span>${Number(pagination.total || 0)} 项</span></div><section class="search-results taxonomy-results taxonomy-directory-results">${items.length ? items.map((item) => taxonomyDirectoryResult(item)).join("") : '<section class="empty-state"><h2>没有匹配的分类</h2><p>调整检索词，或在词条编辑时添加分类。</p></section>'}</section>${taxonomyPaginationHtml(pagination, "分类目录", (next) => href(next))}</section>`;
    document.querySelector("#categoryDirectorySearch")?.addEventListener("submit", (event) => { event.preventDefault(); location.hash = href(1, { q: new FormData(event.currentTarget).get("q") || "" }); });
    return;
  }
  const ancestors = (payload.ancestors || []).map((item) => `<a href="#/category/${encodeURIComponent(item)}">${escapeHtml(item)}</a>`).join("<span>/</span>");
  const children = payload.children || [];
  const pages = payload.pages || [];
  const pagePagination = payload.pagination || {};
  const childPagination = payload.childrenPagination || {};
  const href = (nextPage = page, values = {}) => taxonomyHash("category", name, { q: query, page: nextPage, childPage, ...values });
  el.main.innerHTML = `<header class="article-head taxonomy-head"><div class="taxonomy-breadcrumbs"><a href="#/category">分类目录</a>${ancestors ? `<span>/</span>${ancestors}` : ""}</div><div class="article-title-row"><h1>${escapeHtml(payload.name || name)}</h1><span class="quality-badge">${Number(pagePagination.total || 0)} 个直接词条</span></div><p class="article-summary">浏览该分类下的子分类、主题与词条。</p><div class="chip-row">${distributionChips(payload.qualityDistribution)}</div></header><section class="taxonomy-workbench"><form class="taxonomy-filter-form" id="categoryDetailSearch"><label><span>筛选本分类</span><input name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索子分类或词条" /></label><button class="command-button" type="submit">筛选</button></form>${children.length ? `<section class="taxonomy-subsection"><div class="section-title-row"><h2>子分类</h2><span>${Number(childPagination.total || 0)} 项</span></div><section class="search-results taxonomy-results taxonomy-directory-results">${children.map((item) => taxonomyDirectoryResult(item)).join("")}</section>${taxonomyPaginationHtml(childPagination, "子分类", (next) => href(page, { childPage: next }))}</section>` : ""}${payload.topics?.length ? `<section class="taxonomy-subsection"><div class="section-title-row"><h2>关联主题</h2></div><div class="chip-row">${payload.topics.map((topic) => `<a class="topic-chip" href="#/topic/${encodeURIComponent(topic)}">${escapeHtml(topic)}</a>`).join("")}</div></section>` : ""}<section class="taxonomy-subsection"><div class="section-title-row"><h2>直接词条</h2><span>${Number(pagePagination.total || 0)} 篇</span></div><section class="search-results taxonomy-results">${pages.length ? pages.map(navigationPageCard).join("") : '<section class="empty-state"><h2>该分类尚无匹配词条</h2><p>浏览子分类，或编辑词条并加入此分类。</p></section>'}</section>${taxonomyPaginationHtml(pagePagination, "分类词条", (next) => href(next))}</section></section>`;
  document.querySelector("#categoryDetailSearch")?.addEventListener("submit", (event) => { event.preventDefault(); location.hash = href(1, { q: new FormData(event.currentTarget).get("q") || "", childPage: 1 }); });
}

async function renderTopic(value = "") {
  const name = splitValueQuery(value).pathValue || "";
  const payload = await api(`/api/topics${name ? `?name=${encodeURIComponent(name)}` : ""}`);
  setChromeTitle(name ? `主题：${name}` : "主题树");
  renderToc([]);
  el.editLink.href = "#/new";
  if (!name) {
    const topics = payload.topics || [];
    el.main.innerHTML = `<header class="article-head taxonomy-head"><div class="article-title-row"><h1>主题树</h1><span class="quality-badge">Topic Map</span></div><p class="article-summary">按主题路径浏览跨分类的数学内容。</p></header><section class="taxonomy-grid">${topics.length ? topics.map((item) => `<a class="taxonomy-card" href="#/topic/${encodeURIComponent(item.name)}"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.pageCount)} 个词条</span><div class="chip-row">${distributionChips(item.qualities)}</div></a>`).join("") : '<section class="empty-state"><h2>暂无主题</h2><p>编辑词条并填写主题路径。</p></section>'}</section>`;
    return;
  }
  const children = payload.children || [];
  const pages = payload.pages || [];
  el.main.innerHTML = `<header class="article-head taxonomy-head"><div class="taxonomy-breadcrumbs"><a href="#/topic">主题树</a></div><div class="article-title-row"><h1>${escapeHtml(payload.name || name)}</h1><span class="quality-badge">${pages.length} 个词条</span></div><div class="chip-row">${distributionChips(payload.qualityDistribution)}</div></header>${children.length ? `<section class="taxonomy-subsection"><div class="section-title-row"><h2>子主题</h2></div><div class="taxonomy-grid compact">${children.map((item) => `<a class="taxonomy-card" href="#/topic/${encodeURIComponent(item.name)}"><strong>${escapeHtml(item.label || item.name)}</strong><span>${Number(item.pageCount)} 个词条</span></a>`).join("")}</div></section>` : ""}<section class="search-results taxonomy-results">${pages.length ? pages.map(navigationPageCard).join("") : '<section class="empty-state"><h2>该主题尚无直接词条</h2><p>在词条编辑器填写主题路径，即可将其加入这里。</p></section>'}</section>`;
}

function accountWatchesHtml(items = [], total = 0) {
  return `
    <section class="auth-panel compact watches-panel" id="accountWatches">
      <div class="panel-heading-row"><div><h2>我的关注</h2><p class="muted-line">词条、分类和译文语言的变化会进入消息中心。</p></div><span class="favorite-count-badge">${Number(total || 0)}</span></div>
      <div class="watch-list compact">${items.length ? items.slice(0, 6).map((item) => watchItemHtml(item, true)).join("") : '<div class="favorite-empty"><strong>还没有关注目标</strong><span>在词条标题旁点击关注，或进入关注列表管理分类与语言。</span></div>'}</div>
      <div class="watchlist-manage-action"><a class="watchlist-manage-button" href="#/watchlist">管理关注列表</a></div>
    </section>`;
}

function accountCommunityLibraryHtml(collectionPayload = {}, followPayload = {}) {
  const collections = collectionPayload.items || [];
  const follows = followPayload.items || [];
  const row = (item, kind) => `<a class="account-community-library-item" href="${escapeHtml(item.url || "#/questions")}"><span>${navigationIconSvg(kind === "collection" ? "bookmark" : "pulse")}</span><div><strong>${escapeHtml(item.title || "社区内容")}</strong><small>${escapeHtml(shortText(item.summary || (item.type === "tag" ? "社区标签" : "问答内容"), 90))}</small></div></a>`;
  const panel = ({ className, title, description, total, items, kind, empty, href, action }) => `<section class="auth-panel compact account-community-library-panel ${className}"><div class="panel-heading-row"><div><h2>${title}</h2><p class="muted-line">${description}</p></div><span class="account-community-library-count">${Number(total || 0)} 条</span></div><div class="account-community-library-list">${items.length ? items.slice(0, 3).map((item) => row(item, kind)).join("") : `<p class="muted-line">${empty}</p>`}</div><div class="watchlist-manage-action"><a class="watchlist-manage-button" href="${href}">${action}</a></div></section>`;
  return `${panel({ className: "is-collection", title: "社区收藏", description: "保存准备继续阅读或整理的问答。", total: collectionPayload.total, items: collections, kind: "collection", empty: "还没有收藏问答内容。", href: "#/questions/collections", action: "管理社区收藏" })}${panel({ className: "is-follow", title: "社区关注", description: "跟进问题、回答与标签更新。", total: followPayload.total, items: follows, kind: "follow", empty: "还没有关注问题或标签。", href: "#/questions/follows", action: "管理社区关注" })}`;
}

function accountSecurityHtml(user = {}, preferences = {}) {
  const emailState = user.emailVerified ? "已验证" : "未验证";
  const twoFactorState = user.twoFactorEnabled ? "已开启" : "未开启";
  const directMessageState = preferences.openMode ? "开放私信" : "请求模式";
  const autoReplyState = preferences.autoReplyEnabled ? "自动回复已开启" : "自动回复已关闭";
  return `
    <section class="auth-panel compact security-panel" id="accountSecurityPanel">
      <div class="panel-heading-row"><div><h2>安全中心</h2><p class="muted-line">邮箱验证、找回密码和二次验证统一在这里管理。</p></div><span class="security-score">${user.emailVerified && user.twoFactorEnabled ? "强" : "待加强"}</span></div>
      <div class="security-check-list">
        <span class="${user.emailVerified ? "ok" : "warn"}">邮箱 ${emailState}</span>
        <span class="${user.twoFactorEnabled ? "ok" : "warn"}">二次验证 ${twoFactorState}</span>
        <span class="ok">密码 scrypt 加密</span>
      </div>
      <div class="editor-actions security-actions">
        ${user.email && !user.emailVerified ? '<button class="command-button secondary" type="button" id="sendVerificationEmail">发送验证邮件</button>' : ""}
        ${user.twoFactorEnabled ? '<button class="command-button secondary" type="button" id="disableTwoFactor">关闭二次验证</button>' : '<button class="command-button" type="button" id="setupTwoFactor">开启二次验证</button>'}
      </div>
      <section class="account-messaging-summary" aria-labelledby="accountMessagingTitle">
        <div class="account-messaging-copy"><span class="system-kicker">Messaging</span><strong id="accountMessagingTitle">通信设置</strong><small>${escapeHtml(directMessageState)} · ${escapeHtml(autoReplyState)}</small></div>
        <button class="command-button secondary" id="accountMessagingPreferences" type="button">管理通信设置</button>
      </section>
      <div class="two-factor-setup" id="twoFactorSetupBox" hidden></div>
      <div class="status-line" id="securityStatus"></div>
    </section>`;
}

function accountProfilePanelHtml(user = {}) {
  return `<form class="auth-panel compact profile-panel" id="profileForm">
    <h2>公开资料</h2>
    <label>显示名称<input name="displayName" value="${escapeHtml(user.displayName || "")}" required /></label>
    <label>邮箱<input name="email" type="email" value="${escapeHtml(user.email || "")}" /></label>
    <label>头像地址<input name="avatarUrl" value="${escapeHtml(user.avatarUrl || "")}" placeholder="https://..." /></label>
    <label>简介<input name="bio" value="${escapeHtml(user.bio || "")}" maxlength="500" /></label>
    ${profileSocialFields(user.socialLinks)}
    <label class="profile-markdown-field">个人 Markdown 页面<textarea class="profile-markdown" name="pageMd" spellcheck="false">${escapeHtml(user.pageMd || "")}</textarea></label>
    <button class="command-button" type="submit">保存资料</button>
    <div class="status-line" id="profileStatus"></div>
  </form>`;
}

function accountPasswordPanelHtml() {
  return `<form class="auth-panel compact password-panel" id="passwordForm">
    <h2>修改密码</h2>
    <p class="muted-line">修改后会退出当前登录，请使用新密码重新进入通行证。</p>
    <label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required /></label>
    <label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
    <label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
    <button class="command-button" type="submit">更新密码</button>
    <div class="status-line" id="passwordStatus"></div>
  </form>`;
}

function accountTranslatorPanelHtml(user = {}) {
  return `<form class="auth-panel compact translator-panel" id="translatorJoinForm">
    <h2>翻译社区</h2>
    <p class="muted-line">${user.translator ? `已加入，目标语言：${(user.translator.languages || []).map(languageLabel).join("、")}` : "加入后可在词条翻译页保存译文并参与社区审阅。"}</p>
    ${translatorLanguagePicker(user.translator?.languages || ["en", "zh-TW"])}
    <div class="translator-panel-actions"><button class="command-button" type="submit">${user.translator ? "更新翻译语言" : "加入翻译社区"}</button><a class="command-button secondary translator-glossary-button" href="#/translation-glossary">翻译术语表</a>${user.translator ? '<button class="command-button secondary translator-leave-button" id="translatorLeaveButton" type="button">退出翻译社区</button>' : ""}</div>
    <div class="status-line" id="translatorJoinStatus"></div>
  </form>`;
}

function selectionSnapshotFromRecord(selection) {
  return {
    selection: {
      id: Number(selection.id || 0),
      canDelete: Boolean(selection.canDelete),
    },
    object: {
      type: selection.objectType,
      id: selection.objectId,
      label: selection.objectLabel,
      url: selection.objectUrl,
      pageSlug: selection.objectType === "wiki_entry" ? selection.objectId : "",
    },
    selector: {
      exact: selection.selectedText,
      prefix: selection.prefixText || "",
      suffix: selection.suffixText || "",
      start: Number(selection.startOffset || 0),
      end: Number(selection.endOffset || 0),
    },
  };
}

function selectionActivityLabel(activity = {}) {
  if (activity.type === "like") return "喜欢";
  return "批注";
}

function selectionSourceUrl(selection = {}) {
  const base = String(selection.objectUrl || "");
  if (!base.startsWith("#/")) return "#/account?section=highlights";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}selection=${encodeURIComponent(Number(selection.id) || 0)}`;
}

function accountSelectionItemHtml(selection, index = 0) {
  const sourceUrl = selectionSourceUrl(selection);
  const activity = selection.activity || { type: selection.commented ? "comment" : "like", createdAt: selection.updatedAt };
  const activityNote = activity.type === "comment" && activity.targetLabel
    ? `<p class="account-selection-activity-note"><strong>我的批注</strong><span>${escapeHtml(shortText(activity.targetLabel, 220))}</span></p>`
    : "";
  const unlikeButton = activity.type === "like" ? '<button class="mini-button account-selection-unlike" type="button" data-unlike-account-selection><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="m8 8 8 8"/></svg><span>取消喜欢</span></button>' : "";
  const deleteCommentButton = activity.type === "comment" && Number(activity.targetId || activity.id) > 0
    ? `<button class="mini-button danger account-selection-comment-delete" type="button" data-delete-account-comment="${Number(activity.targetId || activity.id)}">${navigationIconSvg("delete")}<span>删除批注</span></button>`
    : "";
  const deleteButton = selection.canDelete ? '<button class="mini-button danger account-selection-delete" type="button" data-delete-account-selection><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg><span>删除划词</span></button>' : "";
  return `<article class="result-item search-result-card account-selection-item" data-account-selection-index="${index}" style="--result-index:${index + 1}"><div class="search-result-rank">${index + 1}</div><div class="search-result-body"><div class="selection-activity-heading"><div class="account-selection-primary"><span class="selection-activity-badge is-${escapeHtml(activity.type || "like")}">${escapeHtml(selectionActivityLabel(activity))}</span><a class="account-selection-source" href="${escapeHtml(sourceUrl)}"><h2>${escapeHtml(selection.objectLabel || selection.objectId)}</h2><blockquote>${escapeHtml(shortText(selection.selectedText, 420))}</blockquote>${activityNote}<div class="chip-row"><span class="chip">${Number(selection.commentCount || 0)} 条批注</span><span class="chip">${Number(selection.likeCount || 0)} 人喜欢</span></div></a></div><div class="account-selection-meta"><small>${fmtDate(activity.createdAt || selection.updatedAt)}</small><div class="account-selection-actions"><button class="mini-button" type="button" data-open-account-selection>${navigationIconSvg("comments")}<span>查看批注</span></button>${unlikeButton}${deleteCommentButton}${deleteButton}</div></div></div></div></article>`;
}

function accountSelectionsPanelHtml(payload, mode = "all") {
  const { items, pagination } = normalizedPaged(payload || {}, Number(payload?.pagination?.page || 1), 12);
  const filters = [["all", "全部"], ["liked", "喜欢"], ["commented", "批注"]];
  return `<section class="account-selections-panel"><nav class="account-selection-filters" aria-label="我的划词筛选">${filters.map(([id, label]) => `<a class="${id === mode ? "active" : ""}" href="#/account?section=highlights&mode=${id}">${label}</a>`).join("")}</nav><div class="account-selection-list refined-search-results" id="accountSelectionList">${items.length ? items.map(accountSelectionItemHtml).join("") : '<div class="empty-state"><h2>还没有划词记录</h2><p>喜欢正文或发布批注后，记录会出现在这里。</p></div>'}</div><div id="accountSelectionPager">${paginationHtml(pagination, "我的划词")}</div></section>`;
}

function achievementIconSvg(icon = "") {
  const value = String(icon || "").toLowerCase();
  if (value.includes("language")) return navigationIconSvg("translate");
  if (value.includes("message") || value.includes("answer")) return navigationIconSvg("comments");
  if (value.includes("bookmark")) return navigationIconSvg("bookmark");
  if (value.includes("user")) return navigationIconSvg("community");
  if (value.includes("network")) return navigationIconSvg("network");
  if (value.includes("file") || value.includes("library") || value.includes("highlight")) return navigationIconSvg("article");
  if (value.includes("radar")) return navigationIconSvg("pulse");
  return navigationIconSvg("review");
}

function accountAchievementsPanelHtml(payload = {}) {
  const summary = payload.summary || { earned: 0, total: 0, points: 0, completion: 0 };
  const items = Array.isArray(payload.items) ? payload.items : [];
  const timeline = payload.timeline || { items: [], page: 1, pages: 1, total: 0 };
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  return `<section class="account-achievements" style="--achievement-progress:${Math.max(0, Math.min(100, Number(summary.completion || 0)))}%">
    <header class="achievement-overview">
      <div class="achievement-progress-ring"><strong>${Number(summary.completion || 0)}%</strong><span>成长进度</span></div>
      <div class="achievement-overview-copy"><span class="system-kicker">Wikist Growth</span><h3>知识成长历程</h3><p>持续创作、协作和交流，解锁覆盖全站的贡献成就。</p><div class="achievement-summary-metrics"><span><strong>${Number(summary.earned || 0)}</strong><small>已解锁</small></span><span><strong>${Number(summary.total || 0)}</strong><small>全部成就</small></span><span><strong>${Number(summary.points || 0)}</strong><small>成长点数</small></span></div></div>
    </header>
    ${categories.length ? `<div class="achievement-category-row">${categories.map((category) => `<span>${escapeHtml(category)}</span>`).join("")}</div>` : ""}
    <div class="achievement-grid">${items.length ? items.map((item) => `<article class="achievement-card ${item.earned ? "is-earned" : "is-locked"}">
      <span class="achievement-card-icon">${achievementIconSvg(item.icon)}</span>
      <div class="achievement-card-copy"><div><span class="achievement-level is-${escapeHtml(item.level || "bronze")}">${item.earned ? "已解锁" : escapeHtml(item.level || "bronze")}</span><small>${escapeHtml(item.category || "知识成长")}</small></div><h3>${escapeHtml(item.name || "未命名成就")}</h3><p>${escapeHtml(item.description || "")}</p></div>
      <footer><div class="achievement-progress-track"><i style="width:${Math.max(0, Math.min(100, Number(item.progress || 0)))}%"></i></div><span>${Number(item.current || 0)} / ${Number(item.threshold || 1)}</span>${item.earned && item.awardedAt ? `<time>${fmtDate(item.awardedAt)}</time>` : ""}</footer>
    </article>`).join("") : '<div class="empty-state"><h2>成就正在准备</h2><p>完成一次知识贡献后再来看看。</p></div>'}</div>
    <section class="achievement-timeline"><header><div><span class="system-kicker">Growth Timeline</span><h3>解锁记录</h3></div><span>${Number(timeline.total || 0)} 项</span></header><div>${(timeline.items || []).length ? timeline.items.map((item) => `<article><span class="achievement-timeline-mark">${achievementIconSvg(item.icon || "review")}</span><div><strong>${escapeHtml(item.name || "成就")}</strong><p>${escapeHtml(item.description || "")}</p><small>${escapeHtml(item.category || "知识成长")} · +${Number(item.points || 0)} 点</small></div><time>${fmtDate(item.awardedAt)}</time></article>`).join("") : '<p class="muted-line">完成第一项贡献后，成长记录会出现在这里。</p>'}</div><div id="accountAchievementPager">${paginationHtml(timeline, "成就记录")}</div></section>
  </section>`;
}

function accountSectionTabs(active = "profile") {
  const items = [
    ["profile", "公开资料", "community"],
    ["security", "安全中心", "workspace"],
    ["identity", "社区身份", "network"],
    ["library", "收藏与关注", "category"],
    ["achievements", "成就", "review"],
    ["highlights", "我的划词", "article"],
  ];
  return `<nav class="account-section-tabs" aria-label="账户中心分区">${items.map(([id, label, icon]) => `<a class="${id === active ? "active" : ""}" href="#/account?section=${id}" ${id === active ? 'aria-current="page"' : ""}>${navigationIconSvg(icon)}<span>${label}</span></a>`).join("")}</nav>`;
}

async function renderAccount(value = "") {
  await refreshUser();
  setChromeTitle("账户中心");
  renderToc([]);
  el.editLink.href = "#/new";
  if (!state.user) { location.hash = "#/login"; return; }
  const requestedSection = splitValueQuery(value).params.get("section") || "profile";
  const accountSection = ["profile", "security", "identity", "library", "achievements", "highlights"].includes(requestedSection) ? requestedSection : "profile";
  const selectionMode = ["all", "liked", "commented"].includes(splitValueQuery(value).params.get("mode")) ? splitValueQuery(value).params.get("mode") : "all";
  const selectionPage = Math.max(1, Number(splitValueQuery(value).params.get("page")) || 1);
  const [watchPayload, communityCollections, communityFollows] = accountSection === "library"
    ? await Promise.all([
        api("/api/passport/watches?limit=8").catch(() => ({ items: [] })),
        api("/api/community/qa/collections?page=1&limit=3").catch(() => ({ items: [], total: 0 })),
        api("/api/community/qa/follows?page=1&limit=3").catch(() => ({ items: [], total: 0 })),
      ])
    : [{ items: [] }, { items: [], total: 0 }, { items: [], total: 0 }];
  const accountWatches = watchPayload.items || [];
  const selectionPayload = accountSection === "highlights" ? await api(`/api/selections/mine?mode=${encodeURIComponent(selectionMode)}&page=${selectionPage}&limit=12`).catch(() => ({ items: [], pagination: { page: selectionPage, pageSize: 12, total: 0, totalPages: 1 } })) : { items: [] };
  const achievementPayload = accountSection === "achievements" ? await api(`/api/passport/achievements?page=${selectionPage}&limit=12`).catch(() => ({ summary: { earned: 0, total: 0, points: 0, completion: 0 }, items: [], timeline: { items: [], page: selectionPage, pages: 1, total: 0 } })) : {};
  if (accountSection === "security") await loadMessagingPreferences();
  const accountRole = state.user.groupLabel || GROUP_LABELS[state.user.role] || state.user.role;
  const sectionMeta = {
    profile: ["Public Identity", "公开资料", "编辑头像、简介、外部资料与公开主页。"],
    security: ["Passport Security", "安全中心", "管理邮箱验证、二次验证和登录密码。"],
    identity: ["Academic Identity", "社区身份", "管理翻译语言与协作组织身份。"],
    library: ["Personal Library", "收藏与关注", "管理收藏词条与更新提醒。"],
    achievements: ["Growth Record", "成就", "查看知识创作、协作与社区成长历程。"],
    highlights: ["Text Highlights", "我的划词", "查看喜欢的正文和已发布批注。"],
  }[accountSection];
  const sectionBody = accountSection === "profile"
    ? `<section class="account-section-single">${accountProfilePanelHtml(state.user)}</section>`
    : accountSection === "security"
      ? `<section class="account-section-grid account-security-grid">${accountSecurityHtml(state.user, messagingPreferences)}${accountPasswordPanelHtml()}</section>`
      : accountSection === "identity"
        ? `<section class="account-section-grid account-identity-grid">${accountTranslatorPanelHtml(state.user)}${organizationIdentityPanelHtml(state.user.organizations || [], Number(state.user.stats?.organizations || 0))}</section>`
        : accountSection === "library"
          ? `<section class="account-section-grid account-library-grid">${accountFavoritesHtml(state.user.favorites || [], Number(state.user.stats?.favorites || 0))}${accountWatchesHtml(accountWatches, Number(state.user.stats?.watches || 0))}${accountCommunityLibraryHtml(communityCollections, communityFollows)}</section>`
          : accountSection === "achievements"
            ? `<section class="account-section-single account-achievement-section">${accountAchievementsPanelHtml(achievementPayload)}</section>`
            : `<section class="account-section-single">${accountSelectionsPanelHtml(selectionPayload, selectionMode)}</section>`;
  el.main.innerHTML = `
    <header class="article-head profile-hero account-profile-hero">
      <div class="profile-hero-main">${avatarHtml(state.user, "large")}<div class="profile-hero-copy"><span class="system-kicker">${escapeHtml(currentPassportName())}</span><h1>${escapeHtml(state.user.displayName || state.user.username)}</h1><p>@${escapeHtml(state.user.username)} · ${escapeHtml(accountRole)}</p></div></div>
      <div class="profile-hero-actions"><a class="command-button" href="#/user/${encodeURIComponent(state.user.username)}">查看公开主页</a>${canAccessAdmin() ? '<a class="command-button secondary" href="#/admin/overview">进入后台</a>' : ""}<button class="command-button secondary" id="logoutButton" type="button">退出登录</button></div>
      <div class="profile-metric-strip"><a href="#/following?direction=followers"><strong>${Number(state.user.stats?.followers || 0)}</strong><span>关注者</span></a><a href="#/following?direction=following"><strong>${Number(state.user.stats?.following || 0)}</strong><span>正在关注</span></a><span><strong>${Number(state.user.stats?.edits || 0)}</strong><span>编辑</span></span><span><strong>${Number(state.user.stats?.favorites || 0)}</strong><span>收藏</span></span><span><strong>${Number(state.user.stats?.watches || 0)}</strong><span>关注词条</span></span></div>
      ${socialLinksHtml(state.user.socialLinks, "public")}
    </header>
    ${accountSectionTabs(accountSection)}
    <section class="account-section-shell"><header class="account-section-head"><span class="system-kicker">${sectionMeta[0]}</span><h2>${sectionMeta[1]}</h2><p>${sectionMeta[2]}</p></header>${sectionBody}</section>`;
  document.querySelector("#logoutButton").addEventListener("click", () => logoutSiteSession(passportUrl("login")));
  document.querySelector("#accountMessagingPreferences")?.addEventListener("click", () => openMessagingPreferencesDialog({
    onSaved: async () => renderAccount(value),
  }));
  document.querySelector("#accountFavorites")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-favorite]");
    if (!button) return;
    const slug = button.dataset.removeFavorite;
    button.disabled = true;
    try {
      await api(`/api/pages/${encodeSlug(slug)}/favorite`, { method: "PUT", body: JSON.stringify({ favorited: false }) });
      await refreshUser();
      uiToast("已取消收藏");
      await renderAccount(value);
    } catch (error) {
      button.disabled = false;
      await uiAlert("操作失败", error.message, "error");
    }
  });
  document.querySelector("#accountWatches")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-watch-type]");
    if (!button) return;
    button.disabled = true;
    try {
      await saveWatch(button.dataset.removeWatchType, button.dataset.removeWatchKey, false);
      await refreshUser();
      uiToast("已取消关注");
      await renderAccount(value);
    } catch (error) {
      button.disabled = false;
      await uiAlert("操作失败", error.message, "error");
    }
  });
  document.querySelector("#accountSelectionList")?.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-account-selection-index]");
    if (!item) return;
    const selection = (selectionPayload.items || [])[Number(item.dataset.accountSelectionIndex)];
    if (!selection) return;
    if (event.target.closest("[data-open-account-selection]")) {
      await openSelectionAnnotationDialog(selectionSnapshotFromRecord(selection));
      return;
    }
    const unlike = event.target.closest("[data-unlike-account-selection]");
    if (unlike) {
      unlike.disabled = true;
      try {
        await selectionApiClient.like(selection.id, false);
        uiToast("已取消喜欢");
        await renderAccount(value);
      } catch (error) {
        unlike.disabled = false;
        await uiAlert("操作失败", error.message, "error");
      }
      return;
    }
    const removeComment = event.target.closest("[data-delete-account-comment]");
    if (removeComment) {
      const commentId = Number(removeComment.dataset.deleteAccountComment || 0);
      const confirmed = await uiConfirm({
        title: "删除这条批注？",
        text: "批注删除后不会再出现在正文和我的划词中。",
        confirmText: "删除批注",
        danger: true,
      });
      if (!confirmed) return;
      removeComment.disabled = true;
      try {
        await selectionApiClient.deleteComment(selection.id, commentId);
        uiToast("批注已删除");
        await renderAccount(value);
      } catch (error) {
        removeComment.disabled = false;
        await uiAlert("删除失败", error.message, "error");
      }
      return;
    }
    const remove = event.target.closest("[data-delete-account-selection]");
    if (remove) {
      const confirmed = await uiConfirm({
        title: "删除划词？",
        text: "你的喜欢和批注会一并移除；其他用户已经参与时，他们的内容仍会保留。",
        confirmText: "删除划词",
        danger: true,
      });
      if (!confirmed) return;
      remove.disabled = true;
      try {
        const result = await selectionApiClient.delete(selection.id);
        uiToast(result.preserved ? "你的划词已删除，其他用户的内容仍保留" : "划词已删除");
        await renderAccount(value);
      } catch (error) {
        remove.disabled = false;
        await uiAlert("删除失败", error.message, "error");
      }
    }
  });
  bindPagination(document.querySelector("#accountSelectionPager") || document.createElement("div"), (nextPage) => {
    location.hash = `#/account?section=highlights&mode=${encodeURIComponent(selectionMode)}&page=${nextPage}`;
  });
  bindPagination(document.querySelector("#accountAchievementPager") || document.createElement("div"), (nextPage) => {
    location.hash = `#/account?section=achievements&page=${nextPage}`;
  });
  document.querySelector("#sendVerificationEmail")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = document.querySelector("#securityStatus");
    button.disabled = true;
    status.textContent = "正在发送验证邮件...";
    try {
      const result = await api("/api/passport/email/verification", { method: "POST", body: JSON.stringify({}) });
      status.textContent = result.mail?.messageId ? "验证邮件已发送，请检查邮箱。" : "验证邮件请求已提交。";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#setupTwoFactor")?.addEventListener("click", async () => {
    const status = document.querySelector("#securityStatus");
    const box = document.querySelector("#twoFactorSetupBox");
    status.textContent = "正在生成二次验证密钥...";
    try {
      const result = await api("/api/passport/security/2fa/setup", { method: "POST", body: JSON.stringify({}) });
      const qrCodeDataUri = /^data:image\/(?:svg\+xml|png);base64,/i.test(String(result.qrCodeDataUri || ""))
        ? String(result.qrCodeDataUri)
        : "";
      box.hidden = false;
      box.innerHTML = `<div class="two-factor-enrollment">
        ${qrCodeDataUri ? `<figure class="two-factor-qr"><img src="${escapeHtml(qrCodeDataUri)}" alt="二次验证设置二维码" width="240" height="240" /><figcaption>使用验证器应用扫码</figcaption></figure>` : ""}
        <div class="two-factor-enrollment-body">
          <div><span class="system-kicker">TOTP SECURITY</span><h3>连接验证器</h3><p class="muted-line">使用任意兼容 TOTP 的验证器扫描二维码，再输入应用中显示的 6 位动态码。</p></div>
          <form id="enableTwoFactorForm" class="two-factor-confirm"><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 位动态码" aria-label="6 位动态码" required /><button class="command-button" type="submit">确认启用</button></form>
          <details class="two-factor-manual" ${qrCodeDataUri ? "" : "open"}><summary>无法扫码？使用密钥手动添加</summary><code>${escapeHtml(result.secret)}</code><textarea readonly aria-label="TOTP 配置链接">${escapeHtml(result.otpauthUrl)}</textarea></details>
        </div>
      </div>`;
      status.textContent = "";
      document.querySelector("#enableTwoFactorForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
        status.textContent = "正在启用...";
        try {
          await api("/api/passport/security/2fa/enable", { method: "POST", body: JSON.stringify(payload) });
          await refreshUser();
          await renderAccount(value);
        } catch (error) {
          status.textContent = error.message;
        }
      });
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#disableTwoFactor")?.addEventListener("click", async () => {
    const currentPassword = await uiPrompt({ title: "关闭二次验证", text: "请输入当前密码。", confirmText: "继续" });
    if (currentPassword === null) return;
    const code = await uiPrompt({ title: "动态验证码", text: "请输入当前 6 位 TOTP 动态码。", confirmText: "关闭" });
    if (code === null) return;
    const status = document.querySelector("#securityStatus");
    status.textContent = "正在关闭二次验证...";
    try {
      await api("/api/passport/security/2fa/disable", { method: "POST", body: JSON.stringify({ currentPassword, code }) });
      await refreshUser();
      await renderAccount(value);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#translatorJoinForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#translatorJoinStatus");
    const data = new FormData(event.currentTarget);
    const languages = uniqueLanguages([
      ...data.getAll("languages"),
      ...String(data.get("customLanguages") || "").split(/[,\n，、\s]+/),
    ]).filter((lang) => lang !== "zh-CN");
    status.textContent = "正在保存...";
    try {
      const result = await api("/api/passport/translation/join", { method: "POST", body: JSON.stringify({ languages }) });
      state.user.translator = result.translator;
      status.textContent = "翻译社区资料已更新。";
      await refreshUser();
      await renderAccount(value);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#translatorLeaveButton")?.addEventListener("click", async () => {
    const accepted = await uiConfirm({
      title: "退出翻译社区",
      text: "已保存的译文与审阅记录会保留；再次加入后可以继续参与翻译。",
      confirmText: "确认退出",
      danger: true,
    });
    if (!accepted) return;
    const status = document.querySelector("#translatorJoinStatus");
    status.textContent = "正在退出...";
    try {
      await api("/api/passport/translation/join", { method: "DELETE" });
      state.user.translator = null;
      await refreshUser();
      uiToast("已退出翻译社区");
      await renderAccount(value);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#profileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#profileStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.socialLinks = readProfileSocialLinks(event.currentTarget);
    const submittedSocialLinks = Object.values(payload.socialLinks).some(Boolean);
    status.textContent = "正在保存...";
    try {
      const result = await api("/api/passport/profile", { method: "PUT", body: JSON.stringify(payload) });
      if (submittedSocialLinks && !Object.prototype.hasOwnProperty.call(result.user || {}, "socialLinks")) {
        status.textContent = "服务器尚未加载社交资料功能，请重启 Wikist 后重试。";
        await uiAlert("服务器需要重启", "当前页面已更新，但运行中的 Wikist 后端仍是旧版本，尚不能保存外部资料。请停止旧服务并重新运行 run-wikist-server.cmd，然后按控制台显示的地址重新打开站点。", "warning");
        return;
      }
      state.user = result.user;
      renderPassportLink();
      status.textContent = "资料已保存。";
      await refreshUser();
      await renderAccount(value);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#passwordStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (payload.newPassword !== payload.confirmPassword) { status.textContent = "两次输入的新密码不一致。"; return; }
    delete payload.confirmPassword;
    status.textContent = "正在更新...";
    try {
      await api("/api/passport/password", { method: "POST", body: JSON.stringify(payload) });
      state.user = null;
      renderPassportLink();
      location.hash = "#/login";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

async function renderOrganizations(value = "") {
  const parsed = splitValueQuery(value);
  const username = String(parsed.params.get("user") || "").trim();
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  const limit = 12;
  if (!username && !state.user) { location.hash = "#/login"; return; }
  const endpoint = username
    ? `/api/users/${encodeURIComponent(username)}/organizations?page=${page}&limit=${limit}`
    : `/api/passport/organizations?page=${page}&limit=${limit}&pending=true`;
  const payload = await api(endpoint);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const owner = payload.user || state.user || {};
  const title = username ? `${owner.displayName || owner.username} 的组织身份` : "我的组织身份";
  setChromeTitle(title);
  renderToc([]);
  el.editLink.href = "#/new";
  const link = (next) => `#/organizations${username ? `?user=${encodeURIComponent(username)}&page=${next}` : `?page=${next}`}`;
  el.main.innerHTML = `<header class="article-head organization-directory-head"><span class="system-kicker">Academic Identity</span><div class="article-title-row"><h1>${escapeHtml(title)}</h1><span class="quality-badge">${Number(pagination.total || 0)} 个组织</span></div><p class="article-summary">查看已加入的组织、身份与待处理申请。</p></header><section class="organization-identity-directory">${items.length ? items.map(organizationIdentityCardHtml).join("") : '<section class="empty-state"><h2>暂未加入组织</h2><p>前往协作社区加入或创建组织。</p><a class="command-button" href="#/community">进入协作社区</a></section>'}</section>${paginationHtml(pagination, "组织身份")}`;
  bindPagination(el.main, (next) => { location.hash = link(next); });
}
function messagingKindMeta(kind) {
  return ({
    direct: { label: "私信", icon: "members" },
    organization: { label: "组织群聊", icon: "community" },
    system: { label: "系统通知", icon: "pulse" },
    personal: { label: "个人通知", icon: "comments" },
  })[String(kind || "")] || { label: "会话", icon: "chat" };
}

function messagingFormatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function messagingSafeUrl(value, fallback = "#") {
  const url = String(value || "").trim();
  if (/^#\//.test(url) || /^\/api\/messaging\/attachments\//.test(url)) return url;
  return fallback;
}

function messagingBodyTextHtml(value) {
  let html = escapeHtml(String(value || ""));
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  html = html.replace(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,32})/gu, (_match, prefix, username) => `${prefix}<a class="messaging-mention" href="#/user/${encodeURIComponent(username)}">@${username}</a>`);
  return html.replace(/\n/g, "<br>");
}

const MESSAGING_REFERENCE_PATTERN = /\{\{ref:([a-z_]+)\|([^|{}\n]+)(?:\|([^{}\n]+))?\}\}/gi;

function messagingReferenceIdentity(reference = {}) {
  const type = reference.type === "page" ? "wiki_entry" : String(reference.type || "wiki_entry").toLowerCase();
  return `${type}:${String(reference.id || "").trim()}:${String(reference.revision || "").trim()}`;
}

function messagingReferenceToken(reference = {}) {
  const type = reference.type === "page" ? "wiki_entry" : String(reference.type || "wiki_entry").toLowerCase();
  const revision = String(reference.revision || "").trim();
  const rawId = `${String(reference.id || "").trim()}${type === "revision" && revision ? `@${revision}` : ""}`;
  const id = rawId.replace(/[|{}\n\r]/g, " ").trim();
  const label = String(reference.label || reference.displayName || reference.id || "").replace(/[|{}\n\r]/g, " ").trim();
  return `{{ref:${type}|${id}${label ? `|${label}` : ""}}}`;
}

function messagingReferenceFromToken(type, rawId, label, references = []) {
  const normalizedType = String(type || "wiki_entry").toLowerCase() === "page" ? "wiki_entry" : String(type || "wiki_entry").toLowerCase();
  let id = String(rawId || "").trim();
  let revision = "";
  if (normalizedType === "revision") {
    const separator = id.lastIndexOf("@");
    if (separator > 0) {
      revision = id.slice(separator + 1).trim();
      id = id.slice(0, separator).trim();
    }
  }
  const identity = `${normalizedType}:${id}:${revision}`;
  const resolved = references.find((reference) => messagingReferenceIdentity(reference) === identity);
  if (resolved) return resolved;
  const url = normalizedType === "wiki_entry"
    ? `#/page/${encodeSlug(id)}`
    : normalizedType === "user"
      ? `#/user/${encodeURIComponent(id)}`
      : normalizedType === "organization"
        ? `#/organization/${encodeURIComponent(id)}`
        : "#";
  return { type: normalizedType, id, revision, label: String(label || id).trim(), url };
}

function messagingInlineReferenceHtml(reference) {
  const typeLabel = ({ wiki_entry: "词条", page: "词条", revision: "修订", question: "问题", answer: "回答", organization: "组织", user: "用户", selection: "划词" })[reference.type] || "知识对象";
  return `<a class="messaging-inline-reference" href="${escapeHtml(messagingSafeUrl(reference.url))}" title="${escapeHtml(`${typeLabel}：${reference.label || reference.id || "未命名对象"}`)}">${navigationIconSvg("network")}<span>${escapeHtml(reference.label || reference.id || "未命名对象")}</span></a>`;
}

function messagingBodyHtml(value, references = []) {
  const source = String(value || "");
  let cursor = 0;
  let html = "";
  MESSAGING_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(MESSAGING_REFERENCE_PATTERN)) {
    html += messagingBodyTextHtml(source.slice(cursor, match.index));
    html += messagingInlineReferenceHtml(messagingReferenceFromToken(match[1], match[2], match[3], references));
    cursor = Number(match.index || 0) + match[0].length;
  }
  html += messagingBodyTextHtml(source.slice(cursor));
  return html;
}

function messagingReferenceHtml(reference, compact = false) {
  const meta = messagingKindMeta(reference.type === "organization" ? "organization" : reference.type === "user" ? "direct" : "wiki");
  const typeLabel = ({ wiki_entry: "词条", page: "词条", revision: "修订", question: "问题", answer: "回答", organization: "组织", user: "用户", selection: "划词" })[reference.type] || reference.type || "知识对象";
  const summary = reference.metadata?.quote || reference.metadata?.summary || reference.summary || reference.revision || reference.id || "";
  return `<a class="messaging-reference ${compact ? "compact" : ""}" href="${escapeHtml(messagingSafeUrl(reference.url))}">${navigationIconSvg(meta.icon)}<span><small>${escapeHtml(typeLabel)}</small><strong>${escapeHtml(reference.label || reference.id || "未命名对象")}</strong>${compact ? "" : `<em>${escapeHtml(shortText(summary, 100))}</em>`}</span></a>`;
}

function messagingAttachmentHtml(attachment) {
  const url = escapeHtml(messagingSafeUrl(attachment.url));
  const isImage = String(attachment.mimeType || "").startsWith("image/");
  if (isImage) {
    const label = escapeHtml(attachment.name || "图片附件");
    return `<a class="messaging-attachment image" href="${url}" target="_blank" rel="noopener" data-messaging-image-preview data-wiki-image-src="${url}" data-wiki-image-caption="${label}" aria-label="预览图片：${label}"><img src="${url}" alt="${label}" loading="lazy"><span>${label} · ${messagingFormatBytes(attachment.size)}</span></a>`;
  }
  return `<a class="messaging-attachment file" href="${url}" target="_blank" rel="noopener">${navigationIconSvg("article")}<span><strong>${escapeHtml(attachment.name || "附件")}</strong><small>${escapeHtml(attachment.mimeType || "文件")} · ${messagingFormatBytes(attachment.size)}</small></span></a>`;
}

function messagingMessageHtml(message) {
  const sender = message.sender || {};
  const withdrawn = message.status === "withdrawn";
  const failed = message.status === "failed";
  const allowReply = messagingWorkspaceState.activeConversation?.kind !== "system";
  const systemEvent = message.type === "system";
  const mine = Boolean(message.mine && !systemEvent);
  const body = message.bodyMd || message.bodyPlain || "";
  const hasInlineReferences = /\{\{ref:/i.test(body);
  const priority = messagePriorityMeta(message.priority || "normal");
  const withdrawWindow = Math.max(60, Number(messagingBootstrap?.capabilities?.withdrawWindowSeconds || 300));
  const createdAt = Date.parse(String(message.createdAt || ""));
  const canWithdraw = !withdrawn && !failed && Boolean(message.mine) && Number.isFinite(createdAt) && Date.now() - createdAt <= withdrawWindow * 1000;
  const errorText = String(message.sendError || "消息未能送达，请稍后重试。");
  const moderationEvent = systemEvent
    && message.metadata?.source === "conversation_moderation"
    && message.metadata?.event === "all_muted";
  if (moderationEvent) {
    const moderationState = message.metadata?.allMuted ? "is-waiting" : "is-released";
    return `<article class="messaging-conversation-boundary messaging-moderation-event ${moderationState}" data-messaging-message-id="${escapeHtml(message.id)}" data-message-cursor="${Number(message.cursor || 0)}" role="status"><span>${escapeHtml(body)}</span></article>`;
  }
  return `<article class="messaging-message-row ${mine ? "mine" : "incoming"} ${systemEvent ? "system-event" : ""} ${withdrawn ? "withdrawn" : ""} ${failed ? "failed" : ""}" data-messaging-message-id="${escapeHtml(message.id)}" data-message-cursor="${Number(message.cursor || 0)}">
    <a class="messaging-message-avatar" href="${sender.username ? `#/user/${encodeURIComponent(sender.username)}` : "#"}" aria-label="查看 ${escapeHtml(sender.displayName || sender.username || "系统")} 的主页">${avatarHtml(sender, "small")}</a>
    <div class="messaging-message-stack">
      <header><strong>${escapeHtml(sender.displayName || sender.username || currentSiteName())}</strong><time datetime="${escapeHtml(message.createdAt || "")}">${fmtDate(message.createdAt)}</time>${message.metadata?.autoReply ? '<span class="messaging-auto-reply-badge">自动回复</span>' : ""}${message.mine ? `<span class="messaging-read-state">${Number(message.readByCount || 0)} 人已读</span>` : ""}${message.priority !== "normal" ? `<span class="message-priority ${priority.tone}">${priority.label}</span>` : ""}</header>
      <div class="messaging-bubble-line">${failed ? `<button class="messaging-send-failed" type="button" data-failed-message="${escapeHtml(message.id)}" aria-label="发送失败：${escapeHtml(errorText)}" title="${escapeHtml(errorText)}">!</button>` : ""}<div class="messaging-bubble">
        ${withdrawn ? '<p class="messaging-withdrawn-copy">这条消息已撤回</p>' : `${message.replyTo ? `<button class="messaging-reply-quote" type="button" data-scroll-message="${escapeHtml(message.replyTo.id)}"><small>回复 ${escapeHtml(message.replyTo.senderName || "消息")}</small><span>${escapeHtml(shortText(message.replyTo.preview, 120))}</span></button>` : ""}<div class="messaging-message-body">${messagingBodyHtml(body, message.references || [])}</div>${message.references?.length && !hasInlineReferences ? `<div class="messaging-reference-grid">${message.references.map((item) => messagingReferenceHtml(item)).join("")}</div>` : ""}${message.attachments?.length ? `<div class="messaging-attachment-grid">${message.attachments.map(messagingAttachmentHtml).join("")}</div>` : ""}`}
      </div></div>
      <footer>${failed ? `<span class="messaging-failed-note">发送失败</span>` : ""}<span class="messaging-message-tools">${failed ? `<button type="button" data-retry-failed-message="${escapeHtml(message.id)}">重新编辑</button><button type="button" data-dismiss-failed-message="${escapeHtml(message.id)}">移除</button>` : `${withdrawn ? "" : `${allowReply ? `<button type="button" data-reply-message="${escapeHtml(message.id)}">回复</button>` : ""}${canWithdraw ? `<button type="button" data-withdraw-message="${escapeHtml(message.id)}">撤回</button>` : ""}`}<button type="button" data-hide-message="${escapeHtml(message.id)}">删除</button>`}</span></footer>
    </div>
  </article>`;
}

function messagingConversationItemHtml(conversation, activeId = "") {
  const kind = messagingKindMeta(conversation.kind);
  const unread = Number(conversation.unreadCount || 0);
  const last = conversation.lastMessage || {};
  const title = conversation.title || "未命名会话";
  const peerId = Number(conversation.peer?.id || 0);
  const online = peerId > 0 && messagingWorkspaceState.presenceUsers?.has(peerId);
  return `<a class="messaging-conversation-item ${String(conversation.id) === String(activeId) ? "active" : ""} ${unread ? "unread" : ""}" href="#/messages/${encodeURIComponent(conversation.id)}" data-conversation-id="${escapeHtml(conversation.id)}">
    <span class="messaging-conversation-avatar">${avatarHtml({ displayName: title, username: title, avatarUrl: conversation.avatarUrl }, "small")}${conversation.kind === "direct" ? `<i class="messaging-presence-dot ${online ? "is-online" : ""}" data-presence-user="${peerId}" aria-label="${online ? "在线" : "离线"}"></i>` : ""}</span>
    <span class="messaging-conversation-copy"><span><strong>${escapeHtml(title)}</strong><time>${last.createdAt ? fmtDate(last.createdAt) : ""}</time></span><small>${escapeHtml(shortText(last.preview || conversation.description || kind.label, 76))}</small></span>
    ${unread ? `<span class="messaging-unread-count">${unread > 99 ? "99+" : unread}</span>` : ""}
  </a>`;
}

function messagingConversationListHtml(conversations, activeId = "") {
  if (!conversations.length) {
    return '<div class="messaging-sidebar-empty"><span>没有匹配的会话</span><button type="button" data-open-people-picker>查找用户</button></div>';
  }
  const pinned = conversations.filter((conversation) => conversation.pinned);
  const regular = conversations.filter((conversation) => !conversation.pinned);
  if (!pinned.length) return regular.map((item) => messagingConversationItemHtml(item, activeId)).join("");
  const group = (label, items, kind) => items.length ? `<section class="messaging-conversation-group ${kind}"><header><span>${label}</span><small>${items.length}</small></header><div>${items.map((item) => messagingConversationItemHtml(item, activeId)).join("")}</div></section>` : "";
  return `${group("已置顶", pinned, "pinned")}${group("其他会话", regular, "regular")}`;
}

function messagingConversationPagerHtml(pagination) {
  const page = Math.max(1, Number(pagination.page || 1));
  const pages = Math.max(1, Number(pagination.pages || 1));
  if (Number(pagination.total || 0) <= Number(pagination.limit || 24)) return "";
  return `<nav class="messaging-conversation-pager" aria-label="会话分页"><button type="button" data-messaging-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="上一页">‹</button><span>${page} / ${pages}</span><button type="button" data-messaging-page="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="下一页">›</button></nav>`;
}

function messagingComposerStateHtml() {
  const reply = messagingComposerState.replyTo;
  const attachments = messagingComposerState.attachments || [];
  if (!reply && !attachments.length) return "";
  return `<div class="messaging-composer-state">
    ${reply ? `<div class="messaging-compose-chip reply"><span><small>正在回复 ${escapeHtml(reply.sender?.displayName || reply.sender?.username || "消息")}</small><strong>${escapeHtml(shortText(reply.bodyPlain || reply.bodyMd || "", 90))}</strong></span><button type="button" data-remove-composer-reply aria-label="取消回复">×</button></div>` : ""}
    ${attachments.map((item, index) => `<div class="messaging-compose-chip attachment"><span>${escapeHtml(item.name)} · ${messagingFormatBytes(item.size)}</span><button type="button" data-remove-composer-attachment="${index}" aria-label="移除附件">×</button></div>`).join("")}
  </div>`;
}

function messagingMemberSectionHtml(conversation, memberPage = {}) {
  const members = memberPage.items || [];
  const total = Number(memberPage.total ?? conversation.memberCount ?? members.length);
  const page = Math.max(1, Number(memberPage.page || 1));
  const pages = Math.max(1, Number(memberPage.pages || 1));
  const privateList = Boolean(memberPage.private);
  const directOpen = conversation.kind === "direct" || memberPage.open ? " open" : "";
  const moderation = conversation.moderation || {};
  const viewerRole = String(conversation.role || "member");
  const memberList = privateList
    ? `<p class="messaging-member-privacy">${memberPage.scope === "site" ? "全站公告成员名单仅本人可见。" : "会话成员信息仅本人可见。"}</p>`
    : members.map((member) => {
      const online = messagingWorkspaceState.presenceUsers?.has(Number(member.id));
      const role = String(member.role || "member");
      const muted = Boolean(member.mutedUntil && String(member.mutedUntil) > new Date().toISOString());
      const canSetRole = Boolean(moderation.canManageRoles && role !== "owner");
      const canMute = Boolean(moderation.canModerate && role !== "owner" && (state.user?.role === "admin" || viewerRole === "owner" || role !== "admin"));
      const memberMenuId = `messaging-member-actions-${Number(member.id)}`;
      const controls = canSetRole || canMute ? `<div class="messaging-member-actions"><button class="messaging-member-action-trigger" type="button" popovertarget="${memberMenuId}" data-messaging-member-menu-toggle aria-label="管理 ${escapeHtml(member.displayName || member.username)}" title="成员操作">${navigationIconSvg("more")}</button><section class="messaging-member-action-menu" id="${memberMenuId}" popover="auto" role="group" aria-label="${escapeHtml(member.displayName || member.username)} 的群聊设置"><header><strong>成员操作</strong><small>@${escapeHtml(member.username)}</small></header>${canSetRole ? `<label class="wikist-field"><span>群聊身份</span><select class="wikist-input" data-messaging-member-role="${Number(member.id)}" aria-label="调整 ${escapeHtml(member.displayName || member.username)} 的群聊身份"><option value="member" ${role === "member" ? "selected" : ""}>成员</option><option value="admin" ${role === "admin" ? "selected" : ""}>管理员</option></select></label>` : ""}${canMute ? `<label class="wikist-field messaging-mute-duration" ${muted ? "hidden" : ""}><span>禁言时长</span><select class="wikist-input" data-messaging-mute-duration="${Number(member.id)}"><option value="60">1 小时</option><option value="1440">1 天</option><option value="10080">7 天</option><option value="43200">30 天</option></select></label><button class="mini-button ${muted ? "danger" : ""}" type="button" data-messaging-member-mute="${Number(member.id)}" data-muted="${muted ? "true" : "false"}">${muted ? "解除禁言" : "禁言"}</button>` : ""}</section></div>` : "";
      return `<article class="messaging-member-row ${muted ? "is-muted" : ""}"><a class="messaging-member-profile" href="#/user/${encodeURIComponent(member.username)}"><span class="messaging-member-avatar">${avatarHtml(member, "small")}<i class="messaging-presence-dot ${online ? "is-online" : ""}" data-presence-user="${Number(member.id)}" aria-label="${online ? "在线" : "离线"}"></i></span><span><strong>${escapeHtml(member.displayName || member.username)}</strong><small>@${escapeHtml(member.username)} · <b class="messaging-presence-label ${online ? "is-online" : ""}" data-presence-label="${Number(member.id)}">${online ? "在线" : "离线"}</b></small></span><em class="messaging-role-badge role-${escapeHtml(role)}">${escapeHtml(messagingRoleLabel(role))}</em></a>${controls}${muted ? `<p class="messaging-member-mute-state">禁言至 ${fmtDate(member.mutedUntil)}${member.muteReason ? ` · ${escapeHtml(member.muteReason)}` : ""}</p>` : ""}</article>`;
    }).join("") || '<p class="muted-line">暂无成员资料</p>';
  const pager = !privateList && pages > 1 ? `<nav class="messaging-member-pager" aria-label="会话成员分页"><button type="button" data-messaging-member-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${pages}</span><button type="button" data-messaging-member-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button></nav>` : "";
  return `<section class="messaging-members-section"><details class="messaging-members-details"${directOpen}><summary><strong>成员</strong><span>${total}</span></summary><div class="messaging-member-list">${memberList}</div>${pager}</details></section>`;
}

function messagingContextHtml(conversation, messages = [], memberPage = {}) {
  const references = [...new Map(messages.flatMap((message) => message.references || []).map((item) => [`${item.type}:${item.id}:${item.revision || ""}`, item])).values()].slice(0, 12);
  const peer = conversation.kind === "direct" ? (conversation.peer || {}) : null;
  const identity = peer || { displayName: conversation.title, username: conversation.title, avatarUrl: conversation.avatarUrl };
  const identityLabel = peer?.username ? `@${peer.username} · 私信` : messagingKindMeta(conversation.kind).label;
  const identityBio = peer?.bio || conversation.description || "暂未填写简介。";
  const moderation = conversation.moderation || {};
  const organizationModeration = conversation.kind === "organization" && moderation.canModerate ? `<section class="messaging-group-moderation"><header><strong>群聊管理</strong><span>${escapeHtml(messagingRoleLabel(conversation.role))}</span></header><div><span><strong>全体禁言</strong><small>${moderation.allMuted ? "仅群主和管理员可发言" : "所有成员均可发言"}</small></span><button type="button" data-messaging-all-muted="${moderation.allMuted ? "false" : "true"}" aria-pressed="${Boolean(moderation.allMuted)}">${moderation.allMuted ? "解除" : "开启"}</button></div></section>` : "";
  return `<aside class="messaging-context-panel" aria-label="会话资料">
    <section class="messaging-context-identity">${avatarHtml(identity, "medium")}<h3>${escapeHtml(conversation.title || "会话")}</h3><p class="messaging-context-kind">${escapeHtml(identityLabel)}</p><p class="messaging-context-bio">${escapeHtml(identityBio)}</p>${peer ? socialLinksHtml(peer.socialLinks, "context") : ""}</section>
    ${messagingMemberSectionHtml(conversation, memberPage)}
    ${organizationModeration}
    <section><header><strong>知识关联</strong><span>${references.length}</span></header><div class="messaging-context-references">${references.length ? references.map((item) => messagingReferenceHtml(item, true)).join("") : '<p class="muted-line">尚未添加知识引用。</p>'}</div></section>
    <section class="messaging-context-settings"><header><strong>会话设置</strong></header><button type="button" data-messaging-setting="pinned" data-setting-value="${conversation.pinned ? "false" : "true"}">${conversation.pinned ? "取消置顶" : "置顶会话"}</button><button type="button" data-messaging-setting="muted" data-setting-value="${conversation.mutedUntil ? "false" : "true"}">${conversation.mutedUntil ? "恢复通知" : "消息免打扰"}</button><button type="button" data-messaging-setting="archived" data-setting-value="${conversation.archived ? "false" : "true"}">${conversation.archived ? "移出归档" : "归档会话"}</button></section>
  </aside>`;
}

function messagingReferencePickerHtml() {
  return `<section class="messaging-picker messaging-reference-picker" id="messagingReferencePicker" hidden><header><strong>引用知识对象</strong><button type="button" data-close-messaging-picker aria-label="关闭">×</button></header><div class="messaging-picker-fields"><select id="messagingReferenceType" aria-label="对象类型"><option value="wiki_entry">词条</option><option value="revision">词条修订</option><option value="organization">协作组织</option><option value="user">用户</option><option value="question">问题</option><option value="answer">回答</option></select><input id="messagingReferenceSearch" autocomplete="off" placeholder="搜索标题或标识"><input id="messagingReferenceRevision" placeholder="修订版本标识" hidden></div><div class="messaging-picker-results" id="messagingReferenceResults"><p class="muted-line">搜索并选择要引用的内容。</p></div></section>`;
}

function messagingMentionPickerHtml() {
  return `<section class="messaging-picker messaging-mention-picker" id="messagingMentionPicker" hidden><header><strong>提及用户</strong><small>输入用户名或显示名称</small></header><div class="messaging-mention-results" id="messagingMentionResults"></div></section>`;
}

function messagingRoleLabel(role) {
  return ({ owner: "群主", admin: "管理员", member: "成员" })[String(role || "member")] || "成员";
}

function closeMessagingPreferencesDialog() {
  const layer = document.querySelector("#messagingPreferencesLayer");
  if (!layer) return;
  if (layer._escapeHandler) document.removeEventListener("keydown", layer._escapeHandler);
  layer.remove();
}

async function loadMessagingPreferences() {
  const payload = await api("/api/messaging/preferences").catch(() => null);
  if (payload?.preferences) {
    messagingPreferences = { openMode: false, autoReplyEnabled: false, autoReplyText: "", ...payload.preferences };
  }
  return messagingPreferences;
}

async function openMessagingPreferencesDialog(options = {}) {
  await loadMessagingPreferences();
  closeMessagingPreferencesDialog();
  const preferences = { openMode: false, autoReplyEnabled: false, autoReplyText: "", ...(messagingPreferences || {}) };
  const layer = document.createElement("section");
  layer.id = "messagingPreferencesLayer";
  layer.className = "wikist-modal-layer messaging-preferences-layer";
  layer.innerHTML = `<article class="wikist-modal messaging-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="messagingPreferencesTitle"><header><div><span class="system-kicker">Messaging Preferences</span><h2 id="messagingPreferencesTitle">通信设置</h2></div><button type="button" data-close-messaging-preferences aria-label="关闭">×</button></header><form id="messagingPreferencesForm"><label class="messaging-preference-toggle"><input name="openMode" type="checkbox" ${preferences.openMode ? "checked" : ""}><span><strong>开放私信</strong><small>允许未互相关注的用户持续发送消息。</small></span></label><label class="messaging-preference-toggle"><input name="autoReplyEnabled" type="checkbox" ${preferences.autoReplyEnabled ? "checked" : ""}><span><strong>离线自动回复</strong><small>离线收到私信时发送一次自动回复。</small></span></label><label class="messaging-auto-reply-field wikist-field"><span>自动回复内容</span><textarea class="wikist-input" name="autoReplyText" rows="4" maxlength="500" placeholder="例如：我当前不在线，稍后回复你。">${escapeHtml(preferences.autoReplyText || "")}</textarea></label><footer><p class="status-line" id="messagingPreferencesStatus"></p><button class="command-button" type="submit">保存设置</button></footer></form></article>`;
  document.body.appendChild(layer);
  const syncField = () => {
    const enabled = Boolean(layer.querySelector('[name="autoReplyEnabled"]')?.checked);
    const field = layer.querySelector('[name="autoReplyText"]');
    if (field) field.disabled = !enabled;
    layer.querySelector(".messaging-auto-reply-field")?.classList.toggle("is-disabled", !enabled);
  };
  syncField();
  layer.querySelector('[name="autoReplyEnabled"]')?.addEventListener("change", syncField);
  const close = () => closeMessagingPreferencesDialog();
  layer._escapeHandler = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", layer._escapeHandler);
  layer.addEventListener("click", (event) => { if (event.target === layer || event.target.closest("[data-close-messaging-preferences]")) close(); });
  layer.querySelector("#messagingPreferencesForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector("#messagingPreferencesStatus");
    submit.disabled = true;
    status.textContent = "正在保存...";
    try {
      const result = await api("/api/messaging/preferences", { method: "PUT", body: JSON.stringify({ openMode: form.openMode.checked, autoReplyEnabled: form.autoReplyEnabled.checked, autoReplyText: form.autoReplyText.value.trim() }) });
      messagingPreferences = result.preferences || preferences;
      close();
      if (typeof options.onSaved === "function") await options.onSaved(messagingPreferences);
      uiToast("通信设置已保存");
    } catch (error) {
      status.textContent = error.message || "保存失败";
      submit.disabled = false;
    }
  });
}

function messagingThreadHtml(conversation, messages, pageData) {
  if (!conversation) {
    return `<main class="messaging-thread empty"><section class="messaging-thread-empty">${navigationIconSvg("chat")}<h2>从一次对话开始</h2><p>选择会话，或查找用户发起私信。</p><button class="command-button" type="button" data-open-people-picker>发起私信</button></section></main>`;
  }
  const canSend = conversation.kind !== "system" && conversation.canSend !== false;
  const kind = messagingKindMeta(conversation.kind);
  const peerId = Number(conversation.peer?.id || 0);
  const peerOnline = peerId > 0 && messagingWorkspaceState.presenceUsers?.has(peerId);
  const isSiteBroadcast = conversation.kind === "system" && conversation.metadata?.scope === "site";
  const threadStatus = conversation.kind === "direct" ? `<span class="messaging-presence-label ${peerOnline ? "is-online" : ""}" data-presence-label="${peerId}">${peerOnline ? "在线" : "离线"}</span>` : isSiteBroadcast ? "全站广播" : `${Number(conversation.memberCount || 0)} 位成员`;
  const directPolicy = conversation.kind === "direct" ? (conversation.directPolicy || {}) : null;
  const policyMarker = directPolicy && !directPolicy.openMode && !directPolicy.mutualFollow
    ? `<div class="messaging-conversation-boundary ${directPolicy.waitingForReply ? "is-waiting" : ""}"><span>${directPolicy.waitingForReply ? "消息已送出，等待对方回复后可继续发送" : "非好友会话：对方回复前可发送 1 条消息"}</span></div>`
    : "";
  const blockedMessage = conversation.kind === "direct" && directPolicy?.waitingForReply
    ? "等待对方回复后可继续发送。"
    : conversation.kind === "organization" && conversation.moderation?.allMuted
      ? "群聊已开启全体禁言。"
      : conversation.kind === "organization" && conversation.moderation?.mutedUntil
        ? `你已被禁言至 ${fmtDate(conversation.moderation.mutedUntil)}。`
        : "站点通知仅供查看。";
  return `<main class="messaging-thread" data-active-conversation="${escapeHtml(conversation.id)}">
    <header class="messaging-thread-head"><button class="messaging-mobile-back" type="button" data-messaging-back aria-label="返回会话列表">‹</button><span class="messaging-thread-avatar">${avatarHtml({ displayName: conversation.title, username: conversation.title, avatarUrl: conversation.avatarUrl }, "small")}${conversation.kind === "direct" ? `<i class="messaging-presence-dot ${peerOnline ? "is-online" : ""}" data-presence-user="${peerId}" aria-label="${peerOnline ? "在线" : "离线"}"></i>` : ""}</span><div><h2>${escapeHtml(conversation.title || "会话")}</h2><p>${escapeHtml(kind.label)} · ${threadStatus}</p></div><div class="messaging-thread-actions"><button type="button" data-messaging-setting="pinned" data-setting-value="${conversation.pinned ? "false" : "true"}" title="${conversation.pinned ? "取消置顶" : "置顶会话"}">${navigationIconSvg("workspace")}</button><button type="button" data-toggle-context-panel title="会话资料">${navigationIconSvg("members")}</button></div></header>
    <section class="messaging-message-scroll" id="messagingMessageScroll" aria-live="polite"><div class="messaging-load-older">${pageData.hasMore ? '<button type="button" data-load-older-messages>加载更早消息</button>' : '<span>会话从这里开始</span>'}</div>${policyMarker}<div class="messaging-message-list" id="messagingMessageList">${messages.length ? messages.map(messagingMessageHtml).join("") : '<div class="messaging-thread-welcome"><strong>尚无消息</strong><span>发出第一条消息，或先引用一个词条作为上下文。</span></div>'}</div><div class="messaging-typing" id="messagingTyping" hidden></div></section>
    ${canSend ? `<section class="messaging-composer-shell"><div id="messagingComposerState">${messagingComposerStateHtml()}</div>${messagingReferencePickerHtml()}${messagingMentionPickerHtml()}<form class="messaging-composer" id="messagingComposer"><textarea name="bodyMd" rows="3" maxlength="20000" placeholder="写消息，使用 @用户名 提及成员..." aria-label="消息内容" autocomplete="off"></textarea><input id="messagingAttachmentInput" type="file" hidden multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,.md"><footer class="messaging-composer-footer"><div class="messaging-composer-actions"><button type="button" data-upload-messaging-attachment title="添加附件" aria-label="添加附件">${navigationIconSvg("article")}</button><button type="button" data-open-reference-picker title="引用知识对象" aria-label="引用知识对象">${navigationIconSvg("network")}</button></div><button class="messaging-send-button" type="submit" aria-label="发送消息">${navigationIconSvg("transfer")}<span>发送</span></button></footer></form><p class="status-line" id="messagingComposerStatus"></p></section>` : `<footer class="messaging-system-note">${escapeHtml(blockedMessage)}</footer>`}
  </main>`;
}

function messagingSidebarHtml(conversations, pagination, activeId, filters) {
  const tabs = [["", "全部"], ["direct", "私信"], ["organization", "组织"], ["system", "系统"]];
  return `<aside class="messaging-sidebar"><header class="messaging-sidebar-head"><div><span class="system-kicker">Messaging</span><h1>通信</h1></div><button type="button" data-open-people-picker aria-label="发起私信" title="发起私信">＋</button></header><form class="messaging-search" id="messagingConversationSearch"><input name="q" value="${escapeHtml(filters.q || "")}" placeholder="搜索会话或成员" autocomplete="off"><button type="submit" aria-label="搜索">${navigationIconSvg("search")}</button></form><nav class="messaging-kind-tabs" aria-label="会话类型">${tabs.map(([value, label]) => `<button class="${filters.kind === value ? "active" : ""}" type="button" data-messaging-kind="${value}">${label}</button>`).join("")}</nav><section class="messaging-people-picker" id="messagingPeoplePicker" hidden><header><strong>发起私信</strong><button type="button" data-close-messaging-picker aria-label="关闭">×</button></header><input id="messagingPeopleSearch" placeholder="搜索用户名或显示名称" autocomplete="off"><div id="messagingPeopleResults"><p class="muted-line">输入至少一个字符。</p></div></section><div class="messaging-conversation-list" id="messagingConversationList">${messagingConversationListHtml(conversations, activeId)}</div><div id="messagingConversationPager">${messagingConversationPagerHtml(pagination)}</div></aside>`;
}

function messagingWorkspaceHash(conversationId = "", filters = {}) {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.kind) query.set("kind", filters.kind);
  if (Number(filters.page || 1) > 1) query.set("page", String(filters.page));
  return `#/messages${conversationId ? `/${encodeURIComponent(conversationId)}` : ""}${query.toString() ? `?${query}` : ""}`;
}

async function renderMessagingWorkspace(value = "") {
  await refreshUser({ ttlMs: 30000 });
  if (!state.user) { location.hash = "#/login"; return; }
  stopMessagingWorkspacePolling();
  messagingComposerState = { attachments: [], references: [], replyTo: null };
  const parsed = splitValueQuery(value);
  let requestedId = String(parsed.pathValue || "").trim();
  const requestedUserId = Number(parsed.params.get("user") || 0);
  const requestedOrganization = String(parsed.params.get("organization") || "").trim();
  if (!requestedId && requestedUserId > 0) {
    const started = await api("/api/messaging/conversations/direct", { method: "POST", body: JSON.stringify({ userId: requestedUserId }) });
    requestedId = started.conversation.id;
  } else if (!requestedId && requestedOrganization) {
    const started = await api("/api/messaging/conversations/organization", { method: "POST", body: JSON.stringify({ organizationSlug: requestedOrganization }) });
    requestedId = started.conversation.id;
  }
  const filters = {
    q: String(parsed.params.get("q") || "").trim(),
    kind: ["direct", "organization", "system"].includes(parsed.params.get("kind")) ? parsed.params.get("kind") : "",
    page: Math.max(1, Number(parsed.params.get("page")) || 1),
  };
  const query = new URLSearchParams({ page: String(filters.page), limit: "24" });
  if (filters.q) query.set("q", filters.q);
  if (filters.kind) query.set("kind", filters.kind);
  const [bootstrap, conversationPayload] = await Promise.all([
    api("/api/messaging/bootstrap"),
    api(`/api/messaging/conversations?${query}`),
  ]);
  messagingBootstrap = bootstrap;
  messagingPreferences = { openMode: false, autoReplyEnabled: false, autoReplyText: "", ...(bootstrap.preferences || {}) };
  if (bootstrap.presence) applyMessagingPresence(bootstrap.presence);
  state.unreadMessages = Number(bootstrap.unreadCount || 0);
  renderMessageBadge();
  let conversations = conversationPayload.items || [];
  let activeConversation = null;
  let pageData = { items: [], hasMore: false, nextCursor: null };
  let memberPage = { items: [], page: 1, pages: 1, total: 0, limit: 12, private: false };
  if (requestedId) {
    const detail = await api(`/api/messaging/conversations/${encodeURIComponent(requestedId)}`);
    activeConversation = detail.conversation;
    if (!conversations.some((item) => item.id === activeConversation.id)) conversations = [activeConversation, ...conversations];
  } else if (conversations.length) {
    const detail = await api(`/api/messaging/conversations/${encodeURIComponent(conversations[0].id)}`);
    activeConversation = detail.conversation;
    conversations[0] = activeConversation;
  }
  if (activeConversation) {
    [pageData, memberPage] = await Promise.all([
      api(`/api/messaging/conversations/${encodeURIComponent(activeConversation.id)}/messages?limit=50`),
      api(`/api/messaging/conversations/${encodeURIComponent(activeConversation.id)}/members?page=1&limit=12`),
    ]);
  }
  const presenceIds = [...new Set([
    ...conversations.map((conversation) => Number(conversation.peer?.id || 0)),
    Number(activeConversation?.peer?.id || 0),
    ...(memberPage.items || []).map((member) => Number(member.id || 0)),
  ].filter((id) => id > 0))];
  if (presenceIds.length) {
    const presence = await api("/api/messaging/presence/heartbeat", {
      method: "POST",
      body: JSON.stringify({ userIds: presenceIds, context: activeConversation ? `conversation:${activeConversation.id}` : "route:messages", clientId: currentMessagingPresenceClientId() }),
    }).catch(() => null);
    if (presence) applyMessagingPresence(presence);
  }
  if (activeConversation) {
    const exactPresence = await api(`/api/messaging/conversations/${encodeURIComponent(activeConversation.id)}/presence`).catch(() => null);
    if (exactPresence) applyMessagingPresence(exactPresence);
  }
  messagingWorkspaceState = {
    conversations,
    pagination: { page: conversationPayload.page || filters.page, pages: conversationPayload.pages || 1, total: conversationPayload.total || conversations.length, limit: conversationPayload.limit || 24 },
    activeConversation,
    messages: pageData.items || [],
    hasMore: Boolean(pageData.hasMore),
    nextCursor: pageData.nextCursor || null,
    typingUsers: new Map(),
    presenceUsers: new Map(messagingPresenceCache),
    memberPage,
    filters,
  };
  setChromeTitle(activeConversation ? `${activeConversation.title} - 通信` : "通信");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = `<section class="messaging-page"><header class="messaging-page-head"><div><span class="system-kicker">Knowledge Collaboration</span><h1>统一通信</h1><p>联系成员、进入组织群聊或引用知识内容。</p></div><div><span class="messaging-connection-state"><i></i>${bootstrap.realtime?.enabled ? "实时连接" : "安全同步"}</span><button type="button" data-open-messaging-preferences>${navigationIconSvg("workspace")}<span>通信设置</span></button><button type="button" data-messaging-read-all ${state.unreadMessages ? "" : "disabled"}>全部已读</button></div></header><section class="messaging-workspace ${activeConversation ? "has-active" : ""} ${requestedId ? "mobile-thread-open" : ""}" id="messagingWorkspace">${messagingSidebarHtml(conversations, messagingWorkspaceState.pagination, activeConversation?.id || "", filters)}${messagingThreadHtml(activeConversation, messagingWorkspaceState.messages, pageData)}${activeConversation ? messagingContextHtml(activeConversation, messagingWorkspaceState.messages, memberPage) : ""}</section></section>`;
  bindMessagingWorkspace();
  if (activeConversation) {
    await markMessagingConversationRead(activeConversation.id);
    await subscribeMessagingConversation(activeConversation.id).catch(() => {});
    scrollMessagingToBottom(false);
  }
  startMessagingWorkspacePolling();
}

function renderMessagingComposerState() {
  const target = document.querySelector("#messagingComposerState");
  if (target) target.innerHTML = messagingComposerStateHtml();
}

function insertMessagingComposerText(value) {
  const textarea = document.querySelector("#messagingComposer textarea");
  if (!textarea) return;
  const token = String(value || "").trim();
  if (!token) return;
  const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
  const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const insertion = `${prefix}${token}${suffix}`;
  textarea.setRangeText(insertion, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function closeMessagingMentionPicker() {
  window.clearTimeout(messagingMentionState.timer);
  const requestId = Number(messagingMentionState.requestId || 0) + 1;
  messagingMentionState = { query: "", start: 0, end: 0, items: [], activeIndex: 0, timer: 0, requestId };
  const panel = document.querySelector("#messagingMentionPicker");
  if (panel) panel.hidden = true;
}

function renderMessagingMentionResults() {
  const target = document.querySelector("#messagingMentionResults");
  if (!target) return;
  const items = messagingMentionState.items || [];
  target.innerHTML = items.length ? items.map((user, index) => `<button class="messaging-mention-result ${index === messagingMentionState.activeIndex ? "active" : ""}" type="button" data-select-messaging-mention="${escapeHtml(user.username)}" data-mention-index="${index}">${avatarHtml(user, "small")}<span><strong>${escapeHtml(user.displayName || user.username)}</strong><small>@${escapeHtml(user.username)}</small></span><em>提及</em></button>`).join("") : '<p class="muted-line">没有找到匹配用户。</p>';
}

function selectMessagingMention(index = messagingMentionState.activeIndex) {
  const textarea = document.querySelector("#messagingComposer textarea");
  const user = messagingMentionState.items?.[Number(index)];
  if (!textarea || !user) return false;
  textarea.setRangeText(`@${user.username} `, messagingMentionState.start, messagingMentionState.end, "end");
  closeMessagingMentionPicker();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
  return true;
}

function updateMessagingMentionPicker(textarea) {
  window.clearTimeout(messagingMentionState.timer);
  const caret = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
  const match = textarea.value.slice(0, caret).match(/(?:^|[\s(\[\u3000])@([\p{L}\p{N}_.-]{0,32})$/u);
  if (!match) { closeMessagingMentionPicker(); return; }
  const query = match[1];
  const start = caret - query.length - 1;
  const requestId = Number(messagingMentionState.requestId || 0) + 1;
  messagingMentionState = { query, start, end: caret, items: [], activeIndex: 0, timer: 0, requestId };
  const panel = document.querySelector("#messagingMentionPicker");
  const target = document.querySelector("#messagingMentionResults");
  if (!panel || !target) return;
  panel.hidden = false;
  document.querySelector("#messagingReferencePicker")?.setAttribute("hidden", "");
  if (!query) {
    const members = (messagingWorkspaceState.memberPage?.items || [])
      .filter((user) => Number(user.id || 0) !== Number(state.user?.id || 0))
      .slice(0, 8);
    messagingMentionState.items = members;
    target.innerHTML = members.length ? "" : '<p class="muted-line">输入用户名或显示名称。</p>';
    renderMessagingMentionResults();
    return;
  }
  target.innerHTML = '<p class="muted-line">正在查找成员...</p>';
  messagingMentionState.timer = window.setTimeout(async () => {
    const result = await api(`/api/messaging/users/suggest?q=${encodeURIComponent(query)}&limit=8`).catch(() => ({ items: [] }));
    if (messagingMentionState.requestId !== requestId || messagingMentionState.query !== query || messagingMentionState.start !== start) return;
    const conversationMemberIds = new Set((messagingWorkspaceState.memberPage?.items || []).map((item) => Number(item.id || 0)));
    const items = (result.items || []).filter((item) => Number(item.id || 0) !== Number(state.user?.id || 0));
    items.sort((left, right) => Number(conversationMemberIds.has(Number(right.id || 0))) - Number(conversationMemberIds.has(Number(left.id || 0))));
    messagingMentionState.items = items;
    messagingMentionState.activeIndex = 0;
    renderMessagingMentionResults();
  }, 140);
}

function scrollMessagingToBottom(smooth = true) {
  window.cancelAnimationFrame(messagingScrollFrame);
  messagingScrollFrame = window.requestAnimationFrame(() => {
    const target = document.querySelector("#messagingMessageScroll");
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

async function markMessagingConversationRead(conversationId) {
  const last = messagingWorkspaceState.messages.at(-1);
  const conversation = messagingWorkspaceState.conversations.find((item) => String(item.id) === String(conversationId));
  const localUnread = Number(conversation?.unreadCount || messagingWorkspaceState.activeConversation?.unreadCount || 0);
  if (conversation) conversation.unreadCount = 0;
  if (messagingWorkspaceState.activeConversation) messagingWorkspaceState.activeConversation.unreadCount = 0;
  state.unreadMessages = Math.max(0, Number(state.unreadMessages || 0) - localUnread);
  renderMessagingConversationListState();
  renderMessageBadge();
  const result = await api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/read`, { method: "PUT", body: JSON.stringify(last ? { cursor: last.cursor } : {}) }).catch(() => null);
  if (result) {
    state.unreadMessages = Number(result.unreadCount || 0);
    renderMessageBadge();
  }
}

function renderMessagingConversationListState() {
  const list = document.querySelector("#messagingConversationList");
  if (!list) return;
  const activeId = messagingWorkspaceState.activeConversation?.id || messagingActiveConversationId;
  list.innerHTML = messagingConversationListHtml(messagingWorkspaceState.conversations || [], activeId);
  const pager = document.querySelector("#messagingConversationPager");
  if (pager) pager.innerHTML = messagingConversationPagerHtml(messagingWorkspaceState.pagination || {});
  document.querySelectorAll("[data-messaging-kind]").forEach((button) => {
    button.classList.toggle("active", button.dataset.messagingKind === String(messagingWorkspaceState.filters?.kind || ""));
  });
  const search = document.querySelector("#messagingConversationSearch input[name='q']");
  if (search && document.activeElement !== search) search.value = messagingWorkspaceState.filters?.q || "";
}

async function requestMessagingConversationList(filters) {
  const query = new URLSearchParams({ page: String(filters.page || 1), limit: "24" });
  if (filters.q) query.set("q", filters.q);
  if (filters.kind) query.set("kind", filters.kind);
  return api(`/api/messaging/conversations?${query}`);
}

async function applyMessagingConversationFilters(nextFilters, options = {}) {
  const filters = {
    q: String(nextFilters.q || "").trim(),
    kind: ["direct", "organization", "system"].includes(nextFilters.kind) ? nextFilters.kind : "",
    page: Math.max(1, Number(nextFilters.page) || 1),
  };
  const list = document.querySelector("#messagingConversationList");
  list?.setAttribute("aria-busy", "true");
  try {
    const payload = await requestMessagingConversationList(filters);
    messagingWorkspaceState.filters = filters;
    messagingWorkspaceState.conversations = payload.items || [];
    messagingWorkspaceState.pagination = { page: payload.page || 1, pages: payload.pages || 1, total: payload.total || 0, limit: payload.limit || 24 };
    renderMessagingConversationListState();
    const activeVisible = messagingWorkspaceState.conversations.some((conversation) => String(conversation.id) === String(messagingActiveConversationId));
    if (!activeVisible) {
      const nextConversation = messagingWorkspaceState.conversations[0];
      if (nextConversation) await activateMessagingConversation(nextConversation.id, { updateUrl: false });
      else await clearMessagingConversationSelection();
    } else {
      refreshMessagingHeartbeat(`conversation:${messagingActiveConversationId}`).catch(() => {});
    }
    if (options.updateUrl !== false) {
      history.replaceState(null, "", messagingWorkspaceHash(messagingWorkspaceState.activeConversation?.id || "", filters));
    }
    return true;
  } catch (error) {
    await uiAlert("筛选失败", error?.message || "暂时无法刷新会话，请稍后重试。", "error");
    return false;
  } finally {
    list?.removeAttribute("aria-busy");
  }
}

async function refreshMessagingConversationList() {
  const list = document.querySelector("#messagingConversationList");
  if (!list || !state.user) return;
  const filters = messagingWorkspaceState.filters || { q: "", kind: "", page: 1 };
  const payload = await requestMessagingConversationList(filters);
  messagingWorkspaceState.conversations = payload.items || [];
  messagingWorkspaceState.pagination = { page: payload.page || 1, pages: payload.pages || 1, total: payload.total || 0, limit: payload.limit || 24 };
  renderMessagingConversationListState();
}

function appendMessagingMessage(message, options = {}) {
  if (!message?.id) return;
  const existing = document.querySelector(`[data-messaging-message-id="${CSS.escape(String(message.id))}"]`);
  if (existing) {
    const index = messagingWorkspaceState.messages.findIndex((item) => String(item.id) === String(message.id));
    const previous = index >= 0 ? messagingWorkspaceState.messages[index] : {};
    const merged = { ...previous, ...message };
    if (index >= 0) messagingWorkspaceState.messages[index] = merged;
    const readState = existing.querySelector(".messaging-read-state");
    if (readState && merged.mine) readState.textContent = `${Number(merged.readByCount || 0)} 人已读`;
    if (String(previous.status || "") !== String(merged.status || "")) existing.outerHTML = messagingMessageHtml(merged);
    return;
  }
  const list = document.querySelector("#messagingMessageList");
  if (!list) return;
  list.querySelector(".messaging-thread-welcome")?.remove();
  if (options.prepend) {
    messagingWorkspaceState.messages.unshift(message);
    list.insertAdjacentHTML("afterbegin", messagingMessageHtml(message));
  } else {
    messagingWorkspaceState.messages.push(message);
    list.insertAdjacentHTML("beforeend", messagingMessageHtml(message));
    scrollMessagingToBottom(true);
  }
  if (!message.mine) markMessagingConversationRead(messagingActiveConversationId).catch(() => {});
}

async function refreshActiveMessagingDirectPolicy() {
  const conversationId = String(messagingActiveConversationId || "");
  const current = messagingWorkspaceState.activeConversation;
  if (!conversationId || current?.kind !== "direct" || !document.querySelector("#messagingWorkspace")) return false;
  const payload = await api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}`);
  if (conversationId !== String(messagingActiveConversationId || "") || !payload?.conversation) return false;
  const next = payload.conversation;
  const previousPolicy = current.directPolicy || {};
  const nextPolicy = next.directPolicy || {};
  messagingWorkspaceState.activeConversation = next;
  const existingIndex = messagingWorkspaceState.conversations.findIndex((item) => String(item.id) === conversationId);
  if (existingIndex >= 0) messagingWorkspaceState.conversations[existingIndex] = next;
  const policyChanged = Boolean(current.canSend) !== Boolean(next.canSend)
    || Boolean(previousPolicy.waitingForReply) !== Boolean(nextPolicy.waitingForReply)
    || Boolean(previousPolicy.peerReplied) !== Boolean(nextPolicy.peerReplied);
  if (policyChanged) {
    const thread = document.querySelector(`.messaging-thread[data-active-conversation="${CSS.escape(conversationId)}"]`);
    if (thread) thread.outerHTML = messagingThreadHtml(next, messagingWorkspaceState.messages, {
      hasMore: messagingWorkspaceState.hasMore,
      nextCursor: messagingWorkspaceState.nextCursor,
    });
    const context = document.querySelector(".messaging-context-panel");
    if (context) context.outerHTML = messagingContextHtml(next, messagingWorkspaceState.messages, messagingWorkspaceState.memberPage);
    bindMessagingComposerControls();
    scrollMessagingToBottom(false);
  }
  renderMessagingConversationListState();
  return policyChanged;
}

async function refreshActiveMessagingModeration() {
  const conversationId = String(messagingActiveConversationId || "");
  if (!conversationId || !document.querySelector("#messagingWorkspace")) return false;
  if (messagingModerationRefreshPromise) return messagingModerationRefreshPromise;
  messagingModerationRefreshPromise = (async () => {
    const memberPageNumber = Math.max(1, Number(messagingWorkspaceState.memberPage?.page || 1));
    const [detail, memberPage] = await Promise.all([
      api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}`),
      api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/members?page=${memberPageNumber}&limit=12`),
    ]);
    if (conversationId !== String(messagingActiveConversationId || "") || !detail?.conversation) return false;
    const next = detail.conversation;
    messagingWorkspaceState.activeConversation = next;
    messagingWorkspaceState.memberPage = memberPage;
    const existingIndex = messagingWorkspaceState.conversations.findIndex((item) => String(item.id) === conversationId);
    if (existingIndex >= 0) messagingWorkspaceState.conversations[existingIndex] = next;
    const thread = document.querySelector(`.messaging-thread[data-active-conversation="${CSS.escape(conversationId)}"]`);
    if (thread) {
      thread.outerHTML = messagingThreadHtml(next, messagingWorkspaceState.messages, {
        hasMore: messagingWorkspaceState.hasMore,
        nextCursor: messagingWorkspaceState.nextCursor,
      });
    }
    const context = document.querySelector(".messaging-context-panel");
    if (context) context.outerHTML = messagingContextHtml(next, messagingWorkspaceState.messages, memberPage);
    bindMessagingComposerControls();
    renderMessagingConversationListState();
    scrollMessagingToBottom(false);
    return true;
  })();
  try {
    return await messagingModerationRefreshPromise;
  } finally {
    messagingModerationRefreshPromise = null;
  }
}

function markMessagingMessageWithdrawn(messageId) {
  const index = messagingWorkspaceState.messages.findIndex((item) => String(item.id) === String(messageId));
  if (index >= 0) messagingWorkspaceState.messages[index] = { ...messagingWorkspaceState.messages[index], status: "withdrawn", bodyMd: "", attachments: [], references: [] };
  const node = document.querySelector(`[data-messaging-message-id="${CSS.escape(String(messageId))}"]`);
  if (node && index >= 0) node.outerHTML = messagingMessageHtml(messagingWorkspaceState.messages[index]);
}

function markMessagingMessageHidden(messageId) {
  messagingWorkspaceState.messages = messagingWorkspaceState.messages.filter((item) => String(item.id) !== String(messageId));
  document.querySelector(`[data-messaging-message-id="${CSS.escape(String(messageId))}"]`)?.remove();
  const list = document.querySelector("#messagingMessageList");
  if (list && !list.querySelector(".messaging-message-row")) {
    list.innerHTML = '<div class="messaging-thread-welcome"><strong>当前没有可见消息</strong><span>已删除的消息只从你的会话视图隐藏。</span></div>';
  }
}

async function refreshMessagingMemberPage(page = 1) {
  if (!messagingActiveConversationId) return;
  const payload = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/members?page=${Math.max(1, Number(page) || 1)}&limit=12`);
  messagingWorkspaceState.memberPage = { ...payload, open: true };
  const section = document.querySelector(".messaging-members-section");
  if (section && messagingWorkspaceState.activeConversation) {
    section.outerHTML = messagingMemberSectionHtml(messagingWorkspaceState.activeConversation, messagingWorkspaceState.memberPage);
  }
}

function updateMessagingReadReceipts(cursor, userId) {
  if (!cursor || Number(userId) === Number(state.user?.id)) return;
  window.clearTimeout(messagingReadReceiptTimer);
  messagingReadReceiptTimer = window.setTimeout(() => refreshMessagingReadReceipts().catch(() => {}), 120);
}

async function refreshMessagingReadReceipts() {
  if (!messagingActiveConversationId || !document.querySelector("#messagingMessageList")) return;
  const payload = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/messages?limit=50`);
  (payload.items || []).forEach((message) => appendMessagingMessage(message));
}

function renderMessagingTyping() {
  const target = document.querySelector("#messagingTyping");
  if (!target) return;
  const users = [...messagingWorkspaceState.typingUsers.values()].map((entry) => entry.user).filter((user) => Number(user.id) !== Number(state.user?.id));
  target.hidden = users.length === 0;
  target.innerHTML = users.length ? `<span class="messaging-typing-dots"><i></i><i></i><i></i></span><span>${escapeHtml(users.slice(0, 2).map((user) => user.displayName || user.username).join("、"))}${users.length > 2 ? ` 等 ${users.length} 人` : ""}正在输入</span>` : "";
}

function updateMessagingTyping(user, active) {
  if (!user?.id || Number(user.id) === Number(state.user?.id)) return;
  const previous = messagingWorkspaceState.typingUsers.get(Number(user.id));
  if (previous?.timer) window.clearTimeout(previous.timer);
  if (!active) messagingWorkspaceState.typingUsers.delete(Number(user.id));
  else {
    const timer = window.setTimeout(() => { messagingWorkspaceState.typingUsers.delete(Number(user.id)); renderMessagingTyping(); }, 5000);
    messagingWorkspaceState.typingUsers.set(Number(user.id), { user, timer });
  }
  renderMessagingTyping();
}

function applyMessagingPresence(payload = {}) {
  const now = Date.now();
  if (Number(payload.ttlSeconds) > 0) messagingPresenceTtlMs = Number(payload.ttlSeconds) * 1000;
  const users = new Map((payload.online || []).map((user) => [Number(user.id), user]).filter(([id]) => id > 0));
  const observed = new Set((payload.observed || []).map(Number).filter((id) => id > 0));
  [
    Number(messagingWorkspaceState.activeConversation?.peer?.id || 0),
    ...((messagingWorkspaceState.activeConversation?.members || []).map((member) => Number(member.id || 0))),
    ...((messagingWorkspaceState.memberPage?.items || []).map((member) => Number(member.id || 0))),
  ].filter((id) => id > 0).forEach((id) => observed.add(id));
  if (!payload.private) {
    observed.forEach((id) => { if (!users.has(id)) messagingPresenceCache.delete(id); });
    users.forEach((user, id) => messagingPresenceCache.set(id, { ...user, seenAt: Date.parse(user.lastSeenAt || "") || now }));
  }
  messagingPresenceCache.forEach((user, id) => {
    if (now - Number(user.seenAt || 0) > messagingPresenceTtlMs + 5000) messagingPresenceCache.delete(id);
  });
  messagingWorkspaceState.presenceUsers = new Map(messagingPresenceCache);
  document.querySelectorAll("[data-presence-user]").forEach((node) => {
    const online = messagingPresenceCache.has(Number(node.dataset.presenceUser || 0));
    node.classList.toggle("is-online", online);
    node.setAttribute("aria-label", online ? "在线" : "离线");
  });
  document.querySelectorAll("[data-presence-label]").forEach((node) => {
    const online = messagingPresenceCache.has(Number(node.dataset.presenceLabel || 0));
    node.textContent = online ? "在线" : "离线";
    node.classList.toggle("is-online", online);
  });
  document.querySelectorAll("[data-profile-presence-user]").forEach((node) => {
    node.classList.toggle("is-online", messagingPresenceCache.has(Number(node.dataset.profilePresenceUser || 0)));
  });
}

async function refreshMessagingPresence() {
  if (!messagingActiveConversationId || !document.querySelector("#messagingWorkspace")) return;
  const payload = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/presence`);
  applyMessagingPresence(payload);
}

async function loadOlderMessagingMessages() {
  if (!messagingWorkspaceState.hasMore || !messagingWorkspaceState.nextCursor || !messagingActiveConversationId) return;
  const button = document.querySelector("[data-load-older-messages]");
  if (button) { button.disabled = true; button.textContent = "正在加载..."; }
  const scroll = document.querySelector("#messagingMessageScroll");
  const beforeHeight = scroll?.scrollHeight || 0;
  try {
    const payload = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/messages?limit=50&before=${Number(messagingWorkspaceState.nextCursor)}`);
    [...(payload.items || [])].reverse().forEach((message) => appendMessagingMessage(message, { prepend: true }));
    messagingWorkspaceState.hasMore = Boolean(payload.hasMore);
    messagingWorkspaceState.nextCursor = payload.nextCursor || null;
    const holder = document.querySelector(".messaging-load-older");
    if (holder) holder.innerHTML = messagingWorkspaceState.hasMore ? '<button type="button" data-load-older-messages>加载更早消息</button>' : '<span>会话从这里开始</span>';
    if (scroll) scroll.scrollTop += scroll.scrollHeight - beforeHeight;
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "重试加载"; }
    uiToast(error.message);
  }
}

async function uploadMessagingAttachments(files) {
  const status = document.querySelector("#messagingComposerStatus");
  for (const file of [...files].slice(0, 8 - messagingComposerState.attachments.length)) {
    if (status) status.textContent = `正在上传 ${file.name}...`;
    const body = new FormData();
    body.append("file", file);
    const result = await api("/api/messaging/attachments", { method: "POST", body });
    messagingComposerState.attachments.push(result.attachment);
    renderMessagingComposerState();
  }
  if (status) status.textContent = "";
}

function renderMessagingPickerResults(target, items, mode) {
  if (!target) return;
  if (!items.length) { target.innerHTML = '<p class="muted-line">没有找到匹配结果。</p>'; return; }
  target.innerHTML = items.map((item) => `<button class="messaging-picker-result" type="button" ${mode === "people" ? `data-start-direct="${Number(item.id)}"` : `data-add-reference="${escapeHtml(encodeURIComponent(JSON.stringify(item)))}"`}>
    ${avatarHtml({ displayName: item.displayName || item.label, username: item.username || item.label, avatarUrl: item.avatarUrl }, "small")}<span><strong>${escapeHtml(item.displayName || item.label || item.username)}</strong><small>${escapeHtml(item.username ? `@${item.username}` : shortText(item.summary || item.id, 90))}</small></span>${navigationIconSvg(mode === "people" ? "chat" : "network")}
  </button>`).join("");
}

async function pollMessagingWorkspace() {
  if (!document.querySelector("#messagingWorkspace") || !state.user) return;
  await refreshMessagingConversationList().catch(() => {});
  if (!messagingActiveConversationId) return;
  const payload = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/messages?limit=50`).catch(() => null);
  if (!payload) return;
  (payload.items || []).forEach((message) => appendMessagingMessage(message));
  if (messagingWorkspaceState.activeConversation?.kind === "direct"
    && messagingWorkspaceState.activeConversation?.directPolicy?.waitingForReply
    && (payload.items || []).some((message) => !message.mine && !message.metadata?.autoReply)) {
    await refreshActiveMessagingDirectPolicy().catch(() => {});
  }
}

function stopMessagingWorkspacePolling() {
  if (messagingPollTimer) window.clearInterval(messagingPollTimer);
  messagingPollTimer = 0;
  if (messagingPresenceTimer) window.clearInterval(messagingPresenceTimer);
  messagingPresenceTimer = 0;
  window.clearTimeout(messagingTypingTimer);
  window.clearTimeout(messagingTypingIdleTimer);
}

async function startMessagingWorkspacePolling() {
  const client = await ensureMessagingRealtime().catch(() => null);
  if (!document.querySelector("#messagingWorkspace")) return;
  messagingPollTimer = window.setInterval(pollMessagingWorkspace, client ? 30000 : 5000);
  if (messagingActiveConversationId) {
    refreshMessagingPresence().catch(() => {});
    messagingPresenceTimer = window.setInterval(() => refreshMessagingPresence().catch(() => {}), client ? 12000 : 8000);
  }
}

async function clearMessagingConversationSelection() {
  const workspace = document.querySelector("#messagingWorkspace");
  if (!workspace) return;
  stopMessagingWorkspacePolling();
  messagingWorkspaceState.activeConversation = null;
  messagingWorkspaceState.messages = [];
  messagingWorkspaceState.memberPage = { items: [], page: 1, pages: 1, total: 0, limit: 12, private: false };
  messagingWorkspaceState.hasMore = false;
  messagingWorkspaceState.nextCursor = null;
  messagingWorkspaceState.typingUsers = new Map();
  messagingComposerState = { attachments: [], references: [], replyTo: null };
  const thread = workspace.querySelector(".messaging-thread");
  if (thread) thread.outerHTML = messagingThreadHtml(null, [], {});
  workspace.querySelector(".messaging-context-panel")?.remove();
  workspace.classList.remove("has-active", "mobile-thread-open", "context-open");
  await subscribeMessagingConversation("").catch(() => {});
  renderMessagingConversationListState();
  startMessagingWorkspacePolling();
}

async function activateMessagingConversation(conversationId, options = {}) {
  conversationId = String(conversationId || "").trim();
  const workspace = document.querySelector("#messagingWorkspace");
  if (!conversationId || !workspace) return;
  if (conversationId === messagingActiveConversationId && messagingWorkspaceState.activeConversation && !options.force) {
    if (options.updateUrl !== false) history.replaceState(null, "", messagingWorkspaceHash(conversationId, messagingWorkspaceState.filters));
    workspace.classList.add("mobile-thread-open");
    return;
  }
  workspace.setAttribute("aria-busy", "true");
  stopMessagingWorkspacePolling();
  try {
    const [detail, pageData, memberPage] = await Promise.all([
      api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}`),
      api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`),
      api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/members?page=1&limit=12`),
    ]);
    const activeConversation = detail.conversation;
    const presenceIds = [...new Set([
      Number(activeConversation?.peer?.id || 0),
      ...(memberPage.items || []).map((member) => Number(member.id || 0)),
    ].filter((id) => id > 0))];
    if (presenceIds.length) {
      const presence = await api("/api/messaging/presence/heartbeat", {
        method: "POST",
        body: JSON.stringify({ userIds: presenceIds, context: `conversation:${conversationId}`, clientId: currentMessagingPresenceClientId() }),
      }).catch(() => null);
      if (presence) applyMessagingPresence(presence);
    }
    const exactPresence = await api(`/api/messaging/conversations/${encodeURIComponent(conversationId)}/presence`).catch(() => null);
    if (exactPresence) applyMessagingPresence(exactPresence);
    messagingComposerState = { attachments: [], references: [], replyTo: null };
    messagingWorkspaceState.activeConversation = activeConversation;
    messagingWorkspaceState.messages = pageData.items || [];
    messagingWorkspaceState.hasMore = Boolean(pageData.hasMore);
    messagingWorkspaceState.nextCursor = pageData.nextCursor || null;
    messagingWorkspaceState.memberPage = memberPage;
    messagingWorkspaceState.typingUsers = new Map();
    messagingWorkspaceState.presenceUsers = new Map(messagingPresenceCache);
    messagingActiveConversationId = conversationId;
    const existingIndex = messagingWorkspaceState.conversations.findIndex((conversation) => String(conversation.id) === conversationId);
    if (existingIndex >= 0) messagingWorkspaceState.conversations[existingIndex] = activeConversation;
    const thread = workspace.querySelector(".messaging-thread");
    if (thread) thread.outerHTML = messagingThreadHtml(activeConversation, messagingWorkspaceState.messages, pageData);
    const context = workspace.querySelector(".messaging-context-panel");
    const contextHtml = messagingContextHtml(activeConversation, messagingWorkspaceState.messages, memberPage);
    if (context) context.outerHTML = contextHtml;
    else workspace.insertAdjacentHTML("beforeend", contextHtml);
    workspace.classList.add("has-active", "mobile-thread-open");
    workspace.classList.remove("context-open");
    renderMessagingConversationListState();
    bindMessagingComposerControls();
    setChromeTitle(`${activeConversation.title} - 通信`);
    if (options.updateUrl !== false) history.replaceState(null, "", messagingWorkspaceHash(conversationId, messagingWorkspaceState.filters));
    await markMessagingConversationRead(conversationId);
    await subscribeMessagingConversation(conversationId).catch(() => {});
    scrollMessagingToBottom(false);
    return true;
  } catch (error) {
    await uiAlert("切换失败", error?.message || "暂时无法打开该会话，请稍后重试。", "error");
    return false;
  } finally {
    workspace.removeAttribute("aria-busy");
    startMessagingWorkspacePolling();
  }
}

function bindMessagingComposerControls() {
  const referenceType = document.querySelector("#messagingReferenceType");
  const referenceRevision = document.querySelector("#messagingReferenceRevision");
  referenceType?.addEventListener("change", () => { referenceRevision.hidden = referenceType.value !== "revision"; document.querySelector("#messagingReferenceSearch")?.dispatchEvent(new Event("input")); });
  let referenceTimer = 0;
  document.querySelector("#messagingReferenceSearch")?.addEventListener("input", (event) => {
    window.clearTimeout(referenceTimer);
    const query = event.currentTarget.value.trim();
    const target = document.querySelector("#messagingReferenceResults");
    if (!query) { target.innerHTML = '<p class="muted-line">搜索并选择要引用的内容。</p>'; return; }
    referenceTimer = window.setTimeout(async () => { target.innerHTML = '<p class="muted-line">正在解析知识对象...</p>'; const result = await api(`/api/messaging/objects/suggest?type=${encodeURIComponent(referenceType.value)}&q=${encodeURIComponent(query)}&limit=12`).catch(() => ({ items: [] })); renderMessagingPickerResults(target, result.items || [], "reference"); }, 180);
  });
  document.querySelector("#messagingAttachmentInput")?.addEventListener("change", async (event) => { try { await uploadMessagingAttachments(event.currentTarget.files || []); } catch (error) { await uiAlert("上传失败", error.message, "error"); } finally { event.currentTarget.value = ""; } });
  const composer = document.querySelector("#messagingComposer");
  const textarea = composer?.querySelector("textarea");
  const handleComposerInput = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(180, textarea.scrollHeight)}px`;
    updateMessagingMentionPicker(textarea);
    window.clearTimeout(messagingTypingTimer);
    window.clearTimeout(messagingTypingIdleTimer);
    messagingTypingTimer = window.setTimeout(() => api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/typing`, { method: "POST", body: JSON.stringify({ active: true }) }).catch(() => {}), 120);
    messagingTypingIdleTimer = window.setTimeout(() => api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/typing`, { method: "POST", body: JSON.stringify({ active: false }) }).catch(() => {}), 1800);
  };
  textarea?.addEventListener("input", handleComposerInput);
  textarea?.addEventListener("compositionend", () => window.setTimeout(() => updateMessagingMentionPicker(textarea), 0));
  textarea?.addEventListener("keyup", (event) => {
    if (!["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) updateMessagingMentionPicker(textarea);
  });
  textarea?.addEventListener("click", () => updateMessagingMentionPicker(textarea));
  textarea?.addEventListener("focus", () => updateMessagingMentionPicker(textarea));
  composer?.addEventListener("keydown", (event) => {
    const mentionPanel = document.querySelector("#messagingMentionPicker");
    if (mentionPanel && !mentionPanel.hidden && messagingMentionState.items.length) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const delta = event.key === "ArrowUp" ? -1 : 1;
        messagingMentionState.activeIndex = (messagingMentionState.activeIndex + delta + messagingMentionState.items.length) % messagingMentionState.items.length;
        renderMessagingMentionResults();
        return;
      }
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); selectMessagingMention(); return; }
      if (event.key === "Escape") { event.preventDefault(); closeMessagingMentionPicker(); return; }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
  });
  composer?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#messagingComposerStatus");
    const bodyMd = textarea.value.trim();
    if (!bodyMd && !messagingComposerState.attachments.length && !messagingComposerState.references.length) return;
    const submit = composer.querySelector("[type=submit]");
    const pendingAttachments = [...messagingComposerState.attachments];
    const pendingReferences = [...messagingComposerState.references];
    const pendingReply = messagingComposerState.replyTo;
    submit.disabled = true;
    if (status) status.textContent = "正在发送...";
    try {
      const result = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/messages`, { method: "POST", body: JSON.stringify({ bodyMd, clientNonce: `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, attachmentIds: messagingComposerState.attachments.map((item) => item.id), references: messagingComposerState.references, replyToId: messagingComposerState.replyTo?.id || "" }) });
      appendMessagingMessage(result.message);
      textarea.value = "";
      textarea.style.height = "auto";
      closeMessagingMentionPicker();
      messagingComposerState = { attachments: [], references: [], replyTo: null };
      renderMessagingComposerState();
      if (status) status.textContent = "";
      await refreshMessagingConversationList();
      scrollMessagingToBottom(true);
    } catch (error) {
      appendMessagingMessage({
        id: `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cursor: 0,
        type: pendingAttachments.length && !bodyMd ? "attachment" : "text",
        status: "failed",
        priority: "normal",
        bodyMd,
        bodyPlain: bodyMd,
        mine: true,
        createdAt: new Date().toISOString(),
        readByCount: 0,
        sender: {
          id: Number(state.user?.id || 0),
          username: state.user?.username || "",
          displayName: state.user?.displayName || state.user?.username || "",
          avatarUrl: state.user?.avatarUrl || "",
        },
        attachments: pendingAttachments,
        references: pendingReferences,
        replyTo: pendingReply ? {
          id: pendingReply.id,
          senderName: pendingReply.sender?.displayName || pendingReply.sender?.username || "消息",
          preview: pendingReply.bodyPlain || pendingReply.bodyMd || "",
        } : null,
        sendError: error?.message || "消息未能送达，请稍后重试。",
        errorCode: error?.code || "message_send_failed",
      });
      textarea.value = "";
      textarea.style.height = "auto";
      closeMessagingMentionPicker();
      messagingComposerState = { attachments: [], references: [], replyTo: null };
      renderMessagingComposerState();
      if (status) status.textContent = error?.message || "发送失败";
    } finally { submit.disabled = false; }
  });
}

function positionMessagingMemberActionMenu(trigger) {
  const menu = document.getElementById(String(trigger?.getAttribute("popovertarget") || ""));
  if (!menu) return;
  window.requestAnimationFrame(() => {
    if (!menu.matches(":popover-open")) return;
    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const left = Math.max(viewportPadding, Math.min(triggerRect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding));
    const below = triggerRect.bottom + gap;
    const top = below + menuHeight <= window.innerHeight - viewportPadding
      ? below
      : Math.max(viewportPadding, triggerRect.top - menuHeight - gap);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  });
}

function bindMessagingWorkspace() {
  const workspace = document.querySelector("#messagingWorkspace");
  if (!workspace) return;
  const openPeoplePicker = () => {
    const panel = document.querySelector("#messagingPeoplePicker");
    if (!panel) return;
    panel.hidden = false;
    document.querySelector("#messagingPeopleSearch")?.focus();
  };
  workspace.addEventListener("click", async (event) => {
    const memberMenuToggle = event.target.closest("[data-messaging-member-menu-toggle]");
    if (memberMenuToggle) { positionMessagingMemberActionMenu(memberMenuToggle); return; }
    const contextToggle = event.target.closest("[data-toggle-context-panel]");
    if (workspace.classList.contains("context-open")
      && window.matchMedia("(max-width: 1480px)").matches
      && !contextToggle
      && !event.target.closest(".messaging-context-panel")) {
      workspace.classList.remove("context-open");
    }
    const conversationLink = event.target.closest("[data-conversation-id]");
    if (conversationLink) { event.preventDefault(); await activateMessagingConversation(conversationLink.dataset.conversationId); return; }
    const openPeople = event.target.closest("[data-open-people-picker]");
    if (openPeople) { openPeoplePicker(); return; }
    const closePicker = event.target.closest("[data-close-messaging-picker]");
    if (closePicker) { closePicker.closest(".messaging-picker, .messaging-people-picker").hidden = true; return; }
    const kind = event.target.closest("[data-messaging-kind]");
    if (kind) { await applyMessagingConversationFilters({ ...messagingWorkspaceState.filters, kind: kind.dataset.messagingKind, page: 1 }); return; }
    const pageButton = event.target.closest("[data-messaging-page]");
    if (pageButton) { await applyMessagingConversationFilters({ ...messagingWorkspaceState.filters, page: Number(pageButton.dataset.messagingPage) }); return; }
    const memberPageButton = event.target.closest("[data-messaging-member-page]");
    if (memberPageButton) { await refreshMessagingMemberPage(Number(memberPageButton.dataset.messagingMemberPage)); return; }
    const allMuted = event.target.closest("[data-messaging-all-muted]");
    if (allMuted && messagingActiveConversationId) {
      const nextAllMuted = allMuted.dataset.messagingAllMuted === "true";
      allMuted.disabled = true;
      try {
        await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/moderation`, { method: "PUT", body: JSON.stringify({ allMuted: nextAllMuted }) });
        await refreshActiveMessagingModeration();
        await refreshMessagingReadReceipts().catch(() => {});
        uiToast(nextAllMuted ? "已开启全体禁言" : "已解除全体禁言");
      } catch (error) {
        allMuted.disabled = false;
        await uiAlert("设置失败", error.message, "error");
      }
      return;
    }
    const memberMute = event.target.closest("[data-messaging-member-mute]");
    if (memberMute && messagingActiveConversationId) {
      const userId = Number(memberMute.dataset.messagingMemberMute || 0);
      const muted = memberMute.dataset.muted !== "true";
      const duration = Number(document.querySelector(`[data-messaging-mute-duration="${userId}"]`)?.value || 60);
      memberMute.disabled = true;
      try {
        await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/members/${userId}/mute`, { method: "PUT", body: JSON.stringify({ muted, durationMinutes: duration }) });
        await refreshActiveMessagingModeration();
        uiToast(muted ? "成员已被禁言" : "成员已解除禁言");
      } catch (error) {
        memberMute.disabled = false;
        await uiAlert("禁言设置失败", error.message, "error");
      }
      return;
    }
    if (event.target.closest("[data-messaging-back]")) { workspace.classList.remove("mobile-thread-open"); history.replaceState(null, "", messagingWorkspaceHash("", messagingWorkspaceState.filters)); return; }
    if (contextToggle) { workspace.classList.toggle("context-open"); return; }
    if (event.target.closest("[data-load-older-messages]")) { await loadOlderMessagingMessages(); return; }
    const scrollMessage = event.target.closest("[data-scroll-message]");
    if (scrollMessage) { document.querySelector(`[data-messaging-message-id="${CSS.escape(scrollMessage.dataset.scrollMessage)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const reply = event.target.closest("[data-reply-message]");
    if (reply) { messagingComposerState.replyTo = messagingWorkspaceState.messages.find((item) => String(item.id) === reply.dataset.replyMessage) || null; renderMessagingComposerState(); document.querySelector("#messagingComposer textarea")?.focus(); return; }
    if (event.target.closest("[data-remove-composer-reply]")) { messagingComposerState.replyTo = null; renderMessagingComposerState(); return; }
    const failedMessageButton = event.target.closest("[data-failed-message]");
    if (failedMessageButton) {
      const failedMessage = messagingWorkspaceState.messages.find((item) => String(item.id) === failedMessageButton.dataset.failedMessage);
      await uiAlert("发送失败", failedMessage?.sendError || "消息未能送达，请稍后重试。", "error");
      return;
    }
    const retryFailed = event.target.closest("[data-retry-failed-message]");
    if (retryFailed) {
      const failedMessage = messagingWorkspaceState.messages.find((item) => String(item.id) === retryFailed.dataset.retryFailedMessage);
      if (!failedMessage) return;
      messagingComposerState = {
        attachments: [...(failedMessage.attachments || [])],
        references: [...(failedMessage.references || [])],
        replyTo: failedMessage.replyTo ? messagingWorkspaceState.messages.find((item) => String(item.id) === String(failedMessage.replyTo.id)) || null : null,
      };
      const textarea = document.querySelector("#messagingComposer textarea");
      if (textarea) {
        textarea.value = failedMessage.bodyMd || failedMessage.bodyPlain || "";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
      }
      renderMessagingComposerState();
      markMessagingMessageHidden(failedMessage.id);
      return;
    }
    const dismissFailed = event.target.closest("[data-dismiss-failed-message]");
    if (dismissFailed) { markMessagingMessageHidden(dismissFailed.dataset.dismissFailedMessage); return; }
    const removeReference = event.target.closest("[data-remove-composer-reference]");
    if (removeReference) { messagingComposerState.references.splice(Number(removeReference.dataset.removeComposerReference), 1); renderMessagingComposerState(); return; }
    const removeAttachment = event.target.closest("[data-remove-composer-attachment]");
    if (removeAttachment) { messagingComposerState.attachments.splice(Number(removeAttachment.dataset.removeComposerAttachment), 1); renderMessagingComposerState(); return; }
    const withdraw = event.target.closest("[data-withdraw-message]");
    if (withdraw) {
      const accepted = await uiConfirm({ title: "撤回消息", text: "撤回后消息内容将隐藏。", confirmText: "确认撤回" });
      if (!accepted) return;
      try { const result = await api(`/api/messaging/messages/${encodeURIComponent(withdraw.dataset.withdrawMessage)}`, { method: "DELETE" }); markMessagingMessageWithdrawn(result.message?.id || withdraw.dataset.withdrawMessage); } catch (error) { await uiAlert("撤回失败", error.message, "error"); }
      return;
    }
    const hideMessage = event.target.closest("[data-hide-message]");
    if (hideMessage) {
      const accepted = await uiConfirm({ title: "删除这条消息", text: "这条消息将从你的会话视图隐藏。", confirmText: "从我的视图删除", danger: true });
      if (!accepted) return;
      try {
        const result = await api(`/api/messaging/messages/${encodeURIComponent(hideMessage.dataset.hideMessage)}/visibility`, { method: "DELETE" });
        markMessagingMessageHidden(result.messageId || hideMessage.dataset.hideMessage);
        state.unreadMessages = Number(result.unreadCount || 0);
        renderMessageBadge();
        await refreshMessagingConversationList();
      } catch (error) { await uiAlert("删除失败", error.message, "error"); }
      return;
    }
    const setting = event.target.closest("[data-messaging-setting]");
    if (setting && messagingActiveConversationId) {
      const key = setting.dataset.messagingSetting;
      const value = setting.dataset.settingValue === "true";
      try {
        const result = await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/settings`, { method: "PUT", body: JSON.stringify({ [key]: value }) });
        messagingWorkspaceState.activeConversation = result.conversation;
        const existingIndex = messagingWorkspaceState.conversations.findIndex((conversation) => String(conversation.id) === String(result.conversation.id));
        if (existingIndex >= 0) messagingWorkspaceState.conversations[existingIndex] = result.conversation;
        await refreshMessagingConversationList();
        const context = document.querySelector(".messaging-context-panel");
        if (context) context.outerHTML = messagingContextHtml(result.conversation, messagingWorkspaceState.messages, messagingWorkspaceState.memberPage);
        document.querySelectorAll(`[data-messaging-setting="${CSS.escape(key)}"]`).forEach((button) => {
          button.dataset.settingValue = String(!value);
          if (key === "pinned" && button.closest(".messaging-thread-actions")) button.title = value ? "取消置顶" : "置顶会话";
        });
        uiToast("会话设置已更新");
      } catch (error) { await uiAlert("设置失败", error.message, "error"); }
      return;
    }
    const direct = event.target.closest("[data-start-direct]");
    if (direct) {
      direct.disabled = true;
      try { const result = await api("/api/messaging/conversations/direct", { method: "POST", body: JSON.stringify({ userId: Number(direct.dataset.startDirect) }) }); location.hash = `#/messages/${encodeURIComponent(result.conversation.id)}`; } catch (error) { direct.disabled = false; await uiAlert("无法发起私信", error.message, "error"); }
      return;
    }
    const addReference = event.target.closest("[data-add-reference]");
    if (addReference) {
      const item = JSON.parse(decodeURIComponent(addReference.dataset.addReference));
      if (item.type === "revision") {
        const revision = document.querySelector("#messagingReferenceRevision")?.value.trim();
        if (!revision) { uiToast("请先填写修订版本标识"); return; }
        item.revision = revision;
      }
      if (!messagingComposerState.references.some((entry) => entry.type === item.type && String(entry.id) === String(item.id) && String(entry.revision || "") === String(item.revision || ""))) {
        messagingComposerState.references.push({ ...item, relation: "context" });
      }
      insertMessagingComposerText(messagingReferenceToken(item));
      renderMessagingComposerState();
      document.querySelector("#messagingReferencePicker").hidden = true;
      return;
    }
    const mention = event.target.closest("[data-select-messaging-mention]");
    if (mention) { selectMessagingMention(Number(mention.dataset.mentionIndex || 0)); return; }
    if (event.target.closest("[data-upload-messaging-attachment]")) { document.querySelector("#messagingAttachmentInput")?.click(); return; }
    if (event.target.closest("[data-open-reference-picker]")) { closeMessagingMentionPicker(); const panel = document.querySelector("#messagingReferencePicker"); panel.hidden = !panel.hidden; if (!panel.hidden) document.querySelector("#messagingReferenceSearch")?.focus(); return; }
  });
  document.querySelector("#messagingConversationSearch")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q") || "";
    await applyMessagingConversationFilters({ ...messagingWorkspaceState.filters, q, page: 1 });
  });
  let peopleTimer = 0;
  document.querySelector("#messagingPeopleSearch")?.addEventListener("input", (event) => {
    window.clearTimeout(peopleTimer);
    const query = event.currentTarget.value.trim();
    const target = document.querySelector("#messagingPeopleResults");
    if (!query) { target.innerHTML = '<p class="muted-line">输入至少一个字符。</p>'; return; }
    peopleTimer = window.setTimeout(async () => { target.innerHTML = '<p class="muted-line">正在查找...</p>'; const result = await api(`/api/messaging/users/suggest?q=${encodeURIComponent(query)}&limit=12`).catch(() => ({ items: [] })); renderMessagingPickerResults(target, result.items || [], "people"); }, 180);
  });
  workspace.addEventListener("change", async (event) => {
    const role = event.target.closest("[data-messaging-member-role]");
    if (!role || !messagingActiveConversationId) return;
    role.disabled = true;
    try {
      await api(`/api/messaging/conversations/${encodeURIComponent(messagingActiveConversationId)}/members/${Number(role.dataset.messagingMemberRole)}/role`, { method: "PUT", body: JSON.stringify({ role: role.value }) });
      await refreshActiveMessagingModeration();
      uiToast("群聊身份已更新");
    } catch (error) {
      role.disabled = false;
      await uiAlert("身份更新失败", error.message, "error");
    }
  });
  bindMessagingComposerControls();
  document.querySelector("[data-open-messaging-preferences]")?.addEventListener("click", () => openMessagingPreferencesDialog());
  document.querySelector("[data-messaging-read-all]")?.addEventListener("click", async (event) => { event.currentTarget.disabled = true; const result = await api("/api/messaging/read-all", { method: "PUT", body: "{}" }); state.unreadMessages = Number(result.unreadCount || 0); renderMessageBadge(); await refreshMessagingConversationList(); });
}
function userFollowButtonHtml(user, isSelf, isBanned) {
  if (isSelf || isBanned) return "";
  const follow = user.follow || {};
  const label = follow.mutual ? "互相关注" : follow.following ? "已关注" : "关注";
  return `<button class="command-button secondary user-follow-button ${follow.following ? "active" : ""}" type="button" id="userFollowButton" data-user-follow="${escapeHtml(user.username)}" aria-pressed="${Boolean(follow.following)}">${label}</button>`;
}

function updateUserFollowButton(button, follow = {}) {
  if (!button) return;
  button.classList.toggle("active", Boolean(follow.following));
  button.setAttribute("aria-pressed", String(Boolean(follow.following)));
  button.textContent = follow.mutual ? "互相关注" : follow.following ? "已关注" : "关注";
  button.title = follow.following ? "取消关注该用户" : "关注该用户的词条更新";
}

function bindUserFollowButton(user) {
  const button = document.querySelector("#userFollowButton");
  if (!button) return;
  updateUserFollowButton(button, user.follow || {});
  button.addEventListener("click", async () => {
    if (!state.user) {
      const accepted = await uiConfirm({ title: "登录后关注用户", text: "关注后，对方创建、保存、恢复或更新译文时会写入站内信。", confirmText: "去登录" });
      if (accepted) location.hash = "#/login";
      return;
    }
    button.disabled = true;
    try {
      const enabled = button.getAttribute("aria-pressed") !== "true";
      const result = await api(`/api/users/${encodeURIComponent(user.username)}/follow`, { method: "PUT", body: JSON.stringify({ enabled }) });
      user.follow = result.follow;
      updateUserFollowButton(button, result.follow);
      const message = result.follow.following ? (result.follow.mutual ? "已互相关注" : "已关注用户") : "已取消关注";
      await renderUserPage(user.username);
      uiToast(message);
    } catch (error) {
      await uiAlert("关注失败", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

function followUserCard(item) {
  const user = item.user || item;
  return `<article class="follow-user-card"><a href="#/user/${encodeURIComponent(user.username)}">${avatarHtml(user, "small")}<div><strong>${escapeHtml(user.displayName || user.username)}</strong><span>@${escapeHtml(user.username)}</span><small>编辑 ${Number(user.stats?.edits || 0)} · 关注者 ${Number(user.stats?.followers || 0)}</small></div></a><span>关注于 ${fmtDate(item.createdAt)}</span></article>`;
}

async function renderFollowing(value = "") {
  await refreshUser();
  if (!state.user) { location.hash = "#/login"; return; }
  const parsed = splitValueQuery(value);
  const direction = parsed.params.get("direction") === "followers" ? "followers" : "following";
  const page = Math.max(1, Number(parsed.params.get("page")) || 1);
  setChromeTitle(direction === "followers" ? "关注我的用户" : "我关注的用户");
  renderToc([]);
  el.editLink.href = "#/new";
  const payload = await api(`/api/passport/follows?direction=${direction}&page=${page}&limit=12`);
  const { items, pagination } = normalizedPaged(payload, page, 12);
  const href = (nextDirection, nextPage = 1) => `#/following?direction=${nextDirection}&page=${nextPage}`;
  el.main.innerHTML = `
    <header class="article-head favorites-page-head">
      <div class="article-title-row"><h1>社交关系</h1><span class="quality-badge">${Number(pagination.total || 0)} 人</span></div>
      <p class="article-summary">关注贡献者，其词条与译文更新会进入消息中心。</p>
      <nav class="following-tabs"><a class="${direction === "following" ? "active" : ""}" href="${href("following")}">我关注的</a><a class="${direction === "followers" ? "active" : ""}" href="${href("followers")}">关注我的</a></nav>
    </header>
    <section class="follow-user-list">${items.length ? items.map(followUserCard).join("") : `<div class="empty-state"><h2>${direction === "following" ? "还没有关注用户" : "还没有关注者"}</h2><p class="muted-line">在任何公开用户主页点击关注即可建立关系。</p></div>`}</section>
    ${paginationHtml(pagination, "社交关系")}`;
  bindPagination(el.main, (nextPage) => { location.hash = href(direction, nextPage); });
}

async function renderUserPage(username) {
  setChromeTitle(`用户 ${username}`);
  renderToc([]);
  el.editLink.href = "#/new";
  await refreshUser().catch(() => {});
  try {
    const { user } = await api(`/api/users/${encodeURIComponent(username)}`);
    const [communityReputation, publicAchievements] = await Promise.all([
      api(`/api/community/qa/users/${Number(user.id)}/reputation?page=1&limit=8`).catch(() => ({ score: 0, rank: 0, events: { items: [] } })),
      api(`/api/achievements/users/${Number(user.id)}`).catch(() => ({ summary: { earned: 0, total: 0, points: 0, completion: 0 } })),
    ]);
    const growthSummary = publicAchievements.summary || { earned: 0, total: 0, points: 0, completion: 0 };
    setChromeTitle(user.displayName || user.username);
    renderToc(user.toc || []);
    const isSelf = state.user?.username && state.user.username.toLowerCase() === String(user.username || "").toLowerCase();
    const isBanned = user.status === "disabled" || user.isBanned === true;
    const editProfileButton = isSelf ? `<a class="icon-button user-profile-edit" href="#/account" title="编辑个人主页" aria-label="编辑个人主页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg></a>` : "";
    const followButton = userFollowButtonHtml(user, isSelf, isBanned);
    const messageButton = state.user && !isSelf && !isBanned ? `<a class="command-button secondary user-message-button" href="#/messages?user=${Number(user.id)}">${navigationIconSvg("chat")}<span>私信</span></a>` : "";
    const activity = user.recentEdits?.length
      ? user.recentEdits.slice(0, 10).map((event) => `<a class="edit-event" href="#/page/${encodeSlug(event.pageSlug)}"><div><strong>${escapeHtml(event.pageTitle)}</strong><span>${event.action === "create" ? "创建" : event.action === "delete" ? "删除" : "编辑"}</span></div><small>${fmtDate(event.createdAt)}</small></a>`).join("")
      : `<p class="muted-line">暂无公开活动。</p>`;
    el.main.innerHTML = `
      <header class="article-head user-head profile-hero public-profile-hero">
        <div class="profile-hero-main">${avatarHtml(user, "large")}<div class="profile-hero-copy"><span class="system-kicker">Community Profile</span><h1>${escapeHtml(user.displayName || user.username)}</h1><p>@${escapeHtml(user.username)} · ${escapeHtml(user.groupLabel || GROUP_LABELS[user.role] || user.role)} <span class="user-presence-status ${user.online ? "is-online" : ""}" data-profile-presence-user="${Number(user.id)}" title="实时在线状态"><i></i><span class="messaging-presence-label ${user.online ? "is-online" : ""}" data-presence-label="${Number(user.id)}">${user.online ? "在线" : "离线"}</span></span></p><small>${escapeHtml(user.bio || "这个用户还没有填写简介。")}</small></div></div>
        <div class="profile-hero-actions">${followButton}${messageButton}${editProfileButton}</div>
        <div class="profile-metric-strip public-profile-metric-strip"><span><strong>${Number(user.stats?.edits || 0)}</strong><span>编辑</span></span><span><strong>${Number(user.stats?.comments || 0)}</strong><span>评论</span></span><span><strong>${Number(communityReputation.score || 0)}</strong><span>社区声望</span></span><span><strong>#${Number(communityReputation.rank || 0)}</strong><span>社区排名</span></span><span><strong>${Number(user.stats?.followers || 0)}</strong><span>关注者</span></span><span><strong>${Number(user.stats?.following || 0)}</strong><span>正在关注</span></span><span><strong>${fmtDate(user.createdAt).split(" ")[0] || "-"}</strong><span>加入日期</span></span></div>
        ${socialLinksHtml(user.socialLinks, "public")}
      </header>
      ${isBanned ? `<section class="user-ban-notice" role="status"><div><strong>该用户已被封禁</strong><p>该账户无法登录或发起新的编辑、评论与消息；既有公开贡献仍可查看。</p></div><span>账户状态：已封禁</span></section>` : ""}
      ${organizationIdentityPanelHtml(user.organizations || [], Number(user.stats?.organizations || 0), { public: true, username: user.username })}
      <section class="community-profile-grid public-growth-grid">
        <article class="community-profile-panel"><header><div><span class="system-kicker">Community Reputation</span><h2>问答声望</h2></div><strong>${Number(communityReputation.score || 0)}</strong></header><div class="public-reputation-summary"><span><strong>#${Number(communityReputation.rank || 0)}</strong><small>社区排名</small></span><span><strong>${Number(communityReputation.events?.total || 0)}</strong><small>声望记录</small></span></div></article>
        <article class="community-profile-panel public-growth-panel" style="--achievement-progress:${Math.max(0, Math.min(100, Number(growthSummary.completion || 0)))}%"><div class="achievement-progress-ring"><strong>${Number(growthSummary.completion || 0)}%</strong><span>成长进度</span></div><div class="achievement-overview-copy"><span class="system-kicker">Wikist Growth</span><h3>知识成长历程</h3><p>持续创作、协作和交流，解锁覆盖全站的贡献成就。</p><div class="achievement-summary-metrics"><span><strong>${Number(growthSummary.earned || 0)}</strong><small>已解锁</small></span><span><strong>${Number(growthSummary.points || 0)}</strong><small>成长点数</small></span></div></div></article>
      </section>
      <section class="user-profile-layout">
        <article class="article-body user-profile-body" ${selectionContentAttributes({ type: "user_page", id: user.id, label: `${user.displayName || user.username} 的个人主页`, url: `#/user/${encodeURIComponent(user.username)}` })}>${user.pageHtml || ""}</article>
        <aside class="user-edit-feed"><h2>最近贡献</h2>${activity}</aside>
      </section>`;
    bindUserFollowButton(user);
    refreshMessagingHeartbeat("route:user-profile").catch(() => {});
    typesetMath();
  } catch (error) {
    el.main.innerHTML = `<section class="empty-state"><h1>用户不存在</h1><p>${escapeHtml(error.message)}</p></section>`;
  }
}

async function renderAdminKnowledge() {
  const payload = await api("/api/admin/knowledge");
  const stats = payload.stats || {};
  const missingRows = (payload.missing || []).map((item) => `<tr><td><strong>${escapeHtml(item.label || item.slug)}</strong><small>${escapeHtml(item.slug)}</small></td><td>${Number(item.sourceCount || 0)}</td><td>${(item.sourceSlugs || []).slice(0, 4).map((slug) => `<a class="mini-link" href="#/page/${encodeSlug(slug)}">${escapeHtml(slug)}</a>`).join(" ")}</td><td><a class="mini-button" href="#/edit/${encodeSlug(item.slug)}">创建词条</a></td></tr>`).join("");
  const orphanRows = (payload.orphans || []).map((page) => `<tr><td><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)}</small></td><td>${escapeHtml(page.summary || "")}</td><td><a class="mini-link" href="#/page/${encodeSlug(page.slug)}">查看</a> <a class="mini-link" href="#/edit/${encodeSlug(page.slug)}">编辑</a></td></tr>`).join("");
  const aliasRows = (payload.aliases || []).map((alias) => `<tr><td><strong>${escapeHtml(alias.aliasSlug)}</strong></td><td><a class="mini-link" href="#/page/${encodeSlug(alias.targetSlug)}">${escapeHtml(alias.targetSlug)}</a></td><td><button class="mini-button danger" type="button" data-delete-alias="${escapeHtml(alias.aliasSlug)}">删除</button></td></tr>`).join("");
  el.main.innerHTML = adminShell("knowledge", `
    ${adminHeader("知识网络", "查看缺失词条、孤立词条、别名与重定向。")}
    <section class="admin-metrics knowledge-admin-metrics">
      ${[["词条", stats.pages], ["链接", stats.links], ["反向链接", stats.backlinks], ["缺失", stats.missing], ["孤立", stats.orphans], ["别名", stats.aliases]].map(([label, value]) => `<div class="admin-metric"><span>${label}</span><strong>${Number(value || 0)}</strong></div>`).join("")}
    </section>
    <section class="admin-grid knowledge-admin-grid">
      <form class="admin-settings-panel" id="aliasForm">
        <div class="panel-heading-row"><div><h2>别名与重定向</h2><p class="muted-line">添加别名，或把旧地址指向现有词条。</p></div></div>
        <label>别名 slug<input name="aliasSlug" placeholder="例如 group-theory" required /></label>
        <label>目标词条 slug<input name="targetSlug" placeholder="例如 abstract-algebra/group" required /></label>
        <div class="editor-actions"><button class="command-button" type="submit">保存别名</button><button class="command-button secondary" type="button" id="rebuildKnowledgeIndex">重建索引</button></div>
        <div class="status-line" id="knowledgeAdminStatus"></div>
      </form>
      <section class="admin-note"><strong>分类覆盖</strong><div class="chip-row knowledge-category-chips">${(payload.categories || []).slice(0, 24).map((item) => `<span class="chip">${escapeHtml(item.name)} · ${item.pageCount}</span>`).join("") || '<span class="muted-line">暂无分类数据。</span>'}</div></section>
    </section>
    <section class="admin-table-wrap"><table class="admin-table"><thead><tr><th>缺失概念</th><th>引用数</th><th>来源词条</th><th>操作</th></tr></thead><tbody>${missingRows || '<tr><td colspan="4">没有缺失词条。</td></tr>'}</tbody></table></section>
    <section class="admin-table-wrap"><table class="admin-table"><thead><tr><th>孤立词条</th><th>摘要</th><th>操作</th></tr></thead><tbody>${orphanRows || '<tr><td colspan="3">没有孤立词条。</td></tr>'}</tbody></table></section>
    <section class="admin-table-wrap"><table class="admin-table"><thead><tr><th>别名</th><th>目标词条</th><th>操作</th></tr></thead><tbody>${aliasRows || '<tr><td colspan="3">尚未配置别名。</td></tr>'}</tbody></table></section>
  `);
  const status = document.querySelector("#knowledgeAdminStatus");
  document.querySelector("#aliasForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "正在保存别名...";
    try {
      await api("/api/admin/aliases", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      status.textContent = "别名已保存。";
      await renderAdminKnowledge();
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
  document.querySelector("#rebuildKnowledgeIndex")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    status.textContent = "正在重建链接索引...";
    try {
      const result = await api("/api/admin/knowledge/rebuild", { method: "POST", body: "{}" });
      status.textContent = `已重建 ${result.result?.pages || 0} 个词条的链接索引。`;
      await renderAdminKnowledge();
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
  document.querySelectorAll("[data-delete-alias]").forEach((button) => {
    button.addEventListener("click", async () => {
      const accepted = await uiConfirm({ title: "删除词条别名", text: `确定删除 ${button.dataset.deleteAlias} 吗？`, confirmText: "删除", icon: "warning" });
      if (!accepted) return;
      button.disabled = true;
      try {
        await api(`/api/admin/aliases/${encodeSlug(button.dataset.deleteAlias)}`, { method: "DELETE", body: "{}" });
        uiToast("别名已删除");
        await renderAdminKnowledge();
      } catch (error) {
        button.disabled = false;
        await uiAlert("删除失败", error.message, "error");
      }
    });
  });
}

function adminSectionTitleLegacy(section) {
  return ({ overview: "概览", users: "用户管理", pages: "词条管理", knowledge: "知识网络", citations: "来源审阅", comments: "评论管理", "comment-replies": "二级评论", messages: "消息管理", logs: "更新日志", archives: "归档页面", backups: "全站备份", settings: "站点设置", imports: "导入导出", plugins: "插件管理" })[section] || "概览";
}

function adminSectionTitle(section) {
  return ({ overview: "概览", users: "用户管理", organizations: "协作社区管理", community: "社区治理", pages: "词条管理", knowledge: "知识网络", citations: "来源审阅", reviews: "版本审阅", "search-index": "搜索索引", runtime: "运行健康", comments: "评论管理", "comment-replies": "二级评论", messages: "消息管理", logs: "更新日志", archives: "归档页面", backups: "全站备份", settings: "站点设置", imports: "导入导出", plugins: "插件管理" })[section] || pluginAdminPanels.get(section)?.title || "概览";
}

function adminShellLegacy(active, body) {
  const sections = [
    ["overview", "概览"],
    ...(canManageUsers() ? [["users", "用户管理"]] : []),
    ["organizations", "协作社区管理"],
    ["community", "社区治理"],
    ["pages", "词条管理"],
    ["knowledge", "知识网络"],
    ["citations", "来源审阅"],
    ["comments", "评论管理"],
    ["messages", "消息管理"],
    ["logs", "更新日志"],
    ["archives", "归档页面"],
    ["backups", "全站备份"],
    ["imports", "导入导出"],
    ["settings", "站点设置"],
    ["plugins", "插件管理"],
    ...activePluginAdminPanels().map((panel) => [panel.routeId, panel.title]),
  ];
  return `
    <section class="admin-layout">
      <aside class="admin-sidebar" aria-label="后台导航">
        <div class="admin-sidebar-head"><span class="system-kicker">${escapeHtml(currentSiteName())} Admin</span><strong>控制面板</strong></div>
        <nav>${sections.map(([id, label]) => `<a class="${id === active ? "active" : ""}" href="#/admin/${id}">${label}</a>`).join("")}</nav>
      </aside>
      <section class="admin-main">${body}</section>
    </section>`;
}

function adminShell(active, body) {
  const sections = [
    ["overview", "概览"],
    ...(canManageUsers() ? [["users", "用户管理"]] : []),
    ["organizations", "协作社区管理"],
    ["community", "社区治理"],
    ["pages", "词条管理"],
    ["knowledge", "知识网络"],
    ["citations", "来源审阅"],
    ["reviews", "版本审阅"],
    ["search-index", "搜索索引"],
    ["runtime", "运行健康"],
    ["comments", "评论管理"],
    ["messages", "消息管理"],
    ["logs", "更新日志"],
    ["archives", "归档页面"],
    ["backups", "全站备份"],
    ["imports", "导入导出"],
    ["settings", "站点设置"],
    ["plugins", "插件管理"],
  ];
  return `<section class="admin-layout"><button class="admin-mobile-nav-toggle" id="adminMobileNavToggle" type="button" aria-label="&#25171;&#24320;&#21518;&#21488;&#23548;&#33322;" aria-controls="adminMobileNav" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h5v5H5V5Zm9 0h5v5h-5V5ZM5 14h5v5H5v-5Zm9 0h5v5h-5v-5Z"/></svg></button><button class="admin-mobile-nav-backdrop" id="adminMobileNavBackdrop" type="button" aria-label="&#20851;&#38381;&#21518;&#21488;&#23548;&#33322;" tabindex="-1"></button><aside class="admin-sidebar" id="adminMobileNav" aria-label="&#21518;&#21488;&#23548;&#33322;"><div class="admin-sidebar-head"><span class="system-kicker">${escapeHtml(currentSiteName())} Admin</span><strong>&#25511;&#21046;&#38754;&#26495;</strong></div><nav>${sections.map(([id, label]) => `<a class="${id === active ? "active" : ""}" href="#/admin/${id}">${label}</a>`).join("")}</nav></aside><section class="admin-main">${body}</section></section>`;
}

function adminHeader(title, summary) {
  return `<header class="article-head admin-head"><div class="article-title-row"><h1>${escapeHtml(title)}</h1><span class="quality-badge">后台</span></div><p class="article-summary">${escapeHtml(summary)}</p></header>`;
}

async function renderPluginAdminPanel(panel) {
  el.main.innerHTML = adminShell(panel.routeId, `${adminHeader(panel.title, panel.description || "查看并管理插件提供的后台功能。")}<section class="admin-settings-panel plugin-hook-panel"><div id="pluginHookPanelRoot"></div></section>`);
  const root = document.querySelector("#pluginHookPanelRoot");
  try {
    await panel.render({ root, api, state, route, plugin: (state.site?.pluginCatalog || []).find((item) => item.id === panel.pluginId) || null });
  } catch (error) {
    root.innerHTML = `<p class="status-line error">${escapeHtml(error.message || "插件后台面板加载失败。")}</p>`;
  }
}

function adminSearchForm(id, value, placeholder, extra = "") {
  return `<form class="admin-toolbar" id="${id}"><input name="q" type="search" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" />${extra}<button class="command-button" type="submit">查询</button></form>`;
}

function adminStatus(text) {
  return `<span class="admin-status">${escapeHtml(text || "待处理")}</span>`;
}

function roleOptions(active) {
  return [
    ["member", "普通用户"],
    ["creator", "创作者"],
    ["editor", "编辑"],
    ["senior_editor", "资深编辑"],
    ["admin", "管理员"],
  ].map(([role, label]) => `<option value="${role}" ${role === active ? "selected" : ""}>${label}</option>`).join("");
}

function accountStatusOptions(active) {
  return ["active", "disabled"].map((status) => `<option value="${status}" ${status === active ? "selected" : ""}>${status === "active" ? "正常" : "禁用"}</option>`).join("");
}

function commentStatusOptions(active) {
  return [
    ["published", "显示"],
    ["hidden", "隐藏"],
    ["deleted", "已删除"],
  ].map(([value, label]) => `<option value="${value}" ${value === active ? "selected" : ""}>${label}</option>`).join("");
}

function policyLabel(value) {
  return ({ guest: "访客可用", user: "登录用户", senior_editor: "资深编辑", locked: "锁定" })[value] || value || "默认";
}

function shortText(value, max = 120) {
  const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function adminPager(pagination, callback) {
  const target = document.querySelector(".admin-main");
  if (target) bindPagination(target, callback);
}

function adminUserRow(user) {
  return `
    <tr data-user-id="${user.id}">
      <td><div class="admin-identity-cell">${avatarHtml(user, "small")}<div><strong>${escapeHtml(user.displayName || user.username)}</strong><small>@${escapeHtml(user.username)} · #${user.id}</small></div></div></td>
      <td><input data-field="displayName" value="${escapeHtml(user.displayName || "")}" /></td>
      <td><input data-field="email" type="email" value="${escapeHtml(user.email || "")}" /></td>
      <td><input data-field="avatarUrl" value="${escapeHtml(user.avatarUrl || "")}" placeholder="https://..." /></td>
      <td><select data-field="role">${roleOptions(user.role)}</select><small>${escapeHtml(user.groupLabel || GROUP_LABELS[user.role] || user.role)}</small></td>
      <td><select data-field="status">${accountStatusOptions(user.status)}</select></td>
      <td class="admin-number">${user.stats?.edits || 0}</td>
      <td class="admin-number">${user.stats?.comments || 0}</td>
      <td><button class="mini-button" data-save-user type="button">保存</button><span class="status-line"></span></td>
    </tr>`;
}

function adminPageRow(page) {
  const rating = page.rating || {};
  const ratingText = Number(rating.count || 0) ? `${Number(rating.average || 0).toFixed(1)} 分 / ${rating.count} 评` : "暂无评分";
  return `
    <tr>
      <td><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)}</small></td>
      <td>${escapeHtml((page.categories || []).join("、") || "未分类")}</td>
      <td>${escapeHtml(page.quality || "C")} / ${escapeHtml(page.status || "draft")}<small>评分 ${escapeHtml(ratingText)}</small></td>
      <td>${policyLabel(page.permissions?.editPolicy)} · ${policyLabel(page.permissions?.commentPolicy)} · ${policyLabel(page.permissions?.deletePolicy)}</td>
      <td>${fmtDate(page.updatedAt)}</td>
      <td class="admin-row-actions"><a class="mini-link" href="#/edit/${encodeSlug(page.slug)}">编辑</a><a class="mini-link" href="#/permissions/${encodeSlug(page.slug)}">权限/删除</a><a class="mini-link" href="#/history/${encodeSlug(page.slug)}">记录</a></td>
    </tr>`;
}
async function renderAdminOverview() {
  const overview = await api("/api/admin/overview");
  const stats = overview.stats || {};
  const metric = (label, value, detail, href, icon) => `${href ? `<a class="admin-metric" href="${href}">` : '<article class="admin-metric">'}<span class="admin-metric-icon">${navigationIconSvg(icon)}</span><span class="admin-metric-copy"><small>${escapeHtml(label)}</small><strong>${Number(value || 0)}</strong><em>${escapeHtml(detail)}</em></span>${href ? "</a>" : "</article>"}`;
  const activity = (overview.recentActivity || []).map((item) => `<li class="admin-activity-item"><span class="admin-activity-mark"></span><div><strong>${escapeHtml(item.summary || item.action || "站点操作")}</strong><span>${escapeHtml(item.actorLabel || item.actorName || "系统")} · ${escapeHtml(item.targetLabel || item.targetId || item.targetType || "Wikist")}</span></div><time>${fmtDate(item.createdAt)}</time></li>`).join("") || '<li class="admin-empty-row">暂无站点活动。</li>';
  const recentPages = (overview.recentPages || []).map((page) => `<a class="admin-recent-page" href="#/page/${encodeSlug(page.slug)}"><span><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)} · ${escapeHtml(page.author || "Wikist")}</small></span><span><em>${escapeHtml(page.quality || "C")}</em><time>${fmtDate(page.updatedAt)}</time></span></a>`).join("") || '<p class="admin-empty-row">暂无词条更新。</p>';
  const qualityTotal = Math.max(1, Object.values(overview.quality || {}).reduce((sum, value) => sum + Number(value || 0), 0));
  const qualityRows = [["A", "稳定优质"], ["B", "结构完整"], ["C", "持续完善"], ["draft", "草稿内容"]].map(([key, label]) => { const value = Number(overview.quality?.[key] || 0); return `<div class="admin-quality-row"><div><span>${escapeHtml(label)}</span><strong>${value}</strong></div><div class="admin-quality-track"><i style="--quality-progress:${Math.round(value / qualityTotal * 100)}%"></i></div></div>`; }).join("");
  const activityTrend = recentTrendSeries(overview.recentActivity || [], 10);
  const body = `
    ${adminHeader("后台概览", "查看站点内容、协作活动与运行状态。")}
    <div class="admin-metrics admin-dashboard-metrics">
      ${metric("用户", stats.users, stats.users === null ? "仅管理员可见" : "注册身份", canManageUsers() ? "#/admin/users" : "", "community")}
      ${metric("词条", stats.pages, `${Number(stats.stable || 0)} 个稳定版本`, "#/admin/pages", "workspace")}
      ${metric("协作组织", stats.organizations, `${Number(overview.organizations?.active || 0)} 个活跃`, "#/admin/organizations", "network")}
      ${metric("一级评论", stats.comments, "公开讨论", "#/admin/comments", "pulse")}
    </div>
    <section class="admin-dashboard-grid">
      <article class="admin-dashboard-panel admin-activity-panel"><header><div><span class="system-kicker">Activity Stream</span><h2>站点活动</h2></div><a class="mini-link" href="#/admin/logs">查看全部</a></header><div class="admin-activity-chart"><div><strong>${activityTrend.reduce((sum, value) => sum + value, 0)}</strong><span>近 10 日活动</span></div>${chartSparklineSvg(activityTrend, "后台最近十日站点活动趋势")}</div><ol class="admin-activity-list">${activity}</ol></article>
      <aside class="admin-dashboard-side"><article class="admin-dashboard-panel"><header><div><span class="system-kicker">Quality</span><h2>内容质量分布</h2></div><span class="admin-panel-count">${qualityTotal}</span></header><div class="admin-quality-visual">${qualityDonutHtml(overview.quality || {}, "词条")}</div><div class="admin-quality-list">${qualityRows}</div><footer><span>待审 ${Number(stats.pending || 0)}</span><a href="#/admin/reviews">进入版本审阅</a></footer></article><article class="admin-dashboard-panel"><header><div><span class="system-kicker">Recent Pages</span><h2>最近词条</h2></div></header><div class="admin-recent-pages">${recentPages}</div></article></aside>
    </section>`;
  el.main.innerHTML = adminShell("overview", body);
}

async function renderAdminUsers(page = 1, query = "") {
  const limit = 12;
  const payload = await api(`/api/admin/users?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const rows = items.length ? items.map(adminUserRow).join("") : `<tr><td colspan="9">没有匹配的用户。</td></tr>`;
  const body = `
    ${adminHeader("用户管理", "搜索用户并调整角色、状态与资料。")}
    ${adminSearchForm("adminUserSearch", query, "搜索用户名、显示名或邮箱")}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>用户</th><th data-sort>显示名称</th><th data-sort>邮箱</th><th>头像</th><th data-sort>用户组</th><th data-sort>状态</th><th data-sort>编辑</th><th data-sort>评论</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "用户管理")}`;
  el.main.innerHTML = adminShell("users", body);
  document.querySelector("#adminUserSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderAdminUsers(1, new FormData(event.currentTarget).get("q") || "").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminUsers(nextPage, query).catch(renderError));
  document.querySelectorAll("[data-save-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const status = row.querySelector(".status-line");
      const payload = {};
      row.querySelectorAll("[data-field]").forEach((field) => { payload[field.dataset.field] = field.value; });
      status.textContent = "保存中...";
      try {
        await api(`/api/admin/users/${row.dataset.userId}`, { method: "PUT", body: JSON.stringify(payload) });
        status.textContent = "已保存。";
        await refreshUser();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  });
}

function adminOrganizationRow(organization) {
  const status = organization.status === "disabled" ? "已停用" : "正常";
  const statusControl = canManageUsers()
    ? `<div class="admin-inline-control"><select data-organization-status aria-label="组织状态"><option value="active" ${organization.status === "active" ? "selected" : ""}>正常</option><option value="disabled" ${organization.status === "disabled" ? "selected" : ""}>停用</option></select><button class="mini-button" type="button" data-save-organization>保存</button></div>`
    : `<span class="admin-status">${status}</span>`;
  return `<tr data-organization-slug="${escapeHtml(organization.slug)}"><td><strong>${escapeHtml(organization.name)}</strong><small>${escapeHtml(organization.slug)}</small></td><td>${organization.founderUsername ? `<a class="mini-link" href="#/user/${encodeURIComponent(organization.founderUsername)}">${escapeHtml(organization.founderName || organization.founderUsername)}</a>` : "未记录"}</td><td>${(organization.focus || []).slice(0, 3).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("") || '<span class="muted-line">未设置</span>'}</td><td>${Number(organization.memberCount || 0)} 成员<small>${Number(organization.taskCount || 0)} 任务 · ${Number(organization.discussionCount || 0)} 主题</small></td><td>${statusControl}<span class="status-line"></span></td><td class="admin-row-actions"><a class="mini-link" href="#/organization/${encodeURIComponent(organization.slug)}">进入组织</a><a class="mini-link" href="#/organization/${encodeURIComponent(organization.slug)}?tab=members">成员</a></td></tr>`;
}

async function renderAdminOrganizations(page = 1, query = "", filter = "all") {
  const limit = 12;
  const payload = await api(`/api/admin/organizations?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(filter)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const stats = payload.stats || {};
  const rows = items.length ? items.map(adminOrganizationRow).join("") : '<tr><td colspan="6">没有匹配的协作组织。</td></tr>';
  const body = `${adminHeader("协作社区管理", "搜索组织并管理状态与公开入口。")}<section class="admin-metrics organization-admin-metrics"><div class="admin-metric"><span>全部组织</span><strong>${Number(stats.total || 0)}</strong></div><div class="admin-metric"><span>正常运行</span><strong>${Number(stats.active || 0)}</strong></div><div class="admin-metric"><span>已停用</span><strong>${Number(stats.disabled || 0)}</strong></div></section>${adminSearchForm("adminOrganizationSearch", query, "搜索组织名称、标识、简介或创建者", `<select name="status" aria-label="组织状态"><option value="all" ${filter === "all" ? "selected" : ""}>全部状态</option><option value="active" ${filter === "active" ? "selected" : ""}>正常</option><option value="disabled" ${filter === "disabled" ? "selected" : ""}>已停用</option></select>`)}<div class="admin-table-wrap"><table class="admin-table organization-admin-table"><thead><tr><th>组织</th><th>创建者</th><th>研究方向</th><th>协作规模</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>${paginationHtml(pagination, "协作社区管理")}`;
  el.main.innerHTML = adminShell("organizations", body);
  document.querySelector("#adminOrganizationSearch")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); renderAdminOrganizations(1, data.get("q") || "", data.get("status") || "all").catch(renderError); });
  enhanceTables();
  adminPager(pagination, (next) => renderAdminOrganizations(next, query, filter).catch(renderError));
  document.querySelectorAll("[data-save-organization]").forEach((button) => button.addEventListener("click", async () => {
    const row = button.closest("tr");
    const statusLine = row.querySelector(".status-line");
    button.disabled = true;
    statusLine.textContent = "保存中...";
    try {
      await api(`/api/admin/organizations/${encodeURIComponent(row.dataset.organizationSlug)}`, { method: "PUT", body: JSON.stringify({ status: row.querySelector("[data-organization-status]").value }) });
      statusLine.textContent = "已保存。";
    } catch (error) {
      statusLine.textContent = error.message;
      button.disabled = false;
    }
  }));
}

function adminCommunityTabs(active) {
  const items = [["overview", "数据概览"], ["reports", "举报队列"], ["reviews", "修订审核"]];
  return `<nav class="admin-community-tabs" aria-label="社区治理分区">${items.map(([id, label]) => `<button class="${active === id ? "active" : ""}" type="button" data-admin-community-tab="${id}" aria-current="${active === id ? "page" : "false"}">${label}</button>`).join("")}</nav>`;
}

function bindAdminCommunityTabs() {
  document.querySelectorAll("[data-admin-community-tab]").forEach((button) => button.addEventListener("click", () => {
    renderAdminCommunity(button.dataset.adminCommunityTab).catch(renderError);
  }));
}

async function renderAdminCommunity(tab = "overview", page = 1, statusFilter = "pending") {
  const active = ["overview", "reports", "reviews"].includes(tab) ? tab : "overview";
  const heading = `${adminHeader("社区治理", "管理问答内容、举报与修订审核。")}${adminCommunityTabs(active)}`;

  if (active === "overview") {
    const overview = await api("/api/community/qa/moderation/overview");
    const content = overview.content || {};
    const queues = overview.queues || {};
    const engagement = overview.engagement || {};
    const spaces = overview.spaces || {};
    const body = `${heading}
      <section class="admin-metrics community-admin-metrics"><div class="admin-metric"><span>问题</span><strong>${Number(content.questions || 0)}</strong></div><div class="admin-metric"><span>回答</span><strong>${Number(content.answers || 0)}</strong></div><div class="admin-metric"><span>评论</span><strong>${Number(content.comments || 0)}</strong></div><div class="admin-metric"><span>标签</span><strong>${Number(content.tags || 0)}</strong></div></section>
      <section class="admin-community-grid"><article class="admin-settings-panel"><div class="panel-heading-row"><div><span class="system-kicker">Native Source</span><h2>Wikist 原生数据</h2></div><span class="search-index-state ready">主数据源</span></div><dl class="admin-community-facts"><div><dt>公共空间</dt><dd>${Number(spaces.public || 0)}</dd></div><div><dt>组织空间</dt><dd>${Number(spaces.organization || 0)}</dd></div><div><dt>待处理举报</dt><dd>${Number(queues.reports || 0)}</dd></div><div><dt>待审修订</dt><dd>${Number(queues.reviews || 0)}</dd></div></dl><div class="editor-actions"><a class="command-button" href="#/questions">打开问答社区</a><button class="command-button secondary" type="button" data-admin-community-tab="reports">处理举报</button></div></article><article class="admin-settings-panel"><div class="panel-heading-row"><div><span class="system-kicker">Engagement</span><h2>社区互动</h2></div></div><dl class="admin-community-facts"><div><dt>质量投票</dt><dd>${Number(engagement.votes || 0)}</dd></div><div><dt>Reaction</dt><dd>${Number(engagement.reactions || 0)}</dd></div><div><dt>收藏</dt><dd>${Number(engagement.collections || 0)}</dd></div><div><dt>关注</dt><dd>${Number(engagement.follows || 0)}</dd></div></dl></article></section>`;
    el.main.innerHTML = adminShell("community", body);
    bindAdminCommunityTabs();
    return;
  }

  if (active === "reports" || active === "reviews") {
    const limit = 16;
    const endpoint = active === "reports" ? "reports" : "reviews";
    const payload = await api(`/api/community/qa/moderation/${endpoint}?page=${page}&limit=${limit}&status=${encodeURIComponent(statusFilter)}`);
    const { items, pagination } = normalizedPaged(payload, page, limit);
    const reports = active === "reports";
    const rows = items.length ? items.map((item) => reports
      ? `<tr data-community-report-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(({ spam: "垃圾信息", abuse: "不当内容", duplicate: "重复内容", incorrect: "事实错误", copyright: "版权问题", privacy: "隐私问题", other: "其他" })[item.reason] || item.reason)}</strong><small>${escapeHtml(item.details || "未补充说明")}</small></td><td>${communityModerationObjectHtml(item)}</td><td>${escapeHtml(item.reporter?.displayName || item.reporter?.username || "用户")}<small>${fmtDate(item.createdAt)}</small></td><td>${adminStatus(item.status)}</td><td class="admin-row-actions">${item.status === "pending" ? '<button class="mini-button" type="button" data-community-report-decision="resolved">确认处理</button><button class="mini-button danger" type="button" data-community-report-decision="dismissed">驳回</button>' : escapeHtml(item.resolution || "已处理")}</td></tr>`
      : `<tr data-community-review-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(item.queueType || "内容审核")}</strong><small>${escapeHtml(item.reason || "待社区审阅")}</small></td><td>${communityModerationObjectHtml(item)}</td><td><strong>${escapeHtml(item.requester?.displayName || item.requester?.username || "社区成员")}</strong>${adminStatus(item.status)}<small>${fmtDate(item.createdAt)}</small></td><td class="admin-row-actions">${item.status === "pending" ? '<button class="mini-button" type="button" data-community-review-decision="approved">通过</button><button class="mini-button danger" type="button" data-community-review-decision="rejected">拒绝</button>' : "已完成"}</td></tr>`).join("") : `<tr><td colspan="${reports ? 5 : 4}">${reports ? "没有符合条件的举报。" : "没有符合条件的修订。"}</td></tr>`;
    const options = [["pending", "待处理"], [reports ? "resolved" : "approved", reports ? "已处理" : "已通过"], [reports ? "dismissed" : "rejected", reports ? "已驳回" : "已拒绝"]];
    const filter = `<form class="admin-toolbar" id="adminCommunityQueueFilter"><select name="status" aria-label="队列状态">${options.map(([value, label]) => `<option value="${value}" ${statusFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select><button class="command-button" type="submit">筛选</button></form>`;
    const body = `${heading}${filter}<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${reports ? "<th>举报原因</th><th>对象</th><th>提交者</th><th>状态</th><th>处理</th>" : "<th>审核任务</th><th>对象</th><th>状态</th><th>决定</th>"}</tr></thead><tbody>${rows}</tbody></table></div>${paginationHtml(pagination, reports ? "社区举报" : "社区修订审核")}`;
    el.main.innerHTML = adminShell("community", body);
    bindAdminCommunityTabs();
    document.querySelector("#adminCommunityQueueFilter")?.addEventListener("submit", (event) => { event.preventDefault(); renderAdminCommunity(active, 1, new FormData(event.currentTarget).get("status") || "pending").catch(renderError); });
    adminPager(pagination, (next) => renderAdminCommunity(active, next, statusFilter).catch(renderError));
    document.querySelectorAll("[data-community-report-decision]").forEach((button) => button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const resolution = await uiPrompt({ title: button.dataset.communityReportDecision === "resolved" ? "确认处理举报" : "驳回举报", text: "填写审核结论，结果将留在治理记录中。", placeholder: "审核结论", confirmText: "提交决定" });
      if (resolution === null) return;
      try { await api(`/api/community/qa/moderation/reports/${encodeURIComponent(row.dataset.communityReportId)}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.communityReportDecision, resolution }) }); await uiToast("举报已处理"); await renderAdminCommunity(active, page, statusFilter); } catch (error) { await uiAlert("处理失败", error.message, "error"); }
    }));
    document.querySelectorAll("[data-community-review-decision]").forEach((button) => button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const opinion = await uiPrompt({ title: button.dataset.communityReviewDecision === "approved" ? "通过修订" : "拒绝修订", text: "审核意见会随修订记录保存。", placeholder: "审核意见", confirmText: "提交决定" });
      if (opinion === null) return;
      try { await api(`/api/community/qa/moderation/reviews/${encodeURIComponent(row.dataset.communityReviewId)}`, { method: "PUT", body: JSON.stringify({ status: button.dataset.communityReviewDecision, opinion }) }); await uiToast("审核决定已保存"); await renderAdminCommunity(active, page, statusFilter); } catch (error) { await uiAlert("审核失败", error.message, "error"); }
    }));
    return;
  }

}

async function renderAdminPages(page = 1, query = "") {
  const limit = 12;
  const payload = await api(`/api/admin/pages?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const rows = items.length ? items.map(adminPageRow).join("") : `<tr><td colspan="6">没有匹配的词条。</td></tr>`;
  const body = `
    ${adminHeader("词条管理", "搜索词条并管理质量、评分、权限与内容。")}
    ${adminSearchForm("adminPageSearch", query, "搜索标题、slug、分类或作者")}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>词条</th><th data-sort>分类</th><th data-sort>质量/状态</th><th data-sort>权限</th><th data-sort>更新</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "词条管理")}`;
  el.main.innerHTML = adminShell("pages", body);
  document.querySelector("#adminPageSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderAdminPages(1, new FormData(event.currentTarget).get("q") || "").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminPages(nextPage, query).catch(renderError));
}

function citationAdminRowLegacy(page) {
  const stats = page.citationStats || {};
  const unresolved = stats.unresolved || [];
  const issueCount = (stats.issues || []).length;
  const state = !Number(stats.total || 0)
    ? '<span class="citation-state missing">缺少来源</span>'
    : unresolved.length || Number(stats.citationNeeded || 0) || Number(stats.uncited || 0) || issueCount
      ? '<span class="citation-state warning">待补充</span>'
      : '<span class="citation-state ready">记录完整</span>';
  const problems = [
    unresolved.length ? `未解析 ${unresolved.length}` : "",
    Number(stats.citationNeeded || 0) ? `待来源 ${stats.citationNeeded}` : "",
    Number(stats.uncited || 0) ? `未引用 ${stats.uncited}` : "",
    issueCount ? `字段不全 ${issueCount}` : "",
  ].filter(Boolean).join(" · ") || "—";
  return `<tr><td><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)}</small></td><td>${state}<small>${escapeHtml(problems)}</small></td><td>${Number(stats.total || 0)} / ${Number(stats.cited || 0)}</td><td>${Number(stats.verifiable || 0)}</td><td>${Number(stats.completeness || 0)}% / ${Number(stats.qualityScore || 0)}</td><td>${fmtDate(page.updatedAt)}</td><td class="admin-row-actions"><a class="mini-link" href="#/page/${encodeSlug(page.slug)}">查看</a><a class="mini-link" href="#/edit/${encodeSlug(page.slug)}">编辑引用</a></td></tr>`;
}

async function renderAdminCitationsLegacy(page = 1, query = "", mode = "needs-review") {
  const limit = 15;
  const payload = await api(`/api/admin/citations?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const stats = payload.stats || {};
  const rows = items.length ? items.map(citationAdminRow).join("") : '<tr><td colspan="7">没有符合条件的词条。</td></tr>';
  const body = `
    ${adminHeader("来源审阅", "检查来源、正文引用与缺失项。")}
    <section class="admin-metrics citation-admin-metrics"><div class="admin-metric"><span>词条</span><strong>${Number(stats.pages || 0)}</strong></div><div class="admin-metric"><span>来源记录</span><strong>${Number(stats.references || 0)}</strong></div><div class="admin-metric"><span>可核验</span><strong>${Number(stats.verifiable || 0)}</strong></div><div class="admin-metric"><span>待审阅</span><strong>${Number(stats.needsReview || 0)}</strong></div><div class="admin-metric"><span>无来源</span><strong>${Number(stats.withoutSources || 0)}</strong></div></section>
    <form class="admin-search-form citation-admin-controls" id="citationAdminSearch"><input name="q" value="${escapeHtml(query)}" placeholder="搜索词条、作者、题名、DOI 或 arXiv" /><select name="mode"><option value="needs-review" ${mode === "needs-review" ? "selected" : ""}>待审阅</option><option value="all" ${mode === "all" ? "selected" : ""}>全部词条</option><option value="missing" ${mode === "missing" ? "selected" : ""}>缺少来源</option><option value="unresolved" ${mode === "unresolved" ? "selected" : ""}>未解析引用</option></select><button class="command-button" type="submit">筛选</button></form>
    <div class="admin-table-wrap"><table class="admin-table citation-admin-table"><thead><tr><th>词条</th><th>状态</th><th>来源 / 已引用</th><th>可核验</th><th>完整度 / 质量</th><th>更新</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "来源审阅")}`;
  el.main.innerHTML = adminShell("citations", body);
  document.querySelector("#citationAdminSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminCitations(1, data.get("q") || "", data.get("mode") || "needs-review").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminCitations(nextPage, query, mode).catch(renderError));
}
function citationReviewMeta(page) {
  const stats = page.citationStats || {};
  const unresolved = stats.unresolved || [];
  const issueCount = (stats.issues || []).length;
  const missing = !Number(stats.total || 0);
  const needsWork = missing || unresolved.length || Number(stats.citationNeeded || 0) || Number(stats.uncited || 0) || issueCount || Number(stats.completeness || 0) < 100;
  const label = missing ? "缺少来源" : needsWork ? "待补来源" : "来源完整";
  const tone = missing ? "missing" : needsWork ? "warning" : "ready";
  const problems = [
    unresolved.length ? `未解析 ${unresolved.length}` : "",
    Number(stats.citationNeeded || 0) ? `待补 ${stats.citationNeeded}` : "",
    Number(stats.uncited || 0) ? `未引用 ${stats.uncited}` : "",
    issueCount ? `字段 ${issueCount}` : "",
  ].filter(Boolean);
  return { label, tone, problems, stats };
}

function citationAdminRow(page) {
  const meta = citationReviewMeta(page);
  const stats = meta.stats;
  return `<article class="citation-review-item">
    <div class="citation-review-title"><a href="#/page/${encodeSlug(page.slug)}"><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)}</small></a><span class="citation-state ${meta.tone}">${meta.label}</span></div>
    <div class="citation-review-facts"><span><strong>${Number(stats.total || 0)}</strong><small>来源</small></span><span><strong>${Number(stats.cited || 0)}</strong><small>已引用</small></span><span><strong>${Number(stats.verifiable || 0)}</strong><small>可核验</small></span><span><strong>${Number(stats.qualityScore || 0)}</strong><small>质量分</small></span></div>
    <div class="citation-review-problems">${meta.problems.length ? meta.problems.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : '<span>字段、解析与正文调用均已通过检查</span>'}</div>
    <div class="citation-review-actions"><a class="mini-link" href="#/page/${encodeSlug(page.slug)}">查看</a><a class="mini-link" href="#/edit/${encodeSlug(page.slug)}">编辑来源</a></div>
  </article>`;
}

async function renderAdminCitations(page = 1, query = "", mode = "needs-review") {
  const limit = 10;
  const payload = await api(`/api/admin/citations?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const stats = payload.stats || {};
  const cards = items.length ? items.map(citationAdminRow).join("") : '<div class="citation-review-empty"><strong>没有符合条件的词条</strong><span>可以切换筛选范围，或使用标题、作者、DOI 与 arXiv 搜索。</span></div>';
  const body = `
    ${adminHeader("来源审阅", "按问题优先级检查并补充来源。")}
    <section class="citation-review-workbench">
      <div class="citation-review-metrics"><span><small>词条</small><strong>${Number(stats.pages || 0)}</strong></span><span><small>来源记录</small><strong>${Number(stats.references || 0)}</strong></span><span><small>可核验</small><strong>${Number(stats.verifiable || 0)}</strong></span><span><small>待处理</small><strong>${Number(stats.needsReview || 0)}</strong></span><span><small>无来源</small><strong>${Number(stats.withoutSources || 0)}</strong></span></div>
      <form class="citation-review-filters" id="citationAdminSearch"><input name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索词条、作者、题名、DOI 或 arXiv" /><select name="mode" aria-label="来源审阅范围"><option value="needs-review" ${mode === "needs-review" ? "selected" : ""}>待处理</option><option value="all" ${mode === "all" ? "selected" : ""}>全部词条</option><option value="missing" ${mode === "missing" ? "selected" : ""}>缺少来源</option><option value="unresolved" ${mode === "unresolved" ? "selected" : ""}>未解析引用</option></select><button class="command-button" type="submit">筛选</button></form>
      <div class="citation-review-list">${cards}</div>
    </section>
    ${paginationHtml(pagination, "来源审阅")}`;
  el.main.innerHTML = adminShell("citations", body);
  document.querySelector("#citationAdminSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminCitations(1, data.get("q") || "", data.get("mode") || "needs-review").catch(renderError);
  });
  adminPager(pagination, (nextPage) => renderAdminCitations(nextPage, query, mode).catch(renderError));
}

function reviewQueueItem(page) {
  const review = page.review || {};
  const status = review.isCurrentStable ? "当前即稳定" : review.hasStable ? "有待审改动" : "尚未审阅";
  const tone = review.isCurrentStable ? "stable" : "pending";
  const detail = review.hasStable ? `${review.reviewerName || "审核者"} · ${fmtDate(review.reviewedAt)}` : "尚未创建稳定快照";
  return `<article class="review-queue-item"><div class="review-queue-title"><a href="#/review/${encodeSlug(page.slug)}"><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.slug)}</small></a><span class="review-version-chip ${tone}">${status}</span></div><div class="review-queue-meta"><span>当前：${fmtDate(page.updatedAt)}</span><span>稳定：${escapeHtml(detail)}</span></div><div class="review-queue-actions"><a class="mini-link" href="#/review/${encodeSlug(page.slug)}">审阅差异</a><a class="mini-link" href="#/page/${encodeSlug(page.slug)}">打开词条</a></div></article>`;
}

async function renderAdminReviews(page = 1, query = "", mode = "pending") {
  const limit = 10;
  const payload = await api(`/api/admin/reviews?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const stats = payload.stats || {};
  const queue = items.length ? items.map(reviewQueueItem).join("") : '<div class="review-queue-empty"><strong>当前筛选下没有词条</strong><span>新建或编辑词条后，可在待审队列中查看。</span></div>';
  const body = `
    ${adminHeader("版本审阅", "比较版本、填写意见并发布稳定版本。")}
    <section class="review-queue-workbench">
      <div class="review-queue-metrics"><span><small>全部词条</small><strong>${Number(stats.pages || 0)}</strong></span><span><small>待审</small><strong>${Number(stats.pending || 0)}</strong></span><span><small>当前稳定</small><strong>${Number(stats.stable || 0)}</strong></span><span><small>从未审阅</small><strong>${Number(stats.unreviewed || 0)}</strong></span></div>
      <form class="review-queue-filters" id="reviewQueueSearch"><input name="q" type="search" value="${escapeHtml(query)}" placeholder="搜索词条、审核者或审核意见" /><select name="mode" aria-label="版本审阅范围"><option value="pending" ${mode === "pending" ? "selected" : ""}>待审队列</option><option value="stable" ${mode === "stable" ? "selected" : ""}>当前稳定</option><option value="unreviewed" ${mode === "unreviewed" ? "selected" : ""}>从未审阅</option><option value="all" ${mode === "all" ? "selected" : ""}>全部词条</option></select><button class="command-button" type="submit">筛选</button></form>
      <div class="review-queue-list">${queue}</div>
    </section>
    ${paginationHtml(pagination, "版本审阅")}`;
  el.main.innerHTML = adminShell("reviews", body);
  document.querySelector("#reviewQueueSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminReviews(1, data.get("q") || "", data.get("mode") || "pending").catch(renderError);
  });
  adminPager(pagination, (nextPage) => renderAdminReviews(nextPage, query, mode).catch(renderError));
}

function adminCommentRow(comment, options = {}) {
  const showReplies = options.showReplies !== false;
  const authorUser = { displayName: comment.authorName || "访客", username: comment.authorUsername || "guest", avatarUrl: comment.authorAvatarUrl || "" };
  const authorMain = comment.authorType === "user" && comment.authorUsername
    ? `<a class="mini-link" href="#/user/${encodeURIComponent(comment.authorUsername)}">${escapeHtml(comment.authorName || comment.authorUsername)}</a>`
    : `<strong>${escapeHtml(comment.authorName || "访客")}</strong>`;
  const authorMeta = comment.authorType === "guest" ? (comment.authorEmail || "访客") : `@${comment.authorUsername || "user"}`;
  const repliesCell = showReplies
    ? `<a class="mini-link" href="#/admin/comment-replies/${comment.id}">查看二级评论（${Number(comment.replyCount || 0)}）</a>`
    : `<span class="muted-line">二级评论</span>`;
  return `
    <tr data-comment-id="${comment.id}">
      <td><a class="mini-link" href="#/comments/${encodeSlug(comment.pageSlug)}">${escapeHtml(comment.pageSlug)}</a><small>#${comment.id}${comment.parentId ? ` · 回复 #${comment.parentId}` : ""}</small></td>
      <td><div class="admin-identity-cell">${avatarHtml(authorUser, "small")}<div>${authorMain}<small>${escapeHtml(authorMeta)}</small></div></div></td>
      <td class="admin-comment-cell">${escapeHtml(shortText(comment.contentMd || comment.contentHtml || "", 160))}</td>
      <td>${repliesCell}</td>
      <td><select data-field="status">${commentStatusOptions(comment.status)}</select></td>
      <td>${fmtDate(comment.createdAt)}</td>
      <td class="admin-comment-actions"><div class="admin-row-action-strip"><button class="mini-button" data-save-comment type="button">保存</button><button class="mini-button danger" data-delete-admin-comment type="button">删除</button></div><span class="status-line"></span></td>
    </tr>`;
}

function bindAdminCommentSaves(refresh) {
  document.querySelectorAll("[data-save-comment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const status = row.querySelector(".status-line");
      const value = row.querySelector("[data-field='status']").value;
      status.textContent = "保存中...";
      try {
        await api(`/api/admin/comments/${row.dataset.commentId}`, { method: "PUT", body: JSON.stringify({ status: value }) });
        status.textContent = "已保存。";
        if (typeof refresh === "function") await refresh();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  });
  document.querySelectorAll("[data-delete-admin-comment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const status = row.querySelector(".status-line");
      button.disabled = true;
      status.textContent = "删除中...";
      try {
        await api(`/api/admin/comments/${row.dataset.commentId}`, { method: "DELETE", body: "{}" });
        status.textContent = "已删除。";
        if (typeof refresh === "function") await refresh();
        else row.querySelector("[data-field='status']").value = "deleted";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });
}

function adminMessageRow(message) {
  const recalled = message.broadcastStatus === "recalled" || message.status === "recalled";
  const sender = message.senderUsername ? `@${message.senderUsername}` : (message.senderName || "Wikist");
  const priority = messagePriorityMeta(message.priority);
  const delivery = Number(message.deliveryCount || 0);
  const read = Number(message.readCount || 0);
  const deleted = Number(message.deletedCount || 0);
  return `
    <tr data-admin-message-id="${escapeHtml(message.rawId || message.id)}">
      <td><strong>${escapeHtml(message.title)}</strong><small>${escapeHtml(message.kind || "broadcast")} &middot; #${escapeHtml(message.rawId || message.id)}</small></td>
      <td><span class="message-priority ${priority.tone}">${priority.label}</span></td>
      <td><strong>\u5168\u7ad9\u7528\u6237</strong><small>\u8986\u76d6 ${delivery} \u4eba &middot; \u5df2\u8bfb ${read} \u00b7 \u81ea\u884c\u5220\u9664 ${deleted}</small></td>
      <td>${escapeHtml(sender)}</td>
      <td class="admin-comment-cell">${escapeHtml(shortText(message.body || "", 150))}</td>
      <td><span class="admin-status ${recalled ? "" : "hot"}">${recalled ? "\u5df2\u64a4\u56de" : "\u53d1\u9001\u4e2d"}</span></td>
      <td>${fmtDate(message.createdAt)}${message.recalledAt ? `<small>\u64a4\u56de ${fmtDate(message.recalledAt)}</small>` : ""}</td>
      <td>${recalled ? '<span class="muted-line">\u4e0d\u53ef\u91cd\u590d\u64a4\u56de</span>' : `<button class="mini-button danger" type="button" data-admin-message-revoke="${escapeHtml(message.rawId || message.id)}">\u5168\u5458\u64a4\u56de</button>`}</td>
    </tr>`;
}

function adminLogRow(log) {
  return `
    <tr>
      <td><strong>${escapeHtml(log.action || "")}</strong><small>#${log.id} · ${fmtDate(log.createdAt)}</small></td>
      <td><strong>${escapeHtml(log.actorName || "系统")}</strong><small>${escapeHtml(log.actorLabel || log.actorType || "")}</small></td>
      <td><span class="admin-status">${escapeHtml(log.targetType || "site")}</span><small>${escapeHtml(log.targetId || "")}</small></td>
      <td><strong>${escapeHtml(log.targetLabel || "")}</strong><small>${escapeHtml(log.summary || "")}</small></td>
      <td class="admin-comment-cell"><code>${escapeHtml(JSON.stringify(log.metadata || {}))}</code></td>
    </tr>`;
}

async function renderAdminSearchIndex() {
  const payload = await api("/api/admin/search-index");
  const index = payload.index || {};
  const state = index.ready ? "已就绪" : index.coverage === "disabled" ? "已停用" : index.coverage === "unavailable" ? "不可用" : "待建立";
  const tone = index.ready ? "ready" : index.coverage === "disabled" || index.coverage === "unavailable" ? "muted" : "pending";
  el.main.innerHTML = adminShell("search-index", `
    ${adminHeader("搜索索引", "查看索引状态，并执行修复或重建。")}
    <section class="search-index-metrics">
      <article><small>引擎</small><strong>${escapeHtml(index.engine || "sqlite-fts5")}</strong></article>
      <article><small>索引词条</small><strong>${Number(index.documents || 0)}</strong></article>
      <article><small>覆盖状态</small><strong class="${tone}">${escapeHtml(state)}</strong></article>
      <article><small>最近同步</small><strong>${index.updatedAt ? escapeHtml(fmtDate(index.updatedAt)) : "尚未同步"}</strong></article>
    </section>
    <section class="admin-settings-panel search-index-panel">
      <div class="panel-heading-row"><div><h2>持久全文索引</h2><p class="muted-line">检查覆盖状态；需要时重建历史词条索引。</p></div><span class="search-index-state ${tone}">${escapeHtml(state)}</span></div>
      <div class="search-index-details">
        <span><small>配置</small><strong>${index.enabled ? "advancedSearch.fts5 已启用" : "advancedSearch.fts5 已停用"}</strong></span>
        <span><small>兼容性</small><strong>${index.available ? "当前 SQLite 支持 FTS5" : escapeHtml(index.error || "当前运行时不支持 FTS5")}</strong></span>
      </div>
      <div class="editor-actions">
        <button class="command-button" id="rebuildSearchIndex" type="button" ${index.enabled && index.available ? "" : "disabled"}>建立 / 重建索引</button>
        <a class="command-button secondary" href="#/admin/plugins">调整高级搜索配置</a>
      </div>
      <p class="status-line" id="searchIndexStatus"></p>
    </section>
  `);
  document.querySelector("#rebuildSearchIndex")?.addEventListener("click", async (event) => {
    const accepted = await uiConfirm({
      title: "建立 SQLite FTS5 索引",
      text: "重建现有词条索引；完成前请勿关闭页面。",
      confirmText: "开始建立",
    });
    if (!accepted) return;
    const button = event.currentTarget;
    const status = document.querySelector("#searchIndexStatus");
    button.disabled = true;
    status.textContent = "正在建立持久搜索索引...";
    try {
      const result = await api("/api/admin/search-index/rebuild", { method: "POST", body: JSON.stringify({}) });
      status.textContent = `索引已建立：${Number(result.index?.documents || 0)} 个词条。`;
      await renderAdminSearchIndex();
    } catch (error) {
      button.disabled = false;
      status.textContent = error.message;
    }
  });
}

function runtimeBucketFields(firewall = {}) {
  const labels = { general: "站点访问", health: "健康检查", api: "读取 API", write: "写入请求", auth: "通行证", install: "安装器" };
  return Object.entries(labels).map(([key, label]) => {
    const bucket = firewall.policies?.[key] || {};
    return `<fieldset class="runtime-firewall-bucket"><legend>${label}</legend><label>次数<input name="${key}.points" type="number" min="4" max="20000" value="${Number(bucket.points || 0)}" /></label><label>窗口（秒）<input name="${key}.windowSeconds" type="number" min="1" max="86400" value="${Number(bucket.windowSeconds || 0)}" /></label><label>封禁（秒）<input name="${key}.blockSeconds" type="number" min="1" max="86400" value="${Number(bucket.blockSeconds || 0)}" /></label></fieldset>`;
  }).join("");
}

async function renderAdminRuntime() {
  const payload = await api("/api/admin/health");
  const health = payload.health || {};
  const metrics = health.metrics || {};
  const database = health.database || {};
  const index = health.searchIndex || {};
  const firewall = health.firewall || {};
  const requests = metrics.requests || {};
  const searchMetrics = metrics.search || {};
  const pluginFailures = metrics.pluginFailures || [];
  const routes = requests.routes || [];
  const runtimeMetric = (label, value, detail, icon, danger = false) => `<article class="admin-metric runtime-metric ${danger ? "is-danger" : ""}"><span class="admin-metric-icon">${navigationIconSvg(icon)}</span><span class="runtime-metric-copy"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong><em>${escapeHtml(String(detail || ""))}</em></span></article>`;
  const body = `
    ${adminHeader("运行健康", "检查数据库、搜索、备份与请求防护状态。")}
    <section class="admin-metrics runtime-health-metrics">
      ${runtimeMetric("数据库", database.integrityOk === false ? "异常" : "正常", database.journalMode || "SQLite", "workspace", database.integrityOk === false)}
      ${runtimeMetric("FTS5 索引", index.ready ? "就绪" : index.recoveryNeeded ? "待修复" : "回退", `${Number(index.documents || 0)} 词条`, "category", Boolean(index.recoveryNeeded))}
      ${runtimeMetric("请求", Number(requests.total || 0), "本进程启动后", "pulse")}
      ${runtimeMetric("搜索平均耗时", `${Number(searchMetrics.avgMs || 0)} ms`, `缓存命中 ${Number(metrics.cache?.hitRate || 0)}%`, "network")}
      ${runtimeMetric("防护拦截", Number(metrics.firewall?.blocked || 0), "限流 / 安装防护", "community")}
    </section>
    <section class="admin-settings-panel runtime-panel">
      <div class="panel-heading-row"><div><h2>健康检查与恢复</h2><p class="muted-line">运行检查，并在索引异常时执行修复。</p></div><span class="search-index-state ${health.ok ? "ready" : "pending"}">${health.ok ? "运行正常" : "需要处理"}</span></div>
      <div class="runtime-health-facts"><span><small>WAL</small><strong>${escapeHtml(database.journalMode || "未知")}</strong></span><span><small>busy timeout</small><strong>${Number(database.busyTimeoutMs || 0)} ms</strong></span><span><small>完整性</small><strong>${database.integrityChecked ? (database.integrityOk ? "通过" : "失败") : "未深检"}</strong></span><span><small>索引失败</small><strong>${Number(index.failureCount || 0)} 次</strong></span></div>
      <div class="editor-actions"><button class="command-button" id="runHealthCheck" type="button">执行健康检查</button><button class="command-button secondary" id="recoverSearchIndex" type="button" ${index.enabled && index.available !== false ? "" : "disabled"}>修复搜索索引</button><button class="command-button secondary" id="runBackupDrill" type="button">执行还原演练</button></div>
      <label class="setting-toggle runtime-drill-toggle"><input id="backupDrillUserData" type="checkbox" /><span><strong>演练包含用户数据</strong><small>同时验证用户与互动数据能否恢复。</small></span></label>
      <p class="status-line" id="runtimeStatus"></p>
    </section>
    <section class="admin-settings-panel runtime-panel">
      <div class="panel-heading-row"><div><h2>请求防护</h2><p class="muted-line">调整访问频率、请求大小与可信代理设置。</p></div><span class="search-index-state ${firewall.enabled ? "ready" : "pending"}">${firewall.enabled ? "已启用" : "已停用"}</span></div>
      <form id="runtimeFirewallForm" class="runtime-firewall-form">
        <div class="settings-toggle-row"><label class="setting-toggle"><input name="enabled" type="checkbox" ${firewall.enabled ? "checked" : ""} /><span><strong>启用请求防护</strong><small>对高频访问返回 429 与 Retry-After。</small></span></label><label class="setting-toggle"><input name="trustedProxy" type="checkbox" ${firewall.trustedProxy ? "checked" : ""} /><span><strong>信任反向代理</strong><small>仅在 Nginx 等可信代理已正确覆写 X-Forwarded-For 时启用。</small></span></label><label>最大请求体（字节）<input name="maxBodyBytes" type="number" min="16384" max="33554432" value="${Number(firewall.maxBodyBytes || 0)}" /></label></div>
        <div class="runtime-firewall-grid">${runtimeBucketFields(firewall)}</div>
        <div class="editor-actions"><button class="command-button" type="submit">保存防护策略</button></div><p class="status-line" id="runtimeFirewallStatus"></p>
      </form>
    </section>
    <section class="admin-settings-panel runtime-panel"><h2>脱敏指标</h2><div class="runtime-observability-grid"><div><h3>高频路由</h3><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>路由</th><th>请求</th><th>平均耗时</th><th>5xx</th></tr></thead><tbody>${routes.length ? routes.map((item) => `<tr><td>${escapeHtml(item.route)}</td><td>${Number(item.count || 0)}</td><td>${Number(item.avgMs || 0)} ms</td><td>${Number(item.errors || 0)}</td></tr>`).join("") : "<tr><td colspan=\"4\">尚无请求样本。</td></tr>"}</tbody></table></div></div><div><h3>插件失败</h3>${pluginFailures.length ? `<ul class="runtime-plugin-failures">${pluginFailures.map((item) => `<li><strong>${escapeHtml(item.pluginId)}</strong><span>${escapeHtml(item.hook)}</span><small>${Number(item.failures || 0)} 次 · ${item.lastAt ? fmtDate(item.lastAt) : ""}</small></li>`).join("")}</ul>` : "<p class=\"muted-line\">未记录插件失败。</p>"}</div></div></section>`;
  el.main.innerHTML = adminShell("runtime", body);
  const status = document.querySelector("#runtimeStatus");
  document.querySelector("#runHealthCheck")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true; status.textContent = "检查中...";
    try { const result = await api("/api/admin/health/check", { method: "POST", body: "{}" }); status.textContent = result.health?.ok ? "健康检查通过。" : "检查发现需处理项。"; await renderAdminRuntime(); } catch (error) { status.textContent = error.message; } finally { event.currentTarget.disabled = false; }
  });
  document.querySelector("#recoverSearchIndex")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true; status.textContent = "正在重建 SQLite FTS5...";
    try { const result = await api("/api/admin/search-index/recover", { method: "POST", body: "{}" }); status.textContent = `索引已修复：${Number(result.index?.documents || 0)} 个词条。`; await renderAdminRuntime(); } catch (error) { status.textContent = error.message; } finally { event.currentTarget.disabled = false; }
  });
  document.querySelector("#runBackupDrill")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true; status.textContent = "正在创建隔离快照并演练还原...";
    try { const result = await api("/api/admin/health/backup-drill", { method: "POST", body: JSON.stringify({ includeUserData: document.querySelector("#backupDrillUserData")?.checked === true }) }); status.textContent = `演练通过：恢复 ${Number(result.drill?.restored || 0)} 个文件。`; } catch (error) { status.textContent = error.message; } finally { event.currentTarget.disabled = false; }
  });
  document.querySelector("#runtimeFirewallForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const formData = new FormData(form); const firewallInput = { enabled: form.elements.enabled.checked, trustedProxy: form.elements.trustedProxy.checked, maxBodyBytes: Number(formData.get("maxBodyBytes")) };
    ["general", "health", "api", "write", "auth", "install"].forEach((key) => { firewallInput[key] = { points: Number(formData.get(`${key}.points`)), windowSeconds: Number(formData.get(`${key}.windowSeconds`)), blockSeconds: Number(formData.get(`${key}.blockSeconds`)) }; });
    const firewallStatus = document.querySelector("#runtimeFirewallStatus"); firewallStatus.textContent = "保存中...";
    try { await api("/api/admin/runtime/firewall", { method: "PUT", body: JSON.stringify({ firewall: firewallInput }) }); firewallStatus.textContent = "请求防护策略已保存。"; } catch (error) { firewallStatus.textContent = error.message; }
  });
}

async function renderAdminLogs(page = 1, query = "", action = "all", targetType = "all") {
  const limit = 18;
  const payload = await api(`/api/admin/logs?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&action=${encodeURIComponent(action)}&targetType=${encodeURIComponent(targetType)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const rows = items.length ? items.map(adminLogRow).join("") : `<tr><td colspan="5">暂无匹配日志。</td></tr>`;
  const extra = `<select name="action"><option value="all" ${action === "all" ? "selected" : ""}>全部动作</option><option value="page.update" ${action === "page.update" ? "selected" : ""}>词条编辑</option><option value="comment.delete" ${action === "comment.delete" ? "selected" : ""}>评论删除</option><option value="settings.update" ${action === "settings.update" ? "selected" : ""}>站点设置</option><option value="translation.save" ${action === "translation.save" ? "selected" : ""}>翻译保存</option></select><select name="targetType"><option value="all" ${targetType === "all" ? "selected" : ""}>全部对象</option><option value="page" ${targetType === "page" ? "selected" : ""}>词条</option><option value="comment" ${targetType === "comment" ? "selected" : ""}>评论</option><option value="user" ${targetType === "user" ? "selected" : ""}>用户</option><option value="site" ${targetType === "site" ? "selected" : ""}>站点</option><option value="plugin" ${targetType === "plugin" ? "selected" : ""}>插件</option></select>`;
  const body = `
    ${adminHeader("更新日志", "查询词条、评论、用户、设置、插件、备份与翻译操作。")}
    ${adminSearchForm("adminLogSearch", query, "搜索操作者、动作、对象或摘要", extra)}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>动作</th><th data-sort>操作者</th><th data-sort>对象</th><th data-sort>摘要</th><th>元数据</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "更新日志")}`;
  el.main.innerHTML = adminShell("logs", body);
  document.querySelector("#adminLogSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminLogs(1, data.get("q") || "", data.get("action") || "all", data.get("targetType") || "all").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminLogs(nextPage, query, action, targetType).catch(renderError));
}

async function renderAdminMessages(page = 1, query = "", statusFilter = "all") {
  const limit = 12;
  const payload = await api(`/api/admin/messages?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(statusFilter)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const rows = items.length ? items.map(adminMessageRow).join("") : `<tr><td colspan="8">\u6682\u65e0\u5168\u7ad9\u6d88\u606f\u8bb0\u5f55\u3002</td></tr>`;
  const extra = `<select name="status"><option value="all" ${statusFilter === "all" ? "selected" : ""}>全部状态</option><option value="active" ${statusFilter === "active" ? "selected" : ""}>发送中</option><option value="recalled" ${statusFilter === "recalled" ? "selected" : ""}>已撤回</option></select>`;
  const body = `
    ${adminHeader("消息管理", "发布、撤回并查看全站消息。")}
    <form class="auth-panel compact admin-message-form" id="adminBroadcastForm">
      <h2>全站群发</h2>
      <label>标题<input name="title" required maxlength="140" placeholder="例如：站点维护通知" /></label>
      <label>内容<textarea name="body" class="profile-markdown" required placeholder="写给所有用户的站内消息"></textarea></label>
      <div class="admin-priority-grid">
        <label class="admin-priority-select">\u4f18\u5148\u7ea7<select name="priority"><option value="normal">\u666e\u901a\uff1a\u8fdb\u5165\u6d88\u606f\u4e2d\u5fc3</option><option value="high">\u9ad8\uff1a\u7a81\u51fa\u663e\u793a</option><option value="urgent">\u6700\u9ad8\uff1a\u53f3\u4e0a\u89d2\u5f39\u7a97</option><option value="low">\u4f4e\uff1a\u9759\u9ed8\u901a\u77e5</option></select></label>
        <label class="admin-priority-select">\u5f39\u7a97\u79d2\u6570<input name="displaySeconds" type="number" min="3" max="60" value="7" /></label>
      </div>
      <button class="command-button" type="submit">发送给全站用户</button>
      <div class="status-line" id="adminBroadcastStatus"></div>
    </form>
    ${adminSearchForm("adminMessageSearch", query, "搜索标题、正文或发送者", extra)}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>\u6d88\u606f</th><th>\u4f18\u5148\u7ea7</th><th data-sort>\u8303\u56f4\u4e0e\u72b6\u6001</th><th data-sort>\u53d1\u9001\u8005</th><th data-sort>\u6b63\u6587</th><th data-sort>\u72b6\u6001</th><th data-sort>\u65f6\u95f4</th><th>\u64cd\u4f5c</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "消息管理")}`;
  el.main.innerHTML = adminShell("messages", body);
  document.querySelector("#adminBroadcastForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector("#adminBroadcastStatus");
    const requestBody = Object.fromEntries(new FormData(form).entries());
    status.textContent = "发送中...";
    try {
      const result = await api("/api/admin/messages/broadcast", { method: "POST", body: JSON.stringify(requestBody) });
      form?.reset();
      status.textContent = `已创建 1 条全站消息，当前覆盖 ${result.count || 0} 位用户。`;
      await renderAdminMessages(1, query, statusFilter);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#adminMessageSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminMessages(1, data.get("q") || "", data.get("status") || "all").catch(renderError);
  });
  document.querySelectorAll("[data-admin-message-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.adminMessageRevoke;
      button.disabled = true;
      button.textContent = "撤回中...";
      try {
        await api(`/api/admin/messages/${encodeURIComponent(id)}/revoke`, { method: "POST", body: JSON.stringify({}) });
        await renderAdminMessages(page, query, statusFilter);
      } catch (error) {
        button.textContent = error.message;
        setTimeout(() => renderAdminMessages(page, query, statusFilter).catch(renderError), 900);
      }
    });
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminMessages(nextPage, query, statusFilter).catch(renderError));
}async function renderAdminComments(page = 1, query = "", statusFilter = "all") {
  const limit = 12;
  const payload = await api(`/api/admin/comments?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(statusFilter)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const rows = items.length ? items.map((item) => adminCommentRow(item, { showReplies: true })).join("") : `<tr><td colspan="7">没有匹配的一级评论。</td></tr>`;
  const extra = `<select name="status"><option value="all" ${statusFilter === "all" ? "selected" : ""}>全部状态</option><option value="published" ${statusFilter === "published" ? "selected" : ""}>显示中</option><option value="hidden" ${statusFilter === "hidden" ? "selected" : ""}>已隐藏</option><option value="deleted" ${statusFilter === "deleted" ? "selected" : ""}>已删除</option></select>`;
  const body = `
    ${adminHeader("评论管理", "搜索一级评论，或进入回复页面继续管理。")}
    ${adminSearchForm("adminCommentSearch", query, "搜索词条、作者、邮箱或评论内容", extra)}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>词条</th><th data-sort>作者</th><th data-sort>内容</th><th data-sort>二级评论</th><th data-sort>状态</th><th data-sort>时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "评论管理")}`;
  el.main.innerHTML = adminShell("comments", body);
  document.querySelector("#adminCommentSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminComments(1, data.get("q") || "", data.get("status") || "all").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminComments(nextPage, query, statusFilter).catch(renderError));
  bindAdminCommentSaves(null);
}

async function renderAdminCommentReplies(parentId, page = 1, query = "", statusFilter = "all") {
  const limit = 12;
  const payload = await api(`/api/admin/comments/${parentId}/replies?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(statusFilter)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const root = payload.root || {};
  const rows = items.length ? items.map((item) => adminCommentRow(item, { showReplies: false })).join("") : `<tr><td colspan="7">这个一级评论下暂无二级评论。</td></tr>`;
  const extra = `<select name="status"><option value="all" ${statusFilter === "all" ? "selected" : ""}>全部状态</option><option value="published" ${statusFilter === "published" ? "selected" : ""}>显示中</option><option value="hidden" ${statusFilter === "hidden" ? "selected" : ""}>已隐藏</option><option value="deleted" ${statusFilter === "deleted" ? "selected" : ""}>已删除</option></select>`;
  const rootPreview = shortText(root.contentMd || root.contentHtml || "", 120);
  const body = `
    ${adminHeader("二级评论管理", `正在管理 #${parentId} 下的二级评论。根评论：${escapeHtml(rootPreview)}`)}
    <div class="admin-toolbar"><a class="command-button secondary" href="#/admin/comments">返回一级评论</a><a class="command-button secondary" href="#/comments/${encodeSlug(root.pageSlug || "home")}">打开前台讨论区</a></div>
    ${adminSearchForm("adminReplySearch", query, "搜索二级评论作者、邮箱或内容", extra)}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>词条</th><th data-sort>作者</th><th data-sort>内容</th><th data-sort>层级</th><th data-sort>状态</th><th data-sort>时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "二级评论")}`;
  el.main.innerHTML = adminShell("comments", body);
  document.querySelector("#adminReplySearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    renderAdminCommentReplies(parentId, 1, data.get("q") || "", data.get("status") || "all").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminCommentReplies(parentId, nextPage, query, statusFilter).catch(renderError));
  bindAdminCommentSaves(null);
}
function adminArchiveRow(item) {
  return `
    <tr>
      <td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.slug)} · ${escapeHtml(item.archiveId)}</small></td>
      <td>${escapeHtml(item.author || "Wikist")}</td>
      <td>${escapeHtml(item.quality || "C")} / ${escapeHtml(item.status || "archived")}</td>
      <td>${fmtDate(item.archivedAt)}</td>
      <td class="admin-row-actions"><a class="mini-link" href="#/archive/${encodeSlug(item.slug)}/${encodeURIComponent(item.archiveId)}">查看归档</a><button class="mini-button" data-restore-archive data-slug="${escapeHtml(item.slug)}" data-archive="${escapeHtml(item.archiveId)}" type="button">恢复</button><span class="status-line"></span></td>
    </tr>`;
}

function downloadTextFile(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importExportHubHtml(options = {}) {
  const pageOptions = state.pages.slice(0, 200).map((page) => `<option value="${escapeHtml(page.slug)}">${escapeHtml(page.title)}</option>`).join("");
  const header = options.admin
    ? adminHeader("导入导出", "导入、同步或导出词条。")
    : `<header class="article-head transfer-head"><div class="article-title-row"><h1>导入导出</h1><span class="quality-badge">Wikist Transfer</span></div><p class="article-summary">导入、同步或导出词条，并保留可继续编辑的内容与词条链接。</p></header>`;
  return `
    ${header}
    <section class="transfer-hub">
      <article class="transfer-hero">
        <div><span class="system-kicker">Knowledge Portability</span><h2>开放知识应该能自由迁移</h2><p>登录后可导入和同步词条；导出可直接使用，操作会记录到贡献。</p></div>
        <div class="transfer-state"><strong>${state.user ? "已登录" : "未登录"}</strong><span>${state.user ? escapeHtml(state.user.displayName || state.user.username) : "导入前请先登录通行证"}</span></div>
      </article>
      <section class="transfer-grid">
        <form class="transfer-panel" id="pageExportForm">
          <header><span>01</span><h2>导出词条</h2></header>
          <label>词条 slug<input name="slug" list="pageSlugList" required placeholder="abstract-algebra" /></label>
          <label>格式<select name="format"><option value="json">Wikist JSON</option><option value="markdown">Markdown</option></select></label>
          <button class="command-button" type="submit">导出</button>
          <div class="status-line" id="pageExportStatus"></div>
        </form>
        <form class="transfer-panel" id="wikistImportForm">
          <header><span>02</span><h2>导入 Wikist</h2></header>
          <div class="transfer-fields two"><label>格式<select name="format"><option value="json">Wikist JSON</option><option value="markdown">Markdown</option></select></label><label>目标 slug<input name="slug" required placeholder="imported-page" /></label></div>
          <label>标题<input name="title" placeholder="Markdown 导入时使用" /></label>
          <label>摘要<input name="summary" placeholder="Markdown 导入时使用" /></label>
          <label>导入内容<textarea name="content" spellcheck="false" placeholder="粘贴 Wikist JSON，或 Markdown 正文"></textarea></label>
          <label class="transfer-overwrite-toggle"><input type="checkbox" name="overwrite" /><span>允许覆盖已有词条</span></label>
          <button class="command-button" type="submit">导入 Wikist</button>
          <div class="status-line" id="wikistImportStatus"></div>
        </form>
        <form class="transfer-panel transfer-panel-accent" id="wikipediaImportForm">
          <header><span>03</span><h2>导入 Wikipedia</h2></header>
          <div class="transfer-fields two"><label>语言<select name="lang"><option value="zh">中文 Wikipedia</option><option value="en">English Wikipedia</option><option value="zh-cn">中文源 · 简体显示</option><option value="zh-tw">中文源 · 繁体显示</option></select></label><label>标题<input name="title" required placeholder="Virus / 群 (数学)" /></label></div>
          <label>目标 slug<input name="slug" placeholder="留空则自动生成" /></label>
          <label class="transfer-overwrite-toggle"><input type="checkbox" name="overwrite" /><span>允许覆盖已有词条</span></label>
          <button class="command-button" type="submit">从 Wikipedia 导入</button>
          <div class="status-line" id="wikipediaImportStatus"></div>
        </form>
        <form class="transfer-panel" id="wikipediaSyncForm">
          <header><span>04</span><h2>同步来源</h2></header>
          <label>已导入词条 slug<input name="slug" list="pageSlugList" required placeholder="virus" /></label>
          <p class="muted-line">选择已导入词条并同步；本地标题、slug 与顶部大图会保留。</p>
          <button class="command-button" type="submit">同步最新源</button>
          <div class="status-line" id="wikipediaSyncStatus"></div>
        </form>
      </section>
    </section>
    <datalist id="pageSlugList">${pageOptions}</datalist>`;
}

function bindImportExportForms() {
  document.querySelector("#pageExportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#pageExportStatus");
    const data = new FormData(event.currentTarget);
    const slug = data.get("slug") || "";
    const format = data.get("format") || "json";
    status.textContent = "正在导出...";
    try {
      const response = await fetch(`/api/pages/export?slug=${encodeURIComponent(slug)}&format=${encodeURIComponent(format)}`, { credentials: "same-origin" });
      const text = await response.text();
      if (!response.ok) throw new Error(JSON.parse(text || "{}").error || "导出失败。");
      downloadTextFile(`${slug}.${format === "markdown" ? "md" : "json"}`, format === "json" ? JSON.stringify(JSON.parse(text), null, 2) : text, format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8");
      status.textContent = "导出完成。";
    } catch (error) { status.textContent = error.message; }
  });

  document.querySelector("#wikistImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#wikistImportStatus");
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data.entries());
    payload.overwrite = data.has("overwrite");
    status.textContent = "正在导入...";
    try {
      const result = await api("/api/pages/import/wikist", { method: "POST", body: JSON.stringify(payload) });
      status.innerHTML = `导入完成：<a href="#/page/${encodeSlug(result.page.slug)}">${escapeHtml(result.page.title)}</a>`;
      await refreshChrome();
    } catch (error) { status.textContent = error.message; }
  });

  document.querySelector("#wikipediaImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#wikipediaImportStatus");
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data.entries());
    payload.overwrite = data.has("overwrite");
    status.textContent = "正在拉取 Wikipedia...";
    try {
      const result = await api("/api/pages/import/wikipedia", { method: "POST", body: JSON.stringify(payload) });
      status.innerHTML = `导入完成：<a href="#/page/${encodeSlug(result.page.slug)}">${escapeHtml(result.page.title)}</a>`;
      await refreshChrome();
    } catch (error) { status.textContent = error.message; }
  });

  document.querySelector("#wikipediaSyncForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#wikipediaSyncStatus");
    const slug = new FormData(event.currentTarget).get("slug") || "";
    status.textContent = "正在同步...";
    try {
      const result = await api(`/api/pages/${encodeSlug(slug)}/sync`, { method: "POST", body: JSON.stringify({}) });
      status.innerHTML = `同步完成：<a href="#/page/${encodeSlug(result.page.slug)}">${escapeHtml(result.page.title)}</a>`;
      await refreshChrome();
    } catch (error) { status.textContent = error.message; }
  });
}

async function renderImportExport() {
  await refreshUser().catch(() => {});
  setChromeTitle("导入导出");
  renderToc([]);
  el.editLink.href = "#/new";
  el.main.innerHTML = importExportHubHtml({ admin: false });
  bindImportExportForms();
}

async function renderAdminImports() {
  const body = importExportHubHtml({ admin: true });
  el.main.innerHTML = adminShell("imports", body);
  bindImportExportForms();
}
async function renderAdminArchives(page = 1, query = "") {
  const limit = 12;
  const payload = await api(`/api/admin/archives?page=${page}&limit=${limit}&q=${encodeURIComponent(query)}`);
  const { items, pagination } = normalizedPaged(payload, page, limit);
  const rows = items.length ? items.map(adminArchiveRow).join("") : `<tr><td colspan="5">没有归档页面。</td></tr>`;
  const body = `
    ${adminHeader("归档页面", "搜索已归档词条，并执行查看或恢复。")}
    ${adminSearchForm("adminArchiveSearch", query, "搜索归档标题、slug、作者或编号")}
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th data-sort>归档</th><th data-sort>作者</th><th data-sort>质量/状态</th><th data-sort>归档时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${paginationHtml(pagination, "归档页面")}`;
  el.main.innerHTML = adminShell("archives", body);
  document.querySelector("#adminArchiveSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderAdminArchives(1, new FormData(event.currentTarget).get("q") || "").catch(renderError);
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminArchives(nextPage, query).catch(renderError));
  document.querySelectorAll("[data-restore-archive]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = button.parentElement.querySelector(".status-line");
      status.textContent = "恢复中...";
      button.disabled = true;
      try {
        await api(`/api/admin/archives/${encodeSlug(button.dataset.slug)}/${encodeURIComponent(button.dataset.archive)}/restore`, { method: "POST", body: JSON.stringify({}) });
        await refreshChrome();
        status.textContent = "已恢复。";
        setTimeout(() => renderAdminArchives(page, query).catch(renderError), 350);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message;
      }
    });
  });
}
async function renderArchive(slugAndArchive) {
  const parts = String(slugAndArchive || "").split("/").filter(Boolean);
  const archiveId = parts.pop();
  const slug = parts.join("/");
  const archive = await api(`/api/archives/${encodeSlug(slug)}/${encodeURIComponent(archiveId)}`);
  setChromeTitle(`归档 - ${archive.title}`);
  renderToc(archive.toc || []);
  el.editLink.href = `#/edit/${encodeSlug(archive.slug)}`;
  el.main.innerHTML = `<header class="article-head"><div class="article-title-row"><h1>${escapeHtml(archive.title)}</h1><span class="quality-badge">归档</span></div><p class="article-summary">${escapeHtml(archive.summary || "已删除词条的归档快照。")}</p><div class="meta-row"><span class="chip">${escapeHtml(archive.slug)}</span><span class="chip">归档 ${fmtDate(archive.archivedAt)}</span><span class="chip">${archive.bytes || 0} 字节</span></div></header><article class="article-body archived-body">${archive.html || ""}</article>`;
  typesetMath();
}

function enhanceTables() {
  document.querySelectorAll(".admin-table th[data-sort]").forEach((th, index) => {
    th.setAttribute("role", "button");
    th.title = "点击排序";
    th.addEventListener("click", () => {
      const table = th.closest("table");
      const tbody = table.querySelector("tbody");
      const rows = [...tbody.querySelectorAll("tr")];
      const dir = th.dataset.dir === "asc" ? "desc" : "asc";
      table.querySelectorAll("th[data-sort]").forEach((item) => delete item.dataset.dir);
      th.dataset.dir = dir;
      rows.sort((a, b) => {
        const left = a.children[index]?.innerText.trim() || "";
        const right = b.children[index]?.innerText.trim() || "";
        return dir === "asc" ? left.localeCompare(right, "zh-CN") : right.localeCompare(left, "zh-CN");
      });
      rows.forEach((row) => tbody.appendChild(row));
    });
  });
}
const HOME_SETTING_FIELDS = [
  ["showFeatured", "特色词条", "展示高质量与推荐词条入口"],
  ["showNews", "资讯雷达", "展示资讯页与最近更新"],
  ["showPath", "入门路径", "展示标记规范、教程、协议等入口"],
  ["showProgress", "全球数学进展", "展示国际会议、形式化数学、预印本动态"],
  ["showStable", "稳定内容", "展示 A 级或 stable 词条"],
  ["showOriginal", "首页正文", "展示 home 词条原始 Markdown 正文"],
  ["showCategories", "分类索引", "展示分类云"],
  ["showActions", "协作控制台", "展示新建、搜索和后台入口"],
];

function settingToggleHtml([key, label, description], home) {
  const checked = home?.[key] !== false ? "checked" : "";
  return `<label class="setting-toggle"><input name="${key}" type="checkbox" ${checked} /><span><strong>${label}</strong><small>${description}</small></span></label>`;
}

async function renderAdminBackupsLegacy() {
  const body = `
    ${adminHeader("全站备份", "创建并下载完整站点备份。")}
    <section class="admin-settings-panel backup-panel">
      <div class="settings-section">
        <h2>创建备份包</h2>
        <p class="muted-line">生成备份后可用于迁移、留档或恢复。</p>
        <button class="command-button" type="button" id="createBackupButton">生成并下载备份</button>
        <div class="backup-progress" id="backupProgress" hidden>
          <div><span id="backupProgressText">准备中...</span><strong id="backupProgressPercent">0%</strong></div>
          <progress id="backupProgressBar" value="0" max="100"></progress>
        </div>
        <div class="status-line" id="backupStatus"></div>
      </div>
    </section>`;
  el.main.innerHTML = adminShell("backups", body);
  document.querySelector("#createBackupButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = document.querySelector("#backupStatus");
    const box = document.querySelector("#backupProgress");
    const text = document.querySelector("#backupProgressText");
    const percent = document.querySelector("#backupProgressPercent");
    const bar = document.querySelector("#backupProgressBar");
    button.disabled = true;
    box.hidden = false;
    status.textContent = "";
    text.textContent = "正在创建备份包...";
    percent.textContent = "0%";
    bar.value = 0;
    try {
      const response = await fetch("/api/admin/backup", { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "备份创建失败。");
      }
      const total = Number(response.headers.get("content-length") || 0);
      const reader = response.body?.getReader();
      const chunks = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const next = total ? Math.min(98, Math.round((received / total) * 100)) : Math.min(98, bar.value + 8);
          bar.value = next;
          percent.textContent = `${next}%`;
          text.textContent = "正在下载备份数据...";
        }
      }
      const blob = reader ? new Blob(chunks, { type: response.headers.get("content-type") || "application/gzip" }) : await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `wikist-backup-${Date.now()}.json.gz`;
      downloadBlobFile(filename, blob);
      bar.value = 100;
      percent.textContent = "100%";
      text.textContent = "备份完成";
      status.textContent = `已下载 ${filename}`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function readBackupFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(new Error("备份文件读取失败。"));
    reader.readAsDataURL(file);
  });
}

function humanFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function backupMetricsHtml(counts = {}) {
  const items = [
    ["词条", counts.pages || 0],
    ["修订", counts.revisions || 0],
    ["归档", counts.deleted || 0],
    ["配置", counts.config || 0],
    ["插件", counts.plugins || 0],
    ["用户数据", counts.userDataFiles || 0],
  ];
  return `<div class="backup-metrics">${items.map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${label}</small></span>`).join("")}</div>`;
}

function backupInspectHtml(backup = {}) {
  const files = (backup.files || []).slice(0, 8).map((file) => `<li><span>${escapeHtml(file.path)}</span><small>${humanFileSize(file.bytes)}</small></li>`).join("");
  const users = (backup.userData || []).map((file) => `<li><span>${escapeHtml(file.path)}</span><small>${humanFileSize(file.bytes)}</small></li>`).join("");
  const validation = backup.validation || {};
  const validationLine = validation.valid === false
    ? `<p class="muted-line strong-warn">校验失败：${escapeHtml((validation.issues || []).slice(0, 3).join("；") || "备份包内容不完整")}</p>`
    : `<p class="muted-line">完整性校验：${escapeHtml(validation.algorithm || "legacy")} · ${validation.valid === true ? "通过" : "旧格式，已完成路径检查"}</p>`;
  return `
    <div class="backup-result-card">
      <div class="backup-result-head"><strong>备份包已识别</strong><small>${backup.generatedAt ? fmtDate(backup.generatedAt) : "未知时间"} · ${escapeHtml(backup.format || "")}</small></div>
      ${backupMetricsHtml(backup.counts || {})}
      ${validationLine}
      <div class="backup-file-preview">
        <div><b>内容样例</b><ul>${files || "<li><span>无内容文件</span></li>"}</ul></div>
        <div><b>用户数据</b><ul>${users || "<li><span>未包含通行证数据库</span></li>"}</ul></div>
      </div>
    </div>`;
}

function backupRestoreHtml(result = {}) {
  const restored = (result.restored || []).slice(0, 10).map((file) => `<li><span>${escapeHtml(file.path)}</span><small>${humanFileSize(file.bytes)}</small></li>`).join("");
  const skipped = (result.skipped || []).slice(0, 8).map((file) => `<li><span>${escapeHtml(file.path || "未知路径")}</span><small>${escapeHtml(file.reason || "")}</small></li>`).join("");
  return `
    <div class="backup-result-card success">
      <div class="backup-result-head"><strong>回档完成</strong><small>${result.restoredFrom ? `来源 ${fmtDate(result.restoredFrom)}` : "已写入站点目录"}</small></div>
      ${backupMetricsHtml(result.counts || {})}
      <p class="muted-line">回档前已自动保存安全备份：${escapeHtml(result.safetyBackup?.path || "未生成")}</p>
      ${result.needsRestart ? '<p class="muted-line strong-warn">已恢复用户、评论、消息与评分数据库，建议重启 Wikist 服务使所有连接完全切换到新数据。</p>' : ""}
      <div class="backup-file-preview">
        <div><b>已恢复</b><ul>${restored || "<li><span>没有写入文件</span></li>"}</ul></div>
        <div><b>已跳过</b><ul>${skipped || "<li><span>无跳过项</span></li>"}</ul></div>
      </div>
    </div>`;
}

async function selectedBackupPayload() {
  const input = document.querySelector("#backupImportFile");
  const file = input?.files?.[0];
  if (!file) throw new Error("请先选择 Wikist 备份包。");
  return { filename: file.name, packageBase64: await readBackupFileBase64(file) };
}

async function renderAdminBackups() {
  const body = `
    ${adminHeader("全站备份", "创建、校验、导入或恢复站点备份。")}
    <section class="backup-admin-grid">
      <article class="admin-settings-panel backup-panel">
        <div class="settings-section">
          <span class="system-kicker">Backup</span>
          <h2>创建备份包</h2>
          <p class="muted-line">生成包含站点内容、配置、插件与用户数据的备份。</p>
          <button class="command-button" type="button" id="createBackupButton">生成并下载备份</button>
          <div class="backup-progress" id="backupProgress" hidden>
            <div><span id="backupProgressText">准备中...</span><strong id="backupProgressPercent">0%</strong></div>
            <progress id="backupProgressBar" value="0" max="100"></progress>
          </div>
          <div class="status-line" id="backupStatus"></div>
        </div>
      </article>
      <article class="admin-settings-panel backup-panel">
        <div class="settings-section">
          <span class="system-kicker">Restore</span>
          <h2>导入与回档</h2>
          <p class="muted-line">先选择并校验备份，再确认恢复范围。</p>
          <label class="backup-file-picker">
            <span>选择备份包</span>
            <input id="backupImportFile" type="file" accept=".gz,.json,application/gzip,application/json" />
          </label>
          <label class="setting-toggle backup-userdata-toggle">
            <input id="restoreUserData" type="checkbox" />
            <span><strong>同时恢复用户与互动数据</strong><small>勾选后将恢复通行证、评论、消息与评分。</small></span>
          </label>
          <div class="editor-actions">
            <button class="command-button secondary" type="button" id="inspectBackupButton">解析备份包</button>
            <button class="command-button danger" type="button" id="restoreBackupButton">执行回档</button>
          </div>
          <div class="status-line" id="backupRestoreStatus"></div>
          <div class="backup-result" id="backupInspectResult" hidden></div>
        </div>
      </article>
    </section>`;
  el.main.innerHTML = adminShell("backups", body);

  document.querySelector("#createBackupButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = document.querySelector("#backupStatus");
    const box = document.querySelector("#backupProgress");
    const text = document.querySelector("#backupProgressText");
    const percent = document.querySelector("#backupProgressPercent");
    const bar = document.querySelector("#backupProgressBar");
    button.disabled = true;
    box.hidden = false;
    status.textContent = "";
    text.textContent = "正在创建备份包...";
    percent.textContent = "0%";
    bar.value = 0;
    try {
      const response = await fetch("/api/admin/backup", { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "备份创建失败。");
      }
      const total = Number(response.headers.get("content-length") || 0);
      const reader = response.body?.getReader();
      const chunks = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const next = total ? Math.min(98, Math.round((received / total) * 100)) : Math.min(98, bar.value + 8);
          bar.value = next;
          percent.textContent = `${next}%`;
          text.textContent = "正在下载备份数据...";
        }
      }
      const blob = reader ? new Blob(chunks, { type: response.headers.get("content-type") || "application/gzip" }) : await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `wikist-backup-${Date.now()}.json.gz`;
      downloadBlobFile(filename, blob);
      bar.value = 100;
      percent.textContent = "100%";
      text.textContent = "备份完成";
      status.textContent = `已下载 ${filename}`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#inspectBackupButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = document.querySelector("#backupRestoreStatus");
    const resultBox = document.querySelector("#backupInspectResult");
    button.disabled = true;
    status.textContent = "正在读取并解析备份包...";
    try {
      const payload = await selectedBackupPayload();
      const result = await api("/api/admin/backup/inspect", { method: "POST", body: JSON.stringify(payload) });
      resultBox.hidden = false;
      resultBox.innerHTML = backupInspectHtml(result.backup);
      status.textContent = "解析完成，可以执行回档。";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#restoreBackupButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = document.querySelector("#backupRestoreStatus");
    const resultBox = document.querySelector("#backupInspectResult");
    const includeUserData = document.querySelector("#restoreUserData")?.checked === true;
    const message = includeUserData
      ? "确认执行全量回档？这会覆盖词条、配置、插件清单以及用户、评论、消息、评分数据库。系统会先自动保存当前状态。"
      : "确认执行内容回档？这会覆盖词条、修订、归档、配置和插件清单。系统会先自动保存当前状态。";
    if (!(await uiConfirm({ title: "确认回档备份", text: message, icon: "warning", confirmText: "执行回档", danger: true }))) return;
    button.disabled = true;
    status.textContent = "正在执行回档...";
    try {
      const payload = await selectedBackupPayload();
      const result = await api("/api/admin/backup/restore", { method: "POST", body: JSON.stringify({ ...payload, includeUserData }) });
      resultBox.hidden = false;
      resultBox.innerHTML = backupRestoreHtml(result);
      await reloadSiteChrome();
      status.textContent = result.needsRestart ? "回档完成。全量用户数据已写入，建议重启服务。" : "回档完成，站点缓存已刷新。";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function pluginConfigTextarea(plugin, config) {
  const pluginConfig = config?.[plugin.id] || {};
  return `<textarea class="plugin-json compact" data-plugin-config="${escapeHtml(plugin.id)}" spellcheck="false">${escapeHtml(JSON.stringify(pluginConfig, null, 2))}</textarea>`;
}

function pluginVendorHtml(plugin) {
  const vendor = plugin.vendor;
  if (!vendor?.supported) return `<small class="plugin-source-line">来源：${escapeHtml(plugin.source || plugin.directory || "local")}</small>`;
  const status = vendor.installed ? `已安装 · ${escapeHtml(vendor.commit || "unknown")}` : "未拉取";
  const pkg = vendor.packageName ? `${vendor.packageName}${vendor.packageVersion ? `@${vendor.packageVersion}` : ""}` : "";
  return `
    <div class="plugin-vendor-info ${vendor.installed ? "installed" : "missing"}">
      <span>${status}</span>
      <small>${escapeHtml(vendor.path || "")}${pkg ? ` · ${escapeHtml(pkg)}` : ""}${vendor.packageLicense ? ` · ${escapeHtml(vendor.packageLicense)}` : ""}</small>
      <small>${escapeHtml(vendor.repository || plugin.source || "")}</small>
    </div>`;
}


function pluginRuntimeHtml(plugin) {
  const runtime = plugin.runtime || {};
  if (!runtime.label) return "";
  const state = String(runtime.state || "manifest-only").replace(/[^\w-]/g, "");
  return `<span class="plugin-runtime-pill ${escapeHtml(state)}" title="${escapeHtml(runtime.detail || "")}">${escapeHtml(runtime.label)}</span>`;
}

function pluginHookHtml(plugin) {
  const hooks = plugin.hookCapabilities || [];
  if (!hooks.length) return '<small class="plugin-hook-empty">未声明扩展入口。</small>';
  return `<div class="plugin-hook-list">${hooks.map((hook) => `<span class="plugin-hook-chip ${hook.granted ? "declared" : "blocked"}" title="${escapeHtml(hook.detail || hook.description || "")}">${escapeHtml(hook.name)} · ${escapeHtml(hook.permission)}</span>`).join("")}</div>`;
}

function pluginVendorButton(plugin) {
  if (!plugin.vendor?.supported) return "";
  return `<button class="command-button secondary plugin-vendor-button" type="button" data-plugin-vendor-sync="${escapeHtml(plugin.id)}">${plugin.vendor.installed ? "更新仓库" : "拉取仓库"}</button>`;
}

function homeProgressJson(homeContent) {
  return JSON.stringify(homeContent?.progressItems || [], null, 2);
}

function homeNewsJson(homeContent) {
  return JSON.stringify(homeContent?.newsItems || [], null, 2);
}

function siteSettingsForm(site, home, homeContent = {}) {
  const settingsLanguages = uniqueLanguages([...DEFAULT_LANGUAGE_CODES, ...(site.languages || state.site?.languages || [])]);
  const mail = site.mail || {};
  const passportSecurity = site.passportSecurity || {};
  return `
    <form class="admin-settings-panel" id="siteSettingsForm">
      <section class="settings-section"><h2>基础信息</h2><div class="site-settings-grid">
        <label>站点标题<input name="name" value="${escapeHtml(site.name || "Wikist")}" /></label>
        <label>默认首页<input name="defaultPage" value="${escapeHtml(site.defaultPage || "home")}" /></label>
        <label>默认语言<select name="language">${settingsLanguages.map((lang) => `<option value="${lang}" ${lang === (site.language || "zh-CN") ? "selected" : ""}>${languageLabel(lang)}</option>`).join("")}</select></label>
        <label>协议<input name="license" value="${escapeHtml(site.license || "CC BY-SA 4.0")}" /></label>
        <label class="wide">站点语言列表<input name="languages" value="${escapeHtml(settingsLanguages.join(", "))}" placeholder="zh-CN, zh-TW, en, fr, ja" /></label>
        <label class="wide">站点简介<input name="tagline" value="${escapeHtml(site.tagline || "")}" /></label>
        <label class="wide">MathJax CDN<input name="mathCdn" value="${escapeHtml(site.mathCdn || "")}" /></label>
        <label class="wide">站点 CDN Base<input name="cdnBase" value="${escapeHtml(site.cdnBase || "")}" placeholder="例如：https://cdn.example.com/wikist" /></label>
        <label class="wide">站点图标 URL<input name="siteIcon" value="${escapeHtml(safeSiteIconUrl(site.siteIcon))}" placeholder="/uploads/site-icon.png 或 https://cdn.example.com/icon.png" /></label>
      </div></section>
      <section class="settings-section"><h2>&#x90AE;&#x4EF6;&#x4E0E;&#x5B89;&#x5168;</h2><div class="site-settings-grid mail-settings-grid">
        <label class="setting-toggle wide"><input name="mailEnabled" type="checkbox" ${mail.enabled ? "checked" : ""} /><span><strong>&#x542F;&#x7528; SMTP &#x90AE;&#x4EF6;</strong><small>&#x7528;&#x4E8E;&#x6CE8;&#x518C;&#x90AE;&#x7BB1;&#x9A8C;&#x8BC1;&#x3001;&#x627E;&#x56DE;&#x5BC6;&#x7801;&#x548C;&#x5B89;&#x5168;&#x901A;&#x77E5;&#x3002;</small></span></label>
        <label>SMTP &#x4E3B;&#x673A;<input name="smtpHost" value="${escapeHtml(mail.host || "")}" placeholder="smtp.example.com" /></label>
        <label>SMTP &#x7AEF;&#x53E3;<input name="smtpPort" type="number" min="1" max="65535" value="${escapeHtml(mail.port || 587)}" /></label>
        <label class="setting-toggle"><input name="smtpSecure" type="checkbox" ${mail.secure ? "checked" : ""} /><span><strong>SSL/TLS</strong><small>465 &#x901A;&#x5E38;&#x5F00;&#x542F;&#xFF0C;587 &#x901A;&#x5E38;&#x5173;&#x95ED;&#x3002;</small></span></label>
        <label>SMTP &#x7528;&#x6237;<input name="smtpUser" value="${escapeHtml(mail.user || "")}" autocomplete="off" /></label>
        <label>SMTP &#x5BC6;&#x7801;<input name="smtpPass" type="password" value="" autocomplete="new-password" placeholder="${mail.smtpPassSet ? "&#x5DF2;&#x914D;&#x7F6E;&#xFF0C;&#x7559;&#x7A7A;&#x4E0D;&#x4FEE;&#x6539;" : "&#x672A;&#x914D;&#x7F6E;"}" /></label>
        <label>&#x53D1;&#x4EF6;&#x4EBA;&#x540D;&#x79F0;<input name="fromName" value="${escapeHtml(mail.fromName || site.name || "Wikist")}" /></label>
        <label>&#x53D1;&#x4EF6;&#x90AE;&#x7BB1;<input name="fromAddress" type="email" value="${escapeHtml(mail.fromAddress || "")}" placeholder="no-reply@example.com" /></label>
        <label class="wide">&#x7AD9;&#x70B9;&#x5916;&#x90E8; URL<input name="mailBaseUrl" value="${escapeHtml(mail.baseUrl || "")}" placeholder="https://wiki.example.com" /></label>
        <label class="setting-toggle wide"><input name="requireEmailVerification" type="checkbox" ${passportSecurity.requireEmailVerification ? "checked" : ""} /><span><strong>&#x6CE8;&#x518C;&#x540E;&#x5FC5;&#x987B;&#x9A8C;&#x8BC1;&#x90AE;&#x7BB1;&#x624D;&#x80FD;&#x767B;&#x5F55;</strong><small>&#x5EFA;&#x8BAE;&#x5728; SMTP &#x6D4B;&#x8BD5;&#x7A33;&#x5B9A;&#x540E;&#x5F00;&#x542F;&#x3002;</small></span></label>
        <label>&#x9A8C;&#x8BC1;&#x90AE;&#x4EF6;&#x6709;&#x6548;&#x671F;&#xFF08;&#x79D2;&#xFF09;<input name="emailVerificationTTLSeconds" type="number" min="60" max="86400" value="${escapeHtml(passportSecurity.emailVerificationTTLSeconds || 1800)}" /></label>
        <label>&#x627E;&#x56DE;&#x5BC6;&#x7801;&#x6709;&#x6548;&#x671F;&#xFF08;&#x79D2;&#xFF09;<input name="passwordResetTTLSeconds" type="number" min="60" max="86400" value="${escapeHtml(passportSecurity.passwordResetTTLSeconds || 1200)}" /></label>
        <label>TOTP Issuer<input name="twoFactorIssuer" value="${escapeHtml(passportSecurity.twoFactorIssuer || site.name || "Wikist")}" /></label>
      </div></section>
      <section class="settings-section"><h2>网页端自定义</h2><p class="muted-line">编辑全站 CSS 与 JS；保存前请确认代码来源可信。</p><div class="site-code-grid">
        <label>自定义 CSS<textarea name="customCss" class="site-code-textarea" spellcheck="false">${escapeHtml(site.customCss || "")}</textarea></label>
        <label>自定义 JS<textarea name="customJs" class="site-code-textarea" spellcheck="false">${escapeHtml(site.customJs || "")}</textarea></label>
      </div></section>
      <section class="settings-section"><h2>首页展示内容</h2><div class="site-settings-grid">
        <label>首页眉标<input name="homeContent.heroKicker" value="${escapeHtml(homeContent.heroKicker || "")}" /></label>
        <label>首页标题前缀<input name="homeContent.heroTitle" value="${escapeHtml(homeContent.heroTitle || "欢迎来到")}" placeholder="欢迎来到" /></label>
        <label class="wide">首页简介<textarea name="homeContent.heroSummary" rows="3">${escapeHtml(homeContent.heroSummary || "")}</textarea></label>
        <label>搜索按钮<input name="homeContent.heroSearch" value="${escapeHtml(homeContent.heroSearch || "")}" /></label>
        <label>贡献按钮<input name="homeContent.heroContribute" value="${escapeHtml(homeContent.heroContribute || "")}" /></label>
        <label>资讯按钮<input name="homeContent.heroNews" value="${escapeHtml(homeContent.heroNews || "")}" /></label>
        <label>资讯雷达标题<input name="homeContent.newsTitle" value="${escapeHtml(homeContent.newsTitle || "")}" /></label>
        <label class="wide">资讯雷达 JSON<textarea name="homeContent.newsItems" class="site-code-textarea" spellcheck="false">${escapeHtml(homeNewsJson(homeContent))}</textarea></label>
        <label>入门路径标题<input name="homeContent.pathTitle" value="${escapeHtml(homeContent.pathTitle || "")}" /></label>
        <label>全球进展标题<input name="homeContent.progressTitle" value="${escapeHtml(homeContent.progressTitle || "")}" /></label>
        <label>协作区标题<input name="homeContent.actionsTitle" value="${escapeHtml(homeContent.actionsTitle || "")}" /></label>
        <label class="wide">协作区简介<textarea name="homeContent.actionsSummary" rows="3">${escapeHtml(homeContent.actionsSummary || "")}</textarea></label>
        <label class="wide">全球数学进展 JSON<textarea name="homeContent.progressItems" class="site-code-textarea" spellcheck="false">${escapeHtml(homeProgressJson(homeContent))}</textarea></label>
      </div></section>
      <section class="settings-section"><h2>首页模块</h2><div class="settings-grid">${HOME_SETTING_FIELDS.map((field) => settingToggleHtml(field, home)).join("")}</div></section>
      <div class="editor-actions"><button class="command-button" type="submit">保存站点设置</button><a class="command-button secondary" href="#/page/${encodeSlug(state.site.defaultPage)}">预览首页</a></div>
      <div class="status-line" id="siteSettingsStatus"></div>
    </form>`;
}

async function renderAdminSettings() {
  const payload = await api("/api/admin/settings").catch(() => ({ site: state.site || {}, home: state.site?.home || {}, homeContent: state.site?.homeContent || {} }));
  const site = payload.site || {};
  const home = payload.home || {};
  const homeContent = payload.homeContent || {};
  state.site = { ...state.site, ...site, home, homeContent };
  const body = `${adminHeader("站点设置", "配置站点信息、首页、邮件与自定义资源。")}${siteSettingsForm(site, home, homeContent)}`;
  el.main.innerHTML = adminShell("settings", body);
  document.querySelector("#siteSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#siteSettingsStatus");
    const data = new FormData(event.currentTarget);
    const sitePayload = Object.fromEntries(data.entries());
    sitePayload.mailEnabled = data.has("mailEnabled");
    sitePayload.smtpSecure = data.has("smtpSecure");
    sitePayload.requireEmailVerification = data.has("requireEmailVerification");
    sitePayload.smtpPort = Number(sitePayload.smtpPort || 587);
    sitePayload.emailVerificationTTLSeconds = Number(sitePayload.emailVerificationTTLSeconds || 1800);
    sitePayload.passwordResetTTLSeconds = Number(sitePayload.passwordResetTTLSeconds || 1200);
    sitePayload.baseUrl = sitePayload.mailBaseUrl || "";
    const homePayload = {};
    const homeContentPayload = {};
    HOME_SETTING_FIELDS.forEach(([key]) => { homePayload[key] = data.has(key); });
    for (const [key, value] of data.entries()) {
      if (!key.startsWith("homeContent.")) continue;
      const field = key.slice("homeContent.".length);
      if (field === "progressItems" || field === "newsItems") {
        try {
          homeContentPayload[field] = JSON.parse(value || "[]");
        } catch (_error) {
          status.textContent = `${field === "newsItems" ? "资讯雷达" : "全球数学进展"} JSON 格式不正确。`;
          return;
        }
      } else {
        homeContentPayload[field] = value;
      }
      delete sitePayload[key];
    }
    status.textContent = "保存中...";
    try {
      const saved = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ site: sitePayload, home: homePayload, homeContent: homeContentPayload }) });
      state.site = { ...state.site, ...(saved.site || sitePayload), home: saved.home || homePayload, homeContent: saved.homeContent || homeContentPayload };
      applySiteCustomizations();
      el.siteName.textContent = state.site.name;
      el.siteTagline.textContent = state.site.tagline;
      applySiteIcon();
      updateLanguageChrome();
      renderPassportLink();
      status.textContent = "站点设置已保存。";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function pluginTableRow(plugin, plugins) {
  const config = plugins?.[plugin.id] || {};
  return `
    <tr data-plugin-id="${escapeHtml(plugin.id)}">
      <td><strong>${escapeHtml(plugin.name)}</strong><small>${escapeHtml(plugin.id)} · ${escapeHtml(plugin.type)} · 配置 v${Number(plugin.configVersion || 1)}</small></td>
      <td><span class="plugin-enabled-state">${config.enabled !== false ? "启用" : "停用"}</span><small class="plugin-state-meta">${escapeHtml(plugin.entry || "manifest-only")}</small>${pluginRuntimeHtml(plugin)}</td>
      <td>${escapeHtml(plugin.description)}${pluginHookHtml(plugin)}${pluginVendorHtml(plugin)}</td>
      <td><pre class="plugin-doc plugin-doc-inline"><code>${escapeHtml(plugin.syntax.join("\n"))}</code></pre></td>
      <td>${pluginConfigTextarea(plugin, plugins)}<label class="plugin-enable inline"><input type="checkbox" data-plugin-enabled="${escapeHtml(plugin.id)}" ${config.enabled !== false ? "checked" : ""} />启用插件</label><div class="plugin-row-actions">${pluginVendorButton(plugin)}</div></td>
    </tr>`;
}

async function renderAdminPlugins(page = 1, query = "") {
  const payload = await api("/api/admin/settings").catch(() => ({ plugins: state.site?.plugins || {}, pluginCatalog: state.site?.pluginCatalog || [] }));
  const plugins = payload.plugins || {};
  const catalog = payload.pluginCatalog || [];
  state.site.plugins = plugins;
  state.site.pluginCatalog = catalog;
  const limit = 6;
  const q = String(query || "").trim().toLowerCase();
  const filtered = q ? catalog.filter((plugin) => [plugin.id, plugin.name, plugin.type, plugin.description, plugin.source, plugin.entry, plugin.clientModule, plugin.serverModule, plugin.repository].join(" ").toLowerCase().includes(q)) : catalog;
  const pagination = { page, pageSize: limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)), hasPrev: page > 1, hasNext: page < Math.ceil(filtered.length / limit) };
  const items = filtered.slice((page - 1) * limit, page * limit);
  const rows = items.length ? items.map((plugin) => pluginTableRow(plugin, plugins)).join("") : `<tr><td colspan="5">没有匹配的插件。</td></tr>`;
  const body = `
    ${adminHeader("插件管理", "搜索、启用、配置或加入插件。启用前请核对来源与权限。")}
    <form class="admin-settings-panel plugin-create-panel" id="pluginCreateForm">
      <section class="settings-section"><h2>加入新插件</h2><div class="plugin-create-grid">
        <label>插件 ID<input name="id" required placeholder="例如：graphTheoryBox" /></label>
        <label>插件名称<input name="name" required placeholder="例如：图论信息框" /></label>
        <label>类型<input name="type" value="extension" /></label>
        <label>入口<input name="entry" value="manifest-only" /></label>
        <label>客户端模块<input name="clientModule" placeholder="client.js 或 src/index.mjs" /></label>
        <label>服务端模块<input name="serverModule" placeholder="server.js（预留）" /></label>
        <label>Hooks<input name="hooks" placeholder="admin.panel, markdown.block" /></label>
        <label>权限<input name="permissions" placeholder="ui:admin-panel, content:render" /></label>
        <label>配置项<input name="configKeys" value="enabled" /></label>
        <label>Vendor 目录<input name="vendorDirectory" placeholder="例如：markdown-it-plugin" /></label>
        <label class="wide">来源<input name="source" placeholder="local:my-plugin 或 https://github.com/owner/repo" /></label>
        <label class="wide">GitHub 仓库<input name="repository" placeholder="https://github.com/owner/repo.git" /></label>
        <label class="wide">说明<input name="description" placeholder="插件用途说明" /></label>
        <label class="wide">语法示例<textarea name="syntax" class="plugin-mini-textarea" spellcheck="false" placeholder="::: graph-box\n...\n:::"></textarea></label>
        <label>配置版本<input name="configVersion" type="number" min="1" max="1000" value="1" /></label>
        <label class="wide">默认配置 JSON<textarea name="defaultConfig" class="plugin-mini-textarea" spellcheck="false">{"enabled":true}</textarea></label>
        <label class="wide">配置 Schema JSON<textarea name="configSchema" class="plugin-mini-textarea" spellcheck="false" placeholder='{"type":"object","properties":{"enabled":{"type":"boolean","default":true}}}'></textarea></label>
        <label class="wide">声明式配置迁移 JSON<textarea name="configMigrations" class="plugin-mini-textarea" spellcheck="false" placeholder='[{"from":1,"to":2,"rename":{"oldKey":"newKey"},"defaults":{"enabled":true}}]'></textarea></label>
      </div><div class="editor-actions plugin-form-actions"><button class="command-button" type="submit">创建插件 Manifest</button></div><div class="status-line" id="pluginCreateStatus"></div></section>
    </form>
    ${adminSearchForm("adminPluginSearch", query, "搜索插件名称、类型或来源")}
    <form class="admin-settings-panel" id="pluginSettingsForm">
      <div class="admin-table-wrap plugin-table-wrap"><table class="admin-table plugin-table"><thead><tr><th data-sort>插件</th><th data-sort>状态</th><th>说明</th><th>语法</th><th>配置</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${paginationHtml(pagination, "插件管理")}
      <div class="editor-actions plugin-form-actions"><button class="command-button" type="submit">保存本页插件配置</button></div>
      <div class="status-line" id="pluginSettingsStatus"></div>
    </form>`;
  el.main.innerHTML = adminShell("plugins", body);
  document.querySelector("#pluginCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#pluginCreateStatus");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    status.textContent = "正在创建插件 manifest...";
    try {
      await api("/api/admin/plugins", { method: "POST", body: JSON.stringify(payload) });
      status.textContent = "插件 manifest 已创建。";
      event.currentTarget.reset();
      setTimeout(() => renderAdminPlugins(1, query).catch(renderError), 350);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.querySelector("#adminPluginSearch")?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderAdminPlugins(1, new FormData(event.currentTarget).get("q") || "").catch(renderError);
  });
  document.querySelectorAll("[data-plugin-vendor-sync]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.pluginVendorSync;
      button.disabled = true;
      button.textContent = "同步中...";
      try {
        const synced = await api("/api/admin/plugins/vendor", { method: "POST", body: JSON.stringify({ id }) });
        state.site.pluginCatalog = synced.pluginCatalog || state.site.pluginCatalog;
        state.site.plugins = synced.plugins || state.site.plugins;
        await renderAdminPlugins(page, query);
      } catch (error) {
        button.textContent = error.message;
        setTimeout(() => {
          button.disabled = false;
          button.textContent = "重试同步";
        }, 1600);
      }
    });
  });
  enhanceTables();
  adminPager(pagination, (nextPage) => renderAdminPlugins(nextPage, query).catch(renderError));
  document.querySelector("#pluginSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#pluginSettingsStatus");
    const nextPlugins = { ...plugins };
    try {
      document.querySelectorAll("[data-plugin-config]").forEach((textarea) => {
        const id = textarea.dataset.pluginConfig;
        const parsed = JSON.parse(textarea.value || "{}");
        parsed.enabled = document.querySelector(`[data-plugin-enabled="${CSS.escape(id)}"]`)?.checked !== false;
        nextPlugins[id] = parsed;
      });
    } catch (error) {
      status.textContent = `插件配置 JSON 有误：${error.message}`;
      return;
    }
    status.textContent = "保存中...";
    try {
      const saved = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ plugins: nextPlugins }) });
      state.site.plugins = saved.plugins || nextPlugins;
      status.textContent = "插件配置已保存。";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}
function renderError(error) {
  if (error?.code === "rate_limited") {
    showFirewallNotice(error.retryAfter || 0);
    return;
  }
  const statusCode = Number(error?.statusCode || 0);
  const missing = statusCode === 404;
  const missingPageSlug = String(state.currentSlug || "").trim();
  const creatablePage = missing
    && error?.code === "page_not_found"
    && missingPageSlug !== ""
    && !missingPageSlug.includes("/");
  const tooLarge = error?.code === "body_too_large";
  const title = creatablePage
    ? `词条“${missingPageSlug}”尚未创建`
    : missing ? "未找到这个入口" : tooLarge ? "这次提交需要精简" : "连接暂时中断";
  const copy = missing
    ? (creatablePage ? "你可以创建这个词条，或先搜索站内是否已有相近主题。" : "该词条、协作资源或功能入口可能已被移动、归档或尚未创建。")
    : tooLarge
      ? "提交内容超过站点当前允许的大小。请移除不必要内容后重新提交。"
      : (error?.message || "请求未能完成，请稍后重试。");
  const code = creatablePage ? "NEW / KNOWLEDGE ENTRY" : missing ? "404 / KNOWLEDGE ROUTE" : tooLarge ? "413 / PAYLOAD LIMIT" : `ERROR / ${statusCode || "NETWORK"}`;
  const missingActions = creatablePage
    ? `<a class="command-button" href="#/edit/${encodeSlug(missingPageSlug)}">创建词条</a><a class="command-button secondary" href="#/search/${encodeURIComponent(missingPageSlug)}">搜索相近词条</a>`
    : '<a class="command-button secondary" href="#/search">搜索词条</a>';
  el.main.innerHTML = `<section class="wikist-route-state ${missing ? "is-missing" : ""} ${creatablePage ? "is-creatable-page" : ""}"><div class="wikist-route-state-grid" aria-hidden="true"></div><article><span class="wikist-system-mark" aria-hidden="true">${missing ? "?" : "!"}</span><p class="wikist-system-kicker">${escapeHtml(code)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p><div class="wikist-route-state-actions"><a class="command-button" href="#/page/${encodeSlug(state.site?.defaultPage || "home")}">返回首页</a>${missing ? missingActions : '<button class="command-button secondary" type="button" data-route-retry>重新尝试</button>'}</div></article></section>`;
  el.main.querySelector("[data-route-retry]")?.addEventListener("click", () => route());
}

function beginRouteTransition(options = {}) {
  window.clearTimeout(routePendingTimer);
  const soft = options.soft === true;
  document.dispatchEvent(new CustomEvent("wikist:route-loading", { detail: { state, soft } }));
  if (soft) {
    el.main?.classList.add("route-soft-pending");
    return;
  }
  routePendingTimer = window.setTimeout(() => {
    el.main?.classList.add("route-pending");
    const loader = ensureRouteLoader();
    loader.hidden = false;
  }, 120);
}

function endRouteTransition() {
  window.clearTimeout(routePendingTimer);
  routePendingTimer = 0;
  el.main?.classList.remove("route-pending", "route-soft-pending");
  const loader = document.querySelector("#wikistRouteLoader");
  if (loader) loader.hidden = true;
  document.dispatchEvent(new CustomEvent("wikist:route-ready", { detail: { state } }));
}

function routeTransitionScope(routeInfo) {
  const name = String(routeInfo?.name || "");
  if (["account", "admin", "community", "following", "favorites", "watchlist", "knowledge"].includes(name)) return name;
  if (name === "organization") {
    const parsed = splitValueQuery(routeInfo.value || "");
    return `organization:${String(parsed.pathValue || "").split("/")[0]}`;
  }
  return "";
}

function isSoftRouteTransition(nextRoute) {
  const nextScope = routeTransitionScope(nextRoute);
  return Boolean(nextScope && completedRoute && nextScope === routeTransitionScope(completedRoute));
}

function ensureRouteLoader() {
  let loader = document.querySelector("#wikistRouteLoader");
  if (loader) return loader;
  loader = document.createElement("div");
  loader.id = "wikistRouteLoader";
  loader.className = "wikist-native-route-loader";
  loader.hidden = true;
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  const icon = safeSiteIconUrl(siteAssetValue("siteIcon"));
  loader.innerHTML = `<div class="wikist-route-loader-core" aria-hidden="true"><i></i><i></i><img src="${escapeHtml(icon)}" alt=""></div><strong>正在接入知识节点</strong>`;
  document.body.appendChild(loader);
  return loader;
}

async function renderAdmin(section = "overview") {
  if (!state.user) await refreshUser({ ttlMs: 30000 });
  else refreshUser({ ttlMs: 30000 }).catch(() => {});
  if (!state.user) { location.hash = "#/login"; return; }
  if (!canAccessAdmin()) {
    setChromeTitle("无权访问后台");
    renderToc([]);
    el.main.innerHTML = `<section class="empty-state"><h1>无权访问后台</h1><p>后台仅允许资深编辑和管理员访问。普通用户可以继续编辑开放词条与参与评论。</p><a class="command-button" href="#/page/${encodeSlug(state.site.defaultPage)}">返回首页</a></section>`;
    return;
  }
  await loadClientPluginModules(el.main);
  const parts = String(section || "overview").split("/");
  const requested = parts[0];
  const pluginPanel = activePluginAdminPanels().find((panel) => panel.routeId === requested) || null;
  const active = ["overview", "users", "organizations", "community", "pages", "knowledge", "citations", "reviews", "search-index", "runtime", "comments", "comment-replies", "messages", "logs", "archives", "backups", "imports", "settings", "plugins"].includes(requested) || pluginPanel ? requested : "overview";
  setChromeTitle(`后台 - ${adminSectionTitle(active === "comment-replies" ? "comment-replies" : active)}`);
  renderToc([]);
  el.editLink.href = "#/new";
  if (active === "users") {
    if (!canManageUsers()) { await renderAdminOverview(); return; }
    await renderAdminUsers();
  }
  else if (active === "organizations") await renderAdminOrganizations();
  else if (active === "community") await renderAdminCommunity();
  else if (active === "pages") await renderAdminPages();
  else if (active === "knowledge") await renderAdminKnowledge();
  else if (active === "citations") await renderAdminCitations();
  else if (active === "reviews") await renderAdminReviews();
  else if (active === "search-index") await renderAdminSearchIndex();
  else if (active === "runtime") await renderAdminRuntime();
  else if (active === "comments") await renderAdminComments();
  else if (active === "comment-replies") await renderAdminCommentReplies(Number(parts[1]) || 0);
  else if (active === "messages") await renderAdminMessages();
  else if (active === "logs") await renderAdminLogs();
  else if (active === "archives") await renderAdminArchives();
  else if (active === "backups") await renderAdminBackups();
  else if (active === "imports") await renderAdminImports();
  else if (active === "settings") await renderAdminSettings();
  else if (active === "plugins") await renderAdminPlugins(Number(parts[1]) || 1, "");
  else if (pluginPanel) await renderPluginAdminPanel(pluginPanel);
  else await renderAdminOverview();
}
function parseRoute() {
  const hash = location.hash;
  if (!hash || hash === "#" || hash === "#/") return { name: "portal", value: "" };
  const clean = hash.replace(/^#\/?/, "");
  const [pathValue, query = ""] = clean.split("?");
  const [name, ...rest] = pathValue.split("/");
  const value = `${rest.join("/")}${query ? `?${query}` : ""}`;
  return { name: name || "page", value: decodeURIComponent(value || "") };
}

async function route() {
  const generation = ++routeGeneration;
  const nextRoute = parseRoute();
  if (completedRoute && (completedRoute.name !== nextRoute.name || completedRoute.value !== nextRoute.value)) {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }
  closeMessagePopover();
  clearHydrationTask();
  beginRouteTransition({ soft: isSoftRouteTransition(nextRoute) });
  try {
    const { name, value } = nextRoute;
    if (name !== "messages") {
      stopMessagingWorkspacePolling();
      if (messagingConversationSubscription) {
        try { messagingConversationSubscription.unsubscribe(); } catch (_error) {}
        try { messagingConversationSubscription.removeAllListeners(); } catch (_error) {}
        messagingConversationSubscription = null;
      }
      messagingActiveConversationId = "";
    }
    renderNav();
    renderTopQuickNav();
    if (state.site?.setup?.needsAdmin && name !== "setup-admin" && name !== "reset-password" && name !== "verify-email") {
      location.hash = "#/setup-admin";
      return;
    }
    document.body.classList.toggle("admin-mode", name === "admin");
    document.body.classList.toggle("portal-mode", name === "portal");
    document.body.classList.toggle("messaging-mode", name === "messages");
    if (name !== "edit" && name !== "new") destroyVisualEditor();
    if (name === "portal") renderKnowledgePortal();
    else if (name === "search") await renderSearch(value);
    else if (name === "edit") await renderEditor(value);
    else if (name === "new") await renderEditor("");
    else if (name === "translate") await renderTranslation(value);
    else if (name === "translation-glossary") await renderTranslationGlossary(value);
    else if (name === "history") await renderHistory(value);
    else if (name === "review") await renderPageReview(value);
    else if (name === "comments") await renderComments(value);
    else if (name === "permissions") await renderPermissions(value);
    else if (name === "login") { redirectToPassport("login"); return; }
    else if (name === "register") { redirectToPassport("register"); return; }
    else if (name === "setup-admin") { location.replace(`${passportUrl("register")}&setup=1`); return; }
    else if (name === "forgot-password") { redirectToPassport("forgot"); return; }
    else if (name === "reset-password") { redirectToPassport("reset", value); return; }
    else if (name === "verify-email") { redirectToPassport("verify", value); return; }
    else if (name === "account") await renderAccount(value);
    else if (name === "highlights") await renderAccount(`?section=highlights${value ? `&${value.replace(/^\?/, "")}` : ""}`);
    else if (name === "favorites") await renderFavorites(value);
    else if (name === "watchlist") await renderWatchlist(value);
    else if (name === "following") await renderFollowing(value);
    else if (name === "organizations") await renderOrganizations(value);
    else if (name === "messages") await renderMessagingWorkspace(value);
    else if (name === "questions") await renderCommunityQuestions(value);
    else if (name === "community") await renderCommunity(value);
    else if (name === "organization") await renderOrganization(value);
    else if (name === "knowledge") await renderKnowledge(value);
    else if (name === "category") await renderCategory(value);
    else if (name === "topic") await renderTopic(value);
    else if (name === "news") {
      location.hash = "#/page/news";
      return;
    }
    else if (name === "pages") {
      location.hash = `#/page/${value || state.site.defaultPage || "home"}`;
      return;
    }
    else if (name === "import-export" || name === "imports") await renderImportExport();
    else if (name === "archive") await renderArchive(value);
    else if (name === "admin") await renderAdmin(value || "overview");
    else if (name === "user") await renderUserPage(value);
    else await renderPage(value || state.site.defaultPage || "home");
  } catch (error) {
    if (generation === routeGeneration) renderError(error);
  } finally {
    if (generation === routeGeneration) {
      completedRoute = nextRoute;
      schedulePostRenderHydration(el.main);
      selectionToolbar?.refresh(el.main).then(() => revealRequestedSelection()).catch(() => {});
      endRouteTransition();
    }
  }
}

function scrollToWikiAnchor(id) {
  const target = document.getElementById(String(id || ""));
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("anchor-pulse");
  window.setTimeout(() => target.classList.remove("anchor-pulse"), 1200);
  return true;
}

function ensureImageViewer() {
  let viewer = document.querySelector("#imageViewer");
  if (viewer) return viewer;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="image-viewer" id="imageViewer" role="dialog" aria-modal="true" aria-label="图片查看">
      <button class="image-viewer-close" type="button" data-image-viewer-close aria-label="关闭图片查看">&times;</button>
      <figure>
        <img alt="" />
        <figcaption></figcaption>
      </figure>
    </div>`);
  viewer = document.querySelector("#imageViewer");
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer || event.target.closest("[data-image-viewer-close]")) closeImageViewer();
  });
  return viewer;
}

function openImageViewer(image) {
  if (!image) return;
  const frame = image.closest(".wiki-image, .messaging-attachment.image") || image;
  const viewer = ensureImageViewer();
  const src = frame.dataset.wikiImageSrc || image.currentSrc || image.src;
  const caption = frame.querySelector?.("figcaption")?.textContent?.trim() || frame.dataset.wikiImageCaption || image.alt || "";
  const target = viewer.querySelector("img");
  target.src = src;
  target.alt = frame.dataset.wikiImageAlt || image.alt || caption || "Wikist 图片";
  viewer.querySelector("figcaption").textContent = caption;
  viewer.classList.add("active");
  document.body.classList.add("image-viewer-open");
}

function closeImageViewer() {
  const viewer = document.querySelector("#imageViewer");
  if (!viewer) return;
  viewer.classList.remove("active");
  document.body.classList.remove("image-viewer-open");
  const target = viewer.querySelector("img");
  if (target) target.removeAttribute("src");
}
function submitChromeSearch(input) {
  const query = input?.value?.trim() || "";
  location.hash = searchHash({ q: query, page: 1 });
}

bindPageSuggestions(el.topSearchInput, { limit: 8 });

el.searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChromeSearch(el.searchInput);
});

el.topSearchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChromeSearch(el.topSearchInput);
});

el.languageSelect?.addEventListener("change", async (event) => {
  let value = event.currentTarget.value;
  if (value === "__custom") {
    value = await uiPrompt({
      title: "添加站点语言",
      text: "输入 BCP 47 语言代码，例如 fr、ja 或 de-DE。",
      value: state.uiLanguage || "zh-CN",
      placeholder: "fr / ja / de-DE",
      validator: (input) => normalizeLanguageCode(input, "") ? undefined : "请输入有效的语言代码。",
    });
    if (value === null) { updateLanguageChrome(); return; }
  }
  const lang = normalizeLanguageCode(value, "");
  if (!lang) {
    updateLanguageChrome();
    return;
  }
  setUiLanguage(lang);
  const current = parseRoute();
  if (current.name === "page" || !current.name) {
    route().catch((error) => {
      el.main.innerHTML = `<section class="empty-state"><h1>加载失败</h1><p>${escapeHtml(error.message)}</p></section>`;
    });
  }
});

el.themeToggle?.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

el.topbarLogout?.addEventListener("click", async () => {
  el.topbarLogout.disabled = true;
  try {
    await logoutSiteSession();
  } finally {
    el.topbarLogout.disabled = false;
  }
});

document.addEventListener("click", (event) => {
  const homeDiscoveryRefresh = event.target.closest("#homeDiscoveryRefresh");
  if (homeDiscoveryRefresh) {
    event.preventDefault();
    state.homeDiscoverySeed = (Date.now() + Number(state.homeDiscoverySeed || 0) + 1) >>> 0;
    const list = document.querySelector("#homeDiscoveryList");
    if (list) list.innerHTML = homeDiscoveryItemsHtml();
    return;
  }

  const recommendationRefresh = event.target.closest("#recommendationRefresh");
  if (recommendationRefresh) {
    event.preventDefault();
    state.recommendationSeed = (Date.now() + Number(state.recommendationSeed || 0) + 1) >>> 0;
    renderRecommendationItems(state.recommendationPool, state.recommendationSlug, { preservePool: true });
    return;
  }

  const recentRefresh = event.target.closest("#recentRefresh");
  if (recentRefresh) {
    event.preventDefault();
    state.recentSeed = (Date.now() + Number(state.recentSeed || 0) + 1) >>> 0;
    renderRecent();
    return;
  }

  const siteNavToggle = event.target.closest("#mobileNavToggle");
  if (siteNavToggle) {
    const open = !document.body.classList.contains("mobile-nav-open");
    document.body.classList.toggle("mobile-nav-open", open);
    siteNavToggle.setAttribute("aria-expanded", String(open));
    return;
  }

  const adminNavToggle = event.target.closest("#adminMobileNavToggle");
  if (adminNavToggle) {
    const open = !document.body.classList.contains("admin-mobile-nav-open");
    document.body.classList.toggle("admin-mobile-nav-open", open);
    adminNavToggle.setAttribute("aria-expanded", String(open));
    return;
  }

  if (event.target.closest("#mobileNavBackdrop") || event.target.closest(".sidebar a")) {
    document.body.classList.remove("mobile-nav-open");
    document.querySelector("#mobileNavToggle")?.setAttribute("aria-expanded", "false");
  }

  if (event.target.closest("#adminMobileNavBackdrop") || event.target.closest(".admin-sidebar a")) {
    document.body.classList.remove("admin-mobile-nav-open");
    document.querySelector("#adminMobileNavToggle")?.setAttribute("aria-expanded", "false");
  }

  const closeButton = event.target.closest("[data-image-viewer-close]");
  if (closeButton) {
    event.preventDefault();
    closeImageViewer();
    return;
  }

  const scrollLink = event.target.closest("a[data-wikist-scroll]");
  if (scrollLink) {
    event.preventDefault();
    scrollToWikiAnchor(scrollLink.dataset.wikistScroll);
    return;
  }

  const imageTrigger = event.target.closest(".wiki-image img[data-wiki-image-trigger], .messaging-attachment.image[data-messaging-image-preview]");
  if (imageTrigger) {
    event.preventDefault();
    openImageViewer(imageTrigger.matches("img") ? imageTrigger : imageTrigger.querySelector("img"));
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeImageViewer();
    document.body.classList.remove("mobile-nav-open", "admin-mobile-nav-open");
    document.querySelector("#mobileNavToggle")?.setAttribute("aria-expanded", "false");
    document.querySelector("#adminMobileNavToggle")?.setAttribute("aria-expanded", "false");
  }
});
window.addEventListener("hashchange", () => {
  route().catch((error) => {
    el.main.innerHTML = `<section class="empty-state"><h1>加载失败</h1><p>${escapeHtml(error.message)}</p></section>`;
  });
});

async function boot() {
  beginRouteTransition();
  try {
    state.site = await api("/api/site");
    state.uiLanguage = savedLanguage();
    el.siteName.textContent = state.site.name;
    el.siteTagline.textContent = state.site.tagline;
    renderSiteFooter();
    applySiteIcon();
    updateLanguageChrome();
    setupUnifiedMessageMenu();
    await Promise.all([refreshUser(), refreshChrome()]);
    initSelectionInteractions();
    await route();
  } catch (error) {
    endRouteTransition();
    throw error;
  }
}

boot().catch((error) => {
  el.main.innerHTML = `<section class="empty-state"><h1>启动失败</h1><p>${escapeHtml(error.message)}</p></section>`;
});
