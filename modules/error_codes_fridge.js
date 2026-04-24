// ═══════════════════════════════════════════════════════════
//  ERROR CODES — ตู้เย็น (Refrigerator) — แบรนด์ยอดนิยมในไทย
// ═══════════════════════════════════════════════════════════

import { renderErrorExplorer } from "./error_codes_shared.js";

const FRIDGE_DB = {
  "Samsung": {
    "1E": { desc: "เซ็นเซอร์อุณหภูมิตู้แช่ (Fridge) ผิดปกติ", cause: "เทอร์มิสเตอร์ตู้เย็นเสีย / สายขาด", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "2E": { desc: "เซ็นเซอร์อุณหภูมิช่องแช่แข็ง (Freezer) ผิดปกติ", cause: "เทอร์มิสเตอร์ช่องแข็งเสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "4E": { desc: "เซ็นเซอร์ละลายน้ำแข็ง (Defrost) ผิดปกติ", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ defrost" },
    "5E": { desc: "เซ็นเซอร์อุณหภูมิห้องภายนอกผิดปกติ", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์ ambient" },
    "6E": { desc: "เซ็นเซอร์ pantry (ช่องอุณหภูมิพิเศษ) ผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ pantry" },
    "8E": { desc: "เซ็นเซอร์ทำน้ำแข็ง (Ice maker) ผิดปกติ", cause: "เทอร์มิสเตอร์ ice maker เสีย", fix: "เปลี่ยนเซ็นเซอร์ ice maker" },
    "13E": { desc: "สัญญาณ ice bucket ผิดปกติ", cause: "sensor ถังน้ำแข็งเสีย", fix: "ถอดถังน้ำแข็ง ใส่ใหม่ / เปลี่ยน sensor" },
    "14E": { desc: "Ice maker sensor ผิดปกติ", cause: "เซ็นเซอร์ ice maker เสีย", fix: "เปลี่ยน ice maker sensor" },
    "15E": { desc: "Ice maker motor ผิดปกติ", cause: "มอเตอร์ ice maker ค้าง/เสีย", fix: "ถอดถังน้ำแข็ง ล้าง, เปลี่ยนมอเตอร์ ice maker" },
    "21E": { desc: "พัดลมช่องแช่แข็ง (Freezer fan) ผิดปกติ", cause: "มอเตอร์พัดลมช่องแข็งเสีย / น้ำแข็งเกาะ", fix: "ละลายน้ำแข็ง, เปลี่ยนมอเตอร์พัดลม" },
    "22E": { desc: "พัดลมช่องเย็น (Fridge fan) ผิดปกติ", cause: "มอเตอร์พัดลมช่องเย็นเสีย", fix: "เปลี่ยนมอเตอร์พัดลมช่องเย็น" },
    "23E": { desc: "พัดลมคอนเดนเซอร์ (ด้านหลัง) ผิดปกติ", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม condenser" },
    "25E": { desc: "ฮีตเตอร์ละลายน้ำแข็ง (Defrost heater) ผิดปกติ", cause: "ฮีตเตอร์ขาด / รีเลย์เสีย", fix: "เปลี่ยนฮีตเตอร์ defrost" },
    "26E": { desc: "Defrost ทำงานไม่สำเร็จ", cause: "ฮีตเตอร์อ่อน / เซ็นเซอร์ผิด", fix: "เช็คฮีตเตอร์และเซ็นเซอร์ defrost" },
    "39E": { desc: "Ice maker function error (ทำน้ำแข็งไม่ได้)", cause: "ice maker ขัดข้อง / น้ำไม่ไหล", fix: "ตรวจ water inlet valve, เปลี่ยน ice maker" },
    "40E": { desc: "Ice room fan ผิดปกติ", cause: "มอเตอร์พัดลมห้อง ice maker เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "41E": { desc: "Ice room heater ผิดปกติ", cause: "ฮีตเตอร์ห้อง ice maker ขาด", fix: "เปลี่ยนฮีตเตอร์" },
    "76C": { desc: "Water valve ผิดปกติ (ice/water)", cause: "วาล์วน้ำเสีย", fix: "เปลี่ยน water inlet valve" },
    "85E": { desc: "แรงดันไฟตัวเครื่องผิดปกติ", cause: "ไฟเข้าต่ำ/สูงเกิน", fix: "ตรวจไฟเข้า, ใช้ stabilizer" },
    "86E": { desc: "PCB ตัวเครื่อง communication error", cause: "แผง PCB เสีย / สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง PCB" },
    "88E": { desc: "EEPROM ผิดพลาด / power cut", cause: "หน่วยความจำเสีย", fix: "ถอดปลั๊ก 5 นาที, หากยังมี error เปลี่ยนแผง PCB" },
    "PC": { desc: "Compressor / inverter communication error", cause: "แผงอินเวอร์เตอร์เสีย", fix: "เปลี่ยนแผง inverter" },
    "PC ER": { desc: "Main PCB กับ Inverter PCB สื่อสารผิด", cause: "สายระหว่างแผงขาด", fix: "เช็คสาย, เปลี่ยนแผง inverter" },
    "RdE": { desc: "ระบบละลายน้ำแข็งตู้เย็นผิดปกติ", cause: "ฮีตเตอร์ / เซ็นเซอร์ defrost เสีย", fix: "เปลี่ยนฮีตเตอร์/เซ็นเซอร์" },
    "OF OF": { desc: "โหมด Demo / Showroom", cause: "เข้าโหมดโชว์สินค้าอยู่", fix: "กด Power Cool + Power Freeze ค้าง 10 วิ เพื่อออก" }
  },
  "LG": {
    "Er rS": { desc: "เซ็นเซอร์อุณหภูมิช่องเย็น (Fridge) ผิดปกติ", cause: "เทอร์มิสเตอร์ตู้เย็นเสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "Er FS": { desc: "เซ็นเซอร์อุณหภูมิช่องแข็ง (Freezer) ผิดปกติ", cause: "เทอร์มิสเตอร์ช่องแข็งเสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "Er dS": { desc: "เซ็นเซอร์ละลายน้ำแข็ง (Defrost) ผิดปกติ", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ defrost" },
    "Er rt": { desc: "เซ็นเซอร์ห้องภายนอก (Room temp) ผิดปกติ", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์ ambient" },
    "Er Ft": { desc: "เซ็นเซอร์ท่อ evaporator ช่องแข็งผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "Er dH": { desc: "ฮีตเตอร์ defrost ผิดปกติ", cause: "ฮีตเตอร์ขาด / ฟิวส์ defrost ขาด", fix: "เปลี่ยนฮีตเตอร์ / bi-metal fuse" },
    "Er CF": { desc: "พัดลม condenser (BLDC) ผิดปกติ", cause: "มอเตอร์ condenser fan เสีย", fix: "เปลี่ยนมอเตอร์พัดลม condenser" },
    "Er FF": { desc: "พัดลมช่องแข็ง (Freezer fan / BLDC) ผิดปกติ", cause: "มอเตอร์พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "Er CO": { desc: "สัญญาณ communication ผิดพลาด (Main-Display)", cause: "แผงสื่อสารเสีย", fix: "เช็คสาย, เปลี่ยนแผง Main/Display" },
    "Er IS": { desc: "Ice maker sensor ผิดปกติ", cause: "เทอร์มิสเตอร์ ice maker เสีย", fix: "เปลี่ยน ice maker" },
    "Er HS": { desc: "Humidity sensor ผิดปกติ", cause: "เซ็นเซอร์ความชื้นเสีย", fix: "เปลี่ยน humidity sensor" },
    "Er gF": { desc: "Geared fan (motor drive) ผิดปกติ", cause: "มอเตอร์ผิดปกติ", fix: "เปลี่ยนมอเตอร์" },
    "Er IF": { desc: "Ice maker fan ผิดปกติ", cause: "มอเตอร์พัดลม ice maker เสีย", fix: "เปลี่ยนมอเตอร์" },
    "Er Ic": { desc: "Ice maker จ่ายน้ำแข็งไม่ได้", cause: "น้ำแข็งค้าง / motor ice maker เสีย", fix: "ละลายน้ำแข็งที่ค้าง, เปลี่ยน ice maker" },
    "Er It": { desc: "เซ็นเซอร์ช่อง ice maker ผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "Er F1": { desc: "พัดลมช่องแข็ง DC motor ผิด", cause: "มอเตอร์ DC fan เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "Er F3": { desc: "Condenser fan DC motor ผิด", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "rE": { desc: "เซ็นเซอร์ห้องเย็นช็อต/ขาด", cause: "สายเทอร์มิสเตอร์หลุด", fix: "ตรวจสายและเปลี่ยนเทอร์มิสเตอร์" },
    "FE": { desc: "เซ็นเซอร์ช่องแข็งช็อต/ขาด", cause: "สายเทอร์มิสเตอร์หลุด", fix: "ตรวจสายและเปลี่ยนเทอร์มิสเตอร์" },
    "dE": { desc: "เซ็นเซอร์ defrost ช็อต/ขาด", cause: "สายเทอร์มิสเตอร์หลุด", fix: "ตรวจสายและเปลี่ยนเทอร์มิสเตอร์ defrost" },
    "CE": { desc: "Compressor BLDC error", cause: "คอมเพรสเซอร์ / อินเวอร์เตอร์เสีย", fix: "เปลี่ยนแผง inverter / คอมเพรสเซอร์" },
    "CH": { desc: "Compressor ไม่ทำงาน (lock)", cause: "คอมฯล็อค", fix: "วัดคอมฯ, เปลี่ยนถ้าเสีย" },
    "E0": { desc: "Ice maker จ่ายน้ำแข็งไม่ได้", cause: "ice maker ติด", fix: "รีเซ็ต ice maker (กดปุ่มด้านใต้ ice maker)" }
  },
  "Hitachi": {
    "F0-01": { desc: "Power source error", cause: "ไฟเข้าผิดปกติ / แรงดันต่ำ", fix: "ตรวจไฟเข้า, ใช้ stabilizer" },
    "F0-02": { desc: "Compressor inverter error", cause: "แผง inverter เสีย", fix: "เปลี่ยนแผง inverter" },
    "F0-03": { desc: "Compressor startup failure", cause: "คอมฯ startup ไม่ได้", fix: "ตรวจคอมฯ, capacitor" },
    "F0-04": { desc: "Compressor overcurrent", cause: "คอมฯกินไฟมาก", fix: "เปลี่ยนคอมฯหากวัดแล้วเสีย" },
    "F0-09": { desc: "Condenser fan motor ผิดปกติ", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "F0-15": { desc: "Inverter heat sink overheat", cause: "แผงร้อนเกิน", fix: "ทำความสะอาดช่องระบายความร้อน" },
    "F1-01": { desc: "เซ็นเซอร์อุณหภูมิช่องเย็นผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "F1-02": { desc: "เซ็นเซอร์อุณหภูมิช่องแข็งผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "F1-03": { desc: "เซ็นเซอร์ห้องภายนอกผิด", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "F1-04": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "F1-05": { desc: "Vacuum compartment sensor ผิด (Vacuum Compartment)", cause: "เซ็นเซอร์เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "F2-01": { desc: "Freezer fan motor ผิดปกติ", cause: "พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "F2-02": { desc: "Fridge fan motor ผิดปกติ", cause: "พัดลมช่องเย็นเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "F2-03": { desc: "Damper motor (ช่องลม) ผิดปกติ", cause: "damper ค้าง / มอเตอร์เสีย", fix: "เปลี่ยน damper motor" },
    "F3-01": { desc: "Defrost ไม่สำเร็จ (timeout)", cause: "ฮีตเตอร์อ่อน / น้ำแข็งเกาะหนา", fix: "ละลายน้ำแข็ง, เปลี่ยนฮีตเตอร์" },
    "F5-01": { desc: "Communication error (Main-Display)", cause: "สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "F6-01": { desc: "Ice maker motor ผิดปกติ", cause: "ice maker ค้าง", fix: "ละลายน้ำแข็ง, เปลี่ยน ice maker" },
    "F6-02": { desc: "Ice maker water valve ผิด", cause: "วาล์วน้ำเสีย", fix: "เปลี่ยน water valve" }
  },
  "Toshiba": {
    "H1": { desc: "เซ็นเซอร์ช่องเย็น (Fridge) ผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "H2": { desc: "เซ็นเซอร์ช่องแช่แข็ง (Freezer) ผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "H3": { desc: "เซ็นเซอร์ defrost ผิดปกติ", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "H4": { desc: "เซ็นเซอร์อุณหภูมิห้องภายนอกผิด", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "H5": { desc: "Defrost ไม่สำเร็จ", cause: "ฮีตเตอร์ / ฟิวส์ defrost ขาด", fix: "เปลี่ยนฮีตเตอร์/ฟิวส์" },
    "H6": { desc: "Freezer fan motor ผิดปกติ", cause: "มอเตอร์พัดลมเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "H7": { desc: "Condenser fan motor ผิดปกติ", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "H8": { desc: "Damper motor ผิดปกติ", cause: "damper ค้าง / มอเตอร์เสีย", fix: "เปลี่ยน damper motor" },
    "F1": { desc: "Inverter compressor ผิดปกติ", cause: "แผง inverter / คอมฯเสีย", fix: "เปลี่ยนแผง inverter" },
    "F2": { desc: "Main PCB communication error", cause: "สายสัญญาณหลวม / แผงเสีย", fix: "เช็คสาย, เปลี่ยนแผง" },
    "F3": { desc: "Ice maker ผิดปกติ", cause: "ice maker ค้าง / motor เสีย", fix: "ละลายน้ำแข็ง, เปลี่ยน ice maker" },
    "F4": { desc: "Water valve ผิดปกติ", cause: "วาล์วน้ำเสีย", fix: "เปลี่ยน water inlet valve" },
    "F5": { desc: "EEPROM ผิดพลาด", cause: "แผง main เสีย", fix: "เปลี่ยนแผง main PCB" }
  },
  "Panasonic": {
    "H01": { desc: "เซ็นเซอร์อุณหภูมิช่องแช่แข็งผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "H02": { desc: "เซ็นเซอร์อุณหภูมิช่องเย็นผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "H03": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "H04": { desc: "เซ็นเซอร์อุณหภูมิห้องภายนอกผิด", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "H05": { desc: "เซ็นเซอร์ vegetable room ผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "H06": { desc: "เซ็นเซอร์ humidity ผิด", cause: "เซ็นเซอร์ความชื้นเสีย", fix: "เปลี่ยน humidity sensor" },
    "F11": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด / เซ็นเซอร์ไม่ทำงาน", fix: "เปลี่ยนฮีตเตอร์ defrost" },
    "F12": { desc: "Freezer fan motor error", cause: "มอเตอร์พัดลมเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "F13": { desc: "Condenser fan motor error", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "F14": { desc: "Damper motor error", cause: "damper ค้าง", fix: "เปลี่ยน damper motor" },
    "F15": { desc: "Compressor inverter error", cause: "แผง inverter / คอมฯเสีย", fix: "เปลี่ยนแผง inverter" },
    "F16": { desc: "Ice maker error", cause: "ice maker ค้าง", fix: "ละลายน้ำแข็ง, เปลี่ยน ice maker" },
    "F17": { desc: "Communication error (แผง main-display)", cause: "สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "F18": { desc: "EEPROM ผิดพลาด", cause: "แผง main เสีย", fix: "เปลี่ยนแผง main PCB" }
  },
  "Sharp": {
    "H1": { desc: "เซ็นเซอร์ช่องเย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "H2": { desc: "เซ็นเซอร์ช่องแช่แข็งผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "H3": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "H4": { desc: "เซ็นเซอร์ห้องภายนอกผิด", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "F1": { desc: "Freezer fan motor ผิดปกติ", cause: "มอเตอร์พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "F2": { desc: "Compressor ผิดปกติ", cause: "คอมฯเสีย / inverter เสีย", fix: "ตรวจคอมฯ, เปลี่ยนแผง inverter" },
    "F3": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยนฮีตเตอร์" },
    "F4": { desc: "Communication error", cause: "สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "F5": { desc: "EEPROM ผิดพลาด", cause: "แผง PCB เสีย", fix: "เปลี่ยนแผง PCB" },
    "E1": { desc: "Damper / air flow ผิดปกติ", cause: "damper ค้าง", fix: "เปลี่ยน damper motor" },
    "E2": { desc: "Ice maker error", cause: "ice maker ค้าง / เสีย", fix: "ละลายน้ำแข็ง, เปลี่ยน ice maker" }
  },
  "Mitsubishi Electric": {
    "E0": { desc: "EEPROM ผิดพลาด", cause: "แผง PCB เสีย", fix: "เปลี่ยนแผง PCB" },
    "E1": { desc: "เซ็นเซอร์ช่องเย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "E2": { desc: "เซ็นเซอร์ช่องแข็งผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "E3": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "E4": { desc: "เซ็นเซอร์ ambient ผิด", cause: "เซ็นเซอร์ห้องภายนอกเสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "E5": { desc: "Freezer fan motor error", cause: "มอเตอร์พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E6": { desc: "Condenser fan motor error", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E7": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยนฮีตเตอร์ defrost" },
    "E8": { desc: "Compressor inverter error", cause: "แผง inverter / คอมฯเสีย", fix: "เปลี่ยนแผง inverter" },
    "E9": { desc: "Communication error", cause: "สายสัญญาณหลวม", fix: "เช็คสาย" },
    "EE": { desc: "Ice maker error", cause: "ice maker ค้าง", fix: "ละลายน้ำแข็ง, เปลี่ยน ice maker" }
  },
  "Haier": {
    "E0": { desc: "เซ็นเซอร์ defrost ผิดปกติ", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "E1": { desc: "เซ็นเซอร์ช่องเย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "E2": { desc: "เซ็นเซอร์ช่องแช่แข็งผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "E3": { desc: "เซ็นเซอร์อุณหภูมิห้องภายนอกผิด", cause: "เซ็นเซอร์ ambient เสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "E4": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ / ฟิวส์ defrost ขาด", fix: "เปลี่ยนฮีตเตอร์/ฟิวส์" },
    "E5": { desc: "Communication error", cause: "สายสัญญาณหลวม", fix: "เช็คสาย" },
    "E6": { desc: "Freezer fan motor error", cause: "พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E7": { desc: "Fridge fan motor error", cause: "พัดลมช่องเย็นเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E8": { desc: "Damper motor error", cause: "damper ค้าง", fix: "เปลี่ยน damper motor" },
    "F1": { desc: "Compressor ผิดปกติ", cause: "คอมฯเสีย", fix: "ตรวจคอมฯ" },
    "F2": { desc: "Inverter error", cause: "แผง inverter เสีย", fix: "เปลี่ยนแผง inverter" }
  },
  "Electrolux": {
    "SY EF": { desc: "Evaporator fan motor error", cause: "มอเตอร์พัดลม evaporator เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "SY CE": { desc: "Communication error (Main-Display)", cause: "สายสัญญาณหลวม", fix: "เช็คสาย, เปลี่ยนแผง" },
    "SY CF": { desc: "Condenser fan motor error", cause: "มอเตอร์พัดลม condenser เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "SY IF": { desc: "Ice maker fan error", cause: "พัดลม ice maker เสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "1": { desc: "เซ็นเซอร์ fresh food (ช่องเย็น) ผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "2": { desc: "เซ็นเซอร์ freezer ผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "3": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "4": { desc: "เซ็นเซอร์ ambient ผิด", cause: "เซ็นเซอร์ห้องภายนอกเสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "5": { desc: "Ice maker sensor ผิด", cause: "เทอร์มิสเตอร์ ice maker เสีย", fix: "เปลี่ยน ice maker" },
    "DF": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยนฮีตเตอร์ defrost" }
  },
  "Whirlpool": {
    "CE": { desc: "Communication error (Main-UI)", cause: "สายสัญญาณหลวม / แผง UI เสีย", fix: "เช็คสาย, เปลี่ยนแผง" },
    "E1": { desc: "เซ็นเซอร์ช่องเย็นผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "E2": { desc: "เซ็นเซอร์ช่องแข็งผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "E3": { desc: "เซ็นเซอร์ evaporator ผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "E4": { desc: "เซ็นเซอร์ ambient ผิด", cause: "เซ็นเซอร์ห้องภายนอกเสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "E5": { desc: "Fan motor error", cause: "มอเตอร์พัดลมเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E6": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยนฮีตเตอร์" },
    "E7": { desc: "Ice maker error", cause: "ice maker ค้าง", fix: "เปลี่ยน ice maker" },
    "E8": { desc: "Compressor / inverter error", cause: "คอมฯ / แผง inverter เสีย", fix: "เปลี่ยนแผง inverter" },
    "PO": { desc: "ไฟฟ้าขาดระหว่างทำงาน (Power Outage)", cause: "ไฟดับ", fix: "กด Reset ที่ display" }
  },
  "Daewoo": {
    "E1": { desc: "เซ็นเซอร์ช่องเย็นผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "E2": { desc: "เซ็นเซอร์ช่องแช่แข็งผิดปกติ", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "E3": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์ defrost เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์" },
    "E4": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยนฮีตเตอร์ defrost" },
    "E5": { desc: "Freezer fan motor error", cause: "พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E6": { desc: "Communication error", cause: "สายสัญญาณหลวม", fix: "เช็คสาย" },
    "E7": { desc: "EEPROM ผิดพลาด", cause: "แผง PCB เสีย", fix: "เปลี่ยนแผง PCB" }
  },
  "Beko": {
    "E0": { desc: "เซ็นเซอร์ defrost ผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ defrost" },
    "E1": { desc: "เซ็นเซอร์ช่องเย็นผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ตู้เย็น" },
    "E2": { desc: "เซ็นเซอร์ช่องแช่แข็งผิด", cause: "เทอร์มิสเตอร์เสีย", fix: "เปลี่ยนเทอร์มิสเตอร์ช่องแช่แข็ง" },
    "E3": { desc: "เซ็นเซอร์ ambient ผิด", cause: "เซ็นเซอร์ห้องภายนอกเสีย", fix: "เปลี่ยนเซ็นเซอร์" },
    "E4": { desc: "Freezer fan motor error", cause: "พัดลมช่องแข็งเสีย", fix: "เปลี่ยนมอเตอร์พัดลม" },
    "E5": { desc: "Defrost ล้มเหลว", cause: "ฮีตเตอร์ขาด", fix: "เปลี่ยนฮีตเตอร์" },
    "E6": { desc: "Compressor inverter error", cause: "แผง inverter / คอมฯเสีย", fix: "เปลี่ยนแผง inverter" },
    "E7": { desc: "EEPROM ผิดพลาด", cause: "แผง PCB เสีย", fix: "เปลี่ยนแผง PCB" }
  }
};

export function renderErrorCodesFridgePage(ctx) {
  renderErrorExplorer({
    containerId: "page-error_codes_fridge",
    db: FRIDGE_DB,
    hero: {
      icon: "🧊",
      title: "Error Code ตู้เย็น",
      subtitle: "ค้นหารหัสข้อผิดพลาดตู้เย็นตามยี่ห้อ",
      gradient: "linear-gradient(135deg,#dbeafe,#e0f2fe)",
      titleColor: "#1e40af",
      subtitleColor: "#1e3a8a"
    },
    placeholder: "พิมพ์รหัส เช่น 21E, Er FS, H1, F0-01...",
    tips: {
      title: "💡 เคล็ดลับก่อนเรียกช่าง (ตู้เย็น)",
      html: `
        1. <b>ถอดปลั๊ก 5 นาที</b> — แล้วเสียบใหม่ — แก้ error ชั่วคราวได้บ่อย<br>
        2. <b>เช็คประตู</b> — ประตูปิดไม่สนิททำให้ไม่เย็น + error fan<br>
        3. <b>ละลายน้ำแข็ง</b> — น้ำแข็งเกาะ evaporator ทำให้ fan error<br>
        4. <b>คอยล์ด้านหลัง/ใต้</b> — ทำความสะอาดคอยล์ร้อน ลดโอกาสคอมฯพัง<br>
        5. <b>ห้ามแช่ของร้อน</b> — เซ็นเซอร์จะคิดว่าตู้ไม่เย็นพอ → overwork<br>
        6. <b>ice maker</b> — ถ้า error ให้ลองถอดถังน้ำแข็งออก ล้าง แล้วใส่กลับ
      `
    }
  });
}
