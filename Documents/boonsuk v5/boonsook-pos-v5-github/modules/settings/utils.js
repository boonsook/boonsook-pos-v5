// ═══════════════════════════════════════════════════════════
//  settings/utils.js — Shared utilities & constants
// ═══════════════════════════════════════════════════════════

export const THAI_BANKS = [
  { code: "", name: "-- เลือกธนาคาร --" },
  { code: "BBL", name: "ธนาคารกรุงเทพ (BBL)" },
  { code: "KBANK", name: "ธนาคารกสิกรไทย (KBANK)" },
  { code: "KTB", name: "ธนาคารกรุงไทย (KTB)" },
  { code: "SCB", name: "ธนาคารไทยพาณิชย์ (SCB)" },
  { code: "BAY", name: "ธนาคารกรุงศรีอยุธยา (BAY)" },
  { code: "TTB", name: "ธนาคารทหารไทยธนชาต (TTB)" },
  { code: "CIMBT", name: "ธนาคารซีไอเอ็มบีไทย (CIMBT)" },
  { code: "TISCO", name: "ธนาคารทิสโก้ (TISCO)" },
  { code: "KKP", name: "ธนาคารเกียรตินาคินภัทร (KKP)" },
  { code: "LHFG", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์ (LHFG)" },
  { code: "ICBC", name: "ธนาคารไอซีบีซี (ไทย) (ICBC)" },
  { code: "UOBT", name: "ธนาคารยูโอบี (UOBT)" },
  { code: "BAAC", name: "ธนาคาร ธ.ก.ส. (BAAC)" },
  { code: "GSB", name: "ธนาคารออมสิน (GSB)" },
  { code: "GHB", name: "ธนาคารอาคารสงเคราะห์ (GHB)" },
  { code: "ISBT", name: "ธนาคารอิสลามแห่งประเทศไทย (ISBT)" },
  { code: "OTHER", name: "อื่นๆ (พิมพ์เอง)" }
];

/**
 * Escape HTML special characters
 * @param {string} s - String to escape
 * @returns {string} Escaped string
 */
export function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format currency (Thai Baht)
 * @param {number} num - Number to format
 * @returns {string} Formatted currency
 */
export function formatCurrency(num) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0
  }).format(num || 0);
}

/**
 * Role colors for display
 */
export const ROLE_COLORS = {
  admin: "#dc2626",
  technician: "#d97706",
  sales: "#0284c7",
  customer: "#059669"
};
