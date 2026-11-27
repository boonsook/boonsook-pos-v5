// Phase 648A — local-only PostgreSQL behavioral rehearsal for the customer-chat migration.
// STATUS: prepared, NOT RUN. Run only after the owner approves a test database in chat.
// No host/DSN/credential option: it creates its own loopback cluster under --cluster-root
// (must not exist), applies tests/phase648_chat_pg_fixture.sql, the migration TWICE (re-run safety),
// tests/phase648_chat_pg_checks.sql, then two-session races. Evidence + transcript stay in --cluster-root.
//   node scripts/phase648-chat-pg-local.mjs --bin-dir <pg/bin> --cluster-root <new dir> --port <49152-65535>
// Expected stdout lines (all required):
//   PHASE648 PG CHECKS PASS
//   PHASE648 RACE INGEST-BEFORE-DONE PASS
//   PHASE648 RACE DONE-BEFORE-INGEST PASS
//   PHASE648 RACE PARALLEL-INGEST PASS
/* global process, console, setTimeout */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (index % 2 === 0) pairs.push([value, values[index + 1]]);
  return pairs;
}, []));
assert.deepEqual(Object.keys(args).sort(), ["--bin-dir", "--cluster-root", "--port"]);
const bin = args["--bin-dir"];
const clusterRoot = args["--cluster-root"];
const port = Number(args["--port"]);
assert.ok(path.isAbsolute(bin) && path.isAbsolute(clusterRoot));
assert.ok(Number.isInteger(port) && port >= 49152 && port <= 65535);
assert.ok(!fs.existsSync(clusterRoot), "refuse pre-existing test cluster");
const data = path.join(clusterRoot, "data");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("PG")));
Object.assign(env, { PGCLIENTENCODING: "UTF8", PGCONNECT_TIMEOUT: "5" });
const exe = (name) => path.join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
for (const name of ["initdb", "pg_ctl", "psql"]) assert.ok(fs.statSync(exe(name)).isFile());
const socket = net.createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(port, "127.0.0.1", () => socket.close(resolve));
});
const portOpen = () => new Promise(resolve => {
  const probe = net.connect({ host: "127.0.0.1", port });
  probe.once("connect", () => { probe.destroy(); resolve(true); });
  probe.once("error", () => resolve(false));
  probe.setTimeout(1000, () => { probe.destroy(); resolve(true); });
});
const owner = crypto.randomUUID();
fs.mkdirSync(clusterRoot);
fs.writeFileSync(path.join(clusterRoot, ".owner"), owner, { flag: "wx" });
const sourceFiles = [
  "supabase-phase648-customer-chat-inbox.sql",
  "tests/phase648_chat_pg_fixture.sql",
  "tests/phase648_chat_pg_checks.sql",
  "scripts/phase648-chat-pg-local.mjs",
];
const sourceBytes = Object.fromEntries(sourceFiles.map(relative => [relative, fs.readFileSync(path.join(repo, relative))]));
const sourceHashes = Object.fromEntries(sourceFiles.map(relative => [
  relative, crypto.createHash("sha256").update(sourceBytes[relative]).digest("hex"),
]));
// Bind the run to the kit manifest committed with these exact files.
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "tests/phase648_chat_pg_manifest.json"), "utf8"));
assert.deepEqual(sourceHashes, manifest.files, "kit files differ from tests/phase648_chat_pg_manifest.json — refuse to run");
fs.writeFileSync(path.join(clusterRoot, "input-hashes.json"), `${JSON.stringify(sourceHashes, null, 2)}\n`, { flag: "wx" });
const transcript = [];
let started = false;
let control = 0;
const SALES = "00000000-0000-0000-0000-0000000000a2";

function run(name, argv, input, expectFailure = false) {
  let result;
  if (name === "pg_ctl") {
    const out = path.join(clusterRoot, `control-${++control}.out`);
    const err = path.join(clusterRoot, `control-${control}.err`);
    const o = fs.openSync(out, "wx");
    const e = fs.openSync(err, "wx");
    try {
      result = spawnSync(exe(name), argv, { env, windowsHide: true, timeout: 120000, stdio: ["ignore", o, e] });
    } finally { fs.closeSync(o); fs.closeSync(e); }
    result.stdout = fs.readFileSync(out, "utf8");
    result.stderr = fs.readFileSync(err, "utf8");
  } else {
    result = spawnSync(exe(name), argv, { input, env, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 12 * 1024 * 1024 });
  }
  transcript.push(JSON.stringify({ name, argv, status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }));
  if (result.error) throw result.error;
  assert.equal(result.status === 0, !expectFailure, `${name} status ${result.status}: ${result.stderr}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}
const psqlArgs = (database) => ["-X", "-w", "-At", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", database];
function sql(database, source, expectFailure = false) { return run("psql", psqlArgs(database), source, expectFailure).trim(); }
function sqlAsync(database, source) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe("psql"), psqlArgs(database), { env, windowsHide: true, timeout: 30000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      transcript.push(JSON.stringify({ name: "psql-concurrent", status: code, stdout, stderr }));
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`concurrent psql status ${code}: ${stderr}`));
    });
    child.stdin.end(source);
  });
}
async function waitFor(database, query, expected, label, ms = 6000) {
  const deadline = Date.now() + ms;
  let got = "";
  while (Date.now() < deadline) {
    got = sql(database, query);
    if (got === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`${label}: expected ${expected}, got ${got}`);
}
const file = (relative) => sourceBytes[relative].toString("utf8");
const ingest = (user, msg) => `SELECT public.customer_chat_ingest_line('${user}','${msg}','text','race ${msg}',now(),NULL);`;
const threadState = (db, user) => JSON.parse(sql(db, `SELECT row_to_json(t) FROM (SELECT status,inbound_seq,read_seq,unread_count FROM public.customer_chat_threads WHERE external_user_id='${user}') t;`));

try {
  assert.match(run("psql", ["--version"]), /\b1[5-7]\.\d+/);
  run("initdb", ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale"]);
  fs.appendFileSync(path.join(data, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${port}\nstatement_timeout='30s'\nlock_timeout='10s'\n`);
  run("pg_ctl", ["-D", data, "-l", path.join(clusterRoot, "server.log"), "-w", "-t", "30", "start"]);
  started = true;
  const identity = JSON.parse(sql("postgres", "SELECT jsonb_build_object('data',current_setting('data_directory'),'host',host(inet_server_addr()),'port',inet_server_port());"));
  assert.equal(identity.host, "127.0.0.1");
  assert.equal(identity.port, port);
  assert.equal(fs.realpathSync(identity.data).toLowerCase(), fs.realpathSync(data).toLowerCase());
  fs.writeFileSync(path.join(clusterRoot, "owned-pid"), fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").split(/\r?\n/)[0]);
  sql("postgres", "CREATE DATABASE phase648;");
  sql("phase648", file("tests/phase648_chat_pg_fixture.sql"));
  sql("phase648", file("supabase-phase648-customer-chat-inbox.sql"));
  sql("phase648", file("supabase-phase648-customer-chat-inbox.sql")); // re-run must be safe
  const checks = sql("phase648", file("tests/phase648_chat_pg_checks.sql"));
  assert.match(checks, /PHASE648 PG CHECKS PASS/);
  console.log("PHASE648 PG CHECKS PASS");

  // R-A: ingest holds the thread row (uncommitted) while sales presses "done" with the seq it saw.
  sql("phase648", `SET ROLE service_role; ${ingest("Urace", "r1")}`);
  const raceThread = sql("phase648", "SELECT id FROM public.customer_chat_threads WHERE external_user_id='Urace';");
  sql("phase648", `SET ROLE authenticated; SET request.jwt.claim.sub='${SALES}'; SELECT public.customer_chat_set_thread_state('${raceThread}',1,NULL);`);
  const slowIngest = sqlAsync("phase648", `SET application_name='p648-ingest'; BEGIN; SET LOCAL ROLE service_role; ${ingest("Urace", "r2")} SELECT pg_sleep(2); COMMIT;`);
  await waitFor("phase648", "SELECT count(*) FROM pg_stat_activity WHERE application_name='p648-ingest' AND wait_event='PgSleep';", "1", "R-A ingest hold");
  const done = sqlAsync("phase648", `SET application_name='p648-done'; SET ROLE authenticated; SET request.jwt.claim.sub='${SALES}'; SELECT public.customer_chat_set_thread_state('${raceThread}',1,'done');`);
  await waitFor("phase648", "SELECT count(*) FROM pg_stat_activity WHERE application_name='p648-done' AND wait_event_type='Lock';", "1", "R-A done must block on the thread row");
  await slowIngest;
  const doneResult = JSON.parse((await done).split("\n").pop());
  assert.equal(doneResult.ok, false);
  assert.equal(doneResult.reason, "new_messages");
  assert.deepEqual(threadState("phase648", "Urace"), { status: "open", inbound_seq: 2, read_seq: 1, unread_count: 1 });
  console.log("PHASE648 RACE INGEST-BEFORE-DONE PASS");

  // R-B: "done" (with full seq) holds the row; a new message waits, then reopens the thread.
  const slowDone = sqlAsync("phase648", `SET application_name='p648-done2'; BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${SALES}'; SELECT public.customer_chat_set_thread_state('${raceThread}',2,'done'); SELECT pg_sleep(2); COMMIT;`);
  await waitFor("phase648", "SELECT count(*) FROM pg_stat_activity WHERE application_name='p648-done2' AND wait_event='PgSleep';", "1", "R-B done hold");
  const lateIngest = sqlAsync("phase648", `SET application_name='p648-ingest2'; SET ROLE service_role; ${ingest("Urace", "r3")}`);
  await waitFor("phase648", "SELECT count(*) FROM pg_stat_activity WHERE application_name='p648-ingest2' AND wait_event_type='Lock';", "1", "R-B ingest must block on the thread row");
  const done2 = JSON.parse((await slowDone).split("\n").filter(line => line.startsWith("{")).pop());
  assert.equal(done2.ok, true);
  await lateIngest;
  assert.deepEqual(threadState("phase648", "Urace"), { status: "open", inbound_seq: 3, read_seq: 2, unread_count: 1 });
  console.log("PHASE648 RACE DONE-BEFORE-INGEST PASS");

  // R-C: parallel ingests for a brand-new customer + parallel redelivery of one message id.
  const parallel = [];
  for (let i = 1; i <= 10; i++) parallel.push(sqlAsync("phase648", `SET ROLE service_role; ${ingest("Upar", "p" + i)}`));
  for (let i = 1; i <= 3; i++) parallel.push(sqlAsync("phase648", `SET ROLE service_role; ${ingest("Upar", "dup")}`));
  await Promise.all(parallel);
  assert.equal(sql("phase648", "SELECT string_agg(inbound_seq::text, ',' ORDER BY inbound_seq) FROM public.customer_chat_messages m JOIN public.customer_chat_threads t ON t.id=m.thread_id WHERE t.external_user_id='Upar';"),
    Array.from({ length: 11 }, (_, i) => String(i + 1)).join(","));
  assert.deepEqual(threadState("phase648", "Upar"), { status: "open", inbound_seq: 11, read_seq: 0, unread_count: 11 });
  console.log("PHASE648 RACE PARALLEL-INGEST PASS");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    assert.equal(fs.readFileSync(path.join(clusterRoot, ".owner"), "utf8"), owner, "cluster ownership changed");
    if (started) {
      const pid = fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").split(/\r?\n/)[0];
      assert.equal(pid, fs.readFileSync(path.join(clusterRoot, "owned-pid"), "utf8"), "server PID changed");
      run("pg_ctl", ["-D", data, "-w", "-t", "30", "-m", "fast", "stop"]);
      assert.ok(!fs.existsSync(path.join(data, "postmaster.pid")), "server not stopped");
      assert.equal(await portOpen(), false, "loopback port still open");
    } else if (fs.existsSync(path.join(data, "postmaster.pid"))) {
      assert.fail("server PID exists after startup failure; inspect manually");
    }
    fs.writeFileSync(path.join(clusterRoot, "STOP-CONFIRMED.txt"), "owned loopback PostgreSQL cluster stopped; files retained\n");
  } catch (error) {
    console.error(`CLEANUP UNCONFIRMED: ${error.message}`);
    process.exitCode = 1;
  }
  fs.writeFileSync(path.join(clusterRoot, "transcript.jsonl"), `${transcript.join("\n")}\n`);
  console.log(`Evidence: ${clusterRoot}`);
}
