<?php

require __DIR__ . '/database.php';

$options = getopt('', ['username:', 'yes']);
$username = trim((string) ($options['username'] ?? ''));
if ($username === '' || !array_key_exists('yes', $options)) {
    fwrite(STDERR, "Usage: php tools/recover-admin.php --username=<username> --yes\n");
    exit(2);
}

['pdo' => $pdo, 'driver' => $driver] = wikist_database();
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->beginTransaction();
try {
    $activeAdmin = $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'")?->fetchColumn();
    if ((int) $activeAdmin > 0) {
        throw new RuntimeException('An active administrator already exists; recovery was refused.');
    }

    $find = $pdo->prepare('SELECT id, username FROM users WHERE username = ? LIMIT 1');
    $find->execute([$username]);
    $user = $find->fetch(PDO::FETCH_ASSOC);
    if (!$user) {
        throw new RuntimeException("User '{$username}' does not exist.");
    }

    $now = gmdate('c');
    $update = $pdo->prepare("UPDATE users SET role = 'admin', status = 'active', session_version = session_version + 1, last_security_at = ?, updated_at = ? WHERE id = ?");
    $update->execute([$now, $now, (int) $user['id']]);

    $stateSql = $driver === 'sqlite'
        ? 'INSERT INTO wikist_security_state (state_key, state_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at'
        : 'INSERT INTO wikist_security_state (state_key, state_value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)';
    $state = $pdo->prepare($stateSql);
    $state->execute(['initial_admin_created', 'server-cli-recovery', $now]);

    $tables = $driver === 'sqlite'
        ? $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")?->fetchAll(PDO::FETCH_COLUMN)
        : $pdo->query('SHOW TABLES')?->fetchAll(PDO::FETCH_COLUMN);
    $tables = array_fill_keys(array_map('strval', $tables ?: []), true);
    if (isset($tables['passport_sessions'])) {
        $deleteSessions = $pdo->prepare('DELETE FROM passport_sessions WHERE user_id = ?');
        $deleteSessions->execute([(int) $user['id']]);
    }
    if (isset($tables['site_audit_logs'])) {
        $audit = $pdo->prepare("INSERT INTO site_audit_logs (actor_type, user_id, guest_id, actor_name, actor_label, action, target_type, target_id, target_label, summary, metadata_json, ip, user_agent, created_at) VALUES ('system', NULL, NULL, 'server-cli', 'Server CLI', 'admin.recovered', 'user', ?, ?, ?, '{}', NULL, 'recover-admin.php', ?)");
        $audit->execute([(string) $user['id'], (string) $user['username'], "Recovered administrator account {$user['username']} from the server console.", $now]);
    }

    $pdo->commit();
    fwrite(STDOUT, "Administrator access recovered for {$user['username']}. Existing sessions were invalidated.\n");
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "Administrator recovery failed: {$error->getMessage()}\n");
    exit(1);
}
