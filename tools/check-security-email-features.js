const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");

const dbPath = path.join(process.cwd(), "data", "wikist-security-email-test.sqlite");
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_error) {}
}

function req() {
  return { headers: { cookie: "", "user-agent": "wikist-security-test" }, socket: { remoteAddress: "127.0.0.1" } };
}

function captcha(store) {
  const item = store.createCaptcha();
  const row = store.db.prepare("SELECT question FROM captchas WHERE id = ?").get(item.id);
  const match = row.question.match(/(\d+)\s*([+-])\s*(\d+)/);
  const answer = match[2] === "+" ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
  return { captchaId: item.id, captchaAnswer: String(answer) };
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = Buffer.alloc(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)) % 1000000;
  return String(code).padStart(6, "0");
}

const store = new PassportStore(process.cwd(), {
  database: dbPath,
  requireEmailVerification: true,
  twoFactorIssuer: "Wikist Test",
});

const created = store.register({
  username: "secure_user",
  displayName: "Secure User",
  email: "secure-user@example.com",
  password: "Passw0rd!",
  ...captcha(store),
}, req()).user;

let blockedBeforeEmail = false;
try {
  store.login({ identifier: "secure_user", password: "Passw0rd!", ...captcha(store) }, req());
} catch (_error) {
  blockedBeforeEmail = true;
}

const emailToken = store.createEmailVerificationToken(created.id);
const verified = store.verifyEmailToken(emailToken.token);

const reset = store.createPasswordResetToken("secure-user@example.com");
store.resetPasswordWithToken(reset.token, "N3wPassw0rd!");
const setup = store.setupTwoFactor(created.id);
const code = totp(setup.secret);
const twoFactor = store.enableTwoFactor(created.id, code);

let blockedWithoutTotp = false;
try {
  store.login({ identifier: "secure_user", password: "N3wPassw0rd!", ...captcha(store) }, req());
} catch (_error) {
  blockedWithoutTotp = true;
}
const loggedIn = store.login({ identifier: "secure_user", password: "N3wPassw0rd!", twoFactorCode: totp(setup.secret), ...captcha(store) }, req()).user;

const admin = store.register({ username: "security_admin", displayName: "Security Admin", email: "security-admin@example.com", password: "Passw0rd!", ...captcha(store) }, req()).user;
store.updateUserById(admin.id, { role: "admin", emailVerified: true });
store.broadcastMessage({ user: store.getUserProfile(admin.id) }, { title: "Urgent", body: "Timed", priority: "urgent", displaySeconds: 13 });
const urgent = store.listMessages(created.id, { priority: "urgent", status: "unread", limit: 5, offset: 0 })[0];

const checks = {
  emailLoginBlockedBeforeVerification: blockedBeforeEmail,
  emailVerified: verified.emailVerified === true,
  resetPasswordWorks: loggedIn.username === "secure_user",
  twoFactorEnabled: twoFactor.twoFactorEnabled === true,
  twoFactorRequired: blockedWithoutTotp,
  messageDisplaySeconds: urgent?.displaySeconds === 13,
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
store.db.close();
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_error) {}
}

if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length }, null, 2));
