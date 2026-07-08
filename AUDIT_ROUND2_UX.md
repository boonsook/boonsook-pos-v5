# 📋 AUDIT รอบ 2 — UX / Navigation / localStorage (2026-07-07)

> ตรวจบน `origin/main` @ `2894a11` (build 568 + Phase 569) โดย reviewer (Claude analyst session) —
> 5 ด้าน: navigation/routing · localStorage integrity · re-render/listener · silent failure · data caps/PWA.
> ทุก finding ผ่านการ verify จากโค้ดจริง (อ้าง `file:line`) และตัว Blocking หลัก reviewer เปิดโค้ดยันซ้ำเองแล้ว
> **ไฟล์นี้คือคิวงานเฟสถัดไป** — ทีม implement หยิบทีละเฟส (รอ prompt จาก reviewer ต่อเฟส) ห้ามทำรวบ

## นิยามเลขเฟส
เลขเฟส = ลำดับแนะนำ (571 ขึ้นไป ต่อจาก build 570 settings-bounce+catalog ที่กำลังทำ) — owner สลับลำดับได้

---

## 🔴 กลุ่ม Blocking (เงิน/ข้อมูลเสียหาย/แอปตาย)

### ✅ Phase 571 — POS `_checkoutKey` ถูกล้างโดย background reload → บิลซ้ำได้ — DONE (MERGED+LIVE build 571, PR #149 `93c3a67`, 2026-07-07)
- `modules/pos.js:242` — `renderPosPage` ทำ `_checkoutKey = null` ทุกครั้ง แต่ `renderAll()` (หลัง `loadAllData` ที่ deferred 10s–2min) ก็เรียก renderPosPage ด้วย → จังหวะ retry หลัง checkout timeout ได้ key ใหม่ → `uq_sales_checkout_key` ดัก replay ไม่ได้ = บิลซ้ำ/ตัดสต็อกซ้ำ/JV ซ้ำ
- แก้: reset key เฉพาะเมื่อ `state.cart` ว่าง (cart ไม่ว่าง = intent เดิม) + อัปเดต `tests/checkout_key_credit_guard.test.js` (ปัจจุบัน assert พฤติกรรมที่เป็นช่องโหว่ — ระบุเหตุผลใน PR ตาม §5)
- 🔻 follow-up คงค้าง: ปิด edge committed-but-errored ให้สนิท = reset key ตอน cart→0 ผ่าน `removeFromCart` (edge แคบ, ทำแยกเฟสถ้าจัดคิว)

### ✅ Phase 572 — `TOKEN_REFRESHED` trigger `afterLogin()` เต็มชุด → ทั้งแอป re-render เองทุก ~1 ชม. — DONE (MERGED+LIVE build 572, PR #150 `ee233fe`, 2026-07-08; owner smoke login/boot preview ผ่าน)
- `main.js:993-1003` — `onAuthStateChange` ไม่ filter event type → token refresh (ทุก ~1 ชม. + ตอน tab กลับ focus) รัน afterLogin → loadAllData → renderAll → หน้า reset (นี่คือ "ต้นน้ำ" ของอาการหน้าเด้ง/ฟอร์มหาย ที่ Phase 570 แก้ปลายน้ำ)
- แก้: เช็ค `_event` — `TOKEN_REFRESHED`/`USER_UPDATED` → อัปเดต `window._sbAccessToken` แล้ว return; afterLogin เฉพาะ transition logged-out→in (+ same-user guard `_appSessionUserId` กัน boot รันซ้ำ 2-3 รอบ)

### Phase 573 — JSON.parse ตอน boot ไม่มี try/catch → key เดียวเสีย = แอปขาวถาวร (selfheal กู้ไม่ได้)
- `main.js:284-288` (cart/lastReceipt/storeInfo/paymentInfo — รันตอน module eval, throw = main.js ไม่โหลดทั้งไฟล์) + `modules/customer_dashboard.js:15` (`bsk_cust_cart` — ลูกค้าติดหน้าเปล่าถาวร)
- Corruption vector จริง: หน้ากู้ backup (`modules/settings/pages.js:240-250`) restore `bsk_*` โดยไม่ validate JSON
- แก้: helper `safeParse(key, fallback)` (pattern มีแล้ว `main.js:1238`) + validate JSON ใน restore loop + selfheal เพิ่มการล้าง `bsk_*` ที่ parse ไม่ผ่าน

### Phase 574 — receipts multi-payment: PATCH ล้มแต่ UI+JV เดินต่อ (สำเร็จปลอม)
- `modules/receipts.js:1354` — `await window._appXhrPatch?.(...)` ไม่เช็คผล (xhrPatch ไม่ throw — คืน `{ok:false}`) → mutate state + void/repost JV (`:1361`) + toast สำเร็จ ทั้งที่ DB ไม่ถูกแก้ → GL ไม่ตรง receipts
- แก้: เช็ค `res?.ok` ก่อน optimistic ทุกบรรทัด (catch `:1365` restore ปุ่มอยู่แล้ว) + guard test

### Phase 575 — quotations: โหลด items ล้มเป็น `[]` เงียบ + save ไม่เช็คผล → ลบรายการทั้งใบแบบเงียบได้
- `modules/quotations.js:1016/1039/200/1348` — fetch items ล้ม → `_lineItems=[]` ไม่มี toast; `:962` xhrDelete + `:973` loop xhrPost ไม่เช็คผล → scenario: เปิดแก้ตอนเน็ตสะดุด → ฟอร์มว่าง → กดบันทึก → DELETE items ทั้งใบ + toast สำเร็จ
- แก้: (ก) catch ต้อง toast+block เข้าฟอร์ม/convert (ข) เช็คผล delete + `failedItems` แบบ Phase 412 (`:1396-1399`) (ค) กัน save เมื่อ edit ใบเดิมที่มีรายการแต่ `_lineItems.length===0`

### Phase 576 — income_overview + dashboard: ตัวเลขเงินจาก state ที่ cap → โชว์ผิดเงียบ
- `modules/income_overview.js:54-90` ทั้งหน้า (POS/web/service + กราฟรายเดือนปีนี้) จาก `state.sales` cap 50 + `state.serviceJobs` cap 50 — footer `:146` อ้างว่าตรง P&L ซึ่งไม่จริง
- `modules/dashboard.js:446-448,458,465-469` — expenses cap 200 + serviceIncome/webOrders cap 50 → "กำไรสุทธิเดือนนี้"/การ์ดรายจ่ายปีเพี้ยน (Phase 562 แก้เฉพาะ sales)
- แก้: ขยายโครง `_dashSalesRows`/`fetchSalesSince` (Phase 562, `sales_fetch.js`) ครอบ expenses + service_jobs ช่วงปี

---

## 🟡 กลุ่ม Should-fix (จัดเป็นเฟสถัด ๆ ไป)

### Phase 577 — กำไร/รายจ่าย cap ที่เหลือ
- `modules/profit_report.js:111-117` expenses จาก state cap 200 → กำไรสุทธิสูงเกินจริง (sales แก้แล้ว Phase 492 — แก้ครึ่งเดียว)
- `modules/expense_overview.js:60` rolling N เดือน ไม่มี limit → PostgREST cap 1000

### Phase 578 — loyalty points จาก `state.loyaltyPoints` cap 500
- `modules/loyalty.js:389-409, 34-59` + `modules/customer_dashboard.js:131-132` — ยอดแต้มรายลูกค้า (ที่ลูกค้าเห็นเอง) + summary เพี้ยนเมื่อธุรกรรมรวมเกิน 500 (คงเหลือติดลบได้ — earn เก่าหลุดหน้าต่างก่อน redeem) · redeem จริงปลอดภัย (server enforce Phase 540/541)
- แก้: balance รายลูกค้า query DB ตรง/RPC sum

### Phase 579 — receipts page: ยอดรวม (เงิน) + ค้นหา + Excel บน cap 50
- `modules/receipts.js:199-267` — stat "ยอดรวม" คือ 50 ใบล่าสุดไม่มี label; ค้นใบเก่าไม่เจอ; Excel ไม่ครบ → server-side search (pattern `serials.js:36`) + aggregate DB/label

### Phase 580 — period close-readiness: fail-safe-green + 1000-cap
- `modules/accounting/periods.js:120-124,134` — บิลทั้งเดือน cap 1000 + `id=in.(1000 ids)` URL ~8KB เสี่ยง fail → catch → การ์ดโชว์ "JE ครบ ✅" ทั้งที่ตรวจไม่ครบ → paginate + fail=unknown ⚠️ (semantics แบบ `:152-160`)
- คู่กัน: `modules/accounting/backfill.js:187,204` — เครื่องมือ backfill เองก็ cap 1000 เงียบ (ไม่ double-post — unique index กันอยู่)

### Phase 581 — POS view sticky (UX แคชเชียร์)
- `modules/pos.js:237-244` — renderAll ระหว่างพิมพ์ → numpad/ยอด/ค้นหา/จอเด้งกลับ home (cart รอด) → ทำ `refreshPosPage()` แบบ products (`main.js:1288`) · รวม `pos.js:2165-2168` (เพิ่มลูกค้า inline แล้วเด้ง home)

### Phase 582 — JV form header หาย + settings listener leak
- `modules/accounting/journal_form.js:104-115` — กด "+ เพิ่มบรรทัด" (`:207-210`) re-render → วันที่ back-date/type/คำอธิบายเด้งกลับ default เงียบ → เสี่ยงลงผิดงวด → snapshot header แบบ quotations (`quotations.js:535-550`)
- `modules/settings/index.js:36,105` — `navigate-settings` listener ลงซ้ำไม่จำกัด (doubling ต่อการกดกลับจากหน้า store) → bind ครั้งเดียว/module flag
- คู่กัน: settings ฟอร์มร้าน/ชำระเงิน ไม่ preserve ค่าที่พิมพ์ (`store.js`, `payment.js:76-89`)

### Phase 583 — logout hygiene (PII/attribution)
- `main.js:1045-1076` logout ไม่เรียก `clearCurrentStaff()` (auth.js:52) → PIN session (ชื่อ/เบอร์/role) ค้างข้าม account + `staff_sessions.logged_out_at` ไม่ set
- `bsk_last_receipt` (มี customer_name) ไม่ถูกล้างตอน logout
- ปุ่ม "ออกจากระบบ" ใน topbar profile menu = dead (`main.js:4961` เรียก `window.__authLogout?.()` ที่ไม่มีใคร assign — auth.js เป็น dead module) → เรียก `logout()` ตรง
- `modules/settings/payment.js:243-281` + `main.js:566/540` — QR ไม่ compress + `setItem` นอก try → quota เต็ม = เซฟล้มทั้ง local+cloud แต่ toast สำเร็จ

### Phase 584 — PWA update UX + offline queue visibility
- `boot.js:37-41` ปุ่ม "อัปเดตเลย" no-op เมื่อไม่มี `reg.waiting` (ไม่มี feedback/fallback reload) · `:92-102` reload พึ่ง controllerchange ทางเดียว · `:63` `isReallyNewBuild` fetch fail → return false = banner ถูกทิ้งทั้ง session
- time_clock offline queue: ไม่มี `online` listener/boot drain (drain เฉพาะเปิดหน้า time clock), self view ไม่มี badge ของค้าง, batch fail ทั้งชุด = เงียบ (`time_clock.js:750-756,902`) → ลงเวลา offline หายจาก payroll ได้เงียบ ๆ

### Phase 585 — เก็บเล็ก (บันทึกไว้ รวมทำทีเดียว)
- `bsk_quote_template_pending` write-only → ปุ่ม "ใช้ template" เป็น no-op (`quote_templates.js:274-281`) — ต่อ consumer หรือถอด
- cash recon = device-local (เงิน!) — sync ขึ้น Supabase หรือ label "เฉพาะเครื่องนี้" (`cash_recon.js:169,345,364`) + fetch fail โชว์ 0 เงียบ + cache ไม่ retry (`:179-197`)
- `bsk_category_order` device-local → ปุ่มหมวด POS แต่ละเครื่องเรียงไม่เหมือนกัน (`products.js:586,2504`) → ย้าย app_settings
- `bsk_product_settings` ghost key (มี reader ไม่มี writer — `main.js:1238,3216`) → confirm intent
- quotations PDF `.then` ไม่มี catch + ไม่ guard `window.jspdf` (`quotations.js:1235-1244`) · solar ตรวจสลิป catch เงียบ (`solar.js:679-681`)
- fetch ไม่มี timeout: `credit_tracker.js:70`, `service_request.js:240`, `api.js appAuthFetch`, hr/payroll bulk
- stock_movements ค้นหา/ตัวนับบน cap 200 (`stock_movements.js:56-65`) · customer portal ประวัติจาก cap 50 (`customer_dashboard.js:135-157`) · Nit ชุด: sales/quotations/DI ไม่มี label "50 ล่าสุด", warranty 500, serials 200 (ค้นหา server-side ถูกแล้ว), listener ESC ค้าง (product_detail_modal/ac-spec-editor/ac-stock-form), hrEmployeeModal โดน renderAll ลบ, backfill `_running` ไม่มี finally, dashboard `buildTimeBuckets` local clock

---

## ✅ ที่ตรวจแล้วแข็งแรง (อ้างอิงเป็นต้นแบบ)
- Route guard ครบทุกทางเข้า (`canAccessPage`) + boot restore validate role · deep-link `#products?cat=` ทำงานครบ
- products/customers/quotations/service drafts มี sticky/snapshot pattern ที่ถูกต้อง (ใช้เป็นต้นแบบแก้ POS/JV/settings)
- drawer หลัก 5 ตัวเป็น static DOM นอก page sections → รอด renderAll
- ปุ่ม save หลักทุกตัว restore สถานะครบ (ไม่พบ Phase-476-style ค้างเพิ่ม) · boot overlay มี auto-hide fallback
- งบบัญชี TB/P&L/BS + export_bundle paginate ครบ (Phase 496) · products/customers/warehouse_stock โหลดครบ (Phase 366)
- offline queue กันซ้ำด้วย client_uuid + 409=success (ฝาก owner ยืนยัน unique index `staff_attendance` บน prod)
- ไม่มี interval UI re-render ที่ชน input · scanner force-stop ตอนเปลี่ยน route

## ลำดับแนะนำ
**571 (เงิน, จิ๋ว) → 572 (ต้นน้ำ re-render, จิ๋ว) → 573 (boot-death, เล็ก) → 574 (จิ๋ว) → 575 → 576** จากนั้น 577-580 (ตัวเลขเงิน/บัญชี) แล้วค่อยกลุ่ม UX 581-585 — เฟส 571-574 เป็นงานเล็กทั้งหมด (แก้จุดเดียว+guard test) เหมาะทำติดกันรวดเดียว
