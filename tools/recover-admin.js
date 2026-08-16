const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const candidates = [
  process.env.WIKIST_PHP,
  process.platform === "win32" ? path.join(root, ".runtime", "php", "php.exe") : "",
  process.platform === "win32" ? path.join(root, "runtime", "php", "php.exe") : "",
  process.platform === "win32" ? "php.exe" : "php",
].filter(Boolean);

const php = candidates.find((candidate) => {
  const probe = spawnSync(candidate, ["-r", "echo PHP_VERSION_ID;"], { encoding: "utf8", windowsHide: true });
  return !probe.error && probe.status === 0 && Number(probe.stdout) >= 80401;
});
if (!php) {
  throw new Error("PHP 8.4.1 or newer is required. Set WIKIST_PHP when PHP is not in PATH.");
}

const forwarded = process.argv.slice(2);
const result = spawnSync(php, [path.join(root, "webman-backend", "tools", "recover-admin.php"), ...forwarded], {
  cwd: path.join(root, "webman-backend"),
  env: process.env,
  encoding: "utf8",
  windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
