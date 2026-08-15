<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $columns = $pdo->query("PRAGMA table_info(content_selection_comments)")?->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $hasColumn = array_filter($columns, static fn (array $column): bool => ($column['name'] ?? '') === 'reply_to_comment_id');
        if ($hasColumn === []) {
            $pdo->exec('ALTER TABLE content_selection_comments ADD COLUMN reply_to_comment_id INTEGER NOT NULL DEFAULT 0');
        }
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_selection_comments_reply ON content_selection_comments(reply_to_comment_id, status, id)');
        return;
    }

    $statement = $pdo->prepare(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
    );
    $statement->execute(['content_selection_comments', 'reply_to_comment_id']);
    if (!$statement->fetchColumn()) {
        $pdo->exec('ALTER TABLE content_selection_comments ADD COLUMN reply_to_comment_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER user_id');
    }

    $index = $pdo->prepare(
        'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
    );
    $index->execute(['content_selection_comments', 'idx_selection_comments_reply']);
    if (!$index->fetchColumn()) {
        $pdo->exec('CREATE INDEX idx_selection_comments_reply ON content_selection_comments(reply_to_comment_id, status, id)');
    }
};
