const fs = require("fs");
const path = require("path");
const { parseFrontMatter, serializeFrontMatter } = require("./frontmatter");
const { normalizeReferences } = require("./citations");
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
  }

  onChange(listener) {
    if (typeof listener !== "function") return () => {};
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  emitChange(type, page) {
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

    const stat = fs.statSync(filePath);
    const cached = this.cache.get(normalized);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
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

    this.cache.set(normalized, { mtimeMs: stat.mtimeMs, page });
    return page;
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
    return this.listPages()
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
