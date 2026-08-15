<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS content_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    object_label TEXT NOT NULL DEFAULT '',
    object_url TEXT NOT NULL DEFAULT '',
    selected_text TEXT NOT NULL,
    prefix_text TEXT NOT NULL DEFAULT '',
    suffix_text TEXT NOT NULL DEFAULT '',
    start_offset INTEGER NOT NULL DEFAULT 0,
    end_offset INTEGER NOT NULL DEFAULT 0,
    anchor_hash TEXT NOT NULL,
    creator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(object_type, object_id, anchor_hash)
);
CREATE INDEX IF NOT EXISTS idx_content_selections_object ON content_selections(object_type, object_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_content_selections_creator ON content_selections(creator_user_id, status, created_at);
CREATE TABLE IF NOT EXISTS content_selection_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selection_id INTEGER NOT NULL REFERENCES content_selections(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reply_to_comment_id INTEGER NOT NULL DEFAULT 0,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_selection_comments_selection ON content_selection_comments(selection_id, status, id);
CREATE INDEX IF NOT EXISTS idx_selection_comments_user ON content_selection_comments(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_selection_comments_reply ON content_selection_comments(reply_to_comment_id, status, id);
CREATE TABLE IF NOT EXISTS content_selection_likes (
    selection_id INTEGER NOT NULL REFERENCES content_selections(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (selection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_selection_likes_user ON content_selection_likes(user_id, created_at);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS content_selections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    object_type VARCHAR(48) NOT NULL,
    object_id VARCHAR(190) NOT NULL,
    object_label VARCHAR(255) NOT NULL DEFAULT '',
    object_url VARCHAR(1024) NOT NULL DEFAULT '',
    selected_text TEXT NOT NULL,
    prefix_text VARCHAR(500) NOT NULL DEFAULT '',
    suffix_text VARCHAR(500) NOT NULL DEFAULT '',
    start_offset INT UNSIGNED NOT NULL DEFAULT 0,
    end_offset INT UNSIGNED NOT NULL DEFAULT 0,
    anchor_hash CHAR(64) NOT NULL,
    creator_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_content_selection_anchor (object_type, object_id, anchor_hash),
    KEY idx_content_selections_object (object_type, object_id, status, created_at),
    KEY idx_content_selections_creator (creator_user_id, status, created_at),
    CONSTRAINT fk_content_selection_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS content_selection_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    selection_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    reply_to_comment_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    deleted_at VARCHAR(40) NOT NULL DEFAULT '',
    KEY idx_selection_comments_selection (selection_id, status, id),
    KEY idx_selection_comments_user (user_id, status, created_at),
    KEY idx_selection_comments_reply (reply_to_comment_id, status, id),
    CONSTRAINT fk_selection_comment_selection FOREIGN KEY (selection_id) REFERENCES content_selections(id) ON DELETE CASCADE,
    CONSTRAINT fk_selection_comment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS content_selection_likes (
    selection_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (selection_id, user_id),
    KEY idx_selection_likes_user (user_id, created_at),
    CONSTRAINT fk_selection_like_selection FOREIGN KEY (selection_id) REFERENCES content_selections(id) ON DELETE CASCADE,
    CONSTRAINT fk_selection_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
