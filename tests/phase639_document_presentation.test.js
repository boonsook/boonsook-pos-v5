import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocumentTemplateSnapshot as snapshot, resolveDocumentPresentation as resolve,
  isDocumentTemplateSnapshot as valid, checkDocumentTemplateSchema, DOCUMENT_TITLES } from '../modules/document_presentation.js';
import { renderDocumentTemplateHeader, renderDocumentTemplateNote, renderDocumentTemplateFooter } from '../modules/doc-utils.js';
import { withoutPhase639SnapshotInsertion } from './phase639_snapshot_delta.shared.js';

const oldInfo = Object.freeze({ name: 'Store', docHeader: ' Old header ', docFooter: 'Old footer', docNote: 'Old terms' });
const settings = Object.freeze({ docHeader: 'New header', docFooter: 'New footer', docTemplatesV1: Object.freeze({
  quotation: Object.freeze({ title: 'ใบประเมินราคา', note: 'QT terms', showNote: true }),
  delivery: Object.freeze({ title: 'ใบแจ้งหนี้', note: 'DI terms', showNote: false }),
  receipt: Object.freeze({ title: 'ใบเสร็จรับเงิน', note: 'RC terms', showNote: true }),
}) });

for (const type of Object.keys(DOCUMENT_TITLES)) {
  test('639: '+type+' old snapshot survives settings change, reload, preview/print helper reuse', () => {
    const frozen = Object.freeze(snapshot(oldInfo, type));
    const saved = Object.freeze({ id: 1, total_amount: 45500, grand_total: 40950, document_template_snapshot: frozen });
    const before = JSON.stringify(saved);
    const si = resolve(settings, JSON.parse(before), type);
    assert.equal(si.documentTitle, DOCUMENT_TITLES[type][0]);
    assert.equal(si.docHeader, 'Old header');
    assert.equal(si.docNote, 'Old terms');
    assert.match(renderDocumentTemplateHeader(si), /Old header/);
    assert.match(renderDocumentTemplateNote(si, { documentType: type }), /Old terms/);
    assert.match(renderDocumentTemplateFooter(si), /Old footer/);
    assert.equal(JSON.stringify(saved), before);
  });
  test('639: '+type+' new document uses own defaults, detached and persisted as plain JSON', () => {
    const s = snapshot(settings, type);
    assert.equal(valid(s,type), true);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    assert.equal(s.title, settings.docTemplatesV1[type].title);
    assert.equal(s.note, settings.docTemplatesV1[type].note);
    assert.equal(s.show_note, settings.docTemplatesV1[type].showNote);
    s.note = 'local edit';
    assert.notEqual(settings.docTemplatesV1[type].note, s.note);
    assert.deepEqual(Object.keys(s).sort(), ['document_type','footer','header','note','show_note','title','version']);
  });
  test('639: '+type+' rejects missing/corrupt snapshots after activation', () => {
    const good = snapshot(settings,type);
    for (const s of [null, undefined, [], {}, { ...good,version:2 }, { ...good,show_note:'false' },
      { ...good,title:'' }, { ...good,title:'   ' }, { ...good,title:123 }, { ...good,title:'x'.repeat(201) },
      { ...good,note:'x'.repeat(4001) }, { ...good,header:null },
      { ...good, document_type:'unknown' }]) {
      assert.equal(valid(s,type), false);
      assert.throws(() => resolve(settings,{ document_template_snapshot:s },type), /รูปแบบเอกสาร/);
    }
    assert.equal(resolve(oldInfo,{},type).documentTitle,DOCUMENT_TITLES[type][0], 'pre-migration compatibility only');
    assert.throws(() => resolve(oldInfo,{ document_template_snapshot:null },type), /รูปแบบเอกสาร/);
  });
}
test('639: historical titles survive removal from current choices; writer stays allowlisted', () => {
  for (const type of Object.keys(DOCUMENT_TITLES)) {
    const title='ชื่อเอกสารที่เคยอนุญาต <img src=x onerror=alert(1)>';
    const old=Object.freeze({...snapshot(oldInfo,type),title});
    assert.equal(valid(old,type),true);
    assert.equal(resolve(settings,{document_template_snapshot:old},type).documentTitle,title);
    assert.equal(snapshot({docTemplatesV1:{[type]:{title}}},type).title,DOCUMENT_TITLES[type][0]);
  }
  assert.equal(valid({...snapshot(oldInfo,'quotation'),title:'x'.repeat(200)},'quotation'),true);
  assert.equal(valid({...snapshot(oldInfo,'quotation'),document_type:'unknown'},'unknown'),false);
});
test('639: malicious note/header/footer are escaped by actual shared render helpers', () => {
  const malicious = '<img src=x onerror=alert(1)> & "';
  const info = { docHeader:malicious,docFooter:malicious,docNote:malicious };
  const si = resolve({}, { document_template_snapshot:snapshot(info,'quotation') }, 'quotation');
  for (const html of [renderDocumentTemplateHeader(si), renderDocumentTemplateFooter(si),
    renderDocumentTemplateNote(si,{ documentType:'quotation' })]) {
    assert.ok(html.includes('&lt;img'));
    assert.ok(!html.includes('<img'));
  }
});
test('639: all legacy visibility flags migrate independently and explicit empty terms stay empty', () => {
  const info = { ...oldInfo,docShowNoteQuotation:false,docShowNoteDelivery:true,docShowNoteReceipt:false };
  assert.equal(snapshot(info,'quotation').show_note,false);
  assert.equal(snapshot(info,'delivery').show_note,true);
  assert.equal(snapshot(info,'receipt').show_note,false);
  assert.equal(snapshot({ ...info,docTemplatesV1:{ quotation:{ note:'' } } },'quotation').note,'');
});
test('639: schema readiness is GET-only, checks all three tables and fails closed', async () => {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.window = { SUPABASE_CONFIG:{ url:'https://fixture.invalid',anonKey:'synthetic' },_sbAccessToken:'synthetic-auth' };
  try {
    globalThis.fetch = async (url,options) => { calls.push([url,options]); return { ok:true,json:async()=>[] }; };
    await checkDocumentTemplateSchema();
    assert.equal(calls.length,3);
    for (const [i,table] of ['quotations','delivery_invoices','receipts'].entries()) {
      assert.equal(calls[i][0], 'https://fixture.invalid/rest/v1/'+table+'?select=document_template_snapshot&limit=0');
      assert.equal(calls[i][1].method,undefined);
      assert.equal(calls[i][1].body,undefined);
      assert.equal(calls[i][1].headers.Authorization,'Bearer synthetic-auth');
    }
    for (const response of [{ ok:false,json:async()=>[] },{ ok:true,json:async()=>({}) }]) {
      globalThis.fetch=async()=>response;
      await assert.rejects(checkDocumentTemplateSchema(),/SQL/);
    }
    globalThis.fetch=async()=>{ throw new Error('offline'); };
    await assert.rejects(checkDocumentTemplateSchema(),/offline/);
  } finally {
    if(oldWindow===undefined) delete globalThis.window; else globalThis.window=oldWindow;
    globalThis.fetch=oldFetch;
  }
});
test('639: financial pin exception rejects missing/duplicate/changed snapshot insertion', () => {
  const src=readFileSync(new URL('../modules/quotations.js',import.meta.url),'utf8');
  assert.throws(()=>withoutPhase639SnapshotInsertion('no insertion','saveQuotationFull'));
  assert.throws(()=>withoutPhase639SnapshotInsertion(src+src,'saveQuotationFull'));
  assert.throws(()=>withoutPhase639SnapshotInsertion(src.replace("if (!_editingId) payload.document_template_snapshot", "payload.document_template_snapshot"),'saveQuotationFull'));
});
