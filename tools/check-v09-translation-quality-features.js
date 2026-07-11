const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PageStore } = require("../src/core/page-store");
const { PassportStore } = require("../src/core/passport-store");
const { translationSourceChanges } = require("../src/core/translation-quality");

const tempRoot = path.join(process.cwd(), "data", "wikist-v09-translation-quality-test");
const appSource = fs.readFileSync(path.join(process.cwd(), "src", "server", "app.js"), "utf8");

function removeTempRoot() {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}

function request() {
  return {
    headers: { cookie: "", "user-agent": "wikist-v09-translation-quality-test" },
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
  passport = new PassportStore(tempRoot, { database: "data/v09-translation-quality.sqlite" });
  const admin = passport.register({
    username: "v09_admin",
    displayName: "V09 Admin",
    email: "v09-admin@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const translator = passport.register({
    username: "v09_translator",
    displayName: "V09 Translator",
    email: "v09-translator@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const reader = passport.register({
    username: "v09_reader",
    displayName: "V09 Reader",
    email: "v09-reader@example.com",
    password: "Passw0rd!",
    ...captcha(passport),
  }, request()).user;
  const adminSession = { user: passport.getUserProfile(admin.id) };
  const translatorSession = { user: passport.getUserProfile(translator.id) };
  const readerSession = { user: passport.getUserProfile(reader.id) };
  passport.joinTranslatorCommunity(translatorSession, { languages: ["en"] });

  const initialPage = pages.savePage("translation-quality", {
    title: "翻译质量",
    summary: "翻译记忆与术语表的最小验证词条。",
    body: "群论研究满足结合律的代数结构，并通过同态研究结构之间的关系。\n\n每一段译文都应保留定义、记法与可核验来源之间的联系。",
  });
  const draft = passport.saveTranslation(translatorSession, initialPage.slug, initialPage, {
    language: "en",
    title: "Translation quality",
    summary: "A minimal verification page for translation memory and glossary.",
    translatedMd: "Group theory studies algebraic structures with associative composition and maps between those structures.\n\nEach translated paragraph should preserve definitions, notation, and links to verifiable sources.",
  });
  const memoryBeforeReview = passport.listTranslationMemory(translatorSession, { source: "zh-CN", target: "en" });
  const reviewed = passport.reviewTranslation(adminSession, initialPage.slug, "en", { decision: "approve", comment: "术语、段落对应和来源表达均已核验。" });
  const memoryAfterReview = passport.listTranslationMemory(translatorSession, { source: "zh-CN", target: "en", limit: 20 });
  const glossary = passport.saveTranslationGlossary(adminSession, {
    sourceLanguage: "zh-CN",
    targetLanguage: "en",
    sourceTerm: "群",
    targetTerm: "group",
    notation: "G",
    note: "代数结构语境下使用 group。",
    discouragedTerms: "grouping, collection",
  });
  const changedPage = pages.savePage(initialPage.slug, {
    ...initialPage,
    body: `${initialPage.body}\n\n新增段落用于确认源文改动会被译者工作台标记。`,
  });
  const assistant = passport.translationAssistant(translatorSession, changedPage, reviewed, "en");
  const directDiff = translationSourceChanges(initialPage.body, changedPage.body);
  const moved = pages.movePage(initialPage.slug, "quality/translation-quality", { leaveRedirect: true });
  const moveStorage = passport.movePageData(initialPage.slug, moved.page.slug, moved.page.title);
  const movedMemory = passport.listTranslationMemory(translatorSession, { source: "zh-CN", target: "en", limit: 20 });
  let readerDenied = false;
  try {
    passport.listTranslationGlossary(readerSession, { source: "zh-CN", target: "en" });
  } catch (error) {
    readerDenied = error.statusCode === 403;
  }

  const checks = {
    draftDoesNotEnterMemory: draft.status === "review" && memoryBeforeReview.total === 0,
    reviewedTranslationBuildsMemory: reviewed.status === "published" && memoryAfterReview.total >= 2 && memoryAfterReview.items.every((item) => item.translationId === reviewed.id),
    glossaryStoresStructuredTerms: glossary.sourceTerm === "群" && glossary.targetTerm === "group" && glossary.notation === "G" && glossary.discouragedTerms.includes("grouping"),
    sourceChangesAreVisible: assistant.sourceChanges.hasChanges && assistant.sourceChanges.addedCount >= 1 && directDiff.hasChanges,
    assistantReusesMemoryAndGlossary: assistant.memory.length >= 2 && assistant.glossary.some((item) => item.targetTerm === "group"),
    ordinaryReaderCannotAccessQualityData: readerDenied,
    moveRekeysTranslationMemory: moveStorage.translationMemory >= 2 && movedMemory.items.every((item) => item.pageSlug === "quality/translation-quality"),
    serverRoutesPresent: appSource.includes("/api/translation-memory") && appSource.includes("/api/translation-glossary") && appSource.includes("translationAssistant"),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  assert.deepStrictEqual(failed, [], `v0.9 translation quality checks failed: ${failed.join(", ")}`);
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, memory: memoryAfterReview.total, glossary: glossary.id }, null, 2));
} finally {
  try { passport?.db.close(); } catch (_error) {}
  removeTempRoot();
}
