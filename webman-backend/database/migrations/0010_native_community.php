<?php

/**
 * Wikist Native Community schema.
 *
 * Domain behavior was independently reimplemented after studying Apache Answer
 * (Apache-2.0, apache/answer, main@3b9f1370612e690a0b7f230f05e688930db4c6d3).
 * No Answer database table is used as Wikist's source of truth.
 */
return static function (PDO $pdo, string $driver): void {
    if ($driver === 'sqlite') {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS community_spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL DEFAULT 'public',
    organization_id INTEGER UNIQUE REFERENCES writing_organizations(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL DEFAULT 'active',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_spaces_scope ON community_spaces(scope, visibility, status);

CREATE TABLE IF NOT EXISTS community_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    space_id INTEGER NOT NULL REFERENCES community_spaces(id) ON DELETE RESTRICT,
    organization_id INTEGER REFERENCES writing_organizations(id) ON DELETE CASCADE,
    author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'zh-CN',
    visibility TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL DEFAULT 'published',
    review_status TEXT NOT NULL DEFAULT 'approved',
    close_reason TEXT NOT NULL DEFAULT '',
    closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    closed_at TEXT NOT NULL DEFAULT '',
    accepted_answer_id INTEGER,
    view_count INTEGER NOT NULL DEFAULT 0,
    unique_view_count INTEGER NOT NULL DEFAULT 0,
    answer_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    upvote_count INTEGER NOT NULL DEFAULT 0,
    downvote_count INTEGER NOT NULL DEFAULT 0,
    vote_score INTEGER NOT NULL DEFAULT 0,
    reaction_count INTEGER NOT NULL DEFAULT 0,
    collection_count INTEGER NOT NULL DEFAULT 0,
    follower_count INTEGER NOT NULL DEFAULT 0,
    hot_score REAL NOT NULL DEFAULT 0,
    current_revision_id INTEGER,
    last_activity_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_questions_feed ON community_questions(space_id, status, last_activity_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_community_questions_org ON community_questions(organization_id, visibility, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_questions_author ON community_questions(author_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_questions_hot ON community_questions(status, hot_score DESC, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS community_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    question_id INTEGER NOT NULL REFERENCES community_questions(id) ON DELETE CASCADE,
    author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    review_status TEXT NOT NULL DEFAULT 'approved',
    is_accepted INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    upvote_count INTEGER NOT NULL DEFAULT 0,
    downvote_count INTEGER NOT NULL DEFAULT 0,
    vote_score INTEGER NOT NULL DEFAULT 0,
    reaction_count INTEGER NOT NULL DEFAULT 0,
    collection_count INTEGER NOT NULL DEFAULT 0,
    current_revision_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accepted_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_answers_question ON community_answers(question_id, status, is_accepted DESC, vote_score DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_community_answers_author ON community_answers(author_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS community_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    question_id INTEGER NOT NULL REFERENCES community_questions(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reply_to_comment_id INTEGER REFERENCES community_comments(id) ON DELETE SET NULL,
    reply_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    upvote_count INTEGER NOT NULL DEFAULT 0,
    reaction_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_comments_target ON community_comments(target_type, target_id, status, id ASC);
CREATE INDEX IF NOT EXISTS idx_community_comments_question ON community_comments(question_id, status, id ASC);
CREATE INDEX IF NOT EXISTS idx_community_comments_author ON community_comments(author_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS community_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    description_md TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    question_count INTEGER NOT NULL DEFAULT 0,
    follower_count INTEGER NOT NULL DEFAULT 0,
    is_recommended INTEGER NOT NULL DEFAULT 0,
    is_reserved INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_tags_popular ON community_tags(status, question_count DESC, follower_count DESC);

CREATE TABLE IF NOT EXISTS community_question_tags (
    question_id INTEGER NOT NULL REFERENCES community_questions(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES community_tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (question_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_community_question_tags_tag ON community_question_tags(tag_id, question_id);

CREATE TABLE IF NOT EXISTS community_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    value INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS idx_community_votes_object ON community_votes(object_type, object_id, value, updated_at);

CREATE TABLE IF NOT EXISTS community_reactions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    reaction TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id, reaction)
);
CREATE INDEX IF NOT EXISTS idx_community_reactions_object ON community_reactions(object_type, object_id, reaction, created_at);

CREATE TABLE IF NOT EXISTS community_collections (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    collection_name TEXT NOT NULL DEFAULT 'default',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS idx_community_collections_user ON community_collections(user_id, collection_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_collections_object ON community_collections(object_type, object_id, created_at);

CREATE TABLE IF NOT EXISTS community_follows (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    notification_level TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS idx_community_follows_object ON community_follows(object_type, object_id, notification_level, created_at);

CREATE TABLE IF NOT EXISTS community_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    revision_no INTEGER NOT NULL,
    editor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL DEFAULT '',
    body_md TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'approved',
    reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_opinion TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    reviewed_at TEXT NOT NULL DEFAULT '',
    UNIQUE(object_type, object_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_community_revisions_object ON community_revisions(object_type, object_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_community_revisions_review ON community_revisions(status, created_at, id);

CREATE TABLE IF NOT EXISTS community_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    parent_type TEXT NOT NULL DEFAULT '',
    parent_id INTEGER,
    space_id INTEGER REFERENCES community_spaces(id) ON DELETE CASCADE,
    organization_id INTEGER REFERENCES writing_organizations(id) ON DELETE CASCADE,
    reputation_delta INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    canceled_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_activity_feed ON community_activity(space_id, canceled_at, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_community_activity_user ON community_activity(actor_user_id, canceled_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_activity_object ON community_activity(object_type, object_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_reputation (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 0,
    rank_position INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_reputation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    activity_id INTEGER REFERENCES community_activity(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    delta INTEGER NOT NULL,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    canceled_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_reputation_events_user ON community_reputation_events(user_id, canceled_at, created_at DESC);

CREATE TABLE IF NOT EXISTS community_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'bronze',
    icon TEXT NOT NULL DEFAULT 'award',
    rule_key TEXT NOT NULL DEFAULT '',
    threshold INTEGER NOT NULL DEFAULT 0,
    is_repeatable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_badge_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    badge_id INTEGER NOT NULL REFERENCES community_badges(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    award_count INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL DEFAULT '',
    awarded_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(badge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_badge_awards_user ON community_badge_awards(user_id, awarded_at DESC);

CREATE TABLE IF NOT EXISTS community_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    organization_id INTEGER REFERENCES writing_organizations(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_reports_queue ON community_reports(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_community_reports_object ON community_reports(object_type, object_id, status);
CREATE INDEX IF NOT EXISTS idx_community_reports_org ON community_reports(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS community_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    object_type TEXT NOT NULL,
    object_id INTEGER NOT NULL,
    organization_id INTEGER REFERENCES writing_organizations(id) ON DELETE CASCADE,
    queue_type TEXT NOT NULL DEFAULT 'content',
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_community_reviews_queue ON community_reviews(status, queue_type, created_at, id);
CREATE INDEX IF NOT EXISTS idx_community_reviews_object ON community_reviews(object_type, object_id, status);
CREATE INDEX IF NOT EXISTS idx_community_reviews_org ON community_reviews(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS community_views (
    question_id INTEGER NOT NULL REFERENCES community_questions(id) ON DELETE CASCADE,
    viewer_key TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    first_viewed_at TEXT NOT NULL,
    last_viewed_at TEXT NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (question_id, viewer_key)
);
CREATE INDEX IF NOT EXISTS idx_community_views_user ON community_views(user_id, last_viewed_at DESC);

CREATE TABLE IF NOT EXISTS community_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL DEFAULT '',
    object_id INTEGER,
    storage_disk TEXT NOT NULL DEFAULT 'local',
    storage_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_attachments_object ON community_attachments(object_type, object_id, status);
CREATE INDEX IF NOT EXISTS idx_community_attachments_owner ON community_attachments(owner_user_id, status, created_at DESC);

SQL);
    } else {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS community_spaces (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    scope VARCHAR(24) NOT NULL DEFAULT 'public',
    organization_id BIGINT UNSIGNED NULL,
    slug VARCHAR(190) NOT NULL,
    name VARCHAR(255) NOT NULL,
    visibility VARCHAR(32) NOT NULL DEFAULT 'public',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    settings_json JSON NOT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_community_spaces_public (public_id),
    UNIQUE KEY uq_community_spaces_slug (slug),
    UNIQUE KEY uq_community_spaces_org (organization_id),
    KEY idx_community_spaces_scope (scope, visibility, status),
    CONSTRAINT fk_community_space_org FOREIGN KEY (organization_id) REFERENCES writing_organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_space_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_questions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    space_id BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(300) NOT NULL,
    body_md MEDIUMTEXT NOT NULL,
    body_plain MEDIUMTEXT NOT NULL,
    language VARCHAR(32) NOT NULL DEFAULT 'zh-CN',
    visibility VARCHAR(32) NOT NULL DEFAULT 'public',
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    review_status VARCHAR(32) NOT NULL DEFAULT 'approved',
    close_reason VARCHAR(500) NOT NULL DEFAULT '',
    closed_by BIGINT UNSIGNED NULL,
    closed_at VARCHAR(40) NOT NULL DEFAULT '',
    accepted_answer_id BIGINT UNSIGNED NULL,
    view_count INT UNSIGNED NOT NULL DEFAULT 0,
    unique_view_count INT UNSIGNED NOT NULL DEFAULT 0,
    answer_count INT UNSIGNED NOT NULL DEFAULT 0,
    comment_count INT UNSIGNED NOT NULL DEFAULT 0,
    upvote_count INT UNSIGNED NOT NULL DEFAULT 0,
    downvote_count INT UNSIGNED NOT NULL DEFAULT 0,
    vote_score INT NOT NULL DEFAULT 0,
    reaction_count INT UNSIGNED NOT NULL DEFAULT 0,
    collection_count INT UNSIGNED NOT NULL DEFAULT 0,
    follower_count INT UNSIGNED NOT NULL DEFAULT 0,
    hot_score DOUBLE NOT NULL DEFAULT 0,
    current_revision_id BIGINT UNSIGNED NULL,
    last_activity_at VARCHAR(40) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    deleted_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_questions_public (public_id),
    KEY idx_community_questions_feed (space_id, status, last_activity_at, id),
    KEY idx_community_questions_org (organization_id, visibility, status, last_activity_at),
    KEY idx_community_questions_author (author_user_id, status, created_at),
    KEY idx_community_questions_hot (status, hot_score, last_activity_at),
    CONSTRAINT fk_community_question_space FOREIGN KEY (space_id) REFERENCES community_spaces(id) ON DELETE RESTRICT,
    CONSTRAINT fk_community_question_org FOREIGN KEY (organization_id) REFERENCES writing_organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_question_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_community_question_closer FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_answers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    question_id BIGINT UNSIGNED NOT NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    body_md MEDIUMTEXT NOT NULL,
    body_plain MEDIUMTEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    review_status VARCHAR(32) NOT NULL DEFAULT 'approved',
    is_accepted TINYINT(1) NOT NULL DEFAULT 0,
    comment_count INT UNSIGNED NOT NULL DEFAULT 0,
    upvote_count INT UNSIGNED NOT NULL DEFAULT 0,
    downvote_count INT UNSIGNED NOT NULL DEFAULT 0,
    vote_score INT NOT NULL DEFAULT 0,
    reaction_count INT UNSIGNED NOT NULL DEFAULT 0,
    collection_count INT UNSIGNED NOT NULL DEFAULT 0,
    current_revision_id BIGINT UNSIGNED NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    accepted_at VARCHAR(40) NOT NULL DEFAULT '',
    deleted_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_answers_public (public_id),
    KEY idx_community_answers_question (question_id, status, is_accepted, vote_score, id),
    KEY idx_community_answers_author (author_user_id, status, created_at),
    CONSTRAINT fk_community_answer_question FOREIGN KEY (question_id) REFERENCES community_questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_answer_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    question_id BIGINT UNSIGNED NOT NULL,
    target_type VARCHAR(24) NOT NULL,
    target_id BIGINT UNSIGNED NOT NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    reply_to_comment_id BIGINT UNSIGNED NULL,
    reply_user_id BIGINT UNSIGNED NULL,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    upvote_count INT UNSIGNED NOT NULL DEFAULT 0,
    reaction_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    deleted_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_comments_public (public_id),
    KEY idx_community_comments_target (target_type, target_id, status, id),
    KEY idx_community_comments_question (question_id, status, id),
    KEY idx_community_comments_author (author_user_id, status, created_at),
    CONSTRAINT fk_community_comment_question FOREIGN KEY (question_id) REFERENCES community_questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_comment_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_community_comment_reply FOREIGN KEY (reply_to_comment_id) REFERENCES community_comments(id) ON DELETE SET NULL,
    CONSTRAINT fk_community_comment_reply_user FOREIGN KEY (reply_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_tags (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description_md TEXT NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT '',
    question_count INT UNSIGNED NOT NULL DEFAULT 0,
    follower_count INT UNSIGNED NOT NULL DEFAULT 0,
    is_recommended TINYINT(1) NOT NULL DEFAULT 0,
    is_reserved TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_community_tags_slug (slug),
    KEY idx_community_tags_popular (status, question_count, follower_count),
    CONSTRAINT fk_community_tag_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_question_tags (
    question_id BIGINT UNSIGNED NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (question_id, tag_id),
    KEY idx_community_question_tags_tag (tag_id, question_id),
    CONSTRAINT fk_community_qt_question FOREIGN KEY (question_id) REFERENCES community_questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_qt_tag FOREIGN KEY (tag_id) REFERENCES community_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_votes (
    user_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    value TINYINT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id),
    KEY idx_community_votes_object (object_type, object_id, value, updated_at),
    CONSTRAINT fk_community_vote_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_reactions (
    user_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    reaction VARCHAR(32) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id, reaction),
    KEY idx_community_reactions_object (object_type, object_id, reaction, created_at),
    CONSTRAINT fk_community_reaction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_collections (
    user_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    collection_name VARCHAR(100) NOT NULL DEFAULT 'default',
    note VARCHAR(500) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id),
    KEY idx_community_collections_user (user_id, collection_name, created_at),
    KEY idx_community_collections_object (object_type, object_id, created_at),
    CONSTRAINT fk_community_collection_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_follows (
    user_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    notification_level VARCHAR(24) NOT NULL DEFAULT 'all',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, object_type, object_id),
    KEY idx_community_follows_object (object_type, object_id, notification_level, created_at),
    CONSTRAINT fk_community_follow_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_revisions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    revision_no INT UNSIGNED NOT NULL,
    editor_user_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(300) NOT NULL DEFAULT '',
    body_md MEDIUMTEXT NOT NULL,
    tags_json JSON NOT NULL,
    summary VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'approved',
    reviewer_user_id BIGINT UNSIGNED NULL,
    review_opinion VARCHAR(1000) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    reviewed_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_revisions_public (public_id),
    UNIQUE KEY uq_community_revisions_sequence (object_type, object_id, revision_no),
    KEY idx_community_revisions_object (object_type, object_id, revision_no),
    KEY idx_community_revisions_review (status, created_at, id),
    CONSTRAINT fk_community_revision_editor FOREIGN KEY (editor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_community_revision_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_activity (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(64) NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    parent_type VARCHAR(24) NOT NULL DEFAULT '',
    parent_id BIGINT UNSIGNED NULL,
    space_id BIGINT UNSIGNED NULL,
    organization_id BIGINT UNSIGNED NULL,
    reputation_delta INT NOT NULL DEFAULT 0,
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    canceled_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_activity_event (event_id),
    KEY idx_community_activity_feed (space_id, canceled_at, created_at, id),
    KEY idx_community_activity_user (actor_user_id, canceled_at, created_at),
    KEY idx_community_activity_object (object_type, object_id, created_at),
    CONSTRAINT fk_community_activity_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_community_activity_space FOREIGN KEY (space_id) REFERENCES community_spaces(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_activity_org FOREIGN KEY (organization_id) REFERENCES writing_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_reputation (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    score INT NOT NULL DEFAULT 0,
    rank_position INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at VARCHAR(40) NOT NULL,
    CONSTRAINT fk_community_reputation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_reputation_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    activity_id BIGINT UNSIGNED NULL,
    reason VARCHAR(64) NOT NULL,
    delta INT NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    canceled_at VARCHAR(40) NOT NULL DEFAULT '',
    KEY idx_community_reputation_events_user (user_id, canceled_at, created_at),
    CONSTRAINT fk_community_rep_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_rep_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_community_rep_event_activity FOREIGN KEY (activity_id) REFERENCES community_activity(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_badges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL,
    level VARCHAR(24) NOT NULL DEFAULT 'bronze',
    icon VARCHAR(64) NOT NULL DEFAULT 'award',
    rule_key VARCHAR(64) NOT NULL DEFAULT '',
    threshold INT UNSIGNED NOT NULL DEFAULT 0,
    is_repeatable TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_community_badges_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_badge_awards (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    badge_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    award_count INT UNSIGNED NOT NULL DEFAULT 1,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    awarded_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_community_badge_user (badge_id, user_id),
    KEY idx_community_badge_awards_user (user_id, awarded_at),
    CONSTRAINT fk_community_badge_award_badge FOREIGN KEY (badge_id) REFERENCES community_badges(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_badge_award_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    reporter_user_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    reason VARCHAR(64) NOT NULL,
    details VARCHAR(1000) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    assignee_user_id BIGINT UNSIGNED NULL,
    resolution VARCHAR(1000) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    resolved_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_reports_public (public_id),
    KEY idx_community_reports_queue (status, created_at, id),
    KEY idx_community_reports_object (object_type, object_id, status),
    KEY idx_community_reports_org (organization_id, status, created_at),
    CONSTRAINT fk_community_report_reporter FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_community_report_assignee FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_community_report_org FOREIGN KEY (organization_id) REFERENCES writing_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    object_type VARCHAR(24) NOT NULL,
    object_id BIGINT UNSIGNED NOT NULL,
    organization_id BIGINT UNSIGNED NULL,
    queue_type VARCHAR(32) NOT NULL DEFAULT 'content',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    requested_by BIGINT UNSIGNED NULL,
    reviewer_user_id BIGINT UNSIGNED NULL,
    reason VARCHAR(1000) NOT NULL DEFAULT '',
    payload_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    reviewed_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_community_reviews_public (public_id),
    KEY idx_community_reviews_queue (status, queue_type, created_at, id),
    KEY idx_community_reviews_object (object_type, object_id, status),
    KEY idx_community_reviews_org (organization_id, status, created_at),
    CONSTRAINT fk_community_review_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_community_review_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_community_review_org FOREIGN KEY (organization_id) REFERENCES writing_organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_views (
    question_id BIGINT UNSIGNED NOT NULL,
    viewer_key VARCHAR(128) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    first_viewed_at VARCHAR(40) NOT NULL,
    last_viewed_at VARCHAR(40) NOT NULL,
    view_count INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (question_id, viewer_key),
    KEY idx_community_views_user (user_id, last_viewed_at),
    CONSTRAINT fk_community_view_question FOREIGN KEY (question_id) REFERENCES community_questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_view_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS community_attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    owner_user_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(24) NOT NULL DEFAULT '',
    object_id BIGINT UNSIGNED NULL,
    storage_disk VARCHAR(32) NOT NULL DEFAULT 'local',
    storage_path VARCHAR(1024) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    sha256 CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ready',
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_community_attachments_public (public_id),
    KEY idx_community_attachments_object (object_type, object_id, status),
    KEY idx_community_attachments_owner (owner_user_id, status, created_at),
    CONSTRAINT fk_community_attachment_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SQL);
    }

    $now = gmdate('c');
    $insertSpace = $driver === 'sqlite'
        ? "INSERT OR IGNORE INTO community_spaces (public_id,scope,organization_id,slug,name,visibility,status,settings_json,created_by,created_at,updated_at) VALUES ('space-public','public',NULL,'public','Wikist Public Community','public','active','{}',NULL,?,?)"
        : "INSERT IGNORE INTO community_spaces (public_id,scope,organization_id,slug,name,visibility,status,settings_json,created_by,created_at,updated_at) VALUES ('space-public','public',NULL,'public','Wikist Public Community','public','active','{}',NULL,?,?)";
    $statement = $pdo->prepare($insertSpace);
    $statement->execute([$now, $now]);

    foreach ([
        ['first-question', '首问', '提出第一个公开问题。', 'bronze', 'message-circle', 'questions_created', 1],
        ['first-answer', '初次作答', '发布第一个有效回答。', 'bronze', 'message-square-reply', 'answers_created', 1],
        ['accepted-answer', '获得采纳', '回答首次被提问者采纳。', 'silver', 'badge-check', 'accepted_answers', 1],
        ['trusted-contributor', '可信贡献者', '社区声望达到 100。', 'gold', 'award', 'reputation', 100],
    ] as [$slug, $name, $description, $level, $icon, $rule, $threshold]) {
        $sql = $driver === 'sqlite'
            ? 'INSERT OR IGNORE INTO community_badges (slug,name,description,level,icon,rule_key,threshold,is_repeatable,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,\'active\',?,?)'
            : 'INSERT IGNORE INTO community_badges (slug,name,description,level,icon,rule_key,threshold,is_repeatable,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,\'active\',?,?)';
        $badge = $pdo->prepare($sql);
        $badge->execute([$slug, $name, $description, $level, $icon, $rule, $threshold, $now, $now]);
    }
};
