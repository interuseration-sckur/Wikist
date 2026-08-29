#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");
const DEFAULT_TITLE_OVERRIDES = path.join(__dirname, "eom-zh-title-overrides.json");

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, parts: 8, allowPartial: false, titleOverrides: DEFAULT_TITLE_OVERRIDES };
  for (const arg of argv) {
    if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg.startsWith("--parts=")) options.parts = Number(arg.slice(8));
    else if (arg.startsWith("--title-overrides=")) options.titleOverrides = arg.slice(18);
    else if (arg === "--allow-partial") options.allowPartial = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.root = path.resolve(options.root);
  options.titleOverrides = path.resolve(options.titleOverrides);
  if (!Number.isInteger(options.parts) || options.parts < 1 || options.parts > 64) throw new Error("--parts must be 1..64.");
  return options;
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL ${filePath}:${index + 1}: ${error.message}`); }
  });
}
function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, filePath);
}
function writeJson(filePath, value) { atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(filePath, rows) { atomicWrite(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }

function cleanTitle(value) {
  return String(value || "").normalize("NFKC").replace(/[\u0000-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function titleKey(value) { return cleanTitle(value).toLocaleLowerCase("zh-CN"); }

function cleanNote(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function readTitleOverrides(filePath = DEFAULT_TITLE_OVERRIDES) {
  const document = readJson(filePath);
  if (document.format !== "wikist-eom-title-overrides" || document.formatVersion !== 1 || !Array.isArray(document.overrides)) {
    throw new Error("Invalid title override document: " + filePath);
  }
  const seen = new Set();
  const overrides = document.overrides.map((row, index) => {
    const sourceId = Number(row.sourceId);
    const sourceTitle = cleanTitle(row.sourceTitle);
    const zhTitle = cleanTitle(row.zhTitle);
    const titleConfidence = String(row.titleConfidence || "");
    const reason = cleanNote(row.reason);
    if (!Number.isInteger(sourceId) || sourceId < 1) throw new Error("Invalid sourceId in title override " + filePath + ":" + (index + 1));
    if (seen.has(sourceId)) throw new Error("Duplicate sourceId " + sourceId + " in title overrides: " + filePath);
    if (!sourceTitle || !zhTitle || !reason) throw new Error("Incomplete title override for sourceId " + sourceId + ": " + filePath);
    if (titleConfidence !== "high") throw new Error("Only high-confidence title overrides are accepted; sourceId " + sourceId + " is " + (titleConfidence || "unset") + ".");
    seen.add(sourceId);
    return { sourceId, sourceTitle, zhTitle, titleConfidence, reason };
  });
  return overrides.sort((left, right) => left.sourceId - right.sourceId);
}

function applyTitleOverrides(titleMap, overrides) {
  const itemById = new Map(titleMap.map((item) => [Number(item.sourceId), item]));
  const applications = [];
  const conflicts = [];
  for (const override of overrides) {
    const item = itemById.get(override.sourceId);
    if (!item) {
      conflicts.push({ ...override, conflict: "missing-source-id" });
      continue;
    }
    if (cleanTitle(item.sourceTitle) !== override.sourceTitle) {
      conflicts.push({
        ...override,
        actualSourceTitle: item.sourceTitle,
        conflict: "source-title-mismatch",
      });
      continue;
    }
    const previousZhTitle = cleanTitle(item.zhTitle);
    item.zhTitle = override.zhTitle;
    item.titleConfidence = override.titleConfidence;
    item.titleNotes = override.reason;
    item.titleStatus = "translated";
    applications.push({
      sourceId: override.sourceId,
      sourceTitle: item.sourceTitle,
      previousZhTitle,
      overrideZhTitle: override.zhTitle,
      titleConfidence: override.titleConfidence,
      reason: override.reason,
    });
  }
  return { applications, conflicts };
}

function titleAuditIssues(sourceTitle, translated) {
  const title = cleanTitle(translated.zhTitle);
  const notes = String(translated.titleNotes || "");
  const issues = [];
  if (!/[\p{Script=Han}]/u.test(title) && /[A-Za-z]{3}/.test(sourceTitle)) issues.push("中文标题仍为纯拉丁字母形式");
  if (/未确认|待核验|不确定|无法确认/.test(notes) && translated.titleConfidence === "high") issues.push("备注表示未确认但置信度标为 high");
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) if ((title.split(open).length - 1) !== (title.split(close).length - 1)) issues.push(`标题中的 ${open}${close} 不配对`);
  if (/\?{2,}|�|[\u0000-\u001F]/.test(title)) issues.push("标题含异常字符");
  return issues;
}

function consolidate(options) {
  const mapPath = path.join(options.root, "mappings", "global-title-map.jsonl");
  const manifestPath = path.join(options.root, "manifests", "conversion-manifest.jsonl");
  const titleMap = readJsonl(mapPath);
  const manifest = readJsonl(manifestPath);
  const translatedById = new Map();
  const partStats = [];
  const malformed = [];

  for (let index = 1; index <= options.parts; index += 1) {
    const name = `part-${String(index).padStart(2, "0")}.jsonl`;
    const inputPath = path.join(options.root, "work", "title-input", name);
    const outputPath = path.join(options.root, "work", "title-output", name);
    const input = readJsonl(inputPath);
    const output = readJsonl(outputPath);
    const expected = new Set(input.map((item) => Number(item.sourceId)));
    const unique = new Set();
    for (const [rowIndex, row] of output.entries()) {
      const id = Number(row.sourceId);
      if (!expected.has(id) || !Number.isInteger(id) || unique.has(id) || !cleanTitle(row.zhTitle)) {
        malformed.push({ part: index, line: rowIndex + 1, sourceId: row.sourceId, reason: unique.has(id) ? "duplicate-source-id" : !expected.has(id) ? "unexpected-source-id" : "missing-title" });
        continue;
      }
      unique.add(id);
      translatedById.set(id, row);
    }
    const missing = [...expected].filter((id) => !unique.has(id));
    partStats.push({ part: index, input: input.length, output: output.length, valid: unique.size, missing: missing.length, missingIds: missing.slice(0, 100) });
  }

  if ((malformed.length || translatedById.size !== titleMap.length) && !options.allowPartial) {
    writeJson(path.join(options.root, "reports", "title-consolidation-blocked.json"), { generatedAt: new Date().toISOString(), expected: titleMap.length, translated: translatedById.size, malformed, parts: partStats });
    throw new Error(`Title mapping is incomplete: expected ${titleMap.length}, valid ${translatedById.size}, malformed ${malformed.length}.`);
  }

  const collisions = [];
  const suspiciousTitles = [];
  const termCandidates = [];
  for (const item of titleMap) {
    const translated = translatedById.get(Number(item.sourceId));
    if (!translated) continue;
    item.zhTitle = cleanTitle(translated.zhTitle);
    item.zhAliases = [...new Set([item.sourceTitle, ...(Array.isArray(translated.zhAliases) ? translated.zhAliases : [])].map(cleanTitle).filter(Boolean))].slice(0, 20);
    item.titleConfidence = ["high", "medium", "low"].includes(translated.titleConfidence) ? translated.titleConfidence : "low";
    item.titleNotes = cleanNote(translated.titleNotes);
    for (const term of Array.isArray(translated.termCandidates) ? translated.termCandidates : []) {
      termCandidates.push({ ...term, sourceId: item.sourceId, sourceTitle: item.sourceTitle });
    }
  }

  const titleOverrides = readTitleOverrides(options.titleOverrides);
  const overrideResult = applyTitleOverrides(titleMap, titleOverrides);
  if (overrideResult.conflicts.length) {
    writeJson(path.join(options.root, "reports", "title-consolidation-blocked.json"), {
      generatedAt: new Date().toISOString(),
      expected: titleMap.length,
      translated: translatedById.size,
      malformed,
      parts: partStats,
      titleOverrides: {
        path: options.titleOverrides,
        configured: titleOverrides.length,
        applied: overrideResult.applications.length,
        conflicts: overrideResult.conflicts.length,
        conflictDetails: overrideResult.conflicts,
      },
    });
    throw new Error("Title overrides conflict with the title map: " + overrideResult.conflicts.length + " conflict(s).");
  }

  const overrideSourceIds = new Set(overrideResult.applications.map((item) => item.sourceId));
  const titleOwners = new Map();
  for (const item of titleMap) {
    if (!translatedById.has(Number(item.sourceId)) && !overrideSourceIds.has(Number(item.sourceId))) continue;
    const auditIssues = titleAuditIssues(item.sourceTitle, item);
    if (auditIssues.length) {
      item.titleConfidence = "low";
      item.titleNotes = [item.titleNotes, ...auditIssues].filter(Boolean).join("；").slice(0, 500);
      suspiciousTitles.push({ sourceId: item.sourceId, sourceTitle: item.sourceTitle, zhTitle: item.zhTitle, issues: auditIssues });
    }
    item.titleStatus = item.titleConfidence === "high" ? "translated" : "needs_review";
    const key = titleKey(item.zhTitle);
    const owner = titleOwners.get(key);
    if (owner) {
      const original = item.zhTitle;
      item.zhTitle = cleanTitle(item.zhTitle + "（" + item.sourceTitle + "）");
      item.titleStatus = "needs_review";
      item.titleConfidence = "low";
      item.titleNotes = [item.titleNotes, "中文题名与源词条 " + owner.sourceTitle + " 冲突，暂以英文原题消歧。"].filter(Boolean).join(" ");
      collisions.push({
        zhTitle: original,
        firstSourceId: owner.sourceId,
        firstSourceTitle: owner.sourceTitle,
        adjustedSourceId: item.sourceId,
        adjustedSourceTitle: item.sourceTitle,
        adjustedZhTitle: item.zhTitle,
        overrideInvolved: overrideSourceIds.has(Number(owner.sourceId)) || overrideSourceIds.has(Number(item.sourceId)),
      });
    } else {
      titleOwners.set(key, item);
    }
  }

  const itemById = new Map(titleMap.map((item) => [Number(item.sourceId), item]));
  for (const application of overrideResult.applications) {
    const finalZhTitle = cleanTitle(itemById.get(application.sourceId)?.zhTitle);
    application.finalZhTitle = finalZhTitle;
    application.collisionAdjusted = finalZhTitle !== application.overrideZhTitle;
    application.effective = finalZhTitle === application.overrideZhTitle
      || finalZhTitle.startsWith(application.overrideZhTitle + "(");
  }
  for (const state of manifest) {
    const title = itemById.get(Number(state.sourceId));
    if (!title?.zhTitle) continue;
    state.status = title.titleStatus === "needs_review" ? "title_needs_review" : "title_mapped";
    state.translationStatus = "pending";
    state.needsReview = title.titleStatus === "needs_review";
    state.issues = state.needsReview ? [{ code: "title-needs-review", note: title.titleNotes }] : [];
    state.updatedAt = new Date().toISOString();
  }

  const glossaryPath = path.join(options.root, "mappings", "global-term-glossary.json");
  const glossary = readJson(glossaryPath);
  const knownTerms = new Map((glossary.terms || []).map((term) => [String(term.english || "").toLocaleLowerCase("en-US"), term]));
  const termConflicts = [];
  for (const candidate of termCandidates) {
    const english = cleanTitle(candidate.english);
    const preferredChinese = cleanTitle(candidate.preferredChinese);
    if (!english || !preferredChinese) continue;
    const key = english.toLocaleLowerCase("en-US");
    const known = knownTerms.get(key);
    if (known && cleanTitle(known.preferredChinese) !== preferredChinese) {
      termConflicts.push({ english, existing: known.preferredChinese, proposed: preferredChinese, sourceId: candidate.sourceId, sourceTitle: candidate.sourceTitle });
      continue;
    }
    if (!known) {
      const term = {
        english,
        preferredChinese,
        alternatives: Array.isArray(candidate.alternatives) ? candidate.alternatives.map(cleanTitle).filter(Boolean).slice(0, 10) : [],
        domain: cleanTitle(candidate.domain),
        confidence: ["high", "medium", "low"].includes(candidate.confidence) ? candidate.confidence : "low",
        notes: cleanTitle(candidate.notes),
        source: `title:${candidate.sourceId}`,
      };
      glossary.terms.push(term);
      knownTerms.set(key, term);
    }
  }
  glossary.updatedAt = new Date().toISOString();

  writeJsonl(mapPath, titleMap);
  writeJsonl(manifestPath, manifest);
  writeJson(glossaryPath, glossary);
  writeJson(path.join(options.root, "reports", "title-integrity.json"), {
    generatedAt: new Date().toISOString(),
    expected: titleMap.length,
    translated: titleMap.filter((item) => item.zhTitle).length,
    high: titleMap.filter((item) => item.titleConfidence === "high").length,
    medium: titleMap.filter((item) => item.titleConfidence === "medium").length,
    low: titleMap.filter((item) => item.titleConfidence === "low").length,
    collisions: collisions.length,
    collisionDetails: collisions,
    malformed,
    termConflicts: termConflicts.length,
    termConflictDetails: termConflicts,
    suspiciousTitles: suspiciousTitles.length,
    suspiciousTitleDetails: suspiciousTitles,
    titleOverrides: {
      path: path.relative(path.resolve(__dirname, ".."), options.titleOverrides).split(path.sep).join("/"),
      configured: titleOverrides.length,
      applied: overrideResult.applications.length,
      effective: overrideResult.applications.filter((item) => item.effective).length,
      collisionAdjusted: overrideResult.applications.filter((item) => item.collisionAdjusted).length,
      conflicts: overrideResult.conflicts.length,
      applications: overrideResult.applications,
      conflictDetails: overrideResult.conflicts,
    },
    parts: partStats,
  });
  process.stdout.write(JSON.stringify({
    expected: titleMap.length,
    translated: titleMap.filter((item) => item.zhTitle).length,
    low: titleMap.filter((item) => item.titleConfidence === "low").length,
    collisions: collisions.length,
    termConflicts: termConflicts.length,
    titleOverridesApplied: overrideResult.applications.length,
    titleOverridesEffective: overrideResult.applications.filter((item) => item.effective).length,
    titleOverrideConflicts: overrideResult.conflicts.length,
  }, null, 2) + "\n");
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write("Usage: node tools/eom-zh-titles.js [--root=PATH] [--parts=8] [--title-overrides=PATH] [--allow-partial]\n");
    else consolidate(options);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { applyTitleOverrides, cleanTitle, consolidate, readTitleOverrides, titleAuditIssues };
