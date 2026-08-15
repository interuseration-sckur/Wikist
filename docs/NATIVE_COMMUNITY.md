# Wikist Native Community

Wikist Community is a Webman-native Q&A domain. Questions, answers, comments, votes, reactions, collections, follows, revisions, invitations, reputation, badges, moderation queues and organization spaces are stored in the Wikist database and exposed through `/api/community/qa/*`.

## Ownership Boundaries

- Passport is the only account, session and account-status source.
- Existing Wikist organizations and roles control organization Community access.
- `CommunityQaService` is the public application facade; repositories own persistence and permission services enforce access before data leaves Webman.
- Messaging and Centrifugo carry notifications and realtime events. Centrifugo never owns Community data or permissions.
- Knowledge objects and relations connect questions, answers and comments to Wiki entries, revisions, users, organizations and messages.
- Organization forum topics and replies reuse the same reference grammar and resolver. They are indexed as `question` and `answer` objects under the `organization_forum` source, with organization, answer and reference relations preserved for reverse lookup.

## Data Model

Native tables use the `community_*` prefix. Stable public IDs are separate from database row IDs, and every public object is synchronized to `knowledge_objects`. Cross-object links are written to `knowledge_relations`, allowing reverse lookup without coupling Community to another product schema.

Private organization content is filtered independently in feeds, detail reads, search, previews, relations, notifications and moderation. A missing permission is returned as not found so private object existence is not leaked.

## Runtime

The unified process group contains:

1. Webman/Workerman as the public application and business API.
2. The loopback Node compatibility process for modules that have not moved to Webman yet.
3. Centrifugo as the optional realtime transport.

There is no separate Q&A process, account database, remote Q&A API or Go runtime. Migration `0013_remove_answer_bridge.php` removes obsolete bridge-only tables while preserving Native Community and knowledge-graph data.

Migration `0016_organization_forum_knowledge.php` backfills forum content created before 1.0. New topic and reply writes update only their own objects and outgoing relations, so normal forum activity does not trigger a global rebuild.

## Verification

Run the focused Community regression suite:

```powershell
npm run check:community
```

The default `npm run check` also validates PHP syntax, Webman routes, Native Community behavior, permissions, knowledge relations and messaging integration.

## Provenance

Apache Answer was studied as a mature Q&A product during the original domain design. Wikist's implementation is independently organized around its own Webman services, Passport identity, organization permissions, database schema and Design System; no Answer runtime or source code is distributed as part of the current system.
