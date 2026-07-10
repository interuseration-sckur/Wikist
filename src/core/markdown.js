const { applyMagicWords, pluginSettings, renderPluginBlock, renderPluginFence } = require("./plugin-registry");
const { slugToId } = require("./slug");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(href) {
  const value = String(href || "").trim();
  if (/^(https?:|mailto:|#\/|#|\/)/i.test(value)) return value.replace(/"/g, "%22");
  return "#";
}

function sanitizeSrc(src) {
  const value = String(src || "").trim();
  if (/^(https?:\/\/|data:image\/|\/|\.\/)/i.test(value)) return value.replace(/"/g, "%22");
  return "";
}

function sanitizeCssSize(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{2,4}$/.test(text)) return `${text}px`;
  if (/^\d{1,4}(\.\d+)?(px|%|rem|em|ch|vw)$/i.test(text)) return text;
  return "";
}

function splitPipes(value) {
  const parts = [];
  let current = "";
  let escaped = false;
  for (const char of String(value || "")) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

function parseAttrSpec(spec = "") {
  const attrs = { id: "", classes: [], values: {} };
  const raw = String(spec || "").trim().replace(/^\{/, "").replace(/\}$/, "");
  for (const token of raw.split(/\s+/).filter(Boolean)) {
    if (/^#[\w-]+$/.test(token)) attrs.id = token.slice(1);
    else if (/^\.[\w-]+$/.test(token)) attrs.classes.push(token.slice(1));
    else {
      const pair = token.match(/^([\w-]+)=(.+)$/);
      if (pair) attrs.values[pair[1]] = pair[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return attrs;
}

function splitTrailingAttrs(value) {
  const match = String(value || "").match(/\s+\{([^{}]+)\}\s*$/);
  if (!match) return { text: String(value || ""), attrs: parseAttrSpec() };
  return {
    text: String(value || "").slice(0, match.index).trim(),
    attrs: parseAttrSpec(match[0].trim()),
  };
}

function attrsToHtml(attrs, extraClass = "") {
  const classes = [...(attrs.classes || [])];
  if (extraClass) classes.unshift(extraClass);
  const parts = [];
  if (attrs.id) parts.push(`id="${escapeHtml(attrs.id)}"`);
  if (classes.length) parts.push(`class="${escapeHtml(classes.join(" "))}"`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function parseImageOptions(parts, defaults = {}) {
  const options = {
    align: defaults.align || "center",
    width: defaults.width || "",
    alt: defaults.alt || "",
    caption: defaults.caption || "",
    link: "",
    wrap: false,
    frame: false,
    border: false,
    inline: Boolean(defaults.inline),
    classes: [],
  };
  let explicitAlign = Boolean(defaults.align);
  for (const raw of parts) {
    const item = String(raw || "").trim();
    if (!item) continue;
    const lower = item.toLowerCase();
    if (["left", "right", "center", "wide", "full", "inline"].includes(lower)) {
      options.align = lower;
      options.inline = lower === "inline";
      explicitAlign = true;
      if (lower === "left" || lower === "right") options.wrap = true;
      continue;
    }
    if (["wrap", "around", "float"].includes(lower)) { options.wrap = true; continue; }
    if (["nowrap", "no-wrap", "block"].includes(lower)) { options.wrap = false; continue; }
    if (["thumb", "thumbnail", "frame", "framed"].includes(lower)) { options.frame = true; continue; }
    if (lower === "border") { options.border = true; continue; }
    if (/^\d{2,4}(px)?$/i.test(lower) || /^width\s*=/.test(lower)) {
      options.width = sanitizeCssSize(item.replace(/^width\s*=\s*/i, ""));
      continue;
    }
    if (/^alt\s*=/.test(lower)) { options.alt = item.replace(/^alt\s*=\s*/i, ""); continue; }
    if (/^caption\s*=/.test(lower)) { options.caption = item.replace(/^caption\s*=\s*/i, ""); continue; }
    if (/^link\s*=/.test(lower)) { options.link = item.replace(/^link\s*=\s*/i, ""); continue; }
    if (/^class\s*=/.test(lower)) {
      options.classes.push(...item.replace(/^class\s*=\s*/i, "").split(/\s+/).filter((name) => /^[\w-]+$/.test(name)));
      continue;
    }
    options.caption = item;
  }
  if (options.frame && !explicitAlign) {
    options.align = "right";
    options.wrap = true;
  }
  if (options.align === "wide" || options.align === "full" || options.align === "center") options.wrap = false;
  return options;
}

function imageClasses(options) {
  const classes = ["wiki-image", `wiki-image-${options.align || "center"}`];
  if (options.wrap) classes.push("wiki-image-wrap");
  if (options.frame) classes.push("wiki-image-frame");
  if (options.border) classes.push("wiki-image-border");
  if (options.inline) classes.push("wiki-image-inline");
  classes.push(...(options.classes || []));
  return classes.filter(Boolean).join(" ");
}

function markdownFeatureEnabled(context = {}, pluginId = "markdownAdvanced") {
  const settings = pluginSettings(context.config || {});
  if (settings.markdownAdvanced?.enabled === false) return false;
  return settings[pluginId]?.enabled === true;
}
function renderImageFigure(src, options = {}) {
  const cleanSrc = sanitizeSrc(src);
  if (!cleanSrc) return escapeHtml(src || "");
  const alt = escapeHtml(options.alt || options.caption || "");
  const width = sanitizeCssSize(options.width);
  const style = width ? ` style="--wiki-image-width:${escapeHtml(width)}"` : "";
  const captionText = escapeHtml(options.caption || options.alt || "");
  const viewerAttrs = ` data-wiki-image-src="${escapeHtml(cleanSrc)}" data-wiki-image-alt="${alt}" data-wiki-image-caption="${captionText}"`;
  const img = `<img src="${escapeHtml(cleanSrc)}" alt="${alt}" loading="lazy" decoding="async" data-wiki-image-trigger="true" />`;
  const content = options.link ? `<a href="${sanitizeHref(options.link)}">${img}</a>` : img;
  if (options.inline) return `<span class="${escapeHtml(imageClasses(options))}"${style}${viewerAttrs}>${content}</span>`;
  const caption = options.caption ? `<figcaption>${renderInline(options.caption)}</figcaption>` : "";
  return `<figure class="${escapeHtml(imageClasses(options))}"${style}${viewerAttrs}>${content}${caption}</figure>`;
}

function parseMediaWikiImage(source, inline = false) {
  const match = String(source || "").trim().match(/^\[\[(?:File|Image|文件|图片):([\s\S]+)\]\]$/i);
  if (!match) return null;
  const parts = splitPipes(match[1]);
  const src = parts.shift();
  const options = parseImageOptions(parts, { inline });
  return renderImageFigure(src, options);
}

function parseMarkdownImage(source, inline = false) {
  const match = String(source || "").trim().match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']+)["'])?\)\s*(\{[^{}]+\})?$/);
  if (!match) return null;
  const attrs = parseAttrSpec(match[4] || "");
  const options = parseImageOptions([], {
    inline,
    alt: match[1],
    caption: match[3] || "",
    width: attrs.values.width || "",
  });
  for (const cls of attrs.classes) {
    if (["left", "right", "center", "wide", "full", "inline"].includes(cls)) {
      options.align = cls;
      options.inline = cls === "inline";
      if (cls === "left" || cls === "right") options.wrap = true;
    } else if (cls === "wrap") {
      options.wrap = true;
    } else if (cls === "thumb" || cls === "frame") {
      options.frame = true;
    } else if (cls === "border") {
      options.border = true;
    } else {
      options.classes.push(cls);
    }
  }
  if (attrs.values.alt) options.alt = attrs.values.alt;
  if (attrs.values.caption) options.caption = attrs.values.caption;
  if (attrs.values.link) options.link = attrs.values.link;
  return renderImageFigure(match[2], options);
}

function createRuntime(footnotes = new Map()) {
  return { footnotes, footnoteNumbers: new Map(), footnoteOrder: [] };
}

function footnoteRefHtml(id, runtime) {
  if (!runtime?.footnotes?.has(id)) return "";
  if (!runtime.footnoteNumbers.has(id)) {
    runtime.footnoteNumbers.set(id, runtime.footnoteOrder.length + 1);
    runtime.footnoteOrder.push(id);
  }
  const number = runtime.footnoteNumbers.get(id);
  const safeId = slugToId(id);
  return `<sup id="fnref-${safeId}" class="footnote-ref"><a href="#fn-${safeId}" data-wikist-scroll="fn-${safeId}">${number}</a></sup>`;
}

function renderInline(source, runtime = createRuntime()) {
  const tokens = [];
  const stash = (html) => {
    const token = `@@HTML${tokens.length}@@`;
    tokens.push(html);
    return token;
  };
  let text = String(source || "");

  text = text.replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[\[(?:File|Image|文件|图片):[^\]]+\]\]/gi, (match) => stash(parseMediaWikiImage(match, true) || escapeHtml(match)));
  text = text.replace(/!\[[^\]]*\]\([^\n]+?\)(?:\s*\{[^{}]+\})?/g, (match) => stash(parseMarkdownImage(match, true) || escapeHtml(match)));
  text = text.replace(/\[\^([^\]]+)\]/g, (match, id) => {
    const html = footnoteRefHtml(id.trim(), runtime);
    return html ? stash(html) : match;
  });
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, slug, label) => {
    return stash(`<a href="#/page/${encodeURIComponent(slug.trim())}" class="wiki-link">${escapeHtml(label.trim())}</a>`);
  });
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_match, slug) => {
    const label = slug.trim();
    return stash(`<a href="#/page/${encodeURIComponent(label)}" class="wiki-link">${escapeHtml(label)}</a>`);
  });
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    return stash(`<a href="${sanitizeHref(href)}" rel="noreferrer">${escapeHtml(label)}</a>`);
  });
  text = text.replace(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/g, (_match, href) => stash(`<a href="${sanitizeHref(href)}" rel="noreferrer">${escapeHtml(href)}</a>`));

  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  text = text.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  text = text.replace(/\^([^\^\s][^\^]*?)\^/g, "<sup>$1</sup>");
  text = text.replace(/(^|[^~])~([^~\s][^~]*?)~(?!~)/g, "$1<sub>$2</sub>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");
  text = text.replace(/(^|\s)((?:https?:\/\/)[^\s<]+)/g, (_match, prefix, href) => `${prefix}<a href="${sanitizeHref(href)}" rel="noreferrer">${escapeHtml(href)}</a>`);

  for (let index = 0; index < tokens.length; index += 1) {
    text = text.replace(`@@HTML${index}@@`, tokens[index]);
  }
  return text;
}

function renderTable(lines, runtime) {
  const rows = lines
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1);
  if (rows.length < 2) return null;
  const header = rows[0];
  const align = rows[1];
  if (!align.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const alignStyle = (cell) => {
    if (/^:-+:$/.test(cell)) return ' style="text-align:center"';
    if (/-+:$/.test(cell)) return ' style="text-align:right"';
    if (/^:-+/.test(cell)) return ' style="text-align:left"';
    return "";
  };
  const bodyRows = rows.slice(2);
  const headHtml = header.map((cell, index) => `<th${alignStyle(align[index] || "")}>${renderInline(cell, runtime)}</th>`).join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((cell, index) => `<td${alignStyle(align[index] || "")}>${renderInline(cell, runtime)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-scroll"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function flushParagraph(buffer, html, runtime) {
  if (!buffer.length) return;
  html.push(`<p>${renderInline(buffer.join(" "), runtime)}</p>`);
  buffer.length = 0;
}

function collectBlock(lines, start, matcher) {
  const block = [];
  let index = start;
  while (index < lines.length && matcher(lines[index])) {
    block.push(lines[index]);
    index += 1;
  }
  return { block, next: index };
}

function extractFootnotes(lines) {
  const output = [];
  const footnotes = new Map();
  let index = 0;
  while (index < lines.length) {
    const match = lines[index].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (!match) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const id = match[1].trim();
    const body = [match[2].trim()];
    index += 1;
    while (index < lines.length && /^( {2,}|\t)/.test(lines[index])) {
      body.push(lines[index].trim());
      index += 1;
    }
    footnotes.set(id, body.join(" "));
  }
  return { lines: output, footnotes };
}

function renderFootnotes(runtime) {
  if (!runtime.footnoteOrder.length) return "";
  const items = runtime.footnoteOrder.map((id) => {
    const safeId = slugToId(id);
    const number = runtime.footnoteNumbers.get(id);
    const body = runtime.footnotes.get(id) || "";
    return `<li id="fn-${safeId}">${renderInline(body, runtime)} <a class="footnote-backref" href="#fnref-${safeId}" data-wikist-scroll="fnref-${safeId}" aria-label="返回正文">↩</a></li>`;
  }).join("");
  return `<section class="footnotes"><h2>注释</h2><ol>${items}</ol></section>`;
}

function renderList(block, ordered, runtime, options = {}) {
  let taskList = false;
  const items = block.map((item) => {
    const text = item.trim().replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, "");
    const task = text.match(/^\[([ xX])\]\s+(.+)$/);
    if (task && !ordered && options.taskLists) {
      taskList = true;
      const checked = task[1].toLowerCase() === "x";
      return `<li class="task-list-item"><input type="checkbox" disabled ${checked ? "checked" : ""} />${renderInline(task[2], runtime)}</li>`;
    }
    return `<li>${renderInline(text, runtime)}</li>`;
  }).join("");
  const tag = ordered ? "ol" : "ul";
  const cls = taskList ? ' class="task-list"' : "";
  return `<${tag}${cls}>${items}</${tag}>`;
}

function renderDefinitionList(lines, start, runtime) {
  if (start + 1 >= lines.length || !/^:\s+/.test(lines[start + 1].trim())) return null;
  const terms = [];
  let index = start;
  while (index < lines.length) {
    const term = lines[index].trim();
    if (!term || /^:\s+/.test(term)) break;
    const defs = [];
    let cursor = index + 1;
    while (cursor < lines.length && /^:\s+/.test(lines[cursor].trim())) {
      defs.push(lines[cursor].trim().replace(/^:\s+/, ""));
      cursor += 1;
    }
    if (!defs.length) break;
    terms.push({ term, defs });
    index = cursor;
    if (index >= lines.length || !lines[index].trim() || index + 1 >= lines.length || !/^:\s+/.test(lines[index + 1].trim())) break;
  }
  if (!terms.length) return null;
  const html = terms.map((entry) => `<dt>${renderInline(entry.term, runtime)}</dt>${entry.defs.map((def) => `<dd>${renderInline(def, runtime)}</dd>`).join("")}`).join("");
  return { html: `<dl class="definition-list">${html}</dl>`, next: index };
}

function matchColonFence(line) {
  const match = String(line || "").trim().match(/^(:{3,})\s*([\w-]+)\b\s*(.*)$/);
  if (!match) return null;
  return { marker: match[1], name: match[2], meta: match[3] || "" };
}

function isColonFenceClose(line, marker) {
  const size = Math.max(3, String(marker || ":::").length);
  return new RegExp(`^:{${size},}\\s*$`).test(String(line || "").trim());
}
function renderContainer(lines, start, context, runtime) {
  const trimmed = lines[start].trim();
  const fence = matchColonFence(trimmed);
  if (!fence) return null;
  const kind = fence.name.toLowerCase();
  const supported = new Set(["theorem", "definition", "example", "proof", "note", "warning", "tip", "danger", "info"]);
  const isSupported = supported.has(kind);
  if (!markdownFeatureEnabled(context, "upstreamContainer")) return null;
  const title = fence.meta.trim() || kind;
  const body = [];
  let index = start + 1;
  while (index < lines.length && !isColonFenceClose(lines[index], fence.marker)) {
    body.push(lines[index]);
    index += 1;
  }
  if (index < lines.length) index += 1;
  const renderedBody = renderMarkdown(body.join("\n"), { ...context, nested: true }).html;
  if (!isSupported) {
    const safeKind = slugToId(kind);
    return {
      html: `<div class="wikist-container wikist-container-${escapeHtml(safeKind)}"><div class="wikist-container-label">${escapeHtml(title)}</div>${renderedBody}</div>`,
      next: index,
    };
  }
  return {
    html: `<aside class="math-note math-note-${escapeHtml(kind)}"><div class="math-note-label">${escapeHtml(title)}</div>${renderedBody}</aside>`,
    next: index,
  };
}

function renderMarkdown(source, context = {}) {
  const preparedSource = applyMagicWords(source, context, context.config?.plugins?.magicWords);
  const preparedLines = String(preparedSource || "").replace(/\r\n/g, "\n").split("\n");
  const footnotesEnabled = markdownFeatureEnabled(context, "upstreamFootnote");
  const extracted = footnotesEnabled ? extractFootnotes(preparedLines) : { lines: preparedLines, footnotes: new Map() };
  const lines = extracted.lines;
  const runtime = createRuntime(extracted.footnotes);
  const html = [];
  const toc = [];
  const paragraph = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraph, html, runtime);
      index += 1;
      continue;
    }

    const pluginBlock = renderPluginBlock(lines, index, context);
    if (pluginBlock) {
      flushParagraph(paragraph, html, runtime);
      if (pluginBlock.html) html.push(pluginBlock.html);
      index = pluginBlock.next;
      continue;
    }

    const container = renderContainer(lines, index, context, runtime);
    if (container) {
      flushParagraph(paragraph, html, runtime);
      html.push(container.html);
      index = container.next;
      continue;
    }

    const mediaImage = parseMediaWikiImage(trimmed, false);
    const markdownImage = parseMarkdownImage(trimmed, false);
    if (mediaImage || markdownImage) {
      flushParagraph(paragraph, html, runtime);
      html.push(mediaImage || markdownImage);
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^(```|~~~)\s*(.*)$/);
    if (fence) {
      flushParagraph(paragraph, html, runtime);
      const marker = fence[1];
      const lang = fence[2].trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pluginHtml = renderPluginFence(lang, code, context);
      html.push(pluginHtml === null ? `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code.join("\n"))}</code></pre>` : pluginHtml);
      continue;
    }

    if (trimmed === "$$") {
      flushParagraph(paragraph, html, runtime);
      const math = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "$$") {
        math.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<div class="math-block">$$\n${escapeHtml(math.join("\n"))}\n$$</div>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(paragraph, html, runtime);
      html.push("<hr />");
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(paragraph, html, runtime);
      const level = heading[1].length;
      const parsed = markdownFeatureEnabled(context, "upstreamAttrs") ? splitTrailingAttrs(heading[2].trim()) : { text: heading[2].trim(), attrs: parseAttrSpec() };
      const title = parsed.text;
      const id = parsed.attrs.id || slugToId(title);
      toc.push({ level, title, id });
      html.push(`<h${level}${attrsToHtml({ ...parsed.attrs, id })}>${renderInline(title, runtime)}</h${level}>`);
      index += 1;
      continue;
    }

    const definitionList = markdownFeatureEnabled(context, "upstreamDeflist") ? renderDefinitionList(lines, index, runtime) : null;
    if (definitionList) {
      flushParagraph(paragraph, html, runtime);
      html.push(definitionList.html);
      index = definitionList.next;
      continue;
    }

    if (/^\|.+\|$/.test(trimmed)) {
      flushParagraph(paragraph, html, runtime);
      const { block, next } = collectBlock(lines, index, (item) => /^\|.+\|$/.test(item.trim()));
      const table = renderTable(block, runtime);
      if (table) {
        html.push(table);
        index = next;
        continue;
      }
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph(paragraph, html, runtime);
      const { block, next } = collectBlock(lines, index, (item) => /^>\s?/.test(item.trim()));
      const quote = block.map((item) => item.replace(/^>\s?/, "")).join("\n");
      html.push(`<blockquote>${renderMarkdown(quote, { ...context, nested: true }).html}</blockquote>`);
      index = next;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph(paragraph, html, runtime);
      const { block, next } = collectBlock(lines, index, (item) => /^[-*+]\s+/.test(item.trim()));
      html.push(renderList(block, false, runtime, { taskLists: markdownFeatureEnabled(context, "upstreamTaskLists") }));
      index = next;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(paragraph, html, runtime);
      const { block, next } = collectBlock(lines, index, (item) => /^\d+\.\s+/.test(item.trim()));
      html.push(renderList(block, true, runtime));
      index = next;
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph(paragraph, html, runtime);
  if (!context.nested) {
    const footnotes = renderFootnotes(runtime);
    if (footnotes) html.push(footnotes);
  }

  return { html: html.join("\n"), toc };
}

module.exports = {
  escapeHtml,
  renderInline,
  renderMarkdown,
};