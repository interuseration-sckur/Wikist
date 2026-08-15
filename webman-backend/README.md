# Wikist Webman Backend

This directory is the PHP application embedded in the Wikist repository. It is not a fork of `project_template` and it does not use the old Passport database at runtime.

## Ownership

- Webman is the public HTTP entry point and the only Passport/authentication authority.
- Wikist's existing `users`, `sessions`, `passport_tokens` and domain tables remain the source of truth.
- Node runs on loopback as a temporary compatibility service for APIs that have not yet moved.
- The browser continues to call the existing `/api/*` routes; no second account frontend is introduced.

## Run From The Wikist Root

```bash
npm start
```

The root launcher installs Composer dependencies when needed, migrates the current Wikist database, starts Webman on `WIKIST_PORT`, and starts Node on the loopback-only `WIKIST_NODE_PORT`.

Stop the complete process group with `node tools/start-hybrid.js --stop`. On Windows, `run-wikist-server.cmd --restart` uses the same PID record before starting the replacement service.

For direct backend maintenance:

```bash
cd /path/to/wikist
php update.php --dry-run
php update.php
php webman-backend/webman route:list
php webman-backend/tools/check.php
```

The root `update.php` adds preflight, a verified SQLite snapshot, migration-state verification and an update report around the low-level `webman-backend/tools/migrate.php` runner. Use the low-level runner only from controlled installer or test code that already owns backup and verification.

Copy `.env.example` to `.env` only when running Webman independently. The normal Wikist launcher derives the database and public URL from the root installation.

## Legacy Passport Import

The old `project_template/app/passport` schema is supported only as an optional one-time import source:

```bash
php tools/import-legacy-passport.php
```

Normal requests never query the old `user` table or the old Passport database. See `docs/WEBMAN_MIGRATION.md` for the compatibility contract and staged ownership map.

## Unified Messaging

Webman owns the unified messaging repository, services, permission checks,
attachment authorization, API and transactional outbox. Passport is the only
identity source, while organization conversations derive access directly from
`organization_members`.

Run the isolated regression check with:

```bash
php tools/check-messaging.php
```

Centrifugo is optional and transport-only. Start from
`config/centrifugo.example.json`, use the same HMAC/API secrets in `.env`, and
keep its HTTP API bound to loopback. See
[`docs/REALTIME_MESSAGING.md`](../docs/REALTIME_MESSAGING.md) for the channel,
event, reverse-proxy and rollout contract.
