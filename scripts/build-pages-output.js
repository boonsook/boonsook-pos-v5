#!/usr/bin/env node
// Phase 647 pages allowlist r1 — build + verify the Cloudflare Pages static output.
//
// Why: the deploy workflow used to run `wrangler pages deploy .` from the repo
// root, which uploads every file (runbooks *.md, *.sql with production
// identifiers, evidence, scripts) as public static assets. This script copies
// ONLY the exact Git-tracked files listed in scripts/pages-allowlist.txt into a
// fresh output folder (default dist-pages/), byte-for-byte with the same
// relative paths, then verifies the result. Any problem = non-zero exit, so the
// workflow's deploy step never runs.
//
// Pages Functions are NOT copied: Wrangler bundles functions/ from the project
// root (cwd) at deploy time. The output must never contain functions/ source or
// a _worker.js.
//
// Usage:
//   node scripts/build-pages-output.js build  --out dist-pages --report <file outside output>
//   node scripts/build-pages-output.js verify --out dist-pages [--report <file>]
// Options: --root <repo root> (default: parent of scripts/), --allowlist <file>
//          (default: <root>/scripts/pages-allowlist.txt)
//
// Node built-ins only (zero npm deps). Exit codes: 0 ok, 1 check failed, 2 usage.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(__filename), "..");

export class PagesOutputError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "PagesOutputError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new PagesOutputError(code, message); };

// ---------------------------------------------------------------------------
// Deny rules — applied to allowlist entries AND to every file found in output.
// ---------------------------------------------------------------------------
const DENY_EXTENSIONS = new Set([
  ".md", ".markdown", ".sql", ".log", ".patch", ".diff", ".orig", ".rej",
  ".bak", ".tmp", ".env", ".pem", ".key", ".p12", ".pfx", ".crt", ".sqlite",
  ".db", ".zip", ".tar", ".gz", ".har", ".ps1", ".bat", ".cmd", ".sh",
]);
const DENY_TOP_DIRS = new Set([
  "functions", "tests", "scripts", ".git", ".github", ".claude", ".codex",
  "node_modules", "test-results", "playwright-report", "dist-pages",
]);
// Root-level build/config files that are not runtime assets.
const DENY_ROOT_BASENAMES = new Set([
  "package.json", "package-lock.json", "eslint.config.js", "playwright.config.js",
  "dockerfile", "docker-compose.yml", "nginx.conf", "wrangler.toml", "wrangler.json",
  "wrangler.jsonc", "_routes.json",
]);
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** Returns a reason string when the repo-relative POSIX path is forbidden, else null. */
export function denyReason(rel) {
  const segments = rel.split("/");
  const base = segments[segments.length - 1];
  const lowerBase = base.toLowerCase();
  const ext = path.posix.extname(lowerBase);
  if (DENY_EXTENSIONS.has(ext)) return `forbidden extension ${ext}`;
  if (lowerBase.startsWith(".env") || lowerBase.includes(".env.") || lowerBase === ".dev.vars") return "env file";
  if (segments.some((s) => s.startsWith("."))) return "dotfile / dot-directory";
  if (DENY_TOP_DIRS.has(segments[0].toLowerCase())) return `forbidden top-level dir ${segments[0]}/`;
  if (segments.length === 1 && DENY_ROOT_BASENAMES.has(lowerBase)) return `build/config file ${base}`;
  if (lowerBase === "_worker.js") return "_worker.js would override Pages Functions routing";
  if (/(secret|credential|service[-_]?role|private[-_]?key|evidence|screenshot)/i.test(rel)) {
    return "secret/evidence-like name";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Allowlist parsing
// ---------------------------------------------------------------------------
export function parseAllowlist(text, source = "allowlist") {
  const entries = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const where = `${source}:${i + 1}`;
    if (raw !== line) fail("ALLOWLIST_FORMAT", `${where}: leading/trailing whitespace in "${raw}"`);
    if (/[*?[\]{}!]/.test(line)) fail("ALLOWLIST_GLOB", `${where}: globs are not allowed ("${line}")`);
    if (line.includes("\\")) fail("ALLOWLIST_FORMAT", `${where}: use "/" separators ("${line}")`);
    if (line.startsWith("/") || /^[A-Za-z]:/.test(line)) fail("ALLOWLIST_PATH", `${where}: absolute path ("${line}")`);
    if (line.endsWith("/")) fail("ALLOWLIST_DIR", `${where}: directories are not allowed, list each file ("${line}")`);
    for (const s of line.split("/")) {
      if (s === "" || s === "." || s === "..") fail("ALLOWLIST_PATH", `${where}: path escapes or is not normalized ("${line}")`);
      if (!SAFE_SEGMENT.test(s)) fail("ALLOWLIST_PATH", `${where}: unsafe path segment "${s}"`);
    }
    const reason = denyReason(line);
    if (reason) fail("ALLOWLIST_DENIED", `${where}: "${line}" is not allowed (${reason})`);
    const key = line.toLowerCase();
    if (seen.has(key)) fail("ALLOWLIST_DUPLICATE", `${where}: duplicate entry "${line}"`);
    seen.add(key);
    entries.push(line);
  });
  if (entries.length === 0) fail("ALLOWLIST_EMPTY", `${source}: no entries`);
  return entries.sort();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], {
    input, maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Map of tracked path -> { mode, blob, stage } from the Git index. */
function trackedIndex(root) {
  const out = git(root, ["ls-files", "-s", "-z"]).toString("utf8");
  const map = new Map();
  for (const rec of out.split("\0")) {
    const m = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t([\s\S]+)$/.exec(rec);
    if (m) map.set(m[4], { mode: m[1], blob: m[2], stage: m[3] });
  }
  return map;
}

function isInside(child, parent) {
  const r = path.relative(parent, child);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

/** Throws if any component of rel (under base) is a symlink/junction or resolves outside base. */
function assertNoLinks(base, rel, code) {
  let cur = base;
  for (const seg of rel.split("/")) {
    cur = path.join(cur, seg);
    if (fs.lstatSync(cur).isSymbolicLink()) {
      fail(code, `symlink/junction in path: ${rel} (at ${path.relative(base, cur).split(path.sep).join("/")})`);
    }
  }
  if (!isInside(fs.realpathSync.native(cur), fs.realpathSync.native(base))) fail(code, `path resolves outside root: ${rel}`);
}

function listOutputFiles(outDir) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) fail("OUTPUT_SYMLINK", `symlink/junction in output: ${rel}`);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile()) files.push(rel);
      else fail("OUTPUT_SPECIAL", `non-regular file in output: ${rel}`);
    }
  };
  walk(outDir, "");
  return files.sort();
}

// Detects privileged secret material inside a text asset (public anon JWT is allowed).
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
export function findPrivilegedSecrets(text) {
  const hits = [];
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) hits.push("sb_secret_ key");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push("PEM private key");
  for (const m of text.matchAll(JWT_RE)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload && typeof payload === "object" && payload.role && payload.role !== "anon") hits.push(`JWT role=${payload.role}`);
    } catch { /* not a JWT payload */ }
  }
  return hits;
}

const TEXT_EXT = new Set([".js", ".mjs", ".html", ".css", ".json", ".svg", ".txt", ""]);

// ---------------------------------------------------------------------------
// Resolve paths / options
// ---------------------------------------------------------------------------
function resolveContext({ root = DEFAULT_ROOT, allowlist, out, report } = {}) {
  if (!out) fail("USAGE", "--out is required");
  const absRoot = fs.realpathSync.native(path.resolve(root));
  const allowFile = path.resolve(absRoot, allowlist || path.join("scripts", "pages-allowlist.txt"));
  const absOut = path.resolve(absRoot, out);
  if (isInside(absRoot, absOut)) fail("OUTPUT_PATH", `output ${absOut} is the repo root or one of its parents`);
  for (const top of [".git", ".github", "functions", "modules", "icons", "data", "scripts", "tests"]) {
    if (isInside(absOut, path.join(absRoot, top))) fail("OUTPUT_PATH", `output ${absOut} is inside ${top}/`);
  }
  const absReport = report ? path.resolve(absRoot, report) : null;
  if (absReport && isInside(absReport, absOut)) fail("REPORT_PATH", `report ${absReport} must be outside the output folder`);
  return { absRoot, allowFile, absOut, absReport };
}

/** Collects the approved source set: [{ rel, abs, blob, size, sha256 }]. Fails closed. */
export function collectSources({ root, allowlist } = {}) {
  const absRoot = fs.realpathSync.native(path.resolve(root || DEFAULT_ROOT));
  const allowFile = path.resolve(absRoot, allowlist || path.join("scripts", "pages-allowlist.txt"));
  const label = path.relative(absRoot, allowFile).split(path.sep).join("/") || allowFile;
  const entries = parseAllowlist(fs.readFileSync(allowFile, "utf8"), label);
  const index = trackedIndex(absRoot);
  const missing = [];
  const sources = [];
  for (const rel of entries) {
    const info = index.get(rel);
    if (!info) { missing.push(`${rel} (not tracked by Git)`); continue; }
    if (info.stage !== "0") fail("SOURCE_CONFLICT", `${rel} has an unmerged index entry`);
    if (info.mode === "120000") fail("SOURCE_SYMLINK", `${rel} is a symlink in Git`);
    if (info.mode !== "100644" && info.mode !== "100755") fail("SOURCE_MODE", `${rel} has unsupported Git mode ${info.mode}`);
    const abs = path.join(absRoot, ...rel.split("/"));
    let exists = true;
    try { fs.lstatSync(abs); } catch { exists = false; }
    if (!exists) {
      // A dangling link in a parent still counts as a link, not a missing file.
      let cur = absRoot;
      for (const seg of rel.split("/").slice(0, -1)) {
        cur = path.join(cur, seg);
        try { if (fs.lstatSync(cur).isSymbolicLink()) fail("SOURCE_SYMLINK", `symlink/junction in path: ${rel}`); } catch (e) { if (e instanceof PagesOutputError) throw e; break; }
      }
      missing.push(`${rel} (missing on disk)`);
      continue;
    }
    assertNoLinks(absRoot, rel, "SOURCE_SYMLINK");
    if (!fs.lstatSync(abs).isFile()) fail("SOURCE_TYPE", `${rel} is not a regular file`);
    sources.push({ rel, abs, blob: info.blob });
  }
  if (missing.length) fail("SOURCE_MISSING", `required allowlisted file(s) missing:\n  ${missing.join("\n  ")}`);
  // Working tree must equal the indexed blob, so local edits never slip into a deploy.
  const hashed = git(absRoot, ["hash-object", "--stdin-paths"], sources.map((s) => s.rel).join("\n") + "\n")
    .toString("utf8").trim().split(/\r?\n/);
  sources.forEach((s, i) => {
    if (hashed[i] !== s.blob) fail("SOURCE_DIRTY", `${s.rel} differs from the Git index (working tree ${hashed[i]} != index ${s.blob})`);
    const buf = fs.readFileSync(s.abs);
    s.size = buf.length;
    s.sha256 = sha256(buf);
  });
  return sources;
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
export function verifyOutput(opts) {
  const { absRoot, allowFile, absOut, absReport } = resolveContext(opts);
  const sources = collectSources({ root: absRoot, allowlist: allowFile });
  let outSt;
  try { outSt = fs.lstatSync(absOut); } catch { fail("OUTPUT_MISSING", `output folder not found: ${absOut}`); }
  if (outSt.isSymbolicLink() || !outSt.isDirectory()) fail("OUTPUT_SYMLINK", `output must be a real directory: ${absOut}`);
  const actual = listOutputFiles(absOut);
  const expected = new Map(sources.map((s) => [s.rel, s]));
  const extra = actual.filter((rel) => !expected.has(rel));
  if (extra.length) {
    const detail = extra.map((rel) => `${rel}${denyReason(rel) ? ` [${denyReason(rel)}]` : ""}`);
    fail("OUTPUT_EXTRA", `file(s) in output outside the allowlist:\n  ${detail.join("\n  ")}`);
  }
  const actualSet = new Set(actual);
  const absent = [...expected.keys()].filter((rel) => !actualSet.has(rel));
  if (absent.length) fail("OUTPUT_MISSING_FILE", `allowlisted file(s) missing from output:\n  ${absent.join("\n  ")}`);
  const files = [];
  for (const rel of actual) {
    const reason = denyReason(rel);
    if (reason) fail("OUTPUT_DENIED", `${rel} must never be deployed (${reason})`);
    const buf = fs.readFileSync(path.join(absOut, ...rel.split("/")));
    const digest = sha256(buf);
    const src = expected.get(rel);
    if (digest !== src.sha256 || buf.length !== src.size) {
      fail("OUTPUT_HASH", `${rel} bytes differ from approved source (out ${digest} != src ${src.sha256})`);
    }
    if (TEXT_EXT.has(path.posix.extname(rel).toLowerCase())) {
      const hits = findPrivilegedSecrets(buf.toString("utf8"));
      if (hits.length) fail("OUTPUT_SECRET", `${rel} contains privileged secret material: ${hits.join(", ")}`);
    }
    files.push({ path: rel, size: buf.length, sha256: digest, git_blob: src.blob });
  }
  const result = {
    ok: true,
    output: absOut,
    allowlist: path.relative(absRoot, allowFile).split(path.sep).join("/"),
    allowlist_sha256: sha256(fs.readFileSync(allowFile)),
    file_count: files.length,
    total_bytes: files.reduce((n, f) => n + f.size, 0),
    files,
  };
  if (absReport) {
    fs.mkdirSync(path.dirname(absReport), { recursive: true });
    fs.writeFileSync(absReport, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
export function buildOutput(opts) {
  const { absRoot, allowFile, absOut } = resolveContext(opts);
  const sources = collectSources({ root: absRoot, allowlist: allowFile });
  let st = null;
  try { st = fs.lstatSync(absOut); } catch { /* does not exist */ }
  if (st) {
    if (st.isSymbolicLink() || !st.isDirectory()) fail("OUTPUT_EXISTS", `output path exists and is not a plain directory: ${absOut}`);
    if (fs.readdirSync(absOut).length > 0) {
      fail("OUTPUT_NOT_EMPTY", `output folder already has content (refusing to reuse or clean an unverified folder): ${absOut}`);
    }
  } else {
    fs.mkdirSync(absOut, { recursive: true });
  }
  for (const s of sources) {
    const dest = path.join(absOut, ...s.rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(s.abs, dest, fs.constants.COPYFILE_EXCL);
  }
  return verifyOutput(opts);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const m = /^--(root|allowlist|out|report)(?:=(.*))?$/.exec(rest[i]);
    if (!m) throw new PagesOutputError("USAGE", `unknown argument ${rest[i]}`);
    const val = m[2] !== undefined ? m[2] : rest[++i];
    if (val === undefined || val === "") throw new PagesOutputError("USAGE", `--${m[1]} needs a value`);
    opts[m[1]] = val;
  }
  return { cmd, opts };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    if (parsed.cmd !== "build" && parsed.cmd !== "verify") throw new PagesOutputError("USAGE", "command must be build or verify");
  } catch (e) {
    console.error(`pages-output: ${e.message}`);
    console.error("usage: node scripts/build-pages-output.js <build|verify> --out <dir> [--report <file>] [--root <dir>] [--allowlist <file>]");
    process.exit(2);
  }
  try {
    const res = parsed.cmd === "build" ? buildOutput(parsed.opts) : verifyOutput(parsed.opts);
    console.log(`pages-output ${parsed.cmd} OK: ${res.file_count} files, ${res.total_bytes} bytes -> ${res.output}`);
    console.log(`allowlist ${res.allowlist} sha256 ${res.allowlist_sha256}`);
  } catch (e) {
    console.error(`pages-output ${parsed.cmd} FAILED: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
