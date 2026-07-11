const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PageStore } = require("../src/core/page-store");
const { PassportStore } = require("../src/core/passport-store");
const { categoryDetail, categorySnapshot, topicDetail } = require("../src/core/knowledge-navigation");

const tempRoot = path.join(process.cwd(), "data", "wikist-v08-knowledge-test");
const appSource = fs.readFileSync(path.join(process.cwd(), "src", "server", "app.js"), "utf8");

function removeTempRoot() {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}

function request() {
  return {
    headers: { cookie: "", "user-agent": "wikist-v08-knowledge-test" },
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

removeTempRoot();
fs.mkdirSync(tempRoot, { recursive: true });

let passport = null;
try {
  const pages = new PageStore(tempRoot, {});
  passport = new PassportStore(tempRoot, { database: "data/v08-knowledge.sqlite" });
  const admin = passport.register({
    username: "v08_admin",
    displayName: "V08 Admin",
    email: "v08-admin@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const translator = passport.register({
    username: "v08_translator",
    displayName: "V08 Translator",
    email: "v08-translator@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const reader = passport.register({
    username: "v08_reader",
    displayName: "V08 Reader",
    email: "v08-reader@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const adminSession = { user: passport.getUserProfile(admin.id) };
  const translatorSession = { user: passport.getUserProfile(translator.id) };
  const readerSession = { user: passport.getUserProfile(reader.id) };

  const groupTheory = pages.savePage("group-theory", {
    title: "群论",
    summary: "研究群及其同态的代数分支。",
    categories: ["数学/代数/群论"],
    topic: "数学/代数/群论",
    canonicalNames: ["Group theory", "群理论"],
    classifications: ["MSC 20-XX", "ACM CCS: Mathematics of computing"],
    notation: ["G|群|全文", "H|G 的子群|子群部分"],
    prerequisites: ["set-theory"],
    relatedPages: ["ring-theory"],
    body: "群论研究满足结合律的代数结构。参见 [[ring-theory|环论]]。",
  });
  const revisedGroupTheory = pages.savePage("group-theory", {
    ...groupTheory,
    body: "群论研究满足结合律的代数结构。参见 [[ring-theory|环论]] 与 [[set-theory|集合论]]。",
  });
  pages.snapshotCurrentForReview(revisedGroupTheory.slug, revisedGroupTheory.revisionId);
  const dependent = pages.savePage("representation-theory", {
    title: "表示论",
    categories: ["数学/代数/表示论"],
    topic: "数学/代数/表示论",
    prerequisites: ["group-theory"],
    relatedPages: ["group-theory"],
    body: "表示论以 [[group-theory|群论]] 为基础。",
  });
  const backlinkPages = Array.from({ length: 9 }, (_, index) => pages.savePage(`group-reference-${index + 1}`, {
    title: `群论引用 ${index + 1}`,
    body: `这是第 ${index + 1} 条反向链接：[[group-theory|群论]]。`,
  }));
  const ring = pages.savePage("ring-theory", {
    title: "环论",
    categories: ["数学/代数/环论"],
    topic: "数学/代数/环论",
    body: "环论的基础词条。",
  });
  const setTheory = pages.savePage("set-theory", {
    title: "集合论",
    categories: ["数学/基础"],
    topic: "数学/基础",
    body: "集合论的基础词条。",
  });
  passport.syncPageLinks(dependent);
  for (const page of backlinkPages) passport.syncPageLinks(page);
  passport.setPageFavorite(readerSession, revisedGroupTheory, true);
  passport.setWatch(readerSession, "page", "group-theory", true);
  passport.recordPageEdit(request(), adminSession, revisedGroupTheory, { action: "update" });
  passport.joinTranslatorCommunity(translatorSession, { languages: ["en"] });
  const translationBeforeMove = passport.saveTranslation(translatorSession, "group-theory", revisedGroupTheory, {
    language: "en",
    title: "Group theory",
    summary: "An algebraic theory of groups.",
    translatedMd: "Group theory studies algebraic structures with associative composition. See [[group-theory|Group theory]] and [[ring-theory|Ring theory]].",
  });
  const unreadBeforeReview = passport.getReadableTranslation("group-theory", "en", null);
  const targetFootprint = passport.pageDataFootprint("abstract-algebra/group-theory");

  const moved = pages.movePage("group-theory", "abstract-algebra/group-theory", { leaveRedirect: true });
  const storage = passport.movePageData("group-theory", "abstract-algebra/group-theory", moved.page.title);
  const rewritten = pages.rewriteReferencesForMove("group-theory", "abstract-algebra/group-theory");
  passport.syncPageLinks(moved.page);
  if (moved.redirect) passport.syncPageLinks(moved.redirect);
  for (const page of rewritten) passport.syncPageLinks(page);

  const movedPage = pages.getPage("abstract-algebra/group-theory");
  const redirect = pages.getPage("group-theory");
  const dependentAfterMove = pages.getPage("representation-theory");
  const movedTranslation = passport.getTranslation("abstract-algebra/group-theory", "en");
  const workspaceTranslation = passport.getReadableTranslation("abstract-algebra/group-theory", "en", translatorSession, { workspace: true });
  const reviewedTranslation = passport.reviewTranslation(adminSession, "abstract-algebra/group-theory", "en", { decision: "approve", comment: "术语与链接均已核对。" });
  const publicTranslation = passport.getReadableTranslation("abstract-algebra/group-theory", "en", null);
  const watcherState = passport.watchState(reader.id, "page", "abstract-algebra/group-theory");
  const favoriteState = passport.pageFavoriteState(reader.id, "abstract-algebra/group-theory");
  const movedRevisions = pages.listRevisions("abstract-algebra/group-theory");
  const movedSnapshot = pages.getReviewedSnapshot("abstract-algebra/group-theory", revisedGroupTheory.revisionId);
  const pageKnowledge = passport.pageKnowledge("abstract-algebra/group-theory", pages.listPages(), {
    defaultSlug: "home",
    linkLimit: 4,
    backlinksPage: 2,
  });
  const taxonomy = categorySnapshot(pages.listPages());
  const rootCategory = categoryDetail(pages.listPages(), "数学");
  const algebraCategory = categoryDetail(pages.listPages(), "数学/代数");
  const rootTopic = topicDetail(pages.listPages(), "数学");

  const checks = {
    metadataPersists: movedPage.canonicalNames.includes("Group theory")
      && movedPage.classifications.includes("MSC 20-XX")
      && movedPage.notation.length === 2
      && movedPage.topic === "数学/代数/群论",
    moveCreatesRedirect: redirect?.redirectTarget === "abstract-algebra/group-theory",
    revisionsAndReviewedSnapshotMove: movedRevisions.length >= 1 && movedSnapshot?.revisionId === revisedGroupTheory.revisionId,
    moveRewritesMarkdownAndMetadata: dependentAfterMove.body.includes("[[abstract-algebra/group-theory|群论]]")
      && dependentAfterMove.prerequisites.includes("abstract-algebra/group-theory")
      && dependentAfterMove.relatedPages.includes("abstract-algebra/group-theory"),
    pageLinksRemainConnected: pageKnowledge.backlinksPagination.total === 11
      && pageKnowledge.backlinksPagination.totalPages === 3
      && pageKnowledge.backlinksPagination.page === 2
      && pageKnowledge.backlinks.length === 4
      && pageKnowledge.outgoingPagination.total === 2,
    footprintGuardsEmptyTarget: !targetFootprint.hasData,
    translationRekeysAndRemainsPrivateBeforeReview: translationBeforeMove.status === "review"
      && !unreadBeforeReview
      && movedTranslation?.pageSlug === "abstract-algebra/group-theory"
      && movedTranslation.translatedMd.includes("[[abstract-algebra/group-theory|Group theory]]")
      && workspaceTranslation?.id === movedTranslation.id,
    translationReviewPublishesWithReviewer: reviewedTranslation.status === "published"
      && reviewedTranslation.reviewerUserId === admin.id
      && publicTranslation?.status === "published"
      && publicTranslation.reviewComment.includes("术语"),
    watchesAndFavoritesMove: watcherState.watched && favoriteState.favorited,
    storageMigrationTouchedLinkedData: storage.links >= 1 && storage.translations >= 1,
    hierarchyBuildsParentLandings: taxonomy.rootCategoryItems.some((item) => item.name === "数学" && item.pageCount === 4)
      && rootCategory.children.some((item) => item.name === "数学/代数")
      && algebraCategory.children.some((item) => item.name === "数学/代数/群论")
      && rootTopic.children.some((item) => item.name === "数学/代数"),
    moveAndTranslationRoutesPresent: appSource.includes("const pageMoveMatch")
      && appSource.includes("translationReviewMatch")
      && appSource.includes("/api/categories"),
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepStrictEqual(failed, [], `v0.8 knowledge checks failed: ${failed.join(", ")}`);
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, moved: movedPage.slug, pages: [dependent.slug, ring.slug, setTheory.slug] }, null, 2));
} finally {
  try { passport?.db.close(); } catch (_error) {}
  removeTempRoot();
}
