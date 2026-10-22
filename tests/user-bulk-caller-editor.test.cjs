const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture, R } = require('./fixtures/bulk-group-harness.cjs');

for (const state of ['disabled', 'readonly', 'editable']) test(`bulk caller ID editor respects native ${state} state`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(6000);
    const server = await fixture(page);
    page.on('pageerror', error => errors.push(error.message));
    // Preserve the real transport and engine; change the native form's supported state.
    await page.evaluate(({ state, add }) => {
      const acquire = window.cpAcquireUserBulk;
      window.cpAcquireUserBulk = async (...args) => {
        const lease = await acquire(...args), navigate = lease.navigate;
        lease.navigate = async (...args) => {
          const result = await navigate(...args);
          if (args[0] === add) {
            const caller = document.forms.mainForm.elements.namedItem('clidPhone');
            caller.disabled = state === 'disabled'; caller.readOnly = state === 'readonly';
          }
          return result;
        };
        return lease;
      };
    }, { state, add: R.add });
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=prefix]').fill('AZ');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=numberMode]').selectOption('none');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-action=options]').click();
    const input = page.locator('.subdialog [data-field=caller]');
    assert.equal(await input.isEditable(), state === 'editable', 'the editor must not offer a PBX-controlled override');
    if (state === 'editable') {
      await input.fill('3125550110');
      await page.locator('.subdialog [data-action=dismiss]').last().click();
      await page.locator('[data-action=options]').click();
      assert.equal(await input.inputValue(), '3125550110', 'a permitted override survives closing and reopening');
    } else {
      assert.equal(await input.inputValue(), '3125550100', 'the current PBX-controlled value remains visible');
      assert.match(await page.locator('.subdialog').innerText(), /controlled by the PBX/i);
    }
    assert.equal(server.writes.length, 0);
    assert.equal(server.badTokens, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
