// Phase 639: presentation only. Never derive money, numbers or document status.
export const DOCUMENT_TITLES = Object.freeze({
  quotation: Object.freeze(['ใบเสนอราคา', 'ใบประเมินราคา']),
  delivery: Object.freeze(['ใบส่งสินค้า/ใบแจ้งหนี้', 'ใบส่งสินค้า', 'ใบแจ้งหนี้']),
  receipt: Object.freeze(['ใบเสร็จรับเงิน']),
});
export const DOCUMENT_NOTE_KEYS = Object.freeze({
  quotation: 'docShowNoteQuotation', delivery: 'docShowNoteDelivery', receipt: 'docShowNoteReceipt',
});
const text = value => typeof value === 'string' ? value.trim() : '';

export function createDocumentTemplateSnapshot(storeInfo = {}, type) {
  if (!DOCUMENT_TITLES[type]) throw new Error('Unknown document type');
  const config = storeInfo.docTemplatesV1?.[type];
  return {
    version: 1, document_type: type,
    title: DOCUMENT_TITLES[type].includes(config?.title) ? config.title : DOCUMENT_TITLES[type][0],
    header: text(storeInfo.docHeader), footer: text(storeInfo.docFooter),
    note: typeof config?.note === 'string' ? text(config.note) : text(storeInfo.docNote),
    show_note: typeof config?.showNote === 'boolean' ? config.showNote : storeInfo[DOCUMENT_NOTE_KEYS[type]] !== false,
  };
}

export function isDocumentTemplateSnapshot(value, type) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && value.version === 1 && value.document_type === type
    && Object.hasOwn(DOCUMENT_TITLES, type)
    // Read historical text independently of today's choices; renderers escape it.
    // The writer and DB still enforce the allowed choices for new documents.
    && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200
    && ['header', 'footer', 'note'].every(key => typeof value[key] === 'string' && value[key].length <= 4000)
    && typeof value.show_note === 'boolean';
}

// Missing column is the pre-migration compatibility path, not a replacement for
// a corrupt snapshot. After SQL, NOT NULL + DEFAULT covers all old rows/clients.
export function resolveDocumentPresentation(storeInfo = {}, document = {}, type) {
  const snapshot = document.document_template_snapshot;
  if (snapshot === undefined && !storeInfo.docTemplatesV1) return {
    ...storeInfo, documentTitle: DOCUMENT_TITLES[type][0],
  };
  if (!isDocumentTemplateSnapshot(snapshot, type)) {
    throw new Error('รูปแบบเอกสารไม่ครบหรือไม่รองรับ — หยุดพิมพ์และตรวจข้อมูล');
  }
  return {
    ...storeInfo, documentTitle: snapshot.title, docHeader: snapshot.header,
    docFooter: snapshot.footer, docNote: snapshot.note,
    [DOCUMENT_NOTE_KEYS[type]]: snapshot.show_note,
  };
}

// Read-only schema gate before changing defaults. No helper/RPC/number allocation.
export async function checkDocumentTemplateSchema() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url || !cfg?.anonKey) throw new Error('ยังไม่ได้เชื่อมต่อระบบเอกสาร');
  for (const table of ['quotations', 'delivery_invoices', 'receipts']) {
    const response = await fetch(`${cfg.url}/rest/v1/${table}?select=document_template_snapshot&limit=0`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${window._sbAccessToken || cfg.anonKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !Array.isArray(await response.json())) {
      throw new Error('ยังไม่พร้อมใช้รูปแบบเอกสาร — ต้องตรวจ Phase 639 SQL ก่อน');
    }
  }
}
