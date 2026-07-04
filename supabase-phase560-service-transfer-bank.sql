-- ═══════════════════════════════════════════════════════════════════════════
--  Phase 560 — งานบริการรับเงินโอน: Dr เข้าบัญชีตามประเภทงาน (transfer_debit_code)
-- ═══════════════════════════════════════════════════════════════════════════
--  OWNER-RUN เท่านั้น — รันทีละ STEP ใน Supabase SQL Editor.
--
--  ปัญหา: postJournalForServiceJob (auto_post.js) รับเงินโอน hardcode Dr="1130" แบน →
--  งานบริการทุกประเภทกองรวม 1130 ไม่เข้าบัญชีย่อยที่ owner ตั้งไว้ (1134 งานช่าง / 1136
--  ขายพร้อมติดตั้ง). ต่างจาก POS (BANK_COA note) + ใบเสร็จ (bank_coa_code) ที่ route ถูกแล้ว.
--
--  แก้: เพิ่มคอลัมน์ account_mapping.transfer_debit_code (Dr โอน ต่อประเภทงาน). code (build 560)
--  อ่านค่านี้ route Dr; ยังไม่ตั้ง/ไม่ valid = fallback 1130 (ไม่ regress).
--
--  ★ owner decision (mapping): ทุกงาน → 1134 (KBANK งานช่าง) ยกเว้น ติดตั้งแอร์ + โซลาร์ → 1136 (SCB).
-- ───────────────────────────────────────────────────────────────────────────

-- ── STEP 0 — เพิ่มคอลัมน์ ──────────────────────────────────────────────────
ALTER TABLE public.account_mapping
  ADD COLUMN IF NOT EXISTS transfer_debit_code TEXT REFERENCES public.chart_of_accounts(code);
NOTIFY pgrst, 'reload schema';

-- ── STEP 1 — verify ก่อนตั้ง: ควรเห็น service_* ครบ 11 keys ───────────────────
--   (service_install_ac, service_repair_ac, service_clean_ac, service_move_ac,
--    service_satellite, service_repair_fridge, service_repair_washer, service_cctv,
--    service_repair_tv, service_solar, service_other). ถ้าขาด key ไหน = ยังไม่ได้รัน
--    supabase-phase88-service-mappings.sql / phase88-16-solar-mapping.sql → รันก่อน.
SELECT mapping_key, description, credit_account_code, transfer_debit_code
FROM public.account_mapping
WHERE mapping_key LIKE 'service_%'
ORDER BY mapping_key;

-- ── STEP 2 — ตั้งค่า (owner decision) ───────────────────────────────────────
--   ★ 1136 = SCB ขายพร้อมติดตั้ง · 1134 = KBANK งานช่าง (ยืนยันมีจริงใน chart_of_accounts)
UPDATE public.account_mapping SET transfer_debit_code = '1136'
  WHERE mapping_key IN ('service_install_ac', 'service_solar');

UPDATE public.account_mapping SET transfer_debit_code = '1134'
  WHERE mapping_key IN ('service_repair_ac', 'service_clean_ac', 'service_move_ac',
                        'service_satellite', 'service_repair_fridge', 'service_repair_washer',
                        'service_cctv', 'service_repair_tv', 'service_other');

-- ── STEP 3 — verify หลัง: install_ac/solar=1136, ที่เหลือ=1134, ครบทุก service_* ──
SELECT mapping_key, transfer_debit_code
FROM public.account_mapping
WHERE mapping_key LIKE 'service_%'
ORDER BY mapping_key;
-- Expected: service_install_ac|1136 · service_solar|1136 · ที่เหลือ 9 keys = 1134

-- ── ROLLBACK (ถ้าต้องถอน) ───────────────────────────────────────────────────
-- ALTER TABLE public.account_mapping DROP COLUMN transfer_debit_code;
-- NOTIFY pgrst, 'reload schema';
