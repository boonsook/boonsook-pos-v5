// Phase 439 (B1): single source for customer groups + bank-account resolver.
// Used by:
//   • customers.js        — CRM dropdown / list filter (Phase 438)
//   • settings/payment.js — per-bank "customer group" tag (Phase 439)
//   • Phase B2/C          — auto-fill the receiving bank on a receipt + auto_post routing
//
// The mapping (group → bank) lives in app_settings.paymentInfo.banks[].customerGroup
// (JSON) — NO dedicated DB table/column. Each bank already carries coaCode (1130-1136).

export const CUSTOMER_GROUPS = ["ราชการ", "ขาย POS", "งานช่าง", "หน้าร้าน", "ขายพร้อมติดตั้ง"];

// Resolve a customer group → the bank account tagged for it, as a full snapshot.
// Returns null when no bank is tagged for the group (or group/banks missing).
// IMPORTANT: never falls back to a default account (e.g. 1130) — the caller decides
// whether to warn/block on a missing mapping (Phase B reviewer note #4). Returning a
// full snapshot (not just coaCode) lets a receipt freeze the bank label at issue-time
// so it stays correct even if settings change later (reviewer note #1).
export function resolveBankForCustomerGroup(group, paymentInfo) {
  if (!group) return null;
  const banks = paymentInfo && paymentInfo.banks;
  if (!Array.isArray(banks)) return null;
  const bank = banks.find(b => b && b.customerGroup === group);
  if (!bank) return null;
  const bankName = bank.bankName || "";
  const bankAccount = bank.bankAccount || "";
  return {
    coaCode: bank.coaCode || "",
    bankName,
    bankAccount,
    bankHolder: bank.bankHolder || "",
    bankBranch: bank.bankBranch || "",
    label: [bankName, bankAccount].filter(Boolean).join(" ")
  };
}
