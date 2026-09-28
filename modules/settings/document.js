import { escHtml } from './utils.js';
import { DOCUMENT_TITLES, createDocumentTemplateSnapshot,
  resolveDocumentPresentation, checkDocumentTemplateSchema } from '../document_presentation.js';
import { renderDocumentTemplateHeader, renderDocumentTemplateNote, renderDocumentTemplateFooter } from '../doc-utils.js';

const LABELS = { quotation: 'ใบเสนอราคา', delivery: 'ใบส่งสินค้า', receipt: 'ใบเสร็จรับเงิน' };

export function renderDocumentSettings(el, ctx, goBack) {
  const { state, showToast, saveStoreInfo } = ctx || {};
  const info = state?.storeInfo || {};
  let previewType = 'quotation';
  let saving = false;
  // A detached copy: typing/preview/back does not mutate storeInfo or storage.
  const initial = Object.fromEntries(Object.keys(LABELS).map(type => [type, createDocumentTemplateSnapshot(info, type)]));
  el.innerHTML = `
    <div class="set-subpage" id="documentSettings639">
      <style>
        #documentSettings639 .dt-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
        #documentSettings639 fieldset{min-width:0;margin:0;padding:0;border:0}
        #documentSettings639 label{display:block;margin:10px 0 5px}
        #documentSettings639 textarea,#documentSettings639 select{width:100%;box-sizing:border-box;max-width:100%}
        #documentSettings639 .dt-toggle{display:flex;align-items:center;gap:8px}
        #documentSettings639 .dt-toggle input{width:auto;margin:0;flex:0 0 auto}
        #documentSettings639 .dt-preview{background:white;color:#0f172a;border:1px solid #cbd5e1;padding:16px;border-radius:10px;overflow-wrap:anywhere;min-width:0}
        #documentSettings639 .dt-preview table{width:100%;border-collapse:collapse;margin:18px 0}
        #documentSettings639 .dt-preview td,#documentSettings639 .dt-preview th{border:1px solid #cbd5e1;padding:6px;text-align:left}
        #documentSettings639 .dt-preview .doc-title{font-size:22px;text-align:right}
        #documentSettings639 .dt-preview .doc-footer{margin-top:24px}
        #documentSettings639 .dt-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
        #documentSettings639 .dt-status{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}
        @media(max-width:760px){#documentSettings639 .dt-grid{grid-template-columns:minmax(0,1fr)}}
      </style>
      <div class="set-subpage-header"><button class="set-back-btn" id="setBackBtn">←</button>
        <h3 class="set-subpage-title">ปรับแต่งเอกสาร</h3></div>
      <p>ใช้กับเอกสารใหม่เท่านั้น ใบที่ออกแล้วเก็บรูปแบบเดิมไว้ การดูตัวอย่างไม่สร้างเอกสารหรือจองเลข</p>
      <div class="dt-grid">
        <fieldset id="docSettingsFields"><div class="set-form-card">
          <label for="docHeaderInput">ส่วนหัวเอกสาร (เช่น สโลแกนร้าน)</label>
          <textarea id="docHeaderInput" class="bank-input" maxlength="4000" rows="2">${escHtml(initial.quotation.header)}</textarea>
          <label for="docFooterInput">ส่วนท้ายเอกสาร</label>
          <textarea id="docFooterInput" class="bank-input" maxlength="4000" rows="2">${escHtml(initial.quotation.footer)}</textarea>
          ${Object.entries(LABELS).map(([type, label]) => `
            <section style="border-top:1px solid #e2e8f0;margin-top:16px;padding-top:8px">
              <h4>${label}</h4>
              <label for="docTitle_${type}">หัวเอกสาร</label>
              <select id="docTitle_${type}" class="bank-input">${DOCUMENT_TITLES[type].map(title => `<option value="${escHtml(title)}" ${initial[type].title === title ? 'selected' : ''}>${escHtml(title)}</option>`).join('')}</select>
              <label for="docNote_${type}">หมายเหตุ / เงื่อนไขสำหรับ${label}</label>
              <textarea id="docNote_${type}" class="bank-input" maxlength="4000" rows="3">${escHtml(initial[type].note)}</textarea>
              <label class="dt-toggle"><input id="docShow_${type}" type="checkbox" ${initial[type].show_note ? 'checked' : ''}> แสดงหมายเหตุใน${label}</label>
            </section>`).join('')}
        </div></fieldset>
        <div><strong>ตัวอย่างรูปแบบ — ไม่ใช่เอกสารจริง</strong>
          <div class="dt-tabs">${Object.entries(LABELS).map(([type,label])=>`<button class="btn light" data-doc-preview="${type}" type="button">${label}</button>`).join('')}</div>
          <div id="docSettingsPreview" class="dt-preview" aria-live="polite"></div>
          <p class="sku">ข้อมูลจำลองสำหรับตรวจข้อความ รูปแบบพิมพ์จริงใช้หน้าดูตัวอย่างของเอกสารแต่ละใบ</p>
        </div>
      </div>
      <div id="docSettingsStatus" class="dt-status" role="status"></div>
      <button id="saveDocSettingsBtn" class="set-save-btn">บันทึกสำหรับเอกสารใหม่</button>
    </div>`;
  const $ = id => el.querySelector(`#${id}`);
  const readDraft = () => ({
    ...(state?.storeInfo || {}),
    docHeader: $('docHeaderInput').value.trim(), docFooter: $('docFooterInput').value.trim(),
    // Preserve old docNote/docShowNote* fields: old clients keep their old defaults.
    docTemplatesV1: Object.fromEntries(Object.keys(LABELS).map(type => [type, {
      title: $(`docTitle_${type}`).value, note: $(`docNote_${type}`).value.trim(), showNote: $(`docShow_${type}`).checked,
    }])),
  });
  function preview() {
    const draft = readDraft();
    const snapshot = createDocumentTemplateSnapshot(draft, previewType);
    const si = resolveDocumentPresentation(draft, { document_template_snapshot: snapshot }, previewType);
    // Same escaped title/note/header/footer helpers as the three real renderers.
    $('docSettingsPreview').innerHTML = `<div class="doc-title">${escHtml(si.documentTitle)}</div>
      <p>ร้านตัวอย่าง · เลขที่: ตัวอย่างเท่านั้น</p>${renderDocumentTemplateHeader(si)}
      <p>ลูกค้า: ลูกค้าตัวอย่าง</p>
      <table><thead><tr><th>รายการสินค้า / บริการ</th><th>จำนวน</th><th>ยอดรวม</th></tr></thead>
      <tbody><tr><td>สินค้าตัวอย่าง</td><td>1</td><td>100.00</td></tr></tbody></table>
      <p style="text-align:right">จำนวนเงินรวมทั้งสิ้น 100.00 บาท</p>
      ${renderDocumentTemplateNote(si, { documentType: previewType })}${renderDocumentTemplateFooter(si)}`;
    el.querySelectorAll('[data-doc-preview]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.docPreview === previewType)));
  }
  $('docSettingsFields').addEventListener('input', preview);
  $('docSettingsFields').addEventListener('change', preview);
  el.querySelectorAll('[data-doc-preview]').forEach(button => button.addEventListener('click', () => {
    previewType = button.dataset.docPreview; preview();
  }));
  $('setBackBtn').addEventListener('click', () => { if (!saving) goBack?.(); });
  $('saveDocSettingsBtn').addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    const draft = readDraft();
    $('docSettingsFields').disabled = true;
    $('saveDocSettingsBtn').disabled = true;
    $('setBackBtn').disabled = true;
    $('docSettingsStatus').textContent = 'กำลังตรวจความพร้อมและบันทึก...';
    let beforeSave;
    try {
      await checkDocumentTemplateSchema();
      if (typeof saveStoreInfo !== 'function') throw new Error('ไม่พร้อมบันทึกการตั้งค่า กรุณาเปิดหน้านี้ใหม่');
      beforeSave = state?.storeInfo;
      const result = await saveStoreInfo(draft);
      if (result?.ok !== true) throw new Error(result?.error || 'บันทึกไม่สำเร็จ');
      if (state) state.storeInfo = draft;
      const message = result.cloudSynced === true
        ? 'บันทึกสำหรับเอกสารใหม่แล้ว ✅ ใบเดิมไม่เปลี่ยน'
        : 'บันทึกเฉพาะเครื่องนี้แล้ว ⚠️ ยังไม่ซิงก์ไปเครื่องอื่น กรุณาตรวจการเชื่อมต่อแล้วบันทึกอีกครั้ง';
      $('docSettingsStatus').textContent = message;
      showToast?.(message);
    } catch (error) {
      // The existing local-first writer merges state before localStorage. If
      // storage throws, undo only our own merge, never a later unrelated change.
      if (beforeSave && state?.storeInfo?.docTemplatesV1 === draft.docTemplatesV1) state.storeInfo = beforeSave;
      const message = `บันทึกไม่สำเร็จ: ${error.message}`;
      $('docSettingsStatus').textContent = message;
      showToast?.(message, 'error');
    } finally {
      saving = false;
      $('docSettingsFields').disabled = false;
      $('saveDocSettingsBtn').disabled = false;
      $('setBackBtn').disabled = false;
    }
  });
  preview();
}
