PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    social_links_json TEXT NOT NULL DEFAULT '{}',
    page_md TEXT NOT NULL DEFAULT '',
    email_verified_at TEXT NOT NULL DEFAULT '',
    two_factor_secret TEXT NOT NULL DEFAULT '',
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    two_factor_confirmed_at TEXT NOT NULL DEFAULT '',
    two_factor_recovery_json TEXT NOT NULL DEFAULT '[]',
    pending_two_factor_secret TEXT NOT NULL DEFAULT '',
    pending_two_factor_created_at TEXT NOT NULL DEFAULT '',
    pending_email TEXT NOT NULL DEFAULT '',
    pending_email_requested_at TEXT NOT NULL DEFAULT '',
    session_version INTEGER NOT NULL DEFAULT 1,
    last_security_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    password_updated_at TEXT NOT NULL,
    last_sync_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wikist_security_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS passport_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_passport_tokens_user ON passport_tokens(user_id, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_passport_tokens_hash ON passport_tokens(token_hash);

CREATE TABLE IF NOT EXISTS passport_import_map (
    source TEXT NOT NULL,
    source_user_id TEXT NOT NULL,
    wikist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (source, source_user_id)
);

CREATE TABLE IF NOT EXISTS webman_migrations (
    migration TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS writing_organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    description_md TEXT NOT NULL DEFAULT '',
    hero_image TEXT NOT NULL DEFAULT '',
    avatar_image TEXT NOT NULL DEFAULT '',
    focus_json TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public',
    review_threshold INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id INTEGER NOT NULL REFERENCES writing_organizations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    intro TEXT NOT NULL DEFAULT '',
    joined_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user ON organization_members(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_organization_members_org ON organization_members(organization_id, status, role);

CREATE TABLE IF NOT EXISTS messaging_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    direct_key TEXT UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    organization_id INTEGER,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_message_id INTEGER,
    message_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messaging_conversations_kind ON messaging_conversations(kind, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_messaging_conversations_org ON messaging_conversations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_messaging_conversations_last ON messaging_conversations(last_message_id, updated_at);

CREATE TABLE IF NOT EXISTS messaging_conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    notification_level TEXT NOT NULL DEFAULT 'all',
    last_read_message_id INTEGER,
    last_read_at TEXT NOT NULL DEFAULT '',
    muted_until TEXT NOT NULL DEFAULT '',
    pinned_at TEXT NOT NULL DEFAULT '',
    archived_at TEXT NOT NULL DEFAULT '',
    joined_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_members_user ON messaging_conversation_members(user_id, status, archived_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_messaging_members_conversation ON messaging_conversation_members(conversation_id, status, last_read_message_id);

CREATE TABLE IF NOT EXISTS messaging_user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    open_mode INTEGER NOT NULL DEFAULT 0,
    auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
    auto_reply_text TEXT NOT NULL DEFAULT '',
    show_online_status INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_follows (
    follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (follower_user_id, following_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_user_id, created_at);

CREATE TABLE IF NOT EXISTS messaging_auto_reply_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    last_sent_at TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_auto_reply_sent ON messaging_auto_reply_state(last_sent_at);

CREATE TABLE IF NOT EXISTS messaging_conversation_mutes (
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    muted_until TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_conversation_mutes_active ON messaging_conversation_mutes(conversation_id, muted_until);

CREATE TABLE IF NOT EXISTS messaging_user_presence (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_seen_at TEXT NOT NULL,
    last_context TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messaging_user_presence_seen ON messaging_user_presence(last_seen_at);

CREATE TABLE IF NOT EXISTS messaging_presence_leases (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_context TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_presence_leases_seen ON messaging_presence_leases(last_seen_at);

CREATE TABLE IF NOT EXISTS messaging_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL DEFAULT '',
    sender_avatar TEXT NOT NULL DEFAULT '',
    message_type TEXT NOT NULL DEFAULT 'text',
    body_md TEXT NOT NULL DEFAULT '',
    body_plain TEXT NOT NULL DEFAULT '',
    reply_to_message_id INTEGER REFERENCES messaging_messages(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'published',
    client_nonce TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    edited_at TEXT NOT NULL DEFAULT '',
    withdrawn_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_messaging_messages_conversation ON messaging_messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messaging_messages_sender ON messaging_messages(sender_user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_messages_nonce ON messaging_messages(conversation_id, sender_user_id, client_nonce) WHERE client_nonce IS NOT NULL;

CREATE TABLE IF NOT EXISTS messaging_message_hidden (
    message_id INTEGER NOT NULL REFERENCES messaging_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_message_hidden_user ON messaging_message_hidden(user_id, hidden_at);

CREATE TABLE IF NOT EXISTS messaging_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    message_id INTEGER REFERENCES messaging_messages(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_disk TEXT NOT NULL DEFAULT 'local',
    storage_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'ready',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messaging_attachments_message ON messaging_attachments(message_id, status);
CREATE INDEX IF NOT EXISTS idx_messaging_attachments_owner ON messaging_attachments(owner_user_id, status, created_at);

CREATE TABLE IF NOT EXISTS messaging_object_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messaging_messages(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    object_revision TEXT NOT NULL DEFAULT '',
    relation_type TEXT NOT NULL DEFAULT 'context',
    label TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(message_id, object_type, object_id, object_revision, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_messaging_object_target ON messaging_object_references(object_type, object_id, object_revision);

CREATE TABLE IF NOT EXISTS messaging_mentions (
    message_id INTEGER NOT NULL REFERENCES messaging_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_mentions_user ON messaging_mentions(user_id, created_at);

CREATE TABLE IF NOT EXISTS messaging_outbox_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messaging_outbox_pending ON messaging_outbox_events(status, available_at, id);
CREATE INDEX IF NOT EXISTS idx_messaging_outbox_aggregate ON messaging_outbox_events(aggregate_type, aggregate_id, created_at);

CREATE TABLE IF NOT EXISTS messaging_legacy_links (
    legacy_type TEXT NOT NULL,
    legacy_id INTEGER NOT NULL,
    legacy_user_id INTEGER NOT NULL DEFAULT 0,
    conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messaging_messages(id) ON DELETE CASCADE,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (legacy_type, legacy_id, legacy_user_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_legacy_message ON messaging_legacy_links(message_id);

CREATE TABLE IF NOT EXISTS content_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    object_label TEXT NOT NULL DEFAULT '',
    object_url TEXT NOT NULL DEFAULT '',
    selected_text TEXT NOT NULL,
    prefix_text TEXT NOT NULL DEFAULT '',
    suffix_text TEXT NOT NULL DEFAULT '',
    start_offset INTEGER NOT NULL DEFAULT 0,
    end_offset INTEGER NOT NULL DEFAULT 0,
    anchor_hash TEXT NOT NULL,
    creator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(object_type, object_id, anchor_hash)
);

CREATE INDEX IF NOT EXISTS idx_content_selections_object ON content_selections(object_type, object_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_content_selections_creator ON content_selections(creator_user_id, status, created_at);

CREATE TABLE IF NOT EXISTS content_selection_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selection_id INTEGER NOT NULL REFERENCES content_selections(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reply_to_comment_id INTEGER NOT NULL DEFAULT 0,
    body_md TEXT NOT NULL,
    body_plain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_selection_comments_selection ON content_selection_comments(selection_id, status, id);
CREATE INDEX IF NOT EXISTS idx_selection_comments_user ON content_selection_comments(user_id, status, created_at);
CREATE TABLE IF NOT EXISTS content_selection_likes (
    selection_id INTEGER NOT NULL REFERENCES content_selections(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (selection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_selection_likes_user ON content_selection_likes(user_id, created_at);

CREATE TABLE IF NOT EXISTS content_selection_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selection_id INTEGER NOT NULL REFERENCES content_selections(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    target_label TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_selection_activities_selection ON content_selection_activities(selection_id, activity_type, created_at);
CREATE INDEX IF NOT EXISTS idx_selection_activities_user ON content_selection_activities(user_id, activity_type, created_at);

CREATE TABLE IF NOT EXISTS knowledge_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    global_id TEXT NOT NULL UNIQUE,
    object_type TEXT NOT NULL,
    object_key TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'wikist',
    external_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    organization_id INTEGER,
    author_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    search_text TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    synced_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_system, object_type, object_key)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_type ON knowledge_objects(object_type, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_external ON knowledge_objects(source_system, external_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_org ON knowledge_objects(organization_id, object_type, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_author ON knowledge_objects(author_user_id, object_type, updated_at);

CREATE TABLE IF NOT EXISTS knowledge_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relation_key TEXT NOT NULL UNIQUE,
    subject_global_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_global_id TEXT NOT NULL,
    actor_user_id INTEGER,
    source_system TEXT NOT NULL DEFAULT 'wikist',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_subject ON knowledge_relations(subject_global_id, predicate, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_object ON knowledge_relations(object_global_id, predicate, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_actor ON knowledge_relations(actor_user_id, updated_at);
