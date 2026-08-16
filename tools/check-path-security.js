"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { safeJoin } = require("../src/core/http");
const { normalizeSlug } = require("../src/core/slug");
const { validateBackupPackage } = require("../src/core/backup");

let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function backupEntry(relativePath) {
  const content = Buffer.from("test", "utf8");
  return {
    path: relativePath,
    encoding: "base64",
    bytes: content.length,
    content: content.toString("base64"),
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wikist-path-security-"));
const publicRoot = path.join(root, "public");
const outside = path.join(root, "outside");
fs.mkdirSync(publicRoot, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(publicRoot, "safe.txt"), "safe", "utf8");
fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");

try {
  assert(safeJoin(publicRoot, "safe.txt") === path.join(publicRoot, "safe.txt"), "safeJoin rejected an in-root file");

  const traversalInputs = [
    "../outside/secret.txt",
    "..\\outside\\secret.txt",
    "/../../outside/secret.txt",
    "C:\\Windows\\win.ini",
    "//server/share/file",
    "safe/../../../outside/secret.txt",
  ];
  for (const value of traversalInputs) {
    assert(safeJoin(publicRoot, value) === null, `safeJoin accepted traversal input: ${value}`);
  }

  const invalidSlugs = [
    "../admin",
    "a/../../admin",
    "%2e%2e/admin",
    "a/%2e%2e/admin",
    "a%2fb%2f..%2fadmin",
    "a\\..\\admin",
    "a\u0000b",
  ];
  for (const value of invalidSlugs) {
    let rejected = false;
    try { normalizeSlug(value); } catch (_error) { rejected = true; }
    assert(rejected, `normalizeSlug accepted traversal input: ${JSON.stringify(value)}`);
  }

  const validSlugs = ["abstract-algebra", "group/theory", "群论/有限群", "a.b-c_d"];
  for (const value of validSlugs) assert(normalizeSlug(value) === value, `normalizeSlug changed valid slug: ${value}`);

  for (const value of ["../outside.md", "content/pages/../../outside.md", "content\\pages\\..\\outside.md", "C:/outside.md", ""]) {
    const validation = validateBackupPackage({
      package: {
        format: "wikist-site-backup",
        version: 2,
        files: [backupEntry(value)],
        userData: [],
      },
    });
    assert(validation.valid === false, `backup validator accepted unsafe path: ${JSON.stringify(value)}`);
  }

  let symlinkCreated = false;
  const link = path.join(publicRoot, "linked");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    symlinkCreated = true;
  } catch (error) {
    if (![
      "EPERM",
      "EACCES",
      "ENOSYS",
    ].includes(error?.code)) throw error;
  }
  if (symlinkCreated) assert(safeJoin(publicRoot, "linked/secret.txt") === null, "safeJoin followed a symbolic link outside the root");

  console.log(JSON.stringify({ ok: true, checks, symlinkChecked: symlinkCreated }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
