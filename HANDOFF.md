# 📋 HANDOFF — Boonsook POS V5 PRO

**วันที่บันทึก:** 22 เมษายน 2026
**สถานะ:** Production at boonsukair.com (Cloudflare Pages)
**เป้าหมายเอกสาร:** ให้ Claude คนใหม่ / ผู้ช่วยคนใหม่ เปิดอ่านไฟล์นี้แล้วรับช่วงต่อได้ทันทีโดยไม่ต้องเริ่มใหม่

---

## 🧑 เกี่ยวกับเจ้าของ

- **ชื่อ:** gangboo
- **Email:** gangboo@gmail.com
- **ใช้ภาษา:** ไทย (ตอบภาษาไทย ยกเว้น code/terminology)
- **สไตล์:** ทำให้ถูกต้องครั้งเดียว ไม่ชอบ revise ซ้ำ — craftsman style
- **บริบทอื่น:** เทรดหุ้นอเมริกัน ชอบ design ชอบเรียนของใหม่

---

## 🏗️ โครงสร้างโปรเจกต์

### Tech Stack
- **Frontend:** Vanilla JS (ไม่ใช้ framework), HTML5, CSS3, Service Worker
- **Hosting:** Cloudflare Pages (Git integration with GitHub)
- **Backend:** Cloudflare Pages Functions (serverless) + Supabase (PostgreSQL + Auth + RLS + Storage)
- **Realtime notification:** LINE Messaging API (push) — 2 กลุ่ม (queue + done)
- **SMS OTP:** Twilio (มี fallback แสดง OTP บนจอถ้า Twilio fail)
- **AI:** Cloudflare Workers AI (binding: `AI`) สำหรับ AI Sales chat

### URLs
- **Production:** https://boonsukair.com
- **GitHub:** https://github.com/boonsook/boonsook-pos-v5
- **Cloudflare:** Pages project ชื่อ `boonsook-pos`

### Local Path (Windows)
```
C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github\
```
(Workspace folder — Claude เห็นว่าเป็น `C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5` mount)

---

## 📁 Repo Layout

```
boonsook-pos-v5-github/
├── index.html              # Entry page
├── main.js                 # 2037 lines — app shell, xhr helpers, routing, showToast, loadAllData
├── ai-chat-widget.js       # AI chat widget (บน customer_dashboard)
├── sw.js                   # Service Worker (cache assets)
├── style.css, phase4-*.css # Styles
├── supabase-config.js      # Supabase URL/anon key (in-browser)
├── manifest.json           # PWA manifest
├── offline.html            # Offline fallback
│
├── modules/                # 35 feature modules
│   ├── main.js             # (dup name — different from root main.js)
│   ├── pos.js              # 1056 lines — POS checkout flow
│   ├── ai_sales.js         # 865 lines — AI recommender + order form
│   ├── customer_dashboard.js  # Customer-facing ordering
│   ├── sales.js, products.js, customers.js  # CRUD
│   ├── service_jobs.js     # งานซ่อม/ติดตั้ง/ออเดอร์ (ทุกประเภท)
│   ├── service_request.js  # ฟอร์มรับแจ้งงาน
│   ├── staff.js, auth.js   # Auth + staff mgmt
│   ├── dashboard.js        # Main dashboard
│   ├── ac_shop.js, ac_install.js, solar.js, btu_calculator.js  # เฉพาะทาง
│   ├── line_notify.js      # Settings UI for LINE groups
│   ├── thermal_printer.js  # พิมพ์ใบเสร็จ
│   └── ... (อีก ~20 modules)
│
├── functions/api/          # Cloudflare Pages Functions
│   ├── send-otp.js         # POST /api/send-otp (Twilio)
│   ├── verify-otp.js       # POST /api/verify-otp (HMAC)
│   ├── line-notify.js      # POST /api/line-notify (LINE push)
│   └── ai-assistant.js     # POST /api/ai-assistant (Workers AI)
│
├── data/                   # Seed data / static json
├── icons/                  # PWA icons
│
├── .gitattributes          # CRLF/LF rules
├── .gitignore              # *.new, *.bak, *.bat, .env
├── OVERNIGHT_REPORT.md     # รายงาน overnight 22-04-2026 (scoring)
├── OVERNIGHT-NOTES.md      # Notes 21-04-2026
└── HANDOFF.md              # ไฟล์นี้
```

---

## 🔐 Environment Variables (Cloudflare Pages → Settings)

### Required for full functionality
- `LINE_CHANNEL_ACCESS_TOKEN` — LINE Messaging API channel token
- `LINE_USER_ID` — default recipient (fallback ถ้า group vars ไม่ตั้ง)
- `LINE_GROUP_QUEUE` — groupId สำหรับออเดอร์ใหม่/คิว (AI Sales + customer_dashboard ใช้ target `"queue"`)
- `LINE_GROUP_DONE` — groupId สำหรับงานเสร็จ (POS checkout ใช้ target `"done"`)
- `OTP_SECRET` — HMAC secret สำหรับ OTP stateless
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — SMS

### Cloudflare AI binding
ตั้งใน Pages → Settings → Functions → AI bindings:
- Variable name: `AI`
- Catalog: Workers AI

### Supabase
ใส่ตรง ๆ ใน `supabase-config.js` (public anon key) — ไม่ใช่ secret

---

## 🧠 Patterns ที่ต้องรู้ (สำคัญมาก)

### 1. xhr helpers — หลักของทุก HTTP call ไป Supabase
อยู่ใน `modules/main.js` (บรรทัด ~60-170):
```js
window.App.xhrPost(table, payload, options)   // INSERT
window.App.xhrPatch(table, payload, query)    // UPDATE
window.App.xhrDelete(table, query)            // DELETE
window.App.xhrGet(url)                        # SELECT (raw URL)
```
**คืนค่า:** `{ ok: boolean, data?: any, error?: { message: string } }`
**Never throw** — always resolves. Check `result.ok`.

**เพิ่ม log ตั้งแต่ commit `32e8033`:** ทุก xhr ตอนนี้ log prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]` + response body 200–300 chars เมื่อ parse fail / 4xx / 5xx

### 2. Toast notification
```js
window.App?.showToast?.("ข้อความ")    // ใช้ optional chain เสมอ
```
**อย่าใช้** `alert()` — overnight refactor กำจัดหมดทั้ง 15 จุดแล้ว (commit `8b6e0e3`)

### 3. LINE notify — 2 กลุ่ม routing
```js
ctx.sendLineNotify(message, { state, showToast }, "queue")   // ออเดอร์ใหม่
ctx.sendLineNotify(message, { state, showToast }, "done")    // เสร็จ
ctx.sendLineNotify(message)                                  // default (LINE_USER_ID)
```
Backend `/api/line-notify` อ่าน `target` param แล้ว map ไป `LINE_GROUP_QUEUE` / `LINE_GROUP_DONE` / `LINE_USER_ID`

### 4. API response shape (หลัง commit `40ce96e`)
ทุก `/api/*` endpoint ตอนนี้ consistent:
- Success: `{ ok: true, ...data }`
- Error: `{ ok: false, error: "ข้อความไทย" }` (ไม่ leak `err.message` ฝั่ง client)
- Server-side: `console.error("[endpoint-name] server error:", err)` → ดูได้ใน Cloudflare Functions Logs

### 5. Supabase RLS
เปิดใช้งาน RLS ที่ทุกตาราง ใช้ `user_id` ของ staff/customer เป็นหลัก
- Staff login ผ่าน Supabase Auth ปกติ
- Customer login ผ่าน OTP → verify → `authPassword` deterministic (HMAC) → `signInWithPassword` ไป Supabase

### 6. Service Worker
`sw.js` cache static assets ถ้า deploy ใหม่ user ต้อง **Ctrl + Shift + R** ล้าง cache ถึงเห็น
- **TODO:** ยังไม่มี "version ใหม่ refresh ด่วน" banner

---

## ⚠️ Gotchas ที่โดนมาแล้ว

### 1. Edit tool truncate ไฟล์ที่มี emoji/Thai special chars
**ปัญหา:** Claude's Edit tool เคยตัด EOF ของ `ai_sales.js` และ `customer_dashboard.js` (หายไป 5-10 บรรทัด) เมื่อแก้ไฟล์ที่มี `\u0e49`, `\U0001F6D2`, surrogate pairs บาง combination

**วิธีแก้ (best practice):**
1. เขียน Python patch script ใน `outputs/` แทนการใช้ Edit tool โดยตรง
2. Script ต้องเช็ค `count == 1` assertion ก่อน replace (กัน match ผิด)
3. Script ต้องเก็บ EOL style เดิม (CRLF/LF) โดยอ่านเป็น bytes ก่อน
4. รัน `node --check` ทุกไฟล์ที่แก้ เพื่อ verify syntax
5. `tail -5` ไฟล์ดู EOF ไม่โดนตัด

**ตัวอย่าง pattern:**
```python
with open(path, "rb") as f:
    raw = f.read()
eol = b"\r\n" if b"\r\n" in raw[:2000] else b"\n"
s = raw.decode("utf-8")
E = eol.decode("utf-8")
# ...
old = 'some code' + E + 'next line' + E
new = 'fixed code' + E + 'next line' + E
c = s.count(old)
assert c == 1, f"count={c}"
s = s.replace(old, new)
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(s)
```

### 2. Python f-string backslash ห้าม
```python
f"EOL: {'CRLF' if eol == b'\\r\\n' else 'LF'}"   # ❌ SyntaxError
```
ใช้แบบนี้แทน:
```python
eol_name = "CRLF" if eol == b"\r\n" else "LF"
print("EOL:", eol_name)
```

### 3. Bash heredoc mangles `!`
ใน heredoc `<< 'EOF'` เมื่อเขียน Python ที่มี `c != 1` bash อาจแทรก backslash → `c \!= 1` → SyntaxError ให้เขียนเป็น `not c == 1` หรือ `if c == 0 or c > 1:` แทน

### 4. CRLF vs LF
- **Root files (main.js, index.html, ai-chat-widget.js):** LF
- **modules/\*.js:** CRLF (ส่วนใหญ่)
- **functions/api/\*.js:** CRLF (ส่วนใหญ่), ยกเว้น `ai-assistant.js` = LF
- **อย่าบังคับเปลี่ยน** — `.gitattributes` จัดการให้แล้ว แค่ preserve EOL ของแต่ละไฟล์

### 5. Cloudflare webhook stuck
บางครั้ง GitHub push แล้ว Cloudflare ไม่ deploy ใน 5-40 นาที **วิธีแก้:**
```bash
git commit --allow-empty -m "chore: trigger cloudflare pages deploy"
git push origin main
```
(เคยทำใน commit `0cfb88c`, `323cb99`, `33a5706`, `95c42c8`)

**อย่า** คลิก "Save and deploy" จาก Cloudflare upload mode — จะ **disconnect Git integration** ต้อง reconnect ใหม่

### 6. Git plumbing เมื่อ `git add/commit` ไม่ทำงาน
Windows mount บน Linux sandbox บางครั้ง `git add` เจอ permission error วิธีแก้ commit ตรงผ่าน plumbing:
```bash
BLOB=$(git hash-object -w path/to/file.js)
# Build new tree:
ROOT_TREE=$(git cat-file -p HEAD^{tree})
# ... replace entry, git mktree ...
NEW_COMMIT=$(echo "$MSG" | git commit-tree $NEW_ROOT -p $HEAD)
echo "$NEW_COMMIT" > .git/refs/heads/main
```

---

## 🧪 Test Accounts

### Staff (Admin)
- ถามเจ้าของ — Supabase Auth ใน dashboard

### Customer (OTP)
- ใช้เบอร์จริง → Twilio ส่ง SMS
- **Dev fallback:** ถ้า Twilio fail / trial limit → endpoint `/api/send-otp` return `devCode` ใน response → main.js แสดงในหน้าจอ (`console.info` + toast)

---

## 📝 งานเมื่อคืน (22-04-2026) — 7 บั๊กแก้ไปแล้ว

สรุปสั้น ดูละเอียดใน `OVERNIGHT_REPORT.md`

### Commits 5 อัน (push แล้วที่ 40ce96e)
1. `58abf5e` — ai_sales: ปุ่มการ์ด reset เมื่อยกเลิก/error, "✅ สั่งแล้ว" เมื่อสำเร็จ
2. `8b6e0e3` — แทน `alert()` 15 จุด → `showToast` (doc-utils, pos, sales, service_jobs, staff, main)
3. `32e8033` — main.js xhr helpers ใส่ console.warn/error 4 จุด silent catch
4. `6499eb2` — pos.js ลบ toast ซ้ำ + try/catch ครอบ doCheckout invoke
5. `40ce96e` — functions/api/\*.js normalize error shape `{ok:false, error}` + `console.error`

### คะแนนแอป (หลัง fix)
- **Code Quality: 7.5 / 10**
- **UX: 8.0 / 10** (ขึ้น +1.5)
- **Security: 7.0 / 10**
- **Performance: 7.5 / 10**
- **Error Handling: 7.5 / 10** (ขึ้น +2.5)
- **Accessibility: 6.0 / 10**
- **รวม: 7.25 / 10**

---

## 🛣️ TODO — งานที่ควรทำต่อ (เรียงตาม ROI)

### Quick wins (< 1 ชั่วโมง)
1. **Loading skeleton** — dashboard, customer list load ข้อมูลนาน ไม่มี spinner
2. **Service Worker version banner** — "มีเวอร์ชันใหม่ คลิกเพื่อ refresh"
3. **ลบ console.log 6 จุด** ที่เหลือใน modules/ ก่อน production
4. **ลบไฟล์ `.new` 6 ไฟล์** (user ต้องลบเองจาก Windows Explorer)

### Medium (1-3 ชั่วโมง)
5. **XSS audit 16 จุด `innerHTML ${}`** — escape ด้วย `textContent` หรือ DOMPurify
6. **Empty state** ในทุกหน้าเมื่อไม่มีข้อมูล
7. **Offline queue retry** สำหรับ checkout / LINE notify
8. **Silent catch cleanup** — 50 จุดที่เหลือใน ac_shop, ai_sales, customers ฯลฯ (ไม่ critical)

### Large (> 3 ชั่วโมง)
9. **Pagination** สำหรับรายการ > 500 items
10. **Accessibility pass** — `<div onclick>` → `<button>`, focus outline, alt text
11. **Dashboard RPC** — ย้าย aggregation ไป Supabase server-side

---

## 🧭 คำสั่งประจำ (Cheat Sheet)

### Deploy
```bash
cd "C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github"
git status
git log --oneline -5
git push origin main
# Cloudflare auto-deploy 1-2 นาที
```

### Hard refresh (clear SW cache)
Ctrl + Shift + R ใน browser

### ดู Cloudflare Functions Logs
Dashboard → Pages → boonsook-pos → Functions → Realtime Logs

### ดู Supabase
Dashboard → Table Editor / Auth / Storage

### Check syntax ไฟล์เดียว (ถ้า Claude แก้ไฟล์)
```bash
cd "C:\Users\Lenovo E14 Gen4\Documents\boonsuk v5\boonsook-pos-v5-github"
node --check modules/pos.js
```

### Rollback commit ล่าสุด
```bash
git reset --hard HEAD~1
git push --force-with-lease origin main
```

---

## 📋 หน้าทั้งหมดในแอป (รู้ไว้เผื่อ user ถาม)

### Staff side (dashboard route `/admin` — auth required)
- `dashboard` — สรุปยอดขาย, กราฟ, KPIs
- `pos` — ขายหน้าร้าน (checkout, QR, attach slip)
- `products` — สินค้า (CRUD + barcode print)
- `sales` — ประวัติการขาย
- `customers` — ลูกค้า + loyalty
- `service_jobs` — งานซ่อม/ติดตั้ง/ออเดอร์ใหม่
- `service_request` — ฟอร์มรับแจ้ง (สำหรับพนักงานกรอกแทนลูกค้า)
- `ai_sales` — AI ช่วยแนะนำสินค้า + รับออเดอร์
- `ac_shop`, `ac_install`, `solar`, `btu_calculator` — เฉพาะธุรกิจแอร์/โซลา
- `expenses`, `profit_report`, `quotations`, `receipts`, `delivery_invoices` — การเงิน/เอกสาร
- `calendar` — ตารางงาน
- `stock_movements`, `loyalty`, `staff`, `settings`, `line_notify`, `payment_gateway`, `permission_matrix` — ตั้งค่า

### Customer side
- `customer_dashboard` — หน้าลูกค้าสั่งซื้อเอง (OTP login → browse → cart → checkout)
- `ai-chat-widget` — Chat bot (overlay บน customer_dashboard)

---

## 🗄️ Supabase Tables ที่ควรรู้

ตารางหลักที่โค้ดเรียกถึงบ่อย (ดูชื่อจาก `xhrPost("tablename", ...)` ใน grep):
- `service_jobs` — ทุกประเภทงาน (job_type: pos, ac, solar, ai_sales, other)
- `products`, `customers`, `sales`, `sale_items`
- `expenses`, `quotations`, `receipts`
- `staff`, `staff_permissions`
- `stock_movements`, `loyalty_points`
- `line_notify_settings` — เก็บ group IDs (สำรอง fallback)
- `store_settings` — ชื่อร้าน, ที่อยู่, QR image URL

**ระวัง:** มี commit เก่าที่แก้ BSK-\* orders จาก job_type ผิด → `"other"` (`fix(service_jobs): set job_type=other for web orders`)

---

## 🎯 บริบทล่าสุด (22-04-2026 เช้า)

User กำลังจะ:
1. รอ Cloudflare deploy เขียว (commit `40ce96e`)
2. Hard refresh boonsukair.com
3. เทสตาม 6 ขั้นใน OVERNIGHT_REPORT.md
4. รายงานผล

**ถ้า user เจอปัญหา:**
- ขอ screenshot + console log
- มองหา prefix `[xhrPost]`, `[xhrPatch]`, `[xhrDelete]`, `[pos doCheckout]`, `[ai-sales]`, `[send-otp]`, `[verify-otp]`, `[ai-assistant]`
- ถ้าเห็น response body = debug ได้ทันที (ก่อนหน้านี้เงียบสนิท)
- ถ้า UI ค้าง → user น่าจะเจอ error ที่ยังไม่ถูก catch — ให้เพิ่ม try/catch ที่ call site

---

## 📞 ติดต่อ / Next session

**ถ้า Claude session นี้จบกลางทาง เปิด session ใหม่แล้ว:**
1. อ่าน `HANDOFF.md` (ไฟล์นี้) ก่อน
2. อ่าน `OVERNIGHT_REPORT.md` เพื่อเข้าใจงานล่าสุด
3. `git log --oneline -20` เพื่อดู commit history
4. `git status` เพื่อดูว่ามี unstaged/uncommitted อะไรบ้าง
5. ถาม user ว่าอยากให้ทำอะไรต่อ อย่าเดาเอง

**Do's:**
- ใช้ Python script ใน `outputs/` สำหรับ patch ไฟล์ใหญ่ (เลี่ยง Edit tool truncate)
- `node --check` ทุกครั้งหลังแก้ JS
- Preserve CRLF/LF ของไฟล์เดิม
- Commit message แบบ conventional: `fix(module): ...`, `feat(module): ...`, `refactor(ux): ...`
- User ให้ push เอง — อย่า push แทน

**Don'ts:**
- อย่าใช้ `alert()`
- อย่า leak `err.message` ฝั่ง client ที่ API endpoints
- อย่าลบ `{ ok: false, error }` shape — frontend พึ่งพาตอนนี้
- อย่า bulk rewrite ไฟล์ใหญ่ด้วย Write tool — ใช้ Edit/Python script
- อย่าคลิก "Save and deploy" ใน Cloudflare upload mode
- อย่าสร้างไฟล์ `.bak`, `.new`, `.old` — ใช้ git history แทน

---

## 🗂️ รายงานอื่น ๆ ในโฟลเดอร์

- `OVERNIGHT_REPORT.md` — 22-04-2026 overnight session (scoring + test plan)
- `OVERNIGHT-NOTES.md` — 21-04-2026 notes
- `AUDIT_FINDINGS.md` (ถ้าอยู่ใน `outputs/`) — P0/P1/P2 issue list

---

**ขอบคุณที่อ่านถึงตรงนี้ครับ ช่วย gangboo ดูแลแอปต่อได้เลย** 🙏

_ลงชื่อ: Claude (Opus 4.7) — session 22-04-2026_
