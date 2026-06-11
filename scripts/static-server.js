// Minimal cross-platform static file server for Playwright e2e smoke tests.
//
// Phase 90.5: replaces `python3 -m http.server` which required Python in PATH.
// Some Windows machines (incl. the maintainer's) ship Python only as a
// Microsoft Store stub that opens the Store instead of running, so the
// previous webServer command failed before any tests could run.
//
// Zero new npm deps — uses Node built-ins only (http, fs, path, url).
//
// Usage:
//   node scripts/static-server.js              # default port 4173
//   node scripts/static-server.js 8080         # custom port
//   PORT=4173 node scripts/static-server.js    # via env var
//
// Behavior intentionally mirrors `python3 -m http.server` to keep tests stable:
//   - Serves files from the project root (cwd of the script's parent dir)
//   - `/` -> `/index.html`
//   - Refuses path traversal outside the project root
//   - Sets sensible Content-Type for the file types our smoke tests touch
//     (especially `application/javascript` for .js — main.js test asserts this)
//   - No directory listing (smoke tests fetch known paths only)
//   - Cache-Control: no-store so dev/test never sees stale responses

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const IDLE_EXIT_MS = Number(
  process.argv.find(arg => arg.startsWith("--idle-exit-ms="))?.split("=")[1] ||
  process.env.IDLE_EXIT_MS ||
  0
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt":  "text/plain; charset=utf-8",
  ".map":  "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (MIME[ext]) return MIME[ext];
  // Extensionless files (e.g. /_headers) — Cloudflare-Pages style config files.
  // text/plain so .text() works in tests and humans browsing won't get a download.
  if (!ext) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  resetIdleExitTimer();

  // Strip query string + decode percent-encoding
  let urlPath = "/";
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";

  // Resolve against root + refuse path traversal
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypeFor(filePath));
    res.setHeader("Cache-Control", "no-store");
    const stream = fs.createReadStream(filePath);
    stream.on("error", (streamErr) => {
      console.error(`[static-server] read error for ${urlPath}:`, streamErr.message);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[static-server] serving ${ROOT} on http://127.0.0.1:${PORT}`);
  resetIdleExitTimer();
});

// Graceful shutdown so Playwright's teardown doesn't leave a zombie.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1000).unref();
}

let idleExitTimer = null;
function resetIdleExitTimer() {
  if (!IDLE_EXIT_MS || shuttingDown) return;
  clearTimeout(idleExitTimer);
  idleExitTimer = setTimeout(shutdown, IDLE_EXIT_MS);
  idleExitTimer.unref?.();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, shutdown);
}
