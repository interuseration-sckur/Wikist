<?php

require __DIR__ . '/database.php';

$legacy = (string) (getenv('WIKIST_PASSPORT_SECRET') ?: '');
$current = (string) (getenv('APP_SECRET') ?: '');
if ($legacy === '' || $current === '' || hash_equals($legacy, $current)) {
    fwrite(STDOUT, "Wikist encrypted secrets require no migration.\n");
    exit(0);
}
if (strlen($current) < 32) {
    throw new RuntimeException('APP_SECRET must contain at least 32 bytes before encrypted secrets can be migrated.');
}

function wikist_secret_key(string $secret): string
{
    return hash('sha256', $secret . ':wikist-secret-v1', true);
}

function wikist_secret_decode(string $value, string $secret): ?string
{
    $parts = explode(':', $value);
    if (count($parts) !== 4 || $parts[0] !== 'v1') {
        return null;
    }
    $decode = static fn (string $part): string|false => base64_decode(strtr($part, '-_', '+/'), true);
    $iv = $decode($parts[1]);
    $tag = $decode($parts[2]);
    $encrypted = $decode($parts[3]);
    if ($iv === false || $tag === false || $encrypted === false) {
        return null;
    }
    $plain = openssl_decrypt($encrypted, 'aes-256-gcm', wikist_secret_key($secret), OPENSSL_RAW_DATA, $iv, $tag);
    return is_string($plain) ? $plain : null;
}

function wikist_secret_encode(string $value, string $secret): string
{
    $iv = random_bytes(12);
    $tag = '';
    $encrypted = openssl_encrypt($value, 'aes-256-gcm', wikist_secret_key($secret), OPENSSL_RAW_DATA, $iv, $tag);
    if ($encrypted === false) {
        throw new RuntimeException('Unable to encrypt a migrated account secret.');
    }
    $encode = static fn (string $part): string => rtrim(strtr(base64_encode($part), '+/', '-_'), '=');
    return 'v1:' . $encode($iv) . ':' . $encode($tag) . ':' . $encode($encrypted);
}

['pdo' => $pdo] = wikist_database();
$pdo->beginTransaction();
try {
    $rows = $pdo->query("SELECT id, two_factor_secret, pending_two_factor_secret FROM users WHERE two_factor_secret <> '' OR pending_two_factor_secret <> ''")?->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $update = $pdo->prepare('UPDATE users SET two_factor_secret = ?, pending_two_factor_secret = ?, updated_at = ? WHERE id = ?');
    $migrated = 0;
    foreach ($rows as $row) {
        $values = [];
        $changed = false;
        foreach (['two_factor_secret', 'pending_two_factor_secret'] as $column) {
            $ciphertext = (string) ($row[$column] ?? '');
            if ($ciphertext === '' || wikist_secret_decode($ciphertext, $current) !== null) {
                $values[$column] = $ciphertext;
                continue;
            }
            $plain = wikist_secret_decode($ciphertext, $legacy);
            if ($plain === null) {
                throw new RuntimeException("Unable to decrypt {$column} for user {$row['id']}; secret migration stopped without changes.");
            }
            $values[$column] = wikist_secret_encode($plain, $current);
            $changed = true;
        }
        if ($changed) {
            $update->execute([$values['two_factor_secret'], $values['pending_two_factor_secret'], gmdate('c'), (int) $row['id']]);
            $migrated++;
        }
    }
    $pdo->commit();
    fwrite(STDOUT, "Wikist encrypted account secrets migrated: {$migrated}.\n");
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $error;
}
