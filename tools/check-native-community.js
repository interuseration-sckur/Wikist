"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend = path.join(root, "webman-backend");

function resolvePhp() {
  const candidates = [
    process.env.WIKIST_PHP,
    process.platform === "win32" ? path.join(root, ".runtime", "php", "php.exe") : "",
    process.platform === "win32" ? path.join(root, "runtime", "php", "php.exe") : "",
    process.platform === "win32" ? path.resolve(root, "..", ".runtime", "php", "php.exe") : "",
    process.platform === "win32" ? "php.exe" : "php",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    const result = spawnSync(candidate, ["-r", "exit(PHP_VERSION_ID >= 80401 ? 0 : 1);"], { windowsHide: true });
    return !result.error && result.status === 0;
  }) || "";
}

const php = resolvePhp();
if (!php) {
  throw new Error("Native Community checks require PHP 8.4.1 or newer. Set WIKIST_PHP when PHP is not in PATH.");
}

const result = spawnSync(php, [path.join(backend, "tools", "check-native-community.php")], {
  cwd: backend,
  encoding: "utf8",
  windowsHide: true,
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "Native Community checks failed.\n");
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout || "Native Community checks passed.\n");
