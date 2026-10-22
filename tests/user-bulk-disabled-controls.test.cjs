const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture, R } = require('./fixtures/bulk-group-harness.cjs');

async function run(guard) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), state = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const address = guard.includes('option');
    await page.evaluate(async ({ guard, address, routes }) => {
      const lease = await cpAcquireUserBulk(), navigate = lease.navigate;
      window.bulkLease = lease;
      window.nativeGuardEnabled = false;
      lease.navigate = async (url, params) => {
        const result = await navigate(url, params);
        if (!nativeGuardEnabled) return result;
        const nativeForm = document.forms.mainForm;
        if (url === routes.auth && !address && guard !== 'normal') {
          const input = guard === 'save-fieldset' ? nativeForm.querySelector('[name="apply"]') :
            nativeForm.elements.namedItem(guard === 'password-fieldset' ? 'newPassword' : 'username');
          const fieldset = document.createElement('fieldset'); fieldset.disabled = true; input.before(fieldset);
          if (guard === 'first-legend') {
            const legend = document.createElement('legend'); fieldset.appendChild(legend); legend.appendChild(input);
          } else fieldset.appendChild(input);
        }
        if (url === routes.addresses && address) {
          const select = nativeForm.elements.namedItem('phoneNumber');
          const option = [...select.options].find(option => option.value === '3125550199');
          if (guard === 'disabled-option') option.disabled = true;
          else {
            const group = document.createElement('optgroup'); group.label = 'Unavailable'; group.disabled = true;
            option.before(group); group.appendChild(option);
          }
        }
        return result;
      };
      window.engine = cpCreateBulkEngine(lease);
      const info = await engine.initialize();
      const config = { ...CpBulkModel.initial(info), prefix: 'AZ', prefixChosen: true,
        devicePrefix: 'AZ', primary: false, sca: [], voicemail: 'off' };
      window.credentials = { web: 'Easy1234', sip: { Operations: 'Sip-Test-A1' } };
      window.user = { first: 'Guard', last: 'Fixture', email: 'guard@example.test',
        dept: 'Operations', extension: '1234', number: address ? '3125550199' : '' };
      await engine.preflightGroup([user], config, credentials);
      await engine.stepGroup(user, 'user', credentials);
      nativeGuardEnabled = true;
    }, { guard, address, routes: R });
    const before = state.writes.length;
    const error = await page.evaluate(async key => {
      try { await engine.stepGroup(user, key, credentials); return ''; }
      catch (error) { return error.message; }
    }, address ? 'addresses' : 'auth');
    if (['normal', 'first-legend'].includes(guard)) {
      assert.equal(error, '');
      assert.equal(state.writes.length - before, 1, 'enabled native controls still save once');
      assert.equal(state.users.get('AZ1234').auth, 'AZ1234');
    } else {
      assert.ok(error, 'locked controls must stop the step');
      assert.equal(state.writes.length, before, 'no save is sent after trying to change a disabled native control');
      assert.match(error, /locked|unavailable/i);
      assert.equal(await page.evaluate(() => bulkLease.needsRecovery), false, 'a locked field does not damage the navigation lease');
    }
    assert.equal(state.badTokens, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

for (const guard of ['username-fieldset', 'password-fieldset', 'save-fieldset', 'disabled-option', 'disabled-optgroup', 'first-legend', 'normal'])
  test(`bulk provisioning honors native disabled controls: ${guard}`, () => run(guard));
