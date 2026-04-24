// ═══════════════════════════════════════════════════════════
//  ERROR CODES — เครื่องซักผ้า (Washing Machine) — แบรนด์ยอดนิยมในไทย
// ═══════════════════════════════════════════════════════════

import { renderErrorExplorer } from "./error_codes_shared.js";

const WASHER_DB = {
  "Samsung": {
    "4E": { desc: "น้ำเข้าผิดปกติ (น้ำไม่เข้า / อ่อน)", cause: "น้ำไม่ไหล / ก๊อกปิด / ตะแกรง inlet อุดตัน", fix: "เปิดก๊อก, ล้างตะแกรงท่อน้ำเข้า, ตรวจแรงดันน้ำ" },
    "4C": { desc: "น้ำเข้าผิดปกติ (รุ่นใหม่ — เทียบเท่า 4E)", cause: "น้ำไม่ไหล / inlet valve เสีย", fix: "เช็คก๊อกน้ำ, ล้างตะแกรง, เปลี่ยน inlet valve" },
    "4E1": { desc: "น้ำเข้าร้อนเกิน (ควรใช้น้ำเย็น)", cause: "ต่อท่อน้ำร้อน-เย็นสลับ", fix: "ตรวจการต่อท่อน้ำเข้า" },
    "4E2": { desc: "น้ำเข้าเย็นเกิน (โปรแกรมต้องการน้ำร้อน)", cause: "heater / น้ำร้อนมีปัญหา", fix: "ตรวจระบบน้ำร้อน" },
    "4C2": { desc: "น้ำร้อนผิดช่อง (ซ้ำ 4E1)", cause: "ต่อท่อสลับ", fix: "ตรวจการต่อท่อน้ำเข้า" },
    "5E": { desc: "ระบายน้ำผิดปกติ (น้ำไม่ออก)", cause: "ฟิลเตอร์ปั๊มตัน / ท่อน้ำทิ้งพับ", fix: "ล้างฟิลเตอร์ปั๊ม, ตรวจท่อน้ำทิ้ง" },
    "5C": { desc: "ระบายน้ำผิดปกติ (รุ่นใหม่)", cause: "ปั๊มระบายน้ำเสีย / อุดตัน", fix: "ล้างฟิลเตอร์, เปลี่ยนปั๊มระบายน้ำ" },
    "nd": { desc: "ไม่ระบายน้ำ (Not Drain)", cause: "ฟิลเตอร์ปั๊มตัน", fix: "ล้างฟิลเตอร์ปั๊มน้ำทิ้ง" },
    "SUd": { desc: "ฟองมากเกินไป", cause: "ใช้ผงซักฟอกมากเกิน / ไม่ใช่สูตรฝาหน้า", fix: "ลดผงซักฟอก, ใช้สูตร HE สำหรับฝาหน้า" },
    "Sud": { desc: "ฟองสะสมในถัง (ซ้ำ SUd)", cause: "ผงซักฟอกมากเกิน", fix: "ลดผงซักฟอก, รอระบายฟอง" },
    "DC": { desc: "ถังไม่สมดุล (Unbalance)", cause: "ผ้าไม่เกลี่ย / ของเดียวตัวหนัก", fix: "เกลี่ยผ้าใหม่, เพิ่มของเล็กน้อยให้สมดุล" },
    "UE": { desc: "ถังไม่สมดุลตอนปั่น (unbalance)", cause: "ผ้ากองข้างเดียว", fix: "เกลี่ยผ้าใหม่" },
    "dE": { desc: "ประตูเปิด / ปิดไม่สนิท", cause: "ประตูไม่ปิด / switch ประตูเสีย", fix: "ปิดประตูให้สนิท, เปลี่ยน door switch" },
    "DE1": { desc: "ประตูเปิดขณะทำงาน / กลอนเสีย", cause: "กลอนล็อคประตูเสีย", fix: "เปลี่ยน door lock" },
    "DE2": { desc: "ประตูไม่ตรวจพบว่าปิด", cause: "switch ประตูเสีย", fix: "เปลี่ยน door switch" },
    "LE": { desc: "น้ำรั่ว / ตรวจพบน้ำใต้ฐาน", cause: "ถังรั่ว / ซีลเสีย / pressure sensor ผิด", fix: "ตรวจรอยรั่ว, เปลี่ยนซีล" },
    "LC": { desc: "Leak sensor ตรวจน้ำรั่ว", cause: "น้ำรั่ว / เซ็นเซอร์เสีย", fix: "ตรวจรอยรั่วใต้เครื่อง" },
    "1E": { desc: "เซ็นเซอร์ระดับน้ำ (pressure) ผิด", cause: "pressure sensor / สาย air hose เสีย", fix: "เปลี่ยน pressure sensor" },
    "2E": { desc: "แรงดันไฟสูงเกิน", cause: "ไฟเข้าสูง", fix: "ตรวจแรงดันไฟฟ้า" },
    "3E": { desc: "เซ็นเซอร์ tacho มอเตอร์ผิด", cause: "tachometer / hall sensor เสีย", fix: "เปลี่ยน tacho sensor" },
    "3E1": { desc: "กระแสมอเตอร์เกิน", cause: "โหลดมาก / มอเตอร์เสีย", fix: "ลดของในถัง, ตรวจมอเตอร์" },
    "tE": { desc: "เซ็นเซอร์อุณหภูมิน้ำผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยน temp sensor" },
    "tE1": { desc: "เซ็นเซอร์อุณหภูมิ heater ผิด", cause: "เทอร์มิสเตอร์ heater เสีย", fix: "เปลี่ยน temp sensor" },
    "HE": { desc: "ฮีตเตอร์ทำน้ำร้อนผิดปกติ", cause: "heater ขาด / รีเลย์เสีย", fix: "เปลี่ยน heater" },
    "HE1": { desc: "น้ำไม่ร้อนตามเวลา", cause: "heater อ่อน / ตะกรันจับ", fix: "ล้างตะกรัน, เปลี่ยน heater" },
    "HE2": { desc: "Heater overheat", cause: "heater ร้อนเกิน", fix: "เปลี่ยน heater + temp sensor" },
    "8E": { desc: "Vibration / unbalance sensor ผิด", cause: "sensor สั่น (accelerometer) เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "9E1": { desc: "แรงดันไฟต่ำ", cause: "ไฟเข้าต่ำ", fix: "ใช้ stabilizer" },
    "9E2": { desc: "Frequency error (50/60Hz)", cause: "ความถี่ไฟผิด", fix: "ตรวจไฟเข้า" },
    "AE": { desc: "Communication error (Sub PCB)", cause: "สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "bE": { desc: "ปุ่มกดค้าง (button stuck)", cause: "ปุ่มกด panel ค้าง / เสีย", fix: "เปลี่ยน display panel" },
    "bE1": { desc: "ปุ่ม Power ค้าง", cause: "ปุ่ม Power เสีย", fix: "เปลี่ยน display/button panel" },
    "bE3": { desc: "Relay บนแผงเสีย", cause: "รีเลย์เสีย", fix: "เปลี่ยนแผง main PCB" },
    "CE": { desc: "Cooling error (heat pump dryer)", cause: "ระบบ cooling dryer ผิด", fix: "ล้างคอนเดนเซอร์, เปลี่ยนพัดลม" },
    "Uc": { desc: "Voltage unstable", cause: "ไฟไม่เสถียร", fix: "ใช้ stabilizer" }
  },
  "LG": {
    "IE": { desc: "น้ำเข้าผิดปกติ (Inlet)", cause: "น้ำไม่ไหล / ก๊อกปิด / inlet valve เสีย", fix: "เปิดก๊อก, ล้างตะแกรง, เปลี่ยน inlet valve" },
    "IE1": { desc: "ระดับน้ำไม่ถึงเกณฑ์", cause: "แรงดันน้ำต่ำ", fix: "เช็คแรงดันน้ำ" },
    "IE2": { desc: "Inlet valve ผิดปกติ", cause: "วาล์วน้ำเสีย", fix: "เปลี่ยน inlet valve" },
    "OE": { desc: "ระบายน้ำผิดปกติ (น้ำไม่ออก)", cause: "ฟิลเตอร์ปั๊มตัน / ท่อพับ", fix: "ล้างฟิลเตอร์ปั๊ม, ตรวจท่อน้ำทิ้ง" },
    "UE": { desc: "ถังไม่สมดุลตอนปั่น", cause: "ผ้าไม่เกลี่ย", fix: "เกลี่ยผ้า, อย่าซักของใหญ่เดี่ยว" },
    "dE": { desc: "ประตูปิดไม่สนิท", cause: "switch / กลอนประตูเสีย", fix: "ปิดให้สนิท, เปลี่ยน door lock" },
    "dE1": { desc: "ประตูไม่ล็อค / กลอนเสีย", cause: "กลอนประตูเสีย", fix: "เปลี่ยน door lock" },
    "LE": { desc: "มอเตอร์ล็อค / ทำงานผิดปกติ", cause: "มอเตอร์ล็อค / โหลดมาก", fix: "ถอดปลั๊ก, ลดของในถัง, เปลี่ยนมอเตอร์" },
    "LE1": { desc: "มอเตอร์ (BLDC) position error", cause: "hall sensor เสีย", fix: "เปลี่ยน hall sensor หรือมอเตอร์" },
    "tE": { desc: "เซ็นเซอร์อุณหภูมิน้ำผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยน thermistor" },
    "tcL": { desc: "Hot/Cold temperature sensor ผิด", cause: "sensor น้ำร้อน-เย็น เสีย", fix: "เปลี่ยน sensor" },
    "CE": { desc: "Current overload (มอเตอร์)", cause: "กระแสมอเตอร์เกิน", fix: "ลดโหลด, ตรวจมอเตอร์" },
    "FE": { desc: "น้ำล้น (Overflow)", cause: "pressure sensor ผิด / valve ค้างเปิด", fix: "เปลี่ยน pressure sensor" },
    "PE": { desc: "Pressure sensor ผิดปกติ", cause: "sensor ระดับน้ำเสีย", fix: "เปลี่ยน pressure sensor" },
    "PF": { desc: "ไฟดับขณะทำงาน (Power Fail)", cause: "ไฟดับ", fix: "กดเริ่มใหม่" },
    "AE": { desc: "น้ำรั่วจากถัง", cause: "ถัง/ซีล leak", fix: "ตรวจรอยรั่ว, เปลี่ยนซีล" },
    "E1": { desc: "น้ำรั่วฐานเครื่อง", cause: "น้ำรั่ว sensor ตรวจพบ", fix: "เช็ครอยรั่ว, เช็ค water inlet" },
    "E3": { desc: "Overheat (heater) ร้อนเกิน", cause: "heater overheat", fix: "เปลี่ยน heater + thermistor" },
    "E6": { desc: "Clutch error (ซักกับปั่นสลับผิด)", cause: "cluth สลับโหมดเสีย (top-load)", fix: "เปลี่ยน clutch" },
    "SE": { desc: "Motor Hall sensor error", cause: "hall sensor เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "EE": { desc: "EEPROM ผิดพลาด", cause: "แผง main เสีย", fix: "เปลี่ยนแผง main" },
    "HE": { desc: "Heater error", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยน heater" },
    "dHE": { desc: "Dryer heater ผิด (รุ่นมีระบบอบ)", cause: "heater dryer เสีย", fix: "เปลี่ยน heater dryer" },
    "oE": { desc: "Drain ผิดปกติ (ซ้ำ OE)", cause: "ท่อน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์ปั๊ม" }
  },
  "Hitachi": {
    "C0": { desc: "ถังสั่นมาก / ไม่สมดุล", cause: "ผ้าไม่เกลี่ย", fix: "เกลี่ยผ้าใหม่" },
    "C1": { desc: "น้ำเข้าน้อย / ไม่เข้า", cause: "น้ำไม่ไหล / inlet valve", fix: "เปิดก๊อก, เช็ค inlet valve" },
    "C2": { desc: "ระบายน้ำผิดปกติ", cause: "ปั๊มระบายน้ำเสีย / ท่อตัน", fix: "ล้างฟิลเตอร์, เปลี่ยนปั๊ม" },
    "C3": { desc: "ประตูปิดไม่สนิท (ฝาด้านบน)", cause: "ฝาไม่ปิด / switch เสีย", fix: "ปิดฝา, เปลี่ยน switch" },
    "C4": { desc: "Overflow (น้ำล้น)", cause: "pressure sensor ผิด / valve ค้าง", fix: "เปลี่ยน pressure sensor" },
    "C5": { desc: "Motor error", cause: "มอเตอร์เสีย / carbon brush หมด", fix: "เปลี่ยน carbon brush / มอเตอร์" },
    "C6": { desc: "Heater error", cause: "heater ขาด / ตะกรัน", fix: "เปลี่ยน heater, ล้างตะกรัน" },
    "C7": { desc: "Water leak (น้ำรั่ว)", cause: "ถังรั่ว / ซีล", fix: "ตรวจรอยรั่ว" },
    "C8": { desc: "Clutch error (top-load)", cause: "clutch สลับโหมดเสีย", fix: "เปลี่ยน clutch" },
    "C9": { desc: "Communication error", cause: "สายระหว่างแผงหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "CA": { desc: "Tachometer / RPM sensor ผิด", cause: "sensor ความเร็วมอเตอร์เสีย", fix: "เปลี่ยน tacho" },
    "Cb": { desc: "EEPROM ผิดพลาด", cause: "แผง main เสีย", fix: "เปลี่ยนแผง PCB" },
    "F0": { desc: "Sensor ระดับน้ำผิดปกติ", cause: "pressure sensor เสีย", fix: "เปลี่ยน pressure sensor" },
    "F1": { desc: "เซ็นเซอร์อุณหภูมิน้ำผิด", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "F5": { desc: "Door lock error (ฝาหน้า)", cause: "กลอนประตูเสีย", fix: "เปลี่ยน door lock" }
  },
  "Toshiba": {
    "E1": { desc: "น้ำเข้าผิดปกติ (น้ำไม่เข้า)", cause: "น้ำไม่ไหล / inlet valve เสีย", fix: "เปิดก๊อก, เปลี่ยน inlet valve" },
    "E2": { desc: "ระบายน้ำผิดปกติ", cause: "ปั๊มระบายน้ำตัน / ท่อพับ", fix: "ล้างฟิลเตอร์ปั๊ม, ตรวจท่อ" },
    "E3": { desc: "ถังไม่สมดุล / ไม่ปั่น", cause: "ผ้าไม่เกลี่ย", fix: "เกลี่ยผ้า" },
    "E4": { desc: "ฝาเปิดขณะทำงาน", cause: "switch ฝา / กลอนเสีย", fix: "ปิดฝาสนิท, เปลี่ยน switch" },
    "E5": { desc: "Motor error", cause: "มอเตอร์เสีย", fix: "ตรวจ carbon brush / มอเตอร์" },
    "E6": { desc: "Overflow (น้ำล้น)", cause: "pressure sensor ผิด", fix: "เปลี่ยน sensor" },
    "E7": { desc: "Heater error (รุ่นมี heater)", cause: "heater ขาด", fix: "เปลี่ยน heater" },
    "E8": { desc: "Water leak", cause: "ถังรั่ว / ซีล", fix: "ตรวจรอยรั่ว" },
    "E9": { desc: "EEPROM / Main PCB error", cause: "แผง main เสีย", fix: "เปลี่ยนแผง PCB" },
    "EA": { desc: "Communication error", cause: "สายระหว่างแผง", fix: "เช็คสาย" },
    "EC": { desc: "Overvoltage", cause: "ไฟเข้าสูง", fix: "ใช้ stabilizer" },
    "Ed": { desc: "Door lock failure", cause: "กลอน door lock เสีย", fix: "เปลี่ยน door lock" },
    "EE": { desc: "Clutch error (top-load)", cause: "clutch เสีย", fix: "เปลี่ยน clutch" }
  },
  "Panasonic": {
    "U10": { desc: "ถังสั่นมาก / ไม่สมดุล", cause: "ผ้ากองข้างเดียว", fix: "เกลี่ยผ้า" },
    "U11": { desc: "ระบายน้ำผิดปกติ", cause: "ท่อน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์, ตรวจท่อ" },
    "U12": { desc: "ฝา/ประตูเปิดขณะทำงาน", cause: "ฝาไม่ปิด / switch", fix: "ปิดฝา, เปลี่ยน switch" },
    "U13": { desc: "ผ้ากองไม่สมดุล (ซ้ำ U10)", cause: "ผ้ากอง", fix: "เกลี่ยผ้าใหม่" },
    "U14": { desc: "น้ำเข้าผิดปกติ", cause: "น้ำไม่ไหล", fix: "เปิดก๊อก, เช็ค inlet" },
    "U18": { desc: "Overflow (น้ำล้น)", cause: "pressure sensor ผิด", fix: "เปลี่ยน sensor" },
    "H01": { desc: "เซ็นเซอร์ระดับน้ำผิด", cause: "pressure sensor เสีย", fix: "เปลี่ยน pressure sensor" },
    "H02": { desc: "เซ็นเซอร์อุณหภูมิน้ำผิด", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "H03": { desc: "Water inlet valve ผิด", cause: "วาล์วน้ำเสีย", fix: "เปลี่ยน inlet valve" },
    "H05": { desc: "Drain pump error", cause: "ปั๊มระบายน้ำเสีย", fix: "เปลี่ยนปั๊ม" },
    "H07": { desc: "Motor error", cause: "มอเตอร์เสีย", fix: "เปลี่ยนมอเตอร์" },
    "H08": { desc: "Door lock error", cause: "กลอน door lock เสีย", fix: "เปลี่ยน door lock" },
    "H11": { desc: "Communication error", cause: "สายระหว่างแผง", fix: "เช็คสาย" },
    "H21": { desc: "Heater error", cause: "heater เสีย", fix: "เปลี่ยน heater" },
    "H23": { desc: "Heater sensor error", cause: "thermistor heater เสีย", fix: "เปลี่ยน thermistor" }
  },
  "Sharp": {
    "E0": { desc: "Water inlet error", cause: "น้ำไม่ไหล", fix: "เปิดก๊อก, เช็ค inlet" },
    "E1": { desc: "Drain error", cause: "ท่อน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์" },
    "E2": { desc: "Door / Lid open", cause: "ฝาไม่ปิด / switch เสีย", fix: "ปิดฝา, เปลี่ยน switch" },
    "E3": { desc: "Unbalance (UE)", cause: "ผ้ากอง", fix: "เกลี่ยผ้า" },
    "E4": { desc: "Overflow (น้ำล้น)", cause: "pressure sensor ผิด", fix: "เปลี่ยน sensor" },
    "E5": { desc: "Motor error", cause: "มอเตอร์เสีย", fix: "ตรวจมอเตอร์, เปลี่ยน carbon" },
    "E6": { desc: "Heater error", cause: "heater ขาด", fix: "เปลี่ยน heater" },
    "E7": { desc: "Thermistor error", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยน sensor" },
    "E8": { desc: "Communication error", cause: "สายระหว่างแผง", fix: "เช็คสาย" },
    "E9": { desc: "EEPROM error", cause: "แผง main เสีย", fix: "เปลี่ยนแผง" }
  },
  "Haier": {
    "E1": { desc: "Drain error (ระบายน้ำไม่ได้)", cause: "ปั๊มน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์ปั๊มระบายน้ำ" },
    "E2": { desc: "Door open / Lid open", cause: "ประตูไม่ปิด", fix: "ปิดประตูให้สนิท, เช็ค switch" },
    "E3": { desc: "Unbalance / spin error", cause: "ผ้าไม่เกลี่ย", fix: "เกลี่ยผ้า" },
    "E4": { desc: "Water inlet error", cause: "น้ำไม่เข้า / valve เสีย", fix: "เปิดก๊อก, เปลี่ยน inlet valve" },
    "E5": { desc: "Overflow", cause: "pressure sensor ผิด", fix: "เปลี่ยน pressure sensor" },
    "E6": { desc: "Motor error", cause: "มอเตอร์ / tacho เสีย", fix: "ตรวจมอเตอร์" },
    "E7": { desc: "Temp sensor error", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "E8": { desc: "Heater error (รุ่นมี heater)", cause: "heater ขาด", fix: "เปลี่ยน heater" },
    "E9": { desc: "Water leak", cause: "ถังรั่ว", fix: "ตรวจรอยรั่ว" },
    "F1": { desc: "EEPROM error", cause: "แผง main เสีย", fix: "เปลี่ยนแผง PCB" },
    "F2": { desc: "Communication error", cause: "สายหลวม", fix: "เช็คสาย" }
  },
  "Electrolux": {
    "E10": { desc: "Water inlet (น้ำเข้าช้า/ไม่เข้า)", cause: "น้ำไม่ไหล / ตะแกรงตัน", fix: "ล้างตะแกรง inlet, เปิดก๊อก" },
    "E11": { desc: "Fill time exceeded (น้ำเต็มเกินเวลา)", cause: "inlet valve / pressure sensor", fix: "เปลี่ยน inlet valve" },
    "E13": { desc: "Water leak (น้ำรั่ว)", cause: "ถังรั่ว / float ทำงาน", fix: "ตรวจรอยรั่ว" },
    "E20": { desc: "Drain error (น้ำไม่ออก)", cause: "ปั๊มระบายน้ำตัน", fix: "ล้างฟิลเตอร์ปั๊ม" },
    "E21": { desc: "Drain time exceeded", cause: "ท่อตัน / ปั๊มอ่อน", fix: "ล้างท่อ + ฟิลเตอร์" },
    "E23": { desc: "Drain pump relay error", cause: "แผง PCB รีเลย์เสีย", fix: "เปลี่ยนแผง PCB" },
    "E31": { desc: "Pressure sensor error", cause: "sensor ระดับน้ำเสีย", fix: "เปลี่ยน pressure sensor" },
    "E35": { desc: "Pressure sensor overflow", cause: "น้ำล้น / sensor ผิด", fix: "เปลี่ยน sensor" },
    "E40": { desc: "Door open / not locked", cause: "กลอนประตูเสีย", fix: "เปลี่ยน door lock" },
    "E41": { desc: "Door not closed properly", cause: "ประตูปิดไม่สนิท", fix: "ปิดให้สนิท" },
    "E52": { desc: "Motor tacho / RPM sensor ผิด", cause: "tacho เสีย", fix: "เปลี่ยน tacho" },
    "E54": { desc: "Motor relay ค้าง", cause: "รีเลย์บนแผง PCB เสีย", fix: "เปลี่ยนแผง PCB" },
    "E60": { desc: "Heater / relay ผิด", cause: "heater ขาด / relay เสีย", fix: "เปลี่ยน heater" },
    "E61": { desc: "Heater ทำงานช้า (น้ำไม่ร้อน)", cause: "heater อ่อน / ตะกรัน", fix: "ล้างตะกรัน, เปลี่ยน heater" },
    "E66": { desc: "Heater overheat", cause: "heater ร้อนเกิน", fix: "เปลี่ยน heater + thermistor" },
    "E70": { desc: "Temperature sensor (NTC) ผิด", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "E90": { desc: "Communication error (Main ↔ Display)", cause: "สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "E93": { desc: "Config error", cause: "ตั้งค่า config PCB ผิด", fix: "ตั้ง config ใหม่ / เปลี่ยนแผง" },
    "EF0": { desc: "Aqua Control (กันน้ำล้น) ทำงาน", cause: "น้ำรั่ว", fix: "ตรวจรอยรั่ว" }
  },
  "Whirlpool": {
    "F01": { desc: "Main Control Board error", cause: "แผง main เสีย", fix: "เปลี่ยนแผง PCB" },
    "F02": { desc: "Drain error (น้ำไม่ออก)", cause: "ปั๊มระบายน้ำตัน", fix: "ล้างฟิลเตอร์ปั๊ม" },
    "F03": { desc: "Heating error", cause: "heater ขาด", fix: "เปลี่ยน heater" },
    "F05": { desc: "Water temperature sensor error", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "F06": { desc: "Motor tacho error", cause: "tacho เสีย", fix: "เปลี่ยน tacho" },
    "F07": { desc: "Motor control board error", cause: "แผงควบคุมมอเตอร์เสีย", fix: "เปลี่ยนแผงมอเตอร์" },
    "F09": { desc: "Overflow (น้ำล้น)", cause: "pressure sensor ผิด", fix: "เปลี่ยน pressure sensor" },
    "F11": { desc: "Communication error (Main ↔ Motor)", cause: "สายสัญญาณหลวม", fix: "เช็คสาย" },
    "F13": { desc: "Dispenser circuit error", cause: "แผง dispenser เสีย", fix: "เปลี่ยนแผง PCB" },
    "F20": { desc: "Water inlet error", cause: "น้ำไม่เข้า", fix: "เปิดก๊อก, เปลี่ยน inlet valve" },
    "F21": { desc: "Long drain time", cause: "ปั๊มอ่อน / ท่อตัน", fix: "ล้างปั๊ม" },
    "F22": { desc: "Door lock error", cause: "กลอนประตูเสีย", fix: "เปลี่ยน door lock" },
    "F23": { desc: "Door unlock error", cause: "กลอนประตูค้าง", fix: "เปลี่ยน door lock" },
    "F26": { desc: "Door switch error", cause: "switch ประตูเสีย", fix: "เปลี่ยน door switch" },
    "F31": { desc: "Motor speed sensor error", cause: "hall sensor มอเตอร์เสีย", fix: "เปลี่ยน sensor" },
    "LF": { desc: "Long Fill (น้ำเข้านาน)", cause: "แรงดันน้ำต่ำ", fix: "เช็คก๊อกน้ำ, ล้างตะแกรง" },
    "Sud": { desc: "ฟองมาก", cause: "ผงซักฟอกมาก", fix: "ลดผงซักฟอก" }
  },
  "Beko": {
    "E01": { desc: "Heater / Heating element ผิด", cause: "heater ขาด", fix: "เปลี่ยน heater" },
    "E02": { desc: "Water level / pressure sensor", cause: "pressure sensor เสีย", fix: "เปลี่ยน sensor" },
    "E03": { desc: "Motor error", cause: "มอเตอร์เสีย", fix: "เปลี่ยนมอเตอร์" },
    "E04": { desc: "Water inlet fault (น้ำเข้าผิด)", cause: "inlet valve เสีย", fix: "เปลี่ยน valve" },
    "E05": { desc: "Drain error (น้ำไม่ออก)", cause: "ปั๊มน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์" },
    "E07": { desc: "Overflow", cause: "pressure sensor / valve ค้าง", fix: "เปลี่ยน sensor/valve" },
    "E08": { desc: "Overvoltage / Undervoltage", cause: "ไฟเข้าไม่เสถียร", fix: "ใช้ stabilizer" },
    "E09": { desc: "Main PCB error", cause: "แผง main เสีย", fix: "เปลี่ยนแผง PCB" },
    "E11": { desc: "Motor board communication error", cause: "สายระหว่างแผง", fix: "เช็คสาย" },
    "E13": { desc: "Hot water temp error", cause: "thermistor / heater", fix: "เปลี่ยน thermistor" }
  },
  "Bosch": {
    "E01": { desc: "Door lock error", cause: "กลอน door lock เสีย", fix: "เปลี่ยน door lock" },
    "E02": { desc: "Motor error", cause: "มอเตอร์เสีย", fix: "ตรวจมอเตอร์" },
    "E03": { desc: "Drain error (น้ำไม่ออก)", cause: "ปั๊มน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์" },
    "E04": { desc: "Water inlet error", cause: "น้ำไม่ไหล", fix: "เปิดก๊อก, เปลี่ยน valve" },
    "E05": { desc: "Overfilling / Overflow", cause: "pressure sensor เสีย", fix: "เปลี่ยน sensor" },
    "E09": { desc: "Heater / heater relay error", cause: "heater ขาด / relay เสีย", fix: "เปลี่ยน heater" },
    "E10": { desc: "NTC / Temp sensor error", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "E12": { desc: "Heating takes too long", cause: "heater อ่อน / ตะกรัน", fix: "ล้างตะกรัน, เปลี่ยน heater" },
    "E13": { desc: "Hot water temp error", cause: "heater / sensor", fix: "เปลี่ยน heater" },
    "E16": { desc: "Door not locked", cause: "ประตูปิดไม่สนิท", fix: "ปิดให้สนิท" },
    "E17": { desc: "Water in tub (sensor leak)", cause: "น้ำรั่วใต้ถัง", fix: "ตรวจรอยรั่ว" },
    "E18": { desc: "Long drain", cause: "ปั๊มอ่อน / ท่อตัน", fix: "ล้างปั๊ม+ท่อ" },
    "E21": { desc: "Motor blocked / jammed", cause: "โหลดมากเกิน / มอเตอร์ล็อค", fix: "ลดของ, ตรวจมอเตอร์" },
    "E23": { desc: "Drain pump relay", cause: "รีเลย์เสีย", fix: "เปลี่ยนแผง PCB" },
    "E27": { desc: "Overvoltage", cause: "ไฟเข้าสูง", fix: "ใช้ stabilizer" },
    "E32": { desc: "Unbalanced drum", cause: "ผ้ากอง", fix: "เกลี่ยผ้า" }
  },
  "Midea": {
    "E10": { desc: "Water inlet error", cause: "น้ำไม่เข้า", fix: "เปิดก๊อก, ล้างตะแกรง" },
    "E11": { desc: "Water not filling to level", cause: "pressure sensor / inlet valve", fix: "เปลี่ยน valve หรือ sensor" },
    "E20": { desc: "Drain error", cause: "ปั๊มน้ำทิ้งตัน", fix: "ล้างฟิลเตอร์ปั๊ม" },
    "E21": { desc: "Long drain time", cause: "ปั๊มอ่อน", fix: "เปลี่ยนปั๊ม" },
    "E30": { desc: "Door lock error", cause: "กลอน door lock เสีย", fix: "เปลี่ยน door lock" },
    "E31": { desc: "Door not closed", cause: "ประตูไม่ปิด", fix: "ปิดให้สนิท" },
    "E40": { desc: "Overflow", cause: "pressure sensor ผิด", fix: "เปลี่ยน sensor" },
    "E50": { desc: "Motor / inverter error", cause: "มอเตอร์ / แผง inverter เสีย", fix: "ตรวจมอเตอร์" },
    "E60": { desc: "Heater error", cause: "heater ขาด", fix: "เปลี่ยน heater" },
    "E70": { desc: "Thermistor / NTC error", cause: "thermistor เสีย", fix: "เปลี่ยน thermistor" },
    "E90": { desc: "Communication error", cause: "สายระหว่างแผงหลวม", fix: "เช็คสาย" }
  }
};

export function renderErrorCodesWasherPage(ctx) {
  renderErrorExplorer({
    containerId: "page-error_codes_washer",
    db: WASHER_DB,
    hero: {
      icon: "🧺",
      title: "Error Code เครื่องซักผ้า",
      subtitle: "ค้นหารหัสข้อผิดพลาดเครื่องซักผ้าตามยี่ห้อ",
      gradient: "linear-gradient(135deg,#fce7f3,#fef3c7)",
      titleColor: "#9d174d",
      subtitleColor: "#92400e"
    },
    placeholder: "พิมพ์รหัส เช่น 4E, UE, OE, E10...",
    tips: {
      title: "💡 เคล็ดลับก่อนเรียกช่าง (เครื่องซักผ้า)",
      html: `
        1. <b>ถอดปลั๊ก 5 นาที</b> — แล้วเสียบใหม่ — รีเซ็ต error ชั่วคราว<br>
        2. <b>ล้างฟิลเตอร์ปั๊มน้ำทิ้ง</b> — แก้ error ระบายน้ำ (5E/OE/E20) ได้บ่อย<br>
        3. <b>เปิดก๊อกน้ำให้สุด</b> — แก้ error น้ำเข้า (4E/IE/E10)<br>
        4. <b>เกลี่ยผ้าให้สมดุล</b> — แก้ error ปั่น (UE/DC/C0)<br>
        5. <b>ลดผงซักฟอก</b> — ฟองเยอะทำให้ error Sud + ระบายน้ำช้า<br>
        6. <b>ปิดประตู/ฝาสนิท</b> — error dE/DE เกิดบ่อยมาก<br>
        7. <b>ตรวจตะแกรงท่อน้ำเข้า</b> — อยู่ที่ขั้วต่อหลังเครื่อง มักมีตะกอน<br>
        8. <b>ห้ามใส่ผ้าเกิน</b> — โหลดมากทำให้มอเตอร์ / ถัง unbalance
      `
    }
  });
}
