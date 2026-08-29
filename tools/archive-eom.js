#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_API = "https://encyclopediaofmath.org/api.php";
const DEFAULT_OUTPUT = process.platform === "win32" ? "G:\\Wikist-EoM" : path.join(process.cwd(), "data", "eom-archive");
const DEFAULT_USER_AGENT = "Wikist-EoM-Archiver/1.0 (+https://github.com/interuseration-sckur/Wikist; contact: math.sx)";
const FORMAT_VERSION = 1;

function usage() {
  return `
Archive the public Encyclopedia of Mathematics content namespaces without
translating or converting the original MediaWiki source.

Usage:
  node tools/archive-eom.js [options]

Options:
  --output=PATH          Archive root (default: ${DEFAULT_OUTPUT})
  --api=URL              MediaWiki API endpoint (default: ${DEFAULT_API})
  --namespaces=0,100     Content namespaces to archive (default: 0,100)
  --batch-size=20        Pages per content request (1-50; default: 20)
  --delay-ms=850         Minimum pause after each API request (default: 850)
  --max-pages=N          Limit pages for a test run; 0 means all (default: 0)
  --inventory-only       Fetch the page inventory but not page content
  --refresh-inventory    Replace a previously saved inventory
  --verify-only          Verify archived source files against stored SHA-256
  --help                 Show this help

The command is resumable. Re-running it skips pages whose source, metadata and
relations files have already been committed to the archive state.
`.trim();
}

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    api: DEFAULT_API,
    namespaces: [0, 100],
    batchSize: 20,
    delayMs: 850,
    maxPages: 0,
    inventoryOnly: false,
    refreshInventory: false,
    verifyOnly: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--inventory-only") options.inventoryOnly = true;
    else if (arg === "--refresh-inventory") options.refreshInventory = true;
    else if (arg === "--verify-only") options.verifyOnly = true;
    else if (arg.startsWith("--output=")) options.output = arg.slice(9);
    else if (arg.startsWith("--api=")) options.api = arg.slice(6);
    else if (arg.startsWith("--namespaces=")) options.namespaces = arg.slice(13).split(",").map(Number);
    else if (arg.startsWith("--batch-size=")) options.batchSize = Number(arg.slice(13));
    else if (arg.startsWith("--delay-ms=")) options.delayMs = Number(arg.slice(11));
    else if (arg.startsWith("--max-pages=")) options.maxPages = Number(arg.slice(12));
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.output = path.resolve(options.output);
  const parsedApi = new URL(options.api);
  if (parsedApi.protocol !== "https:" || parsedApi.username || parsedApi.password) {
    throw new Error("The EoM API must be an HTTPS URL without credentials.");
  }
  if (!options.namespaces.length || options.namespaces.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("--namespaces must contain non-negative integer namespace IDs.");
  }
  options.namespaces = [...new Set(options.namespaces)];
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer from 1 to 50.");
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 250 || options.delayMs > 60000) {
    throw new Error("--delay-ms must be an integer from 250 to 60000.");
  }
  if (!Number.isInteger(options.maxPages) || options.maxPages < 0) {
    throw new Error("--max-pages must be a non-negative integer.");
  }
  const root = path.parse(options.output).root;
  if (options.output === root) throw new Error("Refusing to use a drive or filesystem root as the archive directory.");
  return options;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(filePath, content, encoding = null) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, encoding ? { encoding, flag: "wx" } : { flag: "wx" });
  fs.renameSync(temporary, filePath);
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (_) {
    return fallback;
  }
}

function appendLog(root, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  ensureDir(path.join(root, "logs"));
  fs.appendFileSync(path.join(root, "logs", "archive.log"), line, "utf8");
  process.stdout.write(line);
}

function safeTitle(value, limit = 96) {
  let output = String(value || "untitled")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!output) output = "untitled";
  return [...output].slice(0, limit).join("");
}

function pageStem(page) {
  const id = String(Number(page.pageid) || 0).padStart(8, "0");
  return `${id}--${safeTitle(page.title)}`;
}

function pagePaths(root, page) {
  const id = String(Number(page.pageid) || 0).padStart(8, "0");
  const shard = id.slice(0, 4);
  const namespace = `ns-${Number(page.ns) || 0}`;
  const stem = pageStem(page);
  return {
    source: path.join(root, "pages", namespace, shard, `${stem}.md`),
    metadata: path.join(root, "metadata", namespace, shard, `${stem}.json`),
    relations: path.join(root, "relations", namespace, shard, `${stem}.json`),
  };
}

function archiveRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function lineOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function lineAt(offsets, index) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] <= index) low = middle + 1;
    else high = middle - 1;
  }
  return high + 1;
}

function splitTemplateArguments(value) {
  return String(value || "").split("|").map((item) => item.trim()).filter(Boolean);
}

function extractSourceRelations(source) {
  const text = String(source || "");
  const offsets = lineOffsets(text);
  const wikilinks = [];
  const templates = [];
  const citationUses = [];
  const referenceDefinitions = [];
  const identifiers = [];
  const namedReferences = [];
  const redirect = text.match(/^\s*#redirect\s*\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]/i);

  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const raw = match[1];
    const pipe = raw.indexOf("|");
    const destination = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    const label = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
    const hash = destination.indexOf("#");
    wikilinks.push({
      target: (hash >= 0 ? destination.slice(0, hash) : destination).trim(),
      anchor: hash >= 0 ? destination.slice(hash + 1).trim() : "",
      label,
      line: lineAt(offsets, match.index),
    });
  }

  for (const match of text.matchAll(/\{\{\s*([^{}|\n]+?)\s*(?:\|([\s\S]*?))?\}\}/g)) {
    const name = String(match[1] || "").trim();
    const args = splitTemplateArguments(match[2]);
    templates.push({ name, arguments: args, line: lineAt(offsets, match.index) });
    if (/^cite$/i.test(name)) citationUses.push({ keys: args, line: lineAt(offsets, match.index) });
    if (/^ref$/i.test(name)) referenceDefinitions.push({ key: args[0] || "", arguments: args.slice(1), line: lineAt(offsets, match.index) });
    if (/^(mr|zbl|doi|arxiv|isbn)$/i.test(name)) {
      identifiers.push({ scheme: name.toUpperCase(), value: args[0] || "", line: lineAt(offsets, match.index) });
    }
  }

  for (const match of text.matchAll(/<ref\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/ref\s*>)/gi)) {
    const attributes = String(match[1] || "");
    const name = attributes.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i);
    namedReferences.push({
      name: name ? (name[1] || name[2] || name[3] || "") : "",
      attributes: attributes.trim(),
      content: String(match[2] || ""),
      line: lineAt(offsets, match.index),
    });
  }

  return {
    redirectTarget: redirect ? { title: redirect[1].trim(), anchor: String(redirect[2] || "").trim() } : null,
    wikilinks,
    templates,
    citationUses,
    referenceDefinitions,
    namedReferences,
    identifiers,
  };
}

function mergeUnique(existing, incoming, keyOf) {
  const output = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(output.map(keyOf));
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function mergeApiPage(target, page) {
  const output = target || {};
  for (const [key, value] of Object.entries(page || {})) {
    if (!["links", "categories", "templates", "images", "extlinks", "revisions", "protection"].includes(key)) output[key] = value;
  }
  output.links = mergeUnique(output.links, page.links, (item) => `${item.ns}:${item.title}`);
  output.categories = mergeUnique(output.categories, page.categories, (item) => `${item.ns}:${item.title}`);
  output.templates = mergeUnique(output.templates, page.templates, (item) => `${item.ns}:${item.title}`);
  output.images = mergeUnique(output.images, page.images, (item) => `${item.ns}:${item.title}`);
  output.extlinks = mergeUnique(output.extlinks, page.extlinks, (item) => item.url);
  output.revisions = mergeUnique(output.revisions, page.revisions, (item) => String(item.revid || item.parentid || ""));
  output.protection = mergeUnique(output.protection, page.protection, (item) => `${item.type}:${item.level}:${item.expiry}`);
  return output;
}

class MediaWikiClient {
  constructor(options, root) {
    this.api = options.api;
    this.delayMs = options.delayMs;
    this.root = root;
    this.requestCount = 0;
  }

  async request(params, rawPrefix = "request") {
    const url = new URL(this.api);
    const values = {
      action: "query",
      format: "json",
      formatversion: "2",
      utf8: "1",
      maxlag: "5",
      ...params,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        const response = await fetch(url, {
          headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "application/json" },
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timeout);
        const body = await response.text();
        if (response.status === 429 || response.status === 503 || response.status === 504) {
          const retryAfter = Number(response.headers.get("retry-after") || 0);
          throw Object.assign(new Error(`HTTP ${response.status}`), { retryAfter });
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
        const data = JSON.parse(body);
        if (data.error) {
          const apiError = new Error(`MediaWiki API ${data.error.code}: ${data.error.info}`);
          if (data.error.code === "maxlag") apiError.retryAfter = 5;
          throw apiError;
        }
        this.requestCount += 1;
        if (rawPrefix) {
          const rawPath = path.join(this.root, "raw-api", `${safeTitle(rawPrefix, 120)}--${String(this.requestCount).padStart(7, "0")}.json.gz`);
          ensureDir(path.dirname(rawPath));
          atomicWrite(rawPath, zlib.gzipSync(Buffer.from(body, "utf8"), { level: 9 }));
        }
        await sleep(this.delayMs);
        return data;
      } catch (error) {
        lastError = error;
        const retrySeconds = Number(error.retryAfter || 0);
        const wait = Math.max(retrySeconds * 1000, Math.min(60000, 1000 * (2 ** attempt))) + Math.floor(Math.random() * 400);
        appendLog(this.root, `request retry ${attempt + 1}/8 after ${error.message}; waiting ${wait}ms`);
        await sleep(wait);
      }
    }
    throw lastError || new Error("MediaWiki request failed.");
  }

  async siteInfo() {
    return this.request({ meta: "siteinfo", siprop: "general|namespaces|statistics|rightsinfo" }, "siteinfo");
  }

  async inventory(namespace) {
    const pages = [];
    let continuation = {};
    let sequence = 0;
    do {
      const data = await this.request({
        list: "allpages",
        apnamespace: namespace,
        aplimit: "max",
        apdir: "ascending",
        apfilterredir: "all",
        ...continuation,
      }, `inventory-ns-${namespace}-${String(sequence).padStart(4, "0")}`);
      sequence += 1;
      for (const page of data.query?.allpages || []) pages.push(page);
      continuation = data.continue || null;
    } while (continuation);
    return pages;
  }

  async pages(pageIds, batchName) {
    const merged = new Map();
    let continuation = {};
    let sequence = 0;
    do {
      const data = await this.request({
        pageids: pageIds.join("|"),
        prop: "revisions|info|links|categories|templates|images|extlinks",
        inprop: "url|displaytitle|protection",
        rvprop: "ids|timestamp|user|comment|sha1|size|contentmodel|content",
        rvslots: "main",
        pllimit: "max",
        cllimit: "max",
        clprop: "sortkey|timestamp|hidden",
        tllimit: "max",
        imlimit: "max",
        ellimit: "max",
        ...continuation,
      }, `${batchName}-${String(sequence).padStart(3, "0")}`);
      sequence += 1;
      for (const page of data.query?.pages || []) {
        merged.set(Number(page.pageid), mergeApiPage(merged.get(Number(page.pageid)), page));
      }
      continuation = data.continue || null;
    } while (continuation);
    return merged;
  }
}

function revisionContent(revision) {
  return String(revision?.slots?.main?.content ?? revision?.content ?? revision?.["*"] ?? "");
}

function namespaceMap(siteInfo) {
  const entries = Object.values(siteInfo?.query?.namespaces || {});
  return new Map(entries.map((item) => [Number(item.id), item.name || item.canonical || ""]));
}

function persistPage(root, apiPage, namespaceNames) {
  const locations = pagePaths(root, apiPage);
  const revision = (apiPage.revisions || [])[0] || {};
  const source = revisionContent(revision);
  const sourceHash = sha256(Buffer.from(source, "utf8"));
  const extracted = extractSourceRelations(source);
  const archivedAt = new Date().toISOString();
  const metadata = {
    archiveFormat: "wikist-eom-raw-page",
    archiveFormatVersion: FORMAT_VERSION,
    archivedAt,
    sourceSite: "Encyclopedia of Mathematics",
    sourceApi: DEFAULT_API,
    sourceUrl: apiPage.fullurl || `https://encyclopediaofmath.org/wiki/${encodeURIComponent(String(apiPage.title || "").replace(/ /g, "_"))}`,
    pageid: Number(apiPage.pageid),
    namespace: Number(apiPage.ns),
    namespaceName: namespaceNames.get(Number(apiPage.ns)) || "",
    title: apiPage.title,
    displayTitle: apiPage.displaytitle || apiPage.title,
    redirect: Boolean(apiPage.redirect || extracted.redirectTarget),
    redirectTarget: extracted.redirectTarget,
    missing: Boolean(apiPage.missing),
    contentModel: apiPage.contentmodel || revision?.slots?.main?.contentmodel || revision.contentmodel || "wikitext",
    pageLanguage: apiPage.pagelanguage || "en",
    touched: apiPage.touched || "",
    lastRevisionId: Number(apiPage.lastrevid || revision.revid || 0),
    length: Number(apiPage.length || Buffer.byteLength(source, "utf8")),
    protection: apiPage.protection || [],
    revision: {
      revid: Number(revision.revid || 0),
      parentid: Number(revision.parentid || 0),
      timestamp: revision.timestamp || "",
      user: revision.user || "",
      userhidden: Boolean(revision.userhidden),
      comment: revision.comment || "",
      commenthidden: Boolean(revision.commenthidden),
      sha1: revision.sha1 || "",
      sha1hidden: Boolean(revision.sha1hidden),
      size: Number(revision.size || Buffer.byteLength(source, "utf8")),
      contentmodel: revision?.slots?.main?.contentmodel || revision.contentmodel || "wikitext",
      contentformat: revision?.slots?.main?.contentformat || revision.contentformat || "text/x-wiki",
    },
    sourceFile: archiveRelative(root, locations.source),
    metadataFile: archiveRelative(root, locations.metadata),
    relationsFile: archiveRelative(root, locations.relations),
    sourceBytes: Buffer.byteLength(source, "utf8"),
    sourceSha256: sourceHash,
    licenseStatus: "mixed-or-unspecified; retain page and revision notices",
  };
  const relations = {
    archiveFormat: "wikist-eom-page-relations",
    archiveFormatVersion: FORMAT_VERSION,
    pageid: Number(apiPage.pageid),
    namespace: Number(apiPage.ns),
    title: apiPage.title,
    redirectTarget: extracted.redirectTarget,
    resolvedOutgoingLinks: (apiPage.links || []).map((item) => ({ namespace: Number(item.ns), title: item.title })),
    categories: (apiPage.categories || []).map((item) => ({
      namespace: Number(item.ns),
      title: item.title,
      sortkey: item.sortkey || "",
      timestamp: item.timestamp || "",
      hidden: Boolean(item.hidden),
    })),
    transcludedTemplates: (apiPage.templates || []).map((item) => ({ namespace: Number(item.ns), title: item.title })),
    images: (apiPage.images || []).map((item) => ({ namespace: Number(item.ns), title: item.title })),
    externalLinks: (apiPage.extlinks || []).map((item) => item.url),
    sourceWikilinks: extracted.wikilinks,
    sourceTemplates: extracted.templates,
    citationUses: extracted.citationUses,
    referenceDefinitions: extracted.referenceDefinitions,
    namedReferences: extracted.namedReferences,
    identifiers: extracted.identifiers,
  };
  atomicWrite(locations.source, source, "utf8");
  writeJson(locations.metadata, metadata);
  writeJson(locations.relations, relations);
  return { metadata, relations };
}

function loadInventory(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJsonLines(filePath, values) {
  atomicWrite(filePath, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function initialState(options) {
  return {
    archiveFormatVersion: FORMAT_VERSION,
    api: options.api,
    namespaces: options.namespaces,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inventoryComplete: false,
    completedPageIds: [],
    failures: {},
  };
}

function saveState(root, state) {
  state.updatedAt = new Date().toISOString();
  writeJson(path.join(root, "state.json"), state);
}

function readAllMetadata(root, inventory) {
  const values = [];
  for (const page of inventory) {
    const locations = pagePaths(root, page);
    const metadata = readJson(locations.metadata, null);
    if (metadata) values.push(metadata);
  }
  return values;
}

function readRelations(root, metadata) {
  return readJson(path.join(root, metadata.relationsFile), null);
}

function finalizeArchive(root, options, state, siteInfo, inventory, client) {
  const metadata = readAllMetadata(root, inventory);
  const titleIndex = metadata.map((item) => ({
    pageid: item.pageid,
    namespace: item.namespace,
    namespaceName: item.namespaceName,
    title: item.title,
    redirect: item.redirect,
    redirectTarget: item.redirectTarget,
    lastRevisionId: item.lastRevisionId,
    revisionTimestamp: item.revision.timestamp,
    sourceFile: item.sourceFile,
    metadataFile: item.metadataFile,
    relationsFile: item.relationsFile,
    sourceSha256: item.sourceSha256,
  }));
  const redirects = titleIndex.filter((item) => item.redirect);
  const linkEdges = [];
  const citationEdges = [];
  let sourceBytes = 0;
  for (const item of metadata) {
    sourceBytes += Number(item.sourceBytes || 0);
    const relations = readRelations(root, item);
    if (!relations) continue;
    for (const target of relations.resolvedOutgoingLinks || []) {
      linkEdges.push({ fromPageId: item.pageid, fromTitle: item.title, toNamespace: target.namespace, toTitle: target.title });
    }
    for (const cite of relations.citationUses || []) {
      for (const key of cite.keys || []) citationEdges.push({ pageid: item.pageid, title: item.title, key, line: cite.line });
    }
  }
  writeJsonLines(path.join(root, "indexes", "by-title.jsonl"), titleIndex);
  writeJsonLines(path.join(root, "indexes", "redirects.jsonl"), redirects);
  writeJsonLines(path.join(root, "indexes", "internal-links.jsonl"), linkEdges);
  writeJsonLines(path.join(root, "indexes", "citation-uses.jsonl"), citationEdges);
  atomicWrite(path.join(root, "indexes", "source-checksums.sha256"), `${metadata.map((item) => `${item.sourceSha256}  ${item.sourceFile}`).join("\n")}\n`, "utf8");

  const failedCount = Object.keys(state.failures || {}).length;
  const manifest = {
    archiveFormat: "wikist-eom-raw-archive",
    archiveFormatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    complete: metadata.length === inventory.length && failedCount === 0,
    source: {
      site: "Encyclopedia of Mathematics",
      api: options.api,
      namespaces: options.namespaces,
      siteInfo: siteInfo?.query || {},
      robotsNote: "The probed /robots.txt endpoint returned the site HTML rather than a published robots policy.",
      licenseNote: "EoM states that original encyclopedia articles and later wiki contributions may have different rights. No uniform license is inferred by this archive.",
    },
    counts: {
      inventory: inventory.length,
      archived: metadata.length,
      redirects: redirects.length,
      internalLinkEdges: linkEdges.length,
      citationUses: citationEdges.length,
      failed: failedCount,
      apiRequestsThisRun: client.requestCount,
      sourceBytes,
    },
    paths: {
      originalWikitext: "pages/",
      metadata: "metadata/",
      relations: "relations/",
      rawApi: "raw-api/",
      indexes: "indexes/",
      state: "state.json",
    },
  };
  writeJson(path.join(root, "archive.json"), manifest);
  const readme = `# Encyclopedia of Mathematics raw archive\n\n`
    + `Generated: ${manifest.generatedAt}\n\n`
    + `This directory stores the source exactly as returned by the public MediaWiki API. Files under \`pages/\` use the \`.md\` extension for convenient inspection but contain original MediaWiki wikitext, not converted Wikist Markdown. No translation or syntax rewriting has been applied.\n\n`
    + `- Inventory: ${manifest.counts.inventory}\n`
    + `- Archived: ${manifest.counts.archived}\n`
    + `- Redirects: ${manifest.counts.redirects}\n`
    + `- Failures: ${manifest.counts.failed}\n`
    + `- Complete: ${manifest.complete}\n\n`
    + `Metadata and resolved/source-level relationships are stored separately. The archive does not assert a single license for all pages; inspect each page's revision and notices before reuse or publication.\n`;
  atomicWrite(path.join(root, "README.md"), readme, "utf8");
  return manifest;
}

function verifyArchive(root, inventoryOverride = null) {
  const inventory = Array.isArray(inventoryOverride)
    ? inventoryOverride
    : loadInventory(path.join(root, "inventory", "pages.jsonl"));
  const failures = [];
  let verified = 0;
  for (const page of inventory) {
    const locations = pagePaths(root, page);
    const metadata = readJson(locations.metadata, null);
    if (!metadata || !fs.existsSync(locations.source) || !fs.existsSync(locations.relations)) {
      failures.push({ pageid: page.pageid, title: page.title, error: "archive files missing" });
      continue;
    }
    const actual = sha256(fs.readFileSync(locations.source));
    if (actual !== metadata.sourceSha256) failures.push({ pageid: page.pageid, title: page.title, error: "source checksum mismatch" });
    else verified += 1;
  }
  return { ok: failures.length === 0, inventory: inventory.length, verified, failures };
}

async function buildInventory(client, options, root, siteInfo) {
  const inventoryPath = path.join(root, "inventory", "pages.jsonl");
  if (!options.refreshInventory && fs.existsSync(inventoryPath)) return loadInventory(inventoryPath);
  const names = namespaceMap(siteInfo);
  const inventory = [];
  for (const namespace of options.namespaces) {
    appendLog(root, `fetching namespace ${namespace} (${names.get(namespace) || "main"}) inventory`);
    const pages = await client.inventory(namespace);
    appendLog(root, `namespace ${namespace} inventory: ${pages.length} pages`);
    for (const page of pages) inventory.push({ pageid: Number(page.pageid), ns: Number(page.ns), title: page.title, redirect: Boolean(page.redirect) });
  }
  inventory.sort((a, b) => a.ns - b.ns || a.title.localeCompare(b.title, "en"));
  writeJsonLines(inventoryPath, inventory);
  return inventory;
}

async function archive(options) {
  const root = options.output;
  ensureDir(root);
  for (const directory of ["inventory", "pages", "metadata", "relations", "indexes", "raw-api", "logs"]) ensureDir(path.join(root, directory));
  if (options.verifyOnly) {
    const result = verifyArchive(root);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
    return result;
  }

  const statePath = path.join(root, "state.json");
  const state = readJson(statePath, initialState(options));
  if (state.api !== options.api || JSON.stringify(state.namespaces) !== JSON.stringify(options.namespaces)) {
    throw new Error("Existing archive state uses a different API or namespace set. Choose another output directory or matching options.");
  }
  const client = new MediaWikiClient(options, root);
  appendLog(root, `archive start: api=${options.api} output=${root}`);
  const siteInfo = await client.siteInfo();
  writeJson(path.join(root, "siteinfo.json"), siteInfo);
  const inventoryAll = await buildInventory(client, options, root, siteInfo);
  state.inventoryComplete = true;
  saveState(root, state);
  const inventory = options.maxPages ? inventoryAll.slice(0, options.maxPages) : inventoryAll;
  appendLog(root, `selected ${inventory.length}/${inventoryAll.length} pages`);
  if (options.inventoryOnly) {
    const result = { ok: true, inventory: inventoryAll.length, output: root, apiRequests: client.requestCount };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  const namespaceNames = namespaceMap(siteInfo);
  const completed = new Set((state.completedPageIds || []).map(Number));
  const pending = inventory.filter((page) => {
    if (!completed.has(Number(page.pageid))) return true;
    const locations = pagePaths(root, page);
    return !(fs.existsSync(locations.source) && fs.existsSync(locations.metadata) && fs.existsSync(locations.relations));
  });
  appendLog(root, `pending ${pending.length}; already complete ${inventory.length - pending.length}`);

  let processedThisRun = 0;
  for (let offset = 0; offset < pending.length; offset += options.batchSize) {
    const batch = pending.slice(offset, offset + options.batchSize);
    const batchName = `pages-${String(offset).padStart(7, "0")}`;
    try {
      const apiPages = await client.pages(batch.map((page) => page.pageid), batchName);
      for (const item of batch) {
        const page = apiPages.get(Number(item.pageid));
        if (!page) throw new Error(`API omitted page ${item.pageid} (${item.title})`);
        persistPage(root, page, namespaceNames);
        completed.add(Number(item.pageid));
        delete state.failures[String(item.pageid)];
        processedThisRun += 1;
      }
    } catch (error) {
      appendLog(root, `batch ${batchName} failed: ${error.message}; retrying pages individually`);
      for (const item of batch) {
        if (completed.has(Number(item.pageid))) continue;
        try {
          const apiPages = await client.pages([item.pageid], `page-${item.pageid}`);
          const page = apiPages.get(Number(item.pageid));
          if (!page) throw new Error(`API omitted page ${item.pageid}`);
          persistPage(root, page, namespaceNames);
          completed.add(Number(item.pageid));
          delete state.failures[String(item.pageid)];
          processedThisRun += 1;
        } catch (pageError) {
          state.failures[String(item.pageid)] = { title: item.title, error: pageError.message, at: new Date().toISOString() };
          appendLog(root, `page ${item.pageid} (${item.title}) failed: ${pageError.message}`);
        }
      }
    }
    state.completedPageIds = [...completed].sort((a, b) => a - b);
    saveState(root, state);
    const done = inventory.filter((item) => completed.has(Number(item.pageid))).length;
    const percent = inventory.length ? ((done / inventory.length) * 100).toFixed(2) : "100.00";
    writeJson(path.join(root, "progress.json"), {
      updatedAt: new Date().toISOString(),
      selected: inventory.length,
      archived: done,
      pending: Math.max(0, inventory.length - done),
      failed: Object.keys(state.failures || {}).length,
      percent: Number(percent),
      apiRequestsThisRun: client.requestCount,
    });
    appendLog(root, `progress ${done}/${inventory.length} (${percent}%); failures=${Object.keys(state.failures || {}).length}`);
  }

  const manifest = finalizeArchive(root, options, state, siteInfo, inventory, client);
  const verification = verifyArchive(root, inventory);
  writeJson(path.join(root, "verification.json"), { generatedAt: new Date().toISOString(), ...verification });
  appendLog(root, `archive finished: archived=${manifest.counts.archived} failed=${manifest.counts.failed} verified=${verification.verified}`);
  const result = { ok: manifest.complete && verification.ok, output: root, processedThisRun, manifest, verification };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  await archive(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  MediaWikiClient,
  archive,
  extractSourceRelations,
  mergeApiPage,
  pagePaths,
  parseArgs,
  safeTitle,
  sha256,
  verifyArchive,
};
