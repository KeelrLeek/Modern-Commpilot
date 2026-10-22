const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
for (const [name, list, launch] of [
  ['number-bulk', '/Group/GroupDnManagement/index.jsp', '#cp-bulk-number-launch'],
  ['number-activation-bulk', '/Group/DnActivation/', '#cp-bulk-activation-launch'],
  ['profile-bulk', '/Group/DeviceInventory/', '#cp-bulk-profile-launch']
]) test(`${name} keeps browser Back from changing the group under its open dialog`, async () => {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const requests = [];
    await page.route('**/*', request => {
      if (request.request().method() === 'POST') requests.push(request.request().url());
      return request.fulfill({ contentType: 'text/html', body:
        '<html><body><form name="leftNavForm"></form><input name="formtokenserial" value="fixture-token">' +
        '<table><tr><td width="82%"><form name="mainForm"><input name="ok" type="button" value="OK">' +
        '<input name="add" type="button" value="Add"></form></td></tr></table>' +
        '<script>window.redirectPost=function(){};</script></body></html>' });
    });
    const current = '/commpilot' + list;
    await page.goto('https://apps-sbx.avpaas.io' + current);
    await page.addStyleTag({ path: path.join(runtime, 'src/content/number-bulk.css') });
    for (const file of ['pjax', name]) await page.addScriptTag({ path: path.join(runtime, `src/content/${file}.js`) });
    await page.evaluate(current => {
      history.replaceState({ cpNav: { url: '/commpilot/ServiceProvider/Members/Modify/index.jsp',
        params: { key: 'FixtureOtherGroup' } } }, '', '/commpilot/ServiceProvider/Members/Modify/index.jsp');
      history.pushState({ cpNav: { url: current, params: {} }, marker: 'current-group' }, '', current);
      window.backSeen = 0;
      window.addEventListener('popstate', () => { window.backSeen++; }, true);
    }, current);
    await page.locator(launch).click();
    const before = requests.length;
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => window.backSeen > 0);
    await page.waitForTimeout(100);
    assert.equal(new URL(page.url()).pathname, current, 'Back must not switch the underlying group');
    assert.equal(requests.length, before, 'no other-group POST may run behind the bulk dialog');
    assert.equal(await page.evaluate(() => history.state.marker), 'current-group');
    assert.equal(await page.locator('.cp-bulk-overlay').count(), 1);
    await page.evaluate(current => {
      history.replaceState({ marker: 'native-preview', cpNav: { url: current, params: {} } }, '', current + '?preview=1');
      document.dispatchEvent(new Event('cp:reskin'));
      history.back();
    }, current);
    await page.waitForFunction(() => window.backSeen > 1);
    assert.equal(await page.evaluate(() => history.state.marker), 'native-preview', 'internal native navigation updates the held location');
    assert.equal(new URL(page.url()).search, '?preview=1');
    assert.equal(requests.length, before);
    await page.locator('[data-action="close"]').click();
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => window.backSeen > 2);
    await page.waitForFunction(() => location.pathname === '/commpilot/ServiceProvider/Members/Modify/index.jsp');
  } finally { await browser.close(); }
});
