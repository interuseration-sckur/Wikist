#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const include = [".gitignore", "CHANGELOG.md", "README.md", "SECURITY.md", "docs", "package-lock.json", "package.json", "public/assets", "public/passport", "public/index.html", "public/install.html", "server.js", "update.php", "src", "tools", "webman-backend/.gitignore", "webman-backend/.env.example", "webman-backend/README.md", "webman-backend/app", "webman-backend/config", "webman-backend/database/migrations", "webman-backend/database/schema", "webman-backend/public", "webman-backend/support", "webman-backend/tools", "webman-backend/composer.json", "webman-backend/composer.lock", "webman-backend/start.php", "webman-backend/webman", "webman-backend/windows.bat", "webman-backend/windows.php"];
const files = [];
function visit(absolute, relative) {
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Release payload cannot contain symlinks: ${relative}`);
  if (stat.isFile()) {
    const bytes = fs.readFileSync(absolute);
    files.push({ path: relative.replace(/\\/g, "/"), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Unsupported release entry: ${relative}`);
  for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), path.join(relative, name));
}
for (const relative of include) visit(path.join(root, relative), relative);
const pluginRoot = path.join(root, "plugins");
if (fs.existsSync(pluginRoot)) {
  for (const entry of fs.readdirSync(pluginRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && entry.name !== "vendor" && (entry.name.startsWith("wikist-") || entry.name.startsWith("upstream-"))) visit(path.join(pluginRoot, entry.name), path.join("plugins", entry.name));
  }
}
files.sort((a, b) => a.path.localeCompare(b.path));
let gitCommit = "";
try { gitCommit = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (_error) {}
const manifest = { schema: "wikist-release-v1", product: "wikist", version: String(require(path.join(root, "package.json")).version || ""), gitCommit, generatedAt: new Date().toISOString(), files };
const signingKey = String(process.env.WIKIST_RELEASE_SIGNING_KEY || "");
if (signingKey) {
  if (signingKey.length < 32) throw new Error("WIKIST_RELEASE_SIGNING_KEY must contain at least 32 characters.");
  manifest.signature = { algorithm: "hmac-sha256", value: crypto.createHmac("sha256", signingKey).update(JSON.stringify(manifest)).digest("base64url") };
}
fs.writeFileSync(path.join(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Wikist release manifest: ${files.length} files, version ${manifest.version}${manifest.signature ? ", signed" : ""}`);
