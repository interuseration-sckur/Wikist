const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");

const dbPath = path.join(process.cwd(), "data", "wikist-message-priority-test.sqlite");
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_error) {}
}

function req() {
  return { headers: { cookie: "", "user-agent": "wikist-priority-test" }, socket: { remoteAddress: "127.0.0.1" } };
}

function captcha(store) {
  const item = store.createCaptcha();
  const question = store.db.prepare("SELECT question FROM captchas WHERE id = ?").get(item.id).question.match(/(\d+)\s*([+-])\s*(\d+)/);
  const answer = question[2] === "+" ? Number(question[1]) + Number(question[3]) : Number(question[1]) - Number(question[3]);
  return { captchaId: item.id, captchaAnswer: String(answer) };
}

function register(store, username) {
  return store.register({ username, displayName: username, email: username + "@example.com", password: "Passw0rd!", ...captcha(store) }, req()).user;
}

const store = new PassportStore(process.cwd(), { database: dbPath });
const admin = register(store, "priority_admin");
const member = register(store, "priority_member");
store.updateUserById(admin.id, { role: "admin" });
const sent = store.broadcastMessage({ user: store.getUserProfile(admin.id) }, { title: "Urgent test", body: "Priority message", priority: "urgent" });
const urgent = store.listMessages(member.id, { status: "unread", priority: "urgent", limit: 5, offset: 0 });
const checks = {
  broadcastCoversUsers: sent.count === 2,
  urgentIsFiltered: urgent.length === 1 && urgent[0].priority === "urgent" && urgent[0].id < 0,
  unreadCountMatches: store.countMessages(member.id, { status: "unread", priority: "urgent" }) === 1,
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
