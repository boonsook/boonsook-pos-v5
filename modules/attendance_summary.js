// Read-only attendance days; deliberately independent of payroll/OT calculations.
import { escHtml } from "./utils.js";

export function validWorkDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

export function attendancePeriod(kind, today) {
  if (!validWorkDate(today)) throw new Error("วันที่ไม่ถูกต้อง");
  const date = new Date(today + "T00:00:00Z");
  if (kind === "week") {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const from = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return { from, to: date.toISOString().slice(0, 10) };
  }
  if (kind !== "month") throw new Error("ช่วงวันที่ไม่ถูกต้อง");
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { from: today.slice(0, 7) + "-01", to: date.toISOString().slice(0, 10) };
}

function checkRange(from, to) {
  if (!validWorkDate(from) || !validWorkDate(to) || from > to) throw new Error("กรุณาระบุวันที่เริ่มต้นและสิ้นสุดให้ถูกต้อง");
}

export function summarizeAttendance(rows, profiles, { from, to }) {
  checkRange(from, to);
  const byUser = new Map(profiles.map(p => [String(p.id), {
    id: String(p.id), name: p.full_name || p.display_name || p.name || "พนักงานไม่ระบุชื่อ",
    dates: new Set(), open: 0, review: 0,
  }]));
  for (const row of rows) {
    if (!validWorkDate(row.work_date) || row.work_date < from || row.work_date > to
      || row.user_id == null || !row.clock_in_at || !Number.isFinite(Date.parse(row.clock_in_at))) {
      throw new Error("พบรายการลงเวลาไม่สมบูรณ์ จึงยังสรุปจำนวนวันไม่ได้");
    }
    const id = String(row.user_id);
    if (!byUser.has(id)) byUser.set(id, { id, name: "ไม่พบชื่อในรายชื่อพนักงาน", dates: new Set(), open: 0, review: 0 });
    const item = byUser.get(id);
    item.dates.add(row.work_date);
    if (!row.clock_out_at) item.open++;
    else {
      const end = Date.parse(row.clock_out_at);
      const start = Date.parse(row.clock_in_at);
      const endDate = Number.isFinite(end) ? new Date(end + 7 * 3600000).toISOString().slice(0, 10) : "";
      if (!Number.isFinite(end) || end < start || endDate !== row.work_date) item.review++;
    }
  }
  return [...byUser.values()].map(p => ({ ...p, days: p.dates.size, dates: [...p.dates].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, "th") || a.id.localeCompare(b.id));
}

// Count and page boundaries must agree: never present a capped response as a full report.
export async function fetchAttendanceSummary({ baseUrl, headers, from, to, signal, fetchImpl = fetch }) {
  checkRange(from, to);
  const rows = [];
  const seen = new Set();
  let expected = null;
  do {
    const query = new URLSearchParams({ select: "id,user_id,work_date,clock_in_at,clock_out_at", order: "id.asc", limit: "500", offset: String(rows.length) });
    query.append("work_date", `gte.${from}`);
    query.append("work_date", `lte.${to}`);
    const response = await fetchImpl(`${baseUrl}/rest/v1/staff_attendance?${query}`, {
      method: "GET", headers: { ...headers, Prefer: "count=exact" }, signal,
    });
    if (!response.ok) throw new Error("อ่านข้อมูลลงเวลาไม่สำเร็จ กรุณาลองใหม่");
    const page = await response.json();
    const range = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.headers.get("Content-Range") || "");
    if (!Array.isArray(page) || !range) throw new Error("ยังยืนยันความครบถ้วนของข้อมูลไม่ได้ กรุณาลองใหม่");
    const total = Number(range[3]);
    if (expected === null) expected = total;
    if (total !== expected || total > 20000 || (page.length && (Number(range[1]) !== rows.length || Number(range[2]) - Number(range[1]) + 1 !== page.length))
      || (!page.length && rows.length !== total)) throw new Error("ข้อมูลเปลี่ยนระหว่างโหลดหรือช่วงกว้างเกินไป กรุณาเลือกช่วงใหม่");
    for (const row of page) {
      if (row?.id == null || seen.has(String(row.id))) throw new Error("พบข้อมูลซ้ำระหว่างโหลด กรุณาลองใหม่");
      seen.add(String(row.id));
      rows.push(row);
    }
    if (rows.length > expected) throw new Error("จำนวนรายการไม่ตรง กรุณาลองใหม่");
  } while (rows.length < expected);
  return rows;
}

export function mountAttendanceSummary(root, { profiles, today, load }) {
  const initial = attendancePeriod("month", today);
  root.innerHTML = `
    <h3 style="margin:0 0 8px">📅 สรุปการมาทำงาน</h3>
    <p style="margin:0 0 12px;font-size:13px">นับวันที่ลงเวลาเข้าไม่ซ้ำต่อคน รวมวันที่ยังไม่ลงออก · ไม่ใช่ยอดอนุมัติจ่ายเงินเดือน</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <button class="btn light" data-period="week">สัปดาห์นี้ (จ.–อา.)</button>
      <button class="btn light" data-period="month">เดือนนี้</button>
    </div>
    <form style="display:flex;flex-wrap:wrap;gap:8px;align-items:end">
      <label>จาก <input aria-label="สรุปจากวันที่" type="date" name="from" value="${initial.from}" required style="max-width:100%"></label>
      <label>ถึง <input aria-label="สรุปถึงวันที่" type="date" name="to" value="${initial.to}" required style="max-width:100%"></label>
      <button class="btn light" type="submit">ดูสรุป</button>
    </form>
    <div data-summary-result role="status" aria-live="polite" style="margin-top:12px"></div>`;
  const form = root.querySelector("form");
  const result = root.querySelector("[data-summary-result]");
  let generation = 0;
  let controller;
  const run = async () => {
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const from = form.elements.from.value;
    const to = form.elements.to.value;
    result.textContent = "กำลังโหลดสรุป…";
    const controllerForRequest = controller;
    const timer = setTimeout(() => controllerForRequest.abort(), 15000);
    try {
      checkRange(from, to);
      const rows = await load({ from, to, signal });
      signal.throwIfAborted();
      const summary = summarizeAttendance(rows, profiles, { from, to });
      if (current !== generation || !root.isConnected) return;
      result.innerHTML = `<p>ช่วง ${escHtml(from)} ถึง ${escHtml(to)} · รวม ${summary.reduce((n, p) => n + p.days, 0)} คน-วัน · ${rows.length} รายการที่อ่านได้</p>
        <p style="font-size:12px">ข้อมูล ณ เวลาโหลด กดดูสรุปเพื่ออัปเดต · วันที่มีหลายรายการนับ 1 วัน · รายการข้ามวัน/เวลาผิดลำดับควรตรวจสอบ</p>
        ${rows.length ? "" : "<p>ไม่มีรายการลงเวลาในช่วงนี้</p>"}
        <p style="font-size:12px">เลื่อนตารางด้านข้างเพื่อดูทุกคอลัมน์ · 0 วันหมายถึงไม่พบการลงเวลาในช่วงนี้ ไม่ใช่การยืนยันว่าขาดงาน</p>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:430px">
          <thead><tr><th>พนักงาน</th><th>วันมาทำงาน</th><th>ยังไม่ลงออก (รายการ)</th><th>ข้ามวัน/ควรตรวจ (รายการ)</th></tr></thead>
          <tbody>${summary.map(p => `<tr><td style="padding:8px">${escHtml(p.name)}</td><td style="text-align:center">${p.days}</td><td style="text-align:center">${p.open}</td><td style="text-align:center">${p.review}</td></tr>`).join("")}</tbody>
        </table></div>`;
    } catch (error) {
      if (current !== generation || !root.isConnected) return;
      result.textContent = signal.aborted ? "โหลดสรุปนานเกินไป กรุณากดดูสรุปอีกครั้ง" : (error?.message || "โหลดสรุปไม่สำเร็จ");
    } finally {
      clearTimeout(timer);
    }
  };
  form.addEventListener("submit", event => { event.preventDefault(); void run(); });
  root.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
    const range = attendancePeriod(button.dataset.period, today);
    form.elements.from.value = range.from;
    form.elements.to.value = range.to;
    void run();
  }));
  void run();
}
