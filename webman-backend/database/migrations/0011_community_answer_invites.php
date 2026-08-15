<?php

return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS community_answer_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    question_id INTEGER NOT NULL REFERENCES community_questions(id) ON DELETE CASCADE,
    inviter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    responded_at TEXT NOT NULL DEFAULT '',
    UNIQUE(question_id, invitee_user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_answer_invites_question ON community_answer_invites(question_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_answer_invites_user ON community_answer_invites(invitee_user_id, status, created_at DESC);
SQL);
        return;
    }

    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS community_answer_invites (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    question_id BIGINT UNSIGNED NOT NULL,
    inviter_user_id BIGINT UNSIGNED NOT NULL,
    invitee_user_id BIGINT UNSIGNED NOT NULL,
    message VARCHAR(1000) NOT NULL DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    responded_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_answer_invites_public (public_id),
    UNIQUE KEY uq_community_answer_invites_question_user (question_id, invitee_user_id),
    KEY idx_community_answer_invites_question (question_id, status, created_at),
    KEY idx_community_answer_invites_user (invitee_user_id, status, created_at),
    CONSTRAINT fk_community_answer_invites_question FOREIGN KEY (question_id) REFERENCES community_questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_answer_invites_inviter FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_answer_invites_invitee FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL);
};
