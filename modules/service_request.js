// ═══════════════════════════════════════════════════════════
//  SERVICE REQUEST — ลูกค้าแจ้งซ่อม/บริการเอง
// ═══════════════════════════════════════════════════════════
// Phase 347: รับ "คำขอจอง" จากแคตตาล็อกแอร์ (หน้าร้าน) มา prefill — user ต้องกดส่งเอง
import { consumeAirBookingDrafts } from "./ac_booking_draft.js";
import { describeLineResult } from "./line_notify.js";

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

  // ★ Phase 347/349: consume booking draft จากแคตตาล็อกแอร์ (อ่านครั้งเดียวแล้วลบ — กันเติมซ้ำตอน reload)
  let _booking = null;
  try { const ds = consumeAirBookingDrafts(); if (ds && ds.length) _booking = ds[ds.length - 1]; }
  catch (e) { console.warn("[service_request] booking draft consume failed:", e); }

  // ★ Phase 349: intent-aware UI (booking = สั่งจอง, อื่น = สอบถามราคา) + ราคาเสนอ/ต้องเช็คราคา
  const _isBooking = !!_booking;
  const _isAsk = _booking && _booking.intent !== "booking"; // price_inquiry / ask_price
  const _heading = !_isBooking ? "🛠️ แจ้งซ่อม / บริการ"
    : _isAsk ? "💬 สอบถามราคาแอร์" : "📅 สั่งจอง / แจ้งติดตั้งแอร์";
  const _submitLabel = !_isBooking ? "📨 ส่งคำแจ้งซ่อม"
    : _isAsk ? "📨 ส่งคำขอสอบถามราคา" : "📨 ส่งคำขอจอง / แจ้งงาน";
  const _priceTxt = _booking
    ? (Number(_booking.offerPrice) > 0 ? `฿${Number(_booking.offerPrice).toLocaleString()} (ราคาเสนอ)` : "ต้องเช็คราคา")
    : "";

  const typeOptions = SERVICE_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("");

  container.innerHTML = `
    <div style="background:linear-gradient(135deg,#38bdf8,#0284c7);color:#fff;border-radius:22px;padding:20px">
      <div style="font-size:14px;opacity:.85">👤 สวัสดีคุณ</div>
      <div style="font-size:22px;font-weight:900">${escHtml(userName)}</div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">📞 ${escHtml(customerPhone)} &nbsp;|&nbsp; ✉️ ${escHtml(userEmail)}</div>
    </div>

    <div class="panel">
      <h3 style="color:var(--primary2);margin-bottom:12px">${_heading}</h3>

      ${_booking ? `<div style="margin-bottom:14px;border:1px solid #bfdbfe;border-radius:14px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;background:#0284c7;color:#fff">
          <span style="font-size:13px;font-weight:800">🌬️ รายการจากแคตตาล็อกแอร์</span>
          <span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.22);padding:2px 9px;border-radius:999px">${_isAsk ? '💬 สอบถามราคา' : '📅 สั่งจอง'}</span>
        </div>
        <div style="padding:11px 12px;background:#eff6ff">
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;color:#1e3a8a">
            <span style="color:#64748b">ประเภท</span><b>${escHtml(_booking.airType || '-')}</b>
            <span style="color:#64748b">แบรนด์/รุ่น</span><b>${escHtml(_booking.brand || '')} ${escHtml(_booking.model || '')}</b>
            ${Number(_booking.btu) > 0 ? `<span style="color:#64748b">BTU</span><b>${Number(_booking.btu).toLocaleString()}</b>` : ''}
            <span style="color:#64748b">ราคา</span><b style="color:${Number(_booking.offerPrice) > 0 ? '#0284c7' : '#b45309'}">${escHtml(_priceTxt)}</b>
            ${_booking.warranty ? `<span style="color:#64748b">ประกัน</span><span style="font-size:12px">${escHtml(_booking.warranty)}</span>` : ''}
            ${_booking.spec ? `<span style="color:#64748b">สเปก</span><span style="font-size:12px">${escHtml(_booking.spec)}</span>` : ''}
          </div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #bfdbfe;font-size:11px;color:#64748b">
            ⚠️ <b>ยังไม่ใช่การซื้อจริง</b> เจ้าหน้าที่จะยืนยันราคาและเวลานัดหมายอีกครั้ง — <b>ยังไม่ได้ส่ง</b> กดปุ่มด้านล่างเพื่อยืนยัน
          </div>
        </div>
      </div>` : ''}

      ${!_isBooking ? `<button id="srAiBtn" type="button" aria-label="AI ช่วยแจ้งงาน"
        style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:14px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:14px;padding:12px;font-size:14px;font-weight:800;cursor:pointer">
        🤖 AI ช่วยแจ้งงาน / ลงคิวงาน
      </button>` : ''}

      <label class="set-field-label">ประเภทงาน</label>
      <select id="srType">${typeOptions}</select>

      <div id="srCustomTypeWrap" class="hidden" style="margin-top:8px">
        <label class="set-field-label">ระบุประเภทงาน</label>
        <input type="text" id="srCustomType" placeholder="เช่น ติดตั้งพัดลม, ซ่อมปั๊มน้ำ..." />
      </div>

      <label class="set-field-label" style="margin-top:12px">📍 ที่อยู่ ${_isBooking ? '/ สถานที่ติดตั้ง' : ''}</label>
      <textarea id="srAddress" placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด" rows="2" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical">${escHtml(customerRecord?.address || "")}</textarea>

      <!-- ★ Phase 349: นัดหมาย (optional — map ลง note เดิม ไม่แก้ schema) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <div>
          <label class="set-field-label">📅 วันที่สะดวก</label>
          <input type="date" id="srPrefDate" aria-label="เลือกวันที่สะดวก" title="เลือกวันที่สะดวก (ไม่ระบุก็ได้)" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:11px;font:inherit;box-sizing:border-box;color:#475569" />
        </div>
        <div>
          <label class="set-field-label">⏰ ช่วงเวลา</label>
          <select id="srPrefTime" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:11px;font:inherit;box-sizing:border-box">
            <option value="">เลือกช่วงเวลา (ไม่ระบุก็ได้)</option>
            <option value="ช่วงเช้า (09:00–12:00)">ช่วงเช้า (09:00–12:00)</option>
            <option value="ช่วงบ่าย (13:00–16:00)">ช่วงบ่าย (13:00–16:00)</option>
            <option value="ช่วงเย็น (16:00–18:00)">ช่วงเย็น (16:00–18:00)</option>
            <option value="ทั้งวัน">ทั้งวัน</option>
          </select>
        </div>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">ยังไม่ระบุก็ได้ — เจ้าหน้าที่จะติดต่อยืนยันเวลานัดหมายอีกครั้ง</div>

      <label class="set-field-label" style="margin-top:12px">⚡ ${_isBooking ? 'รายละเอียดเพิ่มเติม (ถ้ามี)' : 'อาการเสีย / รายละเอียด'}</label>
      <textarea id="srSymptom" placeholder="${_isBooking ? 'เช่น ขนาดห้อง จุดที่จะติดตั้ง งบประมาณ ฯลฯ' : 'อธิบายอาการเสีย หรือรายละเอียดงานที่ต้องการ...'}" rows="${_isBooking ? 3 : 4}" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical;min-height:${_isBooking ? 64 : 96}px"></textarea>

      <label class="set-field-label" style="margin-top:12px">📌 หมายเหตุ (ถ้ามี)</label>
      <textarea id="srNote" placeholder="เช่น วันเวลาที่สะดวก, รุ่นเครื่อง..." rows="2" style="width:100%;border:1px solid var(--line);border-radius:14px;padding:12px;font:inherit;resize:vertical;min-height:56px"></textarea>
    </div>

    <button id="srSubmitBtn" class="set-save-btn" style="background:var(--success);box-shadow:0 8px 24px rgba(5,150,105,.25)">${_submitLabel}</button>

    ${_isBooking ? `<button id="srAiBtn" type="button" aria-label="AI ช่วยกรอก"
      style="width:100%;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:6px;background:transparent;color:#7c3aed;border:1px dashed #c4b5fd;border-radius:12px;padding:9px;font-size:12px;font-weight:700;cursor:pointer">
      🤖 หรือให้ AI ช่วยกรอกรายละเอียดแทน
    </button>` : ''}

    <div id="srStatus" class="hidden panel mt16"></div>
  `;

  // ★ Phase 347/350: prefill จาก booking draft (user กดส่งเอง — ไม่ auto-submit)
  //   ลดความซ้ำ: "รายละเอียด" (description) สั้น — ข้อมูลรุ่นครบ + source=air_catalog เก็บใน note ที่ส่งเข้า DB
  if (_booking) {
    const sym = container.querySelector("#srSymptom");
    const noteEl = container.querySelector("#srNote");
    const typeSel = container.querySelector("#srType");
    const btuStr = Number(_booking.btu) > 0 ? ` ${Number(_booking.btu).toLocaleString()} BTU` : "";
    const priceTxt = Number(_booking.offerPrice) > 0 ? `ราคาเสนอ ${Number(_booking.offerPrice).toLocaleString()} บาท` : "ต้องเช็คราคา";
    // description (สั้น — กล่องสรุปด้านบนมีครบแล้ว) → ลูกค้าเติม "รายละเอียดเพิ่มเติม" เองได้
    if (sym && !sym.value) {
      sym.value = `${_isAsk ? 'สอบถามราคา' : 'จองติดตั้ง'}แอร์ ${_booking.brand} ${_booking.model}${btuStr}`.trim();
    }
    // note (ข้อมูลครบสำหรับเจ้าหน้าที่ + trace marker) — submit เดิมส่ง field นี้
    const noteBits = [`[source=air_catalog] ${_booking.airType} ${_booking.brand} ${_booking.model}${btuStr} · ${priceTxt}`];
    if (_booking.spec) noteBits.push('สเปก ' + _booking.spec);
    if (_booking.warranty) noteBits.push('ประกัน ' + _booking.warranty);
    if (_booking.note) noteBits.push(_booking.note);
    if (noteEl) noteEl.value = noteBits.filter(Boolean).join(' | ');
    if (typeSel) { const opt = [...typeSel.options].find(o => o.value.includes("ติดตั้งแอร์")); if (opt) typeSel.value = opt.value; }
  }

  // Toggle custom type
  container.querySelector("#srAiBtn")?.addEventListener("click", () => window.BoonsookAI?.open());

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
  container.querySelector("#srSubmitBtn").addEventListener("click", async (e) => {
    const submitBtn = e.currentTarget;
    // ★ ป้องกัน double-click
    if (submitBtn.disabled) return;

    const typeVal = typeSelect.value.includes("อื่นๆ")
      ? (container.querySelector("#srCustomType").value.trim() || typeSelect.value)
      : typeSelect.value;
    const address = container.querySelector("#srAddress").value.trim();
    const symptom = container.querySelector("#srSymptom").value.trim();
    const note = container.querySelector("#srNote").value.trim();
    // ★ Phase 349: นัดหมาย → map ลง note เดิม (ไม่แก้ schema)
    const prefDate = container.querySelector("#srPrefDate")?.value || "";
    const prefTime = container.querySelector("#srPrefTime")?.value || "";
    const apptBits = [];
    if (prefDate) apptBits.push(`นัดหมาย ${prefDate}`);
    if (prefTime) apptBits.push(prefTime);
    const finalNote = apptBits.length ? (note ? note + " | " : "") + apptBits.join(" ") : note;

    if (!symptom) return showToast("กรุณากรอกอาการเสีย/รายละเอียด");

    submitBtn.disabled = true;
    const origText = submitBtn.textContent;
    submitBtn.textContent = "⏳ กำลังส่ง...";

    const statusEl = container.querySelector("#srStatus");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "กำลังส่งคำแจ้งซ่อม...";

    try {
      const cfg = window.SUPABASE_CONFIG;
      const token = (await state.supabase.auth.getSession())?.data?.session?.access_token || cfg.anonKey;

      const record = {
        // ★ Phase 394: sync กับ schema จริง service_jobs (live-verified 201)
        //   - job_no = NOT NULL (gen pattern เดียวกับ main.saveServiceJob/ai_sales)
        //   - ใช้ customer_address (ไม่มีคอลัมน์ address) · เก็บชนิดงานที่ sub_service (ไม่มี device_name)
        job_no: "JOB-" + Date.now(),
        customer_name: userName,
        customer_phone: customerPhone,
        job_type: resolveJobType(typeVal),
        sub_service: typeVal,
        description: symptom,
        customer_address: address,
        note: finalNote,
        status: "pending",
        // ★ Phase 393: service_jobs.total_cost = NOT NULL → 0 (งานแจ้งซ่อมยังไม่คิดเงิน; pending+0 → auto_post ไม่โพสต์ SV)
        total_cost: 0,
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

      // ★ Phase 391: บอก AI chat widget ว่าบันทึกสำเร็จจริง (กัน success ปลอม เมื่อ widget click srSubmitBtn)
      try { window.dispatchEvent(new CustomEvent("service-job:saved", { detail: { source: "service_request" } })); } catch (_) {}

      // ★ Phase 350: confirmation ชัดเจน + ปุ่ม "ดูงานของฉัน" (ถ้า route พร้อม)
      const okTitle = _isBooking ? "ส่งคำขอแล้ว!" : "แจ้งซ่อมสำเร็จ!";
      const okMsg = _isBooking
        ? "เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันราคาและเวลานัดหมาย"
        : "ทางร้านจะติดต่อกลับเร็วๆ นี้ครับ";
      statusEl.innerHTML = `<div style="text-align:center;padding:8px">
        <div style="font-size:40px">✅</div>
        <div style="font-weight:700;color:var(--success);margin-top:8px">${okTitle}</div>
        <div class="sku" style="margin-top:2px">${okMsg}</div>
        <button id="srViewJobs" type="button" style="margin-top:12px;padding:9px 18px;border:1px solid #0284c7;border-radius:12px;background:#fff;color:#0284c7;font-size:13px;font-weight:700;cursor:pointer">📋 ดูงานของฉัน</button>
      </div>`;
      container.querySelector("#srViewJobs")?.addEventListener("click", () => {
        if (typeof ctx.showRoute === "function") ctx.showRoute("customer_dashboard");
        else window.location.hash = "customer_dashboard";
      });
      showToast(_isBooking ? "ส่งคำขอแล้ว เจ้าหน้าที่จะติดต่อกลับ ✅" : "แจ้งซ่อมสำเร็จ!");

      // Reset form
      container.querySelector("#srSymptom").value = "";
      container.querySelector("#srNote").value = "";

      // Send LINE notify — ★ Phase 391: ต้องส่งเข้า "queue" (กลุ่มคิวงาน) ไม่ใช่ default (LINE_USER_ID)
      //   + await + handle result (LINE fail ต้องไม่ทำให้งาน fail แต่ต้องเตือนชัด ไม่หลอกว่าส่งแล้ว)
      if (typeof ctx.sendLineNotify === "function") {
        try {
          const lr = await ctx.sendLineNotify(
            `✍️ ลูกค้าแจ้งซ่อม!\n🔧 ${typeVal}\n👤 ${userName} | 📞 ${customerPhone}\n📍 ${address || "-"}\n⚡ ${symptom.substring(0, 120)}`,
            { state, showToast },
            "queue"
          );
          const d = describeLineResult(lr, { context: "LINE คิวงาน" });
          if (d) showToast(d.msg, d.type);
        } catch (lineErr) {
          console.warn("[service_request] LINE notify failed:", lineErr);
          showToast("แจ้งซ่อมสำเร็จ แต่ส่ง LINE คิวงานไม่สำเร็จ (network)", "warning");
        }
      }
    } catch (e) {
      console.error("[service_request submit] error:", e);
      try { window.dispatchEvent(new CustomEvent("service-job:save-failed", { detail: { reason: e.message, source: "service_request" } })); } catch (_) {}
      statusEl.textContent = "เกิดข้อผิดพลาด: " + e.message;
      showToast("แจ้งซ่อมไม่สำเร็จ");
    } finally {
      if (submitBtn.isConnected) {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    }
  });
}
