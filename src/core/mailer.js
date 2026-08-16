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
    baseUrl: String(source.baseUrl || config.publicUrl || "").trim(),
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

function addressIsPublic(address) {
  const mapped = String(address || "").match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return addressIsPublic(mapped[1]);
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    return !(octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || octets[0] >= 224);
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value));
  }
  return false;
}

async function resolveSmtpTarget(settings) {
  const allowedPorts = String(process.env.SMTP_ALLOWED_PORTS || "25,465,587,2525")
    .split(",").map(Number).filter(Number.isInteger);
  if (!allowedPorts.includes(Number(settings.port))) throw new Error("SMTP 端口未被服务器策略允许。");
  if (!settings.host || settings.host.includes("://") || /[^A-Za-z0-9._:\-]/.test(settings.host)) throw new Error("SMTP 主机格式无效。");
  const addresses = net.isIP(settings.host)
    ? [{ address: settings.host }]
    : await dns.promises.lookup(settings.host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("SMTP 主机无法解析。");
  const allowPrivate = /^(?:1|true|yes|on)$/i.test(String(process.env.SMTP_ALLOW_PRIVATE_HOSTS || "false"));
  if (!allowPrivate && addresses.some((item) => !addressIsPublic(item.address))) {
    throw new Error("SMTP 主机指向内网或保留地址，服务器策略已拒绝。");
  }
  return addresses[0].address;
}

function mailerTransport(settings, targetHost) {
  if (!settings.enabled) throw new Error("邮件系统尚未启用。");
  if (!settings.host || !settings.fromAddress) throw new Error("SMTP 主机和发件地址不能为空。");
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (_error) {
    throw new Error("缺少 nodemailer 依赖，请先安装后再发送邮件。");
  }
  return nodemailer.createTransport({
    host: targetHost,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user || settings.pass ? { user: settings.user, pass: settings.pass } : undefined,
    tls: { rejectUnauthorized: true, servername: net.isIP(settings.host) ? undefined : settings.host },
  });
}

async function sendWikistMail(config, message) {
  const settings = mailSettings(config);
  const targetHost = await resolveSmtpTarget(settings);
  const transport = mailerTransport(settings, targetHost);
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
  if (configured) {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("邮件公开地址配置无效。");
    if (/^(?:production|prod)$/i.test(String(process.env.NODE_ENV || process.env.APP_ENV || "")) && parsed.protocol !== "https:") {
      throw new Error("生产环境邮件链接必须使用 HTTPS。");
    }
    return parsed.href.replace(/\/+$/, "");
  }
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
const dns = require("dns");
const net = require("net");
