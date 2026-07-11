# Writing Commons And Community Review

## Academic Identity And Forum (v0.11)

- Every active organization membership is part of a Passport academic identity. The account center and public profile show organization, role, active task count, and topic contribution count. Pending memberships remain private to the member.
- `#/organizations` is the paginated personal identity directory. `#/organizations?user=<username>` exposes only a user's active public memberships.
- `#/organization/<slug>?tab=forum` is the organization's durable forum workspace. It supports paginated topics, title/body/article search, topic categories, open/resolved/locked state, latest/active/unresolved sorting, coordinator pinning, and independently paginated replies.
- `#/organization/<slug>` is a paged workspace rather than one long overview: **首页** renders the public Markdown charter and facts, **协作任务** has its own filters and pagination, **学术论坛** owns topic/reply pagination, and **成员** owns applications and role changes. The horizontal sub-navigation remains scrollable on narrow screens.
- A topic may link to an article and an optional language. New topics notify active organization members through the existing inbox; replies, resolution, and locking notify only the author and topic followers. Members can follow or favorite a topic without creating a second social data store.
- Joining a request-only organization notifies active coordinators. Approval, removal, and role changes notify the affected member. Task publication, claim, and status changes are also directed to the relevant organization members, creators, and assignees.
- Article pages render a paginated organization-task context for writing, translation, and review tasks. Review consensus remains scoped to the exact page or translation snapshot.

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
PUT  /api/community/posts/:postId/follow
PUT  /api/community/posts/:postId/favorite
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

The temporary-database check creates public and request-only organizations, verifies applicant/coordinator/member notices, assigns reviewers, creates and claims tasks, follows and favorites a discussion, persists a reply, reaches a two-reviewer article consensus, reaches a two-reviewer translation consensus, and verifies that an unaffiliated reader cannot vote.
