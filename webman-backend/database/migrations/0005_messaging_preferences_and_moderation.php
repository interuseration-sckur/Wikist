<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS messaging_user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    open_mode INTEGER NOT NULL DEFAULT 0,
    auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
    auto_reply_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_follows (
    follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (follower_user_id, following_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_user_id, created_at);
CREATE TABLE IF NOT EXISTS messaging_auto_reply_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    last_sent_at TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_messaging_auto_reply_sent ON messaging_auto_reply_state(last_sent_at);
CREATE TABLE IF NOT EXISTS messaging_conversation_mutes (
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    muted_until TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_messaging_conversation_mutes_active ON messaging_conversation_mutes(conversation_id, muted_until);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS messaging_user_preferences (
    user_id BIGINT UNSIGNED NOT NULL,
    open_mode TINYINT(1) NOT NULL DEFAULT 0,
    auto_reply_enabled TINYINT(1) NOT NULL DEFAULT 0,
    auto_reply_text VARCHAR(500) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_messaging_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS user_follows (
    follower_user_id BIGINT UNSIGNED NOT NULL,
    following_user_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (follower_user_id, following_user_id),
    KEY idx_user_follows_following (following_user_id, created_at),
    KEY idx_user_follows_follower (follower_user_id, created_at),
    CONSTRAINT fk_user_follows_follower FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_follows_following FOREIGN KEY (following_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS messaging_auto_reply_state (
    user_id BIGINT UNSIGNED NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    last_sent_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, conversation_id),
    KEY idx_messaging_auto_reply_sent (last_sent_at),
    CONSTRAINT fk_messaging_auto_reply_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_auto_reply_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS messaging_conversation_mutes (
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    muted_by BIGINT UNSIGNED NULL,
    muted_until VARCHAR(40) NOT NULL DEFAULT '',
    reason VARCHAR(300) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_messaging_conversation_mutes_active (conversation_id, muted_until),
    CONSTRAINT fk_messaging_mute_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_mute_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_mute_actor FOREIGN KEY (muted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
