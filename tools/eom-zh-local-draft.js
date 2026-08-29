#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, part: 0, model: "translategemma:4b", endpoint: "http://127.0.0.1:11434", limit: 0, maxChars: 7000, retries: 3, force: false };
  for (const arg of argv) {
    if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg.startsWith("--part=")) options.part = Number(arg.slice(7));
    else if (arg.startsWith("--model=")) options.model = arg.slice(8);
    else if (arg.startsWith("--endpoint=")) options.endpoint = arg.slice(11).replace(/\/$/, "");
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice(8));
    else if (arg.startsWith("--max-chars=")) options.maxChars = Number(arg.slice(12));
    else if (arg.startsWith("--retries=")) options.retries = Number(arg.slice(10));
    else if (arg === "--force") options.force = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.root = path.resolve(options.root);
  if (!Number.isInteger(options.part) || options.part < 1 || options.part > 64) throw new Error("--part must be 1..64.");
  if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error("--limit must be a non-negative integer.");
  if (!Number.isInteger(options.maxChars) || options.maxChars < 1000 || options.maxChars > 30000) throw new Error("--max-chars must be 1000..30000.");
  return options;
}

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, filePath);
}
function appendLog(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function chunks(markdown, maxChars) {
  const blocks = String(markdown || "").split(/(\n{2,})/);
  const output = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length > maxChars) {
      output.push(current);
      current = "";
    }
    if (block.length <= maxChars) {
      current += block;
      continue;
    }
    if (current) { output.push(current); current = ""; }
    const lines = block.split(/(?<=\n)/);
    let lineChunk = "";
    for (const line of lines) {
      if (lineChunk && lineChunk.length + line.length > maxChars) { output.push(lineChunk); lineChunk = ""; }
      if (line.length <= maxChars) lineChunk += line;
      else for (let offset = 0; offset < line.length; offset += maxChars) output.push(line.slice(offset, offset + maxChars));
    }
    current = lineChunk;
  }
  if (current) output.push(current);
  return output.filter(Boolean);
}

function tokens(text) { return String(text || "").match(/@@WIKIST_[A-Z]+_\d{6}@@/g) || []; }
function tokenCounts(values) { return values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map()); }
function tokenErrors(source, output) {
  const left = tokenCounts(tokens(source));
  const right = tokenCounts(tokens(output));
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].filter((key) => left.get(key) !== right.get(key)).map((key) => ({ token: key, expected: left.get(key) || 0, actual: right.get(key) || 0 }));
}

async function ollamaChat(endpoint, model, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "30m",
        options: { temperature: 0, top_p: 0.9, num_ctx: 16384 },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    const content = String(payload.message?.content || "").trim();
    if (!content) throw new Error("Ollama returned an empty translation.");
    return content.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "");
  } finally {
    clearTimeout(timeout);
  }
}

function translationPrompt(text, extra = "", context = {}) {
  const glossary = String(context.glossary || "").trim();
  const linkedTerms = String(context.linkedTerms || "").trim();
  const entry = context.sourceTitle ? `Current entry: ${context.sourceTitle} → ${context.zhTitle || ""}.` : "";
  return `You are a professional English (en) to Chinese (Simplified) (zh-Hans) translator. Your goal is to accurately convey the meaning and nuances of the original English mathematical encyclopedia text while adhering to Chinese mathematical writing conventions. Preserve every token matching @@WIKIST_[A-Z]+_[0-9]{6}@@ byte-for-byte. Preserve Markdown headings, lists, tables, Wikist links, citation calls, numbers, symbols, names, and logical strength. Do not add, omit, summarize, explain, or correct facts. Distinguish terminology by mathematical domain and obey the supplied glossary and linked-entry title mapping when their stated context applies. ${entry}\n${glossary ? `Terminology glossary:\n${glossary}\n` : ""}${linkedTerms ? `Linked-entry title mapping:\n${linkedTerms}\n` : ""}${extra}\nProduce only the Chinese translation, without any additional explanations or commentary. Please translate the following English text into Chinese (Simplified):\n\n\n${text}`;
}

async function translateChunk(text, options, context = {}) {
  let lastError;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      const output = await ollamaChat(options.endpoint, options.model, translationPrompt(text, attempt > 1 ? "A previous attempt changed protected tokens; be especially strict about copying them exactly." : "", context));
      const errors = tokenErrors(text, output);
      if (errors.length) throw new Error(`protected token mismatch: ${JSON.stringify(errors.slice(0, 5))}`);
      return output;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function translateCategories(categories, options, context = {}) {
  const values = Array.isArray(categories) ? categories.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!values.length) return [];
  const markers = values.map((value, index) => `CATEGORY_${String(index + 1).padStart(3, "0")}: ${value}`).join("\n");
  try {
    const output = await ollamaChat(options.endpoint, options.model, translationPrompt(markers, "Keep every CATEGORY_NNN marker unchanged and translate only the category name after the colon.", context));
    const translated = new Map();
    for (const match of output.matchAll(/^CATEGORY_(\d{3}):\s*(.+)$/gm)) translated.set(Number(match[1]) - 1, match[2].trim());
    return values.map((value, index) => translated.get(index) || value).slice(0, 12);
  } catch (_error) {
    return values.slice(0, 12);
  }
}

async function run(options) {
  const partName = `part-${String(options.part).padStart(2, "0")}`;
  const queuePath = path.join(options.root, "work", "body-input", `${partName}.jsonl`);
  if (!fs.existsSync(queuePath)) throw new Error(`Body queue not found: ${queuePath}`);
  const health = await fetch(`${options.endpoint}/api/tags`);
  if (!health.ok) throw new Error(`Ollama is unavailable at ${options.endpoint}.`);
  const queue = readJsonl(queuePath);
  const glossaryData = readJson(path.join(options.root, "mappings", "global-term-glossary.json"));
  const titleMap = readJsonl(path.join(options.root, "mappings", "global-title-map.jsonl"));
  const titleBySource = new Map(titleMap.map((item) => [String(item.sourceTitle || "").replace(/_/g, " ").trim().toLocaleLowerCase("en-US"), item]));
  const glossary = (glossaryData.terms || []).map((term) => {
    const alternatives = Array.isArray(term.alternatives) && term.alternatives.length ? `; alternatives: ${term.alternatives.join("/")}` : "";
    const domain = term.domain ? `; context: ${term.domain}` : "";
    const notes = term.notes ? `; note: ${term.notes}` : "";
    return `${term.english} = ${term.preferredChinese}${alternatives}${domain}${notes}`;
  }).join("\n");
  const selected = options.limit ? queue.slice(0, options.limit) : queue;
  const logPath = path.join(options.root, "logs", `local-draft-${partName}.jsonl`);
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();
  for (const [index, item] of selected.entries()) {
    const inputPath = path.join(options.root, item.inputPath);
    const outputPath = path.join(options.root, item.outputPath);
    if (!options.force && fs.existsSync(outputPath)) { skipped += 1; continue; }
    try {
      const unit = readJson(inputPath);
      const linkedPairs = new Map();
      for (const token of unit.protectedTokens || []) {
        const sourceTarget = String(token.sourceTarget || "").replace(/_/g, " ").trim();
        if (!sourceTarget) continue;
        const target = titleBySource.get(sourceTarget.toLocaleLowerCase("en-US"));
        if (target?.zhTitle) linkedPairs.set(sourceTarget, target.zhTitle);
      }
      const linkedTerms = [...linkedPairs.entries()].slice(0, 160).map(([sourceTitle, zhTitle]) => `${sourceTitle} = ${zhTitle}`).join("\n");
      const context = { sourceTitle: unit.sourceTitle, zhTitle: unit.zhTitle, glossary, linkedTerms };
      const translatedChunks = [];
      for (const chunk of chunks(unit.markdown, options.maxChars)) translatedChunks.push(await translateChunk(chunk, options, context));
      const translatedMarkdown = translatedChunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      const errors = tokenErrors(unit.markdown, translatedMarkdown);
      if (errors.length) throw new Error(`full-page protected token mismatch: ${JSON.stringify(errors.slice(0, 10))}`);
      const zhCategories = await translateCategories(unit.categories, options, context);
      atomicWrite(outputPath, `${JSON.stringify({
        format: "wikist-eom-translation-output",
        formatVersion: 1,
        sourceId: unit.sourceId,
        sourceTitle: unit.sourceTitle,
        zhTitle: unit.zhTitle,
        translatedMarkdown,
        zhCategories,
        needsReview: true,
        modelOrAgent: `Ollama/${options.model} draft; pending Codex agent audit`,
        translatedAt: new Date().toISOString(),
        issues: [{ code: "machine-draft-awaiting-agent-audit" }],
      }, null, 2)}\n`);
      completed += 1;
      appendLog(logPath, { at: new Date().toISOString(), sourceId: unit.sourceId, status: "translated", index: index + 1, total: selected.length });
    } catch (error) {
      failed += 1;
      appendLog(logPath, { at: new Date().toISOString(), sourceId: item.sourceId, status: "failed", error: error.message, index: index + 1, total: selected.length });
    }
    if ((completed + failed) % 10 === 0) process.stdout.write(`Part ${options.part}: ${completed + skipped + failed}/${selected.length}, translated ${completed}, skipped ${skipped}, failed ${failed}\n`);
  }
  process.stdout.write(`${JSON.stringify({ part: options.part, selected: selected.length, completed, skipped, failed, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), outputRoot: path.join(options.root, "work", "body-output", partName) }, null, 2)}\n`);
  if (failed) process.exitCode = 2;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write("Usage: node tools/eom-zh-local-draft.js --part=N [--root=PATH] [--model=translategemma:4b] [--limit=N] [--force]\n");
  else run(options).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { chunks, tokenErrors, translationPrompt };
