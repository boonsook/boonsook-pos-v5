# 🔍 AUDIT — หน้า "สินค้า / คลัง" (Products / Inventory)

> วันที่: **2026-06-18** · live build: **475** · main HEAD: `3665dc3`
> ผู้ตรวจ: Claude (analyst/reviewer mode — read-only, ไม่แก้โค้ด)
> วิธี: กระจาย 4 sub-audit (products / stock-deduct-CAS / stock-ops / dual-stock-sync) แบบคู่ขนาน → verify finding สำคัญด้วยการอ่านโค้ดจริงเอง
> ขอบเขตไฟล์: `modules/products.js` · `stock_cas/precheck/movements/in_wizard/count/dead_stock/value/reconcile.js` · `modules/pos.js` (stock-deduct) · `main.js` (saveProduct/loadAllData/deduct/revert/transfer/applyStockMovement) · SQL `phase403/437/468`
> ⚠️ ขณะ audit: working tree อยู่บน branch `claude/phase-476-checkout-block-button-reset` (uncommitted ของอีก session) — **ไม่แตะ**

---

## บริบท
builds **468–475** เพิ่งรื้อระบบสต็อก/checkout หนัก (snapshot `sale_items.warehouse_id`, block oversell, CAS stock-count adjust, revert restock เฉพาะที่ตัดจริง, surface stock-in cost fail, saveProduct safety) → เป็นจุดที่บั๊กใหม่มีโอกาสสูง จึงโฟกัสตรวจของใหม่ + invariant เงิน/สต็อก

---

## ✅ ส่วนที่ตรวจแล้ว "แข็งแรง" (ไม่ต้องห่วง)

- **CAS + floor + idempotency backbone** — การตัด/คืน/โอนสต็อกทั้งหมดผ่าน `atomicDecrementStock`/`atomicAddToField` (`stock_cas.js`) = conditional UPDATE (`&{field}=eq.{before}`), 0-rows → retry → กัน lost-update/oversell; floor กันติดลบ (`stock_cas.js:71-78`)
- **revert idempotent** — `_revertStockForSale` เช็ค `_STOCK_RETURNED_MARKER` + fail-closed ถ้าอ่าน note ไม่ได้ (`main.js:3247`)
- **โอนคลัง** — ลอง RPC 1-tx ก่อน, fallback: source CAS+floor, target fail → rollback คืน source (`main.js:3456-3575`); locked `warehouse_transfer_cas.test.js`
- **build 470** (stock-in cost fail เตือนไม่เงียบ — `stock_in_wizard.js:451-475`) / **build 472** (stock-count adjust CAS — `main.js:3605-3621` + `adjust_cas_guard.test.js`) ✅ ทำงานถูก
- **dual-stock** — `products.stock = sum(warehouse_stock)` ผ่าน DB trigger (Phase 403); runtime paths (deduct/revert/applyMovement) ไม่เขียน `products.stock` ตรง (optimistic local sum + ให้ trigger เป็น canonical — `main.js:3333`) ✅ locked `stock_mirror_canonical_guard.test.js`
- **loadAllData** — products + warehouse_stock โหลดครบผ่าน `fetchAllPaginated` (ไม่ติด cap 1000) ✅ locked `load_all_pagination.test.js`
- **468 migration** ปลอดภัย (nullable, ไม่ backfill, revert รองรับ NULL) · **XSS** escape ครบทุกจุด render ชื่อสินค้า/คลัง/note · **permission** ครบ (accountant read-only, technician ไม่เห็นต้นทุน, saveProduct = admin/sales เท่านั้น)

---

## 🔴 BLOCKING (1) — ✅ RESOLVED build 477 (merged + live 2026-06-18, commit 49ec159)

> **แก้แล้ว:** `_revertStockForSale` ตรวจ `product.is_bundle` → expand recipe (`expandBundleForRevert` ใน modules/bundle_revert.js ใหม่) → คืน children ผ่าน deductedIds-gated CAS เข้าคลังที่ขาย. verified: code review + 1849 unit + e2e 14 + runtime wired (preview) + non-bundle revert + Phase 468 ยืนยัน live (owner smoke). ระบบมี 0 bundle (latent) → fix นี้ป้องกันอนาคต.

### B1 — ขาย bundle (สินค้าชุด) แล้ว "ยกเลิก/ลบบิล" → สต็อก children ไม่ถูกคืน = สต็อกหายถาวร
**ไฟล์:** `main.js:3697` (`_appDeductStockSmart`) · `pos.js:1209` (sale_items) · `main.js:3278-3294` (revert + Phase 471 filter)

**หลักฐาน (verified อ่านโค้ดจริง):**
1. ขาย bundle → `_appDeductStockSmart` ตัดสต็อก **children** ทีละตัวผ่าน `_deductStockForSaleItem` → log movement `type=sale` ใต้ **child product_id** (note มี `[bundle:ชื่อ]` + orderNo) — `main.js:3726-3732`
2. แต่ `sale_items` เก็บ `product_id: item.id` = **ตัว bundle แม่** — `pos.js:1209`
3. ตอน revert: `deductedIds` = set ของ product_id จาก `sale` movements = **child ids** (`main.js:3272`) → loop เช็ค `deductedIds.has(item.product_id)` โดย `item.product_id` = **แม่** → `false` → `continue` ข้ามทั้งบรรทัด (`main.js:3291`)
4. ผล: **children ไม่ถูกคืน** → สต็อกที่ตัดไปตอนขายหายถาวร

**ความเสี่ยง:** สต็อกจริงหาย (data/money) — ทุกครั้งที่ขาย bundle แล้ว void
**⚠️ เงื่อนไข:** เป็นจริงเมื่อร้าน **มีสินค้า bundle + ขาย + ยกเลิก** จริง — ถ้าตอนนี้ไม่มี bundle = latent (ยังไม่กระทบ). **ต้อง verify ว่าใช้ bundle จริงไหม** (`select count(*) from products where is_bundle = true;`)
**Guard gap:** guard test คุม bundle "ตัด" (`_appDeductStockSmart`) แต่ **ไม่มี test คุม bundle "คืน"**

**แนวทางแก้:** ใน revert loop ถ้า `product.is_bundle` → query `product_bundles` → คืน `child_qty × item.qty` เข้าคลังที่ขาย (mirror `_appDeductStockSmart`); `deductedIds` มี child ids อยู่แล้ว → filter จะทำงานถูกหลัง expand

---

## 🟠 SHOULD-FIX

### S1 — Dead Stock report เพี้ยนทั้งหน้า (แสดงทุกสินค้าเป็น "ไม่เคยขาย/ค้าง") — ✅ RESOLVED build 478 (merged+live 2026-06-18, commit 6e33806)

> **แก้แล้ว:** dead_stock.js เลิกอ่าน `state.saleItems` (ว่าง) → fetch `stock_movements type=sale` ทั้งช่วง (paginate, read-only) → `computeDeadStock` (pure). error→errorHtml+retry (ไม่ fallback all-dead). verified: review+unit 1859+e2e+read-only smoke (dead 286→279 ตาม sale จริง). โบนัส: ขายจริง 90 วัน = 8 ตัว distinct (อาจ sanity-check ว่าน้อยไป — บาง sale ไม่ลง movement? = data question แยก).
**ไฟล์:** `dead_stock.js:44-59`
**หลักฐาน (verified):** `dead_stock.js:45,52` อ่าน `state.saleItems` แต่ **`state.saleItems` ไม่เคยถูก assign** ที่ไหนเลย (`grep "state.saleItems ="` = 0 ผลลัพธ์; `loadAllData` โหลด 15 ตารางไม่มี sale_items — fetch แบบ on-demand ต่อบิลเท่านั้น) → `soldProductIds` ว่างเสมอ → `dead = สินค้าที่มีสต็อก > 0 ทุกตัว` + KPI "มูลค่าทุนค้าง" + "% ของสต็อก" + Excel export ผิดทั้งหมด
**ความเสี่ยง:** read-only (ไม่กระทบเงิน/สต็อกจริง) แต่ **ทำให้ตัดสินใจธุรกิจผิด** (เช่น เทขายล้างของที่จริงขายดี)
**แก้:** โหลด sale_items เข้า state (เฉพาะช่วง cutoff ฝั่ง server — ระวัง cap) หรือทำ dead-stock ผ่าน server RPC

### S2 — saveProduct + CSV import เขียน `products.stock` ตรง → diverge จาก warehouse_stock — ✅ RESOLVED build 479 (merged+live 2026-06-18, commit f89f1d3)

> **แก้แล้ว:** saveProduct มีคลัง → omit `stock` จาก products payload (ปล่อย trigger 403 derive; wh write fail = understated ปลอดภัย ไม่ overstated) + new product seed stock:0 กัน NOT NULL; legacy ไม่มีคลัง = เขียนตรงเดิม. CSV strip stock/min_stock (master-data only) + toast. **ทีม deviate ถูกกว่า prompt:** เก็บ `min_stock` เขียนตรง (trigger 403 derive เฉพาะ stock — phase403:37,52; min_stock ถูกอ่านโดย getDisplayStock→low-stock filter → omit จะ stale). +guard stock_mirror_canonical_guard ขยายคลุม saveProduct+CSV (ไม่อ่อนลง). verified: review + unit 1861 + e2e 14 + EOL + read-only check 0/295 divergent (ระบบสะอาด; fix = preventive กัน wh-fail divergence).
**ไฟล์:** `main.js:1705` (saveProduct) · `products.js:1334` (CSV import)
**หลักฐาน:** payload ส่ง `stock: totalStock` ไปตาราง `products` ตรง ๆ; ปกติ trigger 403 (หลัง warehouse write) ทับให้ถูก **แต่** ถ้า warehouse_stock write บางตัว fail (RLS/network — 474 ดักด้วย `_whFails` + เตือน toast แต่ **ไม่ revert** `products.stock`) → `products.stock` ค้างเกินจริงจนกว่าจะมี warehouse movement ถัดไป re-sync. CSV import: re-import สินค้าที่มี warehouse rows อยู่แล้ว → ทับ `products.stock` โดยไม่แตะ warehouse_stock
**ความเสี่ยง:** สต็อกแสดงเกินจริง → ขายเกินได้ (ผ่าน precheck ที่อ่าน products.stock)
**แก้:** ตัด `stock`/`min_stock` ออกจาก payload `products` เมื่อมี warehouse (ให้ trigger คุมอย่างเดียว — ตรงกับ runtime paths); CSV ก็ route ผ่าน warehouse_stock หรือ strip stock

### S3 — auto-คลัง: ขายได้จริงแต่ติดธง "[สต็อกไม่ครบ]" ผิด (undersell + false flag) — ✅ RESOLVED build 480 (merged+live 2026-06-18, commit 572c382)

> **แก้แล้ว** (verified: review + unit 1869 + e2e 14 + EOL; deviation ถูก—precheck fallback products.stock เมื่อ legacy ไม่มี warehouse row, ตรงกับ deduct legacy): เลือก "precheck สะท้อนคลังเดียว" (ไม่ใช่ spill — คง concept 1-บิล-1-คลัง). +modules/warehouse_pick.js (pure `pickAutoWarehouseStock`) = single source ของ auto-pick (บ้านก่อน/max stock); deduct (main.js) + precheck (pos.js) ใช้ helper เดียวกัน → คลังตรงกัน 100% กัน false flag. legacy ไม่มี warehouse row → null → precheck fallback `products.stock` (= ค่าที่ deduct legacy branch ตัดจริง main.js:3211 → consistent; deviate จาก "block" ใน prompt เพราะ block จะขวาง legacy ที่ขายได้). block message ระบุ "คลัง {ชื่อ} มี {N}" + "เลือกคลังอื่น". +guard precheck_single_warehouse (8) + ปรับ pos_warehouse_deduct/checkout_precheck (intent เดิม). unit 1869 · e2e 14. ดู HANDOFF build 480.
**ไฟล์:** `pos.js:1098` (precheck) vs `main.js:3138` (auto pick)
**หลักฐาน:** precheck (build 473) เทียบ qty กับ `products.stock` = **ผลรวมทุกคลัง**; แต่ deduct auto หยิบ **คลังเดียว** (`stocks[0]` บ้าน-first) ไม่ spill ข้ามคลัง → ของ 3(บ้าน)+4(รถ)=7 ขาย 5 → precheck ผ่าน แต่ตัดบ้านได้ 3 → ติดธง `[สต็อกไม่ครบ]` ทั้งที่ของพอ (fails closed = undersell ไม่ใช่ oversell)
**แก้:** auto path loop ตัดข้ามคลายจนครบ (CAS ทีละคลัง) แล้วค่อย flag ถ้า total ทั้งหมดไม่พอ — หรือ precheck สะท้อนคลังเดียว

### S4 — bundle child qty ไม่ validate NaN — 🔧 FIX บน branch `claude/phase-481-product-save-validation` (build 481, รอ owner smoke + Codex review · ยังไม่ merge · รวมกับ S5)

> **แก้ (รอ review):** +modules/product_validation.js `normalizeBundleQty(v)` = `Number.isFinite(q)&&q>0?q:1`; ใช้ที่ qty input edit + insert payload (filter row ไม่มี child_product_id) + add-button guard เปลี่ยนเป็น `!Number.isFinite||<=0` (เดิม `qty<=0` ปล่อย NaN รอด). ดู HANDOFF build 481.
**ไฟล์:** `main.js:2083` (set qty) · `main.js:1784` (insert)
**หลักฐาน:** `items[idx].qty = Number(inp.value || 1)` → พิมพ์ `"2ก"` = `NaN` → ส่งเข้า `product_bundles` → null/corrupt. build 474 fix NaN ให้ price/cost/stock แต่ **ตก bundle qty**
**แก้:** `const q = Number(inp.value); items[idx].qty = Number.isFinite(q) && q > 0 ? q : 1;` + filter qty > 0 ก่อน insert

### S5 — ไม่เช็ค SKU / barcode ซ้ำตอน save — 🔧 FIX บน branch `claude/phase-481-product-save-validation` (build 481, รอ owner smoke + Codex review · ยังไม่ merge · รวมกับ S4)

> **แก้ (รอ review):** +`findDuplicateProduct(state.products,{sku,barcode},editingProductId)` (เช็ค barcode ก่อน/sku, exclude self, ค่าว่างข้าม) ใน saveProduct ก่อน write → เจอ → App.confirm allow-proceed (cancel→ไม่ save; modal ไม่พร้อม→toast ไม่ block). **ไม่เพิ่ม DB unique index** (client warn ก่อน — owner กดต่อได้; DB partial unique = follow-up ถ้าต้องการ hard-block). ดู HANDOFF build 481.
**ไฟล์:** `main.js:1698-1738`
**หลักฐาน:** saveProduct validate ชื่อ + price>0 + auto-gen SKU แต่ไม่เช็ค barcode/SKU ซ้ำ; ไม่พบ DB unique constraint ใน repo → 2 สินค้า barcode เดียวกันได้ → สแกน POS ได้ผิดตัว (first match wins เงียบ ๆ)
**แก้:** เช็ค `state.products` ก่อน insert (ยกเว้น row ที่กำลังแก้) + เตือน; ในระยะยาวทำ partial unique index ฝั่ง Supabase

### S6 — revert `deductedIds` keyed by product_id เฉย ๆ (ไม่รวม warehouse)
**ไฟล์:** `main.js:3269,3291`
**หลักฐาน:** edge case สินค้าเดียวกันหลายบรรทัดในบิล ตัดบางบรรทัด → movement 1 อันทำให้ `has(id)`=true ทุกบรรทัดของสินค้านั้น → คืนเกินบรรทัดที่ไม่ได้ตัด (โอกาสน้อย)
**แก้:** match/คืนที่ granularity (product_id, warehouse_id) หรือ reconcile by summed deducted qty

---

## 🔵 NIT
- saveProduct ไม่ปัดเงิน 2 ตำแหน่ง (float drift; inline edit ปัดแล้ว = inconsistent) — `main.js:1676`
- inline POS price edit last-writer-wins (ไม่มี CAS; benign เพราะ price = scalar ไม่ใช่ accumulator) — `pos.js:1450`
- `_applyStockMovement` out-flow CAS fail แบบ non-insufficient ยัง log movement (record การตัดที่ไม่เกิดจริง = reconcile noise) — `main.js:3675`
- stock-count adjust ใช้ `before` จาก cache ไม่ refetch → false-conflict "นับใหม่" ได้ถ้า cache stale (ปลอดภัย ไม่ corrupt) — `main.js:3599`
- `note=ilike.*orderNo*` substring match ไม่ anchored (ปัจจุบัน orderNo = ms timestamp = collision ต่ำ; future-proof = เก็บ order_no column แยก) — `main.js:3269`

---

## ลำดับที่แนะนำ (ทำทีละข้อ — money/stock จะเขียนสเปกให้ review ก่อนแก้)
1. **เช็ค bundle ใช้จริงไหม** → ถ้าใช้ = **B1** แก้ก่อน (สต็อกหายจริง)
2. **S1 dead_stock** — รายงานเพี้ยนตอนนี้ (เห็นผลทันที)
3. **S2** (stock divergence) → **S3** (false flag) → **S4/S5/S6**
4. NIT — ทยอยเก็บ

---

## หมายเหตุการตรวจ
- ไม่มีการแก้/commit ใด ๆ — read-only audit
- finding B1, S1, S2 (runtime pattern), dead_stock = **verified โดยอ่านโค้ดจริง**; ที่เหลือ = sub-audit รายงาน + cross-check (ระบุ file:line ให้ตรวจซ้ำได้)
- CAS/floor/idempotency/transfer/470/472/dual-stock-trigger/loadAllData/468/XSS/permission = **ตรวจแล้วผ่าน** (ไม่ใช่บั๊ก)
