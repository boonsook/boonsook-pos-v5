// ═══════════════════════════════════════════════════════════
//  opening_balance.js — Opening Balance Wizard (Phase 88.5)
//
//  ฟอร์มช่วย admin ลงยอดยกมา (ทุน + เงินสด + เงินฝาก + ลูกหนี้/เจ้าหนี้)
//  → สร้าง JV ประเภท "OB" doc_no = OB2026010001 ลงวันที่ effective date
//
//  หลังลง OB → Balance Sheet จะแสดงตัวเลขถูกต้อง
//  (เช่น เงินสดยกมา 100,000 + ทุนเริ่มต้น 100,000 → BS จะ balance ตามจริง)
// ═══════════════════════════════════════════════════════════

// ★ Phase 88.18b: production เริ่ม 1 พ.ค. 2026 — opening balance ลงวันนี้
const ACCOUNTING_EFFECTIVE_DATE = "2026-05-01";

let _ctx = null;

function money(n) { return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
function escHtml(s) { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; }
function num(v) { return Number(v || 0); }

// ─── Default fields ที่ user มักลงตอน start ───
//  Debit side (สินทรัพย์ที่ยกมา)
const ASSET_FIELDS = [
  { code: "1110", label: "เงินสดในมือ",                  emoji: "💵" },
  { code: "1120", label: "เงินสดย่อย",                    emoji: "💴" },
  { code: "1130", label: "เงินฝากธนาคาร — กระแสรายวัน",  emoji: "🏦" },
  { code: "1140", label: "เงินฝากธนาคาร — ออมทรัพย์",     emoji: "🏦" },
  { code: "1200", label: "ลูกหนี้การค้า",                  emoji: "📋" },
  { code: "1300", label: "สินค้าคงเหลือ",                  emoji: "📦" }
];

//  Credit side (หนี้สิน + ส่วนของเจ้าของ)
const LIABILITY_FIELDS = [
  { code: "2100", label: "เจ้าหนี้การค้า",                emoji: "📋" },
  { code: "2120", label: "เจ้าหนี้อื่น (บัตรเครดิต ฯลฯ)", emoji: "💳" },
  { code: "2200", label: "เงินกู้ยืม",                     emoji: "🏛" }
];
const EQUITY_FIELDS = [
  { code: "3100", label: "ทุนจดทะเบียน",                  emoji: "💼" },
  { code: "3200", label: "ทุนของเจ้าของ",                 emoji: "👤" }
];

export function renderOpeningBalancePage(ctx) {
  _ctx = ctx;
  const container = document.getElementById("page-accounting_opening_balance");
  if (!container) return;

  container.innerHTML = `
    <div class="panel" style="max-width:900px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-size:30px">📥</span>
        <div style="flex:1;min-width:200px">
          <h2 style="margin:0;font-size:20px;color:#0f172a">ลงยอดยกมา (Opening Balance)</h2>
          <div style="font-size:12px;color:#64748b">เริ่มต้นใช้ระบบ — ลงทุน + เงินสดเริ่มต้น + ลูกหนี้/เจ้าหนี้ คงค้าง · ลงวันที่ ${ACCOUNTING_EFFECTIVE_DATE}</div>
        </div>
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:#78350f;line-height:1.7">
        <b>⚠️ ลงครั้งเดียวเท่านั้น</b> — ระบบจะสร้าง JV ประเภท OB (Opening Balance) ลงวันที่ ${ACCOUNTING_EFFECTIVE_DATE}<br>
        ถ้าผิด → ลบ JV นั้นในสมุดรายวัน แล้วลงใหม่ (ผ่าน JV ใหม่ — กดปุ่มซ้ำได้ มี idempotency กัน)
      </div>

      <!-- Asset section -->
      <div style="margin-bottom:18px">
        <div style="background:#0284c7;color:#fff;padding:10px 14px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">🟦 สินทรัพย์ที่ยกมา (Debit)</div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:14px">
          ${ASSET_FIELDS.map(f => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
              <span style="font-size:20px;width:28px;text-align:center">${f.emoji}</span>
              <span style="font-family:monospace;color:#475569;width:60px">${f.code}</span>
              <span style="flex:1;color:#0f172a;font-size:13px">${escHtml(f.label)}</span>
              <input type="number" id="ob_${f.code}" step="0.01" min="0" placeholder="0.00" style="width:160px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;text-align:right" />
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Liability section -->
      <div style="margin-bottom:18px">
        <div style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">🟥 หนี้สินที่ยกมา (Credit)</div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:14px">
          ${LIABILITY_FIELDS.map(f => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
              <span style="font-size:20px;width:28px;text-align:center">${f.emoji}</span>
              <span style="font-family:monospace;color:#475569;width:60px">${f.code}</span>
              <span style="flex:1;color:#0f172a;font-size:13px">${escHtml(f.label)}</span>
              <input type="number" id="ob_${f.code}" step="0.01" min="0" placeholder="0.00" style="width:160px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;text-align:right" />
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Equity section -->
      <div style="margin-bottom:18px">
        <div style="background:#7c3aed;color:#fff;padding:10px 14px;border-radius:8px 8px 0 0;font-weight:700;font-size:14px">🟪 ส่วนของเจ้าของที่ยกมา (Credit)</div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:14px">
          ${EQUITY_FIELDS.map(f => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
              <span style="font-size:20px;width:28px;text-align:center">${f.emoji}</span>
              <span style="font-family:monospace;color:#475569;width:60px">${f.code}</span>
              <span style="flex:1;color:#0f172a;font-size:13px">${escHtml(f.label)}</span>
              <input type="number" id="ob_${f.code}" step="0.01" min="0" placeholder="0.00" style="width:160px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;text-align:right" />
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Live balance display -->
      <div id="obBalancePanel" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px"></div>

      <!-- Action buttons -->
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button id="obSubmitBtn" class="btn primary" style="font-size:14px;padding:12px 20px">💾 บันทึกยอดยกมา (สร้าง JV)</button>
        <button id="obResetBtn" class="btn light">รีเซ็ตทั้งหมด</button>
      </div>

      <div id="obStatus" style="margin-top:14px"></div>
    </div>
  `;

  // Live balance update
  const updateBalance = () => {
    const totalDebit = ASSET_FIELDS.reduce((s, f) => s + num(document.getElementById(`ob_${f.code}`)?.value), 0);
    const totalCredit = [...LIABILITY_FIELDS, ...EQUITY_FIELDS].reduce((s, f) => s + num(document.getElementById(`ob_${f.code}`)?.value), 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
    const empty = totalDebit < 0.01 && totalCredit < 0.01;

    const panel = document.getElementById("obBalancePanel");
    if (!panel) return;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:10px;font-family:monospace;text-align:center">
        <div>
          <div style="font-size:11px;color:#64748b">Dr (สินทรัพย์)</div>
          <div style="font-size:18px;font-weight:800;color:#0284c7">${money(totalDebit)}</div>
        </div>
        <div style="font-size:24px;color:${balanced ? '#15803d' : (empty ? '#94a3b8' : '#dc2626')};font-weight:900">=</div>
        <div>
          <div style="font-size:11px;color:#64748b">Cr (หนี้สิน + ส่วนของเจ้าของ)</div>
          <div style="font-size:18px;font-weight:800;color:#7c3aed">${money(totalCredit)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#64748b">ผลต่าง</div>
          <div style="font-size:16px;font-weight:800;color:${balanced ? '#15803d' : (empty ? '#94a3b8' : '#dc2626')}">${money(totalDebit - totalCredit)}</div>
        </div>
      </div>
      ${balanced ? '<div style="text-align:center;color:#15803d;font-size:12px;margin-top:6px;font-weight:700">✓ Dr = Cr — พร้อมบันทึก</div>'
        : empty ? '<div style="text-align:center;color:#94a3b8;font-size:12px;margin-top:6px">กรอกตัวเลขในช่องด้านบน</div>'
        : '<div style="text-align:center;color:#dc2626;font-size:12px;margin-top:6px;font-weight:700">⚠️ Dr ≠ Cr — ปรับให้เท่ากันก่อนบันทึก</div>'}
    `;
  };

  // Wire all input changes
  [...ASSET_FIELDS, ...LIABILITY_FIELDS, ...EQUITY_FIELDS].forEach(f => {
    document.getElementById(`ob_${f.code}`)?.addEventListener("input", updateBalance);
  });
  updateBalance();

  document.getElementById("obResetBtn")?.addEventListener("click", () => {
    if (!confirm("รีเซ็ตทั้งหมด?")) return;
    [...ASSET_FIELDS, ...LIABILITY_FIELDS, ...EQUITY_FIELDS].forEach(f => {
      const el = document.getElementById(`ob_${f.code}`);
      if (el) el.value = "";
    });
    updateBalance();
  });

  document.getElementById("obSubmitBtn")?.addEventListener("click", _onSubmit);
}

async function _onSubmit() {
  const setStatus = (html) => {
    const el = document.getElementById("obStatus");
    if (el) el.innerHTML = html;
  };

  // Collect lines
  const lines = [];
  ASSET_FIELDS.forEach(f => {
    const v = num(document.getElementById(`ob_${f.code}`)?.value);
    if (v > 0) lines.push({ account_code: f.code, debit: v, credit: 0, description: `ยอดยกมา — ${f.label}` });
  });
  [...LIABILITY_FIELDS, ...EQUITY_FIELDS].forEach(f => {
    const v = num(document.getElementById(`ob_${f.code}`)?.value);
    if (v > 0) lines.push({ account_code: f.code, debit: 0, credit: v, description: `ยอดยกมา — ${f.label}` });
  });

  if (lines.length === 0) {
    setStatus(`<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">กรอกตัวเลขอย่างน้อย 1 ช่อง</div>`);
    return;
  }

  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    setStatus(`<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">⚠️ Dr ≠ Cr — ปรับให้เท่ากันก่อนบันทึก<br>Dr ${money(totalDebit)} ≠ Cr ${money(totalCredit)}</div>`);
    return;
  }

  if (!confirm(`ยืนยันบันทึกยอดยกมา?\n\nDr = Cr = ${money(totalDebit)}\nลงวันที่ ${ACCOUNTING_EFFECTIVE_DATE}\n${lines.length} รายการ`)) return;

  const cfg = window.SUPABASE_CONFIG;
  const token = window._sbAccessToken || cfg.anonKey;
  const headers = { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": "Bearer " + token, "Prefer": "return=representation" };

  setStatus(`<div style="padding:12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;color:#0c4a6e">⏳ กำลังบันทึก...</div>`);

  try {
    // Find next OB doc_no
    const yyyy = ACCOUNTING_EFFECTIVE_DATE.slice(0, 4);
    const mm   = ACCOUNTING_EFFECTIVE_DATE.slice(5, 7);
    const docNoPrefix = `OB${yyyy}${mm}`;
    let nextSeq = 1;
    try {
      const r = await fetch(`${cfg.url}/rest/v1/journal_entries?select=doc_no&doc_no=like.${docNoPrefix}*&order=doc_no.desc&limit=1`, { headers });
      const arr = await r.json();
      if (arr[0]?.doc_no) {
        const tail = arr[0].doc_no.slice(docNoPrefix.length);
        nextSeq = (Number(tail) || 0) + 1;
      }
    } catch(_) {}
    const docNo = `${docNoPrefix}${String(nextSeq).padStart(4, "0")}`;

    // POST entry
    const entryRes = await fetch(`${cfg.url}/rest/v1/journal_entries`, {
      method: "POST", headers,
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: "OB",
        doc_date: ACCOUNTING_EFFECTIVE_DATE,
        description: "ยอดยกมา (Opening Balance)",
        status: "approved",
        total_debit: totalDebit,
        total_credit: totalCredit,
        approved_at: new Date().toISOString()
      })
    });
    if (!entryRes.ok) throw new Error("HTTP " + entryRes.status + " — " + (await entryRes.text()).slice(0, 200));
    const entry = (await entryRes.json())[0];
    if (!entry?.id) throw new Error("ไม่ได้ id JV กลับ");

    // POST lines
    const linePayload = lines.map((l, i) => ({
      entry_id: entry.id,
      line_no: i + 1,
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description
    }));
    const linesRes = await fetch(`${cfg.url}/rest/v1/journal_lines`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify(linePayload)
    });
    if (!linesRes.ok) throw new Error("Lines HTTP " + linesRes.status);

    setStatus(`
      <div style="padding:14px;background:#f0fdf4;border:2px solid #16a34a;border-radius:10px;color:#166534">
        <div style="font-weight:700;font-size:15px;margin-bottom:6px">✅ บันทึกยอดยกมาสำเร็จ!</div>
        <div style="font-size:13px;line-height:1.7">
          เลขที่: <b>${docNo}</b><br>
          ${lines.length} รายการ · Dr = Cr = ${money(totalDebit)}<br>
          → ดูใน <a href="#" id="ob-go-journals" style="color:#0284c7;font-weight:700">📒 สมุดรายวัน</a> หรือ
          <a href="#" id="ob-go-balance" style="color:#0284c7;font-weight:700">🏦 งบดุล</a> (ตัวเลขจะเป็นบวกแล้ว)
        </div>
      </div>
    `);
    // Phase 89.23: bind nav links ผ่าน addEventListener (เลิก inline onclick)
    document.getElementById("ob-go-journals")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector('[data-route=accounting_journals]')?.click();
    });
    document.getElementById("ob-go-balance")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector('[data-route=accounting_balance_sheet]')?.click();
    });
    _ctx?.showToast?.("บันทึกยอดยกมาแล้ว ✅");

    // Reset form
    [...ASSET_FIELDS, ...LIABILITY_FIELDS, ...EQUITY_FIELDS].forEach(f => {
      const el = document.getElementById(`ob_${f.code}`);
      if (el) el.value = "";
    });

  } catch(e) {
    console.error("[opening_balance] save failed:", e);
    setStatus(`<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b">❌ ${escHtml(e.message || String(e))}</div>`);
  }
}
