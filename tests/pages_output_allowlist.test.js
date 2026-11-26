// Phase 647 pages allowlist r1 — guard for scripts/build-pages-output.js + scripts/pages-allowlist.txt.
//
// Invariants:
//  - deploy uploads ONLY the exact allowlisted Git-tracked files (byte-identical, same paths)
//  - *.md / *.sql (any case), evidence, scripts, tests, functions source never reach the output
//  - every local file the app references (HTML/manifest/SW/CSS/JS imports) is allowlisted
//  - missing file / stale or extra output file / symlink / dirty source / secret = fail before deploy
//  - workflow builds + verifies dist-pages before `pages deploy dist-pages`, Wrangler from repo root
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildOutput, verifyOutput, parseAllowlist, collectSources, findPrivilegedSecrets, denyReason, PagesOutputError,
} from "../scripts/build-pages-output.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "build-pages-output.js");
const ALLOWLIST = path.join(ROOT, "scripts", "pages-allowlist.txt");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pages-${tag}-`));
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
}

/** Minimal synthetic repo: index.html + icons/app.png + modules/a.js + allowlist. */
function fixtureRepo({ extraTracked = {} } = {}) {
  const dir = tmpDir("repo");
  git(dir, "init", "-q");
  const files = {
    "index.html": "<!doctype html><script type=module src=./modules/a.js></script>\n",
    "icons/app.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
    "modules/a.js": "export const a = 1;\n",
    "scripts/pages-allowlist.txt": "# fixture\nindex.html\nicons/app.png\nmodules/a.js\n",
    ...extraTracked,
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  return dir;
}

const expectCode = (fn, code) => assert.throws(fn, (e) => e instanceof PagesOutputError && e.code === code, `expected ${code}`);

// ---------------------------------------------------------------------------
// Real repository
// ---------------------------------------------------------------------------
test("real repo: build copies exactly the allowlist, byte-identical, report outside output", () => {
  const work = tmpDir("real");
  const out = path.join(work, "out");
  const report = path.join(work, "report.json");
  const res = buildOutput({ root: ROOT, out, report });
  const entries = parseAllowlist(fs.readFileSync(ALLOWLIST, "utf8"));
  assert.deepEqual(res.files.map((f) => f.path), entries);
  for (const f of res.files) {
    const src = fs.readFileSync(path.join(ROOT, ...f.path.split("/")));
    const dst = fs.readFileSync(path.join(out, ...f.path.split("/")));
    assert.equal(sha256(dst), sha256(src), f.path);
    assert.equal(f.sha256, sha256(src));
  }
  assert.ok(fs.existsSync(report), "report written");
  assert.ok(!fs.existsSync(path.join(out, "report.json")));
  for (const required of ["index.html", "offline.html", "share.html", "manifest.json", "sw.js", "_headers",
    "main.js", "boot.js", "selfheal.js", "supabase-config.js", "style.css", "data/ac_catalog.json", "icons/logo.svg"]) {
    assert.ok(entries.includes(required), `${required} allowlisted`);
  }
  const all = res.files.map((f) => f.path);
  assert.ok(!all.some((p) => /\.(md|sql)$/i.test(p)), "no md/sql");
  assert.ok(!all.some((p) => /^(functions|tests|scripts|\.github|\.git)\//.test(p)), "no source dirs");
  assert.ok(!all.includes("_worker.js") && !all.includes("_routes.json"));
  fs.rmSync(work, { recursive: true, force: true });
});

test("real repo: every tracked *.md / *.sql / functions file is excluded by the allowlist", () => {
  const entries = new Set(parseAllowlist(fs.readFileSync(ALLOWLIST, "utf8")));
  const tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const sensitive = tracked.filter((p) => /\.(md|sql)$/i.test(p) || /^(functions|tests|scripts|\.github)\//.test(p));
  assert.ok(sensitive.length > 50, "repo has many sensitive tracked files (sanity)");
  for (const p of sensitive) assert.ok(!entries.has(p), `${p} must not be allowlisted`);
});

/** Collects local file references reachable from the runtime entry points. */
function referencedFiles() {
  const entryPoints = ["index.html", "offline.html", "share.html", "manifest.json", "sw.js"];
  const seen = new Set();
  const unresolved = new Set();
  const denied = new Set();
  const queue = [...entryPoints];
  const REF = /["'`(]((?:\.{1,2}\/|\/)?[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:js|css|html|json|png|svg|ico|webp|jpg))(?:\?[^"'`)\s]*)?["'`)]/g;
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");
    for (const m of text.matchAll(REF)) {
      const ref = m[1];
      if (ref.startsWith("//")) continue;
      const candidates = ref.startsWith("/")
        ? [ref.slice(1)]
        : [path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref)), path.posix.normalize(ref)];
      const hit = candidates.find((c) => !c.startsWith("..") && fs.existsSync(path.join(ROOT, ...c.split("/")))
        && fs.statSync(path.join(ROOT, ...c.split("/"))).isFile());
      if (!hit) { unresolved.add(ref); continue; }
      // e.g. "see tests/x_guard.test.js" in a code comment: never deployable, never fetched.
      if (denyReason(hit)) { denied.add(`${rel} -> ${hit}`); continue; }
      if (/\.(js|css|html|json)$/.test(hit)) queue.push(hit); else seen.add(hit);
    }
  }
  return { seen, unresolved, denied };
}

test("real repo: every runtime-referenced local file (imports, lazy imports, CSS, manifest icons, SW precache) is allowlisted", () => {
  const entries = new Set(parseAllowlist(fs.readFileSync(ALLOWLIST, "utf8")));
  const { seen, denied } = referencedFiles();
  for (const d of denied) assert.match(d, / -> tests\/[\w.-]+\.test\.js$/, `only comment refs to tests/ may be skipped: ${d}`);
  const missing = [...seen].filter((p) => !entries.has(p));
  assert.deepEqual(missing, [], `referenced but not allowlisted: ${missing.join(", ")}`);
  for (const p of ["modules/time_clock.js", "modules/_offline_queue.js", "icons/icon-maskable-512x512.png", "phase4-components.css"]) {
    assert.ok(seen.has(p), `scanner reaches ${p}`);
  }
});

test("real repo: sw.js PRECACHE_URLS and manifest icons all resolve to allowlisted files", () => {
  const entries = new Set(parseAllowlist(fs.readFileSync(ALLOWLIST, "utf8")));
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const block = /const PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw)[1];
  const urls = [...block.matchAll(/'\.\/([^'?]*)/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(urls.length >= 10);
  for (const u of urls) assert.ok(entries.has(u), `precache ${u}`);
  assert.ok(entries.has(/const OFFLINE_PAGE = '\.\/([^']+)'/.exec(sw)[1]));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  for (const icon of manifest.icons) assert.ok(entries.has(icon.src.replace(/^\.\//, "")), icon.src);
  assert.ok(entries.has(manifest.start_url.replace(/^\.\//, "")));
});

// ---------------------------------------------------------------------------
// Allowlist format
// ---------------------------------------------------------------------------
test("allowlist rejects globs, directories, traversal, md/sql (any case), dotfiles, functions/scripts/tests, duplicates", () => {
  const bad = {
    "modules/*.js": "ALLOWLIST_GLOB",
    "icons/": "ALLOWLIST_DIR",
    "../secret.js": "ALLOWLIST_PATH",
    "/index.html": "ALLOWLIST_PATH",
    "modules/../x.js": "ALLOWLIST_PATH",
    "HANDOFF.md": "ALLOWLIST_DENIED",
    "notes.MD": "ALLOWLIST_DENIED",
    "supabase-phase647-x.Sql": "ALLOWLIST_DENIED",
    ".env.example": "ALLOWLIST_PATH",
    "config/.env.local": "ALLOWLIST_PATH",
    "functions/_middleware.js": "ALLOWLIST_DENIED",
    "scripts/static-server.js": "ALLOWLIST_DENIED",
    "tests/a.test.js": "ALLOWLIST_DENIED",
    "package.json": "ALLOWLIST_DENIED",
    "_worker.js": "ALLOWLIST_DENIED",
    "icons/evidence-c4.png": "ALLOWLIST_DENIED",
    "run.log": "ALLOWLIST_DENIED",
    "fix.patch": "ALLOWLIST_DENIED",
  };
  for (const [line, code] of Object.entries(bad)) expectCode(() => parseAllowlist(`${line}\n`), code);
  expectCode(() => parseAllowlist("a.js\nA.js\n"), "ALLOWLIST_DUPLICATE");
  expectCode(() => parseAllowlist("# only comments\n\n"), "ALLOWLIST_EMPTY");
  expectCode(() => parseAllowlist(" a.js\n"), "ALLOWLIST_FORMAT");
  assert.deepEqual(parseAllowlist("# c\nb.js\r\n\na/x.css\n"), ["a/x.css", "b.js"]);
});

// ---------------------------------------------------------------------------
// Source side (synthetic Git repo)
// ---------------------------------------------------------------------------
test("source: tracked .md / .sql / evidence .png under icons/ that are not listed never reach the output", () => {
  const repo = fixtureRepo({
    extraTracked: {
      "RUNBOOK.md": "project ref xyz\n",
      "icons/NOTES.Md": "x\n",
      "phase647-postcheck.sql": "select 1;\n",
      "icons/c4-evidence-screenshot.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]),
      "icons/extra.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 7]),
    },
  });
  const out = path.join(tmpDir("out"), "dist");
  const res = buildOutput({ root: repo, out });
  assert.deepEqual(res.files.map((f) => f.path), ["icons/app.png", "index.html", "modules/a.js"]);
  const actual = [];
  const walk = (d, p) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) =>
    (e.isDirectory() ? walk(path.join(d, e.name), `${p}${e.name}/`) : actual.push(`${p}${e.name}`)));
  walk(out, "");
  assert.deepEqual(actual.sort(), ["icons/app.png", "index.html", "modules/a.js"]);
});

test("source: a required allowlisted file that is missing fails (not tracked / deleted on disk)", () => {
  const repo = fixtureRepo();
  fs.appendFileSync(path.join(repo, "scripts", "pages-allowlist.txt"), "offline.html\n");
  expectCode(() => buildOutput({ root: repo, out: path.join(tmpDir("o"), "d") }), "SOURCE_MISSING");
  const repo2 = fixtureRepo();
  fs.rmSync(path.join(repo2, "modules", "a.js"));
  const out2 = path.join(tmpDir("o"), "d");
  expectCode(() => buildOutput({ root: repo2, out: out2 }), "SOURCE_MISSING");
  assert.ok(!fs.existsSync(out2), "nothing written when sources fail");
});

test("source: untracked allowlisted file and dirty tracked file both fail", () => {
  const repo = fixtureRepo();
  fs.writeFileSync(path.join(repo, "new.js"), "x\n");
  fs.appendFileSync(path.join(repo, "scripts", "pages-allowlist.txt"), "new.js\n");
  expectCode(() => collectSources({ root: repo }), "SOURCE_MISSING");
  const repo2 = fixtureRepo();
  fs.appendFileSync(path.join(repo2, "modules", "a.js"), "// local edit\n");
  expectCode(() => collectSources({ root: repo2 }), "SOURCE_DIRTY");
});

test("source: symlink / junction in a copied path fails", () => {
  const repo = fixtureRepo();
  const real = path.join(repo, "modules-real");
  fs.renameSync(path.join(repo, "modules"), real);
  try {
    fs.symlinkSync(real, path.join(repo, "modules"), "junction");
  } catch (e) {
    // Platform without symlink permission: record and skip rather than pass silently.
    assert.ok(/EPERM|EACCES/.test(e.code), e.message);
    return;
  }
  expectCode(() => buildOutput({ root: repo, out: path.join(tmpDir("o"), "d") }), "SOURCE_SYMLINK");
});

// ---------------------------------------------------------------------------
// Output side
// ---------------------------------------------------------------------------
test("output: pre-existing non-empty folder is refused (no reuse of stale output)", () => {
  const repo = fixtureRepo();
  const out = path.join(tmpDir("o"), "d");
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "stale.js"), "old\n");
  expectCode(() => buildOutput({ root: repo, out }), "OUTPUT_NOT_EMPTY");
  assert.ok(fs.existsSync(path.join(out, "stale.js")), "existing folder is not cleaned/deleted");
  const empty = path.join(tmpDir("o"), "e");
  fs.mkdirSync(empty);
  assert.equal(buildOutput({ root: repo, out: empty }).file_count, 3, "empty pre-created folder is OK");
});

test("output: stale / extra / tampered / removed files are caught by verify before deploy", () => {
  const repo = fixtureRepo();
  const out = path.join(tmpDir("o"), "d");
  buildOutput({ root: repo, out });
  const cases = [
    ["RUNBOOK.md", "OUTPUT_EXTRA"],
    ["icons/leftover.png", "OUTPUT_EXTRA"],
    ["_worker.js", "OUTPUT_EXTRA"],
    ["functions/_middleware.js", "OUTPUT_EXTRA"],
  ];
  for (const [rel, code] of cases) {
    const abs = path.join(out, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x\n");
    expectCode(() => verifyOutput({ root: repo, out }), code);
    fs.rmSync(abs);
  }
  fs.rmSync(path.join(out, "functions"), { recursive: true, force: true });
  verifyOutput({ root: repo, out });
  fs.appendFileSync(path.join(out, "modules", "a.js"), "tampered\n");
  expectCode(() => verifyOutput({ root: repo, out }), "OUTPUT_HASH");
  fs.rmSync(path.join(out, "modules", "a.js"));
  expectCode(() => verifyOutput({ root: repo, out }), "OUTPUT_MISSING_FILE");
});

test("output/report paths: refuses repo root, source dirs, and report inside output", () => {
  const repo = fixtureRepo();
  expectCode(() => buildOutput({ root: repo, out: "." }), "OUTPUT_PATH");
  expectCode(() => buildOutput({ root: repo, out: "modules/out" }), "OUTPUT_PATH");
  expectCode(() => buildOutput({ root: repo, out: "dist", report: "dist/report.json" }), "REPORT_PATH");
});

test("secret scan: privileged JWT / sb_secret / PEM detected, public anon JWT allowed", () => {
  const jwt = (payload) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "c2lnbmF0dXJlc2ln"].join(".");
  assert.deepEqual(findPrivilegedSecrets(`const k = "${jwt({ role: "anon", iss: "supabase" })}";`), []);
  assert.deepEqual(findPrivilegedSecrets(`k="${jwt({ role: "service_role" })}"`), ["JWT role=service_role"]);
  assert.deepEqual(findPrivilegedSecrets("x=sb_secret_abcdefghijklmnop"), ["sb_secret_ key"]);
  const repo = fixtureRepo({ extraTracked: { "modules/a.js": `export const k = "${jwt({ role: "service_role" })}";\n` } });
  expectCode(() => buildOutput({ root: repo, out: path.join(tmpDir("o"), "d") }), "OUTPUT_SECRET");
});

test("CLI: exit 0 on success, 1 on check failure, 2 on usage error", () => {
  const repo = fixtureRepo();
  const out = path.join(tmpDir("o"), "d");
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  assert.equal(run("build", "--root", repo, "--out", out).status, 0);
  assert.equal(run("verify", "--root", repo, "--out", out).status, 0);
  fs.writeFileSync(path.join(out, "x.sql"), "select 1;\n");
  const r = run("verify", "--root", repo, "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /OUTPUT_EXTRA/);
  assert.equal(run("deploy", "--out", out).status, 2);
  assert.equal(run("build").status, 1);
});

// ---------------------------------------------------------------------------
// Workflow wiring
// ---------------------------------------------------------------------------
test("workflow: build + verify dist-pages before deploy; deploy dist-pages from repo root; triggers unchanged", () => {
  const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "main.yml"), "utf8");
  assert.match(wf, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/m);
  const iBuild = wf.indexOf("node scripts/build-pages-output.js build --out dist-pages");
  const iVerify = wf.indexOf("node scripts/build-pages-output.js verify --out dist-pages");
  const iDeploy = wf.indexOf("command: pages deploy dist-pages --project-name=boonsook-pos-v5 ");
  assert.ok(iBuild > 0 && iVerify > iBuild && iDeploy > iVerify, "build -> verify -> deploy order");
  assert.ok(!/pages deploy \.(\s|$)/.test(wf), "no root deploy");
  assert.ok(!/continue-on-error/.test(wf), "a failing gate must stop the job");
  const deployStep = wf.slice(wf.lastIndexOf("- name:", iDeploy), iDeploy);
  assert.ok(!/working-directory|workingDirectory/.test(deployStep), "Wrangler runs from repo root (finds functions/)");
  assert.match(wf, /docker:\n {4}runs-on: ubuntu-latest\n {4}name: Build Docker Image\n {4}needs: deploy/);
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^dist-pages\/$/m);
});
