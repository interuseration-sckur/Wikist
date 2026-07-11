# Wikist Roadmap

Wikist already has its installation flow, Markdown article store, SQLite Passport, roles, page permissions, comments, ratings, favorites, messages, translations, import/export, backups, and mathematical rendering plugins. The next phase is not to add weight for its own sake; it is to make a serious knowledge community more trustworthy, navigable, and fast.

## Product Principles

- Preserve Markdown articles and SQLite as the default deployment model.
- Prefer incremental indexes and additive tables over mandatory external services.
- Make editorial state visible: readers should know whether content is draft, current, reviewed, or stable.
- Keep plugins declarative and permission-scoped; unknown code must never execute merely because it was copied into a directory.
- Optimize for a mathematics and science community, where sources, notation, translations, and proof quality matter more than social-feed mechanics.

## P0: Editorial Quality And Review

### Delivered: Lightweight Stable Revision Workflow

Wikist now uses a small review layer instead of copying MediaWiki FlaggedRevs wholesale:

- Each page exposes a current revision ID and optional stable revision pointer.
- `senior_editor` and `admin` can approve or request changes with an auditable review note.
- Show readers a compact “latest / reviewed” switch and show contributors the diff since the stable revision.
- Add a paginated review queue filtered by category, age, contributor, and quality label.

[MediaWiki FlaggedRevs](https://www.mediawiki.org/wiki/Extension:FlaggedRevs) separates the newest draft from the reader-facing stable version, but its own documentation describes the extension as complex. Wikist should adopt the workflow, not its heavy multi-table rating system.

### Delivered: Structured Citation And Source Records

Wikist now provides portable structured reference records with author, title, publication, year, volume, issue, pages, DOI, arXiv, URL, access date, and note fields. Body syntax such as `[@hardy1908, p. 42]` creates numbered, clickable references while explanatory footnotes remain independent.

Article saves validate citation keys and resolver formats without making network requests. The reader sees completeness, verifier count, unresolved keys, and explicit `{{cite-needed}}` signals. The dashboard has a paginated source-review queue for no-source, unresolved, and incomplete records. The next refinement is citation style selection, optional DOI/arXiv metadata enrichment, and source-aware review approval.

### Delivered: Watchlists And Editorial Notifications

Users can already follow a page, category, or translation language, following the practical value of a [wiki watchlist](https://www.mediawiki.org/wiki/Help:Watchlist). A save, import, restore, delete, or translation update sends one direct message per matching active subscriber, reusing the existing inbox rather than creating a second notification system.

The next refinement is configurable digest delivery and review/comment-specific subscriptions.

### Delivered: Author Following And Portable Disambiguation

Readers can now follow contributors from public profiles, see mutual-follow state, and browse paginated following/follower lists. Followed-author article and translation updates reuse the existing inbox. Articles can also carry portable aliases, redirects, and disambiguation targets in Markdown front matter; safe rename repair now migrates the article's collaboration data and rewrites affected references. The next refinement is a guided disambiguation editor for larger encyclopedias.

## P1: Knowledge Navigation

### Delivered: Backlinks, Missing Pages, Redirects, Aliases, And Safe Moves

Wikist now maintains a persistent link index during page save, import, restore, and delete. It exposes backlinks, missing-page reports, orphan reports, and administrator-managed aliases that redirect old slugs to a live canonical page.

Article pages paginate incoming and outgoing links independently, keeping large link neighborhoods light. Moving a page checks target collisions, preserves an optional redirect, migrates revisions/reviewed snapshots and SQLite collaboration state, and repairs Wiki links plus metadata references. The next refinement is a “what links here” filter with richer editorial context.

### Delivered: Category And Topic Pages

Slash-separated categories and optional topic paths now form hierarchy pages with child paths, direct article lists, and aggregate quality distribution. The hierarchy is derived from Markdown metadata at read time and intentionally has no separate taxonomy database. A future refinement may add an optional category-introduction article, recent-change slice, and category review filter.

### Delivered: Mathematical Knowledge Metadata

Optional portable front matter now covers prerequisites, notation, canonical names, related pages, MSC/ACM classification, and topic. It is editable from the article screen and preserved by Wikist export/import. The next refinement is source-language and theorem-specific relation conventions, not a mandatory ontology.

## P2: Translation Quality

### Delivered: Translation Memory, Glossary, And Source Change Markers

The side-by-side workbench now offers per-language-pair exact-match translation memory populated only from approved translations, source snapshot comparison, and a community glossary with preferred translations, notation, notes, and discouraged alternatives. The glossary is paginated and searchable; only `senior_editor` and `admin` can curate it. The implementation stays in SQLite and uses Markdown paragraph boundaries rather than becoming a general localization platform. See [Translation Quality Layer](TRANSLATION_QUALITY.md).

[MediaWiki Translate](https://www.mediawiki.org/wiki/Extension:Translate) demonstrates the value of completion statistics, translation memory, source-change visibility, glossary aids, and proofreading. Wikist now implements the smallest useful subset around article sections; later work should focus on target-language link previews and translation coverage reporting.

### 8. Language-Aware Linking

Language-aware links now preserve the reader's language choice and fall back explicitly to the source when a target translation is not published. Translation review is now separate from article review: `draft`, `review`, `changes_requested`, and `published` protect unfinished work from readers. The next refinement is translation completeness and target-language titles in link previews.

## P3: Search And Performance

### 9. Persistent Search Index (Completed Baseline)

Wikist now provides an optional SQLite FTS5 index alongside the existing in-memory engine. It updates only the changed page on save/delete/restore, is explicitly backfilled from the dashboard instead of rebuilding during cold start, and automatically falls back to the lightweight engine when FTS5 is unavailable or a query needs fuzzy/phrase matching. The next search work should focus on observability and translation-aware indexing, not on introducing Elasticsearch.

### 10. Render And Media Cache

- Cache rendered Markdown by page revision and theme-independent content hash.
- Invalidate only the affected page, translation, link preview, and backlink rows after a save.
- Generate local responsive image variants and lazy-load article media.
- Add simple operational metrics: request duration, cache hit rate, search latency, and failed plugin loads. Do not log raw personal content or passwords.

## P4: Interoperability And Plugin Maturity

### 11. Reliable Exchange

- Improve Wikipedia imports with explicit handling reports for templates, citations, infobox-like structures, redirects, and categories.
- Add MediaWiki XML and Wiki.js-compatible export adapters as opt-in import plugins.
- Provide a machine-readable site export manifest so another Wikist installation can import content predictably.

### 12. Plugin Hook API

Evolve manifests into a small, documented extension contract:

- Explicit hook points: Markdown preprocess, block render, page metadata, search enrichment, admin panel, and client hydration.
- A capability declaration such as `content:read`, `content:transform`, or `admin:panel`.
- Server-side plugins remain disabled by default and require an administrator's explicit trust decision.
- Plugin configuration schema validation and upgrade migrations.

## P5: Community Governance

### Delivered: Writing Commons And Community Review

Wikist now has lightweight writing organizations, Passport-synced academic identities, a Markdown-authored organization home, independent paged task/forum/member workspaces, claimable writing/translation/review tasks, topic state with subscriptions and favorites, and threshold-based community consensus for exact article and translation snapshots. Request approvals, role changes, task events, and followed-topic changes reuse directed Passport messages rather than adding a separate forum service. See [Writing Commons And Community Review](WRITING_COMMONS.md).

### 13. Transparent Contribution Tools

- Contributor statistics based on edits, organization tasks, reviews, translations, and accepted citations rather than raw activity counts.
- Moderation reasons, reversible page protection, and rate limits for anonymous edits.
- A public quality dashboard that distinguishes article completeness, review status, source coverage, translation coverage, and active organization ownership.

## Not A Near-Term Goal

Do not add a mandatory message broker, graph database, Elasticsearch cluster, full template programming language, or unrestricted marketplace of server-side plugins. Those systems can be appropriate for a very large public encyclopedia, but they would weaken Wikist's promise of inspectable, portable deployment.

## Recommended Delivery Order

1. Stable revision workflow, review queue, and source records.
2. Category landing pages, rename repair, and richer link-graph reports.
3. Translation coverage reporting, target-language link previews, and lightweight render caching.
4. SQLite FTS5 observability, image variants, and exchange adapters.
5. Community governance metrics, organization health, and targeted moderation tools.

Each stage should ship with a focused migration, API contract, UI route, documentation update, and feature check. This keeps the system fast to deploy while steadily increasing its value as a serious knowledge wiki.
