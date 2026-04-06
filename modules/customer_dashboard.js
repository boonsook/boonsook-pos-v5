// ═══════════════════════════════════════════════════════════
//  CUSTOMER DASHBOARD — หน้าหลักลูกค้า: ร้านค้าออนไลน์ + ตะกร้า + ประวัติ + แต้ม
// ═══════════════════════════════════════════════════════════

let _custCart = JSON.parse(localStorage.getItem("bsk_cust_cart") || "[]");
let _custTab = "shop"; // shop | cart | orders | points
let _custCategory = "all";
let _custSearch = "";
let _acCatalog = null; // ★ แคชแคตตาล็อกแอร์
let _custSlipData = null; // ★ base64 ของสลิปที่แนบ
let _custSlipVerified = false; // ★ ผ่านการตรวจสอบหรือยัง
let _custSlipResult = null; // ★ ผลตรวจสลิป
let _custSlipUrl = null;  // ★ URL สลิปที่ upload ไป Supabase Storage แล้ว

function saveCustCart() {
  try { localStorage.setItem("bsk_cust_cart", JSON.stringify(_custCart)); } catch(e){}
}

function money(n){return new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(Number(n||0));}

const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ★ Upload สลิปไป Supabase Storage bucket "proofs" — ป้องกันสลิปหายหลัง checkout
async function _uploadSlipToStorage(base64Data, state) {
  try {
    const cfg = window.SUPABASE_CONFIG;
    if (!cfg?.url || !cfg?.anonKey) return null;
    const token = (await state.supabase?.auth?.getSession?.())?.data?.session?.access_token || cfg.anonKey;

    // แปลง base64 → Blob
    const arr = base64Data.split(",");
    const mimeType = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const ext = mimeType.split("/")[1] || "jpg";
    const bstr = atob(arr[1]);
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
    const blob = new Blob([u8arr], { type: mimeType });

    const filePath = `slips/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadRes = await fetch(`${cfg.url}/storage/v1/object/proofs/${filePath}`, {
      method: "POST",
      headers: {
        "apikey": cfg.anonKey,
        "Authorization": `Bearer ${token}`,
        "Content-Type": mimeType,
        "x-upsert": "true"
      },
      body: blob
    });
    if (uploadRes.ok) {
      return `${cfg.url}/storage/v1/object/public/proofs/${filePath}`;
    }
    return null;
  } catch(e) {
    console.warn("Slip upload to Storage failed:", e);
    return null;
  }
}

// ★ ตรวจสอบสลิปผ่าน SlipOK API (https://slipok.com)
// ถ้าร้านยังไม่ได้ตั้ง API key จะ return { valid: false, error: "no_api" } → ให้ผ่านเลย ร้านตรวจเอง
async function _verifySlip(base64Data, expectedAmount) {
  try {
    // ★ อ่าน SlipOK API key จาก localStorage (ร้านตั้งค่าในหน้า settings)
    const slipOkKey = localStorage.getItem("bsk_slipok_key") || "";
    const slipOkBranch = localStorage.getItem("bsk_slipok_branch") || "";
    if (!slipOkKey) return { valid: false, error: "no_api", message: "ไม่มี SlipOK API Key" };

    // แปลง base64 เป็น blob/file
    const byteStr = atob(base64Data.split(",")[1]);
    const mimeType = base64Data.split(",")[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const ab = new ArrayBuffer(byteStr.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
    const blob = new Blob([ab], { type: mimeType });

    const formData = new FormData();
    formData.append("files", blob, "slip.jpg");
    if (expectedAmount) formData.append("amount", String(expectedAmount));

    const apiUrl = slipOkBranch
      ? `https://api.slipok.com/api/line/apikey/${slipOkBranch}`
      : "https://api.slipok.com/api/line/apikey/0";

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "x-authorization": slipOkKey },
      body: formData
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { valid: false, error: "api_error", message: "API Error: " + resp.status };
    }

    const data = await resp.json();
    if (data.success) {
      const d = data.data || {};
      const amountOk = !expectedAmount || Math.abs(Number(d.amount || 0) - Number(expectedAmount)) < 1;
      return {
        valid: true,
        amountMatch: amountOk,
        amount: d.amount,
        sender: d.sender?.name || d.sendingBank || "",
        receiver: d.receiver?.name || "",
        transRef: d.transRef || "",
        date: d.transDate || "",
        raw: d
      };
    } else {
      return { valid: false, error: "invalid", message: data.message || "สลิปไม่ถูกต้องหรือเป็นสลิปปลอม" };
    }
  } catch(e) {
    console.warn("SlipOK verify error:", e);
    return { valid: false, error: "network", message: "ตรวจสอบสลิปไม่ได้ — " + e.message };
  }
}

export function renderCustomerDashboard(ctx) {
  const { state, showRoute, showToast } = ctx;
  const container = document.getElementById("page-customer_dashboard");
  if (!container) return;

  const userEmail = state.currentUser?.email || "";
  const userPhone = userEmail.replace("@phone.boonsook.local", "");
  const userName = state.profile?.full_name || userPhone;

  // หาข้อมูลลูกค้า
  const customerRecord = state.customers?.find(c => c.phone === userPhone || c.email === userEmail) || null;
  const customerId = customerRecord?.id;

  // แต้มสะสม
  const myPoints = customerId ? (state.loyaltyPoints || []).filter(p => p.customer_id === customerId) : [];
  const totalPoints = myPoints.reduce((sum, p) => sum + (p.points || 0), 0);

  // ประวัติซื้อ — ดึงจาก service_jobs (ออเดอร์จากลูกค้า) + sales (ขายที่เคาน์เตอร์)
  const myOrders = (state.serviceJobs || []).filter(j =>
    (j.customer_phone === userPhone || j.created_by === state.currentUser?.id) &&
    (j.sub_service || "").includes("สั่งซื้อ") &&
    !(j.note || "").includes("[ลบแล้ว]")
  );
  const mySales = customerId
    ? (state.sales || []).filter(s => s.customer_id === customerId && !(s.note||"").includes("[ลบแล้ว]"))
    : [];

  // ★ สินค้าหน้าลูกค้า = แคตตาล็อกแอร์ (จาก localStorage หรือ JSON ไฟล์) แยกจากสต๊อกในร้าน
  const catalog = (function(){
    // ลอง localStorage ก่อน (admin อัปโหลด CSV ได้)
    try {
      const saved = localStorage.getItem("bsk_ac_catalog");
      if (saved) return JSON.parse(saved);
    } catch(e){}
    // fallback: ใช้ _acCatalog ที่โหลดมาจาก JSON
    return _acCatalog || [];
  })();
  const products = catalog.map(c => ({
    id: c.id || c.model,
    name: `${c.section} ${c.model}`,
    sku: c.model,
    price: c.price,
    stock: c.stock ?? 0,
    btu: c.btu,
    section: c.section,
    w_install: c.w_install,
    w_parts: c.w_parts,
    w_comp: c.w_comp,
    _isCatalog: true
  }));
  const categories = [...new Set(catalog.map(c => c.section))];

  let filteredProducts = products;
  if (_custCategory !== "all") filteredProducts = filteredProducts.filter(p => p.section === _custCategory);
  if (_custSearch) filteredProducts = filteredProducts.filter(p => (p.name||"").toLowerCase().includes(_custSearch.toLowerCase()) || (p.sku||"").toLowerCase().includes(_custSearch.toLowerCase()) || String(p.btu||"").includes(_custSearch));

  const cartCount = _custCart.reduce((s,i) => s + i.qty, 0);
  const cartTotal = _custCart.reduce((s,i) => s + (i.price * i.qty), 0);

  container.innerHTML = `
    <!-- ═══ HEADER ═══ -->
    <div style="background:linear-gradient(135deg,#38bdf8,#0284c7);color:#fff;border-radius:22px;padding:20px;position:relative;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:13px;opacity:.8">สวัสดี</div>
          <div style="font-size:22px;font-weight:900">${escHtml(userName)}</div>
          <div style="font-size:12px;opacity:.7;margin-top:2px">📞 ${escHtml(customerRecord?.phone || userPhone)}</div>
        </div>
        <div style="text-align:center;background:rgba(255,255,255,.2);border-radius:16px;padding:10px 16px">
          <div style="font-size:22px">⭐</div>
          <div style="font-size:18px;font-weight:900">${totalPoints.toLocaleString()}</div>
          <div style="font-size:10px;opacity:.8">แต้ม</div>
        </div>
      </div>
    </div>

    <!-- ═══ TAB NAV ═══ -->
    <div style="display:flex;gap:4px;background:#f1f5f9;border-radius:14px;padding:4px;position:sticky;top:0;z-index:10">
      ${[
        {id:"shop", icon:"🛍️", label:"ร้านค้า"},
        {id:"cart", icon:"🛒", label:"ตะกร้า", badge: cartCount},
        {id:"orders", icon:"📋", label:"ประวัติซื้อ"},
        {id:"points", icon:"⭐", label:"แต้มสะสม"}
      ].map(t => `
        <button class="cust-tab-btn" data-cust-tab="${t.id}" style="flex:1;padding:10px 4px;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;transition:.15s;position:relative;
          background:${_custTab===t.id ? '#0284c7' : 'transparent'};
          color:${_custTab===t.id ? '#fff' : '#64748b'}">
          ${t.icon} ${t.label}
          ${t.badge ? `<span style="position:absolute;top:2px;right:8px;background:#ef4444;color:#fff;font-size:10px;font-weight:900;padding:1px 5px;border-radius:99px;min-width:16px">${t.badge}</span>` : ''}
        </button>
      `).join("")}
    </div>

    <!-- ═══ TAB CONTENT ═══ -->
    <div id="custTabContent"></div>
  `;

  const contentEl = document.getElementById("custTabContent");

  // ═══ RENDER TAB CONTENT ═══
  if (_custTab === "shop") {
    contentEl.innerHTML = `
      <!-- Search -->
      <div style="position:relative">
        <input id="custSearchInput" type="text" placeholder="🔍 ค้นหาสินค้า..." value="${escHtml(_custSearch)}" style="width:100%;padding:12px 16px;border:2px solid #e2e8f0;border-radius:14px;font-size:14px;box-sizing:border-box" />
      </div>

      <!-- Categories (dropdown) -->
      <div style="position:relative">
        <select id="custCatSelect" style="width:100%;padding:12px 40px 12px 16px;border:2px solid #e2e8f0;border-radius:14px;font-size:14px;font-weight:700;color:#0284c7;background:#fff;appearance:none;-webkit-appearance:none;cursor:pointer;box-sizing:border-box">
          <option value="all" ${_custCategory==='all' ? 'selected' : ''}>🌬️ ทั้งหมด (${products.length} รุ่น)</option>
          ${categories.map(c => {
            const count = products.filter(p => p.section === c).length;
            return `<option value="${escHtml(c)}" ${_custCategory===c ? 'selected' : ''}>${escHtml(c)} (${count})</option>`;
          }).join("")}
        </select>
        <div style="position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:14px;color:#94a3b8">▼</div>
      </div>

      <!-- Products Grid -->
      ${filteredProducts.length > 0 ? `
      <div id="custProductGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        ${filteredProducts.map(p => {
          const imgUrl = p.image_url || p.img || "";
          const inCart = _custCart.find(c => c.id === p.id);
          const btuLabel = p.btu ? Number(p.btu).toLocaleString() + ' BTU' : '';
          return `
          <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;transition:.15s;cursor:pointer" data-view-product="${p.id}">
            <div style="height:80px;background:${imgUrl ? `url('${imgUrl}') center/cover` : 'linear-gradient(135deg,#e0f2fe,#bae6fd)'};display:flex;align-items:center;justify-content:center;position:relative">
              ${!imgUrl ? `<span style="font-size:32px">❄️</span>` : ''}
              ${btuLabel ? `<div style="position:absolute;top:6px;right:6px;background:rgba(2,132,199,.9);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px">${btuLabel}</div>` : ''}
            </div>
            <div style="padding:10px">
              <div style="font-size:10px;color:#0284c7;font-weight:700;margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.section || '')}</div>
              <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:4px">${escHtml(p.sku || '')}</div>
              <div style="font-size:17px;font-weight:900;color:#0284c7">${money(p.price)}</div>
              <div style="font-size:10px;color:#10b981;font-weight:600">รวมติดตั้ง</div>
              ${p.w_install || p.w_parts || p.w_comp ? `<div style="font-size:9px;color:#94a3b8;margin-top:2px;line-height:1.3">${[p.w_install ? 'ติดตั้ง ' + p.w_install : '', p.w_parts ? 'อะไหล่ ' + p.w_parts : '', p.w_comp ? 'คอมฯ ' + p.w_comp : ''].filter(Boolean).join(' | ')}</div>` : ''}
              <button data-add-cart="${p.id}" style="width:100%;margin-top:8px;padding:8px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;
                background:${inCart ? '#10b981' : p.stock > 0 ? '#0284c7' : '#f59e0b'};color:#fff">
                ${inCart ? `✓ ในตะกร้า (${inCart.qty})` : p.stock > 0 ? '🛒 เพิ่มลงตะกร้า' : '📞 สั่งจอง'}
              </button>
            </div>
          </div>`;
        }).join("")}
      </div>` : `
      <div id="custProductGrid" style="text-align:center;padding:40px;color:#94a3b8">
        <div style="font-size:48px;margin-bottom:8px">🔍</div>
        <div>ไม่พบสินค้า</div>
      </div>`}
    `;

  } else if (_custTab === "cart") {
    contentEl.innerHTML = `
      ${_custCart.length > 0 ? `
      <div style="display:grid;gap:10px">
        ${_custCart.map(item => `
          <div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px;overflow:hidden;box-sizing:border-box">
            <div style="display:flex;gap:10px;align-items:center">
              <div style="width:44px;height:44px;background:linear-gradient(135deg,#e0f2fe,#bae6fd);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">❄️</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.name)}</div>
                <div style="font-size:12px;color:#0284c7;font-weight:700">${money(item.price)}/เครื่อง</div>
              </div>
              <button data-cart-remove="${item.id}" style="background:none;border:none;font-size:16px;cursor:pointer;color:#ef4444;flex-shrink:0;padding:4px">✕</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid #f1f5f9">
              <div style="display:flex;align-items:center;gap:6px">
                <button data-cart-minus="${item.id}" style="width:32px;height:32px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
                <span style="font-size:16px;font-weight:900;min-width:28px;text-align:center">${item.qty}</span>
                <button data-cart-plus="${item.id}" style="width:32px;height:32px;border-radius:8px;border:none;background:#0284c7;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
              </div>
              <div style="font-size:16px;font-weight:900;color:#0284c7">${money(item.price * item.qty)}</div>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- ═══ ข้อมูลจัดส่ง ═══ -->
      <div style="background:#fff;border-radius:16px;border:2px solid #0284c7;padding:16px;margin-top:8px;box-sizing:border-box;max-width:100%">
        <div style="font-size:15px;font-weight:900;color:#0284c7;margin-bottom:12px">📦 ข้อมูลจัดส่ง</div>
        <div style="display:grid;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">ชื่อผู้รับ *</label>
            <input id="custChkName" type="text" value="${escHtml(customerRecord?.name || userName)}" placeholder="ชื่อ-นามสกุล" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">เบอร์โทร *</label>
            <input id="custChkPhone" type="tel" value="${escHtml(customerRecord?.phone || userPhone)}" placeholder="0xx-xxx-xxxx" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">ที่อยู่จัดส่ง *</label>
            <textarea id="custChkAddress" placeholder="บ้านเลขที่ ซอย ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical;min-height:60px;box-sizing:border-box">${escHtml(customerRecord?.address || "")}</textarea>
          </div>
          <div>
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">หมายเหตุเพิ่มเติม</label>
            <input id="custOrderNote" type="text" placeholder="เช่น ส่งช่วงเย็น, โทรก่อนส่ง..." style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box" />
          </div>
        </div>
      </div>

      <!-- ═══ เลือกวิธีชำระเงิน ═══ -->
      <div style="background:#fff;border-radius:16px;border:2px solid #0284c7;padding:16px;margin-top:8px;box-sizing:border-box;max-width:100%">
        <div style="font-size:15px;font-weight:900;color:#0284c7;margin-bottom:12px">💳 เลือกวิธีชำระเงิน</div>
        <div style="display:grid;gap:8px">
          <label data-pay-opt="transfer" style="display:flex;align-items:center;gap:12px;padding:14px;border:2px solid #0284c7;border-radius:12px;cursor:pointer;background:#eff6ff;transition:.15s">
            <input type="radio" name="custPayMethod" value="transfer" checked style="width:18px;height:18px;accent-color:#0284c7" />
            <div style="flex:1">
              <div style="font-weight:700;font-size:14px;color:#1e40af">🏦 โอนเงิน / QR Code</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">โอนแล้วแนบสลิป — ตรวจสอบอัตโนมัติ</div>
            </div>
          </label>
          <label data-pay-opt="cod_cash" style="display:flex;align-items:center;gap:12px;padding:14px;border:2px solid #e2e8f0;border-radius:12px;cursor:pointer;background:#fff;transition:.15s">
            <input type="radio" name="custPayMethod" value="cod_cash" style="width:18px;height:18px;accent-color:#0284c7" />
            <div style="flex:1">
              <div style="font-weight:700;font-size:14px;color:#1f2937">💵 เก็บเงินปลายทาง (เงินสด)</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">จ่ายเงินสดตอนรับสินค้า</div>
            </div>
          </label>
          <label data-pay-opt="cod_transfer" style="display:flex;align-items:center;gap:12px;padding:14px;border:2px solid #e2e8f0;border-radius:12px;cursor:pointer;background:#fff;transition:.15s">
            <input type="radio" name="custPayMethod" value="cod_transfer" style="width:18px;height:18px;accent-color:#0284c7" />
            <div style="flex:1">
              <div style="font-weight:700;font-size:14px;color:#1f2937">📲 จ่ายหน้างาน (โอน)</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">โอนเงินให้ช่างตอนส่งมอบสินค้า</div>
            </div>
          </label>
        </div>

        <!-- ★ ข้อมูลบัญชีจากตั้งค่าร้าน (แสดงเมื่อเลือก "โอนเงิน") -->
        <div id="custBankInfo" style="margin-top:12px">
          ${(function(){
            const pi = state.paymentInfo || {};
            const banks = pi.banks || [];
            const promptPay = pi.promptPay || "";
            const mainQr = pi.qrImage || "";
            let html = "";

            // ★ QR Code (ถ้ามี)
            if (mainQr || banks.some(b => b.qrImage)) {
              const qrSrc = mainQr || banks.find(b => b.qrImage)?.qrImage || "";
              if (qrSrc) {
                html += '<div style="text-align:center;padding:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:14px;border:1px solid #bfdbfe;margin-bottom:10px">';
                html += '<div style="font-size:14px;font-weight:900;color:#1e40af;margin-bottom:10px">📱 สแกน QR Code เพื่อชำระเงิน</div>';
                html += '<img src="' + escHtml(qrSrc) + '" alt="QR Code" style="max-width:220px;width:100%;border-radius:12px;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.1)" />';
                html += '<div style="font-size:20px;font-weight:900;color:#0284c7;margin-top:10px">' + money(cartTotal) + '</div>';
                html += '<div style="font-size:11px;color:#64748b;margin-top:4px">สแกนจ่ายตามยอดด้านบน</div>';
                html += '</div>';
              }
            }

            // ★ PromptPay
            if (promptPay) {
              html += '<div style="padding:12px;background:#ecfdf5;border-radius:12px;border:1px solid #a7f3d0;margin-bottom:10px;text-align:center">';
              html += '<div style="font-size:13px;font-weight:700;color:#059669;margin-bottom:4px">พร้อมเพย์ PromptPay</div>';
              html += '<div style="font-size:20px;font-weight:900;color:#047857;letter-spacing:2px">' + escHtml(promptPay) + '</div>';
              html += '</div>';
            }

            // ★ บัญชีธนาคาร
            if (banks.length > 0) {
              html += '<div style="display:grid;gap:8px">';
              banks.forEach(function(bank, idx) {
                if (!bank.bankName && !bank.bankAccount) return;
                html += '<div style="padding:12px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;border:1px solid #bfdbfe">';
                html += '<div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:6px">🏦 ' + escHtml(bank.bankName || "ธนาคาร") + '</div>';
                if (bank.bankAccount) html += '<div style="font-size:11px;color:#64748b">เลขบัญชี</div><div style="font-size:18px;font-weight:900;color:#1e3a5f;letter-spacing:1.5px;margin-bottom:4px">' + escHtml(bank.bankAccount) + '</div>';
                if (bank.bankHolder) html += '<div style="font-size:12px;color:#475569">👤 ' + escHtml(bank.bankHolder) + '</div>';
                if (bank.bankBranch) html += '<div style="font-size:11px;color:#94a3b8">สาขา: ' + escHtml(bank.bankBranch) + '</div>';
                if (bank.qrImage) html += '<div style="text-align:center;margin-top:8px"><img src="' + escHtml(bank.qrImage) + '" alt="QR" style="max-width:160px;border-radius:8px;border:2px solid #fff" /></div>';
                html += '</div>';
              });
              html += '</div>';
            }

            // ★ ไม่มีข้อมูลเลย
            if (!html) {
              html = '<div style="padding:14px;background:#fef3c7;border-radius:12px;border:1px solid #fde68a;text-align:center"><div style="font-size:13px;color:#92400e">⚠️ ร้านยังไม่ได้ตั้งค่าข้อมูลบัญชี กรุณาติดต่อร้านโดยตรง</div></div>';
            }

            return html;
          })()}

          <!-- ★ แนบสลิปการโอนเงิน -->
          <div style="margin-top:12px;padding:14px;background:#fff;border-radius:14px;border:2px dashed #0284c7">
            <div style="font-size:14px;font-weight:900;color:#0284c7;margin-bottom:8px;text-align:center">📸 แนบสลิปการโอนเงิน</div>
            <input type="file" id="custSlipFileInput" accept="image/*" style="display:none" />
            <div id="custSlipPreview" style="text-align:center;margin-bottom:8px"></div>
            <button id="custSlipUploadBtn" style="width:100%;padding:12px;background:linear-gradient(135deg,#e0f2fe,#bae6fd);color:#0284c7;border:2px solid #0284c7;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">
              📷 เลือกรูปสลิป
            </button>
            <div id="custSlipStatus" style="margin-top:8px;font-size:12px;color:#64748b;text-align:center"></div>
          </div>
        </div>
      </div>

      <!-- ═══ ยอดรวม + สั่งซื้อ ═══ -->
      <div style="background:#fff;border-radius:16px;border:2px solid #10b981;padding:16px;margin-top:8px;box-sizing:border-box;max-width:100%">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:15px;font-weight:700;color:#64748b">รวมทั้งหมด (${cartCount} ชิ้น)</span>
          <span style="font-size:24px;font-weight:900;color:#0284c7">${money(cartTotal)}</span>
        </div>
        <div id="custPaySummary" style="font-size:13px;color:#059669;font-weight:700;margin-bottom:10px;padding:8px 12px;background:#ecfdf5;border-radius:8px;text-align:center">
          🏦 ชำระโดย: โอนเงิน / QR Code
        </div>
        <button id="custCheckoutBtn" style="width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:900;cursor:pointer;letter-spacing:1px">
          🛒 ยืนยันสั่งซื้อ
        </button>
      </div>

      <button id="custClearCartBtn" style="width:100%;padding:10px;background:none;border:1px solid #fca5a5;border-radius:10px;color:#ef4444;font-size:13px;cursor:pointer;margin-top:6px">ล้างตะกร้า</button>
      ` : `
      <div style="text-align:center;padding:60px 20px;color:#94a3b8">
        <div style="font-size:64px;margin-bottom:12px">🛒</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">ตะกร้าว่าง</div>
        <div>เลือกสินค้าจากร้านค้าได้เลย</div>
        <button class="cust-tab-btn" data-cust-tab="shop" style="margin-top:16px;padding:12px 24px;background:#0284c7;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">🛍️ ไปร้านค้า</button>
      </div>`}
    `;

  } else if (_custTab === "orders") {
    const hasOrders = myOrders.length > 0 || mySales.length > 0;
    contentEl.innerHTML = `
      <h3 style="margin:0;color:#0284c7;font-size:16px">📋 ประวัติการสั่งซื้อ</h3>
      ${hasOrders ? `
      <div style="display:grid;gap:10px">
        ${myOrders.map(j => {
          const statusMap = { pending:"🟡 รอดำเนินการ", progress:"🔵 กำลังดำเนินการ", in_progress:"🔵 กำลังดำเนินการ", done:"🟢 เสร็จแล้ว", delivered:"🟣 ส่งมอบแล้ว", cancelled:"🔴 ยกเลิก" };
          const statusBg  = { pending:"#fef3c7", progress:"#dbeafe", in_progress:"#dbeafe", done:"#dcfce7", delivered:"#e0e7ff", cancelled:"#fee2e2" };
          const statusLabel = statusMap[j.status] || j.status || "—";
          const bgColor = statusBg[j.status] || "#f1f5f9";
          const itemLines = ((j.description||"").match(/• .+/g) || []).map(l => l.replace(/^• /, ""));
          // ★ ดึงวิธีชำระจาก note (format: SH-transfer|xxx หรือ SH-cod_cash|xxx)
          const notePayMatch = (j.note || "").match(/^SH-(transfer|cod_cash|cod_transfer)/);
          const payMethodIcons = { transfer: "🏦 โอนเงิน", cod_cash: "💵 เงินสด", cod_transfer: "📲 โอนหน้างาน" };
          const payDisplay = notePayMatch ? payMethodIcons[notePayMatch[1]] || "" : "";
          return `
          <div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden">
            <div style="padding:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div style="font-weight:700;font-size:13px">🛒 ${escHtml(j.job_no)}</div>
                <div style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${bgColor}">${statusLabel}</div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:12px;color:#94a3b8">${new Date(j.created_at).toLocaleString("th-TH")}</div>
                ${payDisplay ? `<div style="font-size:11px;font-weight:700;color:#1e40af;padding:2px 8px;border-radius:99px;background:#dbeafe">${payDisplay}</div>` : ''}
              </div>
              ${itemLines.length > 0 ? `<div style="display:grid;gap:2px">${itemLines.map(line => `<div style="font-size:13px;color:#374151;padding:3px 0;border-bottom:1px solid #f1f5f9">📦 ${escHtml(line)}</div>`).join("")}</div>` : ''}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f0f9ff;border-top:1px solid #e0f2fe">
              <span style="font-size:13px;color:#64748b">รวมทั้งหมด</span>
              <span style="font-size:18px;font-weight:900;color:#0284c7">${money(j.total_cost)}</span>
            </div>
          </div>`;
        }).join("")}
        ${mySales.map(s => {
          let items = [];
          try { items = typeof s.items === "string" ? JSON.parse(s.items) : (s.items || []); } catch(e){}
          return `
          <div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-weight:700;font-size:13px">🧾 ${escHtml(s.order_no)}</div>
              <div style="font-weight:900;color:#0284c7">${money(s.total_amount)}</div>
            </div>
            <div style="font-size:12px;color:#94a3b8">${new Date(s.created_at).toLocaleString("th-TH")}</div>
            ${items.length > 0 ? `<div style="margin-top:8px;font-size:12px;color:#64748b">${items.map(i => `${escHtml(i.name||i.product_name||"สินค้า")} x${i.qty||1}`).join(", ")}</div>` : ''}
          </div>`;
        }).join("")}
      </div>` : `
      <div style="text-align:center;padding:40px;color:#94a3b8">
        <div style="font-size:48px;margin-bottom:8px">📋</div>
        <div>ยังไม่มีประวัติการสั่งซื้อ</div>
      </div>`}
    `;

  } else if (_custTab === "points") {
    contentEl.innerHTML = `
      <div style="text-align:center;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:20px;padding:24px">
        <div style="font-size:14px;color:#92400e">แต้มสะสมรวม</div>
        <div style="font-size:40px;font-weight:900;color:#b45309;margin-top:4px">${totalPoints.toLocaleString()}</div>
        <div style="font-size:13px;color:#92400e;margin-top:4px">แต้ม</div>
      </div>
      ${myPoints.length > 0 ? `
      <div style="display:grid;gap:6px">
        ${myPoints.slice(0,20).map(p => {
          const isEarn = p.points > 0;
          return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff;border-radius:12px;border:1px solid #e2e8f0">
            <div>
              <div style="font-weight:600;font-size:13px">${escHtml(p.note || (isEarn ? "ได้รับแต้ม" : "ใช้แต้ม"))}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">${new Date(p.created_at).toLocaleDateString("th-TH")}</div>
            </div>
            <div style="font-weight:900;font-size:16px;color:${isEarn ? '#10b981' : '#ef4444'}">${isEarn ? '+' : ''}${p.points}</div>
          </div>`;
        }).join("")}
      </div>` : `
      <div style="text-align:center;padding:40px;color:#94a3b8">
        <div style="font-size:48px;margin-bottom:8px">⭐</div>
        <div>ยังไม่มีประวัติแต้ม</div>
      </div>`}
    `;
  }

  // ═══ EVENT BINDINGS ═══

  // Tab switching
  container.querySelectorAll("[data-cust-tab]").forEach(btn => btn.addEventListener("click", () => {
    _custTab = btn.dataset.custTab;
    renderCustomerDashboard(ctx);
  }));

  // Category filter (dropdown)
  container.querySelector("#custCatSelect")?.addEventListener("change", (e) => {
    _custCategory = e.target.value;
    renderCustomerDashboard(ctx);
  });

  // Search (★ render แค่ product grid ไม่ re-render ทั้งหน้า เพื่อไม่ให้ input หลุด focus)
  container.querySelector("#custSearchInput")?.addEventListener("input", (e) => {
    _custSearch = e.target.value;
    clearTimeout(window._custSearchTimer);
    window._custSearchTimer = setTimeout(() => {
      let fp = products;
      if (_custCategory !== "all") fp = fp.filter(p => p.section === _custCategory);
      if (_custSearch) fp = fp.filter(p => (p.name||"").toLowerCase().includes(_custSearch.toLowerCase()) || (p.sku||"").toLowerCase().includes(_custSearch.toLowerCase()) || String(p.btu||"").includes(_custSearch));

      const gridEl = container.querySelector("#custProductGrid");
      if (gridEl) {
        gridEl.innerHTML = fp.length > 0 ? fp.map(p => {
          const imgUrl = p.image_url || p.img || "";
          const inCart = _custCart.find(c => c.id === p.id);
          const btuLabel = p.btu ? Number(p.btu).toLocaleString() + ' BTU' : '';
          return `
          <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;transition:.15s;cursor:pointer" data-view-product="${p.id}">
            <div style="height:80px;background:${imgUrl ? `url('${imgUrl}') center/cover` : 'linear-gradient(135deg,#e0f2fe,#bae6fd)'};display:flex;align-items:center;justify-content:center;position:relative">
              ${!imgUrl ? `<span style="font-size:32px">❄️</span>` : ''}
              ${btuLabel ? `<div style="position:absolute;top:6px;right:6px;background:rgba(2,132,199,.9);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px">${btuLabel}</div>` : ''}
            </div>
            <div style="padding:10px">
              <div style="font-size:10px;color:#0284c7;font-weight:700;margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.section || '')}</div>
              <div style="font-size:14px;font-weight:900;color:#1f2937;margin-bottom:4px">${escHtml(p.sku || '')}</div>
              <div style="font-size:17px;font-weight:900;color:#0284c7">${money(p.price)}</div>
              <div style="font-size:10px;color:#10b981;font-weight:600">รวมติดตั้ง</div>
              ${p.w_install || p.w_parts || p.w_comp ? `<div style="font-size:9px;color:#94a3b8;margin-top:2px;line-height:1.3">${[p.w_install ? 'ติดตั้ง ' + p.w_install : '', p.w_parts ? 'อะไหล่ ' + p.w_parts : '', p.w_comp ? 'คอมฯ ' + p.w_comp : ''].filter(Boolean).join(' | ')}</div>` : ''}
              <button data-add-cart="${p.id}" style="width:100%;margin-top:8px;padding:8px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;
                background:${inCart ? '#10b981' : p.stock > 0 ? '#0284c7' : '#f59e0b'};color:#fff">
                ${inCart ? `✓ ในตะกร้า (${inCart.qty})` : p.stock > 0 ? '🛒 เพิ่มลงตะกร้า' : '📞 สั่งจอง'}
              </button>
            </div>
          </div>`;
        }).join("") : `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#94a3b8"><div style="font-size:48px;margin-bottom:8px">🔍</div><div>ไม่พบสินค้า</div></div>`;
        // rebind add-to-cart
        gridEl.querySelectorAll("[data-add-cart]").forEach(btn => btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const pid = Number(btn.dataset.addCart);
          const product = products.find(pp => pp.id === pid);
          if (!product) return;
          const existing = _custCart.find(c => c.id === pid);
          if (existing) { existing.qty++; } else { _custCart.push({ id: pid, name: product.name, price: Number(product.price||0), qty: 1 }); }
          saveCustCart();
          if (showToast) showToast(`เพิ่ม "${product.name}" ลงตะกร้า 🛒`);
          renderCustomerDashboard(ctx);
        }));
      }
    }, 200);
  });

  // Add to cart
  container.querySelectorAll("[data-add-cart]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pid = Number(btn.dataset.addCart);
    const product = products.find(p => p.id === pid);
    if (!product) return;

    const existing = _custCart.find(c => c.id === pid);
    if (existing) {
      if (existing.qty < Number(product.stock || 99)) {
        existing.qty++;
      } else {
        return showToast("สินค้าหมดสต็อก");
      }
    } else {
      _custCart.push({ id: pid, name: product.name, price: Number(product.price || 0), qty: 1 });
    }
    saveCustCart();
    if (showToast) showToast(`เพิ่ม "${product.name}" ลงตะกร้า 🛒`);
    renderCustomerDashboard(ctx);
  }));

  // Cart +/-/remove
  container.querySelectorAll("[data-cart-plus]").forEach(btn => btn.addEventListener("click", () => {
    const item = _custCart.find(c => c.id === Number(btn.dataset.cartPlus));
    if (item) { item.qty++; saveCustCart(); renderCustomerDashboard(ctx); }
  }));
  container.querySelectorAll("[data-cart-minus]").forEach(btn => btn.addEventListener("click", () => {
    const idx = _custCart.findIndex(c => c.id === Number(btn.dataset.cartMinus));
    if (idx >= 0) {
      _custCart[idx].qty--;
      if (_custCart[idx].qty <= 0) _custCart.splice(idx, 1);
      saveCustCart(); renderCustomerDashboard(ctx);
    }
  }));
  container.querySelectorAll("[data-cart-remove]").forEach(btn => btn.addEventListener("click", () => {
    _custCart = _custCart.filter(c => c.id !== Number(btn.dataset.cartRemove));
    saveCustCart(); renderCustomerDashboard(ctx);
  }));

  // Clear cart
  container.querySelector("#custClearCartBtn")?.addEventListener("click", () => {
    if (!confirm("ล้างตะกร้าทั้งหมด?")) return;
    _custCart = []; saveCustCart(); renderCustomerDashboard(ctx);
  });

  // ★ Payment method selection UI
  const payLabels = { transfer: "🏦 โอนเงิน / QR Code", cod_cash: "💵 เก็บเงินปลายทาง (เงินสด)", cod_transfer: "📲 จ่ายหน้างาน (โอน)" };
  container.querySelectorAll("input[name='custPayMethod']").forEach(radio => {
    radio.addEventListener("change", () => {
      const val = radio.value;
      container.querySelectorAll("[data-pay-opt]").forEach(label => {
        const isSelected = label.dataset.payOpt === val;
        label.style.border = isSelected ? "2px solid #0284c7" : "2px solid #e2e8f0";
        label.style.background = isSelected ? "#eff6ff" : "#fff";
      });
      const bankInfo = container.querySelector("#custBankInfo");
      if (bankInfo) bankInfo.style.display = val === "transfer" ? "block" : "none";
      const paySummary = container.querySelector("#custPaySummary");
      if (paySummary) paySummary.innerHTML = `${val === "transfer" ? "🏦" : "💵"} ชำระโดย: ${payLabels[val] || val}`;
      // ★ อัปเดตปุ่มยืนยัน
      const chkBtn = container.querySelector("#custCheckoutBtn");
      if (chkBtn) {
        if (val === "transfer" && !_custSlipData) {
          chkBtn.style.background = "linear-gradient(135deg,#94a3b8,#64748b)";
          chkBtn.textContent = "📸 กรุณาแนบสลิปก่อนยืนยัน";
        } else {
          chkBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
          chkBtn.textContent = "🛒 ยืนยันสั่งซื้อ";
        }
      }
    });
  });

  // ★ Slip upload — แก้ไขให้ทำงานได้ดี
  // ใช้ setTimeout เพื่อให้ DOM render เสร็จก่อน
  setTimeout(() => {
    const uploadBtn = container.querySelector("#custSlipUploadBtn");
    const fileInput = container.querySelector("#custSlipFileInput");

    if (!uploadBtn) {
      console.warn("[customer_dashboard] #custSlipUploadBtn not found");
      return;
    }
    if (!fileInput) {
      console.warn("[customer_dashboard] #custSlipFileInput not found");
      return;
    }

    // ลบ event listener เก่า (ถ้ามี) ก่อนเพิ่มใหม่
    const newUploadBtn = uploadBtn.cloneNode(true);
    uploadBtn.parentNode.replaceChild(newUploadBtn, uploadBtn);

    // attach listener ใหม่
    newUploadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("[customer_dashboard] Upload button clicked");
      try {
        const inp = container.querySelector("#custSlipFileInput");
        if (inp) {
          inp.click();
          console.log("[customer_dashboard] File input clicked successfully");
        } else {
          console.error("[customer_dashboard] File input not found when clicking upload button");
          showToast("❌ เกิดข้อผิดพลาด: ไม่พบ file input");
        }
      } catch(err) {
        console.error("[customer_dashboard] Error clicking file input:", err);
        showToast("❌ เกิดข้อผิดพลาดในการเปิด: " + err.message);
      }
    });
  }, 100);

  // File input change handler
  setTimeout(() => {
    const fileInput = container.querySelector("#custSlipFileInput");
    if (!fileInput) {
      console.warn("[customer_dashboard] File input not found for change listener");
      return;
    }

    fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("กรุณาเลือกไฟล์รูปภาพ");
    if (file.size > 10 * 1024 * 1024) return showToast("ไฟล์ใหญ่เกิน 10MB");

    const statusEl = container.querySelector("#custSlipStatus");
    if (statusEl) statusEl.innerHTML = '<span style="color:#0284c7">กำลังอ่านไฟล์...</span>';

    const reader = new FileReader();
    reader.onload = (ev) => {
      _custSlipData = ev.target.result;
      _custSlipVerified = false;
      _custSlipResult = null;
      console.log("[customer_dashboard] File loaded successfully, size:", _custSlipData.length);

      // แสดง preview
      const previewEl = container.querySelector("#custSlipPreview");
      if (previewEl) {
        previewEl.innerHTML = `
          <div style="position:relative;display:inline-block;margin-bottom:8px">
            <img src="${_custSlipData}" alt="สลิป" style="max-width:100%;max-height:280px;border-radius:12px;border:2px solid #0284c7;box-shadow:0 2px 12px rgba(0,0,0,.1)" />
            <button id="custSlipRemoveBtn" style="position:absolute;top:-8px;right:-8px;width:28px;height:28px;border-radius:50%;background:#ef4444;color:#fff;border:2px solid #fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2)">✕</button>
          </div>`;
        previewEl.querySelector("#custSlipRemoveBtn")?.addEventListener("click", () => {
          _custSlipData = null; _custSlipVerified = false; _custSlipResult = null;
          previewEl.innerHTML = "";
          if (statusEl) statusEl.innerHTML = "";
          const uploadBtn = container.querySelector("#custSlipUploadBtn");
          if (uploadBtn) uploadBtn.innerHTML = "📷 เลือกรูปสลิป";
          // reset checkout button
          const chkBtn = container.querySelector("#custCheckoutBtn");
          if (chkBtn) { chkBtn.style.background = "linear-gradient(135deg,#94a3b8,#64748b)"; chkBtn.textContent = "📸 กรุณาแนบสลิปก่อนยืนยัน"; }
        });
      }

      // เปลี่ยนปุ่ม upload
      const uploadBtn = container.querySelector("#custSlipUploadBtn");
      if (uploadBtn) uploadBtn.innerHTML = "🔄 เปลี่ยนรูปสลิป";

      // ★ ตรวจสอบสลิปอัตโนมัติ (SlipOK API)
      if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">🔍 กำลังตรวจสอบสลิป...</span>';
      _verifySlip(_custSlipData, cartTotal).then(result => {
        _custSlipResult = result;
        _custSlipVerified = result.valid;
        if (statusEl) {
          if (result.valid) {
            statusEl.innerHTML = '<span style="color:#10b981;font-weight:700">✅ สลิปถูกต้อง' + (result.amount ? ' — ยอด ' + money(result.amount) : '') + (result.sender ? ' จาก ' + escHtml(result.sender) : '') + '</span>';
          } else if (result.error === "no_api") {
            _custSlipVerified = true; // ถ้าไม่มี API key ให้ผ่านเลย (ร้านยืนยันเอง)
            statusEl.innerHTML = '<span style="color:#f59e0b">📋 แนบสลิปแล้ว — ร้านจะตรวจสอบอีกครั้ง</span>';
          } else {
            statusEl.innerHTML = '<span style="color:#ef4444">❌ ' + escHtml(result.message || "ตรวจสอบสลิปไม่ผ่าน") + '</span>';
          }
        }
        // อัปเดตปุ่มยืนยัน
        const chkBtn = container.querySelector("#custCheckoutBtn");
        if (chkBtn && _custSlipVerified) {
          chkBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
          chkBtn.textContent = "🛒 ยืนยันสั่งซื้อ";
        }
      }).catch(err => {
        console.error("[customer_dashboard] Slip verification error:", err);
        if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">📋 แนบสลิปแล้ว — ร้านจะตรวจสอบอีกครั้ง</span>';
        _custSlipVerified = true; // ให้ผ่านได้ถ้า API error
      });
    };
    reader.onerror = (err) => {
      console.error("[customer_dashboard] FileReader error:", err);
      showToast("❌ เกิดข้อผิดพลาดในการอ่านไฟล์");
    };
    try {
      reader.readAsDataURL(file);
      console.log("[customer_dashboard] Reading file...");
    } catch(err) {
      console.error("[customer_dashboard] Error reading file:", err);
      showToast("❌ ไม่สามารถอ่านไฟล์ได้");
    }
    });
  }, 100);

  // Checkout
  container.querySelector("#custCheckoutBtn")?.addEventListener("click", async () => {
    if (_custCart.length === 0) return showToast("ตะกร้าว่าง");

    // ★ อ่านค่าจากฟอร์มข้อมูลจัดส่ง
    const chkName    = (container.querySelector("#custChkName")?.value || "").trim();
    const chkPhone   = (container.querySelector("#custChkPhone")?.value || "").trim();
    const chkAddress = (container.querySelector("#custChkAddress")?.value || "").trim();
    const chkNote    = (container.querySelector("#custOrderNote")?.value || "").trim();
    const payMethod  = container.querySelector("input[name='custPayMethod']:checked")?.value || "transfer";

    // Validate
    if (!chkName)    return showToast("กรุณากรอกชื่อผู้รับ");
    if (!chkPhone)   return showToast("กรุณากรอกเบอร์โทร");
    if (!chkAddress) return showToast("กรุณากรอกที่อยู่จัดส่ง");
    if (payMethod === "transfer" && !_custSlipData) return showToast("กรุณาแนบสลิปการโอนเงินก่อนยืนยัน 📸");

    const orderItems = _custCart.map(c => ({
      product_id: c.id,
      name: c.name,
      price: c.price,
      qty: c.qty,
      total: c.price * c.qty
    }));

    const orderNo = "BSK-" + Date.now();
    const totalAmount = _custCart.reduce((s,i) => s + (i.price * i.qty), 0);

    // สร้าง service_job (ออเดอร์จากลูกค้า)
    try {
      const btn = container.querySelector("#custCheckoutBtn");
      if (btn) { btn.disabled = true; btn.textContent = "กำลังสั่งซื้อ..."; }

      const payLabelsMap = { transfer: "โอนเงิน/QR", cod_cash: "เก็บเงินปลายทาง(สด)", cod_transfer: "จ่ายหน้างาน(โอน)" };
      const payLabel = payLabelsMap[payMethod] || payMethod;

      // ★ Upload สลิปไป Supabase Storage ก่อน insert (ป้องกันสลิปหาย)
      if (payMethod === "transfer" && _custSlipData) {
        const btn2 = container.querySelector("#custCheckoutBtn");
        if (btn2) btn2.textContent = "กำลังอัปโหลดสลิป...";
        _custSlipUrl = await _uploadSlipToStorage(_custSlipData, state);
      }

      const jobPayload = {
        job_no: orderNo,
        customer_name: chkName,
        customer_phone: chkPhone,
        customer_address: chkAddress,
        job_type: "ac",
        sub_service: "🛒 สั่งซื้อสินค้า",
        status: "pending",
        total_cost: totalAmount,
        description: `📱 สั่งซื้อผ่านเว็บ\n👤 ${chkName}\n📞 ${chkPhone}\n📍 ${chkAddress}\n💳 ชำระ: ${payLabel}${payMethod === "transfer" && _custSlipResult ? `\n🧾 สลิป: ${_custSlipVerified ? "✅ ตรวจแล้ว" : "⏳ รอตรวจ"}${_custSlipResult.transRef ? " Ref:" + _custSlipResult.transRef : ""}${_custSlipResult.amount ? " ยอด:" + _custSlipResult.amount : ""}${_custSlipResult.sender ? " จาก:" + _custSlipResult.sender : ""}` : ""}${_custSlipUrl ? `\n🔗 สลิป: ${_custSlipUrl}` : ""}\n${chkNote ? `📝 ${chkNote}` : ""}\n\n🛒 รายการ:\n${orderItems.map(i => `• ${i.name} x${i.qty} = ${money(i.total)}`).join("\n")}\n\n💰 รวม: ${money(totalAmount)}`,
        note: `SH-${payMethod}|${_custSlipVerified ? "SLIP_OK" : _custSlipData ? "SLIP_PENDING" : ""}|${chkNote || "สั่งซื้อจากลูกค้า " + chkName}${_custSlipUrl ? "|SLIP_URL:" + _custSlipUrl : ""}`,
        created_by: state.currentUser?.id || null
      };

      // ★ Validate payload ก่อนส่ง — ป้องกัน 400 error
      if (!jobPayload.job_no || !jobPayload.customer_name || !jobPayload.customer_phone) {
        throw new Error("ข้อมูลไม่ครบ กรุณากรอกชื่อ เบอร์โทร และที่อยู่");
      }
      if (typeof jobPayload.total_cost !== 'number' || jobPayload.total_cost <= 0) {
        jobPayload.total_cost = Number(jobPayload.total_cost) || 0;
        if (jobPayload.total_cost <= 0) throw new Error("ยอดรวมต้องมากกว่า 0");
      }

      let success = false;

      // วิธีที่ 1: fetch REST API โดยตรง (เหมือน service_request.js ที่ทำงานได้)
      try {
        const cfg = window.SUPABASE_CONFIG;
        const token = (await state.supabase?.auth?.getSession?.())?.data?.session?.access_token;
        if (cfg?.url && cfg?.anonKey && token) {
          const resp = await fetch(`${cfg.url}/rest/v1/service_jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Prefer": "return=minimal" },
            body: JSON.stringify(jobPayload)
          });
          if (resp.ok) success = true;
          else console.warn("REST POST failed:", resp.status, await resp.text().catch(()=>""));
        }
      } catch(fetchErr) { console.warn("Fetch insert error:", fetchErr); }

      // วิธีที่ 2: Supabase JS client fallback (ไม่ใช้ .select() เพราะ RLS อาจบล็อค)
      if (!success && state.supabase) {
        const { error } = await state.supabase.from("service_jobs").insert([jobPayload]);
        if (!error) success = true;
        else console.warn("Supabase insert failed:", error?.message);
      }

      // วิธีที่ 3: XHR POST fallback
      if (!success && window._appXhrPost) {
        const res = await window._appXhrPost("service_jobs", jobPayload);
        if (res?.ok) success = true;
        else console.warn("XHR POST failed:", res?.error?.message);
      }

      if (!success) throw new Error("ไม่สามารถสร้างออเดอร์ได้ — กรุณาลองอีกครั้ง");

      // ★ ส่ง LINE แจ้งร้าน
      if (typeof window.shareViaLINE === "function") {
        const msg = `🛒 ออเดอร์ใหม่!\n${orderNo}\n👤 ${chkName}\n📞 ${chkPhone}\n📍 ${chkAddress}\n💳 ${payLabel}\n\n${orderItems.map(i => `• ${i.name} x${i.qty}`).join("\n")}\n\n💰 รวม: ${money(totalAmount)}${chkNote ? `\n📝 ${chkNote}` : ""}`;
        window.shareViaLINE(msg);
      }

      _custCart = [];
      saveCustCart();
      _custSlipData = null; _custSlipVerified = false; _custSlipResult = null; _custSlipUrl = null;

      // ★ แสดงหน้ายืนยันตามวิธีชำระเงิน
      if (payMethod === "transfer") {
        showToast(_custSlipVerified ? "สั่งซื้อสำเร็จ! 🎉 สลิปตรวจแล้ว" : "สั่งซื้อสำเร็จ! 🎉 ร้านจะตรวจสลิปอีกครั้ง");
      } else {
        showToast("สั่งซื้อสำเร็จ! 🎉 ร้านค้าจะติดต่อกลับเร็วๆ นี้");
      }
      _custTab = "orders";
      // Reload data
      if (ctx.loadAllData) await ctx.loadAllData();
      else renderCustomerDashboard(ctx);

    } catch(e) {
      // Improved error handling with better user messages
      let errorMsg = e?.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
      // Show validation errors directly, wrap other errors
      if (e?.message?.includes("ข้อมูลไม่ครบ") || e?.message?.includes("ยอดรวม")) {
        showToast("❌ " + errorMsg);
      } else {
        showToast("❌ สั่งซื้อไม่สำเร็จ: " + errorMsg);
      }
      const btn = container.querySelector("#custCheckoutBtn");
      if (btn) { btn.disabled = false; btn.textContent = "🛒 ยืนยันสั่งซื้อ"; }
      console.error("Checkout error:", e);
    }
  });
}
