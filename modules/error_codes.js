// ═══════════════════════════════════════════════════════════
//  ERROR CODES — ค้นหารหัสข้อผิดพลาดแอร์ตามยี่ห้อ
// ═══════════════════════════════════════════════════════════

const ERROR_DB = {
  "Daikin": {
    "E0": { desc: "ระบบป้องกันคอมเพรสเซอร์ทำงาน", cause: "แรงดันไฟต่ำ / สายไฟหลวม", fix: "ตรวจสอบแรงดันไฟฟ้า, เช็คสายไฟเข้าคอมเพรสเซอร์" },
    "E1": { desc: "แผงวงจร PCB ผิดพลาด", cause: "แผงควบคุมเสีย", fix: "เปลี่ยนแผง PCB ตัวใน" },
    "E3": { desc: "เซ็นเซอร์แรงดันสูงทำงาน", cause: "น้ำยาแอร์อุดตัน / พัดลมคอยล์ร้อนไม่หมุน", fix: "ตรวจพัดลมคอยล์ร้อน, ล้างคอยล์ร้อน" },
    "E4": { desc: "เซ็นเซอร์แรงดันต่ำทำงาน", cause: "น้ำยาแอร์รั่ว / น้ำยาน้อย", fix: "เช็ครอยรั่ว, เติมน้ำยาแอร์" },
    "E5": { desc: "ป้องกันคอมเพรสเซอร์ร้อนเกิน", cause: "คอมเพรสเซอร์ร้อนจัด", fix: "ล้างคอยล์ร้อน, ตรวจพัดลม, เช็คน้ำยา" },
    "E6": { desc: "มอเตอร์พัดลมคอยล์เย็นล็อค", cause: "มอเตอร์พัดลมเสีย / ฝุ่นอุดตัน", fix: "ล้างคอยล์เย็น, เปลี่ยนมอเตอร์พัดลม" },
    "E7": { desc: "มอเตอร์พัดลมคอยล์ร้อนล็อค", cause: "มอเตอร์คอยล์ร้อนเสีย", fix: "เปลี่ยนมอเตอร์พัดลมคอยล์ร้อน" },
    "E9": { desc: "วาล์วสลับทิศผิดพลาด", cause: "วาล์วสี่ทางเสีย", fix: "เปลี่ยนวาล์วสี่ทาง (4-way valve)" },
    "F3": { desc: "อุณหภูมิท่อทางออกสูงเกิน", cause: "น้ำยาน้อย / คอยล์ร้อนสกปรก", fix: "เช็คน้ำยา, ล้างคอยล์ร้อน" },
    "F6": { desc: "เซ็นเซอร์อุณหภูมิคอยล์เย็นผิดปกติ", cause: "เซ็นเซอร์เสีย / สายหลุด", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิ" },
    "H6": { desc: "เซ็นเซอร์ตรวจจับตำแหน่งคอมเพรสเซอร์", cause: "คอมเพรสเซอร์ผิดปกติ", fix: "ตรวจสอบคอมเพรสเซอร์, อาจต้องเปลี่ยน" },
    "J3": { desc: "เซ็นเซอร์ท่อทางกลับผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ท่อทางกลับ" },
    "L5": { desc: "กระแสไฟเกิน (overcurrent)", cause: "คอมเพรสเซอร์กินไฟเกิน", fix: "ตรวจคอมเพรสเซอร์, เช็คไฟเข้า" },
    "U0": { desc: "น้ำยาแอร์น้อย / ไม่เพียงพอ", cause: "น้ำยารั่ว", fix: "หารอยรั่ว, เติมน้ำยา R32/R410A" },
    "U4": { desc: "สัญญาณสื่อสารระหว่างตัวใน-นอกผิดพลาด", cause: "สายสัญญาณขาด / หลวม", fix: "เช็คสายสัญญาณ 3 เส้นระหว่างตัวใน-นอก" }
  },
  "Mitsubishi Electric": {
    "E1": { desc: "รีโมทคอนโทรลผิดพลาด", cause: "รีโมทเสีย / สัญญาณรบกวน", fix: "เปลี่ยนแบตรีโมท, รีเซ็ตรีโมท" },
    "E6": { desc: "สัญญาณสื่อสารตัวใน-นอกผิดพลาด", cause: "สายสัญญาณมีปัญหา", fix: "ตรวจสายสัญญาณ, เช็คแผง PCB" },
    "E9": { desc: "สัญญาณสื่อสารระหว่างตัวใน", cause: "สายสัญญาณระหว่างตัวในขาด", fix: "เช็คสายเชื่อมต่อระหว่างตัวใน (Multi)" },
    "P1": { desc: "เซ็นเซอร์ดูดกลับผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์ดูดกลับ" },
    "P2": { desc: "เซ็นเซอร์คอยล์เย็นผิดปกติ", cause: "เทอร์มิสเตอร์คอยล์เย็นเสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "P4": { desc: "เซ็นเซอร์ท่อน้ำทิ้งผิดปกติ", cause: "ท่อน้ำทิ้งอุดตัน / เซ็นเซอร์เสีย", fix: "ล้างท่อน้ำทิ้ง, เปลี่ยนเซ็นเซอร์" },
    "P5": { desc: "ปั๊มน้ำทิ้งผิดปกติ", cause: "ปั๊มน้ำทิ้งเสีย", fix: "เปลี่ยนปั๊มน้ำทิ้ง (drain pump)" },
    "P8": { desc: "เซ็นเซอร์ท่อคอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์ร้อน" },
    "U1": { desc: "แรงดันไฟเกิน / ขาดเฟส", cause: "ไฟฟ้าไม่เสถียร", fix: "ตรวจแรงดันไฟ, ติดตั้งเครื่องปรับแรงดัน" },
    "U2": { desc: "เซ็นเซอร์อุณหภูมิคอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย / น้ำยาน้อย", fix: "เปลี่ยนเทอร์มิสเตอร์, เช็คน้ำยา" },
    "U3": { desc: "สวิตช์แรงดันสูงทำงาน (HP)", cause: "น้ำยามาก / คอยล์ร้อนสกปรก", fix: "ล้างคอยล์ร้อน, ปล่อยน้ำยาส่วนเกิน" },
    "U4": { desc: "สวิตช์แรงดันต่ำทำงาน (LP)", cause: "น้ำยาน้อย / ท่อตัน", fix: "เช็ครอยรั่ว, เติมน้ำยา" }
  },
  "Mitsubishi Heavy": {
    "E1": { desc: "รีโมทสัญญาณผิดพลาด", cause: "รีโมทเสีย / รับสัญญาณไม่ได้", fix: "เปลี่ยนรีโมท, เช็คตัวรับสัญญาณ" },
    "E3": { desc: "เซ็นเซอร์ห้องผิดปกติ", cause: "เทอร์มิสเตอร์ห้องเสีย", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิห้อง" },
    "E4": { desc: "เซ็นเซอร์คอยล์เย็นลัดวงจร / ขาด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "E9": { desc: "ถาดน้ำทิ้งเต็ม / ท่อน้ำอุดตัน", cause: "น้ำไม่ระบาย", fix: "ล้างถาดน้ำทิ้ง, เป่าท่อน้ำทิ้ง" },
    "E32": { desc: "คอมเพรสเซอร์ร้อนเกิน (OLP)", cause: "น้ำยาน้อย / คอยล์สกปรก", fix: "เช็คน้ำยา, ล้างคอยล์ร้อน" },
    "E35": { desc: "แรงดันสูงเกิน (HP)", cause: "คอยล์ร้อนสกปรก / พัดลมเสีย", fix: "ล้างคอยล์ร้อน, ตรวจพัดลมคอยล์ร้อน" },
    "E36": { desc: "อุณหภูมิท่อทางออกสูง", cause: "น้ำยาน้อย", fix: "เช็ครอยรั่ว, เติมน้ำยา" },
    "E38": { desc: "เซ็นเซอร์คอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์ร้อน" }
  },
  "Samsung": {
    "E101": { desc: "สัญญาณสื่อสารตัวใน-นอกผิดพลาด", cause: "สายสัญญาณหลวม / ขาด", fix: "ตรวจสายสัญญาณระหว่างตัวใน-นอก" },
    "E121": { desc: "เซ็นเซอร์อุณหภูมิห้องผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิห้อง" },
    "E122": { desc: "เซ็นเซอร์คอยล์เย็นผิดปกติ", cause: "เทอร์มิสเตอร์คอยล์เย็นเสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "E154": { desc: "พัดลมตัวในผิดปกติ", cause: "มอเตอร์พัดลมเสีย", fix: "เปลี่ยนมอเตอร์พัดลมตัวใน" },
    "E201": { desc: "สัญญาณสื่อสารตัวนอกผิดพลาด", cause: "แผง PCB ตัวนอกเสีย", fix: "เปลี่ยนแผง PCB ตัวนอก" },
    "E301": { desc: "เซ็นเซอร์อุณหภูมิตัวนอกผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิตัวนอก" },
    "E401": { desc: "กระแสไฟเกิน (overcurrent)", cause: "คอมเพรสเซอร์ผิดปกติ", fix: "ตรวจคอมเพรสเซอร์, เช็คแรงดันไฟ" },
    "E416": { desc: "เซ็นเซอร์ท่อทางออกผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์ท่อทางออก" },
    "E440": { desc: "แรงดันสูงเกิน (HP)", cause: "น้ำยามาก / คอยล์สกปรก", fix: "ล้างคอยล์ร้อน, ปล่อยน้ำยา" },
    "E441": { desc: "แรงดันต่ำเกิน (LP)", cause: "น้ำยาน้อย / ท่อตัน", fix: "เช็ครอยรั่ว, เติมน้ำยา" }
  },
  "LG": {
    "CH01": { desc: "เซ็นเซอร์อุณหภูมิห้องผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิห้อง" },
    "CH02": { desc: "เซ็นเซอร์คอยล์เย็นผิดปกติ", cause: "เทอร์มิสเตอร์คอยล์เย็นเสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "CH05": { desc: "เซ็นเซอร์คอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์ร้อน" },
    "CH09": { desc: "เซ็นเซอร์ท่อทางออกผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์ท่อทางออก" },
    "CH10": { desc: "กระแสไฟเกิน (COMP overcurrent)", cause: "คอมเพรสเซอร์กินไฟมาก", fix: "ตรวจคอมเพรสเซอร์, เช็คแรงดันไฟ" },
    "CH21": { desc: "อินเวอร์เตอร์คอมเพรสเซอร์ DC ผิดปกติ", cause: "แผงอินเวอร์เตอร์เสีย", fix: "เปลี่ยนแผง IPM (อินเวอร์เตอร์)" },
    "CH22": { desc: "กระแส CT ผิดปกติ", cause: "CT เซ็นเซอร์เสีย", fix: "เปลี่ยน CT เซ็นเซอร์" },
    "CH32": { desc: "แรงดันสูงเกิน (HP)", cause: "คอยล์ร้อนสกปรก / น้ำยามาก", fix: "ล้างคอยล์ร้อน, ปล่อยน้ำยา" },
    "CH38": { desc: "เซ็นเซอร์อุณหภูมิอากาศภายนอก", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิอากาศภายนอก" },
    "CH44": { desc: "แรงดันต่ำเกิน (LP)", cause: "น้ำยาน้อย / ท่อตัน", fix: "เช็ครอยรั่ว, เติมน้ำยา" }
  },
  "Haier": {
    "E1": { desc: "เซ็นเซอร์อุณหภูมิห้องผิดปกติ", cause: "เทอร์มิสเตอร์เสีย / สายขาด", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิห้อง" },
    "E2": { desc: "เซ็นเซอร์คอยล์เย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "E4": { desc: "ระบบละลายน้ำแข็งผิดพลาด", cause: "น้ำแข็งเกาะหนา / เซ็นเซอร์เสีย", fix: "ล้างคอยล์เย็น, เช็คเซ็นเซอร์" },
    "E5": { desc: "แรงดันสูงเกิน (HP)", cause: "คอยล์ร้อนสกปรก / น้ำยามาก", fix: "ล้างคอยล์ร้อน" },
    "E6": { desc: "สัญญาณสื่อสารตัวใน-นอกผิดพลาด", cause: "สายสัญญาณหลวม", fix: "เช็คสายสัญญาณ" },
    "E7": { desc: "โหมดขัดแย้ง (Mode conflict)", cause: "เปิดโหมดไม่ถูกต้อง", fix: "รีเซ็ตแอร์, เปลี่ยนโหมดใหม่" },
    "F1": { desc: "เซ็นเซอร์อุณหภูมิตัวนอกผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์ตัวนอก" },
    "F2": { desc: "เซ็นเซอร์คอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์ร้อน" },
    "F3": { desc: "เซ็นเซอร์ท่อทางออกผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์ท่อทางออก" }
  },
  "Carrier": {
    "E1": { desc: "เซ็นเซอร์อุณหภูมิห้องผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์อุณหภูมิห้อง" },
    "E2": { desc: "เซ็นเซอร์คอยล์เย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "E3": { desc: "เซ็นเซอร์คอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์ร้อน" },
    "E4": { desc: "ระบบป้องกันความดันสูง", cause: "น้ำยามาก / คอยล์สกปรก", fix: "ล้างคอยล์ร้อน" },
    "E5": { desc: "คอมเพรสเซอร์ร้อนเกิน", cause: "น้ำยาน้อย / ระบายอากาศไม่ดี", fix: "เช็คน้ำยา, เปิดพื้นที่ระบายอากาศ" },
    "E6": { desc: "สัญญาณสื่อสารผิดพลาด", cause: "สายสัญญาณหลวม", fix: "เช็คสายสัญญาณตัวใน-นอก" },
    "E8": { desc: "มอเตอร์พัดลมตัวในผิดปกติ", cause: "มอเตอร์เสีย / ล็อค", fix: "เปลี่ยนมอเตอร์พัดลม" }
  },
  "Panasonic": {
    "E1": { desc: "สัญญาณสื่อสารตัวใน-นอกผิดพลาด", cause: "สายสัญญาณหลวม / ขาด", fix: "ตรวจสายสัญญาณ 3 เส้น" },
    "E5": { desc: "แรงดันสูงเกิน / คอมเพรสเซอร์ OLP", cause: "คอยล์สกปรก / น้ำยาเกิน", fix: "ล้างคอยล์ร้อน, เช็คน้ำยา" },
    "E6": { desc: "ท่อน้ำทิ้งอุดตัน / โฟลตสวิตช์ทำงาน", cause: "น้ำทิ้งไม่ออก", fix: "ล้างท่อน้ำทิ้ง, เช็คโฟลตสวิตช์" },
    "F11": { desc: "วาล์วสี่ทางผิดปกติ", cause: "วาล์วเสีย / คอยล์วาล์วขาด", fix: "เปลี่ยนวาล์วสี่ทาง" },
    "F17": { desc: "น้ำแข็งเกาะคอยล์เย็น", cause: "ลมเย็นไม่ออก / ฟิลเตอร์ตัน", fix: "ล้างฟิลเตอร์, ล้างคอยล์เย็น" },
    "F90": { desc: "กระแสคอมเพรสเซอร์ผิดปกติ", cause: "PFC circuit เสีย", fix: "เปลี่ยนแผง inverter" },
    "F99": { desc: "กระแส DC ผิดปกติ", cause: "คอมเพรสเซอร์ / แผง IPM เสีย", fix: "ตรวจคอมเพรสเซอร์, เปลี่ยนแผง" },
    "H11": { desc: "สัญญาณสื่อสารตัวใน-นอกผิดพลาด", cause: "แผง PCB เสีย", fix: "เปลี่ยนแผง PCB" },
    "H14": { desc: "เซ็นเซอร์อุณหภูมิอากาศผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "H16": { desc: "กระแส CT คอยล์ร้อนต่ำ", cause: "น้ำยาน้อย", fix: "เช็ครอยรั่ว, เติมน้ำยา" }
  },
  "TCL": {
    "E0": { desc: "EEPROM ผิดพลาด", cause: "หน่วยความจำแผง PCB เสีย", fix: "เปลี่ยนแผง PCB ตัวใน" },
    "E1": { desc: "เซ็นเซอร์อุณหภูมิห้องผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "E2": { desc: "เซ็นเซอร์คอยล์เย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์เย็น" },
    "E3": { desc: "เซ็นเซอร์คอยล์ร้อนผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์คอยล์ร้อน" },
    "E5": { desc: "สัญญาณสื่อสารตัวใน-นอกผิดพลาด", cause: "สายสัญญาณหลวม", fix: "เช็คสายสัญญาณ" },
    "E6": { desc: "มอเตอร์พัดลมตัวในผิดปกติ", cause: "มอเตอร์เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E8": { desc: "ท่อน้ำทิ้งอุดตัน", cause: "น้ำไม่ระบาย", fix: "ล้างท่อน้ำทิ้ง" },
    "P0": { desc: "คอมเพรสเซอร์ IPM ผิดปกติ", cause: "แผง IPM เสีย", fix: "เปลี่ยนแผง IPM" },
    "P2": { desc: "คอมเพรสเซอร์ร้อนเกิน", cause: "น้ำยาน้อย / ระบายอากาศไม่ดี", fix: "เช็คน้ำยา, ล้างคอยล์ร้อน" },
    "P4": { desc: "อินเวอร์เตอร์กระแสเกิน", cause: "คอมเพรสเซอร์เสีย", fix: "ตรวจคอมเพรสเซอร์, เปลี่ยนแผง" }
  }
};

const BRANDS = Object.keys(ERROR_DB);

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

export function renderErrorCodesPage(ctx) {
  const container = document.getElementById("page-error_codes");
  if (!container) return;

  container.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:8px">
      <div class="hero" style="text-align:center;padding:24px 16px;margin-bottom:20px;background:linear-gradient(135deg,#fee2e2,#fef3c7);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">⚠️</div>
        <h2 style="margin:0 0 4px;color:#b91c1c">Error Code แอร์</h2>
        <p style="margin:0;color:#92400e;font-size:14px">ค้นหารหัสข้อผิดพลาดตามยี่ห้อ — วิเคราะห์ปัญหาเบื้องต้น</p>
      </div>

      <!-- ═══ Search Bar ═══ -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <select id="ecBrandSelect" style="flex:1;min-width:140px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px;background:#fff">
          <option value="">— เลือกยี่ห้อ —</option>
          ${BRANDS.map(b => `<option value="${b}">${b}</option>`).join("")}
        </select>
        <input id="ecSearchInput" type="text" placeholder="พิมพ์รหัส เช่น E1, F3, CH02..." style="flex:2;min-width:160px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px" />
      </div>

      <!-- ═══ Quick brand buttons ═══ -->
      <div id="ecBrandBtns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        ${BRANDS.map(b => `<button class="ec-brand-btn" data-brand="${b}" style="padding:6px 14px;border:2px solid #e5e7eb;border-radius:20px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s">${b}</button>`).join("")}
      </div>

      <!-- ═══ Results ═══ -->
      <div id="ecResults"></div>

      <!-- ═══ Tips Section ═══ -->
      <div style="margin-top:24px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0">
        <h3 style="margin:0 0 8px;color:#166534;font-size:15px">💡 เคล็ดลับก่อนเรียกช่าง</h3>
        <div style="font-size:13px;color:#15803d;line-height:1.7">
          1. <b>รีเซ็ตแอร์</b> — ถอดปลั๊ก 30 วินาที แล้วเสียบใหม่<br>
          2. <b>ล้างฟิลเตอร์</b> — ฟิลเตอร์สกปรกเป็นสาเหตุหลักของ E6, F17<br>
          3. <b>เช็คสายสัญญาณ</b> — สายหลวมทำให้เกิด Error สื่อสารตัวใน-นอก<br>
          4. <b>บันทึกรหัส</b> — จดรหัส Error + กดถ่ายรูปไว้แจ้งช่าง<br>
          5. <b>แจ้งซ่อม</b> — หากแก้ไม่ได้ กดแจ้งซ่อมผ่านระบบได้เลย
        </div>
      </div>
    </div>
  `;

  const brandSelect = container.querySelector("#ecBrandSelect");
  const searchInput = container.querySelector("#ecSearchInput");
  const brandBtns = container.querySelectorAll(".ec-brand-btn");
  const resultsDiv = container.querySelector("#ecResults");

  function renderResults() {
    const brand = brandSelect.value;
    const query = searchInput.value.trim().toUpperCase();

    if (!brand && !query) {
      resultsDiv.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#9ca3af"><div style="font-size:40px;margin-bottom:8px">🔍</div>เลือกยี่ห้อ หรือ พิมพ์รหัส Error เพื่อค้นหา</div>`;
      return;
    }

    let results = [];

    if (brand) {
      // Search within selected brand
      const codes = ERROR_DB[brand] || {};
      for (const [code, info] of Object.entries(codes)) {
        if (!query || code.toUpperCase().includes(query)) {
          results.push({ brand, code, ...info });
        }
      }
    } else {
      // Search across all brands
      for (const [b, codes] of Object.entries(ERROR_DB)) {
        for (const [code, info] of Object.entries(codes)) {
          if (code.toUpperCase().includes(query)) {
            results.push({ brand: b, code, ...info });
          }
        }
      }
    }

    if (results.length === 0) {
      resultsDiv.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#9ca3af"><div style="font-size:40px;margin-bottom:8px">😕</div>ไม่พบรหัส "${escHtml(query)}" ${brand ? "ในยี่ห้อ " + escHtml(brand) : ""}<br><small>ลองค้นหาด้วยรหัสอื่น หรือ ติดต่อช่างโดยตรง</small></div>`;
      return;
    }

    resultsDiv.innerHTML = `
      <div style="font-size:13px;color:#6b7280;margin-bottom:8px">พบ ${results.length} รายการ</div>
      ${results.map(r => `
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-bottom:10px;background:#fff;transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <span style="background:#ef4444;color:#fff;padding:4px 12px;border-radius:8px;font-weight:700;font-size:15px;font-family:monospace">${r.code}</span>
            <span style="background:#f3f4f6;padding:3px 10px;border-radius:6px;font-size:12px;color:#4b5563;font-weight:600">${r.brand}</span>
          </div>
          <div style="font-weight:600;color:#1f2937;margin-bottom:6px;font-size:14px">${r.desc}</div>
          <div style="display:grid;gap:4px;font-size:13px;color:#4b5563">
            <div><span style="color:#dc2626;font-weight:600">สาเหตุ:</span> ${r.cause}</div>
            <div><span style="color:#059669;font-weight:600">วิธีแก้:</span> ${r.fix}</div>
          </div>
        </div>
      `).join("")}
    `;
  }

  brandSelect.addEventListener("change", () => {
    brandBtns.forEach(b => b.style.borderColor = b.dataset.brand === brandSelect.value ? "#3b82f6" : "#e5e7eb");
    brandBtns.forEach(b => b.style.background = b.dataset.brand === brandSelect.value ? "#eff6ff" : "#fff");
    renderResults();
  });

  searchInput.addEventListener("input", renderResults);

  brandBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      brandSelect.value = btn.dataset.brand;
      brandBtns.forEach(b => {
        b.style.borderColor = b === btn ? "#3b82f6" : "#e5e7eb";
        b.style.background = b === btn ? "#eff6ff" : "#fff";
      });
      renderResults();
    });
  });

  // Initial render
  renderResults();
}
