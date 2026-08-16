"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "public", "assets", "styles.css"), "utf8");
const designCss = fs.readFileSync(path.join(root, "public", "assets", "design-system.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const passportHtml = fs.readFileSync(path.join(root, "public", "passport", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "assets", "app.js"), "utf8");
const messagingPermission = fs.readFileSync(path.join(root, "webman-backend", "app", "service", "MessagingPermissionService.php"), "utf8");
const messagingRepository = fs.readFileSync(path.join(root, "webman-backend", "app", "repository", "MessagingRepository.php"), "utf8");
const messagingSchema = fs.readFileSync(path.join(root, "webman-backend", "database", "schema", "wikist.sqlite.sql"), "utf8");
const messagingService = fs.readFileSync(path.join(root, "webman-backend", "app", "service", "MessagingService.php"), "utf8");
const passportStore = fs.readFileSync(path.join(root, "src", "core", "passport-store.js"), "utf8");
const selectionToolbar = fs.readFileSync(path.join(root, "public", "assets", "selection-toolbar.js"), "utf8");
const selectionCss = fs.readFileSync(path.join(root, "public", "assets", "selection-toolbar.css"), "utf8");
const communityCss = fs.readFileSync(path.join(root, "public", "assets", "community-qa.css"), "utf8");
const communityApp = fs.readFileSync(path.join(root, "public", "assets", "community-qa.js"), "utf8");
const selectionRepository = fs.readFileSync(path.join(root, "webman-backend", "app", "repository", "SelectionRepository.php"), "utf8");
const selectionService = fs.readFileSync(path.join(root, "webman-backend", "app", "service", "SelectionService.php"), "utf8");
const compact = css.replace(/\s+/g, " ");

function requireCss(name, snippet) {
  if (!compact.includes(snippet)) throw new Error(`UI layout invariant failed: ${name}`);
}

function requirePattern(name, source, pattern) {
  if (!pattern.test(source)) throw new Error(`UI asset invariant failed: ${name}`);
}

function rejectPattern(name, source, pattern) {
  if (pattern.test(source)) throw new Error(`UI asset invariant failed: ${name}`);
}

let depth = 0;
for (const char of css) {
  if (char === "{") depth += 1;
  if (char === "}") depth -= 1;
  if (depth < 0) throw new Error("UI stylesheet contains an unmatched closing brace.");
}
if (depth !== 0) throw new Error("UI stylesheet contains an unmatched opening brace.");

let designDepth = 0;
for (const char of designCss) {
  if (char === "{") designDepth += 1;
  if (char === "}") designDepth -= 1;
  if (designDepth < 0) throw new Error("Design-system stylesheet contains an unmatched closing brace.");
}
if (designDepth !== 0) throw new Error("Design-system stylesheet contains an unmatched opening brace.");

const layoutProperties = new Set([
  "position", "display", "inset", "top", "right", "bottom", "left",
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "gap", "row-gap", "column-gap", "grid", "grid-template-columns", "grid-template-rows",
  "grid-column", "grid-row", "flex", "flex-basis", "flex-grow", "flex-shrink",
  "align-items", "align-content", "align-self", "justify-content", "justify-items",
  "justify-self", "place-items", "place-content", "order", "overflow", "overflow-x",
  "overflow-y", "float"
]);
for (const match of designCss.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/gm)) {
  if (layoutProperties.has(match[1])) {
    throw new Error("Design-system stylesheet changed protected layout property: " + match[1]);
  }
}

for (const token of [
  "--panel-strong:",
  "--surface-input:",
  "--surface-hover:",
  "--accent-soft:",
  "--focus-ring:",
  "--radius-lg:"
]) requireCss(`design token ${token}`, token);

requireCss("desktop three-column shell", ".app-grid { grid-template-columns: var(--shell-sidebar) minmax(0, 1fr) var(--shell-rail);");
requireCss("desktop fluid content width", ".content-surface { width: calc(100% - clamp(24px, 2.4vw, 48px)); max-width: none;");
requireCss("desktop editor columns", ".editor-form { grid-template-columns: repeat(2, minmax(0, 1fr));");
requireCss("desktop search filters", ".search-advanced-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));");
requireCss("desktop comments columns", ".comments-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .58fr);");
requireCss("desktop admin columns", ".admin-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr);");
requireCss("admin dual-sidebar shell", "body.admin-mode .app-grid { grid-template-columns: var(--shell-sidebar) minmax(0, 1fr);");
requireCss("wide right-rail collapse", "@media (max-width: 1180px) { .app-grid { grid-template-columns: 252px minmax(0, 1fr); } .right-rail { display: none;");
requireCss("mobile off-canvas shell", "@media (max-width: 900px) { body.mobile-nav-open, body.admin-mobile-nav-open { overflow: hidden; } .app-grid, body.admin-mode .app-grid { display: block;");
requireCss("transition article title row", ".article-head .article-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: clamp(10px, 2vw, 18px); flex-wrap: nowrap; text-align: left;");
requireCss("mobile article action grid", ".article-title-primary-actions, .article-title-actions .article-section-shortcuts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
requireCss("mobile page tools", ".page-tool-nav-mobile-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
requireCss("route loader logo bound", ".wikist-route-loader-core img { display: block; width: 52px; height: 52px; max-width: 52px; max-height: 52px;");
requireCss("uniform article entry surface", ".article-entry-head { overflow: hidden; padding: clamp(18px, 3vw, 28px); border: 1px solid var(--line); border-radius: 22px;");
requireCss("article metadata bottom clearance", ".article-head-with-image .meta-row, .article-head-with-image .chip-row { margin-bottom: clamp(16px, 3vw, 24px);");
requireCss("full-width permission workbench", ".permission-workbench { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(340px, .92fr); gap: 16px; width: 100%; max-width: none;");
requireCss("aligned transfer overwrite toggle", ".transfer-panel .transfer-overwrite-toggle { display: flex; align-items: center; justify-content: flex-start;");
requireCss("lightbox close contrast", ".image-viewer-close { position: fixed; top: 18px; right: 18px; display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid rgba(255, 255, 255, .18); border-radius: 50%; color: #f4ffff;");
requireCss("neutral light function plot", ":root[data-theme=\"light\"] .wikist-function-plot { --plot-bg: transparent; --plot-bg-2: transparent; --plot-line: var(--line);");
requireCss("template profile header", ".profile-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto;");
requireCss("template dashboard metrics", ".admin-dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .72fr);");
requireCss("template sidebar account", ".sidebar-account-link { display: grid; grid-template-columns: 34px minmax(0, 1fr) 16px;");
requireCss("shared paged section navigation", ".account-section-tabs, .page-tool-nav-list, .organization-workspace-tabs { display: grid;");
requireCss("account navigation columns", ".account-section-tabs { grid-template-columns: repeat(6, minmax(0, 1fr));");
requireCss("single-row narrow account navigation", ".account-section-tabs { grid-template-columns: repeat(6, minmax(112px, 1fr)); overflow-x: auto;");
requireCss("article navigation columns", ".page-tool-nav-list { grid-template-columns: repeat(7, minmax(0, 1fr)); width: 100%;");
requireCss("organization navigation columns", ".organization-workspace-tabs { grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible;");
requireCss("classified account sections", ".account-section-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
requireCss("aligned account section cards", ".account-section-grid > * { height: 100%;");
requireCss("content-height organization identities", ".organization-identity-panel { display: grid; align-content: start;");
requireCss("full-width collaboration heading", ".community-head { width: 100%; max-width: none;");
requireCss("full-width collaboration and translation workspaces", ".organization-members-workspace, .organization-tab-layout, .translation-language-chooser { width: 100%; max-width: none;");
requireCss("adaptive translation language grid", ".translation-language-chooser-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));");
requireCss("asymmetric home dashboard", ".home-dashboard-columns.has-two-columns { grid-template-columns: minmax(0, 1.16fr) minmax(300px, .84fr);");
requireCss("five-column runtime health", ".admin-metrics.runtime-health-metrics { grid-template-columns: repeat(5, minmax(0, 1fr));");
requireCss("multi-level right rail toc", ".toc-list a.toc-level-5, .toc-list a.toc-level-6 {");
requireCss("async suggestion anchor", ".async-suggest-shell { position: relative; min-width: 0; width: 100%;");
requireCss("spacious task composer", ".organization-task-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;");
requireCss("full-height messaging workspace", ".messaging-page { display: grid; grid-template-rows: auto minmax(560px, 1fr);");
requireCss("stacked messaging composer", ".messaging-composer { display: grid; grid-template-columns: minmax(0, 1fr);");
requireCss("parent-width messaging composer", ".messaging-composer-shell > #messagingComposerState, .messaging-composer-shell > .messaging-composer, .messaging-composer-shell > .status-line { width: 100%; max-width: none; margin-inline: 0;");
requireCss("empty composer status collapses", ".messaging-composer-shell > .status-line:empty { display: none;");
requireCss("filled messaging thread", ".messaging-thread { display: grid; grid-template-rows: max-content minmax(0, 1fr) max-content;");
requireCss("full-width forum", ".forum-workbench { display: grid; grid-template-columns: minmax(0, 1fr) minmax(278px, 340px); gap: 16px; align-items: start; width: 100%;");
requireCss("compact organization chat action", ".organization-chat-link { width: 40px; min-width: 40px; min-height: 40px;");
requirePattern("desktop organization governance filter", communityCss, /\.organization-governance-filter\s*\{[^}]*grid-template-columns:\s*minmax\(320px,\s*1fr\)\s+max-content;[^}]*width:\s*min\(100%,\s*760px\);/);
requireCss("centered mobile article action track", ".article-title-actions { width: min(100%, 360px); max-width: 100%; margin-inline: auto; grid-template-columns: minmax(0, 1fr); justify-content: stretch;");
requireCss("single social relation divider", ".follow-user-list > .follow-user-card:first-child { border-top: 0;");
requireCss("unified admin table cell borders", ".admin-table th, .admin-table td { border: 0; border-bottom: 1px solid");
requireCss("messaging image preview cursor", ".wiki-image img[data-wiki-image-trigger], .messaging-attachment.image[data-messaging-image-preview] { cursor: zoom-in;");

const htmlVersion = html.match(/styles\.css\?v=([^"']+)/)?.[1];
const designVersion = html.match(/design-system\.css\?v=([^"']+)/)?.[1];
const scriptVersion = html.match(/app\.js\?v=([^"']+)/)?.[1];
const runtimeVersion = app.match(/CORE_ASSET_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!htmlVersion || htmlVersion !== designVersion || htmlVersion !== scriptVersion || htmlVersion !== runtimeVersion) {
  throw new Error("UI asset versions differ: css=" + htmlVersion + ", design=" + designVersion + ", script=" + scriptVersion + ", runtime=" + runtimeVersion);
}

requirePattern("Basecoat-style component skin", designCss, /--ui-surface-card:/);
requirePattern("Magic-style restrained edge treatment", designCss, /linear-gradient\(135deg,/);
requirePattern("template-adaptive component vocabulary", designCss, /--ui-surface-raised:/);
requirePattern("row-level admin table hover", designCss, /\.admin-table tbody tr:hover[\s\S]{0,180}\.admin-table tbody tr:hover > td[\s\S]{0,90}background-color:\s*transparent/);
requirePattern("messaging images reuse shared viewer", app, /function messagingAttachmentHtml[\s\S]{0,900}data-messaging-image-preview[\s\S]*?function openImageViewer\(image\)[\s\S]{0,180}\.wiki-image, \.messaging-attachment\.image/);
requirePattern("messaging image click delegation", app, /\.messaging-attachment\.image\[data-messaging-image-preview\][\s\S]{0,240}openImageViewer/);
requirePattern("article entry surface hook", app, /article-head article-entry-head/);
requirePattern("full-width review and permission headers", app, /article-head review-page-head[\s\S]*article-head permission-page-head/);
requirePattern("transfer overwrite component", app, /transfer-overwrite-toggle[\s\S]*允许覆盖已有词条/);
requirePattern("aggregated admin overview", app, /\/api\/admin\/overview/);
requirePattern("contextual recommendation rail", html, /id="recommendationRailBlock"[^>]*hidden/);
requirePattern("empty table of contents is hidden", app, /tocRailBlock\.hidden = items\.length === 0/);
requirePattern("knowledge recommendation candidate pool", app, /\/recommendations\?limit=12/);
requirePattern("right rail recommendation cap", app, /RAIL_RECOMMENDATION_LIMIT\s*=\s*5/);
requirePattern("right rail recent cap", app, /RAIL_RECENT_LIMIT\s*=\s*5/);
requirePattern("right rail random refresh", html, /id="recommendationRefresh"[\s\S]*id="recentRefresh"/);
requirePattern("global footer", html, /id="siteFooter"[\s\S]*id="footerCopyright"/);
requirePattern("search-first site portal", app, /function renderKnowledgePortal\(\)/);
requirePattern("asynchronous suggestion endpoint", app, /async function fetchPageSuggestions[\s\S]*?\/api\/search\/suggest/);
requirePattern("shared asynchronous suggestions", app, /function bindPageSuggestions\(input, options = \{\}\)/);
requirePattern("search route owns its query input", app, /async function renderSearch\(value\)[\s\S]*?<form class="search-page-form" id="searchPageForm">[\s\S]{0,400}<input name="q" type="search" value="\$\{escapeHtml\(q\)\}"/);
rejectPattern("search route must not overwrite global search inputs", app, /async function renderSearch\(value\)[\s\S]{0,900}(?:el\.searchInput|el\.topSearchInput)\.value\s*=\s*q/);
requirePattern("inline messaging reference magic words", app, /MESSAGING_REFERENCE_PATTERN[\s\S]*?messagingInlineReferenceHtml/);
requirePattern("messaging presence refresh", app, /async function refreshMessagingPresence\(\)/);
requirePattern("stable cross-conversation presence cache", app, /messagingPresenceCache[\s\S]*?seenAt/);
requirePattern("dedicated realtime heartbeat", app, /presence\/heartbeat[\s\S]*?messagingPresenceWatchUserIds/);
requirePattern("presence heartbeat service", messagingService, /function heartbeat[\s\S]*?recordPresence/);
requirePattern("hybrid lease-backed conversation presence", messagingService, /recentlyOnlineConversationUsers[\s\S]*?publisher->presence[\s\S]*?'transportPresence'/);
requirePattern("moderation refresh preserves realtime subscription", app, /function refreshActiveMessagingModeration[\s\S]*?messagingContextHtml/);
rejectPattern("moderation events must not rebuild realtime subscriptions", app, /conversation\.moderation\.updated[^\n]*[\s\S]{0,220}activateMessagingConversation/);
requirePattern("compact member governance menu", app, /messaging-member-actions[\s\S]*?data-messaging-member-role[\s\S]*?data-messaging-member-mute/);
requirePattern("top-layer member governance popover", app, /popover="auto"[\s\S]*?positionMessagingMemberActionMenu/);
requirePattern("moderation timeline message rendering", app, /conversation_moderation[\s\S]*?messaging-conversation-boundary/);
requirePattern("persistent all-mute timeline events", messagingService, /messageType'\s*=>\s*'system'[\s\S]*?conversation_moderation[\s\S]*?message\.created/);
rejectPattern("collaboration navigation is mutually exclusive", app, /community\|organization\|organizations/);
requirePattern("dedicated presence schema", messagingSchema, /CREATE TABLE IF NOT EXISTS messaging_user_presence/);
requirePattern("public profiles use realtime presence leases", passportStore, /getPublicUser[\s\S]*?messaging_presence_leases/);
requirePattern("tab-scoped presence release", app, /pagehide[\s\S]*?presence\/offline|presence\/offline[\s\S]*?pagehide/);
requirePattern("failed outgoing message indicator", app, /messaging-send-failed[\s\S]*?sendError/);
requirePattern("direct recipient state validation", messagingService, /assertDirectRecipientAvailable[\s\S]*?direct_recipient_deleted[\s\S]*?direct_recipient_banned/);
requirePattern("notification conversations are read only", messagingPermission, /kind\s*===\s*'system'[\s\S]*?system_conversation_read_only/);
requirePattern("asynchronous messaging filters", app, /applyMessagingConversationFilters[\s\S]*?history\.replaceState/);
requirePattern("narrow messaging context click-away", app, /context-open[\s\S]{0,220}max-width: 1480px[\s\S]{0,220}messaging-context-panel[\s\S]{0,120}classList\.remove\("context-open"\)/);
requirePattern("realtime read receipt refresh", app, /conversation\.read[\s\S]*?updateMessagingReadReceipts/);
requirePattern("folded message popover", app, /message-popover-fold[\s\S]*?展开其余/);
requirePattern("route-scoped message popover", app, /async function route\(\)[\s\S]{0,520}closeMessagePopover\(\)/);
requirePattern("pinned conversation grouping", app, /messaging-conversation-group[\s\S]*?已置顶/);
requirePattern("composer mention suggestions", app, /messagingMentionPickerHtml[\s\S]*?users\/suggest/);
requirePattern("stale mention request rejection", app, /requestId[\s\S]*?messagingMentionState\.requestId !== requestId/);
requirePattern("strict nested article 404", app, /typeof page\.html !== "string"[\s\S]*?page_not_found/);
requirePattern("missing article creation entry", app, /creatablePage[\s\S]*?#\/edit\/\$\{encodeSlug\(missingPageSlug\)\}/);
requirePattern("nested missing routes remain strict", app, /creatablePage[\s\S]*?!missingPageSlug\.includes\("\/"\)/);
requirePattern("article forwarding", app, /data-share-page[\s\S]*?relation: "share"/);
requirePattern("forwarding recent-conversation recommendations", app, /pageShareTargetList[\s\S]*?最近私信[\s\S]*?最近群聊/);
requirePattern("bounded recent direct recommendations", app, /PAGE_SHARE_RECENT_DIRECT_LIMIT\s*=\s*6[\s\S]*?slice\(0, PAGE_SHARE_RECENT_DIRECT_LIMIT\)/);
requirePattern("article author profile link", app, /authorUsername[\s\S]*?#\/user\/\$\{encodeURIComponent\(page\.authorUsername\)\}/);
rejectPattern("flex identity wrappers must not replace table cells", app, /<td class="admin-identity-cell">/);
if ((app.match(/<td><div class="admin-identity-cell">/g) || []).length < 2) {
  throw new Error("UI asset invariant failed: admin identity content must stay inside real table cells");
}
requireCss("designed forwarding fields", ".page-share-search input, .page-share-note textarea { width: 100%; min-width: 0; border: 1px solid var(--line); padding: 11px 13px;");
requirePattern("messaging preference controls", app, /messagingPreferencesForm[\s\S]*?autoReplyEnabled[\s\S]*?openMode/);
requirePattern("account communication settings", app, /accountMessagingPreferences[\s\S]*?openMessagingPreferencesDialog/);
requirePattern("lazy selection persistence", selectionService, /\$input\['create'\][\s\S]{0,120}createOrRefresh/);
requirePattern("published annotations in personal highlights", selectionRepository, /'commented'\s*=>\s*\$comments\(\)/);
rejectPattern("quote activities stay out of personal highlights", selectionRepository, /'quoted'\s*=>\s*\$quotes\(\)/);
requirePattern("selection comment reply schema", messagingSchema, /content_selection_comments[\s\S]*?reply_to_comment_id/);
requirePattern("flat selection comment replies", selectionRepository, /reply_to_comment_id[\s\S]*?'replyTo'/);
requirePattern("equivalent selection consolidation", selectionRepository, /equivalentSelections[\s\S]*?mergeInto[\s\S]*?merged:/);
requirePattern("strict engaged selection deletion", selectionRepository, /'canDelete'[\s\S]{0,220}isset\(\$liked[\s\S]{0,120}isset\(\$commented/);
requirePattern("owned selection deletion preserves shared anchors", selectionRepository, /function deleteOwned[\s\S]*?creator_user_id[\s\S]*?'preserved'\s*=>\s*true/);
requirePattern("selection deletion route", selectionToolbar, /delete\(id\)[\s\S]*?method:\s*"DELETE"/);
requirePattern("selection toolbar owner delete action", selectionToolbar, /data-selection-action="delete"[\s\S]*?record\?\.canDelete/);
requirePattern("selection quote targets comments", selectionToolbar, /data-selection-quote="comment"[\s\S]*?引用到评论/);
requirePattern("persistent selection highlight", selectionCss, /::highlight\(wikist-selection-anchors\)[\s\S]*?background-color:[\s\S]*?text-decoration-line:\s*underline/);
requirePattern("selection toolbar like count", selectionToolbar, /data-selection-like-count[\s\S]*?result\.likeCount[\s\S]*?\$\{count\} 人喜欢/);
requirePattern("complete liked selection semantic", selectionCss, /data-selection-action="like"\]\.active[\s\S]*?color:\s*#ff[\da-f]+[\s\S]*?background:[\s\S]*?box-shadow:/i);
requirePattern("personal highlight anchor navigation", app, /selectionSourceUrl[\s\S]*?selection=[\s\S]*?revealRequestedSelection/);
requirePattern("selection focus highlight", selectionToolbar, /focus\(selectionId[\s\S]*?TARGET_HIGHLIGHT_NAME/);
requirePattern("separate unlike and selection deletion", app, /data-unlike-account-selection[\s\S]*?data-delete-account-selection/);
requirePattern("personal annotation deletion", app, /data-delete-account-comment[\s\S]*?deleteComment\(selection\.id/);
requirePattern("unframed empty annotation state", designCss, /selection-annotation-comments\.is-empty[\s\S]*?border:\s*0/);
requirePattern("single-grid personal highlight rank rail", css, /\.account-selection-item\s*\{[\s\S]*?grid-template-columns:\s*42px minmax\(0, 1fr\)/);
requirePattern("personal highlight text below activity badge", app, /account-selection-primary[\s\S]*?selection-activity-badge[\s\S]*?account-selection-source[\s\S]*?account-selection-meta/);
requirePattern("personal highlight actions below activity date", app, /account-selection-meta[\s\S]*?<small>\$\{fmtDate[\s\S]*?account-selection-actions/);
rejectPattern("personal highlights have no split footer", app, /account-selection-item[^`]*?<footer class="account-selection-actions"/);
requirePattern("translation source uses one scroll owner", css, /\.translation-pane \.translation-source-code[\s\S]*?overflow:\s*visible/);
requirePattern("translator community leave action", app, /translatorLeaveButton[\s\S]*?method:\s*"DELETE"/);
requirePattern("uniform translator community actions", app, /translator-panel-actions[\s\S]*?translator-glossary-button[\s\S]*?translator-leave-button/);
requirePattern("translator community leave storage", passportStore, /leaveTranslatorCommunity[\s\S]*?DELETE FROM translator_members/);
requirePattern("light is the default wiki theme", html, /data-theme="light"[\s\S]*?savedTheme === "dark"[\s\S]*?: "light"/);
requirePattern("light is the default passport theme", passportHtml, /data-theme="light"[\s\S]*?saved === "dark"[\s\S]*?: "light"/);
rejectPattern("organization facts keeps semantic green kicker", css, /organization-basic-facts\s*>\s*\.system-kicker\s*\{[^}]*var\(--cyan\)/);
requirePattern("comment selection draft", app, /saveSelectionDraft\("comment"[\s\S]*?consumeSelectionDraft\("comment"/);
requirePattern("high-contrast unread counters", designCss, /\.messaging-unread-count,[\s\S]*?background:\s*var\(--rose\)/);
requirePattern("direct request policy", messagingService, /direct_request_limit_reached[\s\S]*?waitingForReply/);
requirePattern("realtime direct-policy refresh", app, /actorId[\s\S]*?refreshActiveMessagingDirectPolicy[\s\S]*?peerReplied/);
requirePattern("new account announcement baseline", messagingRepository, /initializeSiteAnnouncementReadBaseline[\s\S]*?created_at', '<', \$registeredAt[\s\S]*?last_read_message_id/);
requirePattern("announcement baseline synchronization", messagingPermission, /upsertMember\(\(int\) \$site->id[\s\S]*?initializeSiteAnnouncementReadBaseline/);
requirePattern("auto replies exclude presence leases", messagingService, /createAutoReplyIfNeeded[\s\S]*?isUserOnline/);
requirePattern("organization chat moderation", messagingService, /updateOrganizationModeration[\s\S]*?updateOrganizationMemberRole[\s\S]*?updateOrganizationMemberMute/);
requirePattern("organization mute schema", messagingSchema, /CREATE TABLE IF NOT EXISTS messaging_conversation_mutes/);
requirePattern("equal Q&A comment actions", communityCss, /qa-comment-composer-actions\s*>\s*\.qa-form-actions\s*>\s*button\s*\{[^}]*flex:\s*0\s+0\s+150px[^}]*min-width:\s*150px[^}]*min-height:\s*40px/);
requirePattern("per-user message deletion", app, /data-hide-message[\s\S]*?messages\/\$\{encodeURIComponent\(hideMessage\.dataset\.hideMessage\)\}\/visibility/);
requirePattern("sender-only withdrawal", messagingPermission, /sender_user_id[\s\S]*?withdraw_window', 300/);
const withdrawPermissionBody = messagingPermission.match(/function assertCanWithdraw\([\s\S]*?\n    }\n\n    private function/)?.[0] || "";
if (/identity->role\s*===\s*'admin'/.test(withdrawPermissionBody)) throw new Error("Administrators must not bypass sender-only message withdrawal.");
requirePattern("soft-hidden message schema", messagingSchema, /CREATE TABLE IF NOT EXISTS messaging_message_hidden/);
requirePattern("hidden messages filtered in repository", messagingRepository, /whereNotExists[\s\S]*?messaging_message_hidden/);
requirePattern("IME composition suggestions", app, /addEventListener\("compositionend", requestSuggestions\)/);
requirePattern("task slug suggestion selection", app, /organizationWorkspaceTaskForm input\[name='pageSlug'\][\s\S]*?selectionMode: "value"/);
requirePattern("root portal route", app, /return \{ name: "portal", value: "" \}/);
requirePattern("route changes reset document scroll", app, /completedRoute[\s\S]{0,220}window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
requirePattern("community pager uses a dedicated footer column", app, /community-organization-column[\s\S]*?paginationHtml\(pagination, "协作组织"\)/);
requireCss("single-column organization results", ".community-organization-list { display: grid; grid-template-columns: minmax(0, 1fr);");
requireCss("unframed single-page total", ":root .pager.pager-single { display: inline-flex; justify-content: flex-start; justify-self: start; width: max-content; max-width: 100%; margin-top: 8px; border: 0; padding: 0; background: transparent; background-color: transparent; box-shadow: none;");
requireCss("light warning contrast", ':root[data-theme="light"] .math-note-warning { border-color: #e8c96e; border-left-color: #d9a900; color: #432f00; background: #fff8df;');
if (/forum-main-column\s*\{[^}]*min-height|organization-tab-layout\s*,\s*\.organization-members-workspace\s*\{[^}]*min-height/.test(compact)) {
  throw new Error("Paged collaboration lists must not reserve artificial vertical space.");
}
requirePattern("homepage discovery refresh", app, /id="homeDiscoveryRefresh"/);
requirePattern("canonical light surfaces", designCss, /Canonical light surfaces/);
requirePattern("shared collaboration surface", designCss, /\.community-create-panel,[\s\S]*\.organization-identity-panel,/);
requirePattern("readable light primary controls", designCss, /:root\[data-theme="light"\][\s\S]*--ui-primary-text:\s*#071a18/);
requirePattern("light primary control surface", designCss, /--ui-primary-surface:\s*color-mix/);
requirePattern("natural top navigation", designCss, /\.topbar \.top-quick-nav a::after/);
requirePattern("transparent top navigation", designCss, /\.topbar \.top-quick-nav a\s*\{[\s\S]*?background:\s*transparent/);
requirePattern("unframed topbar controls", designCss, /\.topbar \.topbar-actions \.language-select,[\s\S]*?\.topbar \.topbar-actions \.passport-button\s*\{[\s\S]*?border-color:\s*transparent;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
requirePattern("unframed light login control", designCss, /:root\[data-theme="light"\] \.topbar \.topbar-actions \.passport-button:not\(\.signed-in\)[\s\S]*?background:\s*transparent/);
requirePattern("shared organization forum header", app, /renderOrganizationForum[\s\S]*?organizationWorkspaceHeader\(organization, membership, "forum"/);
requirePattern("topbar account avatar", html, /id="passportIcon"[\s\S]*id="topbarLogout"/);
requireCss("avatar-only narrow account control", ".topbar-actions .passport-button.signed-in #passportText { display: none;");
requireCss("visible narrow account avatar", ".topbar-actions .passport-button.signed-in .passport-account-icon {");
requirePattern("unframed signed-in account control", designCss, /\.passport-button\.signed-in\s*\{[\s\S]*?border-color:\s*transparent;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
requirePattern("quiet messaging composer focus", designCss, /\.messaging-composer:focus-within\s*\{[\s\S]*?border-color:\s*var\(--ui-border\);[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
if (/body\.admin-mode \.workspace\s*\{[\s\S]{0,120}overflow:\s*hidden/.test(css)) {
  throw new Error("The admin workspace must not break sticky top navigation with overflow hidden.");
}
if (/sidebar-footer[\s\S]{0,500}#\/admin\/overview/.test(html)) throw new Error("The sidebar must not expose the administration console.");
requirePattern("account-only admin entry", app, /profile-hero-actions[\s\S]*canAccessAdmin\(\)[\s\S]*#\/admin\/overview/);
requirePattern("homepage data visualizations", app, /homepageInsightHtml\(state\.pages, state\.recent\)/);
requirePattern("admin activity visualization", app, /admin-activity-chart/);
requirePattern("runtime metric component", app, /runtimeMetric\("数据库"/);
requirePattern("native community confirmation adapter", app, /confirm:\s*uiConfirm/);
rejectPattern("native community browser dialogs", communityApp, /(^|[^\w$.])(?:window\.|global\.)?(?:alert|confirm|prompt)\s*\(/m);
requirePattern("community deterministic action panels", communityApp, /panel\.hasAttribute\("hidden"\)[\s\S]*?panel\.toggleAttribute\("hidden"/);
requirePattern("community reactions stay out of activity labels", communityApp, /labels\[item\.eventType\]\s*\|\|\s*"社区内容更新"/);
requirePattern("community answer pagination", communityApp, /answerPage[\s\S]*?answerPager/);
requirePattern("community comment pagination", communityApp, /data-qa-load-comments[\s\S]*?data-comment-page/);
requirePattern("community collection uses bookmark", communityApp, /data-qa-collection[\s\S]{0,300}"bookmark"/);
requirePattern("community account library split", app, /title:\s*"社区收藏"[\s\S]*?title:\s*"社区关注"/);
requirePattern("community admin active tabs", communityCss, /\.admin-community-tabs\s*\{[^}]*--qa-accent:\s*var\(--cyan\)/);
requirePattern("community editor uses design-system controls", communityCss, /\.qa-inline-editor \.wikist-input\s*\{[^}]*border:\s*1px solid var\(--ui-border[^}]*background-color:\s*var\(--ui-surface-control[^}]*box-shadow:\s*var\(--ui-shadow-control/);
requirePattern("community comment actions align", communityCss, /\.qa-comment-composer-actions\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*flex-end/);
requirePattern("community comment attachment shares answer tools", communityApp, /qa-comment-composer[\s\S]*?qa-answer-editor-tools[\s\S]*?attachmentPicker\(true\)[\s\S]*?qa-comment-composer-actions/);
requirePattern("community navigation fills four columns", communityCss, /\.qa-section-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
requirePattern("community source filters persist", communityApp, /name="origin"[\s\S]*?questionOriginsHtml\(question/);
requirePattern("community writing forms can clear input", communityApp, /data-qa-clear-form[\s\S]*?clearWritingForm\(form\)/);
requirePattern("admin title centered with adjacent badge", css, /body\.admin-mode \.admin-head \.article-title-row > h1\s*\{[^}]*grid-column:\s*2;[\s\S]*?body\.admin-mode \.admin-head \.article-title-row > \.quality-badge\s*\{[^}]*grid-column:\s*3;/);
requirePattern("admin mobile navigation remains vertical", css, /@media \(max-width: 900px\)[\s\S]*?body\.admin-mode \.sidebar \.nav-section,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
requirePattern("community detail uses one root event delegate", communityApp, /__wikistCommunityQaDetailAbort[\s\S]*?releaseDetailBindings\(\)/);
requirePattern("answer editor reuses knowledge reference tokens", communityApp, /referenceToken\(reference[\s\S]*?data-qa-reference-picker[\s\S]*?messaging\/objects\/suggest/);
requirePattern("organization forum reuses knowledge reference picker", app, /forumReferencePickerHtml\(\)[\s\S]*?data-forum-reference-picker[\s\S]*?messaging\/objects\/suggest/);
requirePattern("organization forum writes reference tokens into markdown", app, /bindForumReferencePicker\(form\)[\s\S]*?data-forum-reference-body[\s\S]*?messagingReferenceToken\(item\)/);
requirePattern("organization forum renders reference cards", app, /decorateForumKnowledgeHtml\(html\)[\s\S]*?forumKnowledgeReferenceHtml/);
if (css.includes(".sci-dashboard-strip")) throw new Error("Retired dashboard-strip selectors must not remain in the stylesheet.");
if (css.includes(".wiki-home-grid")) throw new Error("Retired wiki-home-grid selectors must not remain in the stylesheet.");
if (css.includes(".account-grid.account-grid-wide") || css.includes(".account-dashboard-column")) throw new Error("Retired account dashboard selectors must not remain in the stylesheet.");

const homeBodyPosition = app.indexOf("home-dashboard-wide home-dashboard-introduction");
const homeColumnsPosition = app.indexOf("home-dashboard-columns ${primaryModules");
if (homeBodyPosition < 0 || homeColumnsPosition < 0 || homeBodyPosition > homeColumnsPosition) {
  throw new Error("Homepage body must render before featured and news columns.");
}

for (const retiredSelector of [
  ':root[data-theme="light"] .sci-box-feature {',
  ':root[data-theme="light"] .sci-box-news {',
  ':root[data-theme="light"] .sci-box-path {',
  ':root[data-theme="light"] .sci-box-progress {'
]) {
  if (css.includes(retiredSelector)) throw new Error(`Retired light homepage override remains: ${retiredSelector}`);
}

const passportJs = fs.readFileSync(path.join(root, "public", "passport", "passport.js"), "utf8");
requirePattern("Passport stylesheet cache key", passportHtml, /passport\.css\?v=wikist-passport-[^"']+/);
requirePattern("Passport authenticated session gate", passportJs, /authenticatedEntry[\s\S]*authenticatedSessionPanel\(\)/);
requirePattern("Passport account switching", passportJs, /sessionSwitchAccount[\s\S]*closeAuthenticatedSession\("switch"\)/);
requirePattern("caption-free Passport scene choices", passportJs, /scene-option[^>]*aria-label="选择\$\{escapeHtml\(label\)\}"[^>]*><img[^>]*><\/button>/);
if (/body\.admin-mode \.app-grid > \.sidebar[\s\S]{0,160}display:\s*none\s*!important/.test(css)) {
  throw new Error("The administration shell must retain the global site sidebar.");
}
console.log(`Wikist UI invariants passed (${htmlVersion}).`);
