<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS security_rate_limits (
    key_hash TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_rate_limits_updated ON security_rate_limits(updated_at);
SQL);
        return;
    }
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS security_rate_limits (
    key_hash CHAR(64) NOT NULL PRIMARY KEY,
    scope VARCHAR(40) NOT NULL,
    window_started_at BIGINT NOT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    blocked_until BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    INDEX idx_security_rate_limits_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
