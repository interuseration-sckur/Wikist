-- Generated compatibility schema. Contains structure only; no site data.
CREATE TABLE IF NOT EXISTS captchas (
        id TEXT PRIMARY KEY,
        answer_hash TEXT NOT NULL,
        question TEXT NOT NULL,
        svg TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

CREATE TABLE IF NOT EXISTS community_review_consensus (
        organization_id INTEGER NOT NULL REFERENCES writing_organizations(id) ON DELETE CASCADE,
        subject_type TEXT NOT NULL,
        page_slug TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT '',
        revision_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        finalizer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        finalized_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, subject_type, page_slug, language, revision_id)
      );

CREATE TABLE IF NOT EXISTS community_review_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL REFERENCES writing_organizations(id) ON DELETE CASCADE,
        subject_type TEXT NOT NULL,
        page_slug TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT '',
        revision_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(organization_id, subject_type, page_slug, language, revision_id, reviewer_user_id)
      );

CREATE TABLE IF NOT EXISTS guest_profiles (
        id TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip_first TEXT,
        ip_last TEXT,
        user_agent TEXT,
        edit_count INTEGER NOT NULL DEFAULT 0
      , display_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', comment_count INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS organization_post_favorites (
        post_id INTEGER NOT NULL REFERENCES organization_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );

CREATE TABLE IF NOT EXISTS organization_post_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES organization_posts(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES organization_post_replies(id) ON DELETE CASCADE,
        author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        content_md TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS organization_post_subscriptions (
        post_id INTEGER NOT NULL REFERENCES organization_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );

CREATE TABLE IF NOT EXISTS organization_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL REFERENCES writing_organizations(id) ON DELETE CASCADE,
        post_type TEXT NOT NULL DEFAULT 'discussion',
        title TEXT NOT NULL,
        body_md TEXT NOT NULL,
        page_slug TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        pinned INTEGER NOT NULL DEFAULT 0,
        author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS organization_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL REFERENCES writing_organizations(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL,
        page_slug TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        claimed_at TEXT NOT NULL DEFAULT '',
        closed_at TEXT NOT NULL DEFAULT ''
      );

CREATE TABLE IF NOT EXISTS page_aliases (
        alias_slug TEXT PRIMARY KEY,
        target_slug TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , source_page_slug TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS page_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        parent_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL DEFAULT '',
        author_website TEXT NOT NULL DEFAULT '',
        content_md TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS page_edit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        page_title TEXT NOT NULL,
        action TEXT NOT NULL,
        editor_type TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        editor_name TEXT NOT NULL,
        editor_label TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        page_bytes INTEGER,
        created_at TEXT NOT NULL
      , guest_email TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS page_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_slug TEXT NOT NULL,
        page_title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(user_id, page_slug)
      );

CREATE TABLE IF NOT EXISTS page_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_slug TEXT NOT NULL,
        target_slug TEXT NOT NULL,
        target_label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_slug, target_slug)
      );

CREATE TABLE IF NOT EXISTS page_permissions (
        page_slug TEXT PRIMARY KEY,
        edit_policy TEXT NOT NULL DEFAULT 'guest',
        comment_policy TEXT NOT NULL DEFAULT 'guest',
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      , delete_policy TEXT NOT NULL DEFAULT 'user');

CREATE TABLE IF NOT EXISTS page_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        rating INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS page_review_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_name TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS page_stable_revisions (
        page_slug TEXT PRIMARY KEY,
        stable_revision_id TEXT NOT NULL,
        reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_name TEXT NOT NULL DEFAULT '',
        review_comment TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS page_translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_slug TEXT NOT NULL,
        language TEXT NOT NULL,
        source_language TEXT NOT NULL DEFAULT 'zh-CN',
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        source_md TEXT NOT NULL DEFAULT '',
        translated_md TEXT NOT NULL DEFAULT '',
        progress INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        translator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, reviewer_name TEXT NOT NULL DEFAULT '', review_comment TEXT NOT NULL DEFAULT '', reviewed_at TEXT,
        UNIQUE(page_slug, language)
      );

CREATE TABLE IF NOT EXISTS site_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL DEFAULT 'system',
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        guest_id TEXT REFERENCES guest_profiles(id) ON DELETE SET NULL,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_label TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        target_label TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS site_message_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES site_messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'unread',
        read_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT '',
        UNIQUE(message_id, user_id)
      );

CREATE TABLE IF NOT EXISTS site_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_name TEXT NOT NULL DEFAULT 'Wikist',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'broadcast',
        source_type TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_label TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        recalled_at TEXT NOT NULL DEFAULT ''
      , priority TEXT NOT NULL DEFAULT 'normal', display_seconds INTEGER NOT NULL DEFAULT 7);

CREATE TABLE IF NOT EXISTS translation_glossary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        source_term TEXT NOT NULL,
        target_term TEXT NOT NULL,
        notation TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        discouraged_terms_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_language, target_language, source_term)
      );

CREATE TABLE IF NOT EXISTS translation_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        source_text TEXT NOT NULL,
        target_text TEXT NOT NULL,
        page_slug TEXT NOT NULL,
        translation_id INTEGER REFERENCES page_translations(id) ON DELETE SET NULL,
        approved_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 1,
        UNIQUE(source_language, target_language, source_hash)
      );

CREATE TABLE IF NOT EXISTS translator_members (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        languages_json TEXT NOT NULL DEFAULT '[]',
        joined_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS user_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_name TEXT NOT NULL DEFAULT 'Wikist',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'system',
        source_type TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_label TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unread',
        created_at TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT ''
      , priority TEXT NOT NULL DEFAULT 'normal', display_seconds INTEGER NOT NULL DEFAULT 7);

CREATE TABLE IF NOT EXISTS watch_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, target_type, target_key)
      );

CREATE INDEX IF NOT EXISTS idx_captchas_expires_at ON captchas(expires_at);

CREATE INDEX IF NOT EXISTS idx_community_review_subject ON community_review_votes(subject_type, page_slug, language, revision_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_post_favorites_user ON organization_post_favorites(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_organization_post_replies_post ON organization_post_replies(post_id, parent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_organization_post_subscriptions_user ON organization_post_subscriptions(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_organization_posts_org ON organization_posts(organization_id, pinned, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_organization_posts_page ON organization_posts(page_slug, language, updated_at);

CREATE INDEX IF NOT EXISTS idx_organization_tasks_assignee ON organization_tasks(assignee_user_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_organization_tasks_org ON organization_tasks(organization_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_organization_tasks_page ON organization_tasks(page_slug, task_type, language, status);

CREATE INDEX IF NOT EXISTS idx_page_aliases_source ON page_aliases(source_page_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_page_aliases_target ON page_aliases(target_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_page_comments_guest ON page_comments(guest_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_comments_parent ON page_comments(parent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_comments_slug ON page_comments(page_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_page_comments_user ON page_comments(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_edit_events_guest ON page_edit_events(guest_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_edit_events_slug ON page_edit_events(page_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_page_edit_events_user ON page_edit_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_favorites_page ON page_favorites(page_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_page_favorites_user ON page_favorites(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_links_source ON page_links(source_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_page_links_target ON page_links(target_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_page_ratings_guest ON page_ratings(guest_id, page_slug);

CREATE INDEX IF NOT EXISTS idx_page_ratings_slug ON page_ratings(page_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_page_ratings_user ON page_ratings(user_id, page_slug);

CREATE INDEX IF NOT EXISTS idx_page_review_notes_revision ON page_review_notes(page_slug, revision_id, created_at);

CREATE INDEX IF NOT EXISTS idx_page_review_notes_slug ON page_review_notes(page_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_page_stable_revisions_reviewed ON page_stable_revisions(reviewed_at);

CREATE INDEX IF NOT EXISTS idx_page_translations_page ON page_translations(page_slug, language);

CREATE INDEX IF NOT EXISTS idx_page_translations_user ON page_translations(translator_user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_site_audit_logs_action ON site_audit_logs(action, created_at);

CREATE INDEX IF NOT EXISTS idx_site_audit_logs_target ON site_audit_logs(target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS idx_site_audit_logs_user ON site_audit_logs(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_site_message_states_message ON site_message_states(message_id, user_id);

CREATE INDEX IF NOT EXISTS idx_site_message_states_user ON site_message_states(user_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_site_messages_sender ON site_messages(sender_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_site_messages_status ON site_messages(status, created_at);

CREATE INDEX IF NOT EXISTS idx_translation_glossary_pair ON translation_glossary(source_language, target_language, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_translation_memory_page ON translation_memory(page_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_translation_memory_pair ON translation_memory(source_language, target_language, updated_at);

CREATE INDEX IF NOT EXISTS idx_user_messages_kind ON user_messages(kind, created_at);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient ON user_messages(recipient_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_user_messages_sender ON user_messages(sender_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_watch_subscriptions_target ON watch_subscriptions(target_type, target_key, user_id);

CREATE INDEX IF NOT EXISTS idx_watch_subscriptions_user ON watch_subscriptions(user_id, created_at);
