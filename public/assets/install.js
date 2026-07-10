const form = document.querySelector("#installForm");
const statusNode = document.querySelector("#formStatus");
const stateNode = document.querySelector("#installState");
const noteNode = document.querySelector("#installNote");
const installButton = document.querySelector("#installButton");
const mailEnabled = document.querySelector("#mailEnabled");
const mailFields = document.querySelector("#mailFields");
const baseUrl = document.querySelector("#baseUrl");

function setStatus(text, tone = "") {
  statusNode.textContent = text;
  statusNode.className = `form-status ${tone}`.trim();
}

function syncMailFields() {
  mailFields.hidden = !mailEnabled.checked;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

async function loadStatus() {
  try {
    const state = await request("/api/install/status");
    if (state.setupAllowed) {
      stateNode.textContent = state.forceMode ? "维护重配模式" : "可开始安装";
      stateNode.className = "install-status ready";
      noteNode.textContent = state.forceMode
        ? "维护模式已开启。提交后将覆盖基础站点配置，原有 SQLite 数据不会自动删除。"
        : "配置写入后请重启 Wikist 服务，新的数据库与站点参数才会被加载。";
      installButton.disabled = false;
    } else {
      stateNode.textContent = "已完成配置";
      stateNode.className = "install-status locked";
      noteNode.textContent = "当前站点已经配置完成。为保护现有用户与词条数据，安装器处于只读状态。需要重配时，请设置 WIKIST_INSTALL_MODE=1 后重启服务。";
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
    noteNode.textContent = `已生成 ${result.site.name} 的配置，数据库路径为 ${result.site.database}。请停止并重新启动 Wikist 服务。`;
    setStatus("安装配置已完成。重启服务后，访问首页即可继续创建管理员账号和词条。", "success");
  } catch (error) {
    installButton.disabled = false;
    setStatus(error.message, "error");
  }
});

baseUrl.value = window.location.origin;
syncMailFields();
loadStatus();