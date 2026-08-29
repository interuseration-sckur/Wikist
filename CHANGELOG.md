# Changelog

## 1.0.4 - 2026-08-29

- Completed the built-in English interface across the public application, Passport, installer, Community and selection tools while preserving article, question, answer, organization and other user-authored content without machine translation.
- Added immediate username and email availability feedback during registration, administrator SMTP test delivery, clearer Brevo activation failures, and production permission repairs for service environment files and Centrifugo runtime directories.
- Made XML sitemaps read current published content on every request, bypassing catalog snapshots and stale proxy cache windows after imports, edits, restores and deletions.
- Strengthened homepage discovery with canonical metadata, brand aliases, crawlable links to Wiki, Q&A and collaboration discussions, and structured primary-site navigation for search engines.
- Added regression coverage for English UI boundaries, sitemap freshness, homepage SEO metadata, deployment hardening and mail administration. Organization profile summaries now use the full available content width. Core browser assets are versioned as `wikist-core-20260829-217`.

## 1.0.3 - 2026-08-16

- Fixed the pre-update streaming backup path so it automatically creates a short-lived redacted SQLite snapshot when the caller does not provide one, then removes the snapshot after packaging.
- Unified Passport and updater snapshots on the same sanitizer, preserving account data while excluding sessions, temporary tokens, captcha state, presence leases, pending email changes and pending two-factor secrets.
- Automatically restart the unchanged systemd service when an update fails during the stop or backup stage, before any code has been fetched or replaced.
- Added the real streaming snapshot regression to the default release checks.

## 1.0.2 - 2026-08-16

- Added crawlable server-rendered routes for published Wiki entries, public Q&A and public organization discussions, with canonical URLs, pagination, Open Graph metadata, Article/QAPage/DiscussionForumPosting JSON-LD, robots policy and automatically split sitemaps.
- Unified those clean public URLs with the existing Wikist application shell: crawlers receive complete server-rendered content while browsers progressively enhance the same URL into the established Wiki, Q&A and organization interfaces, without a duplicate public-page design or user-agent branching.
- Added an administrator indexing switch, draft exclusion by default, public discussion indexing without a second data store, homepage metadata injection, SEO regression checks and deployment documentation.
- Added production-only diagnostics and repair commands for systemd ownership, protected environment files, Centrifugo health/key consistency, internal listeners, and local/public WebSocket routing, with pre-repair snapshots and optional validated Nginx include generation.
- Prevented the hybrid launcher from writing source-tree environment files under systemd, repaired ownership across existing runtime trees, enabled the loopback Centrifugo health probe, and documented full Ubuntu, BT Panel/Nginx, upgrade, verification, and incident-recovery workflows.

## 1.0.1 - 2026-08-16

- Hardened authentication, authorization, trusted-origin handling, attachment and path validation, secret management, log redaction, realtime channels, and administrative recovery without changing the Passport identity model.
- Added upgrade preflight, verified backups, migration reporting, deployment diagnostics, repair and administrator recovery commands, service configuration generation, and release integrity tooling.
- Improved SQLite write coordination and operational checks, added migrations `0017` through `0022`, and made organization knowledge communities consistently open while preserving role-based governance.
- Fixed realtime reconnection, collaboration routing, static asset cache invalidation, administration API fallbacks, and responsive article, category, organization, Q&A, account and mobile layouts.
- Updated the user documentation with current installation, deployment, backup, recovery, and in-place upgrade instructions.

## 1.0.0 - 2026-08-15

- Unified Q&A comment actions with the answer composer, including equal clear/publish controls, a compact attachment toolbar, responsive sizing, and shared Design System states. Organization forum topics and replies now use the same knowledge-reference picker, canonical `{{ref:...}}` syntax, rendered reference cards, and global relation graph as Q&A and Messaging. Existing forum content is backfilled by migration `0016_organization_forum_knowledge.php`. Messaging member governance now uses an opaque, spacious top-layer ellipsis popover that cannot collide with member content; inherited context-panel rules are scoped to direct sections so popover padding and field rhythm remain intact. All-member mute and unmute changes persist as centered conversation timeline events and update through the existing realtime channel. Collaboration routes highlight exclusively, moderation updates preserve the realtime subscription, and lease-backed presence is merged with Centrifugo presence so mute changes cannot flip users offline. Added a CLI-only root `update.php` with pending-migration inspection, verified SQLite snapshots, migration reports, post-run checks, and safe coordination with `tools/update.js`; local-package updates now copy migration files as well as schemas. Promoted the framework to `1.0.0` with core assets `wikist-core-20260815-191`.
- Added a native question-source layer for selection, Wiki/page and organization provenance, with source badges and feed filtering. Soft-deleted Community content now clears its full engagement tree and self-heals legacy follow/collection rows; Q&A navigation fills four columns and authoring forms share a Wikist clear-input action. Added migration `0015_community_question_sources.php` and core assets `wikist-core-20260815-186`.
- Unified the answer edit/compose knowledge picker on one Wikist control style, compacted rendered answer references, and prevented flat comment replies from rendering duplicate `@user` mentions. Account Center now keeps all six sections on one row, earned labels use an explicit success state, and public profiles keep seven metrics on one horizontal strip. Removed the redundant public Community Activity/badge lists in favor of spaced reputation and privacy-safe site growth summaries backed by a five-minute aggregate cache. Core assets now use `wikist-core-20260815-185`.
- Unified Q&A detail navigation and answer authoring: nested question routes now retain the active sidebar state; invitation fields use one full-width Wikist control system; edit and compose views share a horizontal knowledge-reference/attachment toolbar whose picker opens upward; publish remains anchored at the lower right; answer references render as full knowledge cards and feed the question-level relation panel. Expanded the legacy Community badge store into a throttled site-wide achievement domain covering Wiki editing, curation, follows, organizations, translation, annotations, messaging and Q&A, with notifications plus a paginated Account Center growth timeline. Added migration `0014_site_achievements.php` and core assets `wikist-core-20260815-184`.
- Removed the retired Go/Apache Answer runtime and AnswerBridge compatibility layer. The unified launcher now supervises only Webman, the loopback Node compatibility process, and Centrifugo; stack configuration is upgraded to version 2 automatically. Legacy bridge routes, services, admin migration UI, plugin source, caches, runtime data and six bridge-only tables were removed while preserving all Wikist-native Community and knowledge-graph data.
- Replaced the Answer-backed Q&A path with **Wikist Native Community** as the source of truth. Webman now owns questions, answers, flat `@` comment replies, answer invitations, acceptance and revocation, quality votes, reactions, collections, follows, tags, feed ranking, revisions/Diff, community edit proposals, activity, reputation, badges, reports, review queues, attachments and Wiki drafts in Wikist tables. Passport remains the only identity source; organization spaces reuse existing memberships and map owner/coordinator/reviewer roles into moderation without a second permission system. Private organization visibility is enforced across feed, detail, search, preview, relation, moderation and notification paths. Community events reuse Messaging/Centrifugo and synchronize stable knowledge objects and relations. Added native migrations `0010_native_community.php` and `0011_community_answer_invites.php`, public and organization Community UI, organization governance, administration queues, a source-audit migration matrix, and `npm run check:community` regression coverage.
- Rebuilt Account Center highlight cards as a single search-result grid: the rank rail is no longer crossed by a split footer, selected text fills the left column below its activity badge, and compact actions sit below the date on the right. Translation workspace light-mode tabs use shared surface tokens, raw Markdown has one scroll owner, and the redundant upper workspace divider was removed. Translator language tiles now follow the checkbox state without stale outlines, members can leave the translation community without deleting saved translations or review history, and glossary/leave actions share one control size. The authenticated Webman identity is now carried over the internal-token proxy boundary so legacy translation APIs cannot misread a valid Passport session as a guest. Selection anchors can be recreated after deletion instead of colliding with their tombstones, and cancelling the final like automatically prunes an anchor with no annotations, references or remaining likes. New visitors start in light mode while an explicit saved preference is preserved; persistent selections are clearer in dark mode, and liked selection controls update their visible count with a complete rose semantic state. Core assets now use `wikist-core-20260810-175`.
- Completed the first-class text-selection workflow: personal highlights now contain only liked text and published annotations, source links deep-link back to the exact article range, delete controls require ownership plus a real like or annotation, and annotation replies remain flat while preserving their `@user` target. Equivalent anchors with small context or offset changes are consolidated transactionally, so liked entries and annotation entries open the same discussion; legacy ids redirect without losing likes, comments or references. Account Center can delete individual annotations, its rank rail remains visually continuous, empty annotation states are unframed, and the wider dialog scales across desktop and mobile. Added migration `0008_selection_comment_replies.php` and bumped core assets to `wikist-core-20260810-169`.
- Isolated the advanced-search route query from the topbar and sidebar search controls; each search surface now owns its input state. Missing single-segment article routes expose a creation entry while malformed nested routes remain strict 404s, article author chips link to public profiles, and forwarding caps recent direct recommendations at six. New accounts implicitly treat broadcasts published before registration as read without per-user state rows. Social-relation lists now draw one separator; administration identity content stays inside real table cells so row dividers remain continuous, and table hover states no longer create cell-by-cell white overlays. Messaging image attachments now reuse the article image viewer. Core assets now use `wikist-core-20260810-162`.
- Polished the article and messaging integration: cover-image metadata now keeps clear bottom spacing, translation controls no longer expose a parent-surface corner in light mode, and the light unread badge uses a clean high-contrast semantic color. Article forwarding now uses the shared Wikist input/list components and recommends recent direct contacts and organization chats before search.
- Exposed communication preferences inside Account Center security, refreshed public-profile follower statistics immediately after follow changes, and made direct-request conversations unlock as soon as a real peer reply arrives. Realtime events now recalculate message ownership from the event actor instead of reusing the sender-oriented payload; bounded polling applies the same policy refresh. Core assets now use `wikist-core-20260809-158`.
- Added native article sharing to direct and organization conversations with typed Wiki references; tightened nested page routing so API subresource collisions render a deliberate 404; kept article metadata on the full available row; and rebuilt warning/danger/tip/info containers with distinct high-contrast light and dark palettes.
- Added communication preferences for closed-by-default message requests and lease-aware offline auto replies. Non-mutual contacts may send one request until the recipient replies, automatic replies do not unlock the request limit, and open mode remains an explicit opt-in.
- Added organization-chat owner, administrator and member roles, owner-managed administrator assignment, per-member timed mute, all-member mute and server-side enforcement. Organization role synchronization now preserves chat administrators instead of overwriting them on access.
- Hardened the upward `@` picker against stale asynchronous responses and IME/caret changes; added strict messaging policy regression coverage to the default Webman checks. Core assets now use `wikist-core-20260809-157`.
- Unified article entry headers so pages with and without cover images share the same framed surface; removed the remaining review/permission width caps; rebuilt import overwrite controls as aligned theme-aware checkboxes; kept the image viewer close control readable over its dark overlay; and made light function plots use neutral transparent surfaces.
- Rewrote UI helper text across the public site, community, messaging, review, translation, account, administration, Passport, import/export, backup, and installer flows. Copy now states the next action or its user-visible result instead of exposing implementation details; Wiki article Markdown remains untouched. Added `npm run check:copy` to prevent retired explanatory phrases from returning.
- Finished the navigation and workspace fit pass: Passport scene choices no longer expose decorative captions; light profile links use theme-native marks; administration retains both the global site sidebar and its management sidebar while keeping the topbar sticky; route changes reset document scroll; the messaging context drawer closes on outside clicks; the composer fills its parent without an empty status gap, dark inset mask, or focus halo; organization results use one compact search-style row per organization; totals follow data as unframed intrinsic-width text without reserved height; empty task queues collapse naturally; and favorites/listing headers no longer inherit article-summary width caps. Passport CSS uses `wikist-passport-20260809-8`.
- Hardened private-message delivery against account lifecycle changes: starting or sending a direct conversation now rejects banned and deleted recipients with distinct API errors, while an attempted send remains visible locally with a WeChat-style red failure marker, retry/edit action, and no durable database write.
- Made system notifications and site broadcasts strictly read-only in both Webman authorization and the browser UI; message-level reply controls and the composer are removed while per-user soft hide remains available.
- Replaced session-shaped online inference with tab-scoped presence leases. Each browser tab heartbeats independently, releases its lease on hide/page exit/window close, and falls back to a 40-second expiry after crashes; Centrifugo channel presence and join/leave events are authoritative when realtime transport is enabled.
- Finished the realtime responsive pass: message history has an independent vertical scrollbar, the composer fills the thread footer, the context rail collapses on constrained widths, organization forum/task layouts stack before overlap, member cards use fluid inner tracks, article rails disappear below 1500px, and admin content consumes the available workspace width.
- Made the legacy notification bridge resolve its bundled Webman schema outside temporary data roots, restoring isolated organization/backup fixtures; the bridge is now included in the default JavaScript syntax check.
- Completed the realtime collaboration polish pass: presence now comes from a dedicated heartbeat table rather than durable Passport sessions, initial conversation/profile presence is hydrated before first paint, Centrifugo `presence.changed` and `conversation.read` events update online/read state, and stale peers expire from the client cache.
- Made Messaging filters and conversation selection fully asynchronous inside the existing workspace, including automatic thread/context switching, URL synchronization, bounded polling fallback, failure recovery, pinned/regular conversation groups, read counts beside timestamps, compact peer biography/social links, folded private member lists, and non-stretching reference/settings controls.
- Capped the topbar communication preview at four visible conversations with a folded remainder and bounded scrolling; route changes now always close the preview. Light-theme social links and soft-delete confirmation controls use semantic surfaces instead of inherited dark fills.
- Kept collaboration pagination totals at the foot of short result panels, removed forum composer overlap at intermediate transition widths, and extended administration surfaces to the full available content width. Frontend assets now use `wikist-core-20260809-150`.
- Added an incremental title/slug/alias prefix index and `/api/search/suggest` endpoint for one-character, Wikipedia-style asynchronous article suggestions. Topbar, root portal, advanced search, and collaboration task slug inputs now share an IME-aware, abortable, cached, keyboard-accessible combobox; the compact sidebar remains a direct-submit search, full results reuse the same short-prefix semantics, and the task composer separates type/priority from full-width article and language fields.
- Reworked navigation and authenticated account chrome: the global quick navigation and all topbar controls now sit directly on the navigation surface without visible frames, while article and organization tabs retain the account-center paged navigation component. Administration entry points are confined to eligible users' account center; the signed-in account entry is an unframed avatar-and-name link plus a dedicated topbar logout control, collapsing reliably to the avatar alone on narrow screens, while Passport login/register URLs become a full current-session screen with continue, logout, and switch-account actions.
- Unified the collaboration forum directory with the organization workspace header used by Home, Tasks, Members, and topic detail views, including the same cover image, avatar, title hierarchy, statistics, spacing, and active workspace navigation.
- Unified Community Identity and Collaboration Commons with the account-center surface language: organization cards now keep intrinsic content height inside aligned account columns, the collaboration heading/search/list share one width baseline, and the create-organization panel no longer carries a separate green skin. Light-mode home/admin elevation and primary control text now retain clear hierarchy without restoring hard dashboard outlines.
- Added a search-first root portal inspired by documentation knowledge bases and the Wikipedia entry experience; the existing editable knowledge homepage remains available at `#/page/home`.
- Added a global license-aware footer, a quality-weighted refreshable Knowledge Discovery module that fills the homepage's formerly empty lower column, and aligned account-section cards across Profile, Security, Identity, and Library pages.
- Consolidated light-mode surfaces in the design system: removed four obsolete homepage color variants, eliminated dark residual fills and card shadows, flattened the nested Global Mathematics Progress rows, and reduced administration to quiet surface hierarchy instead of outlined dashboard boxes.
- Moved the editable homepage article body ahead of featured content and the news radar, so site-authored context introduces the dashboard instead of appearing after discovery modules.
- Split the account center into URL-addressable Profile, Security, Community Identity, and Personal Library sections; each section now loads only the data it needs and collapses to a single column on mobile.
- Capped right-rail recommendations and recent updates at five items, added accessible local "refresh batch" controls backed by twelve-item candidate pools, and weighted recommendations by relationship, quality grade, stable status, and recency.
- Rebuilt the homepage as an asymmetric knowledge dashboard with live quality, update-trend, and field-coverage charts; added the same lightweight SVG/CSS data-visual language to the admin overview without importing the template's legacy jQuery chart stack.
- Made collaboration member workspaces, organization headings, and translation language selection use the full content width; account content now uses classified section grids so unrelated cards no longer create large blank gaps.
- Reworked runtime health into five evenly distributed horizontal metric components, restored readable admin typography, added article edit-record padding, and introduced level-aware right-rail TOC indentation through heading level six.
- Repaired the template-adaptive homepage and account surfaces by removing the retired descendant-wide dashboard rules and obsolete account grid areas that caused nested cards, stretched panels, and profile overlap.
- Rebuilt the right rail as a flat contextual panel: empty tables of contents now disappear, recent updates are capped, and lightweight article recommendations combine explicit related pages, prerequisites,正文 links, backlinks, shared categories, topics, quality, and recency.
- Consolidated article knowledge/community panels into their owning component styles, restoring balanced inner padding without changing article order, width, or grid placement.
- Unified admin focus rings and removed the legacy outline/new shadow overlap; organization status controls and comment row actions now remain on one horizontally scrollable line, while plugin form actions have a dedicated separated action area.
- Server-randomized slider-puzzle and ordered-click CAPTCHA modes so clients can no longer choose the challenge type; issued challenge type and HMAC are Session-bound and one-use.
- Added in-memory PNG TOTP QR generation with a manual secret/URI fallback, no-store response headers, and narrow-card overflow containment.
- Established a token-first Wikist Design System across the Wiki shell, search, community, user surfaces, administration, Passport, and installer. Existing page columns, module order, widths, spacing, and responsive breakpoints remain unchanged.
- Replaced legacy hard-coded accent and dark-surface colors with semantic dark/light tokens, unified controls, cards, pagination, tables, popovers, SweetAlert dialogs, focus states, disabled states, and restrained shadows without adding a frontend framework.
- Added `npm run check:ui` as a layout invariant guard for the desktop shell, content width, editor, search, comments, admin console, mobile navigation, article controls, asset versions, and route-loader dimensions.
- Constrained the knowledge-node loader logo to `52 x 52` inside its existing `88 x 88` orbital core, preventing the supplied site logo from overlapping the loading message.
- Replaced the default site mark with the supplied globe-and-W logo across the Wiki shell, Passport, installer, favicon, and loading states; legacy `/assets/wikist-emblem.svg` settings migrate transparently while custom site icons remain supported.
- Consolidated loading feedback into two deliberate experiences: the optional “连接知识核心” first-entry sequence and one lightweight circular “正在接入知识节点” route loader. Removed the duplicate cosmic route HUD and its obsolete plugin setting.
- Removed the homepage pointer-follow glow at the component level, including its visual layer, animation-frame handler, event listener, configuration key, and persisted defaults.
- Applied the Passport Chinese typeface across the Wiki and installer, removed nonessential login-page system copy, and aligned brand imagery across responsive layouts.
- Fixed ordered-click CAPTCHA readiness and hit testing: hidden loading layers no longer intercept input, image dimensions drive coordinate mapping, and verification tickets remain ordered, one-use, and session-bound.
- Embedded a current Webman 2.2 backend in the Wikist repository; the audited `project_template` was removed after its useful Passport design was extracted, while the optional legacy database importer remains.
- Made Webman the public service and Passport authority while a loopback-only Node compatibility service handles unported APIs behind the unchanged browser routes.
- Reused Wikist's existing users, sessions and security tables, including two-way session compatibility during migration.
- Migrated CAPTCHA, registration, login, logout, profile/social links, email verification, password reset/change, TOTP and realtime tickets to Webman.
- Extracted and rebuilt the former Passport UI inside Wikist at `/passport`: eight original scenes, custom scene/accent settings, responsive light/dark layouts, local slider and ordered-click CAPTCHA components, recovery/reset/verification screens, disabled-account alerts, and compatibility redirects from every former SPA auth URL.
- Replaced the old remote CAPTCHA iframe with self-hosted `fastknife/ajcaptcha`, Webman-side one-use Session-bound verification tickets, a five-minute expiry, and a separate CAPTCHA generation/check rate limit.
- Migrated admin user search, pagination, aggregate statistics, role/status updates, audit records and last-active-admin protection without the old N+1 statistics pattern.
- Added a loopback-only legacy scrypt KDF bridge so existing users can sign in once and have their password upgraded immediately without making Node an authentication authority.
- Added automatic Composer preparation, idempotent schema migration, installer routing, backend ownership headers and a staged migration/rollback document.

## 2026-07-12 - Coordinated Knowledge Route Loading

- Isolated the native and `cosmic-experience` route loaders so plugin code can no longer capture, restyle, or display the fallback loader at the same time.
- Added a route-loader provider handshake: the native loader appears only when no enabled visual plugin has claimed the current transition.
- Reworked the cosmic transition into a restrained knowledge terminal with a subtle grid, compact status panel, and single progress meter; removed the full-screen radial streak and star-warp motion.
- Decoupled the v0.10 community regression fixture from the visual CAPTCHA generator so a CAPTCHA presentation change cannot block local or cloud updates.
- Added loader-collision regression assertions. Bumped the framework to `0.13.1` and frontend assets to `wikist-core-20260712-101`.

## 2026-07-12 - Scalable Page Catalog And Route Loading

- Split lightweight page metadata from full Markdown rendering. List, recent, category, topic, knowledge-link, watchlist, review-queue, and alias operations now reuse a five-second incremental metadata catalog instead of rendering every article.
- Added one-second hot-page stat suppression and per-source search caches. Fallback search incrementally reuses unchanged tokenized documents, while FTS5 rebuild and recovery read source documents without generating article HTML.
- Made `/api/pages` optionally server-paginated; the browser boot path requests at most 200 summaries plus the true total instead of blocking first paint on an unbounded payload.
- Added a native theme-aware route loader that works before optional client plugins load, preventing an empty content surface during slow startup or navigation.
- Added `npm run check:performance`, including a 120-page cold/warm catalog and fallback-search regression fixture. Bumped the framework to `0.13.0` and frontend assets to `wikist-core-20260712-100`.

## 2026-07-12 - Collaboration Organization Quotas

- Limited each account to three active organizations created and five active or pending organization memberships in total, including organizations the account owns.
- Enforced quotas on creation, joining, removed-member reactivation, and request-based memberships; repeated joins are idempotent and no longer emit duplicate organization messages.
- Added live quota usage to the Collaboration Community creation panel and disabled the form when either limit is reached.
- Extended community regression coverage to 18 checks.

## 2026-07-12 - Windows Local Updater Launch

- Fixed the local updater's Windows command execution so `npm.cmd install` and validation scripts run through the platform shell instead of failing with `execFileSync EINVAL` on Node.js 24.
- Kept all local-strategy runtime protections intact; this correction is included in `0.13.0`.

## 2026-07-12 - MathJax Display Delimiter Alignment

- Fixed the browser MathJax configuration so server-rendered `\\[...\\]` blocks are recognized and typeset instead of remaining visible inside `.math-block` elements.
- Enabled both `\\[...\\]` and `$$...$$` display delimiters, retained both `\\(...\\)` and `$...$` inline delimiters, and added a frontend configuration regression assertion.
- Bumped the framework package to `0.12.9` and the frontend asset version to `wikist-core-20260712-98` so browsers and CDNs cannot reuse the incompatible script.

## 2026-07-12 - Imported Article TeX Rendering

- Fixed server-side Markdown ordering so dollar-delimited inline TeX such as `$S_3$`, `$F^*(G)$`, and `$N_G(P)/C_G(P)$` is protected before emphasis and subscript processing.
- Normalized inline and display formulas from `$...$`, `\\(...\\)`, `$$...$$`, and `\\[...\\]` into MathJax-compatible output, including formulas inside wiki-link and Markdown-link labels.
- Kept Wikist's native definition, theorem, proof, note, and warning blocks available independently of the optional arbitrary-container plugin, including TeX in semantic-block titles; added 20 Markdown regression checks.
- Added an Ubuntu cloud troubleshooting playbook for updates, permissions, reverse proxies, request protection, plugin directories, and the 93-article finite-group-theory import. Bumped the framework package to `0.12.8`; frontend assets remain unchanged.

## 2026-07-12 - Proxy-neutral Installer Challenge

- Removed the installer's dependency on matching the browser's public `Origin` host to an internal reverse-proxy `Host`, eliminating false rejections behind Docker, control-panel proxies, tunnels, and multi-hop proxy chains.
- Retained installation CSRF protection through a ten-minute cryptographic one-time challenge bound to the rate-limit client key, HTTP(S)-origin validation, and explicit rejection of browser-declared cross-site requests.
- Bumped the framework package to `0.12.7`; frontend assets remain unchanged.

## 2026-07-12 - Proxy-aware Installer Protection

- Fixed installer origin validation behind same-host reverse proxies by accepting normalized `X-Forwarded-Host` / `Forwarded` authority only from loopback or explicitly trusted proxy connections.
- Kept direct-origin validation and rejected forwarded-host spoofing from untrusted clients.
- Raised the default installer allowance from 8 to 60 requests per ten minutes, reduced the protection cooldown from 900 to 60 seconds, and transparently migrated the exact legacy default policy at load time.
- Bumped the framework package to `0.12.6`; frontend asset version remains `wikist-core-20260712-97` because no browser asset changed.

## 2026-07-12 - Canonical News Routing

- Removed the duplicate `#/news` news-shell route in favor of the canonical article route `#/page/news`.
- Updated navigation and homepage news links, and made legacy `#/news` plus accidental `#/pages/<slug>` URLs normalize to `#/page/<slug>`.
- Bumped the framework package to `0.12.5` with frontend asset version `wikist-core-20260712-97`.

## 2026-07-12 - Upgrade Check Fixture Reliability

- Replaced the v0.8 knowledge-navigation self-check's display-text CAPTCHA parser with a deterministic isolated CAPTCHA fixture, while retaining registration and CAPTCHA verification coverage.
- This removes a non-product random-input dependency that could incorrectly stop an otherwise valid framework upgrade.
- Bumped the framework package to `0.12.4`; frontend asset version remains `wikist-core-20260712-96` because no browser asset changed.

## 2026-07-12 - Responsive Protection States

- Extended the off-canvas navigation and balanced topbar control layout through the tablet transition range, so the sidebar no longer consumes the workspace before compact navigation takes over.
- Rebuilt article header actions as full-width responsive grids at constrained widths, using the complete action area for quality, favorite, follow, knowledge, collaboration, and rating controls.
- Replaced in-app rate-limit feedback with a full-screen Wikist protection state that locks the current route, shows a live cooldown, and only permits reconnection after the window ends.
- Added cinematic route error states in the SPA plus styled direct-browser 404 responses for unknown API, plugin, upload, and core asset paths.
- Bumped the framework package to `0.12.3` with frontend asset version `wikist-core-20260712-96`.

## 2026-07-12 - Health Probe And Restart Resilience

- Assigned the lightweight public health probe to its own high-threshold firewall scope, so normal maintenance checks do not contend with reader API traffic.
- Updated `run-wikist-server.cmd --restart` to verify a running Wikist through `/api/health` first, with a legacy site-check fallback, so a rate-limited content API cannot prevent an in-place restart.
- Bumped the framework package to `0.12.2` with frontend asset version `wikist-core-20260712-95`.

## 2026-07-12 - Request Protection Feedback

- Replaced raw browser-facing rate-limit JSON with a Wikist-styled protection page for direct navigation, including a clear cooldown indicator and return action.
- Added a shared SPA protection notice with live countdown; all API callers now receive concise, actionable retry text rather than serialized error payloads.
- Bumped the framework package to `0.12.1` with frontend asset version `wikist-core-20260712-94`.

## 2026-07-12 - Runtime Reliability, Backup Rehearsal, And Request Protection

- Upgraded Passport SQLite startup to WAL with foreign keys, a configurable busy timeout, normal synchronous mode, automatic WAL checkpoints, health inspection, and consistent `VACUUM INTO` snapshots for live backup downloads.
- Added SHA-256 backup-entry and manifest validation, legacy-package visibility, path / size / encoding checks, live database reconnection for full rollback, and an isolated restore rehearsal that never changes the active site.
- Added durable FTS5 failure state, lightweight-search fallback protection, explicit FTS repair, and health diagnostics for index recovery.
- Added an in-memory privacy-preserving observability layer for request latency, search time, cache hits, FTS / fallback usage, plugin failures, and protection events; no IP, account, query, content, or User-Agent is retained.
- Added configurable single-node request protection for page/API/write/auth/install scopes, body-size limits, standard rate-limit headers, installer challenge tokens, origin checking, and conservative reverse-proxy trust controls.
- Added plugin configuration schemas, declarative rename/default/remove migrations, health reporting, and a strict trusted-core boundary for server Hook registration; external server modules remain declared but never auto-executed.
- Added the responsive **Admin -> Runtime Health** console and bumped the framework package to `0.12.0` with frontend asset version `wikist-core-20260712-93`.

## 2026-07-12 - Collaboration Organization Avatars

- Added a durable organization avatar field with automatic SQLite migration, safe image-path validation, and compatibility with HTTPS, `data:image`, and local `/uploads/...` images.
- Added avatar controls to organization creation and coordinator-managed profile editing, with a generated initial badge when no image is configured.
- Rendered organization identity marks in the collaboration directory and every organization workspace header.
- Bumped the framework package to `0.11.13` with frontend asset version `wikist-core-20260712-92`.

## 2026-07-12 - Mobile Distribution Follow-up

- Distributed the compact topbar controls across the available mobile width instead of clustering them at the right edge.
- Made article quality, favorite, watch, knowledge, collaboration, and rating controls fill their mobile action bands deliberately.
- Forced the site navigation shown from an admin route back into a vertical drawer list, overriding the legacy horizontal overflow layout.
- Bumped the framework package to `0.11.12` with frontend asset version `wikist-core-20260712-91`.

## 2026-07-12 - Mobile Navigation Drawers And Compact Article Controls

- Rebuilt narrow-screen navigation as an off-canvas Wikist drawer with a compact floating trigger, backdrop dismissal, keyboard escape handling, and no persistent sidebar above article content.
- Reworked article header actions into full-width, balanced mobile controls and collapsed the page tool strip into a focused expandable tool menu.
- Converted the mobile admin control panel into a dedicated bottom-left circular launcher that opens a single-column management drawer instead of rendering every admin route button in the page flow.
- Bumped the framework package to `0.11.11` with frontend asset version `wikist-core-20260712-90`.

## 2026-07-12 - Knowledge Directory Spacing And Release Sync

- Added deliberate spacing between the knowledge-network metrics and the category/topic directory actions, preventing the two control bands from visually colliding.
- Prepared the release workspace to become the canonical GitHub source for the current framework build.
- Bumped the framework package to `0.11.10` with frontend asset version `wikist-core-20260712-89`.

## 2026-07-11 - Visual Code Preview Enforcement

- Explicitly enabled Vditor WYSIWYG code-block preview so visual rendering remains active regardless of upstream defaults or a cached editor configuration.
- Bumped the framework package to `0.11.9` with frontend asset version `wikist-core-20260711-88`.

## 2026-07-11 - Visual Editor Toolbar Guard

- Added the documented no-op `customWysiwygToolbar` hook to Vditor initialization, preventing optional-toolbar callback errors when code-block controls are used.
- Bumped the framework package to `0.11.8` with frontend asset version `wikist-core-20260711-87`.

## 2026-07-11 - Visual Editor Dark Code Blocks

- Switched Vditor's dark-mode code highlighting from the light `native` style to `monokai`, applying the same code style on initialization and every theme switch.
- Added a dark editor-host fallback for WYSIWYG code-block previews so late CDN styles cannot reintroduce a light code surface.
- Bumped the framework package to `0.11.7` with frontend asset version `wikist-core-20260711-86`.

## 2026-07-11 - Editor Knowledge Field Density

- Made aliases and redirects, disambiguation, and mathematical knowledge metadata collapsed by default so the visual editor remains immediately reachable.
- Rebuilt the three editor panels with responsive, full-width form grids: alias and redirect fields now align as equal columns, while mathematical metadata inputs fill their cells and stack cleanly on small screens.
- Bumped the framework package to `0.11.6` with frontend asset version `wikist-core-20260711-85`.

## 2026-07-11 - Collaboration Organization Polish

- Normalized every user-facing organization-creation, validation, audit, empty-state, dashboard, and documentation label to Collaboration Organization without changing the durable `writing_organizations` database table or community API routes.
- Refined the empty article collaboration panel so its community entry remains a compact, naturally aligned action instead of stretching across the panel.
- Bumped the framework package to `0.11.5` with frontend asset version `wikist-core-20260711-84`.

## 2026-07-11 - Collaboration Commons Naming

- Renamed the user-facing Writing Community surface to Collaboration Community across navigation, article collaboration prompts, organization identity states, the administration sidebar, documentation, and English visual labels. Existing `#/community` and organization routes remain unchanged.
- Bumped the framework package to `0.11.4` with frontend asset version `wikist-core-20260711-83`.

## 2026-07-11 - Home Brand And Forum Layout Repair

- Restored the dynamic home welcome title as `欢迎来到 {site name}`. The configured site name again uses the existing particle-matrix title renderer instead of being replaced with a generic “首页”.
- Moved article knowledge, collaboration, and rating shortcuts into a second row below the favorite/watch controls; the rating shortcut now updates with the current average score.
- Rebuilt the forum reply composer as a full-width Wikist form and moved reply-floor identifiers into a dedicated left marker column.
- Restored the missing `Admin -> Writing Community Management` navigation entry and clarified the management screen label.
- Bumped the framework package to `0.11.3` with frontend asset version `wikist-core-20260711-82`.

## 2026-07-11 - Forum Interaction And Article Action Shortcuts

- Unified native select controls with explicit dark/light palettes, including organization roles, task states, forum filters, and dashboard forms.
- Rebuilt forum follow and favorite controls with the same icon-and-state language as article watch/favorite actions, fixed their asynchronous event-state failure, and kept topic-management actions on one desktop toolbar.
- Made organization discussion replies a deliberate flat floor stream: replying to a member writes an `@username` mention instead of creating a nested tree; replies now expose floor numbers, reply affordances, and author/coordinator/admin soft-delete controls. Topic authors, coordinators, and administrators can likewise remove a topic from public view while retaining audit history.
- Added article-header shortcuts for knowledge links, organization collaboration, and ratings; each scrolls to the relevant loaded panel without asking readers to hunt through a long article.
- Promoted Writing Community visibility in the admin overview and bumped the framework package to `0.11.2` with frontend asset version `wikist-core-20260711-81`.

## 2026-07-11 - Organization Workspace And Category Directory Refinement

- Rebuilt category directories as searchable, paginated result streams. Root categories, child categories, and direct article lists now use server-side pagination and the same readable article-result treatment as search instead of centered ordinal tiles.
- Removed the duplicate knowledge-network item from the persistent sidebar while retaining it in primary navigation.
- Reframed organization workspaces around a responsive article-style header, optional rounded cover image, aligned horizontal tabs, semantic member metadata, and a collapsible coordinator editor using Wikist form controls.
- Rebuilt organization task, member, and forum-topic layouts so available desktop space is used deliberately, with real side context where a sidebar exists and a single-column mobile layout where it does not.
- Added member search with server-side pagination, organization cover-image persistence, and **Admin -> Writing Community** for paginated organization discovery and administrator status control.
- Added regression coverage for cover-image persistence, member filtering, and organization administration; bumped the framework package to `0.11.1` and the frontend asset version to `wikist-core-20260711-80`.

## 2026-07-11 - Academic Identity And Organization Forum

- Added Passport-synced academic organization identities to account and public user profiles, with a paginated identity directory that keeps pending memberships private.
- Reworked organization discussion into a dedicated forum view with searchable, filterable, sortable, pinned, open/resolved/locked topics and separately paginated Markdown replies.
- Added direct forum notifications for new topics and topic-author reply alerts, preserving the existing Wikist inbox and avoiding a separate social backend.
- Reframed every organization as a paged academic workspace: a Markdown-authored public home, task board, forum, and members/approval page now use one horizontal sub-navigation with responsive light and dark surfaces.
- Routed request membership, approval, role changes, task publication/claim/status changes, topic subscriptions, favorites, replies, and resolution events through the existing inbox without duplicating user or forum storage.
- Made user-facing site branding runtime-configurable across the homepage, Passport shell, account surface, administration shell, email verification/reset templates, and static chrome. Fresh homepages now use the neutral title “首页” instead of a hard-coded product greeting.
- Made collaboration organizations a first-class functional entry in the primary navigation, quick navigation, homepage collaboration console, organization overview, and article task context.
- Expanded article organization context from review-only work to paginated writing, translation, and review tasks, while retaining the existing community-review consensus panel.
- Bumped the framework package to `0.11.0` and the frontend asset version to `wikist-core-20260711-78`.

## 2026-07-11 - Collaboration Commons And Community Review

- Added self-contained collaboration organizations with direct or request-based joining, durable member roles, coordinator-managed task boards, and a paginated Markdown discussion stream.
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



