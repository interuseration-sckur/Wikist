# Wikist Runtime Ownership

This matrix prevents the hybrid migration from creating two sources of truth.

| Capability | Primary owner | Compatibility surface | Why it remains | Removal target |
| --- | --- | --- | --- | --- |
| Passport, sessions, email, 2FA, roles | Webman | Node compatibility session lookup | Unported Node content APIs still need the authenticated user ID | Wikist 2.0 |
| Native Community and moderation | Webman | None for migrated routes | Native Community is already the sole write path | Complete |
| Messaging, notifications, presence | Webman | Node event adapter | Unported content saves still emit watcher notifications | Wikist 2.0 |
| Wiki page files and revisions | Node content engine | Webman loopback proxy | Content migration is intentionally incremental | After a Webman content repository passes parity tests |
| Markdown, plugins, search, import/export | Node content engine | Webman loopback proxy | Existing renderer and plugin ecosystem remain authoritative | After per-module migration |
| Realtime transport | Webman events + Centrifugo | Polling fallback | Centrifugo only transports authorized events | No replacement planned |

## Boundary Rules

- Webman is the only public listener and the only owner of Passport, Community and Messaging writes.
- The Node compatibility listener binds to loopback, requires the internal identity token and cannot mutate schema at startup.
- Migrated Webman routes never fall back to Node.
- New account, community and messaging features must not be added to `src/core/passport-store.js` or `src/core/messaging-bridge.js`.
- Legacy route access is recorded with the `legacy-node` backend marker so remaining usage can be measured before removal.
- The arithmetic CAPTCHA is compatibility-only. New UI, API and cross-domain tests use Webman behavior CAPTCHA or seeded fixtures; the legacy implementation is removed with the Node Passport surface in Wikist 2.0.
