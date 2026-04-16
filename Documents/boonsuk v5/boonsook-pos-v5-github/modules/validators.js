// ═══════════════════════════════════════════════════════════
//  VALIDATORS — ตรวจเช็คข้อมูลก่อน POST/INSERT
// ═══════════════════════════════════════════════════════════

/**
 * ตรวจสอบ required fields
 * @param {Object} fields - ข้อมูลที่ต้องตรวจ { name, email, ... }
 * @returns {boolean} true if all valid
 * @throws {Error} ถ้ามีฟิลด์ขาดหรือว่าง
 */
export const validateRequired = (fields) => {
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || String(value).trim() === "") {
      throw new Error(`กรุณากรอก ${key}`);
    }
  }
  return true;
};

/**
 * ตรวจสอบ email format
 * @param {string} email - email address
 * @returns {boolean}
 */
export const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

/**
 * ตรวจสอบ phone number (Thailand)
 * @param {string} phone - phone number
 * @returns {boolean}
 */
export const isValidPhone = (phone) => {
  return /^(\d{10}|\+66\d{9})$/.test(String(phone).replace(/[\s\-]/g, ""));
};

/**
 * ตรวจสอบ data types สำหรับ order/sale
 * @param {Object} payload - ข้อมูลที่ต้องตรวจ
 * @returns {boolean} true if valid
 * @throws {Error} ถ้า type ผิด
 */
export const validateOrderPayload = (payload) => {
  const { total_amount, items, customer_name, customer_phone, payment_method } = payload;

  // Check required
  validateRequired({
    total_amount,
    customer_name,
    customer_phone,
    payment_method,
  });

  // Check types
  if (typeof total_amount !== "number" || total_amount <= 0) {
    throw new Error("ยอดรวมต้องเป็นตัวเลขที่มากกว่า 0");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
  }

  items.forEach((item, idx) => {
    if (!item.product_id && !item.name) {
      throw new Error(`สินค้า[${idx}] ต้องมี product_id หรือ name`);
    }
    if (typeof item.qty !== "number" || item.qty <= 0) {
      throw new Error(`สินค้า[${idx}] จำนวนต้องเป็นตัวเลขที่มากกว่า 0`);
    }
    if (typeof item.price !== "number" || item.price < 0) {
      throw new Error(`สินค้า[${idx}] ราคาต้องเป็นตัวเลข >= 0`);
    }
  });

  // Check phone
  if (!isValidPhone(customer_phone)) {
    throw new Error("เบอร์โทรไม่ถูกต้อง (10 หลัก หรือ +66)");
  }

  // Check payment method
  const validMethods = ["transfer", "cod_cash", "cod_transfer", "cash", "card"];
  if (!validMethods.includes(payment_method)) {
    throw new Error("วิธีชำระเงินไม่ถูกต้อง");
  }

  return true;
};

/**
 * ตรวจสอบ Supabase RPC payload
 * @param {Object} params - RPC parameters
 * @returns {boolean}
 * @throws {Error}
 */
export const validateRPCParams = (params) => {
  if (typeof params !== "object" || params === null) {
    throw new Error("RPC params must be object");
  }
  return true;
};

/**
 * User-friendly error message converter
 * @param {Error} error - Error object from API/DB
 * @returns {string} User-friendly message
 */
export const getUserFriendlyError = (error) => {
  const message = error?.message || String(error);

  if (message.includes("RLS")) {
    return "ระบบไม่อนุญาต - ตรวจสอบการอนุญาต หรือติดต่อแอดมิน";
  }
  if (message.includes("UNIQUE")) {
    return "ข้อมูลนี้มีอยู่ในระบบแล้ว";
  }
  if (message.includes("FOREIGN KEY")) {
    return "ข้อมูลเชื่อมโยงไม่ถูกต้อง";
  }
  if (message.includes("NOT NULL")) {
    return "มีฟิลด์ที่ต้องกรอก";
  }
  if (message.includes("400")) {
    return "ข้อมูลไม่ถูกต้อง - ตรวจสอบแบบฟอร์มใหม่";
  }
  if (message.includes("401") || message.includes("403")) {
    return "ไม่มีสิทธิ์การเข้าถึง - ลงชื่อเข้าใหม่";
  }
  if (message.includes("404")) {
    return "ไม่พบข้อมูล";
  }
  if (message.includes("500")) {
    return "เซิร์ฟเวอร์เกิดข้อผิดพลาด - ลองใหม่";
  }
  if (message.includes("Network") || message.includes("fetch")) {
    return "ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต";
  }

  return message || "เกิดข้อผิดพลาด - ลองใหม่";
};

/**
 * Validate file (for slip/proof upload)
 * @param {File} file - File object
 * @param {Object} options - { maxSize, allowedTypes }
 * @returns {boolean}
 * @throws {Error}
 */
export const validateFile = (file, options = {}) => {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB default
    allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  } = options;

  if (!file) {
    throw new Error("กรุณาเลือกไฟล์");
  }

  if (file.size > maxSize) {
    throw new Error(`ไฟล์มีขนาดเกิน ${Math.round(maxSize / 1024 / 1024)} MB`);
  }

  if (!allowedTypes.includes(file.type)) {
    throw new Error("ประเภทไฟล์ไม่รองรับ");
  }

  return true;
};

export default {
  validateRequired,
  isValidEmail,
  isValidPhone,
  validateOrderPayload,
  validateRPCParams,
  validateFile,
  getUserFriendlyError,
};
