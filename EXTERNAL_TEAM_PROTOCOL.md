# External Team Protocol — Boonsook POS V5

> กติกาสำหรับ **ทุกทีม/ทุก AI agent ภายนอก** (Claude, Codex, Kimi, อื่น ๆ) ที่มาช่วยดูแลแอปนี้
> คู่กับ [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md) (workflow ลงมือแก้โค้ดละเอียด)
> เป้าหมาย: หลายทีมช่วยกันตรวจ = ตาข่ายหลายชั้น จุดพลาดน้อยที่สุด — โดยไม่เพิ่มความเสี่ยงให้ repo
>
> **Owner แปะไฟล์นี้ (หรือลิงก์) ให้ทีมใหม่อ่านก่อนเริ่มงานแรกเสมอ**

---

## หลักการเดียวที่สำคัญที่สุด

**ทุกทีมคิด / เขียน prompt / implement / audit ได้เต็มที่ — แต่ทางเข้า repo มีประตูเดียว:**

```
ทีมไหนก็ได้                        ประตูเดียว (integration)            repo
┌────────────────────────┐   ┌──────────────────────────────┐   ┌──────────────┐
│ วิเคราะห์ / audit         │   │ verify กับ base ปัจจุบันเสมอ     │   │ branch → PR  │
│ เขียน phase prompt       │ → │ รัน gate เต็มก่อน push          │ → │ → CI เขียว    │
│ implement (zip/patch)   │   │ (lint / unit / e2e)           │   │ → owner merge │
└────────────────────────┘   └──────────────────────────────┘   └──────────────┘
```

ทีมที่ไม่มี GitHub integration ที่ถูกต้อง (GitHub App ที่ owner authorize) **ส่งงานเป็น zip/patch เท่านั้น**
— ห้ามขอ/รับ credential ทุกรูปแบบ (ดูข้อ 4)

---

## กติกา 6 ข้อ (บังคับทุกทีม ทุกงาน)

### 1. Baseline ก่อนเสมอ — งานทุกชิ้นอ้าง commit ปัจจุบัน

- ก่อนเริ่ม: `git fetch` แล้วจด `git log -1 origin/main` (commit hash)
- **รายงานทุกฉบับต้องระบุ base hash** — รายงานที่ไม่มี hash = งานยังไม่จบ
- ทำงานบน snapshot เก่า = ความเสียหายเงียบที่สุด (เคยเกิดจริง: ทีมหนึ่งแก้โค้ดบน snapshot
  3 เดือนเก่า — จุดที่ "แก้" ถูกแก้ไปแล้ว, ไฟล์ที่อ้างไม่มีอยู่จริง, ถ้า apply = ทับงาน 3 เดือน)

### 2. Deliverable = diff/patch + รายงาน `file:line` — ห้ามส่งไฟล์ทั้งไฟล์มาทับ

- การ copy ไฟล์เต็มทับของปัจจุบัน = ย้อนงานคนอื่นแบบมองไม่เห็นใน commit
- ถ้าจำเป็นต้องส่งไฟล์เต็ม (zip): ผู้รับต้อง **diff เทียบ base ก่อน apply เสมอ** —
  diff ต้องเล็กตรงตาม scope; diff บวมผิดปกติ = สัญญาณ base เก่า หยุดทันที
- รายงานอ้างตำแหน่งเป็น `path:line` จากโค้ดจริง ไม่ใช่จากความจำ

### 3. บอก mode ชัดทุกงาน — READ-ONLY audit หรือ implement

- **audit = อ่าน/วิเคราะห์/รายงานเท่านั้น** ห้ามแก้ไฟล์ ห้าม commit แม้ "เห็นว่าควรแก้"
- เจอบั๊กระหว่าง audit → **flag เป็นรายการในรายงาน** ให้ owner ตัดสิน ไม่ลงมือเอง
- implement = ตาม scope ใน phase prompt เท่านั้น ("สิ่งที่ต้องทำ" + "ห้ามแตะ")
- ทำเกินคำสั่ง = งานทั้งชิ้นถูก reject ไม่ว่าเนื้อจะดีแค่ไหน (เคยเกิดจริง: สั่ง audit
  ได้โค้ดแก้ 42 จุดกลับมา — reject ทั้งชุด)

### 4. ห้าม credential ผ่านแชท/ข้อความ — ทุกกรณี ไม่มีข้อยกเว้น

- ห้ามขอ และห้ามส่ง: GitHub PAT · SSH key · Supabase service_role key · รหัสผ่านใด ๆ
- "ส่ง token มา เดี๋ยวลบทีหลัง" = ไม่รับ — token ที่ผ่านแชทแล้วถือว่าหลุดจากการควบคุม
- ทีมที่ push ได้ = ทีมที่ owner authorize ผ่าน **GitHub App integration** เท่านั้น
  (scoped เฉพาะ repo นี้ · credential ไม่เคยผ่านแชท · เพิกถอนได้จุดเดียว)
- ทีมอื่น: ส่ง zip/patch → owner ส่งต่อให้ทีมที่มี integration ตรวจ + push ให้

### 5. รายงานทุกฉบับ = คำกล่าวอ้าง — ต้องมีทีมอื่น verify กับ source จริงก่อนเชื่อ

- ตัวเลข (test pass, line number, "แก้แล้ว", "มีอยู่แล้ว") ต้องถูกตรวจซ้ำกับโค้ด/ผลรันจริง
- ผู้ verify: อ่าน diff จริง ไม่ใช่อ่านรายงาน · รัน test เอง ไม่ใช่เชื่อตัวเลข ·
  นับ guard เอง · เช็ค EOL/markers เอง
- cross-team audit คือหัวใจของโมเดลนี้ — ทุกทีมเคยพลาดและทุกทีมเคยจับความพลาดของทีมอื่นได้
  (รวมถึงผู้เขียน protocol นี้เอง)

### 6. ทีละ phase → STOP รอ review — ไม่มีใครตัดสิน merge เองนอกจาก owner

- จบ phase = push branch + เปิด PR + รายงาน แล้ว **หยุด**
- ห้ามเริ่ม phase ถัดไปเอง · ห้าม merge เอง · ห้าม push เข้า `main` ตรงทุกกรณี
- Verdict เรียงเป็น **Blocking → Should-fix → Nit** พร้อม `file:line`

---

## Checklist สำหรับ owner (ตอนรับงานจากทีมภายนอก)

- [ ] รายงานมี base hash และตรงกับ `origin/main` ปัจจุบัน?
- [ ] Deliverable เป็น diff/patch (หรือ zip ที่ถูก diff เทียบ base แล้ว)?
- [ ] งานตรง mode ที่สั่ง (audit ไม่มีการแก้ไฟล์ / implement ไม่เกิน scope)?
- [ ] ไม่มีการขอ credential ใด ๆ?
- [ ] มีทีมที่สองตรวจซ้ำแล้ว (ไม่ merge จากรายงานทีมเดียว)?
- [ ] ผ่านประตูเดียว: branch → PR → CI เขียว → owner merge?

---

## อ้างอิง

- workflow ลงมือแก้โค้ด (STEP 0–7, gates, commit rules): [`IMPLEMENT_TEAM_PROTOCOL.md`](IMPLEMENT_TEAM_PROTOCOL.md)
- เกณฑ์ review / จุดเสี่ยงเงิน-สต็อก-ความปลอดภัย: [`CLAUDE.md`](CLAUDE.md) §4
- รูปแบบ phase prompt: [`PROMPT_PHASE_BRIEF_SKILL.md`](PROMPT_PHASE_BRIEF_SKILL.md)
