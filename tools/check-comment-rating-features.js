const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");

const dbPath = path.join(process.cwd(), "data", "wikist-comment-rating-test.sqlite");
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(`${dbPath}${suffix}`); } catch (_error) {}
}

function req(cookie = "") {
  return {
    headers: { cookie, "user-agent": "wikist-feature-test" },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function solveCaptcha(store) {
  const captcha = store.createCaptcha();
  const row = store.db.prepare("SELECT question FROM captchas WHERE id = ?").get(captcha.id);
  const match = row.question.match(/(\d+)\s*([+-])\s*(\d+)/);
  const answer = match[2] === "+" ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
  return { captchaId: captcha.id, captchaAnswer: String(answer) };
}

function register(store, username, displayName, email) {
  return store.register({
    username,
    displayName,
    email,
    password: "Passw0rd!",
    ...solveCaptcha(store),
  }, req());
}

const store = new PassportStore(process.cwd(), { enabled: true, database: dbPath });
const account = register(store, "reply_user", "Reply User", "reply-user@example.com");
const adminAccount = register(store, "admin_user", "Admin User", "admin-user@example.com");
store.updateUserById(adminAccount.user.id, { role: "admin" });
store.updateProfile(account.user.id, {
  displayName: "Reply User",
  email: "reply-user@example.com",
  bio: "",
  avatarUrl: "https://example.com/avatar.png",
  pageMd: "# Reply User",
});
const session = { user: store.getUserProfile(account.user.id) };
const adminSession = { user: store.getUserProfile(adminAccount.user.id) };

const root = store.createComment(req(), null, "feature-test", {
  guestName: "RootGuest",
  guestEmail: "root@example.com",
  content: "一级评论",
});
const cookie = root.cookie.split(";")[0];
const reply = store.createComment(req(), session, "feature-test", {
  parentId: root.comment.id,
  content: "二级回复",
});
const folded = store.createComment(req(cookie), null, "feature-test", {
  guestName: "DeepGuest",
  guestEmail: "deep@example.com",
  parentId: reply.comment.id,
  content: "继续讨论",
});

const mentionMessages = store.listMessages(account.user.id, { limit: 10, offset: 0 });
const unreadBeforeRead = store.unreadMessageCount(account.user.id);
store.markMessageRead(account.user.id, mentionMessages[0].id);
const unreadAfterRead = store.unreadMessageCount(account.user.id);
store.deleteMessage(account.user.id, mentionMessages[0].id);
const messagesAfterDelete = store.countMessages(account.user.id);
const broadcast = store.broadcastMessage(adminSession, { title: "全站通知", body: "测试消息" });
const adminMessages = store.listAdminMessages({ limit: 10, offset: 0, query: "全站" });
const broadcastInbox = store.listMessages(account.user.id, { limit: 10, offset: 0 });
const broadcastUnread = store.unreadMessageCount(account.user.id);
store.markMessageRead(account.user.id, broadcastInbox[0].id);
const broadcastRead = store.unreadMessageCount(account.user.id);
store.deleteMessage(account.user.id, broadcastInbox[0].id);
const broadcastDeleted = store.countMessages(account.user.id);
store.revokeBroadcastMessage(adminSession, adminMessages[0].rawId);
const recalledMessages = store.listAdminMessages({ limit: 10, offset: 0, status: "recalled" });
const roots = store.listComments("feature-test", { limit: 10, offset: 0 });
const replies = store.listCommentReplies("feature-test", root.comment.id, { limit: 10, offset: 0 });
const adminRoots = store.listAllComments({ limit: 10, offset: 0 });
const adminReplies = store.listAllCommentReplies(root.comment.id, { limit: 10, offset: 0 });
const guestBeforeRating = store.db.prepare("SELECT display_name, email FROM guest_profiles WHERE id = ?").get(root.comment.guestId);
store.ratePage(req(cookie), null, "feature-test", { rating: 5 });
store.ratePage(req(cookie), null, "feature-test", { rating: 3 });
const rating = store.getPageRatingStats("feature-test");
const guest = store.db.prepare("SELECT display_name, email FROM guest_profiles WHERE id = ?").get(root.comment.guestId);

const userReply = replies.find((item) => item.authorUsername === "reply_user");
const checks = {
  oneRoot: roots.length === 1,
  replyCount: roots[0]?.replyCount === 2,
  twoReplies: replies.length === 2,
  foldedToRoot: folded.comment.parentId === root.comment.id,
  foldedMentionUsesUsername: /^@reply_user\s/.test(folded.comment.contentMd),
  userAvatarProjected: userReply?.authorAvatarUrl === "https://example.com/avatar.png",
  adminOnlyRoots: adminRoots.length === 1 && !adminRoots[0].parentId,
  adminRepliesSeparate: adminReplies.length === 2 && adminReplies.every((item) => item.parentId === root.comment.id),
  mentionCreated: mentionMessages.length === 1 && mentionMessages[0].kind === "mention" && /@ 了你/.test(mentionMessages[0].title),
  unreadReadDelete: unreadBeforeRead === 1 && unreadAfterRead === 0 && messagesAfterDelete === 0,
  broadcastSent: broadcast.count === 2 && adminMessages.length === 1 && adminMessages[0].deliveryCount === 2,
  broadcastUserState: broadcastInbox.length === 1 && broadcastInbox[0].id < 0 && broadcastUnread === 1 && broadcastRead === 0 && broadcastDeleted === 0,
  broadcastRecalled: recalledMessages.length === 1 && store.countMessages(adminAccount.user.id) === 0,
  ratingDeduped: rating.count === 1 && rating.average === 3,
  guestPreserved: guest.display_name === guestBeforeRating.display_name && guest.email === guestBeforeRating.email && guest.display_name !== "访客评分",
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, mentionMessages, adminMessages, broadcastInbox, recalledMessages, roots, replies, adminRoots, adminReplies, rating, guest }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, roots: roots.length, replies: replies.length, messages: adminMessages.length, rating }, null, 2));