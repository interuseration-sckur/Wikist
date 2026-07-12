const {
  tokenize,
  parseQuery,
  normalizeText,
  snippet,
} = require("./search-index");

const FTS_TABLE = "wikist_page_fts";
const STATE_TABLE = "wikist_search_index_state";
const INDEX_VERSION = "1";

function nowIso() {
  return new Date().toISOString();
}

function categoriesText(categories) {
  return (Array.isArray(categories) ? categories : []).map((item) => String(item || "").trim()).filter(Boolean).join("\u001f");
}

function categoriesFromText(value) {
  return String(value || "").split("\u001f").map((item) => item.trim()).filter(Boolean);
}

function indexedText(value) {
  return [...tokenize(value).keys()].join(" ");
}

function ftsQuery(value, prefix) {
  const tokens = [...tokenize(value).keys()].filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((token) => {
    const quoted = `"${String(token).replace(/"/g, '""')}"`;
    return prefix && /^[a-z0-9_]{2,}$/i.test(token) ? `${quoted}*` : quoted;
  }).join(" AND ");
}

function facets(rows) {
  const categories = new Map();
  const qualities = new Map();
  const difficulties = new Map();
  for (const row of rows) {
    for (const category of categoriesFromText(row.categories)) categories.set(category, (categories.get(category) || 0) + 1);
    if (row.quality) qualities.set(row.quality, (qualities.get(row.quality) || 0) + 1);
    if (row.difficulty) difficulties.set(row.difficulty, (difficulties.get(row.difficulty) || 0) + 1);
  }
  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
  return { categories: top(categories), qualities: top(qualities), difficulties: top(difficulties) };
}

class PersistentFtsIndex {
  constructor(passport, settingsProvider = null) {
    this.passport = passport || null;
    this.db = passport?.db || null;
    this.settingsProvider = settingsProvider;
    this.initialized = false;
    this.available = null;
    this.error = "";
    this.failureCount = 0;
    this.lastFailureAt = "";
    this.lastRecoveryAt = "";
    this.recoveryNeeded = false;
  }

  refreshDatabase() {
    const current = this.passport?.db || this.db;
    if (current !== this.db) {
      this.db = current;
      this.initialized = false;
      this.available = null;
      this.error = "";
    }
    return this.db;
  }

  markFailure(error) {
    this.error = error?.message || "SQLite FTS5 operation failed.";
    this.failureCount += 1;
    this.lastFailureAt = nowIso();
    this.recoveryNeeded = true;
    this.initialized = false;
    this.available = false;
  }

  settings() {
    const settings = typeof this.settingsProvider === "function" ? this.settingsProvider() : {};
    return settings?.plugins?.advancedSearch || settings?.advancedSearch || {};
  }

  enabled() {
    this.refreshDatabase();
    const settings = this.settings();
    return Boolean(this.db && settings.enabled !== false && settings.fts5 !== false);
  }

  ensureSchema() {
    this.refreshDatabase();
    if (!this.db || this.available === false) return false;
    if (this.initialized) return true;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
          slug UNINDEXED,
          title_terms,
          summary_terms,
          body_terms,
          category_terms,
          author_terms,
          title UNINDEXED,
          summary UNINDEXED,
          body UNINDEXED,
          categories UNINDEXED,
          quality UNINDEXED,
          difficulty UNINDEXED,
          author UNINDEXED,
          updated_at UNINDEXED,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `);
      this.initialized = true;
      this.available = true;
      this.setState("schema_version", INDEX_VERSION);
      return true;
    } catch (error) {
      this.available = false;
      this.markFailure(error);
      return false;
    }
  }

  getState(key, fallback = "") {
    if (!this.ensureSchema()) return fallback;
    const row = this.db.prepare(`SELECT value FROM ${STATE_TABLE} WHERE key = ?`).get(key);
    return row?.value || fallback;
  }

  setState(key, value) {
    if (!this.db || !this.initialized) return;
    this.db.prepare(`
      INSERT INTO ${STATE_TABLE} (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(key), String(value), nowIso());
  }

  status() {
    if (!this.enabled()) {
      return {
        engine: "sqlite-fts5",
        enabled: false,
        available: this.available !== false,
        ready: false,
        coverage: "disabled",
        documents: 0,
        updatedAt: "",
        error: this.error,
        recoveryNeeded: this.recoveryNeeded,
        failureCount: this.failureCount,
        lastFailureAt: this.lastFailureAt,
        lastRecoveryAt: this.lastRecoveryAt,
      };
    }
    if (!this.ensureSchema()) {
      return {
        engine: "sqlite-fts5",
        enabled: true,
        available: false,
        ready: false,
        coverage: "unavailable",
        documents: 0,
        updatedAt: "",
        error: this.error,
        recoveryNeeded: this.recoveryNeeded,
        failureCount: this.failureCount,
        lastFailureAt: this.lastFailureAt,
        lastRecoveryAt: this.lastRecoveryAt,
      };
    }
    const documents = Number(this.db.prepare(`SELECT count(*) AS n FROM ${FTS_TABLE}`).get().n || 0);
    const coverage = this.getState("coverage", "pending");
    return {
      engine: "sqlite-fts5",
      enabled: true,
      available: true,
      ready: coverage === "complete",
      coverage,
      documents,
      updatedAt: this.getState("updated_at", ""),
      error: "",
      recoveryNeeded: this.recoveryNeeded,
      failureCount: this.failureCount,
      lastFailureAt: this.lastFailureAt,
      lastRecoveryAt: this.lastRecoveryAt,
    };
  }

  writePage(page) {
    const values = {
      slug: String(page?.slug || ""),
      title: String(page?.title || ""),
      summary: String(page?.summary || ""),
      body: String(page?.body || ""),
      categories: categoriesText(page?.categories),
      quality: String(page?.quality || ""),
      difficulty: String(page?.difficulty || ""),
      author: String(page?.author || ""),
      updatedAt: String(page?.updatedAt || ""),
    };
    if (!values.slug) return;
    this.db.prepare(`DELETE FROM ${FTS_TABLE} WHERE slug = ?`).run(values.slug);
    this.db.prepare(`
      INSERT INTO ${FTS_TABLE} (
        slug, title_terms, summary_terms, body_terms, category_terms, author_terms,
        title, summary, body, categories, quality, difficulty, author, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      values.slug,
      indexedText(values.title),
      indexedText(values.summary),
      indexedText(values.body),
      indexedText(values.categories),
      indexedText(values.author),
      values.title,
      values.summary,
      values.body,
      values.categories,
      values.quality,
      values.difficulty,
      values.author,
      values.updatedAt,
    );
  }

  syncPage(page) {
    if (!this.enabled() || !this.ensureSchema()) return this.status();
    try {
      this.writePage(page);
      if (this.getState("coverage", "") === "") this.setState("coverage", "incremental");
      this.setState("updated_at", nowIso());
    } catch (error) {
      this.markFailure(error);
    }
    return this.status();
  }

  removePage(slug) {
    if (!this.enabled() || !this.ensureSchema()) return this.status();
    try {
      this.db.prepare(`DELETE FROM ${FTS_TABLE} WHERE slug = ?`).run(String(slug || ""));
      if (this.getState("coverage", "") === "") this.setState("coverage", "incremental");
      this.setState("updated_at", nowIso());
    } catch (error) {
      this.markFailure(error);
    }
    return this.status();
  }

  rebuild(pages = []) {
    if (!this.enabled()) {
      const error = new Error("SQLite FTS5 已在高级搜索配置中停用。");
      error.statusCode = 409;
      throw error;
    }
    if (!this.ensureSchema()) {
      const error = new Error(this.error || "当前 SQLite 运行时不支持 FTS5。");
      error.statusCode = 409;
      throw error;
    }
    this.db.exec("BEGIN");
    try {
      this.db.exec(`DELETE FROM ${FTS_TABLE}`);
      for (const page of pages) this.writePage(page);
      this.setState("coverage", "complete");
      this.setState("updated_at", nowIso());
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch (_rollbackError) {}
      this.markFailure(error);
      throw error;
    }
    this.recoveryNeeded = false;
    this.lastRecoveryAt = nowIso();
    return this.status();
  }

  recover(pages = []) {
    if (!this.enabled()) {
      const error = new Error("SQLite FTS5 已在高级搜索配置中停用。");
      error.statusCode = 409;
      throw error;
    }
    this.refreshDatabase();
    if (!this.db) {
      const error = new Error("SQLite 数据库当前不可用。");
      error.statusCode = 503;
      throw error;
    }
    this.initialized = false;
    this.available = null;
    this.error = "";
    try {
      this.db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}; DROP TABLE IF EXISTS ${STATE_TABLE};`);
      const result = this.rebuild(pages);
      this.recoveryNeeded = false;
      this.lastRecoveryAt = nowIso();
      return result;
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  filters(parsed, options) {
    return {
      ...parsed.filters,
      category: options.category || parsed.filters.category || "",
      quality: options.quality || parsed.filters.quality || "",
      difficulty: options.difficulty || parsed.filters.difficulty || "",
    };
  }

  where(match, filters) {
    const clauses = [`${FTS_TABLE} MATCH ?`];
    const args = [match];
    const addContains = (column, value) => {
      if (!value) return;
      clauses.push(`lower(${column}) LIKE ?`);
      args.push(`%${normalizeText(value)}%`);
    };
    addContains("categories", filters.category);
    if (filters.quality) {
      clauses.push("lower(quality) = ?");
      args.push(normalizeText(filters.quality));
    }
    addContains("difficulty", filters.difficulty);
    addContains("author", filters.author);
    addContains("slug", filters.slug);
    addContains("title", filters.title);
    return { clause: clauses.join(" AND "), args };
  }

  rows(match, filters, options, pagination = null) {
    const { clause, args } = this.where(match, filters);
    const weights = [
      0,
      options.weights.title,
      options.weights.summary,
      options.weights.body,
      options.weights.category,
      1,
      0, 0, 0, 0, 0, 0, 0, 0,
    ].map((value) => Number(value).toFixed(3)).join(", ");
    const limit = pagination?.limit;
    const offset = pagination?.offset;
    const sql = `
      SELECT slug, title, summary, body, categories, quality, difficulty, author,
        bm25(${FTS_TABLE}, ${weights}) AS rank
      FROM ${FTS_TABLE}
      WHERE ${clause}
      ORDER BY rank ASC, title COLLATE NOCASE
      ${limit == null ? "" : "LIMIT ? OFFSET ?"}
    `;
    return this.db.prepare(sql).all(...args, ...(limit == null ? [] : [limit, offset]));
  }

  search(raw, options) {
    const status = this.status();
    if (!status.ready) return null;
    const parsed = parseQuery(raw);
    if (parsed.phrases.length) return null;
    const filters = this.filters(parsed, options);
    const source = parsed.text || "";
    const match = ftsQuery(source, options.prefix);
    if (!match) return null;
    try {
      const { clause, args } = this.where(match, filters);
      const total = Number(this.db.prepare(`SELECT count(*) AS n FROM ${FTS_TABLE} WHERE ${clause}`).get(...args).n || 0);
      const rows = this.rows(match, filters, options, options);
      const facetRows = total > 0 ? this.rows(match, filters, options, { limit: Math.min(total, 500), offset: 0 }) : [];
      const items = rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        categories: categoriesFromText(row.categories),
        difficulty: row.difficulty,
        quality: row.quality,
        score: Math.max(1, Math.round(Math.abs(Number(row.rank || 0)) * 1000000)),
        snippet: snippet({ summary: row.summary, body: row.body }, source),
      }));
      return {
        query: String(raw || "").trim(),
        items,
        total,
        facets: facets(facetRows),
        engine: "sqlite-fts5",
        pagination: {
          page: options.page,
          pageSize: options.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / options.limit)),
          hasPrev: options.page > 1,
          hasNext: options.page < Math.ceil(total / options.limit),
        },
      };
    } catch (error) {
      this.markFailure(error);
      return null;
    }
  }
}

module.exports = { PersistentFtsIndex };
