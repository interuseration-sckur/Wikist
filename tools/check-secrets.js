"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = childProcess.execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
const excluded = /^(?:data|content|logs|node_modules|plugins\/vendor|public\/uploads|\.runtime|runtime|webman-backend\/vendor)(?:\/|$)/;
const patterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Stripe live key", regex: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "JWT bearer secret", regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
];
const findings = [];
for (const relative of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  const normalized = relative.replace(/\\/g, "/");
  if (excluded.test(normalized)) continue;
  const absolute = path.join(root, relative);
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (_error) { continue; }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const source = buffer.toString("utf8");
  patterns.forEach((pattern) => { if (pattern.regex.test(source)) findings.push(`${normalized}: ${pattern.name}`); });
  source.split(/\r?\n/).forEach((line, index) => {
    const assignment = line.match(/^\s*(APP_SECRET|WIKIST_PASSPORT_SECRET|CENTRIFUGO_(?:API_KEY|TOKEN_HMAC_SECRET)|WIKIST_(?:BACKUP|RELEASE)_SIGNING_KEY)\s*=\s*(.+?)\s*$/);
    if (!assignment) return;
    const value = assignment[2].replace(/^['"]|['"]$/g, "");
    if (value && !/(?:replace|change|example|development|random|<|\$\{|getenv|process\.env)/i.test(value)) findings.push(`${normalized}:${index + 1}: hard-coded ${assignment[1]}`);
  });
}
if (findings.length) {
  console.error(`Potential secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("Secret scan passed.");
