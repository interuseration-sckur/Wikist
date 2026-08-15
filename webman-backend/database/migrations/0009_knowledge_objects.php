<?php

/**
 * Defines Wikist's global knowledge object and relation layer.
 */
return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS knowledge_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    global_id TEXT NOT NULL UNIQUE,
    object_type TEXT NOT NULL,
    object_key TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'wikist',
    external_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    organization_id INTEGER,
    author_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    search_text TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    synced_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_system, object_type, object_key)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_type ON knowledge_objects(object_type, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_external ON knowledge_objects(source_system, external_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_org ON knowledge_objects(organization_id, object_type, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_author ON knowledge_objects(author_user_id, object_type, updated_at);

CREATE TABLE IF NOT EXISTS knowledge_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relation_key TEXT NOT NULL UNIQUE,
    subject_global_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_global_id TEXT NOT NULL,
    actor_user_id INTEGER,
    source_system TEXT NOT NULL DEFAULT 'wikist',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_subject ON knowledge_relations(subject_global_id, predicate, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_object ON knowledge_relations(object_global_id, predicate, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_actor ON knowledge_relations(actor_user_id, updated_at);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS knowledge_objects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    global_id VARCHAR(255) NOT NULL,
    object_type VARCHAR(48) NOT NULL,
    object_key VARCHAR(255) NOT NULL,
    source_system VARCHAR(48) NOT NULL DEFAULT 'wikist',
    external_id VARCHAR(255) NOT NULL DEFAULT '',
    title VARCHAR(500) NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    canonical_url VARCHAR(1000) NOT NULL DEFAULT '',
    language VARCHAR(32) NOT NULL DEFAULT '',
    organization_id BIGINT UNSIGNED NULL,
    author_user_id BIGINT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    search_text LONGTEXT NOT NULL,
    metadata_json LONGTEXT NOT NULL,
    synced_at VARCHAR(40) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_knowledge_global_id (global_id),
    UNIQUE KEY uk_knowledge_source_object (source_system, object_type, object_key),
    KEY idx_knowledge_objects_type (object_type, status, updated_at),
    KEY idx_knowledge_objects_external (source_system, external_id),
    KEY idx_knowledge_objects_org (organization_id, object_type, status),
    KEY idx_knowledge_objects_author (author_user_id, object_type, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_relations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    relation_key CHAR(64) NOT NULL,
    subject_global_id VARCHAR(255) NOT NULL,
    predicate VARCHAR(64) NOT NULL,
    object_global_id VARCHAR(255) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    source_system VARCHAR(48) NOT NULL DEFAULT 'wikist',
    metadata_json LONGTEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_knowledge_relation_key (relation_key),
    KEY idx_knowledge_relations_subject (subject_global_id, predicate, updated_at),
    KEY idx_knowledge_relations_object (object_global_id, predicate, updated_at),
    KEY idx_knowledge_relations_actor (actor_user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
