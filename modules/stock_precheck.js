// ═══════════════════════════════════════════════════════════
// Phase 372: pure helper — รวม need (qty) ต่อ (product_id|warehouse_id) จาก line items
//   บั๊กที่กัน: pre-check ใน ac_install/service_form/solar เดิมเช็คทีละ line —
//   ถ้าสินค้าเดียวกัน+คลังเดียวกันถูกใส่หลาย line (เช่น 2 บรรทัด qty 3 + 3 แต่สต็อก 5)
//   แต่ละ line ผ่านเดี่ยว ๆ (5>=3) แต่ผลรวม 6 > 5 → หลุด → deduct fail / โอนซ้ำ
//   helper นี้รวม qty ต่อ key ให้ pre-check เทียบยอดรวมจริง (dedup ฝั่ง caller)
// pure + dependency-free → unit-testable
// เงื่อนไข skip ตรงกับ loop เดิม: ข้าม item ที่ไม่มี warehouse_id หรือ product_id
// ═══════════════════════════════════════════════════════════
export function aggregateNeedByKey(items) {
  const m = new Map();
  for (const it of (items || [])) {
    if (!it || !it.warehouse_id || !it.product_id) continue;
    const key = `${it.product_id}|${it.warehouse_id}`;
    m.set(key, (m.get(key) || 0) + Number(it.qty || 0));
  }
  return m;
}
