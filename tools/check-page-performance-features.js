const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { serializeFrontMatter } = require("../src/core/frontmatter");
const { PageStore } = require("../src/core/page-store");
const { SearchIndex } = require("../src/core/search-index");
const { slugToFileName } = require("../src/core/slug");

const tempRoot = path.join(process.cwd(), "data", "wikist-page-performance-test");
const pagesDir = path.join(tempRoot, "content", "pages");

fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
fs.mkdirSync(pagesDir, { recursive: true });

try {
  for (let index = 1; index <= 120; index += 1) {
    const slug = `catalog-page-${index}`;
    fs.writeFileSync(path.join(pagesDir, slugToFileName(slug)), serializeFrontMatter({
      title: `Catalog Page ${index}`,
      summary: `Lightweight metadata record ${index}`,
      categories: ["Catalog", index % 2 ? "Odd" : "Even"],
      quality: index % 3 ? "B" : "A",
      updatedAt: new Date(Date.UTC(2026, 6, 12, 0, index % 60)).toISOString(),
    }, `Body ${index} contains searchable algebra and group theory text.`), "utf8");
  }

  const pages = new PageStore(tempRoot, { catalogTtlMs: 5000, pageStatTtlMs: 1000 });
  const coldStarted = performance.now();
  const cold = pages.listPageSummaries();
  const coldMs = performance.now() - coldStarted;
  const warmStarted = performance.now();
  const warm = pages.listPageSummaries();
  const warmMs = performance.now() - warmStarted;

  assert.strictEqual(cold.length, 120, "summary catalog should discover every page");
  assert(cold.every((page) => page.body === undefined && page.html === undefined), "summary catalog must not render or expose article bodies");
  assert.strictEqual(warm.length, cold.length, "warm catalog should preserve all summaries");

  pages.listPages = () => { throw new Error("fallback search must not render the full page collection"); };
  const search = new SearchIndex(pages);
  const result = search.search("Catalog 42", { limit: 10 });
  assert(result.items.some((page) => page.slug === "catalog-page-42"), "fallback search should use source documents without full Markdown rendering");

  pages.savePage("catalog-page-42", {
    title: "Catalog Page Forty Two",
    summary: "Updated incrementally",
    categories: ["Catalog"],
    body: "Updated searchable group theory body.",
  });
  const updated = pages.listPageSummaries().find((page) => page.slug === "catalog-page-42");
  assert.strictEqual(updated.title, "Catalog Page Forty Two", "a save should invalidate and refresh only the affected catalog entry");

  const appSource = fs.readFileSync(path.join(process.cwd(), "public", "assets", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(process.cwd(), "src", "server", "app.js"), "utf8");
  assert(appSource.includes("wikistRouteLoader"), "route loading must have a native fallback independent of optional plugins");
  assert(appSource.includes("wikist-native-route-loader"), "native route loading must use an isolated component class");
  assert(appSource.includes("data-wikist-route-loader-provider"), "native loading must yield to an active plugin provider");
  const cosmicSource = fs.readFileSync(path.join(process.cwd(), "plugins", "wikist-cosmic-experience", "cosmic.mjs"), "utf8");
  assert(cosmicSource.includes("wikist-cosmic-route-loader"), "cosmic loading must use an isolated component class");
  assert(!cosmicSource.includes('document.querySelector(".wikist-route-loader")'), "cosmic loading must never capture the native loader");
  assert(serverSource.includes("pages.listPageSummaries()"), "list APIs should use the lightweight metadata catalog");

  console.log(JSON.stringify({
    ok: true,
    checks: 11,
    pages: cold.length,
    coldCatalogMs: Number(coldMs.toFixed(2)),
    warmCatalogMs: Number(warmMs.toFixed(2)),
    searchEngine: result.engine,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });
}
