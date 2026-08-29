#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PageStore } = require("../src/core/page-store");
const { packageCorpus, parseArgs: parsePackageArgs } = require("./eom-zh-package");
const { importPackage, loadRelease, parseArgs: parseImportArgs } = require("./eom-zh-release-import");

let checks = 0;

function equal(actual, expected, message) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

function okay(value, message) {
  checks += 1;
  assert.ok(value, message);
}

function throws(callback, pattern, message) {
  checks += 1;
  assert.throws(callback, pattern, message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function invoke(callback) {
  const originalWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  let output = "";
  process.exitCode = 0;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    const result = callback();
    return { result, output, exitCode: process.exitCode || 0 };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

function fileSha(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createConversionRoot(root) {
  const firstToken = "@@WIKIST_MATH_000001@@";
  const secondToken = "@@WIKIST_MATH_000002@@";
  const titleRows = [
    {
      sourceId: 1,
      sourceTitle: "Alpha article",
      zhTitle: "阿尔法词条",
      zhAliases: ["Alpha article"],
      targetSlug: "alpha-article",
      entryType: "article",
    },
    {
      sourceId: 2,
      sourceTitle: "Alpha redirect",
      zhTitle: "阿尔法重定向",
      zhAliases: ["Alpha redirect"],
      targetSlug: "alpha-redirect",
      entryType: "redirect",
    },
  ];
  const manifestRows = [
    {
      sourceId: 1,
      sourceTitle: "Alpha article",
      targetSlug: "alpha-article",
      entryType: "article",
      sourceSha256: "a".repeat(64),
      sourceRevisionId: "101",
      sourceRevisionTimestamp: "2025-01-02T03:04:05.000Z",
      inputPath: "work/body-input/part-01/00000001.json",
    },
    {
      sourceId: 2,
      sourceTitle: "Alpha redirect",
      targetSlug: "alpha-redirect",
      entryType: "redirect",
      sourceSha256: "b".repeat(64),
      sourceRevisionId: "102",
      sourceRevisionTimestamp: "2025-01-03T03:04:05.000Z",
    },
  ];
  const unit = {
    format: "wikist-eom-translation-unit",
    formatVersion: 1,
    sourceId: 1,
    sourceTitle: "Alpha article",
    zhTitle: "阿尔法词条",
    targetSlug: "alpha-article",
    entryType: "article",
    sourceSha256: "a".repeat(64),
    sourceRevisionId: "101",
    sourceRevisionTimestamp: "2025-01-02T03:04:05.000Z",
    sourceArchivedAt: "2025-01-04T03:04:05.000Z",
    categories: ["Algebra"],
    classifications: ["03E05"],
    markdown: `# 阿尔法词条\n\nLet ${firstToken} and ${secondToken}.`,
    protectedTokens: [
      { token: secondToken, type: "MATH", value: "$y$" },
      { token: firstToken, type: "MATH", value: "$x$" },
    ],
    references: [],
    conversionIssues: [],
    sourceText: "Alpha article source",
  };
  const output = {
    format: "wikist-eom-translation-output",
    formatVersion: 1,
    sourceId: 1,
    sourceTitle: "Alpha article",
    zhTitle: "阿尔法词条",
    modelOrAgent: "release-regression",
    translatedAt: "2025-02-01T00:00:00.000Z",
    needsReview: false,
    issues: [],
    zhCategories: ["代数"],
    summary: "用于发布链路回归的阿尔法词条。",
    translatedMarkdown: `# 阿尔法词条\n\n设 ${firstToken} 与 ${secondToken}。`,
  };
  writeJson(path.join(root, "conversion-root.json"), { indexedAt: "2025-01-05T00:00:00.000Z" });
  writeJsonl(path.join(root, "mappings", "global-title-map.jsonl"), titleRows);
  writeJsonl(path.join(root, "mappings", "global-redirect-map.jsonl"), [{ sourceId: 2, status: "resolved", targetSourceId: 1, targetSlug: "alpha-article" }]);
  writeJsonl(path.join(root, "manifests", "conversion-manifest.jsonl"), manifestRows);
  writeJson(path.join(root, "work", "body-input", "part-01", "00000001.json"), unit);
  writeJson(path.join(root, "work", "body-output", "part-01", "00000001.json"), output);
  return { outputPath: path.join(root, "work", "body-output", "part-01", "00000001.json"), output };
}

function createWikistRoot(root) {
  writeJson(path.join(root, "package.json"), { name: "wikist-release-test", private: true });
  writeJson(path.join(root, "config", "site.config.json"), { passport: { enabled: false }, hiddenPages: [] });
  for (const directory of ["pages", "revisions", "reviewed", "deleted"]) {
    fs.mkdirSync(path.join(root, "content", directory), { recursive: true });
  }
}

function safeCleanup(root) {
  const resolved = path.resolve(root);
  const temporary = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temporary || !path.basename(resolved).startsWith("wikist-eom-zh-release-test-")) {
    throw new Error(`Refusing to remove unexpected test path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wikist-eom-zh-release-test-"));
  try {
    const conversionRoot = path.join(temporary, "conversion");
    const packageRoot = path.join(temporary, "release");
    const fixture = createConversionRoot(conversionRoot);
    const reviewOutput = { ...fixture.output, needsReview: true, issues: ["manual review required"] };
    writeJson(fixture.outputPath, reviewOutput);

    const dryOptions = parsePackageArgs([`--root=${conversionRoot}`, `--package=${packageRoot}`, "--batch-size=1", "--dry-run"]);
    const reviewGate = invoke(() => packageCorpus(dryOptions));
    equal(reviewGate.result.pending, 1, "needsReview output must stay pending");
    equal(fs.existsSync(packageRoot), false, "package dry-run must not create the package directory");

    writeJson(fixture.outputPath, fixture.output);
    const firstBatch = invoke(() => packageCorpus(parsePackageArgs([`--root=${conversionRoot}`, `--package=${packageRoot}`, "--batch-size=1"])));
    equal(firstBatch.result.status, "building", "first batch must not publish an incomplete release");
    equal(firstBatch.result.packaged, 1, "first batch should package one entry");
    equal(firstBatch.exitCode, 2, "an incomplete package must signal a non-ready exit code");
    throws(() => loadRelease(packageRoot), /not ready/, "the importer must reject a building package");

    const secondBatch = invoke(() => packageCorpus(parsePackageArgs([`--root=${conversionRoot}`, `--package=${packageRoot}`, "--batch-size=1"])));
    equal(secondBatch.result.status, "ready", "second batch should finish the release");
    equal(secondBatch.result.packaged, 2, "ready release should contain article and redirect");
    const manifestPath = path.join(packageRoot, "manifest.json");
    const stableManifestSha = fileSha(manifestPath);
    const resumed = invoke(() => packageCorpus(parsePackageArgs([`--root=${conversionRoot}`, `--package=${packageRoot}`, "--batch-size=1"])));
    equal(resumed.result.written, 0, "a completed package rerun must not rewrite page payloads");
    equal(fileSha(manifestPath), stableManifestSha, "a completed package rerun must be content-idempotent");

    const release = loadRelease(packageRoot);
    equal(release.records.length, 2, "ready package should parse exactly two records");
    equal(release.records.map((record) => Boolean(record.page.redirectTarget)), [false, true], "articles must precede redirects");

    const tamperedRoot = path.join(temporary, "tampered-release");
    fs.cpSync(packageRoot, tamperedRoot, { recursive: true });
    fs.appendFileSync(path.join(tamperedRoot, "pages", "00000001.json"), " ", "utf8");
    throws(() => loadRelease(tamperedRoot), /checksum mismatch/, "payload tampering must fail before import");
    const pollutedRoot = path.join(temporary, "polluted-release");
    fs.cpSync(packageRoot, pollutedRoot, { recursive: true });
    writeJson(path.join(pollutedRoot, "translation-output.json"), { temporary: true });
    throws(() => loadRelease(pollutedRoot), /unexpected top-level entry/, "a release must reject temporary translation files");
    throws(() => parseImportArgs(["--source=temporary-json"]), /no longer accepted/, "temporary translation roots must not be importable");
    throws(() => parseImportArgs([`--package=${packageRoot}`, "--base-url=https://example.invalid"]), /authenticated user session/, "unauthenticated HTTP import mode must stay disabled");

    const appRoot = path.join(temporary, "wikist");
    createWikistRoot(appRoot);
    throws(
      () => invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, `--state=${path.join(appRoot, "content", "bad.state.json")}`, "--dry-run"]))),
      /data\/imports/,
      "resume state must stay in the dedicated import-data directory",
    );
    const beforeDryRun = fs.readdirSync(path.join(appRoot, "content", "pages"));
    const importDryRun = invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, "--batch-size=2", "--dry-run"])));
    equal(importDryRun.result.plannedImports, 2, "empty Wikist root should plan both entries");
    equal(importDryRun.result.failedPreflight, 0, "isolated import preflight should pass");
    equal(fs.readdirSync(path.join(appRoot, "content", "pages")), beforeDryRun, "import dry-run must not create page files");
    equal(fs.existsSync(importDryRun.result.state), false, "import dry-run must not create resume state");

    const importedOne = invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, "--batch-size=1", "--no-backup"])));
    equal(importedOne.result.imported, 1, "first real test batch should import the article");
    const importedTwo = invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, "--batch-size=1", "--no-backup"])));
    equal(importedTwo.result.imported, 1, "second real test batch should import the redirect");
    const articlePath = path.join(appRoot, "content", "pages", "alpha-article.md");
    const articleSha = fileSha(articlePath);
    const noOp = invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, "--batch-size=2", "--no-backup"])));
    equal(noOp.result.selectedThisRun, 0, "completed import state should make reruns no-ops");
    equal(fileSha(articlePath), articleSha, "a resumed no-op must not rewrite imported pages");
    fs.unlinkSync(path.join(appRoot, "content", "pages", "alpha-redirect.md"));
    const reopened = invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, "--batch-size=2", "--dry-run"])));
    equal(reopened.result.reopenedFromState, 1, "a missing imported page must reopen its completed checkpoint");
    equal(reopened.result.selectedThisRun, 1, "only the missing page should be selected again");
    equal(reopened.result.plannedImports, 1, "the missing page should be planned for restoration");

    const overwritePlan = invoke(() => importPackage(parseImportArgs([`--root=${appRoot}`, `--package=${packageRoot}`, "--batch-size=1", "--overwrite", "--dry-run"])));
    equal(overwritePlan.result.plannedUpdates, 1, "explicit overwrite should update an existing EoM page even at the same source revision");

    const protectedRoot = path.join(temporary, "protected-wikist");
    createWikistRoot(protectedRoot);
    const protectedPages = new PageStore(protectedRoot, { hiddenPages: [] });
    protectedPages.savePage("alpha-article", { title: "Local article", importSource: "manual", body: "Local content." });
    const protectedPlan = invoke(() => importPackage(parseImportArgs([`--root=${protectedRoot}`, `--package=${packageRoot}`, "--batch-size=1", "--overwrite", "--dry-run"])));
    equal(protectedPlan.result.plannedSkips, 1, "overwrite must still protect a non-EoM page");
    equal(protectedPlan.result.results[0].reason, "existing-non-eom-page-protected", "protected-page reason should be explicit");

    const hiddenRoot = path.join(temporary, "hidden-wikist");
    createWikistRoot(hiddenRoot);
    writeJson(path.join(hiddenRoot, "config", "site.config.json"), { passport: { enabled: false }, hiddenPages: ["alpha-article"] });
    const hiddenPlan = invoke(() => importPackage(parseImportArgs([`--root=${hiddenRoot}`, `--package=${packageRoot}`, "--batch-size=1", "--overwrite", "--dry-run"])));
    equal(hiddenPlan.result.plannedSkips, 1, "configured hidden slugs must not be imported");
    equal(hiddenPlan.result.results[0].reason, "hidden-page-protected", "hidden-page protection reason should be explicit");

    okay(checks >= 30, "release regression should cover the full chain");
    process.stdout.write(`${JSON.stringify({ passed: checks, packageEntries: release.records.length, temporaryDataRemoved: true }, null, 2)}\n`);
  } finally {
    safeCleanup(temporary);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
