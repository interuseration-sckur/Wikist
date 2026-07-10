const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const COMPRESSIBLE_TYPES = /^(text\/|application\/(?:javascript|json|xml)|image\/svg\+xml)/i;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error("Invalid JSON request body."));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(res, filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const req = options.req || options.request || null;

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    const headers = {
      "content-type": contentType,
      "last-modified": lastModified,
      "etag": etag,
      "cache-control": options.cacheControl || "public, max-age=3600",
      "x-content-type-options": "nosniff",
    };

    if (isNotModified(req, etag, stat)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const encoding = selectCompression(req, contentType, stat.size, options);
    if (encoding) {
      headers["content-encoding"] = encoding;
      headers.vary = "Accept-Encoding";
    } else {
      headers["content-length"] = stat.size;
    }

    res.writeHead(200, headers);
    if (req?.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    if (encoding === "br") {
      stream.pipe(zlib.createBrotliCompress({
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
      })).pipe(res);
    } else if (encoding === "gzip") {
      stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
    } else {
      stream.pipe(res);
    }
  });
}

function isNotModified(req, etag, stat) {
  if (!req?.headers) return false;
  const ifNoneMatch = String(req.headers["if-none-match"] || "");
  if (ifNoneMatch && (ifNoneMatch === "*" || ifNoneMatch.split(",").map((item) => item.trim()).includes(etag))) {
    return true;
  }
  if (ifNoneMatch) return false;

  const ifModifiedSince = Date.parse(req.headers["if-modified-since"] || "");
  if (!Number.isFinite(ifModifiedSince)) return false;
  return ifModifiedSince >= Math.floor(stat.mtimeMs / 1000) * 1000;
}

function selectCompression(req, contentType, size, options) {
  if (options.compress === false || !req?.headers || req.headers.range) return "";
  if (req.method && req.method !== "GET" && req.method !== "HEAD") return "";
  if (size < (options.compressMinBytes || 1024)) return "";
  if (!COMPRESSIBLE_TYPES.test(contentType)) return "";

  const accepted = String(req.headers["accept-encoding"] || "");
  if (/\bbr\b/i.test(accepted) && typeof zlib.createBrotliCompress === "function") return "br";
  if (/\bgzip\b/i.test(accepted)) return "gzip";
  return "";
}

function safeJoin(baseDir, requestedPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(baseDir, requestedPath.replace(/^[/\\]+/, ""));
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolved;
}

module.exports = {
  readJsonBody,
  safeJoin,
  sendJson,
  sendText,
  serveStatic,
};
