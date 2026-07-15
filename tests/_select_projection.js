// ═══════════════════════════════════════════════════════════
//  Phase 606-b1.1 — projection helper กลางสำหรับ mock PostgREST ใน guard tests
// ═══════════════════════════════════════════════════════════
//  ทำไมต้องมี: mock เดิมคืน fixture "เต็มแถว" โดยไม่สน select= จริง → บั๊ก projection
//  (writer ขอคอลัมน์ไม่ครบ เช่น payment writer ขาด total_cost) ถูกกลบจน test เขียวปลอม.
//  ของจริง PostgREST คืน **เฉพาะคอลัมน์ที่ select** — mock ต้องทำแบบเดียวกัน.
//
//  สัญญา (ตาม acceptance ของ owner):
//   - รองรับ select=*            → คืนแถวเต็ม (พฤติกรรม PostgREST)
//   - ไม่มี select= ใน URL       → คืนแถวเต็ม (PostgREST default = *)
//   - select=a,b                 → คืนเฉพาะ field a,b (field ที่ fixture ไม่มี = ไม่โผล่)
//   - ไม่แตะ filter/scenario ของ mock — helper ทำแค่ตัด field ของ "ผลลัพธ์" เท่านั้น
//   - ไม่ mutate fixture เดิม (คืน object ใหม่เสมอเมื่อมีการ project)

/** ดึงรายชื่อ field จาก select= ใน URL — null = ไม่ต้อง project (คืนแถวเต็ม) */
export function selectFieldsOf(url) {
  const m = /[?&]select=([^&]*)/.exec(String(url));
  if (!m) return null;
  const raw = decodeURIComponent(m[1]).trim();
  if (raw === "" || raw === "*") return null;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

/** project แถวเดียวตาม field list (null = คืนแถวเดิมตรง ๆ) */
export function projectRow(row, fields) {
  if (!row || !Array.isArray(fields)) return row;
  const out = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
  }
  return out;
}

/** project array ของแถวตาม select= ใน URL — ใช้หุ้มผลลัพธ์ของ mock handler */
export function projectRows(rows, url) {
  const fields = selectFieldsOf(url);
  if (!fields) return rows;
  return (Array.isArray(rows) ? rows : []).map(r => projectRow(r, fields));
}
