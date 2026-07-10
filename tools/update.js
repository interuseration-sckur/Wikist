#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { createBackupPackage } = require("../src/core/backup");
const { loadConfig } = require("../src/core/config");

const rootDir = path.resolve(__dirname, "..");
const reportDir = path.join(rootDir, "data", "updates");
const backupDir = path.join(rootDir, "data", "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const CODE_PATHS = [
  ".gitignore",
  "CHANGELOG.md",
  "README.md",
  "docs",
  "package-lock.json",
  "package.json",
  "public",
  "server.js",
  "src",
  "tools",
];

const PROTECTED_PATHS = [
  "config/site.config.json",
  "content/deleted",
  "content/pages",
  "content/revisions",
  "data",
  "logs",
  "node_modules",
  "plugins/vendor",
];

function bin(name) {
  if (process.platform === "win32" && name === "npm") return "npm.cmd";
  return name;
}

function gitArgs(args) {
  return ["-c", `safe.directory=${rootDir}`, ...args];
}

function parseArgs(argv) {
  const options = {
    strategy: "git",
    remote: "origin",
    branch: "main",
    source: "",
    service: "",
    dryRun: false,
    yes: false,
    backup: true,
    install: true,
    check: true,
    allowDirty: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--no-backup") options.backup = false;
    else if (arg === "--skip-install") options.install = false;
    else if (arg === "--skip-check") options.check = false;
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg.startsWith("--strategy=")) options.strategy = arg.slice("--strategy=".length);
    else if (arg.startsWith("--source=")) options.source = arg.slice("--source=".length);
    else if (arg.startsWith("--remote=")) options.remote = arg.slice("--remote=".length);
    else if (arg.startsWith("--branch=")) options.branch = arg.slice("--branch=".length);
    else if (arg.startsWith("--service=")) options.service = arg.slice("--service=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function usage() {
  return `
Wikist update

Usage:
  node tools/update.js --strategy=git --remote=origin --branch=main --service=wikist --yes
  node tools/update.js --strategy=local --source=...your-path.../wikist-release --service=wikist --yes
  node tools/update.js --dry-run

Strategies:
  git     Fetch and fast-forward merge from the configured remote branch.
  local   Copy core code from an extracted release directory while preserving runtime data.

Protected paths are never overwritten by the local strategy:
  ${PROTECTED_PATHS.join(", ")}
`.trim();
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, args, options = {}) {
  const display = [command, ...args].join(" ");
  if (options.dryRun) {
    log(`[dry-run] ${display}`);
    return "";
  }
  log(`$ ${display}`);
  return childProcess.execFileSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  }) || "";
}

function capture(command, args, options = {}) {
  return childProcess.execFileSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function safeInside(parent, target) {
  const root = path.resolve(parent);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function ensureProjectRoot(dir) {
  const packagePath = path.join(dir, "package.json");
  const serverPath = path.join(dir, "server.js");
  if (!fs.existsSync(packagePath) || !fs.existsSync(serverPath)) {
    throw new Error(`${dir} does not look like a Wikist project root.`);
  }
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (pkg.name !== "wikist") throw new Error(`${dir} package.json is not Wikist.`);
}

function writeReport(report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const filePath = path.join(reportDir, `update-${stamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function createPreUpdateBackup(options) {
  if (!options.backup) return null;
  const config = loadConfig(rootDir);
  const database = config.passport?.database || "data/wikist.sqlite";
  const backup = createBackupPackage(rootDir, { database });
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `wikist-pre-update-${stamp}.json.gz`;
  const filePath = path.join(backupDir, filename);
  if (!options.dryRun) fs.writeFileSync(filePath, backup.buffer);
  return {
    path: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    database,
    compressedBytes: backup.buffer.length,
    generatedAt: backup.manifest.generatedAt,
  };
}

function service(command, options) {
  if (!options.service) return;
  run("systemctl", [command, options.service], options);
}

function ensureCleanGit(options) {
  if (!fs.existsSync(path.join(rootDir, ".git"))) throw new Error("Git strategy requires a .git directory.");
  const status = capture("git", gitArgs(["status", "--porcelain"]), { cwd: rootDir });
  if (status && !options.allowDirty) {
    throw new Error("Tracked working tree changes exist. Commit/stash them first, or use --allow-dirty after reviewing them.");
  }
}

function currentGitSha() {
  try {
    return capture("git", gitArgs(["rev-parse", "HEAD"]), { cwd: rootDir });
  } catch (_error) {
    return "";
  }
}

function updateFromGit(options) {
  ensureCleanGit(options);
  const before = currentGitSha();
  run("git", gitArgs(["fetch", options.remote, options.branch]), options);
  const target = capture("git", gitArgs(["rev-parse", `${options.remote}/${options.branch}`]), { cwd: rootDir });
  const ancestor = childProcess.spawnSync("git", gitArgs(["merge-base", "--is-ancestor", "HEAD", `${options.remote}/${options.branch}`]), { cwd: rootDir });
  if (ancestor.status !== 0) {
    throw new Error(`Current HEAD is not an ancestor of ${options.remote}/${options.branch}. Refusing non-fast-forward update.`);
  }
  run("git", gitArgs(["merge", "--ff-only", `${options.remote}/${options.branch}`]), options);
  return { before, target, after: options.dryRun ? before : currentGitSha() };
}

function copyPath(source, target, options) {
  if (!safeInside(rootDir, target)) throw new Error(`Unsafe target path: ${target}`);
  if (!fs.existsSync(source)) return { path: path.relative(rootDir, target).replace(/\\/g, "/"), copied: false, missing: true };
  if (options.dryRun) return { path: path.relative(rootDir, target).replace(/\\/g, "/"), copied: true, dryRun: true };
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  return { path: path.relative(rootDir, target).replace(/\\/g, "/"), copied: true };
}

function copyLocalPlugins(sourceRoot, options) {
  const sourcePlugins = path.join(sourceRoot, "plugins");
  const targetPlugins = path.join(rootDir, "plugins");
  const copied = [];
  if (!fs.existsSync(sourcePlugins)) return copied;
  fs.mkdirSync(targetPlugins, { recursive: true });
  for (const entry of fs.readdirSync(sourcePlugins, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "vendor") continue;
    if (!entry.name.startsWith("wikist-") && !entry.name.startsWith("upstream-")) continue;
    copied.push(copyPath(path.join(sourcePlugins, entry.name), path.join(targetPlugins, entry.name), options));
  }
  return copied;
}

function updateFromLocal(options) {
  if (!options.source) throw new Error("Local strategy requires --source=...your-path.../wikist-release");
  const sourceRoot = path.resolve(options.source);
  if (!safeInside(path.dirname(sourceRoot), sourceRoot)) throw new Error("Invalid source path.");
  ensureProjectRoot(sourceRoot);

  const copied = [];
  for (const relativePath of CODE_PATHS) {
    if (relativePath === "package-lock.json" && !fs.existsSync(path.join(sourceRoot, relativePath))) continue;
    if (relativePath === "docs" && !fs.existsSync(path.join(sourceRoot, relativePath))) continue;
    copied.push(copyPath(path.join(sourceRoot, relativePath), path.join(rootDir, relativePath), options));
  }

  const configExample = path.join(sourceRoot, "config", "site.config.example.json");
  if (fs.existsSync(configExample)) {
    copied.push(copyPath(configExample, path.join(rootDir, "config", "site.config.example.json"), options));
  }
  copied.push(...copyLocalPlugins(sourceRoot, options));
  return { source: sourceRoot, copied };
}

function installDependencies(options) {
  if (!options.install) return;
  if (!fs.existsSync(path.join(rootDir, "package.json"))) return;
  run(bin("npm"), ["install", "--omit=dev"], options);
}

function runChecks(options) {
  if (!options.check) return;
  run(bin("npm"), ["run", "check"], options);
}

function assertConfirmation(options) {
  if (options.yes || options.dryRun) return;
  if (!process.stdin.isTTY) throw new Error("Refusing to run without --yes in a non-interactive shell.");
  log("This will update Wikist code while preserving runtime data.");
  log(`Protected paths: ${PROTECTED_PATHS.join(", ")}`);
  throw new Error("Re-run with --yes after confirming the backup and strategy.");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    log(usage());
    return;
  }
  if (!["git", "local"].includes(options.strategy)) throw new Error(`Unsupported strategy: ${options.strategy}`);
  ensureProjectRoot(rootDir);
  assertConfirmation(options);

  const report = {
    status: "running",
    startedAt: new Date().toISOString(),
    strategy: options.strategy,
    dryRun: options.dryRun,
    service: options.service || "",
    backup: null,
    result: null,
    protectedPaths: PROTECTED_PATHS,
  };

  let stopped = false;
  try {
    service("stop", options);
    stopped = Boolean(options.service);
    report.backup = createPreUpdateBackup(options);
    if (report.backup) log(options.dryRun ? `Backup would be: ${report.backup.path}` : `Backup: ${report.backup.path}`);

    report.result = options.strategy === "git" ? updateFromGit(options) : updateFromLocal(options);
    installDependencies(options);
    runChecks(options);

    report.status = "ok";
    report.finishedAt = new Date().toISOString();
    if (options.dryRun) log(`Dry-run report:\n${JSON.stringify(report, null, 2)}`);
    else {
      const reportPath = writeReport(report);
      log(`Update report: ${reportPath}`);
    }
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    report.finishedAt = new Date().toISOString();
    if (options.dryRun) log(`Dry-run failed:\n${JSON.stringify(report, null, 2)}`);
    else {
      const reportPath = writeReport(report);
      log(`Update failed. Report: ${reportPath}`);
    }
    throw error;
  } finally {
    if (stopped) service("start", options);
  }
}

try {
  main();
} catch (error) {
  console.error(`Wikist update error: ${error.message}`);
  process.exit(1);
}
