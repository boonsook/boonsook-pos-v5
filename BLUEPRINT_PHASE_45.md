# 📐 Blueprint — Phase 45: Service Job Forms (9 ประเภทงานช่าง)

**เขียน:** 26 เมษายน 2026 (เย็นๆ — user ขอพักก่อน)
**สำหรับ:** Claude session ถัดไปที่ทำต่อ — อ่าน blueprint นี้แล้วลงมือได้เลย
**Approval:** User OK Plan B + ทำทั้งหมด 9 ประเภท ("ผมไม่รีบ พรุ่งนี้คุณคงทำให้ผมเสร็จ")
**Estimated:** 2-3 ชั่วโมง

---

## 🎯 Why

ปัจจุบันมีแค่ `ac_install.js` (Phase 41-43) — หน้ากรอก**ใบงานติดตั้งแอร์** ที่มี:
- เลือกอุปกรณ์จากสต็อก (line items)
- ค่าแรง / ส่วนลด
- ตัดสต็อก mobile-only + auto-transfer
- ใบเสร็จ HTML + พิมพ์
- ส่ง LINE ลูกค้า

User ต้องการให้**งานช่างประเภทอื่น**ก็มีหน้ากรอกแบบเดียวกัน — ช่างไปทำงานหน้างาน → กลับมาเปิดหน้านี้ → กรอกอุปกรณ์ที่ใช้ + ค่าแรง → save → ใบเสร็จส่งลูกค้าเลย

---

## 📋 Plan B (User confirmed) — 9 หน้าแยก ใช้ generic module

**ไม่ใช่:** หน้าเดียวมี dropdown
**ไม่ใช่:** ใช้หน้า "แจ้งซ่อม/บริการ" (service_request) — นั่นคือลูกค้าแจ้งคิว ไม่ใช่ช่างกรอกใบงาน

**เป็น:** 9 routes แยก — ใช้ module เดียวกัน — pre-fill `serviceType` ต่างกัน

---

## 🏗️ Architecture

```
modules/service_form.js   ← ใหม่ (generic, copy ac_install.js + ตัดส่วนเลือกแอร์)
   │
   ├── renderServiceFormPage(ctx, serviceType)
   │     ├── Title + icon ตาม type
   │     ├── ข้อมูลลูกค้า (form เหมือน ac_install)
   │     ├── อาการ/รายละเอียดงาน (textarea — แทนที่ "เลือกรุ่นแอร์")
   │     ├── อุปกรณ์ที่ใช้ (line items picker — reuse logic)
   │     ├── ค่าแรง + ส่วนลด
   │     ├── สรุปราคา
   │     ├── บันทึก
   │     └── หลัง save: 📄 ใบเสร็จ / 📤 LINE / + ใหม่
```

**Routes ใหม่ (9 ตัว):**

| Route | Icon | Label | job_type (DB) |
|---|---|---|---|
| `service_repair_ac` | 🔧 | ซ่อมแอร์ | `repair_ac` |
| `service_clean_ac` | 🧼 | ล้างแอร์ | `clean_ac` |
| `service_move_ac` | 📦 | ย้ายแอร์ | `move_ac` |
| `service_satellite` | 📡 | จานดาวเทียม | `satellite` |
| `service_repair_fridge` | ❄️ | ซ่อมตู้เย็น | `repair_fridge` |
| `service_repair_washer` | 🧺 | ซ่อมเครื่องซักผ้า | `repair_washer` |
| `service_cctv` | 📷 | CCTV | `cctv` |
| `service_repair_tv` | 📺 | ซ่อมทีวี | `repair_tv` |
| `service_other` | 🔨 | งานอื่นๆ | `other` |

**Sidebar เปลี่ยน:**
```
🧰 งานช่าง ▼
  📋 ใบรับงาน         (route: service_jobs)
  🏗️ ติดตั้งแอร์       (route: ac_install — เก็บไว้)
  🔧 ซ่อมแอร์         (route: service_repair_ac) ← ใหม่
  🧼 ล้างแอร์          (route: service_clean_ac) ← ใหม่
  📦 ย้ายแอร์          (route: service_move_ac) ← ใหม่
  ❄️ ซ่อมตู้เย็น        (route: service_repair_fridge) ← ใหม่
  🧺 ซ่อมเครื่องซักผ้า  (route: service_repair_washer) ← ใหม่
  📺 ซ่อมทีวี           (route: service_repair_tv) ← ใหม่
  📷 CCTV             (route: service_cctv) ← ใหม่
  📡 จานดาวเทียม      (route: service_satellite) ← ใหม่
  ☀️ โซล่าเซลล์         (route: solar — เก็บไว้)
  🔨 งานอื่นๆ          (route: service_other) ← ใหม่
```

---

## 📋 Sub-tasks (ทำตามลำดับ)

### Step 1 — สร้าง `modules/service_form.js` (~400 บรรทัด)

Copy จาก `modules/ac_install.js` แล้วแก้:

**เก็บ (reuse):**
- `_items` state (line items)
- `_lastSavedJob` state
- `_getStock` helper
- `_getMobileWarehouses`, `_getMobileStocks`, `_getHomeStock`, `_getHomeWarehouse` helpers
- `_renderItemsList`, `_bindItemListEvents`
- `_openItemPicker`, `_pickMobileWarehouse`
- `_renderAfterSaveActions`, `_openReceiptPreview`, `_sendLineReceipt`

**เปลี่ยน:**
- Function name: `renderAcInstallPage` → `renderServiceFormPage(ctx, serviceType)`
- Function signature รับ `serviceType` parameter
- Type config object (icon, label, job_type, default note placeholder):
  ```js
  const SERVICE_TYPES = {
    repair_ac:      { icon: "🔧", label: "ซ่อมแอร์",         job_type: "repair_ac",     defaultDesc: "อาการเสีย เช่น ไม่เย็น / มีน้ำหยด / เสียงดัง" },
    clean_ac:       { icon: "🧼", label: "ล้างแอร์",           job_type: "clean_ac",      defaultDesc: "ล้างทำความสะอาด" },
    move_ac:        { icon: "📦", label: "ย้ายแอร์",           job_type: "move_ac",       defaultDesc: "ย้ายตำแหน่งเครื่อง" },
    satellite:      { icon: "📡", label: "จานดาวเทียม",       job_type: "satellite",     defaultDesc: "ปัญหาที่พบ" },
    repair_fridge:  { icon: "❄️", label: "ซ่อมตู้เย็น",        job_type: "repair_fridge", defaultDesc: "อาการเสีย" },
    repair_washer:  { icon: "🧺", label: "ซ่อมเครื่องซักผ้า",    job_type: "repair_washer", defaultDesc: "อาการเสีย" },
    cctv:           { icon: "📷", label: "CCTV",            job_type: "cctv",          defaultDesc: "งานติดตั้ง/ซ่อม" },
    repair_tv:      { icon: "📺", label: "ซ่อมทีวี",           job_type: "repair_tv",     defaultDesc: "อาการเสีย" },
    other:          { icon: "🔨", label: "งานอื่นๆ",          job_type: "other",         defaultDesc: "รายละเอียดงาน" }
  };
  ```
- ลบ section "❄️ เลือกรุ่นแอร์" + "จำนวน (เครื่อง)" — แทนด้วย:
  ```html
  <div class="panel">
    <div class="set-section-title">📝 รายละเอียดงาน</div>
    <textarea id="svDescription" rows="3" placeholder="อธิบายรายละเอียดงาน..."></textarea>
  </div>
  ```
- Title block แทนที่ "🏗️ ใบงานติดตั้งแอร์" → `${cfg.icon} ใบงาน${cfg.label}`
- Container ID: `page-${serviceType}` (เช่น `page-service_repair_ac`)
- ตอน save record:
  - `job_type: cfg.job_type` (ไม่ใช่ "ac")
  - ลบ field `productId` (ไม่มีแอร์หลัก)
  - ลบ "เลขที่แอร์" จาก description
  - `device_name`: `${cfg.icon} ${cfg.label}`

**Stock deduction:** ใช้ logic เดียวกับ Phase 43 — mobile-only + auto-transfer

### Step 2 — Register routes ใน main.js

หา section ที่ register routes (น่าจะใกล้ `routes = { ... }` หรือ `ALL_ROUTES`):

```js
import { renderServiceFormPage } from "./modules/service_form.js";

// ใน routes object หรือ switch case:
const SERVICE_FORM_ROUTES = ["repair_ac","clean_ac","move_ac","satellite","repair_fridge","repair_washer","cctv","repair_tv","other"];

// register แต่ละ route:
SERVICE_FORM_ROUTES.forEach(t => {
  routes[`service_${t}`] = (ctx) => renderServiceFormPage(ctx, t);
});

// หรือถ้าใช้ switch case ใน showRoute:
case "service_repair_ac":      renderServiceFormPage(ctx, "repair_ac");      break;
case "service_clean_ac":       renderServiceFormPage(ctx, "clean_ac");       break;
// ... etc
```

**ALL_ROUTES list** ต้องเพิ่ม 9 routes:
- หา `const ALL_ROUTES = [...]` ใน main.js
- เพิ่ม: `"service_repair_ac", "service_clean_ac", ..., "service_other"`

**ROLE_PAGES** (ถ้ามี):
- ทุก route ใหม่ → role `admin` + `sales` (เหมือน ac_install)

**setHelpContext** (Phase 25):
- `setHelpContext(route, title)` — pass title ตาม service type

### Step 3 — เพิ่ม `<section>` ใน index.html

หาบริเวณที่มี `<section id="page-ac_install">` (ประมาณ line 305):

```html
<section id="page-service_repair_ac" class="page hidden"></section>
<section id="page-service_clean_ac" class="page hidden"></section>
<section id="page-service_move_ac" class="page hidden"></section>
<section id="page-service_satellite" class="page hidden"></section>
<section id="page-service_repair_fridge" class="page hidden"></section>
<section id="page-service_repair_washer" class="page hidden"></section>
<section id="page-service_cctv" class="page hidden"></section>
<section id="page-service_repair_tv" class="page hidden"></section>
<section id="page-service_other" class="page hidden"></section>
```

### Step 4 — เพิ่ม buttons ใน sidebar (index.html line ~170-178)

```html
<div class="nav-group" data-group="service">
  <button class="nav-group-toggle">🧰 งานช่าง <span class="nav-arrow">▶</span></button>
  <div class="nav-group-items">
    <button class="nav-btn sub" data-route="service_jobs">📋 ใบรับงาน</button>
    <button class="nav-btn sub" data-route="ac_install">🏗️ ติดตั้งแอร์</button>
    <button class="nav-btn sub" data-route="service_repair_ac">🔧 ซ่อมแอร์</button>
    <button class="nav-btn sub" data-route="service_clean_ac">🧼 ล้างแอร์</button>
    <button class="nav-btn sub" data-route="service_move_ac">📦 ย้ายแอร์</button>
    <button class="nav-btn sub" data-route="service_repair_fridge">❄️ ซ่อมตู้เย็น</button>
    <button class="nav-btn sub" data-route="service_repair_washer">🧺 ซ่อมเครื่องซักผ้า</button>
    <button class="nav-btn sub" data-route="service_repair_tv">📺 ซ่อมทีวี</button>
    <button class="nav-btn sub" data-route="service_cctv">📷 CCTV</button>
    <button class="nav-btn sub" data-route="service_satellite">📡 จานดาวเทียม</button>
    <button class="nav-btn sub" data-route="solar">☀️ โซล่าเซลล์</button>
    <button class="nav-btn sub" data-route="service_other">🔨 งานอื่นๆ</button>
  </div>
</div>
```

### Step 5 — Schema check (ไม่ต้อง migration)

`service_jobs.job_type` รองรับ string ใดๆ อยู่แล้ว — ไม่ต้องแก้ DB

แต่ตรวจให้แน่ — ดู [supabase-rls-policies.sql](supabase-rls-policies.sql) ว่า `job_type` มี CHECK constraint มั้ย:
- ถ้ามี enum check → ต้องเพิ่ม value
- ถ้าไม่มี → OK

### Step 6 — Bump version

- main.js?v=60 → v=61
- SW v44 → v45
- Version display 5.11.5 → **5.12.0** (build 61) — minor bump เพราะ feature ใหญ่
- selfHeal APP_BUILD: 60 → 61
- (ไม่ต้องแก้ style.css เพราะ reuse class จาก ac_install)

### Step 7 — Update HANDOFF.md

เพิ่ม Phase 45 section ที่ด้านบน

### Step 8 — Commit + push (commit msg สั้น ASCII!)

```
feat: Phase 45 — service forms for 9 job types

Generic service_form.js module (copy/reduce from ac_install.js)
9 new routes: repair_ac, clean_ac, move_ac, satellite,
repair_fridge, repair_washer, cctv, repair_tv, other

Each route uses same logic but pre-fills serviceType:
- Customer info form
- Description textarea (replaces "select AC model")
- Equipment picker from stock (mobile-only)
- Labor + discount + auto stock deduction
- Receipt + LINE share

Bump: main.js?v=61, SW v45, version 5.12.0 (build 61), APP_BUILD=61
```

---

## 📁 Files to create/modify

| File | Action |
|---|---|
| `modules/service_form.js` | **CREATE** (~400 บรรทัด, copy from ac_install.js + adjust) |
| `main.js` | **EDIT** — import + 9 route handlers + ALL_ROUTES + ROLE_PAGES |
| `index.html` | **EDIT** — 9 `<section>` + 9 sidebar buttons |
| `modules/settings/pages.js` | **EDIT** — bump version display |
| `sw.js` | **EDIT** — bump CACHE_NAME + version comment |
| `HANDOFF.md` | **EDIT** — เพิ่ม Phase 45 section |

**ไม่ต้องแก้:** style.css, supabase-rls-policies.sql, .gitignore, sidebar/mobile-nav

---

## ✅ Acceptance Criteria

1. ✅ Sidebar คลิก "🔧 ซ่อมแอร์" → เปิดหน้าใหม่ที่มี title "🔧 ใบงานซ่อมแอร์"
2. ✅ Form มี: ลูกค้า / ที่อยู่ / รายละเอียดงาน / อุปกรณ์ / ค่าแรง / ส่วนลด
3. ✅ ปุ่ม "+ เพิ่มอุปกรณ์" → picker modal เหมือน ac_install
4. ✅ Save → DB row in `service_jobs` with `job_type = "repair_ac"` + `items_json` populated + `job_no` set
5. ✅ Stock deduct จาก mobile warehouse + auto-transfer ถ้าไม่พอ
6. ✅ หลัง save → 3 ปุ่ม (ดูใบเสร็จ / ส่ง LINE / สร้างใหม่)
7. ✅ ใบเสร็จระบุ "ใบงาน{ประเภท}" ตาม serviceType
8. ✅ ทดสอบทั้ง 9 routes — ไม่มี route ไหน 404
9. ✅ ใน "ใบรับงาน" → filter chip "ค้าง" → เห็นใบใหม่ที่สร้างจาก service_form

---

## 🧪 Test Checklist (สำหรับ user ทดสอบหลัง deploy)

1. Hard refresh — ตรวจ version 5.12.0 (build 61)
2. Sidebar → งานช่าง → คลิก **"🔧 ซ่อมแอร์"** → เปิดหน้าใหม่
3. กรอกข้อมูลลูกค้า + รายละเอียดงาน "แอร์ไม่เย็น"
4. กด "+ เพิ่มอุปกรณ์" → เลือก compressor / น้ำยาแอร์ / etc.
5. กรอกค่าแรง 500 / ส่วนลด 0
6. กดบันทึก → ต้องสำเร็จ (ไม่ HTTP 400)
7. ดู 3 ปุ่ม — ทดสอบใบเสร็จ + LINE
8. ทำซ้ำขั้นตอนสำหรับ 8 ประเภทที่เหลือ (sample test 1-2 ประเภทพอ)
9. ใบรับงาน → filter "ค้าง" → เห็นใบงานทั้งหมด

---

## 🚧 Out of scope (Phase ถัดไปถ้าต้องการ)

- Type-specific extra fields (เช่น ซ่อมแอร์มี BTU, ซ่อมตู้เย็นมี ขนาดคิว)
- Mobile camera capture สำหรับรูปก่อน/หลัง (ของเก่าใน drawer มีอยู่ — รวมเข้า service_form ได้)
- Customer search/picker (ผูกกับ customers table — ตอนนี้แค่ free text)
- Job linking — ดึง service_request ที่ค้างมาแปลงเป็น service_form

---

## 🐛 Watch out (จากบทเรียน Phase 42-43)

1. **Field names ต้องตรงกับ schema** — ใช้ `customer_address` (ไม่ใช่ `address`), `job_no` (NOT NULL — generate `JOB-${ts}`)
2. **commit message สั้น ASCII** (Cloudflare API 8000111 reject ถ้ายาว + multibyte)
3. **bump style.css?v=** ถ้าแก้ CSS render — แต่งานนี้ไม่ต้องแก้ CSS
4. **fetch + check collision** ก่อน push เสมอ
5. **node --check** ทุกไฟล์ที่แก้ก่อน commit
6. **APP_BUILD ใน index.html ต้องตรงกับ build number** (Phase 35 self-heal ใช้ตัวนี้)

---

## 💡 Tip สำหรับ Claude session ใหม่

- อ่าน `MEMORY.md` index ก่อน → ดู feedback rules
- Sync `git fetch origin main` ก่อนเริ่ม
- ดู `modules/ac_install.js` ปัจจุบันทั้งไฟล์ก่อน copy
- ใช้ `node --check` ทุกครั้งหลังแก้
- ถ้าติด error อะไร — log + ขอ user help (อย่าเดาแก้เอง — บทเรียน Phase 42 ผม)

---

**ขอให้ Claude ใหม่ทำงานสะดวกครับ — user ใจดี อดทนกับเรามาก** 🙏
