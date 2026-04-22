// ═══════════════════════════════════════════════════════════
//  AC SHOP — แอร์ใหม่พร้อมติดตั้ง (หน้าสำหรับลูกค้า)
//  ข้อมูลจากแคตตาล็อกร้านบุญสุข อิเล็กทรอนิกส์
// ═══════════════════════════════════════════════════════════

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

const BRANDS = [...new Set(AC_CATALOG.map(a => a.s.split(" ")[0]))];
const SERIES = [...new Set(AC_CATALOG.map(a => a.s))];
const BTU_OPTIONS = [...new Set(AC_CATALOG.map(a => a.btu))].sort((a,b) => a - b);

function money(n) { return "฿" + Number(n).toLocaleString(); }

function getBrandIcon(brand) {
  const icons = { Midea:"🌀", Fujitsu:"❄️", Carrier:"🔵", Mitsubishi:"🔴", Gree:"🍃", MAVELL:"⚡", DAIKIN:"🟠" };
  return icons[brand] || "❄️";
}

function isInverter(series) {
  return /inverter|inv/i.test(series);
}

export function renderAcShopPage(ctx) {
  const container = document.getElementById("page-ac_shop");
  if (!container) return;

  const { showToast, showRoute } = ctx;

  container.innerHTML = `
    <div style="max-width:960px;margin:0 auto;padding:8px">
      <!-- Hero -->
      <div style="text-align:center;padding:24px 16px;margin-bottom:16px;background:linear-gradient(135deg,#dbeafe,#c7d2fe);border-radius:16px">
        <div style="font-size:48px;margin-bottom:8px">❄️</div>
        <h2 style="margin:0 0 4px;color:#1e3a8a">แอร์ใหม่พร้อมติดตั้ง</h2>
        <p style="margin:0;color:#3730a3;font-size:14px">ราคารวมค่าติดตั้งมาตรฐาน — รับประกันทุกรุ่น — ร้านบุญสุข อิเล็กทรอนิกส์</p>
      </div>

      <!-- Filters -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <select id="shopBrandFilter" style="flex:1;min-width:120px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;background:#fff">
          <option value="">ทุกยี่ห้อ</option>
          ${BRANDS.map(b => `<option value="${b}">${getBrandIcon(b)} ${b}</option>`).join("")}
        </select>
        <select id="shopBtuFilter" style="flex:1;min-width:120px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;background:#fff">
          <option value="">ทุก BTU</option>
          <option value="9000">9,000 BTU (ห้องเล็ก)</option>
          <option value="12000">12,000 BTU (ห้องกลาง)</option>
          <option value="18000">18,000 BTU (ห้องใหญ่)</option>
          <option value="24000">24,000+ BTU (ห้องใหญ่มาก)</option>
        </select>
        <select id="shopTypeFilter" style="flex:1;min-width:120px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;background:#fff">
          <option value="">ทุกระบบ</option>
          <option value="inverter">⚡ Inverter (ประหยัดไฟ)</option>
          <option value="fixed">🔌 ธรรมดา (Fix Speed)</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <input id="shopSearch" type="text" placeholder="🔍 ค้นหารุ่น / ยี่ห้อ..." style="flex:1;min-width:200px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px" />
        <select id="shopSort" style="min-width:140px;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;background:#fff">
          <option value="price_asc">ราคาต่ำ → สูง</option>
          <option value="price_desc">ราคาสูง → ต่ำ</option>
          <option value="btu_asc">BTU น้อย → มาก</option>
          <option value="btu_desc">BTU มาก → น้อย</option>
        </select>
      </div>

      <!-- Count -->
      <div id="shopCount" style="font-size:13px;color:#6b7280;margin-bottom:12px"></div>

      <!-- Product Grid -->
      <div id="shopGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px"></div>

      <!-- Contact CTA -->
      <div style="margin-top:24px;padding:20px;background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border-radius:14px;border:1px solid #bbf7d0;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">📞</div>
        <h3 style="margin:0 0 4px;color:#166534">สนใจรุ่นไหน ติดต่อร้านบุญสุขได้เลย!</h3>
        <p style="margin:0;color:#15803d;font-size:13px">ราคาพิเศษสำหรับสมาชิก — ผ่อน 0% — ฟรีล้างแอร์ปีแรก</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
          <button id="shopGoBtu" class="btn primary" style="font-size:14px;padding:10px 20px">🧮 คำนวณ BTU ที่เหมาะกับห้อง</button>
          <button id="shopGoAi" class="btn light" style="font-size:14px;padding:10px 20px">🤖 ให้ AI ช่วยเลือก</button>
        </div>
      </div>
    </div>
  `;

  const brandFilter = container.querySelector("#shopBrandFilter");
  const btuFilter = container.querySelector("#shopBtuFilter");
  const typeFilter = container.querySelector("#shopTypeFilter");
  const searchInput = container.querySelector("#shopSearch");
  const sortSelect = container.querySelector("#shopSort");
  const grid = container.querySelector("#shopGrid");
  const countEl = container.querySelector("#shopCount");

  function render() {
    const brand = brandFilter.value;
    const btuRange = btuFilter.value;
    const type = typeFilter.value;
    const query = searchInput.value.trim().toLowerCase();
    const sort = sortSelect.value;

    let items = AC_CATALOG.filter(a => {
      if (brand && !a.s.startsWith(brand)) return false;
      if (btuRange) {
        const bv = Number(btuRange);
        if (bv === 9000 && a.btu > 10000) return false;
        if (bv === 12000 && (a.btu < 10000 || a.btu > 16000)) return false;
        if (bv === 18000 && (a.btu < 16000 || a.btu > 22000)) return false;
        if (bv === 24000 && a.btu < 22000) return false;
      }
      if (type === "inverter" && !isInverter(a.s)) return false;
      if (type === "fixed" && isInverter(a.s)) return false;
      if (query && !(a.s + " " + a.m).toLowerCase().includes(query)) return false;
      return true;
    });

    if (sort === "price_asc") items.sort((a,b) => a.p - b.p);
    if (sort === "price_desc") items.sort((a,b) => b.p - a.p);
    if (sort === "btu_asc") items.sort((a,b) => a.btu - b.btu);
    if (sort === "btu_desc") items.sort((a,b) => b.btu - a.btu);

    countEl.textContent = `แสดง ${items.length} จาก ${AC_CATALOG.length} รุ่น`;

    if (items.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#9ca3af"><div style="font-size:40px;margin-bottom:8px">😕</div>ไม่พบแอร์ตามเงื่อนไข ลองเปลี่ยนตัวกรอง</div>`;
      return;
    }

    grid.innerHTML = items.map(a => {
      const brandName = a.s.split(" ")[0];
      const icon = getBrandIcon(brandName);
      const inv = isInverter(a.s);
      return `
        <div style="border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;transition:box-shadow .2s;display:flex;flex-direction:column" onmouseover="this.style.boxShadow='0 6px 20px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='none'">
          <!-- Header -->
          <div style="background:${inv ? 'linear-gradient(135deg,#dbeafe,#e0e7ff)' : 'linear-gradient(135deg,#f3f4f6,#e5e7eb)'};padding:14px;text-align:center">
            <div style="font-size:36px;margin-bottom:4px">${icon}</div>
            <div style="font-size:11px;font-weight:600;color:${inv ? '#3730a3' : '#6b7280'};letter-spacing:0.5px">${a.s}</div>
            <div style="font-size:16px;font-weight:800;color:#1f2937;margin-top:2px">${a.m}</div>
            ${inv ? '<span style="display:inline-block;background:#3b82f6;color:#fff;font-size:10px;padding:2px 8px;border-radius:10px;margin-top:4px;font-weight:700">⚡ INVERTER</span>' : ''}
          </div>
          <!-- Details -->
          <div style="padding:14px;flex:1;display:flex;flex-direction:column">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:13px;color:#6b7280">❄️ BTU</span>
              <span style="font-weight:700;color:#1e40af">${a.btu.toLocaleString()}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12px;color:#6b7280">🔧 ติดตั้ง</span>
              <span style="font-size:12px">${a.wi}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12px;color:#6b7280">🔩 อะไหล่</span>
              <span style="font-size:12px">${a.wp}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:12px">
              <span style="font-size:12px;color:#6b7280">⚙️ คอมเพรสเซอร์</span>
              <span style="font-size:12px">${a.wc}</span>
            </div>
            <!-- Price + Stock + Order -->
            <div style="margin-top:auto;text-align:center;padding-top:10px;border-top:1px solid #f3f4f6">
              <div style="font-size:10px;color:#6b7280;margin-bottom:2px">ราคาพร้อมติดตั้ง</div>
              <div style="font-size:22px;font-weight:900;color:#059669">${money(a.p)}</div>
              <div style="font-size:11px;color:#16a34a;margin-top:2px">📦 พร้อมส่ง ${a.qty || 3} เครื่อง</div>
              <button data-shop-order='${JSON.stringify({s:a.s,m:a.m,btu:a.btu,p:a.p})}' style="margin-top:8px;width:100%;padding:10px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(124,58,237,.25);transition:all .2s">🛒 สั่งซื้อ</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Attach order button handlers
    grid.querySelectorAll("[data-shop-order]").forEach(btn => {
      btn.addEventListener("mouseenter", () => { btn.style.transform = "scale(1.03)"; });
      btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)"; });
      btn.addEventListener("click", () => {
        const prod = JSON.parse(btn.getAttribute("data-shop-order"));
        showShopOrderForm(prod, btn);
      });
    });
  }

  // ═══ ORDER FORM (inline modal) ═══
  let _shopFormSeq = 0;
  function showShopOrderForm(prod, triggerBtn) {
    const fid = ++_shopFormSeq;
    const prodName = prod.s + " " + prod.m;

    // Remove any existing order form
    const old = container.querySelector(".shop-order-form");
    if (old) old.remove();

    const formDiv = document.createElement("div");
    formDiv.className = "shop-order-form";
    formDiv.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .2s ease";
    formDiv.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:20px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <div style="text-align:center;margin-bottom:14px">
          <div style="font-size:32px">🛒</div>
          <h3 style="margin:4px 0 0;color:#1e3a8a;font-size:16px">สั่งซื้อแอร์</h3>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px;margin-bottom:14px;text-align:center">
          <div style="font-weight:700;color:#166534;font-size:14px">${prodName}</div>
          <div style="font-size:13px;color:#15803d;margin-top:4px">❄️ ${prod.btu.toLocaleString()} BTU — 💰 <b>${prod.p.toLocaleString()} บาท</b> (รวมติดตั้ง)</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input data-sf="${fid}" data-role="name" type="text" placeholder="ชื่อ-นามสกุล *" style="padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px">
          <input data-sf="${fid}" data-role="phone" type="tel" placeholder="เบอร์โทรศัพท์ *" style="padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px">
          <textarea data-sf="${fid}" data-role="addr" rows="2" placeholder="ที่อยู่สำหรับติดตั้ง *" style="padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;resize:vertical"></textarea>
          <textarea data-sf="${fid}" data-role="note" rows="1" placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" style="padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;resize:vertical"></textarea>
          <button data-sf="${fid}" data-role="submit" style="padding:14px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(22,163,74,.3)">✅ ยืนยันสั่งซื้อ</button>
          <button data-sf="${fid}" data-role="close" style="padding:10px;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;border-radius:10px;font-size:14px;cursor:pointer">ยกเลิก</button>
        </div>
      </div>
    `;
    document.body.appendChild(formDiv);

    const nameIn = formDiv.querySelector(`[data-role="name"]`);
    const phoneIn = formDiv.querySelector(`[data-role="phone"]`);
    const addrIn = formDiv.querySelector(`[data-role="addr"]`);
    const noteIn = formDiv.querySelector(`[data-role="note"]`);
    const submitBtn = formDiv.querySelector(`[data-role="submit"]`);
    const closeBtn = formDiv.querySelector(`[data-role="close"]`);

    nameIn.focus();

    // Close
    closeBtn.addEventListener("click", () => formDiv.remove());
    formDiv.addEventListener("click", (e) => { if (e.target === formDiv) formDiv.remove(); });

    // Submit
    submitBtn.addEventListener("click", async () => {
      const cName = nameIn.value.trim();
      const cPhone = phoneIn.value.trim();
      const cAddr = addrIn.value.trim();
      const cNote = noteIn.value.trim();

      if (!cName) { showToast("กรุณากรอกชื่อ"); nameIn.focus(); return; }
      if (!cPhone) { showToast("กรุณากรอกเบอร์โทร"); phoneIn.focus(); return; }
      if (!cAddr) { showToast("กรุณากรอกที่อยู่"); addrIn.focus(); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = "⏳ กำลังส่งคำสั่งซื้อ...";
      submitBtn.style.background = "#9ca3af";

      const jobNo = "SH-" + Date.now().toString(36).toUpperCase();
      const orderData = {
        job_no: jobNo,
        customer_name: cName,
        job_type: "ac",
        status: "pending",
        description: `สั่งซื้อแอร์ (หน้าร้าน): ${prodName}\nBTU: ${prod.btu.toLocaleString()}\nราคา: ${prod.p.toLocaleString()} บาท\n📞 เบอร์: ${cPhone}\n📍 ที่อยู่: ${cAddr}${cNote ? "\n📝 หมายเหตุ: " + cNote : ""}`,
        note: `AC Shop: ${prodName} | ราคา ${prod.p.toLocaleString()} บาท | โทร: ${cPhone}`,
        created_at: new Date().toISOString()
      };

      try {
        const res = await window._appXhrPost("service_jobs", orderData, { returnData: true });
        if (res?.ok) {
          formDiv.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:24px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2)">
              <div style="font-size:48px;margin-bottom:8px">✅</div>
              <h3 style="margin:0 0 8px;color:#166534">สั่งซื้อเรียบร้อยแล้ว!</h3>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-bottom:12px;text-align:left;font-size:13px;color:#15803d;line-height:1.8">
                🛒 <b>${prodName}</b><br>
                💰 ${prod.p.toLocaleString()} บาท<br>
                👤 ${cName} / ${cPhone}<br>
                📍 ${cAddr}<br>
                📄 เลขที่: <b>${jobNo}</b>
              </div>
              <p style="color:#166534;font-size:14px;margin:0 0 14px">ทีมงานบุญสุขจะติดต่อกลับเพื่อนัดวันติดตั้งครับ 🙏</p>
              <button id="shopOrderClose" style="padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer">ปิด</button>
            </div>
          `;
          formDiv.querySelector("#shopOrderClose").addEventListener("click", () => formDiv.remove());
          showToast("สั่งซื้อสำเร็จ!");
          try {
            if (typeof ctx?.sendLineNotify === "function") Promise.resolve(ctx.sendLineNotify(`🛒 ออเดอร์ใหม่จาก AC Shop!\nเลขที่: ${jobNo}\nลูกค้า: ${cName}\nโทร: ${cPhone}\nที่อยู่: ${cAddr}\nสินค้า: ${prodName}\nราคา: ${prod.p.toLocaleString()} บาท`)).catch(err => { console.warn("[ac_shop] LINE notify failed:", err); });
          } catch(e) { console.warn("[ac_shop] LINE notify threw:", e); }
        } else {
          throw new Error(res?.error?.message || "insert failed");
        }
      } catch (e) {
        console.error("Shop order error:", e);
        submitBtn.disabled = false;
        submitBtn.textContent = "✅ ยืนยันสั่งซื้อ";
        submitBtn.style.background = "linear-gradient(135deg,#16a34a,#15803d)";
        showToast("เกิดข้อผิดพลาด กรุณาลองใหม่");
      }
    });
  }

  [brandFilter, btuFilter, typeFilter, sortSelect].forEach(el => el.addEventListener("change", render));
  searchInput.addEventListener("input", render);

  container.querySelector("#shopGoBtu")?.addEventListener("click", () => showRoute("btu_calculator"));
  container.querySelector("#shopGoAi")?.addEventListener("click", () => showRoute("ai_sales"));

  render();
}
