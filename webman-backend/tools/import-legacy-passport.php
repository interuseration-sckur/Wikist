<?php

require __DIR__ . '/database.php';

['pdo' => $target] = wikist_database();
['pdo' => $source] = wikist_database('PASSPORT_IMPORT');

$profileFile = getenv('PASSPORT_IMPORT_PROFILE_JSON') ?: '';
$profiles = $profileFile !== '' && is_file($profileFile)
    ? (json_decode(file_get_contents($profileFile), true) ?: [])
    : [];
$sourceUsers = $source->query('SELECT * FROM user ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$existing = $target->query('SELECT id, LOWER(username) username, LOWER(COALESCE(email, "")) email FROM users')->fetchAll(PDO::FETCH_ASSOC);
$usernames = array_fill_keys(array_column($existing, 'username'), true);
$emails = array_fill_keys(array_filter(array_column($existing, 'email')), true);
$mapped = $target->prepare('SELECT 1 FROM passport_import_map WHERE source = ? AND source_user_id = ?');

$insert = $target->prepare('INSERT INTO users (
    username, email, display_name, password_hash, password_salt, role, status, bio, avatar_url,
    social_links_json, page_md, email_verified_at, two_factor_secret, two_factor_enabled,
    two_factor_confirmed_at, two_factor_recovery_json, last_security_at, created_at, updated_at,
    password_updated_at, last_sync_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
$map = $target->prepare('INSERT INTO passport_import_map (source, source_user_id, wikist_user_id, imported_at) VALUES (?,?,?,?)');

$imported = 0;
$skipped = 0;
$target->beginTransaction();
try {
    foreach ($sourceUsers as $legacy) {
        $mapped->execute(['sckur-passport', (string) $legacy['id']]);
        $username = strtolower(trim((string) $legacy['username']));
        $email = strtolower(trim((string) ($legacy['email'] ?? '')));
        if ($mapped->fetchColumn() || isset($usernames[$username]) || ($email !== '' && isset($emails[$email]))) {
            $skipped++;
            continue;
        }
        $profile = is_array($profiles[$legacy['username']] ?? null) ? $profiles[$legacy['username']] : [];
        $social = array_filter([
            'website' => $profile['website'] ?? '',
            'github' => $profile['github'] ?? '',
            'x' => $profile['twitter'] ?? '',
        ]);
        $now = gmdate('c');
        $insert->execute([
            $legacy['username'], $email !== '' ? $email : null,
            trim((string) ($legacy['nickname'] ?? '')) ?: $legacy['username'],
            $legacy['password'], '', 'member', ($legacy['status'] ?? 'ok') === 'ok' ? 'active' : 'disabled',
            (string) ($profile['introduce'] ?? ''), (string) ($legacy['avatar'] ?? ''),
            json_encode($social, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), '', '', '', 0, '', '[]',
            $now, $now, $now, $now, $now,
        ]);
        $userId = (int) $target->lastInsertId();
        $map->execute(['sckur-passport', (string) $legacy['id'], $userId, $now]);
        $usernames[$username] = true;
        if ($email !== '') {
            $emails[$email] = true;
        }
        $imported++;
    }
    $target->commit();
    echo "Imported {$imported} Passport users; skipped {$skipped}." . PHP_EOL;
} catch (Throwable $error) {
    $target->rollBack();
    throw $error;
}
