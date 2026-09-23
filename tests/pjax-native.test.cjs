const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const pjaxPath = path.resolve(__dirname, '../src/content/pjax.js');
const start = `<!doctype html><html><head><title>Users</title></head><body>
<table><tr><td class="headerBar"><img alt="spacer"></td></tr>
<tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a> &gt;
<a class="headerAuthLevelLink">Acme SP</a> &gt; <a class="headerAuthLevelLink">Acme Group</a> &gt;
<a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel">Old User</span></td></tr></table>
<form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
<input name="formtokenserial" value="token-1">
<table><tr><td width="82%"><div id="view">Original page</div></td></tr></table>
<script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
</body></html>`;
const next = `<!doctype html><html><head><title>Addresses</title></head><body>
<table><tr><td class="headerBar"><img alt="spacer"></td></tr>
<tr><td class="headerBar"><a class="headerAuthLevelLink" id="new-reseller">Reseller</a> &gt;
<a class="headerAuthLevelLink">Acme SP</a> &gt; <a class="headerAuthLevelLink">Acme Group</a> &gt;
<a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel">New User</span>
<script>document.addEventListener('DOMContentLoaded',function(){document.getElementById('new-reseller').addEventListener('click',function(){window.nativeCrumbClicks=(window.nativeCrumbClicks||0)+1;});});</script>
</td></tr></table>
<form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
<input name="formtokenserial" value="token-2">
<table><tr><td width="82%"><div id="view">Address settings</div></td></tr></table>
</body></html>`;

test('PJAX swaps content, header, token, and URL without a document reload', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage();
  let requests = 0;
  await page.route('https://apps-sbx.avpaas.io/**', route => {
    if (route.request().method() === 'POST') {
      requests++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: next });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: start });
  });
  await page.goto('https://apps-sbx.avpaas.io/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => history.replaceState(null, '', '/commpilot/Reseller/Groups/'));
  await page.addScriptTag({ path: pjaxPath });
  const initialDocument = await page.evaluate(() => { window.initialDocument = document; return location.href; });
  await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Admins/', {}));
  await page.getByText('Address settings').waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.locator('td.headerBar:has(.headerAuthLevel)').innerText(),
    'Reseller > Acme SP > Acme Group > Users : New User');
  await page.locator('#new-reseller').click();
  assert.equal(await page.evaluate(() => window.nativeCrumbClicks), 1);
  assert.equal(await page.locator('[name="formtokenserial"]').inputValue(), 'token-2');
  assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  assert.equal(await page.evaluate(() => location.pathname), '/commpilot/Reseller/Admins/');
  assert.ok(initialDocument.endsWith('/commpilot/Reseller/Groups/'));
  await browser.close();
});

test('PJAX leaves the current page intact after a server error', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage();
  await page.route('https://apps-sbx.avpaas.io/**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 500, body: 'Unavailable' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: start });
  });
  await page.goto('https://apps-sbx.avpaas.io/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => history.replaceState(null, '', '/commpilot/Reseller/Groups/'));
  await page.addScriptTag({ path: pjaxPath });
  await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Admins/', {}));
  await page.locator('.cp-alert-error').waitFor();
  assert.equal(await page.locator('#view').innerText(), 'Original page');
  assert.equal(await page.evaluate(() => location.pathname), '/commpilot/Reseller/Groups/');
  await browser.close();
});

test('PJAX retains navigation coverage across the existing page families', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      if (route.request().method() === 'POST') {
        requests.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: 'text/html', body: next });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: start });
    });
    await page.goto('https://apps-sbx.avpaas.io/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => history.replaceState(null, '', '/commpilot/Reseller/Groups/'));
    await page.addScriptTag({ path: pjaxPath });
    const routes = [
      '/commpilot/Reseller/Admins/',
      '/commpilot/ServiceProvider/Members/',
      '/commpilot/Group/Members/',
      '/commpilot/Group/Members/Modify/',
      '/commpilot/User/Profile/',
      '/commpilot/Common/findAll.jsp',
      '/commpilot/Operator/System/DeviceType/Add/'
    ];
    for (const target of routes) {
      const expectedCount = requests.length + 1;
      const response = page.waitForResponse(r => r.request().method() === 'POST' &&
        new URL(r.url()).pathname === target, { timeout: 5000 });
      await page.evaluate(url => window.redirectPost(url, {}), target);
      await response;
      // Fetches are recorded by the route before the content swaps.
      assert.equal(requests[expectedCount - 1], target, `${target} must stay on PJAX transport`);
      await page.waitForFunction(url => location.pathname === url, target, { timeout: 5000 });
    }
  } finally {
    await browser.close();
  }
});
