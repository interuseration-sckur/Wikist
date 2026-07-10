const fs = require("fs");
const path = require("path");
const { PageStore } = require("../src/core/page-store");
const { parseWikistImport, wikitextToMarkdown } = require("../src/core/import-export");

const root = path.join(process.cwd(), "data", "wikist-import-export-test");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, "content", "pages"), { recursive: true });

const store = new PageStore(root, { hiddenPages: [] });

const wikiMarkdown = wikitextToMarkdown(`
{{short description|Test}}
'''群'''是[[数学]]对象。
== 定义 ==
<math display=block>G = \\{e\\}</math>
[[Category:代数]]
`, { sourceUrl: "https://example.org/wiki/Test" });

const fromMarkdown = parseWikistImport({
  format: "markdown",
  slug: "imported-markdown",
  title: "导入 Markdown",
  summary: "测试导入",
  categories: "测试, 导入",
  content: "# 正文\n\n内容",
});

const markdownPage = store.savePage(fromMarkdown.slug, fromMarkdown);
const exportedMarkdown = store.rawMarkdown(markdownPage.slug);
const exportedJson = store.exportPage(markdownPage.slug);

const fromJson = parseWikistImport({
  content: JSON.stringify({
    page: {
      slug: "imported-json",
      title: "导入 JSON",
      summary: "JSON 测试",
      categories: ["迁移"],
      body: "JSON body",
      importSource: "wikipedia",
      importTitle: "Group_(mathematics)",
      importLang: "en",
      importRevision: "123",
    },
  }),
});
const jsonPage = store.savePage(fromJson.slug, fromJson);

const checks = {
  wikitextHeadings: wikiMarkdown.includes("## 定义"),
  wikitextMath: wikiMarkdown.includes("$$") && wikiMarkdown.includes("G = \\{e\\}"),
  wikitextLinks: wikiMarkdown.includes("**群**是[[数学]]对象"),
  markdownSaved: markdownPage.slug === "imported-markdown" && markdownPage.categories.includes("测试"),
  rawExport: exportedMarkdown.includes("title: 导入 Markdown") && exportedMarkdown.includes("# 正文"),
  jsonExport: exportedJson.page.slug === "imported-markdown" && exportedJson.format === "wikist-page",
  importMeta: jsonPage.importSource === "wikipedia" && jsonPage.importRevision === "123",
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, wikiMarkdown, markdownPage, exportedJson, jsonPage }, null, 2));
  process.exit(1);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, checks: Object.keys(checks).length, pages: store.listPages().length }, null, 2));
