// ═══════════════════════════════════════════════════════════
//  AC INSTALL — ใบงานติดตั้งแอร์
// ═══════════════════════════════════════════════════════════

export function renderAcInstallPage(ctx) {
  const { state, money, showToast } = ctx;
  const container = document.getElementById("page-ac_install");
  if (!container) return;

  const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  // สินค้าแอร์ในสต็อก
  const acProducts = (state.products || []).filter(p => {
    const name = (p.name || p.model || "").toLowerCase();
    return (name.includes("แอร์") || name.includes("air") || (parseInt(p.btu) > 0)) && (p.stock_qty || 0) > 0;
  });

  const productOptions = acProducts.map(p =>
    `<option value="${p.id}" data-price="${p.price_install || p.price || 0}" data-btu="${p.btu || 0}">${escHtml(p.name || p.model)} — ${parseInt(p.btu||0).toLocaleString()} BTU (${money(p.price_install || p.price || 0)})</option>`
  ).join("");

  container.innerHTML = `
    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:4px">🏗️ ใบงานติดตั้งแอร์</h3>
      <p class="sku">สร้างใบงานติดตั้งแอร์พร้อมคำนวณราคา</p>
    </div>

    <!-- ข้อมูลลูกค้า -->
    <div class="panel">
      <div class="set-section-title">👤 ข้อมูลลูกค้า</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">ชื่อลูกค้า</label>
          <input type="text" id="acName" placeholder="ชื่อ-นามสกุล" />
        </div>
        <div>
          <label class="set-field-label">เบอร์โทร</label>
          <input type="tel" id="acPhone" placeholder="08X-XXXXXXX" />
        </div>
      </div>
      <label class="set-field-label" style="margin-top:8px">ที่อยู่ติดตั้ง</label>
      <textarea id="acAddress" rows="2" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>
    </div>

    <!-- เลือกรุ่นแอร์ -->
    <div class="panel">
      <div class="set-section-title">❄️ เลือกรุ่นแอร์</div>
      ${acProducts.length > 0
        ? `<select id="acProduct"><option value="">-- เลือกรุ่น --</option>${productOptions}</select>`
        : `<div class="sku" style="text-align:center;padding:12px">ไม่มีสินค้าแอร์ในสต็อก</div>`
      }
      <div style="margin-top:10px">
        <label class="set-field-label">จำนวน (เครื่อง)</label>
        <input type="number" id="acQty" value="1" min="1" max="10" />
      </div>
    </div>

    <!-- ค่าติดตั้ง -->
    <div class="panel">
      <div class="set-section-title">🔨 ค่าติดตั้งเพิ่มเติม</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label class="set-field-label">ค่าท่อทองแดง (฿)</label>
          <input type="number" id="acPipe" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">ค่าท่อน้ำทิ้ง (฿)</label>
          <input type="number" id="acDrain" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">ค่าแท่นยึด/ขาตั้ง (฿)</label>
          <input type="number" id="acBracket" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">ค่าไฟ/เดินสาย (฿)</label>
          <input type="number" id="acElectric" value="0" min="0" step="100" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div>
          <label class="set-field-label">ค่าแรงติดตั้ง (฿)</label>
          <input type="number" id="acLabor" value="0" min="0" step="100" />
        </div>
        <div>
          <label class="set-field-label">ส่วนลด (฿)</label>
          <input type="number" id="acDiscount" value="0" min="0" step="100" />
        </div>
      </div>

      <label class="set-field-label" style="margin-top:10px">หมายเหตุ</label>
      <input type="text" id="acNote" placeholder="เช่น วันนัดติดตั้ง, รายละเอียดเพิ่มเติม..." />
    </div>

    <!-- สรุปราคา -->
    <div id="acPriceSummary" class="panel" style="text-align:center">
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">฿ 0</div>
    </div>

    <button id="acSaveBtn" class="set-save-btn">💾 บันทึกใบงานติดตั้ง</button>
    <div id="acStatus" class="hidden panel mt16"></div>
  `;

  function updateTotal() {
    const sel = container.querySelector("#acProduct");
    const productPrice = sel ? parseFloat(sel.selectedOptions[0]?.dataset?.price || 0) : 0;
    const qty = parseInt(container.querySelector("#acQty").value) || 1;
    const pipe = parseFloat(container.querySelector("#acPipe").value) || 0;
    const drain = parseFloat(container.querySelector("#acDrain").value) || 0;
    const bracket = parseFloat(container.querySelector("#acBracket").value) || 0;
    const electric = parseFloat(container.querySelector("#acElectric").value) || 0;
    const labor = parseFloat(container.querySelector("#acLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#acDiscount").value) || 0;

    const acPrice = productPrice * qty;
    const extras = pipe + drain + bracket + electric + labor;
    const net = Math.max(0, acPrice + extras - discount);

    container.querySelector("#acPriceSummary").innerHTML = `
      <div class="sku">ราคารวมทั้งหมด</div>
      <div style="font-size:36px;font-weight:900;color:var(--primary2)">${money(net)}</div>
      <div class="sku" style="margin-top:4px">ราคาแอร์ ${money(acPrice)} + ค่าติดตั้ง ${money(extras)}${discount > 0 ? ` - ส่วนลด ${money(discount)}` : ""}</div>
    `;
  }

  // Bind all inputs
  container.querySelectorAll("input[type=number], select").forEach(el => el.addEventListener("input", updateTotal));
  container.querySelector("#acProduct")?.addEventListener("change", updateTotal);

  // Save
  container.querySelector("#acSaveBtn").addEventListener("click", async () => {
    const name = container.querySelector("#acName").value.trim();
    if (!name) return showToast("กรอกชื่อลูกค้า");

    const sel = container.querySelector("#acProduct");
    const productName = sel?.selectedOptions[0]?.textContent || "ติดตั้งแอร์";
    const qty = parseInt(container.querySelector("#acQty").value) || 1;
    const productPrice = sel ? parseFloat(sel.selectedOptions[0]?.dataset?.price || 0) : 0;
    const pipe = parseFloat(container.querySelector("#acPipe").value) || 0;
    const drain = parseFloat(container.querySelector("#acDrain").value) || 0;
    const bracket = parseFloat(container.querySelector("#acBracket").value) || 0;
    const electric = parseFloat(container.querySelector("#acElectric").value) || 0;
    const labor = parseFloat(container.querySelector("#acLabor").value) || 0;
    const discount = parseFloat(container.querySelector("#acDiscount").value) || 0;
    const extras = pipe + drain + bracket + electric + labor;
    const net = Math.max(0, (productPrice * qty) + extras - discount);

    const statusEl = container.querySelector("#acStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "กำลังบันทึก...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = (await state.supabase.auth.getSession())?.data?.session?.access_token || cfg.anonKey;

      const desc = [
        `รุ่น: ${productName} x${qty}`,
        pipe ? `ท่อทองแดง: ฿${pipe.toLocaleString()}` : "",
        drain ? `ท่อน้ำทิ้ง: ฿${drain.toLocaleString()}` : "",
        bracket ? `ขาตั้ง: ฿${bracket.toLocaleString()}` : "",
        electric ? `ค่าไฟ: ฿${electric.toLocaleString()}` : "",
        labor ? `ค่าแรง: ฿${labor.toLocaleString()}` : "",
        discount ? `ส่วนลด: -฿${discount.toLocaleString()}` : "",
      ].filter(Boolean).join(" | ");

      const record = {
        customer_name: name,
        customer_phone: container.querySelector("#acPhone").value.trim(),
        job_type: "ac",
        device_name: `🏗️ ติดตั้งแอร์`,
        description: desc,
        address: container.querySelector("#acAddress").value.trim(),
        price: net,
        status: "pending",
        note: container.querySelector("#acNote").value.trim(),
        created_by: state.currentUser?.id
      };

      const resp = await fetch(`${cfg.url}/rest/v1/service_jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Prefer": "return=minimal" },
        body: JSON.stringify(record)
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);

      statusEl.innerHTML = `<div style="text-align:center;color:var(--success);font-weight:700">✅ บันทึกใบงานติดตั้งสำเร็จ!</div>`;
      showToast("บันทึกสำเร็จ!");
    } catch (e) {
      statusEl.textContent = "เกิดข้อผิดพลาด: " + e.message;
    }
  });
}
