const fs = require("fs");
const path = require("path");
const { PassportStore } = require("../src/core/passport-store");
const { PageStore } = require("../src/core/page-store");
const { PersistentFtsIndex } = require("../src/core/fts-index");
const { SearchIndex, cleanSearchOptions } = require("../src/core/search-index");

const pages = [
  {
    slug: "abstract-algebra",
    title: "抽象代数",
    summary: "群、环、域等代数结构的系统入口。",
    body: "抽象代数研究群论、环论、域论、模论以及同态、商结构和作用。",
    categories: ["代数", "基础"],
    difficulty: "本科",
    quality: "A",
    updatedAt: "2026-07-01",
    bytes: 1200,
  },
  {
    slug: "lagrange-theorem",
    title: "Lagrange 定理",
    summary: "有限群中子群阶整除群阶。",
    body: "Lagrange theorem is a core result in group theory.",
    categories: ["代数", "群论"],
    difficulty: "本科",
    quality: "A",
    updatedAt: "2026-07-02",
    bytes: 900,
  },
  {
    slug: "measure-theory",
    title: "测度论",
    summary: "积分、可测集与概率论基础。",
    body: "Lebesgue measure, sigma algebra and integration.",
    categories: ["分析", "概率"],
    difficulty: "研究生",
    quality: "B",
    updatedAt: "2026-07-03",
    bytes: 1000,
  },
  {
    slug: "category-theory",
    title: "范畴论",
    summary: "函子、自然变换和抽象结构语言。",
    body: "Category theory connects algebra, topology and logic.",
    categories: ["基础", "代数"],
    difficulty: "专题",
    quality: "C",
    updatedAt: "2026-07-04",
    bytes: 800,
  },
];

const pageStore = { listPages: () => pages };
const search = new SearchIndex(pageStore, () => ({
  plugins: {
    advancedSearch: {
      enabled: true,
      fuzzy: true,
      prefix: true,
      pageSize: 2,
      titleWeight: 10,
      summaryWeight: 4,
      bodyWeight: 1,
      categoryWeight: 6,
    },
  },
}));

const algebra = search.search("category:代数", { page: 1, limit: 2 });
const algebraPage2 = search.search("category:代数", { page: 2, limit: 2 });
const categoryFiltered = search.search("category:代数", { page: 1, limit: 10 });
const titleFiltered = search.search("title:Lagrange", { page: 1, limit: 10 });
const fuzzy = search.search("lagrane", { page: 1, limit: 10 });
const qualityFiltered = search.search("群", { quality: "A", page: 1, limit: 10 });

const ftsRoot = path.join(process.cwd(), "data", "wikist-fts-search-test");
fs.rmSync(ftsRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
fs.mkdirSync(ftsRoot, { recursive: true });
let ftsPassport = null;
let ftsStatus = null;
let ftsSearch = null;
let ftsChinese = null;
let ftsAfterUpdate = null;
let ftsAfterDelete = null;
let changeStreamCreates = 0;
let changeStreamDeletes = 0;
let changeStreamFound = null;
let changeStreamRemoved = null;
try {
  ftsPassport = new PassportStore(ftsRoot, { database: "data/fts.sqlite" });
  const persistent = new PersistentFtsIndex(ftsPassport, () => ({
    plugins: { advancedSearch: { enabled: true, fts5: true } },
  }));
  const ftsOptions = cleanSearchOptions({ page: 1, limit: 10, prefix: true, fuzzy: false });
  persistent.rebuild(pages);
  ftsStatus = persistent.status();
  ftsSearch = persistent.search("Lagrange", ftsOptions);
  ftsChinese = persistent.search("\u7fa4", ftsOptions);
  persistent.syncPage({ ...pages[1], title: "Lagrange Group Theorem", updatedAt: "2026-07-05" });
  ftsAfterUpdate = persistent.search("Group", ftsOptions);
  persistent.removePage("lagrange-theorem");
  ftsAfterDelete = persistent.search("Lagrange", ftsOptions);

  const eventRoot = path.join(process.cwd(), "data", "wikist-fts-change-stream-test");
  fs.rmSync(eventRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  fs.mkdirSync(eventRoot, { recursive: true });
  const eventPassport = new PassportStore(eventRoot, { database: "data/events.sqlite" });
  const eventStore = new PageStore(eventRoot, {});
  const eventPersistent = new PersistentFtsIndex(eventPassport, () => ({
    plugins: { advancedSearch: { enabled: true, fts5: true } },
  }));
  const eventSearch = new SearchIndex(eventStore, () => ({ plugins: { advancedSearch: { enabled: true, fts5: true } } }), eventPersistent);
  eventPersistent.rebuild([]);
  eventStore.onChange(({ type, page }) => {
    if (type === "delete") {
      changeStreamDeletes += 1;
      eventSearch.removePage(page.slug);
    } else {
      changeStreamCreates += 1;
      eventSearch.syncPage(page);
    }
  });
  eventStore.savePage("incremental-fts", {
    title: "Incremental FTS Record",
    summary: "Only this changed page should enter the persistent index.",
    body: "Incremental index updates avoid a startup-wide rebuild.",
  });
  changeStreamFound = eventPersistent.search("Incremental", ftsOptions);
  eventStore.deletePage("incremental-fts");
  changeStreamRemoved = eventPersistent.search("Incremental", ftsOptions);
  eventPassport.db.close();
  fs.rmSync(eventRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
} finally {
  try { ftsPassport?.db.close(); } catch (_error) {}
  fs.rmSync(ftsRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
}

const checks = {
  paged: algebra.items.length === 2 && algebra.pagination.totalPages >= 2 && algebraPage2.items.length >= 1,
  categoryFilter: categoryFiltered.items.length === 3 && categoryFiltered.items.every((item) => item.categories.includes("代数")),
  titleSyntax: titleFiltered.items.length === 1 && titleFiltered.items[0].slug === "lagrange-theorem",
  fuzzySearch: fuzzy.items.some((item) => item.slug === "lagrange-theorem"),
  qualityFilter: qualityFiltered.items.length >= 2 && qualityFiltered.items.every((item) => item.quality === "A"),
  facets: categoryFiltered.facets.categories.some((item) => item.name === "代数"),
  ftsReady: ftsStatus?.available && ftsStatus?.ready && ftsStatus?.documents === pages.length,
  ftsFindsEnglish: ftsSearch?.engine === "sqlite-fts5" && ftsSearch.items.some((item) => item.slug === "lagrange-theorem"),
  ftsFindsChineseTokens: ftsChinese?.items.some((item) => item.slug === "abstract-algebra"),
  ftsSyncsChangedPage: ftsAfterUpdate?.items.some((item) => item.title === "Lagrange Group Theorem"),
  ftsRemovesDeletedPage: ftsAfterDelete?.total === 0,
  ftsUsesPageChangeStream: changeStreamCreates === 1 && changeStreamDeletes === 1 && changeStreamFound?.total === 1 && changeStreamRemoved?.total === 0,
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, algebra, algebraPage2, categoryFiltered, titleFiltered, fuzzy, qualityFiltered, ftsStatus, ftsSearch, ftsChinese, ftsAfterUpdate, ftsAfterDelete }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, total: algebra.total, engine: algebra.engine }, null, 2));
