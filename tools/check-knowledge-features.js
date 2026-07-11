const fs = require("fs");
const path = require("path");
const { PageStore } = require("../src/core/page-store");
const { PassportStore } = require("../src/core/passport-store");

const tempRoot = path.join(process.cwd(), "data", "wikist-knowledge-test");
function removeTempRoot() {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}

removeTempRoot();
fs.mkdirSync(tempRoot, { recursive: true });

function request() {
  return {
    headers: { cookie: "", "user-agent": "wikist-knowledge-test" },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function captcha(store) {
  const item = store.createCaptcha();
  const row = store.db.prepare("SELECT question FROM captchas WHERE id = ?").get(item.id);
  const match = row.question.match(/(\d+)\s*([+-])\s*(\d+)/);
  const answer = match[2] === "+" ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
  return { captchaId: item.id, captchaAnswer: String(answer) };
}

let store = null;

try {
  const pages = new PageStore(tempRoot, {});
  store = new PassportStore(tempRoot, { database: "data/knowledge.sqlite" });
  const admin = store.register({
    username: "knowledge_admin",
    displayName: "Knowledge Admin",
    email: "knowledge-admin@example.com",
    password: "Passw0rd!",
    ...captcha(store),
  }, request()).user;
  const reader = store.register({
    username: "knowledge_reader",
    displayName: "Knowledge Reader",
    email: "knowledge-reader@example.com",
    password: "Passw0rd!",
    ...captcha(store),
  }, request()).user;
  const adminSession = { user: store.getUserProfile(admin.id) };
  const readerSession = { user: store.getUserProfile(reader.id) };

  const source = pages.savePage("linear-algebra", {
    title: "Linear Algebra",
    categories: ["代数学"],
    body: "[[vector-space|Vector space]]\n\n[[missing-concept|Missing concept]]",
  });
  const target = pages.savePage("vector-space", {
    title: "Vector Space",
    categories: ["代数学"],
    body: "[[linear-algebra|Linear algebra]]",
  });
  const isolated = pages.savePage("isolated-page", {
    title: "Isolated Page",
    categories: ["几何学"],
    body: "No wiki links.",
  });

  store.syncPageLinks(source);
  store.syncPageLinks(target);
  store.syncPageLinks(isolated);
  const initial = store.knowledgeSnapshot(pages.listPages(), { defaultSlug: "home" });

  store.setPageAlias(adminSession, { aliasSlug: "la", targetSlug: "linear-algebra" });
  const alias = store.resolvePageAlias("la");
  store.setWatch(readerSession, "page", "linear-algebra", true);
  store.setWatch(readerSession, "category", "代数学", true);
  store.setWatch(readerSession, "language", "en", true);
  const notified = store.notifyKnowledgeWatchers(source, {
    action: "update",
    actorUserId: admin.id,
    senderName: admin.displayName,
  });
  const translated = store.notifyKnowledgeWatchers(source, {
    action: "translation",
    language: "en",
    actorUserId: admin.id,
    senderName: admin.displayName,
  });
  const messages = store.listMessages(reader.id, { limit: 10, offset: 0 });
  const pageKnowledge = store.pageKnowledge("vector-space", pages.listPages(), { defaultSlug: "home" });

  const checks = {
    missingDetected: initial.missing.some((item) => item.slug === "missing-concept"),
    orphanDetected: initial.orphans.some((page) => page.slug === "isolated-page"),
    backlinkIndexed: pageKnowledge.backlinks.some((item) => item.slug === "linear-algebra"),
    aliasResolves: alias?.targetSlug === "linear-algebra",
    watchSaved: store.countUserWatches(reader.id) === 3,
    pageAndCategoryNotifyOnce: notified === 1,
    languageNotify: translated === 1,
    notificationHasTarget: messages.length === 2 && messages.every((item) => item.sourceUrl === "#/page/linear-algebra"),
  };

  const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed, checks, initial, pageKnowledge, messages }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length }, null, 2));
} finally {
  try { store?.db.close(); } catch (_error) {}
  removeTempRoot();
}
