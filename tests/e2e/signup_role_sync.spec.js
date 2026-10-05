import { test, expect } from '@playwright/test';
for(const width of [390,1280])test('Sync rejects unknown role without writes '+width,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='127.0.0.1')return route.abort();
    return route.continue();
  });
  await page.goto('/offline.html');
  await page.evaluate(async()=>{
    const {renderSettingsUsers}=await import('/modules/settings/users.js');
    document.body.innerHTML='<main id="fixture"></main><p id="result"></p>';
    window.SUPABASE_CONFIG={url:'https://synthetic.invalid',anonKey:'fixture'};
    window._sbAccessToken='fixture';window.fixtureWrites=0;
    window.fetch=async(_url,init={})=>{if(init.method)window.fixtureWrites++;return {ok:true,json:async()=>[{id:'synthetic',role:null}]};};
    renderSettingsUsers(document.querySelector('#fixture'),{state:{allProfiles:[]},ROLE_LABELS:{},showToast:m=>document.querySelector('#result').textContent=m},()=>{});
  });
  await page.getByRole('button',{name:'🔄 Sync ผู้ใช้'}).click();
  await expect(page.locator('#result')).toContainText('Sync ไม่สำเร็จ');
  expect(await page.evaluate(()=>window.fixtureWrites)).toBe(0);
  await expect(page.getByRole('button',{name:'🔄 Sync ผู้ใช้'})).toBeEnabled();
});

for (const width of [390, 1280]) {
  for (const outcome of ['collision', 'insert', 'denied', 'lost', 'mixed']) {
    test(`Sync ${outcome} preserves roles and reports only confirmed writes ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort());
      await page.goto('/offline.html');
      await page.evaluate(async outcome => {
        const { renderSettingsUsers } = await import('/modules/settings/users.js');
        document.body.innerHTML = '<main id="fixture"></main><p id="result"></p>';
        window.SUPABASE_CONFIG = { url: 'https://synthetic.invalid', anonKey: 'fixture' };
        window._sbAccessToken = 'fixture';
        const current = { id: 'existing', role: 'accountant', full_name: 'Current name' };
        const stale = { id: 'existing', role: 'admin', full_name: 'Old name' };
        const fresh = { id: 'new', role: 'admin', full_name: 'New name' };
        const rows = outcome === 'collision' ? [stale] : outcome === 'mixed' ? [fresh, stale] : [fresh];
        window.syncFixture = { records: { existing: current }, writes: [], reloads: 0 };
        window.App = { loadAllData: async () => { window.syncFixture.reloads++; }, showRoute: () => {} };
        window.fetch = async (_url, init = {}) => {
          if (!init.method) return { ok: true, json: async () => rows };
          const row = JSON.parse(init.body);
          window.syncFixture.writes.push({ row, prefer: init.headers.Prefer });
          if (outcome === 'denied') return { ok: false };
          const exists = !!window.syncFixture.records[row.id];
          // Model conflict behavior, so switching back to merge-duplicates loses the current role/name.
          const ignored = exists && init.headers.Prefer.includes('resolution=ignore-duplicates');
          if (!ignored) window.syncFixture.records[row.id] = row;
          if (outcome === 'lost') throw new Error('write applied but response lost');
          return { ok: true, json: async () => ignored ? [] : [row] };
        };
        renderSettingsUsers(document.querySelector('#fixture'), {
          state: { allProfiles: [] }, ROLE_LABELS: {},
          showToast: message => { document.querySelector('#result').textContent = message; },
        }, () => {});
      }, outcome);
      await page.getByRole('button', { name: '🔄 Sync ผู้ใช้' }).click();
      await expect(page.getByRole('button', { name: '🔄 Sync ผู้ใช้' })).toBeEnabled();
      const result = await page.evaluate(() => window.syncFixture);
      expect(result.records.existing).toEqual({ id: 'existing', role: 'accountant', full_name: 'Current name' });
      expect(result.writes).toHaveLength(outcome === 'mixed' ? 2 : 1);
      expect(result.writes.every(write => write.row.role === 'customer')).toBe(true);
      expect(result.reloads).toBe(1);
      if (outcome === 'insert') {
        expect(result.records.new.role).toBe('customer');
        await expect(page.locator('#result')).toContainText('✓ เพิ่มโปรไฟล์ลูกค้า 1');
      } else {
        await expect(page.locator('#result')).toContainText('ยืนยันไม่ได้');
        await expect(page.locator('#result')).not.toContainText('✓');
        if (outcome === 'denied') expect(result.records.new).toBeUndefined();
        if (outcome === 'lost' || outcome === 'mixed') expect(result.records.new.role).toBe('customer');
        if (outcome === 'mixed') await expect(page.locator('#result')).toContainText('เพิ่มโปรไฟล์ลูกค้า 1');
      }
    });
  }
}
