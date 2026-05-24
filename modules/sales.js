
import { renderEmpty } from "./ui_states.js";
// Phase 89.3: void JV + revert stock ตอนลบ POS sale (ป้องกัน P&L นับรายได้เกินจริง)
import { voidJvForSource } from "./accounting/auto_post.js";
// Phase 92.17: forward accounting trace — บิล POS → JV (read-only lookup)
// Phase 92.20: navigateToJv = deep-link เปิด JV drawer ทันทีจาก surface
import { findJournalForSale, renderSaleTraceBadge, navigateToJv } from "./accounting/sale_trace.js";
import { visibleSalesForRole, isAdminProfile, logActivity } from "./utils.js";

function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}
const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

let _salesPage = 1;
const SALES_PAGE_SIZE = 20;
let _salesAbort = null;

export function renderSalesPage({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast }) {
  _salesPage = 1;
  _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
}

function _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast }) {
  if (_salesAbort) _salesAbort.abort();
  _salesAbort = new AbortController();
  const signal = _salesAbort.signal;

  const isAdmin = isAdminProfile(state.profile);
  // ★ Phase 89.24 / 89.27: non-admin เห็นเฉพาะ sales ของตัวเอง — admin เห็นทุกคน
  // Server-side filter + visibleSalesForRole = defense-in-depth (idempotent บน server-filtered data)
  const visibleSales = visibleSalesForRole(state.sales, state.profile, state.currentUser);

  // ★ Pagination
  const totalPages = Math.max(1, Math.ceil(visibleSales.length / SALES_PAGE_SIZE));
  if (_salesPage > totalPages) _salesPage = totalPages;
  const start = (_salesPage - 1) * SALES_PAGE_SIZE;
  const pageSales = visibleSales.slice(start, start + SALES_PAGE_SIZE);

  const paginationHtml = totalPages > 1 ? `
    <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn light" data-sales-page="prev" ${_salesPage <= 1 ? 'disabled' : ''} style="padding:6px 14px;font-size:13px">← ก่อนหน้า</button>
      <span style="font-size:13px;color:#64748b">หน้า ${_salesPage}/${totalPages} (${visibleSales.length} รายการ)</span>
      <button class="btn light" data-sales-page="next" ${_salesPage >= totalPages ? 'disabled' : ''} style="padding:6px 14px;font-size:13px">ถัดไป →</button>
    </div>
  ` : (visibleSales.length > 0 ? `<div style="text-align:center;font-size:12px;color:#94a3b8;margin-top:8px">${visibleSales.length} รายการ</div>` : '');

  document.getElementById("page-sales").innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">รายการขายล่าสุด${isAdmin ? "" : " <span style=\"font-size:11px;font-weight:600;color:#0284c7;background:#e0f2fe;padding:2px 8px;border-radius:10px;margin-left:6px;vertical-align:middle\">เฉพาะของคุณ</span>"}</h3>
        <div style="display:flex;gap:6px">
          <button id="exportSalesXlsxBtn" class="btn light" title="ส่งออก Excel สำหรับทำบัญชี">📊 Excel</button>
          <button id="refreshSalesBtn" class="btn light">รีโหลด</button>
        </div>
      </div>
      <div class="card-list mt16">
        ${pageSales.length ? pageSales.map(s => `
          <div class="card">
            <div class="row">
              <div style="flex:1;min-width:0">
                <div style="font-weight:900">${escHtml(s.order_no)}</div>
                <div class="sku">${escHtml(s.customer_name || "ลูกค้าทั่วไป")} • ${escHtml(s.payment_method || "-")}</div>
                <div class="sku">${new Date(s.created_at).toLocaleString("th-TH")}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <div style="font-weight:900;color:#0284c7">${money(s.total_amount)}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                  <button class="btn light" data-sale-id="${s.id}">เปิดบิล</button>
                  <button class="btn light" data-acct-trace="${s.id}" title="ตรวจ/เปิดเอกสารบัญชีของบิลนี้" style="font-size:12px;padding:4px 10px">📒 บัญชี</button>
                  ${isAdmin ? `<button class="btn" data-del-sale="${s.id}" data-del-sale-no="${escHtml(s.order_no || '')}" style="background:#ef4444;color:#fff;font-size:12px;padding:4px 10px;border-radius:8px;border:none;cursor:pointer">🗑️ ลบ</button>` : ''}
                </div>
              </div>
            </div>
          </div>
        `).join("") : renderEmpty({
          icon: "🧾",
          title: "ยังไม่มีรายการขาย",
          message: "ขายของผ่าน POS หรือบันทึกการขายใหม่ — รายการขายจะแสดงที่นี่ทั้งหมด",
          actionLabel: "ไปที่ POS",
          actionId: "salesEmptyGoToPosBtn",
          actionStyle: "ghost"
        })}
      </div>
      ${paginationHtml}
    </div>
  `;

  document.getElementById("refreshSalesBtn")?.addEventListener("click", loadAllData, { signal });

  // ★ FEATURE: ส่งออก Excel สำหรับทำบัญชี (ใช้ XLSX library ที่ index.html โหลดไว้แล้ว)
  document.getElementById("exportSalesXlsxBtn")?.addEventListener("click", () => {
    try {
      if (typeof XLSX === "undefined") {
        return showToast?.("❌ ไลบรารี Excel ยังไม่พร้อม — รีเฟรชหน้าใหม่");
      }
      if (!visibleSales.length) {
        return showToast?.("ยังไม่มีรายการขายที่จะส่งออก");
      }
      const rows = visibleSales.map(s => ({
        "เลขที่บิล":      s.order_no || "",
        "วันที่":         new Date(s.created_at).toLocaleString("th-TH"),
        "ลูกค้า":         s.customer_name || "ลูกค้าทั่วไป",
        "วิธีชำระ":       s.payment_method || "-",
        "ยอดก่อนส่วนลด":  Number(s.subtotal || s.total_amount || 0),
        "ส่วนลด":         Number(s.discount_amount || 0),
        "รวมสุทธิ":       Number(s.total_amount || 0),
        "รับเงิน":        Number(s.paid_amount || 0),
        "เงินทอน":        Number(s.change_amount || 0),
        "หมายเหตุ":       s.note || ""
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [
        { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 12 },
        { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 28 }
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "รายการขาย");
      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `boonsook-sales-${today}.xlsx`);
      showToast?.("📊 ส่งออก Excel เรียบร้อย");
    } catch (err) {
      console.error("[sales] export error:", err);
      showToast?.("❌ ส่งออกไม่สำเร็จ: " + (err.message || "unknown"));
    }
  }, { signal });

  // ★ Pagination buttons
  document.querySelectorAll("[data-sales-page]").forEach(btn => btn.addEventListener("click", () => {
    const action = btn.dataset.salesPage;
    if (action === "prev" && _salesPage > 1) _salesPage--;
    else if (action === "next" && _salesPage < totalPages) _salesPage++;
    _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });
  }, { signal }));

  // Phase 92.11: เปิดบิล — เดิม await loadReceipt() แล้ว openReceiptDrawer() ตรง ๆ
  // ถ้า loadReceipt throw/hang ปุ่มจะเงียบ (user report). ตอนนี้ loadReceipt คืน {ok,error}
  // → toast เมื่อ fail + เปิด drawer เฉพาะตอนโหลดใบเสร็จสำเร็จเท่านั้น
  document.querySelectorAll("[data-sale-id]").forEach(btn => btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await loadReceipt(Number(btn.dataset.saleId));
      if (r && r.ok === false) {
        showToast?.("❌ เปิดบิลไม่สำเร็จ: " + (r.error?.message || "unknown"));
        return;
      }
      openReceiptDrawer();
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }, { signal }));

  /* ── Phase 92.17: accounting trace — on-demand lookup JV ของบิล ── */
  document.querySelectorAll("[data-acct-trace]").forEach(btn => btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const saleId = Number(btn.dataset.acctTrace);
    if (!saleId || isNaN(saleId)) { showToast?.("ไม่พบ ID รายการขาย"); return; }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳";
    let res;
    try {
      res = await findJournalForSale(saleId);
    } catch (e) {
      console.warn("[sales acct-trace] lookup error:", e?.message);
      res = { ok: false, found: false, status: "error", entry: null };
    }
    // แทนปุ่มด้วย badge — found = กดไปสมุดรายวันได้, missing/error = ข้อความชัด (ไม่เงียบ)
    const wrap = document.createElement("span");
    wrap.innerHTML = renderSaleTraceBadge(res, { compact: true });
    const badgeEl = wrap.firstElementChild;
    if (!badgeEl) { btn.disabled = false; btn.textContent = orig; return; }
    if (badgeEl.classList.contains("sale-acct-trace")) {
      // Phase 92.20: deep-link → เปิด JV drawer ทันทีหลังนำทาง (ไม่ใช่แค่ไปหน้ารายวันเฉย ๆ)
      const goto = () => navigateToJv(badgeEl.dataset.jvId);
      badgeEl.addEventListener("click", goto, { signal });
      badgeEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goto(); } }, { signal });
    }
    btn.replaceWith(badgeEl);
  }, { signal }));

  /* ── Empty-state CTA (Phase 46.2): ไปหน้า POS ── */
  document.getElementById("salesEmptyGoToPosBtn")?.addEventListener("click", () => {
    location.hash = "pos";
  }, { signal });

  /* ── ลบรายการขาย (admin only) ── */
  document.querySelectorAll("[data-del-sale]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const saleId = Number(btn.dataset.delSale);
    // ★ FIX: ป้องกัน NaN
    if (!saleId || isNaN(saleId)) { showToast?.("ไม่พบ ID รายการขาย"); return; }
    const saleNo = btn.dataset.delSaleNo || "";
    if (!(await window.App?.confirm?.(`ลบรายการขาย "${saleNo}" ?\nลบแล้วไม่สามารถกู้คืนได้`))) return;

    /* eslint-disable require-atomic-updates -- A: UI feedback before async (sequential, single click handler per row) */
    btn.disabled = true;
    btn.textContent = "กำลังลบ...";
    /* eslint-enable require-atomic-updates */

    const newNote = "[ลบแล้ว] ลบโดยแอดมิน " + new Date().toLocaleString("th-TH");

    // ★ Safety timeout: ถ้า network/Supabase hang → หลุด 20 วินาที auto-reset
    const withTimeout = (p, ms, label) => Promise.race([
      p,
      new Promise((_, rej) => { setTimeout(() => rej(new Error(label + " timeout " + ms + "ms")), ms); })
    ]);

    try {
      let success = false;

      // ★ วิธีที่ 1: XHR PATCH (เร็วกว่า + ควบคุม token ได้)
      try {
        const cfg = window.SUPABASE_CONFIG;
        const token = window._sbAccessToken || cfg.anonKey;
        const patchRes = await withTimeout(fetch(cfg.url + "/rest/v1/sales?id=eq." + saleId, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": cfg.anonKey,
            "Authorization": "Bearer " + token,
            "Prefer": "return=representation"
          },
          body: JSON.stringify({ note: newNote })
        }), 15000, "PATCH sales");
        const patchData = await patchRes.json().catch(() => null);
        if (patchRes.ok && Array.isArray(patchData) && patchData.length > 0) {
          success = true;
        } else {
          // ★ FIX: null-safe access to patchData
          const errMsg = (patchData && (patchData.message || patchData.hint))
            || ("status " + patchRes.status + " — 0 rows (RLS?)");
          console.warn("[sales delete] PATCH failed:", errMsg);
        }
      } catch (fetchErr) {
        console.warn("[sales delete] PATCH fetch error:", fetchErr.message);
      }

      // ★ วิธีที่ 2: Supabase JS client (fallback)
      if (!success && state.supabase) {
        try {
          const { data, error } = await withTimeout(
            state.supabase.from("sales").update({ note: newNote }).eq("id", saleId).select(),
            15000, "Supabase update"
          );
          if (!error && data && data.length > 0) {
            success = true;
          } else {
            console.warn("[sales delete] Supabase update failed:", error?.message);
          }
        } catch (sbErr) {
          console.warn("[sales delete] Supabase timeout/error:", sbErr.message);
        }
      }

      if (success) {
        // Phase 89.3: void JV + revert stock — แก้ปัญหา P&L นับรายได้เกินจริง + stock ลดถาวร
        // ทำแบบ best-effort: ถ้าตัวใดล้มเหลว → toast เตือนแต่ไม่ block
        const sideEffects = [];

        // (a) void JV ของ sale นี้ (ถ้ามี — POS sale ก่อน effective date ไม่มี JV)
        try {
          const voided = await voidJvForSource("sales", saleId);
          if (voided > 0) sideEffects.push(`JV ${voided} entry`);
        } catch(e) {
          console.warn("[sales delete] void JV failed:", e?.message);
          sideEffects.push("⚠️ void JV fail");
        }

        // (b) revert stock — คืนสต็อกสินค้าใน sale_items กลับ
        try {
          if (window._appRevertStockForSale) {
            const rev = await window._appRevertStockForSale({ saleId, orderNo: saleNo });
            if (rev?.reverted > 0) sideEffects.push(`คืนสต็อก ${rev.reverted} รายการ`);
            if (rev?.errors?.length > 0) {
              console.warn("[sales delete] revert stock partial:", rev.errors);
              sideEffects.push(`⚠️ stock partial (${rev.errors.length} fail)`);
            }
          }
        } catch(e) {
          console.warn("[sales delete] revert stock exception:", e?.message);
          sideEffects.push("⚠️ revert stock exception");
        }

        // (c) Phase 91.3 + 91.4 — reverse loyalty auto-earn. Helper is silent on
        // no-earn / already-reversed and caps reverse at customer.remaining (no
        // negative balance). Helper failures must NEVER fail the delete flow.
        //
        // Phase 91.4: removed the `if (targetSale?.customer_id)` pre-check.
        // sales.customer_id can be missing/null even when the earn record exists
        // (column is an opt-in extension; pos.js only includes it when present).
        // The helper falls back to earn.customer_id when options.customerId is null.
        try {
          const mod = await import("./loyalty.js?v=" + (window.APP_BUILD || "dev"));
          const targetSale = (state.sales || []).find(s => String(s.id) === String(saleId));
          // Diagnostic — visible in DevTools so the next smoke explains itself.
          // info-level: this is an expected per-delete trace, not a problem.
          console.info("[sales delete] loyalty reverse attempt:", {
            saleId,
            saleCustomerId: targetSale?.customer_id ?? null,
            earnCount: (state.loyaltyPoints || [])
              .filter(t => t.type === "earn" && t.ref_type === "sale" && String(t.ref_id) === String(saleId))
              .length,
          });
          const res = await mod.reverseEarnedPointsForSale(saleId, {
            state,
            customerId: targetSale?.customer_id || null,
          });
          if (res?.ok) {
            const cappedNote = res.capped ? `/${res.totalEarned}` : "";
            sideEffects.push(`คืนแต้ม ${res.reversed}${cappedNote}`);
          } else if (res?.skipped) {
            // expected silent skip (no earn / already reversed / remaining=0) — info, not a fault
            console.info("[sales delete] loyalty reverse skipped:", res.reason);
          } else {
            console.warn("[sales delete] loyalty reverse failed:", res?.reason);
            sideEffects.push("⚠️ reverse loyalty fail");
          }
        } catch (e) {
          console.warn("[sales delete] loyalty reverse exception:", e?.message);
          sideEffects.push("⚠️ reverse loyalty exception");
        }

        const sideEffectsMsg = sideEffects.length ? ` (${sideEffects.join(", ")})` : "";
        if (showToast) showToast("ลบรายการขายเรียบร้อย ✅" + sideEffectsMsg);

        // Phase 92.18: audit log (best-effort) — บันทึกการลบบิลขายพร้อม sale id เพื่อให้
        // หน้า Audit Log แสดง accounting trace ได้ (entity_type='sale' + entity_id=saleId).
        // ★ ต้องไม่ทำให้การลบ fail ถ้า log fail — logActivity กลืน error อยู่แล้ว + ห่อ try กันเหนียว
        try {
          const deletedSale = (state.sales || []).find(s => String(s.id) === String(saleId));
          logActivity("delete_sale", {
            entityType: "sale",
            entityId: saleId,
            summary: `ลบบิลขาย ${saleNo || "#" + saleId}`
              + (deletedSale?.customer_name ? ` (${deletedSale.customer_name})` : "")
              + (deletedSale?.total_amount != null ? ` ${Number(deletedSale.total_amount).toLocaleString("th-TH")} บาท` : ""),
            metadata: {
              bill_no: saleNo || null,
              customer_id: deletedSale?.customer_id ?? null,
              customer_name: deletedSale?.customer_name ?? null,
              total_amount: deletedSale?.total_amount ?? null,
            },
          });
        } catch (_e) { /* best-effort — ห้าม block การลบ */ }

        // ★ Optimistic update: mirror the server soft-delete in local state so the
        // row disappears immediately — even if the background reload below times out.
        // visibleSalesForRole() hides notes containing "[ลบแล้ว]", so setting the note
        // here matches exactly what loadAllData() would fetch back from the server.
        const localSale = (state.sales || []).find(s => String(s.id) === String(saleId));
        if (localSale) localSale.note = newNote;
        _renderSalesView({ state, loadAllData, loadReceipt, openReceiptDrawer, showToast });

        // Best-effort background refresh — a timeout here must NOT undo the committed delete
        try { await withTimeout(loadAllData(), 10000, "loadAllData"); } catch(e) { console.warn("[sales delete] loadAllData timeout after committed delete:", e.message); }
      } else {
        throw new Error("ลบไม่ได้ — อาจต้องเพิ่ม UPDATE policy ที่ Supabase สำหรับตาราง sales");
      }
    } catch (err) {
      console.error("[sales delete] error:", err);
      showToast?.("❌ " + (err.message || "ลบไม่สำเร็จ"));
    } finally {
      // ★ Safety: reset button เสมอ ถ้ายังอยู่ใน DOM (กัน stuck "กำลังลบ...")
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "🗑️ ลบ";
      }
    }
  }));
}
