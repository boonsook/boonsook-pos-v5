// ═══════════════════════════════════════════════════════════
//  periods.js — Period Close (Lock งวดบัญชี) — Phase 88.19
//
//  ปิดงวดเดือน → กัน user แก้/สร้าง JV ในงวดนั้น
//  Trigger ระดับ DB กันอีกชั้น (defense in depth)
// ═══════════════════════════════════════════════════════════

let _ctx = null;
let _periods = [];        // cache จาก fetchPeriods()
let _summaryCache = {};   // { "yyyy-mm": { revenue, expense, net, jvCount } }
let _activeYear = new Date().getFullYear() + 543 - 543;  // ค.ศ.

const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }

// ───────────────────────────────────────────────────────────
// API helpers
// ───────────────────────────────────────────────────────────
async function fetchPeriods() {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const r = await fetch(`${cfg.url}/rest/v1/accounting_periods?select=*&order=year.desc,month.desc`, {
    headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
  });
  if (!r.ok) throw new Error("fetch periods failed: HTTP " + r.status);
  return await r.json();
}

async function fetchPeriodSummary(year, month) {
  const cacheKey = `${year}-${String(month).padStart(2,"0")}`;
  if (_summaryCache[cacheKey]) return _summaryCache[cacheKey];

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const fromDate = `${year}-${String(month).padStart(2,"0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${String(month).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;

  // ดึง entries + lines เพื่อคำนวณ revenue/expense
  const headers = { "apikey": cfg.anonKey, "Authorization": "Bearer " + token };
  const entriesUrl = `${cfg.url}/rest/v1/journal_entries?select=id&doc_date=gte.${fromDate}&doc_date=lte.${toDate}&status=eq.approved`;
  const entries = await (await fetch(entriesUrl, { headers })).json();
  const ids = entries.map(e => e.id);

  let revenue = 0, expense = 0;
  if (ids.length) {
    const linesUrl = `${cfg.url}/rest/v1/journal_lines?select=account_code,debit,credit&entry_id=in.(${ids.join(",")})`;
    const lines = await (await fetch(linesUrl, { headers })).json();
    lines.forEach(l => {
      const code = String(l.account_code || "");
      // Revenue: 4xxx (Cr - Dr)
      if (code.startsWith("4")) revenue += Number(l.credit || 0) - Number(l.debit || 0);
      // Expense: 5xxx (Dr - Cr)
      if (code.startsWith("5")) expense += Number(l.debit || 0) - Number(l.credit || 0);
    });
  }

  const summary = {
    revenue,
    expense,
    net: revenue - expense,
    jvCount: ids.length
  };
  _summaryCache[cacheKey] = summary;
  return summary;
}

async function lockPeriod(year, month) {
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const userEmail = window._appCurrentUserEmail || "admin";

  const summary = await fetchPeriodSummary(year, month);

  // upsert (insert if not exists, update if exists)
  const existing = _periods.find(p => p.year === year && p.month === month);
  const payload = {
    year, month,
    status: "locked",
    locked_at: new Date().toISOString(),
    locked_by: userEmail,
    total_revenue: summary.revenue,
    total_expense: summary.expense,
    net_income: summary.net,
    jv_count: summary.jvCount,
    updated_at: new Date().toISOString()
  };

  let url = `${cfg.url}/rest/v1/accounting_periods`;
  let method = "POST";
  let headers = {
    "Content-Type": "application/json",
    "apikey": cfg.anonKey,
    "Authorization": "Bearer " + token,
    "Prefer": "return=representation"
  };
  if (existing) {
    url = `${cfg.url}/rest/v1/accounting_periods?id=eq.${existing.id}`;
    method = "PATCH";
  }

  const r = await fetch(url, { method, headers, body: JSON.stringify(payload) });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Lock failed: " + err.slice(0, 200));
  }
  return await r.json();
}

async function unlockPeriod(year, month, reason) {
  if (!reason || reason.trim().length < 5) {
    throw new Error("ต้องกรอกเหตุผลปลดล็อกอย่างน้อย 5 ตัวอักษร");
  }
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const userEmail = window._appCurrentUserEmail || "admin";

  const existing = _periods.find(p => p.year === year && p.month === month);
  if (!existing) throw new Error("ไม่พบ period นี้ในระบบ");

  const payload = {
    status: "open",
    unlock_reason: reason.trim(),
    unlock_at: new Date().toISOString(),
    unlock_by: userEmail,
    updated_at: new Date().toISOString()
  };

  const r = await fetch(`${cfg.url}/rest/v1/accounting_periods?id=eq.${existing.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + token,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Unlock failed: " + err.slice(0, 200));
  }
  return await r.json();
}

// ───────────────────────────────────────────────────────────
// MAIN render
// ───────────────────────────────────────────────────────────
export async function renderPeriodsPage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_periods");
  if (!container) return;

  container.innerHTML = `<div class="panel"><div style="text-align:center;padding:40px;color:#64748b">⏳ กำลังโหลดข้อมูล...</div></div>`;

  try {
    _periods = await fetchPeriods();
  } catch (e) {
    container.innerHTML = `
      <div class="panel">
        <div style="background:#fef2f2;border:1px solid #fecaca;padding:14px;border-radius:10px;color:#991b1b">
          ❌ โหลดข้อมูลไม่สำเร็จ — กรุณา run SQL <code>supabase-phase88-19-period-close.sql</code> ก่อน<br>
          <small style="color:#7f1d1d">${escHtml(e.message)}</small>
        </div>
      </div>`;
    return;
  }

  // Active year — เริ่มจากปีล่าสุดที่มี data หรือปีปัจจุบัน
  const currentYear = new Date().getFullYear();
  const years = [...new Set(_periods.map(p => p.year))];
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!_activeYear || !years.includes(_activeYear)) _activeYear = currentYear;

  // คำนวณ summary ทุกเดือนของ active year (parallel)
  const summaries = {};
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
      try {
        summaries[m] = await fetchPeriodSummary(_activeYear, m);
      } catch (e) {
        summaries[m] = { revenue: 0, expense: 0, net: 0, jvCount: 0 };
      }
    })
  );

  container.innerHTML = `
    <div class="panel" style="max-width:1100px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="font-size:28px">🔒</span>
        <div>
          <h2 style="margin:0;font-size:20px;color:#0f172a">ปิดงวดบัญชี (Period Close)</h2>
          <div style="font-size:12px;color:#64748b">ล็อกงวดเดือน → กันแก้ JV ย้อนหลัง · Defense in depth (UI + DB trigger)</div>
        </div>
      </div>

      <!-- Year selector -->
      <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
        <span style="font-size:13px;color:#475569;font-weight:600">ปี:</span>
        ${years.map(y => `
          <button class="period-year-btn" data-year="${y}" style="padding:6px 14px;border-radius:14px;border:1px solid ${_activeYear===y?'#0284c7':'#cbd5e1'};background:${_activeYear===y?'#0284c7':'#fff'};color:${_activeYear===y?'#fff':'#475569'};cursor:pointer;font-size:13px;font-weight:600">${y}</button>
        `).join("")}
      </div>

      <!-- 12-month grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
          const period = _periods.find(p => p.year === _activeYear && p.month === m);
          const isLocked = period?.status === "locked";
          const summary = summaries[m] || { revenue: 0, expense: 0, net: 0, jvCount: 0 };
          const hasData = summary.jvCount > 0;
          const monthLabel = MONTHS_TH[m - 1];

          const bg = isLocked ? "#fef2f2" : (hasData ? "#f0fdf4" : "#f8fafc");
          const border = isLocked ? "#fecaca" : (hasData ? "#bbf7d0" : "#e2e8f0");
          const accent = isLocked ? "#991b1b" : (hasData ? "#166534" : "#64748b");

          return `
            <div data-period-card="${_activeYear}-${m}" style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:14px;font-weight:700;color:${accent}">${monthLabel} ${_activeYear}</div>
                <div style="font-size:11px;font-weight:600;color:${accent}">${isLocked ? "🔒 ล็อก" : hasData ? "🟢 เปิด" : "—"}</div>
              </div>
              ${hasData ? `
                <div style="font-size:11px;color:#475569;line-height:1.6">
                  <div>รายได้: <b style="color:#10b981">${money(summary.revenue)}</b></div>
                  <div>ค่าใช้จ่าย: <b style="color:#ef4444">${money(summary.expense)}</b></div>
                  <div>${summary.net >= 0 ? '✅ กำไร' : '⚠️ ขาดทุน'}: <b style="color:${summary.net >= 0 ? '#10b981' : '#ef4444'}">${money(Math.abs(summary.net))}</b></div>
                  <div style="color:#64748b;margin-top:4px">JV ${summary.jvCount} รายการ</div>
                </div>
              ` : `
                <div style="font-size:11px;color:#94a3b8;font-style:italic">ไม่มีรายการในเดือนนี้</div>
              `}
              <div style="margin-top:10px;display:flex;gap:6px">
                ${isLocked ? `
                  <button class="period-unlock-btn" data-y="${_activeYear}" data-m="${m}" style="flex:1;padding:6px 10px;background:#fff;border:1px solid #f59e0b;color:#92400e;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">🔓 ปลดล็อก</button>
                ` : hasData ? `
                  <button class="period-lock-btn" data-y="${_activeYear}" data-m="${m}" style="flex:1;padding:6px 10px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">🔒 ปิดงวด</button>
                ` : ''}
              </div>
              ${isLocked && period?.locked_at ? `
                <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #fecaca;font-size:10px;color:#7f1d1d">
                  ปิดเมื่อ ${new Date(period.locked_at).toLocaleString("th-TH")}<br>
                  โดย ${escHtml(period.locked_by || "?")}
                  ${period.unlock_reason ? `<br>↩️ เคยปลดล็อก: ${escHtml(period.unlock_reason)}` : ''}
                </div>
              ` : ''}
            </div>
          `;
        }).join("")}
      </div>

      <!-- Info note -->
      <div style="margin-top:18px;padding:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:10px;font-size:12px;color:#78350f;line-height:1.7">
        <b>💡 วิธีใช้งาน:</b><br>
        1. <b>ปิดงวด</b> → ตอนสิ้นเดือนหลังตรวจสอบรายการครบแล้ว<br>
        2. <b>ปลดล็อก</b> → ทำได้ถ้าจำเป็น (กรอกเหตุผล) — ระบบ log audit trail<br>
        3. <b>เมื่อล็อก</b> → ห้าม insert/update JV ในงวดนั้น (ยกเว้น void อนุญาตเพราะเป็น soft delete)<br>
        4. <b>Defense in depth</b> — ทั้ง front-end (auto_post.js) + back-end (DB trigger) check
      </div>
    </div>
  `;

  // Wire events
  container.querySelectorAll("[data-year]").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeYear = parseInt(btn.dataset.year, 10);
      _summaryCache = {};  // reset cache เพราะเปลี่ยนปี
      renderPeriodsPage(_ctx);
    });
  });

  container.querySelectorAll(".period-lock-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const y = parseInt(btn.dataset.y, 10);
      const m = parseInt(btn.dataset.m, 10);
      const summary = summaries[m];
      const msg = `ยืนยันปิดงวด ${MONTHS_TH[m-1]} ${y}?\n\n` +
        `📊 Summary:\n` +
        `  รายได้: ${money(summary.revenue)}\n` +
        `  ค่าใช้จ่าย: ${money(summary.expense)}\n` +
        `  ${summary.net >= 0 ? 'กำไร' : 'ขาดทุน'}: ${money(Math.abs(summary.net))}\n` +
        `  JV ${summary.jvCount} รายการ\n\n` +
        `⚠️ หลังปิดงวด — ห้ามแก้/สร้าง JV ในงวดนี้ (เว้นแต่ปลดล็อก)`;
      if (!confirm(msg)) return;

      btn.disabled = true;
      btn.textContent = "🔄 กำลังปิด...";
      try {
        await lockPeriod(y, m);
        _ctx.showToast?.("ปิดงวดสำเร็จ ✅");
        await renderPeriodsPage(_ctx);
      } catch (e) {
        _ctx.showToast?.("ปิดงวดไม่สำเร็จ: " + e.message);
        btn.disabled = false;
        btn.textContent = "🔒 ปิดงวด";
      }
    });
  });

  container.querySelectorAll(".period-unlock-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const y = parseInt(btn.dataset.y, 10);
      const m = parseInt(btn.dataset.m, 10);
      const reason = prompt(`ปลดล็อกงวด ${MONTHS_TH[m-1]} ${y}\n\nกรุณากรอกเหตุผล (บันทึก audit log):`, "");
      if (!reason || reason.trim().length < 5) {
        _ctx.showToast?.("ต้องกรอกเหตุผลอย่างน้อย 5 ตัวอักษร");
        return;
      }

      btn.disabled = true;
      btn.textContent = "🔄 กำลังปลดล็อก...";
      try {
        await unlockPeriod(y, m, reason);
        _ctx.showToast?.("ปลดล็อกงวดสำเร็จ ✅");
        await renderPeriodsPage(_ctx);
      } catch (e) {
        _ctx.showToast?.("ปลดล็อกไม่สำเร็จ: " + e.message);
        btn.disabled = false;
        btn.textContent = "🔓 ปลดล็อก";
      }
    });
  });
}
