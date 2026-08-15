<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS messaging_presence_leases (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_context TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messaging_presence_leases_seen ON messaging_presence_leases(last_seen_at);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS messaging_presence_leases (
    user_id BIGINT UNSIGNED NOT NULL,
    client_id VARCHAR(100) NOT NULL,
    last_seen_at VARCHAR(40) NOT NULL,
    last_context VARCHAR(100) NOT NULL DEFAULT '',
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, client_id),
    KEY idx_messaging_presence_leases_seen (last_seen_at),
    CONSTRAINT fk_messaging_presence_lease_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
};
