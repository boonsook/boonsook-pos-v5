// ═══════════════════════════════════════════════════════════
//  AI SALES ASSISTANT — ผู้ช่วย AI เชียร์ขายแอร์
//  ระบบแนะนำแอร์อัจฉริยะ: ถาม-ตอบ → คำนวณ BTU → แนะนำรุ่น
// ═══════════════════════════════════════════════════════════

const ROOM_TYPES = [
  { key: "bedroom", label: "🛏️ ห้องนอน", factor: 700 },
  { key: "living", label: "🛋️ ห้องนั่งเล่น", factor: 800 },
  { key: "kitchen", label: "🍳 ห้องครัว / ร้านอาหาร", factor: 900 },
  { key: "office", label: "💼 สำนักงาน / ออฟฟิศ", factor: 750 },
  { key: "server", label: "🖥️ ห้อง Server / ห้องเครื่อง", factor: 1000 },
  { key: "shop", label: "🏪 หน้าร้าน / ร้านค้า", factor: 850 },
  { key: "glass", label: "🏢 ห้องกระจก / ผนังกระจก", factor: 1000 }
];

const BTU_SIZES = [9000, 12000, 13000, 18000, 24000, 25000, 30000, 36000, 40000, 48000, 60000];

// ═══ แคตตาล็อกแอร์พร้อมติดตั้ง (จากแอปเก่า) ═══
const AC_CATALOG = [
  {s:"TCL วอลไทป์ ธรรมดา",m:"MFS10",btu:9000,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ธรรมดา",m:"MFS13",btu:13000,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ธรรมดา",m:"MFS19",btu:18000,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ธรรมดา",m:"MFS25",btu:24000,p:23900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ Inverter WIFI",m:"T-PROWD10",btu:9000,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ Inverter WIFI",m:"T-PROWD13",btu:12000,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ Inverter WIFI",m:"T-PROWD19",btu:19050,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ Inverter WIFI",m:"T-PROWD25",btu:19050,p:23900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ Inverter WIFI",m:"T-PROWD25C",btu:19050,p:24900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL T-PROPREMIUM 2024 Inverter",m:"T-PROS10",btu:10350,p:15900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL T-PROPREMIUM 2024 Inverter",m:"T-PROS13",btu:12410,p:16900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL T-PROPREMIUM 2024 Inverter",m:"T-PROS19",btu:18500,p:21900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL T-PROPREMIUM 2024 Inverter",m:"T-PROS25",btu:24010,p:24900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ELITE Inverter",m:"T-WDX10C/H",btu:9500,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ELITE Inverter",m:"T-WDX13C/H",btu:12510,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ELITE Inverter",m:"T-WDX19C/H",btu:18940,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ELITE Inverter",m:"T-WDX25C/H",btu:24200,p:21900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"TCL วอลไทป์ ELITE Inverter",m:"รุ่น F1 WIFI 4WAY",btu:30926,p:36900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX Inverter คอล์ยทองแดง 2025",m:"ASW-09DIME",btu:9000,p:11900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX Inverter คอล์ยทองแดง 2025",m:"ASW-13DIME",btu:13000,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX Inverter คอล์ยทองแดง 2025",m:"ASW-18DIME",btu:18000,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX Inverter คอล์ยทองแดง 2025",m:"ASW-24DIME",btu:23900,p:21900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX MF-3ดาว Inverter 2025",m:"ASW-09DIMA-3S",btu:9000,p:11900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX MF-3ดาว Inverter 2025",m:"ASW-13DIMA-3S",btu:12000,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX MF-3ดาว Inverter 2025",m:"ASW-18DIMA-3S",btu:18000,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"AUX MF-3ดาว Inverter 2025",m:"ASW-24DIMA-3S",btu:23900,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER TECH-V Inverter 2026",m:"42NVAA010/38NVAA10",btu:8000,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER TECH-V Inverter 2026",m:"42NVAA013/37NVAA13",btu:12000,p:14900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER TECH-V Inverter 2026",m:"42NVAA018/38NVAA18",btu:18000,p:19900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER TECH-V Inverter 2026",m:"42NVAA024/38NVAA24",btu:24000,p:26900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER SEAL Inverter R32",m:"38TVDB010/42TVDB010",btu:9200,p:14900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER SEAL Inverter R32",m:"38TVDB013/42TVDB013",btu:12100,p:15900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER SEAL Inverter R32",m:"38TVDB016/42TVDB016",btu:15000,p:19900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER SEAL Inverter R32",m:"38TVDB018/42TVDB018",btu:18000,p:20900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER SEAL Inverter R32",m:"38TVDB026/42TVDB026",btu:25200,p:31900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER11 Inverter R32",m:"38TVEB010/42TVEB010",btu:9200,p:14900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER11 Inverter R32",m:"38TVEB013/42TVEB013",btu:12100,p:15900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER11 Inverter R32",m:"38TVEB016/42TVEB016",btu:15000,p:20900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER11 Inverter R32",m:"38TVEB018/42TVEB018",btu:18000,p:21900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER11 Inverter R32",m:"38TVEB024/42TVEB024",btu:20400,p:27900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CARRIER COPPER7 ธรรมดา R32",m:"38TSAA010/42TSAA010",btu:9200,p:14900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER COPPER7 ธรรมดา R32",m:"38TSAA013/42TSAA013",btu:12200,p:15900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER COPPER7 ธรรมดา R32",m:"38TSAA018/42TSAA018",btu:18000,p:22900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER COPPER7 ธรรมดา R32",m:"38TSAA025/42TSAA025",btu:25250,p:29900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER NSAA ธรรมดา 2026",m:"42NSAA010/38NSAA10",btu:9000,p:13500,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER NSAA ธรรมดา 2026",m:"42NSAA013/38NSAA13",btu:12000,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER NSAA ธรรมดา 2026",m:"42NSAA018/38NSAA18",btu:18000,p:19900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CARRIER NSAA ธรรมดา 2026",m:"42NSAA024/38NSAA24",btu:24000,p:26900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter R32",m:"CFW-JSFE09",btu:9200,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter R32",m:"CFW-JSFE13-1",btu:12500,p:14900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter R32",m:"CFW-JSFE18-1",btu:18080,p:18900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter R32",m:"CFW-JSFE25-1",btu:25100,p:23900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ FIX-SPEED",m:"CFW-MFE09",btu:9300,p:12900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ FIX-SPEED",m:"CFW-MFE13",btu:12300,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ FIX-SPEED",m:"CFW-MFE18",btu:18200,p:18900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ FIX-SPEED",m:"CFW-MFE25",btu:25000,p:23900,wi:"1 ปี",wp:"3 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter",m:"IVJS09-1",btu:9700,p:14900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter",m:"IVJS13-1",btu:12800,p:14900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter",m:"IVJS18-1",btu:18500,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter",m:"IVJS25-1",btu:25400,p:23900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์ Inverter",m:"IVGE30/220V",btu:30700,p:37900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์#5 Inverter",m:"CFW-IVM09",btu:9300,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์#5 Inverter",m:"CFW-IVM13",btu:12100,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์#5 Inverter",m:"CFW-IVM18",btu:18400,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"CENTRAL AIR วอลไทป์#5 Inverter",m:"CFW-IVM25",btu:25000,p:23900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"FRIO DEEDEE Inverter",m:"FMVC09G",btu:9466,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO DEEDEE Inverter",m:"FMVC12G",btu:12537,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO DEEDEE Inverter",m:"FMVC18G",btu:18198,p:20900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO DEEDEE Inverter",m:"FMVC24G",btu:24383,p:24900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO KHODI FIX-SPEED",m:"SMFC09V(I)",btu:9200,p:12900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO KHODI FIX-SPEED",m:"SMFC12V(I)",btu:12200,p:13500,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO KHODI FIX-SPEED",m:"SMFC18V(II)",btu:18800,p:19900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"FRIO KHODI FIX-SPEED",m:"SMF24V(I)",btu:24800,p:23900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HISENSE Inverter",m:"AS10TRKE2",btu:9000,p:11900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HISENSE Inverter",m:"AS13TRKC2",btu:12000,p:12900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HISENSE Inverter",m:"AS18TRKE2",btu:18000,p:16900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HISENSE Inverter",m:"AS24TRKC2",btu:23500,p:22500,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"SAMSUNG Inverter",m:"AR10CYHC",btu:9000,p:12900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"SAMSUNG Inverter",m:"AR13CYHC",btu:12000,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"SAMSUNG Inverter",m:"AR18CYHC",btu:18000,p:19900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER FIX-SPEED R32 ปี67",m:"HSU-10CQRC",btu:10042,p:13500,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER FIX-SPEED R32 ปี67",m:"HSU-13CQRC",btu:12597,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER FIX-SPEED R32 ปี67",m:"HSU-18CQRC",btu:18500,p:19500,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER FIX-SPEED R32 ปี67",m:"HSU-24CQRC",btu:24400,p:23900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-09VQAC",btu:9374,p:13900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-12VQAAC",btu:11568,p:14900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-15VQAC",btu:14976,p:17900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-18VQAC",btu:17837,p:23900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-24VQAC",btu:23854,p:19900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-30VQAC",btu:30700,p:38900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"HAIER Inverter SELF CLEANING R32 ปี68",m:"HSU-36VQAC",btu:36000,p:45900,wi:"1 ปี",wp:"3 ปี",wc:"7 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FIX-SPEED",m:"SRKC 10CXV",btu:9444,p:16900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FIX-SPEED",m:"SRKC13CYC",btu:12039,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FIX-SPEED",m:"SRKC15CXV",btu:15000,p:21900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FIX-SPEED",m:"SRKC18CYV",btu:18000,p:26900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FIX-SPEED",m:"SRKC24CYV",btu:24000,p:35900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FLIGHTING Inverter",m:"SRKC10YYP",btu:9239,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FLIGHTING Inverter",m:"SRKC13YYP",btu:11634,p:19900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FLIGHTING Inverter",m:"SRKC15YYP",btu:14457,p:23900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY FLIGHTING Inverter",m:"SRKC18YYP",btu:17305,p:27900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY STANDARD Inverter",m:"SRK10YYM",btu:8683,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY STANDARD Inverter",m:"SRK13YYM",btu:11098,p:21900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY STANDARD Inverter",m:"SRK15YYM",btu:14457,p:25900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY STANDARD Inverter",m:"SRK18YYM",btu:17276,p:29900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY STANDARD Inverter",m:"SRK24YYM",btu:23021,p:38900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY DELUXE Inverter",m:"SRK10YYS",btu:9444,p:19900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY DELUXE Inverter",m:"SRK13YYS",btu:12039,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY DELUXE Inverter",m:"SRK15YYS",btu:15000,p:27900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY DELUXE Inverter",m:"SRK18YYS",btu:18000,p:32900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI HEAVY DUTY DELUXE Inverter",m:"SRK24YYS",btu:24000,p:42900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"GREE NI SERIES Inverter",m:"GWC12ATCXB",btu:12000,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE SAVI Inverter R32",m:"GWC09 AGB2",btu:9000,p:14500,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE SAVI Inverter R32",m:"GWC12 AGB2",btu:12000,p:15500,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE SAVI Inverter R32",m:"GWC15 AGD2",btu:15000,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE SAVI Inverter R32",m:"GWC18AGD2",btu:18000,p:20900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE SAVI Inverter R32",m:"GWC24AGE2",btu:24000,p:24900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE LUXURY Inverter",m:"GWC12 AGC",btu:12057,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE LUXURY Inverter",m:"GWC18 AGD",btu:18723,p:25900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"GREE LUXURY Inverter",m:"GWC24 AGE",btu:24242,p:29900,wi:"1 ปี",wp:"5 ปี",wc:"10 ปี",qty:3},
  {s:"MAVELL FIX-SPEED",m:"MVF-09FS24",btu:9700,p:12500,wi:"1 ปี",wp:"5 ปี",wc:"12 ปี",qty:3},
  {s:"MAVELL FIX-SPEED",m:"MVF-12FS24",btu:13500,p:13500,wi:"1 ปี",wp:"5 ปี",wc:"12 ปี",qty:3},
  {s:"MAVELL NEO Inverter",m:"MTF-09IN24",btu:9700,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"12 ปี",qty:3},
  {s:"MAVELL NEO Inverter",m:"MTF-12 IN24",btu:13500,p:14900,wi:"1 ปี",wp:"5 ปี",wc:"12 ปี",qty:3},
  {s:"STAR AIR FIX-SPEED",m:"DM09",btu:9000,p:12500,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR FIX-SPEED",m:"DM12",btu:12000,p:13500,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR FIX-SPEED",m:"DM18",btu:18000,p:18500,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR FIX-SPEED",m:"DM24",btu:24000,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR Inverter",m:"DM09IFV",btu:9000,p:13500,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR Inverter",m:"DM12IFV",btu:12000,p:14500,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR Inverter",m:"DM18IFV",btu:18000,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"STAR AIR Inverter",m:"DM24IV",btu:24000,p:26900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter ปี2026",m:"IBY11M KU1",btu:9000,p:13900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter ปี2026",m:"IBY13M KU1",btu:12000,p:14900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter ปี2026",m:"IBY18M KU1",btu:18000,p:18900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter ปี2026",m:"IBY24M KU1",btu:24000,p:22900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"ISC10E",btu:9000,p:12500,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"ISC13E",btu:12000,p:13500,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"ISC18E",btu:18000,p:17900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"ISC24E",btu:21500,p:22900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"ICE11MN",btu:9000,p:13900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"ICE13MN",btu:12000,p:14900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"IKR18MN",btu:18000,p:19900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"LG Inverter",m:"IKR24MN",btu:21500,p:24900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN SMASH ธรรมดา 2018",m:"FTM 13 PV2S",btu:13000,p:17900,wi:"1 ปี",wp:"1 ปี",wc:"3 ปี",qty:3},
  {s:"DAIKIN STAR KQ Inverter 2019",m:"FTKQ 09 TV2S",btu:9200,p:16900,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN STAR KQ Inverter 2019",m:"FTKQ 13 TV2S",btu:12300,p:18500,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN STAR KQ Inverter 2019",m:"FTKQ 18 TV2S",btu:18100,p:27500,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN STAR KQ Inverter 2019",m:"FTKQ 24 TV2S",btu:20500,p:37500,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN SABAI FTKB Inverter",m:"FTKB 09ZY",btu:9200,p:15900,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN SABAI FTKB Inverter",m:"FTKB 13ZY",btu:12300,p:16900,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN SABAI FTKB Inverter",m:"FTKB 15ZV",btu:15000,p:19900,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN SABAI FTKB Inverter",m:"FTKB 18YV",btu:18100,p:21900,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"DAIKIN SABAI FTKB Inverter",m:"FTKB 24ZV",btu:24000,p:27900,wi:"1 ปี",wp:"3 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM EconoAir ธรรมดา R32",m:"MS-GY 09 VF",btu:9212,p:17900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM EconoAir ธรรมดา R32",m:"MS-GY 13 VF",btu:12966,p:18900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM EconoAir ธรรมดา R32",m:"MS-GY 18 VF",btu:18084,p:27900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM HAPPY Inverter",m:"MSY-KY 09 VF",btu:9212,p:16900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM HAPPY Inverter",m:"MSY-KA 13 VF",btu:12283,p:18900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM HAPPY Inverter",m:"MSY-KA 15 VF",btu:15013,p:23900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM HAPPY Inverter",m:"MSY-KA 18 VF",btu:17742,p:28900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM HAPPY Inverter",m:"MSY-KA 24VF",btu:22519,p:35900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM STANDARD Inverter 2025",m:"MSY-JZ 09 VF",btu:9554,p:19900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM STANDARD Inverter 2025",m:"MSY-JZ 13 VF",btu:12624,p:22900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM STANDARD Inverter 2025",m:"MSY-JZ 15 VF",btu:14330,p:27900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM STANDARD Inverter 2025",m:"MSY-JZ 18 VF",btu:17742,p:32900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM STANDARD Inverter 2025",m:"MSY-JZ 24 VF",btu:22519,p:47900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM STANDARD Inverter 2025",m:"MSY-JZ36VF",btu:36167,p:62900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM SUPER Inverter 2025",m:"MSY-GZ 09 VF",btu:9554,p:21900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM SUPER Inverter 2025",m:"MSY-GZ 13 VF",btu:12624,p:25900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM SUPER Inverter 2025",m:"MSY-GZ 15 VF",btu:14330,p:29900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM SUPER Inverter 2025",m:"MSY-GZ 18 VF",btu:17742,p:33900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM SUPER Inverter 2025",m:"MSY-GZ 24 VF",btu:22519,p:49900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"MITSUBISHI Mr.SLIM SUPER Inverter 2025",m:"MSY-GZ30VF",btu:27978,p:63900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"AUFIT QH-SERIES",m:"AUF-09",btu:9500,p:10900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"AUFIT QH-SERIES",m:"AUF-12",btu:12100,p:11900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"AUFIT QH-SERIES",m:"AUF-18",btu:18300,p:16900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"AUFIT QH-SERIES",m:"AUF-24",btu:25200,p:19900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"TOSHIBA FIX-SPEED",m:"RAS-10S4KG",btu:9000,p:12900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"TOSHIBA FIX-SPEED",m:"RAS-13S4KG",btu:12000,p:13900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"TOSHIBA FIX-SPEED",m:"RAS-18S4KG",btu:18000,p:17900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"TOSHIBA FIX-SPEED",m:"RAS-24S4KG",btu:24000,p:23900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"CANDY FIX-SPEED",m:"CE-09PCT",btu:9000,p:10900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"CANDY FIX-SPEED",m:"CE-12PCT",btu:12000,p:11900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"CANDY FIX-SPEED",m:"CE-18PCT",btu:17000,p:15900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"CANDY Inverter",m:"CE18 VPC",btu:18000,p:17900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"CANDY Inverter",m:"CE24 VPC",btu:23200,p:18900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"AIR COOL Inverter",m:"FV1W 012 DLAS",btu:12000,p:11900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA FIX-SPEED",m:"MSAG 09CRN8",btu:9500,p:11900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA FIX-SPEED",m:"MSAG 12CRN8",btu:12600,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA FIX-SPEED",m:"MSAG 18CRN8",btu:18300,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA FIX-SPEED",m:"MSAG 24CRN8",btu:24000,p:23900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA Inverter WIFI",m:"MSNE10CRFN8",btu:9000,p:11900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA Inverter WIFI",m:"MSNE13CRFN8",btu:12000,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA Inverter WIFI",m:"MSNE18CRFN8",btu:18000,p:18900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"MIDEA Inverter WIFI",m:"MSCE25",btu:24000,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI SMART COOL",m:"SMART COOL 09",btu:9000,p:12900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI SMART COOL",m:"SMART COOL 12",btu:12000,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI SMART COOL",m:"SMART COOL 18",btu:18000,p:17900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI SMART COOL",m:"SMART COOL 25",btu:25000,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI SMART COOL",m:"A P S 30 ฟอกอากาศ",btu:30000,p:34900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI FIX-SPEED PM2.5",m:"PM25 KILLER 12 4***",btu:12000,p:13900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI FIX-SPEED PM2.5",m:"PM25 KILLER 18 4***",btu:18000,p:19900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI FIX-SPEED PM2.5",m:"PM25 KILLER 25 4***",btu:25000,p:22900,wi:"1 ปี",wp:"5 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI Inverter PM2.5",m:"PM 25 INVERTER 12",btu:12000,p:14900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI Inverter PM2.5",m:"PM 25 INVERTER 18",btu:18000,p:19900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
  {s:"SAIJO DENKI Inverter PM2.5",m:"PM 25 INVERTER 25",btu:25000,p:23900,wi:"1 ปี",wp:"1 ปี",wc:"5 ปี",qty:3},
];

function matchCatalog(rawBTU, budget, priority) {
  const recBTU = recommendBTU(rawBTU);
  const range = [recBTU - 4000, recBTU + 4000];
  let items = AC_CATALOG.filter(a => a.btu >= range[0] && a.btu <= range[1] && a.p <= budget);

  // Sort by priority
  if (priority === "cheap") items.sort((a,b) => a.p - b.p);
  else if (priority === "inverter" || priority === "quiet") {
    items.sort((a,b) => {
      const aInv = /inverter|inv/i.test(a.s) ? 0 : 1;
      const bInv = /inverter|inv/i.test(b.s) ? 0 : 1;
      return aInv - bInv || a.p - b.p;
    });
  } else if (priority === "brand") {
    const topBrands = ["DAIKIN","MITSUBISHI","Carrier"];
    items.sort((a,b) => {
      const aTop = topBrands.some(tb => a.s.toUpperCase().includes(tb)) ? 0 : 1;
      const bTop = topBrands.some(tb => b.s.toUpperCase().includes(tb)) ? 0 : 1;
      return aTop - bTop || a.p - b.p;
    });
  } else {
    items.sort((a,b) => a.p - b.p);
  }
  return items.slice(0, 10);
}

const SELLING_POINTS = {
  inverter: [
    "ประหยัดไฟสูงสุด 60% เมื่อเทียบกับแอร์รุ่นธรรมดา",
    "ทำความเย็นเร็ว เงียบกว่า เพราะคอมเพรสเซอร์ปรับรอบได้",
    "อุณหภูมิคงที่สม่ำเสมอ ไม่หนาวสลับร้อน",
    "คืนทุนค่าไฟภายใน 1-2 ปี"
  ],
  health: [
    "ระบบฟอกอากาศในตัว กรองฝุ่น PM2.5 ได้",
    "มีระบบ Plasma / Ionizer ฆ่าเชื้อโรค ลดกลิ่น",
    "เหมาะสำหรับคนเป็นภูมิแพ้และห้องที่มีเด็กเล็ก"
  ],
  warranty: [
    "รับประกันคอมเพรสเซอร์ 5-10 ปี ขึ้นอยู่กับยี่ห้อ",
    "ร้านบุญสุขดูแลหลังการขาย ซ่อมเร็ว มีอะไหล่พร้อม",
    "ล้างแอร์ฟรี 1 ปีแรก (เงื่อนไขตามรายการส่งเสริมการขาย)"
  ],
  saving: [
    "ค่าไฟต่อเดือนประมาณ {cost} บาท (ใช้ 8 ชม./วัน)",
    "เลือกขนาด BTU ที่เหมาะสมช่วยประหยัดไฟจริง",
    "แอร์เบอร์ 5 ประหยัดไฟมากกว่าเบอร์ 3 ถึง 25%"
  ]
};

function calcBTU(area, roomType, floor, people) {
  const roomFactor = ROOM_TYPES.find(r => r.key === roomType)?.factor || 750;
  let btu = area * roomFactor;
  if (floor === "upper") btu *= 1.15;
  if (roomType === "glass") btu *= 1.25;
  const extraPeople = Math.max(0, (people || 1) - 2);
  btu += extraPeople * 600;
  return btu;
}

function recommendBTU(rawBTU) {
  for (const size of BTU_SIZES) {
    if (size >= rawBTU) return size;
  }
  return BTU_SIZES[BTU_SIZES.length - 1];
}

function estimateMonthlyCost(btu) {
  const watts = btu * 0.29;
  const kw = watts / 1000;
  const hoursPerDay = 8;
  const daysPerMonth = 30;
  const ratePerUnit = 4.2;
  return Math.round(kw * hoursPerDay * daysPerMonth * ratePerUnit);
}

function matchProducts(products, btu) {
  const target = recommendBTU(btu);
  const range = [target - 3000, target + 3000];
  return products.filter(p => {
    const pBtu = Number(p.btu || 0);
    const nameMatch = (p.name || "").match(/(\d{4,5})\s*BTU/i);
    const parsedBtu = nameMatch ? Number(nameMatch[1]) : pBtu;
    return parsedBtu >= range[0] && parsedBtu <= range[1] && Number(p.stock || 0) > 0;
  });
}

export function renderAiSalesPage(ctx) {
  const container = document.getElementById("page-ai_sales");
  if (!container) return;

  const { state, money, showToast, showRoute } = ctx;

  let chatHistory = [];
  let step = 0;
  let answers = {};

  container.innerHTML = `
    <div style="max-width:700px;margin:0 auto;padding:8px">
      <div style="text-align:center;padding:20px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#e0e7ff);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">🤖</div>
        <h2 style="margin:0 0 4px;color:#1e40af">AI ผู้ช่วยขายแอร์</h2>
        <p style="margin:0;color:#3730a3;font-size:14px">ตอบคำถามไม่กี่ข้อ — ระบบจะแนะนำแอร์ที่เหมาะที่สุดให้</p>
      </div>

      <div id="aiChatBox" style="min-height:300px;max-height:60vh;overflow-y:auto;padding:8px;border:1px solid #e5e7eb;border-radius:14px;background:#fafafa;margin-bottom:12px">
      </div>

      <div id="aiInputArea" style="display:flex;gap:8px;align-items:center">
        <div id="aiChoices" style="display:flex;flex-wrap:wrap;gap:6px;flex:1"></div>
      </div>

      <div id="aiRestart" class="hidden" style="text-align:center;margin-top:12px">
        <button id="aiRestartBtn" class="btn light" style="font-size:14px">🔄 เริ่มใหม่</button>
      </div>
    </div>
  `;

  const chatBox = container.querySelector("#aiChatBox");
  const choicesDiv = container.querySelector("#aiChoices");
  const restartDiv = container.querySelector("#aiRestart");
  const restartBtn = container.querySelector("#aiRestartBtn");

  function addBubble(text, sender = "bot", isHtml = false) {
    const bubble = document.createElement("div");
    const isBot = sender === "bot";
    bubble.style.cssText = `
      max-width:85%;padding:10px 14px;border-radius:${isBot ? "4px 14px 14px 14px" : "14px 4px 14px 14px"};
      margin-bottom:8px;font-size:14px;line-height:1.6;
      background:${isBot ? "#fff" : "#3b82f6"};color:${isBot ? "#1f2937" : "#fff"};
      border:${isBot ? "1px solid #e5e7eb" : "none"};
      ${isBot ? "" : "margin-left:auto;"};width:fit-content;
      animation:fadeIn .3s ease;
    `;
    if (isHtml) bubble.innerHTML = text; else bubble.textContent = text;
    chatBox.appendChild(bubble);
    chatBox.scrollTop = chatBox.scrollHeight;
    chatHistory.push({ text, sender });
  }

  function showChoices(options) {
    choicesDiv.innerHTML = "";
    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.textContent = opt.label;
      btn.style.cssText = `padding:8px 16px;border:2px solid #3b82f6;border-radius:20px;background:#fff;color:#3b82f6;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s`;
      btn.addEventListener("mouseenter", () => { btn.style.background = "#3b82f6"; btn.style.color = "#fff"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "#fff"; btn.style.color = "#3b82f6"; });
      btn.addEventListener("click", () => {
        addBubble(opt.label, "user");
        choicesDiv.innerHTML = "";
        opt.action();
      });
      choicesDiv.appendChild(btn);
    });
  }

  function showNumberInput(placeholder, onSubmit) {
    choicesDiv.innerHTML = "";
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = placeholder;
    input.style.cssText = "flex:1;min-width:100px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px";
    const btn = document.createElement("button");
    btn.textContent = "ตกลง";
    btn.className = "btn primary";
    btn.style.cssText = "padding:10px 20px;font-size:14px";
    btn.addEventListener("click", () => {
      const val = parseFloat(input.value);
      if (!val || val <= 0) { showToast("กรุณากรอกตัวเลข"); return; }
      addBubble(input.value, "user");
      choicesDiv.innerHTML = "";
      onSubmit(val);
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter") btn.click(); });
    choicesDiv.appendChild(input);
    choicesDiv.appendChild(btn);
    input.focus();
  }

  function showDualInput(ph1, ph2, onSubmit) {
    choicesDiv.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1";
    const i1 = document.createElement("input"); i1.type = "number"; i1.placeholder = ph1;
    i1.style.cssText = "width:80px;padding:10px;border:1px solid #d1d5db;border-radius:10px;font-size:15px";
    const x = document.createElement("span"); x.textContent = "×"; x.style.cssText = "font-size:18px;font-weight:700;color:#6b7280";
    const i2 = document.createElement("input"); i2.type = "number"; i2.placeholder = ph2;
    i2.style.cssText = "width:80px;padding:10px;border:1px solid #d1d5db;border-radius:10px;font-size:15px";
    const btn = document.createElement("button"); btn.textContent = "ตกลง"; btn.className = "btn primary";
    btn.style.cssText = "padding:10px 20px;font-size:14px";
    btn.addEventListener("click", () => {
      const v1 = parseFloat(i1.value), v2 = parseFloat(i2.value);
      if (!v1 || !v2 || v1 <= 0 || v2 <= 0) { showToast("กรุณากรอกทั้งกว้างและยาว"); return; }
      addBubble(`${v1} × ${v2} เมตร (${(v1 * v2).toFixed(1)} ตร.ม.)`, "user");
      choicesDiv.innerHTML = "";
      onSubmit(v1, v2);
    });
    wrap.appendChild(i1); wrap.appendChild(x); wrap.appendChild(i2); wrap.appendChild(btn);
    choicesDiv.appendChild(wrap);
    i1.focus();
  }

  // ═══ CONVERSATION STEPS ═══

  function startConversation() {
    step = 0; answers = {}; chatHistory = []; chatBox.innerHTML = "";
    restartDiv.classList.add("hidden");

    addBubble("สวัสดีครับ! 👋 ผม AI ผู้ช่วยขายแอร์ของร้านบุญสุข");
    setTimeout(() => {
      addBubble("ผมจะช่วยแนะนำแอร์ที่เหมาะกับห้องของคุณ ตอบคำถามไม่กี่ข้อเลยครับ");
      setTimeout(() => askRoomType(), 400);
    }, 500);
  }

  function askRoomType() {
    addBubble("ห้องที่จะติดแอร์เป็นห้องประเภทไหนครับ?");
    showChoices(ROOM_TYPES.map(r => ({
      label: r.label,
      action: () => { answers.roomType = r.key; askRoomSize(); }
    })));
  }

  function askRoomSize() {
    addBubble("ห้องกว้าง × ยาว เท่าไหร่ครับ? (เมตร)");
    showDualInput("กว้าง (ม.)", "ยาว (ม.)", (w, l) => {
      answers.width = w; answers.length = l; answers.area = w * l;
      askFloor();
    });
  }

  function askFloor() {
    addBubble(`ห้อง ${answers.area.toFixed(1)} ตร.ม. ครับ 👍 ห้องอยู่ชั้นไหนครับ?`);
    showChoices([
      { label: "🏠 ชั้นล่าง / ชั้น 1", action: () => { answers.floor = "lower"; askPeople(); }},
      { label: "⬆️ ชั้นบน / ชั้น 2+", action: () => { answers.floor = "upper"; askPeople(); }},
      { label: "🏢 ชั้นสูง (คอนโด/อาคาร)", action: () => { answers.floor = "upper"; askPeople(); }}
    ]);
  }

  function askPeople() {
    addBubble("ปกติมีคนอยู่ในห้องกี่คนครับ?");
    showChoices([
      { label: "1-2 คน", action: () => { answers.people = 2; askBudget(); }},
      { label: "3-4 คน", action: () => { answers.people = 4; askBudget(); }},
      { label: "5-6 คน", action: () => { answers.people = 6; askBudget(); }},
      { label: "7+ คน", action: () => { answers.people = 8; askBudget(); }}
    ]);
  }

  function askBudget() {
    addBubble("งบประมาณของคุณประมาณเท่าไหร่ครับ?");
    showChoices([
      { label: "💰 ไม่เกิน 10,000", action: () => { answers.budget = 10000; askPriority(); }},
      { label: "💰 10,000-20,000", action: () => { answers.budget = 20000; askPriority(); }},
      { label: "💰 20,000-35,000", action: () => { answers.budget = 35000; askPriority(); }},
      { label: "💰 35,000+", action: () => { answers.budget = 99999; askPriority(); }},
      { label: "ไม่จำกัดงบ", action: () => { answers.budget = 999999; askPriority(); }}
    ]);
  }

  function askPriority() {
    addBubble("สิ่งที่คุณให้ความสำคัญมากที่สุดคือ?");
    showChoices([
      { label: "⚡ ประหยัดไฟ (Inverter)", action: () => { answers.priority = "inverter"; showResult(); }},
      { label: "🌿 สุขภาพ / กรองอากาศ", action: () => { answers.priority = "health"; showResult(); }},
      { label: "💸 ราคาถูกสุด", action: () => { answers.priority = "cheap"; showResult(); }},
      { label: "🔇 เงียบสุด", action: () => { answers.priority = "quiet"; showResult(); }},
      { label: "🏆 แบรนด์ดัง / รับประกันยาว", action: () => { answers.priority = "brand"; showResult(); }}
    ]);
  }

  // ═══ ORDER SYSTEM: แสดงฟอร์มกรอกข้อมูล → สร้างออเดอร์ ═══
  let _formSeq = 0;
  function showOrderForm(product, source) {
    const fid = ++_formSeq; // unique ID per form
    const prodName = product.name || product.s + " " + product.m;
    const prodPrice = product.price || product.p || 0;

    // Pre-fill from logged-in user if available
    const user = state.currentUser || {};
    const prefillName = user.full_name || user.user_metadata?.full_name || "";
    const prefillPhone = user.phone || user.user_metadata?.phone || "";

    let formHtml = `
      <div id="orderForm${fid}" style="background:#fefce8;border:1px solid #fde68a;border-radius:12px;padding:14px;margin-bottom:4px">
        <div style="font-weight:700;color:#92400e;font-size:14px;margin-bottom:8px">📋 กรอกข้อมูลเพื่อสั่งซื้อ</div>
        <div style="font-size:13px;color:#78350f;margin-bottom:10px;padding:8px;background:#fff;border-radius:8px;border:1px solid #fde68a">
          🛒 <b>${prodName}</b><br>
          ❄️ ${(product.btu || 0).toLocaleString()} BTU — 💰 <b>${prodPrice.toLocaleString()} บาท</b>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <input data-f="${fid}" data-role="name" type="text" placeholder="ชื่อ-นามสกุล *" value="${prefillName}" style="padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px">
          <input data-f="${fid}" data-role="phone" type="tel" placeholder="เบอร์โทรศัพท์ *" value="${prefillPhone}" style="padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px">
          <textarea data-f="${fid}" data-role="addr" rows="2" placeholder="ที่อยู่สำหรับติดตั้ง *" style="padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;resize:vertical"></textarea>
          <textarea data-f="${fid}" data-role="note" rows="1" placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" style="padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button data-f="${fid}" data-role="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(22,163,74,.3)">✅ ยืนยันสั่งซื้อ</button>
            <button data-f="${fid}" data-role="cancel" style="padding:12px 16px;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;border-radius:12px;font-size:14px;cursor:pointer">ยกเลิก</button>
          </div>
        </div>
      </div>
    `;
    addBubble(formHtml, "bot", true);

    // Attach event handlers using unique data-f selectors
    setTimeout(() => {
      const formEl = chatBox.querySelector(`#orderForm${fid}`);
      if (!formEl) return;
      const submitBtn = formEl.querySelector(`[data-role="submit"]`);
      const cancelBtn = formEl.querySelector(`[data-role="cancel"]`);
      const nameInput = formEl.querySelector(`[data-role="name"]`);
      const phoneInput = formEl.querySelector(`[data-role="phone"]`);
      const addrInput = formEl.querySelector(`[data-role="addr"]`);
      const noteInput = formEl.querySelector(`[data-role="note"]`);

      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          // Disable the whole form
          formEl.style.opacity = "0.5";
          formEl.style.pointerEvents = "none";
          addBubble("ยกเลิกคำสั่งซื้อ", "user");
          addBubble("ยกเลิกเรียบร้อยครับ ถ้าสนใจสินค้าตัวอื่นกดเลือกได้เลยนะครับ 😊");
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener("click", async () => {
          const cName = nameInput?.value?.trim();
          const cPhone = phoneInput?.value?.trim();
          const cAddr = addrInput?.value?.trim();
          const cNote = noteInput?.value?.trim();

          if (!cName) { showToast("กรุณากรอกชื่อ"); nameInput?.focus(); return; }
          if (!cPhone) { showToast("กรุณากรอกเบอร์โทร"); phoneInput?.focus(); return; }
          if (!cAddr) { showToast("กรุณากรอกที่อยู่"); addrInput?.focus(); return; }

          submitBtn.disabled = true;
          submitBtn.textContent = "⏳ กำลังส่งคำสั่งซื้อ...";
          submitBtn.style.background = "#9ca3af";

          addBubble(`${cName} / ${cPhone}`, "user");

          const jobNo = "AI-" + Date.now().toString(36).toUpperCase();
          const orderData = {
            job_no: jobNo,
            customer_name: cName,
            customer_phone: cPhone,
            customer_address: cAddr,
            job_type: "ac",
            status: "pending",
            total_cost: prodPrice,
            description: `สั่งซื้อแอร์: ${prodName}\nBTU: ${(product.btu || 0).toLocaleString()}\nราคา: ${prodPrice.toLocaleString()} บาท\nแหล่ง: ${source}\nห้อง: ${answers.area?.toFixed(1) || "-"} ตร.ม. / BTU แนะนำ: ${answers.recBTU?.toLocaleString() || "-"}\n📞 เบอร์: ${cPhone}\n📍 ที่อยู่: ${cAddr}${cNote ? "\n📝 หมายเหตุ: " + cNote : ""}`,
            note: `AI Sales: ${prodName} | ราคา ${prodPrice.toLocaleString()} บาท | โทร: ${cPhone}`
          };

          try {
            const res = await window._appXhrPost("service_jobs", orderData, { returnData: true });
            if (res?.ok) {
              // Get the created order ID for cancel functionality
              const orderId = res.data?.id || null;

              showToast("สั่งซื้อสำเร็จ!");
              // Disable the form after success
              formEl.style.opacity = "0.5";
              formEl.style.pointerEvents = "none";
              let successHtml = `
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px">
                  <div style="font-weight:700;color:#166534;font-size:15px;margin-bottom:8px">✅ สั่งซื้อเรียบร้อยแล้วครับ!</div>
                  <div style="font-size:13px;color:#15803d;line-height:1.8">
                    🛒 <b>${prodName}</b><br>
                    💰 ${prodPrice.toLocaleString()} บาท<br>
                    👤 ${cName} / ${cPhone}<br>
                    📍 ${cAddr}<br>
                    📄 เลขที่: <b>${jobNo}</b>
                  </div>
                  <div style="margin-top:10px;font-size:13px;color:#166534">ทีมงานบุญสุขจะติดต่อกลับเพื่อนัดวันติดตั้งครับ 🙏</div>
                  ${orderId ? `<button data-cancel-order="${orderId}" data-job-no="${jobNo}" style="margin-top:10px;padding:8px 16px;background:#fff;color:#dc2626;border:1px solid #fca5a5;border-radius:10px;font-size:13px;cursor:pointer;transition:all .2s">❌ ยกเลิกคำสั่งซื้อ</button>` : ""}
                </div>
              `;
              addBubble(successHtml, "bot", true);

              // Attach cancel handler
              if (orderId) {
                setTimeout(() => {
                  const cancelBtn = chatBox.querySelector(`[data-cancel-order="${orderId}"]`);
                  if (cancelBtn) {
                    cancelBtn.addEventListener("mouseenter", () => { cancelBtn.style.background = "#fef2f2"; });
                    cancelBtn.addEventListener("mouseleave", () => { cancelBtn.style.background = "#fff"; });
                    cancelBtn.addEventListener("click", async () => {
                      if (!confirm("ต้องการยกเลิกคำสั่งซื้อนี้ใช่ไหมครับ?")) return;
                      cancelBtn.disabled = true;
                      cancelBtn.textContent = "⏳ กำลังยกเลิก...";
                      try {
                        const cancelRes = await window._appXhrPatch("service_jobs", { status: "cancelled", note: orderData.note + " | ❌ ลูกค้ายกเลิก" }, "id", orderId);
                        if (cancelRes?.ok) {
                          cancelBtn.textContent = "✅ ยกเลิกแล้ว";
                          cancelBtn.style.background = "#f3f4f6";
                          cancelBtn.style.color = "#9ca3af";
                          cancelBtn.style.border = "1px solid #e5e7eb";
                          showToast("ยกเลิกคำสั่งซื้อเรียบร้อย");
                          addBubble(`❌ ยกเลิกคำสั่งซื้อ <b>${prodName}</b> (${jobNo}) เรียบร้อยแล้วครับ`, "bot", true);
                          try {
                            if (typeof ctx?.sendLineNotify === "function") Promise.resolve(ctx.sendLineNotify(`❌ ยกเลิกออเดอร์ ${jobNo}\nลูกค้า: ${cName}\nสินค้า: ${prodName}`)).catch(() => {});
                          } catch(le) {}
                        } else {
                          throw new Error("cancel failed");
                        }
                      } catch (ce) {
                        console.error("Cancel error:", ce);
                        cancelBtn.disabled = false;
                        cancelBtn.textContent = "❌ ยกเลิกคำสั่งซื้อ";
                        showToast("เกิดข้อผิดพลาด กรุณาลองใหม่");
                      }
                    });
                  }
                }, 100);
              }

              // LINE notify (safe — fire & forget with .catch)
              try {
                if (typeof ctx?.sendLineNotify === "function") {
                  Promise.resolve(ctx.sendLineNotify(`🛒 ออเดอร์ใหม่จาก AI Sales!\nเลขที่: ${jobNo}\nลูกค้า: ${cName}\nโทร: ${cPhone}\nที่อยู่: ${cAddr}\nสินค้า: ${prodName}\nราคา: ${prodPrice.toLocaleString()} บาท`, { state, showToast }, "queue")).catch(() => {});
                }
              } catch(lineErr) { /* skip */ }
            } else {
              throw new Error(res?.error?.message || "insert failed");
            }
          } catch (e) {
            console.error("Order error:", e);
            submitBtn.disabled = false;
            submitBtn.textContent = "✅ ยืนยันสั่งซื้อ";
            submitBtn.style.background = "linear-gradient(135deg,#16a34a,#15803d)";
            showToast("เกิดข้อผิดพลาด กรุณาลองใหม่");
            addBubble("ขออภัยครับ เกิดข้อผิดพลาดในการสั่งซื้อ กรุณาลองใหม่หรือติดต่อร้านโดยตรง 📞", "bot");
          }
        });
      }
    }, 100);
  }

  function showResult() {
    const rawBTU = calcBTU(answers.area, answers.roomType, answers.floor, answers.people);
    const recBTU = recommendBTU(rawBTU);
    const monthlyCost = estimateMonthlyCost(recBTU);

    answers.rawBTU = rawBTU;
    answers.recBTU = recBTU;

    addBubble("กำลังวิเคราะห์ข้อมูล... 🔄");

    setTimeout(() => {
      // Result bubble
      const roomLabel = ROOM_TYPES.find(r => r.key === answers.roomType)?.label || answers.roomType;
      let html = `
        <div style="margin-bottom:10px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:4px">ผลวิเคราะห์จาก AI</div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-bottom:8px">
            <div style="font-weight:700;color:#166534;font-size:16px;margin-bottom:6px">✅ แนะนำ: แอร์ ${recBTU.toLocaleString()} BTU</div>
            <div style="font-size:13px;color:#15803d;line-height:1.7">
              📐 ห้อง: ${roomLabel} — ${answers.area.toFixed(1)} ตร.ม.<br>
              👥 จำนวนคน: ${answers.people} คน<br>
              🔢 BTU คำนวณได้: ${Math.round(rawBTU).toLocaleString()} BTU<br>
              💡 ค่าไฟโดยประมาณ: <b>${monthlyCost.toLocaleString()} บาท/เดือน</b> (ใช้ 8 ชม./วัน)
            </div>
          </div>
        </div>
      `;

      // Selling points based on priority
      const tips = [];
      if (answers.priority === "inverter" || answers.priority === "quiet") {
        tips.push(...SELLING_POINTS.inverter.slice(0, 2));
      }
      if (answers.priority === "health") {
        tips.push(...SELLING_POINTS.health.slice(0, 2));
      }
      tips.push(SELLING_POINTS.saving[0].replace("{cost}", monthlyCost.toLocaleString()));
      tips.push(...SELLING_POINTS.warranty.slice(0, 1));

      html += `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:8px">
          <div style="font-weight:700;color:#1e40af;margin-bottom:4px;font-size:14px">💡 เคล็ดลับการเลือกซื้อ</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#1e3a8a;line-height:1.7">
            ${tips.map(t => `<li>${t}</li>`).join("")}
          </ul>
        </div>
      `;

      addBubble(html, "bot", true);

      // ═══ CATALOG RECOMMENDATIONS (5-10 models) ═══
      setTimeout(() => {
        const catalogMatched = matchCatalog(rawBTU, answers.budget, answers.priority);
        if (catalogMatched.length > 0) {
          let catHtml = `
            <div style="font-weight:700;color:#7c3aed;margin-bottom:8px;font-size:14px">🏷️ แอร์พร้อมติดตั้งจากแคตตาล็อก (${catalogMatched.length} รุ่นที่แนะนำ)</div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:8px">ราคารวมติดตั้งแล้ว — กดปุ่ม "สั่งซื้อ" เพื่อสั่งได้เลย!</div>
          `;
          catalogMatched.forEach((item, idx) => {
            const isInverter = /inverter|inv|อินเวอร์เตอร์/i.test(item.s);
            const brand = item.s.split(" ")[0];
            catHtml += `
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.05)">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;flex-wrap:wrap">
                  <div style="flex:1;min-width:180px">
                    <div style="font-weight:700;color:#1f2937;font-size:14px">${brand} — ${item.m}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px">${item.s}</div>
                    <div style="display:flex;gap:8px;font-size:12px;color:#6b7280;margin-top:6px;flex-wrap:wrap">
                      <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px">❄️ ${item.btu.toLocaleString()} BTU</span>
                      ${isInverter ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px">⚡ Inverter</span>' : '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:12px">🔧 Fixed Speed</span>'}
                    </div>
                    <div style="font-size:11px;color:#9ca3af;margin-top:4px">
                      รับประกัน: เครื่อง ${item.wi} | อะไหล่ ${item.wp} | คอมเพรสเซอร์ ${item.wc}
                    </div>
                  </div>
                  <div style="text-align:right;min-width:120px">
                    <div style="font-size:18px;font-weight:800;color:#dc2626">${item.p.toLocaleString()}</div>
                    <div style="font-size:11px;color:#6b7280">บาท (รวมติดตั้ง)</div>
                    <button data-order-cat="${idx}" style="margin-top:6px;padding:8px 16px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(124,58,237,.3);transition:all .2s">
                      🛒 สั่งซื้อ
                    </button>
                  </div>
                </div>
              </div>
            `;
          });
          addBubble(catHtml, "bot", true);

          // Attach order handlers for catalog items
          setTimeout(() => {
            catalogMatched.forEach((item, idx) => {
              const btn = chatBox.querySelector(`[data-order-cat="${idx}"]`);
              if (btn) {
                btn.addEventListener("click", () => {
                  btn.disabled = true;
                  btn.textContent = "⏳ กำลังสั่ง...";
                  btn.style.background = "#9ca3af";
                  showOrderForm({ name: item.s + " " + item.m, btu: item.btu, price: item.p }, "แคตตาล็อก");
                });
                btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.transform = "scale(1.05)"; });
                btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)"; });
              }
            });
          }, 100);
        }

        // ═══ STOCK PRODUCTS ═══
        setTimeout(() => {
          const matched = matchProducts(state.products || [], rawBTU);
          if (matched.length > 0) {
            let prodHtml = `
              <div style="font-weight:700;color:#1e40af;margin-bottom:8px;font-size:14px">📦 สินค้าในสต็อกพร้อมส่ง (${matched.length} รายการ)</div>
              <div style="font-size:12px;color:#6b7280;margin-bottom:8px">มีของพร้อมส่ง — กดปุ่ม "สั่งซื้อ" ได้เลย!</div>
            `;
            matched.slice(0, 6).forEach((p, idx) => {
              prodHtml += `
                <div style="background:#fff;border:2px solid #3b82f6;border-radius:12px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(59,130,246,.15)">
                  <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;flex-wrap:wrap">
                    <div style="flex:1;min-width:180px">
                      <div style="display:flex;align-items:center;gap:6px">
                        <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">IN STOCK</span>
                        <div style="font-weight:700;color:#1f2937;font-size:14px">${p.name}</div>
                      </div>
                      <div style="display:flex;gap:8px;font-size:12px;color:#6b7280;margin-top:6px;flex-wrap:wrap">
                        ${p.btu ? `<span>❄️ ${Number(p.btu).toLocaleString()} BTU</span>` : ""}
                        <span>📦 คงเหลือ ${p.stock} เครื่อง</span>
                      </div>
                    </div>
                    <div style="text-align:right;min-width:120px">
                      <div style="font-size:18px;font-weight:800;color:#dc2626">${money(p.price)}</div>
                      <button data-order-stock="${idx}" style="margin-top:6px;padding:8px 16px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(37,99,235,.3);transition:all .2s">
                        🛒 สั่งซื้อ
                      </button>
                    </div>
                  </div>
                </div>
              `;
            });
            addBubble(prodHtml, "bot", true);

            // Attach order handlers for stock items
            setTimeout(() => {
              matched.slice(0, 6).forEach((p, idx) => {
                const btn = chatBox.querySelector(`[data-order-stock="${idx}"]`);
                if (btn) {
                  btn.addEventListener("click", () => {
                    btn.disabled = true;
                    btn.textContent = "⏳ กำลังสั่ง...";
                    btn.style.background = "#9ca3af";
                    showOrderForm({ name: p.name, btu: p.btu, price: p.price, product_id: p.id }, "สต็อกในร้าน");
                  });
                  btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.transform = "scale(1.05)"; });
                  btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)"; });
                }
              });
            }, 100);
          } else if (catalogMatched.length === 0) {
            addBubble("ขณะนี้ยังไม่มีสินค้าที่ตรงตามเงื่อนไขในระบบ กรุณาติดต่อร้านบุญสุขโดยตรงครับ 📞", "bot");
          }

          // ═══ CLOSING / NAVIGATION ═══
          setTimeout(() => {
            addBubble("ต้องการให้ช่วยอะไรเพิ่มไหมครับ? 😊");
            showChoices([
              { label: "🔄 คำนวณห้องอื่น", action: () => startConversation() },
              { label: "🛒 ดูแอร์ทั้งหมด", action: () => showRoute("ac_shop") },
              { label: "🛠️ แจ้งซ่อม/ติดตั้ง", action: () => showRoute("service_request") },
              { label: "🧮 คำนวณ BTU ละเอียด", action: () => showRoute("btu_calculator") },
              { label: "⚠️ ดู Error Code", action: () => showRoute("error_codes") }
            ]);
            restartDiv.classList.remove("hidden");
          }, 500);
        }, 600);
      }, 600);
    }, 800);
  }

  restartBtn.addEventListener("click", startConversation);

  // Start!
  startConversation();
}
