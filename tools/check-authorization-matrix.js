#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const route = read("webman-backend/config/route.php");
const proxy = read("webman-backend/app/controller/LegacyProxyController.php");
const adminMiddleware = read("webman-backend/app/middleware/RequireAdminMiddleware.php");
const nodeApp = read("src/server/app.js");

const checks = [];
function assert(name, condition) {
  if (!condition) throw new Error(`Authorization matrix failed: ${name}`);
  checks.push(name);
}
function protectedGroup(prefix, middleware) {
  const start = route.indexOf(`Route::group('${prefix}'`);
  if (start < 0) return false;
  const end = route.indexOf(`})->middleware(${middleware}::class);`, start);
  return end > start;
}
function guardedNodeEndpoint(pathname, guard) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`pathname === ["']${escaped}["'][\\s\\S]{0,240}${guard}\\(passport, session\\)`).test(nodeApp);
}

assert("default controller routes are disabled", route.includes("Route::disableDefaultRoute();"));
assert("unknown Webman routes use an explicit fallback", route.includes("Route::fallback("));
assert("selection mutations require Passport authentication", protectedGroup("/api/selections", "RequireAuthMiddleware"));
assert("community mutations require Passport authentication", protectedGroup("/api/community/qa", "RequireAuthMiddleware"));
assert("messaging routes require Passport authentication", protectedGroup("/api/messaging", "RequireAuthMiddleware"));
assert("admin user routes require the admin middleware", protectedGroup("/api/admin/users", "RequireAdminMiddleware"));
assert("admin middleware delegates to the central role policy", adminMiddleware.includes("RolePolicy::allows($request->identity->role, 'admin')"));
assert("migrated APIs cannot fall back to Node", proxy.includes("private const MIGRATED_PREFIXES") && proxy.includes("$this->isMigratedPath($path)"));
assert("the compatibility proxy rejects internal API paths", proxy.includes("str_starts_with($path, '/api/internal/')"));
assert("the compatibility target is restricted to loopback", proxy.includes("private function assertLoopbackTarget") && proxy.includes("['127.0.0.1', '::1', 'localhost']"));
assert("sensitive compatibility routes require system admin", proxy.includes("private function requiresSystemAdmin") && proxy.includes("system_admin_required"));
assert("sensitive compatibility routes require recent authentication", proxy.includes("passport.authenticated_at") && proxy.includes("step_up_required"));
assert("the proxy strips caller-supplied identity headers", proxy.includes("'x-wikist-internal-token', 'x-wikist-user-id'"));
assert("backup creation is system-admin guarded", guardedNodeEndpoint("/api/admin/backup", "requireSystemAdmin"));
assert("backup restore is system-admin guarded", guardedNodeEndpoint("/api/admin/backup/restore", "requireSystemAdmin"));
assert("plugin creation is system-admin guarded", guardedNodeEndpoint("/api/admin/plugins", "requireSystemAdmin"));
assert("plugin vendor sync is system-admin guarded", guardedNodeEndpoint("/api/admin/plugins/vendor", "requireSystemAdmin"));
assert("site settings reads are system-admin guarded", guardedNodeEndpoint("/api/admin/settings", "requireSystemAdmin"));
assert("site settings writes remain in the guarded branch", /pathname === "\/api\/admin\/settings" && req\.method === "PUT"[\s\S]{0,180}requireSystemAdmin\(passport, session\)/.test(nodeApp));
assert("firewall writes are system-admin guarded", /pathname === "\/api\/admin\/runtime\/firewall" && req\.method === "PUT"[\s\S]{0,180}requireSystemAdmin\(passport, session\)/.test(nodeApp));
assert("installer removal requires force mode and a bootstrap secret", nodeApp.includes("verifyBootstrapSecret(body)") && nodeApp.includes("installerForceMode()"));

console.log(`Authorization matrix passed (${checks.length} checks).`);
