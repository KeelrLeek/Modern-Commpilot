const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(name, route, check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), posts = [], errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', request => {
      if (request.request().method() === 'POST') posts.push(new URL(request.request().url()).pathname);
      return request.fulfill({ contentType: 'text/html', body:
        '<!doctype html><html><body><form name="leftNavForm"></form><input name="formtokenserial" value="fixture-token">' +
        '<table><tr><td width="82%"><form name="mainForm"><input name="ok" type="button" value="OK">' +
        '<input name="add" type="button" value="Add"></form></td></tr></table>' +
        '<script>window.redirectPost=function(){};</script></body></html>' });
    });
    await page.goto('https://apps-sbx.avpaas.io' + route);
    await page.addStyleTag({ path: path.join(runtime, 'src/content/number-bulk.css') });
    for (const file of ['pjax', ...(name ? [name] : [])])
      await page.addScriptTag({ path: path.join(runtime, `src/content/${file}.js`) });
    await check(page, posts);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function refreshAfterClose(page, posts, route) {
  const before = posts.length;
  const response = page.waitForResponse(response => response.request().method() === 'POST');
  await page.keyboard.press('F5');
  await response;
  assert.equal(posts.length, before + 1, 'closing the batch immediately restores one ordinary refresh');
  assert.equal(posts.at(-1), route);
}

for (const [name, route, launch] of [
  ['number-bulk', '/commpilot/Group/GroupDnManagement/index.jsp', '#cp-bulk-number-launch'],
  ['number-activation-bulk', '/commpilot/Group/DnActivation/', '#cp-bulk-activation-launch'],
  ['profile-bulk', '/commpilot/Group/DeviceInventory/', '#cp-bulk-profile-launch']
]) for (const key of ['F5', 'Control+r']) test(`${name} holds its native page during ${key} until the dialog closes`, () =>
  fixture(name, route, async (page, posts) => {
    await page.locator(launch).click();
    const before = posts.length;
    await page.keyboard.press(key);
    // The intercepted response is immediate; allow the refresh handler's timer to run.
    await page.waitForTimeout(250);
    assert.equal(posts.length, before, 'refresh cannot navigate behind an open bulk operation');
    assert.equal(await page.locator('.cp-bulk-overlay').count(), 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-reload-at')), null,
      'an ignored refresh does not suppress the next real refresh');
    await page.locator('[data-action=close]').click();
    await refreshAfterClose(page, posts, route);
  }));

test('user-bulk transport ownership holds refresh without poisoning the next refresh', () =>
  fixture(null, '/commpilot/Group/Members/', async (page, posts) => {
    await page.evaluate(async () => { window.testLease = await cpAcquireUserBulk(); });
    await page.keyboard.press('F5');
    await page.waitForTimeout(250);
    assert.equal(posts.length, 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-reload-at')), null);
    await page.evaluate(() => testLease.release());
    await refreshAfterClose(page, posts, '/commpilot/Group/Members/');
  }));
