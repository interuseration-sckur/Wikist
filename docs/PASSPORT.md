# Wikist Passport

Wikist Passport is the built-in account layer for Wikist. It is designed as a small local identity system that can later be replaced by OAuth, SSO, or a dedicated account service.

## Storage

The default database is SQLite:

```text
data/wikist.sqlite
```

This keeps migration simple: stop the server, copy `content/`, `config/`, and `data/wikist.sqlite`, then start Wikist on the new machine.

## Features

- Register and login with username or email.
- Optional verified-email login gate with SMTP verification mail.
- Password recovery through short-lived hashed reset tokens.
- Optional TOTP two-factor authentication per user.
- Change password from the account center.
- HttpOnly cookie sessions.
- Password hashing with Node.js `crypto.scrypt` and per-user salt.
- CAPTCHA arithmetic challenge stored in SQLite.
- Automatic author attribution when a logged-in user edits a page.

## Tables

- `users`: account profile, password hash, role, status.
- `sessions`: server-side session records and expiration.
- `captchas`: short-lived human verification challenges.
- `passport_tokens`: one-time hashed tokens for email verification and password reset.

## Production Notes

Set a stable secret before deployment:

```powershell
$env:WIKIST_PASSPORT_SECRET = "replace-with-a-long-random-secret"
```

The current implementation uses Node's built-in `node:sqlite`, which is available in modern Node.js releases. If deploying to an older runtime, replace `src/core/passport-store.js` with a compatible SQLite adapter such as `better-sqlite3` or migrate the same interface to PostgreSQL/MySQL.
## Wiki Identity Integration

Passport is now part of the wiki editing model:

- Logged-in edits are recorded with `user_id`, display name, username label, page slug, action, time, user agent, and IP metadata.
- Guest edits receive a stable HttpOnly `wikist_guest` cookie and are recorded in `guest_profiles` with first seen, last seen, user agent, IP, and edit count.
- Page edit history is available at `GET /api/pages/:slug/edits`.
- Public user pages are available at `GET /api/users/:username` and `#/user/:username`.
- Each account owns a Markdown profile page stored in SQLite as `users.page_md`.

Additional tables:

- `guest_profiles`: basic visitor identity for guest edits.
- `page_edit_events`: append-only wiki edit audit events.

The account center can update display name, email, bio, avatar, external profile links, and Markdown profile. External links support personal website, blog, GitHub, Zhihu, Bilibili, X, and Mastodon; only `http` / `https` URLs are stored and public pages render only the links the user provided. Saving the profile updates `last_sync_at`, which the UI shows as the user data synchronization timestamp.

## Mail And Security

Administrators can configure SMTP from the site settings page. The public site API only exposes safe mail metadata; SMTP passwords stay in local config and are never returned to the browser. When enabled, Wikist sends verification links for registration/email changes and reset links for password recovery.

Two-factor authentication uses TOTP secrets encrypted at rest with the site passport secret. Users can enable or disable it from the account security center, and login requires a current one-time code once it is enabled.
