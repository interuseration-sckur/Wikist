# Changelog

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



