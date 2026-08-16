<?php

declare(strict_types=1);

require __DIR__ . '/database.php';

$scope = 'all';
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--yes') continue;
    if (str_starts_with($argument, '--scope=')) {
        $scope = substr($argument, 8);
        continue;
    }
    if ($argument === '--help' || $argument === '-h') {
        echo "Usage: php tools/repair.php --yes [--scope=all|sqlite|messaging-memberships|operational|attachments]\n";
        exit(0);
    }
    fwrite(STDERR, "Unknown option: {$argument}\n");
    exit(2);
}
if (!in_array('--yes', $argv, true)) {
    fwrite(STDERR, "Refusing repair without --yes. Run doctor first.\n");
    exit(2);
}
if (!in_array($scope, ['all', 'sqlite', 'messaging-memberships', 'operational', 'attachments'], true)) {
    fwrite(STDERR, "Unknown repair scope: {$scope}\n");
    exit(2);
}

['pdo' => $pdo, 'driver' => $driver] = wikist_database();
$root = dirname(__DIR__, 2);
$now = gmdate('c');
$actions = [];
$run = static fn (string $name): bool => $scope === 'all' || $scope === $name;

function wikist_repair_public_id(string $prefix): string
{
    return $prefix . '_' . rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
}

function wikist_repair_table_exists(PDO $pdo, string $driver, string $table): bool
{
    if ($driver === 'sqlite') {
        $statement = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
    } else {
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?');
    }
    $statement->execute([$table]);
    return (bool) $statement->fetchColumn();
}

function wikist_repair_conversation(PDO $pdo, array $values): int
{
    $find = $pdo->prepare('SELECT id, title, description, avatar_url, status FROM messaging_conversations WHERE direct_key = ?');
    $find->execute([$values['direct_key']]);
    $existing = $find->fetch(PDO::FETCH_ASSOC);
    if ($existing) {
        $changed = (string) $existing['title'] !== $values['title']
            || (string) $existing['description'] !== $values['description']
            || (string) $existing['avatar_url'] !== $values['avatar_url']
            || (string) $existing['status'] !== 'active';
        if ($changed) {
            $update = $pdo->prepare('UPDATE messaging_conversations SET title=?, description=?, avatar_url=?, organization_id=?, status=?, metadata_json=?, updated_at=? WHERE id=?');
            $update->execute([$values['title'], $values['description'], $values['avatar_url'], $values['organization_id'], 'active', $values['metadata_json'], $values['updated_at'], $existing['id']]);
        }
        return (int) $existing['id'];
    }
    $insert = $pdo->prepare('INSERT INTO messaging_conversations (public_id, kind, direct_key, title, description, avatar_url, organization_id, owner_user_id, status, last_message_id, message_count, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?, ?)');
    $insert->execute([wikist_repair_public_id('conv'), $values['kind'], $values['direct_key'], $values['title'], $values['description'], $values['avatar_url'], $values['organization_id'], 'active', $values['metadata_json'], $values['updated_at'], $values['updated_at']]);
    return (int) $pdo->lastInsertId();
}

function wikist_repair_member(PDO $pdo, int $conversationId, int $userId, string $role, string $status, string $joinedAt): bool
{
    $find = $pdo->prepare('SELECT role, status FROM messaging_conversation_members WHERE conversation_id=? AND user_id=?');
    $find->execute([$conversationId, $userId]);
    $existing = $find->fetch(PDO::FETCH_ASSOC);
    if ($existing) {
        if ((string) $existing['role'] === $role && (string) $existing['status'] === $status) return false;
        $update = $pdo->prepare('UPDATE messaging_conversation_members SET role=?, status=?, updated_at=? WHERE conversation_id=? AND user_id=?');
        $update->execute([$role, $status, gmdate('c'), $conversationId, $userId]);
        return true;
    }
    $insert = $pdo->prepare("INSERT INTO messaging_conversation_members (conversation_id, user_id, role, status, notification_level, last_read_message_id, last_read_at, muted_until, pinned_at, archived_at, joined_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, 'all', NULL, '', '', '', '', ?, ?, '{}')");
    $insert->execute([$conversationId, $userId, $role, $status, $joinedAt ?: gmdate('c'), gmdate('c')]);
    return true;
}

function wikist_repair_cleanup_files(string $directory, int $cutoff): int
{
    if (!is_dir($directory) || is_link($directory)) return 0;
    $root = realpath($directory);
    if (!$root) return 0;
    $removed = 0;
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($iterator as $file) {
        if ($file->isLink()) continue;
        $real = $file->getRealPath();
        if (!$real || ($real !== $root && !str_starts_with($real, $root . DIRECTORY_SEPARATOR))) continue;
        if ($file->isFile() && $file->getMTime() < $cutoff && preg_match('/(?:\.tmp|\.part|\.staging)$/i', $file->getFilename())) {
            if (@unlink($real)) $removed++;
        } elseif ($file->isDir()) {
            @rmdir($real);
        }
    }
    return $removed;
}

if ($run('sqlite') && $driver === 'sqlite') {
    $pdo->exec('PRAGMA busy_timeout=10000');
    $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    $pdo->exec('PRAGMA optimize');
    $actions[] = ['scope' => 'sqlite', 'checkpoint' => 'truncate', 'optimize' => true];
}

if ($run('messaging-memberships') && wikist_repair_table_exists($pdo, $driver, 'messaging_conversations')) {
    $changed = 0;
    $pdo->beginTransaction();
    try {
        $users = $pdo->query("SELECT id, created_at FROM users WHERE status IN ('active','ok') ORDER BY id")?->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $siteId = wikist_repair_conversation($pdo, [
            'kind' => 'system', 'direct_key' => 'system:site', 'title' => '全站公告', 'description' => '来自站点管理团队的公开消息。',
            'avatar_url' => '', 'organization_id' => null, 'metadata_json' => '{"scope":"site"}', 'updated_at' => $now,
        ]);
        $baseline = $pdo->prepare('SELECT MAX(id) FROM messaging_messages WHERE conversation_id=? AND created_at<=?');
        $setBaseline = $pdo->prepare('UPDATE messaging_conversation_members SET last_read_message_id=?, last_read_at=?, updated_at=? WHERE conversation_id=? AND user_id=? AND last_read_message_id IS NULL');
        foreach ($users as $user) {
            $personalId = wikist_repair_conversation($pdo, [
                'kind' => 'system', 'direct_key' => 'system:user:' . $user['id'], 'title' => '通知中心', 'description' => '与你相关的站内通知、提及与协作动态。',
                'avatar_url' => '', 'organization_id' => null, 'metadata_json' => '{"scope":"personal"}', 'updated_at' => $now,
            ]);
            $changed += wikist_repair_member($pdo, $personalId, (int) $user['id'], 'member', 'active', (string) $user['created_at']) ? 1 : 0;
            $changed += wikist_repair_member($pdo, $siteId, (int) $user['id'], 'member', 'active', (string) $user['created_at']) ? 1 : 0;
            $baseline->execute([$siteId, $user['created_at']]);
            $cursor = $baseline->fetchColumn();
            if ($cursor) $setBaseline->execute([$cursor, $user['created_at'], $now, $siteId, $user['id']]);
        }
        $organizations = $pdo->query("SELECT id, slug, name, description, avatar_image FROM writing_organizations WHERE status='active' ORDER BY id")?->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $members = $pdo->prepare("SELECT m.user_id, m.role, m.joined_at, cm.role AS current_role FROM organization_members m JOIN users u ON u.id=m.user_id LEFT JOIN messaging_conversation_members cm ON cm.user_id=m.user_id AND cm.conversation_id=? WHERE m.organization_id=? AND m.status='active' AND u.status IN ('active','ok')");
        $removeStale = $pdo->prepare("UPDATE messaging_conversation_members SET status='removed', updated_at=? WHERE conversation_id=? AND user_id NOT IN (SELECT user_id FROM organization_members WHERE organization_id=? AND status='active') AND status='active'");
        foreach ($organizations as $organization) {
            $conversationId = wikist_repair_conversation($pdo, [
                'kind' => 'organization', 'direct_key' => 'organization:' . $organization['id'], 'title' => (string) $organization['name'], 'description' => (string) $organization['description'],
                'avatar_url' => (string) $organization['avatar_image'], 'organization_id' => (int) $organization['id'],
                'metadata_json' => json_encode(['organizationSlug' => (string) $organization['slug']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'updated_at' => $now,
            ]);
            $members->execute([$conversationId, $organization['id']]);
            foreach ($members->fetchAll(PDO::FETCH_ASSOC) as $member) {
                $role = $member['role'] === 'owner' ? 'owner' : ($member['role'] === 'coordinator' ? 'admin' : 'member');
                if ($role === 'member' && in_array((string) ($member['current_role'] ?? ''), ['owner', 'admin'], true)) $role = (string) $member['current_role'];
                $changed += wikist_repair_member($pdo, $conversationId, (int) $member['user_id'], $role, 'active', (string) $member['joined_at']) ? 1 : 0;
            }
            $removeStale->execute([$now, $conversationId, $organization['id']]);
            $changed += $removeStale->rowCount();
        }
        $pdo->commit();
        $actions[] = ['scope' => 'messaging-memberships', 'changed' => $changed, 'users' => count($users), 'organizations' => count($organizations)];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

if ($run('operational')) {
    foreach ([
        'sessions' => ['expires_at', $now],
        'passport_tokens' => ['expires_at', $now],
        'captchas' => ['expires_at', $now],
        'messaging_presence_leases' => ['last_seen_at', gmdate('c', time() - 3600)],
        'messaging_user_presence' => ['last_seen_at', gmdate('c', time() - 3600)],
    ] as $table => [$column, $cutoff]) {
        if (!wikist_repair_table_exists($pdo, $driver, $table)) continue;
        $statement = $pdo->prepare("DELETE FROM {$table} WHERE {$column} < ?");
        $statement->execute([$cutoff]);
        $actions[] = ['scope' => 'operational', 'table' => $table, 'purged' => $statement->rowCount()];
    }
    if (wikist_repair_table_exists($pdo, $driver, 'messaging_outbox_events')) {
        $published = $pdo->prepare("DELETE FROM messaging_outbox_events WHERE status='published' AND published_at<>'' AND published_at<?");
        $published->execute([gmdate('c', time() - 604800)]);
        $stale = $pdo->prepare("UPDATE messaging_outbox_events SET status='pending', available_at=?, updated_at=? WHERE status='processing' AND updated_at<?");
        $stale->execute([$now, $now, gmdate('c', time() - 120)]);
        $actions[] = ['scope' => 'operational', 'publishedOutboxPurged' => $published->rowCount(), 'staleOutboxReset' => $stale->rowCount()];
    }
}

if ($run('attachments') && wikist_repair_table_exists($pdo, $driver, 'messaging_attachments')) {
    $configured = getenv('MESSAGING_ATTACHMENT_ROOT') ?: '../data/uploads/messaging';
    $attachmentRoot = preg_match('~^(?:[A-Za-z]:[\\\\/]|[/\\\\]{1,2})~', $configured)
        ? $configured
        : dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $configured);
    if (!is_dir($attachmentRoot)) @mkdir($attachmentRoot, 0770, true);
    $rootReal = realpath($attachmentRoot);
    $expired = $pdo->prepare("SELECT id, storage_path FROM messaging_attachments WHERE status='pending' AND created_at<? ORDER BY id LIMIT 1000");
    $expired->execute([gmdate('c', time() - max(3600, (int) (getenv('ATTACHMENT_PENDING_TTL_SECONDS') ?: 86400)))]);
    $ids = [];
    $files = 0;
    foreach ($expired->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ids[] = (int) $row['id'];
        $candidate = $attachmentRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $row['storage_path']);
        if (!$rootReal || is_link($candidate) || !is_file($candidate)) continue;
        $candidateReal = realpath($candidate);
        if ($candidateReal && str_starts_with($candidateReal, $rootReal . DIRECTORY_SEPARATOR) && @unlink($candidateReal)) $files++;
    }
    if ($ids) {
        $delete = $pdo->prepare('DELETE FROM messaging_attachments WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ") AND status='pending'");
        $delete->execute($ids);
    }
    $staging = wikist_repair_cleanup_files($root . '/data/backups/.staging', time() - 86400);
    $actions[] = ['scope' => 'attachments', 'rowsPurged' => count($ids), 'filesPurged' => $files, 'stagingFilesPurged' => $staging];
}

if ($driver === 'sqlite') {
    $integrity = (string) $pdo->query('PRAGMA quick_check')?->fetchColumn();
    if ($integrity !== 'ok') throw new RuntimeException('SQLite quick_check failed after repair: ' . $integrity);
}

echo json_encode(['ok' => true, 'repairedAt' => $now, 'driver' => $driver, 'scope' => $scope, 'actions' => $actions], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
