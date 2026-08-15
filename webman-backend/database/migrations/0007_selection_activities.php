<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS content_selection_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selection_id INTEGER NOT NULL REFERENCES content_selections(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    target_label TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_selection_activities_selection ON content_selection_activities(selection_id, activity_type, created_at);
CREATE INDEX IF NOT EXISTS idx_selection_activities_user ON content_selection_activities(user_id, activity_type, created_at);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS content_selection_activities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    selection_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    activity_type VARCHAR(32) NOT NULL,
    target_type VARCHAR(48) NOT NULL DEFAULT '',
    target_id VARCHAR(190) NOT NULL DEFAULT '',
    target_label VARCHAR(255) NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    KEY idx_selection_activities_selection (selection_id, activity_type, created_at),
    KEY idx_selection_activities_user (user_id, activity_type, created_at),
    CONSTRAINT fk_selection_activity_selection FOREIGN KEY (selection_id) REFERENCES content_selections(id) ON DELETE CASCADE,
    CONSTRAINT fk_selection_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
