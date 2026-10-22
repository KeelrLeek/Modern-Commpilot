const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture, R } = require('./fixtures/bulk-group-harness.cjs');

async function setup(guard, check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), state = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const info = await page.evaluate(async ({ guard, routes }) => {
      const lease = await cpAcquireUserBulk(), navigate = lease.navigate;
      lease.navigate = async (url, params) => {
        const result = await navigate(url, params), form = document.forms.mainForm;
        if (url === routes.add) {
          if (guard === 'caller-fieldset') {
            const input = form.elements.namedItem('clidPhone'), group = document.createElement('fieldset');
            group.disabled = true; input.before(group); group.appendChild(input);
          }
          if (guard === 'domain' || guard === 'department') {
            const select = form.elements.namedItem(guard === 'domain' ? 'domain' : 'deptEncodedKey');
            const group = document.createElement('optgroup'); group.label = 'Unavailable'; group.disabled = true;
            group.appendChild(new Option(guard === 'domain' ? 'unavailable.example.test' : 'Unavailable department', 'unavailable'));
            select.appendChild(group);
          }
        }
        if (url === routes.deviceAdd && guard === 'device-type') {
          const select = form.elements.namedItem('deviceType');
          const option = [...select.options].find(option => option.value === 'Connect - Mobile (System)');
          const group = document.createElement('optgroup'); group.label = 'Unavailable'; group.disabled = true;
          option.before(group); group.appendChild(option);
        }
        return result;
      };
      window.engine = cpCreateBulkEngine(lease);
      window.groupInfo = await engine.initialize();
      return groupInfo;
    }, { guard, routes: R });
    await check(page, state, info);
    assert.equal(state.badTokens, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

for (const guard of ['domain', 'department', 'device-type']) {
  test(`group setup excludes disabled optgroup choices: ${guard}`, () => setup(guard, async (page, state, info) => {
    const choices = guard === 'domain' ? info.domains : guard === 'department' ? info.departments.map(d => d.name) : info.deviceTypes;
    const unavailable = guard === 'domain' ? 'unavailable' : guard === 'department' ? 'Unavailable department' : 'Connect - Mobile (System)';
    assert.equal(choices.includes(unavailable), false, 'the setup does not offer an unavailable native choice');
    assert.ok(choices.length > 0, 'enabled native choices remain available');
    assert.equal(state.writes.length, 0);
  }));
}

test('group setup identifies caller ID locked by a native fieldset', () => setup('caller-fieldset', async (page, state, info) => {
  assert.equal(info.caller.locked, true);
  assert.equal(info.caller.value, '3125550100');
  assert.equal(state.writes.length, 0);
}));

for (const guard of ['caller-fieldset', 'normal']) {
  test(`group caller-ID metadata and creation respect the native field: ${guard}`, () => setup(guard, async (page, state, info) => {
    await page.evaluate(async () => {
      const config = { ...CpBulkModel.initial(groupInfo), prefix: 'AZ', prefixChosen: true,
        devicePrefix: 'AZ', primary: false, sca: [], voicemail: 'off' };
      const user = { first: 'Caller', last: 'Fixture', email: 'caller@example.test',
        dept: 'Operations', number: '3125550199', extension: '1234' };
      const credentials = { web: 'Easy1234', sip: { Operations: 'Sip-Test-A1' } };
      await engine.preflightGroup([user], config, credentials);
      await engine.stepGroup(user, 'user', credentials);
      window.savedCaller = user.savedCaller;
    });
    const writes = state.writes.filter(write => write.route === R.add);
    assert.equal(writes.length, 1);
    if (guard === 'caller-fieldset') {
      assert.equal(Object.hasOwn(writes[0].params, 'clidPhone'), false, 'the PBX-controlled caller ID is not overwritten');
      assert.equal(await page.evaluate(() => savedCaller), '3125550100');
    } else assert.equal(writes[0].params.clidPhone, '+13125550199');
  }));
}
