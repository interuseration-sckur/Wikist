function mailSettings(config = {}) {
  const source = config.mail && typeof config.mail === "object" ? config.mail : {};
  const smtp = source.smtp && typeof source.smtp === "object" ? source.smtp : {};
  return {
    enabled: source.enabled === true,
    host: String(smtp.host || "").trim(),
    port: Math.max(1, Math.min(Number(smtp.port) || 587, 65535)),
    secure: smtp.secure === true,
    user: String(smtp.user || "").trim(),
    pass: String(smtp.pass || ""),
    fromName: String(source.fromName || config.name || "Wikist").trim() || "Wikist",
    fromAddress: String(source.fromAddress || smtp.user || "").trim(),
    baseUrl: String(source.baseUrl || "").trim(),
  };
}

function publicMailSettings(config = {}) {
  const settings = mailSettings(config);
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    user: settings.user,
    fromName: settings.fromName,
    fromAddress: settings.fromAddress,
    baseUrl: settings.baseUrl,
    configured: settings.enabled && Boolean(settings.host && settings.fromAddress),
  };
}

function mailerTransport(settings) {
  if (!settings.enabled) throw new Error("邮件系统尚未启用。");
  if (!settings.host || !settings.fromAddress) throw new Error("SMTP 主机和发件地址不能为空。");
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (_error) {
    throw new Error("缺少 nodemailer 依赖，请先安装后再发送邮件。");
  }
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user || settings.pass ? { user: settings.user, pass: settings.pass } : undefined,
  });
}

async function sendWikistMail(config, message) {
  const settings = mailSettings(config);
  const transport = mailerTransport(settings);
  const from = settings.fromName
    ? `"${settings.fromName.replace(/"/g, "")}" <${settings.fromAddress}>`
    : settings.fromAddress;
  const info = await transport.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { ok: true, messageId: info.messageId || "" };
}

function siteBaseUrl(config, req) {
  const configured = mailSettings(config).baseUrl;
  if (configured) return configured.replace(/\/+$/, "");
  const proto = req?.headers?.["x-forwarded-proto"] || "http";
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host || "127.0.0.1:8899";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

module.exports = {
  mailSettings,
  publicMailSettings,
  sendWikistMail,
  siteBaseUrl,
};
