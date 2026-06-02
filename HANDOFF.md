# 📋 HANDOFF — Boonsook POS V5 PRO

> 🆕 **เปิด session ใหม่? อ่าน [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) ก่อน** (canonical protocol) แล้วตามด้วย [`SESSION_START_SHARED.md`](SESSION_START_SHARED.md) + ส่วนล่าสุดของ HANDOFF/CHANGELOG
> 🆕 และ [`SESSION_LOG.md`](SESSION_LOG.md) — push history, SQL tracker, audit progress
> ⚠️ `CLAUDE_SESSION_HANDOFF.md` / `CLAUDE_CODE_PROMPT.md` / `CLAUDE_CODE_WORKFLOW.md` = **superseded** (historical) — เป็น redirect ไป `IMPLEMENT_TEAM_PROTOCOL.md` แล้ว อย่าใช้เป็น workflow หลัก

**อัปเดตล่าสุด:** 2 มิถุนายน 2026 (Phase 355 air-quotation-save-linkback — อ้างอิงงานต้นทางลงใน note ตอนกดบันทึก, build 355) · ⏸️ **STOP — รอ owner/Codex review ก่อนเริ่ม Phase 356**
**Version:** 5.66.0 (build 355) — Phase 355 air-quotation-save-linkback (append อ้างอิงงานแอร์ลง note ตอนกดบันทึกเอง; preserve note เดิม + กัน duplicate; ไม่ save อัตโนมัติ/ไม่เปลี่ยน job status/ไม่แตะ stock/POS/cart/schema)
**Previous:** 5.66.0 (build 354) — Phase 354 quotation-air-draft-polish (banner+source summary+back-to-job+price warning+customer hint)
**Pre-prev-0:** 5.66.0 (build 353) — Phase 353 air-job-to-quotation-draft-action (ปุ่ม→quotation draft)
**Pre-prev-1m:** 5.66.0 (build 352) — Phase 352 air-job-filter-and-priority
**Pre-prev-1l:** 5.66.0 (build 351) — Phase 351 service-job-air-source-visibility
**Pre-prev-1k:** 5.66.0 (build 350) — Phase 350 service-request-air-form-polish
**Pre-prev-1j:** 5.66.0 (build 349) — Phase 349 service-request-air-booking-polish (summary card + intent + prefill)
**Pre-prev-1i:** 5.66.0 (build 348) — Phase 348 remove-customer-cart-tab
**Pre-prev-1h:** 5.66.0 (build 347) — Phase 347 air-catalog-public-store-sync (storefront + booking flow)
**Pre-prev-1g:** 5.66.0 (build 346) — Phase 346 air-catalog-to-quotation-draft (→ ใบเสนอราคา)
**Pre-prev-1f:** 5.66.0 (build 345) — Phase air-catalog-not-real-stock-correction (wording ≠ สต็อกจริง)
**Pre-prev-1e:** 5.66.0 (build 344) — Phase air-stock-manager-safe-step (แยก 3 ประเภท — localStorage)
**Pre-prev-1d:** 5.66.0 (build 343) — Phase inventory-action-menu + category-collapse (UI/markup/CSS — สินค้า/คลัง)
**Pre-prev-1c:** 5.66.0 (build 342) — Phase inventory-mobile-polish (UI/CSS safe wins — สินค้า/คลัง)
**Pre-prev-1b:** 5.66.0 (build 341) — Phase sales-doc-mobile (CSS/markup — เอกสารขาย)
**Pre-prev-1:** 5.66.0 (build 340) — Phase mobile-layout follow-up #3 (AI entry UX inline แทน FAB)
**Pre-prev0:** 5.66.0 (build 339) — Phase mobile-layout follow-up #2 (ซ่อน AI FAB ตาม route บนมือถือ)
**Pre-prev:** 5.66.0 (build 338) — follow-up (FAB icon-only) · 337 = mobile-layout (overlap 4 จุด)
**Pre-prev2:** 5.65.0 (build 336) — Phase 92.66 (verify-slip แนบ Supabase JWT × 4 caller — client only, no SQL)
**Pre-prev:** build 335 = 92.65 (AutoKey JWT) · 334 = 92.64 (VAT split Dr=Cr) · 333 = 92.63 (profit XSS/TZ + payroll log) · 332 = 92.62 recurring · 331 = 92.61 refund (+SQL ✓)

> 🆕 **ไม่มี SQL/RLS/schema change ในเฟส 92.64** (client helper เท่านั้น)
> 🏁 **FINANCE AUDIT CLOSED ที่ build 334** — ครบทุกข้อ: #1✓✓ #2✓ #3✓ #4✓ #5✓ #6✓ #6b✓ #7✓(dead code ลบแล้ว) #8✓ #9✓
> ✅ **#9 period-lock DB trigger VERIFIED** (gangboo query DB, 2026-06-01): `journal_entries` → trigger `trg_check_period_locked` → function `check_period_not_locked` → insert เข้า period ที่ locked ถูกกันที่ DB จริง (เส้นแบ่งความปลอดภัยตาม CLAUDE.md 4.3)

---

## 🛠️ Phase 355 air-quotation-save-linkback — อ้างอิงงานต้นทางลงใน note ตอนกดบันทึก (build 355)

**เป้าหมาย:** เมื่อกดบันทึกใบเสนอราคาที่มาจากงานแอร์ (`source=air_job`, build 353/354) → ฝังข้อมูลอ้างอิงงานต้นทางลงใน `note` (field เดิม) เพื่อ trace ได้ว่าเอกสารนี้สร้างมาจากงานแอร์ใด — โดยไม่เปลี่ยน workflow/status งานบริการ, ไม่ auto-save, ไม่แก้ schema.

**Scope/ข้อห้าม:** ❌ save quotation อัตโนมัติ/ก่อนกดบันทึก · ❌ เปลี่ยน service job status · ❌ POST/PUT `service_jobs` · ❌ stock/products/POS/cart · ❌ SQL/schema · ❌ เปลี่ยน save endpoint · ❌ กระทบ draft 346 (catalog)/action·polish 353-354.

**Fix (`modules/quotations.js` เท่านั้น):**
1. **2 pure exported helpers** (testable):
   - `buildAirJobNoteRef(meta)` — เฉพาะ `meta.source === "air_job"` → `สร้างจากงานแอร์: {serviceJobNo|#serviceJobId} | {สั่งจอง|สอบถามราคา} | {แบรนด์ รุ่น BTU} | ราคาเสนอ {price} บาท`. ไม่มี job id → fallback `"สร้างจากงานแอร์จากแคตตาล็อก"`. source อื่น (air_catalog/null) → `""`.
   - `appendAirJobNoteRef(existingNote, meta)` — idempotent: source ไม่ใช่ air_job → คืน note เดิม; note มี marker `"สร้างจากงานแอร์"` อยู่แล้ว → ไม่ append ซ้ำ; มี note เดิม → ขึ้นบรรทัดใหม่ต่อท้าย (preserve ของผู้ใช้).
2. **`saveQuotationFull` payload.note** = `appendAirJobNoteRef(qt_note.value.trim(), _airDraftMeta)` — inject **เฉพาะตอนกดบันทึกเอง** (เป็นจุดเดียวที่เขียน note).
3. **reset `_airDraftMeta = null`** ใน post-save block → กด save อีกครั้งไม่ append ซ้ำ (คู่กับ marker-check = double-safe).

**กลไกกัน duplicate:** marker `"สร้างจากงานแอร์"` เป็นทั้งข้อความอ่านง่าย (ไทย ไม่ใช่ raw technical) **และ** ตัวตรวจซ้ำ — (ก) แก้เอกสารเดิม: `openEditForm` ไม่ตั้ง `_airDraftMeta` (null) → ref="" → note ที่ load มา (มี marker อยู่แล้ว) คงเดิม. (ข) กด save ซ้ำในฟอร์มเดิม: `_airDraftMeta` ถูกเคลียร์หลัง save แรก + ถึงไม่เคลียร์ marker-check ก็กันอยู่.

**ยืนยันไม่เปลี่ยน job status / ไม่แตะ stock·POS·cart·schema:** guard test — `quotations.js` ไม่มี `xhrPost("service_jobs"`/`xhrPatch("service_jobs"`/`rest/v1/service_jobs` (service_jobs ปรากฏแค่ `showRoute` navigation จาก build 354); ปุ่ม `qtBackToJob` ไม่มี status/save; ไม่มี addToCart/saveCustCart/_custCart/`.stock=`/`from("products")`; note ใช้ field เดิม (ไม่เพิ่มคอลัมน์/ไม่แก้ SQL).

**Verify:** lint:errors 0 · unit **1010** (+13 `air_quotation_save_linkback.test.js`: format job no/intent/รุ่น·BTU/ราคา · `#id` เมื่อไม่มี serviceJobNo + ask→สอบถามราคา · fallback ไม่มี job id · source อื่น→"" · append note ว่าง · preserve+append note ผู้ใช้ · re-save ไม่ duplicate · แก้เอกสารเดิม meta=null คงเดิม · air_catalog ไม่แตะ · wiring saveQuotationFull+reset · inject manual-save เท่านั้น (consume block ไม่ save) · ไม่ POST/PATCH service_jobs · ไม่แตะ stock/POS/cart + ไม่เพิ่มคอลัมน์) · **browser smoke (temp chromium, ลบแล้ว):** `buildAirJobNoteRef`/`appendAirJobNoteRef` ใน browser จริง → number grouping (9,000/12,900), dedup, preserve, fallback, air_catalog untouched ตรงกับ unit. e2e 11/11 (build-sync ?v=355). **bump 354→355.**

> ⏸️ **STOP ที่ build 355** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 356.

---

## 🛠️ Phase 354 quotation-air-draft-polish — ขัดเกลาใบเสนอราคารับ draft จากงานแอร์ (build 354)

**เป้าหมาย:** ปรับหน้า quotations ตอน consume draft `source=air_job` (build 353) ให้ชัด/ปลอดภัย: เห็นที่มางาน + ข้อมูลครบ + ทางกลับงานต้นทาง + ยังไม่ save จนกดเอง.

**Scope/ข้อห้าม:** ❌ save quotation/สร้างเลขเอกสารอัตโนมัติ · ❌ stock/products/POS/cart · ❌ SQL/schema · ❌ เปลี่ยน save endpoint · ❌ กระทบ draft 346 (catalog)/service_jobs 351-353.

**Fix (`quotations.js` + `ac_quotation_draft.js` + `service_jobs.js`):**
1. module state `_airDraftMeta` = draft แรก (capture ตอน consume, reset ตอนกลับ list).
2. **banner รวย:** `รายการร่างจาก{งานแอร์|แคตตาล็อกแอร์} N รายการ` + (air_job) source-summary chips: `งานเลขที่ {serviceJobNo}` / intent (`ask`→สอบถามราคา, `booking`→สั่งจอง) / `summary` (airType·brand·model·BTU·price) / `📅 {appointment}`.
3. **price warning:** `priceMissing = isJob && !(offerPrice>0)` → แถบ "⚠️ ยังไม่มีราคา (ต้องเช็คราคา) — กรุณากรอกราคาก่อนส่งให้ลูกค้า" (line item ยังเป็น 0 แต่เตือน visible; **ไม่แตะ saveQuotationFull** — soft warn per spec "อย่างน้อยเตือนก่อน").
4. **back-to-job:** ปุ่ม `#qtBackToJob` เฉพาะ `isJob && serviceJobId!=null` → `_ctx.showRoute("service_jobs")` (bindFormEvents). navigation เท่านั้น.
5. **customer hint:** ใต้หัวข้อ "ข้อมูลลูกค้า" (เฉพาะ `!isEdit && air_job && customer.name`): "ℹ️ เติมจากงานแจ้งบริการ — ... ยังไม่บันทึกลูกค้าใหม่". prefill ใช้ `_airDraftCustomer` (build 353) — ไม่ insert customer.
6. `ac_quotation_draft.pushAirQuoteDraft` + `service_jobs` handler ส่ง `serviceJobNo` เพิ่ม (additive).

**ยืนยันไม่ save/ไม่แตะ stock:** guard — consume block + back-to-job ไม่มี saveQuotationFull/xhrPost/_appXhr/status/customers insert/addToCart/.stock=; เลขเอกสารว่างจนกดบันทึก (smoke: state.quotations=0, #qt_docNo="").

**Verify:** lint:errors 0 · unit **997** (+7: serviceJobNo round-trip · banner source summary · back-to-job เฉพาะมี id + nav-only · price-missing warning · customer hint ไม่สร้าง customer · catalog 346 ยัง "แคตตาล็อกแอร์" + แก้ guard 353 ที่ pin notice เก่า) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** banner "งานแอร์"+chips(งานเลขที่/intent/นัดหมาย), customer hint+prefill, ready job ไม่มี warning / no-price job มี warning, ปุ่มดูงานต้นทาง nav→service_jobs, state.quotations=0 + docNo ว่าง, draft consumed, ไม่มี h-overflow. **bump 353→354.**

> ⏸️ **STOP ที่ build 354** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 355.

---

## 🛠️ Phase 353 air-job-to-quotation-draft-action — ปุ่มสร้างใบเสนอราคาจากงานแอร์ (build 353)

**เป้าหมาย:** ในงานจากแคตตาล็อกแอร์ (service_jobs) เพิ่มปุ่ม "สร้างใบเสนอราคา" → ส่ง draft ไปหน้าใบเสนอราคา (ไม่สร้างเอกสารจริงอัตโนมัติ).

**Scope/ข้อห้าม:** ❌ save quotation อัตโนมัติ · ❌ สร้างเลขเอกสารอัตโนมัติ · ❌ stock/products/POS/cart · ❌ SQL/schema · ❌ เปลี่ยน workflow/status งาน · ❌ กระทบ quotation draft(346)/customer dashboard·service_request(347-350)/filter·priority(351-352).

**Fix:**
1. **`ac_quotation_draft.js`** — `pushAirQuoteDraft` generalize: รับ `item.source` (default "air_catalog") + เก็บ `originalSource/serviceJobId/customerName/customerPhone/summary/intent/appointment` เพิ่ม. **Additive, backward-compatible** — ac-catalog (346) เรียกแบบเดิมยังได้ source=air_catalog.
2. **`service_jobs.js`** — import `pushAirQuoteDraft`; ปุ่ม `data-air-quote="${j.id}"` **เฉพาะ `airMeta.isAir`** (ใน action column ของการ์ด, สีฟ้า "📝 ใบเสนอราคา"); handler: `parseAirJobMeta(job)` → `pushAirQuoteDraft({source:"air_job", originalSource:"air_catalog", serviceJobId, customerName/Phone, summary, btu, offerPrice(parse จาก meta.price), intent, appointment})` + `showRoute("quotations")`. **ไม่เรียก saveQuotationFull/xhrPost/ไม่ตัด stock/ไม่เปลี่ยนสถานะงาน.** งานทั่วไปไม่มีปุ่ม.
3. **`quotations.js`** — `airDraftToLineItem`: ถ้า `d.summary` (air_job) → item_name = summary ตัดส่วนราคา (`split("·")[0]`); else เดิม (air_catalog brand/model/btu). consume เก็บ `_airDraftSource`/`_airDraftCustomer`. notice = "รายการร่างจาก**งานแอร์**" เมื่อ source=air_job (ไม่งั้น "แคตตาล็อกแอร์"). prefill `qt_customerSearch`/`qt_customerPhone` จาก `_airDraftCustomer` **เฉพาะตอนสร้างใหม่** (`!isEdit`). consume-once + ไม่ auto-save (build 346 เดิม).

**ยืนยันไม่ save อัตโนมัติ/ไม่แตะ stock/POS/cart/schema:** guard — handler air-quote ไม่มี saveQuotationFull/xhrPost/_appXhr/qt_no/addToCart/.stock=/rest; consume block ไม่ save; quotations เลขเอกสารยังว่าง (placeholder) จนกดบันทึก; draft = sessionStorage. smoke ยืนยัน `state.quotations.length===0` + `#qt_docNo` ว่าง หลังกดปุ่ม.

**Verify:** lint:errors 0 · unit **991** (+6 `air_job_quotation_draft.test.js`: air_job draft round-trip + consume-once · 346 backward-compat source=air_catalog · ปุ่มเฉพาะ air job · handler stage+nav ไม่ save/ไม่แตะ stock · quotations summary line item + "งานแอร์" notice + customer prefill · ไม่ auto-save; + แก้ guard เดิม 346/351/352 ที่ pin ค่าเก่า) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** air job มีปุ่ม / general ไม่มี → กด → quotations form "งานแอร์" notice + line item MFS10 + customer prefill + เลขเอกสารว่าง + state.quotations=0 + draft consumed + ไม่มี h-overflow. **bump 352→353.**

> ⏸️ **STOP ที่ build 353** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 354.

---

## 🛠️ Phase 352 air-job-filter-and-priority — กรอง + priority งานแอร์ (build 352)

**เป้าหมาย:** เจ้าของร้าน/ช่างหา "งานจากแคตตาล็อกแอร์" ได้ง่าย + เห็นสถานะที่ควรทำต่อ (รอยืนยันราคา/รอนัดหมาย).

**Scope/ข้อห้าม:** READ-ONLY — ❌ SQL/schema · ❌ stock/POS/cart/products · ❌ เปลี่ยน submit endpoint · ❌ กระทบงานทั่วไป · ❌ ใบเสนอราคาอัตโนมัติ.

**Filter logic (`service_jobs.js`):** module state `_sjSourceFilter` (all|air|general); `cAir = count(parseAirJobMeta(j).isAir)`, `cGeneral = total − cAir`; apply หลัง status/tag filter (`air`→`filter(isAir)`, `general`→`filter(!isAir)`). chip row "ที่มา:" โชว์เมื่อ `cAir>0` (ทั้งหมด/🌬️จากแคตตาล็อกแอร์/🔧งานทั่วไป) + handler `[data-sj-source]` re-render. แยกอิสระจาก status filter เดิม (compose ได้).

**Priority logic (`air_job_meta.js` `airPriority(meta)`):** ลำดับ — `appointment` มี → **มีวันนัดหมาย** (เขียว) > `!summary` (ข้อมูลไม่ครบ) → **รอตรวจสอบ** (เทา) > intent `ask` → **รอยืนยันราคา** (เหลือง) > intent `booking` → **รอนัดหมาย** (ฟ้า). `airPriorityBadgeHtml(meta)` → badge "⏳ {label}" ("" ถ้าไม่ใช่งานแอร์). แสดงในการ์ด service_jobs ข้าง air badge. **derive จากข้อมูลเดิม ไม่แตะ status จริงของงาน.**

**ยืนยันไม่แตะ schema/stock/POS/cart:** air_job_meta read-only (guard เดิม); service_jobs เพิ่มแค่ filter (in-memory) + display badge — guard ตรวจไม่มี addToCart/.stock=/quotation/from("products")/alter table.

**Verify:** lint:errors 0 · unit **985** (+4: priority appointment/booking/ask/incomplete · source filter chips+apply+handler+priority badge no-mutation) · **smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** ที่มา-chip (air 2/general 1), priority "มีวันนัดหมาย"+"รอยืนยันราคา", filter air→ซ่อนงานทั่วไป, filter general→ซ่อนงานแอร์+ไม่มี priority badge, งานทั่วไปไม่มี badge, ไม่มี h-overflow. **bump 351→352.**

> ⏸️ **STOP ที่ build 352** — owner สั่งหยุดรอ review ก่อนเริ่ม Phase 353.

---

## 🛠️ Phase 351 service-job-air-source-visibility — เห็นงานจากแคตตาล็อกแอร์ในรายการงาน (build 351)

**เป้าหมาย:** ฝั่งหลังบ้าน/รายการงาน — เจ้าของร้าน/ช่าง/ลูกค้าเห็นว่างานมาจาก "แคตตาล็อกแอร์" + รุ่น/BTU/ราคา/intent.

**Scope/ข้อห้าม:** READ-ONLY — ❌ products/POS/cart/stock · ❌ เพิ่ม/ตัด stock · ❌ ใบเสนอราคาอัตโนมัติ · ❌ SQL/schema (ไม่เพิ่ม column) · ❌ เปลี่ยน submit/workflow/สถานะงาน · ❌ กระทบ service_request ปกติ/quotation(346)/booking(347-350).

**วิธี parse `source=air_catalog`:** marker อยู่ใน `service_jobs.note` ที่ build 350 เขียน (`[source=air_catalog] {airType} {brand} {model} {btu} BTU · {ราคา} | สเปก.. | ประกัน.. | {note} | นัดหมาย {date} {ช่วงเวลา}`). ไฟล์ใหม่ **`modules/air_job_meta.js`**:
- `parseAirJobMeta(job)` — `isAir = /source=air_catalog/.test(note)`; intent จาก description ("สอบถามราคา"→ask, อื่น→booking) หรือ note ("ต้องเช็คราคา"→ask); `summary` = ช่วงแรกหลัง marker จนถึง ` | ` (มี airType/brand/model/BTU/ราคา); `btu`/`price`/`appointment` regex. best-effort, ไม่ crash (null/undefined/ไม่ครบ → `{isAir:false}` หรือ field ว่าง).
- `airBadgeHtml(meta)` = badge ฟ้า "🌬️ จากแคตตาล็อกแอร์ · {สั่งจอง|สอบถามราคา}"; `airJobInfoHtml(meta)` = กล่องสรุป (escape XSS).

**Pages/route ที่เพิ่ม badge:**
1. **`service_jobs.js`** (รายการงานช่าง admin) — `airMeta = parseAirJobMeta(j)`; badge ในแถว status + info box ในการ์ด. งานทั่วไป/ออเดอร์เว็บ (isWebOrder) ไม่โดน.
2. **`customer_dashboard.js`** แท็บ "งานของฉัน" — badge ใต้ type label + info box; **ซ่อน raw `💬 note` block เมื่อ `airMeta.isAir`** (กล่องสรุปแสดงแทน — ไม่โชว์ `[source=air_catalog]` ดิบให้ลูกค้า).

**Detail view (item 5):** กล่อง "รายการจากแคตตาล็อกแอร์" แสดง inline ในการ์ดรายการอยู่แล้ว (เห็นรุ่น/BTU/ราคา/นัดหมายโดยไม่ต้องเปิด) — ไม่แตะ edit drawer/workflow.

**Filter chip (item 4):** **เลื่อนเป็น phase ถัดไป** ตามที่ spec อนุญาต (ทำ badge/card ก่อนให้ปลอดภัย).

**ยืนยันไม่แตะ stock/POS/cart/schema:** air_job_meta ไม่มี fetch/localStorage/sessionStorage/SUPABASE_CONFIG/addToCart/.stock=/rest (guard); service_jobs/customer_dashboard เพิ่มแค่ display string จาก meta (ไม่แตะ mutation เดิม).

**Verify:** lint:errors 0 · unit **981** (+8 `air_job_meta.test.js`: parse booking/ask · normal=no badge · malformed ไม่ crash · marker เฉพาะ note ไม่ใช่ description · badge/info render + XSS escape · air_job_meta read-only · service_jobs+customer_dashboard wired ไม่มี cart/stock/POS/quotation) · **smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** air job → badge + info (รุ่น/BTU/ราคา/นัดหมาย) ทั้ง service_jobs + งานของฉัน; งานทั่วไปไม่มี badge (note ปกติคงอยู่); ไม่โชว์ marker ดิบ; ไม่มี h-overflow. **bump 350→351**.

---

## 🛠️ Phase 350 service-request-air-form-polish — ขัดเกลา UX หน้าแจ้งงาน (build 350)

**เป้าหมาย:** จาก mobile screenshot 349 หน้า service_request ใช้ได้แล้วแต่มี UX ที่ควรปรับ (วันที่กรอบเปล่า, ปุ่ม AI แทรกกลาง flow, รายละเอียดซ้ำกล่องสรุป, หมายเหตุถูกตัด, ไม่มี confirmation ชัด). ปรับ **เฉพาะกรณีมี air_catalog draft** — ไม่กระทบ flow ปกติ.

**Scope/ข้อห้าม:** ❌ products/POS/cart/stock · ❌ เพิ่ม/ตัด stock · ❌ ใบเสนอราคาอัตโนมัติ · ❌ SQL/schema · ❌ เปลี่ยน submit endpoint · ❌ กระทบ service_request ปกติ/quotation(346)/customer dashboard booking(347/348).

**Fix (modules/service_request.js เท่านั้น):**
1. **date/timeslot ชัด:** `#srPrefDate` ได้ `aria-label="เลือกวันที่สะดวก"`/title; `#srPrefTime` option แรก "เลือกช่วงเวลา (ไม่ระบุก็ได้)"; เพิ่ม hint "ยังไม่ระบุก็ได้ — เจ้าหน้าที่จะติดต่อยืนยันเวลานัดหมายอีกครั้ง".
2. **AI button gating:** top button (เด่น) render เฉพาะ `!_isBooking`; เมื่อ `_isBooking` → secondary dashed link "🤖 หรือให้ AI ช่วยกรอกรายละเอียดแทน" ท้ายฟอร์ม (หลังปุ่ม submit). ทั้งคู่ใช้ id `srAiBtn` (render ทีละอัน) → handler `window.BoonsookAI.open()` เดิมผูกได้.
3. **ลดข้อความซ้ำ:** prefill `#srSymptom` สั้น = `{จองติดตั้ง|สอบถามราคา}แอร์ {brand} {model} {btu}` (label "รายละเอียดเพิ่มเติม (ถ้ามี)"); ข้อมูลเต็ม (`[source=air_catalog] airType brand model BTU · ราคา` + spec + ประกัน + note) ย้ายไป `#srNote` ที่ submit ส่งจริง. (prefill ใช้ `if(sym && !sym.value)` กันทับที่ user พิมพ์).
4. **note ไม่ตัด:** `#srNote` เปลี่ยน `input`→`textarea` rows=2 min-height 56px resize.
5. **confirmation:** สำเร็จ → "✅ ส่งคำขอแล้ว! / เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันราคาและเวลานัดหมาย" (booking) + ปุ่ม `#srViewJobs` "📋 ดูงานของฉัน" → `ctx.showRoute("customer_dashboard")` (fallback hash). non-draft = wording เดิม. toast intent-aware.

**submit เดิมไม่เปลี่ยน:** manual click → POST `/rest/v1/service_jobs` (status pending), ใช้ `finalNote` (note + นัดหมาย จาก 349). description=symptom (สั้น), note=ข้อมูลครบ → เจ้าหน้าที่เห็นครบ.

**Verify:** lint:errors 0 · unit **973** (+7 `service_request_air_form_polish.test.js`: date hint/aria · AI gating (top !_isBooking / secondary _isBooking) · short symptom + source ใน note + label "รายละเอียดเพิ่มเติม" · note textarea min-height · confirmation+ดูงานของฉัน · submit endpoint+ไม่มี cart/stock/POS/quotation · normal flow ไม่กระทบ) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** booking→AI อยู่ท้าย (หลัง submit), date hint, symptom สั้น (<80, ไม่มี source ในช่อง), note textarea มี source=air_catalog, submit→confirmation "ส่งคำขอแล้ว"+ดูงานของฉัน, reload no-draft→top AI กลับมา, ไม่มี h-overflow. **bump 349→350**.

---

## 🛠️ Phase 349 service-request-air-booking-polish — หน้าแจ้งงานรับ booking แคตตาล็อกแอร์ (build 349)

**เป้าหมาย:** ปรับ `service_request` (รับ booking draft จาก 347) ให้สวย/ชัด: แสดงว่ามาจาก "แคตตาล็อกแอร์" + ข้อมูลรุ่น/BTU/ราคา/ประเภท, intent-aware, นัดหมาย — ปลอดภัย.

**Scope/ข้อห้าม:** ❌ ไม่แตะ stock/products/POS/cart · ❌ ไม่ตัดสต็อก/เพิ่มคลัง · ❌ ไม่สร้างใบเสนอราคาอัตโนมัติ · ❌ ไม่แก้ SQL/schema · ❌ ไม่กระทบ quotation draft (346)/booking (347/348).

**Fix:**
1. **`ac_booking_draft.js` + `customer_dashboard._book`** — booking draft พก `note`/`spec`/`warranty` เพิ่ม (additive; old drafts → "" ไม่ crash). 347/348 flow ไม่พัง.
2. **`service_request.js`:**
   - **consume-once** `consumeAirBookingDrafts()` (เดิม 347) — อ่านแล้วลบ → reload ไม่เติมซ้ำ; draft เสีย/ไม่มี → ไม่ crash (try/catch).
   - **intent vars:** `_isAsk = intent !== "booking"` (รองรับ price_inquiry/ask_price), `_heading`, `_submitLabel`, `_priceTxt` (ราคาเสนอ | "ต้องเช็คราคา").
   - **summary card** "🌬️ รายการจากแคตตาล็อกแอร์": ประเภท/แบรนด์·รุ่น/BTU/ราคา/ประกัน/สเปก + chip intent + disclaimer "ยังไม่ใช่การซื้อจริง...ยังไม่ได้ส่ง".
   - **heading/ปุ่ม intent-aware:** booking→"📅 สั่งจอง/แจ้งติดตั้งแอร์" + "📨 ส่งคำขอจอง/แจ้งงาน"; ask→"💬 สอบถามราคาแอร์" + "📨 ส่งคำขอสอบถามราคา"; ไม่มี draft = เดิม "🛠️ แจ้งซ่อม/บริการ" + "📨 ส่งคำแจ้งซ่อม".
   - **prefill:** `#srType`=ติดตั้งแอร์; `#srSymptom`=label+airType+brand+model+BTU+price+spec+`[source=air_catalog]`; `#srNote`=รุ่น+note+ประกัน.
   - **นัดหมาย (ใหม่):** `#srPrefDate` (date) + `#srPrefTime` (select ช่วงเวลา) — **optional, map ลง `note` ตอน submit** (`finalNote = note + " | นัดหมาย <date> <time>"`) → **ไม่แก้ schema** (service_jobs ไม่มีคอลัมน์ appointment).
   - **submit เดิมไม่เปลี่ยน:** manual click → POST `/rest/v1/service_jobs` (status pending, job_type=resolveJobType). ใช้ `finalNote` แทน `note`.

**ยืนยันไม่แตะคลัง/POS/cart:** guard test — service_request ไม่มี addToCart/saveCustCart/_custCart/`.stock=`/quotation/`from("products")`; prefill/consume ไม่ POST (POST เฉพาะตอนกดปุ่ม); appointment ไป note ไม่ใช่คอลัมน์ใหม่.

**Verify:** lint:errors 0 · unit **966** (+9 `service_request_air_booking.test.js`: draft พก note/spec/warranty · _book ส่งต่อ · consume not peek · summary card+disclaimer · intent label · prefill type/symptom/note · นัดหมาย→finalNote · no cart/stock/POS/quotation · submit flow intact) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** booking→card+ปุ่ม "ส่งคำขอจอง"+prefill source=air_catalog; ask(price=0)→"ต้องเช็คราคา"+"ส่งคำขอสอบถามราคา"; นัดหมาย fields มี; reload→card หาย (consumed); cart ว่าง; ไม่มี h-overflow. **bump 348→349**.

---

## 🛠️ Phase 348 remove-customer-cart-tab-for-air-catalog — เอา tab "ตะกร้า" ออก (build 348)

**เป้าหมาย:** หน้าร้าน/customer_dashboard เป็น flow **จอง/สอบถามราคา** (build 347) แต่ยังมี tab "🛒 ตะกร้า" → ลูกค้าเข้าใจผิดว่าซื้อทันที. เฟสนี้เอา tab ตะกร้า + cart/checkout wording ออกจากหน้าร้านแอร์.

**Scope/ข้อห้าม:** ❌ ไม่ลบ cart/POS logic ทั่วระบบ · ❌ ไม่กระทบ POS/งานขายจริง · ❌ ไม่แตะ stock/products core/Supabase/SQL · ❌ ไม่กระทบ quotation draft (346)/booking draft (347).

**Fix (customer_dashboard.js + style.css):**
1. **ตัด `{id:"cart"}` ออกจาก tab nav array** → เหลือ ร้านค้า/ประวัติซื้อ/งานของฉัน/แต้มสะสม (ไม่มี cartCount badge แล้ว).
2. **guard `if (_custTab === "cart") _custTab = "shop"`** ต้น render → สาขา `else if (_custTab==="cart")` (cart UI 393-558) + checkout handlers (839-1140) **คงไว้แต่ unreachable (dormant)** — ไม่ลบ (กัน regression + เคารพ "ห้ามลบ cart logic"). cartCount/cartTotal/saveCustCart/_custCart ยังถูกอ้างใน dead branch → ไม่มี unused-var.
3. ปุ่มการ์ดยังเป็น `data-book` → `_book` (booking draft → service_request) จาก 347 — ไม่แตะ.
4. **style.css @media≤768:** เพิ่ม `body[data-route="customer_dashboard"] #bs-help-fab { display:none }` (กัน help FAB ทับการ์ด) — รวมในบล็อกเดียวกับ products/wh_*. **คนละปุ่มกับ AI `#bs-ai-fab`** (build 340 มือถือซ่อน AI FAB อยู่แล้ว).

**ยืนยันไม่กระทบ POS/cart จริง:** `modules/pos.js` ไม่แตะ (POS ใช้ cart ของตัวเอง คนละ store); customer_dashboard cart logic = dormant ไม่ถูกลบ; guard test ยืนยัน pos.js + saveCustCart ยังอยู่. `_custTab` ไม่ persist (default "shop") → ไม่มีทางเข้าสาขา cart.

**Verify:** lint:errors 0 · unit **957** (+4: no cart tab in nav · _custTab guard · help-fab hide customer_dashboard mobile (ไม่แตะ AI FAB) · POS/cart logic preserved) · **smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** tab ไม่มี cart, ไม่มีคำ ตะกร้า/เพิ่มลงตะกร้า/ชำระเงิน/คงเหลือ, กดสั่งจอง→service_request, `bsk_cust_cart` ว่าง, ไม่มี h-overflow. **bump 347→348**.

---

## 🛠️ Phase 347 air-catalog-public-store-sync — หน้าร้านอ่านแคตตาล็อกแอร์ชุดเดียวกัน (build 347)

**เป้าหมาย:** หน้าหลัก/ร้านค้า (customer_dashboard) แสดงแอร์จาก **แคตตาล็อกชุดเดียวกับหน้าจัดการ** (`bsk_ac_catalog`) แต่**แยกจากคลังจริง 100%**; ปุ่ม "สั่งจอง" = booking/lead ไม่ใช่ addToCart/POS.

**Source เดิมของหน้าร้าน:** customer_dashboard อ่าน `bsk_ac_catalog` อยู่แล้ว (line ~180) แต่ map เป็น "products" + เข้า **cart→checkout** (สร้าง service_jobs). ปุ่มเดิม: stock>0 → "🛒 เพิ่มลงตะกร้า" (addToCart), stock≤0 → "📞 สั่งจอง" (toast). filter เดิม = by brand (section).

**Scope/ข้อห้าม:** ❌ ไม่ผูก products/POS · ❌ ไม่เพิ่ม/ตัด stock · ❌ ไม่รวมมูลค่า inventory · ❌ "สั่งจอง" ไม่ใช่ addToCart/POS · ❌ ไม่กระทบ quotation draft (346) · ไม่แตะ SQL.

**Fix:**
1. **customer_dashboard.js** — เพิ่ม `_acStatusOf` (price≤0→check, price>0&&stock>0→ready, อื่น→inactive); `visibleProducts` = products ที่ไม่ใช่ inactive (ซ่อน "เลิกขาย"). filter dropdown เปลี่ยนเป็น **ประเภทแอร์** (`p._acType` = `acTypeOf`, AC_TYPES 3 อัน) นับจาก visibleProducts. การ์ดใหม่ `_acCardHtml` (BTU/แบรนด์/รุ่น/ราคาเสนอ/รวมติดตั้ง/spec inverter·R32·warranty) ปุ่ม `data-book` → "📅 สั่งจอง"(ready)/"💬 สอบถามราคา"(check). **เลิกใช้ addToCart สำหรับ card แอร์** — ลบ `_addToCart`/`_reserve`/`data-add-cart`; เพิ่ม `_book`/`_bindBook`/`_openAcDetail`. notice "ราคาสำหรับเสนอขาย กรุณารอเจ้าหน้าที่ยืนยัน". **cart tab + checkout เดิมคงไว้ (dormant)** — ไม่มี path เพิ่มของเข้าตะกร้าแล้ว (follow-up: เอา tab ตะกร้าออกได้ภายหลัง).
2. **ไฟล์ใหม่ `modules/ac_booking_draft.js`** — sessionStorage `bsk_air_booking_draft` (push/consume-once/peek). `_book` → `pushAirBookingDraft({source:"air_catalog",catalogId,airType,brand,model,btu,offerPrice,intent})` + `showRoute("service_request")`. **ไม่ addToCart/ไม่ตัด stock/ไม่ POS/ไม่ save**.
3. **service_request.js** — `consumeAirBookingDrafts()` ต้น render (อ่านแล้วลบ) → prefill `#srSymptom` ("สนใจสั่งจอง/สอบถามราคา {airType} {brand} {model} {btu} BTU (ราคาเสนอ ...) [source=air_catalog]"), `#srNote`, `#srType`→ "❄️ ติดตั้งแอร์"; notice banner "ยังไม่ได้ส่ง". **submit เดิมไม่แตะ — user กดส่งเอง** (manual).
4. **product_detail_modal.js** — opts `reserveOnly` + `ctaLabel`: โหมดจอง (ปุ่มเดียว → onReserve, ไม่มีตะกร้า). backward-compatible (caller เดิมไม่ส่ง = พฤติกรรมเดิม).

**ยืนยันไม่แตะคลังจริง:** _book ไม่มี `_custCart`/addToCart/saveCustCart/`.stock=`; booking draft = sessionStorage (หายเมื่อปิดแท็บ); consume ใน service_request ไม่ POST (prefill เท่านั้น); customer_dashboard ไม่ import pos/stock_cas/products module; การ์ดไม่มีคำว่า สต็อก/คงเหลือ.

**Verify:** lint:errors 0 · unit **953** (+11 `air_catalog_store_sync.test.js`: booking helper push/consume-once/sessionStorage-only · storefront อ่าน bsk_ac_catalog + filter by type · ซ่อน inactive · card data-book ไม่มี add-cart/คงเหลือ · disclaimer · _book no cart/stock/POS · ไม่ import products/POS · service_request consume+prefill ไม่ auto-submit · quotation draft 346 intact) · **flow smoke (temp, ลบแล้ว) mobile 390×844 + desktop:** storefront โหลด, การ์ดจาก catalog, filter ประเภททำงาน, ซ่อนเลิกขาย, กดสั่งจอง → service_request prefilled "ยังไม่ได้ส่ง", cart ว่าง, booking draft consumed, ไม่มี h-overflow. **bump 346→347**.

---

## 🛠️ Phase 346 air-catalog-to-quotation-draft — "นำไปเสนอราคา" → รายการร่างในใบเสนอราคา (build 346)

**เป้าหมาย:** ปุ่ม "นำไปเสนอราคา" (build 345 เป็น nav-only) ตอนนี้**ส่งข้อมูลรุ่นแอร์เป็น draft item** เข้าฟอร์มใบเสนอราคา. **ไม่สร้างใบเสนอราคาจริงอัตโนมัติ** + **ไม่แตะคลังจริง**.

**Scope/ข้อห้าม:** ❌ ไม่เพิ่ม/ตัด stock จริง · ❌ ไม่ผูก products/POS/cart/billing/stock-core · ❌ ไม่ save Supabase จนกว่าผู้ใช้กดบันทึกเอง · ❌ ไม่แก้ SQL/schema · ❌ ไม่เปลี่ยน import/export format.

**กลไก draft (ไฟล์ใหม่ `modules/ac_quotation_draft.js`):** bridge ผ่าน **sessionStorage** key `bsk_air_quote_draft`.
- `pushAirQuoteDraft(item)` — append draft (source/catalogId/airType/brand/model/btu/offerPrice/estimatedCost/sku/note).
- `consumeAirQuoteDrafts()` — **อ่านแล้วลบ** (consume-once) → กันเติมซ้ำตอน re-render/reload.
- `peekAirQuoteDraftCount()`.

**Flow:**
1. `ac-catalog.js` ปุ่ม `data-ac-quote` → `pushAirQuoteDraft({...})` + toast "เพิ่มเป็นรายการร่าง..." + `showRoute("quotations")`.
2. `quotations.js` `renderQuotationsPage` (ต้นฟังก์ชัน ก่อน clear block) → `consumeAirQuoteDrafts()`; ถ้ามี → `_editingId=null; _viewMode="form"; _lineItems = drafts.map(airDraftToLineItem); _airDraftNotice = n`.
3. `airDraftToLineItem(d)` → `{product_id:null, item_name:"${airType} ${brand} ${model} ${btu} BTU"(+note), qty:1, unit:"เครื่อง", unit_price:offerPrice, line_total, _source:"air_catalog", _estCost, _catalogId}`. marker `_*` **in-memory เท่านั้น** — save (line ~810) เลือกเฉพาะ product_id/item_name/qty/unit/unit_price/discount_pct/line_total/sort_order → ไม่ persist marker, ไม่แตะ schema.
4. ฟอร์มโชว์ notice "🌬️ มีรายการร่างจากแคตตาล็อกแอร์ N รายการ — ยังไม่ได้บันทึกเอกสาร". `_airDraftNotice` reset เป็น 0 เมื่อกลับ list (clear block).

**ยืนยันไม่แตะคลังจริง:** quote handler ไม่เรียก addToCart/_appXhr/SUPABASE_CONFIG/products; consume block ไม่เรียก saveQuotationFull/xhrPost; draft อยู่ sessionStorage (หายเมื่อปิดแท็บ); estimatedCost เก็บเป็น trace ไม่เข้า quotation_items (ฟอร์มไม่มี cost column). existing save flow `qtSaveBtn→saveQuotationFull` ไม่แตะ.

**Verify:** lint:errors 0 · unit **942** (+9 `air_catalog_quotation_draft.test.js`: push→sessionStorage · consume returns+clears+ไม่ re-consume · multi-push · estCost null · helper sessionStorage-only · quotations consume→form ไม่ auto-save · line item product_id:null · notice "ยังไม่ได้บันทึก" · existing save flow intact; + ac guard quote test = stage-draft+nav ไม่แตะ stock/cart) · **flow smoke (temp Playwright, ลบแล้ว) mobile 390×844 + desktop:** catalog → กด "นำไปเสนอราคา" → ฟอร์มเปิดพร้อม notice + line item "แอร์ติดผนัง TCL... MFS10 9,000 BTU", `state.quotations` ยัง 0 (ไม่ save), sessionStorage ถูก consume, render ซ้ำ (reload) ไม่เติม row เพิ่ม, ไม่มี h-overflow. **bump 345→346**.

---

## 🛠️ Phase air-catalog-not-real-stock-correction — แคตตาล็อกทำราคา ≠ สต็อกจริง (build 345)

**Context (owner clarify):** หน้าแอร์ (Settings → ac-catalog) **ไม่ใช่สต็อกจริงในร้าน** — เป็น **แคตตาล็อกสำหรับตั้งราคา/เลือกสินค้าไปทำใบเสนอราคา** ก่อนค่อยสั่งของหรือเพิ่มเข้าคลังจริงภายหลัง. build 344 ตั้งชื่อ "จัดการสต็อกแอร์" สื่อผิด → เฟสนี้แก้ wording.

**Scope:** **wording/UI/UX เท่านั้น** — ❌ ไม่ผูก products/POS · ❌ ไม่รวมมูลค่าคลัง · ❌ ไม่นับ stock จริง · ❌ ไม่แตะ stock-core/billing/cart/Supabase/SQL · ❌ ไม่ migration. (ยังเป็น localStorage `bsk_ac_catalog` เดิม — คนละ store กับ products)

**Fix (ac-catalog.js + ac-stock-form.js + menu.js):**
1. หัวข้อ "จัดการสต็อกแอร์" → **"จัดการแคตตาล็อกแอร์"** + subtitle box "ใช้สำหรับตั้งราคา/ทำใบเสนอราคา — ไม่ใช่สต็อกจริงในคลัง" + menu label.
2. wording: summary `มีสต็อก/หมดสต็อก` → `พร้อมเสนอขาย/ยังไม่เปิดขาย`; **ลบ "คงเหลือ"** จากการ์ด; ปุ่มเสี่ยง `ตั้งสต็อก 5 เครื่อง` → `ตั้งค่าเริ่มต้นแคตตาล็อก` (confirm เดิม, set พร้อมเสนอขาย); `+ เพิ่มเข้าคลัง` → `📝 นำไปเสนอราคา`.
3. **`นำไปเสนอราคา` (`data-ac-quote`)** = navigation อย่างเดียว → `ctx.showRoute("quotations")` (fallback `location.hash`). **ไม่ตัดคลัง/ไม่ persist/ไม่แตะ cart** (เดิม `data-ac-addstock` prompt บวก stock — ลบทิ้งเพราะสื่อว่าเป็นคลังจริง).
4. การ์ด: แบรนด์/รุ่น/BTU/**ราคาขายเสนอ**/**ต้นทุนประมาณการ**/**กำไรประมาณการ**(price−cost ถ้ามี cost)/รหัสอ้างอิง(sku)/หมายเหตุ + **badge 3 สถานะ**: `price≤0`→ต้องเช็คราคา(amber) · `price>0 && stock>0`→พร้อมเสนอขาย(green) · `price>0 && stock≤0`→เลิกขาย(gray).
5. ฟอร์ม: `ราคาขาย`→`ราคาขายเสนอ`, `ต้นทุน`→`ต้นทุนประมาณการ`, `จำนวนสต็อก`→`สถานะเสนอขาย` (>0=พร้อมเสนอขาย; field key `stock` ภายในคงเดิม).

**หมายเหตุ semantics:** field `stock` ในแคตตาล็อกนี้ถูก reframe เป็น **"สถานะเสนอขาย" (>0=เปิด)** ไม่ใช่จำนวนในคลัง — ไม่เปลี่ยน data key (กัน customer_dashboard ที่อ่าน `c.stock>0` เพื่อโชว์ "พร้อมส่ง" พัง). tabs 3 ประเภท + fallback "wall" + import/export 24-col คงเดิม.

**Verify:** lint:errors 0 · unit **933** (14 `ac_stock_manager_guard.test.js`: rename+subtitle · misleading words removed (คงเหลือ/เพิ่มเข้าคลัง/มีสต็อก/หมดสต็อก/พร้อมส่ง) · offer wording · 3-state badge+cost/profit · นำไปเสนอราคา nav-only ไม่ mutate · setStock5 reworded+confirm · import/export ids · export 24-col · form fields · NOT wired to products/POS/API) · **mobile smoke 390×844 (temp, ลบแล้ว):** title+subtitle, badge 3 แบบ, กำไรฯแสดง, "นำไปเสนอราคา" → showRoute("quotations") + localStorage **ไม่เปลี่ยน**, ไม่มี h-overflow. **bump 344→345**.

---

## 🛠️ Phase air-stock-manager-safe-step — จัดการสต็อกแอร์ แยก 3 ประเภท (build 344)

**Scope (SAFE STEP):** ปรับ "จัดการแคตตาล็อกแอร์" (Settings → ac-catalog) เป็น **"จัดการสต็อกแอร์"** แยก 3 ประเภท. **localStorage (`bsk_ac_catalog`) เท่านั้น** — **ไม่แตะ** auth/API/DB schema/billing/cart/stock-core, **ไม่เปลี่ยน format import/export** (Excel/CSV คง 24 คอลัมน์เดิม), **ไม่ลบข้อมูลเดิม**, **ไม่ bulk-migrate**. หน้านี้แยกจากตาราง products/POS (คนละ store) — consumers (`customer_dashboard.js`, `main.js`) อ่าน field เดิมอย่างเดียว → เพิ่ม `ac_type` เป็น additive ปลอดภัย.

**UX issue:** หน้าเดิมเป็น list grouped-by-brand + ปุ่มเสี่ยง "ตั้งสต็อก 5 เครื่องทุกรุ่น" เด่นโต่ง + ไม่มีฟอร์มเพิ่ม/แก้รุ่น (มีแต่ import + spec editor).

**Fix:**
1. **3 air-type tabs** — `AC_TYPES` (wall/ceiling/cassette = แอร์ติดผนัง/แอร์แขวน/แอร์สี่ทิศทาง) ใน `ac-stock-form.js`. `acTypeOf(c)` = `c.ac_type` ถ้าอยู่ใน 3 keys ไม่งั้น **fallback "wall"** → ข้อมูลเดิม (ไม่มี field) โผล่ใน "แอร์ติดผนัง" โดยไม่ migrate. tab state = module-level `_acTab` (default wall).
2. **summary cards** (scope ตาม tab): รุ่นทั้งหมด/แบรนด์-กลุ่ม/มีสต็อก(stock>0)/หมดสต็อก(stock≤0).
3. **product cards** ต่อ tab: รุ่น/แบรนด์(section)/BTU/ราคา/คงเหลือ/SKU/badge(พร้อมส่ง·หมดสต็อก) + ปุ่ม `แก้ไข`(data-ac-edit→core form) / `+ เพิ่มเข้าคลัง`(data-ac-addstock→prompt +N, localStorage) / `⋯`(data-edit-spec→spec editor เดิม).
4. **header actions**: `+ เพิ่มรุ่นแอร์`(`#acAddModelBtn`) / `📂 นำเข้า Excel`(`#acImportQuickBtn`→trigger `#acCatalogFileInput` เดิม) / `⋯ จัดการเพิ่มเติม`(`.prod-more-menu` reuse build 343) ที่เก็บ: export xlsx/csv, **ตั้งสต็อก5 (เสี่ยง, confirm เดิม)**, refresh-JSON, ล้างทั้งหมด(danger). ทุก id/handler เดิม **ไม่แตะ** — แค่ย้ายที่.
5. **import drop-zone** → section รอง `<details>` "นำเข้า/ส่งออกไฟล์ (ขั้นสูง)"; format เดิม, IDs เดิม (`acCatalogFileInput`/`acCatalogImportBtn`/`acCatalogImportStatus`).
6. **`ac-stock-form.js` (ใหม่)** — modal core fields: ประเภท/แบรนด์/รุ่น/BTU/ราคา/ต้นทุน/สต็อก/SKU/หมายเหตุ. add → default ประเภท = tab ปัจจุบัน, id = max+1; edit → spread ของเดิมครบ (คงสเปกเทคนิค/ประกัน/รูป). `cost/sku/note/ac_type` = ฟิลด์ใหม่ใน localStorage.
7. menu label "คลังสินค้า AC" → "จัดการสต็อกแอร์".

**⚠️ Known limitation (ตั้งใจ — รอบถัดไป):** import ยัง **overwrite** catalog ทั้งก้อน (พฤติกรรมเดิม) + Excel/CSV ยังไม่มีคอลัมน์ ac_type/cost/sku/note → ถ้า user import ทับ ฟิลด์ใหม่จะหาย. รอบนี้ลูกค้าสั่ง "ห้ามแตะ import/export format". รอบหน้าค่อยเพิ่มคอลัมน์ + merge-by-id.

**Verify:** lint:errors 0 · unit **931** (+12 `ac_stock_manager_guard.test.js`: 3 types+labels · acTypeOf fallback wall · rename · 3 tabs · summary · primary buttons · setStock5 ย้ายเข้าเมนู+confirm · import/export ids preserved · export 24-col ไม่เปลี่ยน · form 9 fields · default type ตาม tab · form no-API) · **render smoke (temp Playwright, ลบแล้ว):** mobile 390×844 + desktop 1280 — รีโหลด, 3 tabs, legacy→แอร์ติดผนัง, สลับ tab, +เพิ่มรุ่น default type ตาม tab, edit เปิดฟอร์ม, menu เปิด/ปิด, import section คงอยู่, ไม่มี h-overflow. **bump 343→344**.

---

## 🛠️ Phase inventory-action-menu + category-collapse — จัดหน้า สินค้า/คลัง ให้โล่ง (build 343)

**Scope:** ต่อจาก 342 ที่ทำ safe wins — เฟสนี้ทำ **action menu จริง** ที่ 342 เลื่อนไว้ + category collapse. **UI/markup/CSS** เท่านั้น — ไม่แตะ stock/barcode/import-export/billing/auth/API/pricing. **`id`/`data-action`/handler เดิมครบทุกปุ่ม** (ย้าย markup เข้าเมนูเฉย ๆ — event binding by id / event-delegation by attr ยังหาเจอ).

**Root cause (ความรก):** header 9 ปุ่มเรียงพรืด · per-card 4–6 ปุ่ม · หมวด 18+ อันดันรายการลงไกล.

**Fix (modules/products.js + style.css):**
1. **Header menu** — `.prod-header-actions` เหลือ `#prodImportBtn` + `#prodAddBtn` (primary) + `<details class="prod-more-menu">` "⋯ จัดการเพิ่มเติม". ย้ายเข้า panel: `#prodExportBtn`/`#prodGenAllBarcodesBtn`/`#prodPrintBarcodesBtn`/`#prodManageCatBtn`/`#prodMergeCatBtn`/`#prodBulkModeBtn`/`#prodDeleteAllBtn`. **`#prodDeleteAllBtn` = ปุ่มสุดท้าย** + class `prod-more-danger` (สีแดง + เส้นคั่นบน) → handler เดิม `deleteAllProducts(ctx)` (มี confirm) ไม่แตะ.
2. **Per-card menu** — `renderProductItem` (grid+list) เหลือ `+ บิล` (`data-prod-add`) นอกเมนู + `<details class="prod-card-menu">` "⋯" ที่บรรจุ `data-prod-edit`/`data-prod-stockin`/`data-qr-prod`/`data-prod-print`/`data-prod-del` (เงื่อนไข stock/admin เดิม). delegation `el.querySelectorAll("[data-prod-*]")` ยังผูกได้.
3. **Category collapse** — `CAT_CAP=10`. chip index ≥10 ติด class `prod-cat-extra`; chip ที่ตรง `currentCategory` ติด `is-active`; bar ติด `has-extra` ถ้า > CAP. ปุ่ม `#prodCatToggleBtn` (มี 2 label more/less). CSS `@media≤768`: `.prod-category-bar.has-extra:not(.cat-expanded) .prod-cat-extra:not(.is-active){display:none}` → ซ่อนส่วนเกินยกเว้นที่เลือก. toggle = `classList.toggle("cat-expanded")` (ไม่ re-render — คง scroll).
4. **ล้างตัวกรองทั้งหมด** — `#prodClearAllFilters` โชว์เมื่อ `currentCategory!='all' || currentFilter!='all' || quickFilter || currentTagFilter || searchQuery`; handler reset ครบทุก dimension + `renderView`.

**⚠️ ข้อควรระวัง (เหตุผลออกแบบ):** เมนูใช้ `<details>` **inline-flow** (panel เป็น block ดันเนื้อหา ไม่ใช่ `position:absolute`) เพราะ `.prod-list{overflow:hidden}` + `.panel{overflow-x:auto}` (มือถือ) จะ **clip** dropdown ที่ลอย. Header dropdown = absolute เฉพาะ desktop, inline บนมือถือ. accordion: เปิด details ตัวนึงปิดตัวอื่น (`toggle` listener).

**Verify:** lint:errors 0 · unit **919** (+7: header-menu relocate · ลบทั้งหมด last+danger+confirm · card +บิล/⋯ · accordion+inline no-clip · category collapse · clear-filters) · e2e smoke 11 ✓ (build-sync 343) · **mobile smoke 390×844 (temp Playwright, ลบแล้ว):** header เหลือปุ่มหลัก, เมนูเปิด/ปิด, ลบทั้งหมดสีแดงท้ายเมนู, หมวดย่อโชว์ 10+หมวดที่เลือก, +บิลเด่น, ⋯เปิดเมนูได้, ไม่มี h-overflow. **bump 342→343** (data-app-build + style/main/boot/selfheal `?v=343` + sw cache-v343; semver 5.66.0).

---

## 🛠️ Phase inventory-mobile-polish — จัดหน้า สินค้า/คลัง บนมือถือ (safe wins, build 342)

**Scope (ลูกค้ายืนยัน "safe wins ก่อน"):** UI/CSS เท่านั้น — **ไม่แตะ** stock/barcode/import-export/billing/auth/API หรือ **wiring ของปุ่ม** (`#prodImportBtn`/`#prodAddBtn`/`data-prod-*` ฯลฯ เดิมหมด). **action menu จริง** (header "จัดการเพิ่มเติม" + per-card "...") **เลื่อนรอบหน้า** เพราะต้องย้าย markup ของปุ่มที่ต่อ logic.

**Root cause (ความรก):** 9 ปุ่ม header เรียงพรืด · filter 5 ชั้น (type/warehouse/status/tag/search/quick/category) · per-card 6 ปุ่ม action แน่น · help 💡 FAB ลอยทับรายการ.

**Fix (modules/products.js + style.css):**
1. **summary cards** — เพิ่มแถวการ์ด 4 ใบหลัง `.prod-header` (`products.length>0`): ทั้งหมด/พร้อมขาย(เขียว #16a34a)/ใกล้หมด(ส้ม #d97706)/หมดสต็อก(แดง #dc2626). ใช้ `countTypeAll`/`countInstock`/`countLow`/`countOut` ที่ `renderView` คำนวณอยู่แล้ว — **ไม่มี query ใหม่**. CSS `.prod-summary` grid 4-col (≤400px → 2×2).
2. **filter wrap** — `@media≤768`: `.prod-filter-tabs`/`.prod-type-tabs` `flex-wrap:wrap !important` + `overflow-x:visible` (เดิม nowrap+scroll ซ่อนแท็บ) → เห็นครบ ไม่ทับ.
3. **product card** — `@media≤768`: `.prod-list-right` wrap, price `flex:1`, stock ชิดขวา, `.prod-list-actions` `flex-basis:100%` (ลงแถวเต็มกว้างของตัวเอง ไม่ล้น/ทับ).
4. **help FAB** — `@media≤768`: `body[data-route="products"|"wh_kunkhao"|"wh_kundaeng"|"wh_sikhon"] #bs-help-fab { display:none !important }`. **คนละปุ่มกับ AI `#bs-ai-fab`** (build 340) — guard เช็ค.

**Verify:** lint:errors 0 · unit **913** (+3: summary derive/colors · tabs-wrap+actions-row · help-fab-hide ไม่แตะ AI) · Playwright @390×844: summary 4 ใบ in-viewport, status tabs wrap 2 แถว `overlap:false`, per-card action ไม่ overlap, `#bs-help-fab` none (products) vs flex (dashboard); desktop summary 4-col + help-fab flex ปกติ. **bump 341→342** (data-app-build + style/main/boot/selfheal `?v=342` + sw cache-v342; ai-chat-widget คง `?v=9`; semver 5.66.0).

---

## 🛠️ Phase sales-doc-mobile — แก้ layout overlap หน้าเอกสารขาย (build 341)

**Issue:** หน้ากลุ่มงานขายบนมือถือ (ใบเสนอราคา/ใบส่งสินค้า-ใบแจ้งหนี้/ใบเสร็จรับเงิน) มี text/layout overlap 3 จุด.

**Fix (CSS + markup เท่านั้น — ไม่แตะ business/API/auth/accounting):**
1. **status filter tabs ทับกัน** — `.qt-tabs`/`.di-tabs`/`.rc-tabs` เป็น `flex` + `overflow-x:auto` แต่ปุ่ม (`.qt-tab-btn` ฯลฯ) ไม่มี `flex-shrink:0` → flex บีบปุ่ม จนข้อความ `white-space:nowrap` ล้นทับปุ่มข้าง ๆ. **Fix (style.css @media≤768):** containers `flex-wrap:wrap !important` + `border-bottom:0`; buttons `flex:0 0 auto` + `border-radius:999px` (chip) + `border/bg !important` → wrap เป็น chip เห็นครบทุกแท็บ ไม่ทับ. active ยังบอกด้วยสีตัวอักษร (inline). desktop คง underline-tab เดิม.
2. **doc table กว้างเกินจอ** — wrapper เดิม `<div style="overflow-x:auto;margin-top:12px">` (ไม่ใช่ shared). **Fix:** เปลี่ยนเป็น `<div class="table-wrap" style="margin-top:12px">` ใน `quotations.js`/`delivery_invoices.js`/`receipts.js` → ได้ `.table-wrap` mobile (min-width:520px + full-bleed `margin:0 -16px` + scroll) → เลขเอกสาร/สถานะ/ปุ่ม ไม่ถูกตัด/ทับ.
3. **floating help 💡 ทับ row** — `#bs-help-fab` (modules/help_tutor.js, `position:fixed bottom:90px`). **Fix (style.css @media≤768):** `body[data-route="quotations"|"delivery_invoices"|"receipts"] #bs-help-fab { display:none !important }`. ใช้ `body.dataset.route` (มีอยู่จาก build 339). **คนละปุ่มกับ AI `#bs-ai-fab`** — ไม่กระทบ AI flow build 340.

**Verify:** lint:errors 0 · unit **910** (+3 guards: chip-wrap / .table-wrap / help-fab-hide ไม่แตะ AI) · Playwright @390×844 (quotations): tabs 5 อัน wrap 3 แถว `overlap:false` ทุกอันใน viewport, table scrollable, `#bs-help-fab` display none (vs dashboard flex). **bump 340→341** (data-app-build + style/main/boot/selfheal `?v=341` + sw cache-v341; ai-chat-widget คง `?v=9` ไม่ได้แตะ; semver 5.66.0).

---

## 🛠️ Phase mobile-layout follow-up #3 — AI entry UX: inline แทน floating FAB (build 340)

**Issue หลัง build 338/339:** FAB ไม่ทับ bottom nav/settings แล้ว แต่ในหน้า service form (เช่น "ใบงานติดตั้งแอร์") FAB ยัง `position:fixed` ลอยทับ select/input. รากปัญหา: fixed FAB ลอยทับ content เสมอ (content scroll ผ่านหลังได้) — route-gate/icon-only/bottom-padding ไม่พอ.

**UX decision (ลูกค้ายืนยัน: inline-only บนมือถือ):**
- **มือถือ (≤768px):** ไม่มี floating FAB เลย → ใช้ **inline button ในเนื้อหา**
- **Desktop/tablet:** คง FAB เฉพาะ **service flow** (solar / ac_install / service_* ยกเว้น service_jobs — service_request เข้าผ่าน prefix); **เอาออกจาก ai_sales / ac_shop** (มี AI ขายของตัวเอง — `ai_sales.js` หน้า AI ขาย, `ac_shop.js` ปุ่ม `shopGoAi` "ช่วยเลือก")
- **แยกบทบาท copy:** ลูกค้า = "AI ช่วยแจ้งงาน / ลงคิวงาน"; ใบงานช่าง = "AI ช่วยกรอกใบงานนี้"; ขาย = ของเดิม "AI ช่วยขายแอร์"

**สิ่งที่ทำ (UI/UX + CSS — ไม่แตะ API/Auth/business/submit):**
- `ai-chat-widget.js`: FAB base `display:none` (เดิม flex) + allowlist `body[data-route="solar"|"ac_install"|^="service_"(:not service_jobs)] #bs-ai-fab:not(.hidden) { display:flex }` (desktop). `@media ≤768px { #bs-ai-fab { display:none !important } }`. ลบ icon-only/positioning rules เดิม (ไม่ใช้แล้ว). label FAB → "AI ช่วยแจ้งงาน".
- inline buttons (ทุกปุ่ม `?.addEventListener("click", () => window.BoonsookAI?.open())`):
  - `modules/customer_dashboard.js` `#custAiCta` — การ์ด CTA ระหว่าง hero กับ tab nav
  - `modules/service_request.js` `#srAiBtn` — full-width ใต้ h3
  - `modules/service_form.js` `#svAiBtn` · `modules/ac_install.js` `#acAiBtn` · `modules/solar.js` `#solAiBtn` — ในหัว panel ใต้คำอธิบาย
- `BoonsookAI.open()` เดิมรับ 0 args + detect solar/service จาก visible page (greeting ต่างกัน) — reuse ตรง ๆ ไม่แก้ widget logic.

**Verify:** lint:errors 0 · unit **907** (+guards: mobile FAB hidden / desktop route-gate ไม่รวม sales / inline buttons+wiring+copy) · Playwright @390×844: form มือถือ `fabDisplay none`, inline btn `position static` ไม่ overlap select; settings มือถือ FAB none; desktop ac_install FAB flex, settings/ai_sales none. **bump 339→340** (data-app-build + style/main/boot/selfheal `?v=340` + ai-chat-widget `?v=9` + sw cache-v340).

---

## 🛠️ Phase mobile-layout follow-up #2 — ซ่อน AI FAB ตาม route บนมือถือ (build 339)

**Issue หลัง build 338:** icon-only ช่วยให้เล็กลง แต่ `#bs-ai-fab` ยัง `position:fixed` มุมขวาล่าง → **ลอยทับ content** หน้า Settings/เพิ่มเติม (การ์ด "สำรอง / กู้คืน config") เพราะ content scroll ผ่าน**หลัง** fixed FAB ได้ (เพิ่ม bottom padding อย่างเดียวไม่พอ).

**Fix (route-gated visibility — CSS + 1 บรรทัด DOM-state, ไม่แตะ API/Auth/business):**
- `main.js` `showRoute(route)`: เพิ่ม `document.body.dataset.route = route;` (หลัง `state.currentRoute = route`) → เปิดเผย route ปัจจุบันบน `<body>` ทุกครั้งที่เปลี่ยนหน้า (รวม initial load).
- `ai-chat-widget.js` `@media (max-width:768px)`: `#bs-ai-fab { display:none }` เป็นค่าเริ่มต้น + **allowlist** โชว์เฉพาะหน้ากรอกงานจริง:
  `body[data-route="solar"|"ac_install"|"ai_sales"|"ac_shop"] #bs-ai-fab` และ `body[data-route^="service_"]:not([data-route="service_jobs"]) #bs-ai-fab` → `display:flex`.
  (`service_request` + `service_<type>` ทั้ง 9 เข้าผ่าน prefix `service_`; `service_jobs` = list ถูกกัน). allowlist **ไม่ใช้ `!important`** → กฎซ่อนตอน drawer/sidebar/modal เปิด (ที่เป็น `!important`) ยัง override ได้ปกติ.
- desktop ไม่กระทบ (อยู่ใน `@media ≤768px`).

**Verify:** lint:errors 0 · unit **906** (+2 guards: body.dataset.route + route allowlist/no-important) · Playwright @390×844 ตรวจ computed `display` ต่อ route: hidden = dashboard/**settings**/expenses/**service_jobs**/customers · shown = service_request/service_repair_ac/solar/ac_install/ai_sales/ac_shop. **bump 338→339** (data-app-build + style/main/boot/selfheal `?v=339` + ai-chat-widget `?v=8` + sw cache-v339; semver คง 5.66.0).

---

## 🛠️ Phase mobile-layout follow-up — AI FAB icon-only กันบังการ์ด Settings (build 338)

**Issue หลัง build 337:** AI FAB ไม่ทับ bottom nav แล้ว แต่ยัง **บังการ์ดเนื้อหา**หน้า Settings/เพิ่มเติม — โดยเฉพาะการ์ด "สำรอง / กู้คืน config" (FAB เป็น pill กว้างมีข้อความ "AI ช่วยกรอก" → กินพื้นที่มุมขวาล่าง).

**Fix (CSS-only, ไม่แตะ API/Auth/business):**
- `ai-chat-widget.js`: ห่อ label ใน `<span class="bs-fab-label">` + เพิ่ม `title="AI ช่วยกรอก"` (อ่านคู่ `aria-label="เปิด AI ผู้ช่วย"` เดิม). `@media (max-width:480px)` → `#bs-ai-fab { padding:0; width:52px; height:52px; border-radius:50%; gap:0; font-size:22px }` + `.bs-fab-label { display:none }` = **icon-only วงกลม** (เหลือ 🤖, label ซ่อนแต่ a11y/tooltip ยังอยู่).
- `style.css`: `.page` mobile bottom padding 100→**160px** (`@media 768`) และ 100→150px (`@media 400`) → การ์ดท้ายหน้า scroll พ้น FAB (bottom ~72px + สูง) + bottom nav.

**Verify:** lint:errors 0 · unit **904** (+2 guards: icon-only + page padding) · Playwright @390×844 (settings-like page): FAB `52×52 radius 50% labelHidden`, scroll สุด → การ์ด "สำรอง/กู้คืน" `cardBottom 596 < fabTop 720` (พ้น FAB), FAB ยังเหนือ nav. **bump 337→338** (data-app-build + style/main/boot/selfheal `?v=338` + ai-chat-widget `?v=7` + sw cache-v338; semver คง 5.66.0 — follow-up เฟสเดียวกัน).

---

## 🛠️ Phase mobile-layout — แก้ Mobile Overlap 4 จุด (390×844, build 337)

**Scope:** CSS + DOM-state wiring เท่านั้น — **ไม่แตะ** business logic / API / accounting / auth / OCR. ทุก media rule อยู่ใน `@media (max-width:768px)` → desktop ไม่กระทบ.

**Root cause + fix (4 จุด):**
1. **Expenses filter bar ทับกัน** — `.row` (`justify-content:space-between`) + inline `min-width:200px` บน flex children → label/input/ปุ่มเบียดบนจอแคบ. **Fix:** เพิ่ม class `exp-filter-row` (`modules/expenses.js`) + mobile CSS → `> div { flex:1 1 100% !important; min-width:0 !important }` (field เต็มแถว) · `> .btn { flex:1 1 calc(50% - 8px) }` (ปุ่มแบ่งครึ่ง).
2. **Sidebar ถูก bottom nav บัง + ไม่มี state** — `.sidebar` z-index **30** < `.mobile-nav` **40**; toggle เดิมแค่ `.open` ไม่มี backdrop/body class. **Fix:** `style.css` mobile `.sidebar { z-index:60 }` (เหนือ nav 40 + backdrop 50) + `body.sidebar-open { overflow:hidden }`. `main.js`: เพิ่ม `toggleSidebar()`/`closeSidebar()` → คุม `.open` + `body.sidebar-open` + โชว์/ซ่อน `#backdrop` (ซ่อนเฉพาะตอนไม่มี drawer ค้าง). wire `menuToggle`→toggle, backdrop click→`closeSidebar()+closeAllDrawers()`, route change→`closeSidebar()`.
3. **AI FAB ทับ bottom nav + ไม่ซ่อนตอน sidebar เปิด** — `bottom:20px` ชนแถบล่าง ~52px. **Fix:** `ai-chat-widget.js` mobile `#bs-ai-fab { bottom:calc(72px + env(safe-area-inset-bottom)) }` + เพิ่ม `body.sidebar-open #bs-ai-fab` / `body:has(#sidebar.open) #bs-ai-fab` ใน hide list (และ backdrop ที่โชว์ตอน sidebar เปิดก็ทริกเกอร์ rule `body:has(#backdrop:not(.hidden))` เดิมอยู่แล้ว).
4. **Tables ใน panel ถูก clip** — `.table-wrap` มี `overflow-x:auto` อยู่แล้ว แต่ขาดคุมความกว้าง. **Fix:** `.table-wrap { max-width:100% }` → scroll แนวนอนภายใน ไม่ดัน `.panel` (mobile `overflow-x:hidden`) ล้น. (expenses list table wrap อยู่แล้ว.)

**Verify:** lint:errors 0 · unit **902** (+9 `mobile_layout_guard.test.js`: source guards z-order/state/FAB/filter/table) · Playwright @390×844 (real style.css): `fabClearsNav` true (772<801), filter groups `[340,340,340]`, `tableScrollable` true (360<792), `sidebarZ 60 > backdropZ 50 > navZ 40`, `fabHidden` true ตอน sidebar เปิด. **bump 336→337** (data-app-build + style/main/boot/selfheal `?v=337` + ai-chat-widget `?v=6` + sw cache-v337 + package 5.66.0 + data-app-version 5.66.0).

---

## 🛠️ Phase 92.66 — verify-slip (SlipOK) 401 Auth Fix (follow-up ของ 92.65)

**Root cause:** `/api/verify-slip` อยู่ใน `REQUIRE_AUTH_ENDPOINTS` (functions/_middleware.js, Phase 89.14) → middleware `verifyAuthToken` ต้องการ Supabase JWT (3-part) ใน `Authorization: Bearer`. caller "🤖 ตรวจสลิป" **ทั้ง 4 จุด** ยิงแบบมีแค่ `Content-Type` ไม่มี token → โดน 401 ก่อนถึง SlipOK = ฟีเจอร์ตรวจสลิปการโอน (verify การโอนเงินของลูกค้า) พังทั้งหมด นี่คือ follow-up ที่ Phase 92.65 ระบุไว้ (pattern เดียวกับ AutoKey เป๊ะ)

**caller ที่แก้ (เพิ่ม token guard + `Authorization: Bearer window._sbAccessToken` + จับ 401):**
- `main.js` `_verifySlip` (service drawer, line ~2505)
- `modules/service_form.js` `_doVerifySlip` (line ~227)
- `modules/ac_install.js` `_verifyAcSlip` (line ~242)
- `modules/solar.js` `_verifySolSlip` (line ~513)

**สิ่งที่ทำ (ต่อ caller):**
- อ่าน `window._sbAccessToken` **ตอนเรียก verify** (กันทั้ง path ปุ่ม "ตรวจ AI" + auto-verify ตอน payment=โอน/QR) → ไม่มี token → guard แสดง "เข้าสู่ระบบก่อนตรวจสลิป" ก่อนยิง (ไม่เปลือง SlipOK quota)
- แนบ `Authorization: Bearer <token>` ใน fetch · server ตอบ **401** (token หมดอายุ/เพิกถอนระหว่างทาง) → จับแยกแสดง "เข้าสู่ระบบใหม่" แทน `❌ Unauthorized: ...` กว้าง ๆ
- **ไม่ fallback `|| cfg.anonKey`** — anonKey = `sb_publishable_...` ไม่ใช่ JWT → `verifyAuthToken` reject (`parts.length !== 3`) = 401 อยู่ดี (pattern เดียวกับ `ai-chat-widget.js` / `line_notify.js` / AutoKey 92.65)

**Behavior preserved:** flow upload สลิป (ใช้ anonKey storage upload — ถูกต้อง, คนละ endpoint) / preview / auto-verify / ปุ่มตรวจซ้ำ / แสดงผล verification เดิม · ไม่แตะ `functions/api/verify-slip.js` (server) · ไม่มี SQL/RLS

**Gate:** lint:errors 0 · unit 893 (+24 `verify_slip_auth.test.js`: source-guard × 4 call site) · build 335→336

---

## 🛠️ Phase 92.65 — AutoKey (parse-receipt) 401 Auth Fix

**Root cause:** `/api/parse-receipt` อยู่ใน `REQUIRE_AUTH_ENDPOINTS` (functions/_middleware.js, Phase 89.14) → middleware `verifyAuthToken` ต้องการ Supabase JWT (3-part) ใน `Authorization: Bearer`. ปุ่ม AutoKey "🔍 ให้ AI วิเคราะห์ใบเสร็จ" ใน `modules/expenses.js` (`_openAutoKeyModal`) ยิงแบบไม่มี header เลย → โดน 401 ก่อนถึง Gemini = ฟีเจอร์ AutoKey สแกนใบเสร็จในหน้า รายรับ-รายจ่าย พังทั้งหมด

**สิ่งที่ทำ (`modules/expenses.js`, `_openAutoKeyModal`):**
- อ่าน `window._sbAccessToken` **ตอนกดวิเคราะห์** (ไม่ใช่ตอนเปิด modal — เผื่อ token refresh ระหว่างทาง) → แนบ `Authorization: Bearer <token>`
- ไม่มี token → `_akShowAuthError()` guard ก่อนยิง (ไม่เปลือง Gemini quota) · server ตอบ **401** (token หมดอายุ/เพิกถอน) → จับแยกแสดง "เข้าสู่ระบบใหม่" แทน "Server ตอบไม่ใช่ JSON" กว้าง ๆ
- **ไม่ fallback `|| cfg.anonKey`** — anonKey = `sb_publishable_...` ไม่ใช่ JWT → `verifyAuthToken` reject (`parts.length !== 3`) = 401 อยู่ดี (pattern เดียวกับ `ai-chat-widget.js` / `line_notify.js` ที่ยิง require-auth endpoint)

**✅ Related (แก้แล้วใน Phase 92.66):** `/api/verify-slip` ก็อยู่ใน `REQUIRE_AUTH_ENDPOINTS` เหมือนกัน — caller ทั้ง 4 (`main.js:2505`, `service_form.js:227`, `ac_install.js:242`, `solar.js:513`) เดิมยิงแบบไม่มี token → 401 เช่นกัน → แก้ครบใน Phase 92.66 (build 336) ด้วย pattern เดียวกัน (ดูหัวข้อด้านบน)

**Behavior preserved:** flow OCR/parse/แสดงผล/back-button เดิม · ไม่แตะ `functions/api/parse-receipt.js` (server) · ไม่มี SQL/RLS

**Gate:** lint:errors 0 · unit 869 (+6 `expenses_autokey_auth.test.js`: source-guard บน `_openAutoKeyModal`) · build 334→335

---

## 🛠️ Phase 92.64 — Balance Sale VAT Journal Split (audit #4)

**Root cause:** `postJournalForSale` VAT split (auto_post.js) ใช้ Dr=`total`, Cr=`subtotal_before_vat`(DB) + `vat_amount`(DB) ที่ปัดเศษแยกกัน → ผลรวมอาจ ≠ total → `_postJournal` balance guard (tol 0.01): drift >0.01 reject JV เงียบ (revenue หาย), ≤0.01 ผ่านแต่ TB เพี้ยนสะสม

**สิ่งที่ทำ (modules/accounting/auto_post.js):**
- `import round2` จาก `../utils.js`
- `splitSaleVatLines(total, vatAmount)` (exported, pure) → `{total:round2(total), vat:round2(vatAmount), subtotal:round2(total-vat)}` → Dr(total)===Cr(subtotal+vat) ภายใน satang เสมอ (residual เศษเข้า revenue line)
- VAT-split block ใช้ helper: Dr `v.total` / Cr revenue `v.subtotal` / Cr 2170 `v.vat` (เลิกเชื่อ sale.subtotal_before_vat)

**Behavior preserved:** path ไม่มี VAT (2-line Dr=Cr=amount) เดิม · refund/expense/payroll/service/delivery (2-line) ไม่แตะ · COA mapping/formula ไม่เปลี่ยน · balance guard คงอยู่ · ไม่มี SQL

**Gate:** lint 0 · unit 863 (+7 auto_post.test.js: inclusive/exclusive/drift/edge/2-line/refund-regression) · e2e 11 · build 333→334

---

## 🛠️ Phase 92.63 — Finance Audit Quick Wins (#5 XSS / #6b TZ / #8 log)

**สิ่งที่ทำ:**
- **#5 (security)** `modules/profit_report.js` — import `escHtml`; wrap `${escHtml(p.productName)}` (ตารางสินค้า) + `${escHtml(c.category)}` (ตารางค่าใช้จ่าย) → ปิด stored-XSS จากชื่อสินค้า/หมวดที่มาจาก DB
- **#6b (TZ)** profit_report default range → `addDaysBkk(-30)`/`todayBkk()` (ถอด `formatDateForInput` local-TZ); `modules/profit_by_product.js` cutoff (30d/เดือน/ปี) → `todayBkk()`/`addDaysBkk()` แทน `toISOString()` UTC
- **#8 (audit)** `modules/payroll.js` — catch ของ `_createSalaryExpense` + `postJournalForPayroll` เพิ่ม `logActivity('payroll_expense_failed'/'payroll_journal_failed', {error, paid_at, method, employee_id})` (best-effort) → failed money side-effect ตามรอยใน audit log ได้

**Behavior preserved:** ไม่แตะ money math/formula · profit_report month-bucketing (saleDate.getMonth() local) ยังคงเดิม (ICT device ถูกต้อง — residual ความเสี่ยงต่ำ) · ไม่มี schema change

**Gate:** lint 0 · unit 856 (+4 `finance_audit_92_63.test.js`) · e2e build-sync 333 · build 332→333

---

## 🛠️ Phase 92.62 — Recurring Expense: JV + Idempotency + TZ (audit #2/#3/#6)

**สิ่งที่ทำ (modules/recurring_expenses.js):**
- **#2 JV:** `import postJournalForExpense` · `_createExpenseFromRecurring` เปลี่ยน insert เป็น `return=representation` → เรียก `postJournalForExpense(inserted)` (fire-and-forget เหมือน expenses.js) → รายจ่ายประจำเข้าสมุดบัญชีคู่
- **#3 idempotency:** `recurringExpenseTag(id, periodKey)` (exported) = `#recur-{id}-{next_due||today}` ใส่ใน note · `_recurringExpenseExists()` pre-check (note ilike) ก่อน insert → ถ้ามีแล้ว skip insert แต่ยัง advance next_due (recover) · `_reGenBusy` in-flight guard กัน double-click race · generateOne/All คืน "exists" เพื่อ toast แยก
- **#6 TZ:** `todayBkk()` แทน UTC `toISOString().slice(0,10)` ทุกจุด (expense_date/overdue filter/form default) · `_calcNextDue` (exported) เขียนใหม่เป็น **pure integer/UTC math** (split YYYY-MM-DD → คำนวณ) deterministic ไม่ขึ้น runtime TZ; monthly clamp วัน ≤28

**Behavior preserved:** generate flow เดิม (ปุ่ม 💸 สร้าง / สร้างทั้งหมด) · ไม่แตะ schema · expenses ปกติ/payroll JV เดิมไม่กระทบ

**Gate:** lint 0 · unit 852 (+9 `recurring_expenses.test.js`) · e2e build-sync 332 · build 331→332

---

## 🛠️ Phase 92.61 — Refund Over-/Double-Refund Cap (this session, audit fix #1)

**บริบท:** audit หน้าการเงินเจอ — refund modal ตั้ง `max_qty = sale_items.qty` ทุกครั้ง ไม่หักของที่คืนไปแล้ว → เปิดคืนเต็มบิลซ้ำได้ → เงิน+สต็อก+JE รั่ว (loyalty กันแล้ว แต่ amount/stock/JV ไม่กัน)

**สิ่งที่ทำ (modules/refunds.js):**
- `computeRefundableItems(saleItems, priorRefunds)` (exported, pure) → `max_qty = qty เดิม − Σ qty ที่คืนแล้ว`; จับคู่ด้วย `product_id` (fallback ชื่อ ถ้า id null), parse `items_json` ได้ทั้ง object + JSON string, cap `refundedQty` ไม่เกิน qty เดิม (max_qty ไม่ติดลบ)
- `validateRefundWithinRemaining(itemsToRefund, saleItems, priorRefunds)` (exported, pure) → guard ตอน save
- `_fetchRefundsForSale(saleId)` → GET refunds เดิมของบิล (`sale_id=eq.`)
- sale-select handler (async): fetch prior → `computeRefundableItems` → renderItems แสดง "คืนแล้ว N / ครบ" + disable ช่องคืนครบ + ปิดปุ่มถ้าคืนครบทั้งบิล
- save handler: re-fetch + `validateRefundWithinRemaining` ก่อน insert → block + toast ถ้าเกิน (กัน race / modal ค้าง)

**Behavior preserved:** flow refund ปกติ (เลือกบิล→เลือกจำนวน→คืน) เหมือนเดิม · loyalty/stock/JV reversal เดิมไม่แตะ · ไม่มี schema change

**Gate:** lint 0 · unit 843 (+11 `refunds_cap.test.js`) · e2e build-sync 331 · build 330→331

**✅ server-side guard (92.61b):** เพิ่มไฟล์ `supabase-phase92-61b-refund-guard.sql` แล้ว — BEFORE INSERT trigger `trg_guard_refunds_insert` + function `_guard_refunds_insert()` บน `refunds`: รวม qty ใหม่ (NEW.items_json) + ที่คืนแล้ว (refunds เดิม sale_id เดียวกัน) เทียบ sale_items ต่อ product_id → เกิน = RAISE EXCEPTION (ERRCODE 23514). ทุก role, SECURITY INVOKER (auth_all read policies พอ), NOTIFY pgrst reload, rerun-safe. ตรวจเฉพาะ product_id != null (custom item ปล่อย — client จับคู่ชื่อให้).
> **✅ APPLIED:** gangboo รัน `supabase-phase92-61b-refund-guard.sql` ใน Supabase SQL Editor แล้ว (2026-06-01) → trigger `trg_guard_refunds_insert` live ใน DB · refund over/double-refund ถูกกันทั้ง client (92.61) + server (92.61b) แล้ว · (ตรวจ DDL ฝั่ง Claude ไม่ได้เพราะ anon creds — อิง user confirm + VERIFY queries)

---

## 🛠️ Phase 92.60 — HR Overview Premium UI/UX (prev session)

**เป้าหมาย:** ทำหน้า HR ให้ "ดูหรู ดูแพง" ตามที่ user ขอ — visual refresh ล้วน

**สิ่งที่ทำ (modules/hr_overview.js, CSS only):**
- `.hr-page` page gradient background + font-smoothing (เพิ่ม class ที่ root wrapper)
- KPI cards + section panels ทุกใบ: border `#eceff6` + layered shadow + radius 16px (replace_all `border:1px solid #e2e8f0;border-radius:14px`)
- `.hrx-hero` gradient surface + `.hrx-hero h2` gradient-clip title + `.hrx-eyebrow` pill + benefits chips โค้งมน
- `.hrx-toolbar` navy→indigo gradient + glassy chips (backdrop-blur)
- `.hrx-mini-card`/`.hrx-panel` premium + hover lift; `.hrx-mini-icon` radius 13
- bar/donut/vbar gradients → indigo→violet (#4f46e5→#7c3aed); `.hrx-info-card` refined
- KPI hover lift แรงขึ้น + focus ring indigo

**Behavior preserved:** โครงสร้าง HTML/คลาส/logic เดิมทั้งหมด · ไม่แตะ data fetch/SQL/RLS/payroll · unit 837 ผ่านเท่าเดิม (ไม่มี test ใหม่ — visual)

**Gate:** lint 0 · unit 837 · e2e build-sync 330 · build 329→330 (rebased บน Codex 92.59/329)

---

## 🛠️ Phase 92.57 — Export PDF / พิมพ์รายงาน HR (this session)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildHrReportPrintHtml({from, to, employeeRows, empTotals, deptRows, deptTotals, storeName, generatedAt})` (exported, pure) → standalone HTML doc + print CSS + `<body onload="window.print()">`; `escHtml` ทุกค่า (กัน XSS)
  - ปุ่ม "🖨️ พิมพ์ / PDF" ในรายงาน HR → `window.open("","_blank")` + `document.write(html)` + `close()`/`focus()` (auto-print); guard popup-blocked → toast
- **No dependency** — browser-native print, user เลือก "Save as PDF" เองได้ (เลี่ยง jsPDF/dep ตาม CLAUDE.md)

**Gate:** lint 0 · unit 837 (+3) · e2e build-sync 327 · build 326→327

---

## 🛠️ Phase 92.56 — รายงานระดับแผนก (this session)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildDepartmentReport(rows)` (exported, pure) → group per-employee report rows (จาก `buildMonthlyHrReport`) ตาม `department` → `{rows:[{department, headcount, daysWorked, regularHours, otHours, lateCount, earlyLeaveCount, leaveDays}], totals}` · sort headcount desc · bucket "—" สำหรับไม่ระบุแผนก
  - render ตาราง "🏢 สรุปตามแผนก" ใน `_renderMonthlyHrReport` (ใต้ตาราง per-employee, ใช้ `report.rows` เดียวกัน → อัปเดตตาม date-range อัตโนมัติ) + ปุ่ม `hrDeptReportExportBtn` → `hr_dept_report_<from>_<to>.xlsx` (bind ใน `_bindReport`)

**Behavior preserved:** ไม่ fetch เพิ่ม (aggregate client-side) · per-employee report/date-range/timesheet เดิมไม่เปลี่ยน

**Gate:** lint 0 · unit 834 (+3) · e2e build-sync 326 · build 325→326

---

## 🛠️ Phase 92.55 — Timesheet รายคน (this session)

**เป้าหมาย:** ดูตารางเวลารายวันของพนักงาน 1 คน (drill-down)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildEmployeeTimesheet({rows, fromDate, toDate, shiftOpts, attendanceRules})` (exported, pure) → `{days[], totals}` · iterate ทุกวันในช่วง, group attendance ตาม work_date, 1 แถว/วัน (เข้าเร็วสุด/ออกช้าสุด/รวม regular+OT ทุก session/punctuality บน synthesized day row/notes รวม) · วันไม่มีบันทึก = `hasData:false`
  - tab "🗓️ Timesheet" ใน employee modal (MODAL_TABS + modalTabFor + _renderTabTimesheet + _renderModalBody case) · lazy-fetch เดือนปัจจุบัน (`${monthKey}-01`..today) ผ่าน `_fetchUserAttendanceRange` + `timesheetCache` (mirror week-tab pattern)

**Behavior preserved:** ไม่แตะ payroll/leave/accounting · reuse `_fetchUserAttendanceRange` เดิม (limit 200 พอสำหรับ 1 เดือน) · week/payroll tab เดิมไม่เปลี่ยน

**Gate:** lint 0 · unit 831 (+4) · e2e build-sync 325 · build 324→325

---

## 🛠️ Phase 92.54 — HR Report Date-Range Picker + Re-fetch (this session)

**เป้าหมาย:** ต่อยอด 92.53 ให้ผู้ใช้เลือกช่วงวันที่เองได้ (ไม่จำกัดเดือนปัจจุบัน)

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `_fetchReportRange(from, to)` — ดึง `staff_attendance` (work_date gte/lte) + `staff_leaves` (start_date gte/lte) เฉพาะช่วง (staff_leaves graceful)
  - `_renderMonthlyHrReport(report, {from, to, loading})` — เพิ่ม date inputs (`hrReportFrom`/`hrReportTo`) + ปุ่มค้นหา (`hrReportSearchBtn`) + loading state; export ปุ่ม disabled ตอน loading/ว่าง
  - closure ใน `renderHrOverviewPage`: `reportFrom`/`reportTo` (default = เดือนปัจจุบัน 1st..สิ้นเดือน, ใช้ data ที่โหลดแล้ว), `_renderReportSection(loading)` + `_bindReport()` → ค้นหา = fetch ช่วง → rebuild `buildMonthlyHrReport` → re-render เฉพาะ `#hrReportSection` + rebind
  - Export filename = `hr_report_<from>_<to>.xlsx`; validate from ≤ to
- **ไม่ refetch ทั้งหน้า** — profiles/departments ใช้ใน memory (data.profiles, deptNameById)

**Gate:** lint 0 · unit 827 · e2e build-sync 324 · build 323→324

---

## 🛠️ Phase 92.53 — Monthly HR Report (prev session)

**เป้าหมาย:** รายงาน HR รายเดือน รวมต่อพนักงาน (user เลือก option A) — ตารางสรุป 1 แถว/คน + Excel export

**สิ่งที่ทำ:**
- `modules/hr_overview.js`:
  - `buildMonthlyHrReport({profiles, attendanceMonth, leaves, shiftOpts, attendanceRules, deptNameById})` (exported, pure) → `{rows[], totals}` · per-row: daysWorked (distinct work_date), regularHours/otHours (`sumRegularOT`), lateCount/lateMinutes + earlyLeaveCount/earlyLeaveMinutes (`summarizePunctuality`), leaveDays (staff_leaves status=approved)
  - `_renderMonthlyHrReport(report, monthTh)` — section ใหม่ใต้ตารางสถานะวันนี้ (เหนือ Quick actions) + tfoot totals + ปุ่ม `hrReportExportBtn`
  - Export Excel `hr_report_<monthKey>.xlsx` (11 คอลัมน์)
- ใช้เดือนปัจจุบัน (monthKey เดียวกับ dashboard) — ไม่มี date-picker/fetch เพิ่ม (v1)

**Behavior preserved:** ไม่แตะ payroll/leave calc/accounting/RLS · ไม่ fetch เพิ่ม (reuse `data.attendanceMonth`/`data.leaves`/`data.profiles`)

**Gate:** lint 0 · unit 826 (+8) · e2e build-sync 323 · build 322→323

---

## 🛠️ Phase 92.52 — HR Attendance Exception Follow-ups (prev session)

**เป้าหมาย:** ต่อยอด punctuality (92.49) ครบ 5 จุดที่ user สั่ง "ทำทั้งหมด"

**สิ่งที่ทำ:**
- `modules/time_clock.js`:
  - `summarizePunctuality(rows, shift, opts)` (exported, pure) → `{total, onTime, late, earlyLeave, lateAndEarly, missingClockOut, none, totalLateMinutes, totalEarlyLeaveMinutes}`
  - Manager report: summary line "ความตรงต่อเวลา (ช่วงนี้)" + Excel export +3 คอลัมน์ (สถานะตรงเวลา/นาทีสาย/นาทีออกก่อน)
  - Self-view (พนักงาน): chip punctuality ในประวัติ 7 วัน
- `modules/hr_overview.js`:
  - HR export +3 คอลัมน์ punctuality
  - `buildHrDashboardMetrics` รับ `shiftOpts`+`attendanceRules` (additive) → คำนวณ `monthlyPunctuality {lateOccurrences, frequentLateCount(≥3), topLate[5]}` จาก `attendanceMonth`; render `_hrDashTopLate` ใน panel "พนักงานมาสายบ่อย (เดือนนี้)"
- `modules/settings/store.js`: import `logActivity` จาก `../utils.js`; เมื่อ grace/กะ เปลี่ยน → `logActivity('attendance_rules_update', {before, after})` best-effort (ไม่ทำให้ save fail)

**Behavior preserved:** `buildHrDashboardMetrics` ถ้าไม่ส่ง shiftOpts+rules → `monthlyPunctuality` ว่าง (test เดิมไม่พัง) · ไม่แตะ payroll/OT/leave/accounting/JE RLS · clock-in/out เดิม

**Gate:** lint 0 · unit 818 (+12) · e2e build-sync 322 · build 321→322 (index.html ×4 + sw.js) · rebased บน Codex Period Close (92.51/321)

---

## 🛠️ Phase 92.50 — HR Executive Dashboard Detail View (this session)

**เป้าหมาย:** ยกระดับหน้า HR Overview ให้มี dashboard รายละเอียดครบตามภาพตัวอย่าง โดยยังคงตาราง/alert/quick actions เดิมไว้ด้านล่าง

**สิ่งที่ทำ:**
- `modules/hr_overview.js` — เพิ่ม `buildHrDashboardMetrics()` สำหรับรวม KPI แบบ read-only จาก profiles/departments/staff_attendance/staff_payroll/staff_leaves
- เพิ่ม section dashboard ใหม่: hero + benefits, context filter strip, KPI cards, chart แยกแผนก, donut แยกตำแหน่ง, สถานะลงเวลาวันนี้, แนวโน้มลงเวลา 8 วันล่าสุด, สรุปวันลา, ตารางสัญญา/ทดลองงานใกล้ครบ และ info cards แหล่งข้อมูล
- `_fetchHrData()` fetch `staff_leaves` แบบ graceful; ถ้า RLS/table มีปัญหา dashboard ยังไม่ crash และมี warning banner เหมือนตารางอื่น
- `tests/hr_overview.test.js` — เพิ่ม coverage สำหรับ `buildHrDashboardMetrics`
- `index.html`/`sw.js` — bump build 319→320

**ไม่แตะ:** SQL/RLS/schema, payroll calculation, accounting, JE, Time Clock write flow

---

## 🛠️ Phase 92.49 — HR Late / Attendance Exception Rules (this session)

**เป้าหมาย:** ใช้ข้อมูล Time Clock + กะ ที่มีอยู่ → ตีสถานะ "มาสาย / ออกก่อนเวลา" ให้ HR เห็นชัด (informational, ไม่ block)

**สิ่งที่ทำ:**
- `modules/time_clock.js` — pure helpers ใหม่ (exported):
  - `classifyPunctuality(row, shift, opts)` → `{status, lateMinutes, earlyLeaveMinutes}` · status = `on_time`|`late`|`early_leave`|`late_and_early_leave`|`missing_clock_out`|`none` · เทียบ clock_in/out กับเวลาเริ่ม/เลิกกะ บน Asia/Bangkok (ใช้ `_bangkokDateAtHour` เดิม ไม่ใช่ UTC toISOString) · lateMinutes/earlyLeaveMinutes คืนค่าดิบเสมอ, grace ตัดสินแค่ status
  - `attendanceRulesFromState(state)` → `{lateGraceMinutes, earlyLeaveGraceMinutes}` default 15/15 จาก `storeInfo` (pattern เดียวกับ `shiftHoursFromState`/geofence)
  - `punctualityChipMeta(punc)` → label ภาษาไทย + สี (null ถ้า none)
  - manager report row เพิ่ม chip (ใต้ชื่อ user) — ไม่เพิ่มคอลัมน์ (colspan เดิม)
- `modules/hr_overview.js` — import 3 helper ข้างบน · rows มี field `punc` · `_renderTbody` chip ใต้ status chip · drill-down modal header แสดง chip (`buildEmployeeModalSummary.punctuality`) · `detectExceptions` รับ `shiftOpts`+`attendanceRules` → push alert รวม `late_arrivals`/`early_leaves` (นับเป็นจำนวนคน, dedupe ตาม user; late นับจาก `lateMinutes > grace` รวม missing_clock_out) · `alertActionFor` map 2 kind ใหม่ → route `time_clock`
- `modules/settings/store.js` — เพิ่มช่อง "ผ่อนผันเข้าสาย/ออกก่อน (นาที)" ใน section กะ · validate >= 0 (clamp 0–240, default 15) · save เข้า storeInfo

**Behavior preserved:** `detectExceptions` ถ้าไม่ส่ง `shiftOpts`+`attendanceRules` → ไม่มี late/early (test เดิมไม่พัง) · ไม่แตะ payroll/OT/leave/accounting/JE RLS · clock-in/out flow เดิมไม่เปลี่ยน

**Gate:** lint 0 errors · unit 809 ผ่าน (+18 time_clock, +7 hr_overview) · e2e 11 ผ่าน (build-sync smoke เขียว) · build 318→319 (index.html ×4 ?v + data-app-build, sw.js cache-v319 + marker)

---

## 🛠️ Phase 92.48 — Accounting Integrity Status Panel (this session)

**บริบท:**
Audit (dry-run `backfill_orphan_journals.js`) ยืนยัน orphan ที่เหลือ = test data ทั้งหมด → **actionable จริง = 0**:
- Sales 85 = 84 เม.ย. (ก่อน 2026-05-01) + 1 พ.ค. (฿0) · Expenses 1 = เม.ย. ฿1,000 · Payroll 0

แต่ `accounting_integrity_summary()` RPC คืน **raw count = 85** → ถ้าโชว์ดิบ ๆ admin จะตกใจทั้งที่ไม่มีรายการจริงค้าง

**สิ่งที่ทำ:**
- `modules/accounting/backfill.js` — เพิ่มการ์ด integrity ด้านบน (host เดิม ไม่เพิ่ม route/menu): RPC summary → ดึง `vw_*_without_journal` ids → fetch row (date+amount) → `_classifyOrphan` แยก actionable/skipped → 🟢/🔴/🟡
- `_classifyOrphan(cat, row)` (exported) — **mirror auto_post เป๊ะ**: `import { _isAfterEffective }` + `dateBkk`; pre-effective หรือ amount<=0 = skipped, else actionable (ไม่ duplicate logic = กัน drift)
- field ต่อ source ตรง auto_post: sales=`created_at`/`total_amount??grand_total` · expenses=`expense_date`/`amount` · payroll=`paid_at`/`total_amount`

**Approach:** client-side bucketing (option B) — **ไม่แตะ SQL** (ใช้ RPC/views ของ 92.46) → ไม่ต้อง apply อะไรใน Supabase

**Gate:** +8 `tests/accounting_integrity_panel.test.js` (node --test ผ่าน) · eslint clean (0/0) · build 316→317 (backfill.js = lazy module)

**Hotfix (build 318):** orphan fetch เปลี่ยนเป็น `select=*` — เดิม sales select ระบุ `grand_total` (sales ไม่มีคอลัมน์นี้ มีแต่ quotations/receipts) → PostgREST 400 → การ์ดขึ้น 🟡 "85 classify ไม่ได้". เจอจาก **user eyeball** (unit test mock row ตรง ๆ เลยไม่จับ select-column bug = integration gap). `select=*` พิสูจน์แล้วใช้ได้ (dry-run backfill ใช้ pattern เดียวกันสำเร็จ)

**ยังไม่ทำ (ถ้าต่อ):** ปุ่ม backfill ในตัวการ์ด (ตอนนี้ชี้ไปเครื่องมือเดิมด้านล่าง) · Phase 92.49 Month Close checklist

---

## 🛠️ Phase 92.47 — Orphan Journal Backfill Tool (previous session)

**บริบท:**
หลัง Phase 92.46 apply (RLS re-apply + integrity views), audit พบ orphans สะสม:
- 107 sales ไม่มี JV (เม.ย. 84, พ.ค. 23)
- 3 expenses ไม่มี JV (เม.ย. 1, พ.ค. 2)
- 0 payroll orphans (Phase 92.44 wire ใหม่ ครอบทัน)

→ Root cause: RLS bug ที่ Phase 92.46 เพิ่งปิด — sales role ถูก deny insert journal_entries
→ 92.46 ปิด root cause แล้ว แต่ orphan ในอดีตยังต้อง backfill

**ขอบเขตจริง (หลัง pre-effective filter):**
- เม.ย. 2026 (84+1 = 85 rows) → **intentional skip** (ก่อน `ACCOUNTING_EFFECTIVE_DATE=2026-05-01` = test data)
- พ.ค. 2026 (23+2 = 25 rows) → **real backfill targets**

### สิ่งที่ทำ

**1) `scripts/backfill_orphan_journals.js` — Node script**

Strategy: **window shim + reuse `auto_post.js` logic** (ไม่ replicate กัน drift)

```js
// Set up before import — auto_post.js ใช้ window globals ตอนรัน
globalThis.window = {
  SUPABASE_CONFIG: { url, anonKey },
  _sbAccessToken: admin.token,
  showToast: (m) => console.log("  [toast]", m),
};

// Dynamic import (ต้องหลัง shim)
const { postJournalForSale, postJournalForExpense, resetMappingCache } =
  await import(pathToFileURL(autoPostPath).href);
resetMappingCache(); // ใช้ admin token fetch mappings ใหม่
```

Flow:
1. Auth admin (ใช้ `.env` เดียวกับ verify scripts — ADMIN_EMAIL/ADMIN_PASSWORD)
2. Before snapshot: `SELECT public.accounting_integrity_summary()`
3. Sales loop: `vw_sales_without_journal` → fetch full row → `postJournalForSale(row)`
4. Expenses loop: เช่นเดียวกัน
5. After snapshot + diff print
6. Summary: posted / skipped (pre-effective + duplicate) / failed counts

Flags:
- `--dry-run` → preview (ไม่ insert) — print "WOULD post" + date/amount
- `--sales-only` / `--expenses-only` → scope filter

Exit codes:
- 0 = success (รวมกรณี 0 orphans ตอนเริ่ม)
- 1 = some rows failed
- 2 = fatal (auth/network/import/env error)

**2) npm script entry**

```json
"backfill:orphans": "node scripts/backfill_orphan_journals.js"
```

**3) Test +19** (`tests/backfill_orphan_journals.test.js`)

Pure helpers:
- `summarizeResults` (empty / mixed / dry-run / unknown status) ×4
- `formatSummaryLine` (all counts / zero counts) ×2

Source-level guards:
- `pathToFileURL` ใช้ (Windows-safe import URL)
- Window shim มา BEFORE `auto_post` import (order critical)
- Shim has `SUPABASE_CONFIG` + `_sbAccessToken` (used by `_authFetch` fallback)
- `resetMappingCache()` ถูกเรียก (กัน stale anon mappings)
- `--dry-run` / `--sales-only` / `--expenses-only` flags supported
- Imports `postJournalForSale` + `postJournalForExpense` (ไม่ replicate)
- View names ตรงกับ Phase 92.46 SQL (`vw_sales_without_journal` etc.)
- `getIntegritySummary` เรียก ≥2 ครั้ง (before + after snapshot)
- Exit codes 0/1/2 ครบ
- `main()` guarded ด้วย `import.meta.url === pathToFileURL(process.argv[1])` (test import ไม่ trigger network)
- README mentions `ACCOUNTING_EFFECTIVE_DATE` / pre-effective skip (anti-surprise)
- `package.json` register `backfill:orphans` correctly

Unit total: **758 → 777** (+19)

### ไม่แตะ
- `auto_post.js` (zero risk to existing browser flow)
- SQL schema (ใช้ views + RPC ของ 92.46)
- Client UI (script-only — Phase 92.48 จะทำ dashboard UI ถ้า user อยาก permanent tool)
- Effective date logic (ยอมรับ April skip — เป็น intentional design)

### Action required (user)
1. ตรวจ `.env` มี `ADMIN_EMAIL` + `ADMIN_PASSWORD` (role='admin')
2. **DRY-RUN ก่อน:** `npm run backfill:orphans -- --dry-run`
   - ดู list orphans + date + amount — verify scope ตามคาด
   - Expected: ~25 "WOULD post" + ~85 "skipped pre-effective" (auto_post จะ filter)
3. **LIVE:** `npm run backfill:orphans`
   - ใช้เวลา ~30-60 วินาที (110 HTTP calls)
   - Expected: 23-25 posted + 85 skipped pre-effective + 0 failed
4. Verify: `SELECT public.accounting_integrity_summary();` — ควรเห็น sales/expenses orphans ลดลงเหลือ 85+1=86 (พ.ค. เคลียร์, เม.ย. คงไว้เพราะ pre-effective)
5. หน้า "บัญชี > สมุดรายวัน" filter `doc_type=SV` — เห็น JV ของ sale พ.ค. 2026 ครบ

### Gates ✅
- `npm run lint:errors` exit 0
- `npm test` = **777/777** (was 758 + 19 new = correct)
- `npm run test:e2e` ไม่กระทบ (script ไม่เกี่ยว e2e)
- `npm audit --audit-level=moderate` = 0 vulnerabilities

**Build:** 315 (no bump — script-only, no client/SW change)

---

## 🔒 Phase 92.45 — Leave SQL/RLS Hardening + Audit Enforcement

**บริบท / S3 ที่ปิด:**
audit เดิมพบช่องโหว่ "non-admin spoof reviewer fields" — RLS Phase 92.32 เช็คแค่ `status='pending'` + `user_id=auth.uid()` แต่ไม่ได้ lock column `reviewed_by/_at/_note` → non-admin POST/PATCH `{user_id:self, status:'pending', reviewed_by:'<spoofed-admin-uuid>', reviewed_at:'now'}` ผ่าน RLS เดิมได้

นอกจากนั้น `_doReview` เดิม set `reviewed_by: currentUserId` + `reviewed_at: new Date().toISOString()` ฝั่ง client → spoofable + clock-skew prone

### สิ่งที่ทำ

**1) SQL trigger + RPC ([`supabase-phase92-45-leave-hardening.sql`](supabase-phase92-45-leave-hardening.sql))**

- **BEFORE INSERT trigger `_guard_staff_leaves_insert`** — non-admin: force `user_id=auth.uid()`, `status='pending'`, `reviewed_by/_at/_note=NULL`, `created_by=auth.uid()` (silent strip — ไม่ throw เพื่อ UX ไม่พัง)
- **BEFORE UPDATE trigger `_guard_staff_leaves_update`**:
  - non-admin: preserve OLD `user_id/leave_type/created_by/reviewed_by/_at/_note` + RAISE EXCEPTION ถ้า `NEW.status NOT IN ('pending','cancelled')` หรือ `OLD.status IN ('approved','rejected','cancelled')` (ห้ามแก้ row terminal)
  - admin: ตอน `status` เปลี่ยนเป็น approved/rejected → auto `NEW.reviewed_by=auth.uid()` + `NEW.reviewed_at=now()`; ตอน revert ไป pending/cancelled → ล้าง reviewer trail
- **RPC `public.review_staff_leave(p_leave_id, p_status, p_note)`** — SECURITY INVOKER + admin guard (`is_accountant()`) + status whitelist (`approved/rejected/cancelled`) + คืน updated `jsonb` row → trigger จัดการ reviewer ให้เอง
- **GRANT EXECUTE TO authenticated** + `NOTIFY pgrst 'reload schema'` + 5 VERIFY queries
- Rerun-safe: `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` / `DROP FUNCTION IF EXISTS`

**2) Client hardening ([`modules/leave_management.js`](modules/leave_management.js))**

- เพิ่ม helper `_callReviewRpc(leaveId, status, note)` → POST `/rest/v1/rpc/review_staff_leave` body `{p_leave_id, p_status, p_note}`
- `_doReview` switch: เลิกส่ง `reviewed_by/_at` จาก client → เรียก `_callReviewRpc` → audit metadata `after.reviewed_*` อ่านจาก RPC response (server-trusted)
- Form submit branches:
  - `existing && existing.id != null` → **EDIT path**: `_patchLeave(existing.id, {leave_type, start_date, end_date, days_count, reason})` (safe fields whitelist — ไม่ส่ง status/reviewed_*/user_id/created_by) + `leave_update` audit (before/after diff)
  - ไม่มี existing → **CREATE path**: `_insertLeave(body)` + `leave_create` audit (key fields)
- เดิม edit submit ก็เรียก `_insertLeave` (สร้าง row ใหม่แทน update) → bug แอบฟ้องไม่เคยเจอ — แก้ในเฟสนี้

**3) Audit log (utils.js `logActivity`)**

ครอบ leave actions ครบ 6 ตัว:
- `leave_create` (ใหม่ — เฟสนี้)
- `leave_update` (ใหม่ — เฟสนี้)
- `leave_approve` / `leave_reject` (เดิม Phase 92.43 B4)
- `leave_cancel` / `leave_delete` (เดิม Phase 92.43 B4)

Metadata: `before/after`, `leave_type`, `days_count`, `reviewed_by/_at` (จาก RPC response)

### Re-uses (ไม่สร้างใหม่)

- RLS policies เดิม Phase 92.32 ทั้ง 4 ตัว (`leaves_select_admin_or_self` / `leaves_insert_admin_or_self_pending` / `leaves_update_admin_or_self_pending` / `leaves_delete_admin`) — trigger เป็น defense-in-depth ทับ
- `is_accountant()` helper (Phase 88) สำหรับ guard ทั้ง trigger + RPC
- `logActivity` (Phase 57) สำหรับ audit log
- `_patchLeave` / `_insertLeave` helper เดิม
- `_runPopoverAction` wrapper สำหรับ error UX (popover stays open on RPC fail)
- Form modal layout + quota warning (Phase 92.35)

### Tests +8 source-level

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `_callReviewRpc` signature + endpoint `/rpc/review_staff_leave` + payload shape
- `_doReview` ใช้ `_callReviewRpc` แทน `_patchLeave` + ไม่ส่ง `reviewed_by: currentUserId` / `reviewed_at: new Date()...` (regression guard)
- audit metadata `after.reviewed_*` อ่านจาก `updatedRow?.reviewed_*` (RPC response)
- Form submit branch on `existing.id` → `_patchLeave` vs `_insertLeave`
- Edit PATCH body safe-fields whitelist (ห้ามมี `status/reviewed_*/user_id/created_by`)
- `leave_create` audit ใน insert path success + metadata keys ครบ
- `leave_update` audit ใน edit path success + before/after diff
- SQL file `supabase-phase92-45-leave-hardening.sql` มี trigger functions + bindings + RPC + GRANT + NOTIFY

Unit **752 → 760** (+8)

### Gates ✅

- `npm run lint:errors` exit 0
- `npm test` = **760/760**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items ครบ)

- `package.json`: 5.63.1 → **5.64.0** (security minor)
- `index.html`: `?v=314→315` × 4 src (style.css/selfheal.js/main.js/boot.js) + `data-app-build="315"` + `data-app-version="5.64.0"`
- `sw.js`: `cache-v314→v315` + comment v315

### Manual smoke (โปรดทำหลัง deploy)

**1. รัน SQL ก่อน** — Supabase Dashboard → SQL Editor → paste `supabase-phase92-45-leave-hardening.sql` → Run → ตรวจ VERIFY queries ที่ท้ายไฟล์
- (a) Triggers — Expected: 3 ตัว (`trg_staff_leaves_updated_at` + `trg_staff_leaves_guard_insert` + `trg_staff_leaves_guard_update`)
- (b) Functions — Expected: `_bump_staff_leaves_updated_at` + `_guard_staff_leaves_insert` + `_guard_staff_leaves_update` + `review_staff_leave`
- (c) RPC grant — Expected: `review_staff_leave` มี EXECUTE สำหรับ `authenticated`
- (d) RLS policies เดิม — Expected: 4 ตัว (ไม่ถูกแตะ)

**2. Production Ctrl+Shift+R → APP_BUILD=315**

**3. Login admin:**
- สร้าง leave ให้พนักงาน → approve/reject/cancel ได้ผ่าน RPC (network tab: POST `/rest/v1/rpc/review_staff_leave`)
- ตรวจ `audit_log` table — มี action `leave_create/leave_update/leave_approve/leave_reject/leave_cancel/leave_delete` ครบ
- หลัง approve → `reviewed_by` = admin uuid, `reviewed_at` = server timestamp (ไม่ใช่ client clock)

**4. Login sales/technician:**
- สร้าง leave ของตัวเอง → status='pending' (trigger บังคับ)
- ไม่เห็นปุ่ม approve/reject ของคนอื่น (UI guard)
- **เทส spoof:** เปิด DevTools console → ลอง:
  ```js
  // pretend non-admin POST + spoof reviewer
  fetch(window.SUPABASE_CONFIG.url + "/rest/v1/staff_leaves", {
    method: "POST",
    headers: { apikey: window.SUPABASE_CONFIG.anonKey,
               Authorization: "Bearer " + window._sbAccessToken,
               "Content-Type":"application/json",
               Prefer:"return=representation" },
    body: JSON.stringify({
      user_id: "OTHER_USER_UUID",  // not self
      leave_type: "vacation",
      start_date: "2026-06-01", end_date: "2026-06-01", days_count: 1,
      status: "approved",           // spoof
      reviewed_by: "FAKE_ADMIN_UUID", reviewed_at: "2026-06-01T00:00:00Z"
    })
  }).then(r=>r.json()).then(console.log);
  ```
  - **ผลที่คาด:** row ถูกสร้าง แต่ DB silently strip → ได้ `user_id=auth.uid()`, `status='pending'`, `reviewed_by=null`, `reviewed_at=null` (RLS เดิม + trigger ทำงานพร้อมกัน — RLS อาจ block ถ้า user_id !== auth.uid())
- ลอง PATCH spoof reviewed_by ของ row ตัวเอง → trigger preserve OLD value (ลอง SELECT แล้ว reviewed_by ยังเป็น NULL)
- ลอง PATCH status='approved' ของ row ตัวเอง → trigger RAISE EXCEPTION 42501

**5. กลับ admin:**
- เห็น pending leave → approve → KPI/Balance/Calendar update ถูก
- approve ผ่าน RPC: ตรวจ network tab POST `/rest/v1/rpc/review_staff_leave` body `{p_leave_id, p_status, p_note}`

**6. Regression:**
- Leave Calendar / Page click-through (92.42) ยังใช้ได้
- Balance/Quota (92.35) ยังนับถูก
- Payroll paid/journal/reverse (92.43–92.44) ไม่กระทบ
- HR Overview pending leave alert ยังขึ้นถูก
- Form edit (existing) → update row จริง (ไม่สร้าง duplicate แล้ว)

> ⚠️ **หมายเหตุ:** sections ด้านล่างนี้สำหรับเฟส 92.41 และก่อนหน้า — เฟส 92.42 (Leave page click-through cards), 92.43 (Payroll/Accounting audit hardening B1-B4), 92.44 (Payroll payment journal visibility) ไม่ได้อัปเดต HANDOFF section แยก ดูรายละเอียดที่ commit message + CHANGELOG.md

---

## ✨ Phase 92.41 — HR Overview Click-through Navigation (older session)

**บริบท:** หน้า HR Overview มี infrastructure click-through อยู่แล้ว (`hr-kpi-card` + `data-hr-action` + delegation + keyboard handler) แต่ใช้กับเฉพาะ Payroll (conditional `unpaid > 0`) + Offline Queue. KPI cards 4 ใบหลัก (พนักงานทั้งหมด/เข้างานวันนี้/ยังไม่ลงเวลาออก/OT) ยังเป็น static — user ไม่มีทาง drill-down ต่อ. งานเฟสนี้ขยายให้ครบทุกใบ + ปรับ a11y/affordance + เพิ่ม "ไป Payroll" ใน employee modal.

### สิ่งที่ทำ

**1) Pure helper ใหม่ `kpiClickRouteFor(kind)`** ([`modules/hr_overview.js`](modules/hr_overview.js))
- คืน route id ตาม kind (testable, no DOM/state):
  - `total_staff` → `departments` (ดูพนักงานรวมตามแผนก)
  - `present_today` → `time_clock` (default = วันนี้)
  - `open_sessions` → `time_clock` (จัดการ session ค้าง)
  - `ot_month` → `payroll_overview` (OT รายเดือน รวมที่นี่)
  - `payroll` → `payroll` (จัดการ row ต่อ)
  - `offline_pending` → `time_clock` (sync queue)
  - unknown → `null`
- Destination pages default = วันนี้/เดือนปัจจุบันอยู่แล้ว → **ไม่ต้องส่ง filter ข้ามหน้า** (lean)

**2) KPI cards 5 ใบหลัก + Offline Queue ใช้ helper**
- เดิม: `clickRoute: payrollClickable` (= `unpaid > 0 ? "payroll" : null`) → unpaid=0 disable เงียบ
- ใหม่: `clickRoute: kpiClickRouteFor(kind)` ทุกใบ → Payroll 0/0 ก็คลิกได้ (drill-down ดีกว่า disable)
- ลบตัวแปร `payrollClickable` ออก (ไม่ใช้แล้ว)

**3) `_kpiCard` a11y + affordance redesign**
- เพิ่ม `aria-label="label — value — sub (เปิดเพื่อจัดการ)"` dynamic เมื่อ clickable
- ใช้ chevron icon `›` (small, color #0284c7) ใน header row แทน text ลอย "คลิกเพื่อจัดการ →" ที่อยู่ท้าย card
- **เหตุผล UX:** เดิม 1 card มี text นั้น 1 ครั้ง — พอ 5 ใบคลิกได้ก็เห็น 5 ครั้ง = noisy. Affordance (cursor + hover + chevron + aria) ก็พอแล้ว
- `role="button"` + `tabindex="0"` ยังคงเดิม → keyboard นาวิเกตได้

**4) Container scope `<style>` ใหม่**
```css
.hr-kpi-card { transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
.hr-kpi-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,.08); border-color: #cbd5e1; }
.hr-kpi-card:focus-visible { outline: 2px solid #0284c7; outline-offset: 2px; }
.hr-row-employee:hover { background-color: #f8fafc; }
.hr-row-employee:focus-within { outline: 2px solid #0284c7; outline-offset: -2px; }
```

**5) Employee drill-down modal footer เพิ่มปุ่ม Payroll**
- เดิม: ปุ่ม "🕒 ไป Time Clock" + "ปิด"
- ใหม่: + "💰 ไป Payroll" (`class="hr-modal-route-btn"` + `data-hr-action="payroll"`)
- ใช้ delegation เดิม (`hr-modal-route-btn` → close modal + `showRoute(route)`)

### Re-uses (ไม่สร้างใหม่)

- `_kpiCard` infrastructure (`data-hr-action`, `hr-kpi-card` class, role/tabindex)
- Container-level event delegation (line 1322 — `closest("[data-hr-action]")` → `showRoute(route)`)
- Keyboard handler สำหรับ KPI cards (line 1359 — Enter/Space)
- Row click delegation (line 1574 — `closest("[data-hr-action]")` early return → กัน row click ชน button)
- Modal route button delegation (line 1550 — close + navigate)
- `alertActionFor` (5 kinds: stale_session/geofence_out/unpaid_payroll/offline_pending/pending_leaves) — ไม่แตะ (ทำงานครบแล้ว)

### Tests +11 source

[`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- `kpiClickRouteFor` 6 tests (total_staff, present_today/open_sessions/offline_pending, ot_month, payroll, unknown→null)
- valid-route sanity (cross-check kpi + alert routes กับ allowlist `time_clock/payroll/payroll_overview/leave_management/departments/audit_log/hr_overview/settings`)
- Source-level 4:
  - KPI 5 ใบหลักทุกใบส่ง `kpiClickRouteFor("kind")` (+ offline_pending conditional)
  - `_kpiCard` มี aria-label dynamic + role=button + tabindex=0 + ไม่มี text "คลิกเพื่อจัดการ →" แล้ว
  - container `<style>` มี `.hr-kpi-card:hover` + `:focus-visible` outline + `.hr-row-employee:hover`
  - modal มีปุ่ม `data-hr-action="payroll"` คู่กับ time_clock (regression guard)
  - row click delegation ยัง skip data-hr-action + button targets

Unit **680 → 691** (+11)

### Gates ✅

- `npm run lint:errors` exit 0
- `npm test` = **691/691**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.5 → **5.62.6** (minor — feature)
- `index.html`: ?v=308→309 ทุก src + `data-app-build="309"` + `data-app-version="5.62.6"`
- `sw.js`: cache v308→v309 + comment v309

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=309
2. เข้าหน้า HR Overview (admin)
3. KPI 5 ใบหลัก — เห็น chevron `›` มุมขวา + cursor pointer + hover lift
4. คลิก "พนักงานทั้งหมด" → ไป `departments`
5. คลิก "เข้างานวันนี้" / "ยังไม่ลงเวลาออก" → ไป `time_clock`
6. คลิก "OT เดือนนี้" → ไป `payroll_overview`
7. คลิก "Payroll เดือนนี้" → ไป `payroll` (แม้ paid=0/0 ก็คลิกได้)
8. Keyboard Tab ไป KPI card → เห็น focus ring ฟ้า → Enter/Space → navigate
9. คลิก row พนักงาน → modal เปิด → footer มี "🕒 ไป Time Clock" + **"💰 ไป Payroll"** + "ปิด"
10. กด "ไป Payroll" → modal ปิด + ไปหน้า payroll
11. Row hover → bg #f8fafc (subtle)
12. Alerts ยังคลิกได้ตามเดิม (unpaid_payroll/pending_leaves/stale_session/geofence_out/offline_pending)

### Regression check ✅

- HR Overview filters (status/dept/role) + cascade rerender เดิม
- Employee modal tabs (วันนี้/7 วันล่าสุด/เงินเดือน) + close (Esc/backdrop/bottom) เดิม
- Row click → modal เดิม (skip button + data-hr-action target)
- Alerts → route mapping เดิม (5 kinds)
- Time Clock responsive ไม่กระทบ
- Leave Calendar / Payroll leave deduction ไม่กระทบ

---

## ✨ Phase 92.40 — Leave Calendar Event Detail Actions Polish

**บริบท:** หลัง 92.39d (build 306) day-list popover visible แล้ว · calendar event detail popover ทำงาน แต่:
- detail ขาด — ไม่มี email, ไม่มีผู้อนุมัติ (name + เวลา)
- ไม่มีทางออกจาก popover ไปดู row เต็มในตาราง
- error UX ไม่ปลอดภัย — `_doReview/_doCancel/_doDelete` close popover **ก่อน** await action → ถ้า fail user เห็นแค่ toast แล้วต้องเปิดใหม่
- action logic ซ้ำใน 3 จุด (table row, popover template, future) — เสี่ยง drift / hard to test

### สิ่งที่ทำ

**1) Pure helper ใหม่ `calendarDetailActionsFor(leave, currentUserId, role)`** ([`modules/leave_management.js`](modules/leave_management.js))
- คืน descriptor array `{kind, label, style}` — single source of truth สำหรับ popover actions
- Reuse `canEditLeave` + `canReviewLeave` (ไม่สร้าง rule ใหม่)
- Matrix:
  - admin + pending → `approve`/`reject`/`edit`/`delete`/`viewInTable`
  - admin + approved|rejected|cancelled → `edit`/`delete`/`viewInTable`
  - non-admin own + pending → `cancel`/`viewInTable`
  - non-admin own + non-pending → `viewInTable` only
  - non-admin OTHER (currentUserId ≠ leave.user_id) → `viewInTable` only

**2) `_renderLeavePopover` เสริม detail copy + driver จาก helper**
- Header: `<div>` email + role ใต้ name (`p?.email` · `p?.role`) ใช้ truncate ellipsis
- Body: บรรทัด "ผู้พิจารณา: ชื่อ · 27 พ.ค. 14:30" (helper ใหม่ `formatReviewedAt(iso)` th-TH short Asia/Bangkok)
- Body: inline error banner `<div id="lmPopError" role="alert">` (hidden by default)
- Actions: loop จาก `calendarDetailActionsFor(...)` → button class `lm-pop-{kind}` (kind viewInTable → `lm-pop-view-in-table`)
- Style mapping: `primary` (green filled) / `danger-outline` (red outline) / `secondary` (slate outline)

**3) Error-stays-open refactor**
- `_doReview`/`_doCancel`/`_doDelete` คืน `{ok:true}` หรือ `{ok:false, error}` แทน void
- `_runPopoverAction(actionFn)` wrapper: busy-guard กัน double-click + await action ก่อน → `_closePopover()` เฉพาะตอน `result.ok`; ถ้า fail (`error` ≠ "ยกเลิก") → `_setPopoverError(msg)` แสดง banner
- showToast ยังเรียกทั้ง flow เดิม (table row delegation ไม่เปลี่ยน) + flow ใหม่ (popover เพิ่ม inline banner)
- **Regression guard test:** ห้ามมี pattern เดิม `_closePopover(); await _doReview` (ปิดก่อน await = bug ที่ phase นี้แก้)

**4) "ดูในตาราง" navigation**
- `_jumpToTableRow(id)`:
  - เช็คว่า row อยู่ใน `filterLeaves(leaves, {month, status, leaveType})` ปัจจุบันหรือไม่
  - ถ้าตก filter → `window.confirm("รายการนี้อยู่นอก filter ปัจจุบัน — ล้าง filter เพื่อแสดง?")` → ตกลง = reset `activeStatus="all"; activeType="all"; activeMonth=row.start_date.slice(0,7)` (re-scope ให้ครอบคลุม row)
  - ถ้า `activeView !== "table"` → set `"table"`
  - `_closePopover()` + `_rerender()` + `setTimeout(scrollAndHighlight, 0)`
- `_scrollAndHighlightRow(id)`:
  - `tbody.querySelector('tr[data-lm-id="..."]')` ใช้ `CSS.escape` กัน injection
  - `scrollIntoView({behavior: "smooth", block: "center"})` + `classList.add("lm-row-highlight")` + setTimeout remove 2.5s
- `_renderTbody`: เพิ่ม `data-lm-id="${escHtml(String(r.id))}"` บน `<tr>` (anchor)
- CSS ใน container scope: `@keyframes lmRowHighlight { 0%/70% bg #fef3c7 → 100% transparent }` + `#lmTbody tr.lm-row-highlight { animation: lmRowHighlight 2.5s ease-out }`

### Re-uses (ไม่สร้างใหม่)

- `canEditLeave` (modules/leave_management.js:151), `canReviewLeave` (:165) — business rule กลาง
- `_rerender()` — central rerender ที่ sync KPI + balance + table + calendar (action handler ไม่ต้องเพิ่ม sync logic)
- `filterLeaves`, `_findLeave`, `_patchLeave`, `_openPopover`, `_closePopover` — pipeline เดิม
- `escHtml`, `profileDisplayName`, `leaveTypeLabel`, `leaveStatusMeta`, `_formatDateRange` — utils

### Tests +21 source

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `calendarDetailActionsFor` 8 tests (null leave, admin pending/approved/rejected/cancelled, non-admin own pending/approved, non-admin OTHER, role variants sales/technician/customer, descriptor shape + uniqueness + viewInTable last)
- `formatReviewedAt` 3 tests (null/empty/undefined, invalid ISO, valid → th-TH short with พ.ค. + 14:30)
- Source-level 10 (popover ใช้ helper + formatReviewedAt + error banner; openLeavePopover bind viewInTable + ใช้ `_runPopoverAction` + ไม่ pre-close ก่อน await; `_runPopoverAction` ปิดเฉพาะ ok + แสดง error fail; `_do*` คืน `{ok, error}`; `_renderTbody` มี data-lm-id; container scope CSS มี keyframes + .lm-row-highlight; `_jumpToTableRow` + `_scrollAndHighlightRow` flow; header แสดง email+role)

Unit **655 → 676** (+21)

### Gates ✅

- `npm run lint:errors` exit 0
- `npm test` = **676/676**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.3 → **5.62.4** (minor — user-facing feature)
- `index.html`: ?v=306→307 ทุก src + `data-app-build="307"` + `data-app-version="5.62.4"`
- `sw.js`: cache v306→v307 + comment v307

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=307
2. Calendar view → คลิก event pending → admin เห็น approve/reject/edit/delete/viewInTable
3. กด approve → prompt note → confirm → popover ปิด + table/KPI/balance refresh
4. คลิก event approved → เห็น email/role ใต้ชื่อ + "ผู้พิจารณา: ชื่อ · เวลา" + ปุ่ม edit/delete/viewInTable
5. กด "📋 ดูในตาราง" → switch view + scroll/highlight row 2.5s
6. ตั้ง filter status=cancelled → คลิก approved event → กด "ดูในตาราง" → confirm prompt → reset filter + jump
7. Non-admin → คลิก own pending → cancel + viewInTable
8. Non-admin → คลิก own approved → viewInTable only (no admin actions)
9. Force fail (offline/RLS deny) → popover ค้าง + error banner ขึ้น + กดใหม่ได้
10. Mobile ≤768px → bottom sheet ไม่ล้น + scroll detail ได้ + email row truncate

### Regression check ✅

- +N day-list popover (build 306) ยังเปิดได้ + chained leave detail
- Esc / backdrop click ปิดได้
- Mobile agenda render เหมือนเดิม
- Edit quota warning exclude current (build 302) ยังถูก
- Payroll leave deduction flow ไม่กระทบ
- Table row approve/reject/cancel/delete flow เดิมยังใช้ได้

---

## 🧯 Phase 92.39d — HOTFIX dense day popover invisible (CSS scope bug)

**บริบท:** หลัง 92.39c (build 305) user smoke test production พบ:
- About = 5.62.2 / build 305 (SW + cache ตรง — ไม่ใช่ stale)
- คลิก "+1 รายการ" ใน Calendar dense day → backdrop/blur เปิดจริง
- **แต่ day-list dialog content invisible** — ดูเหมือนเปิดแค่ overlay เปล่า

92.39c แก้ container layout (flex centered + overflow-y:auto + max-height) — แต่ไม่ใช่ root cause.

### Root cause

```js
// _renderLeavePopover template literal:
return `
  <style>
    .lm-pop-dialog { max-height: ...; flex column; background:#fff; ... }
    .lm-pop-body { flex:1; overflow-y:auto; }
  </style>
  <div id="lmPopBackdrop"></div>
  <div class="lm-pop-dialog">...</div>
`;

// _renderDayListPopover template literal:
return `
  <div id="lmPopBackdrop"></div>
  <div class="lm-pop-dialog">...</div>   // ← ใช้ class แต่ <style> ไม่ inject!
`;
```

- `<style>` block อยู่ใน `_renderLeavePopover` template เท่านั้น
- คลิก chip event → `_openLeavePopover` → render template + inject `<style>` → dialog visible ✓
- คลิก "+N รายการ" → `_openDayListPopover` → render template โดย**ไม่มี `<style>`** → dialog ใช้ browser default → ไม่มี width/background/max-height → **invisible**

### สิ่งที่แก้

**1) ย้าย CSS rules ไปอยู่ใน container scope (shared, render once)**

[`modules/leave_management.js`](modules/leave_management.js) ใน `_rerender`:
```html
<div id="lmPopover" ... ></div>
<style>
  /* Container layout (92.39c) */
  #lmPopover[style*="display:block"] { display: flex !important; ... }

  /* Phase 92.39d: dialog rules ย้ายมาที่นี่ — ใช้ทั้ง 2 popover types */
  .lm-pop-dialog { max-height: calc(100vh - 96px); display:flex; flex-direction:column; ... }
  .lm-pop-dialog > .lm-pop-body { flex:1 1 auto; overflow-y:auto; }
  @media (max-width: 768px) {
    .lm-pop-dialog { position:fixed; bottom:0; ... bottom sheet }
  }
</style>
```

- ลบ `<style>` block ออกจาก `_renderLeavePopover` (CSS ย้ายไป shared scope แล้ว)
- `_renderDayListPopover` ไม่ต้องเพิ่มอะไร — รับ CSS จาก container scope ทันที

**2) DRY refactor: `_openPopover(html, kind, bindActions)`**

```js
function _openPopover(html, kind, bindActions) {
  const pop = document.getElementById("lmPopover");
  if (!pop) return false;
  const content = String(html || "").trim();
  if (!content) {
    console.warn(`[leave_management] _openPopover(${kind}): empty content — refusing to open`);
    return false;
  }
  // sanity: ห้าม inject html ที่ขาด dialog markup (กัน scope bug ซ้ำ)
  if (!content.includes("lm-pop-dialog")) {
    console.warn(`[leave_management] _openPopover(${kind}): missing .lm-pop-dialog markup`);
    return false;
  }
  pop.innerHTML = content;
  pop.style.display = "block";
  document.body.style.overflow = "hidden";
  _registerPopoverEsc();
  pop.querySelector("#lmPopClose")?.addEventListener("click", _closePopover);
  pop.querySelector("#lmPopBackdrop")?.addEventListener("click", _closePopover);
  if (typeof bindActions === "function") {
    try { bindActions(pop); } catch (_e) {}
  }
  setTimeout(() => pop.querySelector("#lmPopClose")?.focus(), 0);
  return true;
}
```

- Guard: empty content → console.warn + return false (ไม่เปิด backdrop ถ้าไม่มี dialog)
- Sanity: html ต้องมี `.lm-pop-dialog` substring → กันคนเพิ่ม popover ใหม่แต่ลืม class
- Shared: display, focus, Esc, backdrop click → ลด duplicate code
- kind-specific bind actions ผ่าน callback parameter

`_openLeavePopover` + `_openDayListPopover` ตอนนี้สั้นมาก — แค่ render html + เรียก `_openPopover` พร้อม bind callback.

### Regression check ✅

- Calendar event chip click → leave details popover ใช้ `_openPopover("leave", ...)` — bind approve/reject/cancel/edit/delete actions ตาม role
- Dense day "+N รายการ" → day-list popover ใช้ `_openPopover("dayList", ...)` — bind event chip click (chained leave details)
- Esc + backdrop close — logic เดียวกันใน `_openPopover` (shared)
- Mobile bottom sheet (≤768px) — CSS rules ใน container scope ทำงานเหมือนเดิม
- Payroll/Balance/Quota/edit-modal — ไม่กระทบ

### Tests +6 source-level

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `_renderLeavePopover` template ไม่มี `<style>` block (CSS ย้ายไป container scope)
- `_renderDayListPopover` ไม่มี `<style>` block (เคย/ยังเป็นเช่นนั้น)
- Container scope `<style>` มี `.lm-pop-dialog` rules + `max-height: calc(100vh - ...)` + inner body scroll + mobile bottom sheet override
- `_openPopover` shared function: guard empty content + sanity check `.lm-pop-dialog` + `innerHTML` + `display:block`
- `_openLeavePopover` + `_openDayListPopover` ใช้ `_openPopover("leave"|"dayList", ...)` (DRY)
- `_renderDayListPopover` output มี `#lmPopBackdrop` + `class="lm-pop-dialog"` + `class="lm-pop-body"` + `id="lmPopClose"` + `events.map(_calendarEventChip)`

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **655/655** (651 + 4 net หลังตัด focus duplicate)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.2 → **5.62.3** (patch hotfix — root cause fix)
- `index.html`: ?v=305→306, data-app-build="306", data-app-version="5.62.3"
- `sw.js`: cache v305→v306 + v306 comment line

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=306
2. Calendar dense day → คลิก "+N รายการ"
3. **day-list dialog ต้องเห็นเต็มที่** — width 420px, background ขาว, header สีฟ้า "📅 วันXX D เดือน YYYY"
4. คลิก event ใน list → ปิด day-list → เปิด leave details popover (chained)
5. กด Esc / คลิก backdrop → ปิด
6. เปิด DevTools บีบ viewport → popover ยังเห็นได้ (max-height + inner scroll)
7. Mobile ≤768px → bottom sheet slide-up + grabber
8. F12 → Console → ถ้า `_openPopover` ถูกเรียกด้วย empty content จะเห็น `console.warn` (debug aid)

### Lessons learned

> Template literal ที่มี `<style>` tag จะ inject CSS เฉพาะตอน template นั้น render — ถ้ามีหลาย entry points (functions) ใช้ class เดียวกัน ต้อง share CSS scope (container) หรือ duplicate inline ใน ทุก entry point. ถ้า inject ใน entry เดียวจะเจอ bug แบบ 92.39c → 92.39d.

---

## 🧯 Phase 92.39c — HOTFIX popover visibility/position

**บริบท:** หลัง 92.39b verify pipeline ผ่าน source-level test แล้ว user ทดสอบจริง — คลิก "+N รายการ" → backdrop เปิด แต่ day-list popover **ไม่อยู่ใน viewport** โดยเฉพาะตอน DevTools เปิด/viewport เตี้ย.

### Root cause

```
#lmPopover (display:none → block, position:fixed inset:0, z-index:9998)
  ├── #lmPopBackdrop (position:absolute inset:0)         ← ไม่มี z-index
  └── .lm-pop-dialog (position:relative, margin:60px auto, overflow:hidden)
                     ← max-width:420px width:calc(100%-32px)
                     ← ไม่มี max-height, ไม่มี flex center
```

ปัญหา:
- Container `display:block` → ใช้ document flow → dialog ตามหลัง backdrop ใน DOM order
- Dialog `margin:60px auto` center horizontal เฉพาะ — vertical 60px from top
- **ไม่มี max-height** → content สูงเกิน `100vh - 60px` ทะลุล่างจอ
- Container `overflow:visible` (default) → ไม่ scroll
- DevTools เปิด viewport เตี้ย/แคบ → ตกขอบเห็นชัด

### สิ่งที่แก้ ([`modules/leave_management.js`](modules/leave_management.js))

**1) Container `#lmPopover` flex layout (CSS attribute selector):**

```css
#lmPopover[style*="display:block"] {
  display: flex !important;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 48px 16px;
}
@media (max-width: 768px) {
  #lmPopover[style*="display:block"] {
    align-items: stretch;
    padding: 0;
    overflow: hidden;
  }
}
```

- ใช้ attribute selector `[style*="display:block"]` (กับ/ไม่มี space) → flex layout เมื่อ JS toggle เปิด popover
- Desktop: padding 48px 16px ให้ breathing room + scroll ถ้า dialog สูง
- Mobile: stretch + zero padding → bottom sheet เต็มจอ

**2) `.lm-pop-dialog` desktop:**

```css
.lm-pop-dialog {
  position: relative;
  max-width: 420px;
  width: 100%;
  margin: 0;                       /* flex center แล้ว ไม่ต้อง margin */
  max-height: calc(100vh - 96px);  /* กัน dialog ขยายเกินจอ */
  background: #fff;
  border-radius: 14px;
  box-shadow: ...;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1;
}
.lm-pop-dialog > .lm-pop-body { flex: 1 1 auto; overflow-y: auto; }
```

- Dialog เป็น `display:flex flex-direction:column` → header pinned + body scroll
- `max-height: calc(100vh - 96px)` → ไม่ทะลุจอ
- Inner `.lm-pop-body` ใช้ `flex:1 1 auto; overflow-y:auto` → scroll content เฉพาะ body
- Mobile (≤768px): `max-height: 85vh` (เพิ่มจาก 80vh — ใช้พื้นที่มากขึ้น)

**3) z-index hierarchy:**

- Backdrop: `z-index: 0` (inline style)
- Dialog: `z-index: 1` (ใน class rule)
- Container: `z-index: 9998` (เดิม)

**4) `.lm-pop-body` class:**

- เพิ่มใน inner content div ของ `_renderLeavePopover` + `_renderDayListPopover`
- รับ flex+scroll rule จาก dialog selector → content scroll ภายใน, header pinned

**5) Focus management:**

- `setTimeout(() => pop.querySelector("#lmPopClose")?.focus(), 0)` หลัง open
- ใช้ทั้ง 2 popover types
- Benefits: a11y (keyboard nav) + visual confirmation ว่า popover visible + Esc key ทำงานทันที

### Regression check ✅

- Calendar event chip click → leave details popover ทำงานเหมือนเดิม (logic ไม่แตะ — เฉพาะ layout)
- Dense day "+N รายการ" → day-list popover ทำงานเหมือนเดิม (logic ไม่แตะ)
- Esc + backdrop close ยังทำงาน (handlers เดิม)
- Mobile bottom sheet (≤768px) — slide-up animation + grabber bar ยังทำงาน
- Edit quota warning (92.38c) ไม่แตะ
- Calendar mobile agenda (92.39) ไม่แตะ

### Tests +5 source-level

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `#lmPopover` container ใช้ flex layout via attribute selector + mobile override
- `.lm-pop-dialog` desktop มี `max-height: calc(100vh - ...)` + `flex-direction: column` + inner scroll
- z-index hierarchy: backdrop z-index:0 + dialog z-index:1 explicit
- ทั้ง 2 popover types ใช้ `class="lm-pop-body"` ใน inner content
- Focus close button หลัง open (a11y + visibility confirm) ทั้ง 2 popover types

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **651/651** (646 + 5)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.1 → **5.62.2** (patch hotfix)
- `index.html`: ?v=304→305, data-app-build="305", data-app-version="5.62.2"
- `sw.js`: cache v304→v305 + v305 comment line

### Smoke test (manual)

1. Production Ctrl+Shift+R → APP_BUILD=305
2. หน้าวันลา → ปฏิทิน → คลิก "+N รายการ" บน cell ที่มี events ≥ 4
3. day-list popover ต้องเปิดที่ **กลางจอ desktop** หรือ **ตรงจาก bottom mobile** — มองเห็นชัด
4. กด Esc → ปิด (focus อยู่ที่ close button → keyboard ได้ทันที)
5. คลิก backdrop → ปิด
6. **เปิด DevTools บีบ viewport** ให้สูง ~400px → popover ยังเห็นได้ (scroll ภายใน body ได้)
7. Mobile (≤768px) → bottom sheet slide-up จากด้านล่าง + grabber bar + ไม่มี horizontal overflow
8. ทดสอบ event click chip ปกติ → leave details popover ก็ทำงานเหมือนกัน (same .lm-pop-dialog rules)

---

## 🧪 Phase 92.39b — Calendar Dense Day "+N รายการ" verification

**บริบท:** Production scenario เดิม (sompong 2 events/day) ไม่เคย trigger overflow branch — cap=3 ไม่เกิน. User ขอ verify ว่าเมื่อมี dense day (4+ events วันเดียว) flow ทำงานครบ:
1. Desktop cell แสดง 3 events + "+N รายการ"
2. Click "+N รายการ" → day-list popover แสดง events ทั้งหมด
3. Click event ใน popover → chained leave details popover
4. Esc / backdrop close
5. Mobile agenda ไม่ล้น

**ผลลัพธ์:** ทั้ง pipeline verified ไม่มี bug → **test-only release** (ไม่แตะ behavior).

### Verification approach

แทนที่จะ mock dense data ใน DB → ใช้ 2 levels of testing:

**1) Unit edge tests** (`limitCalendarDayEvents` 7 cases):
- `[], cap=3` → visible=[] overflow=0 (no chip)
- `events.length === cap` → boundary, no overflow
- `events.length === cap+1` → off-by-one (cap visible, 1 overflow)
- `5 events, cap=3` → 3 visible + 2 overflow + ลำดับ preserve
- `5 events, cap=2` → tighter scenario (2 visible + 3 overflow)
- immutability: `visible.push()` ไม่กระทบ events เดิม
- existing: ≤ cap, > cap, invalid cap, non-array

**2) Source-level integration tests** (6 tests) — อ่าน leave_management.js raw → assert wiring:

| Assert | Pattern |
|---|---|
| Overflow chip template | `+ ${overflowCount} รายการ` |
| Chip class | `class="lm-cal-more"` |
| Chip data attr | `data-lm-date="${escHtml(cell.dateStr)}"` |
| Cap constant | `_CAL_DESKTOP_MAX_VISIBLE = 3` |
| Helper call | `limitCalendarDayEvents(events, _CAL_DESKTOP_MAX_VISIBLE)` |
| Click delegation | `ev.target.closest(".lm-cal-more")` → `_openDayListPopover(dateStr, filtered)` |
| Popover read | `groupLeavesByDate(filtered, activeMonth)` → `byDate.get(dateStr)` |
| Popover render | `events.map(ev => _calendarEventChip(ev, profileMap, dateStr))` |
| Chained click | `_openLeavePopover` ใน popover event click handler |
| Esc + backdrop | `_registerPopoverEsc` + `#lmPopBackdrop` addEventListener `click` |

### Regression check ✅

- ไม่แตะ render code (เฉพาะเพิ่ม tests) — production behavior identical กับ build 303
- ไม่มี SQL / RLS ใหม่
- Edit quota warning build 302 ✓
- Filters / table view ✓
- Mobile agenda ✓

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **646/646** (633 + 13)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.62.0 → **5.62.1** (patch — test-only release)
- `index.html`: ?v=303→304, data-app-build="304", data-app-version="5.62.1"
- `sw.js`: cache v303→v304 + v304 comment line

### Smoke test (manual)

★ ต้องมี dense data ก่อน — ผู้ใช้สร้าง 4+ leave events ในวันเดียวกัน (วันที่ 26 พ.ค. ตัวอย่าง)

1. Production (Ctrl+Shift+R) → APP_BUILD=304
2. หน้าวันลา → ปฏิทิน → วันที่ 26 พ.ค.
3. ต้องเห็น chip 3 ตัว (cap=3) + ปุ่ม "+N รายการ" สีเทาดำ dashed border
4. คลิก "+N รายการ" → popover เปิด (desktop = centered modal / mobile = bottom sheet)
5. ต้องเห็น events ครบทั้งหมดของวันนั้น (รวม visible + overflow)
6. คลิก event ใด event หนึ่งใน popover → ปิด popover เก่า → เปิด leave details popover (chained)
7. กด Esc → ปิด popover ทันที (ทั้ง 2 types)
8. คลิก backdrop → ปิด popover
9. Mobile (resize ≤768px) → agenda list แสดง events ทั้งหมดในวันนั้น แบบ list ลงล่าง ไม่จำกัด cap

---

## 📱 Phase 92.39 — Leave Calendar Mobile Agenda + Dense Day Polish

**บริบท:** ต่อจาก 92.38c. Calendar Leave View ใช้งานได้แล้วบน desktop แต่ user feedback:
- บนมือถือ grid 7-col แน่นเกิน อ่านยาก / horizontal overflow
- วันที่มี leave หลายคน cell ขยายสูง ทำ grid แตก
- popover detail บนมือถือไม่ฟิตจอ + ไม่มี Esc

### Pure helpers ใหม่ ([`modules/leave_management.js`](modules/leave_management.js))

- `groupCalendarAgendaDays(leaves, month)` → array of `{dateStr, dayNum, dowIndex, dowLabel, monthShort, events}` (เฉพาะวันที่มี events, sorted ascending) — wrap `groupLeavesByDate` + เติม dow info ครบ พร้อม render
- `limitCalendarDayEvents(events, maxVisible)` → `{visible, overflowCount}` — split events เป็น visible (default cap 3) + count ส่วนเกิน
- `formatAgendaDateLabel(dateStr)` → "วันพุธ 14 พ.ค." (Asia/Bangkok, pure epoch math จาก 92.38b)

### UI changes

**Desktop month grid (`_renderCalendarMonthGrid`):**
- ใช้ `limitCalendarDayEvents(events, _CAL_DESKTOP_MAX_VISIBLE = 3)` แทน `events.slice(0, 3)` inline
- Overflow → ปุ่ม `"+N รายการ"` (เปลี่ยนจาก "+N เพิ่มเติม") → day-list popover
- Cell `max-height: 140px` (เดิมไม่มี max) — กัน grid แตก
- `min-height` ปรับเป็น 96px (เดิม 88px) อ่านง่ายขึ้น

**Mobile agenda (`_renderCalendarAgenda`):**
- ใช้ `groupCalendarAgendaDays` + `formatAgendaDateLabel` แทน inline `toLocaleDateString`/`Date.getDay()`
- Empty state ปรับ: icon ใหญ่ขึ้น + sub-hint "ลองเปลี่ยนเดือน · สถานะ · หรือประเภทใน filter ด้านบน"
- Header padding + font-size ใหญ่ขึ้นเล็กน้อย อ่านง่ายบนมือถือ

**Responsive section (`_renderCalendarSection`):**
- Breakpoint `max-width: 720px` → `768px` (สอดคล้อง tablet portrait)
- Mobile chip override: `font-size: 12px; padding: 5px 8px` (ใหญ่กว่า desktop chip 10px)

**Popover (`_renderLeavePopover` / `_renderDayListPopover`):**
- Desktop: centered modal เดิม (`max-width: 420px`, `margin: 60px auto`)
- Mobile (≤768px) bottom sheet:
  - `position: fixed; left: 0; right: 0; bottom: 0`
  - `border-radius: 16px 16px 0 0` (มุมโค้งบน)
  - `max-height: 80vh; overflow-y: auto`
  - Slide-up animation 200ms ease-out
  - Grabber bar (`.lm-pop-grabber`) แสดงด้านบนเฉพาะ mobile
- ปุ่ม action + font ใหญ่ขึ้น (8px→10px padding, 12px→13px font) — tap target ผ่าน Apple 44pt guideline

**Esc key:**
- `_registerPopoverEsc` register on open (`_openLeavePopover` / `_openDayListPopover`)
- `_closePopover` unregister — กัน listener leak ตอน rerender

### Regression check ✅

- Leave Balance / Quota Phase 92.35 — ไม่กระทบ (ไม่แตะ `calcBalancesForUser` หรือ `_renderBalanceSection`)
- Paid Leave Policy 92.36 + payroll save 92.37 + edit quota warning 92.38c — ไม่กระทบ
- Calendar desktop chip rendering — ใช้ `_calendarEventChip` เดิม
- Edit leave modal — ไม่แตะ form layout / submit / `_refreshQuotaWarn`
- Time Clock build 295 — ไม่แตะ
- Helpers pure epoch math จาก 92.38b — ยังใช้ `_bkkMidnightMs`/`_bkkDateStr`/`_bkkDow` เดิม
- ไม่มี SQL / RLS ใหม่

### Tests +11

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `groupCalendarAgendaDays`: sorted ascending + dow info / หลายคนวันเดียวกัน stack / leave หลายวัน expand / empty/null safe (4 tests)
- `limitCalendarDayEvents`: events ≤ cap full / events > cap split + count / invalid cap fallback 3 / non-array safe (4 tests)
- `formatAgendaDateLabel`: format ปกติ "วัน{dow} D {month-short}" / invalid → "" / ครอบ 12 เดือนไทย (3 tests)

### Gates

- `npm run lint:errors` exit 0 (clean)
- `npm test` = **633/633** (622 + 11)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.61.2 → **5.62.0** (minor — UX polish + new helpers)
- `index.html`: ?v=302→303, data-app-build="303", data-app-version="5.62.0"
- `sw.js`: cache v302→v303 + v303 comment line

### Smoke test (manual)

**Desktop:**
1. Production (Ctrl+Shift+R) → APP_BUILD=303
2. หน้าวันลา → ปฏิทิน → พ.ค. 2026
3. วันที่ 14–25 มี chips ของ sompong "(ต่อ)" — แสดง 3 อันแรก + "+N รายการ" (ถ้ามี leave คนอื่นซ้อน) → คลิกเปิด day list popover (centered modal, max-width 420px)
4. Click chip → leave popover (centered) — ปุ่ม edit/delete ตาม role
5. กด Esc → ปิด popover

**Mobile (DevTools → 390×844 iPhone 12 Pro หรือเล็กกว่า 768px):**
1. หน้าวันลา → ปฏิทิน → agenda list (ไม่ใช่ grid 7-col)
2. ไม่มี horizontal overflow — chips แสดงในกล่องวันต่อวัน
3. Header แต่ละวัน: "วันXX D เดือน · วันนี้?" + count "N รายการ"
4. แตะ chip → bottom sheet เปิด slide-up จากด้านล่าง + มี grabber bar
5. แตะ backdrop หรือ Esc (ถ้ามีคีย์บอร์ดต่อ) → ปิด
6. ลอง filter status = "ปฏิเสธ" + ไม่มี record → empty state ใหญ่ "ไม่มีรายการลาในเดือนนี้" + hint

---

## 🧯 Phase 92.38c — HOTFIX leave edit quota warning double-count

**บริบท:** Production smoke หลัง build 301 — sompong มี vacation approved รวม 12 วัน (เกิน quota 10 = 2 วัน). เปิด edit modal ของ record 2 วัน → quota warning แสดง **"เกิน quota 4 วัน"** ทั้งที่ควรเป็น 2; เปิด edit record 10 วัน → **"เกิน quota 12 วัน"** ทั้งที่ควรเป็น 2 → record เดิมถูกนับซ้ำ.

### สาเหตุ ([`modules/leave_management.js`](modules/leave_management.js) line ~1835)

```js
const existingDays = existing && existing.status === "pending" && ... ? Number(existing.days_count || 0) : 0;
const projectedPending = (b.pending - existingDays) + newDays;
const projectedTotal = b.used + projectedPending;
```

- ลบเฉพาะ `existing.days_count` เมื่อ `status === "pending"` → **approved record ไม่ถูก exclude**
- `b.used` มาจาก `calcBalancesForUser` ที่นับทุก approved row (รวม record ที่กำลัง edit)
- ผลลัพธ์: ผู้ใช้กรอก `newDays = 2` แล้วถูกบวกเข้า `b.used = 12` → projected = 14 → overBy = 4
- ที่แย่กว่า: ถ้าเปลี่ยน leave_type → bucket ใหม่นับ record เดิมในประเภทเก่าอยู่ดี

### สิ่งที่แก้

**1) `calcBalancesForUser` — เพิ่ม optional `excludeLeaveId` param**

- filter `leaves.filter(r => String(r.id) !== String(excludeId))` ก่อนนับ
- ทำงาน ทั้ง approved + pending (ไม่จำกัด status)
- compare loose แบบ string (ป้องกัน mismatch ระหว่าง `bigint` ใน DB กับ string จาก DOM)
- `excludeLeaveId === undefined/null/""` → no-op (create mode behavior คงเดิม)

**2) `_refreshQuotaWarn` ใน form modal**

- ส่ง `excludeLeaveId: existing?.id` ตอนเรียก `calcBalancesForUser`
- ลบ logic `existingDays`-pending-only ออก
- `projectedPending = b.pending + newDays` (b ที่ exclude record นี้แล้ว)
- `projectedTotal = b.used + projectedPending`
- `overBy = projectedTotal - b.quota`

### Expected behavior หลังแก้

- edit record approved 2 วัน → `b.used` (หลัง exclude) = 10, `+ newDays = 2` → projected 12 → overBy 2 (ถูกต้อง)
- edit record approved 10 วัน → `b.used` (หลัง exclude) = 2, `+ newDays = 10` → projected 12 → overBy 2 (ถูกต้อง)
- เปลี่ยน days 2 → 5: `b.used = 10` + `newDays = 5` → projected 15 → overBy 5 (delta +3 ถูก)
- เปลี่ยน days 10 → 8: `b.used = 2` + `newDays = 8` → projected 10 → overBy 0 (ถูกต้อง ลดลง)
- เปลี่ยน leave_type vacation → sick: bucket ใหม่ filter exclude id เดียวกัน → sick bucket ไม่ได้รับผลกระทบ
- เปลี่ยน employee: balance ของ user คนใหม่ filter exclude id เดียวกัน — ไม่มี match ก็ no-op

### Regression check ✅

- Balance / Quota cards (หน้า Leave) ยังนับ DB จริงเหมือนเดิม (`calcBalancesForUser` เรียกจาก `_rerender` ไม่ส่ง `excludeLeaveId`)
- Payroll decision Phase 92.36 — `decidePayrollLeaveImpact` ไม่ใช้ `excludeLeaveId` → ไม่กระทบ
- Calendar view Phase 92.38 — ไม่แตะ
- Time Clock build 295 — ไม่แตะ
- ไม่มี SQL/RLS ใหม่

### Tests +7

[`tests/leave_management.test.js`](tests/leave_management.test.js):
- `edit approved 2 วัน` — exclude id แล้ว used ลดลง 2 (overQuota=false)
- `edit approved 10 วัน` — exclude id แล้ว used ลดลง 10
- `edit pending` — exclude id ลด pending (used คงเดิม)
- `เปลี่ยน leave_type bucket` — exclude vacation → sick bucket ไม่กระทบ
- `excludeLeaveId ที่ไม่มีจริง` → no-op
- `create mode (undefined/null/empty)` → behavior เดิม
- `number id vs string id` cross-type compare safety

### Gates

- `npm run lint:errors` exit 0
- `npm test` = **622/622** (615 + 7)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync

- `package.json`: 5.61.1 → **5.61.2** (patch hotfix)
- `index.html`: ?v=301→302, data-app-build="302", data-app-version="5.61.2"
- `sw.js`: cache v301→v302 + v302 comment line

### Smoke test (manual)

1. Production (Ctrl+Shift+R) → APP_BUILD=302
2. เปิด หน้า "วันลา" → Calendar
3. คลิก event sompong 2 วัน → กด "✏️ แก้ไข" → modal เปิดด้วยค่าเดิม
4. quota warning ต้องบอกว่า "เกิน quota 2 วัน" (ไม่ใช่ 4) — เพราะ record นี้ถูก exclude ก่อนคำนวณ
5. เปลี่ยน days = 5 → warning เปลี่ยนเป็น "เกิน quota 5 วัน" (delta +3 จาก baseline 10/10)
6. เปลี่ยน days = 8 → warning หาย หรือเป็น "เกิน 0" (baseline 10/10 + 8 - 10 = 8 → wait)

   _แก้ exposition: หลัง exclude 2 record (ที่กำลัง edit) → baseline used = 10 (record อื่น) → + days 8 → projected 18 → over 8._

   ★ **Correction:** หลัง exclude record 2 วัน → baseline used = 10 (จาก record 10 วันที่ยังคงอยู่). กรอก newDays = 8 → projected = 10 + 8 = 18 → over 8 วัน.

   _ตัวอย่างจริงๆ ในข้อ 6:_ ถ้า user มี record อื่นใน vacation ที่ approved 10 + กำลัง edit record 2 → exclude 2 → baseline 10. ใส่ days = 0 ไม่ได้ (validation), days = 1 → over 1. ถ้าต้องการ over=0 → days = 0 หรือ ลบ record อีกอันก่อน
7. กดยกเลิก หรือ บันทึก — submit insert ใหม่ (ไม่ใช่ update — ดู existing form submit logic)

---

## 🧯 Phase 92.38b — HOTFIX TZ-dependent calendar helpers (this session)

**บริบท:** push 92.38 → Cloudflare Pages deploy success (live build 300) แต่ GitHub Actions Tests workflow **fail** ที่ 2 tests:
- `expandLeaveRangeToMonthDays — leave ข้ามเดือน → clip เฉพาะวันใน month ที่ดู`
- `getCalendarMonthGrid — first cell คือ Sunday ของสัปดาห์ที่มี 1 ของเดือน`

Local Windows (TZ=Bangkok) ผ่าน 615/615; CI Linux (TZ=UTC) fail 2 → CI parity issue ที่ผมพลาด

### สาเหตุ

- `getCalendarMonthGrid`: ใช้ `first.getDay()` → method `Date.getDay()` อ่าน DOW ตาม **local TZ ของ environment** ไม่ใช่ Bangkok
  - UTC env: `2026-05-01T00:00:00+07:00` ⇄ `2026-04-30T17:00:00Z` → `getDay()` = 4 (Thu) ใน UTC, ควรเป็น 5 (Fri) ใน Bangkok
- `expandLeaveRangeToMonthDays`: ใช้ `nextMonth.setMonth(getMonth()+1)` + `toLocaleDateString` — เสี่ยง parity ในเงื่อนไข specific

### สิ่งที่แก้ ([`modules/leave_management.js`](modules/leave_management.js))

เพิ่ม 3 internal helpers pure epoch math:
- `_bkkMidnightMs(yyyyMmDd)` = `Date.parse(s + "T00:00:00+07:00")` — UTC ms ของ Bangkok midnight
- `_bkkDateStr(ms)` = shift `ms + 7*3600*1000` แล้ว format `getUTCFullYear/Month/Date` → YYYY-MM-DD
- `_bkkDow(ms)` = `((floor((ms + 7h)/86400000) % 7) + 4) % 7` — 1970-01-01 = Thu reference

แทนที่ใน 2 helpers:
- `expandLeaveRangeToMonthDays`: month end exclusive คำนวณจาก year+month next (ไม่ใช้ `setMonth`); loop ใช้ `_bkkDateStr` แทน `toLocaleDateString`
- `getCalendarMonthGrid`: `firstDow` ใช้ `_bkkDow`; loop 42 cells ใช้ index math + `_bkkDateStr` แทน `cursor.setDate()`; dayNum extract จาก dateStr.slice(8,10) แทน `Date.getDate()`

### ตรวจสอบ

- Local Windows Bangkok TZ: unit **615/615**
- Simulated CI: `$env:TZ='UTC'; node --test tests/leave_management.test.js` → **108/108**
- Lint clean, audit 0

### Version sync

- `package.json`: 5.61.0 → **5.61.1** (patch hotfix)
- `index.html`: ?v=300→301, data-app-build="301", data-app-version="5.61.1"
- `sw.js`: cache v300→v301 + v301 comment line

---

## 📅 Phase 92.38 — Calendar Leave View (this session)

**บริบท:** ต่อจาก 92.37. หน้า "วันลา" ใน production มีตารางอย่างเดียว — admin/พนักงานไม่เห็น overview ของวันลา/บรรยากาศเดือนนั้น ๆ ในแบบ visual. เฟสนี้เพิ่ม **Calendar view** เป็นมุมมองทางเลือก (table ยังเป็น default คงเดิม) — ดูภาพรวมเดือนได้, click event เปิด popover พร้อม action ตาม role.

### Pure helpers (test-friendly, Asia/Bangkok)

[`modules/leave_management.js`](modules/leave_management.js):
- `expandLeaveRangeToMonthDays(leave, month)` — return array YYYY-MM-DD ที่ overlap month นั้น; clip ที่ขอบเดือน (leave ข้ามเดือนแสดงเฉพาะวัน in-month); empty month → ใช้ทั้งช่วง
- `groupLeavesByDate(leaves, month)` — Map<YYYY-MM-DD, Array<leave>> เรียง key ascending; leave หลายวันกระจายอยู่หลาย key; หลายคนวันเดียวกัน stack ใน key เดียว
- `getCalendarMonthGrid(month, todayStr?)` — { weeks: [6 × 7 cells], monthLabel, year, monthNum }; first cell = Sunday ของแถวที่มีวันที่ 1; cell มี `{ dateStr, dayNum, inMonth, isWeekend, isToday }`; รองรับ leap year; invalid month → weeks=[]

### UI changes — `renderLeaveManagementPage`

- เพิ่ม state `activeView = "table"` (default คงเดิม)
- Filter bar เพิ่มปุ่ม toggle 2 ตัว: 📋 ตาราง / 📅 ปฏิทิน — active state = พื้นน้ำเงิน, inactive = ขาว
- เมื่อ `activeView === "calendar"` → render `_renderCalendarSection(filtered, activeMonth, profileMap, today)`
- เมื่อ `activeView === "table"` → render table เดิม (ไม่เปลี่ยน)

### Desktop month grid (`_renderCalendarMonthGrid`)

- 7-col grid (อา–เสาร์, Sun-first ตาม Thai POS convention)
- 6 rows × 7 cells (เริ่ม Sunday ของสัปดาห์ที่มี 1 ของเดือน)
- Cell ละ row แสดง:
  - dayNum + "วันนี้" chip (ถ้า isToday)
  - Event chips ≤ 3 ตัว (ใช้ `_calendarEventChip`): icon ประเภท + ชื่อพนักงาน + suffix "(ต่อ)" ถ้าวันที่ไม่ใช่ start_date
  - Overflow > 3 → ปุ่ม "+ N เพิ่มเติม" → day-list popover
- Visual cues:
  - Today = bg เหลือง + border ส้ม
  - In-month = white, out-month = grey
  - Weekend (Sun/Sat) = day color แดง
  - Status pending = dashed border, rejected/cancelled = opacity 0.55, approved = solid

### Mobile agenda (`_renderCalendarAgenda`, ≤720px)

- CSS-driven responsive (`@media (max-width: 720px)`)
- Group เฉพาะวันที่มี event (ไม่แสดงวันว่าง)
- แต่ละ block: dow label ไทย (วันพุธ/วันศุกร์/...) + count + chips ของวันนั้น
- ถ้าไม่มี event ในเดือน → empty state 📭 "ไม่มีรายการลาในเดือนนี้"

### Click interaction (popover)

[`#lmPopover`] container ใหม่ใน DOM:
- Click chip → `_openLeavePopover(leave)`:
  - แสดง: icon ประเภท + ชื่อพนักงาน + label ประเภท + date range + จำนวนวัน + status chip + reason + review_note
  - ปุ่ม action ตาม role (ใช้ `canEditLeave`/`canReviewLeave` guard เดิม):
    - admin: ✓ อนุมัติ / ✕ ปฏิเสธ (ถ้า pending) · ✏️ แก้ไข / 🗑️ ลบ
    - non-admin: ยกเลิก (เฉพาะ row ของตัวเอง + pending)
- Click "+N เพิ่มเติม" → `_openDayListPopover(dateStr)` — list ทุก leave ในวันนั้น → click row → chained popover (leave details)
- Backdrop click / ปุ่ม ✕ → close

### Integration กับ filters เดิม

- View toggle ใช้ `month`/`status`/`type` filter เดียวกัน (state ใน `_rerender` scope)
- เปลี่ยน month → calendar re-render with new grid
- เปลี่ยน status/type → events ที่ผ่าน filter เท่านั้นแสดงใน calendar
- Export, KPI cards, Balance section, Create form — ใช้ flow เดิม ไม่กระทบ

### Regression check ✅

- Leave Balance / Quota Phase 92.35 — ไม่กระทบ (`_renderBalanceSection` แยกจาก calendar)
- Paid Leave Policy decision Phase 92.36 (payroll modal) — ไม่กระทบ (คนละ module flow)
- Payroll save audit Phase 92.37 — ไม่กระทบ (ไม่แตะ payroll.js)
- Time Clock responsive build 295 — ไม่กระทบ (แตะเฉพาะ leave_management.js)
- ไม่แตะ DB schema / RLS / SQL / payroll math / time_clock
- Non-admin ยังเห็นเฉพาะของตัวเอง (client filter line 1040 + RLS server-side)

### Gates

- `npm run lint:errors` exit 0 (clean)
- `npm test` = **615/615** (595 + 20 ใหม่)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items)

- `package.json`: 5.60.0 → **5.61.0** (minor — UI addition)
- `index.html`: `style.css?v=299→300`, `selfheal.js?v=299→300` + `data-app-build="300"` + `data-app-version="5.61.0"`, `main.js?v=299→300`, `boot.js?v=299→300`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v300'` + v300 + v299 comment lines

### Smoke test (manual)

1. **ไม่ต้องรัน SQL ใหม่** — ใช้ตาราง 92.32 + 92.35
2. Production (Ctrl+Shift+R) → APP_BUILD=300
3. **Admin → 🌴 วันลา → เลือกเดือน พฤษภาคม 2026**
4. Default = ตาราง — ตรวจปุ่ม toggle อยู่บน filter bar (📋 ตาราง / 📅 ปฏิทิน)
5. กด **📅 ปฏิทิน** → ควรเห็น 7-col grid:
   - sompong พักร้อน 14–25 พ.ค. (12 วัน) → chips สีฟ้า 🌴 บนวันที่ 14 + วันที่ 15–25 มี chip "(ต่อ)"
   - วันนี้ (26 พ.ค.) cell มี border ส้ม + chip "วันนี้"
6. **filter ประเภท = "พักร้อน"** → ยังเห็น chips ของ sompong (ประเภทอื่นหาย)
7. **filter สถานะ = "อนุมัติแล้ว"** → ถ้า sompong approved → solid border; rejected/cancelled หาย
8. **click chip** → popover แสดง: 🌴 sompong, "พักร้อน · 2026-05-14 → 2026-05-25 (12 วัน)", สถานะ ✅ อนุมัติแล้ว, reason ถ้ามี, ปุ่ม ✏️ แก้ไข / 🗑️ ลบ (admin)
9. ปิด popover (✕ หรือ click backdrop)
10. **mobile view** (resize browser ≤720px หรือเปิดบนมือถือ) → calendar เป็น agenda list — group เฉพาะวันที่มี event, dow label ไทย ("วันพุธ 14 พ.ค.")
11. กด **📋 ตาราง** → กลับมา table view เดิม — filters ยังคง state เดิม

---

## 🧮 Phase 92.37 — Payroll Save + Leave Deduction Finalization Audit

**บริบท:** ต่อจาก 92.36b (idempotency hotfix) — production smoke เคส sompong พักร้อน 12 วัน, quota 10, เกิน 2 วัน, daily rate 400 → แนะนำหัก ฿800 → ช่อง `หัก (-)` = `฿800` → สุทธิ = `฿400`. ปุ่ม "เติมลงช่องหัก" กดซ้ำไม่บวกซ้ำแล้ว (จาก 92.36b) แต่ยังเหลือ gap UX:
1. กด "ดึงสรุปวันลา" ซ้ำหลังเปิดรายการเดิม → ปุ่ม apply ยังโผล่ทุกครั้ง → admin ไม่รู้ว่า "เคยเติมไปแล้ว"
2. หลังกด apply แล้ว row ถูก hide → admin ตรวจไม่ทันว่าเติมไปจริง
3. ไม่มี warning info ที่ชัดเจนว่ามีรายการหักวันลาแล้ว

### Audit (Goal 1) — save flow ผ่านครบ ✅

- `_savePayroll` ใน [`modules/payroll.js`](modules/payroll.js) อ่าน `deductions`/`note` ตรงจาก DOM inputs → ส่ง PATCH/POST ไป staff_payroll ตรง ๆ — **ไม่มี mutation/override**
- `total_amount` คำนวณฝั่ง DB (generated/trigger) — payload ไม่ส่ง field นี้, ให้ DB ตัดสินจาก base+ot+welfare+bonus+commission − deductions
- เปิด modal edit รายการเดิม → `value="${Number(payroll?.deductions || 0)}"` + `escHtml(payroll?.note || '')` ตรงๆ — ค่าเดิม survive ครบ
- กด "ดึงสรุปวันลา" ซ้ำ + apply ซ้ำ → `hasLeaveDeductionNoteMarker(curNote, marker)` จับ marker เดิมใน note → ปฏิเสธการบวกซ้ำ (จาก 92.36b)

### UX hardening (Goal 2-3) — guards + visual state

[`modules/payroll.js`](modules/payroll.js):
- เพิ่ม `prLeaveApplyInfo` element (yellow box) ใต้ปุ่ม apply
- เพิ่ม `_setLeaveApplyButtonState(applied, suggestedAmount)`:
  - `applied=true` → ปุ่ม disabled, label `✓ เติมแล้ว`, สีเทา (#94a3b8), cursor not-allowed + info แสดง `ⓘ ตรวจพบรายการหักวันลาแล้ว (เติม ฿X ไว้แล้ว — แก้ช่องหัก/หมายเหตุก่อนบันทึก)`
  - `applied=false` → ปุ่ม active, label `→ เติมลงช่องหัก`, สีแดง + ซ่อน info
- `_refreshLeaveDecision`: หลังคำนวณ decision + render breakdown → ตรวจ `hasLeaveDeductionNoteMarker(curNote, marker)` แล้วเรียก `_setLeaveApplyButtonState(already, suggestedDeduction)` — guard ทำงานทันทีตอน reopen + กด "ดึงสรุปวันลา"
- `prFillLeaveBtn` click handler: หลัง apply สำเร็จ → เรียก `_setLeaveApplyButtonState(true, ...)` แทน `_hideLeaveApplyRow()` — apply row ไม่ซ่อน, admin เห็น breakdown + state ปุ่มชัด
- Live recompute: เพิ่ม `prNote` ใน listener list (`prBase`/`prDailyRate`/`prDailyToggle`/`prNote`) → admin ลบ marker จาก note → ปุ่ม apply กลับมา active ทันที (ไม่ต้อง re-fetch)

### Tests (Goal 4)

[`tests/leave_management.test.js`](tests/leave_management.test.js) — เพิ่ม 5 test:
- `hasLeaveDeductionNoteMarker — เคส smoke จริง: หัก 2 วันเกิน quota, reopen รายการเดิม` (round-trip note → reopen guard)
- `hasLeaveDeductionNoteMarker — เคส decimal และตัวเลขมีเศษ` (`0.5`, `1.50`, `10` วัน)
- `hasLeaveDeductionNoteMarker — manual note ที่ไม่มี marker pattern → allow apply` (`ลาป่วย 5 วัน` ไม่ match, `หักลา 2 ครั้ง` ไม่ match)
- `hasLeaveDeductionNoteMarker — null/undefined/whitespace-only safety`
- `hasLeaveDeductionNoteMarker — exact marker priority over regex fallback`

### Regression check ✅

- ไม่แตะ payroll save payload shape / money math / DB / RLS / SQL / auto-deduction
- Leave Balance Phase 92.35 + Paid Leave Policy 92.36 + Time Clock responsive build 295 ไม่ regression — แตะเฉพาะ UI guard ใน payroll modal

### Gates

- `npm run lint:errors` exit 0 (clean)
- `npm test` = **595/595** (590 + 5 ใหม่)
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items)

- `package.json`: 5.59.1 → **5.60.0** (minor — UX behavior change)
- `index.html`: `style.css?v=298→299`, `selfheal.js?v=298→299` + `data-app-build="299"` + `data-app-version="5.60.0"`, `main.js?v=298→299`, `boot.js?v=298→299`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v299'` + v299 + v298 comment lines

### Smoke test (manual)

1. **ไม่ต้องรัน SQL ใหม่** — ใช้ตาราง 92.32 + 92.35
2. Production (Ctrl+Shift+R) → APP_BUILD=299
3. Admin → 💰 รายการเงินเดือน → เปิดรายการ sompong พฤษภาคม 2026
4. ช่อง `หัก (-)` = `800`, note มี marker `หักลา 2 วัน (เกิน quota 2)` ✓
5. กด "📥 ดึงสรุปวันลา" อีกครั้ง → policy breakdown แสดง: ✅ Paid 10 · ⚠️ Over 2 · → แนะนำหักรวม ฿800
6. ตรวจปุ่ม `→ เติมลงช่องหัก` → ควร **disabled** + label `✓ เติมแล้ว` + info แสดง `ⓘ ตรวจพบรายการหักวันลาแล้ว ...`
7. ลบ marker `· หักลา 2 วัน (เกิน quota 2)` ออกจาก note → ปุ่มกลับมา active
8. กดปุ่ม apply → ช่อง `หัก (-)` คงเป็น `800` (ไม่บวกเป็น `1600`) + ปุ่ม disabled + info แสดงอีกครั้ง
9. กด `+ บันทึก` → success
10. เปิดรายการเดิมอีกครั้ง → `deductions=800`, สุทธิยังถูก, note marker ยังอยู่ ✓

---

## 🧯 Phase 92.36b — Payroll leave apply idempotency hotfix

**บริบท:** Production smoke หลัง Phase 92.36 เจอว่าเคสพักร้อนเกิน quota 2 วัน คำนวณแนะนำหัก `฿800` ถูกต้อง แต่ถ้ากดปุ่ม "→ เติมลงช่องหัก" ซ้ำ ช่อง `หัก (-)` ถูกบวกซ้ำเป็น `฿1600` และสุทธิกลายเป็นติดลบ ทั้งที่ note มี marker `หักลา 2 วัน (เกิน quota 2)` แล้ว.

### สาเหตุ

- Guard เดิมใน [`modules/payroll.js`](modules/payroll.js) ใช้ exact `curNote.includes(marker)`
- ถ้า marker format drift เช่น `2` vs `2.00` หรือ note ถูก normalize ต่างกันเล็กน้อย guard อาจไม่ match แล้วบวกยอดซ้ำ

### สิ่งที่แก้

- [`modules/leave_management.js`](modules/leave_management.js)
  - เพิ่ม pure helper `hasLeaveDeductionNoteMarker(note, marker)`
  - เช็ค exact marker ก่อน แล้ว fallback regex `/หักลา\s+\d+(?:\.\d+)?\s*วัน/`
  - หลักการ: ถ้า note มี marker "หักลา ... วัน" อยู่แล้ว ถือว่า leave deduction applied แล้ว ห้ามบวกซ้ำ
- [`modules/payroll.js`](modules/payroll.js)
  - ปุ่ม "→ เติมลงช่องหัก" เปลี่ยนจาก `curNote.includes(marker)` เป็น `hasLeaveDeductionNoteMarker(curNote, marker)`
- [`tests/leave_management.test.js`](tests/leave_management.test.js)
  - เพิ่ม test เคส marker drift (`หักลา 2 วัน` vs `หักลา 2.00 วัน`) ต้อง detect เป็น applied
- Version/cache sync:
  - `package.json`: 5.59.0 → **5.59.1**
  - `index.html`: `?v=297→298`, `data-app-build="298"`, `data-app-version="5.59.1"`
  - `sw.js`: cache `v297→v298` + comment

### Smoke หลัง deploy

- เปิด Payroll modal เคสเดิมที่มี note `หักลา 2 วัน (เกิน quota 2)` และช่องหัก `800`
- กด "ดึงสรุปวันลา" แล้วกด "→ เติมลงช่องหัก" ซ้ำ
- Expected: ช่อง `หัก (-)` ยังเป็น `800`, ไม่กลายเป็น `1600`, และขึ้นข้อความเติมแล้วก่อนหน้านี้

### Gates

- `npm run lint:errors` = 0/0
- `npm test` = **590/590**
- `npm run test:e2e -- --reporter=line` = **11/11**
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

---

## 🧮 Phase 92.36 — Paid Leave Policy → Payroll Decision (this session)

**บริบท:** ต่อจาก Phase 92.35 (Leave Policy + Balance foundation) — ระบบรู้ quota รายปีแล้ว แต่ยังไม่ตัดสินใจว่าวันลา vacation/sick/personal ที่เกิน quota ควรหักหรือไม่. เฟสนี้เพิ่ม **policy decision helper** + **Payroll modal breakdown** + **Apply ที่รวม unpaid + over-quota** เป็นปุ่มเดียว (idempotent).

**Policy rule (advisory only — admin ต้องกดยืนยันเอง):**
- vacation/sick/personal **ภายใน quota → paid** (ไม่หัก)
- ส่วนที่เกิน quota → **แนะนำ** หักเฉพาะวันที่เกิน (advisory)
- unpaid → แนะนำหักทั้งหมด
- other → info only (ไม่หัก)

### สิ่งที่เพิ่ม

**1) Pure helpers** [`modules/leave_management.js`](modules/leave_management.js) (test-friendly):
- `decidePayrollLeaveImpact({monthSummary, balances, dailyRate, baseSalary})` → returns `{paidWithinQuotaDays, overQuotaDays, unpaidDays, otherDays, deductibleDays, suggestedDeduction, perType, hasBalanceData}`
  - หลักการคำนวณ "over": `usedBefore = balance.used - monthDays` (balance.used รวมเดือนนี้แล้ว) → `headroom = quota - usedBefore` → `paid = min(monthDays, headroom)` · `over = monthDays - paid`
  - ถ้า `balances=null` หรือ `tracksBalance=false` หรือ `quota=null` → tracked types treat เป็น paid ทั้งหมด (graceful)
- `leaveDeductionNoteMarker(decision)` → string marker `หักลา <D> วัน (ไม่รับค่าจ้าง U, เกิน quota O)` สำหรับ idempotent check ใน note

**2) Payroll modal** [`modules/payroll.js`](modules/payroll.js)
- ปุ่ม "📥 ดึงสรุปวันลา" ตอนนี้ **await ทั้ง period leaves + year balance ขนาน** แล้วคำนวณ decision
- เพิ่ม section "🧮 Policy breakdown (advisory)" — 5 cards: ✅ Paid · ⚠️ เกิน quota · 💸 ไม่รับค่าจ้าง · 📌 อื่น ๆ · → แนะนำหักรวม
- ปุ่ม "→ เติมลงช่องหัก" รวม unpaid + over-quota เป็นยอดเดียว · idempotent ผ่าน combined marker ใน note (ถ้า marker เดิมอยู่ใน note → toast แจ้ง + ไม่บวกซ้ำ)
- ข้อความ italic ใต้ปุ่ม apply: "★ ปุ่มนี้เป็นการ 'แนะนำ' ไม่หักเงินอัตโนมัติ — admin ตรวจช่องหัก/หมายเหตุก่อนบันทึก"
- recompute decision ทันทีเมื่อ admin แก้ base/dailyRate/dailyToggle (event listeners เดิม) → suggestedDeduction อัปเดต real-time

**3) Safety / non-regression**
- ★ Leave Balance UI (build 296) **ไม่ regression** — `_loadYearBalance` + `_renderBalanceSection` แยกออกจาก decision logic
- ★ Time Clock self responsive (build 295) **ไม่ regression** — แตะแค่ leave_management.js + payroll.js
- ไม่แตะ money math / staff_leaves write / payroll save / RLS / dep ใหม่
- ลบ unused import `calcUnpaidLeaveDeduction` ใน payroll.js (decidePayrollLeaveImpact เรียกภายในแล้ว)

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **589/589** (เพิ่ม 13 จาก 576: decide 8 + marker 5)
- `npm run test:e2e` = **11/11** (รอบแรก fail style.css?v=296 มิตรงกับ data-app-build 297 — แก้แล้วผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.58.0 → **5.59.0**
- `index.html`: `style.css?v=296→297`, `selfheal.js?v=296→297` + `data-app-build="297"` + `data-app-version="5.59.0"`, `main.js?v=296→297`, `boot.js?v=296→297`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v297'` + v297 + v296 comment lines

### Smoke test (manual)
1. **ไม่ต้องรัน SQL ใหม่** — ใช้ตารางจาก 92.32 + 92.35
2. เปิด `https://boonsook-pos-v5.pages.dev/` (Ctrl+Shift+R) → ตรวจ APP_BUILD=297
3. **Admin → "💰 รายการเงินเดือน":**
   - เพิ่ม/แก้ → เลือกพนักงานที่มีวันลา approved ในเดือนนั้น → กด "📥 ดึงสรุปวันลา"
   - ต้องเห็น **🧮 Policy breakdown** (5 cards) ใต้ summary และ **📊 ทั้งปี** balance (5 cards)
   - **เคส A** (ภายใน quota): พนักงานใช้ vacation 3 วันในเดือน ปียังเหลือ 7 → Paid=3, เกิน=0, แนะนำหัก=0 → apply row ซ่อน
   - **เคส B** (เกิน quota): พนักงานใช้ vacation 12 วันสะสมทั้งปี เดือนนี้ 5 วัน → Paid=3, เกิน=2, แนะนำหัก = 2 × dailyRate
   - **เคส C** (unpaid อย่างเดียว): unpaid 4 วัน → แนะนำหัก = 4 × dailyRate
   - **เคส D** (mixed): vacation 2 + personal 2 + unpaid 2 + other 1.5 (สมมติ personal เกิน 1 วัน) → Paid=3, เกิน=1, ไม่รับ=2, อื่นๆ=1.5, deductible=3
   - กด "→ เติมลงช่องหัก" → ช่อง "หัก (-)" บวกตามที่แนะนำ + note ได้ marker · กดซ้ำ → toast "เติมแล้วก่อนหน้านี้ (idempotent)"
4. **Graceful** (ก่อนรัน Phase 92.35 SQL): balance map = default policies → ทำงานเหมือน Phase 92.35 (UI label "ใช้ค่า default")
5. **Regression check:**
   - หน้า "🌴 วันลา" (Phase 92.35) → balance section ยังแสดงปกติ
   - หน้า "🕒 ลงเวลาทำงาน" mobile/desktop (build 295) — ไม่แตะ

### Follow-ups (ค้างจงใจ — ลำดับแนะนำ)
| ลำดับ | ค้าง | บริบท |
|---|---|---|
| 1 | Admin manage policies UI | "ตั้งค่า → Leave Policy" ให้ admin แก้ quota default ผ่าน UI |
| 2 | Per-user override UI | สร้าง `staff_leave_overrides` ผ่าน UI |
| 3 | Calendar leave view | ใช้ `modules/calendar.js` |
| 4 | Payslip รายละเอียดวันลา | section ในใบจ่ายเงินเดือน — เอา perType จาก decision มาแสดง |
| 5 | เชื่อม Time Clock → leave | approved leave → chip ใน HR Overview status table |
| - | Audit tab modal (ค้างจาก 92.30) · Late rule (ค้างจาก 92.29) · Edit attendance modal 7-วัน (ค้างจาก 92.30) | |

---

## 💼 Phase 92.35 — Leave Policy + Balance/Quota Foundation

**บริบท:** ต่อจาก Phase 92.33 (Leave→Payroll advisory) — user ขอ quota/balance พื้นฐาน: ทำเฟส foundation ก่อน (ตาราง + helpers + UI balance + form warning + payroll advisory display). **เฟสนี้ยังไม่เปลี่ยน money math** — vacation/sick/personal ยังแสดงเฉย ๆ ไม่หักเงิน. unpaid logic เดิม (Phase 92.33) ยังใช้.

### สิ่งที่เพิ่ม

**1) SQL migration** [`supabase-phase92-35-leave-policies-balances.sql`](supabase-phase92-35-leave-policies-balances.sql) — additive only:
- `leave_policies` (PK=`leave_type`, `annual_quota` numeric(6,2), `tracks_balance` bool, ...)
  - Seed 5 rows: vacation 10, sick 30, personal 3, unpaid null, other null · `ON CONFLICT DO NOTHING` re-run safe
- `staff_leave_overrides` (id, user_id uuid, leave_type, annual_quota, effective_year, ...) + `UNIQUE(user_id,leave_type,effective_year)`
- 4 CHECK + 2 indexes + 2 updated_at triggers
- 8 RLS policies (4 per table):
  - **leave_policies**: ทุก authenticated SELECT (UI ของ user ต้องอ่าน quota ของตัวเองได้) · admin write
  - **staff_leave_overrides**: admin all · user SELECT own
- `NOTIFY pgrst` + 6 verify queries

**2) Pure helpers** [`modules/leave_management.js`](modules/leave_management.js) (test-friendly):
- `defaultLeavePolicies()` — in-code fallback
- `effectiveQuotaForUser({userId, leaveType, year, policies, overrides})` → priority **override > policy > default**
- `calcLeaveBalance({quota, approvedDays, pendingDays})` → `{quota, used, pending, remaining, overQuota, willExceed}`
- `calcBalancesForUser({...})` → `Map<leave_type, balance>` — filter ปี ด้วย overlap, skip rejected/cancelled, ปัด 2 ตำแหน่ง
- `isOverQuotaWarning` · `formatBalanceLabel`
- `fetchLeavePolicies` / `fetchLeaveOverridesForUser` — graceful return shape

**3) UI หน้าวันลา**
- Section "💼 Balance / Quota (year)" ใต้ KPI — admin มี dropdown เลือกพนักงาน, non-admin ของตัวเอง
- 5 cards พร้อม chip สี + source label
- Form modal `#lmFormQuotaWarn` advisory (recompute on user/type/days change · ไม่ block submit)

**4) Payroll modal integration**
- ปุ่ม "ดึงสรุปวันลา" → render advisory balance ทั้งปีของ user (5 cards) ใน `#prLeaveBalance`
- vacation/sick/personal ยังไม่หักเงิน · unpaid logic เดิม

**5) Safety**
- ไม่แตะ money math / staff_leaves write / payroll save / RLS เก่า
- ★ Time Clock self responsive (build 295) **ไม่ regression** — แตะแค่ leave_management.js + payroll.js + SQL
- ไม่เพิ่ม dep · escape HTML · event delegation · graceful HTTP/NO_TABLE
- form warning เป็น advisory ไม่ block

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **576/576** (เพิ่ม 28 จาก 548)
- `npm run test:e2e` = **11/11** (รอบแรก fail 1 ก่อน sync index.html — แก้แล้วผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.57.1 → **5.58.0**
- `index.html`: `style.css?v=295→296`, `selfheal.js?v=295→296` + `data-app-build="296"` + `data-app-version="5.58.0"`, `main.js?v=295→296`, `boot.js?v=295→296`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v296'` + v296 + v295 comment lines

### Smoke test (manual)
1. **รัน SQL ก่อน:** Phase 92.32 (ถ้ายัง) + Phase 92.35 → ตรวจ 6 verify queries
2. เปิด `https://boonsook-pos-v5.pages.dev/` (Ctrl+Shift+R)
3. **Admin:** เข้า "🌴 วันลา" → เห็น "💼 Balance / Quota (2026)" + dropdown · ลองสร้างคำขอที่จะเกิน quota → เห็นป้ายส้ม advisory · อนุมัติแล้ว balance update · "💰 รายการเงินเดือน" → กด "ดึงสรุปวันลา" เห็น 5 cards balance ทั้งปี
4. **Non-admin:** เห็น balance ของตัวเอง · ขอลาเกิน quota → ป้าย advisory · ส่งได้
5. **Graceful** (ก่อนรัน SQL): UI แสดง 5 cards + ป้าย "ใช้ค่า default" สีส้ม (ไม่ crash)
6. **Regression check:** Time Clock self responsive (build 295) — mobile 390px ไม่ล้น · desktop 1440px shell ~1120px

### Follow-ups (ค้างจงใจ — ลำดับแนะนำ)
| ลำดับ | ค้าง | บริบท |
|---|---|---|
| 1 | Admin manage policies UI | "ตั้งค่า → Leave Policy" ให้ admin แก้ quota default ผ่าน UI |
| 2 | Per-user override UI | สร้าง `staff_leave_overrides` ผ่าน UI |
| 3 | Paid leave policy ต่อ leave_type | ตัดสินใจ vacation/sick/personal เกิน quota → หักเงิน |
| 4 | Calendar leave view | ใช้ `modules/calendar.js` |
| 5 | Payslip รายละเอียดวันลา | section ในใบจ่ายเงินเดือน |
| 6 | เชื่อม Time Clock → leave | approved leave → chip ใน HR Overview status table |
| - | Audit tab modal (ค้างจาก 92.30) · Late rule (ค้างจาก 92.29) · Edit attendance modal 7-วัน (ค้างจาก 92.30) | |

---

> ⚠️ **SQL ที่ต้องรัน** (จาก 92.32, ยังจำเป็น): [`supabase-phase92-32-leave-management.sql`](supabase-phase92-32-leave-management.sql) — ก่อนเริ่มใช้ปุ่ม "ดึงสรุปวันลา" ใน Payroll modal. ก่อนรัน → ปุ่มยังกดได้แต่แสดง warning + ไม่ crash. **เฟส 92.33 ไม่มี SQL ใหม่** (additive code only).

---

## 🕒 Phase 92.34 — Time Clock self-service responsive fix (this session)

**บริบท:** user แจ้งว่า mobile หน้า “ลงเวลาทำงาน” ล้นขวาหนัก แต่ desktop กลับเล็กเกินไปกลางจอ. สาเหตุหลักคือ `_renderSelfView()` ใน `modules/time_clock.js` ใช้ inline `max-width:680px` และ table/card sizing ที่เหมาะกับ desktop card เดียว ไม่ใช่ responsive layout.

### สิ่งที่แก้

- `modules/time_clock.js`
  - เปลี่ยน self view markup เป็น class-based: `tc-self-shell`, `tc-self-profile`, `tc-self-action-card`, `tc-self-summary`, `tc-self-history`
  - คง ID ปุ่มเดิม `tcSelfClockIn` / `tcSelfClockOut` เพื่อไม่กระทบ event handlers
  - ไม่แตะ flow ลงเวลา, offline queue, GPS/geofence, OT calculation
- `style.css`
  - Desktop: shell กว้าง `min(1120px, 100%)`, top area เป็น profile + action card, summary/history เต็มความกว้าง
  - Mobile: single column, จำกัด `max-width:100%`, ปุ่มเต็มความกว้าง, table history scroll เฉพาะใน wrapper
  - เลี่ยง global `.panel table { min-width:760px }` เพราะ self view ไม่ใช้ `.panel` outer แล้ว
- Version/cache sync:
  - `package.json`: 5.57.0 → **5.57.1**
  - `index.html`: `?v=294→295`, `data-app-build="295"`, `data-app-version="5.57.1"`
  - `sw.js`: cache `v294→v295` + comment

### Smoke checklist

- Mobile Time Clock: content no longer overflows page; only history table can scroll horizontally inside its block. Playwright check: viewport/body/page = 390px, table wrapper = 344px client / 520px scroll.
- Desktop Time Clock: no longer tiny 680px card in the middle of large screen. Playwright check: shell width = 1120px at 1440px viewport.
- Attendance behavior unchanged. Gates: lint:errors 0/0, unit 548/548, e2e 11/11, audit moderate 0 vulnerabilities.

---

## 💸 Phase 92.33 — Leave → Payroll Integration (this session)

**บริบท:** ต่อจาก Phase 92.32 (Leave foundation) — user ขอเชื่อม leave เข้า payroll **แบบ advisory + optional apply** — ดึงสรุปได้, คำนวณ suggested deduction ของ `unpaid` leave ได้, แต่ admin ต้องกด apply เอง. vacation/sick/personal **แสดงข้อมูลเฉย ๆ** ไม่หักเงินในเฟสนี้.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ใน [`modules/leave_management.js`](modules/leave_management.js) (export ครบ)**
- `summarizeApprovedLeavesForPayroll(leaves)` → `{totalApprovedDays, unpaidDays, sickDays, personalDays, vacationDays, otherDays, records}`
  - skip non-approved status / invalid days_count (≤0, NaN)
  - leave_type unknown → `otherDays` bucket
  - ปัด 2 ตำแหน่งทุก field (กัน float drift 0.1+0.2)
- `calcUnpaidLeaveDeduction({unpaidDays, dailyRate, baseSalary})` → number (ปัด 2 ตำแหน่ง)
  - priority 1: `unpaidDays × dailyRate` (ต้อง dailyRate > 0)
  - priority 2: `(baseSalary / 30) × unpaidDays` (ต้อง baseSalary > 0)
  - invalid (days≤0, NaN, ไม่มี rate/base) → 0
- `fetchApprovedLeavesForUser(userId, fromDate, toDate)` — **graceful** REST helper:
  - URL: `staff_leaves?status=eq.approved&user_id=eq.X&start_date=lte.Y&end_date=gte.Z&order=start_date.asc&limit=200`
  - return shape: `{ok:true, rows}` หรือ `{ok:false, code, message}` — code: `BAD_INPUT` / `NO_CONFIG` / `NO_TABLE` (HTTP 400/404) / `HTTP`
  - ★ **ไม่ throw** — caller branch ได้ตาม code

**2) Payroll modal UX** [`modules/payroll.js`](modules/payroll.js)
- import 3 helpers จาก `./leave_management.js`
- เพิ่ม HTML block ใหม่ใน modal **ก่อน Time Clock section** (ที่ Phase 92.26 เพิ่ม):
  - ขอบสีส้ม + title "🌴 วันลาในรอบเดือน"
  - ปุ่ม **📥 ดึงสรุปวันลา**
  - `#prLeaveSummary` placeholder
  - `#prLeaveApplyRow` (hidden by default): แสดง suggested deduction + source description + ปุ่ม "→ เติมลงช่องหัก"
- Handlers (5 new):
  - `prFetchLeaveBtn` click → calc from/to ของเดือนนั้น → `fetchApprovedLeavesForUser` → branch on `ok`/`code`
  - `_setLeaveSummary(html, isError)` — text/HTML in summary box
  - `_hideLeaveApplyRow()` — reset apply state
  - `_refreshLeaveSuggestion()` — recompute amount + source label
  - `prFillLeaveBtn` click → **additive** (`current + amount`) + ต่อ note "หักลาไม่รับค่าจ้าง N วัน" (idempotent — skip ถ้ามี marker อยู่แล้ว) + trigger recalc total + hide apply row + show success
  - Listen `prBase` / `prDailyRate` / `prDailyToggle` changes → re-call `_refreshLeaveSuggestion` (ถ้า admin แก้ฐานเงินเดือนหลังดึงสรุป)
- Summary breakdown แสดงเฉพาะ bucket ที่ > 0 + `unpaidDays` ตัวหนาสีแดง

**3) Safety**
- ★ ไม่ auto-mutate — admin ต้องกด "เติม" เอง
- ★ vacation/sick/personal/other แสดงข้อมูลแต่ไม่หักเงิน (เฟสถัดไป)
- additive ที่ `deductions` — ไม่ทับค่าเดิม, ป้องกัน double-apply ด้วยการ hide apply row หลังเติม
- graceful NO_TABLE → warning message (ไม่ crash modal)
- `escHtml` ทุก output ที่มี user data
- ไม่แตะ DB schema / RLS / money math เดิม / payroll save logic / dep ใหม่
- ไม่มี inline `onclick` — bind ผ่าน `addEventListener`

**4) Tests (+12)** [`tests/leave_management.test.js`](tests/leave_management.test.js):
- `summarizeApprovedLeavesForPayroll`: empty/null → zero / breakdown by 5 types / skip non-approved+invalid / unknown→other / float drift round
- `calcUnpaidLeaveDeduction`: dailyRate priority / baseSalary÷30 fallback / invalid→0 (5 cases) / round 2 decimals / negative dailyRate → fallback
- `fetchApprovedLeavesForUser`: missing args → `BAD_INPUT` / no config → `NO_CONFIG` (node test env)

### ขอบเขต (จงใจ — ตามข้อห้าม)
- ★ Advisory only — admin ต้องกด apply เอง · ไม่ auto-mutate · ไม่ auto-save
- ไม่หัก vacation/sick/personal — ต้องตัดสินใจ paid leave policy ในเฟสถัดไป
- ไม่แก้ DB schema (ไม่เพิ่ม `note_metadata` หรือ JSON detail) — เก็บ note เป็น text เดิม
- ไม่แตะ Payroll save / paid logic
- ไม่ refetch HR Overview / Leave Management — fetch แค่ตอนกดปุ่มใน modal

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **548/548** (เพิ่ม 12 จาก 536)
- `npm run test:e2e` = **11/11** (ครั้งแรก 10/11 flaky `APP_BUILD is set` — เคลียร์ใน rerun)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.56.0 → **5.57.0** (minor)
- `index.html`: `style.css?v=293→294`, `selfheal.js?v=293→294` + `data-app-build="294"` + `data-app-version="5.57.0"`, `main.js?v=293→294`, `boot.js?v=293→294`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v294'` + comment line

### วิธี smoke test
1. ตรวจว่ารัน SQL จาก Phase 92.32 แล้ว (`supabase-phase92-32-leave-management.sql`) — ถ้ายัง: ปุ่ม "ดึงสรุปวันลา" จะแสดง warning แทน crash
2. **สร้าง approved unpaid leave** สำหรับพนักงาน 1 คน:
   - ไปที่ **🌴 วันลา** → กด "+ ขอลา" → เลือกพนักงาน · ประเภท `ลาไม่รับเงิน` · ช่วงวันที่ในเดือนปัจจุบัน (เช่น 2 วัน) → ส่งคำขอ
   - กด **✓ อนุมัติ** ที่ row pending → status = "อนุมัติแล้ว"
3. ไปที่ **💰 รายการเงินเดือน** → กด "+ เพิ่มรายการเงินเดือน" หรือเปิดของพนักงานคนนั้น
4. **Test checklist:**
   - [ ] เห็น section สีส้ม "🌴 วันลาในรอบเดือน" ก่อน Time Clock section
   - [ ] กด "📥 ดึงสรุปวันลา" → แสดง breakdown รวมถึง "💸 ไม่รับค่าจ้าง 2" ตัวหนาแดง
   - [ ] แถวล่างแสดง "แนะนำหัก: ฿X" + source ("(2 วัน × ฿Y/วัน)" หรือ "(2 วัน × เงินเดือน÷30)")
   - [ ] กรอก base_salary 30,000 → "แนะนำหัก" คำนวณใหม่ทันที (`30000/30 × 2 = 2000`)
   - [ ] กด "→ เติมลงช่องหัก" → ช่อง "หัก (-)" เพิ่ม 2,000 (ถ้าเดิม 0 → 2000.00) + ช่องหมายเหตุได้ "หักลาไม่รับค่าจ้าง 2 วัน" + รวมสุทธิ recalc ทันที
   - [ ] apply row หาย → กดปุ่มซ้ำไม่ทำให้ deductions เพิ่มซ้ำ
   - [ ] กด save payroll → บันทึกสำเร็จ
5. **Graceful test** (ถ้ายังไม่รัน SQL Phase 92.32):
   - [ ] กด "ดึงสรุปวันลา" → แสดง "⚠️ ยังไม่ได้ติดตั้งตารางวันลา" สีแดง · modal ยังใช้งานได้

### Follow-ups (ค้างจงใจ — ลำดับแนะนำ)
- **Paid leave policy ต่อ leave_type** — กฎหัก/ไม่หัก vacation/sick/personal (เช่น vacation 10 วัน/ปีฟรี, เกิน → หัก; sick 30 วัน/ปีฟรี) — ต้องเพิ่ม `leave_quotas` ตารางหรือ Settings
- **Leave balance/quota ต่อปี** — quota per user + check ตอนสร้าง pending request
- **Calendar leave view** — มุมมองปฏิทินรวม leave ของทีม (ใช้ `modules/calendar.js`)
- **Payslip แสดงรายละเอียดวันลา** — section ในใบจ่ายเงินเดือนที่ list approved leaves ในรอบนั้น
- **เชื่อม Time Clock → leave** (ค้างจาก 92.32) — approved leave → chip ใน HR Overview "สถานะวันนี้"
- **Audit tab ใน employee modal** (ค้างจาก 92.30) — schema query `activity_log`
- **Late rule** (ค้างจาก 92.29) — กฎเวลามาสาย
- **Edit attendance ใน modal 7-วัน tab** (ค้างจาก 92.30)

---

---

## 🌴 Phase 92.32 — Leave Management Foundation (this session)

**บริบท:** ต่อจาก Phase 92.31 (HR dept/role filters) — user ขอ Leave Management foundation: SQL ใหม่ + UI หน้าใหม่ + HR Overview integration แบบเบา ๆ. **เฟสนี้ไม่หัก payroll ตาม leave** (follow-up).

### สิ่งที่เพิ่ม

**1) SQL migration** [`supabase-phase92-32-leave-management.sql`](supabase-phase92-32-leave-management.sql) (~160 บรรทัด):
- `CREATE TABLE staff_leaves` พร้อม 4 CHECK constraints (leave_type, status, end>=start, days>0)
- 5 indexes (user_id, status, start_date, end_date, created_at DESC)
- `_bump_staff_leaves_updated_at()` trigger
- 4 RLS policies:
  - `leaves_select_admin_or_self` — admin all / user own
  - `leaves_insert_admin_or_self_pending` — non-admin insert ได้เฉพาะ `status='pending'` ของตัวเอง
  - `leaves_update_admin_or_self_pending` — non-admin update ได้เฉพาะของตัวเอง **ที่ยัง pending** → กลายเป็น pending หรือ cancelled (ไม่สามารถ approve/reject ตัวเอง)
  - `leaves_delete_admin` — admin only
- `NOTIFY pgrst, 'reload schema'`
- 6 verify queries (table+columns / constraints / indexes / policies / trigger / row count)
- **Re-run safe** (CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE OR REPLACE FUNCTION)
- ★ Additive only — ไม่แตะ staff_attendance / staff_payroll / profiles / departments / RLS เก่า

**2) modules/leave_management.js** ใหม่ (~620 บรรทัด):
- **Pure helpers (export ครบ):**
  - `calcLeaveDays(start, end)` — inclusive (วันเดียว = 1)
  - `leaveTypeLabel(type)` → `{label, icon, bg, fg, border}` — sick/personal/vacation/unpaid/other + fallback
  - `leaveStatusMeta(status)` → `{label, bg, fg, border}` — pending/approved/rejected/cancelled + fallback
  - `filterLeaves(rows, {month, status, leaveType, userId})` — month overlap (start<=monthEnd AND end>=monthStart)
  - `summarizeLeaves(rows, month?)` → `{pending, approved, rejected, cancelled, total, approvedDays}`
  - `canEditLeave(row, currentUserId, role)` — admin all · non-admin own pending only
  - `canReviewLeave(row, role)` — admin + pending only (กัน double-review)
  - `fetchPendingLeaveCount()` — graceful 0 ถ้าตารางยังไม่มี (สำหรับ HR Overview)
- **UI:**
  - Header (Admin view / ของฉัน) + ปุ่ม ⟳ รีเฟรช + + ขอลา
  - KPI 4 cards (responsive)
  - Filter bar: เดือน (input type=month + ปุ่ม "ทุกเดือน") + status select + type select + Export
  - Table 8 columns (พนักงาน, ประเภท chip, ช่วงวันที่, วัน, เหตุผล, status chip, ผู้พิจารณา + note, action buttons)
  - Row action: approve/reject (admin+pending) · cancel (non-admin own pending) · delete (admin)
  - Form modal: dropdown พนักงาน (admin) · type · start/end + auto-calc days · reason · validation
  - Review flow: prompt() เก็บ `review_note` + confirm ก่อน PATCH
- **REST helpers:** `_fetchLeaves`, `_insertLeave`, `_patchLeave`, `_ensureProfilesLoaded` — graceful HTTP error
- **Defense-in-depth:** non-admin client filter ทับ RLS แม้ RLS เป็นด่านจริง

**3) Routing + sidebar**
- `index.html` sidebar HR group: ปุ่ม `🌴 วันลา` หลัง `🕒 ลงเวลาทำงาน` + `<section id="page-leave_management">`
- `main.js`:
  - `ALL_ROUTES` เพิ่ม `leave_management`
  - `ROLE_PAGES.technician` + `ROLE_PAGES.sales` เพิ่ม `leave_management` (admin ได้ผ่าน ALL_ROUTES)
  - `LAZY_ROUTES.leave_management = ["./modules/leave_management.js", "renderLeaveManagementPage"]`
  - page title `"วันลา"`

**4) HR Overview integration** (additive)
- `detectExceptions` รับ field ใหม่ `pendingLeaves` → push alert `kind: "pending_leaves"` (medium severity) เมื่อ > 0
- `alertActionFor("pending_leaves")` → `{label: "ไปอนุมัติ", route: "leave_management"}`
- `renderHrOverviewPage`: dynamic-import `leave_management.js` แล้วเรียก `fetchPendingLeaveCount()` (silent fail ถ้าตารางยังไม่มี → 0 → ไม่ขึ้น alert)
- **ไม่เปลี่ยน:** attendance/payroll calculation, KPI cards, filter bar เดิม

### ขอบเขต (จงใจ — ตามข้อห้าม)
- **เฟสนี้ leave ไม่ลด attendance/payroll** — admin ดูได้ในหน้าใหม่ + เห็น alert ใน HR Overview · การหัก/ไม่หักจะตัดสินใจในเฟสถัดไป
- ไม่ mark พนักงาน leave เป็นสถานะใน HR Overview status table (follow-up)
- Confirm ใช้ `window.confirm()` แทน custom modal เพื่อ minimal + เชื่อถือได้ (เปลี่ยนเป็น custom modal ในเฟสถัดไปได้)
- ไม่แตะ payroll/time_clock write behavior, money math, RLS เก่า
- ไม่เพิ่ม dependency
- escape HTML ทุก output จาก DB (display name, email, reason, review_note)
- ใช้ event delegation (tbody listener) ไม่มี inline onclick

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **536/536** (เพิ่ม 32 จาก 504)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.55.1 → **5.56.0** (minor — feature + SQL)
- `index.html`: `style.css?v=292→293`, `selfheal.js?v=292→293` + `data-app-build="293"` + `data-app-version="5.56.0"`, `main.js?v=292→293`, `boot.js?v=292→293`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v293'` + comment line

### วิธี smoke test (หลัง deploy + รัน SQL)
1. เปิด Supabase Dashboard → SQL Editor → รัน `supabase-phase92-32-leave-management.sql`
2. ตรวจ verify queries: table+columns (15) / constraints (4) / indexes (5+PK) / policies (4) / trigger (1) / row count (0)
3. เปิด `https://boonsook-pos-v5.pages.dev/` (Ctrl+Shift+R)
4. **Admin checklist:**
   - [ ] เห็นเมนู **🌴 วันลา** ใน HR group
   - [ ] KPI 4 cards โหลด (รออนุมัติ/อนุมัติแล้ว/ปฏิเสธ/รวมวัน)
   - [ ] กด **+ ขอลา** → form modal เปิด → เลือกพนักงาน → ส่งคำขอ → row ปรากฏใน table
   - [ ] กด **✓ อนุมัติ** ที่ row pending → prompt note → confirm → status chip เปลี่ยนเป็น "อนุมัติแล้ว"
   - [ ] กด **✕ ปฏิเสธ** → flow เดียวกัน, status = "ปฏิเสธ"
   - [ ] เปลี่ยน filter เดือน/status/type → table+KPI update
   - [ ] Export Excel → ไฟล์ดาวน์โหลด
   - [ ] กลับไป **📊 ภาพรวม HR** → ใน "🛎️ สิ่งที่ต้องจัดการวันนี้" เห็น alert "คำขอลารออนุมัติ N รายการ" + ปุ่ม "ไปอนุมัติ →" นำทางกลับ "วันลา"
5. **Non-admin checklist (sales/technician):**
   - [ ] เห็นเมนู **🌴 วันลา** เหมือนกัน
   - [ ] หน้าแสดง "ของฉัน" — เห็นเฉพาะของตัวเอง (RLS server-side)
   - [ ] กด **+ ขอลา** → form ไม่มี dropdown พนักงาน (user_id auto-set)
   - [ ] กด **ยกเลิก** ที่ row pending ของตัวเอง → status = "ยกเลิก"
   - [ ] ไม่เห็นปุ่ม ✓/✕ approve/reject (admin only)
   - [ ] ไม่เห็นปุ่ม 🗑️ delete

### Follow-ups (ค้างจงใจ — รออนุมัติเฟสถัดไป)
- **หัก/ไม่หัก payroll ตาม leave type** — ต้องตัดสินใจกฎ (เช่น unpaid → หักจาก daily_rate × days_count, vacation → ไม่หัก) → ค่อยทำเฟส 92.33
- **Calendar leave view** — มุมมองปฏิทินรวม leave ของทั้งทีม (อาจใช้ `modules/calendar.js` ที่มีอยู่แล้ว)
- **Leave balance ต่อปี** — quota per user (vacation 10 วัน/ปี, sick 30 วัน/ปี) + ตรวจตอนสร้างคำขอ
- **เชื่อม Time Clock** — วันลา approved → แสดงในตาราง HR Overview "สถานะวันนี้" เป็น chip "ลาป่วย/ลากิจ/พักร้อน" แทน "ยังไม่เข้า"
- **Audit tab ใน employee modal** (ค้างจาก 92.30) — schema query `activity_log` decision
- **Late rule** (ค้างจาก 92.29) — กฎเวลามาสายใน Settings
- **Edit attendance ใน modal 7-วัน tab** (ค้างจาก 92.30) — inline edit ใน drill-down

---

---

## 🔎 Phase 92.31 — HR Overview Department/Role Filters (this session)

**บริบท:** ต่อจาก Phase 92.30 (Employee modal) — user ขอ filter แผนก + role เพิ่ม เพื่อให้ admin ตัดมุมมองให้แคบลงได้เร็ว (เช่น "เฉพาะแผนกช่าง role technician สถานะกำลังทำงาน"). Filter ทำงาน **in-memory** ไม่ refetch DB, KPI ด้านบนยังเป็นทั้งองค์กร (option A), ตารางและ summary สะท้อน filter.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ (export ครบ, test-friendly)**
- `filterHrRows(rows, {status, departmentId, role})` — รวม 3 filter พร้อมกัน · safe cast `String(did ?? "")` · `__none__` = unassigned, `__all__` = ทั้งหมด · `role:"other"` = ไม่ใช่ admin/sales/technician
- `countDepartmentBuckets(rows)` → `Map<deptId|"__none__", number>` · key เก็บเป็น string เสมอ
- `countRoleBuckets(rows)` → `{all, admin, sales, technician, other}`
- `isDefaultHrFilters(filters)` → boolean (สำหรับซ่อน/แสดงปุ่ม "ล้างตัวกรอง")
- `filterSummaryLabel(filters, total, filtered, departments)` → "แสดง 1 จาก 5 คน · แผนก: ช่าง · Role: Technician · สถานะ: กำลังทำงาน"
- `buildHrExportFilename(today, filters)` → "hr_overview_2026-05-26_dept-12_role-technician_working.xlsx" · sanitize: `[\\/:*?"<>|\x00-\x1f]` + whitespace + collapse `_+` + length cap 200 ก่อน `.xlsx`

**2) UI / interaction**
- เพิ่ม section secondary filter bar ระหว่าง status bar กับ tbody:
  - `_renderDeptDropdown(activeDept, departments, deptCounts)` — `<select>` มี options ทุกแผนก (count ในวงเล็บ) + "ไม่ระบุแผนก" ท้ายสุด
  - `_renderRoleChips(activeRole, roleCounts)` — segmented buttons + count badges · ซ่อน bucket ที่ว่างยกเว้น "all" และ active
  - ปุ่ม `#hrClearFiltersBtn` ขวาสุด (เฉพาะเมื่อ filter ไม่ default)
- เพิ่ม summary bar (`#hrSummaryBar`) เหนือตาราง
- **Cascade re-render** (`_rerenderFilters()` ภายใน scope):
  - dept counts = ใช้ rows ทั้งหมด (ไม่ขึ้นกับ filter อื่น)
  - role counts = filter rows ตาม dept ก่อน (ไม่รวม role+status)
  - status counts = filter rows ตาม dept+role ก่อน
  - visible rows = filter ครบทั้ง 3 axes
- Trigger re-render:
  - status chip click
  - dept select change
  - role chip click
  - "ล้างตัวกรอง" → reset ทั้ง 3 axes
- Event delegation อยู่ที่ `secondaryBarEl` — listen `change` (dropdown) + `click` (chips/clear) แยกกัน

**3) Export Excel** — ใช้ `filterHrRows` ดึง visible rows + `buildHrExportFilename` เพื่อสร้าง filename suffix ตาม filter

**4) Empty state** — เปลี่ยนข้อความใน `_renderTbody` จาก "ไม่มีพนักงานในสถานะที่เลือก" → **"ไม่พบพนักงานตามตัวกรองนี้"** เพราะตอนนี้ filter เป็น multi-axis

**5) Modal** — ทำงานเหมือนเดิม · row click delegation ตรวจ `closest("[data-hr-action]")` + `closest("button")` ก่อน → ปุ่ม clear / dropdown / role chip ไม่ trigger modal เพราะเป็น `<button>` หรือ `<select>`

### ขอบเขต (จงใจตามข้อห้าม)
- **ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior**
- ไม่ refetch DB เมื่อเปลี่ยน filter — ใช้ rows ที่โหลดแล้วใน memory
- ไม่เพิ่ม dependency ใหม่ (`dependencies: {}` คงเดิม)
- ไม่มี inline `onclick` — event delegation ทั้งหมด
- `escHtml` ทุก output จาก DB (dept name, dept id, role label)
- ถ้า `departments` โหลดไม่ได้ → dropdown ยังมี "ทุกแผนก" + "ไม่ระบุแผนก" ใช้งานได้

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **504/504** (เพิ่ม 26 จาก 478)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)
- `npm audit --audit-level=moderate` = **0 vulnerabilities**

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.55.0 → **5.55.1** (patch)
- `index.html`: `style.css?v=291→292`, `selfheal.js?v=291→292` + `data-app-build="292"` + `data-app-version="5.55.1"`, `main.js?v=291→292`, `boot.js?v=291→292`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v292'` + comment line

### Follow-ups (ค้างจงใจจาก phase ก่อนหน้า + ใหม่)
- **Audit tab ใน employee modal** — ต้องตัดสินใจ schema query ของ `activity_log` ก่อน (user_id อาจอยู่ใน `metadata` JSON ไม่ใช่ column ตรง)
- **Leave management** — ต้องเลือก schema (ตาราง `staff_leaves` vs flag `staff_attendance.leave_type`)
- **Late rule** — ตั้งกฎใน Settings (เช่น `clock_in_at > shiftStartHour + 15 min = late`) → ขึ้นเป็น exception ใน HR Overview + chip ใน modal
- **Edit attendance ใน modal 7-วัน tab** — ตอนนี้ admin edit ต้องไปหน้า Time Clock (มี modal แก้อยู่แล้ว Phase 92.25)
- **KPI ที่ตอบ filter (Option B)** — ถ้า user เปลี่ยนใจอยากให้ KPI ปรับตาม filter ค่อย flag

---

---

## 👤 Phase 92.30 — HR Employee Drill-down Modal (this session)

**บริบท:** ต่อจาก Phase 92.29 (HR Overview polish) — user ขอ modal รายละเอียดพนักงานเมื่อคลิกแถว เพื่อให้ admin ดูประวัติได้ในที่เดียวโดยไม่ต้องออกจากหน้า. 3 tabs: วันนี้ / 7 วันล่าสุด / เงินเดือน. Read-only ทั้งหมด.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ใน [`modules/hr_overview.js`](modules/hr_overview.js)** (export ครบ, test-friendly):
- `formatDistanceLabel(distance_m, radiusM)` → "—" / "120 ม." / "350 ม. (นอกพื้นที่)" — radius-aware
- `groupAttendanceLast7Days(rows, todayDate)` → `[{date, attendance[]}]` × 7 (วันนี้ + 6 ก่อนหน้า, เรียงใหม่→เก่า, fill empty days)
- `employeePayrollSummary(payrolls, profile)` → object หรือ `null` — match `String(p.employee_id) === String(profile.id)`, รวม base+ot+wel+bon+com-ded ถ้า `total_amount` หาย
- `buildEmployeeModalSummary(input)` → header object (name/role/dept/status/clockIn-Out/regular/ot/total/distances/notes/radius)
- `modalTabFor(key, validKeys, fallback)` → string (validate ป้องกัน injection)

**2) REST helper ใหม่ (lazy, modal-only)**
- `_fetchUserAttendanceRange(userId, fromDate, toDate)` — `staff_attendance?user_id=eq.X&work_date=gte.Y&lte.Z` (limit 200)

**3) UI / interaction**
- Modal HTML container: `<div id="hrEmployeeModal" style="display:none;position:fixed;inset:0;z-index:9999">` ใน `container.innerHTML` (hidden by default)
- **Row คลิกได้:** `<tr class="hr-row-employee" data-hr-employee="${userId}" cursor:pointer>` + title tooltip
- **Event delegation row click:** skip ถ้า `ev.target.closest("[data-hr-action]")` หรือ `closest("button")` → ปุ่ม action ในแถวไม่ถูก row click ทับ
- **Modal lifecycle:**
  - `_openModal(userId)` → set `activeUserId` + `activeTab="today"` + display:block + lock body scroll + bind Esc
  - `_closeModal()` → null state + display:none + restore scroll + unbind Esc
  - `_renderModal()` → header + tab bar + body + footer (re-render on tab switch)
- **Tabs:**
  - `today` → reuse data จาก HR Overview rows (instant)
  - `week` → lazy fetch (cache per userId) → `groupAttendanceLast7Days` → table 7 วัน + open session highlight + summary footer
  - `payroll` → `employeePayrollSummary` (reuse data.payrolls) → table 6 หมวด + total + paid chip + payment date/method + note + ปุ่มไป Payroll
- **Closes:** `#hrModalClose` (✕ มุมขวาบน), `#hrModalCloseBottom` (ปุ่มล่าง), `#hrModalBackdrop` (คลิกพื้นหลัง), Esc key

**4) Safety**
- Admin only (inherit จาก `requireAdmin()` ของ HR Overview)
- `escHtml` ทุก output (name, email, dept, notes, payment_method, date strings, error message)
- Read-only — ไม่มี mutation ที่ใด
- Graceful error: week tab fetch fail → ไม่ crash, แสดง error banner ในตาราง
- ไม่แตะ DB schema / RLS / money math / payroll/time_clock write behavior
- ไม่เพิ่ม dependency ใหม่

**5) Tests (+19)** [`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- `formatDistanceLabel`: null/empty/invalid / no-radius (round) / radius in-out / radius invalid skip
- `groupAttendanceLast7Days`: empty todayDate / always 7 entries / group by work_date / outside-window excluded / non-array rows
- `employeePayrollSummary`: empty/no-id null / no-match null / computed total fallback / use total_amount from DB / string-uuid cast
- `buildEmployeeModalSummary`: full fields / empty input fallback / display name email-prefix fallback
- `modalTabFor`: valid keys passthrough / invalid → 'today' / custom validKeys + fallback

### ขอบเขต (จงใจตามข้อห้าม)
- **Audit tab ยังไม่ทำ** (per user instruction: "optional, ใส่ follow-up ถ้าไม่ชัวร์") — ค้างเป็น follow-up เพราะ `activity_log` ใช้ entity_id แบบ generic ต้องตัดสินใจ schema query ก่อน (user_id อาจอยู่ใน metadata JSON ไม่ใช่ column ตรง)
- ไม่มี inline `onclick` — event delegation ทั้งหมด
- ไม่ refactor logic เดิม (filter bar / KPI / alerts) — additive ทั้งหมด

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **478/478** (เพิ่ม 19 จาก 459)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.54.1 → **5.55.0** (minor)
- `index.html`: `style.css?v=290→291`, `selfheal.js?v=290→291` + `data-app-build="291"` + `data-app-version="5.55.0"`, `main.js?v=290→291`, `boot.js?v=290→291`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v291'` + comment line

### Follow-ups (ถ้าผู้ใช้เลือกทำต่อ)
- **Audit tab** — ตัดสินใจ schema query ของ `activity_log` ก่อน (user_id อาจอยู่ใน `metadata` JSON column → ต้อง JSONB query) แล้วเพิ่ม tab + helper `buildEmployeeAuditQuery`
- **Department / role filter** ที่หน้า HR Overview — เพิ่ม second-row filter (dept dropdown + role toggle)
- **Leave management** — ตัดสินใจ schema (`staff_leaves` ตารางใหม่ vs `staff_attendance.leave_type` flag) ก่อนทำ UI
- **Late rule** — ตั้งกฎใน Settings (เช่น `clock_in_at > shiftStartHour + 15 min = late`) → ขึ้นเป็น exception ใน HR Overview + chip ใน modal วันนี้
- **Edit attendance ใน modal** — ตอนนี้ปุ่มในตาราง 7 วันยังไม่มี edit; admin edit ต้องไปหน้า Time Clock (มี modal แก้อยู่แล้วใน Phase 92.25)

---

---

## ✨ Phase 92.29 — HR Overview polish + filters + actionable alerts (this session)

**บริบท:** ต่อจาก Phase 92.28 (HR Overview MVP) — user ขอ polish ให้ใช้งานจริงระดับมืออาชีพ: filter ตาราง, action จาก alert, visual polish (role chip / status wording), row action dynamic ตาม status, payroll shortcut, quick actions reorder. **Additive only** — ไม่รื้อ behavior เดิม.

### สิ่งที่เพิ่ม

**1) Pure helpers ใหม่ใน [`modules/hr_overview.js`](modules/hr_overview.js)** (test-friendly, export ครบ):
- `countStatusBuckets(rows)` → `{all, not_in, working, out, abnormal}` — สำหรับ count บนปุ่ม filter
- `filterRowsByStatus(rows, status)` → rows ที่ filter แล้ว (graceful: "all"/unknown → คืนทั้งหมด)
- `rowActionLabel(status)` → `{label, icon, color}` — dynamic ตาม status
- `roleChipMeta(role)` → `{label, bg, fg, border}` — admin ม่วง / sales ฟ้า / technician เขียว
- `alertActionFor(kind)` → `{label, route} | null` — mapping kind → route ที่จะนำทาง

**2) UI changes**
- **Filter bar** (segmented buttons) เหนือตาราง — แสดง count ในแต่ละปุ่ม, default "all", click → re-render `tbody` เท่านั้น (ไม่ refetch)
- **Role chip** ในคอลัมน์ "แผนก / role" — แทน text เปล่า
- **Status wording:** `abnormal` "ผิดปกติ" → **"ต้องตรวจสอบ"** (ทั้ง chip, filter button, Export sheet)
- **Row action button** — label/icon/สี dynamic:
  - `not_in` → "▶️ ลงเวลา" (ฟ้า)
  - `working` → "⏱️ จัดการเวลา" (ส้ม)
  - `abnormal` → "⚠️ จัดการเวลา" (แดง)
  - `out` → "👁️ ดูเวลา" (เทา)
  - ทุกปุ่มไป `time_clock` route เหมือนเดิม
- **Alert action buttons** — ปุ่มขวาสุดของแต่ละ alert: stale/geofence/offline → Time Clock, unpaid_payroll → Payroll
- **KPI clickable** — Payroll card คลิกได้เมื่อ `payrollUnpaid > 0`, Offline Queue card คลิกได้เมื่อมี pending (keyboard: Enter/Space)
- **Quick actions reorder + label สั้น:** ลงเวลา / เงินเดือน / ภาพรวมเงินเดือน / แผนก / ประวัติ / Export (Export ยังเป็น primary green)

**3) Event delegation pattern**
- `container.addEventListener("click", ...)` — จับ `[data-hr-action]` ทุกตัว (KPI card, alert button, row button, quick action) → `showRoute(route)`
- `hrFilterBar` มี listener แยกสำหรับ `.hr-filter-btn` — ไม่ navigate, แค่ update local state + re-render `hrTbody`
- `hrExportBtn` ใช้ filter ปัจจุบัน + filename suffix (`_working`, `_not_in`, ฯลฯ)
- **ไม่มี inline `onclick`** ที่ไหนเลย — ตามข้อห้าม

**4) Tests (+21)** [`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- `countStatusBuckets`: empty / non-array / mixed counts / weird status counted in `all` only
- `filterRowsByStatus`: "all"/empty/undefined → copy / filter exact / unknown → all / non-array → `[]`
- `rowActionLabel`: not_in / working+abnormal / out / unknown+null+undefined fallback
- `roleChipMeta`: 4 known roles TH labels / distinct colors / unknown role label = string passthrough / null/undefined → "—"
- `alertActionFor`: 4 known kinds → correct route / unknown+null → null

### ขอบเขต (จงใจตามข้อห้าม)
- **ไม่แตะ DB / RLS / money math / payroll / time_clock behavior** — pure UI polish + additive helpers
- ไม่เพิ่ม dependency ใหม่ (`dependencies: {}` คงเดิม)
- ไม่มี inline `onclick` — event delegation ทั้งหมด
- `escHtml` ทุก output จาก DB (profile name, email, dept name)
- ถ้า fetch บางตาราง fail → ยังแสดง warning banner เดิม + ตัวเลขที่โหลดได้ (ไม่ crash)

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **459/459** (เพิ่ม 21 จาก 438)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.54.0 → **5.54.1** (patch)
- `index.html`: `style.css?v=289→290`, `selfheal.js?v=289→290` + `data-app-build="290"` + `data-app-version="5.54.1"`, `main.js?v=289→290`, `boot.js?v=289→290`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v290'` + comment line

### Follow-ups (ถ้าผู้ใช้เลือกทำต่อ)
- **Drill-down modal รายพนักงาน** — คลิกชื่อ/แถว → modal แสดง history 7 วัน + payroll history (ปัจจุบันคลิก row action ไปหน้า Time Clock เลย)
- **Filter ตามแผนก/role** — เพิ่มอีกแถว filter (department dropdown + role chip toggle)
- **Leave / วันลา** — ต้องตัดสินใจ schema (ตาราง `staff_leaves` หรือ `staff_attendance.leave_type`) ก่อน
- **KPI "มาสาย"** — ต้องตั้งกฎเวลามาสายใน Settings ก่อน (เช่น clock_in_at > shiftStartHour + 15 min = late)

---

---

## 📊 Phase 92.28 — HR Center / ภาพรวม HR (this session)

**บริบท:** user ขอ HR Overview เพื่อรวมข้อมูล Time Clock + Payroll + Departments + Profiles เป็นศูนย์กลางให้ admin เห็นสถานะพนักงาน/การลงเวลา/เงินเดือน/exceptions ในหน้าเดียว ต่อยอดจากระบบที่ทำเสร็จแล้ว (ไม่สร้าง SQL ใหม่ ไม่แตะ behavior เดิม).

### สิ่งที่เพิ่ม

**1) modules/hr_overview.js** (ใหม่, ~440 บรรทัด) — read-only dashboard
- **Pure helpers (test-friendly):**
  - `classifyAttendanceStatus(row, {now, staleHours=14})` → `"not_in" | "working" | "out" | "abnormal"`
  - `aggregateHrKpi({profiles, attendanceToday, attendanceMonth, payrollsThisMonth, shiftOpts, offlinePending})` → KPI object
  - `detectExceptions({attendanceToday, payrollsThisMonth, offlinePending, geofence, opts})` → list of `{kind, severity, message, userId, refId}` — kinds: `stale_session`/`geofence_out`/`unpaid_payroll`/`offline_pending`
  - `indexAttendanceByUser(rows)` → `Map<user_id, latest row>` (priority: open > closed > newest clock_in)
- **UI structure:**
  - Header (วันที่ TH + กะปัจจุบัน) + ปุ่ม ⟳ รีเฟรช
  - KPI grid responsive `auto-fit minmax(180px,1fr)` — 5–6 cards
  - Section "🛎️ สิ่งที่ต้องจัดการวันนี้" — empty state ✅ ถ้าไม่มี
  - Table "🧑‍💼 สถานะพนักงานวันนี้" — sort `working → abnormal → out → not_in` แล้วตามชื่อ TH
  - Section "⚡ Quick actions" — 5 ปุ่มเปลี่ยน route + Export Excel
- **Reuse จาก time_clock.js:** `workDateBangkok`, `timeBangkok`, `computeRegularOT`, `sumRegularOT`, `shiftHoursFromState`, `profileDisplayName`, `offlinePendingCount`
- **REST queries (5 ขนาน):**
  - `profiles_with_email` (fallback `profiles`) — filter role≠customer
  - `departments?is_active=eq.true`
  - `staff_attendance?work_date=eq.${today}` (today)
  - `staff_attendance?work_date=gte.${monthStart}&lt.${monthEnd}` (เดือน, limit 2000)
  - `staff_payroll?period_month` ของเดือนปัจจุบัน

**2) Routing + sidebar**
- `index.html`: sidebar HR group เพิ่มปุ่ม **📊 ภาพรวม HR** ก่อน "ตั้งค่าแผนก" + `<section id="page-hr_overview">`
- `main.js`:
  - `ALL_ROUTES` เพิ่ม `hr_overview` → admin เข้าได้ (ROLE_PAGES.admin = ALL_ROUTES); sales/technician/customer ไม่มีใน ROLE_PAGES → sidebar auto-hide
  - `LAZY_ROUTES.hr_overview = ["./modules/hr_overview.js", "renderHrOverviewPage"]`
  - page title `"ภาพรวม HR"`

**3) Tests (+22)** [`tests/hr_overview.test.js`](tests/hr_overview.test.js):
- classifyAttendanceStatus: null/working/out/abnormal/staleHours custom/clock_out-without-in
- aggregateHrKpi: empty/presentToday distinct/OT calc closed-only/payroll counts+amounts/offlinePending normalize
- detectExceptions: empty/stale_session/geofence in+out/no-geofence-skip/unpaid count/offline_pending/multi-issue order
- indexAttendanceByUser: open prio/newest clock_in/skip no-user_id/non-array

### ขอบเขต (จงใจ)
- **No DB change** — schema reserve จาก phase 92.22+92.22e+92.24 ใช้ได้ทันที
- **No money/time_clock/payroll/RLS change** — pure additive read-only dashboard
- **Admin only** — guard ฝั่ง client (UX) + RLS เป็นด่านความปลอดภัยจริง
- ไม่แตะ utils_formatters, ui_states — ใช้ของเดิม
- ไม่ขอ GPS ในหน้านี้ — แค่อ่าน `distance_m` ที่ time_clock บันทึกไว้

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **438/438** (เดิม 416 + 22 ใหม่)
- `npm run test:e2e` = **11/11** (build sync ผ่าน)

### Version sync (4 sub-items + sw.js comment)
- `package.json`: 5.53.1 → **5.54.0**
- `index.html`: `style.css?v=288→289`, `selfheal.js?v=288→289` + `data-app-build="289"` + `data-app-version="5.54.0"`, `main.js?v=288→289`, `boot.js?v=288→289`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v289'` + บรรทัดเปลี่ยนแปลงเพิ่ม

### Follow-ups (ถ้าผู้ใช้เลือกทำ)
- เพิ่ม drill-down: คลิกพนักงาน → modal แสดง history 7 วัน + payroll history
- เพิ่ม filter: เลือกแผนก / role
- KPI "ขาด/มาสาย" (ต้องตั้งกฎเวลามาสายใน Settings ก่อน)
- "วันหยุด/ลา" (ยังไม่มีตารางในระบบ — ต้องตัดสินใจ schema)

---

> 🟢 **Time Clock feature ครบทุก aspect ตามที่ user ขอตั้งแต่ Phase 92.22:**
> - ✅ Manager + Self-service flow (92.22 / 92.22e pivot)
> - ✅ OT auto-detect (>17:00 + Settings shift hours) (92.25 / 92.25b)
> - ✅ Admin edit + audit log (92.25)
> - ✅ Payroll integration (auto-fill OT) (92.26)
> - ✅ GPS geo-fence (92.24)
> - ✅ Offline queue + auto-sync (92.27)

> 🟢 **สถานะ ณ ปัจจุบัน:** Phase 92.25 พร้อม push (lint 0/0, unit 393). **ไม่ต้องรัน SQL migration** — ใช้ schema เดิมจาก Phase 92.22e
> 🔵 **ค้าง (อิสระจาก deploy):**
> 1. **Phase 92.24** — GPS geo-fence (schema cols พร้อม)
> 2. **Phase 92.26** — Payroll integration (auto-fill `payroll.ot_hours/ot_amount` จาก `staff_attendance`)
> 3. **Phase 92.27** — Offline queue (IndexedDB + idempotency via `client_uuid` ที่ schema มีให้)
> 4. **Settings page (ถ้าจะทำ):** เปลี่ยนชั่วโมงกะมาตรฐาน (รอบนี้ hardcode 08-17 ใน computeRegularOT — ถ้าต้องการให้กำหนดเองค่อยเพิ่ม settings เฟสหลัง)

---

## 🏷️ Phase 92.22b — Fix About page version display drift (this session)

**ปัญหา:** หน้า "เกี่ยวกับระบบ" (Settings → About) แสดง `Version: 5.47.8` + `Release: May 2026 (build 274)` ทั้งที่ live = 5.48.1/278. ปุ่ม "ตรวจหาอัปเดต" บอก build 278 ถูก — แต่ header ของ About card แสดงเลขเก่า → user งง.

**Root cause:** [modules/settings/pages.js:25-26](modules/settings/pages.js:25) hardcode `<div>Version: 5.47.8</div>` + `<div>Release: May 2026 (build 274)</div>` — ค้างมาตั้งแต่ Phase 92.18 ผ่าน 5 phases (92.19/92.20/92.21/92.22/92.22-hotfix) ที่ผม **ลืม bump 5th sub-item**. Memory `feedback_version_display_sync.md` เคยเตือนเรื่องนี้แล้ว — บทเรียนที่ลืม.

### สิ่งที่แก้ (3 ไฟล์, +12/-6)
- **`selfheal.js`:** เพิ่ม `window.APP_VERSION` (mirror pattern ของ `window.APP_BUILD` ที่มีอยู่แล้ว) — read จาก `data-app-version` attribute ของ script tag
- **`index.html`:** `<script src="./selfheal.js?v=279" data-app-build="279" data-app-version="5.48.2">` — 2 attrs (build + version)
- **`modules/settings/pages.js`:** render `${window.APP_VERSION}` + `${window.APP_BUILD}` ผ่าน `escHtml` — fallback "-" ถ้า global ไม่ set

### ขอบเขต (จงใจ)
- **No behavior change** อื่น — แค่ render text ให้ตรงกับ build จริง
- **ไม่แตะ** money / DB / RLS / time_clock (ของก่อน) — pure UI display
- **Version-sync checklist กลับมา 4 จุด** (ไม่ใช่ 5) — pages.js auto-pickup จาก global, ไม่ต้องแก้ทุก phase อีก

### Lesson logged
4-sub-item checklist (APP_BUILD + main.js?v= + sw.js + pages.js) ที่ memory เตือน — pages.js เป็นจุดที่ลืมง่ายสุดเพราะอยู่ใน sub-module. แก้ refactor ให้ dynamic = ปิดถาวร. ถ้ามี version text hardcoded ที่อื่นในอนาคต ใช้ `window.APP_VERSION` / `window.APP_BUILD` ทันที.

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **380/380** (ไม่เปลี่ยน — UI text เปลี่ยน)
- e2e ผ่าน CI

---

## 🐛 Phase 92.22 HOTFIX — uuid type mismatch (last session)

**Root cause:** ผมเขียน SQL migration โดย assume `staff.id` เป็น bigint (เพราะ `customers.id`, `sales.id`, products tables ใน repo ทุกตัวเป็น bigserial) — **แต่ `staff.id` ใน prod เป็น uuid** (table ถูกสร้างผ่าน Supabase Dashboard ก่อนหน้านี้ ไม่ผ่าน migration script ใน repo). Postgres reject ตอน CREATE TABLE ด้วย error 42804.

### สิ่งที่แก้
- **`supabase-phase92-22-time-clock.sql`:** `staff_id bigint` → `staff_id uuid` (1 บรรทัด) + comment เตือน
- **`modules/time_clock.js:425`:** `Number(tcStaffSelect.value)` → `value?.trim() || ""` (uuid string passthrough; Number() เปลี่ยน uuid → NaN)

### ที่ตรวจแล้วไม่เปลี่ยน
- `_findMyStaff` query by `auth.uid()` — uuid match uuid อยู่แล้ว
- `_fetchAttendance` URL `staff_id=eq.${encodeURIComponent(staffId)}` — รับ uuid string
- `staffMap[s.staff_id]` — string key OK
- `data-clock-out-id` + `Number(btn.dataset.clockOutId)` — attendance.id = bigserial → Number() ยังถูก
- compare `String(_mgrFilterStaff) === String(s.id)` — string compare อยู่แล้ว

### Re-run instructions
- SQL migration เดิมที่รันไปครึ่งทาง (ALTER staff สำเร็จ + CREATE TABLE fail) → **safe to re-run**
  - ALTER จะเป็น no-op (column มีแล้ว — IF NOT EXISTS)
  - CREATE TABLE staff_attendance รอบนี้จะสำเร็จ (uuid match)
  - Indexes + policies + verify queries จะรันต่อจากจุดที่ค้าง

### บทเรียน — บันทึกเป็น memory
- ก่อนเขียน FK ต่อ table ที่ไม่ได้สร้างใน repo migration → **ตรวจ type ใน Supabase Dashboard / `information_schema.columns` ก่อน**
- อย่า assume type จากดู JS module ที่ใช้ sb client (type-agnostic)
- `feedback_id_type_mismatch` memory เตือนเรื่อง customers.id แล้ว — บทเรียนนี้ต่อยอด: ตรวจทุก FK target

---

## 🕒 Phase 92.22+92.23 — Time Clock Foundation + Self-service (last session)

**บริบท:** user ขอระบบลงเวลาเข้า-ออกงาน (clock-in/clock-out) เลือกแบบ "ครบเครื่อง" 4 มิติ (mixed manager+self / GPS / full scope / offline queue) → แตกเป็น 6 phases (92.22-92.27). เฟสนี้ครอบ **Foundation + Self-service** (92.22+92.23) — manager flow ใช้งานได้ทันทีหลัง SQL apply + self-service เปิดให้ staff ที่ผูกบัญชี Supabase Auth.

### สิ่งที่เพิ่ม

**1) DB migration** [`supabase-phase92-22-time-clock.sql`](supabase-phase92-22-time-clock.sql) (~170 lines):
- `ALTER TABLE staff`: เพิ่ม `user_id uuid REFERENCES auth.users(id)` + `email text` (case-insensitive UNIQUE)
- `CREATE TABLE staff_attendance` — fields ครบสำหรับ phases ต่อ:
  - `id, staff_id, work_date, clock_in_at, clock_out_at`
  - GPS reserve (Phase 92.24): `clock_in_lat/lng/distance_m`, `clock_out_lat/lng/distance_m`
  - Idempotency (Phase 92.27): `client_uuid` (partial UNIQUE)
  - Source tracker: `source CHECK IN ('admin','self','queued')`
  - Audit: `notes`, `created_by`, `created_at`, `updated_at` (trigger auto-bump)
- **Indexes:**
  - `idx_attendance_staff_date` (staff_id, work_date DESC) — query history
  - `idx_attendance_one_open_session` UNIQUE WHERE `clock_out_at IS NULL` — ★ กัน 2 open sessions/staff
  - `idx_attendance_client_uuid` UNIQUE WHERE NOT NULL — idempotency
- **RLS:** 4 policies (admin all / staff self ผ่าน user_id link)
- `NOTIFY pgrst, 'reload schema'` + verify queries ที่ท้ายไฟล์ (5 จุด)

**2) `modules/time_clock.js`** (~480 lines):
- Pure helpers (testable): `workDateBangkok` (Asia/Bangkok), `timeBangkok`, `workHours`, `clockState`, `sumWorkHours`, `canAutoClaim` (case-insensitive + null-safe)
- `renderTimeClockPage(ctx)` → fork by role:
  - **Manager view** (admin): active sessions card + clock-in form (dropdown staff) + report tab (date range filter + staff filter + Export CSV)
  - **Self-service view** (sales/technician + linked): clock in/out ของตัวเอง + week summary + 7-day history
- **Auto-claim flow:** user ที่ยังไม่มี staff link → query `staff WHERE email=auth.email() AND user_id IS NULL` → PATCH `user_id=auth.uid()` (one-shot)
- **Graceful errors:** HTTP 404/400 (table ไม่มี) → `NO_TABLE` error → UI โชว์ "ยังไม่ได้ติดตั้ง schema" + ปุ่ม retry
- **Race guards:** `if (btn.isConnected)` หลัง await ทุก mutation (เรียนรู้จาก Phase 92.21)
- REST fetch ตรง (ไม่ใช่ supabase-js client) — เป็น pattern เดียวกับ `payroll.js` / `sale_trace.js`

**3) Wire 4 ที่:**
- `main.js` `LAZY_ROUTES.time_clock` + `ROLE_PAGES.sales/technician` (admin มี ALL_ROUTES อยู่แล้ว)
- `index.html` sidebar button (ใต้ HR group) + `<section id="page-time_clock">`
- `modules/staff.js` add/edit modal: เพิ่มช่อง **อีเมล** + format validation + payload `email`

**4) Tests** [`tests/sale_trace.test.js`](tests/sale_trace.test.js) ใหม่ +24 ตัว:
- `workDateBangkok` — TZ correctness (UTC midnight crossover → Bangkok next day)
- `timeBangkok` — null/invalid date → "-" (no Invalid Date string leak)
- `workHours` — both/null/reversed/missing → 0 ปลอดภัย
- `clockState` — open/closed/none
- `sumWorkHours` — sum + ignore open sessions
- `canAutoClaim` — happy/case-insensitive/already-claimed/mismatch/null-inputs (7 ตัว — กัน auth bypass)

### ขอบเขต (จงใจ — เก็บไว้ Phase ต่อ)
- ❌ **ไม่แตะ** posting / payroll math / accounting / RLS อื่นใด
- ❌ **ไม่บังคับ GPS** — schema reserve cols ไว้ Phase 92.24 จะมาเปิดใช้
- ❌ **ไม่ทำ offline queue** — schema มี `client_uuid` ให้แล้ว Phase 92.27 จะใช้
- ❌ **ไม่ทำ OT calc** — Phase 92.25
- ❌ **ไม่ link payroll** — Phase 92.26

### Decision log
- **Manager + Self รวมใน module เดียว** (ไม่แยก 2 ไฟล์) — render fork ตาม role; deps + utils ใช้ร่วมกัน, DRY
- **Auto-claim เลือก email match แทน admin invite** — ไม่ต้อง backend extra (Cloudflare Function) + ทำงานในขอบเขต Supabase RLS
- **REST fetch ไม่ใช้ sb client** — pattern ใหม่ใน accounting/* / sale_trace.js (consistent)
- **Email UNIQUE บน `lower(email)`** — กัน confusing "JOHN@ex.com" ≠ "john@ex.com"

### ⚠️ SQL Apply Instructions (admin ต้องทำหลัง deploy)
1. Supabase Dashboard → SQL Editor → New query
2. Copy ทั้งไฟล์ [`supabase-phase92-22-time-clock.sql`](supabase-phase92-22-time-clock.sql) → Paste → **Run**
3. ตรวจ result panels ของ verify queries ท้ายไฟล์ (5 ตาราง):
   - (a) staff: 2 columns ใหม่ (email, user_id)
   - (b) staff_attendance: 16 columns
   - (c) Indexes: 5 ตัว (idx_attendance_*, idx_staff_email_unique, idx_staff_user_id_unique)
   - (d) Policies: 4 ตัว (att_select_admin_or_self, att_insert_..., att_update_..., att_delete_admin)
   - (e) RLS enabled: true
4. **Re-run safe** — ใช้ `IF EXISTS`/`IF NOT EXISTS`/`DROP IF EXISTS` ทุกตัว
5. หลังรัน → กลับมาที่หน้า "ลงเวลาทำงาน" → กดปุ่ม retry (ถ้า error card ขึ้น) หรือรีโหลด

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **380/380** (เดิม 356 + 24 ใหม่)
- e2e จะรันใน CI

---

## 🛡️ Phase 92.21 — Guard race on async badge handlers (last session)

---

## 🛡️ Phase 92.21 — Guard race on async badge handlers (this session)

**บริบท:** GH scanner (CodeQL) เตือนทุก PR build = "Possible race condition: `btn.disabled`/`btn.textContent` might be assigned based on an outdated state of `btn`" ที่ async badge click handlers ใน sales.js + audit_log.js (code จากเฟส 92.17/92.18). ผลกระทบจริงต่ำมาก (one-shot click + replaceWith) แต่ scanner รบกวน PR review ทุกรอบ + ถ้า list re-render ตอน `await findJournalForSale` pending = mutate orphan node (no-op) หรือ `btn.replaceWith()` throw silently.

### สิ่งที่เพิ่ม (2 ไฟล์, +12/-2)
- **`modules/sales.js`** (~line 167): ใส่ `if (!btn.isConnected) return;` หลัง try/catch ของ `await findJournalForSale(saleId)` — ก่อน `wrap.innerHTML = renderSaleTraceBadge(...)` + ก่อน `btn.replaceWith(badgeEl)`
- **`modules/audit_log.js`** (~line 163): pattern เดียวกัน

### ขอบเขต (จงใจ)
- **No behavior change** สำหรับ flow ปกติ (non-racy) — guard ทำงานเฉพาะเคส list re-render ระหว่าง async lookup
- **ไม่แตะ** logic ของ `findJournalForSale` / `renderSaleTraceBadge` / `navigateToJv`
- pattern เดียวกับ "เปิดบิล" handler ที่ [modules/sales.js:147](modules/sales.js:147) (`if (btn.isConnected) btn.disabled = false;`) มีอยู่แล้ว = consistent

### Tests
ไม่เพิ่ม test ใหม่ — เป็น defensive guard ที่ test ยากใน jsdom (ต้อง simulate list re-render mid-await). Pattern verified แล้วใน production code [modules/sales.js:147](modules/sales.js:147)

### Version sync (4 จุด)
- `index.html`: `data-app-build="276"`, `main/boot/selfheal/style.css?v=276`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v276'` + comment v276
- `package.json`: `5.47.9 → 5.47.10`

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **356/356** (ไม่เพิ่ม test ใหม่ — defensive guard)
- e2e จะรันใน CI

---

## 🔗 Phase 92.20 — JV drawer deep-link from 3 trace surfaces (last session)

**ปัญหาเดิม:** Phase 92.17/92.18 เพิ่มปุ่ม 📒 trace ใน 3 surface (sales list / receipt drawer / audit log) — กดแล้วไปหน้าสมุดรายวันเฉย ๆ ผู้ใช้ต้องเลื่อนหา JV เอง. มี `data-jv-id` พร้อมใน badge อยู่แล้วแต่ยังไม่ใช้.

### สิ่งที่เพิ่ม (4 ไฟล์ core + 1 test)
- **`modules/accounting/journals.js`:**
  - export ใหม่ `setPendingJvId(id)` — 1-shot module-level state สำหรับ deep-link target
  - หลัง `renderJournalsPage` fetch entries สำเร็จ → consume pending → `queueMicrotask(_openJvDrawer)`; ถ้า id ไม่อยู่ใน 200 entries ล่าสุด → `console.info` แล้วผ่าน (ไม่ crash)
  - error path เพิ่ม clear `_pendingOpenJvId = null` → กัน stale consume ถ้า user navigate ออก/กลับมาทีหลัง
- **`modules/accounting/sale_trace.js`:** export ใหม่ `navigateToJv(jvId, opts)` async — dynamic import `journals.js` (lazy, ไม่ดึง 167KB accounting bundle เข้า eager path) → `setPendingJvId` → `showRoute("accounting_journals")`. inject `showRoute`/`importModule` ได้สำหรับ test. fallback ถ้า import ล้ม = navigate ปกติ
- **Wire 3 surfaces:**
  - `modules/sales.js` — badge click `goto` ใช้ `navigateToJv(badgeEl.dataset.jvId)`
  - `main.js` `_fillReceiptAcctTrace` — `goto` = `closeAllDrawers(); navigateToJv(...)` (ปิด receipt drawer ก่อน)
  - `modules/audit_log.js` — `goto` = `navigateToJv(badgeEl.dataset.jvId)`

### ขอบเขต (จงใจ)
- **ไม่แตะ** posting / `auto_post` / money / stock / loyalty / RLS / SQL — เพิ่มเฉพาะ navigation glue + 1 read-only consume hook
- **No URL state** (ไม่ใช่ `#accounting_journals?jv=42`) — เพราะ pending เป็น 1-shot click intent, ไม่ใช่ shareable link
- **`badgeEl.dataset.jvId` มีอยู่แล้ว** (Phase 92.17 ตั้งไว้ใน `renderSaleTraceBadge`) — diff ไม่แตะ badge HTML
- guard ใน `_openJvDrawer` มีอยู่แล้ว (`document.getElementById("jvDrawer")?.remove()`) — ไม่ open ซ้อน

### Tests (`tests/sale_trace.test.js`, +6 = 24 ตัว)
`navigateToJv`: happy path (set pending + showRoute) / string id pass-through / null+empty+undefined → false / no router → false / import fail → ยัง navigate / setPendingJvId missing → ไม่ throw. inject mock — ไม่แตะ DOM/network จริง.

### Version sync (4 จุด)
- `index.html`: `data-app-build="275"`, `main.js?v=275`, `boot.js?v=275`, `selfheal.js?v=275`, `style.css?v=275`
- `sw.js`: `CACHE_NAME = 'boonsook-pos-v5-cache-v275'` + comment v275
- `package.json`: `5.47.8 → 5.47.9`
- `modules/settings/pages.js:195`: dynamic (`window.APP_BUILD`) → auto pickup

### Gates
- `npm run lint:errors` exit 0 (clean)
- `npm test` = **356/356** (เดิม 350 + 6 ใหม่)
- e2e จะรันใน CI

---

## 🔧 Phase 92.19 — Bump GH Actions to Node 24-ready majors (this session)

**บริบท:** HANDOFF 92.18 ระบุ "CI deprecation (low)" — GH Actions เตือนว่า `actions/checkout@v4` + `wrangler-action@v3` รัน Node 20 → จะถูกบังคับเป็น Node 24 หลัง **2 มิ.ย. 2026** (เหลือ ~9 วัน) ปล่อยไว้ = CI พังหลัง deadline → block merge/deploy

### สิ่งที่เปลี่ยน (2 ไฟล์, 6 บรรทัด)
- `.github/workflows/test.yml`: `actions/checkout@v4 → @v5`, `actions/setup-node@v4 → @v5`
- `.github/workflows/main.yml`: `actions/checkout@v4 → @v5` (x2), `cloudflare/wrangler-action@v3 → @v4`, `docker/setup-buildx-action@v3 → @v4`

### Risk / scope (จงใจ)
- **CI-only** — ไม่แตะ runtime/app code, ไม่ bump APP_BUILD/version/SW cache (live ยัง build 274 ตามเดิม)
- **Minimum bump** = เลือก major แรกของแต่ละ action ที่ใช้ Node 24 (ไม่ jump ไป v6/v4.1) เพื่อจำกัด blast radius + rollback ง่าย
- `wrangler-action@v4` inputs `apiToken`/`accountId`/`command` = identical, `pages deploy` = unchanged (verified จาก official README)
- **wrangler binary default เป็น v4** (จากเดิม v3) — `pages deploy` รองรับเต็มในทั้งสอง major. ถ้าพบ regression สามารถ pin `wranglerVersion: "3"` กลับได้
- ไม่แตะ `actions/setup-node` version input (`node-version: "20"` ยังเดิม — `setup-node@v5` action ใช้ Node 24 ภายใน, แต่ runtime project ยัง pin Node 20 ตาม `package.json.engines`)

### Gates
- `npm run lint:errors` = clean (0 errors) บน local
- `npm test` = **350/350 pass** บน local
- CI `Tests` workflow บน PR branch = ✅ success (verify job + e2e 11)
- CI `Tests` + `Deploy to Cloudflare Pages` บน main หลัง merge = ✅ success ทั้งคู่ (Deploy in 30s, Docker build in 14s — wrangler v4 deploy สำเร็จ first try)
- Live smoke: `data-app-build="274"`, `main.js?v=274`, `style.css?v=274`, SW `cache-v274` = ตรงตามก่อน merge (ไม่เปลี่ยน — ตามที่ตั้งใจ)

---

## 📒 Phase 92.18 — Audit Log accounting trace (deleted POS sales) (this session)

**Task A finding (สำคัญ):** mission เดิมสมมติว่ามี row `delete_sale` ใน Audit Log ให้ติด trace — **แต่ trace ทั้ง repo + git history แล้ว `sales.js` soft-delete ไม่เคยเรียก `logActivity` เลย** → ไม่มี row นั้นจริง. deletion logs ที่มี (delete_receipt/invoice/quotation) ล้วน key คนละ entity (receipts/delivery_invoices) ไม่ใช่ `source_table='sales'`. รายงาน user → เลือก **"เพิ่ม delete_sale log ก่อน แล้ว trace"**.

### สิ่งที่เพิ่ม (read-only trace + 1 best-effort log write)
- **`modules/sales.js`** (soft-delete commit, หลัง toast): เขียน `logActivity("delete_sale", { entityType:"sale", entityId:saleId, summary, metadata:{bill_no,customer_id,customer_name,total_amount} })` — **best-effort**: ห่อ `try{}` + logActivity กลืน error เอง → log fail **ไม่ทำให้การลบ fail**. ไม่ await-block flow สำคัญ
- **`modules/accounting/sale_trace.js`**: เพิ่ม `saleIdFromAuditLog(row)` — คืน sale id เฉพาะเมื่อ `entity_type==='sale' && entity_id` (string); อย่างอื่น → null. **ห้ามเดา** จาก summary/doc_no/customer/amount
- **`modules/audit_log.js`**: row ที่ `saleIdFromAuditLog()` คืนค่า → ปุ่ม **📒 ดูบัญชี** → on-demand `findJournalForSale` (reuse 92.17) → แทนปุ่มด้วย badge; found = กด/Enter ไป `showRoute("accounting_journals")`; missing/error = ข้อความชัด ไม่เงียบ

### ขอบเขต (จงใจ)
- **ไม่แตะ** posting / `auto_post` / stock / loyalty / money math / RLS / SQL — JV lookup เป็น read-only; key = `source_table='sales' + source_id`
- delete_sale log เป็น **additive write** ที่ mirror pattern ของ `delete_receipt` ที่มีอยู่แล้ว (utils.js `logActivity`)

### Tests (`tests/sale_trace.test.js`, +8 = 18 ตัว)
`saleIdFromAuditLog`: sale-row→id / receipt-row→null / missing-id→null / summary-only(no entity_type)→null / garbage→null. trace flow: log→found / missing→"ยังไม่ลงบัญชี" / error→"ตรวจบัญชีไม่ได้" (no throw).

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit **350** (342→+8), e2e 11)

### หมายเหตุ smoke
delete_sale log **เริ่มเขียนตั้งแต่ build 274** → บิลที่ลบ**ก่อน** deploy 274 จะไม่มี row ใน Audit Log (เป็นปกติ). ต้องลบบิลใหม่หลัง deploy ถึงจะเห็นปุ่ม 📒 ดูบัญชี

---

## 🔗 Phase 92.17 — Accounting trace links (POS sale → JV) (this session)

**ปัญหาเดิม:** ระบบ auto_post สร้าง JV (`SV — ขาย`) ให้ทุก POS sale อยู่แล้ว แต่ฝั่ง user-facing **ไม่เห็น linkage** — หน้ารายการขายเห็นแค่เลขบิล BSK-..., ใบเสร็จไม่มี "เอกสารบัญชี" → user เข้าใจว่า "ไม่ลิงก์กับบัญชี" ทั้งที่ลิงก์อยู่ใน DB.

### Reliable key (Task A — audit ก่อนลงมือ)
- **Canonical 1:1:** `journal_entries.source_table='sales'` + `source_id=sale.id` (บังคับ unique ด้วย partial index `idx_je_source_unique`, ดู `auto_post.js:13`)
- `doc_no` (`SV{YYYY}{MM}{####}`) / `description` (`ขาย POS {order_no} — {customer}`) = **label เท่านั้น ห้ามใช้เป็น key**
- **Reverse link มีอยู่แล้ว:** หน้าสมุดรายวัน `journals.js` มี JV drawer → source row (`SOURCE_LABELS`, `_fetchSourceRow`) — เฟสนี้เพิ่ม **forward** (sale → JV) ที่ขาด
- **ข้อจำกัด:** journal entries **ไม่ได้อยู่ใน `state`** (loadAllData ไม่ดึง) → helper ต้อง fetch REST on-demand

### สิ่งที่เพิ่ม (read-only, additive)
- **helper ใหม่ `modules/accounting/sale_trace.js`:**
  - `findJournalForSale(sale, {fetch,cfg,token})` → `{ok, found, status:'found'|'missing'|'error'|'invalid', entry, error}` — fetch JV ด้วย key หลัก (inject fetch ได้สำหรับ test); ไม่ throw ทุก path
  - `renderSaleTraceBadge(result, {compact})` → HTML string (escaped); found = `.sale-acct-trace` + `data-acct-route="accounting_journals"` + `data-jv-id` (click target), missing = "ยังไม่ลงบัญชี", error = "ตรวจบัญชีไม่ได้" — **ทุกสถานะมีข้อความ ไม่เงียบ**
- **Surface 1 — sales list (`modules/sales.js`):** ปุ่ม **📒 บัญชี** ต่อแถว → on-demand lookup → แทนปุ่มด้วย badge; found = กด/Enter ไป `showRoute("accounting_journals")`
- **Surface 2 — receipt drawer (`main.js` `renderReceiptDrawer` + `_fillReceiptAcctTrace`):** section "เอกสารบัญชี" + placeholder "⏳ กำลังตรวจสอบ..." → async fill; found click = `closeAllDrawers()` + นำทาง

### ขอบเขต (จงใจ)
- **ไม่แตะ** posting / `auto_post` / money / stock / loyalty / RLS / SQL — เพิ่มแค่ read-only lookup + UI
- on-demand fetch (ไม่ดึง 200 JV ตอน render list) — online-only view, offline = badge "ตรวจบัญชีไม่ได้" (ไม่ crash)

### Tests (`tests/sale_trace.test.js`, 10 ตัว)
found / missing / error(403+throw) / invalid(no id, no fetch) + badge click-target (route+jv-id) + missing-not-silent + XSS escape doc_no. Inject fetch mock — ไม่แตะ network จริง.

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit **342** (332→+10), e2e 11 รวม build-version-sync)

---

## 🔍 Phase 92.16 — Console noise audit (this session)

**เป้าหมาย:** audit สิ่งที่ขึ้นใน DevTools Console จาก smoke flows หลัก แล้วแยก SAFE_NOISE / ACTIONABLE_LOW / BUG — **สรุป: ไม่เจอ bug จริง** ในเส้นทางที่ตรวจ.

### ตาราง classification (Task A)

| Console text | Source file:line | Level (เดิม → ใหม่) | Classification | Action |
|---|---|---|---|---|
| `Could not find window.__TAURI_METADATA__` | external lib (ไม่มีใน source เรา) | warn (lib) | **SAFE_NOISE** | document only — เป็น Tauri-env detection ของ lib ภายนอก, browser-only, แก้ที่โค้ดเราไม่ได้ |
| `Service Worker was updated because "Update on reload" was checked` | Chrome DevTools | info (browser) | **SAFE_NOISE** | document only — DevTools setting ของผู้ใช้ ไม่ใช่โค้ดเรา |
| `Deleting old cache: boonsook-pos-v5-cache-v<N>` | `sw.js:64` | `console.log` | **SAFE_NOISE** | keep — SW cache cleanup ปกติตอน activate (เห็นทุก build bump) |
| `[auto_post] ✅ created <doc> ...` | `accounting/auto_post.js:316` | `console.info` ✅ | **SAFE_NOISE** | already info — ไม่แตะ |
| `[auto_post] voided N JV(s) for ...` | `accounting/auto_post.js:129` | `console.info` ✅ | **SAFE_NOISE** | already info — ไม่แตะ |
| `[sales delete] loyalty reverse attempt: {...}` | `sales.js:263` | `console.log` → `console.info` | **ACTIONABLE_LOW** | demote — trace ที่คาดไว้ทุกครั้งที่ลบ ไม่ใช่ปัญหา |
| `[sales delete] loyalty reverse skipped: <reason>` | `sales.js:279` | `console.log` → `console.info` | **ACTIONABLE_LOW** | demote — expected no-op (no earn / already reversed / remaining=0) |
| `[refunds] loyalty reverse skipped: <reason>` | `refunds.js:442` | `console.log` → `console.info` | **ACTIONABLE_LOW** | demote — เหมือน sales path เพื่อ consistency |
| `[sales delete] loadAllData timeout after committed delete: ...` | `sales.js:301` | `console.warn` ✅ | **SAFE_NOISE** | keep warn — Phase 92.15 ระบุชัดว่า delete commit สำเร็จแล้ว, แถวไม่เด้งกลับ; warn เหมาะแล้ว |
| `[sales delete] loyalty reverse failed/exception` | `sales.js:281,285` | `console.warn` | (correct) | keep — real failure path ต้องเห็น |

**Real failure logs ที่ "คงไว้เป็น warn/error โดยตั้งใจ"** (ห้าม demote): `[auto_post] unbalanced/entry insert failed/rollback FAILED/voidJV silent fail` (`auto_post.js`), `[refunds] loyalty reverse failed/threw` (`refunds.js:444,447`), `[sales delete] error` (`sales.js:306`). พวกนี้คือสัญญาณบั๊กจริง — ต้องดังไว้.

### สิ่งที่แก้ (Task B — logging only)
- `sales.js:263` loyalty reverse **attempt** diagnostic: `console.log` → `console.info`
- `sales.js:279` loyalty reverse **skipped**: `console.log` → `console.info`
- `refunds.js:442` loyalty reverse **skipped**: `console.log` → `console.info`

### ขอบเขต (จงใจ)
- **ไม่แตะ** money / POS checkout / stock CAS / JV / loyalty side-effect — เปลี่ยนแค่ระดับ log ของ 3 บรรทัดที่เป็น expected no-op
- **ไม่** blanket-monkeypatch console, **ไม่** ลบ diagnostic ที่มีประโยชน์, **ไม่** กลบ error จริง
- ไม่มี SQL / ไม่ install package / ไม่ refactor กว้าง

### Known browser-only warnings (document — ไม่ต้องแก้)
- `Could not find window.__TAURI_METADATA__` — จาก lib ภายนอก, ปกติบนเว็บ (ดู `CLAUDE_SESSION_HANDOFF.md:158`)
- `Service Worker was updated because "Update on reload" was checked` — DevTools setting ของผู้ใช้
- `Deleting old cache: ...v<N>` — SW activate cleanup ปกติ (เห็นทุกครั้งที่ build เลื่อน)

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit 332, e2e 11 — รวม build-version-sync checks)

### Test note (Task C)
ไม่เพิ่ม test — เป็น log-level change ล้วน ไม่กระทบ return shape / behavior; ไม่มี test เดิม assert ข้อความ log เหล่านี้ (ตรวจแล้ว).

---

## 🗑️ Phase 92.15 — Sale delete refresh resilience (this session)

อาการเดิม: ลบบิลในหน้า "รายการขาย" (admin) เป็น **soft-delete** — PATCH `sales.note = "[ลบแล้ว] ..."`. List ซ่อนแถวที่ลบผ่าน `visibleSalesForRole()` (`utils.js:111` filter `note.includes("[ลบแล้ว]")`). แต่ handler เดิม (`modules/sales.js`) **ไม่แตะ `state.sales` ในเครื่องเลย** — พึ่ง `await loadAllData()` ดึงใหม่จาก server เพื่อให้แถวหาย. ถ้า `loadAllData()` timeout (เน็ตช้า) → `state.sales` ไม่ refresh → **แถวที่ลบยังค้างจอ ทั้งที่ toast ขึ้น "ลบรายการขายเรียบร้อย ✅"** (งง).

### สิ่งที่แก้ (`modules/sales.js`, หลัง side-effects เสร็จ ก่อน background reload)
- เติม optimistic update — `localSale.note = newNote` (mirror สิ่งที่ server PATCH ทำเป๊ะ) → `_renderSalesView(...)` ซ้ำทันที → แถวหายเลยเพราะ `visibleSalesForRole()` กรอง `[ลบแล้ว]`
- เลือก **set-note** ไม่ใช่ splice ทิ้ง — เพื่อให้ consumer อื่นที่ filter `[ลบแล้ว]` (P&L/report `main.js:2040, 3826`) consistent ไม่ว่า reload จะสำเร็จหรือไม่
- `loadAllData()` หลัง committed delete = best-effort จริง — log warn `"loadAllData timeout after committed delete"` แทน, แถวไม่เด้งกลับ
- `finally` reset ปุ่ม safe อยู่แล้ว: หลัง re-render ปุ่มเก่าหลุด DOM → `btn.isConnected === false` → ไม่ไป reset node เก่า

### ขอบเขต (จงใจ)
- **ไม่แตะ** money/stock/JV/loyalty side-effect (void JV / revert stock / reverse loyalty คงเดิมทุกบรรทัด) — แก้เฉพาะ local state mirror + re-render ของ list view
- delete fail จริง (0 rows / RLS) ยัง throw → outer catch → toast error เหมือนเดิม (แยกจาก refresh timeout ชัดเจน)

### Gates
- `npm run verify` เขียว exit 0 (lint 0/0, unit 332, e2e 11)

---

## 💰 Phase 92.14 — Money/accounting closure (this session)

ปิด should-fix ที่เหลือจาก money audit 4.1 แบบแคบ + TDD. **✅ MERGED PR #39 + deploy build 270 + smoke PASSED (21 พ.ค. 2026).** ไม่แตะ SQL/RLS, ไม่แตะ proven paths (loyalty CAS, atomicDecrementStock, credit CAS, receipt open, SW).

### 1. round2 — cart total (pos.js) + refund total (refunds.js)
- **pos.js:** มี 5 จุด inline `cart.reduce((s,i)=>s+i.qty*i.price,0)` ดิบ (display, quickPay default, checkout amount) → extract `export function cartSum(cart)` = `round2(Σ)` แทนทั้ง 5. checkout **write path** (total_amount/line_total/...) round2 อยู่แล้ว (Phase 89.2) — นี่คุม in-memory + เงินทอนที่โชว์ ไม่ให้ค้าง 0.30000000000000004
- **refunds.js:** ยอดคืน reduce ดิบ → ลง DB `refund_amount` + JV (postJournalForRefund) ไม่ตรงสตางค์. extract `export function refundTotal(items)` = `round2(Σ)` ใช้ที่ preview (333) + actual write (355)
- Tests: `tests/money_round2_helpers.test.js` (+7)

### 2. verify-slip mismatch confirm (functions/api/verify-slip.js)
- แยก verification block (เดิม inline ใน onRequestPost) → `export function buildSlipVerification(parsed, expectedAmount, expectedRecipient)` (pure → unit-test ได้)
- **Hardening:** เดิมถ้ามี `expected_amount > 0` แต่ OCR อ่านยอดสลิปไม่ได้ (`amount ≤ 0`) → ไม่มี warning → `is_safe` อาจ true → 3 ฟอร์มโชว์ "✅ ผ่านการตรวจสอบ" **หลอก** ทั้งที่ไม่เคยเทียบยอด. แก้: กรณีนี้ `amount_match=false` + warning "อ่านยอดในสลิปไม่ได้ — ยืนยันยอด X เองก่อนรับชำระ" → `is_safe=false`
- ผู้ใช้ร่วม: `ac_install.js` / `service_form.js` / `solar.js` ล้วน gate display ด้วย `v.is_safe === true` → fix เดียวคุมทั้ง 3 (ไม่ต้องแตะ 3 ไฟล์)
- **ขอบเขต (จงใจ):** ยังเป็น advisory display — ไม่ได้ใส่ hard `confirm()` dialog บน save handler ของแต่ละฟอร์ม (จะกระจาย 3 ไฟล์ = เกิน scope/risk). is_safe ที่แม่นขึ้นทำให้ "⚠️ ต้องตรวจเพิ่มเติม" โชว์เชื่อถือได้ — ถ้าต้องการ dialog gate เป็น follow-up แคบ ๆ
- Tests: `tests/verify_slip_verification.test.js` (+8)

### 3. Audit — journal_entries RLS: closed หรือยัง?
**✅ CLOSED — verified on prod 24 พ.ค. 2026** (3 read-only queries, user รันใน Supabase SQL Editor)
- auto_post.js insert `journal_entries` ตรงจาก client (PostgREST). Policy `je_insert_auto` (phase89-25) อนุญาต non-accountant insert เมื่อ `source_table`+`source_id` ไม่ null. `postJournalForSale` ส่งครบ → ถ้า policy active = staff insert ผ่าน
- Phase 92.13 เพิ่ม graceful handling: 403/42501 → warn "JV deferred" (ไม่ crash, sale ผ่าน). User รายงานเห็น `[auto_post] created...` ในรอบหลัง → policy active confirmed
- **Verify evidence (24 พ.ค. 2026, prod Supabase):**
  - **Q1** `pg_policies` บน 3 tables → **10 rows ครบ:** `je_select/update/delete/insert_auto`, `jl_select/update/delete/insert_auto`, `am_select/write` (ทั้ง 2 `*_insert_auto` มี `has CHECK` clause ตามที่ Phase 89.25 ตั้งใจ)
  - **Q2** `is_accountant()` function → 1 row, `returns=boolean` (function ที่ policy USING/CHECK เรียกใช้ มีจริง)
  - **Q3** `pg_class.relrowsecurity` บน 3 tables → 3 rows, `rls_enabled=true` ทุกตัว (`rls_forced=false` ปกติ — owner bypass ได้)
- **สรุป:** non-accountant role (cashier/sales/technician) สามารถ auto-post JV ได้ตราบใดที่ส่ง `source_table` + `source_id` ครบ; HTTP 403 ที่เคยเห็นตอนรอบ Phase 92.13 น่าจะเป็น session test ที่ role ไม่ตรงเงื่อนไข — ไม่ใช่ DB state issue

### Gates
- lint 0/0 · unit 317 → 332 · e2e 11 · verify exit 0 (clean run)

### Manual smoke after deploy (build 270) — ✅ PASSED (21 พ.ค. 2026)
1. ✅ Ctrl+Shift+R → 5.47.4 (build 270)
2. ✅ **Cash recon refund (ของจริง):** คืนเงินสด 1 รายการ → cash recon วันนั้น → "ควรมีในลิ้นชัก" ลดตามยอด refund (ไม่ false "ขาด") — ยืนยัน Phase 92.12 fix ทำงาน live
3. ✅ Refund บิลที่มีราคาทศนิยม → `refund_amount` ตรงสตางค์ (ไม่มี ...0001)
4. ✅ POS cart หลายชิ้นราคาทศนิยม → ยอด/เงินทอนสะอาด
5. ✅ Verify slip ที่อ่านยอดไม่ได้ (รูปมัว) ในฟอร์มบริการ → ไม่ขึ้น "✅ ผ่าน" หลอก, ขึ้น "⚠️ ต้องตรวจ + ยืนยันยอดเอง"

---

## 🐛 Phase 92.13 — Production smoke bugs (previous session)

Build 268 live, user smoke tested. เจอ console errors จริง 2 จุด → fix. **No push yet (awaiting user confirm — production deploy).**

### Task A — journal_entries RLS 403 (auto-post JV)
- **อาการ:** `[auto_post] entry insert failed: HTTP 403 code 42501 ... row-level security policy for table "journal_entries"`
- **วินิจฉัย:** auto_post.js POST `journal_entries` ตรงจาก client (PostgREST). RLS policy `je_insert_auto` (อนุญาต non-accountant insert เมื่อ source_table+source_id ไม่ null) **ไม่มีใน prod** ทั้งที่ `postJournalForSale` ส่ง source ครบ → 403. นี่คือ **DB state issue แก้ JS-only ไม่ได้** (bypass RLS = fake success → ห้าม)
- **POS sale ไม่เคยถูก block:** `postJournalForSale({...}).catch(...)` ใน pos.js เป็น fire-and-forget; `_postJournal` catch แล้ว return null. sale บันทึกสำเร็จเสมอ
- **JS hardening (build นี้):** แยกเคส 403/42501 ออกจาก error ทั่วไป → `console.warn` ข้อความชัด "JV deferred (RLS) — source saved OK; verify je_insert_auto policy" แทน `console.error "entry insert failed"` ที่ดูเหมือน crash. ไม่เปลี่ยน return (ยัง null = ไม่ fake)
- **🔴 DB ACTION (ต้องทำฝั่ง Supabase, ไม่ใช่ deploy นี้):** รัน/verify `supabase-phase89-25-fix-je-rls-pos.sql` ใน prod SQL editor. **discrepancy:** SESSION_LOG line 139 ระบุ `✅ DONE (10 policies created)` แต่ live ยัง 403 → policy อาจถูก revert/หายจาก prod หรือ apply ผิด project. ไฟล์มี verify query (SELECT pg_policies) ท้ายไฟล์ — รันแล้วต้องเห็น 10 rows (je_*×4, jl_*×4, am_*×2). เช็ค `public.is_accountant()` ว่ายังมีอยู่ด้วย

### Task B — stock_movements type constraint บน sale delete (Blocking, fixed)
- **อาการ:** `[xhrPost] stock_movements ERROR: code 23514 ... check constraint "stock_movements_type_check"` ตอนลบบิล
- **สาเหตุ:** `_revertStockForSale` (main.js ~2920) insert `type: "return_sale"` — ไม่อยู่ใน allowed set ของ constraint. allowed types (จาก flow ที่ทำงานได้): `in/out/adjust/transfer/sale/return` (constraint ไม่อยู่ใน tracked SQL — มาจาก migration เก่า)
- **แก้:** `return_sale` → `return` (semantic เดียวกัน = สต็อกคืนกลับคลัง; refund restock ก็ใช้ `return` อยู่แล้ว) — main.js เท่านั้น, ไม่แตะ checkout decrement (`sale`) / transfer (`transfer`)
- **Regression test:** `tests/stock_movement_type_guard.test.js` (+3) — สแกน main.js: ทุก `xhrPost("stock_movements", {type})` ต้องอยู่ใน allowed set + ห้ามมี `return_sale` + reverse block ต้องใช้ `return`

### Task C — role/menu audit (credit payment page)
- **ข้อสรุป: ไม่ใช่ admin-only / ไม่ได้ hidden.** `credit_tracker`:
  - อยู่ใน `ROLE_PAGES.sales` (main.js:596) → sales role เข้าถึงได้
  - มี sidebar nav button: `index.html:275` กลุ่ม "💰 การเงิน" (data-group="finance") → "💳 ลูกค้าค้างชำระ" (sub-item)
  - main.js:786 แสดง/ซ่อน nav-btn ตาม ROLE_PAGES → sales เห็นปุ่มนี้
- **ทำไม user ไม่เห็น:** เป็น sub-item ใน group "การเงิน" ที่ยุบอยู่ (ต้องกดขยายกลุ่มก่อน) — เป็น UX discoverability ไม่ใช่ bug/permission
- **วิธี test Phase 92.12 credit flow (staff):** login sales → sidebar → ขยาย "💰 การเงิน" → "💳 ลูกค้าค้างชำระ" → เลือกบิลเชื่อที่ยังค้าง → "💰 รับชำระ"

### Gates
- lint 0/0 · unit 314 → 317 · e2e 11 · verify exit 0 (clean run)

### Manual smoke after deploy (build 269)
1. Staff POS cash sale → ไม่มี console error ใหม่ (JV 403 ถ้ายังไม่รัน SQL จะขึ้น warn "JV deferred" — ไม่ใช่ error/crash, sale ผ่าน)
2. ลบ/refund บิล → ไม่มี stock_movements 23514, สต็อกคืนกลับ
3. Journal: ถ้ารัน phase89-25 SQL แล้ว → JV ลงจริง (console.info "✅ created"); ถ้ายังไม่รัน → warn "JV deferred" ชัดเจน ไม่มี success หลอก

### Recommend next
- รัน `supabase-phase89-25-fix-je-rls-pos.sql` ใน prod (Task A real fix) → JV auto-post กลับมาทำงานสำหรับ staff
- ถ้า JV เคยพลาดช่วง 403 → ใช้ accounting backfill UI re-post

---

## 💰 Phase 92.12 — Money audit fixes (previous session)

จาก money audit (CLAUDE.md 4.1): money handling แข็งแรง (round2 centralized, VAT correct, double-entry balance, loyalty idempotent — verified) แต่เจอ **1 Blocking + 1 Should-fix**. แก้แบบ **JS-only ไม่มี SQL migration** (column NUMERIC → client CAS พอ), TDD ทั้งคู่. **No push yet (awaiting user confirm — money path, production deploy).**

### 1. 🔴 [Blocking] credit_tracker: รับชำระหนี้ non-atomic
- **ปัญหา:** `credit_tracker.js:278` เดิม `const newPaid = sale._paid + amount; PATCH credit_paid_amount = newPaid` — read-modify-write เขียนค่า absolute จาก `sale._paid` (state อาจ stale). 2 staff รับชำระบิลเดียวกันพร้อมกัน → เขียนทับกัน → **payment หาย + A/R เกินจริง**. `credit_payments` ledger (source of truth) ครบ แต่ `sales.credit_paid_amount` (denormalized cache) drift
- **แก้:** เพิ่ม generic CAS `atomicAddToField({...delta})` ใน `stock_cas.js` (โครงเดียวกับ `atomicDecrementStock` แต่ delta บวก/ลบได้, require `Number.isFinite`, after = before + delta, null field → fail fast). credit_tracker เรียก CAS แทน: refetch DB → PATCH `?credit_paid_amount=eq.{before}` → 0 rows = stale = retry (max 3). `newPaid = round2(inc.after)` = ค่าจริงหลัง increment. ถ้า fully paid → PATCH `credit_paid_at` แยก (idempotent timestamp, ไม่ critical race)
- **ไม่แตะ:** `atomicDecrementStock` (stock checkout ใช้), `credit_payments` insert (ledger), `postJournalForCreditPayment` JV (double-entry, fire-and-forget)
- **column verified NUMERIC** → eq precondition match เป๊ะ (ไม่ใช่ float8 ที่ precision เพี้ยน)

### 2. 🟡 [Should-fix] cash_recon: cash refund ไม่ถูกหักจากลิ้นชัก
- **ปัญหา:** `computeCashRecon` เดิม expected = opening + cashIn − cashOut แต่**ไม่หัก cash refund** → คืนเงินสดทำให้ลิ้นชักขาดโดยไม่มีบันทึก = false "ขาด" ทุกรอบ. `refunds` ไม่อยู่ใน state กลาง
- **แก้:** `computeCashRecon` เพิ่ม `refunds = []` param + คืน `cashRefunds`/`cashRefundOut` (filter เฉพาะ refund_method=cash + วันที่เลือก, โอนคืนไม่กระทบเงินสด). `renderCashReconPage` fetch refunds ของวัน (REST, cache ต่อวันกัน refetch ทุก keystroke, async re-render) แล้ว pass เข้า + expected = opening + cashIn − cashOut − **cashRefundOut** + แสดง refund line ใน Step 2
- **ไม่เปลี่ยน** existing recon math (cashIn/cashOut/transferIn) — แค่เพิ่มหัก cashRefundOut

### 3. 🔧 [Review hardening] partial-failure safety (รับชำระหนี้)
หลัง review: CAS แก้ lost-update แล้ว แต่ยังมี UX risk — ถ้า `credit_payments` insert สำเร็จ แล้ว CAS หรือ `credit_paid_at` PATCH fail → handler throw → user กดซ้ำ → **duplicate ledger row**. แก้:
- แยก logic เป็น `processCreditPayment({...})` (exported, DI fetcher → unit-testable) คืน result object **ไม่ throw หลัง ledger insert**
- **หลัง ledger insert สำเร็จ = committed** → `ok:true, retrySafe:false` เสมอ → handler **ไม่เปิดปุ่มให้กดซ้ำ** (กัน duplicate). เฉพาะ insert fail (`retrySafe:true`) เท่านั้นที่เปิดปุ่มใหม่
- **CAS fail → reconcile จาก ledger SUM** (`reconcileCreditPaidFromLedger`): GET `credit_payments?sale_id&select=amount` → set `credit_paid_amount = SUM` (absolute, authoritative, self-healing — JS-only ไม่แตะ schema). ถ้า reconcile ก็ fail → `syncWarning` non-retry message + reload
- **`credit_paid_at` = best-effort metadata** — ไม่ throw; fail แค่ตั้ง `syncWarning` ("สถานะครบชำระอาจต้องรีโหลด") + success path เดินต่อ + reload
- handler แสดง `syncWarning` (warn toast) แทน success toast เมื่อ cache/status sync degraded

### Tests (TDD red→green)
- `tests/atomic_add_field.test.js` (ใหม่, +5): increment / stale-retry / null-fail / contention-exhaust / non-finite-delta
- `tests/cash_recon.test.js` (+1): cash refund หักจากลิ้นชัก (transfer refund + คนละวัน ไม่นับ)
- `tests/credit_payment_partial_failure.test.js` (ใหม่, +6): happy / insert-fail-retrySafe / credit_paid_at-fail-after-CAS / CAS-fail+reconcile-ok / CAS-fail+reconcile-fail-nonretry / sync-throws-nonretry
- Gates: lint 0/0 · unit 302 → 314 · e2e 11 (verify exit 0 end-to-end, no zombie 4173)

### Remaining non-transaction risk (acknowledged)
ระบบไม่มี DB transaction ข้าม ledger+cache (client REST + RLS, ไม่มี RPC). หลัง hardening:
- **เงินไม่หาย:** `credit_payments` (source of truth) insert ครบ + ไม่ duplicate (no retry หลัง commit)
- **cache (`sales.credit_paid_amount`) อาจ transient stale** ถ้า CAS+reconcile fail ทั้งคู่ (network ตายช่วงนั้น) → self-heal เมื่อรับชำระครั้งถัดไป (CAS อ่านค่าจริง) หรือ manual reload; user เห็น non-retry warning ชัดเจน
- ไม่มี atomic rollback: ถ้าอยากปิด gap 100% ต้องทำ Postgres RPC (`receive_credit_payment` function) ที่ insert+update ใน transaction เดียว — นอก scope JS-only ของ phase นี้ (แนะนำพิจารณาถ้าต้องการ strict guarantee)

### Manual smoke (REQUIRED post-deploy — MONEY)
1. Ctrl+Shift+R → 5.47.2 (build 268)
2. รับชำระหนี้บางส่วน → credit_paid ถูก + JV ลง + (ถ้าครบ) ขึ้น "ครบแล้ว"
3. **Concurrent (proof CAS):** เปิดบิลเชื่อเดียวกัน 2 แท็บ → รับชำระพร้อมกัน → credit_payments 2 rows + credit_paid_amount = SUM (ไม่หาย)
4. คืนเงินสด → cash recon วันนั้น → expected ลดตาม refund (ไม่ false "ขาด")
5. Console ไม่มี ReferenceError

### Next: Phase 92.13 (audit 4.1 should-fix ที่เหลือ)
- 🟡 refunds round2 + pos.js cart round2 + verify-slip mismatch confirm

---

## 🐛 Phase 92.11 — Fix silent "เปิดบิล" + verify health + version sync (previous session)

งาน health/cleanup หลัง build 266. **No push yet (awaiting user confirm — production deploy).**

### 1. ปุ่ม "เปิดบิล" กดแล้วเงียบ (รากของปัญหา = `loadReceipt`)
- `loadReceipt(saleId)` เดิมใช้ `state.supabase.from(...).single()` — Supabase JS client **ค้างบนมือถือ** (pos.js receipt-load เลี่ยงไปแล้วด้วยเหตุนี้) + ถ้า `state.supabase` ยังไม่พร้อม → **throw** → ใน sales.js `await loadReceipt(); openReceiptDrawer();` เมื่อ throw แล้ว drawer ไม่เปิด = ปุ่มเงียบ. กรณี query error → `return` เงียบ ๆ ไม่มี toast
- **แก้:** เขียน `loadReceipt` ใหม่เป็น `fetch` + `AbortController` timeout 8s (mirror pos.js:1176-1198) คืน `{ok, error}` (ตาม convention async-refactor-return-shape) — ไม่ throw, ไม่ hang
- caller (sales.js "เปิดบิล" + customer drawer ใน main.js): เช็ค `r.ok === false` → `showToast` เตือน + เปิด drawer เฉพาะตอนสำเร็จ; ปุ่ม sales.js กัน double-click ด้วย `disabled` ใน finally
- legacy checkout caller (main.js ~3308) ไม่แตะ — ignore return value, ไม่ regress
- **ยังไม่ได้ verify บน device จริง** — โครงสร้างเหมือน pos.js receipt fetch ที่ใช้งานจริงบน prod แล้ว (RLS ผ่าน user token เดิม)

### 2. Lint 2 → 0 warnings
- `pos.js:1193` `state.lastReceipt` — ขยาย `eslint-disable require-atomic-updates` ครอบ assignment (อยู่ใน `_posCheckoutGuard.run()` single-flight อยู่แล้ว เหมือนบล็อกถัดไป)
- `loyalty.js:340` `requireAdmin` — **false positive**: renderLoyaltyPage forward `ctx` ทั้งก้อนเข้า `renderSettingsTab(settings, ctx)` (admin gate อยู่ที่ save handler line ~634). local binding ไม่ถูกอ้างตรง ๆ แต่ guard test `loyalty_settings_admin_guard` ล็อกชื่อ `requireAdmin` ห้าม alias → ใช้ justified `eslint-disable-next-line no-unused-vars` (ไม่ revert เป็น `_` เพราะจะ fail guard test)

### 3. e2e/verify health
- รัน `npm run verify` จบครบ **17-20s** (ไม่ค้าง). อาการค้าง ~180s จาก audit = **zombie `static-server.js` ค้าง port 4173** จาก run ที่ถูก interrupt — ไม่ใช่ bug ของ config. ถ้าเจออีก: kill node ที่ถือ port 4173 แล้วรันใหม่ (`reuseExistingServer:true` local จะ reuse zombie ที่อาจค้าง)

### 4. Version drift fix
- `package.json` 5.43.42 → **5.47.1** (เดิม drift ห่างจาก UI/docs). bump build 266 → 267 ครบ 4 จุด: index.html (selfheal+data-app-build / main.js / boot.js / style.css `?v=267`) · sw.js `cache-v267` · pages.js (5.47.1 / build 267) · package.json

### Verify (เขียวครบ)
- lint **0 errors / 0 warnings** · unit **302 pass** · e2e **11 pass**

### ไม่แตะ (product decision)
- manual tab role gate ใน Loyalty (admin-only settings) — คงเดิม

---

## ♻️ Phase 92.10 CAPSTONE — Extract boot orchestration → `modules/boot.js` (this session)

ปิด **decomposition series 92.1-92.10**. ย้าย boot IIFE (self-invoking async ที่รันตอน main.js โหลด) → `modules/boot.js`. ผลลัพธ์เชิงสถาปัตยกรรม: main.js เป็น **side-effect-free module** แล้ว — ไม่มี IIFE รันเองตอน import → boot orchestration testable + module boundary สะอาด. Refactor-only, byte-identical. **No push (awaiting user).**

### What moved (main.js boot IIFE → modules/boot.js)
- `(async function boot(){...})()` ท้าย main.js → `export async function runBoot({...7 deps})` ใน boot.js
- main.js เรียก `runBoot({...})` (fire-and-forget, ไม่ await) ที่ตำแหน่งเดิม (หลัง updateAppLogos wrapper + window.App) — deps ทั้งหมด hoisted/defined แล้วตอนเรียก

### Why dependency injection (ไม่ใช่ direct import)
boot เรียก initSupabase/afterLogin/bindStaticEvents ที่อยู่ใน main.js. ถ้า boot.js import จาก main.js → **circular** (main.js import boot.js เพื่อ trigger ↔ boot.js import main.js เพื่อเรียก functions). Inject deps ผ่าน params → boot.js ไม่ต้อง import main.js เลย → ตัด circular + ลำดับ testable.

### 7 injected deps (verified main.js scope)
| dep | ที่มา | mapping |
|-----|-------|---------|
| `initDarkMode` / `bindStaticEvents` / `updateAppLogos` / `initSupabase` / `afterLogin` | function decls (hoisted) | ส่งชื่อตรงๆ |
| `syncLogo` | `window._appSyncLogo` | `() => window._appSyncLogo()` |
| `getCurrentUser` | `state.currentUser` | `() => state.currentUser` |

### Byte-identical (ลำดับ + early-return เป๊ะเดิม)
darkMode → static events → logo paint → `await initSupabase()` → `if(!ok) return` → `if(!getCurrentUser()) return` → `await afterLogin()` → background `syncLogo().then(repaint)`. แก้แค่ `state.currentUser`→`getCurrentUser()`, `window._appSyncLogo()`→`syncLogo()`.

### ไม่แตะ (verified)
- `updateAppLogos` wrapper (branding._updateAppLogosImpl) + `window.updateAppLogos` — เก็บใน main.js, ส่งเข้า runBoot ผ่าน param
- dependencies เดิม (initDarkMode/bindStaticEvents/initSupabase/afterLogin) ใน main.js ไม่แตะ

### Tests (+9)
- Behavioral (5): happy-path order / bail-after-supabase-false (no afterLogin) / bail-no-current-user / pre-supabase-steps-always-run / logo-repaint-after-syncLogo
- Source pins (4): boot.js exports runBoot · main.js imports+calls runBoot · main.js side-effect-free (no boot IIFE) · boot.js does NOT import main.js
- หมายเหตุ: ปรับ test helper `makeDeps` ใช้ scenario knobs (`supabaseOk`/`currentUser`) แทน override ตรงๆ — กัน override ลบ `calls.push` (ที่ทำให้ bail-test assert ผิด); เจตนา test เดิมคงไว้

### Decomposition series 92.1-92.10 — COMPLETE
main.js: 4690 → 4247 บรรทัด (-443). Modules แยกออก: `branding.js` (logo) · `lazy_libs.js` (html2canvas) · `share_doc.js` (PDF/share) · `utils.js` (formatters) · `api.js` (XHR/auth data layer) · `boot.js` (orchestration). main.js = pure module definitions + window.App contract + thin wrappers, **side-effect-free**.

### Manual smoke (REQUIRED post-deploy — boot = app entry point)
1. Ctrl+Shift+R → version 5.47.0 (build 266)
2. แอป boot ขึ้นปกติ — dark mode apply, sidebar/logo, login screen หรือ dashboard (ตาม session)
3. Login flow — ถ้ายังไม่ login → login → afterLogin → dashboard โหลด (พิสูจน์ boot ordering)
4. Logo sync background (ถ้ามี Supabase logo) → repaint
5. DevTools Console → ไม่มี ReferenceError / boot ไม่ crash

---

## ♻️ Phase 92.9 — Extract XHR/API data layer → `modules/api.js`

ต่อยอด decomposition 92.1-92.8. ย้าย **data-access layer** (auth-critical) ที่ทุก data operation พึ่งพา. Refactor-only, byte-identical. **No push (awaiting user).**

### What moved (main.js L178-395 → modules/api.js)
- `_refreshInflight` (module-level guard) + `refreshAccessToken` (single-flight token rotation, 3s herd-absorb)
- `appAuthFetch` (401-retry-with-refresh fetch wrapper) + `xhrPost` / `xhrPatch` / `xhrDelete` (XHR REST + 401 recursive retry)

### Why factory `createApi({ windowRef })` (ไม่ใช่ plain exports)
1. **Shared mutable** `_refreshInflight` — 5 functions ต้องเห็น guard เดียวกัน
2. **Internal recursion** — appAuthFetch→refreshAccessToken; xhrPost/Patch/Delete→refreshAccessToken→recursive self with `_isRetry=true`
3. **Positional `_isRetry` param** — เพิ่ม windowRef ต่อ function จะชน positional args ของ 13 callers + recursive retry
→ factory inject `windowRef` ครั้งเดียวผ่าน closure แก้ทั้ง 3 ข้อ; 5 functions + `_refreshInflight` อยู่ closure เดียว

### Caller compatibility (ห้ามแตะ — verified)
- main.js destructure `{ refreshAccessToken, appAuthFetch, xhrPost, xhrPatch, xhrDelete } = createApi({ windowRef: window })` → bindings อยู่ใน module scope
- ผูก `window._appRefreshAccessToken/_appAuthFetch/_appXhrPost/_appXhrPatch/_appXhrDelete` เดิม → 13 module callers (quotations/delivery_invoices/ฯลฯ) ไม่แตะ
- main.js local callers (~30 จุด L1816+: products/customers/sales/stock/profiles) ใช้ destructured bindings ตรงๆ

### Byte-identical — แก้แค่ global → windowRef.*
| เดิม | ใหม่ |
|------|------|
| `window.SUPABASE_CONFIG` / `window._sbAccessToken` / `window.App` | `windowRef.*` |
| `fetch(` | `windowRef.fetch(` |
| `new XMLHttpRequest()` | `new windowRef.XMLHttpRequest()` |
| `state.supabase` fallback (L183) | ตัดออก — `windowRef.App?.state?.supabase` พอ (window.App.state === state, verified L4422) |

retry/refresh/single-flight setTimeout(3s)/headers/timeout(15000)/status-handling/JSON-guards/console logging — ไม่แตะ

### Global-leak guard (auth-critical, A.5) — PASS
`node --check` api.js+main.js OK; ทุก `window.`/`fetch(`/`new XMLHttpRequest`/`state.` ใน api.js เป็น comment หรือ `windowRef.*` (ไม่มี bareword leak)

### Tests (+18 → 293 total)
14 behavioral (appAuthFetch header inject + anonKey fallback + 401 retry single/double; refreshAccessToken false/rotate/single-flight; xhrPost 2xx/empty/4xx; xhrPatch RLS-blocked/2xx; xhrDelete 2xx/4xx) + 4 source pins (factory export, main.js wiring 5 wrappers, no inline defs, windowRef routing)

### Manual smoke (REQUIRED post-merge+deploy — blast radius ใหญ่สุดในซีรีส์)
หลัง build 265 live: Ctrl+Shift+R → 5.46.0 → **login** → **load** data (Dashboard/POS/สินค้า/ลูกค้า) → **create** (ขาย/ใบเสนอราคา) → **edit** (สินค้า/ลูกค้า) → **delete** → **token refresh** (ทิ้งจน token หมดอายุ/ลบ session ใน DevTools → ทำ action → refresh+retry เงียบ หรือ toast "Session หมดอายุ") → Console ไม่มี ReferenceError

---

## ♻️ Phase 92.8 — Extract Thai-locale formatters → `modules/utils.js`

ต่อยอด decomposition 92.1-92.7. ย้าย 5 pure formatters ที่ยัง inline ใน main.js ไปรวมกับ shared utils.js (ที่มี escHtml/round2/todayBkk/dateBkk อยู่แล้ว). Refactor-only, byte-identical. **No push (awaiting user).**

### What moved (main.js → modules/utils.js)
- `money` (const arrow), `formatNumber`, `formatCurrency`, `formatDate`, `formatDateTime` — body byte-identical, แค่เติม `export`; วางไว้หลัง date helpers (todaySuffix) เพื่อ cohesion
- main.js เพิ่ม `import { money, formatNumber, formatCurrency, formatDate, formatDateTime } from "./modules/utils.js";` (บรรทัดถัดจาก escHtml import)

### Why utils.js (ไม่สร้าง module ใหม่)
- มี date helpers (todayBkk/dateBkk) อยู่แล้ว → formatDate/formatDateTime ไปอยู่ด้วยกัน = cohesion
- ตรงกับ pattern Phase 51 (escHtml dedup → utils.js); modules หลายตัว import จาก utils.js ตรงๆ อยู่แล้ว
- `formatCurrency` เรียก `money` → ทั้งคู่ต้องอยู่ module เดียวกันเพื่อให้ internal call ทำงาน

### Caller compatibility (ห้ามแตะ — verified)
- `window.App` exports object (escapeHtml/formatNumber/formatCurrency/formatDate/formatDateTime) ไม่แตะ — ES import live binding ทำให้ object shorthand ทำงานเหมือนเดิม
- 6 จุดที่เรียก `money(...)` ใน main.js ไม่แตะ call site
- ไม่มี name collision ใน utils.js (ตรวจแล้ว) + ไม่มี module อื่น define formatNumber/formatDate ทับ

### Build bump 263 → 264 (จำเป็น)
- utils.js เป็น static import → browser/SW cache ตาม CACHE_NAME; ถ้าไม่ bump client เก่าอาจโหลด utils.js เก่า (ไม่มี formatters) คู่ main.js ใหม่ (ไม่มี inline) → ReferenceError
- Files: index.html (style.css/selfheal/main.js/boot.js ?v=264 + data-app-build=264), sw.js CACHE_NAME v264, pages.js version 5.45.1 + build 264

### Stats
- main.js: 4467 → 4454 บรรทัด (−13); Tests: 263 → 275 (+12: 8 behavioral + 4 source-level pins)
- Verify: lint 0 + 275 unit + 11 e2e green

### Recommend ต่อ (Phase 92.9+)
- DOM/form utils (fadeIn/fadeOut, showLoading/hideLoading, getFormData/validateForm/clearForm) → modules/dom_utils.js
- XHR/API layer (xhrPost/Patch/Delete + appAuthFetch + refreshAccessToken) → modules/api.js
- boot IIFE → modules/boot.js (capstone — main.js side-effect-free)

---

## ♻️ Phase 92.7 — Extract `_appShareDoc` → `modules/share_doc.js`

ต่อยอด decomposition 92.1-92.6. ย้าย Share/PDF overlay (chunk ใหญ่สุดที่เหลือเป็นก้อนเดียวใน main.js, L426-644 ~223 บรรทัด) ออกเป็น module ใหม่. Behavior byte-identical, refactor-only. **No push (awaiting user).**

### What moved
- `window._appShareDoc` body → `export async function shareDoc({ docElementId, docName, documentRef, windowRef, loadHtml2Canvas, showToast, logger })` ใน `modules/share_doc.js` (239 บรรทัด)
- main.js เก็บ thin `window._appShareDoc(docElementId, docName)` wrapper → delegate ไป `_shareDocImpl({...})` bind live `document`/`window`/`_loadHtml2Canvas`/`showToast`
- HTML modal template + `forceA4Style` CSS + closure (`_canvas`/`_pdfBlob`/`_pdfUrl`) + jsPDF multi-page math + 8 share handlers (line/fb/email/native/pdf/save/copy/print) ย้ายมาทั้งก้อน byte-identical

### Why DI (injected refs)
- main.js เป็น ES module ที่รันใน browser เท่านั้น; แยก module ออกมาแล้ว inject `documentRef`/`windowRef` → unit-testable ใน Node + กัน global-leak (Lesson 89.35: bareword `document.` ใน module = ReferenceError ใน prod แต่ unit test ไม่ catch). Global-leak guard (grep) PASS — ทุก DOM/window/navigator/console + html2canvas loader route ผ่าน param.
- `console.warn` → `logger?.warn?.()` (optional-chained, null-safe เมื่อไม่มี console)

### Caller compatibility (ห้ามแตะ — verified)
- delivery_invoices.js:649 / doc-utils.js:262 / quotations.js:1029 / receipts.js:900 — ทุกตัวเรียก `window._appShareDoc(string, string)`; wrapper signature คงเดิมเป๊ะ

### Tests (+10 → 263 total)
- Behavioral (stub doc/window): null-guard returns silently; overlay built + appended w/ 8 share-opt; Phase 92.5 fail-fallback fires on `loadHtml2Canvas()===false`; missing docEl no-throw
- Source pins: export/import/wrapper shape; modal markup gone from main.js; no bareword `document.`/`navigator.`; 92.5 fallback string present
- ⚠️ Phase 92.5 source pin ใน `tests/lazy_libs_load_html2canvas.test.js` ย้าย target จาก mainSrc → shareSrc (code ย้าย module — ไม่ใช่ behavior change)
- **ไม่ unit test** native share / clipboard.write / window.open handlers (mock ROI ต่ำ) → ครอบด้วย source pin + manual smoke

### Net
- main.js: 4690 → 4467 บรรทัด (−223)
- Build: 262 → 263; version 5.44.9 → 5.45.0 (minor — โครงสร้างเพิ่ม module)
- main.js decomposition state: branding.js + lazy_libs.js + share_doc.js เป็นเจ้าของสิ่งที่เคย inline; เหลือ boot IIFE + sidebar/nav + state ใน main.js

### ⚠️ Manual smoke REQUIRED post-deploy (share handlers ไม่มี unit test)
หลัง build 263 live → Ctrl+Shift+R เช็ค 5.45.0; เปิด Quotation/Receipt/Delivery Invoice → แชร์ → modal + thumbnail + "✓ PDF A4 พร้อมแชร์"; ทดสอบ บันทึก PDF / บันทึกรูป / คัดลอกรูป / พิมพ์ / LINE-Messenger-Email / native share (มือถือ) / offline fallback; PDF layout = A4 ตรง logo+ตาราง+ยอดรวม+ลายเซ็นครบ

### Recommend Phase 92.8+
- boot IIFE → modules/boot.js (เล็กแต่ stateful)
- doc-print.css / forceA4Style consolidation (CSS A4 ซ้ำซ้อน?)
- sw.js:147 anomaly (?_t= ERR_CACHE_MISS) — สืบ + fix

---

## 🛡️ Phase 92.6 — Share/PDF + logo-sync hardening

Defensive hardening from a post-92.5 code review — 3 small fixes in 2 modules, TDD (red→green) each. **No push (awaiting user).**

### Fixes
- **Issue 1** (`modules/lazy_libs.js`) — `loadHtml2Canvas` now dedupes concurrent callers (double-clicked Share) via a module-level `_pendingH2c` in-flight promise → one `<script>` injection. Cleared on settle (success → next call short-circuits on `window.html2canvas`; failure → retries).
  - ⚠️ Deviated from the prompt's "don't reset on success": keeping the promise leaked module state across unit tests (broke `onerror`/`custom scriptUrl`). Confirmed by running it, then **user approved clear-on-success** (production-equivalent — see [[feedback_cdn_url_vs_csp]] sibling). +2 tests.
- **Issue 2** (`modules/branding.js`) — `syncAppLogo` early-exits when `bsk_store_logo_url === publicUrl`. Was repainting + re-`setItem` every boot for http-URL logos because the old condition keyed off `!startsWith("data:")`. +1 test.
- **Issue 3** (`modules/branding.js`) — `syncAppLogo` strips CR/LF from `accessToken` before the Authorization header (defense-in-depth; Supabase JWTs are safe but cost is 1 line). +1 test.

### Build
- 261 → 262; version 5.44.8 → **5.44.9** (patch — hardening)
- `npm run verify`: lint 0 errors (2 pre-existing warnings) + **253 unit** (249 → 253, +4) + 11 e2e
- Commits: 3 test (red) + 3 fix + 1 build + 1 docs = 8, on branch `claude/phase-92-6-share-sync-hardening`

### Pending
- **NOT pushed** — awaiting user review/approval before merge to main + deploy. Manual smoke checklist in [`CHANGELOG.md`](CHANGELOG.md) 5.44.9 section.

---

## 📦 สรุปรวบยอด build 256 → 261 (Phase 91.4 → 92.5)

> Roll-up เปิดดูทีเดียวจบ — รายละเอียดเต็มของแต่ละ build อยู่ในส่วนถัดลงไป + [`CHANGELOG.md`](CHANGELOG.md)

| Build | Version | Phase | สรุป | ประเภท |
|------:|---------|-------|------|--------|
| 256 | 5.44.3 | 91.4 | Loyalty audit CLOSED — refund/cancel reverse-loyalty wiring (baseline ก่อนเริ่ม decomposition) | hotfix/feat |
| 257 | 5.44.4 | 92.1 | extract `updateAppLogos()` (DOM painter) → `modules/branding.js` | refactor |
| 258 | 5.44.5 | 92.2 | extract `getAppLogo()` (logo resolver: storeInfo>localStorage>default) → `modules/branding.js` | refactor |
| 259 | 5.44.6 | 92.3 | extract + **harden** `syncAppLogo()` (Supabase Storage pull) → `modules/branding.js` — เพิ่ม AbortController timeout + logged failure | refactor+harden |
| 260 | 5.44.7 | 92.4 | extract `loadHtml2Canvas()` lazy loader → **new** `modules/lazy_libs.js` | refactor |
| 261 | 5.44.8 | 92.5 | **HOTFIX** — html2canvas CDN `cdnjs.cloudflare.com` ถูก CSP บล็อก → Share/PDF ค้าง. เปลี่ยนเป็น `cdn.jsdelivr.net` + กัน modal ค้าง | hotfix |

### ภาพรวม (build 257 → 261 = "Phase 92 main.js decomposition")
- **เป้าหมาย:** แยก `main.js` (4,600+ บรรทัด) ออกเป็น module ทีละชิ้นแบบปลอดภัย — refactor-only, revert ง่าย, ทดสอบทุกชิ้น
- **ผลลัพธ์:** logo logic + html2canvas loader ที่เคย inline ใน `main.js` ย้ายออกหมดแล้ว
  - `modules/branding.js` — `updateAppLogos` (paint) + `getAppLogo` (resolve) + `syncAppLogo` (Supabase pull)
  - `modules/lazy_libs.js` (ใหม่) — `loadHtml2Canvas` + `HTML2CANVAS_CDN_URL`
  - `main.js` เหลือเพียง thin wrapper (`window._appGetLogo` / `window._appSyncLogo` / `_loadHtml2Canvas`) ที่ bind live globals → call sites ทุกที่ทำงานเหมือนเดิม
- **Pattern ที่ใช้ทุก build:** extract → inject globals (state/config/storage/fetch/document) ให้ pure+testable → keep wrapper เดิมไว้ → test 2 layer (behavioral stub + source-level guard) → bump 4 touchpoints (index.html ?v=/data-app-build, sw.js CACHE_NAME, pages.js version) → verify (lint+unit+e2e) → push main → poll live build → manual smoke
- **Test เพิ่มสุทธิ:** 204 → 249 unit (+45 ใน 5 builds), e2e คงที่ 11
- **บทเรียน 2 ข้อ (บันทึก memory แล้ว):**
  1. [[feedback_smoke_log_wrong_function]] — console error ตอน smoke (92.2/92.3) มาจาก `saveStoreInfo` คนละ path กับ `_appSyncLogo` ที่กำลังแก้ — grep หา source จริงก่อน
  2. [[feedback_cdn_url_vs_csp]] — byte-identical extract เก็บ latent bug ไว้ (cdnjs URL ไม่ตรง CSP มาตั้งแต่ก่อน refactor); external-resource path ต้อง smoke จริง + เทียบ `_headers`

### สถานะ ณ build 261 — ✅ Phase 92 arc (256→261) ปิดครบ
- Production live build **261**, version **5.44.8**, `npm run verify` ผ่านครบ (lint 0 errors / 2 pre-existing warnings, 249 unit, 11 e2e)
- Manual smoke Share/PDF: **✅ user ยืนยันผ่านแล้ว** (20 พ.ค. 2026) — html2canvas โหลดจาก jsdelivr, สร้าง/แชร์ไฟล์ได้, ไม่ค้าง
- งานที่ทำบน branch `claude/phase-89-45-final-warnings` แต่ push ตรง `origin/main` ทุก build (Cloudflare deploy จาก main)

### Phase 92 ถัดไป (ยังไม่เริ่ม)
- 92.6+ — `_appShareDoc` (Share/PDF overlay ~130 บรรทัด), boot IIFE → `modules/boot.js`, sidebar/nav, auth/profile boot

---

## 🚑 Phase 92.5 — HOTFIX: html2canvas blocked by CSP, Share/PDF stuck (this session)

### Symptom
Open a document → Share/LINE/PDF → modal stuck on "กำลังสร้าง PDF..." forever, no file. Console: html2canvas script from `cdnjs.cloudflare.com` violates CSP `script-src-elem`.

### Root cause
`HTML2CANVAS_CDN_URL` pointed at `cdnjs.cloudflare.com`, which the production CSP (`_headers`) does NOT allow (only jsdelivr / unpkg / sheetjs / esm.sh). This URL was the **original pre-92.4 value** — the extract was byte-identical, so it preserved a latent bug that surfaced during 92.4 smoke. Compounded by `_appShareDoc` ignoring the loader's boolean: when html2canvas didn't load, the PDF-build `if` was skipped with no else → infinite "กำลังสร้าง PDF...".

### Fix
- `modules/lazy_libs.js` — `HTML2CANVAS_CDN_URL` → `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js`
- `main.js` `_appShareDoc` — capture `_h2cReady = await _loadHtml2Canvas()`; on failure show red thumbnail message + `showToast("โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่")`, wire close + click-outside, and `return` (no stuck modal). Success path unchanged.
- Tests (+3): URL pinned to jsdelivr, host must be CSP-allowed (never cdnjs), **cross-check against `_headers` CSP**, and source-level pin that `_appShareDoc` handles a failed load.

### Build
- 260 → 261; version 5.44.7 → **5.44.8** (patch — hotfix)
- `npm run verify`: lint + **249 unit** (246 → 249) + 11 e2e

### Lesson
A byte-identical extract still carries the original's latent bugs. When smoke-testing an external-resource path (CDN/script inject), verify the URL host against the CSP `_headers` allowlist — not just the function contract.

---

## 🧱 Phase 92.4 — extract html2canvas lazy loader

Continues the `main.js` decomposition. Behavior-preserving extraction (one tiny diagnostic log added).

### Change
- New `modules/lazy_libs.js` — home for lazy third-party script loaders. Exports `loadHtml2Canvas({ windowRef, documentRef, scriptUrl, logger })` + `HTML2CANVAS_CDN_URL` constant.
- Contract identical to the inline original: resolves `true` if `window.html2canvas` already present (idempotent, no duplicate inject); else appends `<script>`, resolves `true` on load / `false` on error; never rejects.
- Only addition: a `logger.warn` on the error path (was silent) — doesn't change the resolve contract or control flow.
- `main.js` — `_loadHtml2Canvas()` is now a 1-line wrapper calling `_loadHtml2CanvasImpl({ windowRef: window, documentRef: document })`. Sole caller (`window._appShareDoc`) unchanged. `_loadHtml2Canvas` was main.js-private (not on window), single call site.
- `tests/lazy_libs_load_html2canvas.test.js` — 10 tests (6 behavioral, 4 source-level), no browser.

### Build
- 259 → 260; version 5.44.6 → **5.44.7** (patch — refactor)
- `npm run verify`: lint + **246 unit** (236 → 246, +10) + 11 e2e

### main.js decomposition progress
`modules/branding.js` (logo: updateAppLogos/getAppLogo/syncAppLogo) + `modules/lazy_libs.js` (loadHtml2Canvas) now own what used to be inline. Remaining big chunks in main.js: the Share/PDF overlay (`_appShareDoc`), boot IIFE, sidebar/nav, auth/profile boot.

---

## 🧱 Phase 92.3 — extract + harden logo Supabase sync

Continues Phase 92.1/92.2. **Behavior-preserving extraction + a small intentional hardening** (network timeout).

### Change
- `modules/branding.js` gains `syncAppLogo({ config, accessToken, storageRef, fetchImpl, timeoutMs, onUpdated, logger })` — pulls the logo from the Supabase Storage `store-assets` bucket (raw REST list), builds the cache-busted public URL, and caches it to localStorage only when stale (no overwrite of a matching user data: URI). All I/O injected → pure & testable.
- **Hardening** (the inline original had neither): the list `fetch` now runs under an `AbortController` timeout (default 8s) so a stalled network can't hang it, and failures are logged via the injected `logger.warn` instead of being silently swallowed. localStorage cache still serves the logo on failure → UI never breaks.
- `main.js` — `window._appSyncLogo` is now a wrapper calling `_syncAppLogoImpl({ config: window.SUPABASE_CONFIG, accessToken: window._sbAccessToken, onUpdated: () => updateAppLogos() })`. Boot caller unchanged.
- `tests/branding_sync_app_logo.test.js` — 14 tests (9 behavioral, 2 hardening, 3 source-level), no network/window.

### Smoke-log clarification
The console line `Supabase save failed (using localStorage): supabase timeout` seen during 92.2 smoke is from **`saveStoreInfo()`** (a *save* path that already has a 3s `Promise.race` timeout) — working as designed. It is NOT `_appSyncLogo`. 92.3 hardens the separate *pull* path, which previously had no timeout at all.

### Logo decomposition — COMPLETE
All three logo concerns now live in `modules/branding.js`: `updateAppLogos` (92.1, DOM paint), `getAppLogo` (92.2, resolver), `syncAppLogo` (92.3, Supabase pull). `main.js` keeps only thin wrappers binding live globals.

### Build
- 258 → 259; version 5.44.5 → **5.44.6** (patch — refactor + harden)
- `npm run verify`: lint + **236 unit** (222 → 236, +14) + 11 e2e

---

## 🧱 Phase 92.2 — extract logo source resolver

Pure refactor — **zero behavior change**. Second extraction from `main.js`, continues Phase 92.1.

### Change
- `modules/branding.js` gains a second export `getAppLogo({ stateRef, storageRef, defaultLogo })` — the priority chain `state.storeInfo?.logoUrl || localStorage["bsk_store_logo"] || "./icons/logo.svg"`, byte-identical to the old inline `_appGetLogo`. `state` + storage are injected → pure & testable.
- `main.js`:
  - Imports `getAppLogo as _getAppLogoImpl` alongside `updateAppLogos`
  - `window._appGetLogo` is now a 1-line wrapper `return _getAppLogoImpl({ stateRef: state })` that binds the live `state`
  - All `window._appGetLogo()` callers (pos, dashboard, payroll, receipts, quotations, delivery_invoices) unchanged
- `tests/branding_update_app_logos.test.js` — +8 (10 → 18): 5 behavioral (priority order, fall-through, custom default, null storage), 3 source-level (export present, no inline chain in main.js, wrapper preserved)

### Intentionally NOT extracted (flagged for 92.3)
- `window._appSyncLogo` — async, fetches from Supabase Storage using `SUPABASE_CONFIG` + `_sbAccessToken`. Needs config + token injected

### Build
- 257 → 258; version 5.44.4 → **5.44.5** (patch — refactor)
- `npm run verify`: lint + **222 unit** (214 → 222, +8) + 11 e2e

---

## 🧱 Phase 92.1 — main.js decomposition first cut

Pure refactor — **zero behavior change**. First extraction from the 4,600+ line `main.js` boot file.

### Change
- New `modules/branding.js` exports `updateAppLogos({ documentRef, getLogo })` — paints store logo into sidebar / auth / profile / spinner / favicon slots. Pure DOM, injectable seam.
- `main.js`:
  - Imports the extracted helper at the top with other module imports
  - Replaces the 16-line inline body (was L4658-4673) with a 3-line wrapper that calls `_updateAppLogosImpl({ documentRef: document, getLogo: () => window._appGetLogo?.() })`
  - Wrapper keeps the SAME closure identity → `window.updateAppLogos`, `window.App.updateAppLogos`, and the 4 internal call sites at L421/L975/L4687 all work unchanged
- `tests/branding_update_app_logos.test.js` — 10 assertions:
  - Behavioral with a hand-rolled minimal Document stub: paints every slot, http URL skips favicon, data: URI overrides favicon, no-op on null doc / empty logo, all `.auth-logo-img` nodes painted (not just first)
  - Source-level: main.js imports from `./modules/branding.js`, branding.js exports the helper, main.js no longer inlines any branding selector (`.sidebar-logo-img`, `.auth-logo-img`, etc.), wrapper function preserved

### Intentionally NOT extracted in 92.1
Couple to globals — flagged for 92.2 / 92.3:
- `window._appGetLogo` — reads `state.storeInfo.logoUrl` + `localStorage`. Needs `state` injected
- `window._appSyncLogo` — async, fetches from Supabase Storage using `SUPABASE_CONFIG` + `_sbAccessToken`. Needs config + token injected

### Out-of-scope finds (flagged, not touched per Phase 92.1 scope guard)
- `loadAppSettings` (L965+) calls `updateAppLogos()` via `typeof` check — could simplify to direct call now, but that's behavior-adjacent. Phase 92.x candidate
- `boot` IIFE (L4678+) at the very bottom — natural candidate for `modules/boot.js` once dependencies decouple

### Build
- 256 → 257; version 5.44.3 → **5.44.4** (patch — refactor)
- `npm run verify`: lint + **214 unit** (204 → 214, +10) + 11 e2e all green

---

## 🏁 Loyalty audit & feature work — CLOSED

> **Canonical prod URL:** [boonsook-pos-v5.pages.dev](https://boonsook-pos-v5.pages.dev) (per [[reference-canonical-prod-url]]) — www.boonsook.com is a parked placeholder, do not use it for build verification.
>
> **Status snapshot (19 พ.ค. 2026):** build **256** live, version **5.44.3**, `npm run verify` clean (lint + 204 unit + 11 e2e), production manual smoke passed.

### Loyalty flow — verified end-to-end on production
| Capability | Status | Closed in |
|------------|--------|-----------|
| Settings save (admin) | ✅ works | 90.4 + 90.6 |
| Settings save runtime requireAdmin guard (defense-in-depth) | ✅ added | 90.12 |
| Manual earn (admin form) | ✅ works | 90.8 + 90.9 |
| Manual redeem (admin form) | ✅ works | 90.8 + 90.9 |
| Customer lookup with bigint vs `<select>.value` string | ✅ fixed via `String()` both sides | 90.10 |
| History modal click-outside listener leak | ✅ bound once, not per open | 90.13 |
| Service-worker periodic + visibilitychange update polling | ✅ added (no auto-reload) | 90.11 |
| **POS auto-earn on sale checkout** | ✅ works (500 + rate 100 → +5; no customer → no points) | 91.1 |
| **Earn formula** | ✅ `floor(amount / bahtPerPoint)`; the 50,000-point bug from inverted multiplication is fixed and locked by unit tests | 91.2 |
| **Refund + sale-delete/cancel reverse loyalty** | ✅ insert `type='redeem' + ref_type='sale_reverse' + ref_id=saleId`; idempotent (`hasReversedLoyaltyForSale`); caps at remaining; helper failure never blocks main flow | 91.3 + 91.4 |
| Smoke verified | ✅ sale #143 earn 5 + sale_reverse 5; sale #144 earn 5 + sale_reverse 5; summary stays consistent | — |

### Audit closure summary
**Closed in Phase 90.x → 91.4:**
- A1 settings save runtime admin guard (90.12)
- B1 history modal click-outside listener leak (90.13)
- POS checkout auto-earn loyalty (91.1)
- Earn formula direction bug — `floor(amount / bahtPerPoint)` (91.2)
- Sale delete / cancel reverse loyalty (91.3 wiring + 91.4 hotfix)
- SW update polling for long sessions (90.11)

**Deferred (intentionally, not blocking):**
- **Manual tab role gate** — product decision (sales granting/redeeming points = store value). Awaiting user direction on whether non-admin should be able to use the manual tab at all
- **`main.js` decomposition** — 6,000+ LOC monolith. Roll to **Phase 92** (no behavior change, structure-only)
- **DB hardening: unique constraint for sale earn/reverse idempotency** — currently idempotent via client-side check (`hasReversedLoyaltyForSale` scans `state.loyaltyPoints`). A DB-level UNIQUE on `(customer_id, ref_type, ref_id)` for `ref_type IN ('sale','sale_reverse')` would be a defense-in-depth. Roll to **Phase 93** (RLS + constraints hardening for `loyalty_points`)
- **Refund partial-quantity reverse** — current implementation reverses the FULL earn on refund regardless of how many items the user chose to refund. If business needs partial refunds → partial point claw-back, roll to **Phase 94**

### Suggested next phases
| Phase | Focus | Risk | Notes |
|-------|-------|------|-------|
| **92** | `main.js` decomposition (structure-only) | Low (behavior unchanged) | Pull lazy-router, XHR helpers, role helpers, state setup into separate files. Tests guard the surface |
| **93** | DB constraints + RLS hardening for `loyalty_points` | Medium (touches SQL + RLS) | UNIQUE `(customer_id, ref_type, ref_id)` for `ref_type IN ('sale','sale_reverse','redemption')`; review RLS rules for non-admin insert |
| **94** | Refund partial-quantity loyalty reverse | Medium (business policy) | Only if business needs partial refunds → partial point claw-back. Helper would compute `reverseAmount = round(earned * refundedQty/totalQty)` |

---

## 🔥 Phase 91.4 HOTFIX — Reverse-loyalty wiring gate (detail)

Build 255 (Phase 91.3) shipped a working helper but ineffective wiring. Real prod data hit a guard that silently no-op'd the reverse.

**Symptom:** sale #143 → POS auto-earn worked (jeerasuk +5). User deletes sale → `[auto_post] voided 1 JV(s) for sales#143` logged but loyalty summary unchanged.

**Root cause:** both `modules/refunds.js` (L419) and `modules/sales.js` (L244) pre-gated the helper on the SALE-row's `customer_id`:
```js
if (targetSale?.customer_id) {   // ← blocked when column null/missing
  await mod.reverseEarnedPointsForSale(...);
}
```
`sales.customer_id` is an opt-in column (pos.js comment line 1119: "ถ้ามี customer_id field ในตาราง — ใส่ด้วย"). When absent or null, the gate skipped silently — no log, no toast, no record. But the helper itself is designed to fall back to `earn_record.customer_id` (loyalty_points always has it since Phase 91.1).

**Fix:**
- Remove the customer_id pre-check from both wiring sites; pass `customerId: ... || null` and let the helper decide
- Add diagnostic `console.log("[sales delete] loyalty reverse attempt:", { saleId, saleCustomerId, earnCount })` to sales.js so the next smoke can self-diagnose without source dive
- 4 new tests in `tests/loyalty_reverse_sale.test.js`:
  - Helper resolves customer_id from earn record when `customerId: null` (real call shape from post-91.4 wiring)
  - Same with `customerId` key omitted
  - Source-level: `refunds.js` must not gate on `_selectedSale?.customer_id`
  - Source-level: `sales.js` must not gate on `targetSale?.customer_id` (strips comments first — earlier false positive caught my own explainer)

`npm run verify` clean: lint + **204 unit** (200 → 204, +4) + 11 e2e

### Lesson recorded
**Wiring guards must not be stricter than the helper's own contract.** The helper said "customer_id optional, I'll resolve from earn record." The wiring said "no customer_id, refuse." Result: helper logic intended to handle the edge case was unreachable. Rule: at the call site, gate only on the inputs the helper *requires* (here: saleId), and let the helper decide on the optional ones.

---

## ↩️ Phase 91.3 — Refund/cancel reverse loyalty earn (previous push)

Phase 91.1 wired auto-earn but didn't claw back when a sale was refunded or soft-deleted → over-credit risk. Phase 91.3 closes that gap with an idempotent helper called from both reverse paths.

### Helper (`modules/loyalty.js`)
- `getSaleEarnedPoints(state, saleId, customerId?)` — sum earn for a sale
- `hasReversedLoyaltyForSale(state, saleId, customerId?)` — idempotency probe
- `reverseEarnedPointsForSale(saleId, { state, customerId?, refundId? })` — main entry. Returns `{ ok, skipped?, reason?, reversed?, totalEarned?, capped? }`. Never throws.

Record shape (stays within existing schema — no `type` enum change, no migration):
```
type     = 'redeem'
ref_type = 'sale_reverse'
ref_id   = <saleId>
```
`getCustomerPoints` already subtracts every `type='redeem'` row → balance updates automatically. `ref_type` distinguishes auto-reverse from manual redemption in history.

### Wiring
1. **`modules/refunds.js`** — fire-and-forget call right after `postJournalForRefund` (line ~412). Skip silently when sale has no `customer_id`. Toast `คืนแต้ม N แต้ม` on success, `(จาก N)` suffix when capped.
2. **`modules/sales.js`** soft-delete — runs as side-effect (c) alongside void JV + revert stock (line ~237). Adds `คืนแต้ม N/T` to the existing summary toast. Errors logged but never fail the delete.

### Guarantees
- **Idempotent:** second refund of the same sale (or refund + soft-delete) skips on `reason: 'already reversed'` — never claws back twice
- **Never negative:** caps reverse at `customer.remaining`. If customer already spent points elsewhere, only the available balance is clawed back; the cap is recorded in `note` (`คืน 2/5 (3 แต้มถูก redeem ไปแล้ว)`)
- **Silent skips** for: no `customer_id` on sale, no earn record for the sale, remaining=0
- **Main flow safe:** helper failures (RLS, network, missing XHR) log but never throw — refund/cancel itself completes

### Tests (`tests/loyalty_reverse_sale.test.js` — 18 unit tests with mocked `window._appXhrPost`)
- Happy path: earn 5 → reverse 5, record shape verified end-to-end
- Idempotency: existing reverse row → skip, 0 POSTs
- Skips: no earn, no customer_id, remaining=0
- Cap: earn 5 + manual redeem 3 → reverse 2, `capped=true`, note shows `2/5`
- Failure modes: missing XHR / RLS / network error → returns `{ ok:false, skipped:false }` without throwing
- `getSaleEarnedPoints` / `hasReversedLoyaltyForSale` defensive coverage (Phase 90.10 bigint vs string)

`npm run verify` clean: lint + **200 unit** (182 → 200, +18) + 11 e2e

### Audit closures (Phase 90.x + 91.x)
| Item | Status | Phase |
|------|--------|-------|
| A1 settings save runtime guard | ✅ | 90.12 |
| B1 history modal listener leak | ✅ | 90.13 |
| Refund/cancel loyalty reverse | ✅ | **91.3** |
| Manual tab role gate | ⏳ deferred — product decision | — |

---

## 🔥 Phase 91.2 HOTFIX — Earn formula

Production build 253 ส่ง point ผิด x10,000 — user สมาชิก `jeerasuk` กระโดดจาก 600 → 50,600 หลัง sale 500 บาท

**Root cause:** column DB ชื่อ `points_per_baht` แต่ UI label คือ "ทุกกี่บาทได้ 1 แต้ม" = ค่าเป็น **BAHT-per-point** (ตัวหาร) — แต่ `loyalty.js:79` คูณ (`floor(amount * rate)`) แทนหาร. ชื่อ var `pointsPerBaht` หลอกตามชื่อ column → คูณ 500 × 100 = 50,000

**Fix:** centralize formula ใน exported helper:
```js
export function calcEarnPoints(amount, settings) {
  const bahtPerPoint = Number(settings?.points_per_baht || 0);
  const spendAmount = Number(amount || 0);
  if (!settings?.is_active || bahtPerPoint <= 0 || spendAmount <= 0) return 0;
  return Math.floor(spendAmount / bahtPerPoint);
}
```
`earnPoints()` เรียก helper นี้แทน inline math — manual + auto-earn paths drift จากกันไม่ได้อีก

**Cleanup:** user อาจอยากลบ row เกินใน loyalty_points table:
```sql
-- ดู records ที่ผิดก่อนลบ (build 253 era, 19 พ.ค.)
SELECT * FROM loyalty_points
WHERE type='earn' AND points > 1000 AND created_at >= '2026-05-19';
-- ถ้าตรงตามที่คาด:
DELETE FROM loyalty_points
WHERE type='earn' AND points > 1000 AND created_at >= '2026-05-19';
```
แล้ว NOTIFY pgrst, 'reload schema'; ไม่จำเป็น (ไม่ใช่ ALTER TABLE)

**Tests (14 unit, `tests/loyalty_calc_earn_points.test.js`):**
- The bug: 500 + rate 100 = 5 (NEVER 50000) — explicit anti-regression
- Boundary: 99 → 0, 100 → 1, 1000 → 10
- Floor semantics: 549.99 → 5
- Null/undefined/empty settings → 0
- is_active false / rate 0 / negative amount → 0
- String coercion (DB returns strings sometimes)
- Rate 1 → 1:1, rate 50 → double rate
- Integration: earnPoints mock posts records.points = 5 (NEVER 50000)
- Integration: below-threshold = 0 POST calls (no DB write)

Real behavior tests (not source-level grep) — formula cannot silently drift back

---

## ⭐ Phase 91.1 — POS checkout auto-earn loyalty points [NEW FEATURE]

`earnPoints()` ใน `modules/loyalty.js` มีอยู่แต่ไม่มี caller ตั้งแต่ Phase 90.8 — feature gap ที่ flag ไว้. ตอนนี้ pos.js checkout success path เรียก earnPoints อัตโนมัติเมื่อมีลูกค้าใน `_posCustomer` + ระบบแต้มเปิด + อัตราตั้งค่าแล้ว

### Change (`modules/pos.js`)
1. **Capture site** หลัง `saleId` validate (L1135-): `const _earnCustomerId = _posCustomer?.id || null; const _earnAmount = actualTotal;` — ก่อน state-reset block ที่ null `_posCustomer`
2. **Fire-and-forget call site** หลัง `postJournalForSale` (L1218-): dynamic `import('./loyalty.js?v=' + APP_BUILD)` (Phase 90.7 cache-bust pattern) แล้วเรียก `earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx)`
3. **Guard** ที่ call site: เรียกเฉพาะเมื่อ `_earnCustomerId && state.loyaltySettings?.is_active && Number(state.loyaltySettings?.points_per_baht || 0) > 0` — silent skip ทุกกรณีที่ไม่ตรงเงื่อนไข (กัน toast "ระบบแต้มไม่เปิดใช้งาน" รั่วออกมาทุกบิล)
4. Amount basis = `actualTotal` (post-discount + VAT — ยอดที่ลูกค้าจ่ายจริง). refType = `'sale'`, refId = `saleId`
5. ctx ให้ `loadAllData: window.App?.loadAllData` — earnPoints success path จะ refresh state เพื่อให้ summary tab อัปเดตทันที (POS เองเรียก loadAllData ไปก่อนแล้ว 1 ครั้ง = duplicate refresh ยอมรับได้)

### Out of scope
- **Refund/cancel reversal** — ยังไม่ wire. ถ้า user refund / soft-delete sale หลังบ้าน → earn record ยังคา (over-credit ลูกค้า). Backlog: ใส่ `redeemPoints` call ใน refund/cancel flow ด้วย refType `'refund_reverse'` + negative points หรือ DELETE row
- **Manual tab role gate** — ยังเป็น product decision

### Tests (8 source-level assertions, `tests/pos_loyalty_auto_earn.test.js`)
1. Capture: `_earnCustomerId = _posCustomer?.id` + `_earnAmount = actualTotal`
2. Capture is AFTER `xhrPostPOS("sales", ...)`
3. Capture is BEFORE post-checkout reset (`_posCustomer = null; // เคลียร์ลูกค้าหลังจบบิล`)
4. Guard checks all 3: `_earnCustomerId` + `is_active` + `points_per_baht`
5. Call signature `.earnPoints(_earnCustomerId, _earnAmount, 'sale', saleId, ctx)`
6. Dynamic import URL has `?v=APP_BUILD` cache-bust
7. No `await` on the import chain (fire-and-forget)
8. `.catch` with `console.warn` (no silent swallow)

### Build
- 252 → 253; version 5.43.48 → **5.44.0** (minor bump — new feature)
- `npm run verify`: lint + 168 unit + 11 e2e all green

---

## 🧹 Phase 90.13 — Loyalty history modal click-outside listener leak

`showPointHistory()` ใน `modules/loyalty.js` เคย `modal?.addEventListener('click', ...)` ทุกครั้งที่เปิด modal → เปิด N ครั้ง = N stacked listeners บน element เดียว. Action เป็น idempotent (`display = 'none'`) — UX ไม่พัง — แต่เป็น DOM listener leak จริงที่โตตามการใช้งาน. ถ้า future refactor เพิ่ม logic ใน handler นี้ จะยิง N ครั้ง

### Fix
- ย้าย listener ไปผูกครั้งเดียวใน `renderLoyaltyPage` (ข้างๆ Phase 89.23 close-button binding ที่ L253-257)
- `showPointHistory` แค่ toggle `display:block` — ไม่ผูก listener อีกแล้ว
- `tests/loyalty_history_modal_listener.test.js` — 4 source-level assertions (showPointHistory ไม่ผูก listener, renderLoyaltyPage ผูกครั้งเดียว, gate ด้วย `e.target === this`, ยังคงปิด modal ด้วย `display:none`, close-button binding ยังอยู่)

### Audit ที่เหลือ
- Manual tab role gate — product decision, ยังรอ user direction

---

## 🔐 Phase 90.12 — Loyalty settings save runtime admin guard

`modules/loyalty.js` save handler now starts with `if (!requireAdmin?.()) { showToast('สิทธิ์ไม่พอ — เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }`. UI gating at render time (L230) still hides the tab content from non-admins, but a runtime check inside the handler closes the gap when:
- A role is downgraded mid-session (stale DOM still holds the wired-up button)
- DevTools / extension injects a click directly
- Future refactor accidentally drops the render-time gate

Supabase RLS is the real gate. This is defense-in-depth + a clean user-visible refusal instead of a server-side error toast.

- `renderLoyaltyPage` destructure: `requireAdmin: _requireAdmin` → `requireAdmin` (dropped unused-prefix)
- `renderSettingsTab` now receives + uses `requireAdmin` from ctx
- `tests/loyalty_settings_admin_guard.test.js` — 5 source-level assertions (destructure clean, guard called with parens, guard before write, early-return, toast on refusal)
- `npm run verify` clean
- Build 250 → 251

### Audit findings still deferred
- B1 history modal click-outside listener leak — low risk
- Manual tab role gate — product decision, awaiting user

---

## 🔄 Phase 90.11 — Update UX hardening

`boot.js` now triggers `reg.update()` on a 10-min interval and on tab `visibilitychange` → visible. Existing watch-for-update / SKIP_WAITING / controllerchange flow is unchanged — the banner UX still owns reload. No auto-reload was added. Long-lived sessions (cashier leaves app open all day) now have multiple chances to see the update banner without manual reload.

- `boot.js` — new `startPeriodicUpdate(reg)` called from SW register `.then()`
- `tests/boot_periodic_sw_update.test.js` — 6 source-level assertions (interval scheduled, visibility gated, no reload, errors swallowed, wired in)
- `npm run verify` clean: lint + 151 unit + 11 e2e
- Build 249 → 250

### Audit findings deferred (out of scope per user spec)
- A1: settings save runtime `requireAdmin?.()` guard — defense-in-depth only (UI already gates content render). Save for later phase
- B1: history modal click-outside listener leak in `showPointHistory` (L631) — fires harmlessly N times but accumulates. Low risk
- Manual tab role gate — product decision (sales granting/redeeming points = store value). User has not asked

---

## 🔥 Phase 90.4 – 90.10 — Loyalty bug onion (6 layers) **CLOSED**

> ปุ่ม "บันทึกการตั้งค่า" + "เพิ่ม/แลกแต้ม" ใน Loyalty page เงียบสนิทมานาน — fix 6 ชั้น 7 phases, build 243 → 249.

| Phase | PR | Build | Layer | Root cause |
|-------|----|-------|-------|------------|
| 90.4 | #28+#29 | 243→244 | 1: dead code | `renderSettingsTab` มี `setTimeout(...).addEventListener` **หลัง** `return html` → handler ไม่ถูก attach |
| 90.5 | #30 (chore) | (no bump) | — | E2E/lint cleanup |
| 90.6 | #31 | 244→245 | 2: signature | settings save เรียก `_appXhrPatch(restUrl, payload, callback)` — ผิดสัญญา (จริงคือ `(table, payload, eqCol, eqVal) → Promise`) |
| 90.7 | #32 | 245→246 | 3: ESM cache | `main.js _lazyImport()` ไม่ใส่ `?v=APP_BUILD` ใน `import()` → browser ESM registry serve module 244-era ต่อ ถึงแม้ network คืนไฟล์ใหม่ |
| 90.8 | (prev) | 246→247 | 4: same signature bug 3 จุดอื่น | `earnPoints` / `redeemPoints` / manual-earn handler เรียก `_appXhrPost('/api/loyalty-points', rec, cb)` — REST path ผิด + callback ถูกทิ้ง |
| 90.9 | (prev) | 247→248 | 5: silent regression จาก 90.8 | `redeemPoints` async แต่คืน `void` — manual handler clear form มั่วๆ ทั้งกรณีสำเร็จ/ล้มเหลว |
| **90.10** | (this) | **248→249** | **6: ID type mismatch** | `customers.id` คือ `bigint` (number ใน JS) แต่ `<select>.value` คืน string เสมอ — `t.customer_id === customerId` = `1 === "1"` = false → `getCustomerPoints` คืน 0 เสมอ → "แต้มไม่พอแลก" ทั้งที่ลูกค้ามีแต้ม |

### Phase 90.10 fixes (this session)
- `modules/loyalty.js:41` `getCustomerPoints` — เปรียบเทียบด้วย `String(t.customer_id) === String(customerId)`
- `modules/loyalty.js:302` summary tab `customers.find(c => c.id === customerId)` — เคยมีปัญหาเดียวกัน (Object.entries key เป็น string, c.id เป็น number) → fallback แสดง `ลูกค้า #N` แทนชื่อจริง
- `modules/loyalty.js:561-566` `showPointHistory` — 2 จุดเดียวกัน, cast `String()` ทั้งคู่
- **ไม่แตะ insert side** (line 81/128/526) — PostgREST coerce string → bigint อัตโนมัติ ตอน INSERT/PATCH; แค่ comparison side ที่ JS strict equality bite

### Lessons (เพิ่ม)
- **DOM `<select>.value` คืน string เสมอ** — แม้ `<option value="${c.id}">` ส่ง number ก็ตาม. ถ้า column DB เป็น bigint → `===` จะ false ตลอด
- **`Object.entries(obj)` คืน key เป็น string เสมอ** — แม้ original key เป็น number key (e.g. when JS coerces) ก็ผ่าน `String(...)`. Trap เดียวกัน
- **Cast ที่จุด compare ดีกว่า cast ที่ boundary** — เพราะ boundary มีหลายจุด (DOM, JSON parse, Object.entries) แต่ compare มีน้อยกว่า + อ่านเข้าใจง่ายว่าทำไม
- **PostgREST insert ใจกว้างกว่า JS compare** — `bigint` column รับ `"2"` แล้ว coerce. JS `===` ไม่. นี่คือเหตุที่ insert side ไม่ต้องแก้ — แต่ read side ต้อง

### Phase 90.9 fixes (previous session — context)
- `modules/loyalty.js` — `earnPoints` + `redeemPoints` ทุก exit path คืน `{ok, error}` (mirror xhrPost shape) — early-return paths (`!is_active`, `< minRedeem`, `< remaining`, etc.) เคยคืน `void` → callers แยกผลไม่ได้
- `modules/loyalty.js` — manual tab redeem branch ใช้ `const r = await redeemPoints(...); if (r?.ok) { clear form }` — เคย clear ไม่มีเงื่อนไข
- earn branch ใน manual tab ใช้ `r?.ok` ของ xhrPost อยู่แล้วตั้งแต่ 90.8 — pattern consistent ทั้ง 2 branch

### Lessons (เพิ่ม)
- **Async refactor ต้อง revisit ทุก caller** — Phase 90.8 ทำ `redeemPoints` เป็น `async` แล้วใส่ `await` ที่ caller. แต่ caller ยังตั้งสมมติฐานเดิม (clear form unconditional) เพราะ return value type ไม่เปลี่ยน (ยังเป็น `void`/`Promise<void>`). Lesson: เปลี่ยน sync→async แล้วถ้า caller ใช้ผลลัพธ์ในเชิง UX ต้องเปลี่ยน return signature ด้วย ไม่ใช่แค่เพิ่ม `await`
- **Form clear belongs to caller, not callee** — `redeemPoints` ไม่รู้ว่า caller จาก manual tab หรือ POS auto-redeem. คนเรียกเท่านั้นที่รู้ว่า input อยู่ใน DOM ไหน + ควร clear เมื่อไหร่. Pattern ถูก: callee คืน status, caller decide

### Phase 90.8 fixes (previous session — context)
- `modules/loyalty.js:60` `earnPoints` → `async`, ใช้ `await _appXhrPost('loyalty_points', rec)` (เคยเป็น dead code — ไม่มี caller, แต่ fix ไว้กัน feature gap ในอนาคต)
- `modules/loyalty.js:102` `redeemPoints` → `async`, แก้ signature (เรียกจาก Manual tab line 540 — LIVE bug)
- `modules/loyalty.js:501` manual-earn click listener → `async`, แก้ signature (LIVE bug)
- ทั้ง 3 จุดใช้ pattern เดียวกับ Phase 90.6 settings save: `if (r?.ok) { ... } else { showToast('...: ' + r?.error?.message) }`

### Lessons (เพิ่มเติมจาก existing "Bug Onion" memory rule)
- **Audit ทุก call site ของ helper ที่ผิด signature** — ไม่ใช่แค่จุดที่ user report. Phase 90.6 fix settings save, แต่ใน file เดียวกันมี 3 จุดอื่นใช้ pattern เดิม (สังเกตเพราะ comment Phase 90.6 ที่ line 420 บอก signature ที่ถูกต้อง → grep `_appXhr*` ใน loyalty.js เจอ mismatch)
- **Dead exports = future trap** — `earnPoints` export แล้วไม่มี caller. ถ้า future session wire POS auto-earn จะหยิบโค้ดเสียไปใช้
- **REST URL vs table name** — `_appXhrPost(table, payload, opts)` ไม่ใช่ Express fetch wrapper. arg 1 ต้องเป็นชื่อตาราง Supabase ตรงๆ. ใส่ `/api/...` = ได้ URL `/rest/v1//api/...` = 404

### Feature gap (out-of-scope but flagged)
- `earnPoints()` export แต่ไม่มี caller. POS checkout ไม่ auto-earn loyalty points. ถ้าจะเปิด feature นี้: เรียก `earnPoints(customerId, totalAfterTax, 'sale', saleId, ctx)` หลัง sale insert success ใน `modules/pos.js` checkout flow (และอย่าลืม refund path เรียก reverse-record `type:'redeem'` หรือ negative `points`).

---

## ✅ Phase 89.41-89.44 — Race-condition resolution 4/4 COMPLETE (ของเดิม)

> 🏆 **Milestone reached (19 พ.ค.):** `require-atomic-updates` rule fully resolved across all 138 sites from Phase 89.40 audit. Lint warnings 361 → **9** (-97%) cumulative since 89.31.

---

## 🏆 Sprint Plan — Phase 89.36-89.44 COMPLETE + Phase 90.x Roadmap

> **Status:** Race-condition resolution **4/4 buckets RESOLVED** (138/138 sites). Sprint window 17-19 พ.ค. closed คลีน — **0 user intervention ระหว่าง autonomous batches**.
> **Methodology proven:** audit → bucket by risk → execute per bucket (TDD for HIGH/MED, silence for FALSE/LOW)
> **Reference prompts (production-ready templates):** `CLAUDE_CODE_PROMPT_89_{32,33,34,35,35b,36-39,40_AUDIT,41,42,43,44}.md`

---

### ✅ Phase 89.36-89.44 — Completed (17-19 พ.ค. 2026)

| Phase | PR | Build | Type | Impact |
|-------|----|----|------|--------|
| 89.36-89.39 | #20 | 241→242 | Mega-batch | Smoke + CF deploy + CI + executor-return cleanup |
| **89.40** | #21 | (audit only) | Audit | 138 warnings categorize: 6 HIGH / 6 MED / 83 FALSE / 43 LOW |
| **89.41** | #23 | 242 | Logic fix + TDD | HIGH_RISK race — `_inflight_guard.js` helper + POS/customer checkout |
| **89.44** | #24 | (no bump) | Silence batch | 83 FALSE_POSITIVE silenced (G/A/E/F/C/B categories) |
| **89.42** | #25 | 243 | Logic fix + TDD | MEDIUM_RISK — receipts multi-pay + POS quickPay + OTP verify guards |
| **89.43** | #26 | (no bump) | Silence batch | 43 LOW_RISK silenced (L1-L6 categories) — **milestone close** |

**Cumulative Phase 89.31 → 89.44:**
- Lint errors: 51,227 → **0** (-100%)
- Lint warnings: 361 → **9** (-97%)
- Unit tests: 33 → **126** (+93)
- E2E smoke: 0 → **11**
- Real bugs fixed: **3** (`dec` hoist + `filtered` scope + `showToast` undeclared)
- Race conditions guarded: **12 sites** (single-flight guards) + **126 sites** documented (silence + reason)

---

### 🎯 Immediate next — Phase 90.x Roadmap (optional)

**ที่เหลือ 9 warnings = different rules (NOT race-condition):**

| Phase | Rule | Count | Files | Type | Estimated |
|-------|------|------:|-------|------|----------|
| **90.1** | `no-misleading-character-class` | 5 | products.js | Audit Thai regex — emoji/charclass patterns | 30 min |
| **90.2** | `no-control-regex` | 2 | bt_printer.js | ESC/POS control bytes — likely intentional, silence + comment | 10 min |
| **90.3** | `no-irregular-whitespace` | 1 | accounting/coa.js | Thai whitespace in comment — fix or silence | 5 min |
| **90.4** | `no-unreachable` | 1 | loyalty.js:417 | **Possibly real bug** — dead code branch, audit ก่อน | 15-30 min |

**Recommended order:** 90.4 ก่อน (potential real bug) → 90.1 (audit) → 90.2 + 90.3 (silence batch)

**Or accept as acceptable noise** — ทั้ง 9 ตัวเป็น style/syntax-level, ไม่กระทบ correctness. Decision ขึ้นกับ aesthetics vs. effort.

---

### 🔧 Tech debt — Higher risk (เก็บไว้ Phase 91+)

1. **Re-enable `no-async-promise-executor`** — refactor `modules/auth.js` `showStaffLogin` Promise pattern (PIN login flow เปราะ — ต้อง regression test ก่อน)
2. **C8 coverage report** — target ≥ 30% (ใช้ตรวจว่าเขียน test ครอบคลุมไหม)
3. **E2E login flow test** — ต้อง Supabase test project (out-of-scope ของ current sandbox)
4. **Promote `no-promise-executor-return` warn → error** — pattern เสร็จแล้ว Phase 89.36-89.39

---

### 🛡️ Long-term — CSP hardening continued (Phase 92+)

1. **M4 part 2** — drop `style-src 'unsafe-inline'` (refactor 121 inline styles → CSS classes)
   - Prerequisite: ครบ Phase 89.23+ inline handler sweep iter
2. **Inline handler sweep iter #2 + #3** — continue from Phase 89.23 iter #1 (13 handlers → addEventListener)
3. **Re-attempt drop script-src `'unsafe-inline'`** — หลัง inline handlers ล้างหมด (จาก Phase 89.15b rollback lesson)

---

### 📝 Backlog (low priority — เก็บไว้)

- **Hot-path unit tests:** เพิ่ม coverage ของ auto_post.js + pos.js checkout + receipts cancel + cash_recon (126 → 160+)
- **HANDOFF.md refactor:** archive Phase 1-80 (currently ~260KB) + CI auto-bump build
- **Audit Panasonic error codes** — `modules/error_codes.js` H33/H58/H98/H99 commented dupe keys (จาก Phase 89.31 cleanup) — ต้อง user verify service manual ก่อน

---

### 🏁 Definition of Done — Sprint 89.x **CLOSED** (Phase 89.50 target exceeded)

หลัง Phase 89.43 merged เข้า main:
- ✅ Lint warnings ≤ 50 — **achieved 9** (original target 50, exceeded by 41)
- ✅ Unit tests ≥ 120 — **achieved 126**
- ✅ Race-condition resolution 138/138 — **achieved**
- ✅ Re-enable `no-undef` rule — **achieved Phase 89.35**
- ✅ CI: lint + test + e2e ทุก PR — **achieved Phase 89.36-89.39**
- ⏳ E2E coverage: login + checkout + JV post (real flows) — **needs Supabase test project**
- ⏳ CSP: drop unsafe-inline — **Phase 92+**
- ⏳ Re-enable `no-async-promise-executor` — **Phase 91+**

**Next milestone:** Phase 90 audit ของ 9 warnings ที่เหลือ, OR jump to Phase 91/92 ถ้า user prioritize tech debt/CSP มากกว่า aesthetic cleanup.

---

## 📚 Phase 89.30-89.44 — Session Summary (16-19 พ.ค.)

สรุปสิ่งที่ทำใน 4 วัน sprint (16, 17, 18, 19 พ.ค. 2026):

| Phase | PR | Build | Impact |
|-------|----|----|--------|
| 89.30 | (previous session) | 240 | XSS hardening batch H1+H2+H3+S6+S7 |
| **89.31** | #14 | (no bump — tooling) | ESLint flat config + Playwright + 3-gate verify, errors **51,227→0** |
| **89.32** | #15 | (no bump — cleanup) | prefer-const + unused vars, warnings 361→207 |
| **89.33** | #16 | (no bump — cleanup) | no-useless-escape + eslint-disable, warnings 207→193 |
| **89.34** | #17 | (no bump — config) | no-undef sweep + 2 bugs discovered, warnings 193→164 |
| **89.35** | #18 | 240 | **Fix 2 real bugs** (dec hoist + Excel export filter) + no-undef → error |
| **89.35b** | #19 | **240→241** | Hotfix showToast undeclared + bump 240→241 (full ?v= sync) + empty commit retrigger |
| **89.36-89.39** | #20 | **241→242** | Mega-batch: smoke ?v= scan + CF deploy commit-message override + CI lint/e2e + no-promise-executor-return |
| **89.40** | #21 | (audit only) | 138 require-atomic-updates categorized — 6 HIGH / 6 MED / 83 FALSE / 43 LOW |
| **89.41** | #23 | 242 | **HIGH_RISK fix** — `_inflight_guard.js` helper + POS checkout + customer dashboard checkout (TDD, 7 helper tests) |
| **89.44** | #24 | (no bump) | **FALSE_POSITIVE silence batch** — 83 entries with G/A/E/F/C/B reason categories |
| **89.42** | #25 | **242→243** | **MEDIUM_RISK fix** — receipts multi-pay + POS quickPay (replace window._checkoutRunning) + OTP verify/request guards (TDD, 23 new tests) |
| **89.43** | #26 | (no bump) | **LOW_RISK silence batch** — 43 entries with L1-L6 reason categories. **Closes race-condition 4/4 🏆** |

**Cumulative Phase 89.30 → 89.44 (4 days):**
- Errors: 51,227 → **0** (-100%)
- Warnings: 361 → **9** (-97%) ✨
- Unit tests: 33 → **126** (+93)
- E2E smoke: 0 → **11**
- Real bugs fixed: 3 + 12 race-protection sites guarded
- Race conditions resolved: **138/138** (100%)
- Autonomous batches: **11** (89.32-89.44 ทุกตัว), 0 user intervention ระหว่าง batch
- Production builds: **240 → 243** (4 builds across 4 days)

**Documentation files (production-ready prompt templates):**
> ⚠️ *(historical snapshot 2026-05-16)* — ปัจจุบัน 2 ไฟล์ล่างนี้ **superseded** แล้ว: entrypoint จริง = `IMPLEMENT_TEAM_PROTOCOL.md` (ทั้งคู่เหลือเป็น redirect)
- `CLAUDE_SESSION_HANDOFF.md` — ~~Claude session continuity (อ่านก่อนเริ่ม)~~ → superseded
- `CLAUDE_CODE_WORKFLOW.md` — ~~autonomous loop guide~~ → superseded
- `SETUP_TOOLING.md` — ESLint + Playwright setup steps (done)
- `AUDIT_REPORT_89_40.md` — race-condition categorization (138 entries, 4 buckets)
- 10+ phase prompt templates: `CLAUDE_CODE_PROMPT_89_{32,33,34,35,35b,36-39_BATCH,40_AUDIT,41,42,43,44}.md`
- `SESSION_SUMMARY_2026-05-16.md` — daily recap

**Memory rules บันทึก (ใน CLAUDE_SESSION_HANDOFF.md):**
- `Cloudflare deploy pattern` — ไม่มีปุ่ม Retry deployment, ใช้ empty commit ASCII-only retrigger (Phase 89.35b verified)
- `Phase 89.13a regression x3` — bump ALL `?v=N` refs (selfheal + main + boot + style.css)
- `Optional chaining ?.() ≠ undeclared protection` — root identifier ต้องอยู่ใน lexical scope
- `Bug Onion` — fix แรกอาจเปิดเผย bug ชั้นที่ 2 → manual smoke test ทุกครั้งหลัง logic fix
- `Audit-driven 4-bucket workflow` (Phase 89.40-89.44 proven) — categorize once, execute per bucket: TDD for HIGH/MED, silence+reason for FALSE/LOW. Helper modules (e.g. `_inflight_guard.js`) ที่สร้างใน HIGH phase reuse ได้ใน MED phase.

---

## 🗂️ Sprint Production Plan — สรุปสถานะ (15 พ.ค. 2026)

Last session: full audit 3-agent → 4 Critical + 7 High + 8 Medium. User เลือก fix batch แรก (C1+H4 — Phase 89.24 ต่อ).

### Production state ปัจจุบัน
- **Build live:** 239 (`window.APP_BUILD === 239`)
- **Tests:** 87/87 pass
- **SQL pending (user run):** `supabase-phase89-29-jv-gaps.sql` — ก่อน deploy build 239 จะทำให้ refund JV ทำงาน
- **Migration SQL ที่รันไป:**
  - `supabase-phase89-13b-fix-invoiced-status.sql` ✅
  - `supabase-phase89-14-error-log-rate-limit.sql` ✅
- **SQL pending (user action required):**
  - `supabase-phase89-25-fix-je-rls-pos.sql` — fix RLS for POS auto-post JV
  - `supabase-phase89-26-audit-missing-jvs.sql` — read-only audit (run after 25)

### Audit batch outstanding (Phase 89.27 batch แรก เสร็จ — 9 รายการเหลือ)
| ID | Description | Severity | Status |
|----|-------------|----------|--------|
| ~~**C1**~~ | Phase 89.24 filter ค้ำเพดาน .limit(50) | Critical | ✅ Phase 89.27 |
| ~~**H4**~~ | 4 หน้า report เห็นยอดคนอื่น | High | ✅ Phase 89.27 |
| ~~**C2**~~ | credit_tracker.js:248 รับชำระเครดิตไม่ post JV | Critical | ✅ Phase 89.29 |
| ~~**C3**~~ | refunds.js:343 ไม่ post JV (Sales Returns) | Critical | ✅ Phase 89.29 |
| ~~**C4**~~ | expenses.js:522 PATCH ไม่ void+repost JV | Critical | ✅ Phase 89.29 |
| **H1 XSS** | service_jobs.js:191 slip URL attribute breakout | High | ⏳ |
| **H2 XSS** | customer_dashboard.js:291 product image_url CSS injection | High | ⏳ |
| **H3 XSS** | quotations.js:651/684 search dropdown ไม่ escHtml | High | ⏳ |
| **H5** | auto_post.js:202 doc_no UNIQUE race → JV ใบที่ 2 หาย | High | ⏳ |
| **H6** | main.js:46 _lazyImport cache rejected promise → sticky fail | High | ⏳ |
| **H7** | customer_dashboard.js:692 ลูกค้ายืนยันปิดงาน ไม่ post JV | High | ⏳ |

### Phase 89.27 + 89.28 sprint progress (เสร็จ session นี้)
| Issue | Phase | Status | File |
|-------|-------|--------|------|
| **C1** Phase 89.24 filter ค้ำเพดาน .limit(50) | 89.27 | ✅ live | main.js:1450 + utils.js |
| **H4** 4 หน้า report ไม่ filter ตาม 89.24 | 89.27 | ✅ live | dashboard.js + profit_report.js + top_customers.js + sales_heatmap.js |
| **Daily LINE summary leak** | 89.27 | ✅ admin-only gate | dashboard.js:1101 |
| **8 unit tests** sales filter | 89.27 | ✅ 79/79 pass | tests/sales_filter.test.js |
| **M4** Dashboard TZ bug — slice(0,10) UTC vs todayKey BKK | 89.28 | ✅ live | dashboard.js (12 จุด) |
| **8 unit tests** TZ today filter regression | 89.28 | ✅ 87/87 pass | tests/tz_today_filter.test.js |
| **C2** Credit payment ไม่ post JV → A/R ค้าง | 89.29 | ✅ live | credit_tracker.js + auto_post.js |
| **C3** Refund ไม่ post JV → P&L รายได้เกิน | 89.29 | ✅ live | refunds.js + auto_post.js |
| **C4** Edit expense ไม่ void+repost JV → P&L stale | 89.29 | ✅ live | expenses.js |
| **M1** credit_payments step 1 ไม่ check r.ok | 89.29 (bundle) | ✅ live | credit_tracker.js |
| **SQL migration** seed 4110 + refund mappings | 89.29 | ⏳ user run | supabase-phase89-29-jv-gaps.sql |

### Sprint progress
| Issue | Phase | Status | File |
|-------|-------|--------|------|
| **C1** receipts.js `.catch` dead | 89.13 | ✅ verified | receipts.js |
| **C2** sw.js CACHE_NAME stuck v206 | 89.13 | ✅ verified | sw.js |
| **C3** error_reporter dedup race | 89.13 | ✅ | error_reporter.js |
| **H1** JWT refresh single-flight | 89.13 | ✅ | main.js |
| **H3** beforeSend throw loop | 89.13 | ✅ (covered by C3) | error_reporter.js |
| **?v=** main.js cache buster stuck 218 | 89.13a hotfix | ✅ verified | index.html |
| **enum typo** "invoiced" not in delivery_invoices.status | 89.13b hotfix | ✅ verified | receipts.js + SQL migration |
| **M6** Auth-gate Gemini/SlipOK APIs | 89.14 | ✅ live | functions/_middleware.js |
| **L4** Redact URL PII in error_log | 89.14 | ✅ live | error_reporter.js |
| **M7** error_log spam protection | 89.14 | ✅ live + SQL ran | functions/api/log-error.js + SQL |
| **M4 part 1** drop script-src unsafe-inline | 89.15 → rollback 89.15b | ⚠️ **PARTIAL** — selfheal/boot externalized but unsafe-inline restored | _headers + selfheal.js + boot.js |
| **APP_BUILD global** (bonus bug from M4 work) | 89.15 + 89.15a hotfix | ✅ verified | selfheal.js (sync setter + querySelector fallback) |
| **CSP regression** + **UI refresh after status change** | 89.15b hotfix | ✅ verified | _headers (rollback) + receipts.js (await loadAllData) |
| **M1** voidJvForSource silent fail (double-revenue) | 89.16 | ✅ verified | auto_post.js (pre-check + toast) |
| **M2** products.stock CAS divergence | 89.17 | ✅ live (just deployed) | main.js:3200 |
| **M3** cash_recon.js TZ filter | 89.17 | ✅ live | cash_recon.js:42,51 |
| **L2** stock_cas null === 0 retry forever | 89.17 | ✅ live | stock_cas.js:52 |

### ⏳ Backlog ที่เหลือ
| ID | Description | Severity | Estimate |
|----|-------------|----------|----------|
| **Phase 1.5** | Inventory + refactor inline `on*=` HTML event handlers in modules → addEventListener (pre-req to re-attempt M4 unsafe-inline drop) | Medium effort | ~1-2 days |
| **M5** | `products.js:100` inline `onerror` XSS surface (escape pattern เปราะ) | Low–Med | ~30 min |
| **Phase 4** | Unit tests for auto_post.js + pos.js checkout + receipts cancel + cash_recon | Medium | ~3-5 days |
| **Phase 5** | Refactor HANDOFF.md (261KB → archive Phase 1-80) + CI auto-bump build | Low | ~1 day |
| **M4 part 2** | Drop `style-src 'unsafe-inline'` (refactor 121 inline styles) | High effort | ~4-6 hours |

### Memory rules อัพเดทใหม่ในรอบนี้ (สำหรับ session ใหม่)
- `feedback_version_display_sync.md` — **4 sub-items** ที่ต้อง bump ทุก build (เดิมบอก 3, เพิ่ม `main.js?v=`)
- `feedback_cross_check_schema.md` (ขยาย):
  - **Verify enum VALUE** ก่อน PATCH (grep STATUS_LABELS) — ไม่ trust comment
  - **Inventory ALL patterns ก่อน drop CSP keyword** — inline script + inline event handlers + javascript: URLs + inline styles
- `feedback_autonomous_edits.md` (ขยาย) — **Anti-rapid-fire push:** ห้าม push commit ที่ 2 ติดกันถ้า commit ที่ 1 ยังไม่ verify (ยกเว้น hotfix regression)

### บันทึกบทเรียนจาก session นี้ (ผมพลาดเอง)
1. Phase 89.13 audit — เจอ pattern bug (.catch dead) แต่ไม่ verify enum value → propagate "invoiced" typo (Phase 89.6 ของเดิม) → ต้อง 89.13b hotfix
2. Phase 89.13a — ลืม bump `main.js?v=` แม้ memory rule บอกชัด — ผม "อ่านผ่าน" → user แจ้ง regression
3. Phase 89.15 — drop CSP `unsafe-inline` โดยไม่ inventory inline event handlers → 16 CSP violations + ปุ่มพัง → 89.15b emergency rollback
4. Pattern: **rapid-fire push 5 builds ใน 1 ชม** → user เหนื่อย verify → memory rule "anti-rapid-fire" + WIP commit pattern

---

## 🚑 Phase 89.13 — Critical regression fix batch (build 222) — 12 พ.ค.

### Context
หลัง full audit (3-agent parallel review) เจอ **2 Critical + 3 High + 5 Med/Low** บัค โดยเฉพาะ 2 regression เก่า + 1 race condition ของ Phase 89.12 ที่เพิ่งคลอด → batch fix ทันที

### Findings & fixes

| ID | Severity | จุด | Root cause | Fix |
|----|----------|-----|------------|-----|
| C1 | Critical | [receipts.js](modules/receipts.js) 3 จุด | `_appXhrPatch.catch(...)` dead code — xhrPatch return resolved `{ok,error}` ไม่เคย reject → restore invoice fail เงียบ (Phase 89.6 regression) | `await` + check `res.ok` + showToast warn |
| C2 | Critical | [sw.js:3](sw.js:3) | CACHE_NAME ค้างที่ `v206` (จริง 222 = ห่าง 15 builds) → user offline เสิร์ฟ build เก่า | bump เป็น `v222` |
| C3 | Critical | [error_reporter.js:62-98](modules/error_reporter.js:62) | `sent.add(fp)` + `stats.sent++` อยู่หลัง `await beforeSend` → 2 errors เดียวกัน fire พร้อมกัน burst POST | ย้าย `sent.add` + `sent++` ขึ้น ก่อน beforeSend |
| H1 | High | [main.js:124-155](main.js:124) | `_refreshInflight = null` sync ใน finally → concurrent 401 trigger refresh พร้อมกัน → Supabase rate-limit | `setTimeout(...,3000)` clear (absorb herd) |
| H3 | High | [error_reporter.js:84-95](modules/error_reporter.js:84) | beforeSend throw → `payload=null` + return ก่อน `sent.add()` → error เดิม trigger send() ซ้ำๆ ไม่หยุด | sent.add ขึ้นก่อน beforeSend (C3 fix ครอบด้วย) |
| L1 | Low | [error_reporter.js POST](modules/error_reporter.js:102) | fetch 4xx ไม่ throw → RLS/PGRST204 ไม่ log | เช็ค `r.ok` + warn |
| L2 (related) | — | error_reporter `build` | snapshot ตอน init → null forever ถ้า APP_BUILD set ทีหลัง | รับ `build` เป็น function ได้ (lazy) |

### Files touched (5)
1. `sw.js` — CACHE_NAME v206 → v222 + comment
2. `index.html` — APP_BUILD 221 → 222
3. `modules/settings/pages.js` — version 5.43.17/build 221 → 5.43.18/build 222
4. `modules/error_reporter.js` — race fix + lazy build + refund slot + r.ok check
5. `modules/receipts.js` — 3 จุด restore invoice (bulk cancel + single primary + single fallback)
6. `main.js` — refresh inflight setTimeout 3s

### Verify after deploy
1. **Ctrl+Shift+R** ครั้งเดียวบนทุกเครื่อง → DevTools → Application → Cache Storage เหลือแค่ `boonsook-pos-v5-cache-v222` (v206 หาย)
2. **Footer/Settings** เห็น "build 222"
3. **Smoke test C1:** ออกใบเสร็จจากใบส่งสินค้า → ยกเลิกใบเสร็จ → เปิด tab ใบส่งสินค้า → status = "รอดำเนินการ" ✅ (ก่อน fix จะค้างเป็น "รับเงินแล้ว")
4. **Smoke test H1:** ทิ้ง POS เปิด >1 ชม. → กด refresh dashboard → ไม่มี toast "Session หมดอายุ" หลายครั้ง (refresh ครั้งเดียวพอ)

### Known bugs ยังไม่แก้รอบนี้ (สำหรับ batch ถัดไป)
- **M1** `voidJvForSource` silent fail (RLS DELETE = 0 rows) → double-revenue risk
- **M3** `cash_recon.js:51` filter expense ใช้ `.slice(0,10)` raw → TZ bug รอบเก่ายังครอบไม่หมด
- **M4** CSP `script-src 'unsafe-inline'` ยังอยู่
- **M5** `products.js:100` inline `onerror` pattern เปราะ (escape gated by .charAt(0))
- **M6** `/api/parse-receipt` + `/api/verify-slip` เปิด anon → cost-abuse risk
- **M7** error_log RLS anon INSERT spam risk (ผ่าน publishable key)
- **L4** error_log payload เก็บ full URL → share token PII leak risk
- **L2** stock_cas.js null → 0 → infinite CAS retry
- **M2** products.stock CAS divergence เมื่อ warehouse_stock fail

→ Critical/High clear, Med/Low ค้าง 9 รายการ — แนะนำเรียงตาม priority: M6 → M1 → M2 → M5 → M3

---

## 📚 Phase 89 series summary (11-12 พ.ค. 2026 — 2 วัน)

| Phase | Build | สิ่งที่แก้ | Verified |
|-------|-------|----------|----------|
| 89.1 | 207 | Security headers + XSS share.html + Timezone BKK + JV-void + POS auto-post payload | ✅ user |
| 89.2 | 208 | JV rollback + BANK_COA validate + Float round + Backfill UI + dbl-click | ✅ user |
| 89.2b | 209 | Chart.js pin UMD + CSP script-src-elem + cloudflareinsights | ✅ user |
| 89.2c | 210 | CSP connect-src for SW CDN fetch | ✅ user (dashboard render OK) |
| 89.2d | 211 | Auto-refresh JWT on 401 (single-flight + _appAuthFetch) | ✅ user |
| 89.3 | 212 | Delete POS sale ครบวงจร (void JV + revert stock) | ✅ user (฿214 → 4100 ลด ฿200) |
| 89.3a/89.4 | 213 | Hot-path 401 coverage + 4 dbl-click guards + round2 export + log polish | ✅ |
| 89.5 | 214 | CDN SRI (5 scripts, SHA-384) — supply-chain protection | ✅ |
| 89.6 | 215 | Cancel receipt → restore invoice status (BUT regression — see 89.13) | ⚠️ regression |
| 89.7 | 216 | Filter chip UX clarity | ✅ |
| 89.9 | 218 | Stabilization batch 2 (H10 stock race + H11 cash_recon TZ) | ✅ partial (M3 ยังครอบไม่หมด) |
| 89.10 | 219 | Drop CSP 'unsafe-eval' | ✅ |
| 89.11 | 220 | Extract CAS module + first unit tests | ✅ |
| 89.12 | 221 | Error tracking via Supabase error_log | ⚠️ race fixed in 89.13 |
| **89.13** | **222** | **Critical regression batch — sw cache + .catch dead + reporter race + refresh single-flight** | **⏳ pending** |

**8 builds + 1 day** — ครอบ Critical + High + defensive papercuts จาก audit เดิม

---

## 🛡️ Phase 89.4 — Hot-path 401 + dbl-click + round2 (build 213) — 11 พ.ค.

### Context
หลัง Phase 89.3 ผ่าน → ทำ defensive batch ตอน user ไปทำงาน (autonomous, low-risk only)

### What shipped
1. **Log polish:** `voided N JV(s) ... (will re-post)` → `voided N JV(s)` ([auto_post.js:93](modules/accounting/auto_post.js:93))
2. **Migrate raw fetch → _appAuthFetch** ที่ critical writes:
   - auto_post.js: 4 sites (void/post entry/post lines/rollback)
   - delivery_invoices.js: bulk + single delete
   - receipts.js: bulk delete
3. **Double-click guard** เพิ่ม 4 ปุ่ม: diBulkCancel, diBulkDelete, rcBulkCancel, rcBulkDelete
4. **round2()** export กลางใน utils.js + ใช้ใน quotations form line_total

### Result
- ทุก critical write path ครอบ 401 retry — JWT expire ตอน accounting/cancel ก็ refresh เอง
- Bulk delete/cancel กดรัวๆ = 1 PATCH (ปุ่มเทาทันที)
- quotation line_total ไม่มี `0.30000000000000004` อีก

---

## 🔐 Phase 89.5 — CDN SRI (build 214) — 11 พ.ค.

### Context
จาก audit Phase 89.1: HIGH risk #C2 — CDN scripts ไม่มี SRI → CDN compromise = full DOM/token access

### What shipped
- เพิ่ม `integrity="sha384-..."` + `crossorigin="anonymous"` ให้ 5 CDN scripts
- Hashes computed: `curl URL | openssl dgst -sha384 -binary | openssl base64`
- Auto-verified against live HTML + CDN content ปัจจุบัน

### Hashes (สำหรับ reference เผื่อ upgrade version)
| Library | Version | Hash (SHA-384) |
|---------|---------|----------------|
| chart.js | 4.4.7 UMD | vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC |
| jspdf | 2.5.1 UMD | JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk |
| html5-qrcode | 2.3.8 | c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+ |
| xlsx (SheetJS) | 0.20.1 | QCIdq2UMVEoSRhR3ZWZwdz2/pivLowr+eokFMdYyukq7qI26VYRxFa4Nl6FKetmL |
| jsbarcode | 3.11.6 | Kk5SjBOKprEnGfyBWfD2zROFd1Cu8kwOXxG2GIhYPcoDL2rBJS9P8Ud1ZMy4412a |

### Risk note
- Upgrade version ของ library ต้อง regenerate hash (ไม่งั้น script ไม่โหลด → Chart undefined)
- Workflow upgrade: 
  ```bash
  curl -sL "<NEW URL>" | openssl dgst -sha384 -binary | openssl base64 -A
  # → paste เข้า integrity attribute + bump build
  ```

---

---

## 🛡️ Phase 89.2 — Defensive Fixes Batch 1 (build 208) — 11 พ.ค.

### Context
หลัง Phase 89.1 (build 207) เสร็จ + user เลือก "เน้นไม่ให้แอปพัง" → ทำ defensive fixes ที่ความเสี่ยง break ต่ำ 5 ข้อก่อน

### What shipped (build 208)

**1. 💾 JV orphan rollback**
- `modules/accounting/auto_post.js:223-243` — ถ้า lines insert fail → DELETE entry รถอลแบ็ค
- เดิม: entry ค้าง trial balance พังเงียบ + admin ต้องมาลบเอง
- ตอนนี้: rollback อัตโนมัติ + ถ้า rollback ล้มเหลว (network/RLS) → showToast เตือน admin

**2. 🏦 BANK_COA regex tighten + validate**
- `modules/accounting/auto_post.js:286` — regex จาก `/BANK_COA:(\d{4,5})/` → `/(?:^|[\s•])BANK_COA:(\d{4,5})(?=$|[\s•])/` (anchor + word boundary)
- เพิ่ม `_getValidCoaCodes()` cache + validate กับ `chart_of_accounts` ก่อน override Dr account
- ถ้า COA invalid → fall back ไป default mapping + showToast
- เดิม: typo `BANK_COA:9999` → FK error เงียบ ไม่มี JV เลย

**3. 🔢 Float math rounding**
- `modules/pos.js`:
  - เพิ่ม `round2()` helper
  - Numpad sum (บรรทัด 476): `round2(Number(numpadValue) + Number(v))`
  - line_total (บรรทัด 1127): `round2(qty * price)`
  - salePayload money fields ทั้งหมด: subtotal, total_amount, paid_amount, change_amount, vat_amount, subtotal_before_vat → ใช้ `round2()` 
- เดิม: `0.1+0.2 = 0.30000000000000004` เข้า DB → balance check fail บางครั้ง

**4. 📅 Backfill UI effective date**
- `modules/accounting/backfill.js:62` UI warning + `:131` cutoff logic — `2026-01-01` → `2026-05-01`
- เดิม: user เห็น UI บอก "rows ก่อน 2026-01-01 จะ skip" แต่ logic ใน auto_post.js (Phase 88.18b) ใช้ `2026-05-01` แล้ว → confused

**5. 🛑 Double-click guard ใน receipt preview**
- `modules/receipts.js:698-720` — "เก็บเงิน" + "ยกเลิก" buttons
- เพิ่ม `btn.disabled = true` + opacity + text "⏳ กำลัง..." → restore เฉพาะตอน error
- กัน user double-tap = duplicate PATCH + JV post ซ้ำ (DB มี unique index จับได้แต่ UX สับสน)

### Test plan
1. **POS float math:** ขายของ ฿0.10 + ฿0.20 → ตรวจ DB sale_items.line_total = `0.30` (ไม่ใช่ `0.30000000000000004`)
2. **JV rollback:** ดู console log ตอน checkout — ถ้าเห็น `[auto_post] rollback OK` หรือ `lines insert failed (entry NN), rolling back` แสดงว่าทำงาน
3. **BANK_COA validate:** ตั้งค่า bank ด้วย COA code ผิด (เช่น 9999) → ขายแบบโอน → คอนโซลต้องเห็น "BANK_COA invalid: 9999 — falling back to default 1130" + toast
4. **Backfill UI:** เปิดหน้า Backfill → ต้องเห็น "Effective date: 2026-05-01"
5. **Double-click guard:** เปิดใบเสร็จ pending → กดเก็บเงินรัวๆ → patch + JV ต้องเกิดครั้งเดียว (ดู Network tab)

### Files changed
- `modules/accounting/auto_post.js` — rollback + BANK_COA validate (+~50 บรรทัด)
- `modules/accounting/backfill.js` — effective date 2 จุด
- `modules/pos.js` — round2 helper + ใช้ใน 5 จุด
- `modules/receipts.js` — double-click guard 2 ปุ่ม
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 208
- `CHANGELOG.md`, `HANDOFF.md`

### Batch 2 ที่รออยู่ (Phase 89.3 — high-risk)
- Tighten RLS sales/customers/profiles_with_email — ลูกค้าเห็นเฉพาะของตัวเอง
- Admin-only RLS บน permissions table
- SRI hash + version pin ทุก CDN script
- ⚠️ ต้องทดสอบรอบคอบ — RLS ผิดอาจทำให้ user ทั้งหมด access ไม่ได้

---

## 🛡️ Phase 89.1 — Phase A Security & Critical Bug Sweep (build 207) — 11 พ.ค.

### Context
หลัง full-codebase audit (security / code quality / bugs / performance) — เจอปัญหา critical 5 ตัวที่อาจทำให้บัญชีและภาษีผิดเงียบ + ช่องโหว่ security ระดับ takeover account ได้ — ทำ "Phase A" หยุดเลือดออกก่อน

### What shipped (build 207)

**1. 💸 POS auto-post — pass full salePayload**
- `modules/pos.js:1187-1196` — เดิม pass `{id, order_no, customer_name, payment_method, total_amount, created_at}` เท่านั้น
- ขาด `note` (BANK_COA) + `vat_amount` + `vat_rate` + `subtotal_before_vat`
- ผลกระทบ: Phase 88.20 bank picker + Phase 88.21 VAT split พังเงียบ → JV ขาดบรรทัด Cr 2170 + override bank ไม่ทำงาน
- Fix: `postJournalForSale({ ...salePayload, id, created_at })`

**2. 📑 JV void on cancel — 5 จุด**
- `delivery_invoices.js`: bulk cancel + dropdown cancel
- `receipts.js`: bulk cancel + dropdown cancel + preview cancel
- ทุกจุดเรียก `voidJvForSource("delivery_invoices"|"receipts", id)` หลัง PATCH สำเร็จ
- ผลกระทบเดิม: ยกเลิกใบเสร็จ → JV เก่าค้าง → รายได้นับซ้ำใน P&L

**3. 🌏 Bangkok timezone helpers**
- `modules/utils.js`: เพิ่ม `todayBkk()`, `dateBkk(date)`, `addDaysBkk(n)` — ใช้ `Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Bangkok"})`
- Replace `new Date().toISOString().slice(0,10)` (UTC) ใน 7 accounting files
  - `auto_post.js` (5 จุด — sale/expense/job/receipt/invoice doc_date)
  - `backfill.js` (todayStr + defaultFrom)
  - `profit_loss.js` (date range default + prev period)
  - `trial_balance.js` (date range default)
  - `balance_sheet.js` (defaultAsOf)
  - `export_bundle.js` (date range default)
  - `journal_form.js` (today default)
- ผลกระทบเดิม: ตี 1-6 โมงเช้าไทย doc_date กลายเป็นเมื่อวาน → ถ้าเมื่อวานปิดงวด → JV ถูก reject

**4. 🛡️ XSS fix ใน share.html (public page)**
- เปลี่ยน photo `onclick="window.open('${esc(url)}')"` → `data-photo-url` + delegated listener
- เพิ่ม `safeUrl()` (allow http/https only) + `safeTel()` (digit-only)
- `window.open(u, "_blank", "noopener,noreferrer")`
- ผลกระทบเดิม: photo URL ที่มี apostrophe → escape เป็น `&#039;` → browser decode ก่อน JS eval → XSS ในหน้า public no-auth

**5. 🔒 Security headers**
- `_headers` — เพิ่ม block `/*` (Cloudflare Pages merge):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(self), bluetooth=(self), serial=(self)`
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdn.sheetjs.com https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https://esm.sh; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`
- หมายเหตุ: ใช้ `unsafe-inline`+`unsafe-eval` เพราะ codebase มี onclick="" + jsPDF — Phase B จะ refactor

### ⚠️ User actions ที่ต้องทำเอง (ก่อน/หลัง deploy)

**ก่อน deploy:**
1. **ปิด `OTP_WEB_FALLBACK` ใน Cloudflare Pages env** (CRITICAL)
   - ไปที่ Cloudflare Dashboard → Pages → boonsook-pos → **Settings** → **Environment variables**
   - หา `OTP_WEB_FALLBACK` → ลบ หรือเปลี่ยนเป็น `false`
   - ทั้ง **Production** และ **Preview**
   - เหตุผล: endpoint `/api/send-otp` คืน `devCode` ใน HTTP response → ใครรู้เบอร์ลูกค้าก็เข้าบัญชีได้ทันที (ไม่ต้องมือถือลูกค้า)
   - ผลกระทบหลังปิด: ลูกค้าจะใช้ login OTP ไม่ได้ถ้ายังไม่ได้ตั้ง Twilio — ถ้าตอนนี้ระบบ SMS ยังไม่พร้อม → leave fallback ไว้แต่ตั้ง `OTP_REQUIRE_ADMIN_FOR_DEV_CODE=true` (ยังต้อง implement)

**หลัง deploy — ทดสอบ:**
1. **POS VAT + Bank picker:** ขายของจริงเปิด VAT 7% → checkout → ดู journal entries ต้องมี **3 บรรทัด** (Dr bank/cash + Cr revenue + Cr 2170 VAT) + Dr account ตรง bank ที่เลือก
2. **Cancel ใบเสร็จ:** เปิด P&L ก่อน → ยกเลิกใบเสร็จ 1 ใบ → reload P&L → รายได้ต้องลดลงตามใบที่ยกเลิก
3. **Timezone:** ลองตั้งนาฬิกาคอมเป็น 02:00 ไทย (จริงๆ ทดสอบยาก) — หรือเช็ค `localStorage` → `new Date()` ของ JV ที่ลงตอนเช้ามืด ต้องเป็นวันเดียวกับวันที่ขาย
4. **Security headers:** เปิด DevTools → Network → ดู Response Headers ของ index.html ต้องเห็น CSP/HSTS/X-Frame-Options
5. **XSS share.html:** เปิด link share สดๆ → คลิกรูป → ต้องเปิด tab ใหม่ปกติ (regression check)

---

## 🛒 Phase 88.20 — POS Cash Breakdown + Bank Picker (build 203) ✅ VERIFIED

### User feedback
> "เงินสด ควรเพิ่มรายละเอียดยอดเงินที่ได้ จากลูกค้า อะไร ยอดอะไร ได้ด้วย"
> "โอนบัญชีธนาคาร ควรให้เราเลือกเปลี่ยนบัญชีได้เอง"

### What shipped (build 203)

**1. POS Cash UI:**
- Confirm-proof view: 2-column breakdown (รับเงิน / เงินทอน) เด่นชัด
- Sales note: `💵 รับ ฿X ทอน ฿Y`

**2. POS Transfer UI:**
- Dropdown picker (ถ้ามี ≥ 2 banks) — เลือกบัญชีรับเงิน
- QR + ข้อมูลบัญชีเปลี่ยนตามที่เลือก
- แสดง COA Code

**3. Settings → ข้อมูลการเงิน:**
- เพิ่ม field "📊 รหัสบัญชี COA" per bank
- บัญชีแรก default = 1130 (suggestion)

**4. auto_post.js logic:**
- `postJournalForSale` parse `BANK_COA:XXXX` จาก note
- Override Dr account จาก default 1130 → COA ที่เลือก

### Verified by user
- ✅ ตั้งค่า 2 banks: KBANK (1130) + SCB (1131) ครบ
- ✅ POS Transfer dropdown: 2 ตัวเลือก แสดง COA
- ✅ เลือก KBANK → QR เขียว, COA 1130
- ✅ เลือก SCB → QR ม่วง, COA 1131
- ✅ Checkout → JV (SV2026050005): Dr 1130 / Cr 4100 ตรงกับ KBANK ที่เลือก

### Files changed
- `modules/pos.js` — bank dropdown + cash breakdown + note format
- `modules/settings/payment.js` — coaCode field
- `modules/accounting/auto_post.js` — parse BANK_COA from note
- `index.html` + `sw.js` + `pages.js` — bump 203
- `CHANGELOG.md`

---

---

## 🆕 Pending — User Requests ปลาย Session (9 พ.ค.)

### 1. 💰 POS แคชเชียร์ — เพิ่ม "เงินที่ลูกค้าให้มา" (cash)
> "เงินสด ควรเพิ่มรายละเอียดยอดเงินที่ได้ จากลูกค้า อะไร ยอดอะไร ได้ด้วย"

**Plan:**
- เพิ่ม input "เงินที่ได้รับ" ในหน้า checkout (ตอน payment_method='cash')
- Auto-calc เงินทอน = received - grand_total
- บันทึกในใบเสร็จ POS / sales table

### 2. 🏦 POS แคชเชียร์ — เลือกบัญชีธนาคาร (transfer)
> "โอนบัญชีธนาคาร ควรให้เราเลือกเปลี่ยนบัญชีได้เอง"

**Plan:**
- เพิ่ม dropdown เลือกบัญชีปลายทาง (1130, 1131, 1132...)
- ตอน checkout → user เลือก → JV ลงบัญชีนั้นแทน 1130 default
- หรือเพิ่ม column `bank_account_code` ใน sales

---

## 🔒 Phase 88.19 — Period Close + Lock Periods (build 200-202) ✅ VERIFIED

### What shipped
- **DB:** ตาราง `accounting_periods` + `is_period_locked()` function + trigger `check_period_not_locked`
- **UI:** หน้า "🔒 ปิดงวดบัญชี" — grid 12 เดือน + summary + Lock/Unlock
- **Validation:** Defense in depth (UI + DB)
  - Front-end: `auto_post.js` ตรวจ period ก่อน insert
  - Back-end: DB trigger ป้องกัน insert + update doc_date เข้า/ใน locked period
- **Relaxed trigger (88.19b):** อนุญาต void/unvoid ใน locked period (เพื่อ correction หลังปิดงวด)

### SQL ที่รัน
- `supabase-phase88-19-period-close.sql` — สร้าง table + function + trigger
- `supabase-phase88-19b-relax-void.sql` — relax allow void/unvoid

### Files
- `modules/accounting/periods.js` (NEW)
- `main.js` — wire route + ALL_ROUTES + title + parent group
- `modules/accounting/auto_post.js` — period check ใน `_postJournal`
- `index.html` — page section + sidebar menu

### Verified by user
- ✅ Lock งวด → 🔒 ล็อก + locked_at + locked_by
- ✅ Unlock งวด → กรอก reason → audit trail
- ✅ Insert JV ใน locked period → reject (PERIOD_LOCKED)
- ✅ Void JV ใน locked period → ผ่าน (relaxed trigger)
- ✅ Cleanup 5 mock JVs (เม.ย. + test JVs)

---

## ก่อนหน้า: Phase 88.18b (build 198) — Production start 1 พ.ค.

---

## 🚀 Phase 88.18b — Production Start (1 พ.ค. 2026)

### Context
> "ผมจะเริ่ม production จริง ก็ตั้งแต่เริ่มเดือน พฤษภาคม ครับ"
> "ส่วนของกุดขาคีม ยังไม่ได้รับเงินนะครับ ลบรายได้ออกก่อน"

### What changed (build 198)
- `ACCOUNTING_EFFECTIVE_DATE`: `2026-01-01` → `2026-05-01` (4 ไฟล์)
- ระบบจะปฏิเสธ post JV ของ docDate < 1 พ.ค. โดยอัตโนมัติ

### User actions ทำแล้ว
1. ✅ Run SQL void JV กุดขาคีม (id=103, ฿93,456) — ยังไม่ได้รับเงินจริง
2. ⏳ Run SQL void JV เม.ย. 2026 (mock data) — รอ user รัน

### Workflow ที่ปลอดภัย (หลัง build 198)
- POS sale วันที่ 30 เม.ย. → ระบบ reject post JV (เพราะก่อน effective date)
- Invoice วันที่ 1 พ.ค. → JV ปกติ
- Backfill เก่าก่อน 1 พ.ค. → ระบบ skip อัตโนมัติ

---

## 🚨 Phase 88.17 + 88.18 — Receipt Approval + B2B Revenue Fix (9 พ.ค.)

---

## 🚨 Phase 88.17 + 88.18 — Receipt Approval + B2B Revenue Fix (9 พ.ค.)

### User feedback (2 ประเด็นใหญ่)
1. **"ใบเสร็จขึ้น 'ชำระแล้ว' ทั้งที่ยังไม่รับเงิน → ควรเป็นรออนุมัติ"**
2. **"แยกรายได้: หน้าร้าน vs งานราชการ/บริษัท เพื่อเข้าระบบสรรพากร"**

### Audit เจอบั๊กบัญชีสำคัญ
ก่อน fix, P&L แสดงรายได้แค่ **฿5,600** ทั้งที่มีใบเสร็จจริง **฿153,153**
- 4100 = ฿600 (POS เล็กๆ)
- 4210 = ฿3,000 (ซ่อมแอร์)
- 4240 = ฿2,000 (อื่นๆ)
- **gap = ฿147,553** ← B2B chain (Quote→Invoice→Receipt) revenue ไม่เคยถูก post!

**Root cause:** เดิม
- ออกใบเสนอราคา → ❌ ไม่ลง JV (ถูก)
- ออกใบส่งสินค้า/แจ้งหนี้ → ❌ **ไม่ลง JV** (ผิด!)
- ออกใบเสร็จ → ✅ ลง JV: Dr 1110 / Cr 1200 (แต่ Dr 1200 ไม่เคยมี → balance ติดลบ)

---

### What shipped (build 197)

#### Phase 88.17 — Receipt Approval Workflow

**1. delivery_invoices.js** — receipt default status="pending" (เดิม "paid")
```js
status: "pending",  // เดิม "paid" → user ต้องกดยืนยันใน list
```

**2. auto_post.js** — `postJournalForReceipt` ตรวจ status="paid" ก่อน post
```js
if (String(receipt.status || "").toLowerCase() !== "paid") return null;
```

**3. receipts.js** — UI ใหม่
- Default filter chip = "🟡 รออนุมัติ" (สีม่วง #a855f7)
- STATUS_LABELS: paid="✅ ชำระแล้ว" / pending="🟡 รออนุมัติ"

#### Phase 88.18 — B2B Revenue Split + Fix JV Chain

**SQL migration** (`supabase-phase88-17-revenue-split.sql`)
```sql
-- Rename 4100 → "หน้าร้าน (POS)"
UPDATE chart_of_accounts SET name='รายได้ขายสินค้า — หน้าร้าน (POS)' WHERE code='4100';

-- เพิ่ม 4150 → "ราชการ/บริษัท"
INSERT INTO chart_of_accounts ... ('4150', 'รายได้ขายสินค้า — งานราชการ/บริษัท', ...);

-- mapping invoice_credit
INSERT INTO account_mapping ... ('invoice_credit', '...', '1200', '4150');
```

**JS code:**
- `auto_post.js`: เพิ่ม `postJournalForDeliveryInvoice(invoice)` — Dr 1200 / Cr 4150
- `quotations.js`: import + fire หลัง insert delivery_invoices
- `backfill.js`: เพิ่ม source "🧾 ใบส่งสินค้า (B2B)"

### Workflow ที่แก้แล้ว

```
ก่อน fix:
  Quote → Invoice (no JV) → Receipt (paid auto, JV: Dr 1110/Cr 1200)
  ผล: revenue ไม่ขึ้น P&L + ลูกหนี้ติดลบ

หลัง fix (Phase 88.17 + 88.18):
  Quote → Invoice (✅ JV: Dr 1200/Cr 4150) → Receipt (pending — รออนุมัติ)
                                              ↓
                             user กดยืนยัน → status=paid → JV: Dr 1110/Cr 1200
  ผล: revenue ขึ้น P&L (4150 แยกจาก 4100) + ลูกหนี้ balance ถูก
```

### ⚠️ User actions required (2 ขั้นตอน)
1. **Run SQL** ใน Supabase Editor — `supabase-phase88-17-revenue-split.sql`
2. **Backfill ย้อนหลัง** ใบส่งสินค้าเก่า:
   - เมนู → บัญชี → Backfill ย้อนหลัง
   - ☑ ติ๊ก "🧾 ใบส่งสินค้า (B2B)"
   - เลือก date range (เช่น 1 เม.ย. — 9 พ.ค.)
   - กด "⚡ เริ่ม Backfill"
   - ผลลัพธ์: P&L revenue 4150 จะเพิ่ม ฿147,553

### Files changed (build 197)
- `supabase-phase88-17-revenue-split.sql` (NEW)
- `modules/accounting/auto_post.js` — เพิ่ม `postJournalForDeliveryInvoice` + ตรวจ status
- `modules/quotations.js` — import + fire JV หลัง insert invoice
- `modules/delivery_invoices.js` — receipt default status=pending
- `modules/receipts.js` — UI default filter pending + STATUS_LABELS ใหม่
- `modules/accounting/backfill.js` — เพิ่ม source delivery_invoices
- `index.html` — bump 197
- `sw.js` — v182
- `modules/settings/pages.js` — build 197 + version 5.40.0
- `CHANGELOG.md` — entry 5.40.0

### Test plan
1. ✅ Run SQL — ตรวจมี COA 4150 + mapping invoice_credit
2. ✅ Backfill ใบส่งสินค้าเก่า → ดู progress + ผล "✅ created"
3. ✅ เปิด P&L → ควรเห็นบรรทัด "รายได้ขายสินค้า — งานราชการ/บริษัท" ฿147,553
4. ✅ ออกใบเสร็จใหม่ → status=pending → ใบรับงานเห็น "🟡 รออนุมัติ" → ยังไม่มี JV
5. ✅ คลิก dropdown → "✓ เก็บเงิน" → status=paid → JV: Dr 1110 / Cr 1200

### Pending Phase 88+
- 🔒 **Period close + Lock periods** (เดิม Step 1 — ทำหลังจากนี้)
- ✏️ Mapping editor UI
- 📜 VAT support (XL — Phase ใหม่)

---

## ☀️ Phase 88.16 — Solar Revenue Mapping → 4300 (9 พ.ค.)

### Why
- เดิม: งาน solar fallback → `service_other` mapping → Cr **4240** (รายได้บริการอื่นๆ)
- ปัญหา: P&L มองไม่เห็นว่ารายได้โซล่าเป็นเท่าไหร่ — ผสมกับงานเล็กๆ น้อยๆ
- ใหม่: solar มี mapping เฉพาะ → Cr **4300** (รายได้บริการ — โซล่าเซลล์)

### What shipped (build 196)

**1. SQL migration** — `supabase-phase88-16-solar-mapping.sql`
```sql
-- COA 4300
INSERT INTO chart_of_accounts (code, name, type, parent_code, sort_order)
  VALUES ('4300', 'รายได้บริการ — โซล่าเซลล์', 'income', '4000', 300)
  ON CONFLICT (code) DO UPDATE...;

-- mapping service_solar
INSERT INTO account_mapping (mapping_key, debit_account_code, credit_account_code)
  VALUES ('service_solar', '1110', '4300')
  ON CONFLICT (mapping_key) DO UPDATE...;

NOTIFY pgrst, 'reload schema';
```

**2. JS code** — `modules/accounting/auto_post.js`
```js
const keyMap = {
  ...
  solar: "service_solar",  // ★ Phase 88.16
  other: "service_other"
};
```

**3. solar.js comment** — อัปเดตหลัง mapping เปลี่ยน (ไม่ใช่ fallback อีก)

### ⚠️ User action required
ต้อง run SQL ใน **Supabase SQL Editor** ก่อนถึงจะมี COA 4300 + mapping
- File: `supabase-phase88-16-solar-mapping.sql` (อยู่ root project)
- รัน 1 ครั้งเดียว → cache invalidate อัตโนมัติด้วย `NOTIFY pgrst`

### Files changed
- `supabase-phase88-16-solar-mapping.sql` (NEW)
- `modules/accounting/auto_post.js` — เพิ่ม solar key
- `modules/solar.js` — comment update
- `index.html` — bump 196
- `sw.js` — v181
- `modules/settings/pages.js` — build 196
- `CHANGELOG.md` — entry 5.39.5

### Test plan
1. **Run SQL** ใน Supabase Editor → ตรวจ result query (ต้องเห็น `service_solar` mapping)
2. **Refresh app** (Ctrl+Shift+R) — clear `_mappingCache`
3. **เปิดงานโซล่าเก่าที่ยัง pending** → admin approve → JV เกิด
4. **ตรวจ JV row** → Cr account ต้องเป็น **4300** (ไม่ใช่ 4240)
5. **เปิด P&L** → ควรเห็นบรรทัดแยก "รายได้บริการ — โซล่าเซลล์"

### Pending Phase 88+ (priority order)
- 🔒 **Period close + Lock periods** (ถัดไป — Step 1 ในแผน)
- ✏️ Mapping editor UI (Step 2)
- 📜 VAT support (XL — Phase ใหม่)

---

## 🔐 Phase 88.15 — แยกสิทธิ์ ช่าง vs Admin (9 พ.ค.)

### User feedback
> "ในหน้าช่าง ทุกหน้า ไม่ควรมี 2 ช้อยนี้นะครับ"
> (📦 ส่งมอบแล้ว / 🎉 ปิดงาน + รับเงิน — ลง JV ทันที)

### Root cause / Design
- ก่อน fix: ทุก dropdown ในฟอร์มช่างมี 6 options รวม `delivered` + `closed`
- ช่างเลือก → JV เกิดทันที (`COMPLETION_STATUSES = ["done","delivered","closed"]`)
- ผู้ใช้ต้องการ: **ช่างห้ามทำให้ JV เกิดเอง** — ต้องผ่าน admin approve เสมอ

### What shipped (build 195)

**1. ฟอร์มช่าง dropdown — เหลือ 4 options:**
```
⏳ รอดำเนินการ      (pending)
🔄 กำลังดำเนินการ    (in_progress)
✅ เสร็จแล้ว         (done)
📨 รออนุมัติ         (pending_review)  ← ส่งให้ admin ตรวจ
```

ลบออก:
- ❌ 📦 ส่งมอบแล้ว (ลง JV ทันที) — admin only
- ❌ 🎉 ปิดงาน + รับเงิน (ลง JV ทันที) — admin only

**2. ปิด JV trigger ในฟอร์มช่าง:**
```js
// เดิม:    const COMPLETION_STATUSES = ["done","delivered","closed"];
// ใหม่:    const COMPLETION_STATUSES = [];
```

**3. Admin drawer (index.html `#serviceStatus`) ยังมี 7 options ครบ**
- ใช้ approve banner (ม่วง) → กดอนุมัติ → set status=delivered → save → JV เกิด

### Workflow ที่ชัดเจน
```
ช่าง (mobile):
  เปิดฟอร์ม → กรอก → status="📨 รออนุมัติ" + แนบสลิป → ส่ง

Admin (desktop):
  ใบรับงาน → filter "📨 รออนุมัติ" → คลิก row → drawer
  → banner ม่วง "✅ อนุมัติ + ลงรายได้" → กด → JV เกิด

JV ไม่มีทางเกิดจากฟอร์มช่าง (ปลอดภัย กัน duplicate)
```

### Files changed (build 195)
- `modules/solar.js` — ลบ 2 options + `COMPLETION_STATUSES = []`
- `modules/ac_install.js` — เหมือนกัน
- `modules/service_form.js` — เหมือนกัน (ครอบคลุม 9 service types)
- `index.html` — bump `?v=195` + APP_BUILD
- `sw.js` — bump v180
- `modules/settings/pages.js` — bump build 195
- `CHANGELOG.md` — entry 5.39.4

### Test plan
1. **เปิดหน้าช่าง** (โซล่า, ติดตั้งแอร์, ซ่อมแอร์ ฯลฯ)
2. **เปิด dropdown สถานะงาน** → ควรเห็นแค่ 4 ตัวเลือก (ไม่มี ส่งมอบแล้ว / ปิดงาน)
3. **เลือก "📨 รออนุมัติ"** → กรอก + แนบสลิป → save → ✅ ใบรับงานเห็นใน filter "รออนุมัติ"
4. **Admin เปิด drawer** → ดู dropdown → ✅ ยังมี 7 options ครบ + banner approve

---

## 🔧 Phase 88.14 — Fix New Service Jobs ไม่โผล่ในใบรับงาน (9 พ.ค.)

### User feedback
> "ผมบันทึกงานเฉยๆ ไม่แนบสลิป งานผมต้องไปอยู่หน้าไหนครับ
> หน้า 'ใบรับงาน' ไม่เจองาน"

### Root cause
- `main.js` `saveServiceJob` มี optimistic update — push job ใหม่เข้า `state.serviceJobs` ทันทีหลัง insert
- แต่ `solar.js`, `ac_install.js`, `service_form.js` (9 routes) **ไม่มี** pattern นี้
- → บันทึก DB สำเร็จ แต่ `state.serviceJobs` ใน RAM ยังเก่า → ใบรับงาน render จาก state → ไม่เห็น

### What shipped (build 194)

**1. modules/solar.js** — เพิ่ม optimistic update หลัง insert
```js
if (inserted?.[0]) {
  state.serviceJobs = [inserted[0], ...(state.serviceJobs || [])];
}
```

**2. modules/ac_install.js** — เพิ่ม pattern เดียวกัน

**3. modules/service_form.js** — เพิ่มที่ครอบคลุม 9 service types
- repair_ac / clean_ac / move_ac / satellite / fridge / washer / cctv / tv / other

### Workflow ที่แก้แล้ว
```
ก่อน fix:
  ช่างเข้าหน้าโซล่า → กรอก → save → DB success → ไปดูใบรับงาน → ❌ ไม่เห็น job
  (ต้อง Ctrl+Shift+R เพื่อ reload state)

หลัง fix:
  ช่างเข้าหน้าโซล่า → กรอก → save → DB success + state push → ไปดูใบรับงาน → ✅ เห็นทันที
```

### Files changed
- `modules/solar.js`
- `modules/ac_install.js`
- `modules/service_form.js`
- `index.html` — bump `?v=194` + APP_BUILD
- `sw.js` — bump CACHE_NAME → `v179`
- `modules/settings/pages.js` — bump build 194
- `CHANGELOG.md` — entry 5.39.3

### Test plan
1. ปิดงานปกติ (เลือก status "รอดำเนินการ" — ไม่แนบสลิป)
2. กดบันทึก → success
3. คลิก "ใบรับงาน" → ✅ เห็น job ทันที (filter "🟡 ค้าง")
4. ทดสอบกับทุกประเภท: solar / ติดตั้งแอร์ / ซ่อมแอร์ / ล้างแอร์ / etc

---

## 🔗 Phase 88.13 — Solar Equipment ↔ Stock Link (9 พ.ค.)

### User feedback
> "หน้าเพิ่ม อุปกรณ์ ควรลิ้งกับ สินค้า คงคลัง ครับ จะได้ทำสต็อกไปด้วย"

### What shipped (build 193)

**1. modules/solar.js — rewrite ครั้งใหญ่ (359 → 801 บรรทัด)**
- ลบ free-text equipment rows ออก → ใช้ modal picker เลือกจาก `state.products`
- Module-private state: `let _solItems = []` (prefix `_sol*` กัน collision กับ ac_install)
- ปุ่ม "+ เพิ่มอุปกรณ์" เปิด modal picker จาก state.products
- แสดงตาราง: ชื่ออุปกรณ์ / คลัง (รถ/บ้าน) / qty stepper / ราคา / รวม / ลบ
- บันทึก `items_json` ลง service_jobs

**2. Helper functions (private)**
- `_solGetMobileWarehouses()` → list คลังในรถ
- `_solGetHomeWarehouse()` → คลังบ้าน
- `_solGetMobileStocks(productId)` → stock ในรถทั้งหมด
- `_solGetHomeStock(productId)` → stock ในบ้าน
- `_solPickMobileWarehouse()` → ถามคลังปลายทาง (ถ้ามีหลายคัน)
- `_solRenderItemsList()` / `_solBindItemListEvents()` — UI render
- `_solOpenItemPicker()` — modal picker UI

**3. Save logic — auto stock movement**
- ถ้าเลือกของจาก "บ้าน" → prompt confirm → call `window._appTransferWarehouseStock(home, mobile, productId, qty)` ก่อน
- ตอน save → call `window._appApplyStockMovement(productId, mobile_warehouse, -qty, ...)` ตัดสต็อก
- Optimistic update `state.warehouseStock` ทันที (ไม่ต้องรอ refresh)

**4. ไม่กระทบ Phase 88.12**
- Section "💰 ปิดงาน + แนบสลิป + AI verify" ยังคงเดิม
- JV trigger (postJournalForServiceJob) ยังเรียกตอน isClosure=true
- Status flow: pending → in_progress → pending_review → delivered/closed

### Files changed
- `modules/solar.js` — rewrite ครั้งใหญ่ (359→801)
- `index.html` — bump `?v=193` (main.js + style.css)
- `sw.js` — bump CACHE_NAME → `v178`
- `modules/settings/pages.js` — bump APP_BUILD → 193
- `CHANGELOG.md` — entry 5.39.2

### Test plan
- เปิด POS → เมนู โซล่าเซลล์ → กด "+ เพิ่มอุปกรณ์"
- ✅ Modal picker เปิด → เห็นรายการ products ที่มีสต็อก
- ✅ เลือกจากบ้าน → confirm transfer → save → stock บ้านลด + รถเพิ่ม + ของในงานหัก
- ✅ JV ยังเกิดถูกต้องตอนปิดงาน

### Pending Phase 88+ (priority order)
- 🔒 Period close + Lock periods
- ✏️ Mapping editor UI
- ☀️ Solar revenue mapping (4300 — currently fallback to 4240)
- 📜 VAT support (XL — Phase ใหม่)

---

## 📨 Phase 88.12 — Approval Workflow + Slip ทุกหน้างานช่าง (9 พ.ค.)

### User feedback
> "ในหน้างานช่างควรมีเมนูเพิ่มสลิ๊ปปิดงาน ทุกหน้าด้วยครับ บางครั้งไปหน้างาน
> ก็สามารถส่งงานได้เลย รอแอดมินยืนยัน อีกที ค่อยลงเป็นรายได้"

### What shipped (build 191-192)

**1. New status: `pending_review`** (📨 รออนุมัติ)
- ช่างเลือก → JV ไม่เกิด (รอ admin)
- ใส่ใน `STATUS_LABELS` + `STATUS_COLOR` (สีม่วง #a855f7)

**2. service_jobs.js list — filter chip ใหม่**
- "📨 รออนุมัติ" + counter
- `REVIEW_STATUSES = ["pending_review"]`
- ระหว่าง chip "ค้าง" และ "ปิดแล้ว"

**3. Drawer admin approve (main.js + index.html):**
- Banner สีม่วงโผล่เมื่อ status=pending_review
- ✅ อนุมัติ + ลงรายได้ → set status=delivered → save → JV
- ↩️ ส่งกลับให้แก้ → set status=in_progress

**4. ครบ 13 หน้างานช่าง** (port closure section + slip + AI verify):
- `service_form.js` → 9 routes (repair_ac/clean/move/satellite/fridge/washer/cctv/tv/other)
- `ac_install.js` → ติดตั้งแอร์
- `solar.js` → โซล่าเซลล์ (refactor: `address` → `customer_address`, ใช้ token cache, return=representation)

**5. ทุกไฟล์มี:**
- 📷 ถ่ายรูป + 🖼️ แกลลอรี่ (capture + no-capture inputs)
- Status dropdown 6 options (รอดำเนินการ → รออนุมัติ → ส่งมอบ → ปิดงาน)
- Payment method (cash → Dr 1110 / transfer → Dr 1130)
- Auto AI verify หลัง upload ถ้า payment=transfer/qr
- ปุ่ม 🤖 ตรวจ AI manual
- Verify result card (ผ่าน/ตรวจเพิ่ม)
- Wire `postJournalForServiceJob` หลัง save ถ้า isClosure=true

### Workflow ที่รองรับแล้ว
```
ช่าง (มือถือ — หน้างาน):
  เปิดหน้างานใดๆ → กรอก + แนบสลิป → status='📨 รออนุมัติ' → ส่ง

Admin (เดสก์ท็อป):
  ใบรับงาน → filter 'รออนุมัติ' → คลิกแก้ไข → drawer → กด 'อนุมัติ + ลงรายได้'

ระบบ:
  status='delivered' → JV เกิด Cr 4200-4290 ตามประเภทงาน
```

หรือ workflow เก่า (ช่างปิดเอง) ยังใช้ได้:
```
ช่าง: เลือก status='ส่งมอบแล้ว' → save → JV เกิดทันที
```

### Files changed (Phase 88.12 + 88.12b)
- `index.html` — เพิ่ม `pending_review` option + admin approve banner
- `main.js` — wire approve/reject buttons + show banner ใน openServiceJobDrawer
- `modules/service_form.js` — closure section + AI verify (port from drawer)
- `modules/service_jobs.js` — filter chip "รออนุมัติ" + REVIEW_STATUSES
- `modules/ac_install.js` — เพิ่ม closure section + AI verify
- `modules/solar.js` — เพิ่ม closure + refactor (token cache + customer_address)

### Pending Phase 88+
- Period close + Lock periods
- Mapping editor UI
- Service mapping for `solar` (ตอนนี้ fallback service_other → 4240)
- VAT support (XL — Phase ใหม่)

---

---

## 🎯 Phase 88.7-88.11 (9 พ.ค.)

### Phase 88.7 — JV Drill-down (build 181)
คลิก row สมุดรายวัน → drawer overlay แสดง:
- Lines table (Dr/Cr ทุกบรรทัด + balance check)
- Source preview ตาม `source_table` (sales/expenses/receipts/service_jobs)
- ปุ่ม "เปิดหน้า [source]" → navigate
- Audit info (created/approved/voided timestamps)

### Phase 88.8 — Drawer service cost input (build 181)
แก้ pain point เดิม: drawer แก้ไขงานช่างไม่มีช่อง total_cost
- HTML: section "💰 ค่าแรง / ปิดงาน" ใน serviceJobDrawer
- Inputs: ค่าแรง + ส่วนลด (auto-recalc ยอดสุทธิ) + payment_method
- payload: `total_cost` + `payment_method` ใส่ตอน save
- ส่ง payment_method ให้ postJournalForServiceJob → override Dr account (transfer→1130)

### Phase 88.9 — Comparative P&L (build 181)
- Toggle "📊 เทียบกับงวดก่อน"
- Auto-compute previous period (m/q/y/custom)
- Side-by-side 5 columns + Net Income compare card

### Phase 88.10 / 88.10b — Re-post JV on edit (build 182-183)
- ปัญหา: edit งานเก่า + เปลี่ยน total_cost → JV ค้าง (idempotent unique block POST ใหม่)
- Fix: เพิ่ม `voidJvForSource()` ใน auto_post.js — DELETE JV เดิม (lines cascade)
- Wire ใน saveServiceJob: void ก่อน post ใหม่ ถ้า edit (!isNewJob)
- 88.10b: trigger logic ขยาย — `editCompleteWithChange` (status เป็น completion อยู่แล้ว + total/method เปลี่ยน)
- เก็บ `state.editingServiceJobOrigTotalCost` + `OrigPaymentMethod` ตอน open drawer เพื่อตรวจ change

### Phase 88.11 — Slip Upload + AI Verify (build 184-190)
ฟีเจอร์ใหญ่ — user ขอ "แนบสลิป + ตรวจจริง/ปลอม"
- **`functions/api/verify-slip.js`** (NEW) — Gemini Vision API:
  - Compact prompt → ดึง 14 fields (sender/recipient/amount/datetime/ref/tampering)
  - Fallback chain 4 models: 2.5-flash → 2.0-flash-lite → flash-latest → 2.0-flash
  - 3-layer JSON extraction (parse ตรง → strip code fence → regex {})
  - maxOutputTokens 4000 (1500 ไม่พอสำหรับ Thai)
- **Drawer section "📷 สลิปการโอน + ตรวจ AI"** สีม่วง — แสดงเมื่อ payment=transfer/qr
  - 2 ปุ่ม (📷 ถ่ายรูป + 🖼️ แกลลอรี่) — แยกตาม Service Photos pattern
  - Auto-verify หลัง upload สำเร็จ
  - Card สีเขียว/เหลือง: ผู้โอน/ผู้รับ/ยอด/Ref/datetime + confidence + tampering_score
- **Smart name match** — normalize ชื่อก่อนเทียบ:
  - Strip คำนำหน้า: ร้าน/บริษัท/หจก./บจ./บมจ./จำกัด/มณี shop/mn shop
  - Unwrap ปีกกา ( ) [ ]
  - Strip bank names: scb/kbank/krungthai/bbl/ttb/kkp/gsb/baac/...
- **Tampering threshold** — สอน AI:
  - ถ่ายจากจอมือถือ ≠ tampering (workflow ปกติร้านค้าไทย)
  - "จริง" tampering = digital editing (ฟ้อนต์ผิด/crop unnatural/pixel artifact)

### Bug debug journey ของ Phase 88.11 (สำหรับ session ใหม่)
1. **build 184**: ปุ่มเดียว — ปัญหา UX มือถือเด้งกล้องเสมอ
2. **185**: แยก 2 ปุ่ม
3. **186-187**: "Gemini ส่ง JSON ไม่ valid" — ลอง fallback chain + cleanup
4. **188**: เห็น raw response ตัดกลาง → MAX_TOKENS issue → 1500→4000
5. **189**: false positive ชื่อร้านไม่ตรง → smart normalize
6. **190**: false positive tampering 40 → สอน AI

### Pre-req
- `GEMINI_API_KEY` ใน Cloudflare env (มีอยู่แล้วจาก Phase 74 AutoKey)
- Storage bucket `proofs/` (มีอยู่แล้ว)

### ✅ Verified (build 190 final)
```
✅ ผ่านการตรวจสอบ
ผู้โอน: น.ส.ปณิชยา W***
ผู้รับ: SCB มณี SHOP (บุญสุขอิเล็กทรอนิกส์)
ยอด: 2,000 · วันที่: 2026-05-08T17:07
Ref: C20260508612817830614
Confidence: 90/100 · Tampering: 10/100
```

---

---

## 🔧 Phase 88.6 + Hotfixes (8 พ.ค. ตอนเย็น)

### Builds 176-180 (5 hotfixes ระหว่าง 88.5 → 88.6)

**Build 176 (5.34.9):** service_form fetch timeout 15s
- ปัญหา: มือถือกดบันทึกแล้วค้าง "กำลังบันทึก..." ตลอด
- แก้: AbortController + timeout — error message แทน hang

**Build 177 (5.35.0):** service_form mobile token + wire auto-post JV
- ปัญหา 1: `state.supabase.auth.getSession()` hang บน slow mobile network
  → แก้: ใช้ `window._sbAccessToken` cache ตรงๆ (pattern xhrPost)
- ปัญหา 2: ผม wire `postJournalForServiceJob` ผิดที่ — main.js drawer แทนที่จะเป็น
  service_form.js (create flow) → JV ไม่เกิดตอนสร้าง
  → แก้: เพิ่ม import + wire ใน service_form.js หลัง POST สำเร็จ

**Build 178 (5.35.1):** Backfill date range bug
- ปัญหา: `created_at=lte.YYYY-MM-DD` = midnight 00:00 → row created 12:56:24 ของ
  วันสุดท้ายในช่วงถูก exclude (Postgres timestamp comparison)
- แก้: ตรวจ field type — timestamptz ใช้ `lt.<nextDay>`, DATE ใช้ `lte.<to>`
- ผลกระทบ: sales + service_jobs (ใช้ `created_at`) — เก่าเสียเอง

**Build 179 (5.35.2):** service_jobs.total_cost
- ปัญหา: service_form.js record ไม่ใส่ `total_cost` field → DB เก็บ NULL →
  postJournalForServiceJob skip silent
- แก้: เพิ่ม `total_cost: net` ใน record (net = itemsTotal+labor-discount)
- Workaround งานเก่า: SQL UPDATE service_jobs SET total_cost=...

**Build 180 (5.36.0) + SQL hotfix — Phase 88.6 FULL:**
- SQL `supabase-phase88-service-mappings.sql`:
  - ALTER service_jobs ADD: total_cost, payment_method, payment_slip_url, closed_at
  - 5 COA ใหม่ (4250-4290): จานดาวเทียม/ตู้เย็น/เครื่องซักผ้า/CCTV/ทีวี
  - 5 account_mappings: service_satellite/repair_fridge/repair_washer/cctv/repair_tv
  - `NOTIFY pgrst, 'reload schema'` — บังคับ PostgREST reload (กัน PGRST204)
- auto_post.js:
  - keyMap ขยาย 9 ประเภทครบ
  - รองรับ `payment_method` — transfer/QR → Dr 1130 แทน 1110
- service_form.js — section "🔚 ปิดงาน" สีเหลือง:
  - Status selector: pending / in_progress / done / delivered / closed
  - Payment method: cash / transfer
  - 📷 Slip upload → Storage `proofs/service-slips/`
  - หลัง save status=closure → fire JV ทันที + payment_method override

### Verified by user
- Mobile บันทึกใบงานเครื่องซักผ้า → JV `SV2026050002` ฿2,000 (Backfill)
- Desktop ลองสร้างงานใหม่ JOB-1778247978973 ดาหมอก → JV `SV2026050003` ฿3,000
- สมุดรายวัน: 9 รายการ (4 SV + 4 PV + 1 OB) — ทุกประเภทครบ
- Trial Balance / P&L / BS — sync ตามจริง

### Lesson Learned (สำคัญสำหรับ session ใหม่)
1. **อย่าแก้ main.js แล้วคิดว่าครอบคลุม** — Phase 86 refactor → ทุก source flow ใน modules/
   - `pos.js doCheckout` (POS sale) — wire ที่นี่
   - `service_form.js` (create) + `main.js saveServiceJob` (drawer edit) — wire **ทั้งคู่**
   - `expenses.js expFormSaveBtn` + `akSaveBtn` — wire **ทั้งคู่**

2. **PostgREST schema cache** — หลัง ALTER TABLE → run `NOTIFY pgrst, 'reload schema'`
   ไม่งั้นเจอ PGRST204 "Could not find column"

3. **Postgres lte กับ timestamptz** — `lte.YYYY-MM-DD` = midnight ของวันนั้นเท่านั้น
   ใช้ `lt.<nextDay>` แทน หรือ append `T23:59:59.999Z`

4. **Mobile/Slow network** — supabase JS lib (`auth.getSession()`) อาจ hang ตลอด
   ใช้ `window._sbAccessToken` cache + AbortController timeout 15s

5. **4-point route checklist** — เพิ่ม route ใหม่ต้องแก้ 4 จุด:
   - index.html (button + section)
   - main.js ALL_ROUTES list
   - main.js ROUTE_GROUP map
   - main.js routeTitles + showRoute handler

---

---

## 📦 Phase 88.5 — FINAL (Opening Balance + Export Bundle) (8 พ.ค.)

### 🎉 จบ Phase 88!
ระบบบัญชีครบสมบูรณ์ — รองรับทุก use case ตั้งแต่บันทึกรายการจน export ส่งสำนักงานบัญชี

### What shipped (5.34.8 build 175)

**1. `modules/accounting/opening_balance.js` (~250 lines — NEW):**
- หน้า wizard ลง JV ประเภท OB (Opening Balance) — ลงวันที่ effective date 2026-01-01
- 3 sections (สีตามมาตรฐาน):
  - 🟦 **Asset (Dr):** 1110/1120/1130/1140/1200/1300 — เงินสด/เงินฝาก/ลูกหนี้/สินค้าคงเหลือ
  - 🟥 **Liability (Cr):** 2100/2120/2200 — เจ้าหนี้/บัตรเครดิต/เงินกู้
  - 🟪 **Equity (Cr):** 3100/3200 — ทุนจดทะเบียน/ทุนของเจ้าของ
- **Live balance check** — แสดง Dr / Cr / ผลต่าง realtime ขณะกรอก
- ปุ่มบันทึกใช้ได้ก็ต่อเมื่อ Dr = Cr (validate ก่อน confirm)
- หลัง save → POST entry + lines → JV `OB2026010001` doc_type=OB
- หลังลง OB → Balance Sheet จะแสดงตัวเลขเป็นบวก (สมจริง)

**2. `modules/accounting/export_bundle.js` (~280 lines — NEW):**
- หน้า "Export ชุดรายงาน" — สร้าง Excel 1 ไฟล์ มี **4 sheets:**
  1. **Trial Balance** — Dr/Cr ทุกบัญชีในงวด
  2. **P&L** — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุน + section breaks
  3. **Balance Sheet** — Assets = L + E (cumulative since effective)
  4. **Journal** — ทุก JV พร้อม lines (วันที่/เลขที่/ประเภท/คำอธิบาย/Dr/Cr)
- ใช้ `window.XLSX` (SheetJS) ที่ load ใน index.html
- Single `fetchAll()` query → reuse data across 4 sheets (efficient)
- Period picker (month/quarter/year/custom) เหมือน TB / P&L
- Filename: `accounting_bundle_<period>_<date>.xlsx`
- ส่งสำนักงานบัญชีทาง email/Line ได้ทันที — รูปแบบ standard

### Files changed (Phase 88.5)
- `modules/accounting/opening_balance.js` — NEW
- `modules/accounting/export_bundle.js` — NEW
- `main.js` — import + 8 wire points (4 per module)
- `index.html` — 2 nav buttons + 2 sections
- `sw.js`, `modules/settings/pages.js` — bump 5.34.7→5.34.8 build 175, SW v160

### ⚠️ Cloudflare deploy pattern (จดเป็น insight final)
- Pattern ตลอด Phase 88.2-88.4: file commits → fail, empty commits → success
- Phase 88.5 อาจจะเป็นเหมือนกัน → preemptive empty commit ส่งทันทีหลัง main commit
- Root cause: ไม่ทราบ — น่าจะเป็น Cloudflare Pages API rate limit / network hiccup

### ✅ Smoke tests Phase 88.5

**Opening Balance:**
1. เมนู "บัญชี" → "📥 ลงยอดยกมา"
2. กรอกตัวอย่าง:
   - 1110 เงินสดในมือ: 50,000
   - 1130 เงินฝากธนาคาร: 100,000
   - 3100 ทุนจดทะเบียน: 150,000
3. Live balance: Dr 150,000 = Cr 150,000 ✓
4. กดบันทึก → confirm → "ยืนยันบันทึกยอดยกมา?"
5. → JV `OB2026010001` ลงวันที่ 2026-01-01
6. ไป **🏦 งบดุล** → ดูตัวเลขเป็นบวก

**Export Bundle:**
1. เมนู "บัญชี" → "📦 Export ชุดรายงาน"
2. เลือก period: เดือน 05/2026
3. กดปุ่มดาวน์โหลด → progress steps (ดึง → aggregate → สร้าง)
4. ได้ไฟล์ `accounting_bundle_05_2026_<date>.xlsx`
5. เปิดดู — มี 4 sheets ครบ (TB, PL, BS, Journal)

---

## 🎯 Phase 88 — สถานะสุดท้าย (FINAL)

| Sub-Phase | สถานะ | สิ่งที่ลง |
|---|---|---|
| 88.0 | ✅ | Foundation — 51 accounts + JV + lines + manual form |
| 88.1a | ✅ | Auto-post sales + expenses |
| 88.1b | ✅ | Auto-post receipts + service jobs + Backfill UI |
| 88.2 | ✅ | Trial Balance report |
| 88.3 | ✅ | P&L report |
| 88.4 | ✅ | Balance Sheet report |
| **88.5** | **✅** | **Opening Balance wizard + Export bundle** |

**สมบูรณ์ครบทุก spec ที่ user ขอตอนเปิด Phase 88:**
- ✅ "ใกล้เคียง FlowAccount" — TB / PL / BS ครบ + auto-post + Backfill
- ✅ "ทำได้ดีกว่า" — auto-post จาก source (FlowAccount ต้องลง JV manual)
- ✅ "ส่งสำนักงานบัญชีได้จริง" — Export bundle 4 sheets standard format

### Pending ที่อาจทำในอนาคต (ไม่อยู่ใน Phase 88)
- 88.6: Drill-down (click JV → drawer with source link)
- 88.7: Mapping editor UI (admin แก้ EXPENSE_CATEGORY_MAP)
- 88.8: Period close + Lock periods
- 88.9: Comparative reports (เทียบกับงวดก่อน + กราฟ trend)
- 89.x: VAT support (ถ้า user จด VAT ในอนาคต)

---

---

## 🏦 Phase 88.4 — งบดุล Balance Sheet (8 พ.ค.)

### Why
หลัง P&L แล้ว → user ต้องการ Balance Sheet (งบดุล) ที่แสดงสถานะ ณ จุดเวลา
ใดเวลาหนึ่ง — สมการ Assets = Liabilities + Equity

### What shipped (5.34.7 build 174)

**`modules/accounting/balance_sheet.js`** (~310 lines — NEW):

**Logic — closing balance (cumulative):**
- BS ใช้ closing balance ตั้งแต่ effective date (2026-01-01) ถึง "as of date"
- ไม่ใช่ movement ในงวด → query JV ทั้งหมด since effective date

**Per-account balance:**
- Asset (1xxx)     → Dr - Cr (normal Dr balance)
- Liability (2xxx) → Cr - Dr (normal Cr balance)
- Equity (3xxx)    → Cr - Dr (normal Cr balance)
- Filter accounts ที่ balance ≈ 0 ออก (ไม่แสดง)

**Retained Earnings (กำไรสะสม):**
- คำนวณ Σ(income amount) - Σ(expense amount) จาก JV ในช่วง effective→asOf
- เพิ่มเป็น row พิเศษใน Equity section (รหัส 3900)
- ถ้าเป็นลบ → label "ขาดทุนสะสม" + สีแดง

**Equation card:**
- แสดง สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- สีเขียว ถ้า balance / สีแดง + ผลต่าง ถ้าไม่
- Visual: 2 ตัวเลขใหญ่ + เครื่องหมาย =

**Negative number warning:**
- ถ้า total assets < 0 หรือ total equity < 0 → แสดง info card สีส้ม
- บอก user ว่า "ระบบยังไม่มี opening balance" + แนะนำให้ลง JV ประเภท OB
- (Phase 88.5 จะมี OB wizard UI)

**UI inputs:**
- Single date picker "ณ วันที่" (default = today, min = 2026-01-01)
- Export Excel + พิมพ์ — เหมือน TB / P&L

### Files changed (Phase 88.4)
- `modules/accounting/balance_sheet.js` — NEW (~310 lines)
- `main.js` — import + 4 wire points
- `index.html` — nav button "🏦 งบดุล" + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.6→5.34.7 build 174, SW v159

### ⚠️ Cloudflare deploy pattern (จดเป็น insight)
ตั้งแต่ Phase 88.2 deploys เริ่ม fail สำหรับ commits ที่มีไฟล์ใหม่ใน
`modules/accounting/*` — empty commit re-trigger แก้ได้ทุกครั้ง
- 0e25d04 (88.2): fail → cbea042 (empty): success
- 51ebd39 (88.3): fail → 08fbe1f (empty): success
- 088aaaa? (88.4): expect fail → empty re-trigger

อาจเป็น Cloudflare API rate limit หรือ wrangler-action transient — ไม่กระทบ
production (เพราะ Cloudflare Pages เก็บ deploy ก่อนหน้าไว้)

**Not investigated yet:** ลอง batch 2 commits → empty re-trigger as standard
practice หรือเปลี่ยน workflow ใช้ `--keep-cache` หรือลด file count ใน upload

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "🏦 งบดุล"
2. As-of date default = วันนี้ → load ทันที
3. **คาดผลปัจจุบัน (data ของ user หลังลบ JV):**
   - 🟦 Assets:
     - 1110 เงินสดในมือ: -115,388 (สีแดง — เพราะ Cr มากกว่า Dr)
     - 1130 เงินฝากธนาคาร: -13,870
     - รวม: -129,258
   - 🟥 Liabilities: ไม่มี → 0.00
   - 🟪 Equity:
     - 3900 ขาดทุนสะสม: -129,258 (จาก P&L)
     - รวม: -129,258
   - **Equation: -129,258 = 0 + (-129,258) ✓** สีเขียว balance
   - ⚠️ Info card สีส้ม: "ตัวเลขลบ — ยังไม่มี opening balance"
4. Export Excel — section breaks + 4 columns + total rows
5. พิมพ์ → popup window

### Pending Phase 88.5
- Export bundle — ดาวน์โหลด PDF + multi-sheet Excel ของ TB + PL + BS รวมกัน
- (Optional) Opening Balance wizard — admin เซต ทุน/เงินสดเริ่มต้น

---

---

## 📈 Phase 88.3 — P&L (งบกำไรขาดทุน) (8 พ.ค.)

### Why
หลัง Trial Balance แล้ว → user ต้องการรู้ผลประกอบการ — **กำไร/ขาดทุนสุทธิ**
รายเดือน เพื่อตัดสินใจธุรกิจ + ส่งสำนักงานบัญชี

### What shipped (5.34.6 build 173)

**`modules/accounting/profit_loss.js`** (~280 บรรทัด — NEW):

**Logic ที่ตรงตามมาตรฐานบัญชี:**
- รายได้ (4xxx) — normal Cr balance → `amount = credit - debit`
- ค่าใช้จ่าย (5xxx) — normal Dr balance → `amount = debit - credit`
- **กำไรสุทธิ = รวมรายได้ - รวมค่าใช้จ่าย**

**Layout:**
- Section 1: 🟢 รายได้ (เขียว) — แสดงทุก 4xxx ที่มียอด
- "หัก" separator
- Section 2: 🟠 ค่าใช้จ่าย (ส้ม) — แสดงทุก 5xxx ที่มียอด
- **Net Income card** — สีเขียวถ้ากำไร / สีแดงถ้าขาดทุน
  - ขาดทุนแสดงในวงเล็บ `(฿XXX)` ตามมาตรฐาน
  - **Margin %** = net / revenue (ถ้ามีรายได้)

**Period picker + Export Excel + พิมพ์** เหมือน Trial Balance

### Files changed (Phase 88.3)
- `modules/accounting/profit_loss.js` — NEW (~280 lines)
- `main.js` — import + 4 wire points (ALL_ROUTES, ROUTE_GROUP, routeTitles, showRoute)
- `index.html` — nav button "📈 งบกำไรขาดทุน" + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.5→5.34.6 build 173, SW v158

### Architecture note
Reuse `fetchData` + `aggregate` pattern จาก trial_balance.js (ไม่ shared utility ทันที — wait until 88.4 มี balance sheet เพราะต้อง logic แตกต่าง)

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "📈 งบกำไรขาดทุน"
2. Default = พ.ค. 2026 → load ทันที
3. **คาดผลปัจจุบัน (data ของ user หลังลบ JV):**
   - รายได้: ไม่มีรายการ (ยังไม่ได้ขายจริง)
   - ค่าใช้จ่าย: 5210 (988) + 5260 (125,270) + 5900 (3,000) = **129,258**
   - **ขาดทุนสุทธิ: (129,258.00)** — สีแดง
   - Margin: -∞ % (เพราะ revenue = 0) → จะไม่แสดง
4. Export Excel — header "หมวด/รหัส/ชื่อบัญชี/จำนวนเงิน" + section breaks + total + net
5. พิมพ์ → popup window พิมพ์ได้

### Pending Phase 88.4-88.5
- 88.4: Balance Sheet (งบดุล) — สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
  - ต้อง opening balance → จุดต่อ Phase ที่ซับซ้อนกว่า TB/PL (ต้อง running balance)
- 88.5: Export bundle — PDF (TB + PL + BS) ในไฟล์เดียว + multi-sheet Excel

---

---

## 📊 Phase 88.2 — Trial Balance Report (8 พ.ค.)

### Why
หลัง Backfill เสร็จ + ลบ JV ทดสอบ → user มีข้อมูลจริง 5 PV ใน พ.ค. → ต้องการ
รายงานยอดทดลอง (trial balance) เพื่อส่งสำนักงานบัญชี + ตรวจ Dr = Cr

### What shipped (5.34.5 build 172)

**`modules/accounting/trial_balance.js`** (~290 บรรทัด — NEW):

**Period picker:**
- 4 modes: month / quarter / year / custom range
- Auto-default = เดือนปัจจุบัน
- Reactive UI — เปลี่ยน tab → re-render input controls

**Data fetch (3 queries):**
1. journal_entries — list ids ที่ doc_date ใน range + status='approved'
2. journal_lines — bulk fetch ผ่าน `entry_id=in.(...)` (chunked 200/batch)
3. chart_of_accounts — full COA สำหรับ map name + type

**Aggregate:**
- Group lines by `account_code` → sum debit + credit ทุก line
- Group accounts by `type` (asset/liability/equity/income/expense)
- Sort by code

**Render:**
- 5 sections (asset/liability/equity/income/expense) — เฉพาะ section ที่มี data
- แต่ละ section มี subtotal Dr/Cr
- Grand total card สีเขียวถ้า balanced (Dr=Cr) / สีแดงถ้าไม่
- Header card: ชื่องวด + range + จำนวนบัญชีที่เคลื่อนไหว

**Actions:**
- 📤 **Export Excel** — sheet "TB_YYYY-MM_YYYY-MM" + 5 columns
  (รหัส | ชื่อบัญชี | ประเภท | เดบิต | เครดิต) + total row
- 🖨 **พิมพ์** — popup window with `<style>` + auto window.print()

### Files changed (Phase 88.2)
- `modules/accounting/trial_balance.js` — NEW (290 lines)
- `main.js` — import + 4 wire points (ALL_ROUTES, ROUTE_GROUP, routeTitles, showRoute)
- `index.html` — nav button (ใต้ "ผังบัญชี" — ก่อน Backfill) + `<section id="page-accounting_trial_balance">`
- `sw.js`, `modules/settings/pages.js` — bump 5.34.4→5.34.5 build 172, SW v157

### ⭐ ใช้ "4-point checklist" ที่จดในบทเรียน Phase 88.1b
- [✓] index.html — button + section
- [✓] ALL_ROUTES (line 863)
- [✓] ROUTE_GROUP (line 899)
- [✓] routeTitles + showRoute handler

### ✅ Smoke tests ที่ควรผ่าน
1. เมนู "บัญชี" → "📊 รายงานยอดทดลอง" (อยู่ระหว่าง "ผังบัญชี" และ "Backfill")
2. Default mode = เดือนปัจจุบัน → auto-load TB ของ พ.ค. 2026
3. แสดง:
   - Section "ค่าใช้จ่าย": 4-5 บัญชี (5210/5220/5260/5900?) รวม Dr ~129K
   - Section "สินทรัพย์": 1110 (เงินสด) Cr ~129K
   - Grand total: Dr 129,258 / Cr 129,258 / ผลต่าง 0 → ✅ balance สีเขียว
4. เปลี่ยนเป็น "ปี 2026" → ดูทุก JV (รวมเดือนหน้าๆ ที่จะมี)
5. Export Excel → ไฟล์ `trial_balance_2026-05-01_2026-05-31_<date>.xlsx`
6. พิมพ์ → popup window พิมพ์ได้

### ⚠️ Known caveats
- Trial Balance ตอนนี้เป็น **Movement-based** (ผลรวม Dr/Cr ในงวด) — ไม่ใช่
  closing balance — เพราะระบบยังไม่มี opening balance (Phase 88.5 จะทำ)
- ถ้า user manual delete JV เฉพาะ entry → CASCADE จะลบ lines อัตโนมัติ
  (foreign key ON DELETE CASCADE) — ดังนั้นไม่มี orphan lines

### Pending Phase 88.3-88.5
- 88.3: P&L (กำไรขาดทุน) report — รายได้ - ค่าใช้จ่าย = กำไรสุทธิ
- 88.4: Balance Sheet — สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ
- 88.5: Export bundle ส่งสำนักงานบัญชี (PDF + CSV หลายชีท)

---

## ✅ Phase 88.1b — Verified end-to-end (8 พ.ค. ตอนเย็น)

**Backfill stress-test:** user ติ๊ก sales + expenses + receipts + service_jobs,
range 01/04/2026 → 08/05/2026 → preview แสดง 91 rows (84 sales + 7 expenses,
receipts/service_jobs = 0) → run → สำเร็จ 90/91 (1 อันเก่ามี JV แล้ว)

→ สมุดรายวันก่อน 3 รายการ → หลัง **93 รายการ** (Phase 88.1a 3 + Backfill 90)

JV ที่ Backfill สร้างย้อนหลังถึง:
- PV2026040001 (เติมน้ำมัน 12/04 ฿1,000)
- SV2026040071 (ขาย 16/04 ฿11,900)
- PV2026050004 (แอร์ 30,000btu 2 ตัว ฿60,000) ฯลฯ

→ trial balance ของเดือน เม.ย.-พ.ค. 2026 **ครบจริง 100%** — สำนักงานบัญชีพร้อมใช้

### Hotfix 5.34.4 (build 171)
ปัญหา: `ALL_ROUTES` ใน main.js line 863 ไม่ได้รวม `accounting_backfill`
→ `canAccessPage("accounting_backfill")` return false → showRoute redirect → กดปุ่มไม่เข้า

แก้: เพิ่ม `"accounting_backfill"` ใน ALL_ROUTES list (1 บรรทัด)

### Lesson learned สำหรับเพิ่ม route ในอนาคต
**4 จุดต้องแก้พร้อมกัน** เวลาเพิ่ม route:
1. `index.html` — `<button data-route="X">` + `<section id="page-X">`
2. `main.js ALL_ROUTES` — list (สำหรับ canAccessPage)
3. `main.js ROUTE_GROUP` — group สำหรับ auto-open sidebar
4. `main.js routeTitles` + `showRoute` — title + render handler

(ลืม #2 ใน Phase 88.1b initial → ต้อง hotfix 171)

---

---

## ⏪ Phase 88.1b — Receipts/Service Jobs auto-post + Backfill UI (8 พ.ค.)

### Why
หลัง Phase 88.1a ทำ sales + expenses เสร็จ — ยังเหลือ source อีก 3 ตัว
(receipts, service_jobs, payroll) + ต้องมี backfill UI เพื่อ post JV ย้อนหลัง
ให้ rows เก่าก่อน Phase 88.1a deploy (ไม่งั้น trial balance ไม่ครบ)

### What shipped (5.34.3)

**1. `modules/accounting/auto_post.js` updates:**
- ขยาย `EXPENSE_CATEGORY_MAP` รวม `salary` / `labor_hire` / `payroll` / `materials` / `utilities`
  - ⭐ **สำคัญ:** Payroll ไม่ต้อง wire ตรง — เพราะ Phase 76 (`payroll.js _markPaid`)
    auto-create expense category=salary ตอนกดจ่าย → expense.js wire (Phase 88.1a)
    จะ trigger postJournalForExpense → ใช้ mapping `payroll_salary` (Dr 5200 / Cr 1110)
- เพิ่ม **`postJournalForReceipt(receipt)`** — RV doc_type
  - default `receipt_payment` (Dr 1110 / Cr 1200)
  - ถ้า `payment_method` มี transfer/โอน/qr/bank → `receipt_transfer` (Dr 1130 / Cr 1200)

**2. Wire 3 จุด:**
- `modules/receipts.js`:
  - dropdown action "เก็บเงิน" (line 442) + button "rcPreviewCollect" (line 671) →
    หลัง PATCH status=paid สำเร็จ → fire `postJournalForReceipt({ ...r, paid_at: now })`
- `main.js saveServiceJob`:
  - import `postJournalForServiceJob`
  - เพิ่ม `{ returnData: true }` ใน xhrPost — ขอ id กลับมา
  - ตรวจ `transitionedToDone || newJobAlreadyComplete` → fire postJournalForServiceJob
  - ใช้ `state.serviceJobs[idx]` (มี total_cost) เป็น input — ไม่ใช่ payload (อาจไม่มี total_cost)
- ⭐ **Payroll:** ผ่าน expense flow auto (จาก Phase 76 + Phase 88.1a) — verified design

**3. `modules/accounting/backfill.js` (NEW — 305 บรรทัด):**
- Page `accounting_backfill` — UI ติ๊ก source (sales/expenses/receipts/service_jobs)
  + date range → Preview / Run
- **Preview mode:** query existing JV → สรุป "รวม / มีอยู่แล้ว / จะสร้างใหม่" ต่อ source
- **Run mode:** loop ทุก row → call postJournalForX — ผ่าน idempotency (HTTP 409 →
  return null = "skipped"); progress bar live update; collected error log (collapsible)
- Effective date check: 2026-01-01 — clamps `from < cutoff` → use cutoff
- Receipts/service_jobs filter pre-loop: `status=eq.paid` / `status=in.(done,delivered,closed)`

**4. Navigation:**
- `index.html`: nav button "⏪ Backfill ย้อนหลัง" + section `page-accounting_backfill`
- `main.js`: route `accounting_backfill` (group "accounting" + label "Backfill JV ย้อนหลัง" +
  call `renderBackfillPage(ctx)` ใน showRoute)

### Files changed (Phase 88.1b)
- `modules/accounting/auto_post.js` — 23 → 24 mappings + postJournalForReceipt function
- `modules/accounting/backfill.js` — NEW (Backfill UI page)
- `modules/receipts.js` — wire 2 จุด (dropdown + preview button)
- `main.js` — import postJournalForServiceJob + wire saveServiceJob + route accounting_backfill
- `index.html` — nav button + section
- `sw.js`, `modules/settings/pages.js` — bump 5.34.2→5.34.3 build 170, SW v155

### Architecture decision: ทำไม Payroll ไม่ wire ตรง
| Approach | ข้อดี | ข้อเสีย |
|---|---|---|
| Wire ตรงที่ `payroll.js _markPaid` | ชัดเจน — JV เกิดจาก source ตรงๆ | ❌ Duplicate — Phase 76 auto-create expense ก็ trigger postJournalForExpense → JV เกิด 2 ครั้ง (PV จาก payroll + PV จาก expense) เพราะ source_table ต่างกัน → ผ่าน idempotency unique → ผิด |
| ⭐ ใช้ expense flow (Phase 76) | JV เกิดครั้งเดียว — สอดคล้อง principle "1 transaction = 1 JV" | ต้องเพิ่ม mapping `salary` ใน EXPENSE_CATEGORY_MAP (ทำแล้ว) |

→ Decision: **expense flow only** — เพิ่ม mapping `salary` → `payroll_salary` (Dr 5200 / Cr 1110)

### ✅ Smoke tests ที่ควรผ่าน
1. ทำ POS sale (เงินสด) → SV เกิด ✅ (verified ใน 88.1a)
2. เพิ่ม expense (fuel) → PV เกิด ✅ (verified ใน 88.1a)
3. **เก็บเงินใบเสร็จ (status pending → paid)** → RV เกิด Dr 1110/1130 / Cr 1200
4. **บันทึกงานช่างใหม่ status=done** → SV เกิด (ถ้ามี total_cost)
5. **เปลี่ยน status งานเก่า → done/delivered/closed** → SV เกิด
6. **จ่ายเงินเดือน** (markPaid) → expense salary เกิด → PV เกิด Dr 5200 / Cr 1110/1130
7. **Backfill UI:** เลือก source + date range → Preview แสดงจำนวน → Run → progress bar → summary

### ⚠️ Known caveats
- Service jobs ที่ **ไม่มี total_cost** → postJournalForServiceJob return null silent
  → user ต้องกรอกยอดก่อน หรือ JV จะไม่เกิด (admin ต้องสร้าง manual JV แทน)
- Backfill ใช้ idempotency unique index — ถ้า admin เคย create manual JV ที่
  source_table+source_id ซ้ำ → backfill skip (ดี — กัน duplicate)

### Pending Phase 88.2-88.5
- 88.1c: Drill-down (click JV row → drawer with source link) + mapping editor UI
- 88.2: Trial Balance report (filter ตาม fiscal period)
- 88.3: P&L (กำไรขาดทุน) report
- 88.4: Balance Sheet (งบดุล) report
- 88.5: Export bundle ส่งสำนักงานบัญชี (PDF + CSV ของทุก JV + รายงาน)

---

## 🛠️ Phase 88.1a-fix — Wire auto-post ที่ pos.js + RLS hotfix (8 พ.ค.)

### ปัญหาที่เจอตอน user test build 168
1. **ตาราง `journal_entries` ว่างเปล่า** ทุกครั้งที่ขายจริง
2. แต่ test ผ่าน console import ตรง → `postJournalForSale` insert ได้สำเร็จ

### 2 root causes (สำคัญสำหรับ session ต่อ)

**Root cause #1 — RLS ของ Phase 88.0 block INSERT:**
- `is_accountant()` ตรวจ `role = 'admin'` เท่านั้น
- RLS `je_admin` / `jl_admin` ใช้ `FOR ALL` → block INSERT จาก non-admin users
- Cashier/owner ขาย → POST JV ตก HTTP 403 → fire-and-forget เก็บ console.warn

→ **Fix:** `supabase-phase88-hotfix-rls.sql` (ไฟล์ใหม่)
- Split `je_admin` / `jl_admin` เป็น 4 policy แยก (SELECT/UPDATE/DELETE = accountant, INSERT = accountant OR source-linked)
- เปิด `account_mapping` SELECT ให้ทุก authenticated (client ต้องอ่าน mapping)
- Total: 10 policies (4+4+2)

**Root cause #2 — Wire auto-post ผิดไฟล์ใน build 168:**
- main.js มี `async function checkout()` (line 3077) — **legacy ที่ไม่ถูกเรียกแล้ว**
- POS จริงใช้ `doCheckout()` ใน `modules/pos.js` line 919
- Build 168 wire ที่ main.js → ขายจริงไม่ trigger

→ **Fix (build 169):** ย้าย wire ไปที่ `modules/pos.js` หลัง `showToast("บันทึกการขายเรียบร้อย ✅")`
- เก็บ wire เก่าใน main.js ไว้ — ไม่ทำงานแต่ idempotent กัน duplicate

### Verification (build 169)
Console ตอนขายจริง:
```
[auto_post] ✅ created SV2026050001 from sales #119 amount 50
```
สมุดรายวัน → SV2026050001 ขาย POS BSK-1778227814186 ฿50 status "อนุมัติแล้ว"

### Files changed (Phase 88.1a-fix)
- `supabase-phase88-hotfix-rls.sql` — NEW (RLS split policies, 10 policies)
- `modules/pos.js` — import + wire postJournalForSale ใน doCheckout
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.34.1→5.34.2 build 169, SW v154

### ⚠️ Lesson learned (สำคัญสำหรับ Phase 88.1b)
**ก่อน wire auto-post — ตรวจ source module ที่ใช้จริง:**
- `pos.js doCheckout()` (sales) — ✅ wired
- `expenses.js expFormSaveBtn` (manual expense) — ✅ wired
- `expenses.js akSaveBtn` (AutoKey OCR) — ✅ wired
- `receipts.js` — TBD (ตรวจไฟล์จริง — อาจอยู่ใน main.js หรือ module แยก)
- `service_jobs` — TBD (เคยอยู่ใน main.js — ต้อง grep)
- `payroll.js` — TBD (มี module แยกอยู่)

**ห้ามแก้ `main.js` แล้วคิดว่าครอบคลุม** — โครงสร้างหลัง refactor 86 → ทุก source flow อยู่ใน `modules/*.js`

---

## 🧾 Phase 88.1a — Auto-post JV (sales + expenses) (8 พ.ค.)

### Why
User ขอ "หน้าบัญชีให้ใกล้เคียง FlowAccount และทำได้ดีกว่า — ส่งสำนักงานบัญชีใช้ได้
จริง" + ตอบ scope: VAT B (ไม่จด), COA B (ส่ง CSV), period month/quarter/year,
start 2026-01-01, path A (sequential 88.0 → 88.5)

Phase 88.0 (build 167) วาง foundation (chart_of_accounts + journal_entries
+ lines + manual JV form) เสร็จแล้ว → 88.1a เริ่ม auto-posting จาก source
transactions แทนการกรอก JV ด้วยมือทุกครั้ง

### What shipped (5.34.1)

**SQL migration** (`supabase-phase88-auto-post.sql`):
1. **Idempotency** — partial unique index บน `journal_entries (source_table,
   source_id) WHERE NOT NULL` → POST ซ้ำได้ HTTP 409 → return null (manual
   JV ที่ source = NULL ใส่ได้หลายอันตามปกติ)
2. **`account_mapping` table** — config ผูก `mapping_key` →
   `debit_account_code` / `credit_account_code` + RLS admin only
3. **22 seed mappings:**
   - Sales: 4 (sale_cash 1110/4100, sale_transfer 1130/4100, sale_credit
     1130/4100, sale_credit_term 1200/4100)
   - Expenses: 10 (fuel/utility/phone/rent/repair/supplies/ads/bank_fee/
     travel/misc — Dr 5xxx / Cr 1110)
   - Service jobs: 5 (install/repair/clean/move/other AC — Dr 1110 / Cr 4xxx)
   - Receipts: 2 (cash 1110/1200, transfer 1130/1200)
   - Payroll: 2 (salary 5200/1110, wht 5200/2140)

**JS module** (`modules/accounting/auto_post.js` — 330 บรรทัด):
- `postJournalForSale(sale)` — POS sale → SV (ดู `payment_method` →
  ระบุ mapping_key: cash/transfer/credit/credit_term)
- `postJournalForExpense(expense)` — expense → PV (ดู `category` →
  EXPENSE_CATEGORY_MAP → mapping; override credit account ถ้า
  `payment_method = transfer/credit`)
- `postJournalForServiceJob(job)` — service → SV (เฉพาะ status
  delivered/closed/done)
- `resetMappingCache()` — เรียกหลัง admin แก้ mapping
- Effective date: skip ถ้า docDate < `2026-01-01`
- Mapping cache: lazy-loaded once per session

**Wiring:**
- `main.js → checkout()` — หลัง `showToast("บันทึกการขายเรียบร้อย")`
  → `postJournalForSale({...}).catch(...)` (fire-and-forget)
- `modules/expenses.js → expFormSaveBtn click` — เปลี่ยน
  `_appXhrPost(...)` ให้ใช้ `{returnData:true}` เพื่อเอา id กลับมา →
  `postJournalForExpense(inserted).catch(...)`
- `modules/expenses.js → akSaveBtn click (AutoKey)` — เปลี่ยน
  `Prefer: return=minimal` → `return=representation` → parse first row →
  `postJournalForExpense(inserted).catch(...)`

### Why fire-and-forget + idempotent
ถ้า auto-post ล้มเหลว (network/RLS/missing mapping) — ไม่ block UX checkout/
expense save (user ทำงานต่อได้) แต่ console.warn เก็บไว้ debug

ถ้า user reload + retry → unique partial index จะ reject (HTTP 409) →
auto_post.js detect 409 → return null (ไม่ duplicate)

### Files changed (Phase 88.1a)
- `supabase-phase88-auto-post.sql` — NEW (idempotency + mapping + seed)
- `modules/accounting/auto_post.js` — NEW (helper เรียกจาก source modules)
- `main.js` — import + wire `postJournalForSale` ใน checkout()
- `modules/expenses.js` — import + wire 2 จุด (manual save + AutoKey)
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.34.0 → 5.34.1

### ⚠️ Manual step required (post-deploy)
**Run `supabase-phase88-auto-post.sql` ใน Supabase SQL Editor** ก่อน user
ทดสอบ — ไม่งั้น auto-post จะ fail (mapping table ไม่มี + ไม่มี idempotency
index → ขายซ้ำเดิม → JV ซ้ำ)

### ✅ Smoke test ที่ควรผ่าน
1. หลังรัน SQL: `SELECT count(*) FROM account_mapping` → 22
2. ทำ POS sale 1 ครั้ง (cash) → เปิดสมุดรายวัน → JV เลข `SV202605####`
   ปรากฏ Dr 1110 / Cr 4100
3. เพิ่ม expense category=fuel 200 บาท (cash) → เปิดสมุดรายวัน → JV
   `PV202605####` Dr 5210 / Cr 1110
4. AutoKey OCR สลิป → save → JV เกิดเหมือนกัน
5. ทำขายซ้ำ id เดิม (manual SQL test) → console "[auto_post] already
   posted" + ไม่ duplicate

### Pending Phase 88.1b/c (next session)
- 88.1b: receipts.js + service_jobs (in main.js) + payroll.js wires +
  backfill UI (post existing pre-2026-05 sales/expenses retroactively)
- 88.1c: Drill-down (click JV row → drawer with source link) + mapping
  editor UI (admin แก้ mapping_key → account ใน Settings)
- 88.2-88.5: Trial Balance + P&L + BS reports + WHT + Export bundle

---

## 🏛️ Phase 88.0 — Accounting Foundation (8 พ.ค.)

### What shipped (5.34.0 build 167 — already pushed)
- `supabase-phase88-accounting-foundation.sql` — chart_of_accounts (51
  Thai accounts), journal_entries (with je_balanced CHECK Dr=Cr),
  journal_lines (line_one_side CHECK), fiscal_periods, is_accountant()
  helper, 4 RLS policies admin-only
- `modules/accounting/journals.js` — JV list (status chip + filter)
- `modules/accounting/journal_form.js` — manual JV form (auto doc_no
  `JV2026MM####`, balance validator)
- `modules/accounting/coa.js` — COA management (stats + collapsible +
  CSV/Excel import/export with Thai aliases)

---

## 🌱 Phase 87.5 — Full Catalog Spec Seed (7 พ.ค.)

### Why
User: "211 SKUs ที่ยังต้องกรอก specs (admin task) ช่วยผมหาข้อมูลจริง มากรอก
ช่วยผมหน่อย" → กรอกเองด้วย UI editor ใช้เวลา ~28 ชั่วโมง — ขอ Claude
generate ตาม brand/BTU patterns แล้ว user ค่อยตรวจ/ปรับเฉพาะรุ่นที่ต้องการ

### What shipped (5.33.5)
- **211 SKUs** ได้ specs เพิ่ม (จาก 12/223 → 223/223 = **100% coverage**)
- ใช้ Python script `scripts/seed_specs.py` (~640 บรรทัด) — generate ตาม
  per-section template (45+ section templates) + per-BTU class scaling
- Cache logic เปลี่ยน: เดิมเช็ค "มี features ไหม" (ผ่านแม้ 12/223) →
  ใหม่เช็ค **ratio ≥90% ของ entries** ถึงไม่ refetch (force refresh user เก่า)

### Strategy / Honest caveats
**Top brands (TCL/Carrier/LG/Samsung/Daikin/Mitsubishi/Haier/Hisense/Gree/
Midea/Toshiba):** Description, features, badges อ้างอิงตาม spec จริง
ของ brand line (Dual Inverter ของ LG, WindFree ของ Samsung, Mr.SLIM
ของ Mitsubishi Electric, Streamer Discharge ของ Daikin ฯลฯ)

**Smaller TH brands (FRIO, MAVELL, STAR AIR, AUFIT, AIR COOL, CANDY,
AUX, CENTRAL AIR, SAIJO DENKI):** Defaults ตาม Inverter/Fix-Speed type +
BTU class — sensible แต่ไม่ใช่ official spec sheet

**Physical specs (dim, weight, current, power, noise, SEER):** ค่าโดย
ประมาณตาม BTU class (industry typical ranges สำหรับตลาดไทย)

**Refrigerant:** R32 สำหรับรุ่นใหม่, R410A สำหรับ DAIKIN SMASH 2018
(รุ่นเก่า)

### Files changed
- `data/ac_catalog.json` — 64KB → 280KB (211 entries gained 16 spec fields)
- `main.js` — cache refresh threshold ratio-based (Phase 87.5)
- `scripts/seed_specs.py` — NEW (generator + 45+ section templates)
- `index.html`, `sw.js`, `modules/settings/pages.js` — bump 5.33.4→5.33.5

### Refinement workflow
- **UI editor** (Phase 87.2) ปรับทีละรุ่น — แก้ description ให้ตรงสเปกจริง
- **Excel bulk** (Phase 87.3) — export → แก้ใน Excel → import กลับ
- **Copy spec** (Phase 87.4) — ใช้รุ่น A เป็น template ของ B รุ่นใกล้เคียง

### ✅ Smoke test ที่ควรผ่าน
- Customer คลิก card สุ่มจาก section ใดก็ได้ → modal เปิด + spec table ครบ
- Admin export Excel → ตรวจ 24 columns × 223 rows + non-empty cells
- Console log: `[ac_catalog] refreshed: 223 entries, 223 with specs`

---

## 🛍️ Phase 87 — Product Detail Modal & Spec Management (7 พ.ค.)

### Why
User: "หาข้อมูลสินค้ามาใส่ สเปกเครื่อง BTU แต่ละรุ่น ให้ลูกค้าคลิกดูรายละเอียดข้างในได้
เหมือนร้านมืออาชีพ หรือห้างเขาขายสินค้า"

### What shipped
**4 commits**, 2 ไฟล์ใหม่ใน `modules/`, 1 ไฟล์ใหม่ใน `modules/settings/`,
schema v2 ของ `data/ac_catalog.json` (24 fields ต่อ entry), 12 SKUs seeded
ครอบคลุม 6 แบรนด์ (TCL/Carrier/LG/Daikin/Mitsubishi).

### 🎨 Phase 87.1 — Product Detail Modal foundation
**ไฟล์ใหม่:** `modules/product_detail_modal.js` (212 lines)

**Schema v2 — 16 extended fields** (optional):
```
description, features (array), badge_tags (array), image_url,
seer, refrigerant, voltage, current_a, power_w,
indoor_dim, outdoor_dim, indoor_weight_kg, outdoor_weight_kg,
noise_indoor_db, noise_outdoor_db, color
```

**Modal layout (เหมือนหน้าสินค้าห้างใหญ่):**
- Hero image (placeholder ❄️ ถ้าไม่มี image_url)
- Badge tags (ขายดี / Inverter / WiFi) มุมซ้ายบน + BTU pill มุมขวาล่าง
- Title + price + "รวมติดตั้ง" + Description paragraph
- Warranty bar (ติดตั้ง/อะไหล่/คอม)
- Features list (pill style)
- Spec table — render เฉพาะ field ที่มีค่า; placeholder "ยังไม่มีข้อมูลสเปก" ถ้าว่าง
- Sticky footer: ปิด + CTA (เพิ่มลงตะกร้า / สั่งจอง)
- ESC + click-outside dismiss + mobile-friendly (full-screen <640px)

**Wired ใน customer_dashboard.js:**
- `import { openProductDetail }`
- Spread `...c` ใน `products = catalog.map(...)` เพื่อ keep extended fields
- Click `[data-view-product]` card → openProductDetail
- Card "+ ลงตะกร้า" button: stopPropagation กัน double-trigger

**Seed 2 SKUs:** id=1 MFS10, id=5 T-PROWD10

### 🔧 Phase 87.1.1 — Schema auto-refresh hotfix
**Bug:** localStorage cache v1 → JSON v2 ไม่ถูก load → modal เห็นแค่ BTU
**Fix in main.js:** หลัง parse cache ตรวจว่ามี entry ใดมี `features|seer|description`
ถ้าไม่มี (= v1) → fetch JSON v2 + overwrite + log "upgraded to v2"

### ✏️ Phase 87.2 — Admin Spec Editor + Seed
**ไฟล์ใหม่:** `modules/settings/ac-spec-editor.js` (233 lines)

`openSpecEditor(product, onSave)` — Modal form:
- Description (textarea), Features + Badges (comma input → string[])
- Image URL, SEER, refrigerant, voltage, current, power, color
- Dim: indoor/outdoor W×H×D, weights
- Noise: indoor/outdoor dB

Number fields fall back to string when range (e.g. `"0.4-4.5"`)
Empty values stripped from save diff

**Wired ใน ac-catalog.js:**
- Each row: ✏️ button — `+ สเปก` (เทา) ถ้าว่าง, `แก้` + 📋 (เขียว) ถ้ามี
- Click → openSpecEditor → save merge → localStorage + rerender + toast

**Seed 8 SKUs เพิ่ม** (รวม 12/223):
- TCL Wall standard: MFS13/19/25
- TCL Inverter WIFI: T-PROWD13/19/25
- Carrier COPPER SEAL: 38TVDB010/42TVDB010
- LG Inverter: ISC10E (Dual Inverter, 19dB whisper)
- Daikin SMASH: FTM 09 PV2S
- Mitsubishi Mr.SLIM: MSY-JZ 09 VF (SEER 18)

### 📊 Phase 87.3 — CSV/Excel Round-trip 24 columns
**Updated ac-catalog.js:**
- Helpers: `_arrToPipe`, `_pipeToArr`, `_tryNum`, `_toExportRow`,
  `_fromImportRow`, `_EXPORT_HEADERS` (24 names)
- Excel export: catalog.map(_toExportRow) + per-column widths
- CSV export: header from _EXPORT_HEADERS, body via _toExportRow
- Import: parse via _fromImportRow (column-name-tolerant English+Thai)

**Smart serialization:**
- Array fields → `"item1 | item2 | item3"` ใน cell
- Import accepts `|` or `,` as separator
- Number-or-range fields → try Number() → fallback string
- Empty fields → ไม่เก็บใน catalog (clean schema)
- **Backwards-compat:** old 8-column CSV/Excel still imports

**UI hint** ใต้ file picker — แสดงรายการ 24 fields แบ่ง 4 กลุ่ม +
ตัวอย่าง pipe separator `Inverter | WiFi | Self-Cleaning`

### ⚡ Phase 87.4 — Copy spec from another SKU (Hybrid workflow boost)
**Updated `modules/settings/ac-spec-editor.js`** — เพิ่ม `sourceList` 3rd arg

**Use case:** Admin กรอก T-PROWD10 ครบ → ต้องกรอก T-PROWD13/19/25
(BTU/dim/power ต่างกัน แต่ description/features/SEER/refrig/voltage
เหมือนกันทั้ง series) → กดปุ่ม "📥 ดูด" → form fill ทันที → แก้แค่
fields ที่ต่าง (current_a, power_w, indoor_dim, weight, noise) → save
→ เร็วกว่ากรอกเองทั้งหมด ~5x

**UI:**
- Green panel ด้านบน body (ใต้ header) — แสดงเฉพาะเมื่อ `sourceList`
  มีอย่างน้อย 1 รุ่น
- `<select>` ที่ optgroup ตาม section + แสดง model + BTU per option
- ปุ่ม "📥 ดูด" disabled จนกว่าเลือก dropdown
- Self-filter: ไม่แสดงรุ่นปัจจุบันใน dropdown
- บน click: fill 16 spec inputs (ไม่แตะ id/section/model/btu/price/stock)
- Feedback: ปุ่ม → "✅ คัดลอกแล้ว" 1.5 วินาที → กลับเป็น "📥 ดูด"

**Wired ใน `ac-catalog.js`:**
```js
const sourceList = catalog.filter(c => c.features || c.seer || c.description);
openSpecEditor(catalog[idx], onSave, sourceList);
```

**Backwards-compat:** ถ้า sourceList ว่าง (ครั้งแรกที่ใช้ — ยังไม่มี
SKU มี specs) → ไม่ render panel — back to plain editor.

### 📊 Status: 12/223 SKUs มี specs
**Remaining 211 SKUs** — admin กรอกเอง 4 วิธี (Hybrid workflow ครบ):
1. **UI editor ทีละรุ่น** (ละเอียด — Phase 87.2)
2. **Copy spec จาก SKU อื่น** (เร็ว — สำหรับ series รุ่น — Phase 87.4)
3. **Excel bulk** (เร็วสุด — 50+ รุ่นต่อรอบ — Phase 87.3)
4. **Hybrid** (รวมทุกข้อข้างต้น)

**Time-saving estimate:**
- กรอกเอง 16 fields × 30s = **8 นาที/รุ่น** → 28 ชม. สำหรับ 211 รุ่น
- Copy + tweak = **1.5 นาที/รุ่น** → ~5 ชม. (5x faster)

### Files
- `modules/product_detail_modal.js`
- `modules/settings/ac-spec-editor.js`
- `modules/settings/ac-catalog.js` (extended)
- `modules/customer_dashboard.js` (catalog spread fix)
- `main.js` (schema upgrade check)
- `data/ac_catalog.json` (12 SKUs with full specs)

### ✅ Smoke test ที่ผ่านใน production
- Customer คลิก card MFS10/13, T-PROWD10, MSY-JZ → modal สวย + spec table
- Customer คลิก card ที่ยังไม่ seed → modal เปิด + "ยังไม่มีข้อมูลสเปก"
- Admin ✏️ + สเปก → modal editor → save → ✅ 📋 ทันที
- Admin export Excel → ตรวจ 24 columns + features pipe-separated +
  range strings (`0.4-4.5`) ถูกต้อง
- Admin upload back → import 223 รุ่นสำเร็จ
- Old 8-column CSV → ยัง import ได้ (backwards-compat)
- ✅ **Phase 87.4 verified:** เปิด T-PROWD13 → dropdown "T-PROWD10 (9,000 BTU)"
  → กด "📥 ดูด" → form fill 16 fields ทันที → user แก้ description
  + dim + weight + noise → save → ✅

---

## 🚀 Phase 85-86 ที่เสร็จในรอบนี้ (7 พ.ค.)

### 📊 สถิติ Session
- **13 commits** in main.js + 4 modules ใหม่ (api_utils, otp_cooldown, auth_email, auth_otp)
- **main.js: 4,415 → 4,032 บรรทัด (-383 lines, -8.7%)**
- ปิด Phase 84 debt (confirm migration) + แก้ login race + UX dashboard + OTP cooldown
- ทุก phase ทดสอบใน production https://boonsukair.com/ แล้ว

### 🔧 Phase 85.x — Bug fix + UX

#### Phase 85.1 — login() race-condition fix
**Symptom:** Phase 84 ทำให้ "ล็อกอินไม่ได้" → revert Phase 84 ทั้งก้อน
**Root cause:** `login()` ใน main.js ขาด 3 defenses ที่ฟังก์ชันคู่ขนาน (requestStaffPasswordReset, requestOtp, verifyOtp) มีครบ:
- ❌ ไม่มี `state.supabase` guard → ถ้า boot ช้า → throw `Cannot read property 'auth' of undefined`
- ❌ ไม่มี try/catch → unhandled rejection → button stuck "กำลังเข้าสู่ระบบ..."
- ❌ ไม่มี button lock → double-click race

**Fix:** Apply pattern เดียวกับ requestStaffPasswordReset:
1. Guard `state.supabase + state.supabase.auth` → toast + return
2. `try/catch` ครอบ `signInWithPassword` + log + toast on throw
3. Button disable + restore ใน `finally`

#### Phase 85.2 + 85.2.1 — confirm() migration (Phase 84 debt)
**Why:** Phase 84 ตั้งใจ migrate native `confirm()` → `App.confirm` (Promise) แต่โดน revert ตามไป
**Migrate 6 จุด:**
- products.js (5 callsites: export filter, clear category, bulk delete x2, delete category)
- main.js:_revokeShareToken (cancel link)
- ใช้ `_appConfirm` wrapper ใน products.js (fallback `window.confirm` ถ้า App ยังไม่พร้อม)
- ใช้ `confirmAsync` (already in scope) ใน main.js

**🐛 85.2.1 hotfix:** Phase 85.2 ใส่ `await _appConfirm()` ใน arrow function ปกติของ `#prodExportBtn` click → SyntaxError → ทั้ง products.js parse fail → import chain แตก → login dead. แก้: async callback

#### Phase 85.3 — OTP cooldown UX
**Why:** User ทดสอบ OTP กดซ้ำ 6 ครั้ง → ติด Phase 17 KV rate limit (HTTP 429) → เข้าระบบไม่ได้
**Fix:** Module-scoped state + 5 helpers ใน main.js:
- `_setOtpCooldown(seconds)` — start countdown + tick ทุกวินาที
- 60s cooldown หลัง send สำเร็จ
- 5-min cooldown ถ้าได้ HTTP 429 + special toast
- `requestOtp` guard cooldown ก่อน fetch
- Button disable "⏳ กำลังส่ง..." → "รอ NN วิ" → restore

#### Phase 85.4 + 85.5 — Dashboard KPI cards (white-on-white bug)
**85.4 attempt:** เปลี่ยน 4 cards (ผู้ใช้งาน/สิทธิ์/สินค้าทั้งหมด/งานช่างค้าง) เป็น defensive IIFE — เพิ่ม fallback chain + min-height + emoji label + Thai role labels
**85.5 actual fix:** DOM inspector ยืนยัน text render OK แต่ `color: rgb(255, 255, 255)` (white) บน card สีขาว → invisible! Parent `<div class="hero">` set `color:#fff` สำหรับ headline → cards inside inherit white. แก้: explicit `color:#0f172a` ใน inline style ทุก stat-label + stat-value

### 🏗️ Phase 86.x — main.js refactor (extract auth modules)

**เป้าหมาย:** main.js 4,300+ บรรทัด ใหญ่เกินไป → แตกเป็น modules ที่ test/reuse ได้

| Phase | Module | main.js Δ | Total Δ |
|---|---|---|---|
| 86.1 | `api_utils.js` (formatPhone, getApiBase, readApiJson) | -62 | 4,287 |
| 86.2 | `otp_cooldown.js` (state + 5 public APIs) | -38 | 4,315 |
| 86.3 | `auth_email.js` (login + setPassword + reset) | -101 | 4,214 |
| 86.4 | `auth_otp.js` (requestOtp + verifyOtp + _pendingOtp) | -182 | **4,032** |

**Pattern:**
- Pure utils (api_utils) → import ตรง
- State-encapsulated (otp_cooldown) → module-private state, public API
- Stateful flow (auth_email, auth_otp) → factory pattern: `createXxxAuth({state, $, setText, showToast, ...})`
- afterLogin pass เป็น `() => afterLogin()` (lazy resolve hoisted function)

**Module dependency tree:**
```
main.js
  ├─ imports auth_email, auth_otp
  └─ const { login } = createEmailAuth({state, $, setText, showToast, afterLogin: () => afterLogin()})
     const { requestOtp, verifyOtp } = createOtpAuth({state, $, setText, showToast})

modules/
  ├─ api_utils.js       (pure - no deps)
  │    ↓ used by
  ├─ auth_otp.js        ← imports api_utils + otp_cooldown directly
  ├─ auth_email.js      (factory pattern, deps via DI)
  └─ otp_cooldown.js    (uses document.getElementById directly)
```

**Phase 85.1 race-condition guards** ยังคงครบใน auth_email.js (ไม่ regress)
**Phase 85.3 OTP cooldown UX** ยังคงครบใน otp_cooldown.js + auth_otp.js (ไม่ regress)

### ✅ Smoke test ที่ผ่านใน production
- Email login (ผิด/ถูก/forgot password) → working ✅
- Customer OTP signup ใหม่ → working (Bug F trigger fix ยังทำงาน)
- Customer OTP signin ลูกค้าเดิม → working
- OTP cooldown countdown 60s/5min → visible
- Dashboard KPI cards 4 ใบ → readable (color:#0f172a)
- confirm modals 6 จุด → ARIA dialog (App.confirm)
- ui_states empty/skeleton ใน 25+ modules → ยังทำงาน

---

## 🔧 Phase 85.1 — login() race-condition fix (7 พ.ค. รอบบ่าย)

### Why
User รายงาน Phase 84 ทำให้ "ล็อกอินไม่ได้" — revert Phase 84 ทั้งก้อน

Audit `main.js login()` function (line 1205) พบ:
- ❌ ไม่มี `state.supabase` guard — ถ้า boot ช้าจน user click ก่อน init เสร็จ → throw `Cannot read property 'auth' of undefined`
- ❌ ไม่มี try/catch — error throw → unhandled promise rejection → UI freeze (button stuck "กำลังเข้าสู่ระบบ...")
- ❌ ไม่มี button lock — double-click → race condition

ในขณะที่ `requestStaffPasswordReset` (line 1218), `requestOtp`, `verifyOtp` มี guard + try/catch ครบ

→ **Phase 84 น่าจะ slow boot นิดเดียว** (ai-chat-widget.js?v=4 → v=5 cache miss / มี code ใหม่ใน boot path) — make race condition window กว้างขึ้น → user เจอ "login เงียบ" บ่อยพอ revert

### Fix ([main.js login()](main.js))
1. **Guard `state.supabase`** — ถ้ายัง init ไม่เสร็จ → toast "ระบบยังเชื่อมต่อไม่เสร็จ — รอ 2-3 วินาทีแล้วลองใหม่"
2. **Wrap `signInWithPassword` ใน try/catch** — surface error ทันที + log
3. **Button lock + restore** — disable + แสดง "⏳ กำลังเข้าสู่ระบบ..." → restore ใน `finally`
4. **Pattern เดียวกับ `requestStaffPasswordReset`** ที่มีอยู่แล้ว — proven safe

### ❌ ไม่ retry Phase 84 ทั้งก้อน
- Phase 84 modify `showStaffLogin` Promise wrapper — uncertain root cause
- 6 จุด `confirm()` migration ยังค้าง (debt) — รอ confirmed safe

### Bump
- main.js v=150 → v=151
- SW v135 → v136
- Version 5.32.10 (build 150) → **5.32.11 (build 151)**

### Test
1. Hard refresh **Ctrl+Shift+R**
2. หน้า login → กรอก email + password ปลอม → กดเข้าสู่ระบบ
3. ✅ ต้องเห็น button disable + "⏳ กำลังเข้าสู่ระบบ..." → toast error → button restore (ไม่ค้าง)
4. ทดสอบในเบราว์เซอร์ **fresh tab** (ที่ supabase ยังไม่ init) → กดเข้าระบบ **ทันทีก่อน 2 วินาที** → ต้องเห็น "ระบบยังเชื่อมต่อไม่เสร็จ" toast (ไม่ throw silent)
5. Login ปกติ → ต้องเข้าได้เหมือนเดิม



## 🆕 Phase 83-84 ที่เสร็จในรอบนี้

### Phase 83 series (6-7 พ.ค.) — AC install + mobile UX hardening
- **Phase 83**: AC install items table mobile scroll — wrap ใน scroll container `min-width:560px` กัน column compress บนมือถือ
- **Phase 83.1**: Qty stepper +/− mobile-friendly (ปุ่มใหญ่กว่า input, no spinner)
- **Phase 83.2**: DOM surgery แทน re-render — กัน keyboard เด้งออกขณะพิมพ์ field qty/price
- **Phase 83.3**: AC install save timeout 25 วินาที + step progress UI ("กำลังตัดสต็อก", "กำลังบันทึกใบงาน") — debug ค้างหน้าบันทึก
- **Phase 83.4**: Confirm dialog mobile fix — blur active input + scrollIntoView + body scroll lock — กัน keyboard บัง modal

### Phase 84 series (6-7 พ.ค.) — Full-app audit (rolled back)
- **Phase 84 (cfc122c)**: feat — full-app audit fixes 5 batches:
  1. Mobile font overlap (stat-value clamp, customer grid auto-fill, ac_install/btu_calc grid stack, modal max-height/overflow)
  2. native `confirm()` → `App.confirm` migration (9 จุด)
  3. Promise antipattern fix ใน showStaffLogin
  4. Form input attrs (inputmode/enterkeyhint/autocomplete)
  5. Defensive base64 parsing
- **Phase 84.1 (379fd3f)**: hide AI FAB ตอน login/setPassword/confirm-modal — live test pinpoint
- **🔴 ทั้ง 84 + 84.1 ถูก REVERT** (24a4f5c, 47a53ae) — สาเหตุที่ revert ไม่อยู่ใน commit message
- **Phase 84-CSS only (c0a5fd8)**: เก็บแค่ส่วน CSS mobile fixes — ทิ้ง confirm migration + a11y JS
- **Phase 84-CSS.2 (47bef49)**: product list mobile — price/stock/wh/actions stack column บน narrow screens (CSS only)

### ⚠️ ที่ค้างจาก Phase 84 revert (debt)
- **6 จุด `confirm()` native ยังค้างอยู่** (Phase 84 ตั้งใจ migrate แต่โดน revert):
  - `modules/products.js:644` (export filter choice)
  - `modules/products.js:1949` (clear category)
  - `modules/products.js:1972, 1973` (bulk delete + reconfirm)
  - `modules/products.js:2210` (delete category)
  - `main.js:2750` (cancel link)
- **Memory rule** บอก "alert() forbidden ใช้ showToast" — confirm() ก็ควรใช้ App.confirm เหมือนกัน
- **App.confirm พร้อมใช้** — `window.App.confirm(message)` returns Promise<boolean>
- **ก่อน migrate ใหม่** — ต้องเข้าใจว่าทำไม Phase 84 revert (อาจมี bug ที่ไม่บันทึก)

## 🆕 Phase 80-82.5 ที่เสร็จในรอบนี้

- **Phase 80**: Sticker print 50×30mm — auto-print + auto-close window + strict @page
- **Phase 81**: Bluetooth printer module (`modules/bt_printer.js`) — Web Bluetooth → XP-420B + TSPL command
  - ⚠️ **ยังไม่ work บน XP-420B จริง** — เครื่องน่าจะเป็น Bluetooth Classic (passcode 0000) ไม่ใช่ BLE
  - Web Bluetooth ใช้ได้แค่ BLE → ขั้นถัดไปต้องลอง WebUSB API ผ่าน USB OTG
- **Phase 82-82.5**: Scan-loop bug fix series (รับเข้าสินค้า + นับสต็อก ลูปเพิ่มเอง)
  - **Root cause: html5-qrcode callback fires ทุก frame ตราบใดที่บาร์โค้ดอยู่หน้ากล้อง** + scanner ไม่ stop หลัง navigate
  - **Final solution (Phase 82.5)**: stop scanner ทันทีหลัง scan สำเร็จ + mutex flags (`_swAddInProgress`, `_swSaving`, `_swScannerActive`) + `isConfirmOpen()` guard + `blurStockInInputs()` + session ID invalidation

---

## 🛠️ User Configuration State (snapshot ปัจจุบัน)

**🚨 อ่านก่อนเสนอฟีเจอร์ใด ๆ — รายการนี้สรุปสิ่งที่ user setup เสร็จแล้ว**
อย่าบอกว่า "ต้อง setup X" ที่ user ทำเรียบร้อยแล้ว

### LINE Notify (Messaging API)
- **Status**: ✅ Active (verified 3 พ.ค. 2026 จาก screenshot Settings)
- **API**: ใช้ LINE Messaging API (LINE Notify เดิมถูกปิด 2025-03-31)
- **Token storage**: Cloudflare Pages → Settings → Environment variables
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_USER_ID`
- **Notif categories** (ทั้งหมด ON):
  - แจ้งเตือนสต็อกต่ำ
  - แจ้งเตือนออเดอร์ใหม่
  - แจ้งเตือนงานช่างเสร็จ
  - สรุปยอดประจำวัน
- **Server status**: เซิร์ฟเวอร์พร้อมส่ง LINE
- **Code**: [modules/line_notify.js](modules/line_notify.js) + [functions/api/line-notify.js](functions/api/line-notify.js)

### Payment (SlipOK)
- **Status**: มีระบบใน Settings → Payment Gateway
- **Token storage**: localStorage `bsk_slipok_key` + `bsk_slipok_branch`
- **ไม่รวมใน config backup/restore** (security)

### AI providers
- **Cloudflare Workers AI** (binding `AI`) — ใช้กับ ai-chat-widget สำหรับ chat ลูกค้าแจ้งซ่อม. ฟรี 10K neuron/วัน
- **Google Gemini Vision** (env `GEMINI_API_KEY`) — Phase 74 AutoKey OCR สลิป ✅ **PRODUCTION READY**
  - **Model: `gemini-2.5-flash`** (current 2026 free tier vision) — ⚠️ `gemini-1.5-flash` family ลบหมดแล้ว, `gemini-2.0-flash` มี limit:0 (paid only)
  - Fallback chain: gemini-2.5-flash → gemini-2.0-flash-lite → gemini-flash-latest → gemini-2.0-flash
  - User key ต้องสร้างจาก [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (ไม่ใช่ Google Cloud Console เพราะ billing project = limit:0)
  - Cloudflare Function: `functions/api/parse-receipt.js` — ทุก error response status 200 (กัน CF intercept 5xx ด้วย HTML)
  - User Setup: ✅ key อยู่ใน Cloudflare Pages → Settings → Variables and Secrets → Production (Secret type)
  - Tested 3 พ.ค. 2569 22:50 — อ่านบิล "บริษัท แมกซ์ การ์ด จำกัด" 988 บาท หมวด "น้ำมันรถ" ครบทุก field

### Database migrations applied (รายการ)
- ✅ supabase-rls-policies.sql (Phase 19)
- ✅ supabase-phase45-* (RLS hardening + bug fixes A/B/C/D/E/F)
- ✅ supabase-phase46-rls-tighten-reads.sql
- ✅ supabase-phase57-activity-log.sql (audit log table)
- ✅ supabase-phase63-service-share.sql (service_jobs.share_token)
- ✅ supabase-phase68-tags-extend.sql (products.tags + service_jobs.tags) ← 3 พ.ค.
- ✅ supabase-phase69-multi-payment.sql (receipts.payments jsonb) ← 3 พ.ค.
- ⚠️ **supabase-phase71-departments.sql** (Phase 71 — ตาราง departments) — ต้องรัน
- ⚠️ **supabase-phase72-payroll.sql** (Phase 72 — ตาราง staff_payroll + RLS) — ต้องรัน
  - ถ้ายังไม่รัน 2 SQL ข้างบน → 2 เมนู "🏢 ตั้งค่าแผนก" + "💰 รายการเงินเดือน" + "📊 ภาพรวมเงินเดือน" จะขึ้น error "ตาราง X ยังไม่มีในฐานข้อมูล"
- ⚠️ **supabase-phase75-profile-view-update.sql** — update view profiles_with_email เพิ่ม column department_id
  - ถ้ายังไม่รัน → Settings/Users dropdown แผนก ดูเหมือนไม่เซฟ (เซฟจริง แต่ view อ่านกลับไม่ได้)

### Customer accounts (test)
- babang / 0874536754 (ลูกค้า role) — สมัครผ่าน OTP เมื่อ 1 พ.ค. (Bug E verify)

### OTP / SMS (Customer login)
- **Mode**: 🟡 **On-screen fallback** (ไม่ใช่ SMS จริง) ตั้งแต่ 6 พ.ค. 2026
- **Cloudflare env**: `OTP_WEB_FALLBACK=true` (Plaintext) + `OTP_SECRET` (Secret)
- **Twilio**: ไม่ active หรือ trial หมด — server return 503 ถ้า fallback ปิด
- **Code**: [functions/api/send-otp.js](functions/api/send-otp.js) — เห็น `otpDelivery: "web_fallback"` → frontend แสดง prefix "[OTP หน้าเว็บชั่วคราว]"
- **⚠️ Security trade-off accepted**: ใครพิมพ์เบอร์ลูกค้าคนใดก็ login เป็นคนนั้นได้
  - `authPassword` ใน [verify-otp.js:47-49](functions/api/verify-otp.js) เป็น HMAC deterministic — login สำเร็จ 1 ครั้ง = จำ password ใช้ได้ตลอด
  - ถ้าเปลี่ยนกลับมาใช้ SMS ถาวร → ต้อง **หมุน `OTP_SECRET`** เพื่อ invalidate password ที่ attacker อาจคำนวณไว้
- **TODO ระยะยาว**: ตั้ง Twilio (เติม credit) หรือใช้ ThaiBulkSMS / SMS Master ราคาถูกกว่า

---

## 📚 Archived: Phase 1 → 75 (24 เม.ย. – 3 พ.ค. 2026)

Phase 75 ลงมา (~123 KB, 2,045 บรรทัด) ย้ายไปที่ **[HANDOFF_ARCHIVE.md](HANDOFF_ARCHIVE.md)** เพื่อ slim ไฟล์นี้

- หา phase เก่า → เปิด archive แล้ว Ctrl+F หาด้วยเลข phase
- ดู short summary ทุก phase → [CHANGELOG.md](CHANGELOG.md)

---

## 📦 Deferred (ยังไม่ได้ทำ — ต้องคุยกับ user ก่อน)
- **Bundle/Set** (ขายแอร์พร้อมติดตั้งเป็น 1 SKU) — ต้อง design table schema
- **Serial Number tracking** — ต้องคุยว่าเก็บที่ไหน/format
- **Auto Reorder PO** — ต้องสร้าง suppliers + workflow ใหญ่

---

## 🧑 เกี่ยวกับเจ้าของ

- **ชื่อ:** gangboo
- **Email:** gangboo@gmail.com
- **ภาษา:** ไทย (ตอบภาษาไทย ยกเว้น code/terminology)
- **สไตล์:** craftsman — ทำให้ถูกต้องครั้งเดียว ไม่ชอบ revise ซ้ำ
- **บริบท:** เทรดหุ้นอเมริกัน ชอบ design ชอบเรียนของใหม่
- **ธุรกิจ:** ร้านแอร์/โซลา (บุญสุข) — POS V5 ใช้ production จริง

**สิทธิ์ที่ user ให้ Claude (ตามที่คุยใน session 22-23 เม.ย.):**
- ✅ แก้ไฟล์ได้ไม่ต้องขอทุกรอบ
- ✅ Commit ได้เอง
- ✅ **Push ได้เอง** (user ไม่อยาก manual push ทุกครั้งแล้ว)
- ❌ ห้าม force push, reset --hard บน remote, skip hooks, รื้อ auth/RLS

---

## 🏗️ โครงสร้างโปรเจกต์

### Tech Stack
- **Frontend:** Vanilla JS (no framework), HTML5, CSS3, Service Worker, ESM modules
- **Hosting:** Cloudflare Pages (Git integration กับ GitHub — auto-deploy)
- **Backend:** Cloudflare Pages Functions (serverless) + Supabase (PostgreSQL + Auth + RLS + Storage)
- **Realtime:** LINE Messaging API — 2 groups (queue=ออเดอร์ใหม่, done=งานเสร็จ)
- **SMS OTP:** Twilio + dev fallback แสดง OTP บนจอถ้า Twilio fail
- **AI:** Cloudflare Workers AI binding `AI` สำหรับ AI Sales chat
- **Excel:** SheetJS XLSX (CDN — โหลดใน index.html)
- **QR:** html5-qrcode scanner, JsBarcode printer
- **Charts:** chart.js
- **PDF:** jspdf (lazy load)

### URLs
- **Production:** https://boonsukair.com
- **Preview:** https://boonsook-pos-v5.pages.dev
- **GitHub:** https://github.com/boonsook/boonsook-pos-v5
- **Cloudflare:** Pages project `boonsook-pos`

### Local paths (Windows)
```
Main repo:  C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github
Worktree:   C:\...\boonsook-pos-v5-github\.claude\worktrees\gifted-fermi-fe5141
```

---

## 📁 Repo Layout

```
boonsook-pos-v5-github/
├── index.html                    # Entry page
├── main.js                       # ~2200 lines — app shell, xhr helpers, routing
├── ai-chat-widget.js             # AI chat widget
├── sw.js                         # Service Worker (cache v12 — ต้อง bump เวอร์ชัน)
├── style.css, phase4-*.css       # Styles
├── supabase-config.js            # Supabase URL/anon key (public, in-browser)
├── manifest.json                 # PWA manifest
├── offline.html                  # Offline fallback
├── supabase-rls-policies.sql     # ★ SQL setup script (copy-paste to SQL Editor)
│
├── modules/                      # ~38 feature modules (ESM)
│   ├── doc-utils.js              # ★ Shared print CSS + bahtText helper
│   ├── pos.js                    # POS checkout flow
│   ├── ai_sales.js               # AI recommender + order form
│   ├── customer_dashboard.js     # Customer-facing ordering
│   ├── sales.js / products.js / customers.js
│   ├── service_jobs.js / service_request.js
│   ├── staff.js / auth.js
│   ├── dashboard.js / expenses.js / loyalty.js
│   ├── quotations.js / delivery_invoices.js / receipts.js   # เอกสาร 3 ตัว
│   ├── ac_shop.js / ac_install.js / solar.js / btu_calculator.js
│   ├── line_notify.js / thermal_printer.js / payment_gateway.js
│   ├── error_codes.js / stock_movements.js
│   └── settings/                 # Sub-pages ของตั้งค่า
│       ├── ac-catalog.js         # จัดการแคตตาล็อกแอร์ (Excel import/export)
│       ├── payment.js / pages.js / store.js / users.js
│       └── menu.js / index.js / utils.js / permissions.js / settings.js
│
├── functions/api/                # Cloudflare Pages Functions
│   ├── send-otp.js               # POST /api/send-otp (Twilio)
│   ├── verify-otp.js             # POST /api/verify-otp (HMAC)
│   ├── line-notify.js            # POST /api/line-notify (LINE push)
│   └── ai-assistant.js           # POST /api/ai-assistant (Workers AI)
│
├── data/                         # Seed data (ac_catalog.json etc.)
├── icons/                        # PWA icons + logo.svg
│
├── .gitattributes                # CRLF/LF rules
├── .gitignore                    # *.new, *.bak, *.bat, .env, commands.txt, .claude/
└── HANDOFF.md                    # ไฟล์นี้
```

**⚠️ ไฟล์ขาด (ถ้าใครถาม):**
- `OVERNIGHT_REPORT.md`, `OVERNIGHT-NOTES.md` — User ลบไปใน commit `6fc4422` (เคยมี)
- `commands.txt`, `commit.bat` — Local helper ของ user (อยู่ใน .gitignore)

---

## 🔐 Environment Variables (Cloudflare Pages → Settings)

### Required
| Variable | Value | Type |
|----------|-------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | (LINE bot token) | **Secret** แนะนำ (เดิมเป็น Plaintext) |
| `LINE_USER_ID` | (default recipient fallback) | Plaintext |
| `LINE_GROUP_QUEUE` | (groupId สำหรับออเดอร์ใหม่) | Plaintext |
| `LINE_GROUP_DONE` | (groupId สำหรับงานเสร็จ) | Plaintext |
| `OTP_SECRET` | สุ่ม 32+ chars | **Secret** (เข้ารหัส) |
| `TWILIO_ACCOUNT_SID` | (Twilio SID) | Plaintext |
| `TWILIO_AUTH_TOKEN` | (Twilio token) | **Secret** แนะนำ |
| `TWILIO_FROM_NUMBER` | +66... | Plaintext |

### AI binding
Pages → Settings → Functions → AI bindings:
- Variable name: `AI`
- Catalog: Workers AI

### Supabase
ใส่ใน `supabase-config.js` (public anon key — ไม่ใช่ secret)

---

## 🧠 Architecture Patterns

### 1. xhr helpers — หลักของทุก HTTP call ไป Supabase
อยู่ใน `main.js` (root):
```js
window._appXhrPost(table, payload, options)   // INSERT
window._appXhrPatch(table, payload, column, value)    // UPDATE
window._appXhrDelete(table, column, value)    // DELETE
window.App.xhrGet(url)                        // SELECT (raw URL)
```
**คืนค่า:** `{ ok: boolean, data?: any, error?: { message: string } }`
**Never throws** — always resolves. Check `result.ok`

**XHR logging (commits `32e8033`, `a02c7e7`):**
- Log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]` + response body 200-300 chars
- ไม่ warn ถ้า response body ว่าง (กรณี `Prefer: return=minimal`)

### 2. Toast notification
```js
window.App?.showToast?.("ข้อความ")    // ใช้ optional chain เสมอ
```
**อย่าใช้** `alert()` / `confirm()` / `prompt()` — ใช้ modal asยนค:
```js
if (await window.App?.confirm?.("ข้อความยืนยัน?")) { ... }
```

### 3. LINE notify — 2 groups routing
```js
ctx.sendLineNotify(message, { state, showToast }, "queue")   // ออเดอร์ใหม่
ctx.sendLineNotify(message, { state, showToast }, "done")    // เสร็จ
ctx.sendLineNotify(message)                                  // default (LINE_USER_ID)
```

### 4. API response shape
ทุก `/api/*` endpoint:
- Success: `{ ok: true, ...data }`
- Error: `{ ok: false, error: "ข้อความไทย" }` (ไม่ leak `err.message` ฝั่ง client)
- Server-side: `console.error("[endpoint-name] server error:", err)` → ดูได้ใน Cloudflare Functions Logs

### 5. Supabase RLS
- RLS เปิดทุกตารางหลัก — ใช้ `supabase-rls-policies.sql` ที่ root repo
- Policy: `FOR ALL TO authenticated USING (true)` — แม้เปิดกว้างแต่ต้อง auth
- Staff login ผ่าน Supabase Auth (email/password)
- Customer login ผ่าน OTP → verify → `authPassword` deterministic (HMAC) → `signInWithPassword`

### 6. `app_settings` table (new — 23 เม.ย.)
Key-value store สำหรับ setting ที่ sync ข้าม device:
- `store_info` — ชื่อร้าน, ที่อยู่, เบอร์, TaxID
- `payment_info` — banks[], promptPay, qrImage

โหลด/บันทึก:
```js
await loadAppSettings();      // ดึงจาก Supabase → merge localStorage
await saveStoreInfo(data);    // localStorage + upsert Supabase
await savePaymentInfo();      // localStorage + upsert Supabase
```

### 7. Service Worker update banner (new — commit `548208b`)
- `sw.js`: ไม่ auto-skipWaiting
- `index.html`: detect `updatefound` → banner "🔄 มีเวอร์ชันใหม่ — คลิกเพื่อใช้งาน"
- Click "อัปเดตเลย" → SKIP_WAITING → controllerchange → reload
- ต้อง bump `CACHE_NAME` ใน sw.js ทุก deploy ที่อยากให้ user เห็น banner

### 8. Document preview pattern (quotations / delivery_invoices / receipts)
3 module นี้มี pattern เดียวกัน:
- List view (table layout แบบ FlowAccount): `_viewMode = "list"`
- Preview view: `_viewMode = "preview", _viewingId = id`
- Status dropdown → PATCH status
- Bulk checkbox + bulk cancel/delete bar
- "อ้างอิง" link cross-navigate (RC → INV → QT)
- Cross-nav: `window._pendingInvoicePreviewId / _pendingQuotationPreviewId`

### 9. Bulk actions
- Checkbox per row (`data-xx-sel="${id}"`)
- Header "select all"
- `_selectedIds = new Set()`
- Bulk bar shown conditionally
- 2 ปุ่ม: "ยกเลิก (เก็บประวัติ)" + "🗑️ ลบถาวร"
- ลบถาวร: cascade restore parent status

---

## ⚠️ Gotchas (เคยเจอจริง)

### 1. Edit tool truncate ไฟล์ที่มี emoji/Thai chars
**อาการ:** Claude's Edit tool เคยตัด EOF ของ `ai_sales.js`, `customer_dashboard.js` (หาย 5-10 บรรทัด)

**วิธีแก้:**
- Small edits: ใช้ Edit tool ปกติ
- Large edits: เขียน Python patch script ใน `outputs/`
- ตรวจเสมอหลังแก้:
  ```bash
  node --check path/to/file.js
  tail -5 path/to/file.js
  ```

### 2. Python f-string backslash ห้าม
```python
f"EOL: {'CRLF' if eol == b'\\r\\n' else 'LF'}"   # ❌ SyntaxError
```
ใช้แทน:
```python
eol_name = "CRLF" if eol == b"\r\n" else "LF"
print("EOL:", eol_name)
```

### 3. Bash heredoc mangles `!`
ใน heredoc `<< 'EOF'` เมื่อเขียน `c != 1` bash อาจแทรก backslash
→ `c \!= 1` → SyntaxError
ใช้ `not c == 1` หรือ `if c == 0 or c > 1:` แทน

### 4. CRLF vs LF per file
- **Root files** (main.js, index.html, ai-chat-widget.js): LF
- **modules/\*.js:** CRLF (ส่วนใหญ่)
- **functions/api/\*.js:** CRLF (ยกเว้น ai-assistant.js = LF)
- **อย่าบังคับเปลี่ยน** — `.gitattributes` จัดการให้แล้ว

### 5. Deploy ผ่าน GitHub Actions (ไม่ใช่ Cloudflare GitHub integration!)

**สำคัญ:** Repo นี้ **ไม่ใช้** Cloudflare Pages Git integration —
ใช้ `.github/workflows/main.yml` ที่ run `wrangler pages deploy` upload โดยตรงแทน

**Workflow มี 2 jobs:**
1. `deploy` — wrangler upload ไป Cloudflare Pages (~30-60s)
2. `docker` — build + test Docker image (~2-3 min) — needs deploy

**เวลาเห็น "deploy ไม่ขึ้น":**
1. ไป **GitHub → Actions tab** ดู workflow runs
2. ถ้า `deploy` job ✓ green = Cloudflare ได้ของใหม่แล้ว → refresh dashboard
3. ถ้า `deploy` job ❌ fail = ดู logs (Cloudflare token หมดอายุ? quota เกิน?)
4. `docker` job fail ไม่กระทบ deployment — แค่ workflow status overall = fail

**ถ้า deploy job ไม่ trigger เลย (rare):**
```bash
git commit --allow-empty -m "chore: trigger workflow"
git push origin main
```

**อย่า** คลิก "Save and deploy" ใน Cloudflare upload mode — จะ disconnect ทุกอย่าง

### 6. Windows bash cd ไม่ข้าม worktree
```bash
cd "C:/path/to/repo" && command...  # อาจไม่ทำงานจาก worktree
```
ใช้:
```bash
cd "/c/Users/.../boonsook-pos-v5-github" && command...
```
หรือแก้ใน worktree แล้ว merge ที่ main repo

### 7. Supabase REST DELETE with `return=minimal` returns 204 even if RLS blocked
**ต้องใช้** `Prefer: return=representation` + check `deleted.length > 0`
ดูตัวอย่างใน `modules/receipts.js` `rcDeleteBtn` handler

### 8. Button stuck pattern
ทุก async handler ที่ disable button ต้องมี `finally` block reset:
```js
try { ... } catch(e) { ... } finally {
  if (btn.isConnected) { btn.disabled = false; btn.textContent = origText; }
}
```

### 9. Double-click race condition
ปุ่ม save/submit ต้องมี guard:
```js
if (btn.disabled) return; // กัน double-click
btn.disabled = true;
```

---

## 📊 Supabase Schema (ตารางหลัก)

ตารางที่ code เรียกถึง (จาก xhrPost/xhrPatch):
- `products`, `warehouse_stock`
- `customers`, `staff`, `staff_permissions`, `profiles`
- `sales`, `sale_items`
- `quotations`, `quotation_items`
- `delivery_invoices`, `delivery_invoice_items`
- `receipts`, `receipt_items`
- `service_jobs` (ทุกประเภทงาน — job_type: pos, ac, solar, ai_sales, other)
- `expenses`, `stock_movements`, `loyalty_points`
- `line_notify_settings`
- `app_settings` (new — key/value/updated_at)
- `warehouses`

**RLS ทุกตาราง:** run `supabase-rls-policies.sql` ที่ SQL Editor

---

## 📝 ประวัติการแก้ใน session นี้ (22-23 เม.ย. 2026)

### Critical / Security
- `52e0ac2` — fix(security): remove OTP_SECRET hardcoded fallback (CRITICAL)
- `b4f5b68` — fix(docs): verify DELETE returns rows (กัน RLS silent fail)
- `dafb4bc` — XSS escape + confirm() migration + silent catch logging + console.log cleanup
- `52e2cbc` — ป้องกัน double-click (service_request, ac_install, solar, expenses)
- `5139d31` — stuck-button fix (staff, products)
- `17f74dd` — customer checkout validation + finally
- `aff48d8` — sales/service_jobs/receipts delete stuck + safety timeout
- `d5971e8` — POS checkout stuck fix
- `b258d82` — ป้องกันสร้างเอกสารซ้อน (qt→inv, inv→rc)

### UX — FlowAccount-style redesign
- `2ecf56b` — list → table layout (ใบเสร็จ/ใบส่งสินค้า/ใบเสนอราคา)
- `7688468` — ต้นฉบับ/สำเนา pill badge + ระบุผู้ใช้
- `a5f2ff1` — จำนวนเงินเป็นสีดำ (ไม่ใช่สีธีม)
- `81afc13` — เอาคอลัมน์ # ออก + baht text + signature compact
- `5922944` — เอา page badge (1/2) มุมขวาบนออก
- `9d0291c` — tabs + status dropdown + bulk select + วันครบกำหนด
- `44efd65` — "อ้างอิง: INV/QT" คลิกเปิดเอกสารต้นทาง
- `07e688d` — bulk "ลบถาวร" hard delete + cascade
- `69fbe2c` — คลิกเลขที่เอกสารเปิด preview ได้เลย

### Features ใหม่
- `b32d86c` — แก้วันที่เอกสารใน preview + cascading lock
- `64b0da4` — receipt: payment method picker → ✓ ในช่อง checkbox
- `548208b` — SW update banner + empty states
- `9c4a625` — AI chat เพิ่มหมวด "🆕 แอร์ใหม่พร้อมติดตั้ง"
- `9e92511` — product category autocomplete (datalist)
- `090d85a` — product category chip filter
- `c1443f9` — product save validation + auto-gen SKU
- `998825e` — barcode print 50×30mm label printer
- `046003c` — ค่าไฟคำนวณถูกต้อง (inverter EER + duty cycle)
- `2bc0fd4` — ac-catalog: Excel import/export + bulk stock 5
- `f991030` — savePaymentInfo + loadAppSettings sync Supabase

### Infrastructure
- `6973165` — supabase-rls-policies.sql (SQL script)
- `75791d1` — silence false-positive warnings
- `a02c7e7` — xhr ไม่ warn ถ้า body ว่าง
- `64c4a1e` — ignore .claude/ worktrees
- `410e000` — copy label pill
- `6cc9377` — amount color black

---

## 🛣️ TODO — งานที่เหลือ (พิจารณาก่อนทำ)

### ยังไม่ได้แก้ (เสี่ยง — ต้องวางแผน)

#### Server-side security (functions/api/*)
- 🔴 **Rate limiting** — OTP/LINE API spam ได้ (costs escalation risk)
- 🟡 **CORS กว้างเกิน** (`Allow-Origin: *`) — CSRF risk
- 🟡 **/api/ai-assistant ไม่มี auth** — ใครก็เรียก Workers AI ได้

#### Accessibility (scope ใหญ่)
- `<div onclick>` → `<button>`
- Focus outline
- Alt text บนรูป
- ARIA labels

#### Performance
- Pagination สำหรับ list > 500 items
- Dashboard RPC — ย้าย aggregation ไป Supabase server-side
- Lazy load modules

#### Minor
- Input length limits (description, address) — กัน DB truncate
- Offline queue + retry สำหรับ checkout / LINE notify

### Cleanup ที่ทำไปแล้วครบ
- ✅ XSS (16 จุด)
- ✅ confirm() migration (30 จุด → 0)
- ✅ Silent catch critical logging (10 จุด)
- ✅ Production console.log (6 จุด)

---

## 🧪 Test Accounts

### Staff (Admin)
- ถาม gangboo — ใช้ Supabase Auth dashboard

### Customer (OTP)
- ใช้เบอร์จริง → Twilio ส่ง SMS
- **Dev fallback:** ถ้า Twilio trial limit → endpoint return `devCode` ใน response → แสดงในจอ + console

---

## 🧭 Cheat Sheet

### Deploy flow
```bash
# Claude session ทำใน worktree
cd "/c/Users/Lenovo E14 Gen4/Documents/boonsuk v5/boonsook-pos-v5-github/.claude/worktrees/gifted-fermi-fe5141"
# edit → commit
git add <files>
git commit -m "feat/fix(module): ..."

# Merge ไปที่ main repo + push
cd "/c/Users/Lenovo E14 Gen4/Documents/boonsuk v5/boonsook-pos-v5-github"
git merge claude/gifted-fermi-fe5141 --no-edit
git push origin main

# Cloudflare auto-deploy 1-2 นาที
```

### Trigger Cloudflare stuck webhook
```bash
git commit --allow-empty -m "chore: trigger cloudflare pages deploy"
git push origin main
```

### Syntax check ไฟล์
```bash
node --check modules/pos.js
```

### Hard refresh (clear SW cache)
Ctrl + Shift + R ใน browser

### ดู Cloudflare Functions Logs
Dashboard → Pages → boonsook-pos → Functions → Realtime Logs

### Supabase SQL Editor
Dashboard → SQL Editor → paste `supabase-rls-policies.sql` → Run

### Rollback commit ล่าสุด (ยังไม่ push)
```bash
git reset --hard HEAD~1
```

---

## 📋 หน้าทั้งหมดในแอป

### Staff side (dashboard route — auth required)
- `dashboard` — สรุปยอดขาย, กราฟ, KPIs
- `pos` — ขายหน้าร้าน (checkout, QR, attach slip)
- `products` — สินค้า (CRUD + barcode print + category chip filter)
- `sales` — ประวัติการขาย
- `customers` — ลูกค้า + loyalty
- `service_jobs` — งานซ่อม/ติดตั้ง/ออเดอร์ใหม่
- `service_request` — ฟอร์มรับแจ้ง
- `ai_sales` — AI ช่วยแนะนำสินค้า + รับออเดอร์
- `ac_shop`, `ac_install`, `solar`, `btu_calculator` — เฉพาะธุรกิจ
- `quotations`, `delivery_invoices`, `receipts` — เอกสาร 3 ตัว
- `expenses`, `profit_report` — การเงิน
- `calendar`, `stock_movements`, `loyalty` — อื่นๆ
- `staff`, `settings`, `line_notify`, `payment_gateway`, `permission_matrix` — ตั้งค่า
- `error_codes` — คู่มือรหัสข้อผิดพลาดแอร์

### Customer side
- `customer_dashboard` — OTP login → browse → cart → checkout
- `ai-chat-widget` — Chat bot overlay (3 หมวด: งานแอร์/โซลา/แอร์ใหม่)

---

## 🎯 บริบทล่าสุด (23 เม.ย.)

**สิ่งที่เพิ่งทำ:**
1. Sync paymentInfo ข้าม device (+ Supabase app_settings table)
2. AC catalog รองรับ Excel (.xlsx) + ตั้งสต็อก 5 ทุกรุ่น
3. ค่าไฟ AC คำนวณถูกต้อง (เดิม 2,631 → ตอนนี้ ~487 บาท/เดือน สำหรับ 9000 BTU)
4. Barcode print 50×30mm label printer

**รอ user ทดสอบ:**
- Cross-device sync บัญชีธนาคาร
- หน้าผู้ใช้ (profiles) หลังรัน SQL ใหม่
- AC catalog Excel workflow

**ถ้า user เจอปัญหา:**
- ขอ screenshot + console log (F12)
- มองหา log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]`, `[savePaymentInfo]`, `[loadAppSettings]`

---

## 📞 Next session checklist

เมื่อ Claude session ใหม่เริ่ม:
1. **อ่าน HANDOFF.md นี้ก่อน** (คุณกำลังอ่านอยู่)
2. `git log --oneline -20` — ดู commits ล่าสุด
3. `git status` — ดู unstaged/uncommitted
4. ตรวจว่า worktree branch sync กับ main มั้ย
5. ถาม user ว่าอยากทำอะไรต่อ อย่าเดา

### Do's
- ใช้ Python script ใน `outputs/` สำหรับ patch ไฟล์ใหญ่ (เลี่ยง Edit tool truncate)
- `node --check` ทุกครั้งหลังแก้ JS
- Preserve CRLF/LF ของไฟล์เดิม
- Commit message conventional: `fix(module)`, `feat(module)`, `refactor(ux)`, `style(docs)`, `chore`
- **Push ได้เองแล้ว** (user อนุญาตแล้วใน session นี้)
- Safety net ในทุก async handler: `try { ... } catch { ... } finally { if (btn.isConnected) reset }`

### Don'ts
- ❌ `alert()`, `confirm()`, `prompt()` — ใช้ showToast, App.confirm
- ❌ Leak `err.message` ฝั่ง client ที่ API endpoints
- ❌ Bulk rewrite ไฟล์ใหญ่ด้วย Write tool — ใช้ Edit/Python
- ❌ Create `.bak`, `.new`, `.old` files — ใช้ git history
- ❌ Force push, reset --hard remote, skip hooks
- ❌ คลิก "Save and deploy" ใน Cloudflare upload mode
- ❌ `innerHTML = user_input` — escape ด้วย escHtml/escapeHtml

---

## 🗂️ รายงานอื่นๆ

- **`supabase-rls-policies.sql`** (root) — script SQL setup RLS + create app_settings
- **`.claude/plans/`** — Plan files ของ Claude (ถ้ามี)
- **User's local** — `commands.txt`, `commit.bat` (ignored — ไม่อยู่ใน git)

---

**ขอบคุณที่อ่านถึงตรงนี้ — ช่วย gangboo ดูแลแอปต่อเลยครับ** 🙏

_อัปเดต: Claude (Opus 4.7) — session 22-23 เม.ย. 2026_
_Total commits this session: 30+_
# 2026-05-29 Correction - Phase 92.46b Not Fully Closed

Phase 92.46b accounting auto-journal should not be treated as fully closed yet.

Latest state:

- DB direct SQL Editor simulation as sales/authenticated can insert `journal_entries` successfully.
- `npm run verify:accounting` still fails A2 with REST JE HTTP 403.
- A2b orphan count still drifts, so production REST path is not verified.

Next owner should restart Supabase API/PostgREST, wait 1-2 minutes, then rerun `npm run verify:accounting`.

If A2 still returns 403 after restart, investigate REST project/JWT/env mismatch before changing DB policy again.
# 2026-05-29 Correction - Phase 92.46 Is Not Fully Closed

Build 315 / v5.64.0 remains the latest known live app. No UI/client change is required for this correction.

Important correction:
- Phase 92.46/92.46b should remain OPEN for accounting REST smoke.
- Direct DB sales/authenticated insert into `public.journal_entries` passes.
- REST/PostgREST smoke still fails: `npm run verify:accounting` A2 returns HTTP 403 / code `42501`.
- A2b still fails because the smoke-created sale becomes an orphan when journal creation is blocked.

Handoff instruction:
- Next operator should restart Supabase API/PostgREST, wait 1-2 minutes, then run `npm run verify:accounting`.
- If A2/A2b pass after restart, complete final orphan backfill and update `INCIDENT_NOTES.md`.
- If A2/A2b still fail, treat this as REST/runtime mismatch, not a generic SQL policy rewrite. Verify `.env` Supabase URL, anon key, JWT freshness, and payload parity with the direct DB insert test.

Do not mark accounting root cause closed until A1-A6 all pass.

# 2026-06-01 - CLOSED - Phase 92.46c JE REST RLS fixed and verified

Accounting auto-journal REST path is now CLOSED. A1-A6 all pass. Full detail in `INCIDENT_NOTES.md` (2026-06-01 entry).

Root cause (empirical, via `scripts/diag_je_rest.js`): the INSERT always worked (non-admin `return=minimal` = 201). The 403 came from the **SELECT-back** that `return=representation`/`headers-only` triggers — `je_select` was admin-only, so non-admin could not read its own just-inserted row, and the same policy blocked `jl_insert_auto`'s `EXISTS` subquery for lines.

Fix: `supabase-phase92-46c-je-rls-final.sql` (applied in Supabase SQL Editor 2026-06-01) adds PERMISSIVE `je_select_auto` for `authenticated`, scoped to auto-post sources (sales/expenses/service_jobs/receipts/delivery_invoices/credit_payments/refunds), `staff_payroll` excluded, line detail still admin-only. Additive — does not touch `auto_post.js`, insert whitelist, or period-close. Includes `NOTIFY pgrst, 'reload schema'`.

Verified 2026-06-01:
- `node scripts/diag_je_rest.js`: non-admin representation + headers-only now 201 (was 403).
- `npm run verify:accounting`: ALL PASS, A2=201, A2b 85->85 no drift, A3/A4 still 403.
- `npm run verify:je`: entry+lines 201/201, exit 0.

Backfill NOT run — dry-run + `auto_post.js` confirm 0 actionable rows. Remaining orphans (`sales_without_journal=85`, `expenses=1`, `payroll=0`) are all intentional skips: pre-effective April test data (`< 2026-05-01`) and one zero-amount May sale. Real May orphans were backfilled in a prior session. Live backfill would be a no-op.

No client/UI change. APP_BUILD stays 315 / v5.64.0.
