#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE = process.platform === "win32" ? "G:\\Wikist-EoM" : path.join(process.cwd(), "data", "eom-archive");
const DEFAULT_OUTPUT = process.platform === "win32" ? "G:\\Wikist-EoM\\wikist-zh" : path.join(process.cwd(), "data", "eom-wikist-zh");
const FORMAT_VERSION = 1;

function usage() {
  return `
Build the immutable global mapping layer for the EoM -> Wikist conversion.

Usage:
  node tools/eom-zh-index.js [options]

Options:
  --source=PATH       Raw EoM archive (default: ${DEFAULT_SOURCE})
  --output=PATH       Independent conversion root (default: ${DEFAULT_OUTPUT})
  --parts=N           Number of title-translation work partitions (default: 8)
  --force             Replace generated mapping/report files
  --help              Show this help
`.trim();
}

function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, output: DEFAULT_OUTPUT, parts: 8, force: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--source=")) options.source = arg.slice(9);
    else if (arg.startsWith("--output=")) options.output = arg.slice(9);
    else if (arg.startsWith("--parts=")) options.parts = Number(arg.slice(8));
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.source = path.resolve(options.source);
  options.output = path.resolve(options.output);
  if (!Number.isInteger(options.parts) || options.parts < 1 || options.parts > 64) {
    throw new Error("--parts must be an integer from 1 to 64.");
  }
  if (options.output === options.source || options.output.startsWith(`${options.source}${path.sep}`) === false) {
    throw new Error("The output must be an independent child directory of the raw archive.");
  }
  return options;
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, filePath);
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  atomicWrite(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function normalizedTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function titleSlug(title, pageid) {
  const replacements = new Map([
    ["*", "star"], ["+", "plus"], ["±", "plus-minus"], ["∞", "infinity"],
    ["ℂ", "complex"], ["ℝ", "real"], ["ℚ", "rational"], ["ℤ", "integer"], ["ℕ", "natural"],
  ]);
  const expanded = [...String(title || "")].map((character) => replacements.get(character) || character).join("");
  const slug = expanded
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
  return `eom/${slug || `page-${pageid}`}`;
}

function referenceId(value, fallback) {
  const original = String(value || "").trim();
  const id = original
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, "-");
  if (/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(id)) return id;
  if (!original) return fallback;
  const slug = original
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "key";
  const digest = crypto.createHash("sha256").update(id).digest("hex").slice(0, 24);
  return `ref-${slug}-${digest}`;
}

function inlineReferenceId(value) {
  return `inline-${crypto.createHash("sha256").update(String(value || "").trim()).digest("hex").slice(0, 16)}`;
}

function decodeReferenceEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (whole, digits) => {
      try { return String.fromCodePoint(Number.parseInt(digits, 16)); } catch { return whole; }
    })
    .replace(/&#(\d+);/g, (whole, digits) => {
      try { return String.fromCodePoint(Number.parseInt(digits, 10)); } catch { return whole; }
    })
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (whole, name) => named[name.toLocaleLowerCase("en-US")] || whole);
}

function referenceImageUrl(value) {
  const source = decodeReferenceEntities(value).trim();
  if (!source) return "";
  if (source.startsWith("//")) return `https:${source}`;
  if (source.startsWith("/")) return `https://encyclopediaofmath.org${source}`;
  return source;
}

function htmlAttributes(tag) {
  const attributes = {};
  for (const match of String(tag || "").matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g)) {
    attributes[match[1].toLocaleLowerCase("en-US")] = decodeReferenceEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function reviewableReferenceMediaValue(value) {
  return String(value || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function referenceMediaMarker(media) {
  const parts = [media.alt, media.url].filter(Boolean).map(reviewableReferenceMediaValue);
  if (!parts.length) parts.push(`HTML=${String(media.sourceHtml || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim()}`);
  return `[image: ${parts.join("; ")}]`;
}

function preserveReferenceImages(value) {
  const media = [];
  const text = String(value || "").replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (sourceHtml) => {
    const attributes = htmlAttributes(sourceHtml);
    const url = referenceImageUrl(attributes.src || "");
    const alt = String(attributes.alt || attributes.title || "").replace(/\s+/g, " ").trim();
    const item = { type: "image", url, alt, sourceHtml };
    media.push(item);
    return referenceMediaMarker(item);
  });
  return { text, media };
}

function plainWikiText(value) {
  return preserveReferenceImages(value).text
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ")
    .replace(/\{\{(?:ISBN|MR|ZBL|DOI|ARXIV)\|([^{}|]+)(?:\|[^{}]*)?\}\}/gi, "$1")
    .replace(/\{\{[^{}]+\}\}/g, " ")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,5}/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function referenceDefinitionFingerprint(value) {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function referenceSectionRanges(source) {
  const text = String(source || "");
  const headings = [...text.matchAll(/^(={2,6})\s*([^=\r\n]+?)\s*\1\s*$/gm)].map((match) => ({
    index: match.index,
    bodyStart: match.index + match[0].length,
    level: match[1].length,
    title: match[2].trim(),
  }));
  const ranges = [];
  for (const [index, heading] of headings.entries()) {
    if (!/\b(references?|bibliography|literature|sources?|notes?|further reading)\b/i.test(heading.title)) continue;
    let end = text.length;
    for (const next of headings.slice(index + 1)) {
      if (next.level <= heading.level) {
        end = next.index;
        break;
      }
    }
    ranges.push({ start: heading.bodyStart, end });
  }
  return ranges;
}

function looksBibliographicReference(value) {
  const text = String(value || "");
  return /\b(?:1[5-9]\d{2}|20\d{2})\b/.test(text)
    || /https?:\/\//i.test(text)
    || /\{\{\s*(?:ISBN|MR|ZBL|DOI|ARXIV)\b/i.test(text)
    || /''[^']{2,}''/.test(text)
    || /["“][^"”]{3,}["”]/.test(text)
    || /\b(?:vol\.?|volume|edition|publisher|journal|proceedings|Springer|Elsevier|Cambridge|Oxford|Nauka|Math\.|Ann\.|Trans\.|Izv\.|Uspekhi)\b/i.test(text)
    || /\b[A-Z]\.(?:\s*[A-Z]\.)?\s*[A-Z][A-Za-z'’-]{2,}/.test(text);
}

function conflictReferenceId(baseId, fingerprint, usedIds) {
  for (const length of [12, 16, 24, 32, 48, 64]) {
    const suffix = `--${fingerprint.slice(0, length)}`;
    const candidate = `${baseId.slice(0, 96 - suffix.length)}${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  let counter = 2;
  while (true) {
    const suffix = `--${fingerprint.slice(0, 48)}-${counter}`;
    const candidate = `${baseId.slice(0, 96 - suffix.length)}${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
    counter += 1;
  }
}

function referenceRecord(rawKey, rawText, id) {
  const sourceText = String(rawText || "");
  const preserved = preserveReferenceImages(sourceText);
  let mediaIndex = 0;
  const titleMarkup = sourceText.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, () => `[reference-image-${mediaIndex++}]`);
  const markupWithoutTags = titleMarkup
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ")
    .replace(/&quot;|&#34;|&#x22;/gi, "\"");
  const text = plainWikiText(preserved.text);
  const year = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1] || "";
  const italicTitle = titleMarkup.match(/''([\s\S]{2,500}?)''/)?.[1];
  const htmlItalicTitle = titleMarkup.match(/<(?:i|em)\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]{2,500}?)<\/(?:i|em)\s*>/i)?.[1];
  const quotedTitle = markupWithoutTags.match(/["“]([^"”\r\n]{3,500})["”]/)?.[1];
  const titleSource = String(italicTitle || htmlItalicTitle || quotedTitle || "").replace(/\[reference-image-(\d+)\]/g, (whole, index) => {
    const media = preserved.media[Number(index)];
    return media ? referenceMediaMarker(media) : whole;
  });
  const title = plainWikiText(titleSource) || `EoM reference ${rawKey}`;
  const identifiers = {};
  for (const match of sourceText.matchAll(/\{\{\s*(ISBN|MR|ZBL|DOI|ARXIV)\s*\|\s*([^{}|]+)[^{}]*\}\}/gi)) {
    identifiers[match[1].toLocaleLowerCase("en-US")] = String(match[2] || "").trim();
  }
  const withoutImages = sourceText.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, " ");
  const url = withoutImages.match(/https?:\/\/[^\s<>"'\]}|]+/i)?.[0] || "";
  return {
    id,
    type: url ? "web" : "other",
    authors: [],
    title,
    year,
    url,
    note: text.slice(0, 800),
    sourceText,
    language: "en",
    identifiers,
    inlineMedia: preserved.media,
    reviewFlags: preserved.media.length ? ["inline-reference-image"] : [],
  };
}

function referenceConflictAudit(references) {
  const groups = new Map();
  for (const item of references) {
    const audit = item.keyAudit || {};
    if (audit.status !== "same-key-distinct") continue;
    if (!groups.has(audit.baseId)) groups.set(audit.baseId, []);
    groups.get(audit.baseId).push(item);
  }
  return [...groups.entries()].map(([baseId, variants]) => ({
    baseId,
    status: "same-key-distinct",
    originalKeys: [...new Set(variants.flatMap((item) => item.originalKeys || [item.originalKey]))],
    variantCount: variants.length,
    variantIds: variants.map((item) => item.id),
    fingerprints: variants.map((item) => item.definitionFingerprint),
    definitionLines: variants.map((item) => item.line),
    occurrences: variants.reduce((sum, item) => sum + Number(item.duplicateCount || 1), 0),
  }));
}

function parseReferenceRows(source) {
  const sourceText = String(source || "");
  const candidates = [];
  const seenOccurrences = new Set();
  const sectionRanges = referenceSectionRanges(sourceText);
  const add = (rawKey, rawText, offset = 0, sourceKind = "unknown") => {
    const originalKey = String(rawKey || "").trim().replace(/^\[|\]$/g, "");
    if (!originalKey) return;
    const baseId = referenceId(originalKey, "");
    const definitionFingerprint = referenceDefinitionFingerprint(rawText);
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const signature = `${normalizedOffset}\u0000${baseId}\u0000${definitionFingerprint}`;
    if (seenOccurrences.has(signature)) return;
    seenOccurrences.add(signature);
    candidates.push({
      originalKey,
      baseId,
      rawText: String(rawText || ""),
      definitionFingerprint,
      line: sourceLineNumber(sourceText, normalizedOffset),
      offset: normalizedOffset,
      sourceKind,
    });
  };

  for (const match of sourceText.matchAll(/<tr\b[^>]*>\s*<td\b[^>]*>\s*(\[[^\]]+\])\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
    add(match[1], match[2], match.index, "html-table-row");
  }
  for (const match of sourceText.matchAll(/^\s*\[([^\]\n]+)\]\s*(.+)$/gm)) {
    const inReferenceSection = sectionRanges.some((range) => match.index >= range.start && match.index < range.end);
    if (inReferenceSection || looksBibliographicReference(match[2])) add(match[1], match[2], match.index, "bracket-line");
  }
  for (const match of sourceText.matchAll(/\{\{\s*Ref\s*\|\s*([^{}|]+)\s*\|([\s\S]*?)\}\}/gi)) {
    add(match[1], match[2], match.index, "ref-template");
  }
  for (const lineMatch of sourceText.matchAll(/^.*$/gm)) {
    const match = lineMatch[0].match(/\{\{\s*Ref\s*\|\s*([^{}|]+)\s*\}\}([\s\S]*)$/i);
    if (!match) continue;
    const bibliography = String(match[2] || "")
      .replace(/^\s*\|{1,2}(?:[^|\n]*\|)?\s*/, "")
      .replace(/^\s*(?:valign|align|style|class|width)\s*=\s*(?:"[^"]*"|'[^']*'|[^|\s]+)\s*\|\s*/i, "")
      .replace(/^\s*[-*#:;|]+\s*/, "")
      .trim();
    if (bibliography) add(match[1], bibliography, lineMatch.index + match.index, "ref-template-row");
  }
  for (const match of sourceText.matchAll(/<ref\b(?![^>]*\/\s*>)([^>]*?)>([\s\S]*?)<\/ref\s*>/gi)) {
    const name = String(match[1] || "").match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    const key = name ? (name[1] || name[2] || name[3]) : inlineReferenceId(match[2]);
    add(key, match[2], match.index, "full-reference");
  }

  candidates.sort((left, right) => left.offset - right.offset || left.baseId.localeCompare(right.baseId, "en"));
  const groups = new Map();
  for (const candidate of candidates) {
    if (!groups.has(candidate.baseId)) groups.set(candidate.baseId, { baseId: candidate.baseId, variants: [] });
    const group = groups.get(candidate.baseId);
    let variant = group.variants.find((item) => item.definitionFingerprint === candidate.definitionFingerprint);
    if (!variant) {
      variant = { definitionFingerprint: candidate.definitionFingerprint, representative: candidate, occurrences: [] };
      group.variants.push(variant);
    }
    variant.occurrences.push({
      originalKey: candidate.originalKey,
      line: candidate.line,
      offset: candidate.offset,
      sourceKind: candidate.sourceKind,
    });
  }

  const usedIds = new Set();
  const rows = [];
  for (const group of groups.values()) {
    group.variants.sort((left, right) => left.representative.offset - right.representative.offset);
    const ids = group.variants.map((variant, index) => {
      const candidate = index === 0 && !usedIds.has(group.baseId)
        ? group.baseId
        : conflictReferenceId(group.baseId, variant.definitionFingerprint, usedIds);
      usedIds.add(candidate);
      return candidate;
    });
    for (const [index, variant] of group.variants.entries()) {
      const id = ids[index];
      const occurrences = variant.occurrences.slice().sort((left, right) => left.offset - right.offset);
      const originalKeys = [...new Set(occurrences.map((item) => item.originalKey))];
      const status = group.variants.length > 1
        ? "same-key-distinct"
        : occurrences.length > 1 ? "same-key-identical" : "unique";
      rows.push({
        originalKey: occurrences[0].originalKey,
        originalKeys,
        id,
        line: occurrences[0].line,
        offset: occurrences[0].offset,
        sourceKind: occurrences[0].sourceKind,
        definitionFingerprint: variant.definitionFingerprint,
        definitionOccurrences: occurrences,
        duplicateCount: occurrences.length,
        duplicateOriginalKeys: originalKeys,
        keyAudit: {
          baseId: group.baseId,
          status,
          variantIndex: index + 1,
          variantCount: group.variants.length,
          occurrenceCount: occurrences.length,
          originalKeys,
          definitionLines: occurrences.map((item) => item.line),
          sourceKinds: [...new Set(occurrences.map((item) => item.sourceKind))],
          fingerprint: variant.definitionFingerprint,
          siblingIds: ids.filter((candidate) => candidate !== id),
        },
        reference: referenceRecord(occurrences[0].originalKey, variant.representative.rawText, id),
      });
    }
  }
  return rows.sort((left, right) => left.offset - right.offset || left.id.localeCompare(right.id, "en"));
}

function sourceLineNumber(source, offset) {
  return String(source || "").slice(0, Math.max(0, offset)).split("\n").length;
}

function sourceOffsetForLine(source, line) {
  const target = Math.max(1, Number(line) || 1);
  if (target === 1) return 0;
  let offset = 0;
  for (let current = 1; current < target; current += 1) {
    const newline = String(source || "").indexOf("\n", offset);
    if (newline < 0) return String(source || "").length;
    offset = newline + 1;
  }
  return offset;
}

function sourceReferenceUses(source, relation = {}, references = []) {
  const sourceText = String(source || "");
  const rawUses = [];
  const add = (originalKey, offset, sourceKind) => {
    const key = String(originalKey || "").trim();
    if (!key) return;
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    rawUses.push({
      originalKey: key,
      baseId: referenceId(key, ""),
      line: sourceLineNumber(sourceText, normalizedOffset),
      offset: normalizedOffset,
      sourceKind,
    });
  };

  for (const match of sourceText.matchAll(/\{\{\s*Cite\s*\|([^{}]+)\}\}/gi)) {
    for (const raw of match[1].split("|").map((item) => item.trim()).filter(Boolean)) add(raw, match.index, "cite-template");
  }
  for (const match of sourceText.matchAll(/\[\[\s*#(?:references?|bibliography|literature|notes?)[^|\]\r\n]*\|\s*\[([^\]\r\n]+)\]\s*\]\]/gi)) {
    add(match[1], match.index, "reference-anchor");
  }
  for (const match of sourceText.matchAll(/<ref\b(?![^>]*\/\s*>)([^>]*?)>([\s\S]*?)<\/ref\s*>/gi)) {
    const name = String(match[1] || "").match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    const originalKey = name ? (name[1] || name[2] || name[3]) : inlineReferenceId(match[2]);
    add(originalKey, match.index, "full-reference");
  }
  for (const match of sourceText.matchAll(/<ref\b([^>]*?)\/\s*>/gi)) {
    const name = String(match[1] || "").match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    const originalKey = name ? (name[1] || name[2] || name[3]) : "";
    if (originalKey) add(originalKey, match.index, "self-closing-reference");
  }

  const rawLineKeys = new Set(rawUses.map((item) => `${item.baseId}\u0000${item.line}`));
  for (const use of relation.citationUses || []) {
    for (const key of use.keys || []) {
      const baseId = referenceId(key, "");
      const line = Number(use.line) || 0;
      if (rawLineKeys.has(`${baseId}\u0000${line}`)) continue;
      add(String(key), sourceOffsetForLine(sourceText, line), "relation-citation");
    }
  }

  const candidatesByBaseId = new Map();
  for (const definition of references) {
    const baseId = definition.keyAudit?.baseId || referenceId(definition.originalKey, "");
    if (!candidatesByBaseId.has(baseId)) candidatesByBaseId.set(baseId, []);
    candidatesByBaseId.get(baseId).push(definition);
  }
  const bind = (use) => {
    const candidates = candidatesByBaseId.get(use.baseId) || [];
    const candidateIds = candidates.map((item) => item.id);
    if (!candidates.length) {
      return {
        ...use,
        id: use.baseId,
        bindingStatus: "unresolved",
        bindingStrategy: "no-definition",
        bindingConfidence: "low",
        candidateIds,
        definitionLine: 0,
        definitionFingerprint: "",
      };
    }
    const occurrences = candidates.flatMap((candidate) => (candidate.definitionOccurrences || [{
      line: candidate.line,
      offset: candidate.offset,
      sourceKind: candidate.sourceKind,
    }]).map((occurrence) => ({ candidate, occurrence })));
    let selected = occurrences.find((item) => item.occurrence.offset === use.offset);
    let strategy = selected ? "same-source-occurrence" : "";
    let confidence = selected ? "high" : "";
    if (!selected && candidates.length === 1) {
      selected = occurrences[0];
      strategy = "only-definition";
      confidence = "high";
    }
    if (!selected) {
      const before = occurrences
        .filter((item) => item.occurrence.offset <= use.offset)
        .sort((left, right) => right.occurrence.offset - left.occurrence.offset);
      const after = occurrences
        .filter((item) => item.occurrence.offset > use.offset)
        .sort((left, right) => left.occurrence.offset - right.occurrence.offset);
      if (use.sourceKind === "self-closing-reference") {
        selected = before[0] || after[0];
        strategy = before.length ? "nearest-prior-definition" : "nearest-following-definition";
      } else {
        selected = after[0] || before[0];
        strategy = after.length ? "nearest-following-definition" : "nearest-prior-definition";
      }
      confidence = "medium";
    }
    return {
      ...use,
      id: selected.candidate.id,
      bindingStatus: candidates.length > 1 ? "inferred" : "bound",
      bindingStrategy: strategy,
      bindingConfidence: confidence,
      candidateIds,
      definitionLine: Number(selected.occurrence.line) || 0,
      definitionFingerprint: selected.candidate.definitionFingerprint,
    };
  };

  const unique = new Map();
  for (const item of rawUses.sort((left, right) => left.offset - right.offset)) {
    const signature = `${item.baseId}\u0000${item.offset}\u0000${item.sourceKind}\u0000${item.originalKey}`;
    if (!unique.has(signature)) unique.set(signature, bind(item));
  }
  return [...unique.values()];
}

function externalTarget(target) {
  return /^(?:Category|File|Image|Template|Help|MediaWiki|Special|User|Talk|Portal):/i.test(String(target || ""))
    || /^[a-z-]+:/i.test(String(target || ""));
}

function redirectLoops(redirectById) {
  const cycles = [];
  const emitted = new Set();
  for (const start of redirectById.keys()) {
    const order = [];
    const positions = new Map();
    let current = start;
    while (redirectById.has(current)) {
      if (positions.has(current)) {
        const cycle = order.slice(positions.get(current));
        const signature = cycle.slice().sort((a, b) => a - b).join(":");
        if (!emitted.has(signature)) {
          emitted.add(signature);
          cycles.push(cycle);
        }
        break;
      }
      positions.set(current, order.length);
      order.push(current);
      current = redirectById.get(current);
      if (!current) break;
    }
  }
  return cycles;
}

const TERM_GLOSSARY = [
  ["field", "域", ["场"], "代数学", "high", "代数学结构使用“域”；物理语境另行判断。"],
  ["ring", "环", [], "代数学", "high", ""],
  ["module", "模", [], "代数学", "high", ""],
  ["ideal", "理想", [], "交换代数", "high", ""],
  ["variety", "簇", ["代数簇"], "代数几何", "high", "按上下文区分一般簇与代数簇。"],
  ["scheme", "概形", [], "代数几何", "high", ""],
  ["sheaf", "层", [], "几何/拓扑", "high", ""],
  ["bundle", "丛", [], "几何/拓扑", "high", "按上下文细化为纤维丛、向量丛等。"],
  ["manifold", "流形", [], "几何/拓扑", "high", ""],
  ["lattice", "格", ["点阵"], "代数/几何", "medium", "偏序结构用“格”；离散子群等语境可用“格点阵/格”。"],
  ["order", "序", ["阶"], "序理论/代数", "medium", "偏序语境用“序”；群元素 order 用“阶”。"],
  ["representation", "表示", [], "代数学", "high", ""],
  ["character", "特征标", ["特征"], "表示论", "medium", "表示论中用“特征标”。"],
  ["kernel", "核", [], "代数/分析", "high", ""],
  ["cokernel", "余核", [], "代数学", "high", ""],
  ["complex", "复形", ["复数的", "复的"], "同调代数/分析", "medium", "名词 chain complex 等用“复形”。"],
  ["resolution", "消解", ["分解"], "同调代数", "medium", "按领域核验。"],
  ["extension", "扩张", ["延拓", "扩展"], "代数/分析", "medium", "域/群扩张与函数延拓需区分。"],
  ["embedding", "嵌入", [], "几何/拓扑", "high", ""],
  ["immersion", "浸入", [], "微分几何", "high", ""],
  ["covering", "覆叠", ["覆盖"], "拓扑", "medium", "covering space 用“覆叠空间”。"],
  ["fibration", "纤维化", ["纤维丛结构"], "拓扑", "high", ""],
  ["valuation", "赋值", [], "代数/数论", "high", ""],
  ["place", "位", [], "代数/数论", "medium", "需按上下文核验。"],
  ["localization", "局部化", [], "代数/分析", "high", ""],
  ["completion", "完备化", ["补全"], "代数/分析", "medium", "数学结构通常用“完备化”。"],
  ["closure", "闭包", [], "拓扑/代数", "high", ""],
  ["operator", "算子", [], "分析", "high", ""],
  ["functional", "泛函", [], "分析", "high", "作为名词时用“泛函”。"],
  ["distribution", "分布", ["广义函数"], "概率/分析", "medium", "概率用“分布”；Schwartz distribution 用“分布/广义函数”。"],
  ["measure", "测度", [], "分析/概率", "high", ""],
  ["group", "群", [], "代数学", "high", ""],
  ["homomorphism", "同态", [], "代数学", "high", ""],
  ["isomorphism", "同构", [], "数学通用", "high", ""],
  ["homeomorphism", "同胚", [], "拓扑", "high", ""],
];

function buildIndex(options) {
  const archivePath = path.join(options.source, "archive.json");
  const titleIndexPath = path.join(options.source, "indexes", "by-title.jsonl");
  if (!fs.existsSync(archivePath) || !fs.existsSync(titleIndexPath)) {
    throw new Error("The raw EoM archive is incomplete: archive.json or indexes/by-title.jsonl is missing.");
  }
  const archive = readJson(archivePath);
  if (archive.complete !== true) throw new Error("The raw EoM archive has not been marked complete.");

  ensureDir(options.output);
  const directories = ["entries", "redirects", "references", "mappings", "manifests", "reports", "logs", "validation", "work/title-input", "work/title-output", "packages"];
  directories.forEach((directory) => ensureDir(path.join(options.output, directory)));
  const marker = path.join(options.output, "conversion-root.json");
  if (fs.existsSync(marker) && !options.force) {
    const existing = readJson(marker);
    if (path.resolve(existing.sourceRoot || "") !== options.source) throw new Error("The output belongs to a different source archive.");
  }

  const rows = readJsonl(titleIndexPath).sort((a, b) => Number(a.pageid) - Number(b.pageid));
  const byExactTitle = new Map();
  const byNormalizedTitle = new Map();
  const byId = new Map();
  const slugOwners = new Map();
  for (const row of rows) {
    byId.set(Number(row.pageid), row);
    byExactTitle.set(String(row.title), row);
    const key = normalizedTitle(row.title);
    const bucket = byNormalizedTitle.get(key) || [];
    bucket.push(row);
    byNormalizedTitle.set(key, bucket);
    let slug = titleSlug(row.title, row.pageid);
    if (slugOwners.has(slug)) slug = `${slug}-${row.pageid}`;
    slugOwners.set(slug, row.pageid);
    row.targetSlug = slug;
  }

  const duplicateTitles = [];
  for (const [key, bucket] of byNormalizedTitle) {
    if (bucket.length > 1) duplicateTitles.push({ normalizedTitle: key, pages: bucket.map((item) => ({ pageid: item.pageid, title: item.title })) });
  }

  const titleMap = [];
  const linkMap = [];
  const redirectMap = [];
  const referenceMap = [];
  const manifest = [];
  const redirectById = new Map();
  const brokenLinks = [];
  const ambiguousLinks = [];
  const duplicateReferenceKeys = [];
  const missingReferenceKeys = [];
  let sourceLinkTotal = 0;
  let resolvedLinkTotal = 0;
  let externalOrNamespaceLinks = 0;
  let citationUseTotal = 0;
  let referenceDefinitionTotal = 0;
  let templateTotal = 0;
  const templateCounts = new Map();

  const resolveTitle = (target) => {
    const exact = byExactTitle.get(String(target || ""));
    if (exact) return { status: "resolved", page: exact };
    const bucket = byNormalizedTitle.get(normalizedTitle(target)) || [];
    if (bucket.length === 1) return { status: "resolved", page: bucket[0] };
    if (bucket.length > 1) return { status: "ambiguous", candidates: bucket };
    return { status: "missing" };
  };

  rows.forEach((row, sequence) => {
    const metadata = readJson(path.join(options.source, row.metadataFile));
    const relation = readJson(path.join(options.source, row.relationsFile));
    const sourcePath = path.join(options.source, row.sourceFile);
    const source = fs.readFileSync(sourcePath, "utf8");
    if (sha256(source) !== row.sourceSha256) throw new Error(`Source checksum mismatch: ${row.sourceFile}`);
    const redirectResolution = row.redirectTarget?.title ? resolveTitle(row.redirectTarget.title) : null;
    if (row.redirect && redirectResolution?.status === "resolved") redirectById.set(Number(row.pageid), Number(redirectResolution.page.pageid));

    const categories = (relation.categories || [])
      .map((item) => String(item.title || "").replace(/^Category:/i, ""))
      .filter((item) => item && !/^(?:TeX|TEX|Created with|Pages with|Source)/i.test(item));
    const classifications = (relation.sourceTemplates || [])
      .filter((item) => /^(?:MSC|MSCwiki)$/i.test(item.name))
      .flatMap((item) => item.arguments || [])
      .map((item) => String(item).trim())
      .filter(Boolean);
    for (const item of relation.sourceTemplates || []) {
      templateTotal += 1;
      const name = String(item.name || "").trim();
      templateCounts.set(name, (templateCounts.get(name) || 0) + 1);
    }

    const links = [];
    for (const [linkIndex, link] of (relation.sourceWikilinks || []).entries()) {
      sourceLinkTotal += 1;
      const target = String(link.target || "").trim();
      if (!target || externalTarget(target)) {
        externalOrNamespaceLinks += 1;
        links.push({ sourceIndex: linkIndex, sourceTarget: target, sourceLabel: link.label || "", anchor: link.anchor || "", line: link.line || 0, status: "external-or-namespace" });
        continue;
      }
      const resolution = resolveTitle(target);
      if (resolution.status === "resolved") {
        resolvedLinkTotal += 1;
        links.push({
          sourceIndex: linkIndex,
          sourceTarget: target,
          sourceLabel: link.label || "",
          anchor: link.anchor || "",
          line: link.line || 0,
          status: "resolved",
          targetSourceId: Number(resolution.page.pageid),
          targetSourceTitle: resolution.page.title,
          targetSlug: resolution.page.targetSlug,
        });
      } else if (resolution.status === "ambiguous") {
        const issue = { sourceId: Number(row.pageid), sourceTitle: row.title, sourceTarget: target, line: link.line || 0, candidates: resolution.candidates.map((item) => Number(item.pageid)) };
        ambiguousLinks.push(issue);
        links.push({ ...issue, status: "ambiguous" });
      } else {
        const issue = { sourceId: Number(row.pageid), sourceTitle: row.title, sourceTarget: target, sourceLabel: link.label || "", anchor: link.anchor || "", line: link.line || 0 };
        brokenLinks.push(issue);
        links.push({ ...issue, status: "missing" });
      }
    }

    const references = parseReferenceRows(source);
    const conflicts = referenceConflictAudit(references);
    const uses = sourceReferenceUses(source, relation, references);
    citationUseTotal += uses.length;
    referenceDefinitionTotal += references.length;
    const defined = new Set(references.map((item) => item.id));
    for (const item of references) {
      if (Number(item.duplicateCount || 1) > 1) {
        duplicateReferenceKeys.push({
          sourceId: Number(row.pageid),
          sourceTitle: row.title,
          status: "same-key-identical",
          baseId: item.keyAudit?.baseId || item.id,
          id: item.id,
          occurrences: item.duplicateCount,
          originalKeys: item.duplicateOriginalKeys || [item.originalKey],
          definitionLines: item.definitionOccurrences?.map((occurrence) => occurrence.line) || [item.line],
          fingerprint: item.definitionFingerprint,
        });
      }
    }
    for (const conflict of conflicts) {
      duplicateReferenceKeys.push({
        sourceId: Number(row.pageid),
        sourceTitle: row.title,
        ...conflict,
      });
    }
    for (const use of uses) {
      if (!use.id || !defined.has(use.id)) missingReferenceKeys.push({ sourceId: Number(row.pageid), sourceTitle: row.title, ...use });
    }

    const entryType = row.redirect ? "redirect" : /disambiguation/i.test(source) || categories.some((item) => /disambiguation/i.test(item)) ? "disambiguation" : "article";
    titleMap.push({
      sequence,
      sourceId: Number(row.pageid),
      sourceTitle: row.title,
      sourceTitleKey: normalizedTitle(row.title),
      sourcePath: row.sourceFile,
      metadataPath: row.metadataFile,
      relationsPath: row.relationsFile,
      entryType,
      targetSlug: row.targetSlug,
      categories,
      classifications: [...new Set(classifications)],
      redirectSourceTarget: row.redirectTarget?.title || "",
      zhTitle: "",
      zhAliases: [row.title],
      titleStatus: "pending",
      titleConfidence: "",
      titleNotes: "",
    });
    linkMap.push({ sourceId: Number(row.pageid), sourceTitle: row.title, sourceSlug: row.targetSlug, links });
    if (row.redirect) {
      redirectMap.push({
        sourceId: Number(row.pageid),
        sourceTitle: row.title,
        sourceSlug: row.targetSlug,
        sourceTarget: row.redirectTarget?.title || "",
        sourceAnchor: row.redirectTarget?.anchor || "",
        status: redirectResolution?.status || "missing",
        targetSourceId: redirectResolution?.page ? Number(redirectResolution.page.pageid) : null,
        targetSourceTitle: redirectResolution?.page?.title || "",
        targetSlug: redirectResolution?.page?.targetSlug || "",
      });
    }
    referenceMap.push({ sourceId: Number(row.pageid), sourceTitle: row.title, sourceSlug: row.targetSlug, references, uses, conflicts });
    manifest.push({
      sequence,
      sourceId: Number(row.pageid),
      sourceTitle: row.title,
      sourcePath: row.sourceFile,
      sourceSha256: row.sourceSha256,
      sourceRevisionId: String(row.lastRevisionId || ""),
      sourceRevisionTimestamp: row.revisionTimestamp || "",
      entryType,
      targetSlug: row.targetSlug,
      status: "pending_title",
      translationStatus: "pending",
      conversionStatus: "pending",
      validationStatus: "pending",
      outputPath: "",
      outputSha256: "",
      needsReview: false,
      issues: [],
      updatedAt: new Date().toISOString(),
    });
  });

  const loops = redirectLoops(redirectById);
  const glossary = TERM_GLOSSARY.map(([english, preferredChinese, alternatives, domain, confidence, notes]) => ({ english, preferredChinese, alternatives, domain, confidence, notes }));
  const generatedAt = new Date().toISOString();
  const sourceAudit = {
    generatedAt,
    sourceArchive: options.source,
    archiveGeneratedAt: archive.generatedAt || "",
    sourcePages: rows.length,
    entryTypes: titleMap.reduce((counts, item) => ({ ...counts, [item.entryType]: (counts[item.entryType] || 0) + 1 }), {}),
    duplicateNormalizedTitles: duplicateTitles.length,
    duplicateTitleDetails: duplicateTitles,
    sourceLinks: sourceLinkTotal,
    resolvedLinks: resolvedLinkTotal,
    externalOrNamespaceLinks,
    brokenLinks: brokenLinks.length,
    ambiguousLinks: ambiguousLinks.length,
    redirects: redirectMap.length,
    redirectResolved: redirectMap.filter((item) => item.status === "resolved").length,
    redirectMissing: redirectMap.filter((item) => item.status === "missing").length,
    redirectAmbiguous: redirectMap.filter((item) => item.status === "ambiguous").length,
    redirectCycles: loops.length,
    redirectCycleDetails: loops,
    citationUses: citationUseTotal,
    referenceDefinitions: referenceDefinitionTotal,
    missingReferenceUses: missingReferenceKeys.length,
    duplicateReferenceKeys: duplicateReferenceKeys.length,
    identicalReferenceKeyRepeats: duplicateReferenceKeys.filter((item) => item.status === "same-key-identical").length,
    conflictingReferenceKeys: duplicateReferenceKeys.filter((item) => item.status === "same-key-distinct").length,
    templates: templateTotal,
    topTemplates: [...templateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([name, count]) => ({ name, count })),
  };

  writeJson(marker, { format: "wikist-eom-zh-conversion", formatVersion: FORMAT_VERSION, sourceRoot: options.source, outputRoot: options.output, createdAt: fs.existsSync(marker) ? readJson(marker).createdAt : generatedAt, indexedAt: generatedAt });
  writeJsonl(path.join(options.output, "mappings", "global-title-map.jsonl"), titleMap);
  writeJsonl(path.join(options.output, "mappings", "global-link-map.jsonl"), linkMap);
  writeJsonl(path.join(options.output, "mappings", "global-redirect-map.jsonl"), redirectMap);
  writeJsonl(path.join(options.output, "mappings", "global-reference-map.jsonl"), referenceMap);
  writeJson(path.join(options.output, "mappings", "global-term-glossary.json"), { formatVersion: FORMAT_VERSION, generatedAt, terms: glossary });
  writeJsonl(path.join(options.output, "manifests", "conversion-manifest.jsonl"), manifest);
  writeJson(path.join(options.output, "reports", "source-audit.json"), sourceAudit);
  writeJsonl(path.join(options.output, "reports", "broken-links.jsonl"), brokenLinks);
  writeJsonl(path.join(options.output, "reports", "ambiguous-links.jsonl"), ambiguousLinks);
  writeJsonl(path.join(options.output, "reports", "missing-reference-uses.jsonl"), missingReferenceKeys);
  writeJsonl(path.join(options.output, "reports", "duplicate-reference-keys.jsonl"), duplicateReferenceKeys);

  const partitions = Array.from({ length: options.parts }, () => []);
  titleMap.forEach((item, index) => partitions[index % options.parts].push({
    sourceId: item.sourceId,
    sourceTitle: item.sourceTitle,
    entryType: item.entryType,
    categories: item.categories,
    classifications: item.classifications,
    redirectSourceTarget: item.redirectSourceTarget,
  }));
  partitions.forEach((partition, index) => writeJsonl(path.join(options.output, "work", "title-input", `part-${String(index + 1).padStart(2, "0")}.jsonl`), partition));

  process.stdout.write(`${JSON.stringify({ indexed: rows.length, links: sourceLinkTotal, resolvedLinks: resolvedLinkTotal, brokenLinks: brokenLinks.length, redirects: redirectMap.length, redirectCycles: loops.length, citationUses: citationUseTotal, referenceDefinitions: referenceDefinitionTotal, output: options.output }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else buildIndex(options);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildIndex,
  inlineReferenceId,
  normalizedTitle,
  parseReferenceRows,
  referenceId,
  sourceReferenceUses,
  titleSlug,
};
