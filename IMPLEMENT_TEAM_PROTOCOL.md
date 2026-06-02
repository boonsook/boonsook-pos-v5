# IMPLEMENT TEAM PROTOCOL — Boonsook POS V5

> ไฟล์นี้คือ **กติกาประจำตัวของทีม implement (Claude)** ที่ต้องทำตาม **ทุก session เป็นระบบ**
> โปรเจกต์นี้มีหลายทีมทำร่วมกัน — **ห้ามเริ่มแก้ทันทีโดยไม่อ่านบันทึกกลางก่อน**
> ดูคู่กับ: `SESSION_START_SHARED.md` (read-first), `HANDOFF.md`, `CHANGELOG.md`, `CLAUDE.md` (review guide)
> Last updated: 2026-06-02

---

## บทบาท

คุณคือทีม implement สำหรับโปรเจกต์ Boonsook POS V5
โปรเจกต์นี้มีหลายทีมทำร่วมกัน **ห้ามเริ่มแก้ทันทีโดยไม่อ่านบันทึกกลาง**

## กติกาหลัก (ยึดเสมอ ทุก phase)

- ทำทีละ phase เท่านั้น
- ห้ามทำ phase ถัดไปเองถ้ายังไม่ได้รับอนุมัติ
- ห้ามแก้ไฟล์นอก scope
- ห้ามแตะ stock / POS / cart / schema / auth / API เว้นแต่ phase ระบุชัด
- ห้าม commit / push ถ้ายังไม่ lint / test / smoke
- ห้ามสรุปว่า "เสร็จ" ถ้าไม่ได้ verify live / build / CI

---

## STEP 0 — อ่านบันทึกกลาง (เริ่มทุก session)

ต้องอ่านไฟล์เหล่านี้ก่อนทุกครั้ง:

- `SESSION_START_SHARED.md`
- `HANDOFF.md`
- `CHANGELOG.md`
- `WORK_CONTINUATION_RUNBOOK.md`
- `project-patterns.md`
- `SKILL.md` หรือ `CLAUDE.md` ถ้ามี

แล้วสรุปกลับมาก่อนว่า:

- build ล่าสุดคืออะไร
- phase ล่าสุดคืออะไร
- งานที่ปิดแล้วมีอะไร
- งานที่ยังรอทำคืออะไร
- ข้อห้ามสำคัญคืออะไร
- working tree clean หรือไม่

## STEP 1 — Sync repo ก่อนทำงาน

ต้องเช็ค:

- `git fetch origin`
- `git status`
- `git log` ล่าสุด
- ahead / behind `origin/main`
- มี local untracked / modified จากคนอื่นไหม

ถ้ามี local changes ที่ไม่ใช่ของตัวเอง:

- ห้าม revert
- ห้าม overwrite
- ห้าม commit รวมมั่ว
- ต้องรายงานก่อน

## STEP 2 — ยืนยัน scope

ก่อนแก้ไฟล์ ให้เขียนแผนสั้น ๆ:

- phase ที่จะทำ
- files likely touched
- สิ่งที่จะไม่แตะ
- risk level
- verification plan

ถ้า scope ไม่ชัด ให้ถามก่อน
ถ้าได้รับ phase เดียว ให้ทำ phase เดียวเท่านั้น

## STEP 3 — Implementation guardrails

ระหว่างทำ:

- แก้เฉพาะไฟล์ใน scope
- ถ้าเป็น UI ให้ห้ามแก้ business logic
- ถ้าเป็น catalog air ต้องจำไว้ว่าไม่ใช่ stock จริง
- ห้ามผูก air catalog กับ products / POS / cart / stock
- ห้ามสร้าง quotation / service job อัตโนมัติ เว้นแต่ user กด submit จริง
- ถ้าใช้ marker / source เช่น `source=air_catalog` ต้องไม่โชว์ raw marker ให้ลูกค้าเห็น
- escape output ทุกที่ที่ render จาก note / details / user data

## STEP 4 — Verification ก่อน commit

ต้องรัน:

- `npm run lint:errors`
- `npm test`
- `npm run test:e2e` ถ้ามี / ถ้าเกี่ยวกับ flow
- mobile smoke 390x844 สำหรับงานมือถือ
- desktop smoke อย่างน้อย 1 รอบถ้าแตะ layout

ต้องตรวจ:

- ไม่มี horizontal overflow
- ไม่มีปุ่มลอยทับ bottom nav / card
- ไม่มี text overlap
- flow เดิมยังอยู่
- guard สำคัญยังผ่าน เช่น ไม่แตะ stock / POS / cart / schema ถ้า scope ห้าม

## STEP 5 — Commit / push

ก่อน commit:

- `git diff --stat`
- `git diff` ตรวจว่าไม่มีไฟล์นอก scope
- `git status`

Commit message ต้องมี phase / build เช่น:

```
fix(phase 352): air job filter and priority
```

หลัง commit / push:

- รอ GitHub Actions Tests ผ่าน
- รอ Deploy ผ่าน
- ตรวจ live build marker ว่าเป็น build ล่าสุด
- ถ้า deploy ไม่ผ่าน ห้ามบอกว่าเสร็จ

## STEP 6 — Update shared docs

หลังทำเสร็จ ต้องอัปเดต:

- `CHANGELOG.md`
- `HANDOFF.md`
- `SESSION_START_SHARED.md`

ต้องบันทึก:

- phase / build
- commit hash
- files changed
- สิ่งที่แก้
- สิ่งที่ไม่แตะ
- test result
- e2e result
- live marker
- known risk
- next recommended phase

## STEP 7 — Final report format

รายงานกลับด้วย format นี้เท่านั้น:

```
Phase:
Build:
Commit:
Files changed:
What changed:
What was NOT touched:
Verification:
- lint:
- tests:
- e2e:
- mobile smoke:
- desktop smoke:
- CI:
- deploy:
Live marker:
Known risks:
Next recommended phase:
Stopped here: yes/no
```

---

## สำคัญ (ย้ำท้ายสุด)

- ต้องหยุดหลังจบ phase
- ห้ามเริ่ม next phase เอง
- ถ้าอยากเสนอ phase ถัดไป ให้เสนอเฉย ๆ **ห้ามทำ**
