// ═══════════════════════════════════════════════════════════
//  accounting/coa.js — ผังบัญชี (Chart of Accounts) (Phase 88.0)
//
//  - แสดง COA ทั้งหมด (group ตาม type)
//  - Import จาก CSV/Excel (สำหรับสำนักงานบัญชีส่ง COA มาทับ)
//  - Add/Edit/Delete account ทีละตัว
// ═══════════════════════════════════════════════════════════

import { renderEmpty } from "../ui_states.js";

const escHtml = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const escAttr = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;");

const TYPE_LABEL = {
  asset:     { th: "สินทรัพย์",    icon: "💰", color: "#0284c7" },
  liability: { th: "หนี้สิน",        icon: "📉", color: "#dc2626" },
  equity:    { th: "ส่วนของเจ้าของ", icon: "👤", color: "#7c3aed" },
  income:    { th: "รายได้",        icon: "📈", color: "#10b981" },
  expense:   { th: "ค่าใช้จ่าย",    icon: "💸", color: "#f59e0b" }
};

let _coa = [];
let _expandedTypes = new Set(["asset", "liability", "equity", "income", "expense"]);

export async function renderCoaPage(ctx) {
  const container = document.getElementById("page-accounting_coa");
  if (!container) return;

  const { showToast } = ctx;
  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;

  // ─── Fetch ──────────────────────────────────────────────
  container.innerHTML = `<div class="panel"><div style="padding:30px;text-align:center;color:#94a3b8">⏳ กำลังโหลดผังบัญชี...</div></div>`;

  try {
    const resp = await fetch(`${cfg.url}/rest/v1/chart_of_accounts?select=*&order=sort_order.asc`, {
      headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + token }
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    _coa = await resp.json();
  } catch(err) {
    console.error("[coa] fetch:", err);
    container.innerHTML = `
      <div class="panel">
        <div class="row"><h3 style="margin:0">📚 ผังบัญชี</h3></div>
        ${renderEmpty({
          icon: "⚠️",
          title: "โหลดผังบัญชีไม่สำเร็จ",
          message: "อาจยังไม่ได้รัน supabase-phase88-accounting-foundation.sql<br>หรือไม่มีสิทธิ์ (ต้องเป็น admin)",
          actionLabel: "ลองใหม่",
          actionId: "coaRetryBtn"
        })}
      </div>`;
    document.getElementById("coaRetryBtn")?.addEventListener("click", () => renderCoaPage(ctx));
    return;
  }

  // Group by type
  const byType = { asset: [], liability: [], equity: [], income: [], expense: [] };
  _coa.forEach(a => { if (byType[a.type]) byType[a.type].push(a); });

  container.innerHTML = `
    <div class="panel">
      <div class="row">
        <h3 style="margin:0">📚 ผังบัญชี</h3>
        <div style="display:flex;gap:6px">
          <button id="coaImportBtn" class="btn light" style="font-size:13px">📂 นำเข้า CSV/Excel</button>
          <button id="coaExportBtn" class="btn light" style="font-size:13px">📥 ดาวน์โหลด CSV</button>
        </div>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:14px">
        ${Object.entries(TYPE_LABEL).map(([t, info]) => `
          <div style="background:${info.color}15;border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:18px">${info.icon}</div>
            <div style="font-size:18px;font-weight:900;color:${info.color}">${byType[t].length}</div>
            <div style="font-size:11px;color:#64748b">${info.th}</div>
          </div>
        `).join("")}
      </div>

      <!-- Import card -->
      <div id="coaImportCard" class="hidden" style="margin-top:14px;padding:14px;background:#f0f9ff;border:2px dashed #0284c7;border-radius:10px">
        <div style="font-size:13px;font-weight:700;color:#0c4a6e;margin-bottom:6px">📂 นำเข้าผังบัญชีจาก CSV / Excel</div>
        <div style="font-size:11px;color:#475569;margin-bottom:8px;line-height:1.6">
          คอลัมน์: <code style="background:#fff;padding:1px 4px;border-radius:3px">code, name, type, parent_code, sort_order</code><br>
          • <b>code</b>: 4-digit code (เช่น 1110)<br>
          • <b>type</b>: asset / liability / equity / income / expense<br>
          • <b>parent_code</b>: code ของ parent (หรือเว้นว่าง = top-level)
        </div>
        <input type="file" id="coaFileInput" accept=".csv,.xlsx,.xls" style="display:none" />
        <div style="display:flex;gap:8px">
          <button id="coaPickFileBtn" class="btn primary" style="font-size:12px;padding:6px 14px">เลือกไฟล์</button>
          <button id="coaImportCancelBtn" class="btn light" style="font-size:12px;padding:6px 14px">ยกเลิก</button>
        </div>
        <div id="coaImportStatus" style="font-size:12px;margin-top:8px;color:#64748b"></div>
      </div>

      <!-- Accounts table by type -->
      <div style="margin-top:14px">
        ${Object.entries(byType).map(([type, accounts]) => {
          const info = TYPE_LABEL[type];
          const expanded = _expandedTypes.has(type);
          return `
            <details ${expanded ? 'open' : ''} data-coa-type="${type}" style="margin-bottom:8px">
              <summary style="padding:10px 12px;background:${info.color}15;border-radius:8px;cursor:pointer;font-weight:700;color:${info.color};font-size:14px">
                ${info.icon} ${info.th} <span style="font-weight:400;color:#64748b">(${accounts.length} บัญชี)</span>
              </summary>
              <div style="padding:8px 4px">
                ${accounts.length ? `
                  <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead>
                      <tr style="background:#f8fafc">
                        <th style="padding:6px 10px;text-align:left;width:80px;border-bottom:1px solid #e2e8f0">รหัส</th>
                        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e2e8f0">ชื่อบัญชี</th>
                        <th style="padding:6px 10px;text-align:left;width:90px;border-bottom:1px solid #e2e8f0">หมวดแม่</th>
                        <th style="padding:6px 10px;text-align:center;width:60px;border-bottom:1px solid #e2e8f0">ใช้</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${accounts.map(a => {
                        const indent = a.parent_code ? '12px' : '0';
                        return `
                          <tr style="border-bottom:1px solid #f1f5f9">
                            <td style="padding:5px 10px;font-family:monospace;font-weight:700;padding-left:${indent}">${escHtml(a.code)}</td>
                            <td style="padding:5px 10px;color:${a.parent_code ? '#334155' : '#0f172a'};font-weight:${a.parent_code ? '500' : '700'}">${escHtml(a.name)}</td>
                            <td style="padding:5px 10px;font-family:monospace;color:#94a3b8;font-size:11px">${escHtml(a.parent_code || '—')}</td>
                            <td style="padding:5px 10px;text-align:center">${a.is_active ? '✅' : '❌'}</td>
                          </tr>`;
                      }).join("")}
                    </tbody>
                  </table>
                ` : '<div style="padding:14px;text-align:center;color:#94a3b8;font-size:12px">— ยังไม่มีบัญชีในหมวดนี้ —</div>'}
              </div>
            </details>`;
        }).join("")}
      </div>
    </div>`;

  // ─── Bind ───────────────────────────────────────────────
  document.getElementById("coaImportBtn")?.addEventListener("click", () => {
    document.getElementById("coaImportCard")?.classList.toggle("hidden");
  });
  document.getElementById("coaImportCancelBtn")?.addEventListener("click", () => {
    document.getElementById("coaImportCard")?.classList.add("hidden");
  });
  document.getElementById("coaPickFileBtn")?.addEventListener("click", () => {
    document.getElementById("coaFileInput")?.click();
  });
  document.getElementById("coaFileInput")?.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    await _importCoa(ctx, file);
    ev.target.value = "";
  });
  document.getElementById("coaExportBtn")?.addEventListener("click", () => _exportCoa(ctx));

  // Track expanded types
  container.querySelectorAll("[data-coa-type]").forEach(d => d.addEventListener("toggle", (ev) => {
    const t = d.dataset.coaType;
    if (d.open) _expandedTypes.add(t);
    else _expandedTypes.delete(t);
  }));
}


// ─── Import COA ──────────────────────────────────────────
async function _importCoa(ctx, file) {
  const { showToast } = ctx;
  const statusEl = document.getElementById("coaImportStatus");
  const setStatus = (msg, color) => { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || "#64748b"; } };

  setStatus("กำลังอ่านไฟล์...");
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  try {
    let rows = [];
    if (isExcel) {
      if (!window.XLSX) throw new Error("XLSX library ยังไม่โหลด — refresh หน้าก่อน");
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    } else {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error("ไฟล์ว่าง");
      const header = _splitCsv(lines[0]).map(h => h.trim().toLowerCase().replace(/^﻿/, ""));
      for (let i = 1; i < lines.length; i++) {
        const cols = _splitCsv(lines[i]);
        const obj = {};
        header.forEach((h, idx) => { obj[h] = cols[idx] != null ? cols[idx].trim() : ""; });
        rows.push(obj);
      }
    }

    if (rows.length === 0) throw new Error("ไม่พบข้อมูล");

    const pick = (r, keys) => {
      for (const k of keys) {
        const found = Object.keys(r).find(ok => ok.toLowerCase().replace(/\s+/g,"") === k.toLowerCase().replace(/\s+/g,""));
        if (found && r[found] !== "" && r[found] != null) return r[found];
      }
      return "";
    };

    const valid = ['asset','liability','equity','income','expense'];
    const accounts = [];
    rows.forEach((r, idx) => {
      const code = String(pick(r, ["code", "รหัส"]) || "").trim();
      const name = String(pick(r, ["name", "ชื่อบัญชี"]) || "").trim();
      const type = String(pick(r, ["type", "ประเภท"]) || "").trim().toLowerCase();
      if (!code || !name || !valid.includes(type)) return; // skip invalid
      accounts.push({
        code,
        name,
        type,
        parent_code: String(pick(r, ["parent_code", "parent", "หมวดแม่"]) || "").trim() || null,
        sort_order: Number(pick(r, ["sort_order", "order"]) || 0) || Number(code) || idx,
        is_active: true
      });
    });

    if (accounts.length === 0) throw new Error("ไม่พบบัญชีที่ valid (ตรวจ code, name, type)");

    setStatus(`พบ ${accounts.length} บัญชี กำลัง upsert...`, "#0284c7");

    const cfg = window.SUPABASE_CONFIG;
    const token = window._sbAccessToken || cfg.anonKey;
    // Upsert (on conflict update)
    const r = await fetch(`${cfg.url}/rest/v1/chart_of_accounts?on_conflict=code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token,
        "Prefer": "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(accounts)
    });
    if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 200));

    setStatus(`✅ นำเข้า ${accounts.length} บัญชีสำเร็จ`, "#10b981");
    showToast(`นำเข้าผังบัญชี ${accounts.length} รายการ ✅`);
    setTimeout(() => renderCoaPage(ctx), 800);
  } catch(err) {
    console.error("[coa import]", err);
    setStatus("❌ " + err.message, "#ef4444");
  }
}

// ─── Export CSV ──────────────────────────────────────────
function _exportCoa(ctx) {
  const { showToast } = ctx;
  try {
    const headers = ["code", "name", "type", "parent_code", "sort_order", "is_active"];
    const csvEsc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    _coa.forEach(a => {
      lines.push(headers.map(h => csvEsc(a[h])).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chart-of-accounts-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`ดาวน์โหลด CSV (${_coa.length} บัญชี) ✅`);
  } catch(err) {
    console.error("[coa export]", err);
    showToast("Export ไม่สำเร็จ: " + err.message);
  }
}

// ─── CSV split (handle quoted fields) ────────────────────
function _splitCsv(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
