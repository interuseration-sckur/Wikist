const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeSlug } = require("./slug");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (_error) {
  DatabaseSync = null;
}

const COOKIE_NAME = "wikist_passport";
const GUEST_COOKIE_NAME = "wikist_guest";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const PROFILE_PAGE_MAX_LENGTH = 20000;
const COMMENT_MAX_LENGTH = 8000;
const MESSAGE_TITLE_MAX_LENGTH = 140;
const MESSAGE_BODY_MAX_LENGTH = 5000;
const BIO_MAX_LENGTH = 500;
const SOCIAL_LINK_KEYS = ["website", "blog", "github", "zhihu", "bilibili", "x", "mastodon"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_TOKEN_TTL_SECONDS = 30 * 60;
const PASSWORD_RESET_TTL_SECONDS = 20 * 60;
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const USER_GROUPS = ["member", "creator", "editor", "senior_editor", "admin"];
const GROUP_RANK = Object.fromEntries(USER_GROUPS.map((role, index) => [role, index]));
const DEFAULT_TRANSLATION_LANGUAGES = ["zh-CN", "zh-TW", "en"];
const GROUP_LABELS = {
  member: "\u666e\u901a\u7528\u6237",
  creator: "\u521b\u4f5c\u8005",
  editor: "\u7f16\u8f91",
  senior_editor: "\u8d44\u6df1\u7f16\u8f91",
  admin: "\u7ba1\u7406\u5458",
};
const DEFAULT_PERMISSIONS = {
  editPolicy: "guest",
  commentPolicy: "guest",
  deletePolicy: "user",
};
const WATCH_TARGET_TYPES = ["page", "category", "language"];

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(token, maxAgeSeconds) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function guestCookie(guestId) {
  return [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(guestId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=31536000",
  ].join("; ");
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)) % (10 ** TOTP_DIGITS);
  return String(code).padStart(TOTP_DIGITS, "0");
}

function verifyTotp(secret, code, windowSize = 1) {
  const input = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(input)) return false;
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -windowSize; offset <= windowSize; offset += 1) {
    if (timingSafeStringEqual(hotp(secret, counter + offset), input)) return true;
  }
  return false;
}

function requireSqlite() {
  if (!DatabaseSync) {
    throw new Error("Wikist Passport 需要支持 node:sqlite 的 Node.js 运行时。");
  }
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value || null;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return fallback;
  }
}

function jsonText(value) {
  return JSON.stringify(value || {});
}

function cleanUrl(value, maxLength = 500) {
  const url = cleanText(value, maxLength);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
    throw new Error("\u5934\u50cf\u5730\u5740\u5fc5\u987b\u662f http(s) \u6216 data:image\u3002");
  }
  return url;
}

function cleanExternalUrl(value, maxLength = 500) {
  const url = cleanText(value, maxLength);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) throw new Error("外部资料链接必须以 http:// 或 https:// 开头。");
  return url;
}

function cleanSocialLinks(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : cleanJson(value, {});
  const links = {};
  for (const key of SOCIAL_LINK_KEYS) {
    const url = cleanExternalUrl(source?.[key], 500);
    if (url) links[key] = url;
  }
  return links;
}

function encryptedValueKey(secret) {
  return crypto.createHash("sha256").update(`${secret}:wikist-secret-v1`).digest();
}

function encryptValue(value, secret) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptedValueKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptValue(value, secret) {
  const parts = String(value || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const encrypted = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptedValueKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (_error) {
    return "";
  }
}

function cleanDisplayName(value, fallback) {
  const displayName = cleanText(value || fallback || "", 40);
  if (!displayName) throw new Error("显示名称不能为空。");
  return displayName;
}

function cleanGuestName(value) {
  const name = cleanText(value, 40);
  if (!name) throw new Error("访客昵称不能为空。");
  return name;
}

function assertUsername(username) {
  if (!/^[a-z0-9_-]{3,30}$/.test(username)) {
    throw new Error("用户名需为 3-30 位小写字母、数字、下划线或连字符。");
  }
}

function assertPassword(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) throw new Error("密码至少需要 8 位。");
  if (value.length > PASSWORD_MAX_LENGTH) throw new Error("密码过长。");
}

function assertEmail(email) {
  if (!email) return;
  if (!EMAIL_RE.test(email)) throw new Error("邮箱格式不正确。");
}

function assertPolicy(policy, fieldName) {
  if (!["guest", "user", "locked"].includes(policy)) {
    throw new Error(`${fieldName} 权限策略无效。`);
  }
}

function assertDeletePolicy(policy) {
  if (!["user", "senior_editor", "locked"].includes(policy)) {
    throw new Error("\u5220\u9664\u6743\u9650\u53ea\u5141\u8bb8\u8d44\u6df1\u7f16\u8f91\u6216\u9501\u5b9a\u3002");
  }
}

function normalizeTranslationLang(value, fallback = "en") {
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

function markdownMeasure(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/[#>*_`~|[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function translationProgress(sourceMd, translatedMd) {
  const source = Math.max(1, markdownMeasure(sourceMd));
  const translated = markdownMeasure(translatedMd);
  return Math.max(0, Math.min(100, Math.round((translated / source) * 100)));
}

function basicAutoTranslateText(text, targetLang) {
  const source = String(text || "");
  if (targetLang === "zh-TW") {
    const map = {
      数学: "數學", 知识: "知識", 开放: "開放", 页面: "頁面", 词条: "詞條", 编辑: "編輯",
      评论: "評論", 证明: "證明", 定义: "定義", 分类: "分類", 质量: "品質", 用户: "使用者",
      系统: "系統", 结构: "結構", 函数: "函數", 计算: "計算", 线性: "線性", 群: "群",
      环: "環", 域: "域", 拓扑: "拓撲", 几何: "幾何", 代数: "代數", 分析: "分析",
    };
    return source.replace(/[数学知识开放页面词条编辑评论证明定义分类质量用户系统结构函数计算线性群环域拓扑几何代数分析]{1,4}/g, (match) => map[match] || match.split("").map((char) => map[char] || char).join(""));
  }
  if (targetLang === "zh-CN") return source;
  const pairs = [
    ["定义", "definition"], ["定理", "theorem"], ["证明", "proof"], ["数学", "mathematics"],
    ["集合", "set"], ["函数", "function"], ["群", "group"], ["环", "ring"], ["域", "field"],
    ["向量", "vector"], ["空间", "space"], ["线性", "linear"], ["拓扑", "topology"],
    ["几何", "geometry"], ["代数", "algebra"], ["分析", "analysis"], ["概率", "probability"],
    ["结构", "structure"], ["映射", "mapping"], ["连续", "continuous"], ["可微", "differentiable"],
    ["积分", "integral"], ["导数", "derivative"], ["矩阵", "matrix"], ["范畴", "category"],
    ["对象", "object"], ["性质", "property"], ["例子", "example"], ["注释", "note"],
    ["参考", "reference"], ["词条", "entry"], ["页面", "page"], ["分类", "category"],
  ];
  let output = source;
  for (const [from, to] of pairs) output = output.replaceAll(from, to);
  output = output
    .replace(/。/g, ". ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ");
  return output;
}

function normalizeRole(role, fallback = "member") {
  const value = String(role || fallback || "member").trim();
  if (value === "senior" || value === "senior-editor") return "senior_editor";
  return USER_GROUPS.includes(value) ? value : fallback;
}

function roleRank(role) {
  return GROUP_RANK[normalizeRole(role)] ?? 0;
}

function sessionRole(session) {
  return normalizeRole(session?.user?.role || "member");
}

function hasRole(session, minimumRole) {
  return Boolean(session?.user) && roleRank(sessionRole(session)) >= roleRank(minimumRole);
}

function accessError(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function hashPassword(password, salt = randomToken(18)) {
  const hash = crypto.scryptSync(String(password), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString("base64url");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return timingSafeStringEqual(hash, expectedHash);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCaptchaSvg(question, nonce) {
  const lines = Array.from({ length: 8 }, (_, index) => {
    const x1 = (index * 37 + nonce) % 260;
    const y1 = 18 + ((index * 23 + nonce) % 72);
    const x2 = (x1 + 74 + index * 11) % 280;
    const y2 = 18 + ((y1 + 31 + index * 13) % 84);
    return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="rgba(56,232,255,.22)" stroke-width="1"/>`;
  }).join("");

  const dots = Array.from({ length: 34 }, (_, index) => {
    const cx = 12 + ((index * 47 + nonce) % 276);
    const cy = 10 + ((index * 31 + nonce) % 100);
    const fill = index % 3 === 0 ? "#7cffb4" : index % 3 === 1 ? "#38e8ff" : "#ffd166";
    return `<circle cx="${cx}" cy="${cy}" r="${index % 2 ? 1.4 : 1}" fill="${fill}" opacity=".42"/>`;
  }).join("");

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="118" viewBox="0 0 300 118" role="img" aria-label="Wikist captcha">',
    '<rect width="300" height="118" rx="8" fill="#080d0c"/>',
    '<rect x="8" y="8" width="284" height="102" rx="6" fill="none" stroke="rgba(124,255,180,.28)"/>',
    lines,
    dots,
    '<text x="18" y="32" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#9bb0a8">WIKIST PASSPORT CHECK</text>',
    `<text x="50%" y="74" text-anchor="middle" font-family="Consolas, monospace" font-size="34" font-weight="700" fill="#edf7f2">${escapeXml(question)} = ?</text>`,
    '<path d="M22 91H278" stroke="rgba(255,209,102,.42)" stroke-width="1"/>',
    "</svg>",
  ].join("");
}

function defaultUserPage(username, displayName) {
  return `# ${displayName}\n\n这里是 @${username} 的 Wikist 个人页面。\n\n## 关注方向\n\n- 数学知识整理\n- 词条审校\n- 开放知识协作\n`;
}

function userFromRow(row) {
  if (!row) return null;
  const role = normalizeRole(row.role);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role,
    status: row.status,
    bio: row.bio || "",
    avatarUrl: row.avatar_url || "",
    socialLinks: cleanSocialLinks(cleanJson(row.social_links_json, {})),
    pageMd: row.page_md || defaultUserPage(row.username, row.display_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordUpdatedAt: row.password_updated_at,
    lastSyncAt: row.last_sync_at,
    emailVerifiedAt: row.email_verified_at || "",
    emailVerified: Boolean(row.email_verified_at),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    twoFactorConfirmedAt: row.two_factor_confirmed_at || "",
    group: role,
    groupLabel: GROUP_LABELS[role] || role,
    capabilities: {
      admin: roleRank(role) >= roleRank("admin"),
      staff: roleRank(role) >= roleRank("senior_editor"),
      manageUsers: roleRank(role) >= roleRank("admin"),
      manageContent: roleRank(role) >= roleRank("senior_editor"),
      reviewContent: roleRank(role) >= roleRank("senior_editor"),
      managePermissions: roleRank(role) >= roleRank("senior_editor"),
      deletePages: roleRank(role) >= roleRank("senior_editor"),
    },
  };
}

function publicUserFromRow(row) {
  const user = userFromRow(row);
  if (!user) return null;
  delete user.email;
  return {
    ...user,
    isBanned: user.status === "disabled",
  };
}

function editEventFromRow(row) {
  return {
    id: row.id,
    pageSlug: row.page_slug,
    pageTitle: row.page_title,
    action: row.action,
    editorType: row.editor_type,
    userId: row.user_id,
    guestId: row.guest_id,
    editorName: row.editor_name,
    editorLabel: row.editor_label,
    guestEmail: row.guest_email || "",
    pageBytes: row.page_bytes,
    createdAt: row.created_at,
  };
}

function pageReviewFromRow(row, currentRevisionId = "", latestNote = null) {
  const stableRevisionId = String(row?.stable_revision_id || "");
  return {
    pageSlug: row?.page_slug || "",
    currentRevisionId: String(currentRevisionId || ""),
    stableRevisionId,
    reviewedAt: row?.reviewed_at || "",
    reviewerName: row?.reviewer_name || "",
    reviewerUserId: row?.reviewer_user_id || null,
    comment: row?.review_comment || "",
    hasStable: Boolean(stableRevisionId),
    isCurrentStable: Boolean(stableRevisionId && currentRevisionId && stableRevisionId === currentRevisionId),
    pending: !stableRevisionId || stableRevisionId !== currentRevisionId,
    latestNote: latestNote ? {
      id: latestNote.id,
      decision: latestNote.decision,
      comment: latestNote.comment,
      reviewerName: latestNote.reviewer_name,
      reviewerUserId: latestNote.reviewer_user_id || null,
      revisionId: latestNote.revision_id,
      createdAt: latestNote.created_at,
    } : null,
  };
}

function commentFromRow(row) {
  return {
    id: row.id,
    pageSlug: row.page_slug,
    parentId: row.parent_id,
    replyCount: Number(row.reply_count || 0),
    authorType: row.author_type,
    userId: row.user_id,
    guestId: row.guest_id,
    authorName: row.author_name,
    authorUsername: row.author_username || "",
    authorAvatarUrl: row.author_avatar_url || "",
    authorEmail: row.author_email || "",
    authorWebsite: row.author_website || "",
    contentMd: row.content_md,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    rawId: row.raw_id || Math.abs(Number(row.id || 0)),
    channel: row.channel || (row.site_message_id ? "site" : "direct"),
    userMessageId: row.user_message_id || null,
    siteMessageId: row.site_message_id || null,
    recipientUserId: row.recipient_user_id,
    recipientUsername: row.recipient_username || "",
    recipientName: row.recipient_name || "",
    senderUserId: row.sender_user_id,
    senderUsername: row.sender_username || "",
    senderName: row.sender_name || "Wikist",
    title: row.title || "",
    body: row.body || "",
    kind: row.kind || "system",
    priority: row.priority || "normal",
    displaySeconds: Number(row.display_seconds || 7),
    sourceType: row.source_type || "",
    sourceUrl: row.source_url || "",
    sourceLabel: row.source_label || "",
    status: row.status || "unread",
    broadcastStatus: row.broadcast_status || "",
    createdAt: row.created_at,
    readAt: row.read_at || "",
    deletedAt: row.deleted_at || "",
    recalledAt: row.recalled_at || "",
    deliveryCount: Number(row.delivery_count || 0),
    readCount: Number(row.read_count || 0),
    deletedCount: Number(row.deleted_count || 0),
  };
}

function auditLogFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorType: row.actor_type,
    userId: row.user_id,
    guestId: row.guest_id || "",
    actorName: row.actor_name || "",
    actorLabel: row.actor_label || "",
    action: row.action || "",
    targetType: row.target_type || "",
    targetId: row.target_id || "",
    targetLabel: row.target_label || "",
    summary: row.summary || "",
    metadata: cleanJson(row.metadata_json, {}),
    ip: row.ip || "",
    userAgent: row.user_agent || "",
    createdAt: row.created_at,
  };
}

function translatorFromRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    languages: cleanJson(row.languages_json, []),
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

function translationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    pageSlug: row.page_slug,
    language: row.language,
    sourceLanguage: row.source_language || "zh-CN",
    title: row.title || "",
    summary: row.summary || "",
    sourceMd: row.source_md || "",
    translatedMd: row.translated_md || "",
    progress: Number(row.progress || 0),
    status: row.status || "draft",
    translatorUserId: row.translator_user_id,
    translatorUsername: row.translator_username || "",
    translatorName: row.translator_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function favoriteFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    pageSlug: row.page_slug,
    pageTitle: row.page_title || row.page_slug,
    createdAt: row.created_at,
  };
}

function permissionsFromRow(slug, row) {
  return {
    pageSlug: slug,
    editPolicy: row?.edit_policy || DEFAULT_PERMISSIONS.editPolicy,
    commentPolicy: row?.comment_policy || DEFAULT_PERMISSIONS.commentPolicy,
    deletePolicy: row?.delete_policy || DEFAULT_PERMISSIONS.deletePolicy,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

function listOptions(options, defaultLimit, maxLimit) {
  const rawLimit = typeof options === "object" ? options.limit : options;
  const rawOffset = typeof options === "object" ? options.offset : 0;
  const limit = Math.max(1, Math.min(Number(rawLimit) || defaultLimit, maxLimit));
  const offset = Math.max(0, Number(rawOffset) || 0);
  return { limit, offset };
}

function normalizeKnowledgeSlug(value, fieldName = "词条") {
  if (!String(value || "").trim()) throw new Error(`${fieldName}标识不能为空。`);
  try {
    return normalizeSlug(String(value || ""));
  } catch (_error) {
    throw new Error(`${fieldName}标识无效。`);
  }
}

function normalizeWatchTarget(type, value) {
  const targetType = String(type || "").trim().toLowerCase();
  if (!WATCH_TARGET_TYPES.includes(targetType)) throw new Error("关注类型无效。");
  if (targetType === "page") return { targetType, targetKey: normalizeKnowledgeSlug(value) };
  if (targetType === "category") {
    const targetKey = cleanText(value, 80).replace(/\s+/g, " ");
    if (!targetKey) throw new Error("分类不能为空。");
    return { targetType, targetKey };
  }
  const targetKey = normalizeTranslationLang(value, "");
  if (!targetKey) throw new Error("语言不能为空。");
  return { targetType, targetKey };
}

function extractWikiLinks(markdown) {
  const links = new Map();
  String(markdown || "").replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match, rawTarget, rawLabel) => {
    const reference = String(rawTarget || "").trim();
    const target = reference.split("#")[0].trim();
    if (!target || /^(?:file|image|category):/i.test(target) || /^(?:https?:)?\/\//i.test(target)) return _match;
    try {
      const targetSlug = normalizeKnowledgeSlug(target, "链接");
      if (targetSlug) {
        links.set(targetSlug, {
          targetSlug,
          targetLabel: cleanText(String(rawLabel || "").trim() || targetSlug, 160),
        });
      }
    } catch (_error) {}
    return _match;
  });
  return [...links.values()];
}

function watchFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.target_type,
    targetKey: row.target_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function linkFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceSlug: row.source_slug,
    targetSlug: row.target_slug,
    targetLabel: row.target_label || row.target_slug,
    updatedAt: row.updated_at,
  };
}

function aliasFromRow(row) {
  if (!row) return null;
  return {
    aliasSlug: row.alias_slug,
    targetSlug: row.target_slug,
    sourcePageSlug: row.source_page_slug || "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function followFromRow(row) {
  if (!row) return null;
  return {
    user: publicUserFromRow(row),
    createdAt: row.followed_at || row.created_at || "",
  };
}

class PassportStore {
  constructor(rootDir, options = {}) {
    requireSqlite();
    this.rootDir = rootDir;
    this.options = {
      enabled: true,
      database: "data/wikist.sqlite",
      sessionDays: 7,
      captchaTTLSeconds: 300,
      ...options,
    };
    this.cookieName = COOKIE_NAME;
    this.guestCookieName = GUEST_COOKIE_NAME;
    this.secret = process.env.WIKIST_PASSPORT_SECRET || "wikist-dev-passport-secret";
    this.dbPath = path.resolve(rootDir, this.options.database);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.migrate();
    this.cleanup();
  }

  columnExists(table, column) {
    return this.db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  }

  addColumn(table, column, definition) {
    if (!this.columnExists(table, column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  migrate() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        bio TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        social_links_json TEXT NOT NULL DEFAULT '{}',
        page_md TEXT NOT NULL DEFAULT '',
        email_verified_at TEXT NOT NULL DEFAULT '',
        two_factor_secret TEXT NOT NULL DEFAULT '',
        two_factor_enabled INTEGER NOT NULL DEFAULT 0,
        two_factor_confirmed_at TEXT NOT NULL DEFAULT '',
        two_factor_recovery_json TEXT NOT NULL DEFAULT '[]',
        last_security_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        password_updated_at TEXT NOT NULL,
        last_sync_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        user_agent TEXT,
        ip TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS captchas (
        id TEXT PRIMARY KEY,
        answer_hash TEXT NOT NULL,
        question TEXT NOT NULL,
        svg TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_captchas_expires_at ON captchas(expires_at);

      CREATE TABLE IF NOT EXISTS guest_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip_first TEXT,
        ip_last TEXT,
        user_agent TEXT,
        edit_count INTEGER NOT NULL DEFAULT 0,
        comment_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS page_permissions (
        page_slug TEXT PRIMARY KEY,
        edit_policy TEXT NOT NULL DEFAULT 'guest',
        comment_policy TEXT NOT NULL DEFAULT 'guest',
        delete_policy TEXT NOT NULL DEFAULT 'user',
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS page_edit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        page_title TEXT NOT NULL,
        action TEXT NOT NULL,
        editor_type TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        editor_name TEXT NOT NULL,
        editor_label TEXT NOT NULL,
        guest_email TEXT NOT NULL DEFAULT '',
        ip TEXT,
        user_agent TEXT,
        page_bytes INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_edit_events_slug ON page_edit_events(page_slug, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_edit_events_user ON page_edit_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_edit_events_guest ON page_edit_events(guest_id, created_at);

      CREATE TABLE IF NOT EXISTS page_stable_revisions (
        page_slug TEXT PRIMARY KEY,
        stable_revision_id TEXT NOT NULL,
        reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_name TEXT NOT NULL DEFAULT '',
        review_comment TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_stable_revisions_reviewed ON page_stable_revisions(reviewed_at);

      CREATE TABLE IF NOT EXISTS page_review_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_name TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_review_notes_slug ON page_review_notes(page_slug, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_review_notes_revision ON page_review_notes(page_slug, revision_id, created_at);

      CREATE TABLE IF NOT EXISTS page_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        parent_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL DEFAULT '',
        author_website TEXT NOT NULL DEFAULT '',
        content_md TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_comments_slug ON page_comments(page_slug, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_comments_user ON page_comments(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_comments_guest ON page_comments(guest_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_comments_parent ON page_comments(parent_id, created_at);

      CREATE TABLE IF NOT EXISTS page_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        rating INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_ratings_slug ON page_ratings(page_slug, updated_at);
      CREATE INDEX IF NOT EXISTS idx_page_ratings_user ON page_ratings(user_id, page_slug);
      CREATE INDEX IF NOT EXISTS idx_page_ratings_guest ON page_ratings(guest_id, page_slug);

      CREATE TABLE IF NOT EXISTS page_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_slug TEXT NOT NULL,
        page_title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(user_id, page_slug)
      );

      CREATE INDEX IF NOT EXISTS idx_page_favorites_user ON page_favorites(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_page_favorites_page ON page_favorites(page_slug, created_at);

      CREATE TABLE IF NOT EXISTS user_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_name TEXT NOT NULL DEFAULT 'Wikist',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'system',
        priority TEXT NOT NULL DEFAULT 'normal',
        display_seconds INTEGER NOT NULL DEFAULT 7,
        source_type TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_label TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unread',
        created_at TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_user_messages_recipient ON user_messages(recipient_user_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_user_messages_kind ON user_messages(kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_user_messages_sender ON user_messages(sender_user_id, created_at);

      CREATE TABLE IF NOT EXISTS site_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_name TEXT NOT NULL DEFAULT 'Wikist',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'broadcast',
        priority TEXT NOT NULL DEFAULT 'normal',
        display_seconds INTEGER NOT NULL DEFAULT 7,
        source_type TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_label TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        recalled_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS site_message_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES site_messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'unread',
        read_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT '',
        UNIQUE(message_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_site_messages_status ON site_messages(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_site_messages_sender ON site_messages(sender_user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_site_message_states_user ON site_message_states(user_id, status, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_site_message_states_message ON site_message_states(message_id, user_id);

      CREATE TABLE IF NOT EXISTS passport_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_passport_tokens_user ON passport_tokens(user_id, purpose, created_at);
      CREATE INDEX IF NOT EXISTS idx_passport_tokens_hash ON passport_tokens(token_hash);

      CREATE TABLE IF NOT EXISTS site_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL DEFAULT 'system',
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_label TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        target_label TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_site_audit_logs_action ON site_audit_logs(action, created_at);
      CREATE INDEX IF NOT EXISTS idx_site_audit_logs_target ON site_audit_logs(target_type, target_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_site_audit_logs_user ON site_audit_logs(user_id, created_at);

      CREATE TABLE IF NOT EXISTS translator_members (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        languages_json TEXT NOT NULL DEFAULT '[]',
        joined_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS page_translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        language TEXT NOT NULL,
        source_language TEXT NOT NULL DEFAULT 'zh-CN',
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        source_md TEXT NOT NULL DEFAULT '',
        translated_md TEXT NOT NULL DEFAULT '',
        progress INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        translator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(page_slug, language)
      );

      CREATE INDEX IF NOT EXISTS idx_page_translations_page ON page_translations(page_slug, language);
      CREATE INDEX IF NOT EXISTS idx_page_translations_user ON page_translations(translator_user_id, updated_at);

      CREATE TABLE IF NOT EXISTS watch_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, target_type, target_key)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_subscriptions_user ON watch_subscriptions(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_watch_subscriptions_target ON watch_subscriptions(target_type, target_key, user_id);

      CREATE TABLE IF NOT EXISTS page_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_slug TEXT NOT NULL,
        target_slug TEXT NOT NULL,
        target_label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_slug, target_slug)
      );

      CREATE INDEX IF NOT EXISTS idx_page_links_source ON page_links(source_slug, updated_at);
      CREATE INDEX IF NOT EXISTS idx_page_links_target ON page_links(target_slug, updated_at);

      CREATE TABLE IF NOT EXISTS page_aliases (
        alias_slug TEXT PRIMARY KEY,
        target_slug TEXT NOT NULL,
        source_page_slug TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_aliases_target ON page_aliases(target_slug, updated_at);

      CREATE TABLE IF NOT EXISTS user_follows (
        follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (follower_user_id, following_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_user_id, created_at);
    `);

    this.addColumn("users", "bio", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "avatar_url", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "social_links_json", "TEXT NOT NULL DEFAULT '{}'");
    this.addColumn("users", "page_md", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "last_sync_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "email_verified_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "two_factor_secret", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "two_factor_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("users", "two_factor_confirmed_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("users", "two_factor_recovery_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("users", "last_security_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("guest_profiles", "display_name", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("guest_profiles", "email", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("guest_profiles", "website", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("guest_profiles", "comment_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("page_edit_events", "guest_email", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("page_permissions", "delete_policy", "TEXT NOT NULL DEFAULT 'user'");
    this.addColumn("user_messages", "priority", "TEXT NOT NULL DEFAULT 'normal'");
    this.addColumn("site_messages", "priority", "TEXT NOT NULL DEFAULT 'normal'");
    this.addColumn("user_messages", "display_seconds", "INTEGER NOT NULL DEFAULT 7");
    this.addColumn("site_messages", "display_seconds", "INTEGER NOT NULL DEFAULT 7");
    this.addColumn("page_aliases", "source_page_slug", "TEXT NOT NULL DEFAULT ''");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_page_aliases_source ON page_aliases(source_page_slug, updated_at)");

    this.db.prepare("UPDATE users SET role = 'senior_editor' WHERE role = 'senior'").run();
    this.db.prepare("UPDATE users SET role = 'creator' WHERE role = 'contributor'").run();
    const hasAdmin = this.db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (!hasAdmin) {
      this.db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT min(id) FROM users)").run();
    }

    const now = nowIso();
    this.db.prepare("UPDATE users SET page_md = ? WHERE page_md = ''").run("# 个人页面\n\n这里可以写 Markdown 自定义个人主页。");
    this.db.prepare("UPDATE users SET last_sync_at = ? WHERE last_sync_at = ''").run(now);
  }

  cleanup() {
    const now = nowIso();
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM captchas WHERE expires_at < ? OR used_at IS NOT NULL").run(now);
  }

  captchaAnswerHash(id, answer) {
    return sha256(`${id}:${String(answer || "").trim()}:${this.secret}`);
  }

  createCaptcha() {
    this.cleanup();
    const id = crypto.randomUUID();
    const left = crypto.randomInt(11, 80);
    const right = crypto.randomInt(3, 39);
    const op = crypto.randomInt(0, 2) ? "+" : "-";
    const answer = op === "+" ? left + right : left - right;
    const question = `${left} ${op} ${right}`;
    const createdAt = nowIso();
    const expiresAt = addSeconds(this.options.captchaTTLSeconds);
    const svg = buildCaptchaSvg(question, crypto.randomInt(10, 999));

    this.db.prepare(`
      INSERT INTO captchas (id, answer_hash, question, svg, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, this.captchaAnswerHash(id, answer), question, svg, createdAt, expiresAt);

    return { id, svg, expiresAt };
  }

  verifyCaptcha(id, answer) {
    const row = this.db.prepare("SELECT * FROM captchas WHERE id = ?").get(String(id || ""));
    if (!row || row.used_at || row.expires_at < nowIso()) throw new Error("验证码已失效，请刷新后重试。");
    const actual = this.captchaAnswerHash(row.id, answer);
    if (!timingSafeStringEqual(actual, row.answer_hash)) throw new Error("验证码不正确。");
    this.db.prepare("UPDATE captchas SET used_at = ? WHERE id = ?").run(nowIso(), row.id);
  }

  findUser(identifier) {
    const value = String(identifier || "").trim().toLowerCase();
    if (!value) return null;
    return this.db.prepare(`
      SELECT * FROM users
      WHERE username = ? OR lower(email) = ?
      LIMIT 1
    `).get(value, value);
  }

  findUserById(userId) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  tokenHash(token) {
    return sha256(`passport-token:${token}:${this.secret}`);
  }

  createPassportToken(userId, purpose, options = {}) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    const token = randomToken(36);
    const now = nowIso();
    const seconds = Math.max(60, Number(options.ttlSeconds || EMAIL_TOKEN_TTL_SECONDS));
    const expiresAt = addSeconds(seconds);
    this.db.prepare(`
      INSERT INTO passport_tokens (user_id, purpose, token_hash, email, metadata_json, created_at, expires_at, used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '')
    `).run(row.id, cleanText(purpose, 40), this.tokenHash(token), normalizeEmail(options.email || row.email) || "", jsonText(options.metadata || {}), now, expiresAt);
    return { token, expiresAt, user: userFromRow(row) };
  }

  consumePassportToken(token, purpose) {
    const row = this.db.prepare(`
      SELECT t.*, u.username, u.email AS current_email
      FROM passport_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = ?
      LIMIT 1
    `).get(this.tokenHash(token), cleanText(purpose, 40));
    if (!row || row.used_at || row.expires_at < nowIso()) throw new Error("验证链接已失效，请重新申请。");
    const now = nowIso();
    this.db.prepare("UPDATE passport_tokens SET used_at = ? WHERE id = ?").run(now, row.id);
    return row;
  }

  createEmailVerificationToken(userId) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    if (!row.email) throw new Error("请先绑定邮箱。");
    return this.createPassportToken(userId, "email_verify", { email: row.email, ttlSeconds: Number(this.options.emailVerificationTTLSeconds || EMAIL_TOKEN_TTL_SECONDS) });
  }

  verifyEmailToken(token) {
    const ticket = this.consumePassportToken(token, "email_verify");
    const current = this.findUserById(ticket.user_id);
    if (!current || normalizeEmail(current.email) !== normalizeEmail(ticket.email)) throw new Error("邮箱已变更，请重新发送验证邮件。");
    const now = nowIso();
    this.db.prepare("UPDATE users SET email_verified_at = ?, updated_at = ?, last_security_at = ? WHERE id = ?")
      .run(now, now, now, ticket.user_id);
    return this.getUserProfile(ticket.user_id);
  }

  createPasswordResetToken(identifier) {
    const user = this.findUser(identifier);
    if (!user || user.status !== "active" || !user.email) return null;
    return this.createPassportToken(user.id, "password_reset", { email: user.email, ttlSeconds: Number(this.options.passwordResetTTLSeconds || PASSWORD_RESET_TTL_SECONDS) });
  }

  resetPasswordWithToken(token, newPassword) {
    const ticket = this.consumePassportToken(token, "password_reset");
    const row = this.findUserById(ticket.user_id);
    if (!row || row.status !== "active") throw new Error("账号不可用。");
    const password = String(newPassword || "");
    assertPassword(password);
    const now = nowIso();
    const { salt, hash } = hashPassword(password);
    this.db.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ?, password_updated_at = ?, last_security_at = ?, last_sync_at = ?
      WHERE id = ?
    `).run(hash, salt, now, now, now, now, row.id);
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
    this.db.prepare("UPDATE passport_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'password_reset' AND used_at = ''").run(now, row.id);
    return userFromRow(this.findUserById(row.id));
  }

  decryptTwoFactorSecret(row) {
    return decryptValue(row?.two_factor_secret || "", this.secret);
  }

  twoFactorStatus(userId) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    const securityChecks = [
      { key: "email", ok: Boolean(row.email && row.email_verified_at), label: "邮箱已验证" },
      { key: "password", ok: Boolean(row.password_updated_at), label: "密码已设置" },
      { key: "twoFactor", ok: Boolean(row.two_factor_enabled), label: "二次验证" },
    ];
    const score = Math.round((securityChecks.filter((item) => item.ok).length / securityChecks.length) * 100);
    return {
      email: row.email || "",
      emailVerified: Boolean(row.email_verified_at),
      emailVerifiedAt: row.email_verified_at || "",
      twoFactorEnabled: Boolean(row.two_factor_enabled),
      twoFactorConfirmedAt: row.two_factor_confirmed_at || "",
      lastSecurityAt: row.last_security_at || "",
      securityScore: score,
      checks: securityChecks,
    };
  }

  setupTwoFactor(userId) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    const secret = base32Encode(crypto.randomBytes(20));
    const now = nowIso();
    this.db.prepare("UPDATE users SET two_factor_secret = ?, two_factor_enabled = 0, two_factor_confirmed_at = '', last_security_at = ? WHERE id = ?")
      .run(encryptValue(secret, this.secret), now, row.id);
    const label = encodeURIComponent(`Wikist:${row.username}`);
    const issuer = encodeURIComponent(this.options.twoFactorIssuer || "Wikist");
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}` };
  }

  enableTwoFactor(userId, code) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    const secret = this.decryptTwoFactorSecret(row);
    if (!secret) throw new Error("请先生成二次验证密钥。");
    if (!verifyTotp(secret, code, Number(this.options.twoFactorWindow || 1))) throw new Error("二次验证码不正确。");
    const now = nowIso();
    this.db.prepare("UPDATE users SET two_factor_enabled = 1, two_factor_confirmed_at = ?, last_security_at = ? WHERE id = ?").run(now, now, row.id);
    return this.twoFactorStatus(userId);
  }

  disableTwoFactor(userId, input = {}) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    if (!verifyPassword(input.currentPassword || "", row.password_salt, row.password_hash)) throw new Error("当前密码不正确。");
    if (row.two_factor_enabled) {
      const secret = this.decryptTwoFactorSecret(row);
      if (!verifyTotp(secret, input.code, Number(this.options.twoFactorWindow || 1))) throw new Error("二次验证码不正确。");
    }
    const now = nowIso();
    this.db.prepare("UPDATE users SET two_factor_enabled = 0, two_factor_secret = '', two_factor_confirmed_at = '', last_security_at = ? WHERE id = ?").run(now, row.id);
    return this.twoFactorStatus(userId);
  }

  register(input, req) {
    this.verifyCaptcha(input.captchaId, input.captchaAnswer);
    const username = normalizeUsername(input.username);
    const email = normalizeEmail(input.email);
    const displayName = cleanDisplayName(input.displayName, input.username);
    const password = String(input.password || "");
    assertUsername(username);
    if (!email) throw new Error("注册需要填写邮箱，用于验证和找回密码。");
    assertEmail(email);
    assertPassword(password);

    const existing = this.findUser(email || username);
    if (existing || this.findUser(username)) throw new Error("用户名或邮箱已被使用。");

    const now = nowIso();
    const initialAdmin = this.needsInitialAdmin();
    const role = initialAdmin ? "admin" : "member";
    const emailVerifiedAt = initialAdmin ? now : "";
    const { salt, hash } = hashPassword(password);
    const pageMd = defaultUserPage(username, displayName);
    const result = this.db.prepare(`
      INSERT INTO users (
        username, email, display_name, password_hash, password_salt,
        role, status, bio, page_md, email_verified_at, created_at, updated_at, password_updated_at, last_sync_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', '', ?, ?, ?, ?, ?, ?)
    `).run(username, email, displayName, hash, salt, role, pageMd, emailVerifiedAt, now, now, now, now);

    return { ...this.createSession(userFromRow(this.findUserById(result.lastInsertRowid)), req), initialAdmin };
  }

  login(input, req) {
    this.verifyCaptcha(input.captchaId, input.captchaAnswer);
    const userRow = this.findUser(input.identifier);
    if (!userRow) throw accessError("账号或密码不正确。", 401);
    if (userRow.status === "disabled") throw accessError("账号已被禁用。", 403);
    if (!verifyPassword(input.password || "", userRow.password_salt, userRow.password_hash)) throw accessError("账号或密码不正确。", 401);
    if (this.options.requireEmailVerification === true && userRow.email && !userRow.email_verified_at) {
      throw accessError("请先完成邮箱验证后再登录。", 403);
    }
    if (userRow.two_factor_enabled) {
      const secret = this.decryptTwoFactorSecret(userRow);
      if (!verifyTotp(secret, input.twoFactorCode, Number(this.options.twoFactorWindow || 1))) {
        throw accessError("二次验证码不正确。", 401);
      }
    }
    return this.createSession(userFromRow(userRow), req);
  }
  createSession(user, req) {
    const token = randomToken();
    const tokenHash = sha256(token);
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const expiresAt = addDays(this.options.sessionDays);
    const { ip, userAgent } = this.getRequestInfo(req);

    this.db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.id, tokenHash, userAgent, ip, createdAt, expiresAt, createdAt);

    return { token, maxAgeSeconds: this.options.sessionDays * 24 * 60 * 60, user };
  }

  authenticate(req) {
    const token = parseCookies(req.headers.cookie)[this.cookieName];
    if (!token) return null;
    const tokenHash = sha256(token);
    const row = this.db.prepare(`
      SELECT sessions.id AS session_id, sessions.expires_at, users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `).get(tokenHash);

    if (!row || row.expires_at < nowIso() || row.status !== "active") {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }

    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.session_id);
    return { token, sessionId: row.session_id, user: userFromRow(row) };
  }

  logout(req) {
    const token = parseCookies(req.headers.cookie)[this.cookieName];
    if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }

  changePassword(userId, input) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    if (!verifyPassword(input.currentPassword || "", row.password_salt, row.password_hash)) throw new Error("当前密码不正确。");
    const nextPassword = String(input.newPassword || "");
    assertPassword(nextPassword);
    if (nextPassword === String(input.currentPassword || "")) throw new Error("新密码不能与当前密码相同。");

    const now = nowIso();
    const { salt, hash } = hashPassword(nextPassword);
    this.db.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ?, password_updated_at = ?, last_security_at = ?, last_sync_at = ?
      WHERE id = ?
    `).run(hash, salt, now, now, now, now, userId);
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return userFromRow(this.findUserById(userId));
  }

  getUserProfile(userId) {
    const user = userFromRow(this.findUserById(userId));
    if (!user) return null;
    return {
      ...user,
      stats: this.userStats(user.id),
      recentEdits: this.listUserEdits(user.username, 10),
      favorites: this.listUserFavorites(user.id, { limit: 10, offset: 0 }),
      translator: this.getTranslatorProfile(user.id),
    };
  }

  getPublicUser(username) {
    const row = this.findUser(username);
    if (!row) return null;
    const user = publicUserFromRow(row);
    return { ...user, stats: this.userStats(user.id), recentEdits: this.listUserEdits(user.username, 10) };
  }


  listUsers(options = {}) {
    const { limit, offset } = listOptions(options, 50, 300);
    const query = typeof options === "object" ? cleanText(options.query || "", 120).toLowerCase() : "";
    const where = query ? "WHERE lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(coalesce(email, '')) LIKE ?" : "";
    const args = query ? [`%${query}%`, `%${query}%`, `%${query}%`, limit, offset] : [limit, offset];
    return this.db.prepare(`SELECT * FROM users ${where} ORDER BY id ASC LIMIT ? OFFSET ?`)
      .all(...args)
      .map((row) => {
        const user = userFromRow(row);
        return { ...user, stats: this.userStats(user.id) };
      });
  }

  countUsers(query = "") {
    const q = cleanText(query, 120).toLowerCase();
    if (!q) return this.db.prepare("SELECT count(*) AS n FROM users").get().n;
    const like = `%${q}%`;
    return this.db.prepare("SELECT count(*) AS n FROM users WHERE lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(coalesce(email, '')) LIKE ?")
      .get(like, like, like).n;
  }

  countAdmins() {
    return this.db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").get().n;
  }

  needsInitialAdmin() {
    return this.countAdmins() === 0;
  }

  updateUserById(userId, input) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("\u8d26\u53f7\u4e0d\u5b58\u5728\u3002");
    const displayName = cleanDisplayName(input.displayName, row.display_name);
    const email = normalizeEmail(input.email);
    const bio = cleanText(input.bio, BIO_MAX_LENGTH);
    const avatarUrl = cleanUrl(input.avatarUrl || input.avatar_url || "");
    const socialLinks = Object.prototype.hasOwnProperty.call(input, "socialLinks")
      ? cleanSocialLinks(input.socialLinks)
      : cleanSocialLinks(cleanJson(row.social_links_json, {}));
    const role = normalizeRole(input.role, row.role);
    const status = ["active", "disabled"].includes(input.status) ? input.status : row.status;
    const pageMd = cleanText(input.pageMd, PROFILE_PAGE_MAX_LENGTH) || row.page_md || defaultUserPage(row.username, displayName);
    assertEmail(email);
    if (email) {
      const existing = this.findUser(email);
      if (existing && existing.id !== Number(userId)) throw new Error("\u90ae\u7bb1\u5df2\u88ab\u5176\u4ed6\u8d26\u53f7\u4f7f\u7528\u3002");
    }
    const now = nowIso();
    const emailChanged = normalizeEmail(row.email) !== email;
    const emailVerifiedAt = input.emailVerified === true ? now : (emailChanged ? "" : (row.email_verified_at || ""));
    this.db.prepare(`
      UPDATE users SET email = ?, email_verified_at = ?, display_name = ?, role = ?, status = ?, bio = ?, avatar_url = ?, social_links_json = ?, page_md = ?, updated_at = ?, last_sync_at = ?
      WHERE id = ?
    `).run(email, emailVerifiedAt, displayName, role, status, bio, avatarUrl, jsonText(socialLinks), pageMd, now, now, userId);
    return { ...userFromRow(this.findUserById(userId)), stats: this.userStats(userId) };
  }
  updateProfile(userId, input) {
    const row = this.findUserById(userId);
    if (!row) throw new Error("账号不存在。");
    const displayName = cleanDisplayName(input.displayName, row.display_name);
    const email = normalizeEmail(input.email);
    const bio = cleanText(input.bio, BIO_MAX_LENGTH);
    const avatarUrl = cleanUrl(input.avatarUrl || input.avatar_url || "");
    const socialLinks = Object.prototype.hasOwnProperty.call(input, "socialLinks")
      ? cleanSocialLinks(input.socialLinks)
      : cleanSocialLinks(cleanJson(row.social_links_json, {}));
    const pageMd = cleanText(input.pageMd, PROFILE_PAGE_MAX_LENGTH) || defaultUserPage(row.username, displayName);
    assertEmail(email);
    if (email) {
      const existing = this.findUser(email);
      if (existing && existing.id !== userId) throw new Error("邮箱已被其他账号使用。");
    }
    const now = nowIso();
    const emailChanged = normalizeEmail(row.email) !== email;
    const emailVerifiedAt = emailChanged ? "" : (row.email_verified_at || "");
    this.db.prepare(`
      UPDATE users SET email = ?, email_verified_at = ?, display_name = ?, bio = ?, avatar_url = ?, social_links_json = ?, page_md = ?, updated_at = ?, last_sync_at = ?
      WHERE id = ?
    `).run(email, emailVerifiedAt, displayName, bio, avatarUrl, jsonText(socialLinks), pageMd, now, now, userId);
    return this.getUserProfile(userId);
  }

  userStats(userId) {
    const edits = this.db.prepare("SELECT count(*) AS n FROM page_edit_events WHERE user_id = ?").get(userId).n;
    const comments = this.db.prepare("SELECT count(*) AS n FROM page_comments WHERE user_id = ? AND status = 'published'").get(userId).n;
    const favorites = this.countUserFavorites(userId);
    const watches = this.countUserWatches(userId);
    const followers = this.countUserFollows(userId, "followers");
    const following = this.countUserFollows(userId, "following");
    return { edits, comments, favorites, watches, followers, following };
  }

  countUserFavorites(userId) {
    return Number(this.db.prepare("SELECT count(*) AS n FROM page_favorites WHERE user_id = ?").get(Number(userId)).n || 0);
  }

  listUserFavorites(userId, options = {}) {
    const { limit, offset } = listOptions(options, 10, 100);
    return this.db.prepare(`
      SELECT * FROM page_favorites
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(Number(userId), limit, offset).map(favoriteFromRow);
  }

  pageFavoriteState(userId, pageSlug) {
    const slug = cleanText(pageSlug, 500);
    const count = Number(this.db.prepare("SELECT count(*) AS n FROM page_favorites WHERE page_slug = ?").get(slug).n || 0);
    const favorited = Boolean(userId && this.db.prepare("SELECT id FROM page_favorites WHERE user_id = ? AND page_slug = ?").get(Number(userId), slug));
    return { pageSlug: slug, favorited, count };
  }

  setPageFavorite(session, page, enabled = true) {
    if (!session?.user) throw accessError("请先登录后收藏词条。", 401);
    const slug = cleanText(page?.slug, 500);
    if (!slug) throw new Error("词条不存在。");
    const userId = Number(session.user.id);
    if (enabled) {
      this.db.prepare(`
        INSERT INTO page_favorites (user_id, page_slug, page_title, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, page_slug) DO UPDATE SET page_title = excluded.page_title
      `).run(userId, slug, cleanText(page.title || slug, 200), nowIso());
    } else {
      this.db.prepare("DELETE FROM page_favorites WHERE user_id = ? AND page_slug = ?").run(userId, slug);
    }
    this.syncUserActivity(userId, nowIso());
    return this.pageFavoriteState(userId, slug);
  }

  countUserWatches(userId, type = "all") {
    const targetType = cleanText(type, 24).toLowerCase();
    if (WATCH_TARGET_TYPES.includes(targetType)) {
      return Number(this.db.prepare("SELECT count(*) AS n FROM watch_subscriptions WHERE user_id = ? AND target_type = ?")
        .get(Number(userId), targetType).n || 0);
    }
    return Number(this.db.prepare("SELECT count(*) AS n FROM watch_subscriptions WHERE user_id = ?").get(Number(userId)).n || 0);
  }

  listUserWatches(userId, options = {}) {
    const { limit, offset } = listOptions(options, 20, 100);
    const type = cleanText(options.type || "all", 24).toLowerCase();
    const args = [Number(userId)];
    let where = "WHERE user_id = ?";
    if (WATCH_TARGET_TYPES.includes(type)) {
      where += " AND target_type = ?";
      args.push(type);
    }
    return this.db.prepare(`
      SELECT * FROM watch_subscriptions
      ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...args, limit, offset).map(watchFromRow);
  }

  watchState(userId, type, value) {
    const target = normalizeWatchTarget(type, value);
    const watched = Boolean(userId && this.db.prepare(
      "SELECT id FROM watch_subscriptions WHERE user_id = ? AND target_type = ? AND target_key = ?",
    ).get(Number(userId), target.targetType, target.targetKey));
    return { ...target, watched, count: this.countUserWatches(userId) };
  }

  setWatch(session, type, value, enabled = true) {
    if (!session?.user) throw accessError("请先登录后管理关注列表。", 401);
    const target = normalizeWatchTarget(type, value);
    if (!target.targetKey) throw new Error("关注目标不能为空。");
    const userId = Number(session.user.id);
    const now = nowIso();
    if (enabled) {
      this.db.prepare(`
        INSERT INTO watch_subscriptions (user_id, target_type, target_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, target_type, target_key) DO UPDATE SET updated_at = excluded.updated_at
      `).run(userId, target.targetType, target.targetKey, now, now);
    } else {
      this.db.prepare(
        "DELETE FROM watch_subscriptions WHERE user_id = ? AND target_type = ? AND target_key = ?",
      ).run(userId, target.targetType, target.targetKey);
    }
    this.syncUserActivity(userId, now);
    return this.watchState(userId, target.targetType, target.targetKey);
  }

  countUserFollows(userId, direction = "following") {
    const column = direction === "followers" ? "following_user_id" : "follower_user_id";
    return Number(this.db.prepare(`SELECT count(*) AS n FROM user_follows WHERE ${column} = ?`).get(Number(userId)).n || 0);
  }

  userFollowState(viewerUserId, targetUserId) {
    const viewerId = Number(viewerUserId || 0);
    const targetId = Number(targetUserId || 0);
    const following = Boolean(viewerId && targetId && viewerId !== targetId && this.db.prepare(
      "SELECT 1 FROM user_follows WHERE follower_user_id = ? AND following_user_id = ?",
    ).get(viewerId, targetId));
    const followedBy = Boolean(viewerId && targetId && viewerId !== targetId && this.db.prepare(
      "SELECT 1 FROM user_follows WHERE follower_user_id = ? AND following_user_id = ?",
    ).get(targetId, viewerId));
    return {
      following,
      followedBy,
      mutual: following && followedBy,
      followers: targetId ? this.countUserFollows(targetId, "followers") : 0,
      followingCount: targetId ? this.countUserFollows(targetId, "following") : 0,
    };
  }

  setUserFollow(session, username, enabled = true) {
    if (!session?.user) throw accessError("请先登录后关注用户。", 401);
    const target = this.findUser(username);
    if (!target) throw new Error("用户不存在。");
    if (target.status !== "active") throw accessError("该用户当前不可被关注。");
    const followerId = Number(session.user.id);
    const followingId = Number(target.id);
    if (followerId === followingId) throw new Error("不能关注自己。");
    const now = nowIso();
    if (enabled) {
      this.db.prepare(`
        INSERT INTO user_follows (follower_user_id, following_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(follower_user_id, following_user_id) DO UPDATE SET updated_at = excluded.updated_at
      `).run(followerId, followingId, now, now);
    } else {
      this.db.prepare("DELETE FROM user_follows WHERE follower_user_id = ? AND following_user_id = ?").run(followerId, followingId);
    }
    this.syncUserActivity(followerId, now);
    return this.userFollowState(followerId, followingId);
  }

  listUserFollows(userId, direction = "following", options = {}) {
    const { limit, offset } = listOptions(options, 12, 100);
    const following = direction !== "followers";
    const joinColumn = following ? "f.following_user_id" : "f.follower_user_id";
    const whereColumn = following ? "f.follower_user_id" : "f.following_user_id";
    return this.db.prepare(`
      SELECT u.*, f.created_at AS followed_at
      FROM user_follows f
      JOIN users u ON u.id = ${joinColumn}
      WHERE ${whereColumn} = ?
      ORDER BY f.created_at DESC, u.username COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(Number(userId), limit, offset).map((row) => {
      const item = followFromRow(row);
      return { ...item, user: { ...item.user, stats: this.userStats(item.user.id) } };
    });
  }

  syncPageLinks(page) {
    const sourceSlug = normalizeKnowledgeSlug(page?.slug);
    const links = extractWikiLinks(page?.body || "");
    const now = nowIso();
    this.db.prepare("DELETE FROM page_links WHERE source_slug = ?").run(sourceSlug);
    const insert = this.db.prepare(`
      INSERT INTO page_links (source_slug, target_slug, target_label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const link of links) insert.run(sourceSlug, link.targetSlug, link.targetLabel, now, now);
    return { sourceSlug, links };
  }

  removePageLinks(slug) {
    const sourceSlug = normalizeKnowledgeSlug(slug);
    return this.db.prepare("DELETE FROM page_links WHERE source_slug = ?").run(sourceSlug).changes;
  }

  rebuildPageLinks(pageList = []) {
    for (const page of pageList) this.syncPageLinks(page);
    return { pages: pageList.length, links: Number(this.db.prepare("SELECT count(*) AS n FROM page_links").get().n || 0) };
  }

  listPageAliases(options = {}) {
    const { limit, offset } = listOptions(options, 100, 500);
    return this.db.prepare(`
      SELECT * FROM page_aliases
      ORDER BY alias_slug COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset).map(aliasFromRow);
  }

  countPageAliases() {
    return Number(this.db.prepare("SELECT count(*) AS n FROM page_aliases").get().n || 0);
  }

  resolvePageAlias(slug) {
    const aliasSlug = normalizeKnowledgeSlug(slug);
    return aliasFromRow(this.db.prepare("SELECT * FROM page_aliases WHERE alias_slug = ?").get(aliasSlug));
  }

  setPageAlias(session, input = {}) {
    if (!hasRole(session, "senior_editor")) throw accessError("只有资深编辑和管理员可以管理别名。");
    const aliasSlug = normalizeKnowledgeSlug(input.aliasSlug || input.alias || "", "别名");
    const targetSlug = normalizeKnowledgeSlug(input.targetSlug || input.target || "", "目标词条");
    if (aliasSlug === targetSlug) throw new Error("别名不能指向自身。");
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO page_aliases (alias_slug, target_slug, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(alias_slug) DO UPDATE SET
        target_slug = excluded.target_slug,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at
    `).run(aliasSlug, targetSlug, session.user.id, now, now);
    return this.resolvePageAlias(aliasSlug);
  }

  syncPageAliases(session, page, aliases = [], existingSlugs = []) {
    if (!hasRole(session, "creator")) throw accessError("Only creator roles and above can manage page aliases.");
    const sourcePageSlug = normalizeKnowledgeSlug(page?.slug, "page");
    const pageSlugs = new Set((existingSlugs || []).map((slug) => normalizeKnowledgeSlug(slug)));
    const requested = [...new Set((Array.isArray(aliases) ? aliases : String(aliases || "").split(/[\n,]/))
      .map((alias) => normalizeKnowledgeSlug(alias, "alias")))]
      .filter((alias) => alias !== sourcePageSlug);
    for (const aliasSlug of requested) {
      if (pageSlugs.has(aliasSlug)) throw new Error(`Alias ${aliasSlug} conflicts with an existing page slug.`);
      const current = this.resolvePageAlias(aliasSlug);
      if (current && current.sourcePageSlug !== sourcePageSlug && current.targetSlug !== sourcePageSlug) {
        throw new Error(`Alias ${aliasSlug} already targets ${current.targetSlug}.`);
      }
    }
    this.db.prepare("DELETE FROM page_aliases WHERE source_page_slug = ?").run(sourcePageSlug);
    const now = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO page_aliases (alias_slug, target_slug, source_page_slug, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias_slug) DO UPDATE SET
        target_slug = excluded.target_slug,
        source_page_slug = excluded.source_page_slug,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at
    `);
    for (const aliasSlug of requested) insert.run(aliasSlug, sourcePageSlug, sourcePageSlug, session.user.id, now, now);
    return requested.map((aliasSlug) => this.resolvePageAlias(aliasSlug));
  }

  removePageAliasesForPage(slug) {
    const normalized = normalizeKnowledgeSlug(slug, "page");
    return this.db.prepare("DELETE FROM page_aliases WHERE source_page_slug = ? OR target_slug = ?").run(normalized, normalized).changes;
  }

  removePageAlias(session, aliasSlug) {
    if (!hasRole(session, "senior_editor")) throw accessError("只有资深编辑和管理员可以管理别名。");
    const normalized = normalizeKnowledgeSlug(aliasSlug, "别名");
    const result = this.db.prepare("DELETE FROM page_aliases WHERE alias_slug = ?").run(normalized);
    if (!result.changes) throw new Error("别名不存在。");
    return { ok: true, aliasSlug: normalized };
  }

  knowledgeSnapshot(pageList = [], options = {}) {
    const pages = Array.isArray(pageList) ? pageList : [];
    const pageMap = new Map(pages.map((page) => [page.slug, page]));
    const aliases = this.listPageAliases({ limit: 500, offset: 0 });
    const aliasMap = new Map(aliases.map((item) => [item.aliasSlug, item.targetSlug]));
    const links = this.db.prepare("SELECT * FROM page_links ORDER BY source_slug ASC, target_slug ASC").all().map(linkFromRow)
      .filter((link) => pageMap.has(link.sourceSlug));
    const incoming = new Map();
    const missing = new Map();
    const outgoing = new Map();
    for (const link of links) {
      const targetSlug = aliasMap.get(link.targetSlug) || link.targetSlug;
      const normalized = { ...link, targetSlug };
      if (!outgoing.has(link.sourceSlug)) outgoing.set(link.sourceSlug, []);
      outgoing.get(link.sourceSlug).push(normalized);
      if (pageMap.has(targetSlug)) {
        if (!incoming.has(targetSlug)) incoming.set(targetSlug, []);
        incoming.get(targetSlug).push(normalized);
      } else {
        const current = missing.get(targetSlug) || {
          slug: targetSlug,
          label: link.targetLabel || targetSlug,
          sourceSlugs: [],
          sourceCount: 0,
        };
        if (!current.sourceSlugs.includes(link.sourceSlug)) current.sourceSlugs.push(link.sourceSlug);
        current.sourceCount = current.sourceSlugs.length;
        missing.set(targetSlug, current);
      }
    }
    const defaultSlug = String(options.defaultSlug || "");
    const orphans = pages
      .filter((page) => page.slug !== defaultSlug && !(incoming.get(page.slug) || []).length)
      .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
    const categories = new Map();
    for (const page of pages) {
      for (const category of page.categories || []) {
        const key = cleanText(category, 80).replace(/\s+/g, " ");
        if (key) categories.set(key, Number(categories.get(key) || 0) + 1);
      }
    }
    return {
      stats: {
        pages: pages.length,
        links: links.length,
        backlinks: incoming.size,
        missing: missing.size,
        orphans: orphans.length,
        aliases: aliases.length,
        categories: categories.size,
      },
      links,
      aliases,
      incoming,
      outgoing,
      missing: [...missing.values()].sort((left, right) => right.sourceCount - left.sourceCount || left.slug.localeCompare(right.slug, "zh-CN")),
      orphans,
      categories: [...categories.entries()].map(([name, pageCount]) => ({ name, pageCount })).sort((left, right) => right.pageCount - left.pageCount || left.name.localeCompare(right.name, "zh-CN")),
      pageMap,
      aliasMap,
    };
  }

  pageKnowledge(slug, pageList = [], options = {}) {
    const canonicalSlug = normalizeKnowledgeSlug(slug);
    const snapshot = this.knowledgeSnapshot(pageList, options);
    const enrich = (link, direction) => {
      const page = direction === "outgoing" ? snapshot.pageMap.get(link.targetSlug) : snapshot.pageMap.get(link.sourceSlug);
      return {
        slug: direction === "outgoing" ? link.targetSlug : link.sourceSlug,
        title: page?.title || link.targetLabel || (direction === "outgoing" ? link.targetSlug : link.sourceSlug),
        summary: page?.summary || "",
        exists: Boolean(page),
        label: link.targetLabel || "",
      };
    };
    return {
      pageSlug: canonicalSlug,
      outgoing: (snapshot.outgoing.get(canonicalSlug) || []).map((link) => enrich(link, "outgoing")),
      backlinks: (snapshot.incoming.get(canonicalSlug) || []).map((link) => enrich(link, "backlink")),
      aliases: snapshot.aliases.filter((item) => item.targetSlug === canonicalSlug),
      stats: snapshot.stats,
    };
  }

  notifyKnowledgeWatchers(page, input = {}) {
    const pageSlug = normalizeKnowledgeSlug(page?.slug);
    const targets = [{ targetType: "page", targetKey: pageSlug }];
    for (const category of page?.categories || []) {
      const targetKey = cleanText(category, 80).replace(/\s+/g, " ");
      if (targetKey) targets.push({ targetType: "category", targetKey });
    }
    const language = normalizeTranslationLang(input.language, "");
    if (language) targets.push({ targetType: "language", targetKey: language });
    const where = targets.map(() => "(w.target_type = ? AND w.target_key = ?)").join(" OR ");
    const args = targets.flatMap((target) => [target.targetType, target.targetKey]);
    const recipients = this.db.prepare(`
      SELECT DISTINCT w.user_id
      FROM watch_subscriptions w
      JOIN users u ON u.id = w.user_id
      WHERE u.status = 'active' AND (${where})
    `).all(...args);
    const actorUserId = Number(input.actorUserId || 0) || null;
    const senderName = cleanText(input.senderName || "Wikist", 80) || "Wikist";
    const action = ({ create: "创建", update: "更新", delete: "归档", restore: "恢复", translation: "更新译文" })[input.action] || "更新";
    const sourceUrl = "#/page/" + pageSlug.split("/").map(encodeURIComponent).join("/");
    let count = 0;
    for (const recipient of recipients) {
      if (actorUserId && Number(recipient.user_id) === actorUserId) continue;
      this.insertMessage({
        recipientUserId: recipient.user_id,
        senderUserId: actorUserId,
        senderName,
        title: "关注的词条已" + action,
        body: (page.title || pageSlug) + " 已" + action + (language ? "（" + language + "）" : "") + "。",
        kind: "watch",
        sourceType: "knowledge",
        sourceUrl,
        sourceLabel: "查看词条",
      });
      count += 1;
    }
    return count;
  }

  notifyUserFollowers(page, input = {}) {
    const actorUserId = Number(input.actorUserId || 0);
    if (!actorUserId) return 0;
    const recipients = this.db.prepare(`
      SELECT f.follower_user_id
      FROM user_follows f
      JOIN users u ON u.id = f.follower_user_id
      WHERE f.following_user_id = ? AND u.status = 'active'
    `).all(actorUserId);
    const pageSlug = normalizeKnowledgeSlug(page?.slug);
    const senderName = cleanText(input.senderName || "Wikist", 80) || "Wikist";
    const action = ({ create: "created", update: "updated", delete: "archived", restore: "restored", translation: "updated a translation" })[input.action] || "updated";
    const language = normalizeTranslationLang(input.language, "");
    const sourceUrl = "#/page/" + pageSlug.split("/").map(encodeURIComponent).join("/");
    let count = 0;
    for (const recipient of recipients) {
      this.insertMessage({
        recipientUserId: recipient.follower_user_id,
        senderUserId: actorUserId,
        senderName,
        title: `${senderName} ${action} a page`,
        body: `${page.title || pageSlug} was ${action}${language ? ` (${language})` : ""}.`,
        kind: "follow",
        sourceType: "user-follow",
        sourceUrl,
        sourceLabel: "View page",
      });
      count += 1;
    }
    return count;
  }

  actorFromRequest(req, session, fallback = {}) {
    const cookies = parseCookies(req?.headers?.cookie || "");
    const guestId = String(fallback.guestId || cookies[this.guestCookieName] || "");
    if (session?.user) {
      return {
        actorType: "user",
        userId: session.user.id,
        guestId: "",
        actorName: session.user.displayName || session.user.username,
        actorLabel: `@${session.user.username}`,
      };
    }
    return {
      actorType: fallback.actorType || (guestId ? "guest" : "system"),
      userId: null,
      guestId,
      actorName: fallback.actorName || (guestId ? "访客" : "系统"),
      actorLabel: fallback.actorLabel || guestId || "system",
    };
  }

  recordAuditLog(req, session, input = {}) {
    const now = nowIso();
    const { ip, userAgent } = this.getRequestInfo(req || { socket: {}, headers: {} });
    const actor = this.actorFromRequest(req || { headers: {} }, session, input);
    const result = this.db.prepare(`
      INSERT INTO site_audit_logs (
        actor_type, user_id, guest_id, actor_name, actor_label, action, target_type, target_id,
        target_label, summary, metadata_json, ip, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor.actorType,
      actor.userId,
      actor.guestId || null,
      cleanText(actor.actorName, 80),
      cleanText(actor.actorLabel, 120),
      cleanText(input.action || "update", 80),
      cleanText(input.targetType || "", 80),
      cleanText(input.targetId || "", 180),
      cleanText(input.targetLabel || "", 180),
      cleanText(input.summary || "", 500),
      jsonText(input.metadata || {}),
      ip,
      userAgent,
      now,
    );
    return auditLogFromRow(this.db.prepare("SELECT * FROM site_audit_logs WHERE id = ?").get(result.lastInsertRowid));
  }

  auditWhere(options = {}) {
    const query = cleanText(options.query || "", 160).toLowerCase();
    const action = cleanText(options.action || "all", 80);
    const targetType = cleanText(options.targetType || "all", 80);
    const quietActions = ["auth.login", "auth.logout", "message.read", "message.readAll", "message.delete", "message.broadcast", "message.revoke", "translation.auto", "translation.join"];
    const where = [`action NOT IN (${quietActions.map(() => "?").join(", ")})`];
    const args = [...quietActions];
    if (query) {
      const like = `%${query}%`;
      where.push("(lower(actor_name) LIKE ? OR lower(actor_label) LIKE ? OR lower(action) LIKE ? OR lower(target_id) LIKE ? OR lower(target_label) LIKE ? OR lower(summary) LIKE ?)");
      args.push(like, like, like, like, like, like);
    }
    if (action && action !== "all") {
      where.push("action = ?");
      args.push(action);
    }
    if (targetType && targetType !== "all") {
      where.push("target_type = ?");
      args.push(targetType);
    }
    return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
  }

  listAuditLogs(options = {}) {
    const { limit, offset } = listOptions(options, 30, 200);
    const { clause, args } = this.auditWhere(options);
    return this.db.prepare(`
      SELECT * FROM site_audit_logs ${clause}
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset).map(auditLogFromRow);
  }

  countAuditLogs(options = {}) {
    const { clause, args } = this.auditWhere(options);
    return this.db.prepare(`SELECT count(*) AS n FROM site_audit_logs ${clause}`).get(...args).n;
  }

  getTranslatorProfile(userId) {
    return translatorFromRow(this.db.prepare("SELECT * FROM translator_members WHERE user_id = ?").get(Number(userId)));
  }

  joinTranslatorCommunity(session, input = {}) {
    if (!session?.user) throw accessError("请先登录后加入翻译社区。", 401);
    const languages = Array.from(new Set((Array.isArray(input.languages) ? input.languages : String(input.languages || "en,zh-TW").split(","))
      .map((item) => normalizeTranslationLang(item, ""))
      .filter((lang) => lang !== "zh-CN"))).slice(0, 8);
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO translator_members (user_id, languages_json, joined_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET languages_json = excluded.languages_json, updated_at = excluded.updated_at
    `).run(session.user.id, jsonText(languages.length ? languages : ["en"]), now, now);
    return this.getTranslatorProfile(session.user.id);
  }

  assertTranslator(session) {
    if (!session?.user) throw accessError("请先登录后参与词条翻译。", 401);
    const profile = this.getTranslatorProfile(session.user.id);
    if (!profile) throw accessError("请先加入翻译社区。", 403);
    return profile;
  }

  getTranslation(pageSlug, language) {
    return translationFromRow(this.db.prepare(`
      SELECT t.*, u.username AS translator_username, u.display_name AS translator_name
      FROM page_translations t
      LEFT JOIN users u ON u.id = t.translator_user_id
      WHERE t.page_slug = ? AND t.language = ?
    `).get(String(pageSlug || ""), normalizeTranslationLang(language)));
  }

  translationSummary(pageSlug, sourceMd, extraLanguages = []) {
    const rows = this.db.prepare(`
      SELECT t.*, u.username AS translator_username, u.display_name AS translator_name
      FROM page_translations t
      LEFT JOIN users u ON u.id = t.translator_user_id
      WHERE t.page_slug = ?
      ORDER BY t.language ASC
    `).all(String(pageSlug || "")).map(translationFromRow);
    const byLang = new Map(rows.map((row) => [row.language, row]));
    const languages = Array.from(new Set([
      "zh-CN",
      ...DEFAULT_TRANSLATION_LANGUAGES,
      ...(Array.isArray(extraLanguages) ? extraLanguages : String(extraLanguages || "").split(",")),
      ...rows.map((row) => row.language),
    ].map((item) => normalizeTranslationLang(item, "")).filter(Boolean)));
    return languages.map((language) => {
      if (language === "zh-CN") return { language, status: "source", progress: 100 };
      const row = byLang.get(language);
      return row ? { language, status: row.status, progress: row.progress, updatedAt: row.updatedAt, translatorName: row.translatorName } : { language, status: "missing", progress: 0 };
    });
  }

  saveTranslation(session, pageSlug, sourcePage, input = {}) {
    this.assertTranslator(session);
    const language = normalizeTranslationLang(input.language);
    if (language === "zh-CN") throw new Error("源语言不需要创建译文。");
    const translatedMd = cleanText(input.translatedMd || input.body || "", 1024 * 1024);
    const title = cleanText(input.title || sourcePage.title || "", 200);
    const summary = cleanText(input.summary || sourcePage.summary || "", 500);
    const progress = translationProgress(sourcePage.body || "", translatedMd);
    const status = progress >= 95 ? "published" : "draft";
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO page_translations (
        page_slug, language, source_language, title, summary, source_md, translated_md,
        progress, status, translator_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_slug, language) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        source_md = excluded.source_md,
        translated_md = excluded.translated_md,
        progress = excluded.progress,
        status = excluded.status,
        translator_user_id = excluded.translator_user_id,
        updated_at = excluded.updated_at
    `).run(sourcePage.slug || pageSlug, language, input.sourceLanguage || "zh-CN", title, summary, sourcePage.body || "", translatedMd, progress, status, session.user.id, now, now);
    return this.getTranslation(sourcePage.slug || pageSlug, language);
  }

  autoTranslationDraft(session, pageSlug, sourcePage, input = {}) {
    this.assertTranslator(session);
    const language = normalizeTranslationLang(input.language);
    if (language === "zh-CN") throw new Error("源语言不需要自动翻译。");
    return {
      language,
      title: basicAutoTranslateText(sourcePage.title || pageSlug, language),
      summary: basicAutoTranslateText(sourcePage.summary || "", language),
      translatedMd: basicAutoTranslateText(sourcePage.body || "", language),
      progress: translationProgress(sourcePage.body || "", basicAutoTranslateText(sourcePage.body || "", language)),
      sourceLanguage: "zh-CN",
    };
  }

  getRequestInfo(req) {
    return {
      ip: String(req.socket.remoteAddress || "").slice(0, 80),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
    };
  }

  validateGuestInput(input, requireEmail = true) {
    const displayName = cleanGuestName(input?.guestName || input?.displayName || input?.authorName);
    const email = normalizeEmail(input?.guestEmail || input?.email || input?.authorEmail);
    const website = cleanText(input?.guestWebsite || input?.website || "", 160);
    if (requireEmail && !email) throw new Error("访客需要填写邮箱。");
    assertEmail(email);
    return { displayName, email: email || "", website };
  }

  getOrCreateGuest(req, input = {}) {
    const cookies = parseCookies(req.headers.cookie);
    const now = nowIso();
    const { ip, userAgent } = this.getRequestInfo(req);
    const guestInfo = input.displayName ? input : this.validateGuestInput(input, true);
    let id = String(cookies[this.guestCookieName] || "").trim();
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) id = `guest_${randomToken(18)}`;

    const existing = this.db.prepare("SELECT * FROM guest_profiles WHERE id = ?").get(id);
    if (existing) {
      this.db.prepare(`
        UPDATE guest_profiles
        SET display_name = ?, email = ?, website = ?, last_seen_at = ?, ip_last = ?, user_agent = ?
        WHERE id = ?
      `).run(guestInfo.displayName, guestInfo.email, guestInfo.website, now, ip, userAgent, id);
      return { id, ...guestInfo, isNew: false, cookie: guestCookie(id) };
    }

    this.db.prepare(`
      INSERT INTO guest_profiles (id, display_name, email, website, first_seen_at, last_seen_at, ip_first, ip_last, user_agent, edit_count, comment_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(id, guestInfo.displayName, guestInfo.email, guestInfo.website, now, now, ip, ip, userAgent);
    return { id, ...guestInfo, isNew: true, cookie: guestCookie(id) };
  }

  getPagePermissions(slug) {
    const row = this.db.prepare("SELECT * FROM page_permissions WHERE page_slug = ?").get(slug);
    return permissionsFromRow(slug, row);
  }

  assertCanAccessDashboard(session) {
    if (!session?.user) throw accessError("\u8bf7\u5148\u767b\u5f55\u540e\u8bbf\u95ee\u540e\u53f0\u3002", 401);
    if (!hasRole(session, "senior_editor")) throw accessError("\u540e\u53f0\u4ec5\u5141\u8bb8\u8d44\u6df1\u7f16\u8f91\u548c\u7ba1\u7406\u5458\u8bbf\u95ee\u3002");
  }

  assertCanManageUsers(session) {
    if (!session?.user) throw accessError("\u8bf7\u5148\u767b\u5f55\u540e\u7ba1\u7406\u7528\u6237\u3002", 401);
    if (!hasRole(session, "admin")) throw accessError("\u7528\u6237\u7ba1\u7406\u4ec5\u5141\u8bb8\u7ba1\u7406\u5458\u8bbf\u95ee\u3002");
  }

  assertCanManagePermissions(session) {
    if (!session?.user) throw accessError("\u8bf7\u5148\u767b\u5f55\u540e\u4fee\u6539\u6743\u9650\u3002", 401);
    if (!hasRole(session, "senior_editor")) throw accessError("\u53ea\u6709\u8d44\u6df1\u7f16\u8f91\u548c\u7ba1\u7406\u5458\u53ef\u4ee5\u4fee\u6539\u8bcd\u6761\u6743\u9650\u3002");
  }

  assertCanReview(session) {
    if (!session?.user) throw accessError("请先登录后审核词条。", 401);
    if (!hasRole(session, "senior_editor")) throw accessError("只有资深编辑和管理员可以审核稳定版本。");
  }

  getPageReview(slug, currentRevisionId = "") {
    const pageSlug = normalizeSlug(slug);
    const stable = this.db.prepare("SELECT * FROM page_stable_revisions WHERE page_slug = ?").get(pageSlug);
    const latest = this.db.prepare("SELECT * FROM page_review_notes WHERE page_slug = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(pageSlug);
    return { ...pageReviewFromRow(stable, currentRevisionId, latest), pageSlug };
  }

  getPageReviewStates(pages = []) {
    const stableRows = this.db.prepare("SELECT * FROM page_stable_revisions").all();
    const stableBySlug = new Map(stableRows.map((row) => [row.page_slug, row]));
    return pages.map((page) => ({ ...pageReviewFromRow(stableBySlug.get(page.slug), page.revisionId || ""), pageSlug: page.slug }));
  }

  listPageReviewNotes(slug, options = {}) {
    const pageSlug = normalizeSlug(slug);
    const limit = Math.max(1, Math.min(Number(options.limit) || 12, 80));
    const offset = Math.max(0, Number(options.offset) || 0);
    return this.db.prepare(`
      SELECT * FROM page_review_notes
      WHERE page_slug = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(pageSlug, limit, offset).map((row) => ({
      id: row.id,
      pageSlug: row.page_slug,
      revisionId: row.revision_id,
      decision: row.decision,
      reviewerUserId: row.reviewer_user_id || null,
      reviewerName: row.reviewer_name || "",
      comment: row.comment || "",
      createdAt: row.created_at,
    }));
  }

  countPageReviewNotes(slug) {
    return Number(this.db.prepare("SELECT count(*) AS n FROM page_review_notes WHERE page_slug = ?").get(normalizeSlug(slug)).n || 0);
  }

  recordPageReview(session, page, input = {}) {
    this.assertCanReview(session);
    const decision = input.decision === "approve" ? "approve" : input.decision === "changes_requested" ? "changes_requested" : "";
    if (!decision) throw accessError("审核决定无效。", 400);
    const pageSlug = normalizeSlug(page?.slug || "");
    const revisionId = String(page?.revisionId || "").replace(/[^0-9TZ-]/g, "");
    if (!pageSlug || !revisionId) throw accessError("当前词条版本不可审核。", 400);
    const comment = cleanText(input.comment, 2000);
    const reviewer = session.user.displayName || session.user.username || "Wikist Reviewer";
    const now = nowIso();
    if (decision === "approve") {
      this.db.prepare(`
        INSERT INTO page_stable_revisions (page_slug, stable_revision_id, reviewer_user_id, reviewer_name, review_comment, reviewed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(page_slug) DO UPDATE SET
          stable_revision_id = excluded.stable_revision_id,
          reviewer_user_id = excluded.reviewer_user_id,
          reviewer_name = excluded.reviewer_name,
          review_comment = excluded.review_comment,
          reviewed_at = excluded.reviewed_at,
          updated_at = excluded.updated_at
      `).run(pageSlug, revisionId, session.user.id, reviewer, comment, now, now);
    }
    this.db.prepare(`
      INSERT INTO page_review_notes (page_slug, revision_id, decision, reviewer_user_id, reviewer_name, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pageSlug, revisionId, decision, session.user.id, reviewer, comment, now);
    return this.getPageReview(pageSlug, revisionId);
  }

  updatePagePermissions(slug, input, userId) {
    const editPolicy = input.editPolicy || DEFAULT_PERMISSIONS.editPolicy;
    const commentPolicy = input.commentPolicy || DEFAULT_PERMISSIONS.commentPolicy;
    const deletePolicy = input.deletePolicy || DEFAULT_PERMISSIONS.deletePolicy;
    assertPolicy(editPolicy, "\u7f16\u8f91");
    assertPolicy(commentPolicy, "\u8bc4\u8bba");
    assertDeletePolicy(deletePolicy);
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO page_permissions (page_slug, edit_policy, comment_policy, delete_policy, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_slug) DO UPDATE SET
        edit_policy = excluded.edit_policy,
        comment_policy = excluded.comment_policy,
        delete_policy = excluded.delete_policy,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(slug, editPolicy, commentPolicy, deletePolicy, userId || null, now);
    return this.getPagePermissions(slug);
  }

  assertCanEdit(slug, session) {
    const permission = this.getPagePermissions(slug);
    if (permission.editPolicy === "locked") throw accessError("该词条已锁定，暂不可编辑。");
    if (permission.editPolicy === "user" && !session?.user) throw accessError("该词条仅允许登录用户编辑。", 401);
    return permission;
  }

  assertCanDelete(slug, session) {
    const permission = this.getPagePermissions(slug);
    if (permission.deletePolicy === "locked") throw accessError("该词条已锁定，暂不可删除。");
    if (permission.deletePolicy === "user" && !session?.user) throw accessError("请先登录后再删除词条。", 401);
    return permission;
  }

  assertCanComment(slug, session) {
    const permission = this.getPagePermissions(slug);
    if (permission.commentPolicy === "locked") throw accessError("该词条已关闭评论。");
    if (permission.commentPolicy === "user" && !session?.user) throw accessError("该词条仅允许登录用户评论。", 401);
    return permission;
  }

  syncUserActivity(userId, now = nowIso()) {
    this.db.prepare("UPDATE users SET updated_at = ?, last_sync_at = ? WHERE id = ?").run(now, now, userId);
  }

  recordPageEdit(req, session, page, options = {}) {
    const now = nowIso();
    const { ip, userAgent } = this.getRequestInfo(req);
    let editorType = "guest";
    let userId = null;
    let guestId = null;
    let editorName = "访客";
    let editorLabel = "访客";
    let guestEmail = "";
    let cookie = null;

    if (session?.user) {
      editorType = "user";
      userId = session.user.id;
      editorName = session.user.displayName || session.user.username;
      editorLabel = `@${session.user.username}`;
      this.syncUserActivity(userId, now);
    } else {
      const guest = this.getOrCreateGuest(req, options.guest || {});
      guestId = guest.id;
      cookie = guest.cookie;
      guestEmail = guest.email;
      editorName = guest.displayName;
      editorLabel = `${guest.displayName} · 访客`;
      this.db.prepare("UPDATE guest_profiles SET edit_count = edit_count + 1, last_seen_at = ?, ip_last = ?, user_agent = ? WHERE id = ?")
        .run(now, ip, userAgent, guest.id);
    }

    const result = this.db.prepare(`
      INSERT INTO page_edit_events (
        page_slug, page_title, action, editor_type, user_id, guest_id,
        editor_name, editor_label, guest_email, ip, user_agent, page_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(page.slug, page.title, options.action || "update", editorType, userId, guestId, editorName, editorLabel, guestEmail, ip, userAgent, page.bytes || 0, now);
    const event = this.getEditEvent(result.lastInsertRowid);
    this.recordAuditLog(req, session, {
      actorType: editorType,
      guestId,
      actorName: editorName,
      actorLabel: editorLabel,
      action: `page.${options.action || "update"}`,
      targetType: "page",
      targetId: page.slug,
      targetLabel: page.title,
      summary: `${editorName} ${options.action || "update"} ${page.title}`,
      metadata: { editEventId: event.id, bytes: page.bytes || 0 },
    });
    return { cookie, event };
  }

  getEditEvent(id) {
    return editEventFromRow(this.db.prepare("SELECT * FROM page_edit_events WHERE id = ?").get(id));
  }

  listPageEdits(slug, options = 20) {
    const { limit, offset } = listOptions(options, 20, 100);
    return this.db.prepare(`
      SELECT * FROM page_edit_events WHERE page_slug = ? ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(String(slug || ""), limit, offset).map(editEventFromRow);
  }

  countPageEdits(slug) {
    return this.db.prepare("SELECT count(*) AS n FROM page_edit_events WHERE page_slug = ?")
      .get(String(slug || "")).n;
  }

  listUserEdits(username, limit = 20) {
    const row = this.findUser(username);
    if (!row) return [];
    return this.db.prepare(`
      SELECT * FROM page_edit_events WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(row.id, Math.max(1, Math.min(Number(limit) || 20, 100))).map(editEventFromRow);
  }

  commentParentTarget(slug, input = {}) {
    const rawParentId = Number(input.parentId || 0);
    if (!rawParentId) return { parentId: null, mention: "" };
    const pageSlug = String(slug || "");
    const parent = this.db.prepare(`
      SELECT c.*, u.username AS author_username
      FROM page_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ? AND c.page_slug = ? AND c.status = 'published'
    `).get(rawParentId, pageSlug);
    if (!parent) throw new Error("要回复的评论不存在。");
    if (!parent.parent_id) return { parentId: parent.id, mention: "" };
    const root = this.db.prepare("SELECT * FROM page_comments WHERE id = ? AND page_slug = ? AND status = 'published' AND parent_id IS NULL")
      .get(parent.parent_id, pageSlug);
    if (!root) throw new Error("要回复的一级评论不存在。");
    const mentionName = parent.author_type === "user" && parent.author_username ? parent.author_username : parent.author_name;
    const mention = mentionName ? `@${mentionName} ` : "";
    return { parentId: root.id, mention };
  }

  createComment(req, session, slug, input) {
    input = input || {};
    this.assertCanComment(slug, session);
    const parentTarget = this.commentParentTarget(slug, input || {});
    let content = cleanText(input.contentMd || input.content || "", COMMENT_MAX_LENGTH);
    if (parentTarget.mention && !content.startsWith(parentTarget.mention)) {
      content = cleanText(`${parentTarget.mention}${content}`, COMMENT_MAX_LENGTH);
    }
    if (!content) throw new Error("评论内容不能为空。");
    const now = nowIso();
    const { ip, userAgent } = this.getRequestInfo(req);
    let authorType = "guest";
    let userId = null;
    let guestId = null;
    let authorName = "访客";
    let authorEmail = "";
    let authorWebsite = "";
    let cookie = null;

    if (session?.user) {
      authorType = "user";
      userId = session.user.id;
      authorName = session.user.displayName || session.user.username;
      authorEmail = session.user.email || "";
      this.syncUserActivity(userId, now);
    } else {
      const guest = this.getOrCreateGuest(req, input);
      guestId = guest.id;
      cookie = guest.cookie;
      authorName = guest.displayName;
      authorEmail = guest.email;
      authorWebsite = guest.website;
      this.db.prepare("UPDATE guest_profiles SET comment_count = comment_count + 1, last_seen_at = ?, ip_last = ?, user_agent = ? WHERE id = ?")
        .run(now, ip, userAgent, guest.id);
    }

    const result = this.db.prepare(`
      INSERT INTO page_comments (
        page_slug, parent_id, author_type, user_id, guest_id, author_name, author_email, author_website,
        content_md, status, ip, user_agent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)
    `).run(String(slug || ""), parentTarget.parentId, authorType, userId, guestId, authorName, authorEmail, authorWebsite, content, ip, userAgent, now, now);

    const comment = this.getComment(result.lastInsertRowid);
    this.notifyMentionsForComment(comment, content, session);
    this.recordAuditLog(req, session, {
      actorType: authorType,
      guestId,
      actorName: authorName,
      actorLabel: authorType === "user" && session?.user ? `@${session.user.username}` : `${authorName} · 访客`,
      action: "comment.create",
      targetType: "comment",
      targetId: String(comment.id),
      targetLabel: String(slug || ""),
      summary: "发布评论",
      metadata: { pageSlug: String(slug || ""), parentId: parentTarget.parentId || null },
    });
    return { cookie, comment };
  }

  getComment(id) {
    return commentFromRow(this.db.prepare(`
      SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar_url, (
        SELECT count(*) FROM page_comments child WHERE child.parent_id = c.id AND child.status = 'published'
      ) AS reply_count
      FROM page_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
    `).get(id));
  }

  listComments(slug, options = 100) {
    const { limit, offset } = listOptions(options, 100, 300);
    return this.db.prepare(`
      SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar_url, (
        SELECT count(*) FROM page_comments child WHERE child.parent_id = c.id AND child.status = 'published'
      ) AS reply_count
      FROM page_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.page_slug = ? AND c.status = 'published' AND c.parent_id IS NULL
      ORDER BY c.id DESC LIMIT ? OFFSET ?
    `).all(String(slug || ""), limit, offset).map(commentFromRow);
  }

  countComments(slug) {
    return this.db.prepare("SELECT count(*) AS n FROM page_comments WHERE page_slug = ? AND status = 'published' AND parent_id IS NULL")
      .get(String(slug || "")).n;
  }

  listCommentReplies(slug, parentId, options = 20) {
    const { limit, offset } = listOptions(options, 20, 80);
    const pageSlug = String(slug || "");
    const root = this.db.prepare("SELECT id FROM page_comments WHERE id = ? AND page_slug = ? AND status = 'published' AND parent_id IS NULL")
      .get(Number(parentId), pageSlug);
    if (!root) throw new Error("一级评论不存在或已隐藏。");
    return this.db.prepare(`
      SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar_url, 0 AS reply_count
      FROM page_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.page_slug = ? AND c.status = 'published' AND c.parent_id = ?
      ORDER BY c.id ASC LIMIT ? OFFSET ?
    `).all(pageSlug, Number(parentId), limit, offset).map(commentFromRow);
  }

  countCommentReplies(slug, parentId) {
    return this.db.prepare("SELECT count(*) AS n FROM page_comments WHERE page_slug = ? AND status = 'published' AND parent_id = ?")
      .get(String(slug || ""), Number(parentId)).n;
  }

  commentWhere(options = {}, extra = []) {
    const query = cleanText(options.query || "", 120).toLowerCase();
    const status = cleanText(options.status || "all", 40).toLowerCase();
    const where = [...extra];
    const args = [];
    if (query) {
      const like = `%${query}%`;
      where.push("(lower(c.page_slug) LIKE ? OR lower(c.author_name) LIKE ? OR lower(coalesce(c.author_email, '')) LIKE ? OR lower(c.content_md) LIKE ?)");
      args.push(like, like, like, like);
    }
    if (status && status !== "all") {
      where.push("c.status = ?");
      args.push(status);
    }
    return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
  }

  listAllComments(options = {}) {
    const { limit, offset } = listOptions(options, 30, 200);
    const { clause, args } = this.commentWhere(options, ["c.parent_id IS NULL"]);
    return this.db.prepare(`
      SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar_url, (
        SELECT count(*) FROM page_comments child WHERE child.parent_id = c.id
      ) AS reply_count
      FROM page_comments c
      LEFT JOIN users u ON u.id = c.user_id
      ${clause}
      ORDER BY c.id DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset).map(commentFromRow);
  }

  countAllComments(options = {}) {
    const { clause, args } = this.commentWhere(options, ["c.parent_id IS NULL"]);
    return this.db.prepare(`SELECT count(*) AS n FROM page_comments c ${clause}`).get(...args).n;
  }

  listAllCommentReplies(parentId, options = {}) {
    const { limit, offset } = listOptions(options, 30, 200);
    const parent = this.getComment(parentId);
    if (!parent || parent.parentId) throw new Error("一级评论不存在。");
    const { clause, args } = this.commentWhere(options, ["c.parent_id = ?"]);
    return this.db.prepare(`
      SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar_url, 0 AS reply_count
      FROM page_comments c
      LEFT JOIN users u ON u.id = c.user_id
      ${clause}
      ORDER BY c.id ASC LIMIT ? OFFSET ?
    `).all(Number(parentId), ...args, limit, offset).map(commentFromRow);
  }

  countAllCommentReplies(parentId, options = {}) {
    const parent = this.getComment(parentId);
    if (!parent || parent.parentId) throw new Error("一级评论不存在。");
    const { clause, args } = this.commentWhere(options, ["c.parent_id = ?"]);
    return this.db.prepare(`SELECT count(*) AS n FROM page_comments c ${clause}`).get(Number(parentId), ...args).n;
  }
  updateCommentStatus(id, status) {
    const next = ["published", "hidden", "deleted"].includes(status) ? status : null;
    if (!next) throw new Error("\u8bc4\u8bba\u72b6\u6001\u65e0\u6548\u3002");
    const result = this.db.prepare("UPDATE page_comments SET status = ?, updated_at = ? WHERE id = ?").run(next, nowIso(), Number(id));
    if (!result.changes) throw new Error("\u8bc4\u8bba\u4e0d\u5b58\u5728\u3002");
    return this.getComment(id);
  }

  canDeleteComment(req, session, comment) {
    if (!comment) return false;
    if (hasRole(session, "senior_editor")) return true;
    if (session?.user && comment.userId && Number(comment.userId) === Number(session.user.id)) return true;
    const guestId = parseCookies(req?.headers?.cookie || "")[this.guestCookieName];
    return Boolean(guestId && comment.guestId && guestId === comment.guestId);
  }

  deleteComment(req, session, id) {
    const comment = this.getComment(id);
    if (!comment) throw new Error("评论不存在。");
    if (!this.canDeleteComment(req, session, comment)) throw accessError("只有评论作者或后台管理员可以删除评论。", session?.user ? 403 : 401);
    const result = this.db.prepare("UPDATE page_comments SET status = 'deleted', updated_at = ? WHERE id = ?").run(nowIso(), Number(id));
    if (!result.changes) throw new Error("评论不存在。");
    return this.getComment(id);
  }

  messagePayload(input = {}, defaults = {}) {
    const title = cleanText(input.title || defaults.title || "", MESSAGE_TITLE_MAX_LENGTH);
    if (!title) throw new Error("消息标题不能为空。");
    const body = cleanText(input.body || input.content || defaults.body || "", MESSAGE_BODY_MAX_LENGTH);
    return {
      title,
      body,
      kind: cleanText(input.kind || defaults.kind || "system", 40) || "system",
      priority: ["low", "normal", "high", "urgent"].includes(String(input.priority || defaults.priority || "normal").toLowerCase())
        ? String(input.priority || defaults.priority || "normal").toLowerCase()
        : "normal",
      displaySeconds: Math.max(3, Math.min(Number(input.displaySeconds || defaults.displaySeconds || 7) || 7, 60)),
      sourceType: cleanText(input.sourceType || defaults.sourceType || "", 60),
      sourceUrl: cleanText(input.sourceUrl || defaults.sourceUrl || "", 300),
      sourceLabel: cleanText(input.sourceLabel || defaults.sourceLabel || "", 80),
    };
  }

  insertMessage(input) {
    const now = nowIso();
    const payload = this.messagePayload(input);
    const result = this.db.prepare(`
      INSERT INTO user_messages (
        recipient_user_id, sender_user_id, sender_name, title, body, kind, priority, display_seconds,
        source_type, source_url, source_label, status, created_at, read_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, '', '')
    `).run(
      Number(input.recipientUserId),
      input.senderUserId ? Number(input.senderUserId) : null,
      cleanText(input.senderName || "Wikist", 80) || "Wikist",
      payload.title,
      payload.body,
      payload.kind,
      payload.priority,
      payload.displaySeconds,
      payload.sourceType,
      payload.sourceUrl,
      payload.sourceLabel,
      now,
    );
    return this.getMessage(result.lastInsertRowid);
  }

  getMessage(id) {
    return messageFromRow(this.db.prepare(`
      SELECT m.*, m.id AS raw_id, 'direct' AS channel, m.id AS user_message_id, NULL AS site_message_id,
        '' AS broadcast_status, '' AS recalled_at, 1 AS delivery_count,
        CASE WHEN m.status = 'read' THEN 1 ELSE 0 END AS read_count,
        CASE WHEN m.deleted_at != '' THEN 1 ELSE 0 END AS deleted_count,
        ru.username AS recipient_username, ru.display_name AS recipient_name,
        su.username AS sender_username
      FROM user_messages m
      LEFT JOIN users ru ON ru.id = m.recipient_user_id
      LEFT JOIN users su ON su.id = m.sender_user_id
      WHERE m.id = ?
    `).get(Number(id)));
  }

  activeUserCount() {
    return this.db.prepare("SELECT count(*) AS n FROM users WHERE status = 'active'").get().n;
  }

  getSiteMessageForUser(userId, siteMessageId) {
    return messageFromRow(this.db.prepare(`
      SELECT -sm.id AS id, sm.id AS raw_id, 'site' AS channel, NULL AS user_message_id, sm.id AS site_message_id,
        ? AS recipient_user_id, '' AS recipient_username, '' AS recipient_name,
        sm.sender_user_id, su.username AS sender_username, sm.sender_name, sm.title, sm.body, sm.kind, sm.priority,
        sm.display_seconds, sm.source_type, sm.source_url, sm.source_label,
        COALESCE(ms.status, 'unread') AS status, sm.status AS broadcast_status,
        sm.created_at, COALESCE(ms.read_at, '') AS read_at, COALESCE(ms.deleted_at, '') AS deleted_at,
        sm.recalled_at, ? AS delivery_count,
        (SELECT count(*) FROM site_message_states rs WHERE rs.message_id = sm.id AND rs.status = 'read' AND rs.deleted_at = '') AS read_count,
        (SELECT count(*) FROM site_message_states ds WHERE ds.message_id = sm.id AND ds.deleted_at != '') AS deleted_count
      FROM site_messages sm
      LEFT JOIN site_message_states ms ON ms.message_id = sm.id AND ms.user_id = ?
      LEFT JOIN users su ON su.id = sm.sender_user_id
      WHERE sm.id = ? AND sm.status = 'active' AND COALESCE(ms.deleted_at, '') = ''
    `).get(Number(userId), this.activeUserCount(), Number(userId), Number(siteMessageId)));
  }

  listMessages(userId, options = {}) {
    const { limit, offset } = listOptions(options, 20, 100);
    const status = cleanText(options.status || "all", 40).toLowerCase();
    const priority = cleanText(options.priority || "all", 20).toLowerCase();
    const where = [];
    const args = [Number(userId), Number(userId), Number(userId)];
    if (status === "read" || status === "unread") {
      where.push("status = ?");
      args.push(status);
    }
    if (["low", "normal", "high", "urgent"].includes(priority)) {
      where.push("priority = ?");
      args.push(priority);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`
      WITH combined AS (
        SELECT m.id AS id, m.id AS raw_id, 'direct' AS channel, m.id AS user_message_id, NULL AS site_message_id,
          m.recipient_user_id, ru.username AS recipient_username, ru.display_name AS recipient_name,
          m.sender_user_id, su.username AS sender_username, m.sender_name, m.title, m.body, m.kind,
          m.source_type, m.source_url, m.source_label, m.status, m.priority, m.display_seconds, '' AS broadcast_status,
          m.created_at, m.read_at, m.deleted_at, '' AS recalled_at,
          1 AS delivery_count, CASE WHEN m.status = 'read' THEN 1 ELSE 0 END AS read_count,
          CASE WHEN m.deleted_at != '' THEN 1 ELSE 0 END AS deleted_count
        FROM user_messages m
        LEFT JOIN users ru ON ru.id = m.recipient_user_id
        LEFT JOIN users su ON su.id = m.sender_user_id
        WHERE m.recipient_user_id = ? AND m.deleted_at = ''
        UNION ALL
        SELECT -sm.id AS id, sm.id AS raw_id, 'site' AS channel, NULL AS user_message_id, sm.id AS site_message_id,
          ? AS recipient_user_id, '' AS recipient_username, '' AS recipient_name,
          sm.sender_user_id, su.username AS sender_username, sm.sender_name, sm.title, sm.body, sm.kind,
          sm.source_type, sm.source_url, sm.source_label, COALESCE(ms.status, 'unread') AS status, sm.priority, sm.display_seconds, sm.status AS broadcast_status,
          sm.created_at, COALESCE(ms.read_at, '') AS read_at, COALESCE(ms.deleted_at, '') AS deleted_at, sm.recalled_at,
          0 AS delivery_count,
          (SELECT count(*) FROM site_message_states rs WHERE rs.message_id = sm.id AND rs.status = 'read' AND rs.deleted_at = '') AS read_count,
          (SELECT count(*) FROM site_message_states ds WHERE ds.message_id = sm.id AND ds.deleted_at != '') AS deleted_count
        FROM site_messages sm
        LEFT JOIN site_message_states ms ON ms.message_id = sm.id AND ms.user_id = ?
        LEFT JOIN users su ON su.id = sm.sender_user_id
        WHERE sm.status = 'active' AND COALESCE(ms.deleted_at, '') = ''
      )
      SELECT * FROM combined ${clause}
      ORDER BY created_at DESC, raw_id DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset).map(messageFromRow);
  }

  countMessages(userId, options = {}) {
    const status = cleanText(options.status || "all", 40).toLowerCase();
    const priority = cleanText(options.priority || "all", 20).toLowerCase();
    const where = [];
    const args = [Number(userId), Number(userId)];
    if (status === "read" || status === "unread") {
      where.push("status = ?");
      args.push(status);
    }
    if (["low", "normal", "high", "urgent"].includes(priority)) {
      where.push("priority = ?");
      args.push(priority);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`
      WITH combined AS (
        SELECT m.status, m.priority
        FROM user_messages m
        WHERE m.recipient_user_id = ? AND m.deleted_at = ''
        UNION ALL
        SELECT COALESCE(ms.status, 'unread') AS status, sm.priority
        FROM site_messages sm
        LEFT JOIN site_message_states ms ON ms.message_id = sm.id AND ms.user_id = ?
        WHERE sm.status = 'active' AND COALESCE(ms.deleted_at, '') = ''
      )
      SELECT count(*) AS n FROM combined ${clause}
    `).get(...args).n;
  }

  unreadMessageCount(userId) {
    const direct = this.db.prepare("SELECT count(*) AS n FROM user_messages WHERE recipient_user_id = ? AND status = 'unread' AND deleted_at = ''")
      .get(Number(userId)).n;
    const site = this.db.prepare(`
      SELECT count(*) AS n
      FROM site_messages sm
      LEFT JOIN site_message_states ms ON ms.message_id = sm.id AND ms.user_id = ?
      WHERE sm.status = 'active' AND COALESCE(ms.deleted_at, '') = '' AND COALESCE(ms.status, 'unread') = 'unread'
    `).get(Number(userId)).n;
    return direct + site;
  }

  markMessageRead(userId, id) {
    const messageId = Number(id);
    if (messageId < 0) {
      const siteMessageId = Math.abs(messageId);
      const existing = this.getSiteMessageForUser(userId, siteMessageId);
      if (!existing) throw new Error("消息不存在。");
      const now = nowIso();
      this.db.prepare(`
        INSERT INTO site_message_states (message_id, user_id, status, read_at, deleted_at)
        VALUES (?, ?, 'read', ?, '')
        ON CONFLICT(message_id, user_id) DO UPDATE SET
          status = 'read',
          read_at = CASE WHEN site_message_states.read_at = '' THEN excluded.read_at ELSE site_message_states.read_at END
      `).run(siteMessageId, Number(userId), now);
      return this.getSiteMessageForUser(userId, siteMessageId);
    }
    const result = this.db.prepare(`
      UPDATE user_messages SET status = 'read', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END
      WHERE id = ? AND recipient_user_id = ? AND deleted_at = ''
    `).run(nowIso(), messageId, Number(userId));
    if (!result.changes) throw new Error("消息不存在。");
    return this.getMessage(messageId);
  }

  markAllMessagesRead(userId) {
    const now = nowIso();
    const direct = this.db.prepare(`
      UPDATE user_messages SET status = 'read', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END
      WHERE recipient_user_id = ? AND status = 'unread' AND deleted_at = ''
    `).run(now, Number(userId));
    const site = this.db.prepare(`
      INSERT INTO site_message_states (message_id, user_id, status, read_at, deleted_at)
      SELECT sm.id, ?, 'read', ?, ''
      FROM site_messages sm
      LEFT JOIN site_message_states ms ON ms.message_id = sm.id AND ms.user_id = ?
      WHERE sm.status = 'active' AND COALESCE(ms.deleted_at, '') = '' AND COALESCE(ms.status, 'unread') = 'unread'
      ON CONFLICT(message_id, user_id) DO UPDATE SET
        status = 'read',
        read_at = CASE WHEN site_message_states.read_at = '' THEN excluded.read_at ELSE site_message_states.read_at END
    `).run(Number(userId), now, Number(userId));
    return { count: direct.changes + site.changes };
  }

  deleteMessage(userId, id) {
    const messageId = Number(id);
    if (messageId < 0) {
      const siteMessageId = Math.abs(messageId);
      const existing = this.getSiteMessageForUser(userId, siteMessageId);
      if (!existing) throw new Error("消息不存在或已删除。");
      const now = nowIso();
      this.db.prepare(`
        INSERT INTO site_message_states (message_id, user_id, status, read_at, deleted_at)
        VALUES (?, ?, 'read', ?, ?)
        ON CONFLICT(message_id, user_id) DO UPDATE SET
          status = 'read',
          read_at = CASE WHEN site_message_states.read_at = '' THEN excluded.read_at ELSE site_message_states.read_at END,
          deleted_at = excluded.deleted_at
      `).run(siteMessageId, Number(userId), now, now);
      return { ok: true };
    }
    const result = this.db.prepare("UPDATE user_messages SET deleted_at = ? WHERE id = ? AND recipient_user_id = ? AND deleted_at = ''")
      .run(nowIso(), messageId, Number(userId));
    if (!result.changes) throw new Error("消息不存在或已删除。");
    return { ok: true };
  }

  listAdminMessages(options = {}) {
    const { limit, offset } = listOptions(options, 30, 200);
    const query = cleanText(options.query || "", 120).toLowerCase();
    const status = cleanText(options.status || "all", 40).toLowerCase();
    const where = [];
    const args = [];
    if (query) {
      const like = `%${query}%`;
      where.push("(lower(sm.title) LIKE ? OR lower(sm.body) LIKE ? OR lower(sm.sender_name) LIKE ? OR lower(su.username) LIKE ?)");
      args.push(like, like, like, like);
    }
    if (status === "active" || status === "recalled") {
      where.push("sm.status = ?");
      args.push(status);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`
      SELECT sm.id, sm.id AS raw_id, 'site' AS channel, NULL AS user_message_id, sm.id AS site_message_id,
        NULL AS recipient_user_id, 'all' AS recipient_username, '全站用户' AS recipient_name,
        sm.sender_user_id, su.username AS sender_username, sm.sender_name, sm.title, sm.body, sm.kind, sm.priority,
        sm.display_seconds, sm.source_type, sm.source_url, sm.source_label, sm.status, sm.status AS broadcast_status,
        sm.created_at, '' AS read_at, '' AS deleted_at, sm.recalled_at,
        ? AS delivery_count,
        (SELECT count(*) FROM site_message_states rs WHERE rs.message_id = sm.id AND rs.status = 'read' AND rs.deleted_at = '') AS read_count,
        (SELECT count(*) FROM site_message_states ds WHERE ds.message_id = sm.id AND ds.deleted_at != '') AS deleted_count
      FROM site_messages sm
      LEFT JOIN users su ON su.id = sm.sender_user_id
      ${clause}
      ORDER BY sm.id DESC LIMIT ? OFFSET ?
    `).all(this.activeUserCount(), ...args, limit, offset).map(messageFromRow);
  }

  countAdminMessages(options = {}) {
    const query = cleanText(options.query || "", 120).toLowerCase();
    const status = cleanText(options.status || "all", 40).toLowerCase();
    const where = [];
    const args = [];
    if (query) {
      const like = `%${query}%`;
      where.push("(lower(sm.title) LIKE ? OR lower(sm.body) LIKE ? OR lower(sm.sender_name) LIKE ? OR lower(su.username) LIKE ?)");
      args.push(like, like, like, like);
    }
    if (status === "active" || status === "recalled") {
      where.push("sm.status = ?");
      args.push(status);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.db.prepare(`
      SELECT count(*) AS n FROM site_messages sm
      LEFT JOIN users su ON su.id = sm.sender_user_id
      ${clause}
    `).get(...args).n;
  }

  broadcastMessage(session, input = {}) {
    if (!session?.user) throw accessError("请先登录后再发送消息。", 401);
    const payload = this.messagePayload(input, { kind: "broadcast", sourceType: "admin", sourceLabel: "查看消息" });
    const senderName = session.user.displayName || session.user.username || "Wikist";
    const now = nowIso();
    const result = this.db.prepare(`
      INSERT INTO site_messages (
        sender_user_id, sender_name, title, body, kind, priority, display_seconds, source_type, source_url, source_label, status, created_at, recalled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '')
    `).run(session.user.id, senderName, payload.title, payload.body, payload.kind, payload.priority, payload.displaySeconds, payload.sourceType, payload.sourceUrl, payload.sourceLabel, now);
    return { count: this.activeUserCount(), message: this.listAdminMessages({ limit: 1, offset: 0 }).find((item) => item.rawId === result.lastInsertRowid) || null };
  }

  revokeBroadcastMessage(session, id) {
    if (!session?.user) throw accessError("请先登录后再撤回消息。", 401);
    const messageId = Number(id);
    const existing = this.db.prepare("SELECT id FROM site_messages WHERE id = ?").get(messageId);
    if (!existing) throw new Error("全站消息不存在。");
    const result = this.db.prepare("UPDATE site_messages SET status = 'recalled', recalled_at = ? WHERE id = ? AND status != 'recalled'")
      .run(nowIso(), messageId);
    return { ok: true, changed: result.changes };
  }
  mentionedUsersFromText(text) {
    const names = new Set();
    String(text || "").replace(/@([a-z0-9_-]{3,30})\b/g, (_match, username) => {
      names.add(normalizeUsername(username));
      return _match;
    });
    if (!names.size) return [];
    return [...names]
      .map((username) => this.findUser(username))
      .filter((user) => user && user.status === "active");
  }

  notifyMentionsForComment(comment, content, session) {
    const mentioned = this.mentionedUsersFromText(content);
    if (!mentioned.length) return 0;
    const actorUserId = session?.user?.id || null;
    const senderName = comment.authorName || session?.user?.displayName || session?.user?.username || "访客";
    const preview = cleanText(String(content || "").replace(/\s+/g, " "), 160);
    let count = 0;
    for (const user of mentioned) {
      if (actorUserId && user.id === actorUserId) continue;
      this.insertMessage({
        recipientUserId: user.id,
        senderUserId: actorUserId,
        senderName,
        title: `${senderName} 在评论中 @ 了你`,
        body: preview,
        kind: "mention",
        sourceType: "comment",
        sourceUrl: `#/comments/${String(comment.pageSlug || "home").split("/").map(encodeURIComponent).join("/")}`,
        sourceLabel: "查看讨论",
      });
      count += 1;
    }
    return count;
  }
  ratingIdentity(req, session) {
    if (session?.user) {
      return { userId: session.user.id, guestId: null, cookie: null };
    }
    const cookies = parseCookies(req.headers.cookie);
    const now = nowIso();
    const { ip, userAgent } = this.getRequestInfo(req);
    const existingId = String(cookies[this.guestCookieName] || "").trim();
    if (/^[a-zA-Z0-9_-]{12,80}$/.test(existingId)) {
      const existing = this.db.prepare("SELECT id FROM guest_profiles WHERE id = ?").get(existingId);
      if (existing) {
        this.db.prepare("UPDATE guest_profiles SET last_seen_at = ?, ip_last = ?, user_agent = ? WHERE id = ?")
          .run(now, ip, userAgent, existingId);
        return { userId: null, guestId: existingId, cookie: guestCookie(existingId) };
      }
    }
    const guest = this.getOrCreateGuest(req, { displayName: "访客评分", email: "", website: "" });
    return { userId: null, guestId: guest.id, cookie: guest.cookie };
  }

  getPageRatingStats(slug, session = null) {
    const pageSlug = String(slug || "");
    const aggregate = this.db.prepare("SELECT count(*) AS n, avg(rating) AS average FROM page_ratings WHERE page_slug = ?")
      .get(pageSlug);
    const rows = this.db.prepare("SELECT rating, count(*) AS n FROM page_ratings WHERE page_slug = ? GROUP BY rating")
      .all(pageSlug);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of rows) distribution[row.rating] = row.n;
    let myRating = 0;
    if (session?.user) {
      const mine = this.db.prepare("SELECT rating FROM page_ratings WHERE page_slug = ? AND user_id = ? ORDER BY id DESC LIMIT 1")
        .get(pageSlug, session.user.id);
      myRating = Number(mine?.rating || 0);
    }
    return {
      pageSlug,
      average: aggregate?.average ? Number(Number(aggregate.average).toFixed(2)) : 0,
      count: Number(aggregate?.n || 0),
      distribution,
      myRating,
    };
  }

  ratePage(req, session, slug, input = {}) {
    const rating = Math.max(1, Math.min(5, Math.round(Number(input.rating) || 0)));
    if (!rating) throw new Error("评分必须是 1-5 分。");
    const pageSlug = String(slug || "");
    const now = nowIso();
    const { ip, userAgent } = this.getRequestInfo(req);
    const identity = this.ratingIdentity(req, session);
    const existing = identity.userId
      ? this.db.prepare("SELECT id FROM page_ratings WHERE page_slug = ? AND user_id = ? ORDER BY id DESC LIMIT 1").get(pageSlug, identity.userId)
      : this.db.prepare("SELECT id FROM page_ratings WHERE page_slug = ? AND guest_id = ? ORDER BY id DESC LIMIT 1").get(pageSlug, identity.guestId);
    if (existing) {
      this.db.prepare("UPDATE page_ratings SET rating = ?, ip = ?, user_agent = ?, updated_at = ? WHERE id = ?")
        .run(rating, ip, userAgent, now, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO page_ratings (page_slug, user_id, guest_id, rating, ip, user_agent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(pageSlug, identity.userId, identity.guestId, rating, ip, userAgent, now, now);
    }
    if (identity.userId) this.syncUserActivity(identity.userId, now);
    this.recordAuditLog(req, session, {
      actorType: identity.userId ? "user" : "guest",
      guestId: identity.guestId,
      actorName: session?.user?.displayName || session?.user?.username || "访客评分",
      actorLabel: session?.user?.username ? `@${session.user.username}` : identity.guestId,
      action: "page.rate",
      targetType: "page",
      targetId: pageSlug,
      targetLabel: pageSlug,
      summary: `词条评分 ${rating}/5`,
      metadata: { rating },
    });
    return { cookie: identity.cookie, rating: this.getPageRatingStats(pageSlug, session) };
  }
}


module.exports = {
  PassportStore,
  USER_GROUPS,
  GROUP_LABELS,
  normalizeRole,
  hasRole,
  clearSessionCookie,
  guestCookie,
  sessionCookie,
};
