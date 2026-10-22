const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const start = '/commpilot/User/Profile/', target = '/commpilot/User/DND/';
const shell = marker => `<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%">
  <form name="mainForm"><div id="current">${marker}</div><input name="description" value="Keep my draft"></form>
  </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;

for (const repeated of [true, false]) test(`${repeated ? 'exhausted' : 'successful'} read retry gives accurate visible feedback`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), requests = [], errors = [];
    page.setDefaultTimeout(6000);
    let posts = 0, restored = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      requests.push(pathname);
      if (request.method() === 'POST') {
        posts++;
        if (!restored && (repeated || posts === 1)) return route.abort('connectionreset');
        return route.fulfill({ contentType: 'text/html', body: shell('loaded') });
      }
      return route.fulfill({ contentType: 'text/html', body: shell('start') });
    });
    await page.goto(origin + start);
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await page.evaluate(url => redirectPost(url, {}), target);
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    assert.equal(posts, 2, 'the existing read retry remains bounded to one retry');
    if (repeated) {
      assert.equal(await page.locator('.cp-upload-notice').count(), 1,
        'a failed read must explain why the requested page did not open');
      assert.match(await page.locator('.cp-upload-notice').innerText(), /could not.*load|connection|network|unavailable/i);
      assert.equal(await page.locator('[name=description]').inputValue(), 'Keep my draft');
      assert.equal(new URL(page.url()).pathname, start);
      restored = true;
      await page.evaluate(url => redirectPost(url, {}), target);
      await page.waitForFunction(() => document.querySelector('#current')?.textContent === 'loaded');
      assert.equal(posts, 3, 'a later explicit click works without a retry loop');
    } else assert.equal(await page.locator('#current').innerText(), 'loaded');
    assert.equal(await page.locator('.cp-upload-notice').count(), 0, 'a successful page has no stale failure notice');
    assert.equal(requests.some(url => /\/Login\/?$/.test(url)), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
