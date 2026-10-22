const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture, R } = require('./fixtures/bulk-group-harness.cjs');

test('bulk page validators are refreshed without retaining a script node for every visit', async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), state = await fixture(page, { nativeHeadValidators: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const initialScripts = await page.locator('head script').count();
    await page.evaluate(async () => { window.fixtureLease = await cpAcquireUserBulk(); });
    for (let pass = 0; pass < 4; pass++) {
      for (const target of [R.extension, R.password, R.passcode, R.deviceAdd, R.users]) {
        const result = await page.evaluate(async target => {
          await fixtureLease.navigate(target);
          return { marker: nativePageMarker, valid: validateForm(document.forms.mainForm),
            scripts: document.head.querySelectorAll('script').length };
        }, target);
        assert.equal(result.marker, target, 'each page restores its own native globals');
        assert.equal(result.valid, true);
        assert.ok(result.scripts <= initialScripts,
          `native head scripts grew from ${initialScripts} to ${result.scripts} on ${target}`);
      }
    }
    await page.evaluate(() => fixtureLease.release());
    assert.equal(state.writes.length, 0, 'this exercise only reads fixture pages');
    assert.equal(state.badTokens, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
