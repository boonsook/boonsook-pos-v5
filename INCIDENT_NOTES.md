# Incident Notes

## 2026-05-28 - POS auto_post_jv RLS denied for sales role

### Status

**Phase 92.46 SQL ready — awaiting user apply** (2026-05-28)

- **SQL migration:** [`supabase-phase92-46-je-rls-rerun-and-tighten.sql`](supabase-phase92-46-je-rls-rerun-and-tighten.sql) (rerun-safe)
  - Re-applies `je_insert_auto` + `jl_insert_auto` policies (defense vs. "policy was reverted/never applied" scenarios — likely root cause)
  - Tightens WITH CHECK with `source_table` whitelist (8 known values from `auto_post.js`)
  - Adds 3 diagnostic views (`vw_sales_without_journal`, `vw_expenses_without_journal`, `vw_payroll_without_journal`)
  - Adds RPC `accounting_integrity_summary()` admin-only — counts (groundwork สำหรับ Phase 92.47 dashboard)
- **Action required (user):**
  1. Supabase Dashboard → SQL Editor → paste `supabase-phase92-46-je-rls-rerun-and-tighten.sql` → Run
  2. ตรวจ VERIFY queries (a)-(d) ที่ท้ายไฟล์ — Expected: 9 policies / `je_insert_auto` WITH CHECK มี whitelist / 3 views / RPC EXECUTE authenticated
  3. **Automated smoke (recommended):** `npm run verify:accounting`
     - Requires `.env` (cp `.env.example` → `.env` + fill test account creds)
     - Tests: admin RPC works · sales create sale+journal · whitelist guard · non-whitelist reject · no-source reject · 3 views accessible · non-admin RPC reject
     - Output: matrix + `✅ ALL PASS` หรือ `❌ FAIL` per scenario
     - Cleanup: ลบ test rows ที่สร้าง (order_no/doc_no LIKE 'TEST-92-46-%')
  4. **Manual smoke (alternative):** Login **sales** role → POS sale ฿10 → ตรวจ console
     - **Expected:** ไม่มี `auto_post_jv deferred (RLS denied role)` แล้ว
     - **Expected:** หน้า "บัญชี → สมุดรายวัน" filter doc_type=SV ต้องเห็น journal ของ sale นั้น
  5. **Manual SQL verify:** Login admin → SQL Editor → `SELECT public.accounting_integrity_summary();` — ดู counts ทั้ง 3 ตาราง
     - ถ้า `sales_without_journal > 0` แสดงว่ามี orphan สะสมไว้ (backfill ต้องรอ Phase 92.47 dashboard หรือ admin login + re-trigger postJournalForSale ผ่าน UI เดิม)

### Why this fixes it

Console warning ใน auto_post.js line 268 มาจาก fallback branch ตอน HTTP 403/42501 — แปลว่า RLS deny non-admin INSERT บน `journal_entries`. SQL phase89-25 ออกแบบมาเพื่อปิดช่องนี้แล้ว (เพิ่ม `je_insert_auto` policy ที่อนุญาต non-admin ถ้ามี source_table+source_id) แต่ถ้า production ยังไม่ได้รัน SQL นั้น (หรือถูก revert) policy ยังเป็น `je_admin` เก่า (FOR ALL admin only) → non-admin INSERT ถูก deny → warning

Phase 92.46 SQL เป็น strict superset ของ phase89-25 (rerun-safe DROP+CREATE) + เพิ่ม whitelist กัน non-admin spam source_table ปลอม

### Out of Scope (Phase 92.46)

- ไม่แก้ accounting math / mapping logic ใน `auto_post.js`
- ไม่ refactor postJournalForSale ไปเป็น SECURITY DEFINER RPC (defer — current behavior ที่ใช้ RLS allow non-admin INSERT พอแล้ว ถ้า whitelist tight)
- Backfill UI → Phase 92.47 dashboard

---

### Original status (kept for history)

Open / follow-up needed. This is separate from Phase 92.45 Leave SQL/RLS hardening.

### Where Seen

- Page: POS / cashier home
- Role: sales
- Browser console
- Build context: after Phase 92.45, app build 315 / version 5.64.0

### Console Message

```text
[auto_post_jv deferred (RLS denied role) for sales#155 -- source saved OK; verify je_insert_auto policy (supabase-phase89-25-fix-je-rls-pos.sql)]
```

### Meaning

The sale itself appears to save successfully, but automatic journal posting for the sale is deferred because the sales role is denied by RLS when trying to create the journal entry.

This is not a Leave RLS issue. It likely belongs to the accounting auto-post / journal entry policy path.

### Risk

- Sales records may exist without matching journal entries.
- Accounting reports, trial balance, or daily journal may be incomplete until backfilled.
- Admin may need a backfill/retry path if the auto-post is intentionally non-blocking.

### Suggested Follow-Up

Phase candidate: Sales Auto-Journal RLS / Backfill Hardening

Check:

1. Confirm the expected writer for POS sale auto journals:
   - sales user directly
   - security definer RPC
   - service/admin-only backfill
2. Review `supabase-phase89-25-fix-je-rls-pos.sql` and current journal entry RLS policies.
3. Review `modules/accounting/auto_post.js` sale posting path.
4. Verify whether `postJournalForSale` uses the current user auth context or an RPC.
5. If sales should not insert journals directly, add a trusted RPC or queued backfill path.
6. Add smoke test:
   - login sales
   - create POS sale
   - verify sale saved
   - verify journal entry exists or a visible deferred/backfill record exists
   - verify audit/log message is actionable

### Out of Scope

- Leave approve/reject RLS
- Payroll journal PV flow
- Payroll delete/reverse flow
