const { runSearchEnhancementHooks } = require("./plugin-registry");

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function normalizeSuggestionText(value) {
  const source = String(value || "");
  const normalized = typeof source.normalize === "function" ? source.normalize("NFKC") : source;
  return normalized.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

const DEFAULT_SEARCH_STOP_WORDS = Object.freeze([
  "的", "了", "和", "与", "及", "或", "是", "在", "为", "中", "上", "下", "由", "从", "对",
  "一个", "一种", "相关", "内容", "页面", "词条", "概念", "定义", "定理", "命题", "引理", "推论",
  "证明", "公式", "性质", "例子", "示例", "介绍", "结论",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "definition", "theorem", "proposition", "lemma", "corollary", "proof", "formula", "example",
  "introduction", "concept", "wiki", "page",
]);

const DEFAULT_SINGLE_CHARACTER_NOISE_WORDS = Object.freeze([
  "词", "条", "页", "文", "章", "节", "项", "个", "些", "本", "此", "该", "其", "所", "等",
  "用", "可", "能", "会", "就", "不", "有", "将", "而", "也", "更", "最", "被", "把", "给",
  "到", "以", "于", "如", "若", "又", "都", "很", "并", "则", "后", "前", "内", "外", "间", "时",
]);

const DEFAULT_SINGLE_CHARACTER_CONCEPTS = Object.freeze([
  "群", "环", "域", "模", "图", "集", "数", "点", "线", "面", "圆", "角", "边", "根", "阶", "秩",
  "核", "像", "商", "熵", "簇", "链", "流", "场", "弦", "解", "序",
]);

const DEFAULT_SINGLE_CHARACTER_CONCEPT_PATTERNS = Object.freeze({
  群: ["群论", "群结构", "群作用", "群同态", "群表示", "群阶", "子群", "有限群", "置换群", "李群", "阿贝尔群"],
  环: ["环论", "环结构", "环同态", "子环", "交换环", "整环", "商环", "多项式环", "局部环"],
  域: ["域论", "域扩张", "域结构", "子域", "有限域", "数域", "定义域", "值域", "代数闭域"],
  模: ["模论", "模结构", "模空间", "子模", "左模", "右模", "模同态", "模表示"],
  图: ["图论", "图结构", "子图", "有向图", "无向图", "连通图", "图算法", "图同构"],
  集: ["集合", "集合论", "子集", "并集", "交集", "补集", "开集", "闭集", "点集"],
  数: ["数论", "实数", "复数", "整数", "有理数", "自然数", "基数", "序数"],
  点: ["点集", "极限点", "驻点", "奇点", "零点", "不动点", "临界点"],
  线: ["直线", "曲线", "线性", "切线", "割线", "法线"],
  面: ["平面", "曲面", "面积", "截面", "超曲面"],
  圆: ["圆周", "圆锥", "圆环", "圆心", "圆弧"],
  角: ["角度", "三角", "夹角", "内角", "外角"],
  边: ["边界", "边长", "多边形", "邻边", "对边"],
  根: ["方程根", "根式", "平方根", "根系", "零根"],
  阶: ["阶数", "群阶", "阶乘", "阶导数", "高阶", "低阶"],
  秩: ["矩阵秩", "秩定理", "满秩", "秩亏"],
  核: ["核空间", "同态核", "线性核", "零核"],
  像: ["映射像", "原像", "像空间", "同态像"],
  商: ["商群", "商环", "商空间", "商集", "商映射"],
  熵: ["信息熵", "拓扑熵", "条件熵", "相对熵"],
  簇: ["代数簇", "向量簇", "仿射簇", "射影簇"],
  链: ["链复形", "上链", "下链", "马尔可夫链", "链群"],
  流: ["网络流", "梯度流", "测地流", "动力流"],
  场: ["向量场", "标量场", "张量场", "随机场"],
  弦: ["弦论", "弦长", "弦振动"],
  解: ["解集", "方程解", "通解", "特解", "弱解", "解析解"],
  序: ["序关系", "偏序", "全序", "良序", "序列", "序数"],
});

const DEFAULT_SINGLE_CHARACTER_FALSE_POSITIVES = Object.freeze({
  环: ["循环论", "环境", "环节"],
  域: ["领域", "区域"],
  模: ["规模", "模式", "模板", "模仿", "模块"],
  图: ["图片", "图标", "截图", "视图"],
  集: ["集成", "集中", "采集"],
  数: ["数据", "数字", "参数"],
  点: ["点击", "观点", "重点", "特点", "节点"],
  线: ["在线", "离线", "下划线", "路线"],
  面: ["页面", "界面", "方面"],
  角: ["角色", "角标"],
  边: ["左边", "右边", "旁边"],
  根: ["根本"],
  像: ["图像"],
  流: ["流程", "流量"],
  场: ["场景"],
  解: ["解决", "解释", "了解"],
  序: ["程序", "顺序"],
});
const CONCEPT_SEPARATORS = new Set(Array.from(",，、。；;：:（）()【】[]{}“”‘’\"'·/|"));

function configuredStopWords(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(/[\s,，;；]+/u);
}

function conceptSearchText(value, concept) {
  return (DEFAULT_SINGLE_CHARACTER_FALSE_POSITIVES[concept] || []).reduce(
    (text, pattern) => text.split(pattern).join(" "),
    normalizeSuggestionText(value),
  );
}

function hasConceptContext(value, concept) {
  const text = conceptSearchText(value, concept);
  const patterns = DEFAULT_SINGLE_CHARACTER_CONCEPT_PATTERNS[concept] || [
    `${concept}论`, `${concept}结构`, `子${concept}`, `${concept}空间`,
  ];
  if (patterns.some((pattern) => text.includes(pattern))) return true;
  if ([`${concept}、`, `、${concept}`, `包括${concept}`, `${concept}与`, `${concept}和`]
    .some((pattern) => text.includes(pattern))) return true;
  const isBoundary = (character) => !character || /\s/u.test(character) || CONCEPT_SEPARATORS.has(character);
  let index = text.indexOf(concept);
  while (index >= 0) {
    if (isBoundary(text[index - 1]) && isBoundary(text[index + concept.length])) return true;
    index = text.indexOf(concept, index + concept.length);
  }
  return false;
}

function analyzeSearchText(value, extraStopWords = [], extraSingleCharacterConcepts = []) {
  const normalized = normalizeSuggestionText(value);
  const configuredStops = configuredStopWords(extraStopWords).map(normalizeSuggestionText).filter(Boolean);
  const stopWords = new Set([
    ...DEFAULT_SEARCH_STOP_WORDS,
    ...configuredStops,
  ]);
  const singleCharacterConcepts = new Set([
    ...DEFAULT_SINGLE_CHARACTER_CONCEPTS,
    ...configuredStopWords(extraSingleCharacterConcepts).map(normalizeSuggestionText).filter((word) => /^[\u3400-\u9fff]$/u.test(word)),
  ]);
  const singleCharacterNoiseWords = new Set([
    ...DEFAULT_SINGLE_CHARACTER_NOISE_WORDS,
    ...configuredStops.filter((word) => /^[\u3400-\u9fff]$/u.test(word)),
  ]);
  const suffixes = [...stopWords]
    .filter((word) => /^[\u3400-\u9fff]+$/u.test(word))
    .sort((left, right) => right.length - left.length);
  const originalTerms = normalized.split(/[\s/\\._:|()[\]{},，;；：·—-]+/u).filter(Boolean);
  const terms = [];
  const ignored = [];
  const ignoredSingleCharacters = [];

  for (const original of originalTerms) {
    if (/^[\u3400-\u9fff]$/u.test(original)
      && !singleCharacterConcepts.has(original)
      && (singleCharacterNoiseWords.has(original) || stopWords.has(original))) {
      ignored.push(original);
      ignoredSingleCharacters.push(original);
      continue;
    }
    if (stopWords.has(original)) {
      ignored.push(original);
      continue;
    }
    let term = original;
    let changed = true;
    while (changed && term) {
      changed = false;
      for (const suffix of suffixes) {
        if (term.length > suffix.length && term.endsWith(suffix)) {
          term = term.slice(0, -suffix.length);
          ignored.push(suffix);
          changed = true;
          break;
        }
      }
    }
    if (term && !stopWords.has(term)) terms.push(term);
    else if (term) ignored.push(term);
  }

  return {
    normalized,
    text: terms.join(" "),
    terms,
    originalTerms,
    ignored: [...new Set(ignored)],
    genericOnly: originalTerms.length > 0 && terms.length === 0,
    lowInformationOnly: originalTerms.length > 0 && ignoredSingleCharacters.length === originalTerms.length,
    focusedOnly: terms.length === 1
      && /^[\u3400-\u9fff]$/u.test(terms[0])
      && !singleCharacterConcepts.has(terms[0]),
    singleCharacterConcept: terms.length === 1 && singleCharacterConcepts.has(terms[0]) ? terms[0] : "",
  };
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
  const conceptSource = [page?.title, page?.summary, ...(Array.isArray(page?.categories) ? page.categories : [])].join(" ");
  for (const concept of DEFAULT_SINGLE_CHARACTER_CONCEPTS) {
    if (hasConceptContext(conceptSource, concept)) terms.add(concept);
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
    category: String(options.category || "").trim().slice(0, 120),
    quality: String(options.quality || "").trim().slice(0, 40),
    difficulty: String(options.difficulty || "").trim().slice(0, 80),
    fuzzy: options.fuzzy !== false,
    prefix: options.prefix !== false,
    stopWords: configuredStopWords(options.stopWords).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 200),
    singleCharacterConcepts: configuredStopWords(options.singleCharacterConcepts)
      .map((item) => String(item || "").trim())
      .filter((item) => /^[\u3400-\u9fff]$/u.test(item))
      .slice(0, 100),
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
    const plugin = this.pluginSettings();
    const analyzed = analyzeSearchText(normalizedQuery, plugin.stopWords, plugin.singleCharacterConcepts);
    const cacheKey = `${normalizedQuery}|${limit}|${analyzed.lowInformationOnly ? "exact" : "prefix"}`;
    const cached = this.suggestionCache.get(cacheKey);
    if (cached) return this.finishSearch(cached, startedAt, true);

    const candidates = [...(this.suggestionPrefixes.get(normalizedQuery) || [])]
      .map((slug) => this.suggestionDocuments.get(slug))
      .filter(Boolean)
      .filter((record) => !analyzed.lowInformationOnly
        || record.normalizedTitle === normalizedQuery
        || record.normalizedSlug === normalizedQuery
        || record.normalizedAliases.includes(normalizedQuery)
        || record.normalizedCanonicalNames.includes(normalizedQuery)
        || record.categories.some((category) => normalizeSuggestionText(category) === normalizedQuery))
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
      ignoredTerms: analyzed.ignored,
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
    const raw = String(query || "").trim().slice(0, 256);
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
    const analyzed = analyzeSearchText(parsed.text, options.stopWords, options.singleCharacterConcepts);
    const q = analyzed.text || (parsed.phrases.length ? parsed.phrases.join(" ") : "");
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

    if ((analyzed.genericOnly || analyzed.focusedOnly || analyzed.singleCharacterConcept) && parsed.phrases.length === 0) {
      const genericTerms = analyzed.genericOnly ? analyzed.originalTerms : analyzed.terms;
      const candidates = this.buildDocuments()
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
          const title = normalizeSuggestionText(page.title);
          const identity = normalizeSuggestionText(doc.identity);
          const categories = normalizeSuggestionText((page.categories || []).join(" "));
          const exactIdentityTerms = [page.title, page.slug, ...(page.aliases || []), ...(page.canonicalNames || [])]
            .map(normalizeSuggestionText)
            .filter(Boolean);
          const exactCategoryTerms = (page.categories || []).map(normalizeSuggestionText).filter(Boolean);
          const conceptPatterns = analyzed.singleCharacterConcept
            ? (DEFAULT_SINGLE_CHARACTER_CONCEPT_PATTERNS[analyzed.singleCharacterConcept] || [
              `${analyzed.singleCharacterConcept}论`, `${analyzed.singleCharacterConcept}结构`,
              `子${analyzed.singleCharacterConcept}`, `${analyzed.singleCharacterConcept}空间`,
            ])
            : [];
          const withoutFalsePositives = (value) => conceptSearchText(value, analyzed.singleCharacterConcept);
          const conceptText = withoutFalsePositives(doc.text);
          const matchesFocusedTerm = (term) => {
            if (analyzed.lowInformationOnly) return exactIdentityTerms.includes(term) || exactCategoryTerms.includes(term);
            if (analyzed.singleCharacterConcept) {
              return exactIdentityTerms.includes(term)
                || exactCategoryTerms.includes(term)
                || conceptPatterns.some((pattern) => conceptText.includes(pattern))
                || hasConceptContext(conceptText, analyzed.singleCharacterConcept);
            }
            return title.includes(term) || identity.includes(term) || categories.includes(term);
          };
          if (!genericTerms.every(matchesFocusedTerm)) return null;
          let score = 0;
          for (const term of genericTerms) {
            if (title === term) score += 140;
            else if (title.includes(term)) score += 96;
            if (identity.includes(term)) score += 72;
            if (categories.includes(term)) score += 48;
          }
          if (analyzed.singleCharacterConcept) {
            const conceptTitle = withoutFalsePositives(page.title);
            const conceptIdentity = withoutFalsePositives(doc.identity);
            const conceptCategories = withoutFalsePositives((page.categories || []).join(" "));
            const conceptSummary = withoutFalsePositives(page.summary);
            const conceptBody = withoutFalsePositives(page.body);
            for (const pattern of conceptPatterns) {
              if (conceptTitle.includes(pattern)) score += 96;
              if (conceptIdentity.includes(pattern)) score += 72;
              if (conceptCategories.includes(pattern)) score += 54;
              if (conceptSummary.includes(pattern)) score += 30;
              if (conceptBody.includes(pattern)) score += 8;
            }
            if (hasConceptContext(page.summary, analyzed.singleCharacterConcept)) score += 28;
            if (hasConceptContext(page.body, analyzed.singleCharacterConcept)) score += 7;
          }
          return {
            slug: page.slug,
            title: page.title,
            summary: page.summary,
            categories: page.categories,
            difficulty: page.difficulty,
            quality: page.quality,
            score,
            snippet: page.summary || page.title,
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"));
      const total = candidates.length;
      const items = candidates.slice(options.offset, options.offset + options.limit);
      return this.finishSearch(this.enhance({
        query: raw,
        items,
        total,
        ignoredTerms: analyzed.ignored,
        facets: this.facets(candidates),
        engine: analyzed.singleCharacterConcept ? "wikist-concept" : "wikist-focused",
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
    const persistent = this.persistentIndex?.search(raw, options);
    if (persistent && (persistent.total > 0 || options.fuzzy === false)) {
      return this.finishSearch(this.enhance({ ...persistent, ignoredTerms: analyzed.ignored }, raw, options), startedAt, false);
    }
    const queryTokens = tokenize(q);
    const requiredCjkSequences = q.match(/[\u3400-\u9fff]{2,}/gu) || [];

    const scored = this.buildDocuments()
      .filter(({ page, text }) => {
        if (filters.category && !(page.categories || []).some((item) => matchText(item, filters.category))) return false;
        if (filters.quality && normalizeText(page.quality) !== normalizeText(filters.quality)) return false;
        if (filters.difficulty && !matchText(page.difficulty, filters.difficulty)) return false;
        if (filters.author && !matchText(page.author, filters.author)) return false;
        if (filters.slug && !matchText(page.slug, filters.slug)) return false;
        if (filters.title && !matchText(page.title, filters.title)) return false;
        if (!requiredCjkSequences.every((sequence) => text.includes(sequence))) return false;
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
        if (!normalizedQuery && Object.values(filters).some(Boolean)) score += 1;
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
      ignoredTerms: analyzed.ignored,
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
  analyzeSearchText,
  DEFAULT_SEARCH_STOP_WORDS,
  DEFAULT_SINGLE_CHARACTER_NOISE_WORDS,
  DEFAULT_SINGLE_CHARACTER_CONCEPTS,
  DEFAULT_SINGLE_CHARACTER_CONCEPT_PATTERNS,
  DEFAULT_SINGLE_CHARACTER_FALSE_POSITIVES,
  parseQuery,
  normalizeText,
  matchText,
  snippet,
  cleanSearchOptions,
};
