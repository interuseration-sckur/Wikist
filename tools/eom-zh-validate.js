#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE = process.platform === "win32" ? "G:\\Wikist-EoM" : path.join(process.cwd(), "data", "eom-archive");
const DEFAULT_ROOT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");

function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, root: DEFAULT_ROOT, allowPending: false };
  for (const arg of argv) {
    if (arg.startsWith("--source=")) options.source = arg.slice(9);
    else if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg === "--allow-pending") options.allowPending = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.source = path.resolve(options.source);
  options.root = path.resolve(options.root);
  return options;
}

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL ${filePath}:${index + 1}: ${error.message}`); }
  });
}
function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, filePath);
}
function writeJson(filePath, value) { atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(filePath, rows) { atomicWrite(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }

function packageFiles(root) {
  const directory = path.join(root, "packages");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(directory, entry.name)).sort();
}

function occurrences(text, value) {
  if (!value) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(value, offset)) >= 0) { count += 1; offset += value.length; }
  return count;
}

function validate(options) {
  const manifest = readJsonl(path.join(options.root, "manifests", "conversion-manifest.jsonl"));
  const titleMap = readJsonl(path.join(options.root, "mappings", "global-title-map.jsonl"));
  const linkMap = readJsonl(path.join(options.root, "mappings", "global-link-map.jsonl"));
  const redirectMap = readJsonl(path.join(options.root, "mappings", "global-redirect-map.jsonl"));
  const referenceMap = readJsonl(path.join(options.root, "mappings", "global-reference-map.jsonl"));
  const titleById = new Map(titleMap.map((item) => [Number(item.sourceId), item]));
  const linkById = new Map(linkMap.map((item) => [Number(item.sourceId), item]));
  const refById = new Map(referenceMap.map((item) => [Number(item.sourceId), item]));
  const packageById = new Map();
  const packageBySlug = new Map();
  const failures = [];
  const syntaxIssues = [];
  const formulaIssues = [];
  const linkIssues = [];
  const referenceIssues = [];
  const provenanceIssues = [];
  const checksums = [];

  for (const filePath of packageFiles(options.root)) {
    try {
      const bytes = fs.readFileSync(filePath);
      const data = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      const id = Number(data.source?.pageid);
      if (!Number.isInteger(id) || packageById.has(id)) throw new Error("missing or duplicate source pageid");
      if (!data.page?.slug || packageBySlug.has(data.page.slug)) throw new Error("missing or duplicate Wikist slug");
      packageById.set(id, data);
      packageBySlug.set(data.page.slug, data);
      checksums.push(`${sha256(bytes)}  packages/${path.basename(filePath)}`);
    } catch (error) {
      failures.push({ file: path.relative(options.root, filePath).split(path.sep).join("/"), error: error.message });
    }
  }

  const titleKeys = new Map();
  for (const title of titleMap) {
    const key = String(title.zhTitle || "").normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
    if (!key) provenanceIssues.push({ sourceId: title.sourceId, code: "missing-zh-title" });
    else if (titleKeys.has(key)) provenanceIssues.push({ sourceId: title.sourceId, code: "duplicate-zh-title", otherSourceId: titleKeys.get(key), title: title.zhTitle });
    else titleKeys.set(key, title.sourceId);
  }

  for (const state of manifest) {
    const id = Number(state.sourceId);
    const data = packageById.get(id);
    const title = titleById.get(id);
    const rawPath = path.join(options.source, state.sourcePath);
    if (!fs.existsSync(rawPath) || sha256(fs.readFileSync(rawPath)) !== state.sourceSha256) provenanceIssues.push({ sourceId: id, code: "source-checksum-mismatch", sourcePath: state.sourcePath });
    if (!data) {
      if (!options.allowPending) failures.push({ sourceId: id, sourceTitle: state.sourceTitle, error: "missing package" });
      continue;
    }
    if (data.source?.sha256 !== state.sourceSha256 || data.source?.revisionId !== state.sourceRevisionId || data.source?.title !== state.sourceTitle) {
      provenanceIssues.push({ sourceId: id, code: "package-provenance-mismatch" });
    }
    if (data.page.title !== title?.zhTitle || data.page.slug !== title?.targetSlug) provenanceIssues.push({ sourceId: id, code: "title-map-mismatch" });
    const body = String(data.page.body || "");
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) syntaxIssues.push({ sourceId: id, code: "illegal-control-character" });
    if (/@@WIKIST_[A-Z]+_\d{6}@@/.test(body)) syntaxIssues.push({ sourceId: id, code: "unresolved-protected-token" });
    const fences = (body.match(/^```/gm) || []).length;
    if (fences % 2) syntaxIssues.push({ sourceId: id, code: "unbalanced-code-fence", count: fences });
    const displayMath = (body.match(/(?<!\\)\$\$/g) || []).length;
    if (displayMath % 2) formulaIssues.push({ sourceId: id, code: "unbalanced-display-math", count: displayMath });

    if (!data.page.redirectTarget) {
      const inputPath = state.inputPath ? path.join(options.root, state.inputPath) : "";
      if (inputPath && fs.existsSync(inputPath)) {
        const unit = readJson(inputPath);
        const formulaCounts = new Map();
        for (const token of (unit.protectedTokens || []).filter((item) => item.type === "MATH")) {
          formulaCounts.set(token.value, (formulaCounts.get(token.value) || 0) + 1);
        }
        for (const [formula, expected] of formulaCounts) {
          const actual = occurrences(body, formula);
          if (actual !== expected) formulaIssues.push({ sourceId: id, code: "formula-preservation", expected, actual, formulaSha256: sha256(formula) });
        }
        const expectedResolved = (linkById.get(id)?.links || []).filter((item) => item.status === "resolved").length;
        const outputInternal = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].filter((match) => !/^(?:File|Image):/i.test(match[1])).length;
        if (outputInternal < expectedResolved) linkIssues.push({ sourceId: id, code: "resolved-link-count", expectedAtLeast: expectedResolved, actual: outputInternal });
      }
    }

    for (const match of body.matchAll(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]*)?\]\]/g)) {
      const target = match[1].trim();
      if (/^(?:File|Image):/i.test(target)) continue;
      if (!packageBySlug.has(target)) linkIssues.push({ sourceId: id, code: "missing-output-target", target });
    }
    const referenceIds = new Set((data.page.references || []).map((item) => String(item.id || "").toLocaleLowerCase("en-US")));
    for (const match of body.matchAll(/@([a-z0-9][a-z0-9._:-]*)/gi)) {
      const citationId = match[1].toLocaleLowerCase("en-US");
      if (!referenceIds.has(citationId)) referenceIssues.push({ sourceId: id, code: "missing-reference", id: citationId });
    }
    const sourceUses = refById.get(id)?.uses || [];
    for (const use of sourceUses) if (use.id && !referenceIds.has(String(use.id).toLocaleLowerCase("en-US"))) referenceIssues.push({ sourceId: id, code: "source-reference-key-lost", id: use.id, line: use.line });
    if ((data.page.references || []).length > 120) referenceIssues.push({ sourceId: id, code: "wikist-reference-limit", count: data.page.references.length });
  }

  for (const redirect of redirectMap) {
    const data = packageById.get(Number(redirect.sourceId));
    if (!data) continue;
    if (!data.page.redirectTarget || !packageBySlug.has(data.page.redirectTarget)) linkIssues.push({ sourceId: redirect.sourceId, code: "invalid-output-redirect", target: data.page.redirectTarget || "" });
  }

  const validLinkCount = [...packageById.values()].reduce((count, data) => count + [...String(data.page.body || "").matchAll(/\[\[([^\]]+)\]\]/g)].filter((match) => !/^(?:File|Image):/i.test(match[1])).length, 0);
  const citationCalls = [...packageById.values()].reduce((count, data) => count + (String(data.page.body || "").match(/@[a-z0-9][a-z0-9._:-]*/gi) || []).length, 0);
  const needsReview = [...packageById.values()].filter((data) => data.translation?.status === "needs_review").length;
  const validated = [...packageById.values()].filter((data) => data.translation?.status === "validated").length;
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceEntries: manifest.length,
    generatedPackages: packageById.size,
    validatedPackages: validated,
    needsReview,
    failed: failures.length,
    pending: Math.max(0, manifest.length - packageById.size),
    sourceResolvedLinks: linkMap.reduce((count, item) => count + (item.links || []).filter((link) => link.status === "resolved").length, 0),
    outputInternalLinks: validLinkCount,
    linkIssues: linkIssues.length,
    sourceCitationUses: referenceMap.reduce((count, item) => count + (item.uses || []).length, 0),
    outputCitationCalls: citationCalls,
    referenceIssues: referenceIssues.length,
    sourceRedirects: redirectMap.length,
    outputRedirects: [...packageById.values()].filter((data) => data.page.redirectTarget).length,
    formulaIssues: formulaIssues.length,
    syntaxIssues: syntaxIssues.length,
    provenanceIssues: provenanceIssues.length,
    complete: packageById.size === manifest.length && failures.length === 0 && linkIssues.length === 0 && referenceIssues.length === 0 && formulaIssues.length === 0 && syntaxIssues.length === 0 && provenanceIssues.length === 0,
  };
  writeJson(path.join(options.root, "reports", "progress.json"), summary);
  writeJson(path.join(options.root, "reports", "link-integrity.json"), { generatedAt: summary.generatedAt, sourceResolved: summary.sourceResolvedLinks, outputInternal: validLinkCount, issues: linkIssues });
  writeJson(path.join(options.root, "reports", "reference-integrity.json"), { generatedAt: summary.generatedAt, sourceUses: summary.sourceCitationUses, outputCalls: citationCalls, issues: referenceIssues });
  writeJson(path.join(options.root, "reports", "redirect-integrity.json"), { generatedAt: summary.generatedAt, sourceRedirects: redirectMap.length, outputRedirects: summary.outputRedirects, issues: linkIssues.filter((item) => item.code.includes("redirect")) });
  writeJson(path.join(options.root, "reports", "formula-integrity.json"), { generatedAt: summary.generatedAt, issues: formulaIssues });
  writeJson(path.join(options.root, "reports", "syntax-integrity.json"), { generatedAt: summary.generatedAt, issues: syntaxIssues });
  writeJson(path.join(options.root, "reports", "provenance-integrity.json"), { generatedAt: summary.generatedAt, issues: provenanceIssues });
  writeJson(path.join(options.root, "reports", "translation-review.json"), {
    generatedAt: summary.generatedAt,
    needsReview,
    entries: [...packageById.values()].filter((data) => data.translation?.status === "needs_review").map((data) => ({
      sourceId: data.source?.pageid,
      sourceTitle: data.source?.title,
      zhTitle: data.page?.title,
      slug: data.page?.slug,
      issues: data.translation?.issues || [],
    })),
  });
  const titleIntegrityPath = path.join(options.root, "reports", "title-integrity.json");
  const titleIntegrity = fs.existsSync(titleIntegrityPath) ? readJson(titleIntegrityPath) : {};
  writeJson(path.join(options.root, "reports", "term-consistency.json"), {
    generatedAt: summary.generatedAt,
    titleCollisions: titleIntegrity.collisions || 0,
    termConflicts: titleIntegrity.termConflicts || 0,
    collisionDetails: titleIntegrity.collisionDetails || [],
    termConflictDetails: titleIntegrity.termConflictDetails || [],
    lowConfidenceTitles: titleMap.filter((item) => item.titleConfidence === "low").map((item) => ({ sourceId: item.sourceId, sourceTitle: item.sourceTitle, zhTitle: item.zhTitle, note: item.titleNotes || "" })),
  });
  writeJsonl(path.join(options.root, "reports", "validation-failures.jsonl"), failures);
  atomicWrite(path.join(options.root, "validation", "packages.sha256"), checksums.join("\n") + (checksums.length ? "\n" : ""));
  writeJson(path.join(options.root, "validation", "release-manifest.json"), { format: "wikist-eom-zh-release", version: 1, ...summary, sourceArchive: options.source, conversionRoot: options.root, packageChecksums: "validation/packages.sha256" });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.complete && !options.allowPending) process.exitCode = 2;
  return summary;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write("Usage: node tools/eom-zh-validate.js [--source=PATH] [--root=PATH] [--allow-pending]\n");
    else validate(options);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { validate };
