# Changelog

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



