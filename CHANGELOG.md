# 📜 CHANGELOG — Boonsook POS V5 PRO

รายการการแก้ไขแบบสั้น เรียงจากใหม่ → เก่า
รายละเอียดเชิงลึก (architecture / why) ดูใน [HANDOFF.md](HANDOFF.md)

รูปแบบ: `<commit> feat|fix|docs|refactor: <สรุปสั้น>` + bullet 1-2 ข้อถ้าจำเป็น

---

## 5.43.11 (build 215) — 2026-05-11 🔄 Phase 89.6 — Cancel receipt → restore invoice

### ปัญหา (user รายงาน)
- ยกเลิกใบเสร็จ RC20260511020 → ใบส่งสินค้า INV20260511780 ยังเป็น "เปิดใบเสร็จแล้ว"
- ลูกค้าไม่สามารถออกใบเสร็จใหม่ได้ → flow ค้าง

### Root cause
Phase 89.1 ผมใส่ `voidJvForSource("receipts")` ตอน cancel แต่**ลืม restore `delivery_invoices.status="invoiced"`**
Inconsistent กับ rcDeleteBtn (ลบ) ที่ restore อยู่แล้ว

### Fix — เพิ่ม restore invoice status ที่ 3 จุด cancel
- **Bulk cancel** ([receipts.js:357-363](modules/receipts.js:357))
- **Dropdown cancel** (XHR path + Supabase fallback path)
- **Preview cancel** ([receipts.js:768-771](modules/receipts.js:768))
- Toast message: "ยกเลิกใบเสร็จเรียบร้อย — ใบส่งสินค้ากลับเป็น 'รอดำเนินการ'"

### Test
1. สร้าง invoice → ออกใบเสร็จ → ยกเลิกใบเสร็จ (ดร็อปดาวน์ หรือ preview)
2. กลับไปที่ **ใบส่งสินค้า/ใบแจ้งหนี้** → invoice ต้องกลับเป็น "รอดำเนินการ"
3. กดออกใบเสร็จใหม่ได้

---

## 5.43.10 (build 214) — 2026-05-11 🔐 Phase 89.5 — CDN SRI (Subresource Integrity)

### ปัญหาเดิม
- CDN scripts ใน index.html ไม่มี SRI hash → ถ้า jsdelivr/unpkg/sheetjs ถูก compromise หรือ DNS poison → attacker แทรก script ที่ steal session/token ได้

### Fix
- เพิ่ม `integrity="sha384-..."` + `crossorigin="anonymous"` ให้ 5 CDN scripts ใน [index.html](index.html):
  - chart.js@4.4.7 UMD — `sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC`
  - jspdf@2.5.1 UMD — `sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk`
  - html5-qrcode@2.3.8 — `sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+`
  - xlsx@0.20.1 (SheetJS) — `sha384-QCIdq2UMVEoSRhR3ZWZwdz2/pivLowr+eokFMdYyukq7qI26VYRxFa4Nl6FKetmL`
  - jsbarcode@3.11.6 — `sha384-Kk5SjBOKprEnGfyBWfD2zROFd1Cu8kwOXxG2GIhYPcoDL2rBJS9P8Ud1ZMy4412a`
- Hashes computed via `curl <URL> | openssl dgst -sha384 -binary | openssl base64`
- ถ้า CDN content เปลี่ยน → browser refuse to execute → app เห็น `Chart is not defined` แต่ปลอดภัย (deny by default)

### Risk note
- ถ้าวันใดต้อง upgrade version ของ library → ต้อง regenerate hash + update integrity attribute (ไม่งั้น script จะไม่โหลด)
- ถ้า script ไม่โหลด → ดู Console: `Failed to find a valid digest in the 'integrity' attribute`

### Test
- Console ห้ามมี integrity error
- Chart ใน dashboard, PDF export, Excel export, barcode print, QR scanner ต้องทำงานปกติ

---

## 5.43.9 (build 213) — 2026-05-11 🛡️ Phase 89.4 — Hot-path coverage + double-click + round2

### Defensive batch — เน้นไม่ให้แอปพัง (ทำตอน user ไปทำงาน)

**1. แก้ log "will re-post" → "voided"**
- [auto_post.js:92](modules/accounting/auto_post.js:92) — log message ที่ misleading (พบตอนทดสอบ delete POS sale)
- เดิม: `voided 1 JV(s) for sales#126 (will re-post)`
- ใหม่: `voided 1 JV(s) for sales#126`

**2. Migrate raw `fetch()` → `window._appAuthFetch` ที่ critical write sites**
- `_authFetch()` helper ใน [auto_post.js](modules/accounting/auto_post.js) — 4 จุด: void JV, post entry, post lines, rollback entry
- `delivery_invoices.js` bulk delete + single delete — ใช้ `authFetch` (alias of `_appAuthFetch`)
- `receipts.js` bulk delete — เหมือนกัน
- **ผล:** ทุก critical write path ครอบ 401-retry-with-refresh (Phase 89.2d) — JWT expire ตอน accounting/cancel ก็จะ auto refresh ไม่ต้อง Ctrl+Shift+R

**3. Double-click guard เพิ่ม 4 ปุ่ม**
- `diBulkCancel`, `diBulkDelete` ใน delivery_invoices.js
- `rcBulkCancel`, `rcBulkDelete` ใน receipts.js
- Pattern: `if (btn.disabled) return; btn.disabled = true; btn.style.opacity = "0.6"` → render ใหม่ DOM cleanup

**4. `round2()` export กลาง + ใช้ใน quotations form**
- `utils.js` export `round2(n)` — single source
- `quotations.js:714` — `item.line_total = round2(qty * unit_price * (1 - discount/100))`
- pos.js ใช้ตัวเดียวกันได้ (จาก local helper ใน Phase 89.2)
- **ผล:** ใบเสนอราคา/ใบส่งสินค้า/ใบเสร็จ ไม่มี `0.30000000000000004` อีก

### ที่เก็บไว้
- ac_install/solar/service_form: line_total ยังไม่ round (low-traffic, ทำเป็น Phase ถัดไปได้)
- BANK_COA validate ที่ receipt/invoice: ไม่มี bank picker UI → ไม่จำเป็น

### Test (รอ deploy 213)
1. ลบใบส่งสินค้า/ใบเสร็จ bulk — กดรัวๆ → ปุ่มเทาทันที กด PATCH ครั้งเดียว
2. ใช้แอปจน JWT expire (1+ ชม.) → กดลบ/post JV → ต้องไม่ต้อง refresh เอง — มี toast ก็ต่อเมื่อ refresh fail
3. แก้ qty/price ใน line item ของใบเสนอราคา → line_total ต้องเป็น 2 ตำแหน่งทศนิยม

---

## 5.43.8 (build 212) — 2026-05-11 🗑️ Phase 89.3 — Delete POS sale ครบวงจร

### ปัญหาเดิม
- ปุ่ม "🗑️ ลบ" ใน [รายการขาย POS](modules/sales.js:137) ทำแค่ **soft-delete** (เปลี่ยน `sales.note = "[ลบแล้ว]..."`)
- ไม่ revert side effects → **P&L ยังเห็นรายได้ + stock ลดถาวร**
- ผลกระทบ: ลบบิล POS ฿600 → JV `Dr 1110 / Cr 4100 = ฿600` ยังลง → รายได้ในงบกำไรขาดทุนเพี้ยน

### Fix
- **`voidJvForSource("sales", saleId)`** ใน sales delete handler → JV หายจากสมุดรายวัน → P&L ถูกต้อง
- **`window._appRevertStockForSale({saleId, orderNo})`** ใน main.js — best-effort:
  - Query `sale_items` ของบิลที่ลบ
  - คืน `warehouse_stock += qty` (เลือก "บ้าน" ก่อน)
  - คืน `products.stock += qty` (legacy)
  - INSERT `stock_movements` type=`return_sale` qty=+ note="คืนสต็อกจากลบ POS..."
- **Toast แจ้งผล:** `"ลบรายการขายเรียบร้อย ✅ (JV 1 entry, คืนสต็อก 3 รายการ)"`
- Best-effort: ถ้า void/revert ล้มเหลว → warning toast + console.warn แต่ไม่ block soft-delete

### Test plan
1. POS → ขายของ ฿100 → checkout
2. เปิด **บัญชี → งบกำไรขาดทุน** → จดยอด 4100
3. ไป **งานขาย → รายการขาย POS** → กดลบบิล
4. Toast ต้องขึ้น "ลบรายการขายเรียบร้อย ✅ (JV 1 entry, คืนสต็อก 1 รายการ)"
5. กลับมา P&L → reload → 4100 **ลดลง ฿100**
6. ไป **คลัง → ประวัติเคลื่อนไหวสต็อก** → ต้องเห็น movement type="return_sale"

---

## 5.43.7 (build 211) — 2026-05-11 🔄 Phase 89.2d — Auto-refresh access token on 401

### ปัญหาที่เจอ
- User login เกิน 1 ชั่วโมง → Supabase JWT expire
- `window._sbAccessToken` ยังเก็บ token เก่า
- DELETE/PATCH/POST → return HTTP 401
- เดิม ต้อง `Ctrl+Shift+R` หรือ logout/login เพื่อ refresh — UX papercut

### Fix
- **`refreshAccessToken()`** ใน [main.js](main.js) — single-flight, parallel calls แชร์ promise เดียว
- **xhrPost / xhrPatch / xhrDelete** — เพิ่ม `_isRetry` flag → ถ้า 401 → refresh + retry ครั้งเดียว
- **`window._appAuthFetch()`** — global wrapper สำหรับ raw fetch sites (auto-inject headers + retry)
- **rcDeleteBtn** ใน [receipts.js](modules/receipts.js) — wrap raw fetch เป็น `_appAuthFetch`
- ถ้า refresh fail → toast "⚠️ Session หมดอายุ — กรุณา login ใหม่"

### Coverage
- ✅ ทุก call ผ่าน `window._appXhrPost/Patch/Delete` (modules มากกว่า 40+ จุด)
- ✅ Delete receipt ที่ user เพิ่งเจอ (Phase 89.2c)
- ⚠️ Raw fetch sites อื่นๆ ใน modules (เช่น auto_post.js, delivery_invoices.js) ยังไม่ wrap — สามารถ migrate เพิ่มทีหลังได้โดยเปลี่ยน `fetch(...)` → `window._appAuthFetch(...)`

### Test
- ใช้แอปต่อเนื่อง 1+ ชั่วโมง → ทำ insert/update/delete → ต้อง work เงียบ ๆ (มี toast แค่ถ้า refresh fail)
- Network tab: ตอน 401 → จะเห็น 2 requests (1st: 401, 2nd: 200 หลัง refresh)

---

## 5.43.6 (build 210) — 2026-05-11 🚑 Phase 89.2c — CSP connect-src CDN

### Root cause หลังจาก 209 ยังพัง:
- Service Worker [sw.js:110](sw.js:110) intercept CDN script request แล้วทำ `fetch()` เพื่อ cache
- Chrome enforces SW `fetch()` ต้องผ่าน document CSP `connect-src`
- CSP `connect-src` ผมใส่แค่ `'self' supabase esm.sh cloudflareinsights` — ไม่มี CDN domains → fetch fail → script unavailable → `Chart is not defined`

### Fix
- `_headers` CSP `connect-src` เพิ่ม: `https://cdn.jsdelivr.net`, `https://unpkg.com`, `https://cdn.sheetjs.com`, `https://static.cloudflareinsights.com`

### Test (รอ deploy 210 + hard reload)
- Console ห้ามมี `Fetch API cannot load https://cdn.jsdelivr.net/...`
- ห้ามมี `Chart is not defined`
- dashboard chart โหลดได้

---

## 5.43.5 (build 209) — 2026-05-11 🚑 Phase 89.2b — Hotfix CSP + Chart.js

### Critical hotfix หลัง deploy 208 พบ dashboard error
- **fix(CSP):** `_headers` — เพิ่ม `https://static.cloudflareinsights.com` ใน script-src + connect-src (Cloudflare Web Analytics beacon)
- **fix(CSP):** เพิ่ม `script-src-elem` directive ระบุชัด (CSP3 standard — browser fallback ไม่เสถียร)
- **fix(CSP):** `worker-src 'self' blob:` (กัน Chart.js/lib ที่สร้าง worker จาก blob URL)
- **fix(Chart.js):** [index.html:17](index.html:17) — เดิม `cdn.jsdelivr.net/npm/chart.js` ไม่ pin version → jsdelivr resolve เป็น CJS (`chart.cjs`) → `window.Chart` undefined → dashboard render crash
- **fix(Chart.js):** pin เป็น `chart.js@4.4.7/dist/chart.umd.min.js` (UMD bundle define global Chart)

### Test
- F12 Console → reload หน้า dashboard → ห้ามมี `Chart is not defined`
- ห้ามมี CSP violation สำหรับ `static.cloudflareinsights.com`

---

## 5.43.4 (build 208) — 2026-05-11 🛡️ Phase 89.2 — Defensive Fixes (Batch 1)

### 5 defensive fixes — low-risk เน้น stability
- **fix(auto_post):** JV orphan rollback — เดิม entry สร้างผ่าน แต่ lines fail = orphan JV → trial balance พังเงียบ ตอนนี้ DELETE entry เพื่อ rollback ([auto_post.js:223-243](modules/accounting/auto_post.js:223))
- **fix(auto_post):** BANK_COA regex tighten — `(?:^|[\s•])BANK_COA:(\d{4,5})(?=$|[\s•])` (anchor + word boundary) + validate กับ chart_of_accounts ก่อน override Dr account — ป้องกัน FK error เงียบ
- **fix(pos):** Float math — เพิ่ม `round2()` helper, ใช้กับ numpad sum + line_total + ทุก money field ใน salePayload → กัน `0.1+0.2 = 0.30000000000000004` เข้า DB
- **fix(backfill):** เปลี่ยน effective date จาก stale `2026-01-01` → `2026-05-01` ทั้งใน UI warning + cutoff logic (ตรงกับ Phase 88.18b)
- **fix(receipts):** Double-click guard ที่ปุ่ม "เก็บเงิน" + "ยกเลิก" ใน preview — กัน user double-tap = patch ซ้ำ/JV post ซ้ำ (มี DB unique index จับได้แล้ว แต่ป้องกัน UX confusing)

### Test plan
- POS: สั่งของ `0.1` + `0.2` (ถ้าทำได้) → ดู line_total = `0.30` (ไม่ใช่ `0.30000...4`)
- Cancel ใบเสร็จ → ดู P&L ลดลง + JV ถูก void
- Backfill UI: เปิดหน้าใหม่ → ต้องเห็น "Effective date 2026-05-01"
- กดปุ่มเก็บเงินใน receipt preview รัวๆ → patch ครั้งเดียว + JV 1 entry

---

## 5.43.3 (build 207) — 2026-05-11 🛡️ Phase 89.1 — Phase A Security & Critical Bug Sweep

### 🚨 Critical fixes (5 bugs ระดับบัญชี/ภาษี/ความปลอดภัย)
- **fix(POS auto-post):** เดิม `postJournalForSale()` รับแค่ 6 fields → Phase 88.20 (bank picker) + 88.21 (VAT split) พังเงียบ ทั้งที่ดู UI ผ่าน — แก้โดย spread `salePayload` ทั้งก้อนรวม `note`, `vat_amount`, `vat_rate`, `subtotal_before_vat`
- **fix(JV void on cancel):** ยกเลิกใบส่งสินค้า / ใบเสร็จ → JV เก่ายังลอย → P&L นับรายได้ซ้ำ — wire `voidJvForSource("delivery_invoices"|"receipts", id)` ทั้ง 5 จุด (bulk + dropdown + preview)
- **fix(timezone):** เพิ่ม `todayBkk()` + `dateBkk()` ใน utils.js — แทน `new Date().toISOString().slice(0,10)` (UTC) ใน auto_post / backfill / profit_loss / trial_balance / balance_sheet / journal_form / export_bundle เพื่อกัน 00:00–06:59 ลง doc_date เป็นเมื่อวาน
- **fix(XSS):** share.html — เปลี่ยน `onclick="window.open('${esc(url)}')"` (apostrophe-decode-in-attr gotcha) เป็น `data-photo-url` + delegated listener + `safeUrl()` (http/https only) + `safeTel()` (digit-only)
- **feat(security headers):** `_headers` — เพิ่ม CSP, HSTS, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy ครอบทุก path

### User actions required (สำคัญมาก!)
1. **ปิด `OTP_WEB_FALLBACK` ใน Cloudflare Pages env** — เดิม endpoint `/api/send-otp` คืน `devCode` ใน response → ใครรู้เบอร์ลูกค้าก็เข้าบัญชีได้
   → Cloudflare → Pages → boonsook-pos → Settings → Environment variables → ลบ `OTP_WEB_FALLBACK` หรือเปลี่ยนเป็น `false`
2. หลัง deploy → ทดสอบ POS ขายของจริง → ดู JV ต้องมี 3 บรรทัด (เปิด VAT) + Dr account ตรงธนาคารที่เลือก
3. ทดสอบ Cancel ใบเสร็จ → เปิด P&L → รายได้ต้องลดลง (JV ถูก void)

---

## 5.43.0 (build 204) — 2026-05-10 ⭐ Phase 88.21 — VAT Support MVP 📜

### Phase 88.21 — รองรับภาษีมูลค่าเพิ่ม (VAT 7%) — MVP
- **feat:** SQL — เพิ่ม COA + mapping + columns
  - COA `1170` (ภาษีซื้อ — Input VAT) / `2170` (ภาษีขาย — Output VAT)
  - Mapping `vat_output` / `vat_input`
  - sales/expenses/delivery_invoices: + columns `vat_amount`, `vat_rate`, `subtotal_before_vat`
- **feat:** Settings → ข้อมูลการเงิน → section "📜 ภาษีมูลค่าเพิ่ม (VAT)"
  - Toggle เปิด/ปิด VAT
  - Tax ID 13 หลัก
  - อัตราภาษี (default 7%)
  - Mode: exclusive (บวก VAT) / inclusive (ราคารวม VAT แล้ว)
- **feat:** POS Cashier — calc VAT auto + แสดง breakdown ในหน้ายืนยัน
  - "ยอดสินค้า ฿X / VAT 7% ฿Y / รวมสุทธิ ฿Z"
  - บันทึก vat_amount + subtotal_before_vat ใน sales
- **feat:** auto_post.js `postJournalForSale` — split JV เป็น 3 บรรทัดเมื่อมี VAT
  - Dr 1110/1130 (เงิน) ฿107
  - Cr 4100 (รายได้) ฿100
  - Cr 2170 (Output VAT) ฿7
- **scope MVP:** POS sale only — Phase ถัดไป: expense (Input VAT) + invoice + service jobs

### User actions required
1. Run SQL: `supabase-phase88-21-vat-support.sql`
2. ตั้งค่า → ข้อมูลการเงิน → ✅ เปิด VAT 7%
3. ทดสอบ POS → ขายของ → ดู breakdown ในหน้ายืนยัน → JV 3 บรรทัด

---

## 5.42.0 (build 203) — 2026-05-09 ⭐ Phase 88.20

### Phase 88.20 — POS Cash breakdown + Bank account picker
- **feat:** POS หน้า "ยืนยันการชำระ" — เพิ่ม breakdown รับเงิน-เงินทอน เด่นชัด
  - 2 columns: 💵 รับเงินจากลูกค้า / 💸 เงินทอน
  - แสดงเสมอ (ไม่ใช่เฉพาะกรณีทอน)
- **feat:** POS Transfer — dropdown เลือกบัญชีธนาคารปลายทาง (ถ้ามีหลายบัญชี)
  - QR + ข้อมูลบัญชีเปลี่ยนตามที่เลือก
  - แสดง COA Code ถ้ากรอกใน settings
- **feat:** Settings → ข้อมูลการเงิน — เพิ่ม "📊 รหัสบัญชี COA" ใน bank card
  - บัญชีแรก default = 1130 (suggestion)
- **feat:** Sales note บันทึก:
  - `BANK_COA:XXXX` — สำหรับ auto-post ใช้
  - `🏦 ชื่อธนาคาร (เลขบัญชี)` — readable
  - `💵 รับ ฿X ทอน ฿Y` — สำหรับ cash
- **feat:** auto_post.js `postJournalForSale` — ตรวจ note BANK_COA → override Dr account

### User actions
- ตั้งค่า → ข้อมูลการเงิน → เพิ่มบัญชี → กรอก COA Code (1130, 1131, 1132)
- POS Transfer → ≥ 2 บัญชี → dropdown โผล่

---

## 5.41.2 (build 202) — Phase 88.19c (table fix)
- **fix:** `journal_entry_lines` → `journal_lines` ใน periods.js fetchPeriodSummary

## 5.41.1 (build 201) — Phase 88.19b (route fix)
- **fix:** เพิ่ม `accounting_periods` ใน `ALL_ROUTES` (ลืม register)

## 5.41.0 (build 200) — 2026-05-09 ⭐ Phase 88.19 — Period Close 🎉

### Phase 88.19 — ปิดงวดบัญชี (Lock Periods)
- **feat:** ตารางใหม่ `accounting_periods` (year/month/status/locked_at/locked_by/unlock_reason)
- **feat:** หน้าใหม่ "🔒 ปิดงวดบัญชี" ใน เมนูบัญชี
  - Grid 12 เดือน × N ปี + summary (revenue/expense/net/JV count)
  - ปุ่ม Lock งวด — confirm dialog แสดง summary
  - ปุ่ม Unlock — กรอกเหตุผล (≥5 chars) → audit trail
- **feat:** Validation 2 ชั้น (defense in depth):
  - Front-end: `auto_post.js` ตรวจ period status ก่อน insert JV
  - Back-end: DB trigger `check_period_not_locked` กัน insert/update ผิดงวด
- **feat:** อนุญาต void JV ใน locked period (soft delete) — ห้าม insert/update
- **SQL:** `supabase-phase88-19-period-close.sql`

### User actions required
1. Run SQL: `supabase-phase88-19-period-close.sql`
2. ลอง: เมนู → บัญชี → "🔒 ปิดงวดบัญชี" → คลิกเดือน → Lock

🎯 **Build 200 — milestone!**

---

## 5.40.2 (build 199) — 2026-05-09 ⭐ Phase 88.18c

### Phase 88.18c — Expense form: แยก ถ่ายรูป / แกลเลอรี่
- **fix:** หน้ารายรับ-รายจ่าย → ฟอร์มแก้ไข → ปุ่ม "ถ่ายรูป / เลือกรูปบิล" ปุ่มเดียว
  - บน mobile: บังคับเปิดกล้องเสมอ — เลือกรูปจากแกลเลอรี่ไม่ได้
  - แก้: แยก 2 ปุ่ม "📷 ถ่ายรูป" (capture=environment) + "🖼️ แกลเลอรี่" (no capture)
  - ใช้ pattern เดียวกับ Phase 88.11 (service form slip)
- **feat:** ปุ่ม "เปลี่ยนรูป" (กรณีมีรูปแล้ว) แยก 2 ปุ่ม: "📷 ถ่ายใหม่" / "🖼️ เลือกใหม่"

---

## 5.40.1 (build 198) — 2026-05-09 ⭐ Phase 88.18b — Production start

### Phase 88.18b — เลื่อน ACCOUNTING_EFFECTIVE_DATE → 2026-05-01
- **change:** Effective date 2026-01-01 → **2026-05-01** ใน 4 ไฟล์
  - auto_post.js / balance_sheet.js / export_bundle.js / opening_balance.js
- **เหตุผล:** User เริ่ม production จริงตั้งแต่ 1 พ.ค. — ก่อนหน้านี้คือ test data
- **ผล:**
  - ระบบจะ reject auto-post JV ของ docDate < 1 พ.ค. โดยอัตโนมัติ
  - กัน backfill mock data + กันสร้าง JV ผิดวันโดยไม่ตั้งใจ
  - Balance Sheet / Export bundle ใช้ 1 พ.ค. เป็น cumulative start
- **User action:** Run SQL void JV ของ เม.ย. 2026 (mock data) → P&L สะอาด

---

## 5.40.0 (build 197) — 2026-05-09 ⭐ Phase 88.17 + 88.18

### Phase 88.17 — Receipt Approval Workflow
- **fix:** ใบเสร็จออกใหม่ default `status="pending"` (เดิม "paid" auto)
  - delivery_invoices.js line 731 — เปลี่ยน default
- **fix:** `postJournalForReceipt` ตรวจ `status="paid"` ก่อน post JV
  - กัน JV เกิดทั้งที่ user ยังไม่ยืนยันรับเงิน
- **feat:** receipts.js UI:
  - Default filter chip = "🟡 รออนุมัติ" (ม่วง — เน้นความสำคัญ)
  - STATUS_LABELS: paid="✅ ชำระแล้ว" / pending="🟡 รออนุมัติ" / cancelled="⚫ ยกเลิก"

### Phase 88.18 — B2B Revenue Split + Fix JV Chain ⚠️ บั๊กบัญชีสำคัญ
- **bug fix:** เดิม invoice ออกแล้ว revenue **ไม่เคย post** เข้า P&L → ลูกหนี้ติดลบ + ขาดทุนปลอม
- **feat:** เพิ่ม COA **4150** "รายได้ขายสินค้า — งานราชการ/บริษัท"
- **feat:** Rename COA 4100 → "รายได้ขายสินค้า — หน้าร้าน (POS)"
- **feat:** เพิ่ม mapping `invoice_credit` (Dr 1200 / Cr 4150)
- **feat:** เพิ่ม `postJournalForDeliveryInvoice()` ใน auto_post.js
  - quotations.js หลัง insert invoice → fire JV (Dr 1200 / Cr 4150)
- **feat:** Backfill page เพิ่ม source "🧾 ใบส่งสินค้า (B2B)"
  - User backfill ย้อนหลังให้ invoice เก่าได้

### User actions required
1. Run SQL: `supabase-phase88-17-revenue-split.sql`
2. Backfill ย้อนหลัง: บัญชี → Backfill ย้อนหลัง → เลือก "ใบส่งสินค้า" + date range → รัน

---

## 5.39.5 (build 196) — 2026-05-09 ⭐ Phase 88.16

### Phase 88.16 — Solar revenue mapping → 4300
- **feat:** เพิ่ม COA 4300 "รายได้บริการ — โซล่าเซลล์"
  - SQL migration: `supabase-phase88-16-solar-mapping.sql`
- **feat:** เพิ่ม `account_mapping.service_solar` (Dr 1110 / Cr 4300)
- **fix:** `auto_post.js` keyMap: `solar → service_solar` (เดิม fallback service_other → 4240)
- **impact:** P&L แยกรายได้โซล่าออกจาก "บริการอื่นๆ" — ดู revenue mix ของแต่ละสายงานได้ชัด
- **action:** ⚠️ User ต้อง run SQL ใน Supabase SQL Editor ก่อน mapping ใหม่จะใช้ได้

---

## 5.39.4 (build 195) — 2026-05-09 ⭐ Phase 88.15

### Phase 88.15 — แยกสิทธิ์ ช่าง vs admin (delivered/closed = admin only)
- **fix:** ลบ option "📦 ส่งมอบแล้ว (ลง JV ทันที)" + "🎉 ปิดงาน + รับเงิน (ลง JV ทันที)" ออกจากฟอร์มช่าง
  - 11 หน้า: solar.js / ac_install.js / service_form.js (9 routes)
  - ช่างเลือกได้: pending / in_progress / done / pending_review เท่านั้น
- **fix:** `COMPLETION_STATUSES = []` ในฟอร์มช่าง — JV ไม่ trigger เองอีก
  - JV เกิดผ่าน admin drawer (approve banner) เท่านั้น
- **impact:** ป้องกันช่างกดผิดแล้ว JV เกิด — workflow ชัดเจน: ช่างส่ง → admin อนุมัติ

---

## 5.39.3 (build 194) — 2026-05-09 ⭐ Phase 88.14

### Phase 88.14 — Fix new service jobs ไม่โผล่ในใบรับงาน
- **fix:** `solar.js` / `ac_install.js` / `service_form.js` (9 routes) บันทึกแล้ว job ใหม่ไม่ push เข้า `state.serviceJobs`
  - ทำให้หน้า "ใบรับงาน" ไม่เห็น job ใหม่จนกว่าจะ refresh page
  - เพิ่ม optimistic update: `state.serviceJobs = [inserted[0], ...state.serviceJobs]` หลัง insert สำเร็จ
  - Pattern เดียวกับ `saveServiceJob` ใน main.js
- **impact:** ทุกหน้างานช่าง (11 หน้า) — บันทึก → เปลี่ยนหน้าใบรับงาน → เห็นทันที

---

## 5.39.2 (build 193) — 2026-05-09 ⭐ Phase 88.13

### Phase 88.13 — Solar equipment ↔ Stock link
- **feat:** หน้าโซล่าเซลล์ — อุปกรณ์/วัสดุ ลิ้งกับสต็อก (warehouse) แทน free-text
  - ปุ่ม "+ เพิ่มอุปกรณ์" เปิด modal picker จาก state.products + แสดงสต็อกในรถ/บ้าน
  - แสดงตาราง อุปกรณ์/คลัง/qty stepper/ราคา/รวม + ลบรายการ
  - ตอน save → ตัดสต็อกอัตโนมัติ (window._appApplyStockMovement) + auto-transfer บ้าน→รถ ถ้าไม่พอ
  - เก็บ items_json ลง service_jobs
  - ไม่กระทบ section ปิดงาน/สลิป/AI verify/JV trigger ของ Phase 88.12

---

## 5.39.1 (build 192) — 2026-05-09 ⭐ Phase 88.12 final

### Phase 88.12 — Approval Workflow ครบ 13 หน้างานช่าง
- **feat:** ทุกหน้างานช่างมี section "ปิดงาน + แนบสลิป + AI verify"
  - 9 service types (service_form.js) + ติดตั้งแอร์ (ac_install.js) + โซล่าเซลล์ (solar.js)
  - ปุ่มแยก 📷 ถ่ายรูป / 🖼️ แกลลอรี่
  - Auto AI verify ถ้า payment=transfer/qr
- **feat:** Status ใหม่ `pending_review` (📨 รออนุมัติ)
  - ช่างเลือก → JV ไม่เกิด (รอ admin)
  - filter chip "รออนุมัติ" สีม่วง ในใบรับงาน
- **feat:** Admin approve banner ใน drawer (ม่วง) + ปุ่ม "อนุมัติ + ลงรายได้"
  - กด → status=delivered → save → JV เกิด

---

## 5.38.6 (build 190) — 2026-05-09 ⭐ Phase 88.11 final

### Phase 88.11 — Slip Upload + AI Verify (Gemini Vision)
- **feat:** ช่างแนบสลิปการโอน + AI ตรวจ tampering ใน drawer
  - `functions/api/verify-slip.js`: Gemini Vision API + 4-model fallback chain
  - Compact prompt + maxTokens 4000 (รองรับ Thai)
  - Extract: sender/recipient/amount/datetime/ref + tampering_score
  - Smart name match (strip prefix + bank name) — กัน false positive
  - Tampering threshold สอน AI: phone-of-phone ≠ tampering
- **feat:** drawer section สีม่วง — 📷 ถ่าย / 🖼️ แกลลอรี่ + auto-verify
- 7 builds (184-190) — debug journey: token truncate, name match, tampering threshold

---

## 5.37.2 (build 183) — 2026-05-09

### Phase 88.10b — Re-post JV ตอน user แก้ total/method
- **fix:** เพิ่ม `editCompleteWithChange` trigger — งาน complete + แก้ total/method
- เก็บ origTotalCost + origPaymentMethod ใน state ตอน open drawer

## 5.37.1 (build 182) — 2026-05-09

### Phase 88.10 — Re-post JV (initial)
- **fix:** เพิ่ม `voidJvForSource()` — DELETE JV เดิมก่อน post ใหม่
- กัน idempotent unique block POST ตอน user แก้ amount

---

## 5.37.0 (build 181) — 2026-05-09 ⭐ Phase 88.7-88.9

### Phase 88.7 — JV Drill-down (สมุดรายวัน → drawer)
- **feat:** คลิก row JV → drawer แสดง:
  - Meta (วันที่/ประเภท/สถานะ) + คำอธิบาย
  - Lines table (Dr/Cr ทุกบรรทัด) + balance check
  - Source preview (ถ้ามี source_table/source_id) — sales/expenses/receipts/service_jobs
  - ปุ่ม "เปิดหน้า [source]" → navigate ไป list page
  - Audit info (created_at / approved_at / voided_at)

### Phase 88.8 — Drawer service edit: ค่าแรง/discount + payment_method
- **feat:** เพิ่ม section "💰 ค่าแรง / ปิดงาน" ใน serviceJobDrawer
  - input ค่าแรง / ส่วนลด / ยอดสุทธิ (auto-recalc)
  - dropdown payment_method (cash → Dr 1110 / transfer → Dr 1130)
- **feat:** saveServiceJob ใส่ `total_cost` + `payment_method` ใน payload
  - ส่ง payment_method ไปยัง postJournalForServiceJob — override Dr account
  - แก้ pain point: drawer ก่อนหน้านี้ไม่มีช่อง total_cost (ต้องไป SQL UPDATE manual)

### Phase 88.9 — Comparative P&L
- **feat:** toggle "📊 เทียบกับงวดก่อน" ในหน้างบกำไรขาดทุน
  - Auto-compute previous period (เดือน/ไตรมาส/ปี/custom = ขนาดเท่ากัน)
  - Fetch 2 งวดพร้อมกัน → render side-by-side (5 columns: รหัส | ชื่อ | งวดนี้ | งวดก่อน | Δ)
  - Net Income compare card (3 ตัวเลข + % change)

---

## 5.36.0 (build 180) + SQL hotfix — 2026-05-08 ⭐ Phase 88.6

### Phase 88.6 — Service Job Closure Workflow
- **feat:** ช่างปิดงานในหน้าเดียว — JV ลงรายได้อัตโนมัติตามประเภทงาน
  - SQL: ALTER service_jobs (total_cost/payment_method/payment_slip_url/closed_at)
    + 5 COA ใหม่ (4250-4290) + 5 mappings (satellite/fridge/washer/cctv/tv)
  - auto_post.js: keyMap 9 ประเภทครบ + payment_method override (transfer→1130)
  - service_form.js: section "🔚 ปิดงาน" (status + payment + slip upload + auto JV)
- **SQL hotfix** (c89a75c): ลืม payment_method ในรอบแรก — เพิ่ม + NOTIFY pgrst
- ✅ User verified: SV2026050003 ฿3,000 จากงานซ่อมแอร์ลูกค้าดาหมอก

---

## 5.35.2 (build 179) — 2026-05-08

### Hotfix — service_jobs.total_cost
- **fix:** service_form.js เพิ่ม `total_cost: net` ใน record ตอน insert
  - Bug: postJournalForServiceJob skip silent ถ้า total_cost=NULL

---

## 5.35.1 (build 178) — 2026-05-08

### Hotfix — Backfill date range
- **fix:** `created_at=lte.YYYY-MM-DD` exclude row ที่ created 12:56 UTC
  - แก้: timestamptz field ใช้ `lt.<nextDay>`, DATE field ใช้ `lte.<to>`

---

## 5.35.0 (build 177) — 2026-05-08

### Hotfix — Mobile service form save
- **fix:** ใช้ `window._sbAccessToken` cache แทน `supabase.auth.getSession()`
  (มือถือ slow network → getSession hang ตลอด)
- **fix:** wire `postJournalForServiceJob` ใน service_form.js (เดิม wire ผิดที่ใน main.js)

---

## 5.34.9 (build 176) — 2026-05-08

### Hotfix — service_form fetch timeout
- **fix:** AbortController + 15s timeout — กัน "กำลังบันทึก..." ค้างไม่จบ

---

## 5.34.8 (build 175) — 2026-05-08 ⭐ Phase 88 FINAL

### Phase 88.5 — Opening Balance wizard + Export bundle (FINAL)
- **feat:** wizard ลงยอดยกมา (Opening Balance) — `modules/accounting/opening_balance.js`
  - 3 sections (Asset/Liability/Equity) + live balance check Dr=Cr
  - หลัง save → JV `OB2026010001` doc_type=OB ลงวันที่ effective date
  - แก้ปัญหา BS แสดงตัวเลขลบ (ไม่มี opening balance)
- **feat:** export bundle ส่งสำนักงานบัญชี — `modules/accounting/export_bundle.js`
  - Excel 1 ไฟล์ มี 4 sheets: TB / P&L / BS / Journal
  - ใช้ window.XLSX (SheetJS) — single fetchAll() reuse data
  - Period picker month/quarter/year/custom
- 🎉 **Phase 88 ครบสมบูรณ์** — รองรับทุก use case จาก spec ของ user

---

## 5.34.7 (build 174) — 2026-05-08

### Phase 88.4 — งบดุล Balance Sheet
- **feat:** หน้างบดุล — สมการบัญชี Assets = Liabilities + Equity
  - `modules/accounting/balance_sheet.js` (~310 lines): closing balance
    cumulative ตั้งแต่ effective date 2026-01-01 → as-of date
  - 3 sections: Assets (Dr-Cr) / Liabilities (Cr-Dr) / Equity (Cr-Dr)
    + Retained Earnings (Σincome-Σexpense) → row พิเศษใน Equity
  - Equation card: balance check ✓ สีเขียว / ⚠️ สีแดง + ผลต่าง
  - Negative number warning → แนะนำลง JV ประเภท OB (Phase 88.5)
- "As of date" picker (default=today, min=2026-01-01) + Excel + พิมพ์

---

## 5.34.6 (build 173) — 2026-05-08

### Phase 88.3 — งบกำไรขาดทุน (P&L)
- **feat:** หน้างบกำไรขาดทุน — รายได้ - ค่าใช้จ่าย = กำไร/ขาดทุนสุทธิ
  - `modules/accounting/profit_loss.js`: 2 sections (รายได้ 4xxx / ค่าใช้จ่าย 5xxx)
    + Net Income card (สีเขียวถ้ากำไร / แดงถ้าขาดทุน) + Margin %
  - ใช้ logic ตรงมาตรฐานบัญชี: income normal Cr balance, expense normal Dr balance
  - Period picker + Export Excel + พิมพ์ (เหมือน Trial Balance)

---

## 5.34.5 (build 172) — 2026-05-08

### Phase 88.2 — Trial Balance Report
- **feat:** หน้ารายงานยอดทดลอง (รายงานหัวใจของบัญชี — ส่งสำนักงานบัญชีได้)
  - `modules/accounting/trial_balance.js`: period picker (เดือน/ไตรมาส/ปี/custom)
    + auto-aggregate Dr/Cr per account + balance check Dr=Cr
  - 5 sections (สินทรัพย์/หนี้สิน/ส่วนของเจ้าของ/รายได้/ค่าใช้จ่าย) + subtotals
  - Export Excel (5 columns + total row) + พิมพ์ (popup window)
- ใช้ "4-point checklist" — เพิ่ม route ครบทั้ง 4 จุด (index.html + ALL_ROUTES +
  ROUTE_GROUP + routeTitles/showRoute) — ไม่พลาดเหมือน Phase 88.1b initial

---

## 5.34.4 (build 171) — 2026-05-08

### Phase 88.1b hotfix + verified end-to-end
- `cb4c13b` **fix:** เพิ่ม `accounting_backfill` ใน `ALL_ROUTES` list
  - Phase 88.1b (build 170) ลืมจุดนี้ → admin canAccessPage = false →
    กดปุ่ม Backfill แล้ว redirect ไป fallback (เข้าหน้าไม่ได้)
- ✅ **Verified end-to-end:** Backfill 91 rows → สร้าง JV ใหม่ 90 (1 มี JV แล้ว)
  - สมุดรายวัน 3 → 93 รายการ
  - PV/SV ครบทั้งเดือน เม.ย.-พ.ค. 2026 → trial balance ครบจริง

---

## 5.34.3 (build 170) — 2026-05-08

### Phase 88.1b — Receipts/Service Jobs auto-post + Backfill UI
- **feat:** auto-post JV จาก 4 sources ใหม่ + Backfill UI
  - `auto_post.js`: เพิ่ม `postJournalForReceipt` (RV) + ขยาย `EXPENSE_CATEGORY_MAP`
    (salary/labor_hire/payroll/materials/utilities)
  - `receipts.js`: wire 2 จุด (dropdown + preview button) — fire ตอน status=paid
  - `main.js saveServiceJob`: wire ตอน status transition → done/delivered/closed
    (xhrPost ใส่ `returnData: true` ขอ id; ใช้ `state.serviceJobs` ที่ optimistic update
    เพื่อได้ total_cost)
  - `modules/accounting/backfill.js`: หน้าใหม่ — เลือก source + date range → preview/run
    batch post (idempotent)
- **Architecture:** Payroll ไม่ wire ตรง — ใช้ expense flow (Phase 76 auto-create
  expense category=salary ตอน markPaid → triggers postJournalForExpense)
  เพื่อกัน duplicate JV (1 transaction = 1 JV)

---

## 5.34.2 (build 169) — 2026-05-08

### Phase 88.1a-fix — RLS hotfix + wire auto-post ที่ pos.js (จุดที่ POS ใช้จริง)
- `60b8fee` **fix:** wire `postJournalForSale` ใน `modules/pos.js doCheckout()`
  (build 168 wire ผิดที่ — main.js:checkout() เป็น legacy ไม่ถูกเรียก)
- `6b2ff34` **fix:** RLS hotfix — split `je_admin`/`jl_admin` policies
  (Phase 88.0 ใช้ FOR ALL → block INSERT จาก non-admin → JV ไม่เกิด)
  - Run `supabase-phase88-hotfix-rls.sql` post-deploy
- ✅ **Verified end-to-end:** ขาย POS → JV `SV2026050001` เกิดอัตโนมัติ Dr 1110 / Cr 4100

---

## 5.34.1 (build 168) — 2026-05-08

### Phase 88.1a — Auto-post JV (sales + expenses)
- **feat:** auto-post Journal Entry จาก POS sale + expense (fire-and-forget)
  - `supabase-phase88-auto-post.sql`: partial unique index บน
    `(source_table, source_id)` → idempotent + 22 seed mappings
    (4 sales + 10 expenses + 5 services + 2 receipts + 2 payroll)
  - `modules/accounting/auto_post.js`: postJournalForSale/Expense/
    ServiceJob — effective date 2026-01-01, mapping cache lazy-loaded
  - `main.js`: wire `postJournalForSale` ใน checkout()
  - `modules/expenses.js`: wire 2 จุด (manual save + AutoKey OCR flow)
- **⚠️ Post-deploy:** ต้องรัน `supabase-phase88-auto-post.sql` ใน Supabase

---

## 5.34.0 (build 167) — 2026-05-08

### Phase 88.0 — Accounting Foundation
- `98f5574` **feat:** accounting foundation
  - SQL: chart_of_accounts (51 Thai accounts) + journal_entries
    (je_balanced CHECK) + journal_lines (line_one_side CHECK) +
    fiscal_periods + is_accountant() helper + 4 RLS policies admin-only
  - JS: journals.js (สมุดรายวัน list) + journal_form.js (manual JV) +
    coa.js (ผังบัญชี + CSV/Excel import/export)

---

## 5.33.5 (build 166) — 2026-05-08

### Phase 87.5 — Full catalog spec seed
- `aabd340` **feat:** seed extended specs ครบ 211 รุ่นที่เหลือ → 223/223 (100%)
  - Python script `scripts/seed_specs.py` — 45+ section templates + per-BTU class scaling
  - main.js cache logic เปลี่ยน: ratio-based (≥90% specced) แทน "any feature" check
  - Caveat: แบรนด์เล็ก (FRIO, MAVELL, STAR AIR ฯลฯ) ใช้ default ตาม BTU class — ไม่ใช่ official spec sheet

---

## 5.33.4 (build 165) — 2026-05-07

### Phase 87.4 — Copy spec from another SKU (Hybrid workflow boost)
- `8712bb1` **docs:** HANDOFF sync to 5.33.4
- `8266167` **feat:** ปุ่ม "📥 ดูด" — fill spec form จากรุ่น A → B (ลด 8 นาที → 1.5 นาที/รุ่น = 5x faster)
  - Green panel ใต้ header + dropdown optgroup ตาม section
  - Self-filter: ไม่แสดงรุ่นปัจจุบันใน dropdown
  - Backwards-compat: ถ้า sourceList ว่าง → ไม่ render panel

---

## 5.33.3 (build 164) — 2026-05-07

### Phase 87.3 — CSV/Excel round-trip 24 columns
- `17c2d0a` **docs:** HANDOFF sync to 5.33.3
- `b7106f3` **feat:** Excel/CSV export/import รองรับ 24 columns (พื้นฐาน 8 + extended 16)
  - Helpers: `_arrToPipe`, `_pipeToArr`, `_tryNum`, `_toExportRow`, `_fromImportRow`
  - Smart serialization: arrays → `"item1 | item2"`, ranges → `"0.4-4.5"` string
  - Backwards-compat: old 8-column CSV ยัง import ได้

---

## 5.33.2 (build 163) — 2026-05-07

### Phase 87.2 — Admin spec editor + 12 SKUs seeded
- `847d718` **feat:** Modal form ใหม่สำหรับ admin กรอก spec (16 fields) + seed 8 SKUs เพิ่ม (รวม 12)
  - ✏️ button per row: `+ สเปก` (เทา) / `📋 แก้` (เขียว)
  - Number fields fall back to string (เช่น `"0.4-4.5"`)
  - 12 SKUs: TCL MFS/T-PROWD series, Carrier 38TVDB010, LG ISC10E, Daikin FTM 09 PV2S, Mitsubishi MSY-JZ 09 VF

---

## 5.33.1.1 (build 162) — 2026-05-07

### Phase 87.1.1 — Schema auto-refresh hotfix
- `111e052` **fix:** localStorage v1 cache ไม่ load JSON v2 — เพิ่ม detect `features|seer|description` แล้ว overwrite cache

---

## 5.33.1 (build 161) — 2026-05-07

### Phase 87.1 — Product detail modal + extended catalog schema
- `c315fd5` **feat:** modal สวยเหมือนห้างใหญ่ (hero image, badge, warranty, features, spec table) + schema v2 (16 extended fields)
  - ไฟล์ใหม่: `modules/product_detail_modal.js` (212 lines)
  - Wire ใน `customer_dashboard.js`: spread `...c` + click `[data-view-product]`
  - Seed 2 sample SKUs: MFS10, T-PROWD10
  - ESC + click-outside dismiss + mobile full-screen <640px

---

## 📋 Format guidelines

- **Headline** = 1 บรรทัด — `<commit> <type>: <สรุป>`
- **Types**: `feat` (ของใหม่), `fix` (แก้ bug), `docs` (เอกสาร), `refactor` (จัดโครงสร้าง), `chore` (อื่นๆ)
- **Bullets** = 1-2 ข้อ ต่อ commit ใหญ่ — เน้น user-impact
- **Skip**: tiny chores, version-bump-only commits — ดู git log ก็พอ
- **เนื้อหาลึก** (why / trade-off / architecture) — ใส่ใน HANDOFF.md ไม่ใช่ตรงนี้
