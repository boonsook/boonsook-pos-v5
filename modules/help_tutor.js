// ═══════════════════════════════════════════════════════════
//  HELP TUTOR (Phase 24)
//  3-in-1 in-app help: 📖 Steps + 🎓 Interactive Tour + 🤖 AI Chat
// ═══════════════════════════════════════════════════════════

const SEEN_KEY = "bsk_help_seen_v1"; // localStorage key (per-route flags)

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

function getSeenMap() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); }
  catch(e) { return {}; }
}
function markSeen(route) {
  try {
    const m = getSeenMap();
    m[route] = Date.now();
    localStorage.setItem(SEEN_KEY, JSON.stringify(m));
  } catch(e) {}
}
function hasSeen(route) {
  return !!getSeenMap()[route];
}

// ═══════════════════════════════════════════════════════════
// PAGE_HELP — เนื้อหาช่วยเหลือแต่ละหน้า
// (steps = ขั้นตอน, tips = เคล็ดลับ, tour = highlight elements)
// ═══════════════════════════════════════════════════════════
const PAGE_HELP = {
  dashboard: {
    title: "📊 Dashboard ภาพรวมบริษัท",
    intro: "หน้าแรกที่แสดงสถิติร้านค้าทั้งหมด — ยอดขายวันนี้, สต็อก, ลูกค้า, งานช่าง",
    steps: [
      "ดูยอดขายรายวัน/รายเดือน ที่กล่องสถิติด้านบน",
      "เลื่อนลงดูกราฟ — กราฟแท่งคือยอดขาย 7 วัน",
      "ส่วน 'งานล่าสุด' = บิลขายล่าสุด, คลิกดูรายละเอียดได้",
      "การ์ด 'แจ้งเตือน' = เตือนสต็อกใกล้หมด, งานเลทกำหนด",
      "ทุกตัวเลขกดได้ → จะพาไปหน้านั้นทันที"
    ],
    tips: [
      "🔄 กด F5 เพื่อ refresh ข้อมูล (auto-refresh ทุก 30 วินาที)",
      "📊 กราฟกดได้ → ขยายเข้าหน้ารายงาน"
    ],
    tour: []
  },

  pos: {
    title: "💰 แคชเชียร์ (POS)",
    intro: "หน้าหลักที่ใช้ขายสินค้า — รับเงิน, ออกใบเสร็จ, ตัดสต็อกอัตโนมัติ",
    steps: [
      "1️⃣ เลือกสินค้าจากกริด — แตะหรือคลิก = เพิ่มลงตะกร้า",
      "2️⃣ ตรวจตะกร้าด้านขวา (มือถือ = ด้านล่าง) — เพิ่ม/ลด/ลบได้",
      "3️⃣ (option) เลือกลูกค้า → กรอกชื่อ-เบอร์ ถ้าเป็นลูกค้าประจำ",
      "4️⃣ กดปุ่มสีเขียว 'ชำระเงิน' หรือกรอกจำนวนเงินที่รับ",
      "5️⃣ เลือกวิธีจ่าย: 💵 เงินสด / 📱 โอน / 💳 บัตร",
      "6️⃣ ถ้าโอน → แนบสลิป (option) → กดเสร็จสิ้น",
      "7️⃣ ใบเสร็จเด้งขึ้น → กดพิมพ์/ส่ง LINE/บันทึก",
      "✨ ถ้าขายเครื่องใช้ไฟฟ้า → ระบบถามบันทึก Serial Number ให้อัตโนมัติ"
    ],
    tips: [
      "🔍 กด Ctrl+F หรือพิมพ์ในช่องค้นหา → กรองสินค้าทันที",
      "📷 มือถือ → ใช้ Barcode Scanner (มี 📷 ในช่อง SN)",
      "🏷️ ตั้งราคาขายส่ง/ขายปลีกได้ที่หน้าสินค้า",
      "🎁 ถ้าเป็นสินค้า Bundle → ตัดสต็อกชิ้นย่อยให้เอง"
    ],
    tour: []
  },

  products: {
    title: "📦 สินค้า / คลัง",
    intro: "จัดการสินค้าทั้งหมด — เพิ่ม/แก้ไข/ลบ + ดูสต็อกแต่ละคลัง",
    steps: [
      "ดูรายการสินค้าทั้งหมดในตาราง",
      "ค้นหา: พิมพ์ชื่อ/SKU ในช่องค้นหา",
      "Filter: เลือกหมวดหมู่/คลังจาก dropdown",
      "เพิ่มสินค้า: กดปุ่ม '+ เพิ่มสินค้า' → กรอกข้อมูล → บันทึก",
      "แก้ไข: คลิกที่แถวสินค้า → drawer เปิด → แก้ไข → บันทึก",
      "🎁 Bundle: ติ๊กที่ checkbox 'เป็นชุด/Bundle' → เลือกสินค้าลูก",
      "📷 อัปโหลดรูป/QR Code: ในหน้าแก้ไข"
    ],
    tips: [
      "💡 SKU ซ้ำไม่ได้ — ระบบจะเตือน",
      "📊 ราคา/ต้นทุน = ใช้คำนวณกำไร อย่าลืมกรอก",
      "📦 สต็อกขั้นต่ำ → จะแจ้งเตือนตอนใกล้หมด"
    ],
    tour: []
  },

  customers: {
    title: "👥 ลูกค้า",
    intro: "จัดการข้อมูลลูกค้า — ประวัติซื้อ, แต้มสะสม, วันเกิด, notes",
    steps: [
      "ค้นหาลูกค้า: พิมพ์ชื่อ/เบอร์",
      "เพิ่มลูกค้า: กด '+ เพิ่มลูกค้า' → กรอกชื่อ-เบอร์ (ที่อยู่เป็น option)",
      "ดูประวัติ: คลิกที่ลูกค้า → เห็นบิลที่เคยซื้อ",
      "🎂 วันเกิด: กรอกแล้วระบบจะแจ้งเตือนล่วงหน้า",
      "📝 Notes & Tags: บันทึก preference (ชอบยี่ห้อไหน, แพ้อะไร)",
      "🤖 AI สรุป: ถ้ามี notes เยอะ → AI ช่วยสรุปให้"
    ],
    tips: [
      "📞 เบอร์โทรซ้ำไม่ได้ — ระบบเช็คให้",
      "🏆 ลูกค้าที่ซื้อเยอะดูได้ที่ 'ลูกค้าซื้อเยอะสุด'"
    ],
    tour: []
  },

  sales: {
    title: "📋 รายการขาย POS",
    intro: "ประวัติการขายทั้งหมด — ค้นหา, ดูใบเสร็จ, refund, พิมพ์ใหม่",
    steps: [
      "Filter: เลือกช่วงวันที่/วิธีจ่ายเงิน",
      "ค้นหา: พิมพ์ order number หรือชื่อลูกค้า",
      "คลิกที่บิล → ดูรายละเอียดทุกชิ้น + ใบเสร็จ",
      "🔄 Refund: กดปุ่ม 'รับคืน' ในหน้ารายละเอียด → เลือกชิ้นที่คืน",
      "🖨️ พิมพ์ใหม่: กดในใบเสร็จ → เลือกความร้อน 80mm/A4"
    ],
    tips: [
      "📊 export Excel ได้ → กดปุ่ม Export ขวาบน",
      "💰 ดูสรุปยอดด้านบน — เปลี่ยน filter วันที่ → ตัวเลขเปลี่ยน"
    ],
    tour: []
  },

  quotations: {
    title: "📄 ใบเสนอราคา",
    intro: "สร้าง/ส่ง/ติดตามใบเสนอราคา — แปลงเป็นบิลขายได้ทันทีถ้าลูกค้าตกลง",
    steps: [
      "กด '+ ใบเสนอราคาใหม่'",
      "เลือกลูกค้า (มีในระบบ) หรือกรอกชื่อใหม่",
      "เพิ่มสินค้า/บริการ — แก้ราคาได้ตามต่อรอง",
      "(option) ใส่ส่วนลด/หมายเหตุ/วันหมดอายุ",
      "บันทึก → กด PDF เพื่อ download/ส่ง LINE/Email",
      "ถ้าลูกค้าตกลง → กดปุ่ม 'แปลงเป็นบิลขาย' → POS อัตโนมัติ"
    ],
    tips: [
      "📑 ใช้ Template (หน้า 'Template ใบเสนอราคา') ประหยัดเวลามาก",
      "⏰ ใบเสนอราคาใกล้หมดอายุ → จะมีสีเหลืองเตือน"
    ],
    tour: []
  },

  serials: {
    title: "🔢 Serial Number Tracking",
    intro: "บันทึก SN เครื่องใช้ไฟฟ้า → track warranty + รับเคลม",
    steps: [
      "ดูรายการ SN ทั้งหมดในตาราง — filter ตามสถานะได้",
      "ค้นหา: serial / ชื่อสินค้า / ชื่อลูกค้า",
      "+ เพิ่ม Serial: กรอก SN + ผูกบิลขาย (auto-fill ชื่อสินค้า/ลูกค้า)",
      "📷 บนมือถือ → กด Scan barcode = ไม่ต้องพิมพ์",
      "🔧 รับเคลม: กดปุ่ม 🔧 ในแถวลูกค้าที่มาเคลม",
      "✏️ แก้ไข: กดดินสอ → แก้สถานะ/หมายเหตุ"
    ],
    tips: [
      "✨ เวลา checkout เครื่องใช้ไฟฟ้า → popup ถามบันทึก SN ให้อัตโนมัติ",
      "📊 ดูใกล้หมดประกัน → ไป 'รายงาน Warranty'",
      "🏭 SN ของแอร์/ทีวี → อยู่หลังเครื่อง/ในกล่อง"
    ],
    tour: []
  },

  warranty_report: {
    title: "📊 รายงาน Warranty",
    intro: "รายชื่อเครื่องประกันใกล้หมด → lead สำหรับขาย service / ประกันต่อ",
    steps: [
      "ดูสถิติ: ใกล้หมด / หมดแล้ว / ใช้งาน / ทั้งหมด — กดเพื่อ filter",
      "เปลี่ยน 'เตือนล่วงหน้า' 15/30/60/90 วันได้",
      "ตารางแสดง: SN / สินค้า / ลูกค้า / วันหมด / เหลือกี่วัน",
      "📲 ปุ่ม 'ส่ง LINE เตือนเจ้าของ' → สรุปรายชื่อส่ง LINE notify",
      "🔔 ระบบ check อัตโนมัติทุกวัน → ส่ง LINE ให้เอง"
    ],
    tips: [
      "💡 ลูกค้าใกล้หมดประกัน = lead ดี — เสนอ service / ขายประกันต่อได้",
      "🎯 60-90 วันก่อนหมด = เวลาที่ดีที่สุดที่จะติดต่อ"
    ],
    tour: []
  },

  expenses: {
    title: "💰 รายรับ-รายจ่าย",
    intro: "บันทึกค่าใช้จ่ายทั้งหมด — ค่าเช่า, ค่าน้ำ-ไฟ, ค่าจ้าง, อื่นๆ",
    steps: [
      "เพิ่มรายจ่าย: กด '+ บันทึกรายจ่าย'",
      "เลือกหมวด: ค่าเช่า/น้ำ/ไฟ/อินเทอร์เน็ต/วัสดุสิ้นเปลือง/อื่นๆ",
      "กรอกจำนวนเงิน + (option) แนบสลิป/ใบเสร็จ",
      "ดูสรุป: filter เดือน/ปี → กราฟแสดงสัดส่วนแต่ละหมวด",
      "🔁 รายจ่ายประจำ → ไปที่หน้า 'รายจ่ายประจำ' (auto-create ทุกเดือน)"
    ],
    tips: [
      "💡 ติดตั้งให้ครบทุกบาท → กำไรขั้นต้นในรายงานจะแม่นยำ",
      "📷 แนบสลิป → ปลอดภัยตอนเช็คภาษี"
    ],
    tour: []
  },

  tasks: {
    title: "⏰ Task / สิ่งที่ต้องทำ",
    intro: "Todo list สำหรับร้าน — เตือนงานที่ต้องทำ, มอบหมายงาน",
    steps: [
      "เพิ่ม task: กด '+ เพิ่มงาน' → กรอกหัวข้อ + กำหนดเวลา",
      "(option) มอบหมายให้ user คนอื่น",
      "ติ๊กกล่อง = เสร็จแล้ว",
      "Filter: ทั้งหมด / รออยู่ / เลทกำหนด / เสร็จแล้ว",
      "🔔 งานเลทกำหนด → ระบบเตือน LINE อัตโนมัติ"
    ],
    tips: [
      "📅 ใช้สำหรับ: นัดติดตั้งแอร์, ติดตามลูกค้า, สั่งของ"
    ],
    tour: []
  },

  refunds: {
    title: "🔄 รับคืนสินค้า",
    intro: "บันทึกการรับคืน → คืนเงิน + เพิ่มสต็อกกลับอัตโนมัติ",
    steps: [
      "กด '+ บันทึกการคืน'",
      "เลือกบิลขายที่จะคืน (ค้นหาจาก order number)",
      "เลือกชิ้นที่คืน + จำนวน",
      "ระบุเหตุผล: ไม่พอใจ / สินค้าเสีย / เคลม",
      "บันทึก → ระบบเพิ่มสต็อกกลับ + คืนเงินตามวิธีจ่ายเดิม"
    ],
    tips: [
      "⚠️ คืนแล้วยกเลิกไม่ได้ — ตรวจให้ดีก่อน",
      "📊 ดูสถิติคืน → ใช้ปรับปรุงสินค้า"
    ],
    tour: []
  },

  cash_recon: {
    title: "💵 กระทบยอดเงินสด",
    intro: "ตรวจสอบเงินสดในลิ้นชักตอนปิดร้าน → ขาด/เกินดูออก",
    steps: [
      "เลือกวันที่ที่จะกระทบยอด",
      "กรอกเงินสดเริ่มต้น (ตอนเปิดร้าน)",
      "ระบบคำนวณยอดที่ควรมี = เริ่มต้น + ขายเงินสด - ทอน - รายจ่ายเงินสด",
      "นับเงินสดจริงในลิ้นชัก → กรอก",
      "ระบบแสดง: ขาด / เกิน / ตรง"
    ],
    tips: [
      "💡 ทำทุกวันก่อนปิดร้าน → ลดปัญหาเงินขาด",
      "📊 บันทึกประวัติไว้ → ตรวจย้อนหลังได้"
    ],
    tour: []
  },

  settings: {
    title: "⚙️ ตั้งค่า",
    intro: "ตั้งค่าร้าน, ผู้ใช้, การเงิน, LINE Notify, สิทธิ์, อัปเดตแอป",
    steps: [
      "ข้อมูลร้าน: ชื่อ, ที่อยู่, โลโก้ (สำหรับใบเสร็จ)",
      "บัญชีรับเงิน: เพิ่ม PromptPay / บัญชีธนาคาร (แสดงในใบเสร็จ)",
      "ผู้ใช้: เพิ่ม/แก้ role (admin/sales/technician/customer)",
      "🔔 LINE Notify: ตั้ง token เพื่อให้ระบบส่งแจ้งเตือน",
      "🔄 ตรวจหาอัปเดต: เช็ค version ใหม่ของแอป"
    ],
    tips: [
      "📷 อัปโหลดโลโก้ร้าน → ใบเสร็จมืออาชีพ",
      "🔐 จำกัด role พนักงาน → ป้องกันแก้ราคา/ลบบิล"
    ],
    tour: []
  }
};

// Generic fallback for pages without specific help
const GENERIC_HELP = {
  title: "หน้านี้",
  intro: "หน้านี้ยังไม่มี tutorial เฉพาะ — ลองสำรวจปุ่มต่างๆ หรือถาม AI",
  steps: ["ดูปุ่มและ menu บนหน้า", "อ่าน label และ tooltip (วาง mouse ค้าง)", "ทดลองกดดู — เปลี่ยนใจกลับได้", "ถ้ายังงง → กด '🤖 ถาม AI'"],
  tips: [],
  tour: []
};

// ═══════════════════════════════════════════════════════════
// FLOATING HELP BUTTON
// ═══════════════════════════════════════════════════════════
let _currentRoute = "dashboard";
let _currentTitle = "Dashboard";

export function setHelpContext(route, title) {
  _currentRoute = route || "dashboard";
  _currentTitle = title || route || "หน้านี้";
  // Update dot ถ้าหน้านี้ user ยังไม่เคยดู help
  updateHelpButtonState();
}

function updateHelpButtonState() {
  const btn = document.getElementById("bs-help-fab");
  if (!btn) return;
  const dot = btn.querySelector(".help-dot");
  if (!hasSeen(_currentRoute) && PAGE_HELP[_currentRoute]) {
    btn.classList.add("pulse");
    if (dot) dot.style.display = "block";
  } else {
    btn.classList.remove("pulse");
    if (dot) dot.style.display = "none";
  }
}

export function mountHelpButton() {
  if (document.getElementById("bs-help-fab")) return;

  const style = document.createElement("style");
  style.id = "bs-help-style";
  style.textContent = `
    #bs-help-fab {
      position: fixed; right: 20px; bottom: 90px; z-index: 99996;
      width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: #fff; border: none; cursor: pointer;
      box-shadow: 0 6px 20px rgba(245,158,11,0.4);
      font-size: 24px; font-family: inherit;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s;
    }
    #bs-help-fab:hover { transform: scale(1.1); }
    #bs-help-fab.pulse {
      animation: bs-help-pulse 2s ease-in-out infinite;
    }
    @keyframes bs-help-pulse {
      0%, 100% { box-shadow: 0 6px 20px rgba(245,158,11,0.4), 0 0 0 0 rgba(245,158,11,0.7); }
      50% { box-shadow: 0 6px 20px rgba(245,158,11,0.4), 0 0 0 14px rgba(245,158,11,0); }
    }
    #bs-help-fab .help-dot {
      position: absolute; top: 4px; right: 4px;
      width: 12px; height: 12px; background: #ef4444;
      border-radius: 50%; border: 2px solid #fff; display: none;
    }
    body:has(#backdrop:not(.hidden)) #bs-help-fab,
    body:has(.drawer:not(.hidden)) #bs-help-fab,
    body:has(#bskQrModal) #bs-help-fab,
    body:has(#sm-modal:not(.sm-modal-hidden)) #bs-help-fab,
    body:has(#serialBatchModal) #bs-help-fab,
    body:has(#serialPromptModal) #bs-help-fab,
    body:has(#snScanModal) #bs-help-fab { display: none !important; }
    @media (max-width: 480px) {
      #bs-help-fab { right: 14px; bottom: 80px; width: 48px; height: 48px; font-size: 22px; }
    }

    /* ─────────── Help dialog ─────────── */
    #bs-help-modal {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      z-index: 99998; display: none; align-items: center; justify-content: center;
      padding: 16px;
    }
    #bs-help-modal.show { display: flex; }
    #bs-help-modal .panel {
      background: #fff; border-radius: 16px; max-width: 440px; width: 100%;
      max-height: 90vh; overflow-y: auto; padding: 22px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    #bs-help-modal h3 { margin: 0 0 6px; color: #0c4a6e; font-size: 18px; }
    #bs-help-modal .sub { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    #bs-help-modal .opt {
      display: flex; align-items: center; gap: 12px;
      padding: 14px; margin-bottom: 10px; border-radius: 10px;
      background: #f8fafc; border: 1px solid #e2e8f0;
      cursor: pointer; font-size: 14px; font-weight: 600; color: #1e293b;
      transition: all 0.15s;
    }
    #bs-help-modal .opt:hover { background: #e0f2fe; border-color: #0284c7; transform: translateX(4px); }
    #bs-help-modal .opt-icon { font-size: 28px; }
    #bs-help-modal .opt-body { flex: 1; }
    #bs-help-modal .opt-desc { font-size: 12px; color: #64748b; font-weight: 400; margin-top: 2px; }
    #bs-help-close {
      width: 100%; padding: 10px; margin-top: 8px;
      border: 1px solid #cbd5e1; background: #fff; border-radius: 8px;
      cursor: pointer; font-size: 13px; color: #475569;
    }

    /* ─────────── Tour overlay ─────────── */
    #bs-tour-overlay {
      position: fixed; inset: 0; z-index: 100000; pointer-events: auto;
    }
    #bs-tour-overlay svg { width: 100%; height: 100%; }
    #bs-tour-tip {
      position: fixed; z-index: 100001;
      background: #fff; padding: 14px; border-radius: 10px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      max-width: 320px; font-size: 13px;
    }
    #bs-tour-tip .tip-text { color: #1e293b; line-height: 1.5; margin-bottom: 12px; }
    #bs-tour-tip .tip-progress { font-size: 11px; color: #64748b; margin-bottom: 6px; }
    #bs-tour-tip .tip-actions { display: flex; gap: 6px; }
    #bs-tour-tip button {
      flex: 1; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: #fff; cursor: pointer; font-size: 12px; color: #475569;
    }
    #bs-tour-tip button.primary {
      background: #0284c7; color: #fff; border-color: #0284c7; font-weight: 700;
    }

    /* ─────────── Steps modal ─────────── */
    #bs-steps-modal {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      z-index: 99999; display: none; align-items: center; justify-content: center;
      padding: 16px;
    }
    #bs-steps-modal.show { display: flex; }
    #bs-steps-modal .panel {
      background: #fff; border-radius: 16px; max-width: 540px; width: 100%;
      max-height: 90vh; overflow-y: auto; padding: 24px;
    }
    #bs-steps-modal h3 { margin: 0 0 4px; color: #0c4a6e; font-size: 19px; }
    #bs-steps-modal .intro { color: #475569; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }
    #bs-steps-modal ol { padding-left: 22px; line-height: 1.7; color: #1e293b; font-size: 14px; }
    #bs-steps-modal ol li { margin-bottom: 6px; }
    #bs-steps-modal .tips {
      margin-top: 14px; padding: 12px; background: #fef3c7;
      border-radius: 8px; border: 1px solid #fcd34d;
    }
    #bs-steps-modal .tips-title { font-weight: 700; color: #92400e; margin-bottom: 6px; font-size: 13px; }
    #bs-steps-modal .tips ul { margin: 0; padding-left: 18px; color: #78350f; font-size: 12px; line-height: 1.6; }

    /* ─────────── AI chat modal ─────────── */
    #bs-help-ai-modal {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      z-index: 99999; display: none; align-items: center; justify-content: center;
      padding: 16px;
    }
    #bs-help-ai-modal.show { display: flex; }
    #bs-help-ai-modal .panel {
      background: #fff; border-radius: 16px; max-width: 520px; width: 100%;
      max-height: 90vh; display: flex; flex-direction: column; padding: 18px;
    }
    #bs-help-ai-modal h3 { margin: 0 0 4px; color: #0c4a6e; font-size: 17px; }
    #bs-help-ai-modal .sub { font-size: 12px; color: #64748b; margin-bottom: 12px; }
    #bs-help-ai-msgs { flex: 1; overflow-y: auto; padding: 12px; background: #f8fafc; border-radius: 8px; min-height: 200px; max-height: 50vh; }
    #bs-help-ai-msgs .msg { margin-bottom: 10px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
    #bs-help-ai-msgs .user { background: #dbeafe; margin-left: 30px; }
    #bs-help-ai-msgs .ai { background: #fff; margin-right: 30px; border: 1px solid #e2e8f0; }
    #bs-help-ai-input { display: flex; gap: 6px; margin-top: 10px; }
    #bs-help-ai-input input { flex: 1; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-family: inherit; }
    #bs-help-ai-input button { padding: 10px 18px; border: none; background: #0284c7; color: #fff; border-radius: 8px; cursor: pointer; font-weight: 700; }
    #bs-help-ai-input button:disabled { opacity: 0.5; cursor: not-allowed; }
    #bs-help-ai-suggest { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    #bs-help-ai-suggest .chip { padding: 5px 10px; background: #e0f2fe; color: #0c4a6e; border-radius: 12px; font-size: 11px; cursor: pointer; border: 1px solid #bae6fd; }
    #bs-help-ai-suggest .chip:hover { background: #bae6fd; }
  `;
  document.head.appendChild(style);

  const fab = document.createElement("button");
  fab.id = "bs-help-fab";
  fab.title = "ช่วยเหลือการใช้งาน";
  fab.innerHTML = `💡<span class="help-dot"></span>`;
  fab.addEventListener("click", openHelpDialog);
  document.body.appendChild(fab);

  // mount help dialog
  const dialog = document.createElement("div");
  dialog.id = "bs-help-modal";
  document.body.appendChild(dialog);
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.classList.remove("show"); });

  // mount steps modal
  const steps = document.createElement("div");
  steps.id = "bs-steps-modal";
  document.body.appendChild(steps);
  steps.addEventListener("click", e => { if (e.target === steps) steps.classList.remove("show"); });

  // mount AI modal
  const aim = document.createElement("div");
  aim.id = "bs-help-ai-modal";
  document.body.appendChild(aim);
  aim.addEventListener("click", e => { if (e.target === aim) aim.classList.remove("show"); });

  updateHelpButtonState();
}

function openHelpDialog() {
  const help = PAGE_HELP[_currentRoute] || GENERIC_HELP;
  const dialog = document.getElementById("bs-help-modal");
  dialog.querySelector(".panel")?.remove();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <h3>🎓 ช่วยเหลือ</h3>
    <div class="sub">หน้าปัจจุบัน: <b>${escHtml(help.title)}</b></div>

    <div class="opt" data-act="steps">
      <div class="opt-icon">📖</div>
      <div class="opt-body">
        <div>วิธีใช้หน้านี้</div>
        <div class="opt-desc">อ่านขั้นตอนการใช้งาน 1-2-3</div>
      </div>
    </div>

    <div class="opt" data-act="tour">
      <div class="opt-icon">🎯</div>
      <div class="opt-body">
        <div>เริ่ม Tour แบบ Interactive</div>
        <div class="opt-desc">ระบบไฮไลท์ปุ่มสำคัญทีละจุด</div>
      </div>
    </div>

    <div class="opt" data-act="ai">
      <div class="opt-icon">🤖</div>
      <div class="opt-body">
        <div>ถาม AI</div>
        <div class="opt-desc">พิมพ์คำถามเกี่ยวกับหน้านี้ได้เลย</div>
      </div>
    </div>

    <button id="bs-help-close">ปิด</button>
  `;
  dialog.appendChild(panel);
  dialog.classList.add("show");
  panel.querySelector("#bs-help-close").addEventListener("click", () => dialog.classList.remove("show"));
  panel.querySelectorAll(".opt").forEach(el => el.addEventListener("click", () => {
    const act = el.dataset.act;
    dialog.classList.remove("show");
    markSeen(_currentRoute);
    updateHelpButtonState();
    if (act === "steps") openStepsModal();
    else if (act === "tour") startTour();
    else if (act === "ai") openAIChat();
  }));
}

function openStepsModal() {
  const help = PAGE_HELP[_currentRoute] || GENERIC_HELP;
  const m = document.getElementById("bs-steps-modal");
  m.querySelector(".panel")?.remove();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <h3>${escHtml(help.title)}</h3>
    <div class="intro">${escHtml(help.intro || "")}</div>
    <ol>
      ${(help.steps || []).map(s => `<li>${escHtml(s)}</li>`).join("")}
    </ol>
    ${(help.tips || []).length > 0 ? `
      <div class="tips">
        <div class="tips-title">💡 เคล็ดลับ</div>
        <ul>${help.tips.map(t => `<li>${escHtml(t)}</li>`).join("")}</ul>
      </div>
    ` : ""}
    <button id="bs-steps-close" style="width:100%;margin-top:16px;padding:12px;border:none;background:#0284c7;color:#fff;border-radius:8px;cursor:pointer;font-weight:700">เข้าใจแล้ว ✓</button>
  `;
  m.appendChild(panel);
  m.classList.add("show");
  panel.querySelector("#bs-steps-close").addEventListener("click", () => m.classList.remove("show"));
}

// ═══════════════════════════════════════════════════════════
// TOUR — interactive spotlight + tooltip
// ═══════════════════════════════════════════════════════════
function startTour() {
  const help = PAGE_HELP[_currentRoute];
  const tour = (help?.tour || []);
  if (tour.length === 0) {
    // ถ้าไม่มี tour เฉพาะหน้า → ใช้ steps แทน
    openStepsModal();
    return;
  }
  let idx = 0;
  showTourStep(tour, idx);
}

function showTourStep(tour, idx) {
  cleanupTour();
  if (idx >= tour.length) return;
  const step = tour[idx];
  const target = document.querySelector(step.selector);
  if (!target) {
    // skip ถ้าหา element ไม่เจอ
    showTourStep(tour, idx + 1);
    return;
  }
  const rect = target.getBoundingClientRect();
  const pad = 8;

  // Overlay with cutout
  const overlay = document.createElement("div");
  overlay.id = "bs-tour-overlay";
  overlay.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <mask id="bs-tour-mask">
          <rect width="100%" height="100%" fill="white"/>
          <rect x="${rect.left - pad}" y="${rect.top - pad}" width="${rect.width + pad*2}" height="${rect.height + pad*2}" rx="8" fill="black"/>
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#bs-tour-mask)"/>
      <rect x="${rect.left - pad}" y="${rect.top - pad}" width="${rect.width + pad*2}" height="${rect.height + pad*2}" rx="8" fill="none" stroke="#fbbf24" stroke-width="3"/>
    </svg>
  `;
  document.body.appendChild(overlay);

  const tip = document.createElement("div");
  tip.id = "bs-tour-tip";
  // วาง tooltip ใต้ element ถ้าพอ ไม่งั้นวางบน
  const tipTop = (rect.bottom + 240 < window.innerHeight) ? (rect.bottom + 12) : Math.max(8, rect.top - 200);
  const tipLeft = Math.min(Math.max(8, rect.left), window.innerWidth - 340);
  tip.style.top = tipTop + "px";
  tip.style.left = tipLeft + "px";
  tip.innerHTML = `
    <div class="tip-progress">${idx + 1} / ${tour.length}</div>
    <div class="tip-text">${escHtml(step.text)}</div>
    <div class="tip-actions">
      <button id="bs-tour-skip">ข้าม</button>
      ${idx > 0 ? `<button id="bs-tour-prev">← ก่อนหน้า</button>` : ""}
      <button id="bs-tour-next" class="primary">${idx === tour.length - 1 ? "เสร็จ ✓" : "ถัดไป →"}</button>
    </div>
  `;
  document.body.appendChild(tip);

  document.getElementById("bs-tour-skip").addEventListener("click", cleanupTour);
  document.getElementById("bs-tour-next").addEventListener("click", () => showTourStep(tour, idx + 1));
  document.getElementById("bs-tour-prev")?.addEventListener("click", () => showTourStep(tour, idx - 1));
  // overlay click = ข้าม
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.tagName === "rect") cleanupTour(); });
}

function cleanupTour() {
  document.getElementById("bs-tour-overlay")?.remove();
  document.getElementById("bs-tour-tip")?.remove();
}

// ═══════════════════════════════════════════════════════════
// AI CHAT — context-aware (รู้ว่า user อยู่หน้าไหน)
// ═══════════════════════════════════════════════════════════
function openAIChat() {
  const help = PAGE_HELP[_currentRoute] || GENERIC_HELP;
  const m = document.getElementById("bs-help-ai-modal");
  m.querySelector(".panel")?.remove();

  const suggestions = [
    "หน้านี้ใช้ทำอะไร?",
    "ขั้นตอนการใช้คืออะไร?",
    "มี keyboard shortcut มั้ย?",
    "ถ้าทำผิด แก้ยังไง?"
  ];

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <h3>🤖 AI ช่วยตอบเรื่อง: ${escHtml(help.title)}</h3>
    <div class="sub">พิมพ์คำถามได้เลย — AI รู้ว่าคุณอยู่หน้าไหน</div>
    <div id="bs-help-ai-msgs">
      <div class="msg ai">สวัสดีครับ! ผมช่วยตอบคำถามเกี่ยวกับ <b>${escHtml(help.title)}</b> ได้นะครับ ถามได้เลย 😊</div>
    </div>
    <div id="bs-help-ai-suggest">
      ${suggestions.map(s => `<span class="chip">${escHtml(s)}</span>`).join("")}
    </div>
    <div id="bs-help-ai-input">
      <input id="bs-help-ai-q" type="text" placeholder="พิมพ์คำถาม..." />
      <button id="bs-help-ai-send">ส่ง</button>
    </div>
    <button id="bs-help-ai-close" style="width:100%;margin-top:8px;padding:8px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;cursor:pointer;font-size:12px;color:#475569">ปิด</button>
  `;
  m.appendChild(panel);
  m.classList.add("show");

  const inp = panel.querySelector("#bs-help-ai-q");
  const send = panel.querySelector("#bs-help-ai-send");
  const msgs = panel.querySelector("#bs-help-ai-msgs");
  setTimeout(() => inp?.focus(), 80);

  panel.querySelector("#bs-help-ai-close").addEventListener("click", () => m.classList.remove("show"));

  panel.querySelectorAll("#bs-help-ai-suggest .chip").forEach(c => c.addEventListener("click", () => {
    inp.value = c.textContent;
    send.click();
  }));

  async function ask(q) {
    if (!q || !q.trim()) return;
    msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${escHtml(q)}</div>`);
    msgs.scrollTop = msgs.scrollHeight;
    inp.value = "";
    send.disabled = true; send.textContent = "...";
    msgs.insertAdjacentHTML("beforeend", `<div class="msg ai" id="bs-ai-typing">⏳ กำลังคิด...</div>`);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      // Build helpContext from PAGE_HELP — ส่งให้ /api/ai-assistant ในโหมด help
      const helpContextStr = `หน้า: "${help.title}" (route: ${_currentRoute})
${help.intro || ""}

ขั้นตอนใช้งาน:
${(help.steps || []).map((s, i) => `${i+1}. ${s}`).join("\n")}

เคล็ดลับ:
${(help.tips || []).join("\n")}`;

      // Build conversation history จาก DOM (ข้าม system greeting อันแรก)
      const allMsgs = msgs.querySelectorAll(".msg");
      const history = [];
      allMsgs.forEach((m, idx) => {
        if (idx === 0) return; // skip greeting
        if (m.id === "bs-ai-typing") return;
        history.push({
          role: m.classList.contains("user") ? "user" : "assistant",
          content: m.textContent.trim()
        });
      });
      // ตัด user message ที่เพิ่งเพิ่มออก (ไม่ต้องส่งใน history เพราะมันคือ message ปัจจุบัน)
      if (history.length > 0 && history[history.length - 1].role === "user") {
        history.pop();
      }

      const token = window._sbAccessToken;
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = "Bearer " + token;

      const r = await fetch("/api/ai-assistant", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: q,
          mode: "help",
          helpContext: helpContextStr,
          history: history.slice(-6) // เก็บแค่ 6 turn ล่าสุด
        })
      });
      document.getElementById("bs-ai-typing")?.remove();
      if (!r.ok) {
        let errText;
        if (r.status === 429) errText = "⚠️ ถามบ่อยเกินไป — รอสักครู่";
        else if (r.status === 401) errText = "⚠️ ต้อง login ก่อนถาม AI (Bearer token หาย)";
        else if (r.status === 400) errText = "⚠️ Request format ผิด — แจ้ง dev";
        else errText = `⚠️ ผิดพลาด (HTTP ${r.status})`;
        try {
          const errBody = await r.json();
          if (errBody?.error) errText += ": " + errBody.error;
        } catch(e){}
        msgs.insertAdjacentHTML("beforeend", `<div class="msg ai">${escHtml(errText)}</div>`);
      } else {
        const data = await r.json();
        const reply = data?.reply || data?.message || data?.content || "(ไม่มีคำตอบ)";
        msgs.insertAdjacentHTML("beforeend", `<div class="msg ai">${escHtml(reply)}</div>`);
      }
      msgs.scrollTop = msgs.scrollHeight;
    } catch(e) {
      document.getElementById("bs-ai-typing")?.remove();
      msgs.insertAdjacentHTML("beforeend", `<div class="msg ai">⚠️ ติดต่อ AI ไม่ได้: ${escHtml(e?.message || String(e))}</div>`);
    } finally {
      send.disabled = false; send.textContent = "ส่ง";
      inp.focus();
    }
  }

  send.addEventListener("click", () => ask(inp.value));
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(inp.value); } });
}
