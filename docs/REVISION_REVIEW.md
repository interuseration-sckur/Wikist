# Lightweight Stable Revision Review

Wikist separates the editable **current version** from the last **reviewed stable version** without importing the full FlaggedRevs model.

## Workflow

1. Any contributor who passes the article edit policy saves the current Markdown page.
2. A save changes the page revision ID, so the article automatically appears in the pending-review queue if it no longer matches its stable revision.
3. A `senior_editor` or `admin` opens **Review**, compares current content with the stable snapshot, and leaves an opinion.
4. **Approve and set stable** copies the current Markdown into `content/reviewed/<slug>/<revision-id>.md`, records the reviewer and comment, and moves the stable pointer.
5. **Request changes** stores an auditable review note but does not change the stable pointer.

Readers continue to see the current version. The reader status panel always indicates whether the current version is stable, has pending changes, or has never been reviewed. The review workspace can display the approved snapshot and a line-level current-versus-stable diff.

## Storage

- Current article: `content/pages/<slug>.md`
- Ordinary edit history: `content/revisions/<slug>/...`
- Reviewed snapshot: `content/reviewed/<slug>/<revision-id>.md`
- Stable pointer and reviewer identity: SQLite table `page_stable_revisions`
- Auditable decisions and comments: SQLite table `page_review_notes`

The article text is never duplicated in SQLite. Stable snapshots travel with backups and restore packages, while the small SQLite records preserve reviewer attribution and notes.

## Permissions

- Members, creators, and editors can submit edits when an article's edit policy permits it.
- `senior_editor` and `admin` can access the review dashboard, compare versions, request changes, and approve a stable version.
- Administrators retain their existing site and user-management responsibilities; this feature does not introduce a new user group or multi-level flag configuration.

## Queue Semantics

- **Pending**: no stable revision exists, or the current revision ID differs from the stable revision ID.
- **Current stable**: the current page is exactly the approved snapshot.
- **Never reviewed**: the page has no stable pointer.

The queue is paginated and searches article title, slug, reviewer, and latest stable-review comment. A line diff uses a bounded in-memory comparison, so unusually large pages gracefully fall back to a compact changed-middle view instead of creating an expensive server job.

## Source Review

Source review and version review are intentionally separate queues. Source review is about bibliographic completeness, resolver availability, unresolved citation keys, and `{{cite-needed}}`; version review is an editorial approval of the complete current Markdown snapshot. A reviewer can use both views before approving a stable version.
