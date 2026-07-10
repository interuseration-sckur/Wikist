# Comments, Routes, and Permissions

## Abstract Page Routes

A page keeps its article route:

```text
#/page/<slug>
```

Related wiki functions use abstract routes with the same slug at the end:

```text
#/history/<slug>
#/comments/<slug>
#/permissions/<slug>
#/edit/<slug>
```

For example:

```text
#/page/abstract-algebra
#/history/abstract-algebra
#/comments/abstract-algebra
#/permissions/abstract-algebra
```

## Comment System Choice

Wikist uses a local SQLite comment layer for now. The model is inspired by self-hosted comment systems such as Waline: Markdown content, local storage, guest identity fields, and user identity integration.

The reason for not using giscus or utterances as the default is that both rely on GitHub identity and GitHub Discussions/Issues, which conflicts with Wikist Passport and guest mode.

## Permission Policies

Each page has two policies stored in `page_permissions`:

- `editPolicy`: `guest`, `user`, or `locked`.
- `commentPolicy`: `guest`, `user`, or `locked`.

Meaning:

- `guest`: visitors and logged-in users may act.
- `user`: only logged-in Passport users may act.
- `locked`: action is closed.

## Guest Identity

Guest edits and comments require:

- display nickname
- email
- optional website

Wikist also records a stable HttpOnly visitor cookie, IP metadata, and user agent for audit and abuse control.

## Tables

- `page_permissions`: per-page edit/comment policy.
- `page_comments`: local Markdown comments.
- `guest_profiles`: visitor identity and activity counters.
- `page_edit_events`: edit audit trail.