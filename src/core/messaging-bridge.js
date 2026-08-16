// @deprecated compatibility-only: Webman Messaging is the source of truth.
// This bridge serves unported Node content events and must not own schema or request-time synchronization.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function publicId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

function json(value) {
  return JSON.stringify(value || {});
}

class MessagingBridge {
  constructor(db, rootDir) {
    this.db = db;
    this.rootDir = rootDir;
  }

  ensureSchema() {
    const schemaPath = [
      path.join(this.rootDir, "webman-backend", "database", "schema", "wikist.sqlite.sql"),
      path.join(__dirname, "..", "..", "webman-backend", "database", "schema", "wikist.sqlite.sql"),
    ].find((candidate) => fs.existsSync(candidate));
    if (!schemaPath) throw new Error("Unified messaging SQLite schema is missing.");
    this.db.exec(fs.readFileSync(schemaPath, "utf8"));
  }

  ensureConversation(directKey, title, scope, userId = 0) {
    let conversation = this.db.prepare("SELECT * FROM messaging_conversations WHERE direct_key = ?").get(directKey);
    if (!conversation) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT OR IGNORE INTO messaging_conversations (
          public_id, kind, direct_key, title, description, avatar_url, organization_id, owner_user_id,
          status, last_message_id, message_count, metadata_json, created_at, updated_at
        ) VALUES (?, 'system', ?, ?, '', '', NULL, NULL, 'active', NULL, 0, ?, ?, ?)
      `).run(publicId("conv"), directKey, title, json({ scope }), now, now);
      conversation = this.db.prepare("SELECT * FROM messaging_conversations WHERE direct_key = ?").get(directKey);
    }
    if (userId) this.ensureMember(conversation.id, userId);
    return conversation;
  }

  ensureMember(conversationId, userId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO messaging_conversation_members (
        conversation_id, user_id, role, status, notification_level, last_read_message_id, last_read_at,
        muted_until, pinned_at, archived_at, joined_at, updated_at, metadata_json
      ) VALUES (?, ?, 'member', 'active', 'all', NULL, '', '', '', '', ?, ?, '{}')
    `).run(Number(conversationId), Number(userId), now, now);
    this.db.prepare(`
      UPDATE messaging_conversation_members SET status = 'active', updated_at = ?
      WHERE conversation_id = ? AND user_id = ?
    `).run(now, Number(conversationId), Number(userId));
  }

  mirrorUserMessage(legacyId) {
    const row = this.db.prepare("SELECT * FROM user_messages WHERE id = ?").get(Number(legacyId));
    if (!row || row.deleted_at) return null;
    const linked = this.db.prepare("SELECT * FROM messaging_legacy_links WHERE legacy_type = 'user_message' AND legacy_id = ? AND legacy_user_id = ?")
      .get(row.id, row.recipient_user_id);
    if (linked) return linked;
    const conversation = this.ensureConversation(`system:user:${row.recipient_user_id}`, "通知中心", "personal", row.recipient_user_id);
    const sender = row.sender_user_id ? this.db.prepare("SELECT avatar_url FROM users WHERE id = ?").get(row.sender_user_id) : null;
    const deterministicId = `msg_legacy_user_${row.id}`;
    const metadata = {
      legacyKind: row.kind,
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      sourceLabel: row.source_label,
      displaySeconds: Number(row.display_seconds || 7),
    };
    const inserted = this.db.prepare(`
      INSERT OR IGNORE INTO messaging_messages (
        public_id, conversation_id, sender_user_id, sender_name, sender_avatar, message_type, body_md,
        body_plain, reply_to_message_id, status, client_nonce, priority, metadata_json, created_at, edited_at, withdrawn_at
      ) VALUES (?, ?, ?, ?, ?, 'system', ?, ?, NULL, 'published', NULL, ?, ?, ?, '', '')
    `).run(
      deterministicId,
      conversation.id,
      row.sender_user_id || null,
      row.sender_name || "Wikist",
      sender?.avatar_url || "",
      [row.title, row.body].filter(Boolean).join("\n\n"),
      [row.title, row.body].filter(Boolean).join(" "),
      row.priority || "normal",
      json(metadata),
      row.created_at,
    );
    const message = this.db.prepare("SELECT * FROM messaging_messages WHERE public_id = ?").get(deterministicId);
    this.db.prepare(`
      INSERT OR IGNORE INTO messaging_legacy_links (legacy_type, legacy_id, legacy_user_id, conversation_id, message_id, imported_at)
      VALUES ('user_message', ?, ?, ?, ?, ?)
    `).run(row.id, row.recipient_user_id, conversation.id, message.id, new Date().toISOString());
    if (inserted.changes) {
      this.advanceConversation(conversation.id, message.id, row.created_at);
      this.enqueue("notification.created", `personal:user:${row.recipient_user_id}`, "message", deterministicId, {
        conversationId: conversation.public_id,
        message: this.eventMessage(message, row.title),
      });
    }
    if (row.status === "read") this.advanceRead(conversation.id, row.recipient_user_id, message.id, row.read_at || row.created_at);
    return { conversation_id: conversation.id, message_id: message.id };
  }

  mirrorSiteMessage(legacyId) {
    const row = this.db.prepare("SELECT * FROM site_messages WHERE id = ?").get(Number(legacyId));
    if (!row) return null;
    const linked = this.db.prepare("SELECT * FROM messaging_legacy_links WHERE legacy_type = 'site_message' AND legacy_id = ? AND legacy_user_id = 0")
      .get(row.id);
    if (linked) return linked;
    const conversation = this.ensureConversation("system:site", "全站公告", "site");
    const sender = row.sender_user_id ? this.db.prepare("SELECT avatar_url FROM users WHERE id = ?").get(row.sender_user_id) : null;
    const deterministicId = `msg_legacy_site_${row.id}`;
    const status = row.status === "recalled" ? "withdrawn" : "published";
    const inserted = this.db.prepare(`
      INSERT OR IGNORE INTO messaging_messages (
        public_id, conversation_id, sender_user_id, sender_name, sender_avatar, message_type, body_md,
        body_plain, reply_to_message_id, status, client_nonce, priority, metadata_json, created_at, edited_at, withdrawn_at
      ) VALUES (?, ?, ?, ?, ?, 'system', ?, ?, NULL, ?, NULL, ?, ?, ?, '', ?)
    `).run(
      deterministicId,
      conversation.id,
      row.sender_user_id || null,
      row.sender_name || "Wikist",
      sender?.avatar_url || "",
      status === "withdrawn" ? "" : [row.title, row.body].filter(Boolean).join("\n\n"),
      status === "withdrawn" ? "" : [row.title, row.body].filter(Boolean).join(" "),
      status,
      row.priority || "normal",
      json({
        legacyKind: row.kind,
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        sourceLabel: row.source_label,
        displaySeconds: Number(row.display_seconds || 7),
      }),
      row.created_at,
      status === "withdrawn" ? (row.recalled_at || row.created_at) : "",
    );
    const message = this.db.prepare("SELECT * FROM messaging_messages WHERE public_id = ?").get(deterministicId);
    this.db.prepare(`
      INSERT OR IGNORE INTO messaging_legacy_links (legacy_type, legacy_id, legacy_user_id, conversation_id, message_id, imported_at)
      VALUES ('site_message', ?, 0, ?, ?, ?)
    `).run(row.id, conversation.id, message.id, new Date().toISOString());
    if (inserted.changes) {
      this.advanceConversation(conversation.id, message.id, row.created_at);
      this.enqueue("notification.created", "system:site", "message", deterministicId, {
        conversationId: conversation.public_id,
        message: this.eventMessage(message, row.title),
      });
    }
    return { conversation_id: conversation.id, message_id: message.id };
  }

  advanceConversation(conversationId, messageId, at) {
    this.db.prepare(`
      UPDATE messaging_conversations
      SET last_message_id = ?, message_count = message_count + 1, updated_at = ?
      WHERE id = ?
    `).run(Number(messageId), at, Number(conversationId));
  }

  advanceRead(conversationId, userId, messageId, at = new Date().toISOString()) {
    this.ensureMember(conversationId, userId);
    this.db.prepare(`
      UPDATE messaging_conversation_members
      SET last_read_message_id = CASE WHEN COALESCE(last_read_message_id, 0) < ? THEN ? ELSE last_read_message_id END,
          last_read_at = CASE WHEN COALESCE(last_read_message_id, 0) < ? THEN ? ELSE last_read_at END,
          updated_at = ?
      WHERE conversation_id = ? AND user_id = ?
    `).run(Number(messageId), Number(messageId), Number(messageId), at, at, Number(conversationId), Number(userId));
  }

  markLegacyRead(type, legacyId, userId) {
    const legacyType = type === "site" ? "site_message" : "user_message";
    const legacyUserId = legacyType === "site_message" ? 0 : Number(userId);
    const linked = this.db.prepare("SELECT * FROM messaging_legacy_links WHERE legacy_type = ? AND legacy_id = ? AND legacy_user_id = ?")
      .get(legacyType, Number(legacyId), legacyUserId);
    if (linked) this.advanceRead(linked.conversation_id, Number(userId), linked.message_id);
  }

  markAllLegacyRead(userId) {
    const personal = this.ensureConversation(`system:user:${userId}`, "通知中心", "personal", userId);
    const site = this.ensureConversation("system:site", "全站公告", "site", userId);
    for (const conversation of [personal, site]) {
      const last = this.db.prepare("SELECT last_message_id FROM messaging_conversations WHERE id = ?").get(conversation.id)?.last_message_id;
      if (last) this.advanceRead(conversation.id, userId, last);
    }
  }

  revokeSiteMessage(legacyId) {
    const linked = this.db.prepare("SELECT * FROM messaging_legacy_links WHERE legacy_type = 'site_message' AND legacy_id = ? AND legacy_user_id = 0")
      .get(Number(legacyId));
    if (!linked) return;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE messaging_messages SET status = 'withdrawn', body_md = '', body_plain = '', withdrawn_at = ? WHERE id = ?")
      .run(now, linked.message_id);
    const conversation = this.db.prepare("SELECT public_id FROM messaging_conversations WHERE id = ?").get(linked.conversation_id);
    const message = this.db.prepare("SELECT public_id FROM messaging_messages WHERE id = ?").get(linked.message_id);
    this.enqueue("message.withdrawn", "system:site", "message", message.public_id, {
      conversationId: conversation.public_id,
      messageId: message.public_id,
    });
  }

  reconcileLegacyNotifications() {
    const direct = this.db.prepare(`
      SELECT m.id FROM user_messages m
      LEFT JOIN messaging_legacy_links l ON l.legacy_type = 'user_message' AND l.legacy_id = m.id AND l.legacy_user_id = m.recipient_user_id
      WHERE l.message_id IS NULL AND m.deleted_at = '' ORDER BY m.id LIMIT 2000
    `).all();
    const site = this.db.prepare(`
      SELECT m.id FROM site_messages m
      LEFT JOIN messaging_legacy_links l ON l.legacy_type = 'site_message' AND l.legacy_id = m.id AND l.legacy_user_id = 0
      WHERE l.message_id IS NULL ORDER BY m.id LIMIT 2000
    `).all();
    for (const row of direct) this.mirrorUserMessage(row.id);
    for (const row of site) this.mirrorSiteMessage(row.id);
    return { direct: direct.length, site: site.length };
  }

  eventMessage(message, title) {
    return {
      id: message.public_id,
      cursor: Number(message.id),
      type: message.message_type,
      preview: String(message.body_plain || title || "").slice(0, 180),
      priority: message.priority,
      createdAt: message.created_at,
    };
  }

  enqueue(type, channel, aggregateType, aggregateId, data) {
    const now = new Date().toISOString();
    const eventId = publicId("evt");
    this.db.prepare(`
      INSERT INTO messaging_outbox_events (
        event_id, event_type, aggregate_type, aggregate_id, channel, payload_json, status,
        attempts, available_at, published_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, '', '', ?, ?)
    `).run(eventId, type, aggregateType, String(aggregateId), channel, json({
      id: eventId,
      type,
      occurredAt: now,
      resource: { type: aggregateType, id: String(aggregateId) },
      data,
    }), now, now, now);
  }
}

module.exports = { MessagingBridge };
