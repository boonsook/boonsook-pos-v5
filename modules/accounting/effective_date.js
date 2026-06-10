// ═══════════════════════════════════════════════════════════
//  effective_date.js — วันเริ่มบัญชีจริง (cutoff) ★ single source of truth
//
//  ★ Phase 413: เริ่มบัญชีจริง 1 ก.ค. 2569 (เดิม 2026-05-01 จาก Phase 88.18b)
//  ข้อมูลก่อนวันนี้ = test data — ไม่ถูกลบ แค่หลุดจากรายงาน/auto_post อัตโนมัติ
//
//  ใช้โดย: auto_post (_isAfterEffective) · balance_sheet · export_bundle ·
//  opening_balance · backfill (cutoff + UI text) · service_reconcile (default)
//  เปลี่ยนวันอีกครั้งในอนาคต = แก้ที่ไฟล์นี้ที่เดียว (กันตกหล่นแบบ 6-จุด-กระจาย)
// ═══════════════════════════════════════════════════════════
export const ACCOUNTING_EFFECTIVE_DATE = "2026-07-01";
