CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    email VARCHAR(254) NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(32) NOT NULL DEFAULT 'member',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    bio VARCHAR(500) NOT NULL DEFAULT '',
    avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
    social_links_json JSON NOT NULL,
    page_md MEDIUMTEXT NOT NULL,
    email_verified_at VARCHAR(40) NOT NULL DEFAULT '',
    two_factor_secret VARCHAR(255) NOT NULL DEFAULT '',
    two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
    two_factor_confirmed_at VARCHAR(40) NOT NULL DEFAULT '',
    two_factor_recovery_json JSON NOT NULL,
    pending_two_factor_secret VARCHAR(255) NOT NULL DEFAULT '',
    pending_two_factor_created_at VARCHAR(40) NOT NULL DEFAULT '',
    pending_email VARCHAR(254) NOT NULL DEFAULT '',
    pending_email_requested_at VARCHAR(40) NOT NULL DEFAULT '',
    session_version INT UNSIGNED NOT NULL DEFAULT 1,
    last_security_at VARCHAR(40) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    password_updated_at VARCHAR(40) NOT NULL,
    last_sync_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wikist_security_state (
    state_key VARCHAR(190) NOT NULL PRIMARY KEY,
    state_value VARCHAR(500) NOT NULL DEFAULT '',
    updated_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_objects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    global_id VARCHAR(255) NOT NULL,
    object_type VARCHAR(48) NOT NULL,
    object_key VARCHAR(255) NOT NULL,
    source_system VARCHAR(48) NOT NULL DEFAULT 'wikist',
    external_id VARCHAR(255) NOT NULL DEFAULT '',
    title VARCHAR(500) NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    canonical_url VARCHAR(1000) NOT NULL DEFAULT '',
    language VARCHAR(32) NOT NULL DEFAULT '',
    organization_id BIGINT UNSIGNED NULL,
    author_user_id BIGINT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    search_text LONGTEXT NOT NULL,
    metadata_json LONGTEXT NOT NULL,
    synced_at VARCHAR(40) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_knowledge_global_id (global_id),
    UNIQUE KEY uk_knowledge_source_object (source_system, object_type, object_key),
    KEY idx_knowledge_objects_type (object_type, status, updated_at),
    KEY idx_knowledge_objects_external (source_system, external_id),
    KEY idx_knowledge_objects_org (organization_id, object_type, status),
    KEY idx_knowledge_objects_author (author_user_id, object_type, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_relations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    relation_key CHAR(64) NOT NULL,
    subject_global_id VARCHAR(255) NOT NULL,
    predicate VARCHAR(64) NOT NULL,
    object_global_id VARCHAR(255) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    source_system VARCHAR(48) NOT NULL DEFAULT 'wikist',
    metadata_json LONGTEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_knowledge_relation_key (relation_key),
    KEY idx_knowledge_relations_subject (subject_global_id, predicate, updated_at),
    KEY idx_knowledge_relations_object (object_global_id, predicate, updated_at),
    KEY idx_knowledge_relations_actor (actor_user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash VARCHAR(86) NOT NULL,
    user_agent VARCHAR(500) NULL,
    ip VARCHAR(64) NULL,
    created_at VARCHAR(40) NOT NULL,
    expires_at VARCHAR(40) NOT NULL,
    last_seen_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_sessions_token_hash (token_hash),
    KEY idx_sessions_user_id (user_id),
    KEY idx_sessions_expires_at (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS passport_import_map (
    source VARCHAR(64) NOT NULL,
    source_user_id VARCHAR(128) NOT NULL,
    wikist_user_id BIGINT UNSIGNED NOT NULL,
    imported_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (source, source_user_id),
    KEY idx_passport_import_user (wikist_user_id),
    CONSTRAINT fk_passport_import_user FOREIGN KEY (wikist_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS passport_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    purpose VARCHAR(40) NOT NULL,
    token_hash VARCHAR(86) NOT NULL,
    email VARCHAR(254) NOT NULL DEFAULT '',
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    expires_at VARCHAR(40) NOT NULL,
    used_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_passport_tokens_hash (token_hash),
    KEY idx_passport_tokens_user (user_id, purpose, created_at),
    CONSTRAINT fk_passport_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webman_migrations (
    migration VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS writing_organizations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(190) NOT NULL,
    name VARCHAR(190) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    description_md MEDIUMTEXT NOT NULL,
    hero_image VARCHAR(2048) NOT NULL DEFAULT '',
    avatar_image VARCHAR(2048) NOT NULL DEFAULT '',
    focus_json JSON NOT NULL,
    visibility VARCHAR(32) NOT NULL DEFAULT 'public',
    review_threshold INT UNSIGNED NOT NULL DEFAULT 2,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_writing_organizations_slug (slug),
    KEY idx_writing_organizations_status (status, updated_at),
    CONSTRAINT fk_writing_organizations_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'member',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    intro VARCHAR(500) NOT NULL DEFAULT '',
    joined_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (organization_id, user_id),
    KEY idx_organization_members_user (user_id, status, updated_at),
    KEY idx_organization_members_org (organization_id, status, role),
    CONSTRAINT fk_organization_members_org FOREIGN KEY (organization_id) REFERENCES writing_organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_organization_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_conversations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    direct_key VARCHAR(190) NULL,
    title VARCHAR(190) NOT NULL DEFAULT '',
    description VARCHAR(500) NOT NULL DEFAULT '',
    avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
    organization_id BIGINT UNSIGNED NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    last_message_id BIGINT UNSIGNED NULL,
    message_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_messaging_conversations_public (public_id),
    UNIQUE KEY uq_messaging_conversations_direct (direct_key),
    KEY idx_messaging_conversations_kind (kind, status, updated_at),
    KEY idx_messaging_conversations_org (organization_id, status),
    KEY idx_messaging_conversations_last (last_message_id, updated_at),
    CONSTRAINT fk_messaging_conversation_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_conversation_members (
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'member',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    notification_level VARCHAR(32) NOT NULL DEFAULT 'all',
    last_read_message_id BIGINT UNSIGNED NULL,
    last_read_at VARCHAR(40) NOT NULL DEFAULT '',
    muted_until VARCHAR(40) NOT NULL DEFAULT '',
    pinned_at VARCHAR(40) NOT NULL DEFAULT '',
    archived_at VARCHAR(40) NOT NULL DEFAULT '',
    joined_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    metadata_json JSON NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_messaging_members_user (user_id, status, archived_at, updated_at),
    KEY idx_messaging_members_conversation (conversation_id, status, last_read_message_id),
    CONSTRAINT fk_messaging_member_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_user_preferences (
    user_id BIGINT UNSIGNED NOT NULL,
    open_mode TINYINT(1) NOT NULL DEFAULT 0,
    auto_reply_enabled TINYINT(1) NOT NULL DEFAULT 0,
    auto_reply_text VARCHAR(500) NOT NULL DEFAULT '',
    show_online_status TINYINT(1) NOT NULL DEFAULT 0,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_messaging_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_follows (
    follower_user_id BIGINT UNSIGNED NOT NULL,
    following_user_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (follower_user_id, following_user_id),
    KEY idx_user_follows_following (following_user_id, created_at),
    KEY idx_user_follows_follower (follower_user_id, created_at),
    CONSTRAINT fk_user_follows_follower FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_follows_following FOREIGN KEY (following_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_auto_reply_state (
    user_id BIGINT UNSIGNED NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    last_sent_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, conversation_id),
    KEY idx_messaging_auto_reply_sent (last_sent_at),
    CONSTRAINT fk_messaging_auto_reply_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_auto_reply_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_conversation_mutes (
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    muted_by BIGINT UNSIGNED NULL,
    muted_until VARCHAR(40) NOT NULL DEFAULT '',
    reason VARCHAR(300) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_messaging_conversation_mutes_active (conversation_id, muted_until),
    CONSTRAINT fk_messaging_mute_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_mute_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_mute_actor FOREIGN KEY (muted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_user_presence (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    last_seen_at VARCHAR(40) NOT NULL,
    last_context VARCHAR(100) NOT NULL DEFAULT '',
    updated_at VARCHAR(40) NOT NULL,
    KEY idx_messaging_user_presence_seen (last_seen_at),
    CONSTRAINT fk_messaging_presence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_presence_leases (
    user_id BIGINT UNSIGNED NOT NULL,
    client_id VARCHAR(100) NOT NULL,
    last_seen_at VARCHAR(40) NOT NULL,
    last_context VARCHAR(100) NOT NULL DEFAULT '',
    updated_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (user_id, client_id),
    KEY idx_messaging_presence_leases_seen (last_seen_at),
    CONSTRAINT fk_messaging_presence_lease_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    sender_user_id BIGINT UNSIGNED NULL,
    sender_name VARCHAR(100) NOT NULL DEFAULT '',
    sender_avatar VARCHAR(2048) NOT NULL DEFAULT '',
    message_type VARCHAR(32) NOT NULL DEFAULT 'text',
    body_md MEDIUMTEXT NOT NULL,
    body_plain MEDIUMTEXT NOT NULL,
    reply_to_message_id BIGINT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    client_nonce VARCHAR(100) NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    edited_at VARCHAR(40) NOT NULL DEFAULT '',
    withdrawn_at VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_messaging_messages_public (public_id),
    UNIQUE KEY uq_messaging_messages_nonce (conversation_id, sender_user_id, client_nonce),
    KEY idx_messaging_messages_conversation (conversation_id, id),
    KEY idx_messaging_messages_sender (sender_user_id, created_at),
    CONSTRAINT fk_messaging_message_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_message_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_messaging_message_reply FOREIGN KEY (reply_to_message_id) REFERENCES messaging_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_message_hidden (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    hidden_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (message_id, user_id),
    KEY idx_messaging_message_hidden_user (user_id, hidden_at),
    CONSTRAINT fk_messaging_hidden_message FOREIGN KEY (message_id) REFERENCES messaging_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_hidden_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    message_id BIGINT UNSIGNED NULL,
    owner_user_id BIGINT UNSIGNED NOT NULL,
    storage_disk VARCHAR(32) NOT NULL DEFAULT 'local',
    storage_path VARCHAR(1024) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    sha256 CHAR(64) NOT NULL,
    width INT UNSIGNED NULL,
    height INT UNSIGNED NULL,
    duration_ms INT UNSIGNED NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ready',
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_messaging_attachments_public (public_id),
    KEY idx_messaging_attachments_message (message_id, status),
    KEY idx_messaging_attachments_owner (owner_user_id, status, created_at),
    CONSTRAINT fk_messaging_attachment_message FOREIGN KEY (message_id) REFERENCES messaging_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_attachment_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_object_references (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT UNSIGNED NOT NULL,
    object_type VARCHAR(48) NOT NULL,
    object_id VARCHAR(190) NOT NULL,
    object_revision VARCHAR(100) NOT NULL DEFAULT '',
    relation_type VARCHAR(40) NOT NULL DEFAULT 'context',
    label VARCHAR(255) NOT NULL DEFAULT '',
    url VARCHAR(2048) NOT NULL DEFAULT '',
    metadata_json JSON NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_messaging_object_relation (message_id, object_type, object_id, object_revision, relation_type),
    KEY idx_messaging_object_target (object_type, object_id, object_revision),
    CONSTRAINT fk_messaging_object_message FOREIGN KEY (message_id) REFERENCES messaging_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_mentions (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (message_id, user_id),
    KEY idx_messaging_mentions_user (user_id, created_at),
    CONSTRAINT fk_messaging_mention_message FOREIGN KEY (message_id) REFERENCES messaging_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_mention_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_outbox_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(48) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    channel VARCHAR(255) NOT NULL,
    payload_json JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    available_at VARCHAR(40) NOT NULL,
    published_at VARCHAR(40) NOT NULL DEFAULT '',
    last_error VARCHAR(1000) NOT NULL DEFAULT '',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_messaging_outbox_event (event_id),
    KEY idx_messaging_outbox_pending (status, available_at, id),
    KEY idx_messaging_outbox_aggregate (aggregate_type, aggregate_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messaging_legacy_links (
    legacy_type VARCHAR(32) NOT NULL,
    legacy_id BIGINT NOT NULL,
    legacy_user_id BIGINT NOT NULL DEFAULT 0,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    imported_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (legacy_type, legacy_id, legacy_user_id),
    KEY idx_messaging_legacy_message (message_id),
    CONSTRAINT fk_messaging_legacy_conversation FOREIGN KEY (conversation_id) REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_messaging_legacy_message FOREIGN KEY (message_id) REFERENCES messaging_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_selections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    object_type VARCHAR(48) NOT NULL,
    object_id VARCHAR(190) NOT NULL,
    object_label VARCHAR(255) NOT NULL DEFAULT '',
    object_url VARCHAR(1024) NOT NULL DEFAULT '',
    selected_text TEXT NOT NULL,
    prefix_text VARCHAR(500) NOT NULL DEFAULT '',
    suffix_text VARCHAR(500) NOT NULL DEFAULT '',
    start_offset INT UNSIGNED NOT NULL DEFAULT 0,
    end_offset INT UNSIGNED NOT NULL DEFAULT 0,
    anchor_hash CHAR(64) NOT NULL,
    creator_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    UNIQUE KEY uq_content_selection_anchor (object_type, object_id, anchor_hash),
    KEY idx_content_selections_object (object_type, object_id, status, created_at),
    KEY idx_content_selections_creator (creator_user_id, status, created_at),
    CONSTRAINT fk_content_selection_creator FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_selection_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    selection_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    reply_to_comment_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    deleted_at VARCHAR(40) NOT NULL DEFAULT '',
    KEY idx_selection_comments_selection (selection_id, status, id),
    KEY idx_selection_comments_user (user_id, status, created_at),
    KEY idx_selection_comments_reply (reply_to_comment_id, status, id),
    CONSTRAINT fk_selection_comment_selection FOREIGN KEY (selection_id) REFERENCES content_selections(id) ON DELETE CASCADE,
    CONSTRAINT fk_selection_comment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_selection_likes (
    selection_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    PRIMARY KEY (selection_id, user_id),
    KEY idx_selection_likes_user (user_id, created_at),
    CONSTRAINT fk_selection_like_selection FOREIGN KEY (selection_id) REFERENCES content_selections(id) ON DELETE CASCADE,
    CONSTRAINT fk_selection_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_selection_activities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    selection_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    activity_type VARCHAR(32) NOT NULL,
    target_type VARCHAR(48) NOT NULL DEFAULT '',
    target_id VARCHAR(190) NOT NULL DEFAULT '',
    target_label VARCHAR(255) NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    KEY idx_selection_activities_selection (selection_id, activity_type, created_at),
    KEY idx_selection_activities_user (user_id, activity_type, created_at),
    CONSTRAINT fk_selection_activity_selection FOREIGN KEY (selection_id) REFERENCES content_selections(id) ON DELETE CASCADE,
    CONSTRAINT fk_selection_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
