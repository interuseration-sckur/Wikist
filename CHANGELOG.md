# Changelog

## 2026-07-11 - Academic Identity And Organization Forum

- Added Passport-synced academic organization identities to account and public user profiles, with a paginated identity directory that keeps pending memberships private.
- Reworked organization discussion into a dedicated forum view with searchable, filterable, sortable, pinned, open/resolved/locked topics and separately paginated Markdown replies.
- Added direct forum notifications for new topics and topic-author reply alerts, preserving the existing Wikist inbox and avoiding a separate social backend.
- Reframed every organization as a paged academic workspace: a Markdown-authored public home, task board, forum, and members/approval page now use one horizontal sub-navigation with responsive light and dark surfaces.
- Routed request membership, approval, role changes, task publication/claim/status changes, topic subscriptions, favorites, replies, and resolution events through the existing inbox without duplicating user or forum storage.
- Made user-facing site branding runtime-configurable across the homepage, Passport shell, account surface, administration shell, email verification/reset templates, and static chrome. Fresh homepages now use the neutral title “首页” instead of a hard-coded product greeting.
- Made writing organizations a first-class functional entry in the primary navigation, quick navigation, homepage collaboration console, organization overview, and article task context.
- Expanded article organization context from review-only work to paginated writing, translation, and review tasks, while retaining the existing community-review consensus panel.
- Bumped the framework package to `0.11.0` and the frontend asset version to `wikist-core-20260711-78`.

## 2026-07-11 - Writing Commons And Community Review

- Added self-contained writing organizations with direct or request-based joining, durable member roles, coordinator-managed task boards, and a paginated Markdown discussion stream.
- Added claimable article-writing, translation, and review tasks. Organization updates and consensus events reuse the existing inbox instead of creating a second notification backend.
- Added threshold-based community review for exact page revisions and translation snapshots. Eligible organization reviewers can form a documented approval or changes-requested consensus; approval creates a stable page snapshot or publishes the reviewed translation.
- Added article-level organization task visibility and community review panels in both page and translation review workflows, while retaining senior-editor direct review as a maintenance path.
- Changed `#/translate/<slug>` into an explicit target-language chooser; the actual workbench requires `?lang=<language>` and no longer silently defaults to English.
- Added [writing commons documentation](docs/WRITING_COMMONS.md) and `npm run check:v10` coverage for roles, tasks, threads, consensus, publication, and authorization boundaries.
- Bumped the framework package to `0.10.0` and the frontend asset version to `wikist-core-20260711-76`.

## 2026-07-11 - Translation Quality Layer And Governance Workbench

- Rebuilt per-article governance into a responsive two-column workbench: access policy, move/rename, and archive-delete now use available desktop width while retaining a single, readable mobile flow and matched light/dark controls.
- Added review-gated translation memory in SQLite. Only published translations contribute normalized paragraph pairs; drafts and pending reviews are never offered as suggestions.
- Added source-snapshot comparison and bounded changed-paragraph markers in the translation workspace, so translators can see when an existing target needs revisiting without an automatic overwrite.
- Added a paginated, searchable translation glossary with source/target language directions, preferred terms, notation, notes, discouraged alternatives, and reviewer-only curation.
- Added [translation quality documentation](docs/TRANSLATION_QUALITY.md) and `npm run check:v09`, covering review-gated memory, source changes, glossary access, and safe page-move rekeying.
- Bumped the framework package to `0.9.0` and the frontend asset version to `wikist-core-20260711-74`.

## 2026-07-11 - Knowledge Navigation, Safe Article Moves, And Translation Review

- Added portable mathematical article metadata: prerequisites, related pages, canonical names, notation conventions, MSC/ACM-style classifications, and topic paths. It is editable with the article and preserved by Wikist export/import.
- Added first-class category and topic routes. Slash-separated metadata derives parent/child navigation and aggregate quality distribution without a graph database or taxonomy migration; redirects are excluded from these counts.
- Added a privileged article-move workflow. It moves Markdown, revisions, reviewed snapshots, permissions, edits, comments, ratings, favorites, translations, watches, aliases, and message URLs; it also repairs affected Wiki links and metadata references, with collision guards before any history is merged.
- Reworked article-level knowledge links into separate bounded outgoing/backlink pagination. Each panel defaults to eight rows and fetches only its requested page, keeping large link neighborhoods responsive.
- Added translation review states: `draft`, `review`, `changes_requested`, and `published`. Readers see published translations only; translators and senior editors retain their appropriate workspace visibility, and a fresh translation save clears a stale decision.
- Added language-aware article links, so non-source reading routes preserve the selected language and provide a clear source fallback when no published target translation exists.
- Added [knowledge-navigation documentation](docs/KNOWLEDGE_NAVIGATION.md), [translation-review documentation](docs/TRANSLATION_REVIEW.md), and `npm run check:v08` coverage for metadata, hierarchy pages, safe moves, rekeyed watches/favorites/translations, and paginated backlinks.
- Bumped the framework package to `0.8.0` and the frontend asset version to `wikist-core-20260711-73`.

## 2026-07-11 - Controlled Plugin Hook API

- Defined manifest-declared Hook contracts for Markdown preprocessing, block rendering, search enhancement, and admin panels, each with an explicit required permission.
- Routed first-party magic words, mathematical block renderers, and search-result finishing through the core Hook dispatcher without changing the trusted server-module boundary.
- Kept every external `serverModule` declarative and non-executable by default; only code explicitly registered in the Wikist core can supply server-side Hook handlers.
- Added a trusted `pluginHooks` client module and **Admin -> Hook API** panel that exposes each plugin's declared or blocked capabilities, including the service-side execution boundary.
- Added manifest validation, Hook capability chips in Plugin management, `npm run check:hooks`, and updater coverage.
- Bumped the framework package to `0.7.0` and the frontend asset version to `wikist-core-20260711-72`.

## 2026-07-11 - SQLite FTS5 Persistent Search

- Added an optional SQLite FTS5 full-text index in the existing Passport database; no Elasticsearch, service process, or startup-wide Markdown scan is required.
- Page create, save, restore, and delete now update or remove only the affected persistent search row through the PageStore change stream. Existing link and watch updates remain incremental in their established save path.
- Kept the lightweight field-weighted search engine as a transparent fallback until an administrator explicitly backfills the historical FTS index, when FTS5 is unavailable, and for quoted-phrase or fuzzy search behavior.
- Added **Admin -> Search Index**, with SQLite compatibility, coverage, document-count, update-time status, and a deliberate historical backfill action.
- Added FTS5 lifecycle documentation and temporary-database checks for Chinese/English search, incremental update, and deletion.
- Bumped the framework package to `0.6.0` and the frontend asset version to `wikist-core-20260711-71`.

## 2026-07-11 - Watch Delivery And Review Workflow

- Article saves now return the actual targeted-notification count and current review state; page, category, language, and author followers continue to receive one direct inbox update per matching save.
- Reworked the article follow control around “follow updates” and made the Account -> Watchlist action fill its panel instead of appearing as a small orphaned link.
- Completed the edit-to-review path: every save creates the current revision, clearly enters the pending-review queue, and gives senior editors a direct choice to open the diff and approve a reviewed stable snapshot.
- Rebuilt the review-decision surface with native Wikist CSS controls, responsive action cards, accessible focus states, and coordinated light/dark themes.
- Review opinions are now paginated ten at a time. Their original senior-editor author can withdraw them; withdrawing the approval that currently defines stability safely restores the latest remaining approval or clears the stable pointer.
- Explicit article, category, and language subscriptions now also receive their own saved update in the inbox, so a contributor can verify the subscription pipeline without relying on a second account.
- Fixed review-note withdrawal route parsing for nested and ordinary article slugs; no manual slug field is required.
- Fixed route precedence so a review-note withdrawal is handled before the generic page-delete endpoint.
- Bumped the framework package to `0.5.3` and the frontend asset version to `wikist-core-20260711-70`.

## 2026-07-11 - Final Light Surface Coverage

- Added light-theme coverage for Plugin management syntax previews, code text, horizontal scrollbars, and the Import / Export signed-in identity card.
- Bumped the framework package to `0.5.2` and the frontend asset version to `wikist-core-20260711-68`.

## 2026-07-11 - Light Admin Surface And Review Pagination Fix

- Changed source review and version review to ten rows per page and rendered their pager directly below the filter controls as well as after results.
- Rebuilt the two review filter bars as consistent first-class search controls instead of inheriting the legacy admin form treatment.
- Added a final light-theme surface layer for admin forms, selects, textareas, source/review workbenches, plugin and import panels, tables, pagers, diff panels, and backup progress bars.
- Bumped the framework package to `0.5.1` and the frontend asset version to `wikist-core-20260711-67`.

## 2026-07-11 - Lightweight Stable Revisions And Review Workbench

- Added current-versus-reviewed-stable article states, immutable reviewed Markdown snapshots, review notes, a paginated pending-review queue, and bounded line-level diff comparison.
- Limited review approval and change requests to senior editors and administrators while keeping ordinary article editing unchanged.
- Rebuilt Admin -> Source review as a compact responsive review list and changed editor references into collapsed summary records with expand/collapse controls.
- Included reviewed snapshots in backup, restore, and update protection; added `npm run check:reviews`.
- Bumped the framework package to `0.5.0` and the frontend asset version to `wikist-core-20260711-66`.

## 2026-07-11 - Structured Citations And Source Quality

- Added portable structured article references with authors, title, type, publication, year, volume, issue, pages, DOI, arXiv, URL, access date, language, and verification notes.
- Added `[@cite-key]`, locator, and multi-source citation syntax with numbered, back-linked reference rendering; explanatory footnotes remain independent.
- Added explicit `{{cite-needed|reason}}` markers, unresolved-key detection, field completeness, verifier counts, and a source-quality score on article pages.
- Added an editor reference manager with citation insertion, import/export preservation, attributed Wikipedia import source records, and a paginated Admin -> Source review queue.
- Added DOI/arXiv/URL/year/key validation plus `npm run check:citations`; the updater now runs the citation check.
- Bumped the framework package to `0.4.0` and the frontend asset version to `wikist-core-20260711-65`.

## 2026-07-11 - Article Redirects, Disambiguation, And Social Following

- Fixed the public knowledge-network layout so missing-page and orphan-page panels use independent, paginated lists instead of stretching each other.
- Added portable article front matter for `aliases`, `redirectTarget`, `disambiguation`, and `disambiguationTargets`; creator roles and above can manage aliases and redirects directly while editing an article.
- Added a Wikipedia-style disambiguation panel for one title with multiple concept targets.
- Added `user_follows`, public profile follow controls, mutual-follow state, paginated following/follower lists, and direct inbox updates when a followed author changes an article or translation.
- Extended `npm run check:knowledge` to verify redirects, editor-managed aliases, disambiguation metadata, user follows, and directed follow notifications.
- Bumped the framework package to `0.3.0` and the frontend asset version to `wikist-core-20260711-64`.

## 2026-07-11 - Knowledge Network, Watchlists, And Aliases

- Added SQLite-backed page, category, and translation-language subscriptions. Matching active users receive direct inbox notifications after article saves, imports, restores, deletes, and translation saves.
- Added an incremental Wiki-link index with backlinks, missing-page and orphan reports, plus administrator-managed aliases and redirects.
- Added article-level follow controls, a personal watchlist, a public knowledge-network view, and an editorial knowledge-management dashboard.
- Added `npm run check:knowledge`; the updater now runs it after the syntax check and records package plus asset versions in its update report.
- Bumped the framework package to `0.2.0` and the frontend asset version to `wikist-core-20260711-63`.

## 2026-07-11 - Architecture And Roadmap Synchronization

- Rewrote the architecture document to describe the implemented Node.js, Markdown, SQLite, Passport, collaboration, plugin, import, backup, and caching model rather than the original 0.1 prototype.
- Replaced the obsolete roadmap with a lightweight delivery plan centered on stable revisions, source records, watchlists, link indexes, translation memory, SQLite FTS5, and permission-scoped plugins.
- Added a bilingual README documentation map and kept the code-level upgrade changelog as the source of framework migration history.

## 2026-07-11 - Sci-Fi Cosmic Experience Plugin

- Replaced the previous dashboard-style home/auth visuals with animated canvas cosmic scenes: starfields, nebula glow, spiral arms, and comet-like warp streaks.
- Reworked the home portal around a cinematic orbital data stage with rotating rings, planet-like core metrics, and floating readouts.
- Reworked the Wikist Passport login/register UI into a cosmic access console with live animated site metrics: registered users, public pages, recent updates, and current identity.
- Added the `cosmicExperience` client plugin for a full-screen warp intro, mouse-parallax nebula, login black-hole accretion disk, homepage title particle aggregation, and sci-fi route-loading progress HUD.
- Added language-aware cosmic UI text for Simplified Chinese, Traditional Chinese, and English.
- Improved light/dark theme adaptation for the homepage hero, Wikist Passport panel, orbital readouts, sci-fi content panels, route loader, warp intro, black-hole accretion disk, and title particles.
- Added theme-aware captcha SVG recoloring so the human verification image uses a light palette in light mode and a dark palette in dark mode.
- Fixed light-theme code block contrast so rendered code text no longer stays white on pale code panels.
- Kept homepage title text readable while particle aggregation plays, increased particle sampling density, and removed login/register engineering jargon such as `SESSION HANDSHAKE`.
- Split the homepage title so `欢迎来到` stays as a readable white label while only `Wikist` is rendered as particles, keeping the desktop title on one line.
- Re-centered the Passport cosmic stage in the left panel and expanded the animation area to remove the large empty space below the orbital visual.
- Changed route loading into a full-screen warp-style loading layer so sci-fi loading appears whenever route work takes noticeable time.
- Versioned trusted client plugin imports with the core asset version to avoid stale CDN/browser caches after cloud updates.
- Added reduced-motion handling and responsive rules for the new cosmic visual components.
- Bumped the core frontend asset version to `wikist-core-20260711-62`.

## 2026-07-11 - Route And Admin Responsiveness

- Batched post-render math rendering, function plots, plugin hydration, and language conversion into a single idle task per route change.
- Scoped plugin hydration and function-plot scans to the current content root instead of scanning the whole document on every navigation.
- Reused a short-lived user-session cache for admin navigation and moved message-badge refreshes into the background to reduce tab-switch latency.
- Added a delayed route-pending visual state for slow navigations without flickering on fast page changes.
- Bumped the core frontend asset version to `wikist-core-20260711-48` and documented cache/CDN verification after cloud updates.

## 2026-07-10 - Cloud Asset Performance And Site Icon

- Added static asset `ETag`, `Last-Modified`, `304`, Brotli/gzip, and versioned cache handling to reduce slow cloud CSS / JS loads.
- Deferred SweetAlert2 and MathJax loading so ordinary homepage visits do not fetch nonessential UI or math CDN assets.
- Added configurable site icon support through the installer, admin settings, runtime HTML, and `config/site.config.example.json`.
- Added `public/uploads/` as a site-local protected directory for icons and similar public files.
- Updated README deployment, CDN, Nginx gzip, update-protection, and troubleshooting notes.

## 2026-07-10 - Home Portal Fallback And CDN Notes

- Kept the configured home portal modules visible even when the default home article has not been created.
- Added a home body fallback that says no related content exists and links directly to create the home article.
- Added Chinese README notes for slow access in Chinese regions and CDN replacement/self-hosting strategies.

## 2026-07-10 - Dirty Working Tree Update Handling

- Added `--stash-dirty` to `tools/update.js` so cloud updates can preserve local tracked changes before syncing upstream code.
- Update failure reports now include `dirtyFiles` and optional stash metadata.
- Documented the `Tracked working tree changes exist` updater error and the recommended inspection, stash, and recovery commands.

## 2026-07-10 - Git Safe Directory Update Fix

- Fixed `tools/update.js` Git strategy when the updater is run through `sudo` against a repository owned by the `wikist` user.
- Git commands now use a command-scoped `safe.directory` for the current Wikist root instead of requiring global Git configuration.
- Documented the `fatal: detected dubious ownership in repository` error and the short-term / long-term fixes in the README.

## 2026-07-10 - Update Program And Config Uninstall

- Added `tools/update.js`, a deployment updater with Git and local-release strategies, pre-update backups, service stop/start support, dependency install, syntax checks, protected runtime paths, and update reports.
- Added `npm run update` and expanded `npm run check` to cover installer and update scripts.
- Added maintenance-mode install config uninstall: `/install.html` can move `config/site.config.json` into `data/backups/config-uninstall/` when started with `WIKIST_INSTALL_MODE=1`.
- Documented cloud update, rollback, local package sync, and initialization rollback workflows in Chinese and English README sections.

## 2026-07-10 - Cloud Deployment And First Admin Flow

- Added a full Chinese / English cloud deployment guide covering clone, Node.js, systemd, Nginx, HTTPS, initialization, backups, updates, customization, and troubleshooting.
- Added installer-first routing: an uninitialized site now redirects normal homepage access to `/install.html`.
- Added the first-admin bootstrap flow: after installation and restart, a site with no administrator prompts for the first admin account from the homepage.
- Changed the first registered account to receive the `admin` role automatically and avoid SMTP lockout during initial setup.

## 2026-07-10 - Bilingual README

- Reworked README into a bilingual Chinese / English document with language jump links.
- Preserved the full Chinese project introduction and added a complete English version for international readers.
## 2026-07-10 - Chinese README And Framework Positioning

- Rewrote README in Chinese.
- Added Wikist framework positioning, target scenarios, core strengths, install-first release scope, and production notes.
- Added a full comparison with MediaWiki across deployment, storage, math rendering, visualization, editing, permissions, plugins, customization, and scale.

## 2026-07-10 - Portable GitHub Release

- Prepared the repository for a minimal, install-first GitHub publication.
- Kept core server code, browser UI, installer, documentation, local trusted plugin manifests, and portable assets.
- Excluded local deployment data: `data/`, `logs/`, SQLite files, user accounts, sessions, comments, ratings, messages, audit logs, page content, revisions, deleted archives, and site-local `config/site.config.json`.
- Added empty directory placeholders so a fresh clone has the expected project shape while `/install.html` remains responsible for writing the runtime configuration.

## 2026-07-10 - Installer, Passport, Plugins, and Operations

- Added `/install.html` for first-run portable configuration, including site identity, SQLite path, editing policy, and optional SMTP.
- Added Wikist Passport features for accounts, sessions, email verification, password reset, TOTP, public profiles, audit logs, comments, ratings, favorites, messages, and translation community data.
- Added plugin catalog management with manifest-only, core, clone-ready, and trusted client-module states.
- Added mathematical rendering plugins for function plots, JSXGraph geometry boards, and Chart.js data models.
- Added backup inspection and restore support with path allowlists and safety backups.
- Added Windows launch scripts and fixed-port restart behavior for local deployment.



