"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend = path.join(root, "webman-backend");
process.env.APP_ENV ||= "development";
process.env.APP_SECRET ||= "wikist-check-app-secret-000000000000000000000000";
process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ||= "wikist-check-token-secret-00000000000000000000";
process.env.CENTRIFUGO_API_KEY ||= "wikist-check-api-key-000000000000000000000000";
const legacyProxySource = fs.readFileSync(path.join(backend, "app", "controller", "LegacyProxyController.php"), "utf8");
const nodeServerSource = fs.readFileSync(path.join(root, "src", "server", "app.js"), "utf8");
const passportControllerSource = fs.readFileSync(path.join(backend, "app", "controller", "PassportController.php"), "utf8");
const passportClientSource = fs.readFileSync(path.join(root, "public", "passport", "passport.js"), "utf8");
const adminMailControllerSource = fs.readFileSync(path.join(backend, "app", "controller", "AdminMailController.php"), "utf8");
const mailServiceSource = fs.readFileSync(path.join(backend, "app", "service", "MailService.php"), "utf8");

if (!legacyProxySource.includes("X-Wikist-User-Id") || !legacyProxySource.includes("AuthService")) {
  throw new Error("Webman legacy proxy must bridge the authenticated Passport identity.");
}
if (!nodeServerSource.includes('req.headers["x-wikist-user-id"]') || !nodeServerSource.includes("internalRequest")) {
  throw new Error("Node compatibility APIs must only accept the Webman identity bridge on trusted internal requests.");
}
if (!passportControllerSource.includes("'emailAvailable' => $email === '' ? null : !$users->emailExists($email),")
  || !passportClientSource.includes('check("email", email, $("#emailHint"))')) {
  throw new Error("Passport availability checks must report existing email addresses before registration is submitted.");
}
if (!adminMailControllerSource.includes("sendTest($request->identity)")
  || !adminMailControllerSource.includes("mail.test")
  || !mailServiceSource.includes("public function sendTest(UserIdentity $user): array")
  || !mailServiceSource.includes("smtp_account_inactive")) {
  throw new Error("Admin SMTP test mail must be sent only to the authenticated administrator and audited.");
}

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

function phpFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return phpFiles(target);
    return entry.isFile() && entry.name.endsWith(".php") ? [target] : [];
  });
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `${command} failed\n`);
    process.exit(result.status || 1);
  }
}

const php = resolvePhp();
if (!php) {
  throw new Error("Wikist Webman checks require PHP 8.4.1 or newer. Set WIKIST_PHP when PHP is not in PATH.");
}
if (!fs.existsSync(path.join(backend, "vendor", "autoload.php"))) {
  throw new Error("Webman dependencies are missing. Run Composer install in webman-backend first.");
}

run(php, ["-l", path.join(root, "update.php")], root);

for (const file of phpFiles(path.join(backend, "app")).concat(
  phpFiles(path.join(backend, "config")),
  phpFiles(path.join(backend, "database")),
  phpFiles(path.join(backend, "support")),
  phpFiles(path.join(backend, "tools")),
)) {
  run(php, ["-l", file], backend);
}
run(php, [path.join(backend, "tools", "check.php")], backend);
run(php, [path.join(backend, "tools", "check-messaging.php")], backend);
run(php, [path.join(backend, "tools", "check-selections.php")], backend);
run(php, [path.join(backend, "tools", "check-native-community.php")], backend);
run(php, [path.join(backend, "tools", "check-seo.php")], backend);
run(php, [path.join(backend, "webman"), "route:list"], backend);
console.log("OK    Wikist Webman syntax, foundation, messaging, selections, native Community and route checks passed.");
