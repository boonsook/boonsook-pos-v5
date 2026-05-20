// ═══════════════════════════════════════════════════════════
//  App boot orchestration (extracted from main.js in Phase 92.10 — capstone)
//
//  ลำดับ boot: darkMode → static events → logo paint → supabase init →
//  (ถ้า session ใช้ได้) afterLogin → background logo sync.
//  Behavior byte-identical กับ boot IIFE เดิม. ทุก dependency inject ผ่าน params
//  → boot.js ไม่ import main.js (ตัด circular) + ordering testable.
// ═══════════════════════════════════════════════════════════

/**
 * @param {object} deps
 * @param {() => void}            deps.initDarkMode
 * @param {() => void}            deps.bindStaticEvents
 * @param {() => void}            deps.updateAppLogos
 * @param {() => Promise<boolean>} deps.initSupabase  — resolves ok flag
 * @param {() => Promise<void>}   deps.afterLogin
 * @param {() => Promise<any>}    deps.syncLogo       — window._appSyncLogo
 * @param {() => any}             deps.getCurrentUser — () => state.currentUser
 * @returns {Promise<void>}
 */
export async function runBoot({
  initDarkMode,
  bindStaticEvents,
  updateAppLogos,
  initSupabase,
  afterLogin,
  syncLogo,
  getCurrentUser,
} = {}) {
  initDarkMode();
  bindStaticEvents();
  updateAppLogos();
  const ok = await initSupabase();
  if (!ok) return;
  if (!getCurrentUser()) return;
  await afterLogin();
  // Sync โลโก้จาก Supabase Storage (ทำ background ไม่ block)
  syncLogo().then(() => { if (typeof updateAppLogos === "function") updateAppLogos(); });
}
