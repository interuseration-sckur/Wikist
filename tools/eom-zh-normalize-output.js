#!/usr/bin/env node
"use strict";

const cp = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { TextDecoder, isDeepStrictEqual } = require("util");

const DEFAULT_ROOT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");
const FORMAT = "wikist-eom-translation-output";
const VERSION = 1;
const META = ["format", "formatVersion", "sourceId", "sourceTitle", "zhTitle"];
const REQUIRED = ["format", "formatVersion", "sourceId", "sourceTitle", "zhTitle", "translatedMarkdown", "zhCategories", "needsReview", "modelOrAgent", "translatedAt", "issues"];
const ENGLISH_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "for", "from", "has", "have", "if", "in", "into", "is", "it", "its", "may", "not", "of", "on", "one", "or", "such", "than", "that", "the", "their", "then", "there", "these", "this", "to", "two", "was", "were", "when", "where", "which", "will", "with", "whose", "would"]);

function args(values) {
  const o = { root: DEFAULT_ROOT, dryRun: false, auditOnly: false, report: "", maxPasses: 12, settleMs: 250, help: false };
  for (const value of values) {
    if (value.startsWith("--root=")) o.root = value.slice(7);
    else if (value === "--dry-run") o.dryRun = true;
    else if (value === "--audit-only") o.auditOnly = true;
    else if (value === "--report") o.report = "default";
    else if (value.startsWith("--report=")) o.report = value.slice(9);
    else if (value.startsWith("--max-passes=")) o.maxPasses = Number(value.slice(13));
    else if (value.startsWith("--settle-ms=")) o.settleMs = Number(value.slice(12));
    else if (value === "--help" || value === "-h") o.help = true;
    else throw new Error("Unknown option: " + value);
  }
  o.root = path.resolve(o.root);
  o.report = o.report === "default" ? path.join(o.root, "reports", "body-output-integrity.json") : (o.report ? path.resolve(o.report) : "");
  if (!Number.isInteger(o.maxPasses) || o.maxPasses < 1 || o.maxPasses > 100) throw new Error("--max-passes must be 1..100.");
  if (!Number.isInteger(o.settleMs) || o.settleMs < 0 || o.settleMs > 10000) throw new Error("--settle-ms must be 0..10000.");
  if (o.dryRun && o.auditOnly) throw new Error("--dry-run and --audit-only cannot be combined.");
  if (o.dryRun && o.report) throw new Error("--dry-run never writes; omit --report.");
  return o;
}

function help() {
  process.stdout.write([
    "Usage: node tools/eom-zh-normalize-output.js [options]",
    "  --root=PATH",
    "  --dry-run",
    "  --audit-only",
    "  --report[=PATH]",
    "  --max-passes=N",
    "  --settle-ms=N",
    "",
  ].join("\n"));
}

function hash(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function sleep(ms) { if (ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function mkdir(directory) { fs.mkdirSync(directory, { recursive: true }); }

function parseBuffer(buffer, file) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch (error) { throw new Error("Invalid UTF-8 in " + file + ": " + error.message); }
  text = text.replace(/^\uFEFF/, "");
  try { return { buffer, hash: hash(buffer), text, value: JSON.parse(text) }; }
  catch (error) { throw new Error("Invalid JSON in " + file + ": " + error.message); }
}

function readJson(file) { return parseBuffer(fs.readFileSync(file), file); }

function readJsonl(file) {
  const buffer = fs.readFileSync(file);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""); }
  catch (error) { throw new Error("Invalid UTF-8 in " + file + ": " + error.message); }
  const records = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { records.push(JSON.parse(line)); }
    catch (error) { throw new Error("Invalid JSONL in " + file + ":" + (index + 1) + ": " + error.message); }
  });
  return { buffer, hash: hash(buffer), records };
}

function enumerate(root) {
  if (!fs.existsSync(root)) return { parts: [], files: [] };
  const parts = fs.readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory() && /^part-\d+$/.test(x.name)).map((x) => x.name).sort();
  const files = [];
  for (const part of parts) {
    const directory = path.join(root, part);
    for (const x of fs.readdirSync(directory, { withFileTypes: true }).filter((y) => y.isFile() && /\.json$/i.test(y.name)).sort((a, b) => a.name.localeCompare(b.name, "en-US"))) {
      files.push({ part, filename: x.name, filePath: path.join(directory, x.name) });
    }
  }
  return { parts, files };
}

function key(item) { return (item.part + "/" + item.filename).toLocaleLowerCase("en-US"); }

function snapshotHash(items) {
  const value = items.map((x) => x.relativePath + "\0" + x.hash).sort().join("\n");
  return hash(Buffer.from(value, "utf8"));
}

function inputIndex(root) {
  const listing = enumerate(root);
  const byRelative = new Map();
  const byId = new Map();
  const snapshots = [];
  const errors = [];
  for (const item of listing.files) {
    let record;
    try { record = readJson(item.filePath); }
    catch (error) { errors.push({ code: "invalid-input", inputPath: item.filePath, reason: error.message }); continue; }
    if (!record.value || typeof record.value !== "object" || Array.isArray(record.value)) {
      errors.push({ code: "invalid-input-root", inputPath: item.filePath, reason: "Input root must be an object." });
      continue;
    }
    const entry = { ...item, input: record.value, hash: record.hash };
    byRelative.set(key(item), entry);
    if (Number.isSafeInteger(entry.input.sourceId)) {
      const list = byId.get(entry.input.sourceId) || [];
      list.push(entry);
      byId.set(entry.input.sourceId, list);
    }
    snapshots.push({ relativePath: key(item), hash: record.hash });
  }
  for (const [sourceId, list] of byId) {
    if (list.length > 1) errors.push({ code: "duplicate-input-sourceId", sourceId, reason: "Duplicate body-input sourceId.", inputPaths: list.map((x) => x.filePath) });
  }
  return { listing, byRelative, byId, errors, hash: snapshotHash(snapshots) };
}

function titleIndex(file) {
  const loaded = readJsonl(file);
  const byId = new Map();
  const errors = [];
  for (const title of loaded.records) {
    if (!Number.isSafeInteger(title.sourceId)) { errors.push({ code: "invalid-title-sourceId", sourceId: title.sourceId }); continue; }
    if (byId.has(title.sourceId)) { errors.push({ code: "duplicate-title-sourceId", sourceId: title.sourceId }); continue; }
    byId.set(title.sourceId, title);
  }
  return { ...loaded, byId, errors };
}

function roots(o) {
  return {
    input: path.join(o.root, "work", "body-input"),
    output: path.join(o.root, "work", "body-output"),
    titles: path.join(o.root, "mappings", "global-title-map.jsonl"),
  };
}

function authority(item, inputs, titles) {
  const errors = [];
  const inputEntry = inputs.byRelative.get(key(item));
  if (!inputEntry) return { errors: [{ code: "output-without-input", reason: "No corresponding body-input." }] };
  const input = inputEntry.input;
  if (!Number.isSafeInteger(input.sourceId)) errors.push({ code: "invalid-input-sourceId", reason: "Input sourceId is invalid." });
  if (typeof input.sourceTitle !== "string" || !input.sourceTitle.trim()) errors.push({ code: "invalid-input-sourceTitle", reason: "Input sourceTitle is invalid." });
  const title = Number.isSafeInteger(input.sourceId) ? titles.byId.get(input.sourceId) : null;
  if (!title) errors.push({ code: "missing-global-title", reason: "Global title record is missing." });
  else {
    if (typeof title.zhTitle !== "string" || !title.zhTitle.trim()) errors.push({ code: "invalid-global-zhTitle", reason: "Global zhTitle is invalid." });
    if (title.sourceTitle !== input.sourceTitle) errors.push({ code: "title-input-sourceTitle-mismatch", reason: "Global and input sourceTitle differ.", input: input.sourceTitle, titleMap: title.sourceTitle });
  }
  const match = /^(\d{8})\.json$/i.exec(item.filename);
  if (!match) errors.push({ code: "invalid-output-filename", reason: "Filename must be eight digits plus .json." });
  else if (Number.isSafeInteger(input.sourceId) && Number(match[1]) !== input.sourceId) errors.push({ code: "filename-input-sourceId-mismatch", reason: "Filename and input sourceId differ.", filenameSourceId: Number(match[1]), inputSourceId: input.sourceId });
  return {
    errors,
    inputEntry,
    title,
    desired: errors.length ? null : { format: FORMAT, formatVersion: VERSION, sourceId: input.sourceId, sourceTitle: input.sourceTitle, zhTitle: title.zhTitle },
  };
}

function withoutMeta(object) {
  const result = {};
  for (const [name, value] of Object.entries(object)) if (!META.includes(name)) result[name] = value;
  return result;
}

function normalized(object, desired) {
  const result = { format: desired.format, formatVersion: desired.formatVersion, sourceId: desired.sourceId, sourceTitle: desired.sourceTitle, zhTitle: desired.zhTitle };
  for (const [name, value] of Object.entries(object)) if (!META.includes(name)) result[name] = value;
  return result;
}

function normalizeFile(item, inputs, titles) {
  let buffer;
  try { buffer = fs.readFileSync(item.filePath); }
  catch (error) { return { item, hash: null, sourceId: null, changes: [], errors: [{ code: "unreadable-output", reason: error.message }] }; }
  const originalHash = hash(buffer);
  let record;
  try { record = parseBuffer(buffer, item.filePath); }
  catch (error) { return { item, buffer, hash: originalHash, sourceId: null, changes: [], errors: [{ code: error.message.startsWith("Invalid UTF-8") ? "invalid-utf8" : "invalid-json", reason: error.message }] }; }
  const object = record.value;
  if (!object || typeof object !== "object" || Array.isArray(object)) return { item, buffer, hash: originalHash, sourceId: null, changes: [], errors: [{ code: "invalid-output-root", reason: "Output root must be an object." }] };
  const auth = authority(item, inputs, titles);
  const sourceId = auth.inputEntry && Number.isSafeInteger(auth.inputEntry.input.sourceId) ? auth.inputEntry.input.sourceId : (Number.isSafeInteger(object.sourceId) ? object.sourceId : null);
  if (auth.errors.length) return { item, buffer, hash: originalHash, object, sourceId, changes: [], errors: auth.errors };
  const changes = META.filter((name) => !isDeepStrictEqual(object[name], auth.desired[name])).map((name) => ({
    field: name,
    beforePresent: Object.prototype.hasOwnProperty.call(object, name),
    before: Object.prototype.hasOwnProperty.call(object, name) ? object[name] : null,
    after: auth.desired[name],
  }));
  const result = normalized(object, auth.desired);
  if (!isDeepStrictEqual(withoutMeta(object), withoutMeta(result))) throw new Error("Preserved-field invariant failed for " + item.filePath);
  return {
    item, buffer, hash: originalHash, object, sourceId, changes, errors: [], result,
    text: JSON.stringify(result, null, 2) + "\n",
    payloadHash: hash(Buffer.from(JSON.stringify(withoutMeta(object)), "utf8")),
  };
}

function scanNormalize(outputRoot, inputs, titles) {
  const listing = enumerate(outputRoot);
  const results = listing.files.map((item) => normalizeFile(item, inputs, titles));
  const hashes = new Map(results.filter((x) => x.hash).map((x) => [x.item.filePath.toLocaleLowerCase("en-US"), x.hash]));
  const fieldMismatches = Object.fromEntries(META.map((name) => [name, 0]));
  for (const result of results) for (const change of result.changes) fieldMismatches[change.field] += 1;
  return {
    listing, results, hashes,
    summary: {
      scanned: results.length,
      conforming: results.filter((x) => !x.errors.length && !x.changes.length).length,
      needingNormalization: results.filter((x) => x.changes.length).length,
      unfixable: results.filter((x) => x.errors.length).length,
      fieldMismatches,
    },
  };
}

function stable(outputRoot, listing, hashes, titleFile, titleHash, settleMs) {
  sleep(settleMs);
  const current = enumerate(outputRoot);
  if (!isDeepStrictEqual(listing.files.map((x) => x.filePath.toLocaleLowerCase("en-US")), current.files.map((x) => x.filePath.toLocaleLowerCase("en-US")))) return false;
  for (const item of current.files) {
    try { if (hashes.get(item.filePath.toLocaleLowerCase("en-US")) !== hash(fs.readFileSync(item.filePath))) return false; }
    catch { return false; }
  }
  try { return hash(fs.readFileSync(titleFile)) === titleHash; }
  catch { return false; }
}

function atomicReplace(candidate) {
  const target = candidate.item.filePath;
  if (hash(fs.readFileSync(target)) !== candidate.hash) return "conflict-before-write";
  const temporary = target + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", fs.statSync(target).mode);
    fs.writeFileSync(fd, candidate.text, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    if (hash(fs.readFileSync(target)) !== candidate.hash) return "conflict-before-rename";
    fs.renameSync(temporary, target);
    const written = readJson(target).value;
    if (!isDeepStrictEqual(withoutMeta(written), withoutMeta(candidate.object))) throw new Error("Post-write preserved-field invariant failed for " + target);
    if (hash(Buffer.from(JSON.stringify(withoutMeta(written)), "utf8")) !== candidate.payloadHash) throw new Error("Post-write payload hash failed for " + target);
    return "written";
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function details(scan) {
  return scan.results.filter((x) => x.changes.length || x.errors.length).map((x) => ({
    part: x.item.part, sourceId: x.sourceId, outputPath: x.item.filePath, changes: x.changes, errors: x.errors,
  }));
}

function runNormalize(o, r, inputs) {
  let first;
  let final;
  let pass = 0;
  let writes = 0;
  let checks = 0;
  const changed = new Map();
  const conflicts = [];
  for (; pass < o.maxPasses; pass += 1) {
    const titles = titleIndex(r.titles);
    if (titles.errors.length) throw new Error("Global title map index errors: " + titles.errors.length);
    const scan = scanNormalize(r.output, inputs, titles);
    if (!first) first = scan;
    if (o.dryRun) {
      if (stable(r.output, scan.listing, scan.hashes, r.titles, titles.hash, o.settleMs)) { final = scan; pass += 1; break; }
      continue;
    }
    for (const candidate of scan.results.filter((x) => !x.errors.length && x.changes.length)) {
      const status = atomicReplace(candidate);
      if (status === "written") {
        writes += 1;
        checks += 1;
        changed.set(candidate.item.filePath.toLocaleLowerCase("en-US"), { part: candidate.item.part, sourceId: candidate.sourceId, outputPath: candidate.item.filePath, changes: candidate.changes });
      } else conflicts.push({ part: candidate.item.part, sourceId: candidate.sourceId, outputPath: candidate.item.filePath, status });
    }
    const verifyTitles = titleIndex(r.titles);
    const verify = scanNormalize(r.output, inputs, verifyTitles);
    if (!verify.summary.needingNormalization && !verify.summary.unfixable && stable(r.output, verify.listing, verify.hashes, r.titles, verifyTitles.hash, o.settleMs)) {
      final = verify;
      pass += 1;
      break;
    }
  }
  if (!final) throw new Error("No stable output snapshot after " + o.maxPasses + " passes.");
  return {
    mode: o.dryRun ? "dry-run" : "write", stable: true, passes: pass,
    before: first.summary, writes, filesChanged: changed.size, preservedPayloadChecksPassed: checks, conflicts,
    after: o.dryRun ? { scanned: first.summary.scanned, projectedConforming: first.summary.conforming + first.summary.needingNormalization, projectedRemainingMetadataChanges: 0, projectedUnfixable: first.summary.unfixable } : final.summary,
    details: o.dryRun ? details(first) : [...changed.values()],
    errors: final.results.flatMap((x) => x.errors.map((error) => ({ part: x.item.part, sourceId: x.sourceId, outputPath: x.item.filePath, ...error }))),
  };
}

function tokens(text) { return String(text || "").match(/@@WIKIST_[A-Z]+_\d{6}@@/g) || []; }

function tokenDiff(expected, actual) {
  const count = (values) => {
    const result = new Map();
    for (const value of values) result.set(value, (result.get(value) || 0) + 1);
    return result;
  };
  const left = count(expected);
  const right = count(actual);
  const missing = [];
  const extra = [];
  for (const value of new Set([...left.keys(), ...right.keys()])) {
    const difference = (left.get(value) || 0) - (right.get(value) || 0);
    if (difference > 0) missing.push({ token: value, count: difference });
    if (difference < 0) extra.push({ token: value, count: -difference });
  }
  return { missing, extra };
}

function readable(text) {
  return String(text || "")
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ").replace(/\x60[^\x60]*\x60/g, " ")
    .replace(/@@WIKIST_[A-Z]+_\d{6}@@/g, " ").replace(/https?:\/\/\S+/gi, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(/[#>*_|~\-\[\](){}]/g, " ").replace(/\s+/g, " ").trim();
}

function bodyOnly(text) {
  const lines = String(text || "").split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (/^#{2,6}\s*(references|bibliography|further reading|\u53C2\u8003\u6587\u732E)\s*$/i.test(line.trim())) break;
    kept.push(line);
  }
  return readable(kept.join("\n"));
}

function words(text) { return String(text || "").toLocaleLowerCase("en-US").match(/[a-z]+(?:'[a-z]+)?/g) || []; }

function bigrams(values) {
  const result = new Set();
  for (let i = 0; i + 1 < values.length; i += 1) result.add(values[i] + "\0" + values[i + 1]);
  return result;
}

function language(input, output) {
  const inputWords = words(bodyOnly(input));
  const clean = bodyOnly(output);
  const outputWords = words(clean);
  const han = (clean.match(/[\u3400-\u9FFF]/g) || []).length;
  const latin = (clean.match(/[A-Za-z]/g) || []).length;
  const functionWords = outputWords.filter((x) => ENGLISH_WORDS.has(x)).length;
  const left = bigrams(inputWords);
  const right = bigrams(outputWords);
  let overlap = 0;
  for (const value of right) if (left.has(value)) overlap += 1;
  const similarity = right.size ? overlap / right.size : 0;
  const ratio = outputWords.length ? functionWords / outputWords.length : 0;
  const obvious = outputWords.length >= 45 && latin >= 220 && han <= 8 && functionWords >= 8 && ratio >= 0.10 && similarity >= 0.72;
  return { status: obvious ? "fail" : "pass", obvious, inputEnglishWords: inputWords.length, outputEnglishWords: outputWords.length, outputHanCharacters: han, outputLatinCharacters: latin, functionWordCount: functionWords, functionWordRatio: Number(ratio.toFixed(4)), englishBigramSimilarityToInput: Number(similarity.toFixed(4)) };
}

function issue(entry, severity, code, reason, data) { entry.issues.push({ severity, code, reason, ...(data || {}) }); }

function audit(r, inputs, titles) {
  const listing = enumerate(r.output);
  const entries = [];
  const hashes = new Map();
  const byId = new Map();
  for (const item of listing.files) {
    const nameMatch = /^(\d{8})\.json$/i.exec(item.filename);
    const nameId = nameMatch ? Number(nameMatch[1]) : null;
    const entry = { part: item.part, sourceId: nameId, filename: item.filename, outputPath: item.filePath, inputPath: null, status: "pending", needsReview: null, tokenValidation: null, languageValidation: null, issues: [] };
    entries.push(entry);
    let buffer;
    try { buffer = fs.readFileSync(item.filePath); hashes.set(item.filePath.toLocaleLowerCase("en-US"), hash(buffer)); }
    catch (error) { issue(entry, "error", "unreadable-output", error.message); continue; }
    let record;
    try { record = parseBuffer(buffer, item.filePath); }
    catch (error) { issue(entry, "error", error.message.startsWith("Invalid UTF-8") ? "invalid-utf8" : "invalid-json", error.message); continue; }
    if (record.text.includes("\uFFFD")) issue(entry, "error", "utf8-replacement-character", "Output contains U+FFFD.");
    if (/[\u0080-\u009F]/.test(record.text)) issue(entry, "error", "suspicious-c1-control", "Output contains a C1 control.");
    const output = record.value;
    if (!output || typeof output !== "object" || Array.isArray(output)) { issue(entry, "error", "schema-root-type", "Output root must be an object."); continue; }
    for (const field of REQUIRED) if (!Object.prototype.hasOwnProperty.call(output, field)) issue(entry, "error", "schema-missing-field", "Missing required field.", { field });
    if (output.format !== FORMAT) issue(entry, "error", "schema-format", "Noncanonical format.", { actual: output.format, expected: FORMAT });
    if (output.formatVersion !== VERSION) issue(entry, "error", "schema-format-version", "Noncanonical formatVersion.", { actual: output.formatVersion, expected: VERSION });
    if (!Number.isSafeInteger(output.sourceId) || output.sourceId <= 0) issue(entry, "error", "schema-sourceId", "sourceId must be a positive safe integer.");
    if (typeof output.sourceTitle !== "string" || !output.sourceTitle.trim()) issue(entry, "error", "schema-sourceTitle", "sourceTitle must be nonempty.");
    if (typeof output.zhTitle !== "string" || !output.zhTitle.trim()) issue(entry, "error", "schema-zhTitle", "zhTitle must be nonempty.");
    if (typeof output.translatedMarkdown !== "string") issue(entry, "error", "schema-translatedMarkdown", "translatedMarkdown must be a string.");
    if (!Array.isArray(output.zhCategories) || output.zhCategories.some((x) => typeof x !== "string")) issue(entry, "error", "schema-zhCategories", "zhCategories must be a string array.");
    if (typeof output.needsReview !== "boolean") issue(entry, "error", "schema-needsReview", "needsReview must be boolean.");
    if (typeof output.modelOrAgent !== "string" || !output.modelOrAgent.trim()) issue(entry, "error", "schema-modelOrAgent", "modelOrAgent must be nonempty.");
    if (typeof output.translatedAt !== "string" || !Number.isFinite(Date.parse(output.translatedAt))) issue(entry, "error", "schema-translatedAt", "translatedAt must be parseable.");
    if (!Array.isArray(output.issues)) issue(entry, "error", "schema-issues", "issues must be an array.");
    if (Object.prototype.hasOwnProperty.call(output, "summary") && typeof output.summary !== "string") issue(entry, "error", "schema-summary", "summary must be a string.");
    entry.sourceId = Number.isSafeInteger(output.sourceId) ? output.sourceId : nameId;
    entry.needsReview = typeof output.needsReview === "boolean" ? output.needsReview : null;
    if (Number.isSafeInteger(output.sourceId)) {
      const list = byId.get(output.sourceId) || [];
      list.push(entry);
      byId.set(output.sourceId, list);
    }
    if (!nameMatch) issue(entry, "error", "invalid-output-filename", "Filename is not eight digits plus .json.");
    else if (Number.isSafeInteger(output.sourceId) && nameId !== output.sourceId) issue(entry, "error", "filename-sourceId-mismatch", "Filename and JSON sourceId differ.", { filenameSourceId: nameId, jsonSourceId: output.sourceId });
    const auth = authority(item, inputs, titles);
    for (const problem of auth.errors) issue(entry, "error", problem.code, problem.reason, problem);
    if (!auth.inputEntry || !auth.desired) continue;
    const input = auth.inputEntry.input;
    entry.inputPath = auth.inputEntry.filePath;
    if (output.sourceId !== auth.desired.sourceId) issue(entry, "error", "sourceId-input-mismatch", "sourceId differs from input.");
    if (output.sourceTitle !== auth.desired.sourceTitle) issue(entry, "error", "sourceTitle-input-mismatch", "sourceTitle differs from input.");
    if (output.zhTitle !== auth.desired.zhTitle) issue(entry, "error", "zhTitle-global-map-mismatch", "zhTitle differs from latest global map.");
    if (input.entryType === "redirect") issue(entry, "error", "output-for-redirect-input", "Output corresponds to redirect input.");
    if (typeof output.translatedMarkdown === "string") {
      if (!output.translatedMarkdown.trim()) issue(entry, "error", "empty-translated-markdown", "translatedMarkdown is empty.");
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(output.translatedMarkdown)) issue(entry, "error", "illegal-control-character", "translatedMarkdown has illegal controls.");
      const heading = output.translatedMarkdown.split(/\r?\n/).find((x) => x.trim()) || "";
      if (typeof output.zhTitle === "string" && heading !== "# " + output.zhTitle) issue(entry, "warning", "heading-zhTitle-mismatch", "First heading differs from canonical zhTitle.", { expected: "# " + output.zhTitle, actual: heading });
      if (typeof input.markdown === "string") {
        const expected = tokens(input.markdown);
        const actual = tokens(output.translatedMarkdown);
        const ledger = Array.isArray(input.protectedTokens) ? input.protectedTokens.map((x) => x && x.token).filter(Boolean) : [];
        const ledgerDifference = tokenDiff(expected, ledger);
        if (ledgerDifference.missing.length || ledgerDifference.extra.length) issue(entry, "error", "input-token-ledger-mismatch", "Input token ledger differs.", ledgerDifference);
        const difference = tokenDiff(expected, actual);
        const sequenceMatches = isDeepStrictEqual(expected, actual);
        entry.tokenValidation = { status: !difference.missing.length && !difference.extra.length && sequenceMatches ? "pass" : "fail", inputCount: expected.length, outputCount: actual.length, sequenceMatches, ...difference };
        if (difference.missing.length || difference.extra.length) issue(entry, "error", "protected-token-count-mismatch", "Token multiset differs.", difference);
        if (!sequenceMatches) issue(entry, "error", "protected-token-order-mismatch", "Token order differs.");
        if (readable(input.markdown) && !readable(output.translatedMarkdown)) issue(entry, "error", "empty-human-readable-body", "Readable body became empty.");
        entry.languageValidation = language(input.markdown, output.translatedMarkdown);
        if (entry.languageValidation.obvious) issue(entry, "error", "obvious-untranslated-english-body", "Body appears substantially untranslated.", entry.languageValidation);
      }
    }
    if (Array.isArray(output.issues) && typeof output.needsReview === "boolean") {
      output.issues.forEach((x, i) => {
        if (!x || typeof x !== "object" || Array.isArray(x)) issue(entry, "error", "issues-item-type", "Issue must be an object.", { index: i });
        else if (typeof x.code !== "string" || !x.code.trim()) issue(entry, "error", "issues-item-code", "Issue code is missing.", { index: i });
      });
      if (output.needsReview && !output.issues.length) issue(entry, "error", "needsReview-without-issues", "needsReview=true but issues is empty.");
      if (!output.needsReview && output.issues.length) issue(entry, "error", "issues-without-needsReview", "needsReview=false but issues is nonempty.");
    }
  }
  for (const [sourceId, list] of byId) if (list.length > 1) for (const entry of list) issue(entry, "error", "duplicate-output-sourceId", "Duplicate output sourceId.", { sourceId, outputPaths: list.map((x) => x.outputPath) });
  for (const entry of entries) {
    const errors = entry.issues.filter((x) => x.severity === "error").length;
    const warnings = entry.issues.filter((x) => x.severity === "warning").length;
    entry.status = errors ? "fail" : (warnings ? "pass-with-warning" : "pass");
    entry.issueCount = entry.issues.length;
    entry.issueCodes = [...new Set(entry.issues.map((x) => x.code))];
  }
  return { listing, entries, hashes };
}

function regression() {
  const checker = path.join(__dirname, "check-eom-zh-pipeline.js");
  const startedAt = new Date().toISOString();
  const result = cp.spawnSync(process.execPath, [checker], { cwd: path.dirname(__dirname), encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const completedAt = new Date().toISOString();
  const stdout = String(result.stdout || "");
  const matches = [...stdout.matchAll(/\{\r?\n\s*"passed"\s*:/g)];
  let parsed;
  if (matches.length) try { parsed = JSON.parse(stdout.slice(matches[matches.length - 1].index)); } catch {}
  const passed = Number(parsed && parsed.passed || 0);
  const failedChecks = parsed && parsed.checks ? Object.entries(parsed.checks).filter((x) => x[1] !== true).map((x) => x[0]) : [];
  return { command: "node " + checker, startedAt, completedAt, expected: 52, passed, failed: Math.max(0, 52 - passed), failedChecks, exitCode: result.status, status: result.status === 0 && passed === 52 && !failedChecks.length ? "passed" : "failed", stderr: String(result.stderr || "") };
}

function summarize(r, inputs, titles, result, tests, snapshot) {
  const issues = result.entries.flatMap((entry) => entry.issues.map((x) => ({ sourceId: entry.sourceId, part: entry.part, outputPath: entry.outputPath, ...x }))).sort((a, b) => String(a.part).localeCompare(String(b.part)) || Number(a.sourceId || 0) - Number(b.sourceId || 0) || a.code.localeCompare(b.code));
  const codes = {};
  for (const item of issues) codes[item.code] = (codes[item.code] || 0) + 1;
  const filesFor = (...wanted) => new Set(issues.filter((x) => wanted.some((value) => value.endsWith("*") ? x.code.startsWith(value.slice(0, -1)) : x.code === value)).map((x) => x.outputPath)).size;
  const idsFor = (code) => new Set(issues.filter((x) => x.code === code && Number.isSafeInteger(x.sourceId)).map((x) => x.sourceId)).size;
  const failed = result.entries.filter((x) => x.status === "fail");
  const warnings = result.entries.filter((x) => x.status === "pass-with-warning");
  const perPart = {};
  for (const part of [...new Set([...inputs.listing.parts, ...result.listing.parts])].sort()) {
    const values = result.entries.filter((x) => x.part === part);
    perPart[part] = {
      inputFiles: inputs.listing.files.filter((x) => x.part === part).length,
      outputFiles: values.length,
      passed: values.filter((x) => x.status !== "fail").length,
      failed: values.filter((x) => x.status === "fail").length,
      passWithWarning: values.filter((x) => x.status === "pass-with-warning").length,
      needsReviewTrue: values.filter((x) => x.needsReview === true).length,
      needsReviewFalse: values.filter((x) => x.needsReview === false).length,
      expectedTokens: values.reduce((sum, x) => sum + Number(x.tokenValidation && x.tokenValidation.inputCount || 0), 0),
      outputTokens: values.reduce((sum, x) => sum + Number(x.tokenValidation && x.tokenValidation.outputCount || 0), 0),
    };
  }
  const problemIds = [...new Set(issues.map((x) => x.sourceId).filter(Number.isSafeInteger))].sort((a, b) => a - b);
  const errorIds = [...new Set(issues.filter((x) => x.severity === "error").map((x) => x.sourceId).filter(Number.isSafeInteger))].sort((a, b) => a - b);
  const expectedTokens = result.entries.reduce((sum, x) => sum + Number(x.tokenValidation && x.tokenValidation.inputCount || 0), 0);
  const outputTokens = result.entries.reduce((sum, x) => sum + Number(x.tokenValidation && x.tokenValidation.outputCount || 0), 0);
  return {
    format: "wikist-eom-body-output-integrity-report", formatVersion: 2, generatedAt: new Date().toISOString(),
    snapshot: {
      ...snapshot, stable: true, inputRoot: r.input, outputRoot: r.output, titleMapPath: r.titles,
      inputSnapshotSha256: inputs.hash, titleMapSha256: titles.hash,
      outputSnapshotSha256: snapshotHash(result.listing.files.map((x) => ({ relativePath: key(x), hash: result.hashes.get(x.filePath.toLocaleLowerCase("en-US")) }))),
    },
    criteria: {
      canonicalFormat: FORMAT, canonicalFormatVersion: VERSION, requiredFields: REQUIRED, optionalFields: ["summary"],
      titleAuthority: "mappings/global-title-map.jsonl by sourceId", sourceAuthority: "corresponding body-input part and filename",
      tokenRule: "Token multiset and occurrence sequence must exactly match body-input.",
      headingRule: "Heading mismatch is warning-only because normalization is metadata-only.",
      encodingRule: "Strict UTF-8 with no replacement, C1, or illegal C0 characters.",
      reviewRule: "needsReview and issues must agree; every issue requires code.",
    },
    regression: tests,
    summary: {
      overallStatus: !failed.length && tests.status === "passed" ? "passed" : "failed",
      totalInputFilesIndexed: inputs.listing.files.length, totalTitleMapRecords: titles.records.length, totalOutputs: result.entries.length,
      passed: result.entries.length - failed.length, failed: failed.length, passWithWarning: warnings.length,
      issueCount: issues.length, errorCount: issues.filter((x) => x.severity === "error").length, warningCount: issues.filter((x) => x.severity === "warning").length,
      problemSourceIds: problemIds, problemSourceIdCount: problemIds.length, errorSourceIds: errorIds, errorSourceIdCount: errorIds.length,
      needsReviewTrue: result.entries.filter((x) => x.needsReview === true).length, needsReviewFalse: result.entries.filter((x) => x.needsReview === false).length,
      expectedTokens, outputTokens,
      tokenValidationPassed: result.entries.filter((x) => x.tokenValidation && x.tokenValidation.status === "pass").length,
      tokenValidationFailed: result.entries.filter((x) => x.tokenValidation && x.tokenValidation.status === "fail").length,
      schemaFailures: filesFor("schema-*", "sourceId-input-mismatch", "sourceTitle-input-mismatch", "zhTitle-global-map-mismatch", "invalid-output-filename", "filename-sourceId-mismatch", "filename-input-sourceId-mismatch", "output-without-input"),
      duplicateOutputSourceIds: idsFor("duplicate-output-sourceId"), outputsWithoutInput: filesFor("output-without-input"),
      partOrFilenameMismatches: filesFor("invalid-output-filename", "filename-sourceId-mismatch", "filename-input-sourceId-mismatch"),
      tokenFailures: filesFor("input-token-ledger-mismatch", "protected-token-count-mismatch", "protected-token-order-mismatch"),
      utf8Failures: filesFor("invalid-utf8", "utf8-replacement-character", "suspicious-c1-control", "illegal-control-character"),
      emptyTranslations: filesFor("empty-translated-markdown", "empty-human-readable-body"),
      obviousUntranslatedEnglishBodies: filesFor("obvious-untranslated-english-body"),
      reviewConsistencyFailures: filesFor("needsReview-without-issues", "issues-without-needsReview", "issues-item-type", "issues-item-code"),
      headingTitleWarnings: filesFor("heading-zhTitle-mismatch"), perPart, issueCodeCounts: codes,
    },
    issues, entries: result.entries,
  };
}

function auditStable(o, r, inputs) {
  for (let attempt = 1; attempt <= o.maxPasses; attempt += 1) {
    const startedAt = new Date().toISOString();
    const titles = titleIndex(r.titles);
    if (titles.errors.length) throw new Error("Global title map index errors: " + titles.errors.length);
    const result = audit(r, inputs, titles);
    if (!stable(r.output, result.listing, result.hashes, r.titles, titles.hash, o.settleMs)) continue;
    const tests = regression();
    if (!stable(r.output, result.listing, result.hashes, r.titles, titles.hash, o.settleMs)) continue;
    return summarize(r, inputs, titles, result, tests, { startedAt, completedAt: new Date().toISOString(), attempts: attempt });
  }
  throw new Error("No stable audit snapshot after " + o.maxPasses + " passes.");
}

function atomicWrite(file, text) {
  mkdir(path.dirname(file));
  const temporary = file + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  let fd;
  try { fd = fs.openSync(temporary, "wx"); fs.writeFileSync(fd, text, "utf8"); fs.fsyncSync(fd); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function main() {
  const o = args(process.argv.slice(2));
  if (o.help) return help();
  const r = roots(o);
  for (const required of [r.input, r.output, r.titles]) if (!fs.existsSync(required)) throw new Error("Required path missing: " + required);
  const inputs = inputIndex(r.input);
  if (inputs.errors.length) throw new Error("body-input index errors: " + inputs.errors.length);
  const normalization = o.auditOnly ? null : runNormalize(o, r, inputs);
  let report = null;
  if (o.report) {
    report = auditStable(o, r, inputs);
    report.normalization = normalization;
    atomicWrite(o.report, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify({
    tool: "eom-zh-normalize-output", mode: o.auditOnly ? "audit-only" : (o.dryRun ? "dry-run" : "write"), root: o.root,
    normalization, audit: report ? report.summary : null, regression: report ? report.regression : null, reportPath: o.report || null,
  }, null, 2) + "\n");
  if (normalization && normalization.errors.length) process.exitCode = 1;
  if (report && report.summary.overallStatus !== "passed") process.exitCode = 1;
}

try { main(); }
catch (error) { process.stderr.write((error && error.stack ? error.stack : String(error)) + "\n"); process.exitCode = 1; }
