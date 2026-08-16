<?php

return static function (PDO $pdo, string $driver): void {
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

    if (!$hasColumn('messaging_user_preferences', 'show_online_status')) {
        $pdo->exec($driver === 'sqlite'
            ? 'ALTER TABLE messaging_user_preferences ADD COLUMN show_online_status INTEGER NOT NULL DEFAULT 0'
            : 'ALTER TABLE messaging_user_preferences ADD COLUMN show_online_status TINYINT(1) NOT NULL DEFAULT 0');
    }
};
