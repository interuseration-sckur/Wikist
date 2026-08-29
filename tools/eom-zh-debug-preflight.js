#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { mediaWikiToProtectedMarkdown, restoreTokens } = require("./eom-zh-convert");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function countOccurrences(text, value) {
  if (!value) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(value, offset)) >= 0) {
    count += 1;
    offset += value.length;
  }
  return count;
}

function excerpt(text, needle, radius = 220) {
  const at = String(text || "").indexOf(String(needle || ""));
  if (at < 0) return "";
  return String(text).slice(Math.max(0, at - radius), at + String(needle).length + radius).replace(/\s+/g, " ").trim();
}

function excerpts(text, needle, limit = 4, radius = 180) {
  const output = [];
  let offset = 0;
  while (output.length < limit) {
    const at = String(text || "").indexOf(String(needle || ""), offset);
    if (at < 0) break;
    output.push(String(text).slice(Math.max(0, at - radius), at + String(needle).length + radius).replace(/\s+/g, " ").trim());
    offset = at + String(needle).length;
  }
  return output;
}

const options = {
  source: process.platform === "win32" ? "G:\\Wikist-EoM" : path.join(process.cwd(), "data", "eom-archive"),
  root: process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh"),
  ids: [],
  warmup: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--source=")) options.source = path.resolve(arg.slice(9));
  else if (arg.startsWith("--root=")) options.root = path.resolve(arg.slice(7));
  else if (arg.startsWith("--ids=")) options.ids = arg.slice(6).split(",").map(Number).filter(Number.isFinite);
  else if (arg === "--warmup") options.warmup = true;
  else throw new Error(`Unknown option: ${arg}`);
}

const titles = readJsonl(path.join(options.root, "mappings", "global-title-map.jsonl"));
const titleById = new Map(titles.map((item) => [Number(item.sourceId), item]));
const titleBySourceKey = new Map(titles.map((item) => [String(item.sourceTitle || "").replace(/_/g, " ").trim().toLocaleLowerCase("en-US"), item]));
const linksById = new Map(readJsonl(path.join(options.root, "mappings", "global-link-map.jsonl")).map((item) => [Number(item.sourceId), item]));
const referencesById = new Map(readJsonl(path.join(options.root, "mappings", "global-reference-map.jsonl")).map((item) => [Number(item.sourceId), item]));
const failures = readJsonl(path.join(options.root, "reports", "preparation-failures.jsonl"));
const selected = new Set(options.ids.length ? options.ids : failures.map((item) => Number(item.sourceId)));
const output = [];

const failureById = new Map(failures.map((item) => [Number(item.sourceId), item]));
const rows = options.warmup ? titles : failures;
for (const row of rows) {
  const id = Number(row.sourceId);
  const failure = failureById.get(id);
  if (!failure && !options.warmup) continue;
  const title = titleById.get(id);
  if (!title || title.entryType === "redirect") continue;
  const source = fs.readFileSync(path.join(options.source, title.sourcePath), "utf8");
  const links = (linksById.get(id)?.links || []).map((item) => ({
    ...item,
    targetZhTitle: item.targetSourceId ? titleById.get(Number(item.targetSourceId))?.zhTitle || "" : "",
  }));
  const converted = mediaWikiToProtectedMarkdown({
    source,
    titleEntry: title,
    links,
    references: referencesById.get(id)?.references || [],
    transclusionTargets: titleBySourceKey,
  });
  if (!selected.has(id)) continue;
  const failedTokens = new Set((failure.errors || []).filter((item) => item.token).map((item) => item.token));
  const restored = restoreTokens(converted.markdown, converted.protectedTokens);
  output.push({
    sourceId: id,
    sourceTitle: title.sourceTitle,
    sourcePath: title.sourcePath,
    conversionIssues: converted.issues,
    restoreErrors: restored.errors,
    tokens: converted.protectedTokens.filter((item) => failedTokens.has(item.token)).map((item) => ({
      ...item,
      actual: countOccurrences(converted.markdown, item.token),
      sourceOccurrences: countOccurrences(source, item.value),
      sourceExcerpt: excerpt(source, item.value),
      outputExcerpt: excerpt(converted.markdown, item.token),
      outputExcerpts: excerpts(converted.markdown, item.token),
    })),
  });
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
