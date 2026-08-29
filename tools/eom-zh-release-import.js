#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { loadConfig } = require("../src/core/config");
const { PersistentFtsIndex } = require("../src/core/fts-index");
const { parseWikistImport } = require("../src/core/import-export");
const { PageStore } = require("../src/core/page-store");
const { PassportStore } = require("../src/core/passport-store");

const PACKAGE_FORMAT = "wikist-eom-zh-package";
const PACKAGE_VERSION = 1;
const STATE_FORMAT = "wikist-eom-zh-import-state";

function usage() {
  return [
    "Import a validated EoM Chinese release package through Wikist's internal PageStore.",
    "",
    "Usage:",
    "  node tools/eom-zh-import.js --package=PATH [--root=PATH] [options]",
    "",
    "Options:",
    "  --package=PATH       Ready release package directory (required)",
    "  --root=PATH          Wikist application root (default: current directory)",
    "  --wikist-root=PATH   Backward-compatible alias for --root",
    "  --batch-size=N       Maximum package entries per run (default: 200)",
    "  --state=PATH         Resume-state path under <root>/data/imports",
    "  --resume             Resume the package state (default behavior)",
    "  --overwrite          Update existing EoM pages; never replaces non-EoM pages",
    "  --no-backup          Skip the first-write backup",
    "  --dry-run            Verify and plan without writing",
    "  --help               Show this help",
    "",
    "Run this command on the Wikist host with the service stopped for real imports.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    packagePath: "",
    root: process.cwd(),
    batchSize: 200,
    statePath: "",
    overwrite: false,
    backup: true,
    dryRun: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--resume") {}
    else if (arg === "--overwrite" || arg === "--overwrite-eom") options.overwrite = true;
    else if (arg === "--no-backup") options.backup = false;
    else if (arg.startsWith("--package=")) options.packagePath = arg.slice(10);
    else if (arg.startsWith("--root=")) options.root = arg.slice(7);
    else if (arg.startsWith("--wikist-root=")) options.root = arg.slice(14);
    else if (arg.startsWith("--batch-size=")) options.batchSize = Number(arg.slice(13));
    else if (arg.startsWith("--state=")) options.statePath = arg.slice(8);
    else if (arg.startsWith("--source=")) throw new Error("--source is no longer accepted; pass a ready release directory with --package.");
    else if (arg.startsWith("--base-url=") || arg.startsWith("--token=")) {
      throw new Error("HTTP import is not enabled because Wikist's import API requires an authenticated user session. Run this tool on the host through the internal PageStore interface.");
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) return options;
  if (!options.packagePath) throw new Error("--package is required.");
  options.packagePath = path.resolve(options.packagePath);
  options.root = path.resolve(options.root);
  if (options.statePath) options.statePath = path.resolve(options.statePath);
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10000) throw new Error("--batch-size must be 1..10000.");
  return options;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function strictText(buffer, filePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new Error(`Invalid UTF-8 in ${filePath}: ${error.message}`);
  }
}

function readJson(filePath) {
  const text = strictText(fs.readFileSync(filePath), filePath);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function serializedJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(filePath, bytes) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function atomicWriteJson(filePath, value) {
  atomicWrite(filePath, serializedJson(value));
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safePackageFile(packagePath, relativePath) {
  const relative = String(relativePath || "");
  if (!relative || relative.includes("\\") || relative.startsWith("/") || path.posix.normalize(relative) !== relative) {
    throw new Error(`Unsafe package path: ${relative}`);
  }
  const filePath = path.resolve(packagePath, ...relative.split("/"));
  if (!isInside(packagePath, filePath)) throw new Error(`Package path escapes its root: ${relative}`);
  let current = packagePath;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Package path contains a symbolic link: ${relative}`);
  }
  return filePath;
}

function assertSafeStatePath(root, statePath) {
  const stateRoot = path.join(root, "data", "imports");
  if (!isInside(stateRoot, statePath)) throw new Error("Import state must be inside <wikist-root>/data/imports.");
  let current = path.resolve(root);
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Wikist root cannot be a symbolic link.");
  for (const segment of path.relative(current, statePath).split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Import state path cannot contain a symbolic link.");
  }
  if (fs.existsSync(statePath) && !fs.statSync(statePath).isFile()) throw new Error("Import state path is not a file.");
}

function parseChecksumFile(filePath) {
  const rows = new Map();
  strictText(fs.readFileSync(filePath), filePath).split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    if (!match) throw new Error(`Invalid checksum line ${index + 1}.`);
    if (rows.has(match[2])) throw new Error(`Duplicate checksum path: ${match[2]}`);
    rows.set(match[2], match[1]);
  });
  return rows;
}

function validatePagePackage(data, entry, filePath) {
  if (data?.format !== "wikist-page" || data?.version !== 1) throw new Error(`Invalid Wikist page package: ${filePath}`);
  if (data.translation?.status !== "validated" || !Array.isArray(data.translation?.issues) || data.translation.issues.length) {
    throw new Error(`Package is not final validated output: ${filePath}`);
  }
  if (data.source?.site !== "Encyclopedia of Mathematics" || Number(data.source?.pageid) !== Number(entry.sourceId)) throw new Error(`Package provenance mismatch: ${filePath}`);
  if (data.source?.title !== entry.sourceTitle || String(data.source?.revisionId || "") !== String(entry.sourceRevisionId || "")) throw new Error(`Package source metadata mismatch: ${filePath}`);
  if (!data.page?.slug || !data.page?.title || data.page.slug !== entry.slug || data.page.title !== entry.title) throw new Error(`Package page metadata mismatch: ${filePath}`);
  if ((data.page.redirectTarget || "") !== (entry.redirectTarget || "")) throw new Error(`Package redirect metadata mismatch: ${filePath}`);
  if (data.page.importSource !== "encyclopedia-of-mathematics") throw new Error(`Package importSource is not EoM: ${filePath}`);
  const body = String(data.page.body || "");
  if (entry.redirectTarget) {
    if (body.trim()) throw new Error(`Redirect package has a nonempty body: ${filePath}`);
  } else if (!body.trim()) throw new Error(`Article package has an empty body: ${filePath}`);
  if (/@@WIKIST_[A-Z]+_\d{6}@@/.test(body)) throw new Error(`Package body contains a protected token: ${filePath}`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) throw new Error(`Package body contains an illegal control character: ${filePath}`);
  const references = Array.isArray(data.page.references) ? data.page.references : null;
  if (!references || references.length > 120) throw new Error(`Package references are invalid: ${filePath}`);
  const referenceIds = new Set();
  for (const reference of references) {
    const id = String(reference?.id || "").trim().toLocaleLowerCase("en-US");
    if (!id || referenceIds.has(id)) throw new Error(`Package has an invalid or duplicate reference id: ${filePath}`);
    referenceIds.add(id);
  }
  for (const match of body.matchAll(/@([a-z0-9][a-z0-9._:-]*)/gi)) {
    if (!referenceIds.has(match[1].toLocaleLowerCase("en-US"))) throw new Error(`Package citation is unresolved in ${filePath}: ${match[1]}`);
  }
  const parsedPage = parseWikistImport({ package: data });
  if (parsedPage.slug !== data.page.slug || parsedPage.title !== data.page.title || parsedPage.body !== body) {
    throw new Error(`Package is not canonical under Wikist's JSON import parser: ${filePath}`);
  }
  return parsedPage;
}

function loadRelease(packagePath) {
  if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isDirectory()) throw new Error(`Release package directory not found: ${packagePath}`);
  if (fs.lstatSync(packagePath).isSymbolicLink()) throw new Error("Release package directory cannot be a symbolic link.");
  const allowedTopLevel = new Set(["build-state.json", "checksums.sha256", "manifest.json", "pages"]);
  for (const entry of fs.readdirSync(packagePath, { withFileTypes: true })) {
    if (!allowedTopLevel.has(entry.name) || entry.isSymbolicLink()) throw new Error(`Release package contains an unexpected top-level entry: ${entry.name}`);
    if (entry.name === "pages" ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Release package entry has the wrong type: ${entry.name}`);
  }
  const manifestPath = path.join(packagePath, "manifest.json");
  const checksumPath = path.join(packagePath, "checksums.sha256");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) throw new Error("Release package must contain manifest.json and checksums.sha256.");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(strictText(manifestBytes, manifestPath));
  if (manifest.format !== PACKAGE_FORMAT || manifest.formatVersion !== PACKAGE_VERSION) throw new Error("Unsupported EoM Chinese release package format.");
  if (manifest.status !== "ready") throw new Error(`Release package is not ready (status: ${manifest.status || "missing"}).`);
  if (!Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error("Release package contains no entries.");
  if (manifest.counts?.expected !== manifest.entries.length || manifest.counts?.packaged !== manifest.entries.length || manifest.counts?.pending !== 0 || manifest.counts?.invalid !== 0) {
    throw new Error("Release package counts are incomplete.");
  }
  if (manifest.selection?.expectedEntries !== manifest.entries.length) throw new Error("Release package selection count is incomplete.");

  const sourceIds = manifest.entries.map((entry) => Number(entry.sourceId)).sort((left, right) => left - right);
  if (sourceIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(sourceIds).size !== sourceIds.length) throw new Error("Release manifest has invalid or duplicate sourceIds.");
  if (manifest.selection?.sourceIdsSha256 !== sha256(Buffer.from(sourceIds.join(","), "ascii"))) throw new Error("Release sourceId selection checksum mismatch.");
  const contentEntries = manifest.entries.map(({ sequence, ...entry }) => entry);
  const contentSha256 = sha256(Buffer.from(JSON.stringify({ sourceIds, entries: contentEntries }), "utf8"));
  if (manifest.contentSha256 !== contentSha256) throw new Error("Release content checksum mismatch.");

  const checksums = parseChecksumFile(checksumPath);
  const expectedPaths = new Set(["manifest.json"]);
  if (checksums.get("manifest.json") !== sha256(manifestBytes)) throw new Error("manifest.json checksum mismatch.");
  const records = [];
  const slugs = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    if (entry.sequence !== index) throw new Error(`Release sequence is not contiguous at index ${index}.`);
    const expectedPath = `pages/${String(entry.sourceId).padStart(8, "0")}.json`;
    if (entry.path !== expectedPath || !/^pages\/\d{8}\.json$/.test(entry.path)) throw new Error(`Invalid page path for sourceId ${entry.sourceId}.`);
    if (slugs.has(entry.slug)) throw new Error(`Duplicate release slug: ${entry.slug}`);
    slugs.add(entry.slug);
    expectedPaths.add(entry.path);
    const filePath = safePackageFile(packagePath, entry.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Release page is missing: ${entry.path}`);
    const bytes = fs.readFileSync(filePath);
    const digest = sha256(bytes);
    if (digest !== entry.sha256 || checksums.get(entry.path) !== digest) throw new Error(`Release page checksum mismatch: ${entry.path}`);
    const data = JSON.parse(strictText(bytes, filePath));
    const page = validatePagePackage(data, entry, filePath);
    records.push({ entry, data, page, filePath, digest });
  }
  const pageDirectory = path.join(packagePath, "pages");
  const payloadFiles = fs.readdirSync(pageDirectory, { withFileTypes: true });
  if (payloadFiles.some((entry) => !entry.isFile() || !/^\d{8}\.json$/.test(entry.name))) throw new Error("Release pages directory contains an unexpected entry.");
  const actualPagePaths = payloadFiles.map((entry) => `pages/${entry.name}`).sort();
  const expectedPagePaths = manifest.entries.map((entry) => entry.path).sort();
  if (actualPagePaths.length !== expectedPagePaths.length || actualPagePaths.some((value, index) => value !== expectedPagePaths[index])) throw new Error("Release pages directory contains unlisted or missing packages.");
  const checksumPaths = [...checksums.keys()].sort();
  const expectedChecksumPaths = [...expectedPaths].sort();
  if (checksumPaths.length !== expectedChecksumPaths.length || checksumPaths.some((value, index) => value !== expectedChecksumPaths[index])) throw new Error("checksums.sha256 contains missing or unexpected payload paths.");
  const ordered = [...records].sort((left, right) => {
    const leftRedirect = left.page.redirectTarget ? 1 : 0;
    const rightRedirect = right.page.redirectTarget ? 1 : 0;
    return leftRedirect - rightRedirect || left.entry.sequence - right.entry.sequence;
  });
  const articleCount = records.filter((record) => !record.page.redirectTarget).length;
  if (manifest.counts.articles !== articleCount || manifest.counts.redirects !== records.length - articleCount) throw new Error("Release article/redirect counts are inconsistent.");
  const recordBySlug = new Map(records.map((record) => [record.page.slug, record]));
  for (const record of records) {
    const target = record.page.redirectTarget ? recordBySlug.get(record.page.redirectTarget) : null;
    if (target?.page.redirectTarget) throw new Error(`Release redirect target is not canonical: ${record.page.slug}`);
  }
  return { packagePath, manifestPath, checksumPath, manifest, records: ordered, recordBySlug, slugs };
}

function runtimeLooksActive(root) {
  const candidates = ["wikist-server.pid", path.join("runtime", "wikist.pid"), path.join("data", "wikist-server.pid")];
  return candidates.some((relative) => {
    const filePath = path.join(root, relative);
    if (!fs.existsSync(filePath)) return false;
    const pid = Number(String(fs.readFileSync(filePath, "utf8")).trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (_error) {
      return false;
    }
  });
}

function backupCurrent(root, config, packageContentSha256) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(root, "data", "import-backups", `eom-zh-${stamp}`);
  ensureDir(target);
  for (const relative of [path.join("content", "pages"), path.join("content", "revisions")]) {
    const source = path.join(root, relative);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(target, relative), { recursive: true, errorOnExist: true });
  }
  const database = path.resolve(root, config.passport?.database || "data/wikist.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${database}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, path.basename(source)));
  }
  atomicWriteJson(path.join(target, "backup.json"), { createdAt: new Date().toISOString(), wikistRoot: root, packageContentSha256, database });
  return target;
}

function defaultStatePath(options, release) {
  const mode = options.overwrite ? "overwrite" : "create-only";
  return path.join(options.root, "data", "imports", "eom-zh", `${release.manifest.contentSha256}-${mode}.state.json`);
}

function loadState(options, release) {
  const statePath = options.statePath || defaultStatePath(options, release);
  assertSafeStatePath(options.root, statePath);
  if (!fs.existsSync(statePath)) {
    return {
      statePath,
      state: {
        format: STATE_FORMAT,
        formatVersion: 1,
        packageContentSha256: release.manifest.contentSha256,
        wikistRoot: options.root,
        overwrite: options.overwrite,
        createdAt: new Date().toISOString(),
        updatedAt: "",
        backup: "",
        completed: {},
      },
    };
  }
  const state = readJson(statePath);
  if (state.format !== STATE_FORMAT || state.formatVersion !== 1) throw new Error("Import state has an unsupported format.");
  if (state.packageContentSha256 !== release.manifest.contentSha256 || path.resolve(state.wikistRoot) !== options.root || Boolean(state.overwrite) !== options.overwrite) throw new Error("Import state belongs to another package, root, or overwrite mode.");
  if (!state.completed || typeof state.completed !== "object" || Array.isArray(state.completed)) throw new Error("Import state is malformed.");
  return { statePath, state };
}

function classifyRecord(record, pages, options) {
  if (pages.hiddenPages?.has(record.page.slug)) return { action: "skip", existing: null, reason: "hidden-page-protected" };
  const existing = pages.getPage(record.page.slug);
  if (!existing) return { action: "import", existing: null, reason: "new-page" };
  const sameSource = existing.importSource === "encyclopedia-of-mathematics";
  const sameRevision = sameSource && String(existing.importRevision || "") === String(record.page.importRevision || "");
  if (sameRevision && !options.overwrite) return { action: "skip", existing, reason: "same-source-revision" };
  if (!options.overwrite) return { action: "skip", existing, reason: "existing-page-overwrite-disabled" };
  if (!sameSource) return { action: "skip", existing, reason: "existing-non-eom-page-protected" };
  return { action: "update", existing, reason: "eom-overwrite-enabled" };
}

function reconcileCompletedState(state, release, pages) {
  const recordById = new Map(release.records.map((record) => [record.entry.sourceId, record]));
  let reopened = 0;
  for (const [idText, completion] of Object.entries(state.completed)) {
    const id = Number(idText);
    const record = recordById.get(id);
    if (!record || String(id) !== idText || Number(completion?.sourceId) !== id || completion?.slug !== record.page.slug || !["imported", "updated", "skipped"].includes(completion?.status)) {
      throw new Error(`Import state has an invalid completion for sourceId ${idText}.`);
    }
    const existing = pages.getPage(record.page.slug);
    const importedPageStillMatches = existing
      && existing.importSource === "encyclopedia-of-mathematics"
      && String(existing.importRevision || "") === String(record.page.importRevision || "");
    if (!existing || (["imported", "updated"].includes(completion.status) && !importedPageStillMatches)) {
      delete state.completed[idText];
      reopened += 1;
    }
  }
  return reopened;
}

function redirectTargetAvailable(record, release, pages, options) {
  if (!record.page.redirectTarget) return true;
  if (pages.getPage(record.page.redirectTarget)) return true;
  const target = release.recordBySlug.get(record.page.redirectTarget);
  return Boolean(target && classifyRecord(target, pages, options).action !== "skip");
}

function acquireLock(root, release) {
  const lockPath = path.join(root, "data", "eom-zh-import.lock");
  ensureDir(path.dirname(lockPath));
  if (fs.existsSync(lockPath)) {
    let active = false;
    try {
      const lock = readJson(lockPath);
      if (Number.isInteger(lock.pid) && lock.pid > 0) {
        try {
          process.kill(lock.pid, 0);
          active = true;
        } catch (_error) {}
      }
    } catch (_error) {}
    if (active) throw new Error(`Another EoM import holds ${lockPath}.`);
    fs.unlinkSync(lockPath);
  }
  const descriptor = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(descriptor, serializedJson({ pid: process.pid, startedAt: new Date().toISOString(), packageContentSha256: release.manifest.contentSha256 }));
  fs.fsyncSync(descriptor);
  return { descriptor, lockPath };
}

function releaseLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.descriptor); } catch (_error) {}
  try { fs.unlinkSync(lock.lockPath); } catch (_error) {}
}

function writeCheckpoint(loaded, state) {
  state.updatedAt = new Date().toISOString();
  atomicWriteJson(loaded.statePath, state);
}

function compactResult(record, status, reason) {
  return { sourceId: record.entry.sourceId, slug: record.page.slug, status, reason, revision: record.page.importRevision || "" };
}

function importPackage(options) {
  const startedAt = new Date().toISOString();
  if (!fs.existsSync(path.join(options.root, "package.json"))) throw new Error("--root is not a Wikist application root.");
  const release = loadRelease(options.packagePath);
  const loaded = loadState(options, release);
  const state = loaded.state;
  const config = loadConfig(options.root);
  if (!options.dryRun && runtimeLooksActive(options.root)) throw new Error("Wikist appears to be running. Stop the service before importing.");
  const pages = new PageStore(options.root, config);
  const reopenedFromState = reconcileCompletedState(state, release, pages);
  const pending = release.records.filter((record) => !state.completed[record.entry.sourceId]);
  const batch = pending.slice(0, options.batchSize);
  const dryResults = batch.map((record) => {
    const classification = classifyRecord(record, pages, options);
    if (!redirectTargetAvailable(record, release, pages, options)) return compactResult(record, "failed", `redirect target is absent or protected: ${record.page.redirectTarget}`);
    return compactResult(record, classification.action === "skip" ? "skipped" : `${classification.action}-planned`, classification.reason);
  });
  const baseReport = {
    package: options.packagePath,
    packageContentSha256: release.manifest.contentSha256,
    wikistRoot: options.root,
    overwrite: options.overwrite,
    batchSize: options.batchSize,
    packageEntries: release.records.length,
    completedBefore: Object.keys(state.completed).length,
    reopenedFromState,
    selectedThisRun: batch.length,
    remainingBefore: pending.length,
  };
  if (options.dryRun) {
    const report = {
      ...baseReport,
      mode: "dry-run",
      plannedImports: dryResults.filter((item) => item.status === "import-planned").length,
      plannedUpdates: dryResults.filter((item) => item.status === "update-planned").length,
      plannedSkips: dryResults.filter((item) => item.status === "skipped").length,
      failedPreflight: dryResults.filter((item) => item.status === "failed").length,
      remainingAfterBatch: Math.max(0, pending.length - batch.length),
      state: loaded.statePath,
      results: dryResults,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.failedPreflight) process.exitCode = 2;
    return report;
  }

  let lock;
  let passport;
  const results = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  try {
    lock = acquireLock(options.root, release);
    const plannedWrites = batch.filter((record) => classifyRecord(record, pages, options).action !== "skip");
    if (plannedWrites.length && options.backup && !state.backup) {
      state.backup = backupCurrent(options.root, config, release.manifest.contentSha256);
      writeCheckpoint(loaded, state);
    }
    passport = config.passport?.enabled ? new PassportStore(options.root, config.passport) : null;
    const fts = passport ? new PersistentFtsIndex(passport, () => ({ plugins: { advancedSearch: { enabled: true, fts5: true } } })) : null;
    for (const record of batch) {
      try {
        const classification = classifyRecord(record, pages, options);
        if (classification.action === "skip") {
          if (classification.reason === "same-source-revision") {
            passport?.syncPageLinks(classification.existing);
            fts?.syncPage(classification.existing);
          }
          skipped += 1;
          const result = compactResult(record, "skipped", classification.reason);
          results.push(result);
          state.completed[record.entry.sourceId] = { ...result, completedAt: new Date().toISOString() };
          writeCheckpoint(loaded, state);
          continue;
        }
        if (record.page.redirectTarget && !pages.getPage(record.page.redirectTarget)) throw new Error(`redirect target is not imported: ${record.page.redirectTarget}`);
        const page = pages.savePage(record.page.slug, record.page);
        passport?.syncPageLinks(page);
        fts?.syncPage(page);
        if (classification.action === "update") updated += 1;
        else imported += 1;
        const result = compactResult(record, classification.action === "update" ? "updated" : "imported", classification.reason);
        results.push(result);
        state.completed[record.entry.sourceId] = { ...result, completedAt: new Date().toISOString() };
        writeCheckpoint(loaded, state);
      } catch (error) {
        failed += 1;
        results.push(compactResult(record, "failed", error.message));
      }
    }
  } finally {
    try { passport?.close?.(); } catch (_error) {}
    releaseLock(lock);
  }

  const completedAfter = Object.keys(state.completed).length;
  const completedAt = new Date().toISOString();
  const report = {
    ...baseReport,
    mode: "write",
    startedAt,
    completedAt,
    imported,
    updated,
    skipped,
    failed,
    completedAfter,
    remainingAfterBatch: Math.max(0, release.records.length - completedAfter),
    backup: state.backup || "",
    state: loaded.statePath,
    results,
  };
  const reportPath = path.join(options.root, "data", "imports", "eom-zh", "reports", `${completedAt.replace(/[:.]/g, "-")}.json`);
  atomicWriteJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: reportPath }, null, 2)}\n`);
  if (failed) process.exitCode = 2;
  return report;
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) process.stdout.write(`${usage()}\n`);
    else importPackage(options);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = { importPackage, loadRelease, parseArgs, runCli, sha256 };
