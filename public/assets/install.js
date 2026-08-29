const form = document.querySelector("#installForm");
const statusNode = document.querySelector("#formStatus");
const stateNode = document.querySelector("#installState");
const noteNode = document.querySelector("#installNote");
const installButton = document.querySelector("#installButton");
const mailEnabled = document.querySelector("#mailEnabled");
const mailFields = document.querySelector("#mailFields");
const publicUrl = document.querySelector("#publicUrl");
const deploymentMode = document.querySelector("#deploymentMode");
const deploymentPreview = document.querySelector("#deploymentPreview");
const publicOriginConfirmation = document.querySelector("#publicOriginConfirmation");
const uninstallPanel = document.querySelector("#uninstallPanel");
const uninstallConfirm = document.querySelector("#uninstallConfirm");
const uninstallButton = document.querySelector("#uninstallButton");
const uninstallStatus = document.querySelector("#uninstallStatus");
const bootstrapSecret = document.querySelector('[name="bootstrapSecret"]');
let installFirewallToken = "";

const INSTALL_EN = [
  ["安装 Wikist", "Install Wikist"], ["建立你的", "Build your"], ["知识共同体。", "knowledge community."],
  ["填写站点、数据和邮件设置后完成安装。", "Complete installation by configuring your site, data, and email."],
  ["站点身份与语言", "Site identity and language"], ["SQLite 数据路径", "SQLite data path"], ["通行证与 SMTP", "Passport and SMTP"],
  ["Wikist 初始配置", "Initial Wikist configuration"], ["正在检测", "Checking"], ["正在读取当前安装状态。", "Reading current installation status."],
  ["服务器所有权", "Server ownership"], ["安装密钥", "Installation key"], ["服务器启动时显示的一次性密钥", "One-time key shown when the server starts"],
  ["站点信息", "Site information"], ["站点标题", "Site title"], ["默认语言", "Default language"], ["部署模式", "Deployment mode"], ["单机生产（推荐）", "Single-server production (recommended)"], ["本地开发", "Local development"], ["高级 / 反向代理", "Advanced / reverse proxy"], ["站点公开地址", "Public site address"],
  ["确认使用不同的公开地址", "Confirm a different public address"], ["当前浏览器地址与公开地址不同。请确认域名和 HTTPS 反向代理已经准备完成。", "The public address differs from this browser address. Confirm that the domain and HTTPS reverse proxy are ready."],
  ["站点简介", "Site tagline"], ["许可证", "License"], ["资源 CDN 基址（可选）", "Asset CDN base URL (optional)"], ["站点图标 URL", "Site icon URL"],
  ["数据与协作", "Data and collaboration"], ["SQLite 数据库路径", "SQLite database path"], ["只能使用项目目录内的相对路径，例如 ", "Use a relative path inside the project directory only, for example "], ["会话有效期（天）", "Session duration (days)"], ["公开编辑策略", "Public editing policy"], ["允许编辑", "Allow editing"], ["暂时关闭", "Temporarily closed"],
  ["编辑需要登录", "Require sign-in to edit"], ["开启后，词条编辑只能由 Wikist 通行证用户提交。", "When enabled, only Wikist Passport users can submit page edits."],
  ["邮件与账户安全 ", "Email and account security "], ["可选", "Optional"], ["启用 SMTP 邮件", "Enable SMTP email"], ["用于注册验证和密码找回；未配置时可稍后在后台补充。", "Used for registration verification and password recovery; it can be configured later in Admin."],
  ["SMTP 主机", "SMTP host"], ["SMTP 端口", "SMTP port"], ["SMTP 用户名", "SMTP username"], ["SMTP 密码", "SMTP password"], ["发件人名称", "Sender name"], ["发件人邮箱", "Sender email"], ["使用 SSL/TLS 直连", "Use direct SSL/TLS"], ["常见于 465 端口；587 通常使用 STARTTLS。", "Common for port 465; port 587 usually uses STARTTLS."],
  ["注册后必须验证邮箱", "Require email verification after registration"], ["建议先完成 SMTP 测试再开启。", "Complete an SMTP test before enabling this."],
  ["写入配置并完成安装", "Write configuration and finish installation"], ["返回 Wikist", "Back to Wikist"],
  ["卸载安装配置", "Remove installation configuration"], ["卸载前会备份当前配置；词条、用户和数据库将保留。重启后可重新配置。", "The current configuration is backed up first; pages, users, and the database are retained. You can configure again after restarting."], ["确认词", "Confirmation phrase"], ["卸载配置并生成备份", "Remove configuration and create backup"],
  ["请填写浏览器实际访问的完整站点地址。", "Enter the full address visitors use to access this site."], ["内部服务仅监听服务器回环地址", "internal services listen only on the server loopback address"],
  ["请求失败（HTTP ", "Request failed (HTTP "], ["维护重配模式", "Maintenance reconfiguration mode"], ["可开始安装", "Ready to install"], ["维护模式已开启。提交后将更新站点配置并保留现有数据。", "Maintenance mode is enabled. Submitting updates the site configuration while retaining existing data."], ["写入配置后，请重启 Wikist 服务。", "Restart the Wikist service after writing configuration."],
  ["已完成配置", "Configuration complete"], ["站点已完成配置。如需重配，请设置 WIKIST_INSTALL_MODE=1 后重启服务。", "The site is configured. To reconfigure, set WIKIST_INSTALL_MODE=1 and restart the service."], ["连接失败", "Connection failed"], ["无法连接到 Wikist 安装接口。请确认服务已经启动。", "Cannot connect to the Wikist installation endpoint. Confirm the service is running."],
  ["正在写入配置...", "Writing configuration..."], ["配置已写入", "Configuration written"], ["已启用", "Enabled"], ["开发模式", "Development mode"], ["请输入确认词 UNINSTALL_CONFIG。", "Enter the confirmation phrase UNINSTALL_CONFIG."], ["正在卸载安装配置...", "Removing installation configuration..."], ["配置已卸载，等待重启", "Configuration removed; waiting for restart"], ["请重启服务后继续安装或恢复配置。", "Restart the service to continue installation or restore configuration."],
  ["正式地址：", "Public address: "], ["实时地址：", "Realtime address: "], ["安全 Cookie：", "Secure cookie: "], ["站点：", "Site: "], ["实时通信：", "Realtime: "], ["配置已备份至", "Configuration backed up to"], ["重启后可重新安装，现有数据已保留。", "Restart to install again; existing data has been retained."],
];
const INSTALL_EN_MAP = new Map(INSTALL_EN);

function installEnglishEnabled() {
  try { return localStorage.getItem("wikist-language") === "en"; } catch (_) { return false; }
}

function translateInstallText(value) {
  const original = String(value || "");
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  const text = original.trim();
  const exact = INSTALL_EN_MAP.get(text);
  if (exact) return `${leading}${exact}${trailing}`;
  const completed = text.match(/^(.+?) 已完成配置，请重启 Wikist 服务。$/);
  if (completed) return `${leading}${completed[1]} is configured. Restart the Wikist service.${trailing}`;
  const preview = text.match(/^站点：(.+?) · 实时通信：(.+?) · 内部服务仅监听服务器回环地址$/);
  if (preview) return `${leading}Site: ${preview[1]} · Realtime: ${preview[2]} · internal services listen only on the server loopback address${trailing}`;
  const status = text.match(/^正式地址：(.+?) · 实时地址：(.+?) · 安全 Cookie：(已启用|开发模式)$/);
  if (status) return `${leading}Public address: ${status[1]} · Realtime address: ${status[2]} · Secure cookie: ${status[3] === "已启用" ? "Enabled" : "Development mode"}${trailing}`;
  const backup = text.match(/^配置已备份至\s*(.+?)。重启后可重新安装，现有数据已保留。$/);
  if (backup) return `${leading}Configuration backed up to ${backup[1]}. Restart to install again; existing data has been retained.${trailing}`;
  return original;
}

function hydrateInstallEnglish(root = document.body) {
  if (!installEnglishEnabled()) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return !parent || !node.nodeValue.trim() || parent.closest("script,style,textarea,code,pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!node._wikistOriginalText) node._wikistOriginalText = node.nodeValue;
    node.nodeValue = translateInstallText(node._wikistOriginalText);
  });
  root.querySelectorAll("*").forEach((element) => ["placeholder", "title", "aria-label"].forEach((name) => {
    const value = element.getAttribute(name);
    if (value === null) return;
    const key = `_wikistOriginal${name[0].toUpperCase()}${name.slice(1)}`;
    if (!(key in element)) element[key] = value;
    const translated = translateInstallText(element[key]);
    if (translated !== element[key]) element.setAttribute(name, translated);
  }));
  document.documentElement.lang = "en";
}

function setStatus(text, tone = "") {
  statusNode.textContent = installEnglishEnabled() ? translateInstallText(text) : text;
  statusNode.className = `form-status ${tone}`.trim();
}

function syncMailFields() {
  mailFields.hidden = !mailEnabled.checked;
}

function syncDeploymentPreview() {
  const value = String(publicUrl?.value || "").trim().replace(/\/+$/, "");
  let origin = "";
  try { origin = new URL(value).origin; } catch (_) {}
  if (!deploymentPreview) return;
  if (!origin) {
    deploymentPreview.textContent = "请填写浏览器实际访问的完整站点地址。";
    if (publicOriginConfirmation) {
      publicOriginConfirmation.hidden = true;
      const confirmation = publicOriginConfirmation.querySelector("input");
      if (confirmation) {
        confirmation.required = false;
        confirmation.checked = false;
      }
    }
    return;
  }
  const realtime = origin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/connection/websocket";
  deploymentPreview.textContent = `站点：${origin} · 实时通信：${realtime} · 内部服务仅监听服务器回环地址`;
  const differs = origin !== window.location.origin;
  if (publicOriginConfirmation) {
    publicOriginConfirmation.hidden = !differs;
    const confirmation = publicOriginConfirmation.querySelector("input");
    if (confirmation) {
      confirmation.required = differs;
      if (!differs) confirmation.checked = false;
    }
  }
}

async function request(url, options = {}) {
  const installRequest = url === "/api/install" || url === "/api/install/uninstall";
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(installRequest && installFirewallToken ? { "x-wikist-install-token": installFirewallToken } : {}), ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

async function loadStatus() {
  if (uninstallPanel) uninstallPanel.hidden = true;
  try {
    const state = await request("/api/install/status");
    installFirewallToken = state.firewall?.installToken?.token || "";
    if (uninstallPanel) uninstallPanel.hidden = !state.uninstallAllowed;
    if (state.setupAllowed) {
      stateNode.textContent = state.forceMode ? "维护重配模式" : "可开始安装";
      stateNode.className = "install-status ready";
      noteNode.textContent = state.forceMode
        ? "维护模式已开启。提交后将更新站点配置并保留现有数据。"
        : "写入配置后，请重启 Wikist 服务。";
      installButton.disabled = false;
    } else {
      stateNode.textContent = "已完成配置";
      stateNode.className = "install-status locked";
      noteNode.textContent = "站点已完成配置。如需重配，请设置 WIKIST_INSTALL_MODE=1 后重启服务。";
      installButton.disabled = true;
      form.querySelectorAll("input, textarea, select").forEach((control) => { control.disabled = true; });
    }
  } catch (error) {
    stateNode.textContent = "连接失败";
    stateNode.className = "install-status locked";
    noteNode.textContent = "无法连接到 Wikist 安装接口。请确认服务已经启动。";
    installButton.disabled = true;
    setStatus(error.message, "error");
  }
}

mailEnabled.addEventListener("change", syncMailFields);
publicUrl?.addEventListener("input", syncDeploymentPreview);
deploymentMode?.addEventListener("change", syncDeploymentPreview);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  delete values.confirmPublicOrigin;
  values.mailEnabled = mailEnabled.checked;
  values.requireLogin = form.elements.requireLogin.checked;
  values.requireEmailVerification = form.elements.requireEmailVerification.checked;
  values.smtpSecure = form.elements.smtpSecure.checked;
  values.openEditing = form.elements.openEditing.value === "true";
  installButton.disabled = true;
  setStatus("正在写入配置...");
  try {
    const result = await request("/api/install", { method: "POST", body: JSON.stringify(values) });
    stateNode.textContent = "配置已写入";
    stateNode.className = "install-status ready";
    noteNode.textContent = `${result.site.name} 已完成配置，请重启 Wikist 服务。`;
    setStatus(`正式地址：${result.site.publicUrl} · 实时地址：${result.site.realtimeUrl} · 安全 Cookie：${result.site.secureCookie ? "已启用" : "开发模式"}`, "success");
  } catch (error) {
    installButton.disabled = false;
    setStatus(error.message, "error");
  }
});

uninstallButton?.addEventListener("click", async () => {
  const confirm = uninstallConfirm.value.trim();
  uninstallStatus.textContent = "";
  uninstallStatus.className = "form-status";
  if (confirm !== "UNINSTALL_CONFIG") {
    uninstallStatus.textContent = "请输入确认词 UNINSTALL_CONFIG。";
    uninstallStatus.classList.add("error");
    return;
  }
  uninstallButton.disabled = true;
  uninstallStatus.textContent = "正在卸载安装配置...";
  try {
    const result = await request("/api/install/uninstall", {
      method: "POST",
      body: JSON.stringify({ confirm, bootstrapSecret: bootstrapSecret?.value || "" }),
    });
    uninstallStatus.textContent = `配置已备份至 ${result.backupPath}。重启后可重新安装，现有数据已保留。`;
    uninstallStatus.classList.add("success");
    stateNode.textContent = "配置已卸载，等待重启";
    stateNode.className = "install-status ready";
    noteNode.textContent = "请重启服务后继续安装或恢复配置。";
    form.querySelectorAll("input, textarea, select, button").forEach((control) => { control.disabled = true; });
  } catch (error) {
    uninstallButton.disabled = false;
    uninstallStatus.textContent = error.message;
    uninstallStatus.classList.add("error");
  }
});

publicUrl.value = window.location.origin;
deploymentMode.value = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) ? "development" : "single-production";
syncDeploymentPreview();
syncMailFields();
hydrateInstallEnglish();
loadStatus();
