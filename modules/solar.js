// ═══════════════════════════════════════════════════════════
//  SOLAR — งานโซล่าเซลล์
// ═══════════════════════════════════════════════════════════

const SOLAR_TYPES = [
  "💧 ติดตั้งปั๊มน้ำโซล่าเซลล์",
  "⚡ ติดตั้งชุดออนกริดโซล่าเซลล์",
  "🔋 ติดตั้งชุดออฟกริดโซล่าเซลล์",
  "🌐 ติดตั้งชุดไฮบริดโซล่าเซลล์",
  "🔌 ซ่อม & เซอร์วิสระบบโซล่าเซลล์",
  "🛠️ งานโซล่าเซลล์อื่นๆ"
];

export function renderSolarPage(ctx) {
  const { state, money, showToast } = ctx;
  const container = document.getElementById("page-solar");
  if (!container) return;

  const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const typeOptions = SOLAR_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("");

  container.innerHTML = `
    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:4px">☀️ งานโซล่าเซลล์</h3>
      <p class="sku">สร้างใบงาน/ใบเสนอราคางานโซล่าเซลล์</p>
    </div>

    <!-- ประเภทงาน -->
    <div class="panel">
      <div class="set-section-title">☀️ ประเภทงาน</div>
      <select id="solType">${typeOptions}</select>
      <div id="solCustomTypeWrap" class="hidden" style="margin-top:8px">
        <input type="text" id="solCustomType" placeholder="ระบุประเภทงาน..." />
      </div>
    </div>

    <!-- ข้อมูลลูกค้า -->
    <div class="panel">
      <div class="set-section-title">👤 ข้อมูลลูกค้า</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">ชื่อลูกค้า</label>
          <input type="text" id="solName" placeholder="ชื่อ-นามสกุล" />
        </div>
        <div>
          <label class="set-field-label">เบอร์โทร</label>
          <input type="tel" id="solPhone" placeholder="08X-XXXXXXX" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:8px">ที่อยู่</label>
      <textarea id="solAddress" rows="2" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>
    </div>

    <!-- รายละเอียดงาน -->
    <div class="panel">
      <div class="set-section-title">⚡ รายละเอียดงาน</div>
      <textarea id="solDetail" rows="3" placeholder="เช่น ระบบ 3kW, จำนวนแผง 8 แผง, อินเวอร์เตอร์ยี่ห้อ..." style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>

      <div class="set-section-title" style="margin-top:14px">🔧 อุปกรณ์ / วัสดุ</div>
      <div id="solEquipList"></div>
      <button type="button" id="solAddEquip" class="btn light" style="margin-top:8px;font-size:13px">+ เพิ่มอุปกรณ์</button>
    </div>

    <!-- ราคา -->
    <div class="panel">
      <div class="set-section-title">💰 ราคาค่าบริการ</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">🔨 ค่าแรง/ค่าบริการ (฿)</label>
          <input type="number" id="solLabor" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">💸 ส่วนลด (฿)</label>
          <input type="number" id="solDiscount" value="0" min="0" step="100" />
        </div>
      </div>
      <div id="solPriceSummary" style="margin-top:12px;text-align:center;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:16px;padding:14px">
        <div class="sku">ราคารวม</div>
        <div style="font-size:32px;font-weight:900;color:#b45309">฿ 0</div>
      </div>
    </div>

    <!-- บันทึก -->
    <button id="solSaveBtn" class="set-save-btn">💾 บันทึกงานโซล่าเซลล์</button>
    <div id="solStatus" class="hidden panel mt16"></div>
  `;

  let equipCount = 0;

  function addEquipRow() {
    equipCount++;
    const div = document.createElement("div");
    div.style.cssText = "display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end;margin-top:6px";
    div.innerHTML = `
      <input type="text" placeholder="ชื่ออุปกรณ์" class="sol-eq-name" />
      <input type="number" placeholder="ราคา/ชิ้น" min="0" step="100" value="0" class="sol-eq-price" />
      <input type="number" placeholder="จำนวน" min="1" value="1" class="sol-eq-qty" />
      <button type="button" class="btn danger-fill" style="padding:8px 12px;font-size:16px" data-remove-equip>✕</button>
    `;
    div.querySelector("[data-remove-equip]").addEventListener("click", () => { div.remove(); updatePrice(); });
    div.querySelectorAll("input").forEach(inp => inp.addEventListener("input", updatePrice));
    container.querySelector("#solEquipList").appendChild(div);
  }

  function updatePrice() {
    const labor = parseFloat(container.querySelector("#solLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#solDiscount").value) || 0;
    let equipTotal = 0;
    container.querySelectorAll("#solEquipList > div").forEach(row => {
      const price = parseFloat(row.querySelector(".sol-eq-price")?.value) || 0;
      const qty = parseInt(row.querySelector(".sol-eq-qty")?.value) || 1;
      equipTotal += price * qty;
    });
    const net = Math.max(0, labor + equipTotal - discount);
    container.querySelector("#solPriceSummary").innerHTML = `
      <div class="sku">ราคารวม ${equipTotal > 0 ? `(ค่าแรง ${money(labor)} + อุปกรณ์ ${money(equipTotal)}${discount > 0 ? ` - ส่วนลด ${money(discount)}` : ""})` : ""}</div>
      <div style="font-size:32px;font-weight:900;color:#b45309">${money(net)}</div>
    `;
  }

  // Events
  container.querySelector("#solType").addEventListener("change", (e) => {
    container.querySelector("#solCustomTypeWrap").classList.toggle("hidden", !e.target.value.includes("อื่นๆ"));
  });
  container.querySelector("#solAddEquip").addEventListener("click", addEquipRow);
  container.querySelector("#solLabor").addEventListener("input", updatePrice);
  container.querySelector("#solDiscount").addEventListener("input", updatePrice);

  // Add 1 default row
  addEquipRow();

  // Save
  container.querySelector("#solSaveBtn").addEventListener("click", async (e) => {
    const saveBtn = e.currentTarget;
    if (saveBtn.disabled) return; // ★ กัน double-click
    const typeVal = container.querySelector("#solType").value.includes("อื่นๆ")
      ? (container.querySelector("#solCustomType")?.value.trim() || container.querySelector("#solType").value)
      : container.querySelector("#solType").value;
    const name = container.querySelector("#solName").value.trim();
    const phone = container.querySelector("#solPhone").value.trim();
    const address = container.querySelector("#solAddress").value.trim();
    const detail = container.querySelector("#solDetail").value.trim();

    if (!name) return showToast("กรอกชื่อลูกค้า");

    saveBtn.disabled = true;
    const origText = saveBtn.textContent;
    saveBtn.textContent = "⏳ กำลังบันทึก...";

    const labor = parseFloat(container.querySelector("#solLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#solDiscount").value) || 0;
    let equipTotal = 0;
    let equipNote = [];
    container.querySelectorAll("#solEquipList > div").forEach(row => {
      const eqName = row.querySelector(".sol-eq-name")?.value.trim();
      const price = parseFloat(row.querySelector(".sol-eq-price")?.value) || 0;
      const qty = parseInt(row.querySelector(".sol-eq-qty")?.value) || 1;
      if (eqName) {
        equipTotal += price * qty;
        equipNote.push(`${eqName} ${qty} ชิ้น = ฿${(price * qty).toLocaleString()}`);
      }
    });
    const net = Math.max(0, labor + equipTotal - discount);

    const statusEl = container.querySelector("#solStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "กำลังบันทึก...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = (await state.supabase.auth.getSession())?.data?.session?.access_token || cfg.anonKey;

      const record = {
        customer_name: name,
        customer_phone: phone,
        job_type: "solar",
        device_name: `☀️ ${typeVal}`,
        description: [detail, equipNote.length ? `อุปกรณ์: ${equipNote.join(" | ")}` : ""].filter(Boolean).join("\n"),
        address: address,
        price: net,
        status: "pending",
        note: `ค่าแรง: ฿${labor.toLocaleString()}${discount ? ` ส่วนลด: ฿${discount.toLocaleString()}` : ""}`,
        created_by: state.currentUser?.id
      };

      const resp = await fetch(`${cfg.url}/rest/v1/service_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.anonKey,
          "Authorization": `Bearer ${token}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(record)
      });

      if (!resp.ok) throw new Error("HTTP " + resp.status);

      statusEl.innerHTML = `<div style="text-align:center;color:var(--success);font-weight:700">✅ บันทึกงานโซล่าเซลล์สำเร็จ!</div>`;
      showToast("บันทึกสำเร็จ!");
    } catch (e) {
      console.error("[solar save] error:", e);
      statusEl.textContent = "เกิดข้อผิดพลาด: " + e.message;
      showToast("บันทึกไม่สำเร็จ");
    } finally {
      if (saveBtn.isConnected) {
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    }
  });
}
