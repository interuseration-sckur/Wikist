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

function seedUser(store, username, displayName, email, role) {
  const now = new Date().toISOString();
  const result = store.db.prepare(`
    INSERT INTO users (
      username, email, display_name, password_hash, password_salt, role, status,
      created_at, updated_at, password_updated_at, last_sync_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(username, email, displayName, "fixture-password-hash", "fixture-password-salt", role, now, now, now, now);
  return store.getUserProfile(Number(result.lastInsertRowid));
}

let store = null;

try {
  const pages = new PageStore(tempRoot, {});
  store = new PassportStore(tempRoot, { database: "data/knowledge.sqlite" });
  const admin = seedUser(store, "knowledge_admin", "Knowledge Admin", "knowledge-admin@example.com", "admin");
  const reader = seedUser(store, "knowledge_reader", "Knowledge Reader", "knowledge-reader@example.com", "member");
  const adminSession = { user: admin };
  const readerSession = { user: reader };

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

  const disambiguation = pages.savePage("sphere", {
    title: "Sphere",
    summary: "A disambiguation page.",
    aliases: ["spheres"],
    disambiguation: true,
    disambiguationTargets: ["vector-space|Vector space|Linear algebra", "linear-algebra|Linear algebra|Matrices and maps"],
    body: "Choose a meaning.",
  });
  const redirect = pages.savePage("sphere-redirect", {
    title: "Sphere redirect",
    redirectTarget: "sphere",
    body: "",
  });

  store.syncPageLinks(source);
  store.syncPageLinks(target);
  store.syncPageLinks(isolated);
  const initial = store.knowledgeSnapshot(pages.listPages(), { defaultSlug: "home" });

  store.setPageAlias(adminSession, { aliasSlug: "la", targetSlug: "linear-algebra" });
  store.syncPageAliases(adminSession, disambiguation, disambiguation.aliases, pages.listPages().map((page) => page.slug));
  const alias = store.resolvePageAlias("la");
  const editorAlias = store.resolvePageAlias("spheres");
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
  store.setUserFollow(readerSession, admin.username, true);
  const socialNotified = store.notifyUserFollowers(source, {
    action: "update",
    actorUserId: admin.id,
    senderName: admin.displayName,
  });
  const messages = store.listMessages(reader.id, { limit: 10, offset: 0 });
  store.setWatch(adminSession, "page", "linear-algebra", true);
  const selfWatchNotified = store.notifyKnowledgeWatchers(source, {
    action: "update",
    actorUserId: admin.id,
    senderName: admin.displayName,
  });
  const selfMessages = store.listMessages(admin.id, { limit: 10, offset: 0 });
  const pageKnowledge = store.pageKnowledge("vector-space", pages.listPages(), { defaultSlug: "home" });

  const checks = {
    missingDetected: initial.missing.some((item) => item.slug === "missing-concept"),
    orphanDetected: initial.orphans.some((page) => page.slug === "isolated-page"),
    backlinkIndexed: pageKnowledge.backlinks.some((item) => item.slug === "linear-algebra"),
    aliasResolves: alias?.targetSlug === "linear-algebra",
    editorAliasResolves: editorAlias?.targetSlug === "sphere" && editorAlias?.sourcePageSlug === "sphere",
    redirectMetadataPersists: redirect.redirectTarget === "sphere",
    disambiguationMetadataPersists: disambiguation.isDisambiguation && disambiguation.disambiguationTargets.length === 2,
    watchSaved: store.countUserWatches(reader.id) === 3,
    pageAndCategoryNotifyOnce: notified === 1,
    languageNotify: translated === 1,
    notificationHasTarget: messages.length === 3 && messages.every((item) => item.sourceUrl === "#/page/linear-algebra"),
    pageWatchMessageExplainsUpdate: messages.some((item) => item.kind === "watch" && /关注的词条已更新/.test(item.title || "")),
    selfWatchReceivesUpdate: selfWatchNotified === 2 && selfMessages.some((item) => item.kind === "watch" && item.sourceUrl === "#/page/linear-algebra"),
    userFollowSaved: store.userFollowState(reader.id, admin.id).following && socialNotified === 1,
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
