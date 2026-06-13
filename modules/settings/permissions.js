// Phase 434: ปิดหน้า "ตารางสิทธิ์พนักงาน" ชั่วคราว — เมทริกซ์ checkbox เดิมบันทึกลงตาราง permissions ได้
//   แต่ไม่มีโค้ดส่วนใดเรียก hasPermission() ไปบังคับสิทธิ์จริง → เป็น UI หลอกตา (owner: "ทำไว้โชว์")
//   เมนูทางเข้าถูกซ่อนแล้วใน menu.js; หน้านี้คงไว้แต่แสดงข้อความปิดปรับปรุง + ชี้ไปที่จุดตั้งสิทธิ์จริง
//   (role ผู้ใช้ที่ "ตั้งค่าผู้ใช้งาน" → ROLE_PAGES คุมว่าแต่ละ role เห็น/ใช้เมนูใด). ไม่เรียก matrix อีก
export function renderSettingsPermissions(el, ctx, goBack) {
  el.innerHTML = `
    <div class="set-subpage">
      <div class="set-subpage-header">
        <button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">สิทธิ์การใช้งาน</h3>
      </div>
      <div style="margin:16px 0;padding:16px;background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f59e0b;border-radius:12px;color:#92400e;font-size:14px;line-height:1.7">
        🛠️ <strong>หน้านี้ปิดปรับปรุงชั่วคราว</strong><br/>
        การกำหนดสิทธิ์การเข้าถึงเมนูทำผ่าน <strong>"บทบาท (role)" ของผู้ใช้แต่ละคน</strong> —
        ไปที่ <strong>ตั้งค่า → ตั้งค่าผู้ใช้งาน</strong> แล้วเลือกบทบาท (ผู้ดูแล / พนักงานขาย / ช่าง / ลูกค้า)
        ระบบจะเปิดเมนูให้อัตโนมัติตามบทบาทนั้น
      </div>
    </div>
  `;
  document.getElementById("setBackBtn")?.addEventListener("click", goBack);
}
