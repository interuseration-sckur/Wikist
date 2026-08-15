const { runSearchEnhancementHooks } = require("./plugin-registry");

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function normalizeSuggestionText(value) {
  const source = String(value || "");
  const normalized = typeof source.normalize === "function" ? source.normalize("NFKC") : source;
  return normalized.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function suggestionTerms(page) {
  const terms = new Set();
  const values = [
    page?.title,
    page?.slug,
    ...(Array.isArray(page?.aliases) ? page.aliases : []),
    ...(Array.isArray(page?.canonicalNames) ? page.canonicalNames : []),
    ...(Array.isArray(page?.categories) ? page.categories : []),
  ];

  for (const value of values) {
    const normalized = normalizeSuggestionText(value);
    if (!normalized) continue;
    terms.add(normalized);

    const words = normalized.split(/[\s/\\._:|()[\]{},，;；：·—-]+/u).filter(Boolean);
    for (let index = 0; index < words.length; index += 1) {
      terms.add(words[index]);
      if (index < words.length - 1) terms.add(words.slice(index).join(" "));
    }

    for (const sequence of normalized.match(/[\u3400-\u9fff]+/gu) || []) {
      for (let index = 0; index < sequence.length; index += 1) terms.add(sequence.slice(index));
    }
  }
  return [...terms].filter(Boolean);
}

function suggestionQualityRank(page) {
  const quality = String(page?.quality || "").toUpperCase();
  if (quality === "A") return 3;
  if (quality === "B") return 2;
  if (quality === "C") return 1;
  return 0;
}

function tokenize(value) {
  const text = normalizeText(value);
  const tokens = new Map();
  const latin = text.match(/[a-z0-9_]{2,}/g) || [];
  const cjk = text.match(/[\u3400-\u9fff]+/g) || [];

  for (const token of latin) {
    tokens.set(token, (tokens.get(token) || 0) + 1);
  }

  for (const sequence of cjk) {
    for (const char of sequence) {
      tokens.set(char, (tokens.get(char) || 0) + 1);
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const gram = sequence.slice(index, index + 2);
      tokens.set(gram, (tokens.get(gram) || 0) + 2);
    }
  }

  return tokens;
}

function levenshtein(a, b, maxDistance = 2) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function snippet(page, query) {
  const source = `${page.summary}\n${page.body}`.replace(/\s+/g, " ");
  const normalized = normalizeText(source);
  const terms = Array.from(tokenize(query).keys()).sort((a, b) => b.length - a.length);
  const hit = terms.map((term) => normalized.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] || 0;
  const start = Math.max(0, hit - 56);
  return source.slice(start, start + 168).trim();
}

function parseQuery(raw) {
  const source = String(raw || "").trim();
  const filters = {};
  const phrases = [];
  let text = source.replace(/"([^"]+)"/g, (_match, phrase) => {
    phrases.push(phrase.trim());
    return " ";
  });
  text = text.replace(/\b(title|category|quality|difficulty|author|slug):([^\s]+)/gi, (_match, key, value) => {
    filters[key.toLowerCase()] = decodeURIComponent(value).trim();
    return " ";
  });
  return { text: text.trim(), phrases, filters };
}

function matchText(value, expected) {
  if (!expected) return true;
  return normalizeText(value).includes(normalizeText(expected));
}

function tokenScore(fieldTokens, queryTokens, options) {
  let score = 0;
  const fieldKeys = Array.from(fieldTokens.keys());
  for (const [token, queryWeight] of queryTokens.entries()) {
    score += (fieldTokens.get(token) || 0) * queryWeight;
    if (options.prefix) {
      const prefixHits = fieldKeys.filter((item) => item.startsWith(token) && item !== token).length;
      score += prefixHits * 0.45 * queryWeight;
    }
    if (options.fuzzy && /^[a-z0-9_]{4,}$/.test(token)) {
      const fuzzyHits = fieldKeys.filter((item) => /^[a-z0-9_]{4,}$/.test(item) && levenshtein(item, token, 1) <= 1).length;
      score += fuzzyHits * 0.28 * queryWeight;
    }
  }
  return score;
}

function cleanSearchOptions(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const mode = ["balanced", "title", "content"].includes(options.mode) ? options.mode : "balanced";
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    mode,
    category: String(options.category || "").trim(),
    quality: String(options.quality || "").trim(),
    difficulty: String(options.difficulty || "").trim(),
    fuzzy: options.fuzzy !== false,
    prefix: options.prefix !== false,
    weights: {
      title: Math.max(1, Number(options.titleWeight) || (mode === "title" ? 16 : 9)),
      summary: Math.max(1, Number(options.summaryWeight) || (mode === "content" ? 5 : 4)),
      body: Math.max(0.2, Number(options.bodyWeight) || (mode === "title" ? 0.55 : 1)),
      category: Math.max(1, Number(options.categoryWeight) || 6),
    },
  };
}

class SearchIndex {
  constructor(pageStore, settingsProvider = null, persistentIndex = null) {
    this.pageStore = pageStore;
    this.settingsProvider = settingsProvider;
    this.persistentIndex = persistentIndex;
    this.cacheKey = "";
    this.documents = [];
    this.suggestionReady = false;
    this.suggestionDocuments = new Map();
    this.suggestionPrefixes = new Map();
    this.suggestionCache = new Map();
    this.lastTelemetry = { cacheHit: false, engine: "wikist-mini", durationMs: 0 };
  }

  pluginSettings() {
    const settings = typeof this.settingsProvider === "function" ? this.settingsProvider() : {};
    return settings?.plugins?.advancedSearch || settings?.advancedSearch || {};
  }

  documentForPage(page) {
    const identity = [page.slug, ...(page.aliases || []), ...(page.canonicalNames || [])].join(" ");
    return {
      signature: `${page.updatedAt || ""}|${page.bytes || 0}`,
      page,
      text: normalizeText(`${page.title}\n${identity}\n${page.summary}\n${page.body}\n${(page.categories || []).join(" ")}`),
      titleTokens: tokenize(page.title),
      identity,
      identityTokens: tokenize(identity),
      summaryTokens: tokenize(page.summary),
      bodyTokens: tokenize(page.body),
      categoryTokens: tokenize((page.categories || []).join(" ")),
    };
  }

  buildDocuments() {
    const summaries = typeof this.pageStore.listPageSummaries === "function"
      ? this.pageStore.listPageSummaries()
      : this.pageStore.listPages();
    const key = summaries.map((page) => `${page.slug}|${page.updatedAt || ""}|${page.bytes || 0}`).join("\n");
    if (key === this.cacheKey) {
      this.lastBuildCacheHit = true;
      return this.documents;
    }
    this.lastBuildCacheHit = false;
    this.cacheKey = key;
    const existing = new Map(this.documents.map((document) => [document.page.slug, document]));
    this.documents = summaries.map((summary) => {
      const signature = `${summary.updatedAt || ""}|${summary.bytes || 0}`;
      const cached = existing.get(summary.slug);
      if (cached?.signature === signature) return cached;
      const page = typeof this.pageStore.getPageSearchDocument === "function"
        ? this.pageStore.getPageSearchDocument(summary.slug)
        : (typeof this.pageStore.getPage === "function" ? this.pageStore.getPage(summary.slug) : summary);
      return this.documentForPage(page);
    });
    return this.documents;
  }

  syncPage(page) {
    this.persistentIndex?.syncPage(page);
    if (this.suggestionReady) this.upsertSuggestionPage(page);
    this.cacheKey = "";
  }

  removePage(slug) {
    this.persistentIndex?.removePage(slug);
    if (this.suggestionReady) this.removeSuggestionPage(slug);
    this.cacheKey = "";
  }

  buildSuggestionIndex() {
    if (this.suggestionReady) return;
    const summaries = typeof this.pageStore.listPageSummaries === "function"
      ? this.pageStore.listPageSummaries()
      : this.pageStore.listPages();
    this.suggestionDocuments.clear();
    this.suggestionPrefixes.clear();
    for (const page of summaries) this.upsertSuggestionPage(page, false);
    this.suggestionReady = true;
    this.suggestionCache.clear();
  }

  upsertSuggestionPage(page, clearCache = true) {
    if (!page?.slug) return;
    this.removeSuggestionPage(page.slug, false);
    const terms = suggestionTerms(page);
    const prefixes = new Set();
    for (const term of terms) {
      const maxLength = Math.min(term.length, 64);
      for (let length = 1; length <= maxLength; length += 1) prefixes.add(term.slice(0, length));
    }
    const record = {
      slug: String(page.slug),
      title: String(page.title || page.slug),
      summary: String(page.summary || ""),
      categories: Array.isArray(page.categories) ? page.categories.slice(0, 6) : [],
      difficulty: String(page.difficulty || ""),
      quality: String(page.quality || "C"),
      status: String(page.status || "draft"),
      updatedAt: String(page.updatedAt || ""),
      normalizedTitle: normalizeSuggestionText(page.title),
      normalizedSlug: normalizeSuggestionText(page.slug),
      normalizedAliases: (Array.isArray(page.aliases) ? page.aliases : []).map(normalizeSuggestionText).filter(Boolean),
      normalizedCanonicalNames: (Array.isArray(page.canonicalNames) ? page.canonicalNames : []).map(normalizeSuggestionText).filter(Boolean),
      terms,
      prefixes,
    };
    this.suggestionDocuments.set(record.slug, record);
    for (const prefix of prefixes) {
      if (!this.suggestionPrefixes.has(prefix)) this.suggestionPrefixes.set(prefix, new Set());
      this.suggestionPrefixes.get(prefix).add(record.slug);
    }
    if (clearCache) this.suggestionCache.clear();
  }

  removeSuggestionPage(slug, clearCache = true) {
    const key = String(slug || "");
    const existing = this.suggestionDocuments.get(key);
    if (existing) {
      for (const prefix of existing.prefixes) {
        const slugs = this.suggestionPrefixes.get(prefix);
        if (!slugs) continue;
        slugs.delete(key);
        if (!slugs.size) this.suggestionPrefixes.delete(prefix);
      }
      this.suggestionDocuments.delete(key);
    }
    if (clearCache) this.suggestionCache.clear();
  }

  suggest(query, options = {}) {
    const startedAt = Date.now();
    const raw = String(query || "").trim().slice(0, 120);
    const normalizedQuery = normalizeSuggestionText(raw);
    const limit = Math.max(1, Math.min(Number(options.limit) || 8, 200));
    if (!normalizedQuery) {
      return this.finishSearch({ query: raw, items: [], total: 0, engine: "wikist-prefix-cache" }, startedAt, true);
    }

    this.buildSuggestionIndex();
    const cacheKey = `${normalizedQuery}|${limit}`;
    const cached = this.suggestionCache.get(cacheKey);
    if (cached) return this.finishSearch(cached, startedAt, true);

    const candidates = [...(this.suggestionPrefixes.get(normalizedQuery) || [])]
      .map((slug) => this.suggestionDocuments.get(slug))
      .filter(Boolean)
      .map((record) => {
        let score = 0;
        let matchedBy = "关键词";
        if (record.normalizedTitle === normalizedQuery) { score = 1200; matchedBy = "标题"; }
        else if (record.normalizedSlug === normalizedQuery) { score = 1160; matchedBy = "slug"; }
        else if (record.normalizedAliases.includes(normalizedQuery)) { score = 1120; matchedBy = "别名"; }
        else if (record.normalizedCanonicalNames.includes(normalizedQuery)) { score = 1080; matchedBy = "规范名"; }
        else if (record.normalizedTitle.startsWith(normalizedQuery)) { score = 980; matchedBy = "标题"; }
        else if (record.normalizedSlug.startsWith(normalizedQuery)) { score = 920; matchedBy = "slug"; }
        else if (record.normalizedAliases.some((value) => value.startsWith(normalizedQuery))) { score = 860; matchedBy = "别名"; }
        else if (record.normalizedCanonicalNames.some((value) => value.startsWith(normalizedQuery))) { score = 820; matchedBy = "规范名"; }
        else if (record.terms.some((term) => term.startsWith(normalizedQuery))) score = 720;
        score += suggestionQualityRank(record) * 18;
        if (record.status === "stable") score += 24;
        return { record, score, matchedBy };
      })
      .sort((left, right) => right.score - left.score
        || new Date(right.record.updatedAt || 0) - new Date(left.record.updatedAt || 0)
        || left.record.title.localeCompare(right.record.title, "zh-CN"));

    const result = {
      query: raw,
      total: candidates.length,
      engine: "wikist-prefix-cache",
      items: candidates.slice(0, limit).map(({ record, matchedBy }) => ({
        slug: record.slug,
        title: record.title,
        summary: record.summary,
        categories: record.categories,
        difficulty: record.difficulty,
        quality: record.quality,
        status: record.status,
        matchedBy,
      })),
    };
    this.suggestionCache.set(cacheKey, result);
    if (this.suggestionCache.size > 128) this.suggestionCache.delete(this.suggestionCache.keys().next().value);
    return this.finishSearch(result, startedAt, false);
  }

  persistentStatus() {
    return this.persistentIndex?.status() || {
      engine: "sqlite-fts5",
      enabled: false,
      available: false,
      ready: false,
      coverage: "unavailable",
      documents: 0,
      updatedAt: "",
      error: "Wikist Passport 未启用，正在使用轻量搜索回退。",
    };
  }

  rebuildPersistentIndex() {
    if (!this.persistentIndex) {
      const error = new Error("Wikist Passport 未启用，无法创建 SQLite FTS5 索引。");
      error.statusCode = 409;
      throw error;
    }
    const summaries = typeof this.pageStore.listPageSummaries === "function" ? this.pageStore.listPageSummaries() : this.pageStore.listPages();
    const status = this.persistentIndex.rebuild(summaries.map((page) => (
      typeof this.pageStore.getPageSearchDocument === "function" ? this.pageStore.getPageSearchDocument(page.slug) : page
    )).filter(Boolean));
    this.cacheKey = "";
    this.suggestionReady = false;
    this.suggestionCache.clear();
    return status;
  }

  recoverPersistentIndex() {
    if (!this.persistentIndex) {
      const error = new Error("Wikist Passport 未启用，无法修复 SQLite FTS5 索引。");
      error.statusCode = 409;
      throw error;
    }
    const summaries = typeof this.pageStore.listPageSummaries === "function" ? this.pageStore.listPageSummaries() : this.pageStore.listPages();
    const status = this.persistentIndex.recover(summaries.map((page) => (
      typeof this.pageStore.getPageSearchDocument === "function" ? this.pageStore.getPageSearchDocument(page.slug) : page
    )).filter(Boolean));
    this.cacheKey = "";
    this.suggestionReady = false;
    this.suggestionCache.clear();
    return status;
  }

  finishSearch(result, startedAt, cacheHit = false) {
    this.lastTelemetry = {
      cacheHit: Boolean(cacheHit),
      engine: result?.engine || "wikist-mini",
      durationMs: Math.max(0, Date.now() - startedAt),
    };
    return result;
  }

  enhance(result, query, options) {
    return runSearchEnhancementHooks(result, {
      query: String(query || ""),
      options,
      pluginSettings: this.pluginSettings(),
    });
  }

  search(query, optionsOrLimit = {}) {
    if (typeof optionsOrLimit === "number") {
      return this.search(query, { limit: optionsOrLimit }).items;
    }

    const startedAt = Date.now();
    const raw = String(query || "").trim();
    const plugin = this.pluginSettings();
    const options = cleanSearchOptions({
      ...plugin,
      ...optionsOrLimit,
      fuzzy: optionsOrLimit.fuzzy ?? plugin.fuzzy,
      prefix: optionsOrLimit.prefix ?? plugin.prefix,
    });
    if (!raw && !options.category && !options.quality && !options.difficulty) {
      return this.finishSearch(this.enhance(this.emptyResult(raw, options), raw, options), startedAt, true);
    }

    const parsed = parseQuery(raw);
    const filters = {
      ...parsed.filters,
      category: options.category || parsed.filters.category || "",
      quality: options.quality || parsed.filters.quality || "",
      difficulty: options.difficulty || parsed.filters.difficulty || "",
    };
    const q = parsed.text || raw;
    const normalizedQuery = normalizeSuggestionText(q);
    const shortPrefixQuery = /^[a-z0-9_]$/i.test(normalizedQuery)
      && parsed.phrases.length === 0
      && !filters.author
      && !filters.slug
      && !filters.title;
    if (shortPrefixQuery) {
      const suggested = this.suggest(q, { limit: 200 });
      const candidates = suggested.items
        .filter((item) => {
          if (filters.category && !(item.categories || []).some((category) => matchText(category, filters.category))) return false;
          if (filters.quality && normalizeText(item.quality) !== normalizeText(filters.quality)) return false;
          if (filters.difficulty && !matchText(item.difficulty, filters.difficulty)) return false;
          return true;
        })
        .map((item, index) => ({
          ...item,
          score: Math.max(1, 200 - index),
          snippet: item.summary || `${item.title} · ${item.slug}`,
        }));
      const total = candidates.length;
      const items = candidates.slice(options.offset, options.offset + options.limit);
      return this.finishSearch(this.enhance({
        query: raw,
        items,
        total,
        facets: this.facets(candidates),
        engine: "wikist-prefix-cache",
        pagination: {
          page: options.page,
          pageSize: options.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / options.limit)),
          hasPrev: options.page > 1,
          hasNext: options.page < Math.ceil(total / options.limit),
        },
      }, raw, options), startedAt, this.lastTelemetry.cacheHit === true);
    }
    const persistent = this.persistentIndex?.search(raw, options);
    if (persistent && (persistent.total > 0 || options.fuzzy === false)) return this.finishSearch(this.enhance(persistent, raw, options), startedAt, false);
    const queryTokens = tokenize(q);

    const scored = this.buildDocuments()
      .filter(({ page, text }) => {
        if (filters.category && !(page.categories || []).some((item) => matchText(item, filters.category))) return false;
        if (filters.quality && normalizeText(page.quality) !== normalizeText(filters.quality)) return false;
        if (filters.difficulty && !matchText(page.difficulty, filters.difficulty)) return false;
        if (filters.author && !matchText(page.author, filters.author)) return false;
        if (filters.slug && !matchText(page.slug, filters.slug)) return false;
        if (filters.title && !matchText(page.title, filters.title)) return false;
        return parsed.phrases.every((phrase) => text.includes(normalizeText(phrase)));
      })
      .map((doc) => {
        const { page } = doc;
        let score = 0;
        score += tokenScore(doc.titleTokens, queryTokens, options) * options.weights.title;
        score += tokenScore(doc.identityTokens, queryTokens, options) * Math.max(6, options.weights.title * .82);
        score += tokenScore(doc.summaryTokens, queryTokens, options) * options.weights.summary;
        score += tokenScore(doc.bodyTokens, queryTokens, options) * options.weights.body;
        score += tokenScore(doc.categoryTokens, queryTokens, options) * options.weights.category;
        if (normalizedQuery && normalizeText(page.title).includes(normalizedQuery)) score += 48;
        if (normalizedQuery && normalizeText(doc.identity).includes(normalizedQuery)) score += 42;
        if (normalizedQuery && normalizeText(page.summary).includes(normalizedQuery)) score += 18;
        if (!normalizedQuery && (filters.category || filters.quality || filters.difficulty)) score += 1;
        return {
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          categories: page.categories,
          difficulty: page.difficulty,
          quality: page.quality,
          score,
          snippet: snippet(page, q || raw),
        };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-CN"));

    const facets = this.facets(scored);
    const total = scored.length;
    const items = scored.slice(options.offset, options.offset + options.limit);
    return this.finishSearch(this.enhance({
      query: raw,
      items,
      total,
      facets,
      engine: this.persistentIndex?.status()?.enabled ? "wikist-mini-fallback" : (plugin.engine || "wikist-mini"),
      pagination: {
        page: options.page,
        pageSize: options.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.limit)),
        hasPrev: options.page > 1,
        hasNext: options.page < Math.ceil(total / options.limit),
      },
    }, raw, options), startedAt, this.lastBuildCacheHit === true);
  }

  facets(results) {
    const categories = new Map();
    const qualities = new Map();
    const difficulties = new Map();
    for (const item of results) {
      for (const category of item.categories || []) categories.set(category, (categories.get(category) || 0) + 1);
      if (item.quality) qualities.set(item.quality, (qualities.get(item.quality) || 0) + 1);
      if (item.difficulty) difficulties.set(item.difficulty, (difficulties.get(item.difficulty) || 0) + 1);
    }
    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 12).map(([name, count]) => ({ name, count }));
    return { categories: top(categories), qualities: top(qualities), difficulties: top(difficulties) };
  }

  emptyResult(query, options) {
    return {
      query,
      items: [],
      total: 0,
      facets: { categories: [], qualities: [], difficulties: [] },
      engine: "wikist-mini",
      pagination: {
        page: options.page,
        pageSize: options.limit,
        total: 0,
        totalPages: 1,
        hasPrev: false,
        hasNext: false,
      },
    };
  }
}

module.exports = {
  SearchIndex,
  tokenize,
  parseQuery,
  normalizeText,
  matchText,
  snippet,
  cleanSearchOptions,
};
