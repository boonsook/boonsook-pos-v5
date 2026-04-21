// ═══════════════════════════════════════════════════════════
//  SERVICE REQUEST — ลูกค้าแจ้งซ่อม/บริการเอง
// ═══════════════════════════════════════════════════════════

const SERVICE_TYPES = [
  "🔧 ซ่อมแอร์",
  "🚿 ล้างแอร์",
  "🚚 ย้ายแอร์",
  "❄️ ติดตั้งแอร์",
  "📡 จานดาวเทียม",
  "❄️ ซ่อมตู้เย็น",
  "👕 ซ่อมเครื่องซักผ้า",
  "📹 ติดตั้ง/ซ่อมกล้อง CCTV",
  "📺 ซ่อมทีวี LED/LCD",
  "🛠️ งานบริการอื่นๆ"
];

export function renderServiceRequestPage(ctx) {
  const { state, showToast } = ctx;
  const container = document.getElementById("page-service_request");
  if (!container) return;

  const userEmail = state.currentUser?.email || "";
  const userName = state.profile?.full_name || userEmail;
  const customerRecord = state.customers?.find(c => c.email === userEmail) || null;
  const customerPhone = customerRecord?.phone || "";

  const escHtml = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const typeOptions = SERVICE_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("");

  container.innerHTML = `
    <div style="background:linear-gradient(135deg,#38bdf8,#0284c7);color:#fff;border-radius:22px;padding:20px">
      <div style="font-size:14px;opacity:.85">👤 สวัสดีคุณ</div>
      <div style="font-size:22px;font-weight:900">${escHtml(userName)}</div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">📞 ${escHtml(customerPhone)} &nbsp;|&nbsp; ✉️ ${escHtml(userEmail)}</div>
    </div>

    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:12px">🛠️ แจ้งซ่อม / บริการ</h3>

      <label class="set-field-label">ประเภทงาน</label>
      <select id="srType">${typeOptions}</select>

      <div id="srCustomTypeWrap" class="hidden" style="margin-top:8px">
        <label class="set-field-label">ระบุประเภทงาน</label>
        <input type="text" id="srCustomType" placeholder="เช่น ติดตั้งพัดลม, ซ่อมปั๊มน้ำ..." />
      </div>

      <label class="set-field-label" style="margin-top:12px">📍 ที่อยู่</label>
      <textarea id="srAddress" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" rows="2" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical">${escHtml(customerRecord?.address || "")}</textarea>

      <label class="set-field-label" style="margin-top:12px">⚡ อาการเสีย / รายละเอียด</label>
      <textarea id="srSymptom" placeholder="อธิบายอาการเสีย หรือรายละเอียดงานที่ต้องการ..." rows="4" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical"></textarea>

      <label class="set-field-label" style="margin-top:12px">📌 หมายเหตุ (ถ้ามี)</label>
      <input type="text" id="srNote" placeholder="เช่น วันเวลาที่สะดวก, รุ่นเครื่อง..." />
    </div>

    <button id="srSubmitBtn" class="set-save-btn" style="background:var(--success);box-shadow:0 8px 24px rgba(5,150,105,.25)">📨 ส่งคำแจ้งซ่อม</button>

    <div id="srStatus" class="hidden panel mt16"></div>
  `;

  // Toggle custom type
  const typeSelect = container.querySelector("#srType");
  const customWrap = container.querySelector("#srCustomTypeWrap");
  typeSelect.addEventListener("change", () => {
    customWrap.classList.toggle("hidden", !typeSelect.value.includes("อื่นๆ"));
  });

  // ★ Map ประเภทงาน (text) → canonical job_type key ที่ dashboard/service_jobs ใช้
  //   ค่า canonical: ac | solar | cctv | other  (ดู modules/service_jobs.js JOB_TYPE_LABELS)
  function resolveJobType(typeText) {
    const t = String(typeText || "").toLowerCase();
    if (t.includes("แอร์")) return "ac";
    if (t.includes("cctv") || t.includes("กล้อง")) return "cctv";
    if (t.includes("โซล่า") || t.includes("solar")) return "solar";
    return "other";
  }

  // Submit
  container.querySelector("#srSubmitBtn").addEventListener("click", async () => {
    const typeVal = typeSelect.value.includes("อื่นๆ")
      ? (container.querySelector("#srCustomType").value.trim() || typeSelect.value)
      : typeSelect.value;
    const address = container.querySelector("#srAddress").value.trim();
    const symptom = container.querySelector("#srSymptom").value.trim();
    const note = container.querySelector("#srNote").value.trim();

    if (!symptom) return showToast("กรุณากรอกอาการเสีย/รายละเอียด");

    const statusEl = container.querySelector("#srStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "กำลังส่งคำแจ้งซ่อม...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = (await state.supabase.auth.getSession())?.data?.session?.access_token || cfg.anonKey;

      const record = {
        customer_name: userName,
        customer_phone: customerPhone,
        job_type: resolveJobType(typeVal),
        device_name: typeVal,
        description: symptom,
        address: address,
        note: note,
        status: "pending",
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

      statusEl.innerHTML = `<div style="text-align:center;padding:8px">
        <div style="font-size:40px">✅</div>
        <div style="font-weight:700;color:var(--success);margin-top:8px">แจ้งซ่อมสำเร็จ!</div>
        <div class="sku">ทางร้านจะติดต่อกลับเร็วๆ นี้ครับ</div>
      </div>`;
      showToast("แจ้งซ่อมสำเร็จ!");

      // Reset form
      container.querySelector("#srSymptom").value = "";
      container.querySelector("#srNote").value = "";

      // Send LINE notify if available — ใช้ endpoint /api/line-notify (server-side token)
      if (typeof ctx.sendLineNotify === "function") {
        ctx.sendLineNotify(
          `✍️ ลูกค้าแจ้งซ่อม!\n🔧 ${typeVal}\n👤 ${userName} | 📞 ${customerPhone}\n📍 ${address || "-"}\n⚡ ${symptom.substring(0, 120)}`,
          { state, showToast }
        );
      }
    } catch (e) {
      statusEl.textContent = "เกิดข้