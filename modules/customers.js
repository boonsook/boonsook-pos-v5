
const CONTACT_TYPES = {
  customer: { label: "ลูกค้า", color: "#0284c7", dot: "#3b82f6" },
  supplier: { label: "ผู้จำหน่าย", color: "#d97706", dot: "#f59e0b" },
  both:     { label: "ผู้จำหน่าย/ลูกค้า", color: "#059669", dot: "#10b981" }
};

let currentFilter = "all"; // all | customer | supplier | both
let searchQuery = "";
let currentPage = 1;
const PAGE_SIZE = 20;
let _custAbort = null;

export function renderCustomersPage({ state, openCustomerDrawer }) {
  const ctx = { state, openCustomerDrawer };
  currentPage = 1;
  searchQuery = "";
  currentFilter = "all";
  renderView(ctx);
}

function renderView(ctx) {
  const { state, openCustomerDrawer } = ctx;

  // Cleanup old event listeners
  if (_custAbort) _custAbort.abort();
  _custAbort = new AbortController();
  const signal = _custAbort.signal;

  const el = document.getElementById("page-customers");

  // Filter + Search
  let filtered = [...(state.customers || [])];
  if (currentFilter !== "all") {
    filtered = filtered.filter(c => (c.contact_type || "customer") === currentFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      String(c.name||"").toLowerCase().includes(q) ||
      String(c.phone||"").toLowerCase().includes(q) ||
      String(c.company||"").toLowerCase().includes(q) ||
      String(c.tax_id||"").toLowerCase().includes(q) ||
      String(c.email||"").toLowerCase().includes(q)
    );
  }

  // Count by type
  const countAll = (state.customers || []).length;
  const countCustomer = (state.customers || []).filter(c => (c.contact_type||"customer") === "customer").length;
  const countSupplier = (state.customers || []).filter(c => (c.contact_type||"customer") === "supplier").length;
  const countBoth = (state.customers || []).filter(c => (c.contact_type||"customer") === "both").length;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  el.innerHTML = `
    <div class="panel">
      <div class="row" style="flex-wrap:wrap;gap:12px">
        <div>
          <h3 style="margin:0;font-size:22px;color:var(--primary2)">สมุดรายชื่อ</h3>
          <div class="sku">สมุดรายชื่อ</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="contactImportBtn" class="btn light">นำเข้ารายชื่อ</button>
          <button id="contactExportBtn" class="btn light">ส่งออก Excel</button>
          ${countAll > 0 ? '<button id="contactDeleteAllBtn" class="btn danger-fill" style="background:#fee2e2;color:#dc2626;border:none">ลบทั้งหมด</button>' : ''}
          <button id="contactAddBtn" class="btn primary">สร้างใหม่</button>
        </div>
      </div>

      <!-- Filter Tabs -->
      <div class="contact-filter-tabs mt16">
        <button class="contact-tab ${currentFilter==='all'?'active':''}" data-filter="all">แสดงทั้งหมด <span class="contact-tab-count">${countAll}</span></button>
        <button class="contact-tab ${currentFilter==='customer'?'active':''}" data-filter="customer"><span class="contact-dot" style="background:#3b82f6"></span> ลูกค้า <span class="contact-tab-count">${countCustomer}</span></button>
        <button class="contact-tab ${currentFilter==='supplier'?'active':''}" data-filter="supplier"><span class="contact-dot" style="background:#f59e0b"></span> ผู้จำหน่าย <span class="contact-tab-count">${countSupplier}</span></button>
        <button class="contact-tab ${currentFilter==='both'?'active':''}" data-filter="both"><span class="contact-dot" style="background:#10b981"></span> ผู้จำหน่าย/ลูกค้า <span class="contact-tab-count">${countBoth}</span></button>
      </div>

      <!-- Search -->
      <div class="toolbar mt16">
        <input id="contactSearchInput" placeholder="ค้นหาจากชื่อ หรือรหัสผู้ติดต่อ" value="${escHtml(searchQuery)}" style="flex:1" />
      </div>

      <!-- Table -->
      <div class="table-wrap mt16">
        <table class="contact-table">
          <thead>
            <tr>
              <th>รายชื่อ</th>
              <th class="desktop-col">ชื่อผู้ติดต่อ</th>
              <th>เบอร์ติดต่อ</th>
              <th class="desktop-col">อีเมล</th>
              <th>ประเภท</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.length ? pageItems.map(c => {
              const t = c.contact_type || "customer";
              const ct = CONTACT_TYPES[t] || CONTACT_TYPES.customer;
              return `
                <tr>
                  <td>
                    <span class="contact-dot" style="background:${ct.dot}"></span>
                    <span style="font-weight:700">${escHtml(c.name || "-")}</span>
                    ${c.company ? `<div class="sku" style="margin-left:16px">${escHtml(c.company)}</div>` : ''}
                  </td>
                  <td class="desktop-col">${escHtml(c.contact_person || "")}</td>
                  <td>${escHtml(c.phone || "-")}</td>
                  <td class="desktop-col">${escHtml(c.email || "")}</td>
                  <td><span style="color:${ct.color};font-weight:700;font-size:13px">${ct.label}</span></td>
                  <td style="white-space:nowrap">
                    <button class="btn light" style="padding:6px 10px;font-size:12px" data-contact-edit="${c.id}">แก้ไข</button>
                    <button class="btn light" style="padding:6px 10px;font-size:12px;color:#dc2626" data-contact-delete="${c.id}">ลบ</button>
                  </td>
                </tr>
              `;
            }).join("") : `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">ไม่มีรายชื่อ</td></tr>`}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      ${totalPages > 1 ? `
      <div class="contact-pagination mt16">
        <button class="contact-page-btn" data-page="1" ${currentPage===1?'disabled':''}>&laquo;</button>
        <button class="contact-page-btn" data-page="${currentPage-1}" ${currentPage===1?'disabled':''}>&lsaquo;</button>
        ${renderPageNumbers(currentPage, totalPages)}
        <button class="contact-page-btn" data-page="${currentPage+1}" ${currentPage===totalPages?'disabled':''}>&rsaquo;</button>
        <button class="contact-page-btn" data-page="${totalPages}" ${currentPage===totalPages?'disabled':''}>&raquo;</button>
      </div>
      ` : ''}
    </div>

    <!-- Hidden import input -->
    <input type="file" id="contactFileInput" accept=".xlsx,.xls,.csv" style="display:none" />
  `;

  // ─── Bindings ───
  document.getElementById("contactAddBtn")?.addEventListener("click", () => openCustomerDrawer(), { signal });
  document.getElementById("contactImportBtn")?.addEventListener("click", () => {
    document.getElementById("contactFileInput")?.click();
  }, { signal });
  document.getElementById("contactExportBtn")?.addEventListener("click", () => exportToExcel(state), { signal });
  document.getElementById("contactFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importFromExcel(file, ctx);
    e.target.value = ""; // ★ reset เพื่อให้เลือกไฟล์เดิมซ้ำได้
  }, { signal });

  // Filter tabs
  document.querySelectorAll("[data-filter]").forEach(btn => btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    currentPage = 1;
    renderView(ctx);
  }, { signal }));

  // Search
  document.getElementById("contactSearchInput")?.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderView(ctx);
  }, { signal });

  // Pagination
  document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => {
    const p = Number(btn.dataset.page);
    if (p >= 1 && p <= totalPages) {
      currentPage = p;
      renderView(ctx);
    }
  }, { signal }));

  // Edit buttons
  document.querySelectorAll("[data-contact-edit]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.customers.find(x => x.id === Number(btn.dataset.contactEdit));
    openCustomerDrawer(item);
  }, { signal }));

  // ★ Delete single contact
  document.querySelectorAll("[data-contact-delete]").forEach(btn => btn.addEventListener("click", async () => {
    const id = Number(btn.dataset.contactDelete);
    const item = state.customers.find(x => x.id === id);
    if (!(await window.App?.confirm?.(`ลบ "${item?.name || '-'}" ?`))) return;
    const ok = await xhrDeleteCustomer(id);
    if (ok) {
      window.App?.showToast?.("ลบแล้ว");
      if (window.App?.loadAllData) await window.App.loadAllData();
      renderView(ctx);
    } else {
      window.App?.showToast?.("ลบไม่สำเร็จ — อาจต้องแก้ RLS policy ใน Supabase");
    }
  }, { signal }));

  // ★ Delete ALL contacts
  document.getElementById("contactDeleteAllBtn")?.addEventListener("click", async () => {
    const total = (state.customers || []).length;
    if (!(await window.App?.confirm?.(`ลบรายชื่อทั้งหมด ${total} รายการ? การกระทำนี้ไม่สามารถย้อนกลับได้`))) return;
    if (!(await window.App?.confirm?.(`ยืนยันอีกครั้ง — ลบทั้งหมด ${total} รายการ?`))) return;
    window.App?.showToast?.("กำลังลบ...");
    const ok = await xhrDeleteCustomer(null); // null = ลบทั้งหมด
    if (ok) {
      window.App?.showToast?.("ลบทั้งหมดสำเร็จ");
    } else {
      window.App?.showToast?.("ลบไม่สำเร็จ — ลองรัน SQL ใน Supabase Dashboard");
    }
    if (window.App?.loadAllData) await window.App.loadAllData();
    renderView(ctx);
  }, { signal });
}

function renderPageNumbers(current, total) {
  let pages = [];
  const range = 2;
  for (let i = Math.max(1, current-range); i <= Math.min(total, current+range); i++) {
    pages.push(i);
  }
  return pages.map(p =>
    `<button class="contact-page-btn ${p===current?'active':''}" data-page="${p}">${p}</button>`
  ).join("");
}


// ═══════════════════════════════════════════════════════════
//  IMPORT FROM EXCEL (Robust — auto-detect header row)
// ═══════════════════════════════════════════════════════════
async function importFromExcel(file, ctx) {
  const { state } = ctx;
  window.App?.showToast?.("กำลังนำเข้า...");

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // ★ อ่านเป็น array of arrays (ไม่สมมติ header row)
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    // rawRows parsed

    // ★ ค้นหา header row อัตโนมัติ — หาแถวที่มีคำ "ชื่อ" หรือ "ประเภท" หรือ "name"
    let headerIdx = -1;
    const HEADER_HINTS = ["ชื่อธุรกิจ", "ชื่อบุคคล", "ประเภท", "รายชื่อ", "name", "ชื่อสินค้า", "รหัสผู้ติดต่อ"];
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const rowStr = rawRows[i].map(c => String(c).trim()).join("|").toLowerCase();
      const matchCount = HEADER_HINTS.filter(h => rowStr.includes(h.toLowerCase())).length;
      if (matchCount >= 2) { headerIdx = i; break; }
    }

    if (headerIdx === -1) {
      // fallback: ถ้าหาไม่เจอ ลอง row 0 แล้ว row 1
      headerIdx = rawRows.length > 1 && rawRows[0].filter(c => String(c).trim()).length <= 2 ? 1 : 0;
    }

    // header found

    const headers = rawRows[headerIdx].map(h => String(h).trim());
    const dataRows = rawRows.slice(headerIdx + 1).filter(r => r.some(c => String(c).trim() !== ""));

    if (!dataRows.length) {
      window.App?.showToast?.("ไม่พบข้อมูลในไฟล์");
      return;
    }

    // ★ สร้าง column index map — ค้นหาตำแหน่ง column จาก header
    function findColIdx(...keywords) {
      for (const kw of keywords) {
        const idx = headers.findIndex(h => h === kw);
        if (idx !== -1) return idx;
      }
      for (const kw of keywords) {
        const idx = headers.findIndex(h => h.includes(kw));
        if (idx !== -1) return idx;
      }
      return -1;
    }

    const COL = {
      name:     findColIdx("ชื่อธุรกิจ/ชื่อบุคคล", "ชื่อธุรกิจ", "ชื่อบุคคล", "รายชื่อ", "ชื่อผู้ติดต่อ", "name"),
      phone:    findColIdx("เบอร์โทรศัพท์", "โทรศัพท์", "เบอร์โทร", "เบอร์ติดต่อ", "เบอร์มือถือ", "phone"),
      company:  findColIdx("บริษัท", "ชื่อกิจการ", "company"),
      address:  findColIdx("ที่อยู่", "address"),
      address2: findColIdx("ที่อยู่ 2", "ที่อยู่2"),
      address3: findColIdx("ที่อยู่ 3", "ที่อยู่3"),
      taxId:    findColIdx("เลขประจำตัวผู้เสียภาษี", "เลขผู้เสียภาษี", "tax_id"),
      email:    findColIdx("อีเมล", "email", "E-mail"),
      contact:  findColIdx("ผู้ติดต่อ", "ชื่อผู้ติดต่อ", "contact"),
      type:     findColIdx("ประเภท", "type")
    };

    // columns mapped

    function getVal(row, colIdx) {
      if (colIdx === -1 || !row[colIdx]) return "";
      return String(row[colIdx]).trim();
    }

    let imported = 0, failed = 0;

    for (const row of dataRows) {
      const name = getVal(row, COL.name);
      if (!name) { failed++; continue; }

      const addr1 = getVal(row, COL.address);
      const addr2 = getVal(row, COL.address2);
      const addr3 = getVal(row, COL.address3);
      const fullAddress = [addr1, addr2, addr3].filter(Boolean).join(" ");

      const payload = {
        name: name,
        phone: getVal(row, COL.phone),
        company: getVal(row, COL.company),
        address: fullAddress,
        tax_id: getVal(row, COL.taxId),
        email: getVal(row, COL.email),
        contact_person: getVal(row, COL.contact),
        contact_type: mapContactType(getVal(row, COL.type) || "customer")
      };

      const cfg = window.SUPABASE_CONFIG;
      const accessToken = window._sbAccessToken || cfg.anonKey;
      const ok = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", cfg.url + "/rest/v1/customers");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("apikey", cfg.anonKey);
        xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
        xhr.setRequestHeader("Prefer", "return=minimal");
        xhr.timeout = 10000;
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) resolve(true);
          else { console.warn("Import contact failed:", xhr.status, xhr.responseText); resolve(false); }
        };
        xhr.onerror = function () { resolve(false); };
        xhr.ontimeout = function () { resolve(false); };
        xhr.send(JSON.stringify([payload]));
      });

      if (ok) imported++;
      else failed++;
    }

    window.App?.showToast?.(`นำเข้าสำเร็จ ${imported} รายการ${failed ? `, ล้มเหลว ${failed}` : ''}`);
    if (window.App?.loadAllData) await window.App.loadAllData();
    renderView(ctx);

  } catch (err) {
    console.error("Import error:", err);
    window.App?.showToast?.("นำเข้าไม่สำเร็จ: " + (err.message || err));
  }
}

function mapContactType(val) {
  const v = String(val).trim();
  const vl = v.toLowerCase();
  if (vl.includes("ผู้จำหน่าย") && vl.includes("ลูกค้า")) return "both";
  if (vl.includes("supplier") && vl.includes("customer")) return "both";
  if (vl.includes("ผู้จำหน่าย") || vl === "supplier" || vl.includes("vendor")) return "supplier";
  if (vl === "both") return "both";
  // FlowAccount: "ลูกค้า" = customer, "ผู้จำหน่าย" = supplier (already handled above)
  if (vl.includes("ลูกค้า") || vl === "customer") return "customer";
  return "customer";
}


// ═══════════════════════════════════════════════════════════
//  EXPORT TO EXCEL
// ═══════════════════════════════════════════════════════════
function exportToExcel(state) {
  try {
    const contacts = (state.customers || []).map(c => ({
      "ประเภท": (CONTACT_TYPES[c.contact_type || "customer"] || CONTACT_TYPES.customer).label,
      "ชื่อธุรกิจ/ชื่อบุคคล": c.name || "",
      "ชื่อผู้ติดต่อ": c.contact_person || "",
      "บริษัท": c.company || "",
      "เบอร์โทรศัพท์": c.phone || "",
      "อีเมล": c.email || "",
      "ที่อยู่": c.address || "",
      "เลขประจำตัวผู้เสียภาษี": c.tax_id || ""
    }));

    const ws = XLSX.utils.json_to_sheet(contacts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "รายชื่อ");

    // Set column widths
    ws["!cols"] = [
      { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 15 },
      { wch: 25 }, { wch: 35 }, { wch: 18 }, { wch: 18 }
    ];

    XLSX.writeFile(wb, "สมุดรายชื่อ_บุญสุข.xlsx");
    window.App?.showToast?.("ส่งออก Excel สำเร็จ");
  } catch(err) {
    window.App?.showToast?.("ส่งออกไม่สำเร็จ: " + (err.message || err));
  }
}


// ═══════════════════════════════════════════════════════════
//  DELETE HELPERS — ใช้ REST DELETE ผ่าน VIEW "customers"
// ═══════════════════════════════════════════════════════════

function xhrDeleteCustomer(id) {
  const cfg = window.SUPABASE_CONFIG;
  const accessToken = window._sbAccessToken || cfg.anonKey;
  const url = id
    ? cfg.url + "/rest/v1/customers?id=eq." + id
    : cfg.url + "/rest/v1/customers?id=gt.0"; // ลบทั้งหมด
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", url);
    xhr.setRequestHeader("apikey", cfg.anonKey);
    xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
    xhr.setRequestHeader("Prefer", "return=representation"); // ★ ส่งผลลัพธ์กลับเพื่อเช็คว่าลบจริงหรือเปล่า
    xhr.timeout = 30000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        // ★ เช็คว่า response มีข้อมูลที่ถูกลบจริง (ป้องกัน RLS block)
        let deleted = [];
        try { deleted = JSON.parse(xhr.responseText); } catch(e) { console.warn("[customers DELETE] JSON.parse failed:", e, xhr.responseText?.slice(0, 200)); }
        if (id && Array.isArray(deleted) && deleted.length === 0) {
          console.warn("DELETE returned 200 but 0 rows deleted — RLS may be blocking");
          resolve(false);
        } else {
          resolve(true);
        }
      } else {
        console.warn("DELETE failed:", xhr.status, xhr.responseText);
        resolve(false);
      }
    };
    xhr.onerror = function () { resolve(false); };
    xhr.ontimeout = function () { resolve(false); };
    xhr.send();
  });
}


function escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
