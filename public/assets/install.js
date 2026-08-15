const form = document.querySelector("#installForm");
const statusNode = document.querySelector("#formStatus");
const stateNode = document.querySelector("#installState");
const noteNode = document.querySelector("#installNote");
const installButton = document.querySelector("#installButton");
const mailEnabled = document.querySelector("#mailEnabled");
const mailFields = document.querySelector("#mailFields");
const baseUrl = document.querySelector("#baseUrl");
const uninstallPanel = document.querySelector("#uninstallPanel");
const uninstallConfirm = document.querySelector("#uninstallConfirm");
const uninstallButton = document.querySelector("#uninstallButton");
const uninstallStatus = document.querySelector("#uninstallStatus");
let installFirewallToken = "";

function setStatus(text, tone = "") {
  statusNode.textContent = text;
  statusNode.className = `form-status ${tone}`.trim();
}

function syncMailFields() {
  mailFields.hidden = !mailEnabled.checked;
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
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
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
    setStatus("重启后可创建管理员账号并进入站点。", "success");
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
      body: JSON.stringify({ confirm }),
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

baseUrl.value = window.location.origin;
syncMailFields();
loadStatus();
