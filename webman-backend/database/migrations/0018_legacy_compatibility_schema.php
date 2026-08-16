<?php

return static function (PDO $pdo, string $driver): void {
    // The compatibility process only supports SQLite. Keeping these tables in a
    // versioned Webman migration prevents the legacy Node runtime from owning DDL.
    if ($driver !== 'sqlite') {
        return;
    }

    $schemaPath = dirname(__DIR__) . '/schema/wikist.legacy.sqlite.sql';
    $schema = file_get_contents($schemaPath);
    if ($schema === false || trim($schema) === '') {
        throw new RuntimeException('Missing legacy compatibility schema.');
    }
    $pdo->exec($schema);

    // FTS5 remains optional. Unsupported SQLite builds keep the lightweight
    // search fallback without preventing an installation or upgrade.
    try {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS wikist_search_index_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS wikist_page_fts USING fts5(
    slug UNINDEXED,
    title_terms,
    summary_terms,
    body_terms,
    category_terms,
    author_terms,
    title UNINDEXED,
    summary UNINDEXED,
    body UNINDEXED,
    categories UNINDEXED,
    quality UNINDEXED,
    difficulty UNINDEXED,
    author UNINDEXED,
    updated_at UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);
SQL);
    } catch (Throwable) {
        // Search will report FTS as unavailable and use the in-memory index.
    }
};
