const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const pjax = process.env.BW_TEST_PJAX_PATH || path.resolve(__dirname, '../src/content/pjax.js');
const origin = 'https://apps-sbx.avpaas.io';
const routePath = '/commpilot/Group/Calling_Plan/Outgoing/index.jsp';
const query = '?TransferForward=1&isEnh=true';

for (const target of ['./index.jsp' + query, query, routePath + query]) {
  test(`native redirectPost preserves query-selected tabs for ${target}`, async () => {
    const browser = await chromium.launch({ headless: true, executablePath:
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
      const page = await browser.newPage();
      const posts = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'POST') posts.push(url.pathname + url.search);
        return route.fulfill({ contentType: 'text/html', body:
          '<!doctype html><body><form name="leftNavForm"></form><input name="formtokenserial" value="fixture-token">' +
          '<table><tr><td width="82%"><form name="mainForm"><div id="view">' +
          (url.searchParams.has('TransferForward') ? 'Forwarded' : 'Originating') +
          '</div></form></td></tr></table><script>window.redirectPost=function(){};</script></body>' });
      });
      await page.goto(origin + routePath);
      await page.addScriptTag({ path: pjax });
      await page.evaluate(target => { window.originalDocument = document; window.redirectPost(target, {}); }, target);
      await page.waitForFunction(() => document.querySelector('#view')?.textContent === 'Forwarded', null, { timeout: 3000 });
      assert.deepEqual(posts, [routePath + query]);
      assert.equal(new URL(page.url()).search, query);
      assert.equal(await page.evaluate(() => document === window.originalDocument), true);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('#view')?.textContent === 'Originating');
      assert.equal(new URL(page.url()).search, '');
      assert.deepEqual(posts, [routePath + query, routePath]);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test('a native redirect stub preserves its query and threads its new form token', async () => {
  const browser = await chromium.launch({ headless: true, executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), posts = [];
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST') {
        posts.push({ url: url.pathname + url.search, token: new URLSearchParams(request.postData()).get('formtokenserial') });
        if (posts.length === 1) return route.fulfill({ contentType: 'text/html', body:
          '<!doctype html><body><input name="formtokenserial" value="rotated-token">' +
          '<script>redirectPost("./index.jsp?TransferForward=1&isEnh=true", {});</script></body>' });
      }
      return route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><body><form name="leftNavForm"></form><input name="formtokenserial" value="initial-token">' +
        '<table><tr><td width="82%"><form name="mainForm"><div id="view">' +
        (url.searchParams.has('TransferForward') ? 'Forwarded' : 'Originating') +
        '</div></form></td></tr></table><script>window.redirectPost=function(){};</script></body>' });
    });
    await page.goto(origin + routePath);
    await page.addScriptTag({ path: pjax });
    await page.evaluate(target => window.redirectPost(target, {}), routePath);
    await page.waitForFunction(() => document.querySelector('#view')?.textContent === 'Forwarded', null, { timeout: 3000 });
    assert.deepEqual(posts, [
      { url: routePath, token: 'initial-token' },
      { url: routePath + query, token: 'rotated-token' }
    ]);
  } finally { await browser.close(); }
});
