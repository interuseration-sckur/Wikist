<?php

/**
 * Import legacy notification rows into the unified messaging domain.
 * The legacy tables remain authoritative during the hybrid migration; runtime
 * writes are mirrored separately, so this migration only handles existing rows.
 */
return static function (PDO $pdo, string $driver): void {
    $hasTable = static function (string $table) use ($pdo, $driver): bool {
        if ($driver === 'sqlite') {
            $statement = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
            $statement->execute([$table]);
            return (bool) $statement->fetchColumn();
        }
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $statement->execute([$table]);
        return (bool) $statement->fetchColumn();
    };

    if (!$hasTable('users')) {
        return;
    }

    $now = gmdate('c');
    $insertConversation = $pdo->prepare(
        'INSERT INTO messaging_conversations '
        . '(public_id, kind, direct_key, title, description, avatar_url, organization_id, owner_user_id, status, last_message_id, message_count, metadata_json, created_at, updated_at) '
        . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $findConversation = $pdo->prepare('SELECT id FROM messaging_conversations WHERE direct_key = ?');
    $insertMember = $pdo->prepare($driver === 'sqlite'
        ? 'INSERT OR IGNORE INTO messaging_conversation_members (conversation_id, user_id, role, status, notification_level, last_read_message_id, last_read_at, muted_until, pinned_at, archived_at, joined_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        : 'INSERT IGNORE INTO messaging_conversation_members (conversation_id, user_id, role, status, notification_level, last_read_message_id, last_read_at, muted_until, pinned_at, archived_at, joined_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $insertMessage = $pdo->prepare(
        'INSERT INTO messaging_messages '
        . '(public_id, conversation_id, sender_user_id, sender_name, sender_avatar, message_type, body_md, body_plain, reply_to_message_id, status, client_nonce, priority, metadata_json, created_at, edited_at, withdrawn_at) '
        . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $insertLegacy = $pdo->prepare($driver === 'sqlite'
        ? 'INSERT OR IGNORE INTO messaging_legacy_links (legacy_type, legacy_id, legacy_user_id, conversation_id, message_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
        : 'INSERT IGNORE INTO messaging_legacy_links (legacy_type, legacy_id, legacy_user_id, conversation_id, message_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)');

    $lastInsertId = static fn (): int => (int) $pdo->lastInsertId();
    $conversationFor = static function (string $key, string $title, ?int $userId = null) use (
        $findConversation,
        $insertConversation,
        $insertMember,
        $lastInsertId,
        $now
    ): int {
        $findConversation->execute([$key]);
        $id = $findConversation->fetchColumn();
        if (!$id) {
            $insertConversation->execute([
                'conv_' . bin2hex(random_bytes(12)), 'system', $key, $title, '', '', null, null,
                'active', null, 0, '{}', $now, $now,
            ]);
            $id = $lastInsertId();
        }
        $id = (int) $id;
        if ($userId) {
            $insertMember->execute([$id, $userId, 'member', 'active', 'all', null, '', '', '', '', $now, $now, '{}']);
        }
        return $id;
    };

    if ($hasTable('user_messages')) {
        $rows = $pdo->query("SELECT * FROM user_messages WHERE deleted_at = '' ORDER BY id")?->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as $row) {
            $userId = (int) $row['recipient_user_id'];
            $conversationId = $conversationFor("system:user:{$userId}", '通知中心', $userId);
            $insertMessage->execute([
                'msg_legacy_user_' . $row['id'], $conversationId,
                $row['sender_user_id'] !== null ? (int) $row['sender_user_id'] : null,
                (string) $row['sender_name'], '', 'system',
                trim((string) $row['title'] . "\n\n" . (string) $row['body']),
                trim((string) $row['title'] . ' ' . (string) $row['body']), null,
                'published', null, (string) $row['priority'],
                json_encode([
                    'legacyKind' => $row['kind'], 'sourceType' => $row['source_type'],
                    'sourceUrl' => $row['source_url'], 'sourceLabel' => $row['source_label'],
                    'displaySeconds' => (int) $row['display_seconds'],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                (string) $row['created_at'], '', '',
            ]);
            $messageId = $lastInsertId();
            $insertLegacy->execute(['user_message', (int) $row['id'], $userId, $conversationId, $messageId, $now]);
            $pdo->prepare('UPDATE messaging_conversations SET last_message_id = ?, message_count = message_count + 1, updated_at = ? WHERE id = ?')
                ->execute([$messageId, (string) $row['created_at'], $conversationId]);
            if ((string) $row['status'] === 'read') {
                $pdo->prepare('UPDATE messaging_conversation_members SET last_read_message_id = ?, last_read_at = ?, updated_at = ? WHERE conversation_id = ? AND user_id = ?')
                    ->execute([$messageId, (string) ($row['read_at'] ?: $row['created_at']), $now, $conversationId, $userId]);
            }
        }
    }

    if ($hasTable('site_messages')) {
        $conversationId = $conversationFor('system:site', '全站公告');
        $rows = $pdo->query("SELECT * FROM site_messages WHERE status = 'active' ORDER BY id")?->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as $row) {
            $insertMessage->execute([
                'msg_legacy_site_' . $row['id'], $conversationId,
                $row['sender_user_id'] !== null ? (int) $row['sender_user_id'] : null,
                (string) $row['sender_name'], '', 'system',
                trim((string) $row['title'] . "\n\n" . (string) $row['body']),
                trim((string) $row['title'] . ' ' . (string) $row['body']), null,
                'published', null, (string) $row['priority'],
                json_encode([
                    'legacyKind' => $row['kind'], 'sourceType' => $row['source_type'],
                    'sourceUrl' => $row['source_url'], 'sourceLabel' => $row['source_label'],
                    'displaySeconds' => (int) $row['display_seconds'],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                (string) $row['created_at'], '', '',
            ]);
            $messageId = $lastInsertId();
            $insertLegacy->execute(['site_message', (int) $row['id'], 0, $conversationId, $messageId, $now]);
            $pdo->prepare('UPDATE messaging_conversations SET last_message_id = ?, message_count = message_count + 1, updated_at = ? WHERE id = ?')
                ->execute([$messageId, (string) $row['created_at'], $conversationId]);
        }
    }
};
