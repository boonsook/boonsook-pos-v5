// ai-chat-widget.js
// UI chat modal สำหรับหน้าแจ้งซ่อม — เรียก /api/ai-assistant
//
// วิธีใช้:
// 1. include script นี้ใน index.html (หลัง main.js):
//      <script src="./ai-chat-widget.js"></script>
// 2. ในหน้าแจ้งซ่อม (service request form) เพิ่มปุ่ม:
//      <button onclick="BoonsookAI.open()">🤖 ให้ AI ช่วยกรอก</button>
// 3. AI จะ auto-fill ช่องเหล่านี้เมื่อคุยจบ (ถ้ามี):
//      - #serviceCustomer       (ชื่อลูกค้า)
//      - #servicePhone          (เบอร์โทร)
//      - #serviceAddress / #srAddress  (ที่อยู่/สถานที่หน้างาน)
//      - #serviceType           (ประเภทบริการ — ac/solar/cctv)
//      - #serviceTitle          (หัวข้อ/อาการ)
//      - #serviceNote / #srSymptom / #srNote  (รายละเอียด)

(function () {
  "use strict";

  const API_URL = "/api/ai-assistant";

  // ★ MAIN_MENU — เมนู 2 ชั้น (หมวดหลัก → หัวข้อย่อย)
  //   อนาคตเพิ่มหมวดใหม่ง่ายๆ แค่ push entry เข้า array นี้
  const MAIN_MENU = [
    {
      key: "ac",
      label: "🛠️ งานแอร์ / เครื่องใช้ไฟฟ้า",
      subs: [
        "ซ่อมแอร์",
        "ล้างแอร์",
        "ย้ายแอร์",
        "ติดตั้งแอร์",
        "จานดาวเทียม",
        "ซ่อมตู้เย็น",
        "ซ่อมเครื่องซักผ้า",
        "CCTV",
        "ซ่อมทีวี",
      ],
    },
    {
      key: "solar",
      label: "☀️ งานโซล่าเซลล์",
      subs: [
        "ติดตั้งปั๊มน้ำโซล่าเซลล์",
        "ติดตั้งชุดออนกริดโซล่าเซลล์",
        "ติดตั้งชุดออฟกริดโซล่าเซลล์",
        "ติดตั้งชุดไฮบริดโซล่าเซลล์",
        "ซ่อม & เซอร์วิสระบบโซล่าเซลล์",
        "งานโซล่าเซลล์อื่นๆ",
      ],
    },
    // ★ เพิ่มหมวดใหม่ตรงนี้ได้เลย เช่น
    // { key: "network", label: "🌐 งานเน็ตเวิร์ก/LAN", subs: [...] },
    // { key: "plumbing", label: "🚰 งานประปา",        subs: [...] },
  ];

  // หา main menu entry จาก key
  function findMenuByKey(key) {
    return MAIN_MENU.find((m) => m.key === key) || null;
  }

  // ★ ตรวจว่าอยู่หน้าไหน → เลือก chip set + เลือกฟอร์มที่จะ fill
  function detectPage() {
    const solarPage = document.getElementById("page-solar");
    if (solarPage && !solarPage.classList.contains("hidden")) return "solar";
    return "service";
  }

  const state = {
    open: false,
    loading: false,
    history: [],
    lastResult: null,
  };

  // ---------- STYLES ----------
  const css = `
  #bs-ai-backdrop {
    position: fixed; inset: 0; background: rgba(10, 20, 35, 0.55);
    backdrop-filter: blur(4px); z-index: 99998; display: none;
  }
  #bs-ai-backdrop.open { display: block; }
  #bs-ai-modal {
    position: fixed; z-index: 99999;
    right: 20px; bottom: 20px;
    width: min(400px, calc(100vw - 40px));
    height: min(600px, calc(100vh - 40px));
    background: #fff; border-radius: 18px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.28);
    display: none; flex-direction: column; overflow: hidden;
    font-family: -apple-system, "Segoe UI", "Sarabun", sans-serif;
  }
  #bs-ai-modal.open { display: flex; }
  #bs-ai-header {
    background: linear-gradient(135deg, #1a2332 0%, #2d3f5c 100%);
    color: #fff; padding: 16px 20px;
    display: flex; align-items: center; gap: 10px;
  }
  #bs-ai-header .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #4ade80; box-shadow: 0 0 8px #4ade80;
    animation: bs-pulse 2s infinite;
  }
  @keyframes bs-pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
  #bs-ai-header .title { font-size: 15px; font-weight: 600; flex: 1; }
  #bs-ai-header .title small { display:block; font-size:11px; opacity:0.7; font-weight:400; margin-top:2px; }
  #bs-ai-close {
    background: rgba(255,255,255,0.15); border: none; color: #fff;
    width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
    font-size: 16px; line-height: 1;
  }
  #bs-ai-close:hover { background: rgba(255,255,255,0.3); }
  #bs-ai-body {
    flex: 1; overflow-y: auto; padding: 18px;
    background: #f5f7fa;
    display: flex; flex-direction: column; gap: 10px;
  }
  .bs-msg {
    max-width: 82%; padding: 10px 14px; border-radius: 14px;
    font-size: 14px; line-height: 1.5; word-wrap: break-word;
  }
  .bs-msg.user {
    align-self: flex-end;
    background: #1a2332; color: #fff;
    border-bottom-right-radius: 4px;
  }
  .bs-msg.ai {
    align-self: flex-start;
    background: #fff; color: #1a2332;
    border: 1px solid #e8ecf1;
    border-bottom-left-radius: 4px;
  }
  .bs-msg.loading { opacity: 0.6; font-style: italic; }
  .bs-chips {
    align-self: flex-start;
    display: flex; flex-wrap: wrap; gap: 6px;
    margin: -4px 0 2px 0;
    max-width: 100%;
  }
  .bs-chip {
    background: #fff; color: #1a2332;
    border: 1.5px solid #c7d2e0; border-radius: 20px;
    padding: 7px 14px; font-size: 13px; cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .bs-chip:hover { background: #1a2332; color: #fff; border-color: #1a2332; transform: translateY(-1px); }
  .bs-chip:active { transform: translateY(0); }
  .bs-chip:disabled { opacity: 0.35; cursor: not-allowed; }
  .bs-chip.selected { background: #1a2332; color: #fff; border-color: #1a2332; }
  .bs-summary {
    align-self: stretch;
    background: #e0f7e9; border: 1px solid #4ade80;
    border-radius: 10px; padding: 12px 14px;
    font-size: 13px; color: #065f46;
  }
  .bs-summary strong { color: #064e3b; }
  .bs-summary .row { margin: 4px 0; }
  .bs-summary .sep { border-top: 1px dashed #86efac; margin: 8px 0; }
  .bs-summary .btns { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
  .bs-summary button {
    background: #1a2332; color: #fff; border: none;
    padding: 8px 14px; border-radius: 6px;
    font-size: 13px; cursor: pointer;
  }
  .bs-summary button.ghost { background: #fff; color: #1a2332; border: 1px solid #94a3b8; }
  #bs-ai-footer {
    padding: 12px 14px; background: #fff; border-top: 1px solid #e8ecf1;
    display: flex; gap: 8px;
  }
  #bs-ai-input {
    flex: 1; padding: 10px 14px; font-size: 14px;
    border: 1.5px solid #e8ecf1; border-radius: 20px; outline: none;
    font-family: inherit;
  }
  #bs-ai-input:focus { border-color: #1a2332; }
  #bs-ai-send {
    background: #1a2332; color: #fff; border: none;
    width: 40px; height: 40px; border-radius: 50%;
    cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  #bs-ai-send:disabled { opacity: 0.4; cursor: not-allowed; }
  #bs-ai-fab {
    position: fixed; right: 20px; bottom: 20px; z-index: 99997;
    background: linear-gradient(135deg, #1a2332 0%, #2d3f5c 100%);
    color: #fff; border: none; padding: 14px 20px;
    border-radius: 50px; cursor: pointer;
    box-shadow: 0 8px 24px rgba(26,35,50,0.35);
    font-size: 14px; font-weight: 600; font-family: inherit;
    display: flex; align-items: center; gap: 8px;
    transition: transform 0.2s;
  }
  #bs-ai-fab:hover { transform: translateY(-2px); }
  #bs-ai-fab.hidden { display: none; }
  @media (max-width: 480px) {
    #bs-ai-modal {
      right: 0; bottom: 0; width: 100vw; height: 100vh;
      border-radius: 0;
    }
  }
  `;

  // ---------- BUILD UI ----------
  function mount() {
    if (document.getElementById("bs-ai-modal")) return;

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const html = `
      <div id="bs-ai-backdrop"></div>
      <button id="bs-ai-fab" aria-label="เปิด AI ผู้ช่วย">
        <span>🤖</span> AI ช่วยกรอก
      </button>
      <div id="bs-ai-modal" role="dialog" aria-label="AI ผู้ช่วย">
        <div id="bs-ai-header">
          <span class="dot"></span>
          <div class="title">
            ผู้ช่วย AI บุญสุขแอร์
            <small>แตะเลือกบริการ — หรือพิมพ์อาการก็ได้</small>
          </div>
          <button id="bs-ai-close" aria-label="ปิด">✕</button>
        </div>
        <div id="bs-ai-body"></div>
        <div id="bs-ai-footer">
          <input id="bs-ai-input" type="text" placeholder="พิมพ์เพิ่มเติมได้..." />
          <button id="bs-ai-send" aria-label="ส่ง">➤</button>
        </div>
      </div>
    `;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    document.body.appendChild(wrap);

    document.getElementById("bs-ai-fab").addEventListener("click", open);
    document.getElementById("bs-ai-close").addEventListener("click", close);
    document.getElementById("bs-ai-backdrop").addEventListener("click", close);
    document.getElementById("bs-ai-send").addEventListener("click", () => send());
    document.getElementById("bs-ai-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  // ---------- OPEN/CLOSE ----------
  function open() {
    mount();
    state.open = true;
    document.getElementById("bs-ai-modal").classList.add("open");
    document.getElementById("bs-ai-backdrop").classList.add("open");
    document.getElementById("bs-ai-fab").classList.add("hidden");

    if (state.history.length === 0) {
      const page = detectPage();
      // ★ ถ้าเปิดจากหน้า solar — ข้ามเมนูหลักเพื่อความเร็ว ไปที่หัวข้อย่อยโซล่าเลย
      if (page === "solar") {
        const solar = findMenuByKey("solar");
        pushMsg(
          "ai",
          "สวัสดีครับ ☀️ เลือกประเภทงานโซล่าเซลล์ที่ต้องการได้เลยครับ"
        );
        if (solar) pushChips(solar.subs);
      } else {
        pushMsg(
          "ai",
          "สวัสดีครับ 🙏 เลือกหมวดงานที่ต้องการได้เลยครับ หรือพิมพ์อาการเองก็ได้"
        );
        pushMainMenu();
      }
    }
    setTimeout(() => document.getElementById("bs-ai-input").focus(), 100);
  }

  function close() {
    state.open = false;
    document.getElementById("bs-ai-modal").classList.remove("open");
    document.getElementById("bs-ai-backdrop").classList.remove("open");
    document.getElementById("bs-ai-fab").classList.remove("hidden");
  }

  // ---------- MESSAGE HANDLING ----------
  // ปิดใช้งาน chip กลุ่มเก่าทั้งหมด (เมื่อลูกค้าเลือก/พิมพ์ไปแล้ว)
  function disableOldChips() {
    document.querySelectorAll("#bs-ai-body .bs-chips").forEach((g) => {
      g.querySelectorAll("button").forEach((b) => (b.disabled = true));
    });
  }

  function pushMsg(role, text) {
    const body = document.getElementById("bs-ai-body");
    const div = document.createElement("div");
    div.className = "bs-msg " + role;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;

    if (role !== "loading") {
      state.history.push({ role: role === "user" ? "user" : "assistant", content: text });
    }
    return div;
  }

  function pushLoading() {
    const body = document.getElementById("bs-ai-body");
    const div = document.createElement("div");
    div.className = "bs-msg ai loading";
    div.textContent = "กำลังคิด...";
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  // แสดงปุ่ม chip ให้ลูกค้าแตะเลือก
  function pushChips(items) {
    if (!items || !items.length) return;
    const body = document.getElementById("bs-ai-body");
    const wrap = document.createElement("div");
    wrap.className = "bs-chips";
    items.forEach((txt) => {
      const btn = document.createElement("button");
      btn.className = "bs-chip";
      btn.type = "button";
      btn.textContent = txt;
      btn.onclick = () => {
        if (state.loading) return;
        // mark selected
        btn.classList.add("selected");
        // ส่งข้อความให้ AI
        send(txt);
      };
      wrap.appendChild(btn);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
    return wrap;
  }

  // ★ แสดง chip หมวดหลัก (ชั้น 1) — คลิกแล้วแตกเป็น chip หัวข้อย่อย (ชั้น 2)
  function pushMainMenu() {
    const body = document.getElementById("bs-ai-body");
    const wrap = document.createElement("div");
    wrap.className = "bs-chips";
    MAIN_MENU.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "bs-chip";
      btn.type = "button";
      btn.textContent = cat.label;
      btn.onclick = () => {
        if (state.loading) return;
        // ปิด chip หมวดหลักทั้งกลุ่ม + ไฮไลต์ตัวที่เลือก
        wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
        btn.classList.add("selected");
        // บันทึกเป็นข้อความ user (ให้ history รู้ว่าเลือกหมวดนี้)
        pushMsg("user", cat.label);
        // ตอบเป็น AI message แล้ว push chip หัวข้อย่อย (ไม่ส่งไป server รอบนี้)
        pushMsg("ai", `รับเรื่อง ${cat.label} ครับ — ต้องการบริการแบบไหนครับ?`);
        pushChips(cat.subs);
      };
      wrap.appendChild(btn);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
    return wrap;
  }

  function pushSummary(result) {
    const body = document.getElementById("bs-ai-body");
    const div = document.createElement("div");
    div.className = "bs-summary";
    const priceRange =
      result.estimated_price_min && result.estimated_price_max
        ? `${result.estimated_price_min.toLocaleString()}-${result.estimated_price_max.toLocaleString()} บาท`
        : "ประเมินหน้างาน";
    div.innerHTML = `
      <strong>📋 สรุปใบแจ้งซ่อม</strong>
      <div class="row">• ประเภท: <strong>${escapeHtml(result.job_type || "-")}</strong></div>
      <div class="row">• อาการ: ${escapeHtml(result.sub_service || "-")}</div>
      <div class="row">• ราคาประเมิน: <strong>${priceRange}</strong></div>
      ${result.urgency !== "normal" ? `<div class="row">• ⚠️ ${result.urgency === "emergency" ? "ด่วนมาก" : "เร่งด่วน"}</div>` : ""}
      ${result.needs_photo ? `<div class="row">📷 แนะนำส่งรูปมาด้วยจะประเมินได้แม่นยำขึ้น</div>` : ""}
      <div class="sep"></div>
      <div class="row">👤 ชื่อ: <strong>${escapeHtml(result.customer_name || "-")}</strong></div>
      <div class="row">📞 เบอร์: <strong>${escapeHtml(result.customer_phone || "-")}</strong></div>
      <div class="row">📍 ที่อยู่: ${escapeHtml(result.customer_address || "-")}</div>
      <div class="btns">
        <button id="bs-ai-apply">✓ ใช้ข้อมูลนี้กรอกแบบฟอร์ม</button>
        <button id="bs-ai-restart" class="ghost">คุยใหม่</button>
      </div>
    `;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;

    div.querySelector("#bs-ai-apply").addEventListener("click", () => applyToForm(result));
    div.querySelector("#bs-ai-restart").addEventListener("click", restart);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  // ---------- SEND ----------
  // รับได้ทั้ง: send() → อ่านจาก input, หรือ send("text") → ใช้ text จาก chip
  async function send(presetText) {
    if (state.loading) return;
    const input = document.getElementById("bs-ai-input");
    const text = presetText != null
      ? String(presetText).trim()
      : (input.value || "").trim();
    if (!text) return;
    if (presetText == null) input.value = "";

    // ปิด chip เก่าทั้งหมดเมื่อ user action แล้ว
    disableOldChips();

    pushMsg("user", text);
    state.loading = true;
    document.getElementById("bs-ai-send").disabled = true;
    const loadingEl = pushLoading();

    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: state.history.slice(0, -1),
          customerPhone: window.BoonsookAI?._currentPhone || null,
          page: detectPage(), // ★ "solar" หรือ "service" — ให้ AI รู้ context
        }),
      });

      const data = await resp.json();
      loadingEl.remove();

      if (!resp.ok) {
        pushMsg("ai", "ขอโทษครับ เกิดข้อผิดพลาด: " + (data.error || "unknown") + (data.hint ? "\n" + data.hint : ""));
        return;
      }

      pushMsg("ai", data.reply || "...");

      // ★ MERGE กับ state.lastResult เก็บข้อมูลที่ AI เคยให้ในรอบก่อน
      //   ป้องกัน AI ลืม job_type/price ในรอบท้ายๆ (Llama บางครั้งคืน null กลับมา)
      const prev = state.lastResult || {};
      const merged = {
        reply: data.reply || "",
        done: !!data.done,
        job_type: data.job_type || prev.job_type || null,
        sub_service: data.sub_service || prev.sub_service || null,
        description: data.description || prev.description || null,
        customer_name: data.customer_name || prev.customer_name || null,
        customer_phone: data.customer_phone || prev.customer_phone || null,
        customer_address: data.customer_address || prev.customer_address || null,
        estimated_price_min:
          data.estimated_price_min != null ? data.estimated_price_min : (prev.estimated_price_min != null ? prev.estimated_price_min : null),
        estimated_price_max:
          data.estimated_price_max != null ? data.estimated_price_max : (prev.estimated_price_max != null ? prev.estimated_price_max : null),
        urgency: data.urgency || prev.urgency || "normal",
        needs_photo: !!(data.needs_photo || prev.needs_photo),
        quick_replies: Array.isArray(data.quick_replies) ? data.quick_replies : [],
      };

      // ★ SAFETY NET: ถ้า AI reply เหมือนจะปิดงานแล้ว แต่ยังไม่ set done:true
      //   → พยายามแกะเบอร์/ชื่อ/ที่อยู่ จากข้อความล่าสุด แล้ว force done:true
      const closingPatterns = /(รับเรื่องแล้ว|ช่างจะโทรกลับ|เข้าคิว|เรียบร้อย|บันทึกแล้ว)/;
      if (!merged.done && closingPatterns.test(merged.reply)) {
        const contact = extractContactFromText(text) || extractContactFromHistory();
        if (contact) {
          merged.customer_name = merged.customer_name || contact.name;
          merged.customer_phone = merged.customer_phone || contact.phone;
          merged.customer_address = merged.customer_address || contact.address;
        }
        if (
          merged.job_type &&
          merged.customer_name &&
          merged.customer_phone &&
          merged.customer_address
        ) {
          merged.done = true;
          console.log("[BoonsookAI] safety net triggered — forced done:true", merged);
        }
      }

      state.lastResult = merged;

      // ปุ่ม chip จาก AI (ถ้ามี และยังไม่ done)
      if (!merged.done && Array.isArray(merged.quick_replies) && merged.quick_replies.length > 0) {
        pushChips(merged.quick_replies);
      }

      if (merged.done && merged.job_type) {
        pushSummary(merged);
      }
    } catch (err) {
      loadingEl.remove();
      pushMsg("ai", "เชื่อมต่อ AI ไม่ได้ครับ ลองใหม่อีกครั้ง\n" + String(err?.message || err));
    } finally {
      state.loading = false;
      document.getElementById("bs-ai-send").disabled = false;
      input.focus();
    }
  }

  // Map หมวดบริการ AI (9 แบบ) → value ใน <select id="serviceType"> (ac/solar/cctv)
  function mapJobTypeToServiceType(jobType) {
    if (!jobType) return null;
    const t = String(jobType);
    if (/แอร์|ตู้เย็น|ซักผ้า|ทีวี/.test(t)) return "ac";
    if (/cctv|กล้อง|จาน|ดาวเทียม/i.test(t)) return "cctv";
    if (/โซลาร์|solar/i.test(t)) return "solar";
    return "ac";
  }

  // helper: set ค่าให้ element + trigger event
  function setField(el, val, eventName) {
    if (!el || val == null || val === "") return false;
    el.value = val;
    try {
      el.dispatchEvent(new Event(eventName || "input", { bubbles: true }));
    } catch {}
    return true;
  }

  // ★ Map AI job_type (text) → solar select option (emoji + ชื่อยาว)
  //   รับค่าใกล้เคียงได้หลายแบบ เช่น "ปั๊มน้ำ", "ติดตั้งปั๊มน้ำโซล่าเซลล์", "on-grid"
  function mapSolarType(jobType) {
    if (!jobType) return null;
    const t = String(jobType).toLowerCase();
    if (/ปั๊ม|pump/i.test(t)) return "💧 ติดตั้งปั๊มน้ำโซล่าเซลล์";
    if (/ไฮบริด|hybrid/i.test(t)) return "🌐 ติดตั้งชุดไฮบริดโซล่าเซลล์";
    if (/ออฟกริด|off.?grid/i.test(t)) return "🔋 ติดตั้งชุดออฟกริดโซล่าเซลล์";
    if (/ออนกริด|on.?grid/i.test(t)) return "⚡ ติดตั้งชุดออนกริดโซล่าเซลล์";
    if (/ซ่อม|เซอร์วิส|service/i.test(t)) return "🔌 ซ่อม & เซอร์วิสระบบโซล่าเซลล์";
    if (/โซล่า|solar/i.test(t)) return "🛠️ งานโซล่าเซลล์อื่นๆ";
    return null;
  }

  // ★ กรอกฟอร์มหน้า page-solar
  function fillSolarForm(result) {
    const typeEl = document.getElementById("solType");
    if (!typeEl) return 0;

    let filled = 0;

    // 1) ประเภทงานโซล่า
    const solarLabel = mapSolarType(result.job_type);
    if (solarLabel) {
      const opts = Array.from(typeEl.options || []);
      const match = opts.find(o => o.value === solarLabel || o.textContent.trim() === solarLabel);
      if (match) {
        typeEl.value = match.value;
        typeEl.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
    }

    // 2) ชื่อลูกค้า
    const nameEl = document.getElementById("solName");
    if (nameEl && result.customer_name && setField(nameEl, result.customer_name)) filled++;

    // 3) เบอร์โทร
    const phoneEl = document.getElementById("solPhone");
    if (phoneEl && result.customer_phone && setField(phoneEl, result.customer_phone)) filled++;

    // 4) ที่อยู่
    const addrEl = document.getElementById("solAddress");
    if (addrEl && result.customer_address && setField(addrEl, result.customer_address)) filled++;

    // 5) รายละเอียดงาน — รวม sub_service + description
    const detailEl = document.getElementById("solDetail");
    if (detailEl) {
      const parts = [];
      if (result.sub_service) parts.push(result.sub_service);
      if (result.description) parts.push(result.description);
      const txt = parts.join(" — ");
      if (txt && setField(detailEl, txt)) filled++;
    }

    return filled;
  }

  // ---------- APPLY TO FORM ----------
  function tryFill(result) {
    // ★ ถ้าอยู่หน้า solar → fill ฟอร์มโซล่าก่อน (ถ้ากรอกได้) else fall-through
    if (detectPage() === "solar") {
      const n = fillSolarForm(result);
      if (n > 0) return n;
    }

    let filled = 0;

    // --- 1) ประเภทบริการ ---
    const typeEl =
      document.getElementById("serviceType") ||
      document.querySelector('select[name="job_type"]') ||
      document.getElementById("jobType") ||
      document.getElementById("srType");
    if (typeEl && result.job_type) {
      const mapped = mapJobTypeToServiceType(result.job_type);
      const opts = Array.from(typeEl.options || []);
      const match = opts.find(
        (o) =>
          o.value === mapped ||
          o.value === result.job_type ||
          o.textContent.trim() === result.job_type ||
          o.textContent.includes(result.job_type)
      );
      if (match) {
        typeEl.value = match.value;
        typeEl.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
    }

    // --- 2) หัวข้อ/อาการ ---
    const titleEl =
      document.getElementById("serviceTitle") ||
      document.querySelector('input[name="sub_service"]') ||
      document.getElementById("subService");
    if (titleEl) {
      const val = result.sub_service || result.job_type || "";
      if (val && setField(titleEl, val)) filled++;
    }

    // --- 3) รายละเอียด/อาการยาว ---
    const noteEl =
      document.getElementById("serviceNote") ||
      document.querySelector('textarea[name="description"]') ||
      document.getElementById("description") ||
      document.getElementById("srSymptom") ||
      document.getElementById("srNote");
    if (noteEl && result.description) {
      if (setField(noteEl, result.description)) filled++;
    }

    // --- 4) ชื่อลูกค้า ---
    const nameEl =
      document.getElementById("serviceCustomer") ||
      document.querySelector('input[name="customer_name"]');
    if (nameEl && result.customer_name) {
      if (setField(nameEl, result.customer_name)) filled++;
    }

    // --- 5) เบอร์โทร ---
    const phoneEl =
      document.getElementById("servicePhone") ||
      document.querySelector('input[name="customer_phone"]') ||
      document.querySelector('input[type="tel"]');
    if (phoneEl && result.customer_phone) {
            if (setField(phoneEl, result.customer_phone)) filled++;
    }

    // --- 6) ที่อยู่/สถานที่หน้างาน ---
    const addrEl =
      document.getElementById("serviceAddress") ||
      document.getElementById("srAddress") ||
      document.querySelector('input[name="customer_address"]') ||
      document.querySelector('textarea[name="customer_address"]');
    if (addrEl && result.customer_address) {
      if (setField(addrEl, result.customer_address)) filled++;
    }

    // --- 7) สถานะ (admin form) — ตั้งเป็น pending ถ้ายังว่าง เพื่อให้บันทึกผ่าน validation ---
    const statusEl = document.getElementById("serviceStatus");
    if (statusEl && !statusEl.value) {
      setField(statusEl, "pending", "change");
    }

    return filled;
  }

  function applyToForm(result) {
    let filled = tryFill(result);

    if (filled === 0) {
      // ★ ถ้า AI บอกเป็นงานโซล่า → พาไปหน้า solar
      const solarLabel = mapSolarType(result.job_type);
      if (solarLabel) {
        const solarNav = document.querySelector('[data-route="solar"]');
        if (solarNav) {
          pushMsg("ai", "กำลังพาไปหน้างานโซล่าเซลล์ให้ครับ...");
          solarNav.click();
          setTimeout(() => {
            filled = tryFill(result);
            finishFill(filled);
          }, 600);
          return;
        }
      }
      const navBtn = document.querySelector('[data-route="service_request"]');
      if (navBtn) {
        pushMsg("ai", "กำลังพาไปหน้าแจ้งซ่อมให้ครับ...");
        navBtn.click();
        setTimeout(() => {
          filled = tryFill(result);
          finishFill(filled);
        }, 600);
        return;
      }
    }
    finishFill(filled);
  }

  // ค้นหาปุ่มบันทึกที่ใช้ได้ — รองรับ solar/service job/customer form
  function findSaveButton() {
    // ★ solar page มีปุ่มบันทึกของตัวเอง
    if (detectPage() === "solar") {
      return document.getElementById("solSaveBtn");
    }
    return (
      document.getElementById("saveServiceJobBtn") ||
      document.getElementById("srSubmitBtn") ||
      document.querySelector('[data-action="save-service-job"]')
    );
  }

  // คลิกปุ่มบันทึกอัตโนมัติ — ลูกค้าจะได้เห็นงานเข้าคิวทันที
  function autoSubmit() {
    const btn = findSaveButton();
    if (!btn) {
      pushMsg("ai", '⚠️ กรอกให้แล้วครับ แต่หาปุ่ม "บันทึก" ไม่พบ กดบันทึกเองได้เลยนะครับ');
      return false;
    }
    try {
      btn.click();
      return true;
    } catch (e) {
      pushMsg("ai", '⚠️ กรอกให้แล้วครับ กรุณากด "บันทึก" ด้วยตัวเองนะครับ');
      return false;
    }
  }

  function finishFill(filled) {
    if (filled > 0) {
      pushMsg("ai", `✓ กรอกแบบฟอร์มให้แล้ว ${filled} ช่อง — กำลังบันทึกงานเข้าคิว...`);
      // รอ 600ms ให้ field update เสร็จก่อน click save
      setTimeout(() => {
        const ok = autoSubmit();
        if (ok) {
          pushMsg("ai", "✅ บันทึกงานเรียบร้อย! งานเข้าคิวแล้วครับ 🎉");
          setTimeout(() => close(), 1800);
        }
      }, 600);
    } else {
      pushMsg(
        "ai",
        'ไม่พบช่องที่ตรงในหน้านี้ครับ กรุณาเปิดหน้า "แจ้งซ่อม/บริการ" ก่อน แล้วกดปุ่ม AI อีกครั้งนะครับ'
      );
    }
  }

  // ---------- RESTART ----------
  function restart() {
    state.history = [];
    state.lastResult = null;
    document.getElementById("bs-ai-body").innerHTML = "";
    const page = detectPage();
    if (page === "solar") {
      const solar = findMenuByKey("solar");
      pushMsg("ai", "เริ่มใหม่ได้เลยครับ ☀️ เลือกประเภทงานโซล่าเซลล์");
      if (solar) pushChips(solar.subs);
    } else {
      pushMsg("ai", "เริ่มใหม่ได้เลยครับ เลือกหมวดงานได้เลย");
      pushMainMenu();
    }
  }

  // ---------- PUBLIC API ----------
  window.BoonsookAI = {
    open,
    close,
    restart,
    _currentPhone: null,
    setCustomerPhone(phone) {
      this._currentPhone = phone;
    },
  };

  // ---------- AUTO-MOUNT ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
