# SQLite FTS5 Persistent Search

Wikist keeps its original in-memory, field-weighted search index as the universal baseline. It is small, supports Chinese token heuristics, quoted phrases, prefix matching, fuzzy English matching, filters, facets, and pagination without requiring a database extension.

When Passport is enabled and the bundled SQLite runtime supports FTS5, the `advancedSearch.fts5` option adds a persistent full-text index to the existing Passport SQLite database. It does not introduce Elasticsearch, a background worker, or a second service.

## Lifecycle

1. Enable **Advanced Search** and keep `fts5: true` in the plugin configuration.
2. Open **Admin -> Search Index** and choose **Build SQLite FTS5 Index** once to backfill existing Markdown pages.
3. After the controlled backfill is complete, ordinary article create, save, restore, and delete operations update or remove only the affected FTS row.

Wikist deliberately does not scan all Markdown files when the server starts. Until an administrator completes the first backfill, search continues to use the established lightweight index, so existing content remains discoverable. The same fallback is used if the runtime does not ship FTS5, if the index is disabled, or when a query needs the lightweight engine's quoted-phrase or fuzzy matching behavior.

## Indexed Data And Boundaries

The FTS record includes title, summary, body, categories, author, quality, difficulty, slug, and update time. Search text is normalized through the existing tokenization rules before insertion; this retains practical Chinese single-character and bigram matching with SQLite's standard `unicode61` tokenizer.

The FTS table is only a derived cache. Canonical article data remains in `content/pages/*.md`, and collaboration data remains in Passport's normal SQLite tables. A backup may preserve the derived table, but restoring a backup explicitly rebuilds it when FTS5 is active. Deleting the FTS table or disabling it cannot delete content.

## Operations

The Search Index dashboard reports availability, coverage, indexed document count, and the most recent incremental update. Building the index is an administrator action because it intentionally reads all current pages. This is appropriate after enabling FTS5 for an existing site, after a manual database repair, or after restoring external content. It is not part of normal startup.

For diagnostics run:

```powershell
npm run check:search
```

The check creates a temporary SQLite database, verifies English and Chinese full-text matches, updates one indexed page, removes it, and deletes its temporary data afterwards.
