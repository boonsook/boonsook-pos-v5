import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) {
  for (const scenario of ['auth-only', 'stale', '403', 'bad-json', 'slow', 'timeout', 'partial', 'non-admin']) {
    test('read-only profile refresh ' + scenario + ' at ' + width, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
        ? route.continue() : route.abort());
      await page.goto('/offline.html');
      await page.evaluate(async scenario => {
        const { renderSettingsUsers } = await import('/modules/settings/users.js');
        document.body.innerHTML = '<main id="fixture"></main><p id="result"></p>';
        window.SUPABASE_CONFIG = { url: 'https://synthetic.invalid', anonKey: 'fixture' };
        window._sbAccessToken = 'fixture';
        const profiles = scenario === 'auth-only' ? [] : [
          { id: 'profile-1', role: 'accountant', full_name: 'ชื่อใหม่' },
          { id: 'profile-2', role: 'technician', full_name: 'อีกโปรไฟล์' }
        ];
        const auth = [{ id: 'auth-only' }, { id: 'profile-1' }, { id: 'profile-2' }];
        const state = { allProfiles: scenario === 'auth-only' ? [] : [
          { id: 'profile-1', role: 'sales', full_name: 'ชื่อเดิม' }
        ] };
        window.refreshFixture = { state, profiles, before: JSON.stringify(profiles), requests: [], globalLoads: 0 };
        window.App = { loadAllData: async () => { window.refreshFixture.globalLoads++; }, showRoute: () => {} };
        window.fetch = async (url, init = {}) => {
          window.refreshFixture.requests.push({ url, method: init.method || 'GET' });
          if (scenario === 'slow' || scenario === 'timeout') {
            await new Promise((resolve, reject) => {
              window.releaseRefresh = resolve;
              init.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
            });
          }
          return { ok: scenario !== '403', status: scenario === 'partial' ? 206 : scenario === '403' ? 403 : 200,
            json: async () => {
              if (scenario === 'bad-json') throw new SyntaxError('invalid JSON');
              // Actual view: profiles LEFT JOIN auth.users, never an auth-only row.
              const readable = scenario === 'partial' ? profiles.slice(0, 1) : profiles;
              return readable.map(profile => ({ ...profile,
                email: auth.some(user => user.id === profile.id) ? 'fixture@example.invalid' : null }));
            }
          };
        };
        renderSettingsUsers(document.querySelector('#fixture'), {
          state, ROLE_LABELS: { sales: 'ฝ่ายขาย', accountant: 'บัญชี', technician: 'ช่าง' },
          requireAdmin: () => scenario !== 'non-admin',
          showToast: message => { document.querySelector('#result').textContent = message; },
        }, () => {});
      }, scenario);
      if (scenario === 'timeout') await page.clock.install();
      await expect(page.locator('#syncUsersBtn')).toHaveText('🔄 รีเฟรชรายชื่อ');
      await page.locator('#syncUsersBtn').click();
      if (scenario === 'slow' || scenario === 'timeout') {
        await expect(page.locator('#syncUsersBtn')).toBeDisabled();
        await expect(page.locator('.usr-name').first()).toHaveText('ชื่อเดิม');
        await expect(page.locator('#result')).toBeEmpty();
        if (scenario === 'slow') await page.evaluate(() => window.releaseRefresh());
        else await page.clock.runFor(15001);
      }
      await expect(page.locator('#syncUsersBtn')).toBeEnabled();
      const result = await page.evaluate(() => window.refreshFixture);
      expect(result.requests.filter(request => !['GET', 'HEAD'].includes(request.method))).toEqual([]);
      expect(result.requests).toHaveLength(scenario === 'non-admin' ? 0 : 1);
      expect(JSON.stringify(result.profiles)).toBe(result.before);
      expect(result.globalLoads).toBe(0);
      expect(result.state.allProfiles.some(profile => profile.id === 'auth-only')).toBe(false);
      const message = await page.locator('#result').textContent();
      expect(message).not.toMatch(/ครบแล้ว|ไม่มีตกหล่น|กู้|สร้าง|เพิ่มโปรไฟล์/);
      if (['403', 'bad-json', 'timeout', 'non-admin'].includes(scenario)) {
        await expect(page.locator('.usr-name').first()).toHaveText('ชื่อเดิม');
        expect(result.state.allProfiles[0].role).toBe('sales');
        expect(message).not.toContain('✓');
        if (scenario !== 'non-admin') expect(message).toContain('ไม่สำเร็จ');
      } else {
        expect(message).toContain('ที่อ่านได้');
        if (scenario === 'auth-only') {
          expect(result.state.allProfiles).toEqual([]);
          await expect(page.locator('#fixture')).toContainText('ไม่พบโปรไฟล์พนักงานในรายการที่อ่านได้');
        } else {
          await expect(page.locator('.usr-name').first()).toHaveText('ชื่อใหม่');
          await expect(page.locator('.usr-role').first()).toHaveText('บัญชี');
          expect(result.state.allProfiles).toHaveLength(scenario === 'partial' ? 1 : 2);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
