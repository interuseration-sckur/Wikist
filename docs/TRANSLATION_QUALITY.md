# Translation Quality Layer

Wikist v0.9 adds a small translation-quality layer on top of the existing article translation workflow. It is deliberately scoped to article Markdown and the existing SQLite Passport database: no external machine-translation account, vector service, or localization platform is required.

## What Is Stored

Two additive SQLite tables are created automatically when Passport starts:

- `translation_memory`: approved paragraph pairs keyed by source language, target language, and a SHA-256 source-segment hash.
- `translation_glossary`: community-curated preferred terms, notation, explanations, discouraged alternatives, lifecycle status, and editor attribution.

The canonical article remains `content/pages/<slug>.md`. Translation memory is a reusable suggestion cache, not a second source of truth. A backup that includes user data already includes these tables because they live in the Passport SQLite database.

## Review-Gated Translation Memory

Only a translation that reaches `published` through a `senior_editor` or `admin` review is copied into translation memory. Draft, review-queue, and changes-requested translations never enter the memory table.

Wikist uses blank-line Markdown paragraphs as its intentionally lightweight segment boundary. During approval it pairs source and target paragraphs by position, skips empty or identical pairs, and stores the normalized source hash. On a later translation workspace visit, only exact source-segment hash matches are suggested. This keeps retrieval predictable and avoids pretending that a simple local heuristic is a semantic translation engine.

Re-approving a translation refreshes its entries. Moving a page rekeys the owning page slug and repairs Wikist links inside saved memory text along with the existing translation migration.

## Source Change Markers

Every saved translation keeps a source Markdown snapshot. The workspace compares the snapshot's normalized paragraph hashes with the current source page and reports added and removed source segments.

- An unchanged source shows an explicit current-state marker.
- A changed source shows a bounded list of changed paragraph previews.
- Translators still decide how to rewrite the target; Wikist does not silently overwrite translated content.

The same check is exposed in translation summaries as `sourceChanged`, so language badges and later quality reports can distinguish an incomplete translation from an out-of-date one.

## Community Glossary

Open `#/translation-glossary?source=zh-CN&target=en` to browse a language pair. It provides server-side pagination and search across source terms, preferred targets, notation, and notes.

- Members of the translation community can browse active glossary entries and translation-memory results.
- `senior_editor` and `admin` can create, update, deactivate, or delete glossary entries.
- Re-saving the same language pair and source term updates that record rather than creating duplicates.

The article translation workspace displays matching active terms. Selecting a memory or glossary suggestion inserts its target text at the Markdown cursor; it never auto-saves or bypasses editorial review.

## API Surface

Authenticated translator-community members and reviewers may request:

```text
GET /api/translation-memory?source=zh-CN&target=en&page=1&limit=12&q=group
GET /api/translation-glossary?source=zh-CN&target=en&page=1&limit=16&q=group
```

Glossary curation is reviewer-only:

```text
POST   /api/translation-glossary
DELETE /api/translation-glossary/:id
```

The article workspace endpoint adds an `assistant` payload when the caller has translation-quality access:

```text
GET /api/pages/<slug>/translation?lang=en&workspace=1
```

`assistant` contains `sourceChanges`, a bounded exact-match `memory` list, and source-page-matching active `glossary` entries. An ordinary reader receives neither unpublished translations nor quality-assistant data.

## Verification

```powershell
npm run check:v09
```

The check uses a temporary SQLite database and verifies that drafts do not enter memory, reviewed translations do, source changes are visible, glossary terms are structured, ordinary readers are denied, and page moves rekey memory ownership.
