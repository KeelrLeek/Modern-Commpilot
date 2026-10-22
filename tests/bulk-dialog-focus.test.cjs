const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

for (const [name, route, launch] of [
  ['number-bulk', '/Group/GroupDnManagement/index.jsp', '#cp-bulk-number-launch'],
  ['number-activation-bulk', '/Group/DnActivation/', '#cp-bulk-activation-launch'],
  ['profile-bulk', '/Group/DeviceInventory/', '#cp-bulk-profile-launch']
]) test(`${name} keeps keyboard focus inside its dialog and releases it on close`, async () => {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', request => request.fulfill({ contentType: 'text/html', body:
      '<html><body><form name="leftNavForm"></form><table><tr><td width="82%"><form name="mainForm">' +
      '<input name="ok" type="button" value="OK"><input name="add" type="button" value="Add">' +
      '</form><button id="background">Background navigation</button></td></tr></table>' +
      '<script>window.redirectPost=function(){};</script></body></html>' }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot' + route);
    await page.addStyleTag({ path: path.join(runtime, 'src/content/number-bulk.css') });
    for (const script of ['pjax', name]) await page.addScriptTag({ path: path.join(runtime, `src/content/${script}.js`) });
    for (let cycle=0; cycle<2; cycle++) {
      await page.locator(launch).click();
      const inside = () => page.evaluate(() => document.querySelector('.cp-bulk-overlay')?.contains(document.activeElement));
      assert.equal(await inside(), true, 'opening the modal must leave background controls unfocused');
      for (const key of ['Tab', 'Shift+Tab']) for (let i=0;i<8;i++) {
        await page.keyboard.press(key);
        assert.equal(await inside(), true, `${key} must stay in the modal`);
      }
      await page.locator('#background').evaluate(node => node.focus());
      assert.equal(await inside(), true, 'a native focus change cannot focus a control behind the modal');
      await page.locator('[data-action="close"]').evaluate(node => { node.disabled=true; });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.cp-bulk-overlay').count(), 1, 'Escape honors a disabled Close button');
      await page.locator('[data-action="close"]').evaluate(node => { node.disabled=false; });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.cp-bulk-overlay').count(), 0);
      assert.equal(await page.locator(launch).evaluate(node => document.activeElement === node), true);
      await page.locator('#background').focus();
      assert.equal(await page.locator('#background').evaluate(node => document.activeElement === node), true, 'closed modal leaves no focus listener');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
