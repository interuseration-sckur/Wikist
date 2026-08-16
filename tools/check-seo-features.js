"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend = path.join(root, "webman-backend");

function requireSource(file, snippets) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  snippets.forEach((snippet) => {
    if (!source.includes(snippet)) throw new Error(`${file} is missing SEO boundary: ${snippet}`);
  });
}

requireSource("webman-backend/config/route.php", [
  "'/robots.txt'", "'/sitemap.xml'", "'/wiki/{slug:.+}'", "'/questions/{id:", "'/discussions/{organization:",
]);
requireSource("webman-backend/app/controller/SeoController.php", [
  "X-Robots-Tag", "sitemapIndex", "application/xml", "Cache-Control",
]);
requireSource("webman-backend/app/service/SeoPageRenderer.php", [
  "QAPage", "DiscussionForumPosting", "BreadcrumbList", "rel=\"canonical\"", "application/ld+json",
  "applicationDocument", "data-seo-prerender", "__WIKIST_INITIAL_ROUTE__",
]);
requireSource("public/assets/app.js", ["__WIKIST_INITIAL_ROUTE__", "__WIKIST_CLEAN_ENTRY__"]);
requireSource("public/assets/seo-reader.css", [':root[data-theme="dark"]', ".seo-prerender", ".seo-standalone"]);
requireSource("src/server/app.js", [
  'pathname === "/api/community/discussions"', 'url.searchParams.get("indexable") === "1"',
]);
requireSource("src/core/passport-store.js", ["listPublicOrganizationPosts(options = {})"]);

const candidates = [
  process.env.WIKIST_PHP,
  process.platform === "win32" ? path.join(root, ".runtime", "php", "php.exe") : "",
  process.platform === "win32" ? "php.exe" : "php",
].filter(Boolean);
const php = candidates.find((candidate) => {
  const result = spawnSync(candidate, ["-r", "exit(PHP_VERSION_ID >= 80401 ? 0 : 1);"], { windowsHide: true });
  return !result.error && result.status === 0;
});
if (!php) throw new Error("SEO checks require PHP 8.4.1 or newer.");

const result = spawnSync(php, [path.join(backend, "tools", "check-seo.php")], {
  cwd: backend,
  encoding: "utf8",
  windowsHide: true,
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "SEO PHP check failed.\n");
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout);
