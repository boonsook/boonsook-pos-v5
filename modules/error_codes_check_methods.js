// ═══════════════════════════════════════════════════════════
//  ERROR CODE CHECK METHODS — วิธีเช็ค Error Code แต่ละยี่ห้อ
//  รวบรวมจากคู่มือมาตรฐานช่าง + TATA reference
//  Phase 58 (1 พ.ค. 2026)
// ═══════════════════════════════════════════════════════════
//
//  Format:
//    BRAND_NAME: {
//      summary: "สรุปวิธีอ่านโค้ดสั้นๆ 1-2 ประโยค",
//      steps:   ["ขั้นตอน 1", "ขั้นตอน 2", ...],
//      tip:     "หมายเหตุพิเศษ" (optional)
//    }
//
//  Brand keys ต้องตรงกับใน error_codes.js (case-sensitive)

export const CHECK_METHODS = {
  "Daikin": {
    summary: "ใช้รีโมทไร้สาย กดปุ่ม CANCEL/CHECK ค้าง 5 วินาที — เครื่องจะเข้าโหมด self-diagnosis",
    steps: [
      "หันรีโมทไปที่ตัวในแอร์",
      "กดปุ่ม CANCEL ค้าง ~5 วินาที (รุ่นเก่ากด CHECK)",
      "หน้าจอรีโมทแสดง '00' = เข้าโหมดเช็คแล้ว",
      "กด TEMP ↑ หรือ ↓ เพื่อเลื่อนรหัส (00 → A1 → A3 → ...)",
      "เมื่อเครื่องร้อง beep ยาว = รหัสตรงกับ Error ที่เกิด",
      "กด ON/OFF เพื่อออกจากโหมดเช็ค"
    ],
    tip: "ถ้าไม่ได้ยิน beep แสดงว่าเครื่องอาจอยู่ในสภาพปกติ — ลองเช็คคอยล์ร้อนสกปรก/ฟิลเตอร์ก่อน"
  },
  "Mitsubishi Electric": {
    summary: "ดูจาก LED ที่ตัวใน — Power LED + Operation LED จะกะพริบเป็นรหัส",
    steps: [
      "เปิดเครื่องแล้วสังเกต LED ที่ตัวใน (Indoor unit)",
      "นับจำนวนครั้งที่ Operation LED กะพริบ → ตามด้วย Timer LED",
      "ตัวอย่าง: Operation 2 ครั้ง + Timer 5 ครั้ง = E25",
      "รุ่นที่มีรีโมทแบบมีจอ (Wired): กด CHECK ค้าง 3 วิ → จอแสดงรหัส",
      "รุ่น Mr.Slim: ดู LED Inspection ที่แผง PCB ตัวนอก"
    ],
    tip: "นับ LED ระหว่างกะพริบ — ถ้ากะพริบเร็ว 0.5 วิ = แสดงรหัส, ช้า 1 วิ = แยกเลขสิบ-เลขหลัก"
  },
  "Mitsubishi Heavy": {
    summary: "ดู LED Run + LED Timer ที่ตัวใน — กะพริบเป็นรหัสเลข",
    steps: [
      "สังเกต LED Run + Timer ที่ตัวใน",
      "Run กะพริบ N ครั้ง → หยุด → Timer กะพริบ M ครั้ง",
      "อ่านเป็น E[N][M] เช่น Run 1 + Timer 2 = E12",
      "รีเซ็ตแอร์: ถอดปลั๊ก 30 วิ → เสียบใหม่"
    ],
    tip: "บางรุ่นเชื่อม Wireless รีโมท → กด CHECK บนรีโมทค้างจนเข้าโหมด diag"
  },
  "Samsung": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — รุ่นเก่า ดู LED กะพริบ",
    steps: [
      "เปิดแอร์ — ถ้ามี Error → จอตัวในแสดงรหัส E1, E2, ... อัตโนมัติ",
      "รุ่นไม่มีจอ: ดู Power/Timer LED ที่ตัวใน",
      "ถอดปลั๊ก 30 วินาที → เสียบใหม่ → ถ้ารหัสกลับมา = Error จริง"
    ]
  },
  "LG": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — รุ่นใหม่มีไฟ LED 7-segment",
    steps: [
      "ดูที่จอตัวใน — แสดง CH01, CH02, ... อัตโนมัติเมื่อมี Error",
      "รุ่น Inverter: ดูที่ตัวนอก → ไฟ LED 1, LED 2 บนแผง PCB กะพริบ",
      "นับจำนวนครั้งกะพริบ + เทียบตารางรหัส"
    ],
    tip: "LG Dual Cool: กด TEMP ↑ + ↓ บนรีโมท พร้อมกัน 5 วิ → จอแสดงรหัส"
  },
  "Haier": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — รุ่นเก่าใช้ LED กะพริบ",
    steps: [
      "ดูที่จอตัวใน — ขึ้น E0, E1, F1, ... อัตโนมัติ",
      "รุ่น LED: นับ Power LED กะพริบ → จำนวนครั้ง = รหัส",
      "Inverter: ดูที่ Display Board ตัวนอก แสดงรหัส 2 หลัก"
    ]
  },
  "Carrier": {
    summary: "ใช้ปลายดินสอ/เข็ม กดปุ่ม CHECK ที่รีโมท → เข้า Service Mode",
    steps: [
      "ใช้ของแหลม (ปลายดินสอ) กดปุ่ม CHECK บนรีโมท",
      "หน้าจอแสดง '00' = เข้า Service Mode แล้ว",
      "กด TEMP เพื่อเลื่อนรหัส (00 → 01 → ... → 33 รวม 52 รหัส)",
      "ถ้าได้ยิน 'beep beep...' ติดต่อกัน ~10 วินาที + ไฟทุกดวงกะพริบเร็ว = รหัสนั้นคือ Error",
      "กด CLEAR เพื่อล้าง memory (จอแสดง '7F')",
      "กด Start/Stop เพื่อออก"
    ],
    tip: "บันทึกรหัสไว้ก่อนล้าง memory — ช่างต้องใช้ดู history"
  },
  "Panasonic": {
    summary: "กดปุ่ม CHECK บนรีโมทค้าง 5 วินาที → เข้าโหมด diagnosis (Phase 64: verified จาก PDF source)",
    steps: [
      "เปิดเครื่อง — เมื่อมี Error → ไฟ TIMER จะกะพริบ",
      "หาปุ่ม CHECK บนรีโมท (อาจอยู่ใต้ฝา หรือเป็น 'CHK')",
      "กดปุ่ม CHECK ค้าง ~5 วินาที → จอแสดงรหัส H00",
      "กด ▲ หรือ ▼ เพื่อเลื่อนรหัส (H00 → H11 → H12 → ... → F11/F90/F99)",
      "เมื่อกด ▲/▼ แล้วเครื่อง beep ยาว + รหัสค้าง = รหัสนั้นคือ Error ที่เกิด",
      "บันทึกรหัส แล้วกด CHECK อีกครั้งเพื่อออก",
      "Reset เครื่อง: กดปุ่ม AUTO ON/OFF ที่ตัวเครื่องค้าง 5 วินาที"
    ],
    tip: "รหัส H = Indoor errors, F = Outdoor/Inverter — H00 = ปกติ ไม่มี Error"
  },
  "TCL": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ",
    steps: [
      "เปิดแอร์ — Error แสดงที่จอตัวในเลย เช่น E0, E5, F1",
      "ถ้าไม่มีจอ: ดู Power LED กะพริบนับครั้ง"
    ]
  },
  "Hitachi": {
    summary: "นับ LED Run + LED Timer กะพริบ — รหัส E[Run][Timer]",
    steps: [
      "สังเกต LED Run + LED Timer ที่ตัวใน",
      "Run กะพริบ N ครั้ง → Timer กะพริบ M ครั้ง",
      "รหัส = E[N][M] เช่น Run 0 + Timer 1 = E01",
      "รุ่นที่มี Wired Remote: เช็คผ่านเมนู Service บนรีโมท"
    ]
  },
  "Toshiba": {
    summary: "กด CHECK บนรีโมท → จอแสดงรหัส",
    steps: [
      "กดปุ่ม CHECK บนรีโมท (รุ่นใหม่) หรือ TEST (รุ่นเก่า)",
      "หน้าจอจะแสดงรหัส F-XX, P-XX, E-XX",
      "บางรุ่นต้องกด CHECK ค้าง 3 วินาที"
    ]
  },
  "Sharp": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — รุ่นเก่าดู LED",
    steps: [
      "ดูที่จอตัวใน — แสดงรหัสเลย เช่น E1, F2",
      "ไม่มีจอ: นับ LED Run กะพริบ",
      "รุ่น Plasmacluster: LED แต่ละสีบอก Error คนละแบบ — ดูคู่มือ"
    ]
  },
  "Gree": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — รุ่นรีโมทมีจอเช็คได้",
    steps: [
      "ดูที่จอตัวใน — แสดง E1, E5, F1, ... อัตโนมัติ",
      "รีโมทรุ่น YAA1FB: กด VERTICAL + HORIZONTAL พร้อมกัน 3 วิ → เข้า diag",
      "Inverter: ดูแผง PCB ตัวนอก → จอ 7-segment แสดงรหัส"
    ]
  },
  "Midea": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ",
    steps: [
      "ดูที่จอตัวใน — Error code ขึ้นเลยเมื่อเปิดเครื่อง",
      "รีเซ็ต: ถอดปลั๊ก 30 วิ → เสียบใหม่",
      "ถ้ารหัสกลับมา = Error จริง — ติดต่อช่าง"
    ]
  },
  "Fujitsu / General": {
    summary: "นับ LED Operation + LED Timer กะพริบ",
    steps: [
      "สังเกต Operation LED + Timer LED ที่ตัวใน",
      "Operation กะพริบ N ครั้ง → Timer กะพริบ M ครั้ง → ทำซ้ำ",
      "รหัส = [N]:[M] เช่น 1:2",
      "Wired Remote: กด ENERGY SAVE + ZONE CONTROL พร้อมกัน 5 วิ"
    ]
  },
  "Hisense": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ",
    steps: [
      "ดูที่จอตัวใน — แสดง E1, E2, ..., F1, F2 อัตโนมัติ",
      "ไม่มีจอ: ดู LED กะพริบ"
    ]
  },
  "York": {
    summary: "ดู LED ที่ตัวใน — กะพริบเป็นรหัส",
    steps: [
      "นับ LED Run/Power กะพริบที่ตัวใน",
      "รุ่นรีโมทมีจอ: กด TIMER ค้าง 5 วิ → จอแสดงรหัส",
      "บางรุ่นต้องเปิด Service Cover ที่ตัวนอก → ดู 7-segment display"
    ]
  },
  "Saijo Denki": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ",
    steps: [
      "Error ขึ้นที่จอตัวในอัตโนมัติ",
      "รีเซ็ต: ถอดปลั๊ก 30 วิ"
    ]
  },
  "Central Air": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ",
    steps: [
      "ดูที่จอตัวใน — แสดง E0, E1, ..., F1, F2 อัตโนมัติ",
      "ไม่มีจอ: ดู Power LED กะพริบที่ตัวใน",
      "รีเซ็ต: ถอดปลั๊ก 30 วิ → เสียบใหม่"
    ]
  },

  // ═══════════════════════════════════════════════════════════
  // Phase 59 — เพิ่ม 4 brands ใหม่ (Tasaki / Mavell / Trane)
  // ═══════════════════════════════════════════════════════════

  "Tasaki (ติดผนัง)": {
    summary: "นับจำนวนครั้งที่ Operation Lamp กะพริบ — เทียบตารางรหัส E/F/P",
    steps: [
      "เปิดเครื่อง — ถ้ามี Error → Operation Lamp จะกะพริบเป็นรูปแบบ",
      "นับจำนวนครั้งที่กะพริบ (1 ครั้ง / 2 ครั้ง / 3 ครั้ง ...)",
      "เทียบกับรหัสในตาราง: 1 ครั้ง = E0, 2 ครั้ง = E1, 3 ครั้ง = E2, ...",
      "รหัสกลุ่ม F (F0, F1, F2, ...) มาจาก Operation Lamp ของอีกชุด — ตรวจอีกครั้ง",
      "รุ่นที่รองรับ: FWDE-I-AF1, FWDE-AF2"
    ],
    tip: "นับช่วงกะพริบให้ครบ 1 รอบเต็ม — รอ 5 วินาทีเพื่อให้แน่ใจว่ารหัสเดียวกันซ้ำ"
  },
  "Tasaki (แขวน/ตู้ตั้ง)": {
    summary: "ดูสัญญาณไฟ POWER + TIMER กะพริบ — แต่ละแบบ = รหัส E1/E6/E8",
    steps: [
      "POWER กะพริบต่อเนื่อง = E1 (Freeze / Anti-ice)",
      "POWER กะพริบ 2 ครั้ง หยุดเป็นจังหวะ = E6 (Cooling Fail)",
      "TIMER กะพริบต่อเนื่อง = E8 (Sensor Error)",
      "รุ่นที่รองรับ: FUL-B-AD1, FULT-B-AD1, FULE-B-AD2, FULE-B-AF2"
    ],
    tip: "Sensor Error (E8) — เครื่องจะเปิด-ปิดเป็นช่วงๆ (10 นาที ON / 5 นาที OFF) เพื่อความปลอดภัย"
  },
  "Mavell": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — แบ่งเป็นโหมด F (outdoor) / E (indoor) / P (protect)",
    steps: [
      "ดูที่จอตัวใน — แสดง F0, F1, F3, ... (outdoor faults)",
      "หรือแสดง E0, E1, E2, ... (indoor sensor faults)",
      "หรือ P3, P4, P8 (protection mode)",
      "เทียบรหัสในตาราง — แต่ละโหมดมีลำดับการตรวจที่ต่างกัน"
    ],
    tip: "ถ้าเซ็นเซอร์ผิดปกติ — ตรวจ PCB Board ก่อนเปลี่ยน sensor"
  },
  "Trane": {
    summary: "หน้าจอตัวในแสดงรหัสอัตโนมัติ — รุ่น MCWA09/12/18BB5 ติดผนัง",
    steps: [
      "ดูที่จอตัวใน — แสดงรหัส E1-E8, F1-F5, H3-H6, PH, U5, EE",
      "รหัส E = ระบบทำงาน (Operation): HP cut, Anti-ice, Communication",
      "รหัส F = Sensor faults (Room/Tube/Ambient)",
      "รหัส H = Hardware (Compressor/IPM/Motor)",
      "EE = EEPROM error — เปลี่ยน Controller CDU",
      "รีเซ็ต: ถอดปลั๊ก 30 วิ → เสียบใหม่"
    ],
    tip: "ถ้า E8 (CDU Ambient ≥ 53°C) — ตรวจการระบายความร้อนตัวนอกเป็นอันดับแรก"
  }
};

/**
 * Render check method panel HTML — ใช้ใน error_codes_shared.js
 * @param {string} brand - Brand name (case-sensitive)
 * @returns {string} HTML or empty string ถ้าไม่มีข้อมูลแบรนด์นั้น
 */
export function renderCheckMethod(brand) {
  if (!brand) return "";
  const m = CHECK_METHODS[brand];
  if (!m) return "";

  // Local escape (ไม่ import เพราะอยากให้ self-contained)
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  return `
    <div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1px solid #bfdbfe;border-radius:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:20px">🔍</span>
        <h4 style="margin:0;color:#1e40af;font-size:15px">วิธีเช็ค Error Code — ${esc(brand)}</h4>
      </div>
      <div style="font-size:13px;color:#1e3a8a;margin-bottom:10px;font-style:italic">${esc(m.summary)}</div>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#1f2937;line-height:1.7">
        ${m.steps.map(s => `<li>${esc(s)}</li>`).join("")}
      </ol>
      ${m.tip ? `<div style="margin-top:10px;padding:8px 10px;background:#fef3c7;border-radius:8px;font-size:12px;color:#78350f"><b>💡 Tip:</b> ${esc(m.tip)}</div>` : ""}
    </div>
  `;
}
