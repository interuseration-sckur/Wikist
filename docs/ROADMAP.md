# Wikist Roadmap

Wikist already has its installation flow, Markdown article store, SQLite Passport, roles, page permissions, comments, ratings, favorites, messages, translations, import/export, backups, and mathematical rendering plugins. The next phase is not to add weight for its own sake; it is to make a serious knowledge community more trustworthy, navigable, and fast.

## Product Principles

- Preserve Markdown articles and SQLite as the default deployment model.
- Prefer incremental indexes and additive tables over mandatory external services.
- Make editorial state visible: readers should know whether content is draft, current, reviewed, or stable.
- Keep plugins declarative and permission-scoped; unknown code must never execute merely because it was copied into a directory.
- Optimize for a mathematics and science community, where sources, notation, translations, and proof quality matter more than social-feed mechanics.

## P0: Editorial Quality And Review

### 1. Stable Revision Workflow

Introduce a small review layer instead of copying MediaWiki FlaggedRevs wholesale:

- Add a per-page current revision and optional stable revision pointer.
- Let `senior_editor` and `admin` approve, request changes, or unpublish a revision with a short review note.
- Show readers a compact “latest / reviewed” switch and show contributors the diff since the stable revision.
- Add a paginated review queue filtered by category, age, contributor, and quality label.

[MediaWiki FlaggedRevs](https://www.mediawiki.org/wiki/Extension:FlaggedRevs) separates the newest draft from the reader-facing stable version, but its own documentation describes the extension as complex. Wikist should adopt the workflow, not its heavy multi-table rating system.

### 2. Citation And Source Records

Footnotes already exist; the next step is structured sources:

- Add a `cite` block or reference record with author, title, publication, year, DOI/arXiv/URL, access date, and optional page range.
- Render numbered references consistently and preserve them in import/export.
- Provide a “missing source” quality warning for claims marked historical, numerical, or externally attributed.
- Add a lightweight citation checker for malformed DOI, arXiv, and URL values without making network validation part of every page request.

This brings Wikipedia-style verifiability into Wikist without requiring template expansion or a large reference extension. The design should remain compatible with the reader expectations established by [MediaWiki Cite](https://www.mediawiki.org/wiki/Extension:Cite).

### Delivered: Watchlists And Editorial Notifications

Users can already follow a page, category, or translation language, following the practical value of a [wiki watchlist](https://www.mediawiki.org/wiki/Help:Watchlist). A save, import, restore, delete, or translation update sends one direct message per matching active subscriber, reusing the existing inbox rather than creating a second notification system.

The next refinement is configurable digest delivery and review/comment-specific subscriptions.

## P1: Knowledge Navigation

### Delivered Foundation: Backlinks, Missing Pages, Redirects, And Aliases

Wikist now maintains a persistent link index during page save, import, restore, and delete. It exposes backlinks, missing-page reports, orphan reports, and administrator-managed aliases that redirect old slugs to a live canonical page.

The next refinement is rename repair suggestions, category landing pages, and a “what links here” filter with richer editorial context.

### 5. Category And Topic Pages

Turn existing category metadata into first-class navigation:

- Category landing pages with an introduction Markdown file, child categories, recent changes, and quality distribution.
- A lightweight topic tree for mathematics branches, without requiring a graph database.
- Category subscriptions and editorial review filters.

### 6. Mathematical Knowledge Metadata

Add optional structured front matter for prerequisites, notation, canonical names, related theorems, MSC/ACM classification, and source language. The first implementation should remain optional and exportable as JSON; it should not turn ordinary article writing into a form-heavy CMS.

## P2: Translation Quality

### 7. Translation Memory And Glossary

Extend the current side-by-side workbench with:

- Per-language-pair translation memory built from approved translations.
- A community terminology glossary, including preferred Chinese names, English equivalents, notation notes, and forbidden ambiguous translations.
- Changed-source segment markers so translators only revisit affected paragraphs.
- Translation review states distinct from article review states.

[MediaWiki Translate](https://www.mediawiki.org/wiki/Extension:Translate) demonstrates the value of completion statistics, translation memory, source-change visibility, glossary aids, and proofreading. Wikist should implement the smallest useful subset around article sections rather than build a general software-localization platform.

### 8. Language-Aware Linking

When a reader changes language, resolve the closest available translation or clearly label the source-language fallback. Link previews should show translation completeness and the target-language title when it exists.

## P3: Search And Performance

### 9. Persistent Search Index

Keep the current in-memory index for small sites, then add an optional SQLite FTS5 index:

- Update only the changed page on save/delete/restore.
- Index title, aliases, summary, categories, body, and translation titles.
- Preserve the current query grammar and pagination API.
- Fall back automatically to the in-memory index when FTS5 is unavailable.

This is the right next step before Elasticsearch: it removes cold-start rebuild cost without adding a separate service.

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

### 13. Transparent Contribution Tools

- Per-page change summary and meaningful diff view.
- Contributor statistics based on edits, reviews, translations, and accepted citations rather than raw activity counts.
- Moderation reasons, reversible page protection, and rate limits for anonymous edits.
- A public quality dashboard that distinguishes article completeness, review status, source coverage, and translation coverage.

## Not A Near-Term Goal

Do not add a mandatory message broker, graph database, Elasticsearch cluster, full template programming language, or unrestricted marketplace of server-side plugins. Those systems can be appropriate for a very large public encyclopedia, but they would weaken Wikist's promise of inspectable, portable deployment.

## Recommended Delivery Order

1. Stable revision workflow, review queue, and source records.
2. Category landing pages, rename repair, and richer link-graph reports.
3. Translation memory, terminology glossary, and changed-source markers.
4. SQLite FTS5, render cache, and image variants.
5. Exchange adapters and a permission-scoped plugin hook API.

Each stage should ship with a focused migration, API contract, UI route, documentation update, and feature check. This keeps the system fast to deploy while steadily increasing its value as a serious knowledge wiki.
