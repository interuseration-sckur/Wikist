# Writing Commons And Community Review

Wikist v0.10 turns article and translation review into a lightweight community workflow. It borrows the useful structural ideas behind WikiProjects and community discussion systems without adding a forum server, a queue service, or a second identity system.

The design has four connected layers:

1. **Writing organizations** gather members around a subject, language, or maintenance goal.
2. **Tasks** make article writing, translation, and review work explicit and claimable.
3. **Discussion threads** let members record context, trade-offs, and decisions near the work rather than in an unbounded social feed.
4. **Community review** lets designated organization reviewers form a threshold-based, auditable consensus for a specific article revision or translation snapshot.

All community state stays in the Passport SQLite database. Article Markdown, revisions, and reviewed snapshots remain portable files.

## Organizations And Roles

Open `#/community` to browse or create organizations, then visit `#/organization/<slug>` for its task board, discussion stream, and members.

Creating an organization makes the creator its `owner`. Members may be assigned one of these roles:

- `member`: joins discussions and may claim tasks.
- `writer`: a visible writing responsibility role.
- `translator`: a visible translation responsibility role.
- `reviewer`: may vote on matching community review tasks.
- `coordinator`: manages members, tasks, and organization discussions.
- `owner`: may additionally transfer owner-level roles and configure the join policy or consensus threshold through the API.

Organizations use either direct joining (`public`) or a pending-application flow (`request`). A coordinator promotes pending members by updating their membership status and role. The last active owner cannot be demoted, so an organization never loses its governance anchor.

## Tasks

Coordinators create `write`, `translate`, or `review` tasks against an existing page slug. Translation and review tasks may be scoped to a target language.

Members can claim an open task, move their own claimed task to `ready`, and coordinators can close it. The task board is paginated; no organization page tries to render an unbounded backlog.

An article page shows a compact collaboration panel for linked tasks. Review tasks link readers to the article's review screen; this keeps task discovery on the article while avoiding a duplicate review interface.

## Discussion Stream

Active organization members can create Markdown discussion threads and reply to them. Coordinators can publish announcements or decisions, pin useful discussions, and mark a thread resolved or reopen it.

Threads are intentionally scoped to an organization. They can optionally reference a page slug and target language. New organization discussions and final consensus events reuse the existing direct-message inbox for active members, so notifications are not implemented as an unrelated system.

## Community Review Consensus

A community reviewer can only vote when all of these conditions hold:

- the user is an active organization member with `reviewer`, `coordinator`, or `owner` role;
- the organization has an open review task for that page;
- the task's language is blank or matches the target translation language;
- the exact current page revision or translation snapshot has not already received a final organization consensus.

Each eligible user has one updatable vote per organization, subject, language, and revision snapshot. A vote is either `approve` or `changes_requested` and may include a review note. When either side reaches the organization’s configured threshold, Wikist records immutable consensus metadata:

- For an article approval, the server snapshots the current Markdown, writes the stable revision pointer, and adds a review note named after the organization consensus.
- For an article change request, the stable pointer is preserved and a consensus review note is added.
- For a translation approval, the translation becomes `published`, gets a community reviewer label, and enters translation memory through the existing review-gated path.
- For a translation change request, the translation becomes `changes_requested`.

Senior editors and administrators retain the existing direct review controls as a safety and maintenance path. Community consensus is an additional transparent route, not an attempt to hide editorial responsibility.

## API Surface

Public list and detail routes:

```text
GET /api/community/organizations?page=1&limit=12&q=algebra
GET /api/community/organizations/:slug
GET /api/community/organizations/:slug/members
GET /api/community/organizations/:slug/tasks
GET /api/community/organizations/:slug/posts
```

Authenticated organization actions:

```text
POST /api/community/organizations
PUT  /api/community/organizations/:slug
POST /api/community/organizations/:slug/join
PUT  /api/community/organizations/:slug/members/:userId
POST /api/community/organizations/:slug/tasks
POST /api/community/tasks/:taskId/claim
PUT  /api/community/tasks/:taskId
POST /api/community/organizations/:slug/posts
POST /api/community/posts/:postId/replies
PUT  /api/community/posts/:postId
```

Article and translation community review routes:

```text
GET  /api/pages/:slug/community
POST /api/pages/:slug/community-review
POST /api/pages/:slug/translation/:language/community-review
```

## Translation Entry

`#/translate/<slug>` is now a language chooser instead of silently selecting English. It displays existing language progress and source-change state, supports target languages already configured on the site or in the translator profile, and accepts a BCP-47-style custom language code. The actual workbench remains `#/translate/<slug>?lang=<language>`.

## Verification

```powershell
npm run check:v10
```

The temporary-database check creates an organization, assigns reviewers, creates and claims tasks, persists a discussion reply, reaches a two-reviewer article consensus, reaches a two-reviewer translation consensus, and verifies that an unaffiliated reader cannot vote.
