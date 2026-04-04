// ═══════════════════════════════════════════════════════════
//  BTU CALCULATOR — คำนวณ BTU สำหรับแอร์
// ═══════════════════════════════════════════════════════════

const BTU_FACTORS = {
  "ห้องนอน (ไม่โดนแดด)": 750,
  "ห้องนอน (โดนแดดบ้าง)": 825,
  "ห้องทำงาน / ห้องนั่งเล่น": 850,
  "ห้องที่โดนแดดมาก / ห้องกระจก": 950,
  "ร้านค้า / ออฟฟิศโดนแดด": 1000,
  "ร้านอาหาร / ห้องประชุม": 1200,
  "ร้านปิ้งย่าง / ห้องที่มีความร้อนสูง": 1400
};

const BTU_SIZES = [
  { btu: 9000, label: "9,000 BTU" },
  { btu: 12000, label: "12,000 BTU" },
  { btu: 15000, label: "15,000 BTU" },
  { btu: 18000, label: "18,000 BTU" },
  { btu: 24000, label: "24,000 BTU" },
  { btu: 30000, label: "30,000 BTU" },
  { btu: 36000, label: "36,000 BTU ขึ้นไป" }
];

export function renderBtuCalculatorPage(ctx) {
  const { state, money } = ctx;
  const container = document.getElementById("page-btu_calculator");
  if (!container) return;

  const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const roomOptions = Object.keys(BTU_FACTORS).map(k => `<option value="${escHtml(k)}">${escHtml(k)}</option>`).join("");

  container.innerHTML = `
    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:4px">🧮 คำนวณ BTU ที่เหมาะสม</h3>
      <p class="sku">กรอกข้อมูลห้องเพื่อคำนวณขนาดแอร์ที่เหมาะสม</p>
    </div>

    <div class="panel">
      <div class="set-section-title">📐 ขนาดห้อง</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">กว้าง (เมตร)</label>
          <input type="number" id="btuWidth" value="4" min="1" max="30" step="0.5" />
        </div>
        <div>
          <label class="set-field-label">ยาว (เมตร)</label>
          <input type="number" id="btuLength" value="5" min="1" max="30" step="0.5" />
        </div>
        <div>
          <label class="set-field-label">สูง (เมตร)</label>
          <input type="number" id="btuHeight" value="2.7" min="2" max="5" step="0.1" />
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="set-section-title">🏠 ประเภทห้อง</div>
      <select id="btuRoomType">${roomOptions}</select>

      <div class="set-section-title" style="margin-top:14px">🏢 ชั้น / ตำแหน่ง</div>
      <select id="btuFloor">
        <option value="normal">ชั้นล่าง / ใต้ร่มเงา</option>
        <option value="sun">ชั้นบน / โดนแดดโดยตรง</option>
        <option value="glass">ห้องกระจก / โดนแดดมาก</option>
      </select>

      <div class="set-section-title" style="margin-top:14px">👥 จำนวนคนใช้งาน</div>
      <input type="number" id="btuPeople" value="2" min="1" max="20" />
    </div>

    <button id="btuCalcBtn" class="set-save-btn" style="margin-top:0">🔍 คำนวณ BTU</button>

    <div id="btuResult" class="hidden"></div>
  `;

  container.querySelector("#btuCalcBtn").addEventListener("click", () => {
    const width = parseFloat(document.getElementById("btuWidth").value) || 4;
    const length = parseFloat(document.getElementById("btuLength").value) || 5;
    const height = parseFloat(document.getElementById("btuHeight").value) || 2.7;
    const roomType = document.getElementById("btuRoomType").value;
    const floor = document.getElementById("btuFloor").value;
    const people = parseInt(document.getElementById("btuPeople").value) || 2;

    const area = width * length;
    const factor = BTU_FACTORS[roomType] || 850;
    let btu = area * factor;

    // ปรับตามความสูง
    if (height > 2.7) btu *= 1.10;
    // ปรับตามชั้น
    if (floor === "sun") btu *= 1.15;
    if (floor === "glass") btu *= 1.25;
    // ปรับตามคน
    if (people > 2) btu += (people - 2) * 600;

    btu = Math.round(btu);

    // แนะนำขนาด
    let recommended = BTU_SIZES[BTU_SIZES.length - 1];
    for (const s of BTU_SIZES) {
      if (btu <= s.btu * 1.05) { recommended = s; break; }
    }

    // หาสินค้าในสต็อก
    const products = (state.products || []).filter(p => {
      const pBtu = parseInt(p.btu) || 0;
      return pBtu > 0 && Math.abs(pBtu - btu) <= 5000 && (p.stock_qty || 0) > 0;
    }).sort((a, b) => Math.abs((parseInt(a.btu)||0) - btu) - Math.abs((parseInt(b.btu)||0) - btu)).slice(0, 6);

    const resultEl = document.getElementById("btuResult");
    resultEl.classList.remove("hidden");
    resultEl.innerHTML = `
      <div style="background:linear-gradient(135deg,#38bdf8,#0284c7);color:#fff;border-radius:22px;padding:24px;text-align:center;margin-top:12px">
        <div style="font-size:14px;opacity:.85">🌡️ BTU ที่ต้องการ</div>
        <div style="font-size:42px;font-weight:900;margin:8px 0">${btu.toLocaleString()} BTU</div>
        <div style="font-size:15px;background:rgba(255,255,255,.2);display:inline-block;padding:6px 16px;border-radius:99px;margin-top:4px">
          ✅ แนะนำขนาด <strong>${recommended.label}</strong>
        </div>
      </div>

      <div class="panel" style="margin-top:12px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:8px">📋 รายละเอียดการคำนวณ</div>
        <div style="display:grid;gap:6px;font-size:14px">
          <div style="display:flex;justify-content:space-between"><span>พื้นที่ห้อง</span><strong>${area.toFixed(1)} ตร.ม.</strong></div>
          <div style="display:flex;justify-content:space-between"><span>ประเภทห้อง</span><strong>${escHtml(roomType)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span>Factor</span><strong>${factor} BTU/ตร.ม.</strong></div>
          <div style="display:flex;justify-content:space-between"><span>จำนวนคน</span><strong>${people} คน</strong></div>
        </div>
      </div>

      ${products.length > 0 ? `
      <div class="panel" style="margin-top:12px">
        <div class="set-section-title">📦 รุ่นที่มีในสต็อก (ใกล้เคียง)</div>
        <div style="display:grid;gap:8px">
          ${products.map(p => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f8fafc;border-radius:14px;border:1px solid var(--line)">
              <div style="font-size:24px;flex-shrink:0">❄️</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px">${escHtml(p.name || p.model || "")}</div>
                <div class="sku">${parseInt(p.btu||0).toLocaleString()} BTU • คงเหลือ ${p.stock_qty || 0} เครื่อง</div>
              </div>
              <div style="font-weight:900;color:var(--primary2);font-size:14px;white-space:nowrap">${money(p.price_install || p.price || 0)}</div>
            </div>
          `).join("")}
        </div>
      </div>` : ""}
    `;
  });
}
