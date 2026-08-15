<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS achievement_sync_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stats_json TEXT NOT NULL DEFAULT '{}',
    evaluated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_achievement_sync_updated ON achievement_sync_state(updated_at);
SQL);
    } else {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS achievement_sync_state (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    stats_json JSON NOT NULL,
    evaluated_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    KEY idx_achievement_sync_updated (updated_at),
    CONSTRAINT fk_achievement_sync_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
    }

    $now = gmdate('c');
    $achievements = [
        ['profile-complete', '身份初成', '完善公开身份、头像与个人简介。', 'bronze', 'user-round-check', 'profile_complete', 1],
        ['first-edit', '知识落笔', '完成第一次词条编辑。', 'bronze', 'file-pen-line', 'edits', 1],
        ['knowledge-builder', '知识建造者', '累计完成 25 次词条编辑。', 'silver', 'library-big', 'edits', 25],
        ['source-curator', '知识策展人', '累计收藏 10 个词条。', 'bronze', 'bookmark', 'favorites', 10],
        ['watch-keeper', '持续关注', '关注 10 个知识对象的更新。', 'bronze', 'radar', 'watches', 10],
        ['community-connector', '同行相连', '关注 5 位社区成员。', 'bronze', 'users-round', 'following', 5],
        ['organization-collaborator', '协作同行', '加入一个协作组织。', 'bronze', 'network', 'organizations', 1],
        ['translation-contributor', '语言桥梁', '提交第一篇词条译文。', 'silver', 'languages', 'translations', 1],
        ['text-annotator', '正文批注者', '发布第一条正文批注。', 'bronze', 'highlighter', 'annotations', 1],
        ['active-correspondent', '协作通信者', '累计发送 25 条协作消息。', 'bronze', 'messages-square', 'messages', 25],
    ];
    $sql = $driver === 'sqlite'
        ? "INSERT OR IGNORE INTO community_badges (slug,name,description,level,icon,rule_key,threshold,is_repeatable,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,'active',?,?)"
        : "INSERT IGNORE INTO community_badges (slug,name,description,level,icon,rule_key,threshold,is_repeatable,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,'active',?,?)";
    $statement = $pdo->prepare($sql);
    foreach ($achievements as $achievement) {
        $statement->execute([...$achievement, $now, $now]);
    }
};
