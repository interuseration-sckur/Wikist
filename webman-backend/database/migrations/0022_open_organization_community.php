<?php

return static function (PDO $pdo, string $driver): void {
    $tableExists = static function (string $table) use ($pdo, $driver): bool {
        if ($driver === 'sqlite') {
            $statement = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
            $statement->execute([$table]);
            return (bool) $statement->fetchColumn();
        }
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $statement->execute([$table]);
        return (bool) $statement->fetchColumn();
    };

    if ($tableExists('writing_organizations')) {
        $pdo->exec("UPDATE writing_organizations SET visibility = 'public' WHERE visibility = 'private'");
    }
    if ($tableExists('community_spaces')) {
        $pdo->exec("UPDATE community_spaces SET visibility = 'public' WHERE visibility <> 'public'");
    }
    if ($tableExists('community_questions')) {
        $pdo->exec("UPDATE community_questions SET visibility = 'public' WHERE visibility <> 'public'");
    }
    if (!$tableExists('knowledge_objects')) {
        return;
    }

    $select = $pdo->query("SELECT id, object_type, metadata_json FROM knowledge_objects WHERE object_type IN ('question', 'answer', 'comment')");
    $update = $pdo->prepare('UPDATE knowledge_objects SET metadata_json = ?, updated_at = ? WHERE id = ?');
    foreach ($select?->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $metadata = json_decode((string) ($row['metadata_json'] ?? '{}'), true);
        $metadata = is_array($metadata) ? $metadata : [];
        $changed = array_key_exists('private', $metadata) || (($metadata['visibility'] ?? 'public') !== 'public');
        unset($metadata['private']);
        if ((string) ($row['object_type'] ?? '') === 'question') {
            $metadata['visibility'] = 'public';
        }
        if ($changed) {
            $update->execute([
                json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
                gmdate('c'),
                (int) $row['id'],
            ]);
        }
    }
};
