#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { inlineReferenceId, parseReferenceRows, referenceId } = require("./eom-zh-index");

const DEFAULT_SOURCE = process.platform === "win32" ? "G:\\Wikist-EoM" : path.join(process.cwd(), "data", "eom-archive");
const DEFAULT_ROOT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");

function usage() {
  return `
Prepare protected translation units or finalize translated EoM entries.

Usage:
  node tools/eom-zh-convert.js prepare [--source=PATH] [--root=PATH] [--parts=8] [--force]
  node tools/eom-zh-convert.js finalize [--source=PATH] [--root=PATH] [--force]
`.trim();
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "";
  const options = { command, source: DEFAULT_SOURCE, root: DEFAULT_ROOT, parts: 8, force: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--source=")) options.source = arg.slice(9);
    else if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg.startsWith("--parts=")) options.parts = Number(arg.slice(8));
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.source = path.resolve(options.source);
  options.root = path.resolve(options.root);
  if (!options.help && !["prepare", "finalize"].includes(options.command)) throw new Error("Command must be prepare or finalize.");
  if (!Number.isInteger(options.parts) || options.parts < 1 || options.parts > 64) throw new Error("--parts must be 1..64.");
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

function createProtector() {
  const tokens = [];
  const protect = (type, value, metadata = {}) => {
    const token = `@@WIKIST_${type}_${String(tokens.length + 1).padStart(6, "0")}@@`;
    tokens.push({ token, type, value: String(value), ...metadata });
    return token;
  };
  return { tokens, protect };
}

function lineNumberAt(source, offset) {
  return String(source || "").slice(0, Math.max(0, offset)).split("\n").length;
}

function referenceSectionRanges(source) {
  const text = String(source || "");
  const lines = text.split(/(?<=\n)/);
  const ranges = [];
  let offset = 0;
  let active = null;
  for (const line of lines) {
    const content = line.replace(/\r?\n$/, "");
    const heading = content.match(/^\s*(={2,6})\s*(.*?)\s*\1\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (active && level <= active.level) {
        ranges.push({ ...active, end: offset });
        active = null;
      }
      if (/^(?:References|Bibliography|Literature|Further reading)$/i.test(heading[2].trim())) {
        active = { start: offset, contentStart: offset + line.length, end: text.length, level, heading: heading[2].trim() };
      }
    }
    offset += line.length;
  }
  if (active) ranges.push({ ...active, end: text.length });
  return ranges;
}

function offsetInRanges(offset, ranges) {
  return ranges.some((range) => offset >= range.contentStart && offset < range.end);
}

function looksBibliographic(value) {
  const text = String(value || "");
  return /(?:\b(?:1[5-9]\d{2}|20\d{2})\b|\{\{\s*(?:ISBN|MR|ZBL|DOI|ARXIV)\s*\||\b(?:doi|isbn|publisher|press|journal|vol\.?|pp?\.)\b|''[^']{3,}'')/i.test(text);
}

function removeReferenceTables(source) {
  const removed = [];
  let text = String(source || "");
  let ranges = referenceSectionRanges(text);
  text = text.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (whole, body, offset) => {
    if (!offsetInRanges(offset, ranges)) return whole;
    const rows = parseReferenceRows(whole);
    const tableRows = [...whole.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const explicitlyKeyedRows = tableRows.filter((row) => /<td\b[^>]*>\s*\[[^\]]+\]\s*<\/td>/i.test(row[1]));
    if (!rows.length || !tableRows.length || explicitlyKeyedRows.length !== tableRows.length || !rows.every((row) => looksBibliographic(row.reference?.note))) return whole;
    removed.push({ type: "html-reference-table", line: lineNumberAt(text, offset), rows: rows.length, characters: whole.length });
    return "\n";
  });
  ranges = referenceSectionRanges(text);
  text = text.replace(/^\{\|[\s\S]*?^\|\}\s*$/gm, (table, offset) => {
    if (!offsetInRanges(offset, ranges) || !/\{\{\s*Ref\s*\|/i.test(table)) return table;
    const rows = parseReferenceRows(table);
    if (!rows.length) return table;
    removed.push({ type: "wiki-reference-table", line: lineNumberAt(text, offset), rows: rows.length, characters: table.length });
    return "\n";
  });
  const lines = text.split("\n");
  const kept = [];
  let referenceLevel = 0;
  let inReferences = false;
  for (const [index, line] of lines.entries()) {
    const heading = line.match(/^\s*(={2,6})\s*(.*?)\s*\1\s*$/);
    if (heading && inReferences && heading[1].length <= referenceLevel) inReferences = false;
    if (heading && /^(?:References|Bibliography|Literature|Further reading)$/i.test(heading[2].trim())) {
      inReferences = true;
      referenceLevel = heading[1].length;
      kept.push(line);
      continue;
    }
    if (inReferences && /\{\{\s*Ref\s*\|/i.test(line) && parseReferenceRows(line).length) {
      removed.push({ type: "wiki-reference-line", line: index + 1, rows: 1, characters: line.length });
      continue;
    }
    const bracketed = inReferences ? line.match(/^\s*\[[^\]\n]+\]\s*(.+)$/) : null;
    if (bracketed && looksBibliographic(bracketed[1])) {
      removed.push({ type: "plain-reference-line", line: index + 1, rows: 1, characters: line.length });
      continue;
    }
    kept.push(line);
  }
  text = kept.join("\n");
  return { text, removed };
}

function genericHtmlTableToMarkdown(table) {
  const rows = [];
  for (const row of String(table || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cell[1].replace(/\|/g, "\\|").trim());
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function genericWikiTableToMarkdown(table) {
  const rows = [];
  const loose = [];
  let current = [];
  let firstRowIsHeader = false;
  const flush = () => {
    if (!current.length) return;
    rows.push(current);
    current = [];
  };
  const cleanCell = (value) => String(value || "")
    .replace(/^\s*(?:(?:style|class|align|valign|width|height|rowspan|colspan)\s*=\s*(?:"[^"]*"|'[^']*'|[^|\s]+)\s*)+\|\s*/i, "")
    .trim();
  for (const rawLine of String(table || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^\{\|/.test(line) || /^\|\}/.test(line)) continue;
    if (/^\|-/.test(line)) { flush(); continue; }
    if (line.startsWith("!")) {
      if (!rows.length && !current.length) firstRowIsHeader = true;
      current.push(...line.slice(1).split(/!!/).map(cleanCell));
      continue;
    }
    if (line.startsWith("|")) {
      current.push(...line.slice(1).split(/\|\|/).map(cleanCell));
      continue;
    }
    if (current.length) current[current.length - 1] = `${current[current.length - 1]} ${line}`.trim();
    else loose.push(rawLine);
  }
  flush();
  if (!rows.length) return loose.join("\n").trim();
  const width = Math.max(...rows.map((row) => row.length));
  if (!width) return "";
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const header = firstRowIsHeader ? normalized.shift() : Array(width).fill("");
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...normalized.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function structureMarkedParagraphs(text, protector) {
  const containerByLabel = {
    definition: "definition",
    theorem: "theorem",
    proposition: "theorem",
    lemma: "theorem",
    corollary: "theorem",
    remark: "note",
    example: "example",
    proof: "proof",
  };
  return String(text || "").split(/(\n{2,})/).map((paragraph) => {
    const match = paragraph.match(/^\s*\*\*((Definition|Theorem|Proposition|Lemma|Corollary|Remark|Example|Proof)\b[^*\n]{0,120})\*\*\s*/i);
    if (!match) return paragraph;
    const type = containerByLabel[match[2].toLocaleLowerCase("en-US")];
    const title = match[1].trim().replace(/[.:：。]+$/, "");
    const body = paragraph.slice(match[0].length).trim();
    if (!body) return paragraph;
    const open = protector.protect("CONTROL", `::: ${type}`);
    const close = protector.protect("CONTROL", ":::");
    return `${open} ${title}\n${body}\n${close}`;
  }).join("");
}

function structureNamedSections(text, protector) {
  const containerByLabel = {
    definition: "definition",
    theorem: "theorem",
    proposition: "theorem",
    lemma: "theorem",
    corollary: "theorem",
    remark: "note",
    remarks: "note",
    example: "example",
    examples: "example",
    proof: "proof",
  };
  const output = [];
  let active = null;
  const closeActive = () => {
    if (!active) return;
    output.push(protector.protect("CONTROL", ":::"));
    active = null;
  };
  for (const line of String(text || "").split("\n")) {
    const heading = line.match(/^\s*(={2,6})\s*(.*?)\s*\1\s*$/);
    if (!heading) { output.push(line); continue; }
    const level = heading[1].length;
    if (active && level <= active.level) closeActive();
    const label = heading[2].trim();
    const typeMatch = label.match(/^(Definition|Theorem|Proposition|Lemma|Corollary|Remarks?|Examples?|Proof)\b/i);
    if (!typeMatch) { output.push(line); continue; }
    const type = containerByLabel[typeMatch[1].toLocaleLowerCase("en-US")];
    output.push(`${protector.protect("CONTROL", `::: ${type}`)} ${label}`);
    active = { level, type };
  }
  closeActive();
  return output.join("\n");
}

function protectNumericLiterals(text, protector) {
  return String(text || "").split(/(@@WIKIST_[A-Z]+_\d{6}@@)/g).map((segment) => {
    if (/^@@WIKIST_[A-Z]+_\d{6}@@$/.test(segment)) return segment;
    return segment.replace(/(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?(?![\p{L}\p{N}_])/gu, (value) => protector.protect("NUMBER", value));
  }).join("");
}

function flattenNestedProtectedTokens(markdown, protector, issues) {
  const text = String(markdown || "");
  const parentReferences = (child) => protector.tokens.flatMap((parent) => {
    if (parent === child) return [];
    const occurrences = countOccurrences(String(parent.value || ""), child.token);
    return occurrences ? [{ parent, occurrences }] : [];
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const child of [...protector.tokens]) {
      if (countOccurrences(text, child.token) !== 0) continue;
      const references = parentReferences(child);
      if (references.length !== 1 || references[0].occurrences !== 1) continue;
      const parent = references[0].parent;
      parent.value = String(parent.value).replace(child.token, () => child.value);
      protector.tokens.splice(protector.tokens.indexOf(child), 1);
      changed = true;
      break;
    }
  }

  for (const child of protector.tokens) {
    if (countOccurrences(text, child.token) !== 0) continue;
    const references = parentReferences(child);
    if (!references.length) {
      issues.push({ code: "orphan-protected-token", token: child.token, type: child.type });
    } else if (references.length === 1) {
      issues.push({
        code: "repeated-nested-protected-token",
        token: child.token,
        type: child.type,
        parent: references[0].parent.token,
        occurrences: references[0].occurrences,
      });
    } else {
      issues.push({
        code: "multiple-parent-protected-token",
        token: child.token,
        type: child.type,
        parents: references.map(({ parent, occurrences }) => ({ token: parent.token, occurrences })),
      });
    }
  }
}

function replaceBalancedWikiLinks(value, replacer) {
  const text = String(value || "");
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("[[", cursor);
    if (start < 0) { output += text.slice(cursor); break; }
    output += text.slice(cursor, start);
    let depth = 1;
    let end = start + 2;
    while (end < text.length && depth > 0) {
      if (text.startsWith("[[", end)) { depth += 1; end += 2; continue; }
      if (text.startsWith("]]", end)) { depth -= 1; end += 2; continue; }
      end += 1;
    }
    if (depth !== 0) { output += text.slice(start); break; }
    const whole = text.slice(start, end);
    output += replacer(whole, whole.slice(2, -2));
    cursor = end;
  }
  return output;
}

function plainWikiLabel(value) {
  return replaceBalancedWikiLinks(value, (_whole, raw) => {
    const pipe = raw.indexOf("|");
    return (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim();
  }).replace(/\|/g, " ").replace(/\s+/g, " ").trim();
}

function splitWikiPipes(value) {
  const text = String(value || "");
  const output = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("[[", index)) { depth += 1; current += "[["; index += 1; continue; }
    if (text.startsWith("]]", index) && depth > 0) { depth -= 1; current += "]]"; index += 1; continue; }
    if (text[index] === "|" && depth === 0) { output.push(current); current = ""; continue; }
    current += text[index];
  }
  output.push(current);
  return output;
}

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["ndash", "–"],
    ["mdash", "—"],
    ["minus", "−"],
    ["times", "×"],
    ["middot", "·"],
  ]);
  return String(value || "").replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (whole, entity) => {
    if (entity[0] !== "#") return named.get(entity.toLocaleLowerCase("en-US")) ?? whole;
    const hexadecimal = entity[1]?.toLocaleLowerCase("en-US") === "x";
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return whole;
    return String.fromCodePoint(codePoint);
  });
}

function htmlAttribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function absoluteEomAssetUrl(value) {
  const source = decodeHtmlEntities(String(value || "").trim());
  if (!source) return "";
  if (/^https?:\/\//i.test(source)) return source;
  if (/^\/\//.test(source)) return `https:${source}`;
  if (source.startsWith("/")) return `https://encyclopediaofmath.org${source}`;
  return `https://encyclopediaofmath.org/${source.replace(/^\.\//, "")}`;
}

function protectSingleDollarMath(text, protector) {
  return String(text || "").replace(/(^|[^\\$])\$(?!\$)([\s\S]*?)(?<!\\)\$(?!\$)/g, (_whole, prefix, body) => (
    `${prefix}${protector.protect("MATH", `$${body}$`)}`
  ));
}

function isInsideSingleDollarMath(text, offset) {
  let open = false;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] !== "$" || text[index - 1] === "\\" || text[index - 1] === "$" || text[index + 1] === "$") continue;
    open = !open;
  }
  return open;
}

function protectLatexEnvironments(text, protector) {
  return String(text || "").replace(/\\begin\{((?:equation|align|alignat|aligned|gather|multline|eqnarray|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|split)\*?)\}([\s\S]*?)\\end\{\1\}/g, (whole, _environment, _body, offset, sourceText) => {
    // Matrix environments frequently occur inside $...$. In that case the outer
    // inline expression must be protected instead of creating nested tokens.
    if (isInsideSingleDollarMath(sourceText, offset)) return whole;
    return protector.protect("MATH", `\n$$\n${whole.trim()}\n$$\n`);
  });
}

function plainImageAlt(value, protector, fallback) {
  const tokenByName = new Map((protector.tokens || []).map((item) => [item.token, item]));
  const expanded = String(value || "").replace(/@@WIKIST_[A-Z]+_\d{6}@@/g, (token) => {
    const item = tokenByName.get(token);
    if (!item) return "";
    if (item.type === "NUMBER" || item.type === "IDENT") return item.value;
    if (item.type === "MATH") return "数学公式";
    return "";
  });
  return plainWikiLabel(expanded || fallback).replace(/\s+/g, " ").trim() || plainWikiLabel(fallback) || "EoM 图像";
}

function mediaWikiToProtectedMarkdown(input) {
  const { source, titleEntry, links, references, transclusionTargets = new Map() } = input;
  const issues = [];
  const protector = createProtector();
  let text = String(source || "").replace(/\r\n/g, "\n");
  const stripped = removeReferenceTables(text);
  text = stripped.text;
  for (const item of stripped.removed) issues.push({ code: "reference-material-extracted", ...item });

  // Resolve reference tags before protecting formulas or links. Reference notes
  // may contain arbitrary wiki/TeX syntax; protecting that content first creates
  // orphan tokens when the note is replaced by its citation marker.
  text = text.replace(/<ref\b([^>]*?)\/\s*>/gi, (_whole, attributes) => {
    const name = String(attributes || "").match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    const key = name ? (name[1] || name[2] || name[3]) : "";
    const id = referenceId(key, "");
    return id ? `[@${protector.protect("CITE", id, { originalKey: key })}]` : "";
  });
  text = text.replace(/<ref\b(?![^>]*\/\s*>)([^>]*?)>([\s\S]*?)<\/ref\s*>/gi, (_whole, attributes, content) => {
    const name = String(attributes || "").match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    const key = name ? (name[1] || name[2] || name[3]) : "";
    const originalKey = key || inlineReferenceId(content);
    const id = referenceId(originalKey, inlineReferenceId(content));
    return `[@${protector.protect("CITE", id, { originalKey })}]`;
  });
  text = text.replace(/<!--([\s\S]*?)-->/g, (_whole, comment) => {
    if (String(comment || "").trim()) issues.push({ code: "html-comment-removed", value: String(comment).trim().slice(0, 160) });
    return "";
  });

  text = text.replace(/<asy\b[^>]*>([\s\S]*?)<\/asy>/gi, (_whole, body) => {
    issues.push({ code: "asymptote-source-needs-rendering" });
    return protector.protect("CODE", `\n\`\`\`asy\n${String(body).trim()}\n\`\`\`\n`);
  });
  text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_whole, body) => protector.protect("CODE", `\n\`\`\`text\n${String(body).trim()}\n\`\`\`\n`));
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_whole, body) => protector.protect("CODE", `\`${decodeHtmlEntities(String(body).trim()).replace(/`/g, "\\`")}\``));
  text = text.replace(/<nowiki\b[^>]*>([\s\S]*?)<\/nowiki>/gi, (_whole, body) => protector.protect("CODE", `\`${String(body).trim().replace(/`/g, "\\`")}\``));
  text = text.replace(/<math\b([^>]*)>([\s\S]*?)<\/math>/gi, (_whole, attributes, body) => {
    const display = /display\s*=\s*["']?block/i.test(attributes) || /\\begin\{(?:equation|align|gather|multline)/.test(body);
    return protector.protect("MATH", display ? `\n$$\n${String(body).trim()}\n$$\n` : `$${String(body).trim()}$`);
  });
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_whole, body) => protector.protect("MATH", `\n$$\n${body.trim()}\n$$\n`));
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_whole, body) => protector.protect("MATH", `$${body.trim()}$`));
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_whole, body) => protector.protect("MATH", `\n$$\n${body.trim()}\n$$\n`));
  text = protectLatexEnvironments(text, protector);
  text = protectSingleDollarMath(text, protector);

  text = text.replace(/\{\{\s*Cite\s*\|([^{}]+)\}\}/gi, (_whole, body) => {
    const ids = body.split("|").map((item) => item.trim()).filter(Boolean).map((key) => {
      const id = referenceId(key, "");
      if (!id) {
        issues.push({ code: "invalid-citation-key", value: key });
        return key;
      }
      return protector.protect("CITE", id, { originalKey: key });
    });
    return ids.length ? `[${ids.map((id) => `@${id}`).join("; ")}]` : "";
  });
  text = text.replace(/\{\{\s*(?:TEX|Category|MSCwiki?|MSC|Stub|EOFM|OldImage)\b[^{}]*\}\}/gi, "");
  text = text.replace(/\{\{\s*Anchor\s*\|\s*([^{}|]+)[^{}]*\}\}/gi, (_whole, anchor) => {
    issues.push({ code: "source-anchor-removed", anchor: String(anchor || "").trim() });
    return "";
  });
  text = text.replace(/\{\{\s*(?:DEF|Disambiguation)\s*\}\}/gi, "");
  text = text.replace(/\{\{\s*OEIS\s*\|\s*([A-Z]\d{6,})\s*\}\}/gi, (_whole, sequence) => {
    const id = String(sequence || "").trim().toUpperCase();
    const url = protector.protect("URL", `https://oeis.org/${id}`, { scheme: "OEIS", identifier: id });
    return `[OEIS ${id}](${url})`;
  });
  text = text.replace(/\{\{\s*(ISBN|MR|ZBL|DOI|ARXIV)\s*\|\s*([^{}|]+)[^{}]*\}\}/gi, (_whole, scheme, rawValue) => {
    const value = String(rawValue || "").trim();
    if (/^DOI$/i.test(scheme)) {
      const token = protector.protect("URL", `https://doi.org/${value}`);
      return `[DOI: ${value}](${token})`;
    }
    return `${scheme.toUpperCase()}: ${protector.protect("IDENT", value)}`;
  });
  text = text.replace(/\{\{\s*!\s*\}\}/g, "|");

  text = text.replace(/<gallery\b[^>]*>([\s\S]*?)<\/gallery>/gi, (_whole, body) => {
    const items = String(body || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => (
      /^(?:File|Image):/i.test(line) ? `[[${line}]]` : `\`${line.replace(/`/g, "\\`")}\``
    ));
    issues.push({ code: "gallery-converted", items: items.length });
    return items.join("\n\n");
  });

  const relationQueues = new Map();
  for (const relation of links || []) {
    const key = String(relation.sourceTarget || "").replace(/_/g, " ").trim().toLocaleLowerCase("en-US");
    const queue = relationQueues.get(key) || [];
    queue.push(relation);
    relationQueues.set(key, queue);
  }
  text = replaceBalancedWikiLinks(text, (whole, raw) => {
    const linkParts = splitWikiPipes(raw);
    const destination = String(linkParts.shift() || "").trim();
    const sourceLabel = linkParts.join("|").trim();
    const hash = destination.indexOf("#");
    const target = (hash >= 0 ? destination.slice(0, hash) : destination).trim();
    const anchor = hash >= 0 ? destination.slice(hash + 1).trim() : "";
    const relationKey = target.replace(/_/g, " ").toLocaleLowerCase("en-US");
    const mappedTarget = transclusionTargets.get(relationKey);
    const relation = relationQueues.get(relationKey)?.shift() || (mappedTarget ? {
      status: "resolved",
      targetSourceTitle: mappedTarget.sourceTitle,
      targetZhTitle: mappedTarget.zhTitle,
      targetSlug: mappedTarget.targetSlug,
    } : null);
    if (!target && /^references?$/i.test(anchor)) {
      const originalKey = plainWikiLabel(sourceLabel || "").replace(/^\[|\]$/g, "").trim();
      const id = referenceId(originalKey, "");
      if (id) return `[@${protector.protect("CITE", id, { originalKey, sourceAnchor: anchor })}]`;
      issues.push({ code: "invalid-reference-anchor", anchor, label: sourceLabel });
      return plainWikiLabel(sourceLabel || destination);
    }
    if (/^Category:/i.test(target)) return "";
    if (/^(?:File|Image):/i.test(target)) {
      const fileName = target.replace(/^(?:File|Image):/i, "").trim();
      const pieces = linkParts.map((item) => item.trim()).filter(Boolean);
      const align = pieces.find((item) => /^(?:left|right|center)$/i.test(item))?.toLocaleLowerCase("en-US") || "center";
      const width = pieces.find((item) => /^\d{2,4}px$/i.test(item)) || "640px";
      const explicitAlt = pieces.find((item) => /^alt=/i.test(item))?.replace(/^alt=/i, "") || "";
      const captions = pieces.filter((item) => !/^(?:left|right|center|thumb|thumbnail|frame|frameless|border|\d{2,4}px|alt=|link=)/i.test(item));
      const captionSource = captions[captions.length - 1] || fileName;
      const related = [];
      const caption = decodeHtmlEntities(replaceBalancedWikiLinks(captionSource, (_nestedWhole, nestedRaw) => {
        const nestedParts = splitWikiPipes(nestedRaw);
        const nestedDestination = String(nestedParts.shift() || "").trim();
        const nestedTarget = nestedDestination.split("#", 1)[0].trim();
        const nestedLabel = plainWikiLabel(nestedParts.join("|")) || nestedTarget.replace(/^(?:Media|File|Image):/i, "");
        if (/^Media:/i.test(nestedTarget)) {
          const mediaUrl = protector.protect("URL", `https://encyclopediaofmath.org/wiki/Special:Redirect/file/${encodeURIComponent(decodeHtmlEntities(nestedTarget.replace(/^Media:/i, "").trim()).replace(/ /g, "_"))}`);
          related.push(`[${nestedLabel}](${mediaUrl})`);
          return nestedLabel;
        }
        if (/^(?:File|Image|Category):/i.test(nestedTarget)) return nestedLabel;
        const nestedKey = nestedTarget.replace(/_/g, " ").toLocaleLowerCase("en-US");
        const nestedMapped = transclusionTargets.get(nestedKey);
        const nestedRelation = relationQueues.get(nestedKey)?.shift() || (nestedMapped ? {
          status: "resolved",
          targetSlug: nestedMapped.targetSlug,
        } : null);
        if (nestedRelation?.status === "resolved" && nestedRelation.targetSlug) {
          const nestedSlug = protector.protect("TARGET", nestedRelation.targetSlug, { sourceTarget: nestedTarget });
          related.push(`[[${nestedSlug}|${nestedLabel}]]`);
        } else {
          const nestedUrl = protector.protect("URL", `https://encyclopediaofmath.org/wiki/${encodeURIComponent(nestedTarget.replace(/ /g, "_"))}`);
          related.push(`[${nestedLabel}](${nestedUrl})`);
          issues.push({ code: "missing-caption-link", target: nestedTarget });
        }
        return nestedLabel;
      }));
      const alt = plainImageAlt(explicitAlt || caption, protector, fileName);
      const remote = `https://encyclopediaofmath.org/wiki/Special:Redirect/file/${encodeURIComponent(decodeHtmlEntities(fileName).replace(/ /g, "_"))}`;
      const url = protector.protect("URL", remote, { sourceFile: fileName });
      issues.push({ code: "external-eom-image", sourceFile: fileName });
      const image = `[[File:${url}|${align}|thumb|${width}|alt=${alt}|caption=${caption || alt}]]`;
      return related.length ? `${image}\n\n图注关联：${[...new Set(related)].join("、")}` : image;
    }
    if (/^Media:/i.test(target)) {
      const url = protector.protect("URL", `https://encyclopediaofmath.org/wiki/Special:Redirect/file/${encodeURIComponent(decodeHtmlEntities(target.replace(/^Media:/i, "").trim()).replace(/ /g, "_"))}`);
      return `[${plainWikiLabel(sourceLabel || target)}](${url})`;
    }
    if (/^https?:\/\//i.test(target)) {
      const url = protector.protect("URL", decodeHtmlEntities(target));
      return `[${plainWikiLabel(sourceLabel || target)}](${url})`;
    }
    if (/^[A-Za-z-]+:/i.test(target)) {
      issues.push({ code: "unsupported-link-namespace", target });
      return plainWikiLabel(sourceLabel || target);
    }
    const label = plainWikiLabel(sourceLabel) || relation?.targetZhTitle || relation?.targetSourceTitle || target;
    if (relation?.status === "resolved" && relation.targetSlug) {
      if (anchor) issues.push({ code: "section-anchor-needs-rebinding", target, anchor });
      const slug = protector.protect("TARGET", relation.targetSlug, { sourceTarget: target, sourceAnchor: anchor });
      return `[[${slug}|${label}]]`;
    }
    const url = protector.protect("URL", `https://encyclopediaofmath.org/wiki/${encodeURIComponent(target.replace(/ /g, "_"))}`);
    issues.push({ code: relation?.status === "ambiguous" ? "ambiguous-internal-link" : "missing-internal-link", target, line: relation?.line || 0 });
    return `[${label}](${url})`;
  });

  text = text.replace(/<img\b([^>]*)\/?>/gi, (_whole, attributes) => {
    const sourceUrl = absoluteEomAssetUrl(htmlAttribute(attributes, "src"));
    const alt = decodeHtmlEntities(htmlAttribute(attributes, "alt") || htmlAttribute(attributes, "title") || "EoM 图像").replace(/\|/g, "\\|").trim();
    const widthValue = htmlAttribute(attributes, "width").match(/^\d{1,4}/)?.[0] || "";
    if (!sourceUrl) {
      issues.push({ code: "unresolved-html-image", source: _whole.slice(0, 240) });
      return protector.protect("CODE", `\`${_whole.replace(/`/g, "\\`")}\``);
    }
    const url = protector.protect("URL", sourceUrl, { sourceFile: sourceUrl });
    issues.push({ code: "external-eom-image", sourceFile: sourceUrl, htmlImage: true });
    return `[[File:${url}|center|thumb|${widthValue ? `${widthValue}px` : "640px"}|alt=${alt}|caption=${alt}]]`;
  });

  text = text.replace(/\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/gi, (_whole, url, label) => `[${label || url}](${protector.protect("URL", decodeHtmlEntities(url))})`);
  text = text.replace(/https?:\/\/[^\s<>)\]]+/gi, (url) => protector.protect("URL", decodeHtmlEntities(url)));

  text = text.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const converted = genericHtmlTableToMarkdown(table);
    if (converted) return converted;
    issues.push({ code: "unparsed-html-table", source: table.slice(0, 300) });
    return protector.protect("CODE", `\n\`\`\`html\n${table.trim()}\n\`\`\`\n`);
  });
  text = text.replace(/^\{\|[\s\S]*?^\|\}\s*$/gm, (table) => {
    if (/\b(?:rowspan|colspan)\s*=/i.test(table)) issues.push({ code: "complex-wiki-table", source: table.slice(0, 300) });
    const converted = genericWikiTableToMarkdown(table);
    if (converted) return converted;
    issues.push({ code: "unparsed-wiki-table", source: table.slice(0, 300) });
    return protector.protect("CODE", `\n\`\`\`text\n${table.trim()}\n\`\`\`\n`);
  });
  text = structureNamedSections(text, protector);
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|span|center|small|big|font|blockquote)\b[^>]*>/gi, "")
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, "^$1^")
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, "~$1~")
    .replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
    .replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*")
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?(?:ul|ol|dl|dt|dd)\b[^>]*>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<[^>]+>/g, (tag) => {
      issues.push({ code: "unsupported-html", value: tag.slice(0, 160) });
      return protector.protect("CODE", `\`${tag.replace(/`/g, "\\`")}\``);
    });

  text = text.replace(/^([*]+)[ \t]+(.+)$/gm, (_whole, marks, body) => `${"  ".repeat(Math.max(0, marks.length - 1))}- ${body}`);
  text = text.replace(/^([#]+)[ \t]+(.+)$/gm, (_whole, marks, body) => `${"  ".repeat(Math.max(0, marks.length - 1))}1. ${body}`);
  text = text.replace(/^\s*(={2,6})\s*(.*?)\s*\1\s*$/gm, (_whole, marks, heading) => `${"#".repeat(Math.min(6, marks.length))} ${heading.trim()}`);
  text = text.replace(/'''([\s\S]*?)'''/g, "**$1**").replace(/''([\s\S]*?)''/g, "*$1*");
  text = text.replace(/^;\s*([^:\n]+)\s*:\s*(.+)$/gm, "**$1**：$2");
  text = text.replace(/^:\s*/gm, "");
  text = structureMarkedParagraphs(text, protector);

  text = text.replace(/\{\{\s*:([^{}|]+)(?:\|[^{}]*)?\}\}/g, (whole, rawTarget) => {
    const key = String(rawTarget || "").replace(/_/g, " ").trim().toLocaleLowerCase("en-US");
    const target = transclusionTargets.get(key);
    if (!target?.targetSlug) {
      issues.push({ code: "unresolved-transclusion", target: String(rawTarget || "").trim() });
      return `\`${whole.replace(/`/g, "\\`")}\``;
    }
    issues.push({ code: "transclusion-needs-expansion", target: target.sourceTitle, source: whole });
    const slug = protector.protect("TARGET", target.targetSlug, { sourceTarget: target.sourceTitle });
    return `[[${slug}|转包含：${target.zhTitle || target.sourceTitle}]]`;
  });

  text = text.replace(/\{\{([^{}]+)\}\}/g, (whole, inner) => {
    issues.push({ code: "unsupported-template", name: String(inner).split("|")[0].trim(), source: whole.slice(0, 300) });
    return `\`${whole.replace(/`/g, "\\`")}\``;
  });
  text = String(text).split(/(@@WIKIST_[A-Z]+_\d{6}@@)/g).map((segment) => (
    /^@@WIKIST_[A-Z]+_\d{6}@@$/.test(segment) ? segment : decodeHtmlEntities(segment)
  )).join("");
  text = text
    .replace(/__TOC__|__NOTOC__|__NOINDEX__|__INDEX__/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = protectNumericLiterals(text, protector);
  flattenNestedProtectedTokens(text, protector, issues);

  return {
    markdown: `# ${titleEntry.zhTitle}\n\n${text}`.trim(),
    protectedTokens: protector.tokens,
    issues,
    sourceReferenceCount: references.length,
  };
}

function addTitleTargets(linkRows, titleById) {
  return linkRows.map((page) => ({
    ...page,
    links: (page.links || []).map((link) => ({ ...link, targetZhTitle: link.targetSourceId ? titleById.get(Number(link.targetSourceId))?.zhTitle || "" : "" })),
  }));
}

function structureLedger(source, converted, strippedReferences = []) {
  const text = String(source || "");
  const tokens = converted.protectedTokens || [];
  return {
    sourceCharacters: text.length,
    protectedMarkdownCharacters: String(converted.markdown || "").length,
    sourceWikiLinks: (text.match(/\[\[/g) || []).length,
    sourceRefTags: (text.match(/<ref\b/gi) || []).length,
    sourceHtmlImages: (text.match(/<img\b/gi) || []).length,
    sourceGalleries: (text.match(/<gallery\b/gi) || []).length,
    sourceHtmlTables: (text.match(/<table\b/gi) || []).length,
    sourceWikiTables: (text.match(/^\{\|/gm) || []).length,
    protectedMath: tokens.filter((item) => item.type === "MATH").length,
    protectedTargets: tokens.filter((item) => item.type === "TARGET").length,
    protectedCitations: tokens.filter((item) => item.type === "CITE").length,
    protectedUrls: tokens.filter((item) => item.type === "URL").length,
    protectedCode: tokens.filter((item) => item.type === "CODE").length,
    extractedReferenceBlocks: strippedReferences.length,
    extractedReferenceCharacters: strippedReferences.reduce((sum, item) => sum + (Number(item.characters) || 0), 0),
  };
}

function prepare(options) {
  const titleMapPath = path.join(options.root, "mappings", "global-title-map.jsonl");
  const titleMap = readJsonl(titleMapPath);
  if (!titleMap.length || titleMap.some((item) => !String(item.zhTitle || "").trim())) {
    throw new Error("global-title-map.jsonl is incomplete; consolidate all title partitions first.");
  }
  const titleById = new Map(titleMap.map((item) => [Number(item.sourceId), item]));
  const titleBySourceKey = new Map(titleMap.map((item) => [String(item.sourceTitle || "").replace(/_/g, " ").trim().toLocaleLowerCase("en-US"), item]));
  const links = addTitleTargets(readJsonl(path.join(options.root, "mappings", "global-link-map.jsonl")), titleById);
  const linksById = new Map(links.map((item) => [Number(item.sourceId), item]));
  const referencesById = new Map(readJsonl(path.join(options.root, "mappings", "global-reference-map.jsonl")).map((item) => [Number(item.sourceId), item]));
  const manifest = readJsonl(path.join(options.root, "manifests", "conversion-manifest.jsonl"));
  const archive = readJson(path.join(options.source, "archive.json"));
  const manifestById = new Map(manifest.map((item) => [Number(item.sourceId), item]));
  const partitions = Array.from({ length: options.parts }, () => []);
  let prepared = 0;
  let redirects = 0;
  const preparationFailures = [];

  for (const titleEntry of titleMap) {
    const id = Number(titleEntry.sourceId);
    const state = manifestById.get(id);
    if (titleEntry.entryType === "redirect") {
      redirects += 1;
      state.status = "pending_redirect";
      state.translationStatus = "not-required";
      state.conversionStatus = "pending";
      state.updatedAt = new Date().toISOString();
      continue;
    }
    const source = fs.readFileSync(path.join(options.source, titleEntry.sourcePath), "utf8");
    const referenceData = referencesById.get(id) || { references: [], uses: [] };
    const converted = mediaWikiToProtectedMarkdown({ source, titleEntry, links: linksById.get(id)?.links || [], references: referenceData.references || [], transclusionTargets: titleBySourceKey });
    const preflight = restoreTokens(converted.markdown, converted.protectedTokens);
    if (preflight.errors.length) {
      const failure = { sourceId: id, sourceTitle: titleEntry.sourceTitle, code: "protected-token-preflight", errors: preflight.errors };
      preparationFailures.push(failure);
      state.status = "conversion_failed";
      state.translationStatus = "blocked";
      state.conversionStatus = "failed";
      state.validationStatus = "failed";
      state.needsReview = true;
      state.issues = [failure];
      state.updatedAt = new Date().toISOString();
      continue;
    }
    const extractedReferences = converted.issues.filter((issue) => issue.code === "reference-material-extracted");
    const unit = {
      format: "wikist-eom-translation-unit",
      formatVersion: 1,
      sourceId: id,
      sourceTitle: titleEntry.sourceTitle,
      zhTitle: titleEntry.zhTitle,
      targetSlug: titleEntry.targetSlug,
      entryType: titleEntry.entryType,
      sourceSha256: state.sourceSha256,
      sourceRevisionId: state.sourceRevisionId,
      sourceRevisionTimestamp: state.sourceRevisionTimestamp,
      sourceArchivedAt: archive.generatedAt || "",
      categories: titleEntry.categories || [],
      classifications: titleEntry.classifications || [],
      markdown: converted.markdown,
      protectedTokens: converted.protectedTokens,
      references: referenceData.references || [],
      conversionIssues: converted.issues,
      integrityLedger: structureLedger(source, converted, extractedReferences),
      sourceText: source,
      translationInstructions: "仅翻译 markdown 中的人类可读英文。不得改动任何 @@WIKIST_*@@ token、Markdown/Wikist 控制结构、公式、引用键、URL、数字或专名。不得扩写。",
    };
    const part = (Number(state.sequence) || 0) % options.parts;
    const relative = path.join("work", "body-input", `part-${String(part + 1).padStart(2, "0")}`, `${String(id).padStart(8, "0")}.json`);
    const target = path.join(options.root, relative);
    if (options.force || !fs.existsSync(target)) writeJson(target, unit);
    partitions[part].push({ sourceId: id, sourceTitle: titleEntry.sourceTitle, zhTitle: titleEntry.zhTitle, inputPath: relative.split(path.sep).join("/"), outputPath: relative.replace("body-input", "body-output").split(path.sep).join("/") });
    state.status = "prepared";
    state.translationStatus = "pending";
    state.conversionStatus = "prepared";
    state.inputPath = relative.split(path.sep).join("/");
    state.updatedAt = new Date().toISOString();
    prepared += 1;
  }
  partitions.forEach((rows, index) => writeJsonl(path.join(options.root, "work", "body-input", `part-${String(index + 1).padStart(2, "0")}.jsonl`), rows));
  writeJsonl(path.join(options.root, "reports", "preparation-failures.jsonl"), preparationFailures);
  writeJsonl(path.join(options.root, "manifests", "conversion-manifest.jsonl"), manifest);
  process.stdout.write(`${JSON.stringify({ prepared, redirects, failed: preparationFailures.length, parts: options.parts, root: options.root }, null, 2)}\n`);
}

function countOccurrences(text, value) {
  if (!value) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(value, index)) >= 0) { count += 1; index += value.length; }
  return count;
}

function restoreTokens(markdown, tokens) {
  let output = String(markdown || "");
  const errors = [];
  for (const item of tokens || []) {
    const count = countOccurrences(output, item.token);
    if (count !== 1) errors.push({ code: "protected-token-count", token: item.token, expected: 1, actual: count, type: item.type });
    // Formula text may contain JavaScript replacement markers such as $&, so return it literally.
    if (count === 1) output = output.replace(item.token, () => item.value);
  }
  const remaining = output.match(/@@WIKIST_[A-Z]+_\d{6}@@/g) || [];
  if (remaining.length) errors.push({ code: "unresolved-protected-tokens", tokens: remaining.slice(0, 20) });
  return { output, errors };
}

function formulaBalanceIssues(body) {
  const issues = [];
  const source = String(body || "");
  const dollars = (source.match(/(?<!\\)\$\$/g) || []).length;
  if (dollars % 2) issues.push({ code: "unbalanced-display-math", count: dollars });
  const withoutDisplay = source.replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$/g, "");
  const singleDollars = (withoutDisplay.match(/(?<!\\)\$(?!\$)/g) || []).length;
  if (singleDollars % 2) issues.push({ code: "unbalanced-inline-math", count: singleDollars });
  const environments = new Map();
  for (const match of source.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    const key = match[2];
    const counts = environments.get(key) || { begin: 0, end: 0 };
    counts[match[1]] += 1;
    environments.set(key, counts);
  }
  for (const [environment, counts] of environments) if (counts.begin !== counts.end) issues.push({ code: "unbalanced-latex-environment", environment, ...counts });
  return issues;
}

function summaryFromBody(body) {
  return String(body || "").split(/\n{2,}/).map((block) => block
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[@[^\]]+\]/g, "")
    .replace(/[*_`>#|]/g, "")
    .replace(/\$[^$]+\$/g, "")
    .replace(/\s+/g, " ")
    .trim()).find((item) => item.length >= 20)?.slice(0, 220) || "";
}

function safeFileStem(id, title) {
  const clean = String(title || "entry").normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "entry";
  return `${String(id).padStart(8, "0")}--${clean}`;
}

function finalize(options) {
  const titleMap = readJsonl(path.join(options.root, "mappings", "global-title-map.jsonl"));
  const titleById = new Map(titleMap.map((item) => [Number(item.sourceId), item]));
  const redirectMap = readJsonl(path.join(options.root, "mappings", "global-redirect-map.jsonl"));
  const redirectById = new Map(redirectMap.map((item) => [Number(item.sourceId), item]));
  const manifest = readJsonl(path.join(options.root, "manifests", "conversion-manifest.jsonl"));
  const archive = readJson(path.join(options.source, "archive.json"));
  const failures = [];
  const review = [];
  let converted = 0;
  let redirected = 0;
  let missing = 0;

  for (const state of manifest) {
    const id = Number(state.sourceId);
    const title = titleById.get(id);
    const packagePath = path.join(options.root, "packages", `${String(id).padStart(8, "0")}.json`);
    if (state.entryType === "redirect") {
      const redirect = redirectById.get(id);
      if (!redirect?.targetSlug || redirect.status !== "resolved") {
        state.status = "needs_review";
        state.validationStatus = "failed";
        state.needsReview = true;
        state.issues = [{ code: "invalid-redirect-target", target: redirect?.sourceTarget || "" }];
        review.push({ sourceId: id, sourceTitle: state.sourceTitle, issues: state.issues });
        continue;
      }
      const page = {
        slug: title.targetSlug,
        title: title.zhTitle,
        summary: `重定向至${titleById.get(Number(redirect.targetSourceId))?.zhTitle || redirect.targetSourceTitle}。`,
        categories: ["EoM 重定向"],
        difficulty: "未分级",
        status: "review",
        quality: "Draft",
        author: "EoM contributors / Wikist 中文转换",
        importSource: "encyclopedia-of-mathematics",
        importTitle: title.sourceTitle,
        importLang: "en",
        importRevision: state.sourceRevisionId,
        importUrl: `https://encyclopediaofmath.org/wiki/${encodeURIComponent(title.sourceTitle.replace(/ /g, "_"))}`,
        importFetchedAt: archive.generatedAt || "",
        importLicense: "mixed-or-unspecified; retain EoM page and revision notices",
        canonicalNames: [title.zhTitle, title.sourceTitle, ...(title.zhAliases || [])],
        redirectTarget: redirect.targetSlug,
        references: [],
        body: "",
      };
      writeJson(packagePath, { format: "wikist-page", version: 1, source: { site: "Encyclopedia of Mathematics", pageid: id, title: title.sourceTitle, revisionId: state.sourceRevisionId, sha256: state.sourceSha256 }, page });
      state.status = "validated";
      state.translationStatus = "not-required";
      state.conversionStatus = "converted";
      state.validationStatus = "validated";
      state.outputPath = path.relative(options.root, packagePath).split(path.sep).join("/");
      state.outputSha256 = sha256(fs.readFileSync(packagePath));
      state.updatedAt = new Date().toISOString();
      redirected += 1;
      continue;
    }

    const inputPath = state.inputPath ? path.join(options.root, state.inputPath) : "";
    const outputPath = state.inputPath ? path.join(options.root, state.inputPath.replace("body-input", "body-output")) : "";
    if (!inputPath || !fs.existsSync(inputPath) || !fs.existsSync(outputPath)) {
      missing += 1;
      state.status = "pending_translation";
      state.translationStatus = "pending";
      continue;
    }
    try {
      const unit = readJson(inputPath);
      const translated = readJson(outputPath);
      if (Number(translated.sourceId) !== id) throw new Error("translated sourceId does not match the unit");
      const restored = restoreTokens(translated.translatedMarkdown, unit.protectedTokens);
      const validationIssues = [
        ...restored.errors,
        ...formulaBalanceIssues(restored.output),
      ];
      const conversionReviewCodes = new Set([
        "asymptote-source-needs-rendering",
        "complex-wiki-table",
        "invalid-reference-anchor",
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
      for (const issue of unit.conversionIssues || []) {
        if (conversionReviewCodes.has(issue.code)) validationIssues.push({ code: "conversion-review-required", sourceIssue: issue });
      }
      restored.output = restored.output.replace(/^#\s+[^\n]+/, `# ${title.zhTitle}`);
      const sourceCitationIds = new Set((unit.references || []).map((item) => item.id));
      const usedCitationIds = [...restored.output.matchAll(/@([a-z0-9][a-z0-9._:-]*)/gi)].map((match) => match[1].toLocaleLowerCase("en-US"));
      for (const citationId of usedCitationIds) if (!sourceCitationIds.has(citationId)) validationIssues.push({ code: "unknown-citation-id", id: citationId });
      const sourceLinkCount = (unit.protectedTokens || []).filter((item) => item.type === "TARGET").length;
      const outputLinkCount = [...restored.output.matchAll(/\[\[([^\]]+)\]\]/g)].filter((match) => !/^(?:File|Image):/i.test(match[1])).length;
      if (sourceLinkCount !== outputLinkCount) validationIssues.push({ code: "internal-link-count", expected: sourceLinkCount, actual: outputLinkCount });
      const sourceUrl = `https://encyclopediaofmath.org/wiki/${encodeURIComponent(title.sourceTitle.replace(/ /g, "_"))}`;
      const sourceReferenceId = `eom-source-${id}`;
      const sourceLicense = /Creative Commons Attribution(?:-| )Share(?:-| )Alike/i.test(unit.sourceText || "")
        ? "CC BY-SA (as stated on the EoM source page); attribution and share-alike required"
        : "EoM source terms vary; verify the original article rights before public redistribution";
      const body = `${restored.output.trim()}\n\n::: note 来源与翻译\n本词条译自 Encyclopedia of Mathematics 的“${title.sourceTitle}”词条；原修订号为 ${state.sourceRevisionId || "未记录"}。中文译文处于社区审阅状态。[@${sourceReferenceId}]\n:::`;
      const sourceReferences = (unit.references || []).map((item) => item.reference || item);
      const citedReferenceIds = new Set(usedCitationIds);
      const prioritizedReferences = [
        ...sourceReferences.filter((item) => citedReferenceIds.has(String(item.id || "").toLocaleLowerCase("en-US"))),
        ...sourceReferences.filter((item) => !citedReferenceIds.has(String(item.id || "").toLocaleLowerCase("en-US"))),
      ];
      const uniqueReferences = [...new Map(prioritizedReferences.map((item) => [String(item.id || "").toLocaleLowerCase("en-US"), item])).values()];
      if (uniqueReferences.length > 119) {
        validationIssues.push({
          code: "wikist-reference-limit",
          sourceCount: uniqueReferences.length,
          retainedCount: 119,
          omittedIds: uniqueReferences.slice(119).map((item) => item.id),
        });
      }
      const references = [...uniqueReferences.slice(0, 119), {
        id: sourceReferenceId,
        type: "web",
        authors: ["Encyclopedia of Mathematics contributors"],
        title: title.sourceTitle,
        containerTitle: "Encyclopedia of Mathematics",
        year: String(state.sourceRevisionTimestamp || "").match(/^\d{4}/)?.[0] || "",
        url: sourceUrl,
        accessed: new Date().toISOString().slice(0, 10),
        language: "en",
        note: `Archived source page ${id}; revision ${state.sourceRevisionId || "unknown"}; SHA-256 ${state.sourceSha256}.`,
      }];
      const page = {
        slug: title.targetSlug,
        title: title.zhTitle,
        summary: String(translated.summary || "").trim().slice(0, 220) || summaryFromBody(restored.output),
        categories: Array.isArray(translated.zhCategories) && translated.zhCategories.length ? translated.zhCategories.slice(0, 12) : ["EoM 待分类"],
        difficulty: "未分级",
        status: "review",
        quality: "Draft",
        author: "EoM contributors / Wikist 中文转换",
        importSource: "encyclopedia-of-mathematics",
        importTitle: title.sourceTitle,
        importLang: "en",
        importRevision: state.sourceRevisionId,
        importUrl: sourceUrl,
        importFetchedAt: unit.sourceArchivedAt || archive.generatedAt || "",
        importLicense: sourceLicense,
        canonicalNames: [...new Set([title.zhTitle, title.sourceTitle, ...(title.zhAliases || [])])].slice(0, 40),
        disambiguation: title.entryType === "disambiguation",
        classifications: unit.classifications || [],
        references,
        body,
      };
      const packageData = { format: "wikist-page", version: 1, source: { site: "Encyclopedia of Mathematics", pageid: id, title: title.sourceTitle, revisionId: state.sourceRevisionId, revisionTimestamp: state.sourceRevisionTimestamp, sha256: state.sourceSha256 }, translation: { status: validationIssues.length || translated.needsReview ? "needs_review" : "validated", modelOrAgent: translated.modelOrAgent || "Codex multi-agent", translatedAt: translated.translatedAt || new Date().toISOString(), issues: [...(unit.conversionIssues || []), ...(translated.issues || []), ...validationIssues] }, page };
      writeJson(packagePath, packageData);
      const entryPath = path.join(options.root, "entries", String(id).padStart(4, "0").slice(0, 4), `${safeFileStem(id, title.zhTitle)}.md`);
      atomicWrite(entryPath, body + "\n");
      state.status = packageData.translation.status;
      state.translationStatus = "translated";
      state.conversionStatus = "converted";
      state.validationStatus = validationIssues.length ? "needs_review" : "validated";
      state.outputPath = path.relative(options.root, packagePath).split(path.sep).join("/");
      state.outputSha256 = sha256(fs.readFileSync(packagePath));
      state.needsReview = packageData.translation.status === "needs_review";
      state.issues = packageData.translation.issues;
      state.updatedAt = new Date().toISOString();
      if (state.needsReview) review.push({ sourceId: id, sourceTitle: title.sourceTitle, issues: state.issues });
      converted += 1;
    } catch (error) {
      state.status = "failed";
      state.translationStatus = "failed";
      state.validationStatus = "failed";
      state.needsReview = true;
      state.issues = [{ code: "finalize-error", message: error.message }];
      state.updatedAt = new Date().toISOString();
      failures.push({ sourceId: id, sourceTitle: state.sourceTitle, error: error.stack || error.message });
    }
  }
  writeJsonl(path.join(options.root, "manifests", "conversion-manifest.jsonl"), manifest);
  writeJsonl(path.join(options.root, "reports", "translation-review.jsonl"), review);
  writeJsonl(path.join(options.root, "reports", "failures.jsonl"), failures);
  const progress = {
    generatedAt: new Date().toISOString(),
    sourceEntries: manifest.length,
    converted,
    redirects: redirected,
    pendingTranslation: missing,
    needsReview: manifest.filter((item) => item.needsReview).length,
    failed: failures.length,
    validated: manifest.filter((item) => item.validationStatus === "validated").length,
  };
  writeJson(path.join(options.root, "reports", "progress.json"), progress);
  process.stdout.write(`${JSON.stringify(progress, null, 2)}\n`);
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else if (options.command === "prepare") prepare(options);
    else finalize(options);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { mediaWikiToProtectedMarkdown, restoreTokens, flattenNestedProtectedTokens, formulaBalanceIssues, summaryFromBody };
