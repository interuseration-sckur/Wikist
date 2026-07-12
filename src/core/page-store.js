const fs = require("fs");
const path = require("path");
const { parseFrontMatter, serializeFrontMatter } = require("./frontmatter");
const { normalizeReferences, referenceQuality } = require("./citations");
const { renderMarkdown } = require("./markdown");
const { revisionIdFromDate } = require("./revision-review");
const { fileNameToSlug, normalizeSlug, slugToFileName } = require("./slug");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeDisambiguationTargets(value) {
  const seen = new Set();
  const targets = [];
  for (const rawItem of toStringList(value)) {
    const [rawSlug, rawLabel = "", rawSummary = ""] = rawItem.split("|");
    const slug = String(rawSlug || "").trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    targets.push({
      slug,
      label: String(rawLabel || "").trim() || slug,
      summary: String(rawSummary || "").trim(),
    });
  }
  return targets.slice(0, 24);
}

function disambiguationTargetStorage(value) {
  return normalizeDisambiguationTargets(value).map((target) => `${target.slug}|${target.label}|${target.summary}`);
}

function normalizeSlugList(value, limit = 40) {
  const seen = new Set();
  const output = [];
  for (const item of toStringList(value)) {
    try {
      const slug = normalizeSlug(item);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      output.push(slug);
    } catch (_error) {}
  }
  return output.slice(0, limit);
}

function normalizeTextList(value, limit = 40, maxLength = 160) {
  return [...new Set(toStringList(value).map((item) => item.slice(0, maxLength)).filter(Boolean))].slice(0, limit);
}

function normalizeNotation(value) {
  const values = Array.isArray(value) ? value : toStringList(value);
  const seen = new Set();
  return values.map((item) => {
    const raw = item && typeof item === "object"
      ? { symbol: String(item.symbol || ""), meaning: String(item.meaning || ""), scope: String(item.scope || "") }
      : (() => {
        const [symbol, meaning = "", scope = ""] = String(item || "").split("|");
        return { symbol, meaning, scope };
      })();
    return {
      symbol: String(raw.symbol || "").trim().slice(0, 80),
      meaning: String(raw.meaning || "").trim().slice(0, 140),
      scope: String(raw.scope || "").trim().slice(0, 80),
    };
  }).filter((item) => item.symbol && !seen.has(item.symbol) && (seen.add(item.symbol) || true)).slice(0, 48);
}

function notationStorage(value) {
  return normalizeNotation(value).map((item) => [item.symbol, item.meaning, item.scope].join("|"));
}

function normalizeTopic(value) {
  return String(value || "").trim().replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "").slice(0, 180);
}

function lightweightCitationStats(body, references) {
  const referenceList = Array.isArray(references) ? references : [];
  const known = new Set(referenceList.map((reference) => reference.id));
  const cited = new Set();
  const unresolved = new Set();
  for (const group of String(body || "").matchAll(/\[([^\]\n]*@[a-z0-9][a-z0-9._:-]*[^\]\n]*)\]/gi)) {
    for (const match of group[1].matchAll(/@([a-z0-9][a-z0-9._:-]*)/gi)) {
      const id = String(match[1] || "").toLowerCase();
      if (known.has(id)) cited.add(id);
      else unresolved.add(id);
    }
  }
  const qualities = referenceList.map((reference) => ({ id: reference.id, ...referenceQuality(reference) }));
  const complete = qualities.filter((item) => !item.issues.length).length;
  const total = referenceList.length;
  return {
    total,
    cited: cited.size,
    uncited: Math.max(0, total - cited.size),
    verifiable: qualities.filter((item) => item.verifiable).length,
    complete,
    completeness: total ? Math.round((complete / total) * 100) : 0,
    qualityScore: total ? Math.round(qualities.reduce((sum, item) => sum + item.score, 0) / total) : 0,
    unresolved: [...unresolved],
    citationNeeded: (String(body || "").match(/\{\{(?:cite-needed|citation needed)(?:\|[^}]*)?\}\}/gi) || []).length,
    issues: qualities.filter((item) => item.issues.length).map((item) => ({ id: item.id, issues: item.issues, score: item.score })),
  };
}

function walkMarkdownFiles(rootDir, currentDir = rootDir, results = []) {
  if (!fs.existsSync(currentDir)) return results;

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(rootDir, fullPath, results);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

class PageStore {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.pagesDir = path.join(rootDir, "content", "pages");
    this.revisionsDir = path.join(rootDir, "content", "revisions");
    this.reviewedDir = path.join(rootDir, "content", "reviewed");
    this.deletedDir = path.join(rootDir, "content", "deleted");
    this.cache = new Map();
    this.summaryCache = new Map();
    this.searchSourceCache = new Map();
    this.summarySnapshot = [];
    this.summaryExpiresAt = 0;
    this.catalogTtlMs = Math.max(500, Number(options.catalogTtlMs) || 5000);
    this.pageStatTtlMs = Math.max(100, Number(options.pageStatTtlMs) || 1000);
    this.changeListeners = new Set();
    this.config = options;
    this.hiddenPages = new Set((options.hiddenPages || []).map((slug) => normalizeSlug(slug)));
    ensureDir(this.pagesDir);
    ensureDir(this.revisionsDir);
    ensureDir(this.reviewedDir);
    ensureDir(this.deletedDir);
  }

  clearCache() {
    this.cache.clear();
    this.summaryCache.clear();
    this.searchSourceCache.clear();
    this.summarySnapshot = [];
    this.summaryExpiresAt = 0;
  }

  onChange(listener) {
    if (typeof listener !== "function") return () => {};
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  emitChange(type, page) {
    this.summaryExpiresAt = 0;
    if (page?.slug) this.searchSourceCache.delete(page.slug);
    if (type === "delete" && page?.slug) this.summaryCache.delete(page.slug);
    for (const listener of this.changeListeners) {
      try { listener({ type, page }); } catch (_error) {}
    }
  }

  pagePath(slug) {
    return path.join(this.pagesDir, slugToFileName(slug));
  }

  revisionDir(slug) {
    return path.join(this.revisionsDir, normalizeSlug(slug));
  }

  reviewedPath(slug, revisionId) {
    const id = String(revisionId || "").replace(/[^0-9TZ-]/g, "");
    if (!id) return "";
    return path.join(this.reviewedDir, normalizeSlug(slug), `${id}.md`);
  }

  getPage(slug) {
    const normalized = normalizeSlug(slug);
    if (this.hiddenPages.has(normalized)) {
      return null;
    }

    const filePath = this.pagePath(normalized);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const cached = this.cache.get(normalized);
    if (cached && Date.now() - Number(cached.checkedAt || 0) < this.pageStatTtlMs) return cached.page;
    const stat = fs.statSync(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      cached.checkedAt = Date.now();
      return cached.page;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    const references = normalizeReferences(parsed.data.references);
    const pageMeta = {
      slug: normalized,
      title: parsed.data.title || normalized,
      summary: parsed.data.summary || "",
      references,
    };
    const rendered = renderMarkdown(parsed.body, { config: this.config, page: pageMeta, references });
    const page = {
      slug: pageMeta.slug,
      title: pageMeta.title,
      summary: pageMeta.summary,
      categories: Array.isArray(parsed.data.categories)
        ? parsed.data.categories
        : parsed.data.categories
          ? [parsed.data.categories]
          : [],
      difficulty: parsed.data.difficulty || "未分级",
      status: parsed.data.status || "draft",
      quality: parsed.data.quality || "C",
      author: parsed.data.author || "Wikist",
      heroImage: parsed.data.heroImage || parsed.data.hero_image || "",
      importSource: parsed.data.importSource || "",
      importTitle: parsed.data.importTitle || "",
      importLang: parsed.data.importLang || "",
      importRevision: parsed.data.importRevision ? String(parsed.data.importRevision) : "",
      importUrl: parsed.data.importUrl || "",
      importFetchedAt: parsed.data.importFetchedAt || "",
      importLicense: parsed.data.importLicense || "",
      aliases: toStringList(parsed.data.aliases),
      redirectTarget: parsed.data.redirectTarget || parsed.data.redirect_to || "",
      isDisambiguation: parsed.data.disambiguation === true || parsed.data.disambiguation === "true",
      disambiguationTargets: normalizeDisambiguationTargets(parsed.data.disambiguationTargets || parsed.data.disambiguation_targets),
      prerequisites: normalizeSlugList(parsed.data.prerequisites),
      relatedPages: normalizeSlugList(parsed.data.relatedPages || parsed.data.related_pages),
      canonicalNames: normalizeTextList(parsed.data.canonicalNames || parsed.data.canonical_names),
      notation: normalizeNotation(parsed.data.notation),
      classifications: normalizeTextList(parsed.data.classifications || parsed.data.classification, 24, 100),
      topic: normalizeTopic(parsed.data.topic),
      references,
      citationStats: rendered.citationStats || { total: references.length, cited: 0, unresolved: [], citationNeeded: 0, completeness: 0, verifiable: 0, issues: [] },
      createdAt: parsed.data.createdAt || stat.birthtime.toISOString(),
      updatedAt: parsed.data.updatedAt || stat.mtime.toISOString(),
      revisionId: revisionIdFromDate(parsed.data.updatedAt || stat.mtime.toISOString()),
      body: parsed.body,
      html: rendered.html,
      toc: rendered.toc,
      bytes: stat.size,
      meta: parsed.data,
    };

    this.cache.set(normalized, { mtimeMs: stat.mtimeMs, checkedAt: Date.now(), page });
    this.summaryCache.set(normalized, { mtimeMs: stat.mtimeMs, summary: this.pageSummaryFromPage(page) });
    return page;
  }

  pageSummaryFromPage(page) {
    if (!page) return null;
    return {
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      categories: page.categories || [],
      difficulty: page.difficulty,
      status: page.status,
      quality: page.quality,
      author: page.author,
      heroImage: page.heroImage || "",
      importSource: page.importSource || "",
      importTitle: page.importTitle || "",
      importLang: page.importLang || "",
      importRevision: page.importRevision || "",
      importUrl: page.importUrl || "",
      importFetchedAt: page.importFetchedAt || "",
      importLicense: page.importLicense || "",
      aliases: page.aliases || [],
      redirectTarget: page.redirectTarget || "",
      isDisambiguation: Boolean(page.isDisambiguation),
      disambiguationTargets: page.disambiguationTargets || [],
      prerequisites: page.prerequisites || [],
      relatedPages: page.relatedPages || [],
      canonicalNames: page.canonicalNames || [],
      notation: page.notation || [],
      classifications: page.classifications || [],
      topic: page.topic || "",
      references: page.references || [],
      citationStats: page.citationStats,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      revisionId: page.revisionId,
      bytes: page.bytes,
    };
  }

  pageSummaryFromParsed(slug, parsed, stat) {
    const data = parsed.data || {};
    const references = normalizeReferences(data.references);
    return {
      slug,
      title: data.title || slug,
      summary: data.summary || "",
      categories: Array.isArray(data.categories) ? data.categories : data.categories ? [data.categories] : [],
      difficulty: data.difficulty || "未分级",
      status: data.status || "draft",
      quality: data.quality || "C",
      author: data.author || "Wikist",
      heroImage: data.heroImage || data.hero_image || "",
      importSource: data.importSource || "",
      importTitle: data.importTitle || "",
      importLang: data.importLang || "",
      importRevision: data.importRevision ? String(data.importRevision) : "",
      importUrl: data.importUrl || "",
      importFetchedAt: data.importFetchedAt || "",
      importLicense: data.importLicense || "",
      aliases: toStringList(data.aliases),
      redirectTarget: data.redirectTarget || data.redirect_to || "",
      isDisambiguation: data.disambiguation === true || data.disambiguation === "true",
      disambiguationTargets: normalizeDisambiguationTargets(data.disambiguationTargets || data.disambiguation_targets),
      prerequisites: normalizeSlugList(data.prerequisites),
      relatedPages: normalizeSlugList(data.relatedPages || data.related_pages),
      canonicalNames: normalizeTextList(data.canonicalNames || data.canonical_names),
      notation: normalizeNotation(data.notation),
      classifications: normalizeTextList(data.classifications || data.classification, 24, 100),
      topic: normalizeTopic(data.topic),
      references,
      citationStats: lightweightCitationStats(parsed.body, references),
      createdAt: data.createdAt || stat.birthtime.toISOString(),
      updatedAt: data.updatedAt || stat.mtime.toISOString(),
      revisionId: revisionIdFromDate(data.updatedAt || stat.mtime.toISOString()),
      bytes: stat.size,
    };
  }

  getPageSummary(slug, knownPath = "") {
    const normalized = normalizeSlug(slug);
    if (this.hiddenPages.has(normalized)) return null;
    const filePath = knownPath || this.pagePath(normalized);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const pageCached = this.cache.get(normalized);
    if (pageCached && pageCached.mtimeMs === stat.mtimeMs) return this.pageSummaryFromPage(pageCached.page);
    const cached = this.summaryCache.get(normalized);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.summary;
    const parsed = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
    const summary = this.pageSummaryFromParsed(normalized, parsed, stat);
    this.summaryCache.set(normalized, { mtimeMs: stat.mtimeMs, summary });
    return summary;
  }

  getPageSearchDocument(slug) {
    const normalized = normalizeSlug(slug);
    if (this.hiddenPages.has(normalized)) return null;
    const filePath = this.pagePath(normalized);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const pageCached = this.cache.get(normalized);
    if (pageCached && pageCached.mtimeMs === stat.mtimeMs) {
      return { ...this.pageSummaryFromPage(pageCached.page), body: pageCached.page.body || "" };
    }
    const cached = this.searchSourceCache.get(normalized);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.document;
    const parsed = parseFrontMatter(fs.readFileSync(filePath, "utf8"));
    const document = { ...this.pageSummaryFromParsed(normalized, parsed, stat), body: parsed.body || "" };
    this.searchSourceCache.set(normalized, { mtimeMs: stat.mtimeMs, document });
    this.summaryCache.set(normalized, { mtimeMs: stat.mtimeMs, summary: { ...document, body: undefined } });
    return document;
  }

  listPageSummaries() {
    const now = Date.now();
    if (this.summarySnapshot.length && now < this.summaryExpiresAt) return this.summarySnapshot.slice();
    const liveSlugs = new Set();
    const summaries = walkMarkdownFiles(this.pagesDir).map((filePath) => {
      const slug = fileNameToSlug(path.relative(this.pagesDir, filePath));
      liveSlugs.add(slug);
      return this.getPageSummary(slug, filePath);
    }).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    for (const slug of this.summaryCache.keys()) {
      if (!liveSlugs.has(slug)) this.summaryCache.delete(slug);
    }
    this.summarySnapshot = summaries;
    this.summaryExpiresAt = now + this.catalogTtlMs;
    return summaries.slice();
  }

  listPages() {
    return walkMarkdownFiles(this.pagesDir)
      .map((filePath) => {
        const relative = path.relative(this.pagesDir, filePath);
        const slug = fileNameToSlug(relative);
        return this.getPage(slug);
      })
      .filter(Boolean)
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }

  getRecent(limit = 12) {
    return this.listPageSummaries()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, limit)
      .map((page) => ({
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        updatedAt: page.updatedAt,
        quality: page.quality,
        status: page.status,
      }));
  }

  listRevisions(slug) {
    const dir = this.revisionDir(slug);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        const stat = fs.statSync(filePath);
        return {
          id: entry.name.replace(/\.md$/i, ""),
          createdAt: stat.mtime.toISOString(),
          bytes: stat.size,
        };
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  currentRevisionId(page) {
    return page?.revisionId || revisionIdFromDate(page?.updatedAt);
  }

  snapshotCurrentForReview(slug, revisionId = "") {
    const normalized = normalizeSlug(slug);
    const page = this.getPage(normalized);
    if (!page) return null;
    const id = String(revisionId || this.currentRevisionId(page)).replace(/[^0-9TZ-]/g, "");
    if (!id) return null;
    const target = this.reviewedPath(normalized, id);
    ensureDir(path.dirname(target));
    fs.copyFileSync(this.pagePath(normalized), target);
    return { revisionId: id, path: target, page };
  }

  getReviewedSnapshot(slug, revisionId) {
    const normalized = normalizeSlug(slug);
    const id = String(revisionId || "").replace(/[^0-9TZ-]/g, "");
    const filePath = this.reviewedPath(normalized, id);
    if (!id || !filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    const references = normalizeReferences(parsed.data.references);
    const pageMeta = {
      slug: normalized,
      title: parsed.data.title || normalized,
      summary: parsed.data.summary || "",
      references,
    };
    const rendered = renderMarkdown(parsed.body, { config: this.config, page: pageMeta, references });
    return {
      slug: normalized,
      title: pageMeta.title,
      summary: pageMeta.summary,
      categories: Array.isArray(parsed.data.categories) ? parsed.data.categories : parsed.data.categories ? [parsed.data.categories] : [],
      difficulty: parsed.data.difficulty || "未分级",
      status: parsed.data.status || "stable",
      quality: parsed.data.quality || "C",
      author: parsed.data.author || "Wikist",
      heroImage: parsed.data.heroImage || parsed.data.hero_image || "",
      references,
      citationStats: rendered.citationStats || { total: references.length, cited: 0, unresolved: [], citationNeeded: 0, completeness: 0, verifiable: 0, issues: [] },
      createdAt: parsed.data.createdAt || stat.birthtime.toISOString(),
      updatedAt: parsed.data.updatedAt || stat.mtime.toISOString(),
      revisionId: id,
      version: "reviewed",
      body: parsed.body,
      html: rendered.html,
      toc: rendered.toc,
      bytes: stat.size,
      meta: parsed.data,
    };
  }

  deletedPath(slug, archiveId) {
    return path.join(this.deletedDir, normalizeSlug(slug), `${archiveId}.md`);
  }

  deletePage(slug) {
    const normalized = normalizeSlug(slug);
    if (this.hiddenPages.has(normalized)) {
      return null;
    }

    const page = this.getPage(normalized);
    if (!page) {
      return null;
    }

    const now = new Date().toISOString();
    const archiveId = now.replace(/[:.]/g, "-");
    const archivePath = this.deletedPath(normalized, archiveId);
    ensureDir(path.dirname(archivePath));
    fs.copyFileSync(this.pagePath(normalized), archivePath);
    fs.unlinkSync(this.pagePath(normalized));
    this.cache.delete(normalized);
    const deleted = { ...page, deletedAt: now, archiveId };
    this.emitChange("delete", deleted);
    return deleted;
  }

  parseDeletedFile(filePath, slug, archiveId) {
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    const normalized = normalizeSlug(slug);
    const references = normalizeReferences(parsed.data.references);
    const rendered = renderMarkdown(parsed.body, { config: this.config, references, page: { slug: normalized, title: parsed.data.title || normalized, summary: parsed.data.summary || "", references } });
    return {
      slug: normalized,
      archiveId,
      title: parsed.data.title || normalized,
      summary: parsed.data.summary || "",
      categories: Array.isArray(parsed.data.categories) ? parsed.data.categories : parsed.data.categories ? [parsed.data.categories] : [],
      difficulty: parsed.data.difficulty || "\u672a\u5206\u7ea7",
      status: parsed.data.status || "archived",
      quality: parsed.data.quality || "C",
      author: parsed.data.author || "Wikist",
      heroImage: parsed.data.heroImage || parsed.data.hero_image || "",
      importSource: parsed.data.importSource || "",
      importTitle: parsed.data.importTitle || "",
      importLang: parsed.data.importLang || "",
      importRevision: parsed.data.importRevision ? String(parsed.data.importRevision) : "",
      importUrl: parsed.data.importUrl || "",
      importFetchedAt: parsed.data.importFetchedAt || "",
      importLicense: parsed.data.importLicense || "",
      references,
      citationStats: rendered.citationStats || { total: references.length, cited: 0, unresolved: [], citationNeeded: 0, completeness: 0, verifiable: 0, issues: [] },
      createdAt: parsed.data.createdAt || stat.birthtime.toISOString(),
      updatedAt: parsed.data.updatedAt || stat.mtime.toISOString(),
      archivedAt: stat.mtime.toISOString(),
      bytes: stat.size,
      body: parsed.body,
      html: rendered.html,
      toc: rendered.toc,
      meta: parsed.data,
    };
  }

  rawMarkdown(slug) {
    const normalized = normalizeSlug(slug);
    if (this.hiddenPages.has(normalized)) return null;
    const filePath = this.pagePath(normalized);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  }

  exportPage(slug) {
    const page = this.getPage(slug);
    if (!page) return null;
    return {
      format: "wikist-page",
      version: 1,
      exportedAt: new Date().toISOString(),
      page: {
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        categories: page.categories,
        difficulty: page.difficulty,
        status: page.status,
        quality: page.quality,
        author: page.author,
        heroImage: page.heroImage,
        importSource: page.importSource,
        importTitle: page.importTitle,
        importLang: page.importLang,
        importRevision: page.importRevision,
        importUrl: page.importUrl,
        importFetchedAt: page.importFetchedAt,
        importLicense: page.importLicense,
        aliases: page.aliases,
        redirectTarget: page.redirectTarget,
        disambiguation: page.isDisambiguation,
        disambiguationTargets: page.disambiguationTargets,
        prerequisites: page.prerequisites,
        relatedPages: page.relatedPages,
        canonicalNames: page.canonicalNames,
        notation: page.notation,
        classifications: page.classifications,
        topic: page.topic,
        references: page.references,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
        body: page.body,
      },
    };
  }

  listDeletedPages() {
    return walkMarkdownFiles(this.deletedDir)
      .map((filePath) => {
        const relative = path.relative(this.deletedDir, filePath);
        const archiveId = path.basename(relative, ".md");
        const slug = fileNameToSlug(path.dirname(relative));
        return this.parseDeletedFile(filePath, slug, archiveId);
      })
      .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
  }

  getDeletedPage(slug, archiveId) {
    const normalized = normalizeSlug(slug);
    const safeArchiveId = String(archiveId || "").replace(/[^0-9TZ-]/g, "");
    if (!normalized || !safeArchiveId) return null;
    const filePath = this.deletedPath(normalized, safeArchiveId);
    if (!fs.existsSync(filePath)) return null;
    return this.parseDeletedFile(filePath, normalized, safeArchiveId);
  }

  restoreDeletedPage(slug, archiveId, options = {}) {
    const normalized = normalizeSlug(slug);
    const safeArchiveId = String(archiveId || "").replace(/[^0-9TZ-]/g, "");
    if (!normalized || !safeArchiveId) return null;

    const archivePath = this.deletedPath(normalized, safeArchiveId);
    if (!fs.existsSync(archivePath)) return null;

    const pagePath = this.pagePath(normalized);
    if (fs.existsSync(pagePath) && !options.overwrite) {
      const error = new Error("目标词条已存在，不能覆盖恢复。");
      error.statusCode = 409;
      throw error;
    }

    if (fs.existsSync(pagePath)) {
      const now = new Date().toISOString();
      const revisionDir = this.revisionDir(normalized);
      ensureDir(revisionDir);
      fs.copyFileSync(pagePath, path.join(revisionDir, `${now.replace(/[:.]/g, "-")}.md`));
    }

    ensureDir(path.dirname(pagePath));
    fs.copyFileSync(archivePath, pagePath);
    fs.unlinkSync(archivePath);
    try {
      fs.rmdirSync(path.dirname(archivePath));
    } catch (_error) {}

    this.cache.delete(normalized);
    const restored = { ...this.getPage(normalized), archiveId: safeArchiveId, restoredAt: new Date().toISOString() };
    this.emitChange("restore", restored);
    return restored;
  }

  moveDirectory(fromPath, targetPath) {
    if (!fs.existsSync(fromPath)) return;
    if (fs.existsSync(targetPath)) {
      const error = new Error("目标词条已有同名修订或稳定快照目录，无法安全移动。");
      error.statusCode = 409;
      throw error;
    }
    ensureDir(path.dirname(targetPath));
    fs.renameSync(fromPath, targetPath);
  }

  movePage(sourceSlug, targetSlug, options = {}) {
    const source = normalizeSlug(sourceSlug);
    const target = normalizeSlug(targetSlug);
    if (source === target) {
      const error = new Error("新旧 slug 相同，无需移动词条。");
      error.statusCode = 400;
      throw error;
    }
    const page = this.getPage(source);
    if (!page) return null;
    if (this.getPage(target) || fs.existsSync(this.pagePath(target))) {
      const error = new Error("目标 slug 已存在，不能覆盖移动。");
      error.statusCode = 409;
      throw error;
    }

    const sourcePath = this.pagePath(source);
    const targetPath = this.pagePath(target);
    const revisionsFrom = this.revisionDir(source);
    const revisionsTarget = this.revisionDir(target);
    const reviewedFrom = path.join(this.reviewedDir, source);
    const reviewedTarget = path.join(this.reviewedDir, target);
    if (fs.existsSync(revisionsTarget) || fs.existsSync(reviewedTarget)) {
      const error = new Error("目标 slug 已有历史数据，无法安全合并。");
      error.statusCode = 409;
      throw error;
    }

    ensureDir(path.dirname(targetPath));
    fs.renameSync(sourcePath, targetPath);
    try {
      this.moveDirectory(revisionsFrom, revisionsTarget);
      this.moveDirectory(reviewedFrom, reviewedTarget);
    } catch (error) {
      try { if (fs.existsSync(targetPath) && !fs.existsSync(sourcePath)) fs.renameSync(targetPath, sourcePath); } catch (_rollbackError) {}
      throw error;
    }
    this.clearCache();
    const moved = this.getPage(target);
    let redirect = null;
    if (options.leaveRedirect !== false) {
      redirect = this.savePage(source, {
        title: `${page.title}（重定向）`,
        summary: `本词条已移动至 ${target}。`,
        categories: page.categories,
        difficulty: page.difficulty,
        quality: page.quality,
        status: "stable",
        author: page.author,
        redirectTarget: target,
        body: `本词条已移动至 [[${target}|${page.title}]]。`,
      });
    }
    this.emitChange("move", moved);
    return { sourceSlug: source, targetSlug: target, page: moved, redirect };
  }

  rewriteReferencesForMove(sourceSlug, targetSlug) {
    const source = normalizeSlug(sourceSlug);
    const target = normalizeSlug(targetSlug);
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linkPattern = new RegExp(`\\[\\[${escaped}(?=\\||\\]\\])`, "g");
    const changed = [];
    for (const page of this.listPages()) {
      let body = String(page.body || "");
      body = body.replace(linkPattern, `[[${target}`);
      const prerequisites = (page.prerequisites || []).map((slug) => slug === source ? target : slug);
      const relatedPages = (page.relatedPages || []).map((slug) => slug === source ? target : slug);
      const redirectTarget = page.redirectTarget === source ? target : page.redirectTarget;
      const disambiguationTargets = (page.disambiguationTargets || []).map((item) => ({ ...item, slug: item.slug === source ? target : item.slug }));
      const hasChange = body !== page.body
        || prerequisites.some((slug, index) => slug !== page.prerequisites[index])
        || relatedPages.some((slug, index) => slug !== page.relatedPages[index])
        || redirectTarget !== page.redirectTarget
        || disambiguationTargets.some((item, index) => item.slug !== page.disambiguationTargets[index]?.slug);
      if (!hasChange) continue;
      changed.push(this.savePage(page.slug, {
        title: page.title,
        summary: page.summary,
        categories: page.categories,
        difficulty: page.difficulty,
        status: page.status,
        quality: page.quality,
        author: page.author,
        heroImage: page.heroImage,
        importSource: page.importSource,
        importTitle: page.importTitle,
        importLang: page.importLang,
        importRevision: page.importRevision,
        importUrl: page.importUrl,
        importFetchedAt: page.importFetchedAt,
        importLicense: page.importLicense,
        aliases: page.aliases,
        redirectTarget,
        disambiguation: page.isDisambiguation,
        disambiguationTargets,
        prerequisites,
        relatedPages,
        canonicalNames: page.canonicalNames,
        notation: page.notation,
        classifications: page.classifications,
        topic: page.topic,
        references: page.references,
        body,
      }));
    }
    return changed;
  }

  savePage(slug, input) {
    const normalized = normalizeSlug(slug || input.slug || input.title);
    const existing = this.getPage(normalized);
    const now = new Date().toISOString();

    if (existing) {
      const dir = this.revisionDir(normalized);
      ensureDir(dir);
      const revisionId = now.replace(/[:.]/g, "-");
      fs.copyFileSync(this.pagePath(normalized), path.join(dir, `${revisionId}.md`));
    }

    const metadata = {
      title: input.title || existing?.title || normalized,
      summary: input.summary || existing?.summary || "",
      categories: Array.isArray(input.categories)
        ? input.categories
        : String(input.categories || existing?.categories?.join(", ") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      difficulty: input.difficulty || existing?.difficulty || "未分级",
      status: input.status || existing?.status || "draft",
      quality: input.quality || existing?.quality || "C",
      author: input.author || existing?.author || "Wikist Contributor",
      heroImage: input.heroImage || input.hero_image || existing?.heroImage || "",
      importSource: input.importSource ?? existing?.importSource ?? "",
      importTitle: input.importTitle ?? existing?.importTitle ?? "",
      importLang: input.importLang ?? existing?.importLang ?? "",
      importRevision: input.importRevision ?? existing?.importRevision ?? "",
      importUrl: input.importUrl ?? existing?.importUrl ?? "",
      importFetchedAt: input.importFetchedAt ?? existing?.importFetchedAt ?? "",
      importLicense: input.importLicense ?? existing?.importLicense ?? "",
      aliases: toStringList(input.aliases ?? existing?.aliases ?? []),
      redirectTarget: String(input.redirectTarget ?? input.redirect_to ?? existing?.redirectTarget ?? "").trim(),
      disambiguation: input.disambiguation === undefined
        ? Boolean(existing?.isDisambiguation)
        : input.disambiguation === true || input.disambiguation === "true",
      disambiguationTargets: disambiguationTargetStorage(input.disambiguationTargets ?? input.disambiguation_targets ?? existing?.disambiguationTargets ?? []),
      prerequisites: normalizeSlugList(input.prerequisites ?? existing?.prerequisites ?? []),
      relatedPages: normalizeSlugList(input.relatedPages ?? input.related_pages ?? existing?.relatedPages ?? []),
      canonicalNames: normalizeTextList(input.canonicalNames ?? input.canonical_names ?? existing?.canonicalNames ?? []),
      notation: notationStorage(input.notation ?? existing?.notation ?? []),
      classifications: normalizeTextList(input.classifications ?? input.classification ?? existing?.classifications ?? [], 24, 100),
      topic: normalizeTopic(input.topic ?? existing?.topic ?? ""),
      references: normalizeReferences(input.references ?? existing?.references ?? []),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const body = String(input.body || input.content || "").trim();
    const filePath = this.pagePath(normalized);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, serializeFrontMatter(metadata, body), "utf8");
    this.cache.delete(normalized);
    const page = this.getPage(normalized);
    this.emitChange(existing ? "update" : "create", page);
    return page;
  }
}

module.exports = {
  PageStore,
};
