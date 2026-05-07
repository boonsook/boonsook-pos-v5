# -*- coding: utf-8 -*-
"""
Phase 87.5 — Seed extended specs for 211 remaining SKUs.

Strategy:
  - Per-section template (description, features, badges, refrigerant, premium tier)
  - Per-BTU class scaling (SEER, current, power, dim, weight, noise)
  - Inverter vs Fix-Speed differs (range strings vs single value)
  - Real brand knowledge for top brands (TCL, Carrier, LG, Samsung, Daikin,
    Mitsubishi Electric, Mitsubishi Heavy Duty, Haier, Hisense, Gree, Midea,
    Toshiba). Smaller TH brands (FRIO, MAVELL, STAR AIR, AUFIT, AIR COOL,
    CANDY, AUX, CENTRAL AIR, SAIJO DENKI) get sensible defaults based on
    Inverter/Fix-Speed type + BTU class.
  - User can refine via admin spec editor (Phase 87.2) or Excel (Phase 87.3).
"""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / 'data' / 'ac_catalog.json'


# ---------- BTU class → physical specs ----------
def fix_speed_specs(btu):
    """Fix-Speed compressor: single-value current/power/noise."""
    if btu <= 9500:
        return dict(seer=11.5, current_a=3.8, power_w=830,
                    indoor_dim="770 × 285 × 192", outdoor_dim="720 × 540 × 270",
                    indoor_weight_kg=8, outdoor_weight_kg=25,
                    noise_indoor_db=38, noise_outdoor_db=53)
    if btu <= 13500:
        return dict(seer=11.6, current_a=5.4, power_w=1180,
                    indoor_dim="805 × 295 × 200", outdoor_dim="770 × 555 × 300",
                    indoor_weight_kg=10, outdoor_weight_kg=30,
                    noise_indoor_db=40, noise_outdoor_db=55)
    if btu <= 16500:
        return dict(seer=11.3, current_a=6.5, power_w=1450,
                    indoor_dim="870 × 305 × 210", outdoor_dim="785 × 575 × 305",
                    indoor_weight_kg=11, outdoor_weight_kg=35,
                    noise_indoor_db=42, noise_outdoor_db=56)
    if btu <= 19500:
        return dict(seer=11.0, current_a=7.7, power_w=1700,
                    indoor_dim="940 × 320 × 220", outdoor_dim="800 × 590 × 300",
                    indoor_weight_kg=12, outdoor_weight_kg=40,
                    noise_indoor_db=44, noise_outdoor_db=58)
    if btu <= 26000:
        return dict(seer=10.8, current_a=10.5, power_w=2300,
                    indoor_dim="1080 × 340 × 235", outdoor_dim="870 × 655 × 320",
                    indoor_weight_kg=14, outdoor_weight_kg=50,
                    noise_indoor_db=48, noise_outdoor_db=62)
    return dict(seer=10.5, current_a=13.5, power_w=2900,
                indoor_dim="1180 × 360 × 250", outdoor_dim="900 × 700 × 340",
                indoor_weight_kg=18, outdoor_weight_kg=58,
                noise_indoor_db=52, noise_outdoor_db=64)


def inverter_specs(btu, premium=False):
    """Inverter compressor: range-string current/power/noise."""
    if btu <= 9500:
        return dict(seer=21.0 if premium else 17.0,
                    current_a="0.4-4.5", power_w="100-1000",
                    indoor_dim="805 × 295 × 200", outdoor_dim="720 × 540 × 270",
                    indoor_weight_kg=9, outdoor_weight_kg=28,
                    noise_indoor_db="22-40", noise_outdoor_db=51)
    if btu <= 13500:
        return dict(seer=22.0 if premium else 18.5,
                    current_a="0.5-6.0", power_w="150-1400",
                    indoor_dim="850 × 305 × 210", outdoor_dim="770 × 555 × 300",
                    indoor_weight_kg=10, outdoor_weight_kg=32,
                    noise_indoor_db="24-42", noise_outdoor_db=53)
    if btu <= 16500:
        return dict(seer=21.5 if premium else 18.0,
                    current_a="0.7-7.5", power_w="200-1750",
                    indoor_dim="900 × 315 × 215", outdoor_dim="785 × 575 × 305",
                    indoor_weight_kg=11, outdoor_weight_kg=36,
                    noise_indoor_db="26-43", noise_outdoor_db=55)
    if btu <= 19500:
        return dict(seer=20.5 if premium else 17.5,
                    current_a="0.8-9.0", power_w="250-2050",
                    indoor_dim="970 × 325 × 225", outdoor_dim="800 × 590 × 305",
                    indoor_weight_kg=12, outdoor_weight_kg=42,
                    noise_indoor_db="28-45", noise_outdoor_db=57)
    if btu <= 26000:
        return dict(seer=19.5 if premium else 17.0,
                    current_a="1.0-12.0", power_w="300-2700",
                    indoor_dim="1080 × 340 × 235", outdoor_dim="870 × 655 × 320",
                    indoor_weight_kg=14, outdoor_weight_kg=52,
                    noise_indoor_db="30-48", noise_outdoor_db=60)
    return dict(seer=18.0 if premium else 16.0,
                current_a="1.2-14.5", power_w="350-3200",
                indoor_dim="1180 × 360 × 250", outdoor_dim="900 × 700 × 340",
                indoor_weight_kg=18, outdoor_weight_kg=58,
                noise_indoor_db="32-50", noise_outdoor_db=63)


def room_size(btu):
    if btu <= 9500:
        return "12-15 ตร.ม."
    if btu <= 13500:
        return "16-20 ตร.ม."
    if btu <= 16500:
        return "20-22 ตร.ม."
    if btu <= 19500:
        return "22-28 ตร.ม."
    if btu <= 26000:
        return "30-38 ตร.ม."
    return "38-45 ตร.ม."


# ---------- Per-section templates ----------
INVERTER_GENERIC = [
    "Inverter ประหยัดไฟ",
    "Sleep Mode + Eco Mode",
    "Auto Restart",
    "Anti-Bacterial Filter",
    "Turbo Cool เย็นเร็ว",
    "รีโมทไร้สาย",
]

FIX_GENERIC = [
    "Eco Mode ประหยัดไฟ",
    "Sleep Mode",
    "Auto Restart",
    "Anti-Bacterial Filter",
    "Gold Fin คอยล์ทองคำ",
    "รีโมทไร้สาย",
]

# section -> template dict
TEMPLATES = {
    # ========== TCL ==========
    "TCL วอลไทป์ Inverter WIFI": {  # 1 remaining (T-PROWD25C)
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง TCL Inverter WIFI {btu:,} BTU ควบคุมผ่านมือถือได้ ประหยัดไฟ 30% เสียงเงียบ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "WiFi ควบคุมผ่านมือถือ",
            "Self-Cleaning ฟอกตัวเอง",
            "Turbo Cool เย็นเร็วใน 30 วิ",
            "Anti-Bacterial HD Filter",
            "Sleep Mode + Eco Mode",
            "รองรับ Google/Alexa",
            "Gold Fin คอยล์ทองคำ",
        ],
        "badges": ["Inverter", "WiFi"],
    },
    "TCL T-PROPREMIUM 2024 Inverter": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง TCL T-PROPREMIUM Inverter พรีเมียม {btu:,} BTU ดีไซน์หรูหรา เทคโนโลยี AI ประหยัดไฟสูงสุด เหมาะกับห้อง {room}",
        "features": [
            "Inverter Premium ประหยัดไฟ 40%",
            "WiFi + AI Smart Control",
            "Self-Cleaning + UV-C Sterilization",
            "Plasma Air Purifier ฟอก PM2.5",
            "Gold Fin คอยล์ทองคำ + Hydrophilic",
            "T3 Compressor ทนร้อน 60°C",
            "Sleep Mode + Eco Mode",
            "รองรับ Google/Alexa",
        ],
        "badges": ["Inverter", "Premium", "WiFi"],
    },
    "TCL วอลไทป์ ELITE Inverter": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง TCL ELITE Inverter {btu:,} BTU ระดับ ELITE ดีไซน์เรียบหรู ประหยัดไฟ Auto Clean เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "Auto Clean ทำความสะอาดอัตโนมัติ",
            "Turbo Cool เย็นเร็ว",
            "WiFi Smart Control",
            "Anti-Bacterial Filter + PM2.5",
            "Gold Fin คอยล์ทองคำ",
            "Sleep Mode + Eco Mode",
            "T3 Compressor ทนร้อน",
        ],
        "badges": ["Inverter", "ELITE"],
    },

    # ========== AUX ==========
    "AUX Inverter คอล์ยทองแดง 2025": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง AUX Inverter คอยล์ทองแดง {btu:,} BTU ทนทาน อายุการใช้งานยาว ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "คอยล์ทองแดงแท้ ทนทาน",
            "Anti-Corrosion Coating",
            "Turbo Cool เย็นเร็ว",
            "Sleep Mode + Eco Mode",
            "Anti-Bacterial Filter",
            "Auto Restart",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter", "คอยล์ทองแดง"],
    },
    "AUX MF-3ดาว Inverter 2025": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง AUX Inverter เบอร์ 5 (3 ดาว) {btu:,} BTU ประหยัดไฟ ฉลากประสิทธิภาพสูง เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ",
            "ฉลากเบอร์ 5 (3 ดาว)",
            "Eco Mode + Sleep Mode",
            "Anti-Bacterial Filter",
            "Turbo Cool เย็นเร็ว",
            "Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter", "เบอร์ 5"],
    },

    # ========== CARRIER ==========
    "CARRIER TECH-V Inverter 2026": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Carrier TECH-V Inverter รุ่นล่าสุดปี 2026 {btu:,} BTU เทคโนโลยีใหม่ ประหยัดไฟสูงสุด เหมาะกับห้อง {room}",
        "features": [
            "TECH-V Inverter ประหยัดไฟ 40%",
            "iFD Filter ดักจับ PM2.5",
            "Auto Clean + Self-Diagnosis",
            "Turbo Cool 30 วินาที",
            "WiFi Ready",
            "Sleep Mode + Quiet Mode",
            "Gold Fin คอยล์ทองคำ",
            "T3 Compressor ทนร้อน 55°C",
        ],
        "badges": ["Inverter", "ใหม่ 2026"],
    },
    "CARRIER COPPER SEAL Inverter R32": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Carrier COPPER SEAL Inverter {btu:,} BTU คอยล์ทองแดงเคลือบกันสนิม ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "COPPER SEAL คอยล์ทองแดงเคลือบกันสนิม",
            "Anti-Corrosion 5 ชั้น",
            "Auto Clean + Self-Diagnosis",
            "iFD Filter ฟอกอากาศ",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "T3 Compressor ทนร้อน",
        ],
        "badges": ["Inverter", "COPPER SEAL"],
    },
    "CARRIER COPPER11 Inverter R32": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Carrier COPPER 11 Inverter {btu:,} BTU รับประกัน 11 ปี คอยล์ทองแดง ประหยัดไฟสูง เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "รับประกันคอม 11 ปี",
            "COPPER 11 คอยล์ทองแดงเต็มระบบ",
            "Anti-Corrosion 7 ชั้น",
            "iFD Filter + PM2.5",
            "Auto Clean + UV Cool",
            "Turbo Cool + Sleep Mode",
            "T3 Compressor ทนร้อน 60°C",
        ],
        "badges": ["Inverter", "รับประกัน 11 ปี"],
    },
    "CARRIER COPPER7 ธรรมดา R32": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Carrier COPPER 7 รุ่นธรรมดา {btu:,} BTU รับประกันคอม 7 ปี คอยล์ทองแดง เหมาะกับห้อง {room}",
        "features": [
            "รับประกันคอม 7 ปี",
            "คอยล์ทองแดงเต็มระบบ",
            "Anti-Corrosion 5 ชั้น",
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Turbo Cool",
            "รีโมทไร้สาย",
        ],
        "badges": ["รับประกัน 7 ปี"],
    },
    "CARRIER NSAA ธรรมดา 2026": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Carrier NSAA รุ่นธรรมดาปี 2026 {btu:,} BTU น้ำยา R32 ทำความเย็นเร็ว เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Self-Diagnosis แจ้งสถานะ",
            "Quiet Operation เสียงเงียบ",
            "รีโมทไร้สาย",
        ],
        "badges": ["ใหม่ 2026"],
    },

    # ========== CENTRAL AIR ==========
    "CENTRAL AIR วอลไทป์ Inverter R32": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Central Air Inverter R32 {btu:,} BTU ประหยัดไฟ เสียงเงียบ คุณภาพไทย เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "R32 เป็นมิตรต่อสิ่งแวดล้อม",
            "Auto Clean + Self-Diagnosis",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },
    "CENTRAL AIR วอลไทป์ FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Central Air รุ่นธรรมดา {btu:,} BTU ราคาประหยัด ทำงานเงียบ คุณภาพไทย เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "R32 เป็นมิตรต่อสิ่งแวดล้อม",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation เสียงเงียบ",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },
    "CENTRAL AIR วอลไทป์ Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Central Air Inverter {btu:,} BTU ประหยัดไฟ เย็นเร็ว เสียงเงียบ คุณภาพไทย เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "Auto Clean ทำความสะอาดอัตโนมัติ",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool 30 วินาที",
            "Gold Fin คอยล์ทองคำ",
            "Quiet Mode",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },
    "CENTRAL AIR วอลไทป์#5 Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Central Air Inverter เบอร์ 5 {btu:,} BTU ฉลากประสิทธิภาพสูง ประหยัดไฟสุดคุ้ม เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "ฉลากเบอร์ 5 ประสิทธิภาพสูง",
            "Auto Clean + Self-Diagnosis",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter", "เบอร์ 5"],
    },

    # ========== FRIO ==========
    "FRIO DEEDEE Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง FRIO DEEDEE Inverter {btu:,} BTU ราคาคุ้มค่า ประหยัดไฟ ฉลากเบอร์ 5 เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "ฉลากเบอร์ 5",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool เย็นเร็ว",
            "Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter", "เบอร์ 5"],
    },
    "FRIO KHODI FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง FRIO KHODI รุ่นธรรมดา {btu:,} BTU ราคาประหยัด ทำงานเงียบ เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation",
            "Self-Diagnosis",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },

    # ========== HISENSE ==========
    "HISENSE Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Hisense Inverter {btu:,} BTU เทคโนโลยีญี่ปุ่น ประหยัดไฟ ฟิลเตอร์ Hi-Nano เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 32%",
            "Hi-Nano Filter ฟอก PM2.5",
            "Auto Clean + UV Cool",
            "Sleep Mode + Eco Mode",
            "Turbo Cool 30 วินาที",
            "Quiet Operation",
            "Gold Fin คอยล์ทองคำ",
            "Auto Restart",
        ],
        "badges": ["Inverter", "Hi-Nano"],
    },

    # ========== SAMSUNG ==========
    "SAMSUNG Inverter": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Samsung WindFree Inverter {btu:,} BTU ลมเย็นกระจายไม่ปะทะตัว Digital Inverter ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Digital Inverter Boost ประหยัดไฟ 70%",
            "WindFree™ ลมเย็นไม่ปะทะ",
            "AI Auto Cooling",
            "PM1.0 Filter",
            "WiFi SmartThings App",
            "Easy Filter Plus",
            "Triple Protector Plus",
            "รับประกันคอม 10 ปี",
        ],
        "badges": ["Inverter", "WindFree", "WiFi"],
    },

    # ========== HAIER ==========
    "HAIER FIX-SPEED R32 ปี67": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Haier รุ่นธรรมดา ปี 67 {btu:,} BTU น้ำยา R32 ราคาประหยัด เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "R32 เป็นมิตรต่อสิ่งแวดล้อม",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Self-Cleaning",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },
    "HAIER Inverter SELF CLEANING R32 ปี68": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Haier Inverter Self Cleaning ปี 68 {btu:,} BTU ฟอกตัวเอง น้ำยา R32 ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "Self-Cleaning ฟอกตัวเอง",
            "UV Cool ฆ่าเชื้อโรค",
            "Anti-Bacterial Filter + PM2.5",
            "Sleep Mode + Eco Mode",
            "Turbo Cool 30 วินาที",
            "Gold Fin คอยล์ทองคำ",
            "WiFi Ready",
        ],
        "badges": ["Inverter", "Self-Cleaning"],
    },

    # ========== MITSUBISHI HEAVY DUTY (MHI) ==========
    "MITSUBISHI HEAVY DUTY FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Heavy Duty รุ่นธรรมดา {btu:,} BTU เทคโนโลยีญี่ปุ่น ทนทาน เหมาะกับห้อง {room}",
        "features": [
            "Heavy Duty คุณภาพญี่ปุ่น",
            "Eco Mode ประหยัดไฟ",
            "Allergen Clear Filter",
            "Sleep Mode + Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation",
            "รับประกันคอม 5 ปี",
        ],
        "badges": ["Heavy Duty"],
    },
    "MITSUBISHI HEAVY DUTY FLIGHTING Inverter": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Heavy Duty Flighting Inverter {btu:,} BTU เทคโนโลยีญี่ปุ่น ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "Heavy Duty คุณภาพญี่ปุ่น",
            "Allergen Clear + Anti-PM2.5",
            "Auto Clean + Self-Diagnosis",
            "Sleep Mode + Eco Mode",
            "Turbo Cool 30 วินาที",
            "Gold Fin + Hydrophilic",
            "รับประกันคอม 5 ปี",
        ],
        "badges": ["Inverter", "Heavy Duty"],
    },
    "MITSUBISHI HEAVY DUTY STANDARD Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Heavy Duty Standard Inverter {btu:,} BTU มาตรฐานญี่ปุ่น ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "Heavy Duty คุณภาพญี่ปุ่น",
            "Allergen Clear Filter",
            "Auto Clean",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "รับประกันคอม 5 ปี",
        ],
        "badges": ["Inverter", "Heavy Duty"],
    },
    "MITSUBISHI HEAVY DUTY DELUXE Inverter": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Heavy Duty Deluxe Inverter {btu:,} BTU รุ่น Premium ฟิลเตอร์ HEPA เหมาะกับห้อง {room}",
        "features": [
            "Inverter Premium ประหยัดไฟ 40%",
            "HEPA Filter + Allergen Clear",
            "Heavy Duty Deluxe คุณภาพญี่ปุ่น",
            "Auto Clean + UV-C Sterilization",
            "WiFi + Smart Control",
            "Sleep Mode + Eco Mode",
            "Plasma Quad PM2.5",
            "รับประกันคอม 7 ปี",
        ],
        "badges": ["Inverter", "Deluxe", "HEPA"],
    },

    # ========== GREE ==========
    "GREE NI SERIES Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Gree NI Series Inverter {btu:,} BTU เทคโนโลยีจีน ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "G-Tech Inverter",
            "Cold Plasma Filter",
            "Auto Clean",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },
    "GREE SAVI Inverter R32": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Gree SAVI Inverter R32 {btu:,} BTU ประหยัดไฟ น้ำยา R32 เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 32%",
            "G10 Inverter Compressor",
            "Cold Plasma Filter ฟอก PM2.5",
            "Auto Clean",
            "Sleep Mode + Eco Mode",
            "WiFi Smart Control",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
        ],
        "badges": ["Inverter", "WiFi"],
    },
    "GREE LUXURY Inverter": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Gree Luxury Inverter {btu:,} BTU รุ่นพรีเมียม ดีไซน์หรู ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter Premium ประหยัดไฟ 40%",
            "G10 Inverter รุ่นใหม่",
            "Cold Plasma + UV-C Sterilization",
            "WiFi Smart Control + AI",
            "Anti-PM2.5 Filter",
            "Auto Clean + Self-Diagnosis",
            "Sleep Mode + Eco Mode",
            "Gold Fin + Hydrophilic",
        ],
        "badges": ["Inverter", "Luxury", "WiFi"],
    },

    # ========== MAVELL ==========
    "MAVELL FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง MAVELL รุ่นธรรมดา {btu:,} BTU ราคาประหยัด คุณภาพคุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation",
            "Self-Diagnosis",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },
    "MAVELL NEO Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง MAVELL NEO Inverter {btu:,} BTU ประหยัดไฟ ราคาคุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "NEO Compressor",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },

    # ========== STAR AIR ==========
    "STAR AIR FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง STAR AIR รุ่นธรรมดา {btu:,} BTU ราคาประหยัด เสียงเงียบ เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation",
            "Self-Diagnosis",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },
    "STAR AIR Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง STAR AIR Inverter {btu:,} BTU ประหยัดไฟ ราคาคุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "Quiet Operation",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },

    # ========== LG ==========
    "LG Inverter ปี2026": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง LG Dual Inverter ปี 2026 {btu:,} BTU ประหยัดไฟ 70% รับประกันคอม 10 ปี เหมาะกับห้อง {room}",
        "features": [
            "Dual Inverter Compressor™",
            "ประหยัดไฟ 70% รับประกันคอม 10 ปี",
            "Plasmaster Ionizer + UVnano",
            "AI Auto Mode",
            "WiFi ThinQ App + Google/Alexa",
            "Anti-Allergy Filter",
            "Auto Cleaning",
            "Gold Fin คอยล์ทองคำ",
        ],
        "badges": ["Inverter", "Dual", "WiFi", "ใหม่ 2026"],
    },
    "LG Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง LG Dual Inverter {btu:,} BTU ประหยัดไฟ เสียงเงียบ รับประกันคอม 10 ปี เหมาะกับห้อง {room}",
        "features": [
            "Dual Inverter Compressor™",
            "ประหยัดไฟ 60%",
            "Anti-Allergy Filter",
            "Auto Cleaning",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "รับประกันคอม 10 ปี",
        ],
        "badges": ["Inverter", "Dual"],
    },

    # ========== DAIKIN ==========
    "DAIKIN SMASH ธรรมดา 2018": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R410A",
        "desc": "แอร์ติดผนัง Daikin SMASH รุ่นธรรมดาปี 2018 {btu:,} BTU เทคโนโลยีญี่ปุ่น ทนทาน เหมาะกับห้อง {room}",
        "features": [
            "Daikin คุณภาพญี่ปุ่น",
            "Streamer Discharge ฟอกอากาศ",
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "รับประกันคอม 5 ปี",
        ],
        "badges": [],
    },
    "DAIKIN STAR KQ Inverter 2019": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Daikin Star KQ Inverter ปี 2019 {btu:,} BTU เทคโนโลยีญี่ปุ่น ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "Daikin คุณภาพญี่ปุ่น",
            "Streamer Discharge ฟอกอากาศ",
            "Coanda Airflow ลมเย็นกระจาย",
            "Eco Plus Mode",
            "Anti-Bacterial Filter",
            "Auto Restart + Self-Diagnosis",
            "Gold Fin คอยล์ทองคำ",
        ],
        "badges": ["Inverter"],
    },
    "DAIKIN SABAI FTKB Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Daikin SABAI FTKB Inverter {btu:,} BTU ประหยัดไฟ คุณภาพญี่ปุ่น เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 32%",
            "Daikin คุณภาพญี่ปุ่น",
            "Streamer Discharge",
            "Coanda Airflow",
            "Econo Mode",
            "Anti-Bacterial Filter",
            "Sleep Mode + Auto Restart",
            "Gold Fin คอยล์ทองคำ",
        ],
        "badges": ["Inverter"],
    },

    # ========== MITSUBISHI ELECTRIC (Mr.SLIM) ==========
    "MITSUBISHI Mr.SLIM EconoAir ธรรมดา R32": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Electric Mr.SLIM EconoAir รุ่นธรรมดา {btu:,} BTU คุณภาพญี่ปุ่นแท้ เหมาะกับห้อง {room}",
        "features": [
            "Mr.SLIM คุณภาพญี่ปุ่น",
            "Plasma Quad ฟอก PM2.5",
            "Anti-Bacterial Filter",
            "EconoCool Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Self-Diagnosis แจ้งสถานะ",
            "Gold Fin คอยล์ทองคำ",
            "รับประกันคอม 5 ปี",
        ],
        "badges": ["Mr.SLIM"],
    },
    "MITSUBISHI Mr.SLIM HAPPY Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Electric Mr.SLIM Happy Inverter {btu:,} BTU คุณภาพญี่ปุ่น ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "Mr.SLIM คุณภาพญี่ปุ่น",
            "Plasma Quad ฟอก PM2.5",
            "Econo Mode + Night Mode",
            "Anti-Allergy Enzyme Filter",
            "Auto Restart + Self-Diagnosis",
            "Gold Fin คอยล์ทองคำ",
            "รับประกันคอม 5 ปี",
        ],
        "badges": ["Inverter", "Mr.SLIM"],
    },
    "MITSUBISHI Mr.SLIM STANDARD Inverter 2025": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Electric Mr.SLIM Standard Inverter ปี 2025 {btu:,} BTU เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 35%",
            "Mr.SLIM คุณภาพญี่ปุ่น",
            "Plasma Quad ฟอก PM2.5",
            "Econo Mode",
            "Anti-Allergy Enzyme Filter",
            "Sleep Mode + Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "รับประกันคอม 5 ปี",
        ],
        "badges": ["Inverter", "Mr.SLIM"],
    },
    "MITSUBISHI Mr.SLIM SUPER Inverter 2025": {
        "type": "inverter",
        "premium": True,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Mitsubishi Electric Mr.SLIM Super Inverter ปี 2025 {btu:,} BTU รุ่นพรีเมียม เหมาะกับห้อง {room}",
        "features": [
            "Super Inverter ประหยัดไฟ 45%",
            "Mr.SLIM คุณภาพญี่ปุ่นแท้",
            "Plasma Quad Plus ฟอก PM0.3",
            "I See Sensor ตรวจจับคน",
            "Anti-Allergy Enzyme Filter",
            "WiFi MELCloud App",
            "Econo Mode + Night Mode",
            "รับประกันคอม 7 ปี",
        ],
        "badges": ["Inverter", "Super", "Mr.SLIM"],
    },

    # ========== AUFIT ==========
    "AUFIT QH-SERIES": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง AUFIT QH-Series {btu:,} BTU ราคาประหยัด คุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation",
            "Self-Diagnosis",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },

    # ========== TOSHIBA ==========
    "TOSHIBA FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Toshiba รุ่นธรรมดา {btu:,} BTU เทคโนโลยีญี่ปุ่น ทนทาน เหมาะกับห้อง {room}",
        "features": [
            "Toshiba คุณภาพญี่ปุ่น",
            "Eco Mode ประหยัดไฟ",
            "Anti-Bacterial Filter + Plasma",
            "Sleep Mode + Auto Restart",
            "Self-Diagnosis",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "รับประกันคอม 5 ปี",
        ],
        "badges": [],
    },

    # ========== CANDY ==========
    "CANDY FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Candy รุ่นธรรมดา {btu:,} BTU ราคาประหยัด คุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Quiet Operation",
            "Self-Diagnosis",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },
    "CANDY Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Candy Inverter {btu:,} BTU ประหยัดไฟ ราคาคุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "Quiet Operation",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },

    # ========== AIR COOL ==========
    "AIR COOL Inverter": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Air Cool Inverter {btu:,} BTU ประหยัดไฟ ราคาคุ้มค่า เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "Anti-Bacterial Filter",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "Quiet Operation",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter"],
    },

    # ========== MIDEA ==========
    "MIDEA FIX-SPEED": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Midea รุ่นธรรมดา {btu:,} BTU น้ำยา R32 ราคาประหยัด เหมาะกับห้อง {room}",
        "features": [
            "Eco Mode ประหยัดไฟ",
            "R32 เป็นมิตรต่อสิ่งแวดล้อม",
            "Sleep Mode + Auto Restart",
            "Anti-Bacterial Filter",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Self-Cleaning",
            "รีโมทไร้สาย",
        ],
        "badges": [],
    },
    "MIDEA Inverter WIFI": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Midea Inverter WiFi {btu:,} BTU ควบคุมผ่านมือถือ ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "WiFi MSmart App",
            "Breezeless Mode ลมเย็นไม่ปะทะ",
            "Self-Cleaning",
            "Anti-Bacterial Filter + PM2.5",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
        ],
        "badges": ["Inverter", "WiFi"],
    },

    # ========== SAIJO DENKI ==========
    "SAIJO DENKI SMART COOL": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Saijo Denki Smart Cool {btu:,} BTU แบรนด์ไทย ประหยัดไฟ เหมาะกับห้อง {room}",
        "features": [
            "Smart Cool Inverter ประหยัดไฟ",
            "PM2.5 Filter",
            "Anti-Bacterial Filter",
            "Auto Clean",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "รีโมทไร้สาย",
        ],
        "badges": ["Inverter", "แบรนด์ไทย"],
    },
    "SAIJO DENKI FIX-SPEED PM2.5": {
        "type": "fix",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Saijo Denki PM2.5 Killer รุ่นธรรมดา {btu:,} BTU ฟอกอากาศ PM2.5 เหมาะกับห้อง {room}",
        "features": [
            "PM2.5 Killer Filter",
            "Anti-Bacterial + Anti-Virus",
            "Eco Mode ประหยัดไฟ",
            "Sleep Mode + Auto Restart",
            "Gold Fin คอยล์ทองคำ",
            "Turbo Cool",
            "Self-Diagnosis",
            "แบรนด์ไทย",
        ],
        "badges": ["PM2.5"],
    },
    "SAIJO DENKI Inverter PM2.5": {
        "type": "inverter",
        "premium": False,
        "refrigerant": "R32",
        "desc": "แอร์ติดผนัง Saijo Denki PM2.5 Inverter {btu:,} BTU ฟอกอากาศ PM2.5 ประหยัดไฟ แบรนด์ไทย เหมาะกับห้อง {room}",
        "features": [
            "Inverter ประหยัดไฟ 30%",
            "PM2.5 Killer Filter",
            "Anti-Bacterial + Anti-Virus",
            "Auto Clean",
            "Sleep Mode + Eco Mode",
            "Turbo Cool",
            "Gold Fin คอยล์ทองคำ",
            "แบรนด์ไทย",
        ],
        "badges": ["Inverter", "PM2.5", "แบรนด์ไทย"],
    },
}


# ---------- Generator ----------
def generate_specs(entry):
    section = entry["section"]
    btu = entry.get("btu") or 0
    if btu == 0:
        btu = 9000  # default for placeholder/out-of-stock

    tpl = TEMPLATES.get(section)
    if not tpl:
        # Unknown section: skip (should not happen if templates cover all)
        return None

    if tpl["type"] == "inverter":
        physical = inverter_specs(btu, premium=tpl.get("premium", False))
    else:
        physical = fix_speed_specs(btu)

    spec = {
        "description": tpl["desc"].format(btu=btu, room=room_size(btu)),
        "features": list(tpl["features"]),
        "badge_tags": list(tpl["badges"]),
        "image_url": "",
        "refrigerant": tpl["refrigerant"],
        "voltage": "220V/1Ph/50Hz",
        "color": "ขาว",
        **physical,
    }
    return spec


def main():
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    n_already = 0
    n_seeded = 0
    n_skipped = 0
    missing_sections = set()

    for entry in catalog:
        # Has specs already
        if entry.get("features") or entry.get("seer") or entry.get("description"):
            n_already += 1
            continue

        spec = generate_specs(entry)
        if spec is None:
            n_skipped += 1
            missing_sections.add(entry["section"])
            continue

        # Merge — don't overwrite existing fields
        for k, v in spec.items():
            if k not in entry or entry[k] in (None, "", []):
                entry[k] = v

        n_seeded += 1

    # Pretty-write
    out = json.dumps(catalog, ensure_ascii=False, indent=2)
    CATALOG_PATH.write_text(out + "\n", encoding="utf-8")

    print(f"Already had specs: {n_already}")
    print(f"Seeded:             {n_seeded}")
    print(f"Skipped (no tpl):   {n_skipped}")
    if missing_sections:
        print("MISSING TEMPLATES for sections:")
        for s in sorted(missing_sections):
            print(f"  - {s}")
    print(f"Total catalog:      {len(catalog)}")


if __name__ == "__main__":
    main()
