const { normalizeSlug } = require("./slug");

const WIKIPEDIA_LANGS = new Set(["zh", "zh-cn", "zh-tw", "en"]);
const MAX_IMPORT_BODY = 1024 * 1024 * 4;
const MEDIA_NAMESPACES = new Set(["file", "image", "文件", "图片", "檔案", "图像", "圖像"]);
const CATEGORY_NAMESPACES = new Set(["category", "分类", "分類"]);
let serverOpenCC = null;

function cleanImportText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function cleanWikipediaLang(value) {
  const lang = String(value || "zh").trim().toLowerCase();
  return WIKIPEDIA_LANGS.has(lang) ? lang : "zh";
}

function wikipediaHost(lang) {
  const normalized = cleanWikipediaLang(lang);
  if (normalized === "zh-cn" || normalized === "zh-tw") return "zh.wikipedia.org";
  return `${normalized}.wikipedia.org`;
}

function wikipediaProjectLang(lang) {
  const normalized = cleanWikipediaLang(lang);
  if (normalized === "zh-cn" || normalized === "zh-tw") return "zh";
  return normalized;
}

function pageTitleToSlug(title) {
  return normalizeSlug(String(title || "").replace(/_/g, " ").trim().toLowerCase());
}

function simplifiedTitleToTraditional(title) {
  try {
    if (!serverOpenCC) {
      serverOpenCC = require("../../plugins/vendor/opencc-js/full.js");
    }
    if (serverOpenCC?.Converter) return serverOpenCC.Converter({ from: "cn", to: "tw" })(String(title || ""));
  } catch (_error) {}
  return String(title || "");
}

async function fetchWikimediaCorePage(projectLang, title, originalStatus = 502) {
  const url = `https://api.wikimedia.org/core/v1/wikipedia/${projectLang}/page/${encodeURIComponent(String(title || "").replace(/\s+/g, "_"))}`;
  let response;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "WikistImporter/0.2 (https://wikist.local; open knowledge wiki)",
        },
        signal: AbortSignal.timeout(25000),
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response && lastError) {
    const error = new Error(`Wikipedia 拉取失败：${lastError.message || "网络连接失败"}`);
    error.statusCode = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Wikipedia 拉取失败：HTTP ${response.status}`);
    error.statusCode = response.status === 404 ? 404 : originalStatus;
    throw error;
  }
  return response.json();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function splitTopLevel(value, separator = "|") {
  const parts = [];
  let current = "";
  let templateDepth = 0;
  let linkDepth = 0;
  for (let index = 0; index < String(value || "").length; index += 1) {
    const two = value.slice(index, index + 2);
    if (two === "{{") {
      templateDepth += 1;
      current += two;
      index += 1;
      continue;
    }
    if (two === "}}" && templateDepth) {
      templateDepth -= 1;
      current += two;
      index += 1;
      continue;
    }
    if (two === "[[") {
      linkDepth += 1;
      current += two;
      index += 1;
      continue;
    }
    if (two === "]]" && linkDepth) {
      linkDepth -= 1;
      current += two;
      index += 1;
      continue;
    }
    if (value[index] === separator && !templateDepth && !linkDepth) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += value[index];
  }
  parts.push(current.trim());
  return parts;
}

function splitKeyValue(value) {
  let templateDepth = 0;
  let linkDepth = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    const two = text.slice(index, index + 2);
    if (two === "{{") { templateDepth += 1; index += 1; continue; }
    if (two === "}}" && templateDepth) { templateDepth -= 1; index += 1; continue; }
    if (two === "[[") { linkDepth += 1; index += 1; continue; }
    if (two === "]]" && linkDepth) { linkDepth -= 1; index += 1; continue; }
    if (text[index] === "=" && !templateDepth && !linkDepth) {
      const key = text.slice(0, index).trim();
      const val = text.slice(index + 1).trim();
      if (/^[\w\s-]{1,48}$/u.test(key)) return [key, val];
    }
  }
  return ["", text.trim()];
}

function findBalancedEnd(text, start, open, close) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const token = text.slice(index, index + 2);
    if (token === open) {
      depth += 1;
      index += 1;
      continue;
    }
    if (token === close) {
      depth -= 1;
      index += 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function namespaceOf(content) {
  const match = String(content || "").match(/^\s*([^:\]]+):/);
  return match ? match[1].trim().toLowerCase() : "";
}

function afterNamespace(content) {
  return String(content || "").replace(/^\s*[^:\]]+:\s*/, "");
}

function commonsFileUrl(fileName) {
  const clean = String(fileName || "").replace(/^File:/i, "").replace(/^Image:/i, "").trim().replace(/\s+/g, "_");
  if (!clean) return "";
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(clean)}`;
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function wikiSyntaxToPlain(value) {
  return String(value || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1");
}

function escapeTableCell(value) {
  const tableHref = (slug) => `#/page/${String(slug || "").split("/").map(encodeURIComponent).join("/")}`;
  return String(value || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_match, slug, label) => `[${label}](${tableHref(slug)})`)
    .replace(/\[\[([^\]]+)\]\]/g, (_match, slug) => `[${slug}](${tableHref(slug)})`)
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageOption(value) {
  const lower = String(value || "").trim().toLowerCase();
  return [
    "thumb", "thumbnail", "frame", "framed", "frameless", "border", "right", "left", "center", "centre",
    "none", "upright", "baseline", "middle", "sub", "super", "top", "text-top", "bottom", "text-bottom",
  ].includes(lower) || /^upright=/.test(lower) || /^\d{2,4}px$/.test(lower) || /^x\d{2,4}px$/.test(lower) || /^alt\s*=/.test(lower) || /^link\s*=/.test(lower);
}

function mediaLinkToMarkdown(content) {
  const parts = splitTopLevel(afterNamespace(content));
  const fileName = parts.shift() || "";
  const url = commonsFileUrl(fileName);
  if (!url) return "";
  const options = { align: "", width: "", frame: false, border: false, caption: "", alt: "" };
  const captionCandidates = [];
  for (const rawPart of parts) {
    const part = wikiSyntaxToPlain(cleanInlineMarkup(rawPart, 2));
    const lower = part.toLowerCase();
    if (!part) continue;
    if (["thumb", "thumbnail", "frame", "framed"].includes(lower)) {
      options.frame = true;
      continue;
    }
    if (lower === "border") {
      options.border = true;
      continue;
    }
    if (["right", "left", "center", "centre", "none"].includes(lower)) {
      options.align = lower === "centre" || lower === "none" ? "center" : lower;
      continue;
    }
    if (/^\d{2,4}px$/i.test(part)) {
      options.width = part;
      continue;
    }
    if (/^alt\s*=/i.test(part)) {
      options.alt = part.replace(/^alt\s*=\s*/i, "").trim();
      continue;
    }
    if (!isImageOption(part)) captionCandidates.push(part);
  }
  options.caption = wikiSyntaxToPlain(captionCandidates.filter(Boolean).pop() || options.alt || fileName.replace(/\.[^.]+$/, ""));
  const attr = [];
  if (options.align) attr.push(`.${options.align}`);
  if (options.align === "left" || options.align === "right" || options.frame) attr.push(".wrap");
  if (options.frame) attr.push(".thumb");
  if (options.border) attr.push(".border");
  if (options.width) attr.push(`width=${options.width}`);
  const title = options.caption.replace(/["']/g, "").slice(0, 180);
  return `\n\n![${escapeMarkdown(options.caption)}](${url} "${escapeMarkdown(title)}")${attr.length ? `{${attr.join(" ")}}` : ""}\n\n`;
}

function collectMediaLinks(text) {
  const links = [];
  let index = 0;
  const source = String(text || "");
  while (index < source.length) {
    const start = source.indexOf("[[", index);
    if (start < 0) break;
    const end = findBalancedEnd(source, start, "[[", "]]");
    if (end < 0) break;
    const content = source.slice(start + 2, end - 2);
    if (MEDIA_NAMESPACES.has(namespaceOf(content))) {
      const fileName = splitTopLevel(afterNamespace(content))[0];
      links.push({ fileName, url: commonsFileUrl(fileName), markdown: mediaLinkToMarkdown(content) });
    }
    index = end;
  }
  return links.filter((item) => item.url);
}

function replaceMediaLinks(text, keepImages = true) {
  let output = "";
  let index = 0;
  const source = String(text || "");
  while (index < source.length) {
    const start = source.indexOf("[[", index);
    if (start < 0) {
      output += source.slice(index);
      break;
    }
    const end = findBalancedEnd(source, start, "[[", "]]");
    if (end < 0) {
      output += source.slice(index);
      break;
    }
    const content = source.slice(start + 2, end - 2);
    const ns = namespaceOf(content);
    output += source.slice(index, start);
    if (MEDIA_NAMESPACES.has(ns)) output += keepImages ? mediaLinkToMarkdown(content) : cleanInlineMarkup(splitTopLevel(afterNamespace(content)).pop() || "", 2);
    else if (CATEGORY_NAMESPACES.has(ns)) output += "";
    else output += source.slice(start, end);
    index = end;
  }
  return output;
}

function wikiLinkFromTitle(target, label = "") {
  const rawTarget = String(target || "").replace(/_/g, " ").trim();
  const baseTarget = rawTarget.split("#")[0].trim();
  const cleanLabel = cleanInlineMarkup(label || baseTarget || rawTarget, 2).trim();
  if (!rawTarget || !cleanLabel) return cleanLabel;
  const ns = namespaceOf(rawTarget);
  if (MEDIA_NAMESPACES.has(ns) || CATEGORY_NAMESPACES.has(ns)) return cleanLabel;
  if (/^(wikt|wiktionary|commons|meta|special|template|help|portal|talk|user):/i.test(rawTarget)) return cleanLabel;
  let slug = "";
  try {
    slug = pageTitleToSlug(baseTarget);
  } catch (_error) {
    return cleanLabel;
  }
  return cleanLabel === slug ? `[[${slug}]]` : `[[${slug}|${cleanLabel}]]`;
}

function convertLinks(text) {
  const tokens = [];
  const stash = (value) => {
    const token = `@@WIKISTLINK${tokens.length}@@`;
    tokens.push(value);
    return token;
  };
  let output = String(text || "")
    .replace(/\[\[Category:[^\]]+\]\]/gi, "")
    .replace(/\[\[分类:[^\]]+\]\]/gi, "")
    .replace(/\[\[分類:[^\]]+\]\]/gi, "")
    .replace(/\[\[([^|\]#]+)#[^|\]]+\|([^\]]+)\]\]/g, (_match, target, label) => stash(wikiLinkFromTitle(target, label)))
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_match, target, label) => stash(wikiLinkFromTitle(target, label)))
    .replace(/\[\[([^\]]+)\]\]/g, (_match, target) => stash(wikiLinkFromTitle(target, target)))
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, (_match, href, label) => stash(`[${label}](${href})`))
    .replace(/\[(https?:\/\/[^\s\]]+)\]/g, "$1");
  tokens.forEach((value, index) => {
    output = output.replace(`@@WIKISTLINK${index}@@`, value);
  });
  return output;
}

function cleanInlineMarkup(value, depth = 0) {
  let text = String(value || "");
  if (depth < 4) text = replaceTemplates(text, depth + 1);
  text = replaceMediaLinks(text, false);
  text = convertLinks(text);
  text = text
    .replace(/'''''([^']+)'''''/g, "**_$1_**")
    .replace(/'''([^']+)'''/g, "**$1**")
    .replace(/''([^']+)''/g, "*$1*")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, "");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function linksFromTemplateArgs(args) {
  return args
    .map((item) => cleanImportText(item, 160))
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => (item.includes("[[") ? cleanInlineMarkup(item, 2) : wikiLinkFromTitle(item, item.split("#")[0])))
    .join("、");
}

function templateTable(title, named) {
  const rows = Object.entries(named)
    .map(([key, value]) => [cleanInlineMarkup(key, 2), cleanInlineMarkup(value, 2)])
    .filter(([key, value]) => key && value && value.length <= 220 && !/^(image|image\d*|caption|align|style|class|width|name)$/i.test(key))
    .slice(0, 18);
  if (!rows.length) return "";
  const tableRows = rows.map(([key, value]) => `| ${escapeTableCell(key)} | ${escapeTableCell(value)} |`).join("\n");
  return `\n\n**${escapeTableCell(title)}**\n\n| 字段 | 内容 |\n| --- | --- |\n${tableRows}\n\n`;
}

function convertTemplate(content, depth = 0) {
  const parts = splitTopLevel(content);
  const rawName = (parts.shift() || "").replace(/^模板:/i, "").replace(/_/g, " ").trim();
  const name = rawName.toLowerCase();
  const positional = [];
  const named = {};
  for (const part of parts) {
    const [key, value] = splitKeyValue(part);
    if (key) named[key] = value;
    else positional.push(value);
  }
  const first = cleanInlineMarkup(positional[0] || "", depth + 1);
  const second = cleanInlineMarkup(positional[1] || "", depth + 1);
  if (!name) return "";
  if (/^(short description|good article|featured article|use dmy dates|use mdy dates|pp-|bots|toc limit|authority control|portal bar|commons category|spoken wikipedia|DEFAULTSORT)$/i.test(name)) return "";
  if (/^(cite|citation|sfn|harv|efn|refn|notelist|reflist|rp|cn|citation needed|failed verification)/i.test(name)) return "";
  if (/^(main|main article|主条目|主條目)$/i.test(name)) return positional.length ? `\n\n**主条目：** ${linksFromTemplateArgs(positional)}\n\n` : "";
  if (/^(see also|further|details|详见|參見|参见)$/i.test(name)) return positional.length ? `\n\n**参见：** ${linksFromTemplateArgs(positional)}\n\n` : "";
  if (/^(about|for|other uses|distinguish|redirect|hatnote)$/i.test(name)) {
    const note = positional.map((item) => cleanInlineMarkup(item, depth + 1)).filter(Boolean).join("；");
    return note ? `\n\n*${note}*\n\n` : "";
  }
  if (/^(lang|transl|transliteration|script)$/i.test(name)) return second || first;
  if (/^(nowrap|nobr|small|resize|mvar|var|em|strong|b|i|code|kbd|samp|visible anchor|not a typo)$/i.test(name)) return first;
  if (/^(math|mvar|chem|ce)$/i.test(name)) return first ? `$${first}$` : "";
  if (/^(frac|sfrac)$/i.test(name)) return positional.length >= 2 ? `${cleanInlineMarkup(positional[0], depth + 1)}/${cleanInlineMarkup(positional[1], depth + 1)}` : first;
  if (/^(sup|sub)$/i.test(name)) return first;
  if (/^(convert|cvt|val)$/i.test(name)) {
    return positional
      .filter((item) => !/^(abbr|disp|sigfig|lk|adj|sortable|sp|and|or)=/i.test(item))
      .slice(0, 3)
      .map((item) => cleanInlineMarkup(item, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  if (/^(url|official website)$/i.test(name)) return first ? `<${first}>` : "";
  if (/^(ill|interlanguage link|illm)$/i.test(name)) return second || first;
  if (/^(quote|blockquote|quotation)$/i.test(name)) return first ? `\n\n> ${first}\n\n` : "";
  if (/infobox|taxobox|speciesbox|virusbox|chembox|sidebar/.test(name)) return templateTable(rawName, named);
  if (Object.keys(named).length >= 6 && positional.length <= 2) return templateTable(rawName, named);
  return first || "";
}

function replaceTemplates(text, depth = 0) {
  if (depth > 6) return "";
  let output = "";
  let index = 0;
  const source = String(text || "");
  while (index < source.length) {
    const start = source.indexOf("{{", index);
    if (start < 0) {
      output += source.slice(index);
      break;
    }
    const end = findBalancedEnd(source, start, "{{", "}}");
    if (end < 0) {
      output += source.slice(index);
      break;
    }
    output += source.slice(index, start);
    const content = source.slice(start + 2, end - 2);
    output += convertTemplate(content, depth + 1);
    index = end;
  }
  return output;
}

function convertMath(text) {
  return String(text || "")
    .replace(/<math\s+display=["']?block["']?\s*>([\s\S]*?)<\/math>/gi, (_match, expr) => `\n$$\n${expr.trim()}\n$$\n`)
    .replace(/<math>([\s\S]*?)<\/math>/gi, (_match, expr) => `$${expr.trim()}$`);
}

function convertHeadings(line) {
  const match = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
  if (!match) return line;
  const level = Math.min(6, Math.max(2, match[1].length));
  return `${"#".repeat(level)} ${cleanInlineMarkup(match[2].trim(), 1)}`;
}

function splitWikiCells(value, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(value || "").split(new RegExp(`\\s*${escaped}\\s*`)).map((cell) => {
    const trimmed = cell.trim();
    const attrSplit = !trimmed.startsWith("[[") ? trimmed.match(/^[^|]*\|\s*([\s\S]+)$/) : null;
    return cleanInlineMarkup(attrSplit ? attrSplit[1] : trimmed, 1);
  }).filter(Boolean);
}

function convertWikiTable(block) {
  const rows = [];
  let caption = "";
  for (const rawLine of block) {
    const line = rawLine.trim();
    if (!line || line.startsWith("{|") || line.startsWith("|}") || line.startsWith("|-")) continue;
    if (line.startsWith("|+")) {
      caption = cleanInlineMarkup(line.slice(2), 1);
      continue;
    }
    if (line.startsWith("!")) rows.push({ header: true, cells: splitWikiCells(line.slice(1), "!!") });
    else if (line.startsWith("|")) rows.push({ header: false, cells: splitWikiCells(line.slice(1), "||") });
  }
  const usable = rows.filter((row) => row.cells.length);
  if (usable.length < 2) return caption ? `\n\n**${caption}**\n\n` : "\n\n*Wikipedia 表格已省略，建议在 Wikist 中重建为 Markdown 表格。*\n\n";
  const maxCols = Math.min(6, Math.max(...usable.map((row) => row.cells.length)));
  let header = usable.find((row) => row.header)?.cells.slice(0, maxCols);
  let bodyRows = usable.filter((row) => row !== usable.find((item) => item.header)).slice(0, 14);
  if (!header || header.length < 2) {
    header = Array.from({ length: maxCols }, (_item, index) => `列 ${index + 1}`);
    bodyRows = usable.slice(0, 14);
  }
  const normalized = (cells) => Array.from({ length: maxCols }, (_item, index) => escapeTableCell(cells[index] || ""));
  const table = [
    `| ${normalized(header).join(" | ")} |`,
    `| ${Array.from({ length: maxCols }, () => "---").join(" | ")} |`,
    ...bodyRows.map((row) => `| ${normalized(row.cells).join(" | ")} |`),
  ].join("\n");
  const note = usable.length > bodyRows.length + 1 ? "\n\n*表格较长，导入时已截取前若干行；完整数据建议按原页面复核。*" : "";
  return `\n\n${caption ? `**${caption}**\n\n` : ""}${table}${note}\n\n`;
}

function convertWikitextToMarkdown(source, options = {}) {
  const images = collectMediaLinks(source);
  let text = String(source || "").slice(0, MAX_IMPORT_BODY).replace(/\r\n/g, "\n");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref\b[^/>]*\/>/gi, "");
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = text.replace(/<gallery\b[^>]*>[\s\S]*?<\/gallery>/gi, "");
  text = convertMath(text);
  text = replaceMediaLinks(text, true);
  text = replaceTemplates(text);
  text = convertLinks(text);
  text = text
    .replace(/'''''([^']+)'''''/g, "**_$1_**")
    .replace(/'''([^']+)'''/g, "**$1**")
    .replace(/''([^']+)''/g, "*$1*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "");
  text = decodeEntities(text);

  const lines = [];
  const sourceLines = text.split("\n");
  for (let index = 0; index < sourceLines.length; index += 1) {
    const rawLine = sourceLines[index];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }
    if (trimmed.startsWith("{|")) {
      const block = [rawLine];
      index += 1;
      while (index < sourceLines.length) {
        block.push(sourceLines[index]);
        if (sourceLines[index].trim().startsWith("|}")) break;
        index += 1;
      }
      lines.push(convertWikiTable(block));
      continue;
    }
    if (/^(__TOC__|__NOTOC__|__NOINDEX__|__INDEX__)$/i.test(trimmed)) continue;
    if (/^\[\[(Category|分类|分類|File|Image|文件|图片|檔案):/i.test(trimmed)) continue;
    if (/^[^[]+\]\]\s*$/.test(trimmed)) continue;
    if (/^[:]{2,}\s*\S/.test(trimmed)) {
      lines.push(`- ${cleanInlineMarkup(trimmed.replace(/^:+\s*/, ""), 1)}`);
      continue;
    }
    if (/^;\s*/.test(trimmed)) {
      const definition = trimmed.replace(/^;\s*/, "");
      const [term, body] = definition.split(/\s*:\s+/, 2);
      lines.push(body ? `**${cleanInlineMarkup(term, 1)}**：${cleanInlineMarkup(body, 1)}` : `**${cleanInlineMarkup(term, 1)}**`);
      continue;
    }
    const unordered = trimmed.match(/^(\*+)\s+(.+)$/);
    if (unordered) {
      lines.push(`${"  ".repeat(Math.max(0, unordered[1].length - 1))}- ${cleanInlineMarkup(unordered[2], 1)}`);
      continue;
    }
    const ordered = trimmed.match(/^(#+)\s*(.+)$/);
    if (ordered) {
      lines.push(`${"  ".repeat(Math.max(0, ordered[1].length - 1))}1. ${cleanInlineMarkup(ordered[2], 1)}`);
      continue;
    }
    lines.push(convertHeadings(rawLine).replace(/^[:;]\s+/, ""));
  }

  const body = lines.join("\n")
    .replace(/^:{3,}(\S.*)$/gm, "- $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const attribution = options.sourceUrl
    ? `\n\n---\n\n*本词条初稿导入自 [Wikipedia](${options.sourceUrl})，遵循原页面许可协议；已转换为 Wikist Markdown，建议继续人工校订。*`
    : "";
  return { body: `${body}${attribution}`.trim(), images };
}

function wikitextToMarkdown(source, options = {}) {
  return convertWikitextToMarkdown(source, options).body;
}

function summaryFromBody(body, fallback = "") {
  const cleanFallback = cleanImportText(fallback, 220);
  const fallbackLooksLikeHatnote = /disambiguation|other uses|^the type of/i.test(cleanFallback);
  if (cleanFallback.length >= 30 && !fallbackLooksLikeHatnote) return cleanFallback;
  const paragraph = String(body || "")
    .split(/\n{2,}/)
    .map((raw) => ({
      raw,
      text: raw
      .replace(/^#+\s+.+$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]+\)(?:\{[^}]+\})?/g, "")
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`>#|-]/g, "")
      .trim(),
    }))
    .find(({ raw, text }) => {
      const trimmed = raw.trim();
      if (text.length <= 40) return false;
      if (/^\*[\s\S]+\*$/.test(trimmed)) return false;
      if (/^\*\*[^*]*(box|infobox|sidebar|taxobox|virusbox)\*\*/i.test(trimmed)) return false;
      if (/\n\|.+\|/.test(raw) || /\| ---/.test(raw)) return false;
      return true;
    })?.text;
  return cleanImportText(paragraph || cleanFallback, 220);
}

function categoriesFromWikitext(source) {
  const categories = [];
  String(source || "").replace(/\[\[(?:Category|分类|分類):([^\]|]+)(?:\|[^\]]*)?\]\]/gi, (_match, category) => {
    categories.push(category.trim());
    return _match;
  });
  return [...new Set(categories)].slice(0, 12);
}

async function fetchWikipediaPage(input = {}) {
  const lang = cleanWikipediaLang(input.lang);
  const title = cleanImportText(input.title, 240);
  if (!title) throw new Error("Wikipedia 词条标题不能为空。");
  const host = wikipediaHost(lang);
  const projectLang = wikipediaProjectLang(lang);
  let payload;
  try {
    payload = await fetchWikimediaCorePage(projectLang, title);
  } catch (error) {
    const convertedTitle = projectLang === "zh" ? simplifiedTitleToTraditional(title) : title;
    if (error.statusCode !== 404 || convertedTitle === title) throw error;
    payload = await fetchWikimediaCorePage(projectLang, convertedTitle, 404);
  }
  if (!payload.source) throw new Error("Wikipedia 返回内容不包含 wikitext source。");
  const redirect = String(payload.source || "").match(/^#REDIRECT\s+\[\[([^\]]+)\]\]/i) || String(payload.source || "").match(/^#重定向\s+\[\[([^\]]+)\]\]/i);
  if (redirect?.[1]) {
    payload = await fetchWikimediaCorePage(projectLang, redirect[1].split("|")[0].trim(), 404);
  }
  if (!payload.source) throw new Error("Wikipedia 返回内容不包含 wikitext source。");
  const sourceUrl = `https://${host}/wiki/${encodeURIComponent(payload.key || title.replace(/\s+/g, "_"))}`;
  const converted = convertWikitextToMarkdown(payload.source, { sourceUrl });
  const pageTitle = payload.title || title;
  const heroImage = input.heroImage || payload.thumbnail?.url || converted.images[0]?.url || "";
  const citationId = `wikipedia-${String(payload.key || pageTitle).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || "source"}`;
  const importedBody = `${converted.body.trim()}\n\n---\n\nImported source: [@${citationId}]`;
  return {
    slug: normalizeSlug(input.slug || pageTitleToSlug(pageTitle)),
    title: pageTitle,
    summary: summaryFromBody(converted.body, payload.description || ""),
    categories: categoriesFromWikitext(payload.source),
    difficulty: input.difficulty || "未分级",
    status: input.status || "review",
    quality: input.quality || "Draft",
    author: input.author || "Wikipedia contributors / Wikist Importer",
    heroImage,
    body: importedBody,
    importSource: "wikipedia",
    importTitle: payload.key || pageTitle,
    importLang: lang,
    importRevision: payload.latest?.id ? String(payload.latest.id) : "",
    importUrl: sourceUrl,
    importFetchedAt: new Date().toISOString(),
    importLicense: payload.license?.title || "CC BY-SA",
    references: [{
      id: citationId,
      type: "web",
      authors: ["Wikipedia contributors"],
      title: pageTitle,
      containerTitle: "Wikipedia",
      year: String(new Date().getUTCFullYear()),
      url: sourceUrl,
      accessed: new Date().toISOString().slice(0, 10),
      note: `Imported revision ${payload.latest?.id || ""}`.trim(),
    }],
  };
}

function parseWikistImport(input = {}) {
  const format = String(input.format || "json").toLowerCase();
  if (format === "markdown") {
    return {
      slug: normalizeSlug(input.slug || input.title || "imported-page"),
      title: cleanImportText(input.title || input.slug || "导入词条", 120),
      summary: cleanImportText(input.summary || "", 220),
      categories: Array.isArray(input.categories) ? input.categories : String(input.categories || "").split(",").map((item) => item.trim()).filter(Boolean),
      difficulty: input.difficulty || "未分级",
      status: input.status || "review",
      quality: input.quality || "Draft",
      author: input.author || "Wikist Importer",
      heroImage: input.heroImage || input.hero_image || "",
      references: Array.isArray(input.references) ? input.references : [],
      body: String(input.content || input.body || "").slice(0, MAX_IMPORT_BODY),
    };
  }
  const packageData = input.package && typeof input.package === "object"
    ? input.package
    : JSON.parse(String(input.content || "{}"));
  const page = packageData.page || packageData;
  if (!page || typeof page !== "object") throw new Error("导入 JSON 缺少 page 对象。");
  return {
    ...page,
    slug: normalizeSlug(input.slug || page.slug || page.title || "imported-page"),
    title: cleanImportText(page.title || input.title || page.slug, 120),
    body: String(page.body || page.content || "").slice(0, MAX_IMPORT_BODY),
  };
}

module.exports = {
  fetchWikipediaPage,
  parseWikistImport,
  wikitextToMarkdown,
};
