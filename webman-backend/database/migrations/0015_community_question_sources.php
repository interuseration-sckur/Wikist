<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS community_question_sources (
    question_id INTEGER PRIMARY KEY REFERENCES community_questions(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    object_type TEXT NOT NULL DEFAULT '',
    object_key TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_question_sources_type ON community_question_sources(source_type, question_id);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS community_question_sources (
    question_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    source_type VARCHAR(40) NOT NULL,
    object_type VARCHAR(40) NOT NULL DEFAULT '',
    object_key VARCHAR(255) NOT NULL DEFAULT '',
    label VARCHAR(255) NOT NULL DEFAULT '',
    url VARCHAR(1000) NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL,
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    KEY idx_community_question_sources_type (source_type, question_id),
    CONSTRAINT fk_community_question_sources_question FOREIGN KEY (question_id) REFERENCES community_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
