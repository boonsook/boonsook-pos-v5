// modules/fetch_paginated.js — Phase 366 fix-loadalldata-1000-row-cap
//
// แก้บั๊ก: PostgREST default max-rows = 1000 → select("*") เปล่า โหลดได้แค่ 1000 แถว/ตาราง
// (products 1075 → หาย 75; warehouse_stock = สินค้า×คลัง อาจหลายพัน → stock เพี้ยน).
// fetchAllPaginated วนโหลดด้วย .range(from,to) จนครบทุกหน้า แล้ว concat คืน array เดียว.
//
// queryFn(from, to) ต้องคืน supabase query ที่ resolve เป็น { data, error }
//   เช่น (f, t) => sb.from("products").select("*").order("id", { ascending: false }).range(f, t)
// หมายเหตุ: queryFn ต้องมี .order() ที่ stable (PK) ก่อน .range() — ไม่งั้นลำดับข้ามหน้าซ้ำ/หาย
//
// คืน: array รวมทุกหน้า · throw ถ้า error (ไม่กลืนเงียบ — เส้นทางข้อมูล/สต็อก)

export async function fetchAllPaginated(queryFn, pageSize = 1000) {
  const acc = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFn(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;       // หน้าว่าง/null → จบ (กันค้างเมื่อ count หาร pageSize ลงตัว)
    acc.push(...data);
    if (data.length < pageSize) break;            // หน้าสุดท้าย (ได้ไม่เต็มหน้า)
  }
  return acc;
}
