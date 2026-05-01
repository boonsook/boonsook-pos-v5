// Shared utilities — Phase 51 (1 พ.ค. 2026)
// Canonical escHtml: null-safe, escapes 5 HTML special chars (&, <, >, ", ')
// Dedupes ~30 local copies across modules.
export function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

// ═══════════════════════════════════════════════════════════
//  Phase 55: Customer Loyalty Tier
//  Auto-classify customers into tiers based on lifetime revenue.
//  Tiers (THB cumulative spend):
//    Platinum  ≥ 100,000   diamond gradient
//    Gold      ≥  50,000   yellow
//    Silver    ≥  20,000   slate
//    Bronze    ≥   5,000   amber
//    (none)    <    5,000
// ═══════════════════════════════════════════════════════════
export const TIER_RULES = [
  { key: "platinum", min: 100000, label: "Platinum", icon: "💎", color: "#7c3aed", bg: "linear-gradient(135deg,#a78bfa,#7c3aed)" },
  { key: "gold",     min:  50000, label: "Gold",     icon: "🥇", color: "#92400e", bg: "linear-gradient(135deg,#fde68a,#f59e0b)" },
  { key: "silver",   min:  20000, label: "Silver",   icon: "🥈", color: "#475569", bg: "linear-gradient(135deg,#e2e8f0,#94a3b8)" },
  { key: "bronze",   min:   5000, label: "Bronze",   icon: "🥉", color: "#9a3412", bg: "linear-gradient(135deg,#fed7aa,#ea580c)" }
];

/**
 * Compute lifetime revenue + tier for a customer.
 * @param {string|number} customerId
 * @param {Array} sales — state.sales (excludes deleted)
 * @returns {Object} { revenue, tier, nextTier, progress }
 */
export function getCustomerTier(customerId, sales) {
  if (customerId == null) return { revenue: 0, tier: null, nextTier: TIER_RULES[TIER_RULES.length - 1], progress: 0 };
  const cid = String(customerId);
  const revenue = (sales || [])
    .filter(s => !(s.note || "").includes("[ลบแล้ว]"))
    .filter(s => String(s.customer_id || "") === cid)
    .reduce((sum, s) => sum + Number(s.total_amount || 0), 0);

  const tier = TIER_RULES.find(t => revenue >= t.min) || null;
  // next tier (closest higher) — for progress bar
  const tierIdx = tier ? TIER_RULES.indexOf(tier) : TIER_RULES.length;
  const nextTier = tierIdx > 0 ? TIER_RULES[tierIdx - 1] : null;
  const progress = nextTier ? Math.min(100, (revenue / nextTier.min) * 100) : 100;
  return { revenue, tier, nextTier, progress };
}

/**
 * Render a small inline tier badge (HTML string).
 * Caller is responsible for escaping if used in untrusted context.
 */
export function renderTierBadge(tier) {
  if (!tier) return "";
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:${tier.bg};color:#fff;font-size:11px;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.2)">${tier.icon} ${tier.label}</span>`;
}

// ═══════════════════════════════════════════════════════════
//  Phase 57: Activity log helper
//  Append-only audit trail. Silent-fails if table not yet created
//  (so the rest of the app keeps working even before migration).
// ═══════════════════════════════════════════════════════════
export async function logActivity(action, opts = {}) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken;
    if (!cfg || !token) return; // not logged in → skip

    const profile = window.App?._state?.profile || {};
    const user = window.App?._state?.currentUser || {};
    const payload = {
      user_id: user.id || null,
      user_name: profile.full_name || user.email || null,
      user_role: profile.role || null,
      action: String(action || "unknown").slice(0, 64),
      entity_type: opts.entityType || null,
      entity_id: opts.entityId != null ? String(opts.entityId) : null,
      summary: opts.summary ? String(opts.summary).slice(0, 500) : null,
      metadata: opts.metadata || null
    };
    await fetch(cfg.url + "/rest/v1/activity_log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("[logActivity] silent fail (table may not exist yet)", e);
  }
}
