// Phase 628A — document item_type schema foundation (schema + tests only)
// Run: node --test tests/phase628a_document_item_type_schema.test.js
//
// Guards the owner-run migration supabase-phase628a-document-item-type-schema.sql:
//   - additive item_type text NOT NULL DEFAULT 'item' + exact CHECK (item|heading)
//     on exactly quotation_items / delivery_invoice_items / receipt_items
//   - legacy rows backfilled as 'item' only; never infer heading from money/product fields
//   - no data/RLS/trigger/policy changes; post-checks A (definition) + B (counts) present
//
// Every rule is scoped to a parsed block of the SQL (transaction, DO block, FOREACH loop,
// EXECUTE format() calls, post-check A, post-check B) — never a whole-file word count.
// Each rule has a positive control: an in-memory single-defect mutant that must trip it.
// The SQL is loaded lazily so a missing file fails every test with "missing artifact"
// (assertion), instead of crashing at module load.
//
// No PostgreSQL parser / live execution here: the SQL is owner-run after independent review.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SQL_FILE = "supabase-phase628a-document-item-type-schema.sql";
const SQL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", SQL_FILE);

const TARGET_TABLES = ["delivery_invoice_items", "quotation_items", "receipt_items"];
const ALLOWED_VALUES = ["item", "heading"];
const CANONICAL_NAME_ARG = "target_table || '_item_type_check'";
const FORBIDDEN_COLUMNS = [
  "qty", "unit_price", "discount_pct", "line_total", "product_id", "sort_order",
  "quotation_id", "delivery_invoice_id", "receipt_id",
];

// The only DDL/DML the per-table loop may run, in this order (deny-by-default surface).
const EXPECTED_LOOP_FORMATS = [
  { template: "ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS item_type text", args: ["target_table"] },
  { template: "UPDATE public.%I SET item_type = %L WHERE item_type IS NULL", args: ["target_table", "'item'"] },
  { template: "ALTER TABLE public.%I ALTER COLUMN item_type SET DEFAULT %L", args: ["target_table", "'item'"] },
  { template: "ALTER TABLE public.%I ALTER COLUMN item_type SET NOT NULL", args: ["target_table"] },
  { template: "ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I", args: ["target_table", CANONICAL_NAME_ARG] },
  {
    template: "ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (item_type IN (%L, %L))",
    args: ["target_table", CANONICAL_NAME_ARG, "'item'", "'heading'"],
  },
];

function loadSql() {
  assert.ok(fs.existsSync(SQL_PATH), `missing artifact: ${SQL_FILE}`);
  return fs.readFileSync(SQL_PATH, "utf8");
}

// ── Lexing helpers (quote-aware; no throws — rules report problems instead) ──────────

// Remove `-- ...` comments outside single/double quoted text. Newlines are kept.
function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) { j += 2; continue; }
        if (sql[j] === ch) break;
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// All single-quoted literals, raw (with quotes).
function singleQuotedLiterals(code) {
  const lits = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] === "'") {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "'" && code[j + 1] === "'") { j += 2; continue; }
        if (code[j] === "'") break;
        j++;
      }
      lits.push(code.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    i++;
  }
  return lits;
}

// Index of the ")" closing the "(" at openIdx; -1 if unbalanced.
function matchParen(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    const ch = code[i];
    if (ch === "'") {
      i++;
      while (i < code.length && !(code[i] === "'" && code[i + 1] !== "'")) {
        if (code[i] === "'" && code[i + 1] === "'") i++;
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") break;
        j++;
      }
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function unquote(lit) {
  return /^'[\s\S]*'$/.test(lit) ? lit.slice(1, -1).replace(/''/g, "'") : null;
}

function count(text, re) {
  return (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
}

// Every `EXECUTE format(...)` in `code`, parsed into { index, template, args }.
function executeFormats(code) {
  const calls = [];
  const re = /EXECUTE\s+format\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(code, open);
    if (close < 0) { calls.push({ index: m.index, template: null, args: [] }); continue; }
    const parts = splitTopLevelCommas(code.slice(open + 1, close));
    calls.push({ index: m.index, template: unquote(parts[0] || ""), args: parts.slice(1) });
  }
  return calls;
}

// ── Structure ────────────────────────────────────────────────────────────────

function parse(sql) {
  const code = stripComments(sql);
  const problems = [];

  const beginLines = [...code.matchAll(/^BEGIN;[ \t]*$/gm)];
  const commitLines = [...code.matchAll(/^COMMIT;[ \t]*$/gm)];
  const beginIdx = beginLines.length === 1 ? beginLines[0].index : -1;
  const commitIdx = commitLines.length === 1 ? commitLines[0].index : -1;

  const doMatches = [...code.matchAll(/DO \$phase628a\$([\s\S]*?)\$phase628a\$;/g)];
  const doBlock = doMatches.length === 1 ? doMatches[0][1] : null;
  const doIdx = doMatches.length === 1 ? doMatches[0].index : -1;
  if (doMatches.length !== 1) problems.push(`expected exactly 1 DO $phase628a$ block, found ${doMatches.length}`);

  let arrayItems = null;
  let loopBody = null;
  if (doBlock) {
    const lm = [...doBlock.matchAll(/FOREACH target_table IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP([\s\S]*?)END LOOP;/g)];
    if (lm.length === 1) {
      arrayItems = splitTopLevelCommas(lm[0][1]);
      loopBody = lm[0][2];
    } else {
      problems.push(`expected exactly 1 FOREACH target_table loop, found ${lm.length}`);
    }
  }

  const aMarks = [...sql.matchAll(/^-- POST-CHECK A:/gm)];
  const bMarks = [...sql.matchAll(/^-- POST-CHECK B:/gm)];
  let postA = null;
  let postB = null;
  let postAIdx = -1;
  if (aMarks.length === 1 && bMarks.length === 1 && aMarks[0].index < bMarks[0].index) {
    postAIdx = aMarks[0].index;
    postA = stripComments(sql.slice(aMarks[0].index, bMarks[0].index));
    postB = stripComments(sql.slice(bMarks[0].index));
  } else {
    problems.push(`expected POST-CHECK A then POST-CHECK B markers once each (A=${aMarks.length}, B=${bMarks.length})`);
  }
  // Raw-text index of COMMIT, to compare with post-check markers (which live in comments).
  const rawCommit = [...sql.matchAll(/^COMMIT;[ \t]*$/gm)];
  const rawCommitIdx = rawCommit.length === 1 ? rawCommit[0].index : -1;

  return { sql, code, problems, beginLines, commitLines, beginIdx, commitIdx, doBlock, doIdx,
    arrayItems, loopBody, postA, postB, postAIdx, rawCommitIdx };
}

// ── Rules: each returns a list of problems ([] = pass) ───────────────────────────

const RULES = {
  "file-format": (p) => {
    const out = [];
    if (p.sql.charCodeAt(0) === 0xfeff) out.push("file starts with a BOM");
    if (p.sql.includes("\r")) out.push("file contains CR (must be LF only)");
    if (!p.sql.endsWith("\n")) out.push("file must end with a newline");
    if (p.sql.endsWith("\n\n")) out.push("file must end with exactly one newline");
    return out;
  },

  transaction: (p) => {
    const out = [];
    if (p.beginLines.length !== 1) out.push(`expected exactly 1 "BEGIN;" line, found ${p.beginLines.length}`);
    if (p.commitLines.length !== 1) out.push(`expected exactly 1 "COMMIT;" line, found ${p.commitLines.length}`);
    if (count(p.code, /\bROLLBACK\b|\bSAVEPOINT\b|\bEND\s+TRANSACTION\b|\bSTART\s+TRANSACTION\b/i) !== 0) {
      out.push("unexpected ROLLBACK/SAVEPOINT/START/END TRANSACTION");
    }
    if (count(p.code, /\bCOMMIT\b/i) !== 1) out.push("COMMIT keyword must appear exactly once");
    if (p.beginIdx >= 0 && p.commitIdx >= 0) {
      if (!(p.beginIdx < p.doIdx && p.doIdx < p.commitIdx)) out.push("DO block must sit between BEGIN and COMMIT");
    }
    if (p.rawCommitIdx < 0 || p.postAIdx < 0 || p.postAIdx < p.rawCommitIdx) {
      out.push("read-only post-checks must come after COMMIT");
    }
    return out;
  },

  notify: (p) => {
    const out = [];
    const notifies = [...p.code.matchAll(/^NOTIFY pgrst, 'reload schema';[ \t]*$/gm)];
    if (notifies.length !== 1) out.push(`expected exactly 1 "NOTIFY pgrst, 'reload schema';", found ${notifies.length}`);
    if (count(p.code, /\bNOTIFY\b/i) !== 1) out.push("NOTIFY keyword must appear exactly once");
    if (notifies.length === 1 && p.beginIdx >= 0 && p.commitIdx >= 0) {
      const at = notifies[0].index;
      if (!(p.doIdx < at && at < p.commitIdx)) out.push("NOTIFY must run after the DO block, before COMMIT");
    }
    return out;
  },

  "target-tables": (p) => {
    const out = [];
    const want = JSON.stringify(TARGET_TABLES);
    if (!p.arrayItems) out.push("FOREACH ARRAY[...] not found");
    else {
      const names = p.arrayItems.map(unquote);
      if (names.some((n) => n === null)) out.push(`ARRAY items must be string literals: ${p.arrayItems.join(", ")}`);
      if (p.arrayItems.length !== 3) out.push(`ARRAY must list exactly 3 tables, found ${p.arrayItems.length}`);
      if (JSON.stringify([...names].sort()) !== want) out.push(`ARRAY tables ${JSON.stringify(names)} != ${want}`);
    }
    if (p.postA) {
      const m = p.postA.match(/c\.relname IN \(([^)]*)\)/);
      const names = m ? splitTopLevelCommas(m[1]).map(unquote) : [];
      if (JSON.stringify([...names].sort()) !== want) out.push(`post-check A relname list ${JSON.stringify(names)} != ${want}`);
    }
    if (p.postB) {
      const froms = [...p.postB.matchAll(/FROM public\.(\w+)/g)].map((m) => m[1]);
      if (JSON.stringify([...froms].sort()) !== want) out.push(`post-check B FROM list ${JSON.stringify(froms)} != ${want}`);
      const labels = [...p.postB.matchAll(/SELECT\s+'(\w+)'/g)].map((m) => m[1]);
      if (JSON.stringify([...labels].sort()) !== want) out.push(`post-check B labels ${JSON.stringify(labels)} != ${want}`);
    }
    const publicRefs = [...p.code.matchAll(/\bpublic\.(\w+)/g)].map((m) => m[1]);
    const stray = publicRefs.filter((t) => !TARGET_TABLES.includes(t));
    if (stray.length) out.push(`references to non-target public tables: ${stray.join(", ")}`);
    return out;
  },

  "allowed-values": (p) => {
    const out = [];
    const sub = count(p.sql, /subheading/i);
    if (sub !== 0) out.push(`"subheading" must not appear (found ${sub})`);
    if (!p.loopBody) return [...out, "loop body not found"];
    const checks = executeFormats(p.loopBody).filter((c) => c.template && /\bCHECK\s*\(/i.test(c.template));
    if (checks.length !== 1) return [...out, `expected exactly 1 CHECK format call, found ${checks.length}`];
    const c = checks[0];
    if (!/CHECK \(item_type IN \((%L(?:, %L)*)\)\)$/.test(c.template)) out.push(`CHECK template not an item_type IN list: ${c.template}`);
    const placeholders = count(c.template.split("CHECK")[1] || "", /%L/);
    const values = c.args.slice(2).map(unquote);
    if (placeholders !== values.length) out.push(`CHECK has ${placeholders} %L but ${values.length} value args`);
    if (JSON.stringify(values) !== JSON.stringify(ALLOWED_VALUES)) out.push(`CHECK values ${JSON.stringify(values)} != ${JSON.stringify(ALLOWED_VALUES)}`);
    // Identifier-like literals inside the DO block must come from a closed vocabulary.
    // relkind 'r' = ordinary table, contype 'c' = CHECK constraint.
    const vocab = new Set([...TARGET_TABLES, ...ALLOWED_VALUES, "public", "r", "c", "text", "item_type", "_item_type_check", ""]);
    const odd = singleQuotedLiterals(p.doBlock || "").map(unquote).filter((v) => /^[a-z_]*$/.test(v) && !vocab.has(v));
    if (odd.length) out.push(`unexpected value literals in DO block: ${odd.join(", ")}`);
    return out;
  },

  "default-backfill-notnull": (p) => {
    const out = [];
    if (!p.loopBody) return ["loop body not found"];
    const calls = executeFormats(p.loopBody);
    const find = (re) => calls.filter((c) => c.template && re.test(c.template));
    const add = find(/ADD COLUMN/);
    const upd = find(/^UPDATE\b/);
    const def = find(/SET DEFAULT/);
    const nn = find(/SET NOT NULL/);
    if (add.length !== 1 || add[0].template !== EXPECTED_LOOP_FORMATS[0].template) {
      out.push("ADD COLUMN must be exactly `ADD COLUMN IF NOT EXISTS item_type text`");
    }
    if (upd.length !== 1) out.push(`expected exactly 1 UPDATE format call, found ${upd.length}`);
    else if (unquote(upd[0].args[1] || "") !== "item") out.push(`backfill value must be 'item', got ${upd[0].args[1]}`);
    if (def.length !== 1) out.push(`expected exactly 1 SET DEFAULT format call, found ${def.length}`);
    else {
      if (!/ALTER COLUMN item_type SET DEFAULT %L$/.test(def[0].template)) out.push(`SET DEFAULT template: ${def[0].template}`);
      if (unquote(def[0].args[1] || "") !== "item") out.push(`default must be 'item', got ${def[0].args[1]}`);
    }
    if (nn.length !== 1) out.push(`expected exactly 1 SET NOT NULL format call, found ${nn.length}`);
    else if (nn[0].template !== EXPECTED_LOOP_FORMATS[3].template) out.push(`SET NOT NULL template: ${nn[0].template}`);
    if (add.length === 1 && upd.length === 1 && nn.length === 1) {
      if (!(add[0].index < upd[0].index && upd[0].index < nn[0].index)) out.push("order must be ADD COLUMN -> backfill UPDATE -> SET NOT NULL");
    }
    return out;
  },

  "canonical-check": (p) => {
    const out = [];
    if (!p.loopBody) return ["loop body not found"];
    const calls = executeFormats(p.loopBody);
    const drop = calls.filter((c) => c.template === EXPECTED_LOOP_FORMATS[4].template);
    const add = calls.filter((c) => c.template && /ADD CONSTRAINT %I CHECK/.test(c.template));
    if (add.length !== 1) out.push(`expected exactly 1 ADD CONSTRAINT ... CHECK in the loop, found ${add.length}`);
    else if (add[0].args[1] !== CANONICAL_NAME_ARG) out.push(`CHECK constraint name must be ${CANONICAL_NAME_ARG}`);
    if (drop.length !== 1) out.push(`expected exactly 1 DROP CONSTRAINT IF EXISTS in the loop, found ${drop.length}`);
    else if (drop[0].args[1] !== CANONICAL_NAME_ARG) out.push(`DROP constraint name must be ${CANONICAL_NAME_ARG}`);
    if (drop.length === 1 && add.length === 1 && !(drop[0].index < add[0].index)) out.push("DROP canonical must precede ADD");
    if (p.postA && !/k\.conname = c\.relname \|\| '_item_type_check'/.test(p.postA)) {
      out.push("post-check A must join pg_constraint on the canonical constraint name");
    }
    return out;
  },

  "fail-closed-guards": (p) => {
    const out = [];
    const d = p.doBlock || "";
    const body = p.loopBody || "";
    if (!/c\.relkind = 'r'/.test(d)) out.push("missing ordinary-table guard (relkind = 'r')");
    if (!/IF target_oid IS NULL THEN\s+RAISE EXCEPTION/.test(d)) out.push("missing RAISE when the table is missing");
    if (!/IF FOUND AND \(\s*column_type <> 'text'\s+OR column_generated <> ''\s+OR column_identity <> ''\s*\) THEN\s+RAISE EXCEPTION/.test(d)) {
      out.push("missing RAISE for an incompatible existing item_type column");
    }
    if (!/k\.contype = 'c'[\s\S]*?ILIKE '%item_type%'[\s\S]*?k\.conname <> target_table \|\| '_item_type_check'/.test(d)) {
      out.push("unexpected-check query must scan item_type CHECKs excluding the canonical name");
    }
    const raiseAt = body.search(/IF unexpected_checks IS NOT NULL THEN\s+RAISE EXCEPTION/);
    const dropAt = body.indexOf("DROP CONSTRAINT IF EXISTS");
    if (raiseAt < 0) out.push("missing RAISE for unexpected item_type checks");
    else if (dropAt >= 0 && raiseAt > dropAt) out.push("unexpected-check RAISE must run before DROP CONSTRAINT");
    return out;
  },

  "update-scope": (p) => {
    const out = [];
    const updates = count(p.code, /\bUPDATE\b/i);
    if (updates !== 1) out.push(`expected exactly 1 UPDATE in the migration, found ${updates}`);
    const calls = p.loopBody ? executeFormats(p.loopBody) : [];
    const upd = calls.filter((c) => c.template && /^UPDATE\b/i.test(c.template));
    if (upd.length !== 1 || upd[0].template !== EXPECTED_LOOP_FORMATS[1].template) {
      out.push("UPDATE must be exactly `UPDATE public.%I SET item_type = %L WHERE item_type IS NULL`");
    }
    for (const col of FORBIDDEN_COLUMNS) {
      if (new RegExp(`\\b${col}\\b`, "i").test(p.code)) out.push(`migration must not reference column ${col}`);
    }
    const altered = [...p.code.matchAll(/ALTER COLUMN\s+(\w+)/gi)].map((m) => m[1]);
    if (altered.some((c) => c !== "item_type")) out.push(`ALTER COLUMN only on item_type, got ${altered.join(", ")}`);
    const added = [...p.code.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)].map((m) => m[1]);
    if (added.some((c) => c !== "item_type")) out.push(`ADD COLUMN only item_type, got ${added.join(", ")}`);
    return out;
  },

  "forbidden-statements": (p) => {
    const out = [];
    const banned = [
      /\bINSERT\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i,
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i, /\bDROP\s+TRIGGER\b/i, /\bCREATE\s+POLICY\b/i,
      /\bALTER\s+POLICY\b/i, /\bDROP\s+POLICY\b/i, /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
      /\bGRANT\b/i, /\bREVOKE\b/i, /\bROW\s+LEVEL\s+SECURITY\b/i, /\bCOPY\b/i,
    ];
    for (const re of banned) if (re.test(p.code)) out.push(`forbidden statement: ${re.source}`);
    const drops = count(p.code, /\bDROP\b/i);
    if (drops !== 1) out.push(`only the canonical DROP CONSTRAINT IF EXISTS is allowed, found ${drops} DROP`);
    return out;
  },

  "loop-surface": (p) => {
    if (!p.loopBody || !p.doBlock) return ["loop body not found"];
    const out = [];
    const calls = executeFormats(p.loopBody);
    const got = calls.map((c) => ({ template: c.template, args: c.args }));
    if (JSON.stringify(got) !== JSON.stringify(EXPECTED_LOOP_FORMATS)) {
      out.push(`loop EXECUTE format() surface differs from the allowed sequence:\n${JSON.stringify(got, null, 1)}`);
    }
    const executes = count(p.doBlock, /\bEXECUTE\b/i);
    if (executes !== calls.length) out.push(`every EXECUTE must be EXECUTE format(...) inside the loop (${executes} vs ${calls.length})`);
    return out;
  },

  "post-check-a": (p) => {
    if (!p.postA) return ["post-check A missing"];
    const out = [];
    const need = [
      /^\s*SELECT\b/,
      /c\.relname AS table_name/,
      /a\.atttypid::regtype::text AS data_type/,
      /a\.attnotnull AS not_null/,
      /pg_get_expr\(d\.adbin, d\.adrelid\) AS default_expr/,
      /pg_get_constraintdef\(k\.oid, true\) AS check_definition/,
      /n\.nspname = 'public'/,
      /a\.attname = 'item_type'/,
      /NOT a\.attisdropped/,
      /LEFT JOIN pg_attrdef d/,
      /LEFT JOIN pg_constraint k/,
      /ORDER BY c\.relname;/,
    ];
    for (const re of need) if (!re.test(p.postA)) out.push(`post-check A missing ${re.source}`);
    if (/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(p.postA)) out.push("post-check A must be read-only");
    return out;
  },

  "post-check-b": (p) => {
    if (!p.postB) return ["post-check B missing"];
    const out = [];
    if (/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(p.postB)) out.push("post-check B must be read-only");
    const branches = p.postB.split(/\bUNION ALL\b/);
    if (branches.length !== 3) out.push(`post-check B must have 3 UNION ALL branches, found ${branches.length}`);
    branches.forEach((b, i) => {
      if (!/count\(\*\)/.test(b)) out.push(`branch ${i + 1}: missing total count(*)`);
      if (!/count\(\*\) FILTER \(WHERE item_type = 'item'\)/.test(b)) out.push(`branch ${i + 1}: missing item count`);
      if (!/count\(\*\) FILTER \(WHERE item_type = 'heading'\)/.test(b)) out.push(`branch ${i + 1}: missing heading count`);
      if (!/count\(\*\) FILTER \(WHERE item_type IS NULL OR item_type NOT IN \('item', 'heading'\)\)/.test(b)) {
        out.push(`branch ${i + 1}: missing invalid/null count`);
      }
    });
    for (const alias of ["total_rows", "item_rows", "heading_rows", "invalid_rows"]) {
      if (!new RegExp(`AS ${alias}\\b`).test(branches[0] || "")) out.push(`first branch missing alias ${alias}`);
    }
    if (!/ORDER BY table_name;\s*$/.test(p.postB)) out.push("post-check B must end with ORDER BY table_name;");
    return out;
  },
};

function problemsFor(ruleId, sql) {
  const p = parse(sql);
  return RULES[ruleId](p);
}

// ── Candidate: every rule passes ────────────────────────────────────────────

test("artifact: migration file exists (baseline control — absent file must fail here)", () => {
  loadSql();
});

test("artifact: structure parses (DO block, FOREACH loop, post-check A/B found)", () => {
  const p = parse(loadSql());
  assert.deepEqual(p.problems, []);
  assert.ok(p.doBlock && p.loopBody && p.postA && p.postB);
});

for (const ruleId of Object.keys(RULES)) {
  test(`rule ${ruleId}: candidate migration passes`, () => {
    assert.deepEqual(problemsFor(ruleId, loadSql()), []);
  });
}

test("parser sanity: loop exposes exactly the 6 expected format() calls", () => {
  const p = parse(loadSql());
  assert.equal(executeFormats(p.loopBody).length, 6);
});

test("parser sanity: comment stripping keeps quoted '--' and removes comment-only words", () => {
  assert.equal(stripComments("SELECT '--x' -- drop table\n"), "SELECT '--x' \n");
  assert.deepEqual(RULES["forbidden-statements"](parse("-- DELETE me\n")).filter((x) => /DELETE/.test(x)), []);
});

// ── Positive controls: single-defect mutants must trip the named rule ─────────
// `edits` = [find, replace] pairs; each `find` must occur exactly once in the candidate.

const MUTANTS = [
  { id: "M01", desc: "remove transaction (BEGIN/COMMIT)", rules: ["transaction"],
    edits: [["\nBEGIN;\n", "\n"], ["\nCOMMIT;\n", "\n"]] },
  { id: "M02", desc: "remove NOTIFY pgrst", rules: ["notify"],
    edits: [["NOTIFY pgrst, 'reload schema';\n", ""]] },
  { id: "M03", desc: "add subheading to CHECK", rules: ["allowed-values", "loop-surface"],
    edits: [["CHECK (item_type IN (%L, %L))',", "CHECK (item_type IN (%L, %L, %L))',"],
      ["      'heading'\n    );", "      'heading',\n      'subheading'\n    );"]] },
  { id: "M04", desc: "default = heading", rules: ["default-backfill-notnull", "loop-surface"],
    edits: [["SET DEFAULT %L',\n      target_table,\n      'item'", "SET DEFAULT %L',\n      target_table,\n      'heading'"]] },
  { id: "M05", desc: "backfill = heading", rules: ["default-backfill-notnull", "loop-surface"],
    edits: [["WHERE item_type IS NULL',\n      target_table,\n      'item'", "WHERE item_type IS NULL',\n      target_table,\n      'heading'"]] },
  { id: "M06", desc: "drop SET NOT NULL", rules: ["default-backfill-notnull", "loop-surface"],
    edits: [["    EXECUTE format(\n      'ALTER TABLE public.%I ALTER COLUMN item_type SET NOT NULL',\n      target_table\n    );\n", ""]] },
  { id: "M07", desc: "drop CHECK constraint", rules: ["allowed-values", "canonical-check", "loop-surface"],
    edits: [["    EXECUTE format(\n      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (item_type IN (%L, %L))',\n      target_table,\n      target_table || '_item_type_check',\n      'item',\n      'heading'\n    );\n", ""]] },
  { id: "M08", desc: "add a 4th target table", rules: ["target-tables"],
    edits: [["    'receipt_items'\n  ] LOOP", "    'receipt_items',\n    'purchase_order_items'\n  ] LOOP"]] },
  { id: "M09", desc: "backfill also rewrites qty", rules: ["update-scope", "loop-surface"],
    edits: [["SET item_type = %L WHERE item_type IS NULL", "SET item_type = %L, qty = 0 WHERE item_type IS NULL"]] },
  { id: "M10", desc: "remove invalid/null post-check", rules: ["post-check-b"],
    edits: [
      ["       count(*) FILTER (WHERE item_type = 'heading') AS heading_rows,\n       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading')) AS invalid_rows\n  FROM public.quotation_items",
        "       count(*) FILTER (WHERE item_type = 'heading') AS heading_rows\n  FROM public.quotation_items"],
      ["       count(*) FILTER (WHERE item_type = 'heading'),\n       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading'))\n  FROM public.delivery_invoice_items",
        "       count(*) FILTER (WHERE item_type = 'heading')\n  FROM public.delivery_invoice_items"],
      ["       count(*) FILTER (WHERE item_type = 'heading'),\n       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading'))\n  FROM public.receipt_items",
        "       count(*) FILTER (WHERE item_type = 'heading')\n  FROM public.receipt_items"],
    ] },
  { id: "M11", desc: "infer heading from unit_price = 0", rules: ["update-scope", "loop-surface"],
    edits: [["    EXECUTE format(\n      'ALTER TABLE public.%I ALTER COLUMN item_type SET DEFAULT %L',",
      "    EXECUTE format(\n      'UPDATE public.%I SET item_type = %L WHERE unit_price = 0',\n      target_table,\n      'heading'\n    );\n\n    EXECUTE format(\n      'ALTER TABLE public.%I ALTER COLUMN item_type SET DEFAULT %L',"]] },
  { id: "M12", desc: "backfill without WHERE item_type IS NULL", rules: ["update-scope", "loop-surface"],
    edits: [["SET item_type = %L WHERE item_type IS NULL'", "SET item_type = %L'"]] },
  { id: "M13", desc: "SET NOT NULL before backfill", rules: ["default-backfill-notnull", "loop-surface"],
    edits: [
      ["    EXECUTE format(\n      'ALTER TABLE public.%I ALTER COLUMN item_type SET NOT NULL',\n      target_table\n    );\n", ""],
      ["    EXECUTE format(\n      'UPDATE public.%I", "    EXECUTE format(\n      'ALTER TABLE public.%I ALTER COLUMN item_type SET NOT NULL',\n      target_table\n    );\n    EXECUTE format(\n      'UPDATE public.%I"],
    ] },
  { id: "M14", desc: "CHECK allows only item", rules: ["allowed-values", "loop-surface"],
    edits: [["CHECK (item_type IN (%L, %L))',", "CHECK (item_type IN (%L))',"], ["      'item',\n      'heading'\n    );", "      'item'\n    );"]] },
  { id: "M15", desc: "remove unexpected-check RAISE", rules: ["fail-closed-guards"],
    edits: [["    IF unexpected_checks IS NOT NULL THEN\n      RAISE EXCEPTION 'Phase 628A: public.% has unexpected item_type checks: %', target_table, unexpected_checks;\n    END IF;\n", ""]] },
  { id: "M16", desc: "drop relkind='r' guard", rules: ["fail-closed-guards"],
    edits: [["\n       AND c.relkind = 'r';", ";"]] },
  { id: "M17", desc: "remove heading post-check", rules: ["post-check-b"],
    edits: [["       count(*) FILTER (WHERE item_type = 'heading'),\n       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading'))\n  FROM public.receipt_items",
      "       0,\n       count(*) FILTER (WHERE item_type IS NULL OR item_type NOT IN ('item', 'heading'))\n  FROM public.receipt_items"]] },
  { id: "M18", desc: "column type varchar instead of text", rules: ["default-backfill-notnull", "loop-surface"],
    edits: [["ADD COLUMN IF NOT EXISTS item_type text'", "ADD COLUMN IF NOT EXISTS item_type varchar(16)'"]] },
  { id: "M19", desc: "add CREATE POLICY", rules: ["forbidden-statements"],
    edits: [["NOTIFY pgrst, 'reload schema';\n", "CREATE POLICY p628a ON public.receipt_items FOR SELECT USING (true);\n\nNOTIFY pgrst, 'reload schema';\n"]] },
  { id: "M20", desc: "NOTIFY moved after COMMIT", rules: ["notify"],
    edits: [["NOTIFY pgrst, 'reload schema';\n\nCOMMIT;\n", "COMMIT;\n\nNOTIFY pgrst, 'reload schema';\n"]] },
  { id: "M21", desc: "CRLF line endings", rules: ["file-format"],
    edits: [["-- Phase 628A — document item_type schema foundation\n", "-- Phase 628A — document item_type schema foundation\r\n"]] },
  { id: "M22", desc: "DELETE legacy rows", rules: ["forbidden-statements", "loop-surface"],
    edits: [["    EXECUTE format(\n      'UPDATE public.%I", "    EXECUTE format('DELETE FROM public.%I WHERE qty = 0', target_table);\n    EXECUTE format(\n      'UPDATE public.%I"]] },
  { id: "M23", desc: "post-check A drops check_definition", rules: ["post-check-a"],
    edits: [["  pg_get_expr(d.adbin, d.adrelid) AS default_expr,\n  pg_get_constraintdef(k.oid, true) AS check_definition\n",
      "  pg_get_expr(d.adbin, d.adrelid) AS default_expr\n"]] },
];

function applyMutant(sql, m) {
  let out = sql;
  for (const [find, replace] of m.edits) {
    const n = out.split(find).length - 1;
    assert.equal(n, 1, `${m.id}: mutation needle must occur exactly once (found ${n}): ${JSON.stringify(find.slice(0, 60))}`);
    out = out.replace(find, () => replace);
  }
  assert.notEqual(out, sql, `${m.id}: mutation must change the text`);
  return out;
}

for (const m of MUTANTS) {
  test(`positive control ${m.id} (${m.desc}) trips ${m.rules.join(" + ")}`, () => {
    const mutated = applyMutant(loadSql(), m);
    for (const ruleId of m.rules) {
      const got = problemsFor(ruleId, mutated);
      assert.ok(got.length > 0, `${m.id}: rule ${ruleId} must report a problem`);
    }
  });
}

test("positive controls cover every rule at least once", () => {
  const covered = new Set(MUTANTS.flatMap((m) => m.rules));
  const missing = Object.keys(RULES).filter((r) => !covered.has(r));
  assert.deepEqual(missing, []);
});
