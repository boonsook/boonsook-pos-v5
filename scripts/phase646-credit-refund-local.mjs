// Local-only PostgreSQL 17.6 behavioral rehearsal. No host/DSN/credential option.
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
  "supabase-phase92-61b-refund-guard.sql",
  "supabase-phase646-credit-refund-approval.sql",
  "tests/phase646_credit_refund_fixture.sql",
  "tests/phase646_credit_refund_checks.sql",
  "scripts/phase646-credit-refund-local.mjs"
];
const sourceBytes = Object.fromEntries(sourceFiles.map(relative => [
  relative, fs.readFileSync(path.join(repo, relative))
]));
const sourceHashes = Object.fromEntries(sourceFiles.map(relative => [
  relative,
  crypto.createHash("sha256").update(sourceBytes[relative]).digest("hex")
]));
fs.writeFileSync(path.join(clusterRoot, "input-hashes.json"), `${JSON.stringify(sourceHashes, null, 2)}\n`, { flag: "wx" });
const transcript = [];
let started = false;
let control = 0;

function run(name, argv, input, expectFailure = false) {
  let result;
  if (name === "pg_ctl") {
    // Windows postgres children can hold inherited pipes after pg_ctl exits.
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

function sql(database, source, expectFailure = false) {
  return run("psql", ["-X", "-w", "-At", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", database], source, expectFailure).trim();
}
function sqlAsync(database, source) {
  return new Promise((resolve, reject) => {
    const argv = ["-X", "-w", "-At", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", database];
    const child = spawn(exe("psql"), argv, { env, windowsHide: true, timeout: 20000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      transcript.push(JSON.stringify({ name: "psql-concurrent", argv, status: code, stdout, stderr }));
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`concurrent psql status ${code}: ${stderr}`));
    });
    child.stdin.end(source);
  });
}
function file(relative) { return sourceBytes[relative]?.toString("utf8") ?? fs.readFileSync(path.join(repo, relative), "utf8"); }

try {
  assert.match(run("psql", ["--version"]), /17\.6(?:\s|$)/);
  run("initdb", ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale"]);
  fs.appendFileSync(path.join(data, "postgresql.conf"), `\nlisten_addresses='127.0.0.1'\nport=${port}\nstatement_timeout='30s'\nlock_timeout='5s'\n`);
  run("pg_ctl", ["-D", data, "-l", path.join(clusterRoot, "server.log"), "-w", "-t", "30", "start"]);
  started = true;
  const identity = JSON.parse(sql("postgres", "SELECT jsonb_build_object('version',current_setting('server_version'),'data',current_setting('data_directory'),'host',host(inet_server_addr()),'port',inet_server_port());"));
  assert.equal(identity.version, "17.6");
  assert.equal(identity.host, "127.0.0.1");
  assert.equal(identity.port, port);
  assert.equal(fs.realpathSync(identity.data).toLowerCase(), fs.realpathSync(data).toLowerCase());
  fs.writeFileSync(path.join(clusterRoot, "owned-pid"), fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").split(/\r?\n/)[0]);
  sql("postgres", "CREATE DATABASE phase646;");
  sql("phase646", file("tests/phase646_credit_refund_fixture.sql"));
  // Install the repository's real legacy over-refund trigger in the local
  // fixture so Phase 646 is tested against its actual SQL, not a stub.
  sql("phase646", file("supabase-phase92-61b-refund-guard.sql"));
  sql("phase646", file("supabase-phase646-credit-refund-approval.sql"));
  const checks = sql("phase646", file("tests/phase646_credit_refund_checks.sql"));
  assert.match(checks, /PHASE646 LOCAL PASS/);
  // Two real PostgreSQL connections: pause the approved finalizer inside its
  // refund INSERT, then prove another connection cannot alter sale_items while
  // the first connection holds its source-item lock.
  sql("phase646", "SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SELECT (public.phase646_submit_credit_refund('00000000-0000-0000-0000-000000000098',16,'[{\"sale_item_id\":88,\"qty\":1}]'::jsonb,'credit','concurrent item change',false,NULL,NULL)).status;");
  sql("phase646", "SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; SELECT (public.phase646_admin_decide_credit_refund((SELECT id FROM public.credit_refund_requests WHERE request_key='00000000-0000-0000-0000-000000000098'),true,20,NULL)).status;");
  const finalize = sqlAsync("phase646", "SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; SELECT (public.phase646_finalize_credit_refund((SELECT id FROM public.credit_refund_requests WHERE request_key='00000000-0000-0000-0000-000000000098'),20)).status;");
  let paused = false;
  const pauseDeadline = Date.now() + 6000;
  while (Date.now() < pauseDeadline) {
    paused = sql("phase646", "SELECT NOT pg_try_advisory_lock(64616);") === "t";
    if (paused) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(paused, "concurrent finalizer did not reach the refund hold point");
  const updateAttempt = sql("phase646", "SET lock_timeout='500ms'; UPDATE public.sale_items SET qty=2 WHERE id=88;", true);
  assert.match(updateAttempt, /canceling statement due to lock timeout/i);
  assert.match(await finalize, /completed/);
  assert.equal(sql("phase646", "SELECT qty FROM public.sale_items WHERE id=88;"), "1");
  console.log("PHASE646 CONCURRENT SOURCE LOCK PASS");
  console.log(checks);
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
