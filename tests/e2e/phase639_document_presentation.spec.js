// Synthetic localhost fixture only: no Supabase config, customer data or real writes.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test.use({ serviceWorkers: 'block' });
const FIXTURE = '/__phase639__/fixture.html';
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/doc-print.css"></head><body>'
  + '<div id="settings"></div><div id="page-quotations"></div><div id="page-delivery_invoices"></div><div id="page-receipts"></div></body></html>';
const docs = [
  ['quotation','qt','renderQuotationsPage','quotations','QT-639','ใบเสนอราคา',1],
  ['delivery','di','renderDeliveryInvoicesPage','deliveryInvoices','INV-639','ใบแจ้งหนี้',2],
  ['receipt','rc','renderReceiptsPage','receipts','RC-639','ใบเสร็จรับเงิน',2],
];
function install() {
  const clone = value => JSON.parse(JSON.stringify(value));
  window.__writes=[]; window.__reads=[]; window.__settingsWrites=[]; window.__toasts=[];
  window.__schemaOK=true; window.__saveMode='success';
  window.__rows=[{ item_type:'item',product_id:null,item_name:'Synthetic item',qty:1,unit:'ชิ้น',unit_price:45500,discount_pct:10,line_total:40950,sort_order:1 }];
  const common={ status:'pending',customer_name:'Synthetic customer',created_at:'2026-09-28T00:00:00Z',
    total_amount:40950,grand_total:40950,amount:40950,after_discount:40950,discount_pct:0,discount_amount:0,withholding_tax:false,payment_terms:'เงินสด' };
  const snap=(kind,title)=>({ version:1,document_type:kind,title,header:'FROZEN HEADER',footer:'FROZEN FOOTER',note:'FROZEN '+kind,show_note:true });
  const qt={ ...common,id:63901,qt_no:'QT-639',document_template_snapshot:snap('quotation','ใบเสนอราคา') };
  const di={ ...common,id:63902,inv_no:'INV-639',quotation_id:qt.id,document_template_snapshot:snap('delivery','ใบแจ้งหนี้') };
  const rc={ ...common,id:63903,receipt_no:'RC-639',delivery_invoice_id:di.id,document_template_snapshot:snap('receipt','ใบเสร็จรับเงิน') };
  const state={ profile:{ role:'admin',full_name:'Synthetic' },customers:[],products:[],paymentInfo:{ banks:[] },
    quotations:[qt],deliveryInvoices:[di],receipts:[rc],storeInfo:{ name:'ร้านจำลอง',docHeader:'CURRENT HEADER',docFooter:'CURRENT FOOTER',docNote:'legacy terms',
      docTemplatesV1:{ quotation:{ title:'ใบประเมินราคา',note:'CURRENT QT',showNote:true },
        delivery:{ title:'ใบแจ้งหนี้',note:'CURRENT DI',showNote:true },receipt:{ title:'ใบเสร็จรับเงิน',note:'CURRENT RC',showNote:true } } } };
  window.__ctx={ state,money:String,showToast:m=>window.__toasts.push(m),showRoute:()=>{},loadAllData:async()=>{},
    saveStoreInfo:async draft=>{
      window.__settingsWrites.push(clone(draft));
      if(window.__saveMode==='deferred') await new Promise(resolve=>{ window.__releaseSave=resolve; });
      if(window.__saveMode==='reject') return { ok:false,error:'rejected' };
      if(window.__saveMode==='quota') { state.storeInfo={ ...state.storeInfo,...draft }; throw new Error('QuotaExceededError'); }
      localStorage.setItem('synthetic-settings',JSON.stringify(draft));
      state.storeInfo=clone(draft);
      return { ok:true,cloudSynced:window.__saveMode!=='local' };
    } };
  window.SUPABASE_CONFIG={ url:'https://fixture.invalid',anonKey:'synthetic' }; window._sbAccessToken='synthetic';
  window.fetch=async(url,init={})=>{
    window.__reads.push({ url:String(url),method:init.method||'GET' });
    if(init.method && init.method!=='GET') throw new Error('fetch writes forbidden');
    if(String(url).includes('select=document_template_snapshot')) return { ok:window.__schemaOK,json:async()=>[] };
    if(/_items\?/.test(String(url))) return { ok:true,json:async()=>clone(window.__rows) };
    if(String(url).includes('/receipts?select=')) return { ok:true,json:async()=>clone(state.receipts) };
    return { ok:true,json:async()=>[] };
  };
  for(const [method,name] of [['POST','Post'],['PATCH','Patch'],['DELETE','Delete'],['PUT','Put']]) window['_appXhr'+name]=async(table,payload,...rest)=>{
    window.__writes.push({ method,table,payload:clone(payload),rest:clone(rest) });
    return { ok:true,data:{ id:63999,qt_no:'QT-NEW-639',inv_no:'INV-NEW-639',receipt_no:'RC-NEW-639' } };
  };
  window.XMLHttpRequest=class { open(){ throw new Error('Raw XHR forbidden'); } };
  window.WebSocket=class { constructor(){ throw new Error('Socket forbidden'); } };
  window._appGetLogo=()=>''; window.print=()=>{};
  window.App={ state,showToast:window.__ctx.showToast,confirm:async()=>true };
  window.__baseline=JSON.stringify([state.quotations,state.deliveryInvoices,state.receipts]);
}
async function boot(page,context,width=390) {
  await page.setViewportSize({ width,height:844 });
  const origin=new URL(test.info().project.use.baseURL).origin;
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  // Explicit mutation mode: prove a hardcoded DI title makes this suite fail.
  // Overrides only the local browser response, never any runtime file on disk.
  if(process.env.PHASE639_MUTANT_DI==='1') {
    const src=readFileSync(new URL('../../modules/delivery_invoices.js',import.meta.url),'utf8');
    const anchor='<div class="doc-title inv">${escHtml(si.documentTitle)}</div>';
    expect(src.split(anchor)).toHaveLength(2);
    await page.route('**/modules/delivery_invoices.js',route=>route.fulfill({
      contentType:'text/javascript',body:src.replace(anchor,'<div class="doc-title inv">ใบส่งสินค้า/ใบแจ้งหนี้</div>'),
    }));
  }
  await page.route('**'+FIXTURE,route=>route.fulfill({ contentType:'text/html',body:HTML }));
  await page.addInitScript(install);
  await page.goto(FIXTURE);
  await page.evaluate(async()=>{
    window.__qt=await import('/modules/quotations.js'); window.__di=await import('/modules/delivery_invoices.js');
    window.__rc=await import('/modules/receipts.js'); window.__settings=await import('/modules/settings/document.js');
    await import('/modules/doc-override.js');
    window.__openSettings=()=>window.__settings.renderDocumentSettings(document.getElementById('settings'),window.__ctx,()=>{window.__wentBack=true;});
  });
}
async function openDoc(page,doc) {
  const [,kind,render,,number]=doc;
  await page.evaluate(({ kind,render })=>window['__'+kind][render](window.__ctx),{kind,render});
  await page.getByRole('link',{ name:number,exact:true }).click();
  await expect(page.locator('#'+kind+'DocPreview')).toBeVisible();
}
async function noDocumentWrites(page) {
  expect(await page.evaluate(()=>window.__writes)).toEqual([]);
  expect(await page.evaluate(()=>JSON.stringify([window.__ctx.state.quotations,window.__ctx.state.deliveryInvoices,window.__ctx.state.receipts])===window.__baseline)).toBe(true);
}
for(const width of [390,1280]) test('639 settings '+width+': draft preview/back no writes; escaped text; mobile fits',async({page,context},info)=>{
  await boot(page,context,width);
  await page.evaluate(()=>window.__openSettings());
  const before=await page.evaluate(()=>JSON.stringify(window.__ctx.state.storeInfo));
  await page.locator('#docTitle_quotation').selectOption('ใบประเมินราคา');
  await page.locator('#docNote_quotation').fill('<img src=x onerror="window.__xss=1"> terms\nsecond line');
  await expect(page.locator('#docSettingsPreview')).toContainText('<img src=x onerror="window.__xss=1"> terms');
  await expect(page.locator('#docSettingsPreview img')).toHaveCount(0);
  await page.locator('[data-doc-preview="delivery"]').click();
  await expect(page.locator('#docSettingsPreview .doc-title')).toHaveText('ใบแจ้งหนี้');
  await page.locator('#docShow_delivery').uncheck();
  await expect(page.locator('#docSettingsPreview')).not.toContainText('CURRENT DI');
  expect(await page.evaluate(()=>JSON.stringify(window.__ctx.state.storeInfo))).toBe(before);
  expect(await page.evaluate(()=>window.__settingsWrites)).toEqual([]);
  expect(await page.evaluate(()=>window.__reads)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({ path:info.outputPath('settings-'+width+'.png'),fullPage:true });
  await page.locator('#setBackBtn').click();
  expect(await page.evaluate(()=>window.__wentBack)).toBe(true);
  await noDocumentWrites(page);
});
for(const mode of ['success','local','reject','quota','schema']) test('639 settings save '+mode+': honest outcome and isolated data',async({page,context})=>{
  await boot(page,context);
  await page.evaluate(mode=>{ window.__openSettings(); window.__saveMode=mode; if(mode==='schema')window.__schemaOK=false; },mode);
  const before=await page.evaluate(()=>JSON.stringify(window.__ctx.state.storeInfo));
  await page.locator('#docNote_quotation').fill('NEW TERMS');
  await page.locator('#saveDocSettingsBtn').click();
  const status=page.locator('#docSettingsStatus');
  if(mode==='success'||mode==='local') {
    await expect(status).toContainText(mode==='success'?'บันทึกสำหรับเอกสารใหม่แล้ว':'บันทึกเฉพาะเครื่องนี้แล้ว');
    expect(await page.evaluate(()=>window.__ctx.state.storeInfo.docTemplatesV1.quotation.note)).toBe('NEW TERMS');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('synthetic-settings')).docTemplatesV1.quotation.note)).toBe('NEW TERMS');
    expect(await page.evaluate(()=>window.__reads.length)).toBe(3);
  } else {
    await expect(status).toContainText('บันทึกไม่สำเร็จ');
    expect(await page.evaluate(()=>JSON.stringify(window.__ctx.state.storeInfo))).toBe(before);
    expect(await page.evaluate(()=>localStorage.getItem('synthetic-settings'))).toBeNull();
    if(mode==='schema') expect(await page.evaluate(()=>window.__settingsWrites.length)).toBe(0);
  }
  await expect(page.locator('#saveDocSettingsBtn')).toBeEnabled();
  await noDocumentWrites(page);
});
test('639 settings saving locks duplicate clicks and preserves submitted values',async({page,context})=>{
  await boot(page,context);
  await page.evaluate(()=>{window.__openSettings();window.__saveMode='deferred';});
  await page.locator('#saveDocSettingsBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__settingsWrites.length)).toBe(1);
  await expect(page.locator('#docTitle_quotation')).toBeDisabled();
  await expect(page.locator('#setBackBtn')).toBeDisabled();
  await page.locator('#saveDocSettingsBtn').dispatchEvent('click');
  expect(await page.evaluate(()=>window.__settingsWrites.length)).toBe(1);
  await page.evaluate(()=>window.__releaseSave());
  await expect(page.locator('#saveDocSettingsBtn')).toBeEnabled();
});
for(const doc of docs) test('639 '+doc[0]+': frozen old title/terms after settings change in Preview/Print/PDF',async({page,context})=>{
  await boot(page,context);
  await openDoc(page,doc);
  const [type,kind,,,,title,copies]=doc;
  const check=async view=>{
    const root=view.locator('#'+kind+'DocPreview');
    await expect(root.locator('.doc-title')).toHaveCount(copies);
    for(const heading of await root.locator('.doc-title').all()) await expect(heading).toHaveText(title);
    await expect(root).toContainText('FROZEN HEADER');
    await expect(root).toContainText('FROZEN '+type);
    await expect(root).toContainText('FROZEN FOOTER');
    await expect(root).not.toContainText('CURRENT');
    for(const grand of await root.locator('.doc-total-row.grand').all()) await expect(grand).toContainText('40,950.00');
  };
  await check(page);
  for(const suffix of ['PrintBtn','PdfBtn']) {
    const promise=page.waitForEvent('popup'); await page.locator('#'+kind+suffix).click();
    const popup=await promise; await popup.waitForLoadState('domcontentloaded'); await check(popup); await popup.close();
  }
  await noDocumentWrites(page);
});
for(const doc of docs) test('639 '+doc[0]+': historical title outside current choices is escaped in Preview/Print/PDF',async({page,context})=>{
  await boot(page,context);
  const [,kind,,list]=doc;
  const title='ชื่อเดิม <img src=x onerror="window.__titleXss=1">';
  await page.evaluate(({list,title})=>{
    window.__ctx.state[list][0].document_template_snapshot.title=title;
    window.__baseline=JSON.stringify([window.__ctx.state.quotations,window.__ctx.state.deliveryInvoices,window.__ctx.state.receipts]);
  },{list,title});
  await openDoc(page,doc);
  const check=async view=>{
    const headings=view.locator('#'+kind+'DocPreview .doc-title');
    await expect(headings).toHaveCount(doc[6]);
    for(const heading of await headings.all()) {
      await expect(heading).toHaveText(title);
      await expect(heading.locator('img')).toHaveCount(0);
    }
    expect(await view.evaluate(()=>window.__titleXss)).toBeUndefined();
  };
  await check(page);
  for(const suffix of ['PrintBtn','PdfBtn']) {
    const promise=page.waitForEvent('popup');await page.locator('#'+kind+suffix).click();
    const popup=await promise;await popup.waitForLoadState('domcontentloaded');await check(popup);await popup.close();
  }
  await noDocumentWrites(page);
});
for(const doc of docs) test('639 '+doc[0]+': corrupt snapshot stops preview instead of adopting current defaults',async({page,context})=>{
  await boot(page,context);
  const [,kind,render,list,number]=doc;
  await page.evaluate(list=>window.__ctx.state[list][0].document_template_snapshot=null,list);
  await page.evaluate(({kind,render})=>window['__'+kind][render](window.__ctx),{kind,render});
  await page.getByRole('link',{name:number,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__toasts.join(' '))).toContain('รูปแบบเอกสารไม่ครบ');
  await expect(page.locator('#'+kind+'DocPreview')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__writes)).toEqual([]);
});
for(const [doc,button,target,type,title,terms] of [
  [docs[0],'qtConvertBtn','delivery_invoices','delivery','ใบแจ้งหนี้','CURRENT DI'],
  [docs[1],'diConvertReceiptBtn','receipts','receipt','ใบเสร็จรับเงิน','CURRENT RC'],
]) test('639 conversion '+type+': new target snapshot uses own settings; source stays frozen',async({page,context})=>{
  await boot(page,context);
  // Duplicate lookup must find no existing target; source stays available.
  await page.evaluate(target=>{ if(target==='receipts') window.__ctx.state.receipts=[]; },target);
  await openDoc(page,doc);
  await page.locator('#'+button).click();
  await expect.poll(()=>page.evaluate(target=>window.__writes.filter(w=>w.method==='POST'&&w.table===target).length,target)).toBe(1);
  const payload=await page.evaluate(target=>window.__writes.find(w=>w.method==='POST'&&w.table===target).payload,target);
  expect(payload.document_template_snapshot).toEqual({ version:1,document_type:type,title,header:'CURRENT HEADER',footer:'CURRENT FOOTER',note:terms,show_note:true });
  expect(payload.total_amount).toBe(40950); expect(payload.grand_total).toBe(40950);
  expect(await page.evaluate(list=>window.__ctx.state[list][0].document_template_snapshot.note,doc[3])).toBe('FROZEN '+doc[0]);
});
test('639 invalid template leaves unsaved QT fields and items intact',async({page,context})=>{
  await boot(page,context);
  await page.evaluate(()=>{ window.__ctx.state.storeInfo.docHeader='x'.repeat(4001);window.__qt.renderQuotationsPage(window.__ctx); });
  await page.locator('#qtAddBtn').click();
  await page.locator('#qt_customerSearch').fill('Keep this customer');
  await page.locator('#qtAddItemBtn').click();
  await page.locator('#qtAddCustomItem').click();
  await page.locator('.qt-li-name').fill('Keep this item');
  await page.locator('#qtPreviewBtn').click();
  await expect(page.locator('#qt_customerSearch')).toHaveValue('Keep this customer');
  await expect(page.locator('.qt-li-name')).toHaveValue('Keep this item');
  await expect.poll(()=>page.evaluate(()=>window.__toasts.join(' '))).toContain('รูปแบบเอกสารไม่ครบ');
  await expect(page.locator('#qtDocPreview')).toHaveCount(0);
  await noDocumentWrites(page);
});
test('639 new QT save includes snapshot; draft preview is write-free; edit PATCH omits snapshot',async({page,context})=>{
  await boot(page,context);
  await page.evaluate(()=>window.__qt.renderQuotationsPage(window.__ctx));
  await page.locator('#qtAddBtn').click();
  await page.locator('#qt_customerSearch').fill('Synthetic new customer');
  await page.locator('#qtAddItemBtn').click();
  await page.locator('#qtAddCustomItem').click();
  await page.locator('.qt-li-name').fill('Synthetic new item');
  await page.locator('.qt-li-price').fill('100');
  await page.locator('#qtPreviewBtn').click();
  await expect(page.locator('#qtDocPreview .doc-title')).toContainText('ใบประเมินราคา');
  await expect(page.locator('#qtDocPreview')).toContainText('CURRENT QT');
  expect(await page.evaluate(()=>window.__writes)).toEqual([]);
  await page.locator('#qtPreviewBack').click();
  await page.locator('#qtSaveBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__writes.filter(w=>w.method==='POST'&&w.table==='quotations').length)).toBe(1);
  expect(await page.evaluate(()=>window.__writes.find(w=>w.table==='quotations').payload.document_template_snapshot.note)).toBe('CURRENT QT');
  // Existing row edit: preserve its immutable snapshot instead of reapplying defaults.
  await page.getByRole('link',{name:'QT-639',exact:true}).click();
  await page.locator('#qtEditFromPreview').click();
  await page.locator('#qtSaveBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__writes.filter(w=>w.method==='PATCH'&&w.table==='quotations').length)).toBe(1);
  expect(await page.evaluate(()=>Object.hasOwn(window.__writes.find(w=>w.method==='PATCH'&&w.table==='quotations').payload,'document_template_snapshot'))).toBe(false);
});

// Phase 643: date visibility is a presentation choice, including both DI/RC copies.
// The effective print/PDF path is the capturing doc-override listener, not module-local handlers.
for (const theme of ['light','dark']) for (const width of [390,1280]) for (const doc of docs) {
  test(`643 ${doc[0]} ${theme} ${width}: readable preview and date choice in preview/print/PDF`,async({page,context})=>{
    await boot(page,context,width);
    await page.evaluate(theme=>{ document.documentElement.dataset.theme=theme; },theme);
    await openDoc(page,doc);
    const [,kind,,,,,copies]=doc;
    const preview=page.locator('#'+kind+'DocPreview');
    const dates=preview.locator(`[id="${kind}DateCell"]`);
    const toggle=page.locator('#'+kind+'ShowDate');
    await expect(dates).toHaveCount(copies);
    await expect(toggle).toBeChecked();

    const contrast=await page.evaluate(kind=>{
      const root=document.getElementById(kind+'DocPreview');
      const paper=getComputedStyle(root.querySelector('.doc-page')).backgroundColor;
      const cells=[...root.querySelectorAll('.doc-detail-table td:last-child, .doc-table tbody tr.doc-item-row td')];
      const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
      const luminance=s=>rgb(s).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      const bg=luminance(paper);
      return cells.map(cell=>{
        const fg=luminance(getComputedStyle(cell).color);
        return (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
      });
    },kind);
    expect(contrast.length).toBeGreaterThan(0);
    for(const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);

    for (const showDate of [true,false,true]) {
      if(showDate) await toggle.check(); else await toggle.uncheck();
      for(const cell of await dates.all()) {
        if(showDate) await expect(cell).toContainText(/28.*2569/);
        else await expect(cell).toHaveText(/^\.{10,}$/);
      }
      for(const suffix of ['PrintBtn','PdfBtn']) {
        const popupPromise=page.waitForEvent('popup');
        await page.locator('#'+kind+suffix).click();
        const popup=await popupPromise; await popup.waitForLoadState('domcontentloaded');
        const printedDates=popup.locator('#'+kind+'DocPreview [id="'+kind+'DateCell"]');
        await expect(printedDates).toHaveCount(copies);
        for(const cell of await printedDates.all()) {
          if(showDate) await expect(cell).toContainText(/28.*2569/);
          else await expect(cell).toHaveText(/^\.{10,}$/);
        }
        await popup.close();
      }
    }
    await noDocumentWrites(page);
  });
}

for (const doc of docs.filter(([,kind])=>kind!=='qt')) {
  test(`643 ${doc[0]}: existing date-edit control updates both copies without changing show/hide choice`,async({page,context})=>{
    await boot(page,context);
    const [,kind]=doc;
    if(kind==='di') await page.evaluate(()=>{
      // Synthetic DI without a linked receipt: the existing edit-date control is then available.
      window.__ctx.state.receipts[0].delivery_invoice_id=null;
      window.__baseline=JSON.stringify([window.__ctx.state.quotations,window.__ctx.state.deliveryInvoices,window.__ctx.state.receipts]);
    });
    await openDoc(page,doc);
    const dates=page.locator('#'+kind+'DocPreview [id="'+kind+'DateCell"]');
    const toggle=page.locator('#'+kind+'ShowDate');
    await toggle.uncheck();
    await page.locator('#'+kind+'EditDate').fill('2026-09-29');
    await expect.poll(()=>page.evaluate(()=>window.__writes.length)).toBe(1);
    for(const cell of await dates.all()) await expect(cell).toHaveText(/^\.{10,}$/);
    await toggle.check();
    for(const cell of await dates.all()) await expect(cell).toContainText(/29.*2569/);
    expect(await page.evaluate(()=>window.__writes.map(w=>w.method))).toEqual(['PATCH']);
  });
}
