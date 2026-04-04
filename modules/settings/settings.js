// ═══════════════════════════════════════════════════════════
//  settings.js — Shim: re-export จาก settings/index.js
//  แก้ปัญหา browser ไม่ auto-resolve folder/index.js แบบ Node.js
// ═══════════════════════════════════════════════════════════
export { renderSettingsPage, navigateToView } from './settings/index.js';
