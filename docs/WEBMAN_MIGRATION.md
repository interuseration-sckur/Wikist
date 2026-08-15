# Wikist Webman Migration

Updated: 2026-08-15

## Target Architecture

Wikist is being migrated in place. The former `project_template` was used only as a read-only audit reference and has been removed after extracting the useful Passport design. Its code and database are not runtime dependencies.

```text
Browser / reverse proxy
        |
        v
Webman public service
  - Passport and authorization authority
  - migrated REST APIs
  - SSE and WebSocket entry points
  - current Wikist frontend/static assets
        |
        +---- shared Wikist database and content directories
        |
        +---- loopback-only Node compatibility service
              - unported domain APIs
              - existing Markdown/plugin behavior during migration
```

The browser keeps the existing URLs. Webman explicitly owns migrated routes and forwards only unmatched `/api/*` and `/plugins/*` requests to Node with a random per-launch internal token. Node accepts the bypass token only from a loopback connection.

## Database Contract

- Wikist's current database is the sole source of truth.
- Webman uses the existing `users`, `sessions`, `passport_tokens`, comments, edits, favorites, watches, translation and organization tables.
- Existing `wikist_passport` sessions are accepted by Webman. New Webman logins also create a compatible session so unported Node APIs see the same user.
- The old Passport `user` table is never queried during normal operation. `tools/import-legacy-passport.php` is an idempotent, one-time importer only.
- During the compatibility phase both runtimes share the existing SQLite database. MySQL schemas are prepared for Webman, but switching the live site to MySQL must wait until all Node-owned database APIs have migrated.
- Existing Node scrypt hashes are checked once through a loopback-only KDF endpoint protected by the per-launch internal token. Webman remains the authentication authority, creates the Session, and immediately replaces a successfully verified legacy hash with PHP's current password hash. No browser route exposes the KDF endpoint.

## Current Route Ownership

### Webman

- Health and request context: `/api/health`
- Passport page: `/passport` with the extracted scene/theme UI, responsive login/register/recovery flows, and legacy hash-route redirects
- Passport API: local slider/click-word CAPTCHA, registration, login, logout, availability and current profile
- Account security: email verification, password reset/change, TOTP setup/enable/disable
- Profile and social links
- Realtime tickets and SSE entry point
- Unified Messaging, notifications, attachments, presence leases and Centrifugo authorization
- Text selections, annotations and selection activity
- Wikist Native Community, organization Q&A spaces, moderation and Community revisions
- Global knowledge-object resolution for Community, Messaging and organization-forum references
- Site-wide achievements and growth timeline
- Admin user search, pagination, role/status editing and last-admin protection
- Frontend root and installation redirect

### Node Compatibility Service

- Pages, revisions, review, citations and Markdown rendering
- Search/FTS and knowledge links
- Article comments, ratings, favorites and watches
- Translation and the base collaboration-organization store; forum writes mirror incrementally into the Webman knowledge graph
- Plugins, imports/exports, backup/restore, runtime metrics and installer APIs

The remaining migration work is content-adjacent: page files, article comments/ratings, translation, collaboration organization persistence, plugins, import/export and backup orchestration. New Community, Messaging and identity features must be implemented in Webman rather than added to the compatibility service.

## Code Organization

```text
webman-backend/
  app/controller/       HTTP input/output only
  app/service/          authentication, security, mail and realtime use cases
  app/repository/       Wikist database access and aggregate queries
  app/domain/passport/  identity and role policy
  app/middleware/       request context, origin, auth and security boundaries
  app/process/          Workerman realtime processes
  database/schema/      compatible SQLite and MySQL bootstrap schemas
  tools/                migration, import and health checks
```

The implementation deliberately avoids translating `passport-store.js` line by line. For example, the admin user list aggregates statistics in bounded grouped queries instead of calling a statistics query once for every user.

## Migration Stages

1. **Project audit - complete.** Node routes, stores, files, cache, jobs and legacy Passport duplication mapped.
2. **Infrastructure - complete for 1.0.** Webman 2.2, unified configuration, shared database, middleware, hybrid launcher, `update.php` and update integration live in the Wikist root.
3. **Passport/users/permissions - complete.** Login, account security, user administration, profile and session authority are Webman-owned.
4. **Ordinary APIs - active.** Native Community, selections, achievements and Messaging have moved; content-file and organization compatibility modules remain.
5. **Chat/AI/realtime - Messaging complete, AI reserved.** Durable chat and notification behavior is Webman-owned and Centrifugo is transport-only; future AI streaming must use Workerman connections and must not fall back to polling.
6. **Background jobs - active.** Transactional Messaging outbox and maintenance checks exist; indexing, import and backup jobs remain migration candidates.
7. **Node retirement - pending.** Confirm that legacy hashes and compatibility traffic have drained, disable the proxy, run final data checks, then remove only the old server code whose routes have zero compatibility traffic.

## Verification Gate For Every Module

- API request/response compatibility, pagination and error codes
- Existing SQLite data read/write regression
- authorization matrix and disabled-user behavior
- query count, latency and memory comparison
- CSRF/origin, session fixation, enumeration and audit checks
- streaming continuity for SSE/WebSocket/AI responses
- rollback test before deleting the corresponding Node implementation

`X-Wikist-Backend: webman` marks migrated JSON responses. Forwarded responses use `X-Wikist-Backend: legacy-node`, which makes compatibility traffic measurable without exposing user data.
