// ═══════════════════════════════════════════════════════════
// Stock CAS (Compare-And-Swap) decrement — extracted from main.js Phase 89.11
// Pure module, dependency-injected fetcher → fully unit-testable
//
// Strategy: avoid TOCTOU race when 2 concurrent checkouts read the same
// stock value from a JS cache and both PATCH `stock - 1` (should be -2).
//   1. Refetch field value from DB (ignore cache).
//   2. PATCH ?id=eq.X&{field}=eq.{before} — atomic UPDATE WHERE on PostgreSQL.
//      If field changed between fetch→patch, 0 rows are returned → retry.
// ═══════════════════════════════════════════════════════════

export async function atomicDecrementStock({
  fetcher,
  supabaseUrl,
  anonKey,
  accessToken,
  table,
  rowId,
  qty,
  field = "stock",
  maxRetries = 3,
  logger = console,
}) {
  if (!supabaseUrl || !anonKey || !table || rowId === undefined || rowId === null || rowId === "") {
    return { ok: false, error: "bad args" };
  }
  if (!(Number(qty) > 0)) {
    return { ok: false, error: "bad args" };
  }
  const fetchFn = fetcher || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return { ok: false, error: "no fetcher" };

  const headers = {
    "apikey": anonKey,
    "Authorization": "Bearer " + (accessToken || anonKey),
  };
  const idEnc = encodeURIComponent(String(rowId));
  const fieldEnc = encodeURIComponent(field);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let before;
    try {
      const r = await fetchFn(
        supabaseUrl + "/rest/v1/" + table + "?id=eq." + idEnc + "&select=" + fieldEnc,
        { headers }
      );
      if (!r.ok) return { ok: false, error: "fetch HTTP " + r.status };
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ok: false, error: table + " row not found (id=" + rowId + ")" };
      }
      // Phase 89.17 (L2): distinguish null from 0
      //   เดิม: `rows[0][field] || 0` → null treated as 0 → CAS PATCH `?field=eq.0` →
      //         ถ้า DB จริง null → 0 rows match → retry forever
      //   ใหม่: null/undefined field = uninitialized data → fail fast แทน infinite retry
      const rawValue = rows[0][field];
      if (rawValue == null) {
        return { ok: false, error: `${table}.${field} is null (uninitialized) — admin should set initial value` };
      }
      before = Number(rawValue);
    } catch (e) {
      return { ok: false, error: "fetch error: " + (e?.message || String(e)) };
    }

    const after = before - Number(qty);

    try {
      const url = supabaseUrl + "/rest/v1/" + table +
        "?id=eq." + idEnc +
        "&" + fieldEnc + "=eq." + before;
      const r = await fetchFn(url, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({ [field]: after }),
      });
      if (!r.ok) return { ok: false, error: "PATCH HTTP " + r.status };
      const data = await r.json().catch(() => []);
      if (Array.isArray(data) && data.length > 0) {
        return { ok: true, before, after, data: data[0], attempts: attempt + 1 };
      }
      logger?.warn?.(`[atomicDecrement] CAS retry ${attempt + 1}/${maxRetries} ${table} id=${rowId} (before=${before} stale)`);
    } catch (e) {
      return { ok: false, error: "PATCH error: " + (e?.message || String(e)) };
    }
  }

  return { ok: false, error: "CAS contention — failed after " + maxRetries + " retries" };
}

// ═══════════════════════════════════════════════════════════
// Phase 92.12: generic atomic field add (credit payment increment etc.)
// Same CAS as atomicDecrementStock but delta can be +/- (require finite).
//   refetch → PATCH ?field=eq.{before} → after = before + delta → stale=retry
// ห้ามแตะ atomicDecrementStock (stock checkout ใช้) — นี่คือ helper แยก
// ═══════════════════════════════════════════════════════════
export async function atomicAddToField({
  fetcher,
  supabaseUrl,
  anonKey,
  accessToken,
  table,
  rowId,
  field,
  delta,
  maxRetries = 3,
  logger = console,
}) {
  if (!supabaseUrl || !anonKey || !table || !field || rowId === undefined || rowId === null || rowId === "") {
    return { ok: false, error: "bad args" };
  }
  if (!Number.isFinite(Number(delta))) {
    return { ok: false, error: "bad args (delta not finite)" };
  }
  const fetchFn = fetcher || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return { ok: false, error: "no fetcher" };

  const headers = {
    "apikey": anonKey,
    "Authorization": "Bearer " + (accessToken || anonKey),
  };
  const idEnc = encodeURIComponent(String(rowId));
  const fieldEnc = encodeURIComponent(field);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let before;
    try {
      const r = await fetchFn(
        supabaseUrl + "/rest/v1/" + table + "?id=eq." + idEnc + "&select=" + fieldEnc,
        { headers }
      );
      if (!r.ok) return { ok: false, error: "fetch HTTP " + r.status };
      const rows = await r.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return { ok: false, error: table + " row not found (id=" + rowId + ")" };
      }
      // null/undefined field = uninitialized → fail fast แทน infinite retry (เหมือน decrement)
      const rawValue = rows[0][field];
      if (rawValue == null) {
        return { ok: false, error: `${table}.${field} is null (uninitialized) — admin should set initial value` };
      }
      before = Number(rawValue);
    } catch (e) {
      return { ok: false, error: "fetch error: " + (e?.message || String(e)) };
    }

    const after = before + Number(delta);

    try {
      const url = supabaseUrl + "/rest/v1/" + table +
        "?id=eq." + idEnc +
        "&" + fieldEnc + "=eq." + before;
      const r = await fetchFn(url, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({ [field]: after }),
      });
      if (!r.ok) return { ok: false, error: "PATCH HTTP " + r.status };
      const data = await r.json().catch(() => []);
      if (Array.isArray(data) && data.length > 0) {
        return { ok: true, before, after, data: data[0], attempts: attempt + 1 };
      }
      logger?.warn?.(`[atomicAddToField] CAS retry ${attempt + 1}/${maxRetries} ${table} id=${rowId} (before=${before} stale)`);
    } catch (e) {
      return { ok: false, error: "PATCH error: " + (e?.message || String(e)) };
    }
  }

  return { ok: false, error: "CAS contention — failed after " + maxRetries + " retries" };
}
