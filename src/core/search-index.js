function normalizeText(value) {
  return String(value || "").toLowerCase();
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
  constructor(pageStore, settingsProvider = null) {
    this.pageStore = pageStore;
    this.settingsProvider = settingsProvider;
    this.cacheKey = "";
    this.documents = [];
  }

  pluginSettings() {
    const settings = typeof this.settingsProvider === "function" ? this.settingsProvider() : {};
    return settings?.plugins?.advancedSearch || settings?.advancedSearch || {};
  }

  buildDocuments() {
    const pages = this.pageStore.listPages();
    const key = pages.map((page) => `${page.slug}|${page.updatedAt || ""}|${page.bytes || 0}`).join("\n");
    if (key === this.cacheKey) return this.documents;
    this.cacheKey = key;
    this.documents = pages.map((page) => ({
      page,
      text: normalizeText(`${page.title}\n${page.summary}\n${page.body}\n${(page.categories || []).join(" ")}`),
      titleTokens: tokenize(page.title),
      summaryTokens: tokenize(page.summary),
      bodyTokens: tokenize(page.body),
      categoryTokens: tokenize((page.categories || []).join(" ")),
    }));
    return this.documents;
  }

  search(query, optionsOrLimit = {}) {
    if (typeof optionsOrLimit === "number") {
      return this.search(query, { limit: optionsOrLimit }).items;
    }

    const raw = String(query || "").trim();
    const plugin = this.pluginSettings();
    const options = cleanSearchOptions({
      ...plugin,
      ...optionsOrLimit,
      fuzzy: optionsOrLimit.fuzzy ?? plugin.fuzzy,
      prefix: optionsOrLimit.prefix ?? plugin.prefix,
    });
    if (!raw && !options.category && !options.quality && !options.difficulty) {
      return this.emptyResult(raw, options);
    }

    const parsed = parseQuery(raw);
    const filters = {
      ...parsed.filters,
      category: options.category || parsed.filters.category || "",
      quality: options.quality || parsed.filters.quality || "",
      difficulty: options.difficulty || parsed.filters.difficulty || "",
    };
    const q = parsed.text || raw;
    const queryTokens = tokenize(q);
    const normalizedQuery = normalizeText(q);

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
        score += tokenScore(doc.summaryTokens, queryTokens, options) * options.weights.summary;
        score += tokenScore(doc.bodyTokens, queryTokens, options) * options.weights.body;
        score += tokenScore(doc.categoryTokens, queryTokens, options) * options.weights.category;
        if (normalizedQuery && normalizeText(page.title).includes(normalizedQuery)) score += 48;
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
    return {
      query: raw,
      items,
      total,
      facets,
      engine: plugin.engine || "wikist-mini",
      pagination: {
        page: options.page,
        pageSize: options.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.limit)),
        hasPrev: options.page > 1,
        hasNext: options.page < Math.ceil(total / options.limit),
      },
    };
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
};
