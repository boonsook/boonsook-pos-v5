// Regenerate tests/phase648_chat_pg_manifest.json after editing any Phase 648 PostgreSQL kit file.
// Does not run PostgreSQL. Status is reset to NOT_RUN (evidence is recorded separately when a run is approved).
/* global console */
import fs from "node:fs";
import crypto from "node:crypto";

const files = [
  "scripts/phase648-chat-pg-local.mjs",
  "supabase-phase648-customer-chat-inbox.sql",
  "tests/phase648_chat_pg_checks.sql",
  "tests/phase648_chat_pg_fixture.sql",
];
const manifest = {
  phase: "648A",
  status: "NOT_RUN",
  note: "Run only on an owner-approved test database: node scripts/phase648-chat-pg-local.mjs --bin-dir <pg/bin> --cluster-root <new dir> --port <49152-65535>",
  files: Object.fromEntries(files.map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")])),
  expected_stdout: [
    "PHASE648 PG CHECKS PASS",
    "PHASE648 RACE INGEST-BEFORE-DONE PASS",
    "PHASE648 RACE DONE-BEFORE-INGEST PASS",
    "PHASE648 RACE PARALLEL-INGEST PASS",
  ],
};
fs.writeFileSync("tests/phase648_chat_pg_manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest.files, null, 2));
