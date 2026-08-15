<?php

/**
 * Backfills legacy organization forum topics and replies into the unified
 * knowledge-object graph. New writes are maintained incrementally by the
 * compatibility store, so this migration only bridges pre-1.0 content.
 */
return static function (PDO $pdo, string $driver): void {
    $tableExists = static function (string $table) use ($pdo, $driver): bool {
        if ($driver === 'sqlite') {
            $statement = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
            $statement->execute([$table]);
            return (bool) $statement->fetchColumn();
        }
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $statement->execute([$table]);
        return (bool) $statement->fetchColumn();
    };
    if (!$tableExists('organization_posts') || !$tableExists('organization_post_replies')
        || !$tableExists('knowledge_objects') || !$tableExists('knowledge_relations')) {
        return;
    }

    $globalId = static function (string $type, string $key, string $source = 'wikist'): string {
        $type = strtolower(trim($type)) === 'page' ? 'wiki_entry' : strtolower(trim($type));
        $source = preg_replace('/[^a-z0-9_-]+/i', '-', strtolower(trim($source))) ?: 'wikist';
        return sprintf('wko:v1:%s:%s:%s', $source, $type, hash('sha256', trim($key)));
    };
    $plain = static function (string $markdown): string {
        $markdown = preg_replace_callback('/\{\{ref:[a-z_]+\|[^|{}\n]+(?:\|([^{}\n]+))?\}\}/i', static fn (array $match): string => trim((string) ($match[1] ?? '')), $markdown) ?? $markdown;
        $markdown = preg_replace_callback('/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/', static fn (array $match): string => trim((string) ($match[2] ?? $match[1])), $markdown) ?? $markdown;
        return mb_substr(trim((string) preg_replace('/[`*_>#~\[\]()]+/u', ' ', $markdown)), 0, 4000);
    };
    $extract = static function (string $markdown): array {
        $items = [];
        $seen = [];
        $add = static function (string $type, string $id, string $label) use (&$items, &$seen): void {
            $type = strtolower(trim($type)) === 'page' ? 'wiki_entry' : strtolower(trim($type));
            $id = trim($id);
            if ($id === '' || !in_array($type, ['wiki_entry', 'revision', 'question', 'answer', 'comment', 'organization', 'user', 'selection'], true)) {
                return;
            }
            $key = $type . ':' . $id;
            if (isset($seen[$key]) || count($items) >= 32) {
                return;
            }
            $seen[$key] = true;
            $items[] = ['type' => $type, 'id' => $id, 'label' => mb_substr(trim($label) ?: $id, 0, 255)];
        };
        preg_match_all('/\{\{ref:([a-z_]+)\|([^|{}\n]+)(?:\|([^{}\n]+))?\}\}/i', $markdown, $matches, PREG_SET_ORDER);
        foreach ($matches as $match) {
            $add((string) $match[1], (string) $match[2], (string) ($match[3] ?? $match[2]));
        }
        preg_match_all('/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/', $markdown, $matches, PREG_SET_ORDER);
        foreach ($matches as $match) {
            $add('wiki_entry', (string) $match[1], (string) ($match[2] ?? $match[1]));
        }
        return $items;
    };

    $objectSql = $driver === 'sqlite'
        ? <<<'SQL'
INSERT INTO knowledge_objects
    (global_id, object_type, object_key, source_system, external_id, title, summary, canonical_url, language, organization_id, author_user_id, status, search_text, metadata_json, synced_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_system, object_type, object_key) DO UPDATE SET
    global_id = excluded.global_id, title = excluded.title, summary = excluded.summary,
    canonical_url = excluded.canonical_url, language = excluded.language,
    organization_id = excluded.organization_id, author_user_id = excluded.author_user_id,
    status = excluded.status, search_text = excluded.search_text,
    metadata_json = excluded.metadata_json, synced_at = excluded.synced_at, updated_at = excluded.updated_at
SQL
        : <<<'SQL'
INSERT INTO knowledge_objects
    (global_id, object_type, object_key, source_system, external_id, title, summary, canonical_url, language, organization_id, author_user_id, status, search_text, metadata_json, synced_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    global_id = VALUES(global_id), title = VALUES(title), summary = VALUES(summary),
    canonical_url = VALUES(canonical_url), language = VALUES(language),
    organization_id = VALUES(organization_id), author_user_id = VALUES(author_user_id),
    status = VALUES(status), search_text = VALUES(search_text),
    metadata_json = VALUES(metadata_json), synced_at = VALUES(synced_at), updated_at = VALUES(updated_at)
SQL;
    $objectStatement = $pdo->prepare($objectSql);
    $upsertObject = static function (array $data) use ($objectStatement, $globalId): string {
        $now = gmdate('c');
        $type = (string) $data['type'];
        $key = (string) $data['key'];
        $source = (string) ($data['source'] ?? 'organization_forum');
        $id = $globalId($type, $key, $source);
        $title = mb_substr(trim((string) ($data['title'] ?? $key)), 0, 500);
        $summary = mb_substr(trim((string) ($data['summary'] ?? '')), 0, 4000);
        $objectStatement->execute([
            $id, $type, $key, $source, (string) ($data['externalId'] ?? $key), $title, $summary,
            mb_substr((string) ($data['url'] ?? ''), 0, 1000), mb_substr((string) ($data['language'] ?? ''), 0, 32),
            $data['organizationId'] ?? null, $data['authorUserId'] ?? null, (string) ($data['status'] ?? 'active'),
            mb_substr(trim((string) ($data['searchText'] ?? ($title . ' ' . $summary . ' ' . $key))), 0, 20000),
            json_encode($data['metadata'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            $now, $now, $now,
        ]);
        return $id;
    };

    $relationSql = $driver === 'sqlite'
        ? 'INSERT INTO knowledge_relations (relation_key,subject_global_id,predicate,object_global_id,actor_user_id,source_system,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(relation_key) DO UPDATE SET actor_user_id=excluded.actor_user_id,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at'
        : 'INSERT INTO knowledge_relations (relation_key,subject_global_id,predicate,object_global_id,actor_user_id,source_system,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE actor_user_id=VALUES(actor_user_id),metadata_json=VALUES(metadata_json),updated_at=VALUES(updated_at)';
    $relationStatement = $pdo->prepare($relationSql);
    $relate = static function (string $subject, string $predicate, string $object, ?int $actor, array $metadata = []) use ($relationStatement): void {
        if ($subject === '' || $object === '' || $subject === $object) {
            return;
        }
        $now = gmdate('c');
        $source = 'organization_forum';
        $relationStatement->execute([
            hash('sha256', implode('|', [$subject, $predicate, $object, $source])), $subject, $predicate, $object,
            $actor, $source, json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}', $now, $now,
        ]);
    };
    $findStatement = $pdo->prepare("SELECT global_id FROM knowledge_objects WHERE object_type = ? AND object_key = ? AND status = 'active' ORDER BY CASE source_system WHEN 'wikist' THEN 0 WHEN 'organization_forum' THEN 1 ELSE 2 END LIMIT 1");
    $target = static function (array $reference) use ($findStatement, $upsertObject): string {
        $type = (string) $reference['type'];
        $rawKey = (string) $reference['id'];
        $keys = [$rawKey];
        if ($type === 'revision' && str_contains($rawKey, '@')) {
            $keys[] = substr($rawKey, 0, (int) strrpos($rawKey, '@'));
        }
        foreach ($keys as $key) {
            $findStatement->execute([$type, $key]);
            $id = $findStatement->fetchColumn();
            if ($id) {
                return (string) $id;
            }
        }
        $forumSource = in_array($type, ['question', 'answer'], true) && preg_match('/^organization-post(?:-reply)?:/i', $rawKey);
        return $upsertObject([
            'type' => $type, 'key' => $rawKey, 'source' => $forumSource ? 'organization_forum' : 'wikist',
            'title' => (string) $reference['label'],
            'url' => $type === 'wiki_entry' ? '#/page/' . str_replace('%2F', '/', rawurlencode($rawKey)) : ($type === 'question' && !$forumSource ? '#/questions/' . rawurlencode($rawKey) : '#/knowledge'),
            'metadata' => ['indexedFrom' => 'organization_forum_reference'],
        ]);
    };

    $posts = $pdo->query("SELECT p.*, o.slug AS organization_slug, o.name AS organization_name FROM organization_posts p JOIN writing_organizations o ON o.id = p.organization_id")?->fetchAll(PDO::FETCH_OBJ) ?: [];
    $deleteRelations = $pdo->prepare("DELETE FROM knowledge_relations WHERE subject_global_id = ? AND source_system = 'organization_forum'");
    foreach ($posts as $post) {
        $topicKey = 'organization-post:' . (int) $post->id;
        $topicUrl = '#/organization/' . rawurlencode((string) $post->organization_slug) . '?tab=forum&topic=' . (int) $post->id;
        $topic = $upsertObject([
            'type' => 'question', 'key' => $topicKey, 'externalId' => (string) $post->id,
            'title' => (string) $post->title, 'summary' => $plain((string) $post->body_md), 'url' => $topicUrl,
            'language' => (string) $post->language, 'organizationId' => (int) $post->organization_id,
            'authorUserId' => (int) $post->author_user_id, 'status' => (string) $post->status === 'hidden' ? 'deleted' : 'active',
            'metadata' => ['postId' => (int) $post->id, 'organizationSlug' => (string) $post->organization_slug, 'visibility' => 'organization'],
        ]);
        $deleteRelations->execute([$topic]);
        $findStatement->execute(['organization', (string) $post->organization_id]);
        $organizationTarget = (string) ($findStatement->fetchColumn() ?: $upsertObject([
            'type' => 'organization', 'key' => (string) $post->organization_id, 'source' => 'wikist',
            'title' => (string) $post->organization_name,
            'url' => '#/organization/' . rawurlencode((string) $post->organization_slug),
            'organizationId' => (int) $post->organization_id,
            'metadata' => ['slug' => (string) $post->organization_slug],
        ]));
        $relate($topic, 'belongs_to', $organizationTarget, (int) $post->author_user_id, ['scope' => 'organization']);
        $references = $extract((string) $post->body_md);
        if ((string) $post->page_slug !== '') {
            array_unshift($references, ['type' => 'wiki_entry', 'id' => (string) $post->page_slug, 'label' => (string) $post->page_slug]);
        }
        foreach ($references as $reference) {
            $relate($topic, 'references', $target($reference), (int) $post->author_user_id, ['label' => $reference['label']]);
        }

        $replyStatement = $pdo->prepare('SELECT * FROM organization_post_replies WHERE post_id = ?');
        $replyStatement->execute([(int) $post->id]);
        foreach ($replyStatement->fetchAll(PDO::FETCH_OBJ) ?: [] as $reply) {
            $replyKey = 'organization-post-reply:' . (int) $reply->id;
            $answer = $upsertObject([
                'type' => 'answer', 'key' => $replyKey, 'externalId' => (string) $reply->id,
                'title' => '回复：' . (string) $post->title, 'summary' => $plain((string) $reply->content_md),
                'url' => $topicUrl . '&reply=' . (int) $reply->id, 'language' => (string) $post->language,
                'organizationId' => (int) $post->organization_id, 'authorUserId' => (int) $reply->author_user_id,
                'status' => (string) $reply->status === 'published' ? 'active' : 'deleted',
                'metadata' => ['postId' => (int) $post->id, 'replyId' => (int) $reply->id, 'organizationSlug' => (string) $post->organization_slug, 'visibility' => 'organization'],
            ]);
            $deleteRelations->execute([$answer]);
            $relate($answer, 'answers', $topic, (int) $reply->author_user_id, ['postId' => (int) $post->id]);
            $relate($answer, 'belongs_to', $organizationTarget, (int) $reply->author_user_id, ['scope' => 'organization']);
            foreach ($extract((string) $reply->content_md) as $reference) {
                $relate($answer, 'references', $target($reference), (int) $reply->author_user_id, ['label' => $reference['label']]);
            }
        }
    }
};
