"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const params = new URLSearchParams(location.search);
const SCENES = [
  ["1", "背景 1"],
  ["2", "背景 2"],
  ["3", "背景 3"],
  ["4", "背景 4"],
  ["5", "背景 5"],
  ["6", "背景 6"],
  ["7", "背景 7"],
  ["8", "背景 8"],
];
const VALID_MODES = new Set(["login", "register", "forgot", "reset", "verify"]);
const UI_LANGUAGE_KEY = "wikist-language";
const PASSPORT_EN = [
  ["开放、严谨、可验证的数学知识共同体", "An open, rigorous, verifiable mathematics knowledge community"],
  ["开放知识通行证", "Open knowledge passport"], ["知识通行证", "Knowledge passport"], ["通行证", "Passport"],
  ["返回 Wiki", "Back to Wiki"], ["页面工具", "Page tools"], ["切换深浅主题", "Switch light/dark theme"], ["主题", "Theme"], ["选择背景", "Choose background"], ["场景", "Scene"],
  ["登录", "Sign in"], ["注册", "Sign up"], ["找回密码", "Reset password"], ["设置新密码", "Set a new password"], ["验证邮箱", "Verify email"],
  ["验证身份后继续进入知识网络。", "Verify your identity to continue to the knowledge network."],
  ["创建账号并开始记录你的贡献。", "Create an account and start recording your contributions."],
  ["通过绑定邮箱恢复你的知识通行证。", "Recover your knowledge passport through your verified email address."],
  ["更新后请使用新密码登录。", "Use your new password to sign in after updating it."],
  ["正在确认验证链接。", "Confirming this verification link."],
  ["用户名或邮箱", "Username or email"], ["用户名", "Username"], ["显示名称", "Display name"], ["邮箱", "Email address"],
  ["密码", "Password"], ["确认密码", "Confirm password"], ["新密码", "New password"], ["确认新密码", "Confirm new password"],
  ["输入你的统一身份标识", "Enter your username or email"], ["输入通行证密码", "Enter your passport password"], ["输入已绑定邮箱的账号", "Enter the account with a verified email"],
  ["你的公开知识署名", "Your public knowledge byline"], ["再次输入密码", "Enter the password again"], ["显示密码", "Show password"], ["隐藏密码", "Hide password"],
  ["3-32 位字母、数字、下划线或连字符", "3-32 letters, numbers, underscores, or hyphens"], ["将显示在贡献、审阅与讨论记录中", "Shown on contributions, reviews, and discussions"],
  ["用于验证身份与找回密码，不会公开展示", "Used for verification and password recovery; never shown publicly"],
  ["验证身份并登录", "Verify identity and sign in"], ["忘记密码？", "Forgot password?"], ["还没有通行证？", "No passport yet?"], ["创建账号", "Create account"], ["已有通行证？", "Already have a passport?"], ["返回登录", "Back to sign in"],
  ["发送密码重置邮件", "Send password reset email"], ["创建新账号", "Create a new account"], ["更新密码并注销旧会话", "Update password and sign out old sessions"],
  ["使用二次验证码", "Use two-factor code"], ["6 位动态验证码", "6-digit one-time code"],
  ["服务器安装密钥", "Server installation key"], ["启动日志中显示的一次性密钥", "One-time key shown in the startup log"], ["该密钥只用于确认你拥有服务器控制权", "This key only confirms that you control the server"],
  ["创建首位管理员", "Create the first administrator"], ["创建知识通行证", "Create a knowledge passport"], ["初始化站点唯一的首位管理身份。", "Initialize the site's first and only administrator identity."],
  ["人机验证", "Human verification"], ["刷新", "Refresh"], ["系统随机验证", "Random system verification"], ["准备中", "Preparing"], ["验证码背景", "Verification background"], ["拼图滑块", "Puzzle slider"],
  ["按提示顺序点选图中文字", "Click the text in the requested order"], ["正在生成安全验证…", "Generating security verification..."], ["拖动滑块完成拼图", "Drag the slider to complete the puzzle"], ["按住滑块向右拖动", "Hold and drag the slider right"], ["撤销一点", "Undo one"], ["完成验证后继续提交。", "Complete verification before submitting."],
  ["正在检查是否可用…", "Checking availability..."], ["用户名可以使用", "Username is available"], ["用户名已被占用", "Username is already taken"], ["邮箱可以使用", "Email is available"], ["邮箱已被占用", "Email is already in use"], ["暂时无法检查，提交时会再次验证", "Unable to check now; it will be verified when you submit"],
  ["正在建立安全会话…", "Creating secure session..."], ["正在发送安全邮件…", "Sending security email..."], ["正在更新密码…", "Updating password..."], ["两次输入的密码不一致。", "The two passwords do not match."],
  ["当前会话", "Current session"], ["继续访问站点，或切换账号。", "Continue to the site or switch accounts."], ["继续使用当前账号", "Continue with this account"], ["退出并切换账号", "Sign out and switch accounts"], ["退出登录", "Sign out"], ["当前已登录为 ", "Signed in as "], ["进入账户中心", "Open account center"],
  ["通行证场景", "Passport scene"], ["关闭", "Close"], ["自定义背景 URL", "Custom background URL"], ["强调色", "Accent color"], ["应用自定义场景", "Apply custom scene"], ["提示", "Notice"], ["知道了", "OK"],
  ["背景地址无效", "Invalid background URL"], ["请输入 HTTPS 图片地址或本站绝对路径。", "Enter an HTTPS image URL or an absolute path on this site."],
  ["通行证暂时不可用", "Passport is temporarily unavailable"], ["返回 Wiki", "Back to Wiki"],
  ["至少 8 位字符", "At least 8 characters"], ["密码强度", "Password strength"], ["若账号存在，将发送密码重置链接", "If the account exists, a password reset link will be sent."],
  ["请在 5 分钟内完成验证。", "Complete verification within 5 minutes."], ["验证码图像加载失败，请刷新后重试。", "Verification image could not load. Refresh and try again."], ["按序点选", "Click in order"], ["滑块拼图", "Slider puzzle"], ["请按以下顺序点选", "Click in this order"], ["正在校验行为轨迹…", "Checking interaction pattern..."], ["验证通过", "Verification passed"], ["验证通过，可提交当前表单。", "Verification passed. You can submit this form."], ["人机验证仍在处理中，请稍候。", "Human verification is still processing. Please wait."], ["请先完成人机验证。", "Complete human verification first."],
  ["身份验证成功，正在进入账户中心…", "Identity verified. Opening Account Center..."], ["首位管理员已创建，正在进入后台。", "First administrator created. Opening Admin..."], ["通行证已创建，验证邮件已经发送到你的邮箱。", "Passport created. A verification email has been sent to your address."], ["通行证已创建；当前站点未能发送验证邮件，可稍后在账户中心重试。", "Passport created, but this site could not send a verification email. Try again later from Account Center."], ["注册成功", "Registration complete"], ["请检查你的邮箱", "Check your email"], ["如果账号存在且邮件服务可用，密码重置链接已经发送。", "If the account exists and email is available, a password reset link has been sent."], ["密码已更新", "Password updated"], ["所有旧登录会话均已失效，请使用新密码重新登录。", "All previous sign-in sessions have been revoked. Sign in with your new password."], ["账号已被封禁", "Account disabled"], ["请输入验证器中的 6 位动态验证码，然后重新完成人机验证。", "Enter the 6-digit code from your authenticator, then complete human verification again."], ["请求较频繁，请在", "Too many requests. Try again in"], ["秒后重试。", "seconds."],
  ["Wikist 用户", "Wikist user"], ["成员", "Member"], ["已验证", "Verified"], ["当前账号已安全退出，请登录其他账号。", "You have safely signed out. Sign in with another account."], ["已退出当前账号。", "Signed out."], ["正在验证邮箱", "Verifying email"], ["正在检查这条验证链接，请稍候…", "Checking this verification link. Please wait..."], ["验证链接不完整", "Incomplete verification link"], ["链接中缺少邮箱验证令牌，请重新发送验证邮件。", "This link is missing an email verification token. Send a new verification email."], ["邮箱验证成功", "Email verified"], ["邮箱已验证，可以继续使用账户。", "Your email is verified. You can continue using your account."], ["邮箱验证失败", "Email verification failed"], ["使用", "Use"], ["账户参与词条、协作、消息与审阅。", "account to participate in pages, collaboration, messages, and review."],
];
const PASSPORT_EN_MAP = new Map(PASSPORT_EN);
const PASSPORT_API_ERROR_EN = {
  invalid_credentials: "Incorrect account or password.", account_disabled: "This account has been disabled.", email_verification_required: "Verify your email address before signing in.", username_invalid: "Username must contain 3-32 letters, numbers, underscores, or hyphens.", display_name_invalid: "Display name is required and must be 80 characters or fewer.", email_invalid: "Enter a valid email address.", password_invalid: "Password must meet the required length and confirmation rules.", identity_exists: "That username or email address is already in use.", install_bootstrap_required: "The one-time installation key shown at server startup is required.", captcha_required: "Complete human verification first.", captcha_invalid: "Verification failed. Complete it again.", captcha_expired: "Verification expired. Refresh and try again.", captcha_unavailable: "Human verification is temporarily unavailable. Try again later.", passport_token_invalid: "This verification link has expired. Request a new one.", login_rate_limited: "Too many sign-in attempts. Try again later.", csrf_token_invalid: "Your security token has expired. Refresh the page and try again.", internal_error: "An internal error occurred. Try again later.",
};

function englishUiEnabled() {
  try { return localStorage.getItem(UI_LANGUAGE_KEY) === "en"; } catch (_) { return false; }
}

function translatePassportText(value) {
  const original = String(value || "");
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  const text = original.trim();
  const exact = PASSPORT_EN_MAP.get(text);
  if (exact) return `${leading}${exact}${trailing}`;
  const scene = text.match(/^选择背景\s*(\d+)$/);
  if (scene) return `${leading}Choose background ${scene[1]}${trailing}`;
  const disabled = text.match(/^该\s+(.+?)\s+通行证已停用，请联系站点管理员。$/);
  if (disabled) return `${leading}This ${disabled[1]} Passport has been disabled. Contact the site administrator.${trailing}`;
  const siteIntro = text.match(/^使用\s+(.+?)\s+账户参与词条、协作、消息与审阅。$/);
  if (siteIntro) return `${leading}Use your ${siteIntro[1]} account to participate in pages, collaboration, messages, and review.${trailing}`;
  const retry = text.match(/^请求较频繁，请在\s*(\d+)\s*秒后重试。$/);
  if (retry) return `${leading}Too many requests. Try again in ${retry[1]} seconds.${trailing}`;
  return original;
}

function hydratePassportEnglish(root = document.body) {
  if (!englishUiEnabled()) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue.trim() || parent.closest("script,style,textarea,code,pre,[data-i18n-skip]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!node._wikistOriginalText) node._wikistOriginalText = node.nodeValue;
    node.nodeValue = translatePassportText(node._wikistOriginalText);
  });
  root.querySelectorAll("*").forEach((element) => {
    if (element.closest("[data-i18n-skip]")) return;
    ["placeholder", "title", "aria-label", "alt"].forEach((name) => {
      const originalKey = `_wikistOriginal${name[0].toUpperCase()}${name.slice(1)}`;
      const value = element.getAttribute(name);
      if (value === null) return;
      if (!(originalKey in element)) element[originalKey] = value;
      const translated = translatePassportText(element[originalKey]);
      if (translated !== element[originalKey]) element.setAttribute(name, translated);
    });
  });
  document.documentElement.lang = "en";
}

const state = {
  mode: VALID_MODES.has(params.get("mode")) ? params.get("mode") : "login",
  setup: params.get("setup") === "1",
  token: params.get("token") || "",
  site: { name: "Wikist", tagline: "开放、严谨、可验证的数学知识共同体" },
  user: null,
  captcha: null,
  csrfToken: "",
};

const elements = {
  siteName: $("#passportSiteName"),
  siteTagline: $("#passportSiteTagline"),
  introSiteName: $("#introSiteName"),
  intro: $("#passportIntro"),
  footerSiteName: $("#footerSiteName"),
  brandIcon: $("#passportBrandIcon"),
  favicon: $("#passportFavicon"),
  formTitle: $("#formTitle"),
  formSubtitle: $("#formSubtitle"),
  formMount: $("#formMount"),
  tabs: $("#passportTabs"),
  signedIn: $("#signedInNotice"),
  themeToggle: $("#themeToggle"),
  sceneButton: $("#sceneButton"),
  sceneDialog: $("#sceneDialog"),
  sceneGrid: $("#sceneGrid"),
  customSceneUrl: $("#customSceneUrl"),
  customAccent: $("#customAccent"),
  noticeDialog: $("#noticeDialog"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function safeAssetUrl(value, fallback = "/assets/wikist-icon.png") {
  const text = String(value || "").trim();
  if (text === "/assets/wikist-emblem.svg") return fallback;
  if (/^\/[A-Za-z0-9_./?=&%+-]+$/.test(text) && !text.startsWith("//")) return text;
  try {
    const url = new URL(text);
    if (["http:", "https:"].includes(url.protocol)) return url.href;
  } catch (_) {}
  return fallback;
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const csrfHeaders = !["GET", "HEAD", "OPTIONS"].includes(method) && state.csrfToken
    ? { "x-csrf-token": state.csrfToken }
    : {};
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...csrfHeaders, ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(englishUiEnabled()
      ? (PASSPORT_API_ERROR_EN[String(payload.code || "")] || `Request failed (HTTP ${response.status})`)
      : (payload.error || `请求失败（HTTP ${response.status}）`));
    error.code = payload.code || "request_failed";
    error.status = response.status;
    error.retryAfter = Number(payload.retryAfter || payload.details?.retryAfter || response.headers.get("retry-after") || 0);
    throw error;
  }
  return payload;
}

function siteName() {
  return String(state.site?.name || "Wikist").trim() || "Wikist";
}

function setStatus(message = "", kind = "") {
  const node = $("#formStatus");
  if (!node) return;
  node.textContent = englishUiEnabled() ? translatePassportText(message) : message;
  node.className = `form-status${kind ? ` ${kind}` : ""}`;
}

function showNotice(title, message, icon = "info", code = "PASSPORT") {
  const localizedTitle = englishUiEnabled() ? translatePassportText(title) : title;
  const localizedMessage = englishUiEnabled() ? translatePassportText(message) : message;
  if (window.Swal?.fire) {
    const style = getComputedStyle(document.documentElement);
    return window.Swal.fire({
      title: localizedTitle,
      text: localizedMessage,
      icon,
      confirmButtonText: englishUiEnabled() ? "OK" : "知道了",
      background: style.getPropertyValue("--panel-solid").trim(),
      color: style.getPropertyValue("--text").trim(),
      confirmButtonColor: style.getPropertyValue("--accent-2").trim(),
      customClass: { popup: "passport-swal", confirmButton: "passport-swal-confirm" },
    });
  }
  $("#noticeCode").textContent = code;
  $("#noticeTitle").textContent = localizedTitle;
  $("#noticeMessage").textContent = localizedMessage;
  if (elements.noticeDialog.showModal) elements.noticeDialog.showModal();
  else elements.noticeDialog.setAttribute("open", "");
  return Promise.resolve();
}

function passwordField(name, label, autocomplete, placeholder = "至少 8 位字符") {
  return `<label class="passport-field"><span>${escapeHtml(label)}</span><span class="password-wrap"><input name="${escapeHtml(name)}" type="password" autocomplete="${escapeHtml(autocomplete)}" minlength="8" maxlength="128" placeholder="${escapeHtml(placeholder)}" required /><button class="password-toggle" type="button" title="显示密码" aria-label="显示密码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg></button></span></label>`;
}

function captchaSlot() {
  return '<div id="captchaMount"></div>';
}

function loginForm() {
  return `<form class="passport-form" id="passportForm" data-mode="login" novalidate>
    <label class="passport-field"><span>用户名或邮箱</span><input name="identifier" autocomplete="username" maxlength="160" placeholder="输入你的统一身份标识" required /></label>
    ${passwordField("password", "密码", "current-password", "输入通行证密码")}
    <details class="two-factor-box" id="twoFactorBox"><summary>使用二次验证码</summary><label class="passport-field"><span>6 位动态验证码</span><input name="twoFactorCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" /></label></details>
    ${captchaSlot()}
    <p class="form-status" id="formStatus"></p>
    <button class="primary-button" type="submit">验证身份并登录</button>
    <div class="form-links"><button type="button" data-navigate="forgot">忘记密码？</button><span>还没有通行证？ <button type="button" data-navigate="register">创建账号</button></span></div>
  </form>`;
}

function registerForm() {
  const setupLabel = state.setup ? "创建首位管理员" : "创建知识通行证";
  return `<form class="passport-form" id="passportForm" data-mode="register" novalidate>
    <div class="field-grid">
      <label class="passport-field"><span>用户名</span><input name="username" autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" placeholder="wikist_user" required /><small class="field-hint" id="usernameHint">3-32 位字母、数字、下划线或连字符</small></label>
      <label class="passport-field"><span>显示名称</span><input name="displayName" autocomplete="nickname" maxlength="80" placeholder="你的公开知识署名" required /><small class="field-hint">将显示在贡献、审阅与讨论记录中</small></label>
    </div>
    <label class="passport-field"><span>邮箱</span><input name="email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" required /><small class="field-hint" id="emailHint">用于验证身份与找回密码，不会公开展示</small></label>
    ${state.setup ? '<label class="passport-field"><span>服务器安装密钥</span><input name="bootstrapSecret" type="password" autocomplete="one-time-code" maxlength="128" placeholder="启动日志中显示的一次性密钥" required /><small class="field-hint">该密钥只用于确认你拥有服务器控制权</small></label>' : ""}
    <div class="field-grid">
      <div>${passwordField("password", "密码", "new-password")}<div class="password-meter" id="passwordMeter" data-score="0" aria-label="密码强度"><i></i><i></i><i></i><i></i></div></div>
      ${passwordField("confirmPassword", "确认密码", "new-password", "再次输入密码")}
    </div>
    ${captchaSlot()}
    <p class="form-status" id="formStatus"></p>
    <button class="primary-button" type="submit">${setupLabel}</button>
    ${state.setup ? "" : '<div class="form-links"><span>已有通行证？ <button type="button" data-navigate="login">返回登录</button></span></div>'}
  </form>`;
}

function forgotForm() {
  return `<form class="passport-form" id="passportForm" data-mode="forgot" novalidate>
    <label class="passport-field"><span>用户名或邮箱</span><input name="identifier" autocomplete="username" maxlength="160" placeholder="输入已绑定邮箱的账号" required /><small class="field-hint">若账号存在，将发送密码重置链接</small></label>
    ${captchaSlot()}
    <p class="form-status" id="formStatus"></p>
    <button class="primary-button" type="submit">发送密码重置邮件</button>
    <div class="form-links"><button type="button" data-navigate="login">返回登录</button><button type="button" data-navigate="register">创建新账号</button></div>
  </form>`;
}

function resetForm() {
  return `<form class="passport-form" id="passportForm" data-mode="reset" novalidate>
    ${passwordField("newPassword", "新密码", "new-password")}
    ${passwordField("confirmPassword", "确认新密码", "new-password", "再次输入新密码")}
    <p class="form-status" id="formStatus"></p>
    <button class="primary-button" type="submit">更新密码并注销旧会话</button>
    <div class="form-links"><button type="button" data-navigate="login">返回登录</button></div>
  </form>`;
}

function resultPanel(code, title, message, actionLabel = "返回登录", actionMode = "login") {
  return `<section class="result-panel"><span class="result-code">${escapeHtml(code)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><button class="primary-button" type="button" data-navigate="${escapeHtml(actionMode)}">${escapeHtml(actionLabel)}</button></section>`;
}

class PassportCaptcha {
  constructor(root) {
    this.root = root;
    this.type = "blockPuzzle";
    this.data = null;
    this.verification = "";
    this.points = [];
    this.dragRatio = 0;
    this.imageWidth = 310;
    this.imageHeight = 155;
    this.pieceWidth = 47;
    this.busy = false;
    this.requestId = 0;
    this.render();
    this.bind();
    this.ready = this.load();
  }

  render() {
    this.root.innerHTML = `<section class="captcha-shell" aria-label="人机验证">
      <header class="captcha-heading"><strong>人机验证</strong><button class="captcha-refresh" type="button">刷新</button></header>
      <div class="captcha-method-indicator" aria-live="polite"><span>系统随机验证</span><strong class="captcha-method">准备中</strong></div>
      <div class="captcha-body">
        <div class="captcha-image-wrap"><img class="captcha-background" alt="验证码背景" draggable="false" /><img class="captcha-piece" alt="拼图滑块" draggable="false" /><div class="captcha-click-layer" role="application" aria-label="按提示顺序点选图中文字"></div><div class="captcha-loading">正在生成安全验证…</div></div>
        <div class="captcha-instruction"><span class="captcha-prompt">拖动滑块完成拼图</span><span class="captcha-words"></span><button class="captcha-undo" type="button" hidden>撤销一点</button></div>
        <div class="captcha-slider"><span class="captcha-slider-fill"></span><span class="captcha-slider-label">按住滑块向右拖动</span><button class="captcha-slider-knob" type="button" role="slider" aria-label="拼图滑块" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">›</button></div>
        <p class="captcha-state">完成验证后继续提交。</p>
      </div>
    </section>`;
    this.shell = $(".captcha-shell", this.root);
    this.background = $(".captcha-background", this.root);
    this.piece = $(".captcha-piece", this.root);
    this.clickLayer = $(".captcha-click-layer", this.root);
    this.loading = $(".captcha-loading", this.root);
    this.prompt = $(".captcha-prompt", this.root);
    this.words = $(".captcha-words", this.root);
    this.undo = $(".captcha-undo", this.root);
    this.slider = $(".captcha-slider", this.root);
    this.sliderFill = $(".captcha-slider-fill", this.root);
    this.sliderLabel = $(".captcha-slider-label", this.root);
    this.knob = $(".captcha-slider-knob", this.root);
    this.stateNode = $(".captcha-state", this.root);
    this.method = $(".captcha-method", this.root);
  }

  bind() {
    $(".captcha-refresh", this.root).addEventListener("click", () => { this.ready = this.load(); });
    this.undo.addEventListener("click", () => {
      if (this.busy || this.verification) return;
      this.points.pop();
      this.renderMarkers();
    });
    this.clickLayer.addEventListener("click", (event) => this.addClickPoint(event));

    let dragging = false;
    let startClientX = 0;
    let startRatio = 0;
    this.knob.addEventListener("pointerdown", (event) => {
      if (this.busy || this.verification || this.type !== "blockPuzzle") return;
      dragging = true;
      startClientX = event.clientX;
      startRatio = this.dragRatio;
      this.knob.setPointerCapture(event.pointerId);
    });
    this.knob.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const max = Math.max(1, this.slider.clientWidth - this.knob.offsetWidth);
      this.setDragRatio(startRatio + (event.clientX - startClientX) / max);
    });
    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      try { this.knob.releasePointerCapture(event.pointerId); } catch (_) {}
      this.verifyBlock();
    };
    this.knob.addEventListener("pointerup", finishDrag);
    this.knob.addEventListener("pointercancel", finishDrag);
    this.knob.addEventListener("keydown", (event) => {
      if (this.busy || this.verification || this.type !== "blockPuzzle") return;
      if (["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) event.preventDefault();
      if (event.key === "ArrowLeft") this.setDragRatio(this.dragRatio - .02);
      if (event.key === "ArrowRight") this.setDragRatio(this.dragRatio + .02);
      if (event.key === "Home") this.setDragRatio(0);
      if (event.key === "End") this.setDragRatio(1);
      if (event.key === "Enter" || event.key === " ") this.verifyBlock();
    });
    this.resizeObserver = new ResizeObserver(() => this.setDragRatio(this.dragRatio));
    this.resizeObserver.observe(this.slider);
  }

  async load() {
    const requestId = ++this.requestId;
    this.busy = true;
    this.data = null;
    this.verification = "";
    this.points = [];
    this.dragRatio = 0;
    this.shell.classList.remove("success", "error");
    this.loading.hidden = false;
    this.loading.textContent = "正在生成安全验证…";
    this.background.removeAttribute("src");
    this.piece.removeAttribute("src");
    this.renderMode();
    this.setState("请在 5 分钟内完成验证。", "");
    try {
      const data = await api("/api/passport/captcha/behavior");
      if (requestId !== this.requestId) return;
      this.data = data;
      this.type = data.type === "clickWord" ? "clickWord" : "blockPuzzle";
      this.renderMode();
      this.imageWidth = Math.max(1, Number(data.imageWidth) || 310);
      this.imageHeight = Math.max(1, Number(data.imageHeight) || 155);
      this.pieceWidth = Math.max(1, Number(data.pieceWidth) || 47);
      const imageTasks = [this.loadImage(this.background, `data:image/png;base64,${data.originalImageBase64}`)];
      if (this.type === "blockPuzzle") {
        imageTasks.push(this.loadImage(this.piece, `data:image/png;base64,${data.jigsawImageBase64}`));
      }
      await Promise.all(imageTasks);
      if (requestId !== this.requestId) return;
      this.words.textContent = this.type === "clickWord" ? (data.wordList || []).join(" → ") : "";
      this.loading.hidden = true;
      this.busy = false;
      this.renderMode();
      this.setDragRatio(0);
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.busy = false;
      this.loading.textContent = error.message;
      this.setState(error.message, "error");
    }
  }

  async loadImage(image, source) {
    image.src = source;
    if (typeof image.decode === "function") {
      await image.decode();
      return;
    }
    if (image.complete && image.naturalWidth > 0) return;
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("验证码图像加载失败，请刷新后重试。")), { once: true });
    });
  }

  renderMode() {
    const click = this.type === "clickWord";
    this.method.textContent = click ? "按序点选" : "滑块拼图";
    this.piece.hidden = click;
    this.clickLayer.hidden = !click;
    this.slider.hidden = click;
    this.undo.hidden = !click || this.points.length === 0;
    this.words.hidden = !click;
    this.prompt.textContent = click ? "请按以下顺序点选" : "拖动滑块完成拼图";
    this.renderMarkers();
  }

  setDragRatio(value) {
    this.dragRatio = Math.max(0, Math.min(1, Number(value) || 0));
    const max = Math.max(0, this.slider.clientWidth - this.knob.offsetWidth);
    const pixels = this.dragRatio * max;
    const travelWidth = Math.max(0, this.imageWidth - this.pieceWidth);
    this.knob.style.transform = `translateX(${pixels}px)`;
    this.sliderFill.style.width = `${pixels + this.knob.offsetWidth / 2}px`;
    this.piece.style.width = `${this.pieceWidth / this.imageWidth * 100}%`;
    this.piece.style.left = `${this.dragRatio * travelWidth / this.imageWidth * 100}%`;
    this.knob.setAttribute("aria-valuenow", String(Math.round(this.dragRatio * 100)));
  }

  verifyBlock() {
    if (this.busy || this.verification || !this.data || this.type !== "blockPuzzle") return;
    this.check({ x: Math.round(this.dragRatio * Math.max(0, this.imageWidth - this.pieceWidth)), y: 5 });
  }

  addClickPoint(event) {
    if (this.busy || this.verification || !this.data || this.type !== "clickWord") return;
    const targetCount = Array.isArray(this.data.wordList) ? this.data.wordList.length : 3;
    if (this.points.length >= targetCount) return;
    const rect = this.background.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.points.push({
      x: Math.round(Math.max(0, Math.min(this.imageWidth, (event.clientX - rect.left) / rect.width * this.imageWidth))),
      y: Math.round(Math.max(0, Math.min(this.imageHeight, (event.clientY - rect.top) / rect.height * this.imageHeight))),
    });
    this.renderMarkers();
    if (this.points.length === targetCount) this.check(this.points);
  }

  renderMarkers() {
    $$(".captcha-marker", this.clickLayer).forEach((node) => node.remove());
    this.points.forEach((point, index) => {
      const marker = document.createElement("span");
      marker.className = "captcha-marker";
      marker.textContent = String(index + 1);
      marker.style.left = `${point.x / this.imageWidth * 100}%`;
      marker.style.top = `${point.y / this.imageHeight * 100}%`;
      this.clickLayer.appendChild(marker);
    });
    this.undo.hidden = this.type !== "clickWord" || this.points.length === 0 || this.busy || Boolean(this.verification);
  }

  async check(point) {
    this.busy = true;
    this.setState("正在校验行为轨迹…", "");
    try {
      const result = await api("/api/passport/captcha/behavior/check", {
        method: "POST",
        body: JSON.stringify({ type: this.type, token: this.data.token, point }),
      });
      this.verification = result.captchaVerification;
      this.shell.classList.add("success");
      this.sliderLabel.textContent = "验证通过";
      this.setState("验证通过，可提交当前表单。", "success");
    } catch (error) {
      this.shell.classList.add("error");
      this.setState(error.message, "error");
      setTimeout(() => { this.ready = this.load(); }, 850);
    } finally {
      this.busy = false;
      this.renderMarkers();
    }
  }

  setState(message, kind) {
    this.stateNode.textContent = message;
    this.stateNode.className = `captcha-state${kind ? ` ${kind}` : ""}`;
  }

  requireVerification() {
    if (!this.verification) throw new Error(this.busy ? "人机验证仍在处理中，请稍候。" : "请先完成人机验证。");
    return this.verification;
  }

  destroy() {
    this.requestId += 1;
    this.resizeObserver?.disconnect();
  }
}

function bindPasswordControls() {
  $$(".password-toggle", elements.formMount).forEach((button) => button.addEventListener("click", () => {
    const input = $("input", button.parentElement);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.title = visible ? "显示密码" : "隐藏密码";
    button.setAttribute("aria-label", button.title);
  }));
  const password = $('[name="password"]', elements.formMount);
  const meter = $("#passwordMeter", elements.formMount);
  if (password && meter) password.addEventListener("input", () => {
    const value = password.value;
    let score = 0;
    if (value.length >= 8) score += 1;
    if (value.length >= 12) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
    meter.dataset.score = String(score);
  });
}

function bindAvailability() {
  const username = $('[name="username"]', elements.formMount);
  const email = $('[name="email"]', elements.formMount);
  let sequence = 0;
  const check = async (kind, input, hint) => {
    const value = input.value.trim();
    if (!value || !input.checkValidity()) return;
    const current = ++sequence;
    hint.textContent = "正在检查是否可用…";
    hint.className = "field-hint";
    try {
      const result = await api(`/api/passport/availability?${kind}=${encodeURIComponent(value)}`);
      if (current !== sequence) return;
      const available = result[`${kind}Available`] !== false;
      hint.textContent = available ? `${kind === "username" ? "用户名" : "邮箱"}可以使用` : `${kind === "username" ? "用户名" : "邮箱"}已被占用`;
      hint.className = `field-hint ${available ? "good" : "bad"}`;
      input.setAttribute("aria-invalid", available ? "false" : "true");
    } catch (_) {
      hint.textContent = "暂时无法检查，提交时会再次验证";
      hint.className = "field-hint";
    }
  };
  if (username) username.addEventListener("blur", () => check("username", username, $("#usernameHint")));
  if (email) email.addEventListener("blur", () => check("email", email, $("#emailHint")));
}

function bindForm() {
  state.captcha?.destroy();
  state.captcha = null;
  bindPasswordControls();
  bindAvailability();
  $$('[data-navigate]', elements.formMount).forEach((button) => button.addEventListener("click", () => navigate(button.dataset.navigate)));
  const captchaRoot = $("#captchaMount", elements.formMount);
  if (captchaRoot) state.captcha = new PassportCaptcha(captchaRoot);
  const form = $("#passportForm", elements.formMount);
  if (form) form.addEventListener("submit", submitForm);
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = $('button[type="submit"]', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  const mode = form.dataset.mode;
  if (["register", "reset"].includes(mode)) {
    const first = mode === "reset" ? payload.newPassword : payload.password;
    if (first !== payload.confirmPassword) {
      setStatus("两次输入的密码不一致。", "error");
      return;
    }
  }
  try {
    if (state.captcha) payload.captchaVerification = state.captcha.requireVerification();
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }
  button.disabled = true;
  setStatus(mode === "forgot" ? "正在发送安全邮件…" : mode === "reset" ? "正在更新密码…" : "正在建立安全会话…");
  try {
    if (mode === "login") {
      const result = await api("/api/passport/login", { method: "POST", body: JSON.stringify(payload) });
      state.user = result.user;
      state.csrfToken = result.csrfToken || "";
      setStatus("身份验证成功，正在进入账户中心…", "success");
      location.href = safeReturnTarget();
      return;
    }
    if (mode === "register") {
      const result = await api("/api/passport/register", { method: "POST", body: JSON.stringify(payload) });
      state.user = result.user;
      state.csrfToken = result.csrfToken || "";
      const verification = result.verification || {};
      const message = result.initialAdmin
        ? "首位管理员已创建，正在进入后台。"
        : verification.sent
          ? "通行证已创建，验证邮件已经发送到你的邮箱。"
          : "通行证已创建；当前站点未能发送验证邮件，可稍后在账户中心重试。";
      await showNotice("注册成功", message, "success", "IDENTITY CREATED");
      location.href = result.initialAdmin ? "/#/admin/overview" : "/#/account";
      return;
    }
    if (mode === "forgot") {
      await api("/api/passport/password/forgot", { method: "POST", body: JSON.stringify(payload) });
      elements.formMount.innerHTML = resultPanel("RECOVERY REQUESTED", "请检查你的邮箱", "如果账号存在且邮件服务可用，密码重置链接已经发送。", "返回登录", "login");
      bindForm();
      return;
    }
    if (mode === "reset") {
      await api("/api/passport/password/reset", { method: "POST", body: JSON.stringify({ token: state.token, newPassword: payload.newPassword }) });
      await showNotice("密码已更新", "所有旧登录会话均已失效，请使用新密码重新登录。", "success", "PASSWORD UPDATED");
      navigate("login", true);
    }
  } catch (error) {
    if (error.code === "account_disabled") {
      setStatus("", "");
      await showNotice("账号已被封禁", `该 ${siteName()} 通行证已停用，请联系站点管理员。`, "error", "ACCESS DENIED");
    } else if (error.code === "two_factor_required") {
      $("#twoFactorBox")?.setAttribute("open", "");
      $('[name="twoFactorCode"]')?.focus();
      setStatus("请输入验证器中的 6 位动态验证码，然后重新完成人机验证。", "error");
    } else if (error.status === 429) {
      setStatus(error.retryAfter > 0 ? `请求较频繁，请在 ${error.retryAfter} 秒后重试。` : error.message, "error");
    } else {
      setStatus(error.message, "error");
    }
    if (state.captcha) state.captcha.ready = state.captcha.load();
  } finally {
    button.disabled = false;
  }
}

function safeReturnTarget() {
  const value = params.get("returnTo") || "";
  if (/^\/#\/[A-Za-z0-9_%/?=&+.-]*$/.test(value)) return value;
  return "/#/account";
}

function sessionAvatarHtml(user = {}) {
  const label = String(user.displayName || user.username || "W").trim() || "W";
  const avatar = safeAssetUrl(user.avatarUrl, "");
  if (avatar) return `<img class="passport-session-avatar" src="${escapeHtml(avatar)}" alt="" />`;
  return `<span class="passport-session-avatar fallback" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`;
}

function authenticatedSessionPanel() {
  const user = state.user || {};
  const label = user.displayName || user.username || "Wikist 用户";
  const role = user.groupLabel || user.role || "成员";
  return `<section class="passport-session-panel">
    <header class="passport-session-identity">${sessionAvatarHtml(user)}<div><span class="system-kicker">Authenticated Session</span><h3>${escapeHtml(label)}</h3><p>@${escapeHtml(user.username || "user")} · ${escapeHtml(role)}</p></div><span class="passport-session-state">已验证</span></header>
    <p class="passport-session-copy">继续使用当前账号，或退出后切换账号。</p>
    <a class="primary-button passport-session-continue" href="${escapeHtml(safeReturnTarget())}">继续使用当前账号</a>
    <div class="passport-session-actions"><button class="secondary-button" id="sessionSwitchAccount" type="button">退出并切换账号</button><button class="secondary-button session-logout-button" id="sessionLogout" type="button">退出登录</button></div>
  </section>`;
}

async function closeAuthenticatedSession(action = "switch") {
  $$("#sessionSwitchAccount, #sessionLogout", elements.formMount).forEach((button) => { button.disabled = true; });
  try { await api("/api/passport/logout", { method: "POST", body: "{}" }); } catch (_) {}
  state.user = null;
  if (action === "logout") {
    location.assign("/");
    return;
  }
  navigate("login", true);
  setStatus("当前账号已安全退出，请登录其他账号。", "success");
}

function bindAuthenticatedSessionPanel() {
  $("#sessionSwitchAccount")?.addEventListener("click", () => closeAuthenticatedSession("switch"));
  $("#sessionLogout")?.addEventListener("click", () => closeAuthenticatedSession("logout"));
}

function renderSignedIn() {
  if (!state.user) {
    elements.signedIn.hidden = true;
    elements.signedIn.innerHTML = "";
    return;
  }
  const label = state.user.displayName || state.user.username;
  elements.signedIn.hidden = false;
  elements.signedIn.innerHTML = `当前已登录为 <strong>${escapeHtml(label)}</strong>。<a href="/#/account">进入账户中心</a> · <button class="text-button" id="switchAccount" type="button">退出并切换账号</button>`;
  $("#switchAccount")?.addEventListener("click", async () => {
    try { await api("/api/passport/logout", { method: "POST", body: "{}" }); } catch (_) {}
    state.user = null;
    renderSignedIn();
    setStatus("已退出当前账号。", "success");
  });
}

const MODE_COPY = {
  login: ["登录", "验证身份后继续进入知识网络。"],
  register: ["注册", "创建账号并开始记录你的贡献。"],
  forgot: ["找回密码", "通过绑定邮箱恢复你的知识通行证。"],
  reset: ["设置新密码", "更新后请使用新密码登录。"],
  verify: ["验证邮箱", "正在确认验证链接。"],
};

function renderMode() {
  state.captcha?.destroy();
  state.captcha = null;
  const authenticatedEntry = Boolean(state.user && ["login", "register"].includes(state.mode) && !state.setup);
  if (authenticatedEntry) {
    elements.formTitle.textContent = "当前会话";
    elements.formSubtitle.textContent = "继续访问站点，或切换账号。";
    elements.tabs.hidden = true;
    elements.signedIn.hidden = true;
    elements.signedIn.innerHTML = "";
    elements.formMount.innerHTML = authenticatedSessionPanel();
    bindAuthenticatedSessionPanel();
    document.title = `当前会话 - ${siteName()} 通行证`;
    hydratePassportEnglish();
    return;
  }
  const copy = MODE_COPY[state.mode] || MODE_COPY.login;
  elements.formTitle.textContent = state.setup && state.mode === "register" ? "创建首位管理员" : copy[0];
  elements.formSubtitle.textContent = state.setup && state.mode === "register" ? "初始化站点唯一的首位管理身份。" : copy[1];
  elements.tabs.hidden = ["reset", "verify"].includes(state.mode) || state.setup;
  $$('[data-mode]', elements.tabs).forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  elements.formMount.innerHTML = state.mode === "register" ? registerForm()
    : state.mode === "forgot" ? forgotForm()
      : state.mode === "reset" ? resetForm()
        : state.mode === "verify" ? resultPanel("EMAIL VERIFICATION", "正在验证邮箱", "正在检查这条验证链接，请稍候…", "返回登录", "login")
          : loginForm();
  renderSignedIn();
  bindForm();
  document.title = `${elements.formTitle.textContent} - ${siteName()} 通行证`;
  if (state.mode === "verify") verifyEmail();
  hydratePassportEnglish();
}

function navigate(mode, replace = false) {
  if (!VALID_MODES.has(mode)) mode = "login";
  state.mode = mode;
  state.setup = false;
  state.token = mode === "reset" || mode === "verify" ? state.token : "";
  const next = new URL(location.href);
  next.search = "";
  next.searchParams.set("mode", mode);
  if (state.token) next.searchParams.set("token", state.token);
  history[replace ? "replaceState" : "pushState"]({}, "", next);
  renderMode();
}

async function verifyEmail() {
  if (!state.token) {
    elements.formMount.innerHTML = resultPanel("INVALID LINK", "验证链接不完整", "链接中缺少邮箱验证令牌，请重新发送验证邮件。", "返回登录", "login");
    bindForm();
    return;
  }
  try {
    await api("/api/passport/email/verify", { method: "POST", body: JSON.stringify({ token: state.token }) });
    elements.formMount.innerHTML = resultPanel("EMAIL VERIFIED", "邮箱验证成功", "邮箱已验证，可以继续使用账户。", "进入账户中心", "account");
    const button = $('[data-navigate="account"]', elements.formMount);
    if (button) button.addEventListener("click", () => { location.href = "/#/account"; });
  } catch (error) {
    elements.formMount.innerHTML = resultPanel("VERIFICATION FAILED", "邮箱验证失败", error.message, "返回登录", "login");
    bindForm();
  }
}

function applySite() {
  const name = siteName();
  const tagline = String(state.site.tagline || "开放、严谨、可验证的数学知识共同体");
  elements.siteName.textContent = name;
  elements.siteTagline.textContent = tagline;
  elements.siteTagline.dataset.i18nSkip = "true";
  elements.introSiteName.textContent = name;
  elements.intro.textContent = englishUiEnabled()
    ? `Use your ${name} account for pages, collaboration, messages, and review.`
    : `使用 ${name} 账户参与词条、协作、消息与审阅。`;
  elements.footerSiteName.textContent = `${name} Passport`;
  const icon = safeAssetUrl(state.site.siteIcon);
  elements.brandIcon.src = icon;
  elements.favicon.href = icon;
}

function applyScene() {
  const scene = localStorage.getItem("wikist-passport-scene") || "1";
  const custom = localStorage.getItem("wikist-passport-custom-scene") || "";
  const image = scene === "custom" && custom ? safeAssetUrl(custom, "/passport/assets/themes/1.jpg") : `/passport/assets/themes/${SCENES.some(([id]) => id === scene) ? scene : "1"}.jpg`;
  document.documentElement.style.setProperty("--scene-image", `url(${JSON.stringify(image)})`);
  const accent = localStorage.getItem("wikist-passport-accent") || "";
  if (/^#[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty("--accent", accent);
  $$(".scene-option", elements.sceneGrid).forEach((button) => button.classList.toggle("active", button.dataset.scene === scene));
}

function setupScenes() {
  elements.sceneGrid.innerHTML = SCENES.map(([id, label]) => `<button class="scene-option" type="button" data-scene="${id}" aria-label="选择${escapeHtml(label)}"><img src="/passport/assets/themes/${id}.jpg" alt="" loading="lazy" /></button>`).join("");
  $$(".scene-option", elements.sceneGrid).forEach((button) => button.addEventListener("click", () => {
    localStorage.setItem("wikist-passport-scene", button.dataset.scene);
    applyScene();
  }));
  elements.sceneButton.addEventListener("click", () => {
    elements.customSceneUrl.value = localStorage.getItem("wikist-passport-custom-scene") || "";
    elements.customAccent.value = localStorage.getItem("wikist-passport-accent") || "#38e8ff";
    if (elements.sceneDialog.showModal) elements.sceneDialog.showModal();
    else elements.sceneDialog.setAttribute("open", "");
  });
  $("#applyCustomScene").addEventListener("click", () => {
    const url = safeAssetUrl(elements.customSceneUrl.value, "");
    if (!url) {
      showNotice("背景地址无效", "请输入 HTTPS 图片地址或本站绝对路径。", "warning", "SCENE INVALID");
      return;
    }
    localStorage.setItem("wikist-passport-custom-scene", url);
    localStorage.setItem("wikist-passport-accent", elements.customAccent.value);
    localStorage.setItem("wikist-passport-scene", "custom");
    applyScene();
    elements.sceneDialog.close?.();
  });
  applyScene();
}

function setupTheme() {
  elements.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("wikist-theme", next);
    document.querySelector('meta[name="theme-color"]').content = next === "light" ? "#eef7f4" : "#07100f";
  });
}

async function bootstrap() {
  setupTheme();
  setupScenes();
  $$('[data-mode]', elements.tabs).forEach((button) => button.addEventListener("click", () => navigate(button.dataset.mode)));
  window.addEventListener("popstate", () => {
    const next = new URLSearchParams(location.search);
    state.mode = VALID_MODES.has(next.get("mode")) ? next.get("mode") : "login";
    state.token = next.get("token") || "";
    renderMode();
  });
  const [site, session] = await Promise.all([
    api("/api/site").catch(() => state.site),
    api("/api/passport/me").catch(() => ({ user: null })),
  ]);
  state.site = site || state.site;
  state.user = session?.user || null;
  state.csrfToken = session?.csrfToken || "";
  if (state.site?.setup?.needsAdmin && !["reset", "verify"].includes(state.mode)) {
    state.mode = "register";
    state.setup = true;
    const next = new URL(location.href);
    next.search = "?mode=register&setup=1";
    history.replaceState({}, "", next);
  }
  applySite();
  renderMode();
  hydratePassportEnglish();
}

bootstrap().catch((error) => {
  elements.formMount.innerHTML = resultPanel("PASSPORT OFFLINE", "通行证暂时不可用", error.message, "返回 Wiki", "home");
  const button = $('[data-navigate="home"]', elements.formMount);
  if (button) button.addEventListener("click", () => { location.href = "/"; });
});
