#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { formulaBalanceIssues, restoreTokens, summaryFromBody } = require("./eom-zh-convert");

const PACKAGE_FORMAT = "wikist-eom-zh-package";
const PACKAGE_VERSION = 1;
const STATE_FORMAT = "wikist-eom-zh-package-state";
const TOKEN_PATTERN = /@@WIKIST_[A-Z]+_\d{6}@@/g;
const BLOCKING_CONVERSION_ISSUES = new Set([
  "asymptote-source-needs-rendering",
  "complex-wiki-table",
  "invalid-reference-anchor",
  "orphan-protected-token",
  "section-anchor-needs-rebinding",
  "transclusion-needs-expansion",
  "unparsed-html-table",
  "unparsed-wiki-table",
  "unresolved-html-image",
  "unresolved-transclusion",
  "unsupported-html",
  "unsupported-link-namespace",
  "unsupported-template",
]);

function usage() {
  return [
    "Build a checksummed, resumable Wikist release package from final EoM Chinese outputs.",
    "",
    "Usage:",
    "  node tools/eom-zh-package.js --root=PATH --package=PATH [options]",
    "",
    "Options:",
    "  --root=PATH          EoM Chinese conversion root (required)",
    "  --package=PATH       Release package directory (required)",
    "  --batch-size=N       Maximum new page packages per run (default: 250)",
    "  --ids=ID,ID          Explicit subset, intended for isolated verification",
    "  --dry-run            Validate and plan without writing",
    "  --resume             Resume the package state (default behavior)",
    "  --help               Show this help",
    "",
    "Use a new --package directory when title maps or already-packaged outputs change.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { root: "", packagePath: "", batchSize: 250, ids: [], dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--resume") {}
    else if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg.startsWith("--package=")) options.packagePath = arg.slice(10);
    else if (arg.startsWith("--batch-size=")) options.batchSize = Number(arg.slice(13));
    else if (arg.startsWith("--ids=")) options.ids = arg.slice(6).split(",").filter(Boolean).map(Number);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) return options;
  if (!options.root) throw new Error("--root is required.");
  if (!options.packagePath) throw new Error("--package is required.");
  options.root = path.resolve(options.root);
  options.packagePath = path.resolve(options.packagePath);
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10000) {
    throw new Error("--batch-size must be 1..10000.");
  }
  if (options.ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("--ids must contain positive integers.");
  options.ids = [...new Set(options.ids)].sort((left, right) => left - right);
  return options;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function strictText(buffer, filePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new Error(`Invalid UTF-8 in ${filePath}: ${error.message}`);
  }
}

function readJson(filePath) {
  const text = strictText(fs.readFileSync(filePath), filePath);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function readJsonl(filePath) {
  const text = strictText(fs.readFileSync(filePath), filePath);
  const rows = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSONL in ${filePath}:${index + 1}: ${error.message}`);
    }
  });
  return rows;
}

function serializedJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(filePath, bytes) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function atomicWriteJson(filePath, value) {
  atomicWrite(filePath, serializedJson(value));
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeRoots(root, packagePath) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Conversion root not found: ${root}`);
  if (root === packagePath) throw new Error("--package cannot equal --root.");
  const protectedRoots = [
    path.join(root, "work", "body-input"),
    path.join(root, "work", "body-output"),
    path.join(root, "mappings"),
    path.join(root, "manifests"),
  ];
  if (protectedRoots.some((directory) => packagePath === directory || isInside(directory, packagePath))) {
    throw new Error("--package cannot be placed inside translation inputs, outputs, mappings, or manifests.");
  }
  if (fs.existsSync(packagePath) && fs.lstatSync(packagePath).isSymbolicLink()) throw new Error("--package cannot be a symbolic link.");
}

function indexUnique(rows, field, label) {
  const result = new Map();
  for (const row of rows) {
    const key = row[field];
    if (key === undefined || key === null || key === "") throw new Error(`${label} has an empty ${field}.`);
    if (result.has(key)) throw new Error(`${label} has duplicate ${field}: ${key}`);
    result.set(key, row);
  }
  return result;
}

function tokenSequence(text) {
  return String(text || "").match(TOKEN_PATTERN) || [];
}

function countOccurrences(text, value) {
  if (!value) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = String(text).indexOf(value, offset)) >= 0) {
    count += 1;
    offset += value.length;
  }
  return count;
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeReferenceId(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function stableSourceDate(unit, state) {
  for (const value of [unit?.sourceArchivedAt, state?.sourceRevisionTimestamp]) {
    if (Number.isFinite(Date.parse(value || ""))) return new Date(value).toISOString().slice(0, 10);
  }
  return "";
}

function sourceUrl(title) {
  return `https://encyclopediaofmath.org/wiki/${encodeURIComponent(String(title).replace(/ /g, "_"))}`;
}

function packageFileName(sourceId) {
  return `${String(sourceId).padStart(8, "0")}.json`;
}

function validateTranslation(unit, output, title, titleBySlug) {
  const problems = [];
  if (Number(unit?.sourceId) !== Number(title.sourceId)) problems.push("body input sourceId differs from latest title map");
  if (unit?.sourceTitle !== title.sourceTitle) problems.push("body input sourceTitle differs from latest title map");
  if (unit?.zhTitle !== title.zhTitle) problems.push("body input zhTitle differs from latest title map");
  if (unit?.targetSlug !== title.targetSlug) problems.push("body input targetSlug differs from latest title map");
  if (output?.format !== "wikist-eom-translation-output" || output?.formatVersion !== 1) problems.push("translation output schema is not canonical");
  if (Number(output?.sourceId) !== Number(unit.sourceId)) problems.push("sourceId differs from body input");
  if (output?.sourceTitle !== unit.sourceTitle) problems.push("sourceTitle differs from body input");
  if (output?.zhTitle !== title.zhTitle) problems.push("zhTitle differs from latest global title map");
  if (output?.needsReview !== false) problems.push("needsReview is not false");
  if (!Array.isArray(output?.issues) || output.issues.length) problems.push("issues is not an empty array");
  if (typeof output?.translatedMarkdown !== "string" || !output.translatedMarkdown.trim()) problems.push("translatedMarkdown is empty");
  if (!Array.isArray(output?.zhCategories) || output.zhCategories.some((item) => typeof item !== "string")) problems.push("zhCategories is not a string array");
  if (typeof output?.modelOrAgent !== "string" || !output.modelOrAgent.trim()) problems.push("modelOrAgent is empty");
  if (!Number.isFinite(Date.parse(output?.translatedAt || ""))) problems.push("translatedAt is invalid");
  const firstLine = String(output?.translatedMarkdown || "").split(/\r?\n/).find((line) => line.trim()) || "";
  if (firstLine !== `# ${title.zhTitle}`) problems.push("first heading differs from latest global title");

  const inputTokens = tokenSequence(unit.markdown);
  const outputTokens = tokenSequence(output?.translatedMarkdown);
  const ledgerTokens = Array.isArray(unit.protectedTokens) ? unit.protectedTokens.map((item) => item?.token).filter(Boolean) : [];
  const inputTokenSet = new Set(inputTokens);
  const ledgerTokenSet = new Set(ledgerTokens);
  if (inputTokenSet.size !== inputTokens.length
    || ledgerTokenSet.size !== ledgerTokens.length
    || inputTokenSet.size !== ledgerTokenSet.size
    || [...inputTokenSet].some((token) => !ledgerTokenSet.has(token))) {
    problems.push("body input token ledger differs from markdown tokens");
  }
  if (!sameSequence(inputTokens, outputTokens)) problems.push("protected token sequence differs from body input");
  for (const token of unit.protectedTokens || []) {
    if (countOccurrences(unit.markdown, token.token) !== 1 || countOccurrences(output?.translatedMarkdown, token.token) !== 1) {
      problems.push(`protected token occurrence mismatch: ${token.token}`);
    }
    if (token.type === "TARGET") {
      const linkedTitle = titleBySlug.get(token.value);
      if (!linkedTitle) {
        problems.push(`linked title is missing from global map: ${token.value}`);
      } else {
        const wrapper = new RegExp(`\\[\\[${regexEscape(token.token)}\\|([^\\]]+)\\]\\]`, "g");
        const matches = [...String(output?.translatedMarkdown || "").matchAll(wrapper)];
        if (matches.length !== 1 || matches[0][1] !== linkedTitle.zhTitle) problems.push(`linked title is stale or malformed: ${token.token}`);
      }
    }
  }
  const blocking = (unit.conversionIssues || []).filter((issue) => BLOCKING_CONVERSION_ISSUES.has(issue?.code));
  if (blocking.length) problems.push(`blocking conversion issues remain: ${blocking.map((item) => item.code).join(", ")}`);
  return problems;
}

function buildArticlePackage(context, state, title) {
  const inputPath = state.inputPath ? path.resolve(context.root, state.inputPath) : "";
  const outputPath = inputPath ? inputPath.replace(`${path.sep}body-input${path.sep}`, `${path.sep}body-output${path.sep}`) : "";
  if (!inputPath || !fs.existsSync(inputPath)) return { status: "pending", reason: "body input is missing" };
  if (!outputPath || !fs.existsSync(outputPath)) return { status: "pending", reason: "translation output is missing" };
  const unit = readJson(inputPath);
  const outputBytes = fs.readFileSync(outputPath);
  const output = JSON.parse(strictText(outputBytes, outputPath));
  const problems = validateTranslation(unit, output, title, context.titleBySlug);
  if (problems.length) return { status: "pending", reason: problems.join("; "), outputSha256: sha256(outputBytes) };

  const restored = restoreTokens(output.translatedMarkdown, unit.protectedTokens);
  if (restored.errors.length) return { status: "invalid", reason: `token restoration failed: ${JSON.stringify(restored.errors.slice(0, 5))}` };
  if (/@@WIKIST_[A-Z]+_\d{6}@@/.test(restored.output)) return { status: "invalid", reason: "restored body still contains protected tokens" };
  const formulaIssues = formulaBalanceIssues(restored.output);
  if (formulaIssues.length) return { status: "invalid", reason: `formula balance failed: ${JSON.stringify(formulaIssues.slice(0, 5))}` };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(restored.output)) return { status: "invalid", reason: "restored body contains illegal control characters" };

  const sourceReferences = (unit.references || []).map((item) => item.reference || item);
  const referenceIds = new Set();
  for (const reference of sourceReferences) {
    const id = normalizeReferenceId(reference?.id);
    if (!id || referenceIds.has(id)) return { status: "invalid", reason: `invalid or duplicate reference id: ${reference?.id || ""}` };
    referenceIds.add(id);
  }
  const citedIds = [...restored.output.matchAll(/@([a-z0-9][a-z0-9._:-]*)/gi)].map((match) => normalizeReferenceId(match[1]));
  const unknownCitations = citedIds.filter((id) => !referenceIds.has(id));
  if (unknownCitations.length) return { status: "invalid", reason: `unknown citation ids: ${[...new Set(unknownCitations)].join(", ")}` };
  if (sourceReferences.length > 119) return { status: "invalid", reason: `reference limit exceeded: ${sourceReferences.length} source references` };

  const sourceReferenceId = `eom-source-${unit.sourceId}`;
  if (referenceIds.has(sourceReferenceId)) return { status: "invalid", reason: `reserved source reference id already exists: ${sourceReferenceId}` };
  const url = sourceUrl(title.sourceTitle);
  const sourceLicense = /Creative Commons Attribution(?:-| )Share(?:-| )Alike/i.test(unit.sourceText || "")
    ? "CC BY-SA (as stated on the EoM source page); attribution and share-alike required"
    : "EoM source terms vary; verify the original article rights before public redistribution";
  const body = `${restored.output.trim()}\n\n::: note 来源与翻译\n本词条译自 Encyclopedia of Mathematics 的“${title.sourceTitle}”词条；原修订号为 ${state.sourceRevisionId || "未记录"}。中文译文已通过发布前结构校验。[@${sourceReferenceId}]\n:::`;
  const sourceReference = {
    id: sourceReferenceId,
    type: "web",
    authors: ["Encyclopedia of Mathematics contributors"],
    title: title.sourceTitle,
    containerTitle: "Encyclopedia of Mathematics",
    year: String(state.sourceRevisionTimestamp || "").match(/^\d{4}/)?.[0] || "",
    url,
    accessed: stableSourceDate(unit, state),
    language: "en",
    note: `Archived source page ${unit.sourceId}; revision ${state.sourceRevisionId || "unknown"}; SHA-256 ${state.sourceSha256}.`,
  };
  const packageData = {
    format: "wikist-page",
    version: 1,
    source: {
      site: "Encyclopedia of Mathematics",
      pageid: Number(unit.sourceId),
      title: title.sourceTitle,
      revisionId: state.sourceRevisionId || "",
      revisionTimestamp: state.sourceRevisionTimestamp || "",
      sha256: state.sourceSha256 || unit.sourceSha256 || "",
    },
    translation: {
      status: "validated",
      modelOrAgent: output.modelOrAgent,
      translatedAt: output.translatedAt,
      sourceOutputSha256: sha256(outputBytes),
      issues: [],
    },
    page: {
      slug: title.targetSlug,
      title: title.zhTitle,
      summary: String(output.summary || "").trim().slice(0, 220) || summaryFromBody(restored.output),
      categories: output.zhCategories.length ? output.zhCategories.slice(0, 12) : ["EoM 待分类"],
      difficulty: "未分级",
      status: "review",
      quality: "Draft",
      author: "EoM contributors / Wikist 中文转换",
      importSource: "encyclopedia-of-mathematics",
      importTitle: title.sourceTitle,
      importLang: "en",
      importRevision: state.sourceRevisionId || "",
      importUrl: url,
      importFetchedAt: unit.sourceArchivedAt || "",
      importLicense: sourceLicense,
      canonicalNames: [...new Set([title.zhTitle, title.sourceTitle, ...(title.zhAliases || [])])].slice(0, 40),
      disambiguation: title.entryType === "disambiguation",
      classifications: unit.classifications || [],
      references: [...sourceReferences, sourceReference],
      body,
    },
  };
  return { status: "ready", packageData, outputSha256: sha256(outputBytes) };
}

function buildRedirectPackage(context, state, title) {
  const redirect = context.redirectById.get(Number(state.sourceId));
  if (!redirect || redirect.status !== "resolved" || !redirect.targetSlug) return { status: "invalid", reason: "redirect target is unresolved" };
  const target = context.titleById.get(Number(redirect.targetSourceId));
  if (!target || target.targetSlug !== redirect.targetSlug) return { status: "invalid", reason: "redirect target differs from latest title map" };
  if (target.entryType === "redirect") return { status: "invalid", reason: "redirect target is not canonical" };
  if (context.explicitSelection && !context.selectedIds.has(Number(redirect.targetSourceId))) {
    return { status: "invalid", reason: "explicit redirect selection must also include its target" };
  }
  const packageData = {
    format: "wikist-page",
    version: 1,
    source: {
      site: "Encyclopedia of Mathematics",
      pageid: Number(state.sourceId),
      title: title.sourceTitle,
      revisionId: state.sourceRevisionId || "",
      revisionTimestamp: state.sourceRevisionTimestamp || "",
      sha256: state.sourceSha256 || "",
    },
    translation: {
      status: "validated",
      modelOrAgent: "not-required-redirect",
      translatedAt: state.sourceRevisionTimestamp || context.createdAt,
      sourceOutputSha256: "",
      issues: [],
    },
    page: {
      slug: title.targetSlug,
      title: title.zhTitle,
      summary: `重定向至${target.zhTitle}。`,
      categories: ["EoM 重定向"],
      difficulty: "未分级",
      status: "review",
      quality: "Draft",
      author: "EoM contributors / Wikist 中文转换",
      importSource: "encyclopedia-of-mathematics",
      importTitle: title.sourceTitle,
      importLang: "en",
      importRevision: state.sourceRevisionId || "",
      importUrl: sourceUrl(title.sourceTitle),
      importFetchedAt: context.createdAt,
      importLicense: "mixed-or-unspecified; retain EoM page and revision notices",
      canonicalNames: [...new Set([title.zhTitle, title.sourceTitle, ...(title.zhAliases || [])])].slice(0, 40),
      redirectTarget: target.targetSlug,
      references: [],
      body: "",
    },
  };
  return { status: "ready", packageData, outputSha256: "" };
}

function entryFromPackage(packageData, relativePath, digest, sourceOutputSha256) {
  return {
    sourceId: Number(packageData.source.pageid),
    sourceTitle: packageData.source.title,
    slug: packageData.page.slug,
    title: packageData.page.title,
    redirectTarget: packageData.page.redirectTarget || "",
    sourceRevisionId: packageData.source.revisionId || "",
    sourceOutputSha256: sourceOutputSha256 || "",
    path: relativePath,
    sha256: digest,
  };
}

function stateSelectionFingerprint(titleMapBytes, redirectMapBytes, selectedIds) {
  return sha256(Buffer.concat([
    Buffer.from(sha256(titleMapBytes), "ascii"),
    Buffer.from("\n", "ascii"),
    Buffer.from(sha256(redirectMapBytes), "ascii"),
    Buffer.from("\n", "ascii"),
    Buffer.from(selectedIds.join(","), "ascii"),
  ]));
}

function loadContext(options) {
  assertSafeRoots(options.root, options.packagePath);
  const manifestPath = path.join(options.root, "manifests", "conversion-manifest.jsonl");
  const titleMapPath = path.join(options.root, "mappings", "global-title-map.jsonl");
  const redirectMapPath = path.join(options.root, "mappings", "global-redirect-map.jsonl");
  for (const required of [manifestPath, titleMapPath, redirectMapPath]) if (!fs.existsSync(required)) throw new Error(`Required conversion file not found: ${required}`);
  const manifestBytes = fs.readFileSync(manifestPath);
  const titleMapBytes = fs.readFileSync(titleMapPath);
  const redirectMapBytes = fs.readFileSync(redirectMapPath);
  const manifest = readJsonl(manifestPath);
  const titleMap = readJsonl(titleMapPath);
  const redirectMap = readJsonl(redirectMapPath);
  const stateById = indexUnique(manifest.map((row) => ({ ...row, sourceId: Number(row.sourceId) })), "sourceId", "conversion manifest");
  const titleById = indexUnique(titleMap.map((row) => ({ ...row, sourceId: Number(row.sourceId) })), "sourceId", "global title map");
  const titleBySlug = indexUnique(titleMap, "targetSlug", "global title map");
  const redirectById = indexUnique(redirectMap.map((row) => ({ ...row, sourceId: Number(row.sourceId) })), "sourceId", "global redirect map");
  const selectedIds = options.ids.length ? options.ids : [...stateById.keys()].sort((left, right) => left - right);
  const missingIds = selectedIds.filter((id) => !stateById.has(id));
  if (missingIds.length) throw new Error(`--ids are absent from conversion manifest: ${missingIds.join(", ")}`);
  for (const id of selectedIds) {
    if (!titleById.has(id)) throw new Error(`Latest title is missing for sourceId ${id}.`);
    const state = stateById.get(id);
    const title = titleById.get(id);
    if (state.sourceTitle !== title.sourceTitle || state.targetSlug !== title.targetSlug) throw new Error(`Manifest/title mismatch for sourceId ${id}.`);
  }
  const conversionRootPath = path.join(options.root, "conversion-root.json");
  const conversionRoot = fs.existsSync(conversionRootPath) ? readJson(conversionRootPath) : {};
  return {
    root: options.root,
    packagePath: options.packagePath,
    stateById,
    titleById,
    titleBySlug,
    redirectById,
    selectedIds: new Set(selectedIds),
    selectedIdList: selectedIds,
    explicitSelection: options.ids.length > 0,
    createdAt: Number.isFinite(Date.parse(conversionRoot.indexedAt || conversionRoot.createdAt || ""))
      ? new Date(conversionRoot.indexedAt || conversionRoot.createdAt).toISOString()
      : "",
    fingerprint: stateSelectionFingerprint(titleMapBytes, redirectMapBytes, selectedIds),
    manifestSha256: sha256(manifestBytes),
    titleMapSha256: sha256(titleMapBytes),
    redirectMapSha256: sha256(redirectMapBytes),
  };
}

function newState(context) {
  const now = new Date().toISOString();
  return {
    format: STATE_FORMAT,
    formatVersion: PACKAGE_VERSION,
    createdAt: now,
    updatedAt: now,
    selection: {
      mode: context.explicitSelection ? "explicit" : "all",
      sourceIds: context.selectedIdList,
      fingerprint: context.fingerprint,
      titleMapSha256: context.titleMapSha256,
      redirectMapSha256: context.redirectMapSha256,
    },
    completed: {},
    lastRun: null,
  };
}

function loadState(context, dryRun) {
  const statePath = path.join(context.packagePath, "build-state.json");
  if (!fs.existsSync(statePath)) return { state: newState(context), statePath, fresh: true };
  const state = readJson(statePath);
  if (state.format !== STATE_FORMAT || state.formatVersion !== PACKAGE_VERSION) throw new Error("Existing build-state.json has an unsupported format.");
  if (state.selection?.fingerprint !== context.fingerprint) throw new Error("Existing package selection or title maps changed; use a new --package directory.");
  if (!state.completed || typeof state.completed !== "object" || Array.isArray(state.completed)) throw new Error("Existing build state is malformed.");
  return { state, statePath, fresh: false, dryRun };
}

function buildCandidate(context, id) {
  const state = context.stateById.get(id);
  const title = context.titleById.get(id);
  if (state.entryType === "redirect" || title.entryType === "redirect") return buildRedirectPackage(context, state, title);
  return buildArticlePackage(context, state, title);
}

function validateCompletedEntry(context, id, completed) {
  const filePath = path.resolve(context.packagePath, completed.path || "");
  if (!isInside(context.packagePath, filePath) || path.dirname(filePath) !== path.join(context.packagePath, "pages")) throw new Error(`Unsafe completed path for sourceId ${id}.`);
  if (!fs.existsSync(filePath)) throw new Error(`Completed package file is missing for sourceId ${id}.`);
  const bytes = fs.readFileSync(filePath);
  if (sha256(bytes) !== completed.sha256) throw new Error(`Completed package checksum changed for sourceId ${id}.`);
  const data = JSON.parse(strictText(bytes, filePath));
  if (Number(data.source?.pageid) !== id || data.translation?.status !== "validated") throw new Error(`Completed package metadata changed for sourceId ${id}.`);
  const state = context.stateById.get(id);
  const title = context.titleById.get(id);
  if (data.source?.title !== state.sourceTitle
    || String(data.source?.revisionId || "") !== String(state.sourceRevisionId || "")
    || String(data.source?.sha256 || "") !== String(state.sourceSha256 || "")
    || data.page?.title !== title.zhTitle
    || data.page?.slug !== title.targetSlug) {
    throw new Error(`Packaged provenance changed for sourceId ${id}; use a new --package directory.`);
  }
  if (state.entryType !== "redirect" && title.entryType !== "redirect") {
    const inputPath = path.resolve(context.root, state.inputPath || "");
    const outputPath = inputPath.replace(`${path.sep}body-input${path.sep}`, `${path.sep}body-output${path.sep}`);
    if (!fs.existsSync(outputPath)) throw new Error(`Packaged translation output disappeared for sourceId ${id}.`);
    if (sha256(fs.readFileSync(outputPath)) !== completed.sourceOutputSha256) throw new Error(`Packaged translation output changed for sourceId ${id}; use a new --package directory.`);
  }
  return entryFromPackage(data, completed.path, completed.sha256, completed.sourceOutputSha256);
}

function releaseManifest(context, state, entries, status, pending, invalid) {
  const ordered = [...entries].sort((left, right) => {
    const leftRedirect = left.redirectTarget ? 1 : 0;
    const rightRedirect = right.redirectTarget ? 1 : 0;
    return leftRedirect - rightRedirect || left.sourceId - right.sourceId;
  }).map((entry, sequence) => ({ sequence, ...entry }));
  const contentSha256 = sha256(Buffer.from(JSON.stringify({ sourceIds: context.selectedIdList, entries: ordered.map(({ sequence, ...entry }) => entry) }), "utf8"));
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_VERSION,
    status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    contentSha256,
    selection: {
      mode: context.explicitSelection ? "explicit" : "all",
      expectedEntries: context.selectedIdList.length,
      sourceIdsSha256: sha256(Buffer.from(context.selectedIdList.join(","), "ascii")),
      titleMapSha256: context.titleMapSha256,
      redirectMapSha256: context.redirectMapSha256,
    },
    counts: {
      expected: context.selectedIdList.length,
      packaged: ordered.length,
      pending: pending.length,
      invalid: invalid.length,
      articles: ordered.filter((entry) => !entry.redirectTarget).length,
      redirects: ordered.filter((entry) => entry.redirectTarget).length,
    },
    entries: ordered,
  };
}

function writeReleaseMetadata(context, state, pending, invalid) {
  const entries = Object.entries(state.completed).map(([id, completed]) => validateCompletedEntry(context, Number(id), completed));
  const status = entries.length === context.selectedIdList.length && !pending.length && !invalid.length ? "ready" : "building";
  const manifest = releaseManifest(context, state, entries, status, pending, invalid);
  const manifestBytes = serializedJson(manifest);
  atomicWrite(path.join(context.packagePath, "manifest.json"), manifestBytes);
  const checksumLines = [
    ...manifest.entries.map((entry) => `${entry.sha256}  ${entry.path}`),
    `${sha256(manifestBytes)}  manifest.json`,
  ];
  atomicWrite(path.join(context.packagePath, "checksums.sha256"), Buffer.from(`${checksumLines.join("\n")}\n`, "utf8"));
  return manifest;
}

function packageCorpus(options) {
  const context = loadContext(options);
  const loaded = loadState(context, options.dryRun);
  const state = loaded.state;
  const completedEntries = [];
  for (const [idText, completed] of Object.entries(state.completed)) {
    const id = Number(idText);
    if (!context.selectedIds.has(id)) throw new Error(`Build state contains unselected sourceId ${id}.`);
    completedEntries.push(validateCompletedEntry(context, id, completed));
  }

  const pending = [];
  const invalid = [];
  const planned = [];
  let written = 0;
  for (const id of context.selectedIdList) {
    if (state.completed[id]) continue;
    let candidate;
    try {
      candidate = buildCandidate(context, id);
    } catch (error) {
      candidate = { status: "invalid", reason: error.message };
    }
    if (candidate.status === "pending") {
      pending.push({ sourceId: id, reason: candidate.reason });
      continue;
    }
    if (candidate.status !== "ready") {
      invalid.push({ sourceId: id, reason: candidate.reason || "package validation failed" });
      continue;
    }
    if (planned.length >= options.batchSize) continue;
    const relativePath = `pages/${packageFileName(id)}`;
    const bytes = serializedJson(candidate.packageData);
    const digest = sha256(bytes);
    planned.push({ sourceId: id, relativePath, digest, sourceOutputSha256: candidate.outputSha256, packageData: candidate.packageData });
    if (options.dryRun) continue;

    const target = path.join(context.packagePath, ...relativePath.split("/"));
    if (fs.existsSync(target)) {
      const existingDigest = sha256(fs.readFileSync(target));
      if (existingDigest !== digest) throw new Error(`Conflicting package file already exists for sourceId ${id}.`);
    } else {
      atomicWrite(target, bytes);
      written += 1;
    }
    state.completed[id] = { path: relativePath, sha256: digest, sourceOutputSha256: candidate.outputSha256 || "" };
    state.updatedAt = new Date().toISOString();
    state.lastRun = { at: state.updatedAt, batchSize: options.batchSize, lastSourceId: id };
    atomicWriteJson(loaded.statePath, state);
  }

  if (options.dryRun) {
    const projected = completedEntries.length + planned.length;
    const report = {
      mode: "dry-run",
      root: context.root,
      package: context.packagePath,
      selection: context.selectedIdList.length,
      alreadyPackaged: completedEntries.length,
      wouldPackage: planned.length,
      projectedPackaged: projected,
      pending: pending.length,
      invalid: invalid.length,
      remainingAfterBatch: Math.max(0, context.selectedIdList.length - projected),
      readyAfterBatch: projected === context.selectedIdList.length && !pending.length && !invalid.length,
      pendingEntries: pending,
      invalidEntries: invalid,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  ensureDir(context.packagePath);
  ensureDir(path.join(context.packagePath, "pages"));
  if (!fs.existsSync(loaded.statePath)) atomicWriteJson(loaded.statePath, state);

  const postPending = [];
  const postInvalid = [];
  for (const id of context.selectedIdList) {
    if (state.completed[id]) continue;
    try {
      const candidate = buildCandidate(context, id);
      if (candidate.status === "ready") postPending.push({ sourceId: id, reason: "deferred by batch limit" });
      else if (candidate.status === "pending") postPending.push({ sourceId: id, reason: candidate.reason });
      else postInvalid.push({ sourceId: id, reason: candidate.reason || "package validation failed" });
    } catch (error) {
      postInvalid.push({ sourceId: id, reason: error.message });
    }
  }
  const manifest = writeReleaseMetadata(context, state, postPending, postInvalid);
  const report = {
    mode: "write",
    root: context.root,
    package: context.packagePath,
    status: manifest.status,
    selection: context.selectedIdList.length,
    packaged: manifest.counts.packaged,
    written,
    resumed: manifest.counts.packaged - written,
    pending: manifest.counts.pending,
    invalid: manifest.counts.invalid,
    remaining: manifest.counts.expected - manifest.counts.packaged,
    contentSha256: manifest.contentSha256,
    manifest: path.join(context.packagePath, "manifest.json"),
    checksums: path.join(context.packagePath, "checksums.sha256"),
    pendingEntries: postPending,
    invalidEntries: postInvalid,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (manifest.status !== "ready") process.exitCode = 2;
  return report;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else packageCorpus(options);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  packageCorpus,
  parseArgs,
  serializedJson,
  sha256,
};
