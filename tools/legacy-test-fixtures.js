"use strict";

function seedTestUser(store, input) {
  const username = String(input.username || "").trim();
  if (!username) throw new Error("测试用户必须提供 username。");
  const now = new Date().toISOString();
  const result = store.db.prepare(`
    INSERT INTO users (
      username, email, display_name, password_hash, password_salt, role, status,
      created_at, updated_at, password_updated_at, last_sync_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(
    username,
    String(input.email || `${username}@example.com`).trim().toLowerCase(),
    String(input.displayName || username).trim(),
    "fixture-password-hash",
    "fixture-password-salt",
    String(input.role || "member").trim().toLowerCase(),
    now,
    now,
    now,
    now,
  );
  return store.getUserProfile(Number(result.lastInsertRowid));
}

function seedTestAccount(store, input) {
  return { user: seedTestUser(store, input) };
}

module.exports = { seedTestAccount, seedTestUser };
