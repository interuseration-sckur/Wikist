<?php

return static function (PDO $pdo, string $driver): void {
    $columns = [
        'session_version' => $driver === 'sqlite' ? "INTEGER NOT NULL DEFAULT 1" : "INT UNSIGNED NOT NULL DEFAULT 1",
        'pending_email' => $driver === 'sqlite' ? "TEXT NOT NULL DEFAULT ''" : "VARCHAR(254) NOT NULL DEFAULT ''",
        'pending_email_requested_at' => $driver === 'sqlite' ? "TEXT NOT NULL DEFAULT ''" : "VARCHAR(40) NOT NULL DEFAULT ''",
        'pending_two_factor_secret' => $driver === 'sqlite' ? "TEXT NOT NULL DEFAULT ''" : "VARCHAR(255) NOT NULL DEFAULT ''",
        'pending_two_factor_created_at' => $driver === 'sqlite' ? "TEXT NOT NULL DEFAULT ''" : "VARCHAR(40) NOT NULL DEFAULT ''",
    ];

    $hasColumn = static function (string $table, string $column) use ($pdo, $driver): bool {
        if ($driver === 'sqlite') {
            foreach ($pdo->query("PRAGMA table_info({$table})")?->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                if ((string) ($row['name'] ?? '') === $column) {
                    return true;
                }
            }
            return false;
        }
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?');
        $statement->execute([$table, $column]);
        return (bool) $statement->fetchColumn();
    };

    foreach ($columns as $name => $definition) {
        if (!$hasColumn('users', $name)) {
            $pdo->exec("ALTER TABLE users ADD COLUMN {$name} {$definition}");
        }
    }

    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS wikist_security_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
SQL);
    } else {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS wikist_security_state (
    state_key VARCHAR(190) NOT NULL PRIMARY KEY,
    state_value VARCHAR(500) NOT NULL DEFAULT '',
    updated_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
    }

    $adminCount = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")?->fetchColumn();
    if ($adminCount > 0) {
        $statement = $pdo->prepare($driver === 'sqlite'
            ? 'INSERT OR IGNORE INTO wikist_security_state (state_key, state_value, updated_at) VALUES (?, ?, ?)'
            : 'INSERT IGNORE INTO wikist_security_state (state_key, state_value, updated_at) VALUES (?, ?, ?)');
        $statement->execute(['initial_admin_created', 'legacy', gmdate('c')]);
    }
};
