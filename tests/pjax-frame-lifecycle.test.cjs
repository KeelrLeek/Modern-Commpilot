const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const entry = '/commpilot/Reseller/Groups/Modify/index.jsp';
const destination = '/commpilot/Group/Profile/';
const shell = (marker, token) => `<!doctype html><html><body>
  <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="${token}">
  <table><tr><td width="82%"><form name="mainForm"><div id="current">${marker}</div>
  <input name="description" value="Preserve this draft"></form></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;

for (const mode of ['success', 'redirect', 'timeout', 'prototype-success', 'prototype-redirect']) test(`temporary navigation frame releases its resources after ${mode}`, { timeout: 20000 }, async () => {
  const behavior = mode.replace('prototype-', '');
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage(), posts = [], errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin);
      if (request.method() !== 'POST') return route.fulfill({ contentType: 'text/html', body: shell('start', 'token-0') });
      posts.push({ path: url.pathname, data: Object.fromEntries(new URLSearchParams(request.postData())) });
      if (behavior === 'timeout') { await held; return route.abort().catch(() => {}); }
      const token = 'token-' + posts.length;
      if (behavior === 'redirect' && url.pathname === entry) return route.fulfill({ contentType: 'text/html', body:
        `<html><body><input name="formtokenserial" value="${token}"><script>redirectPost('${destination}',{key:'fixture-group'});</script><!--${'stub padding '.repeat(30)}--></body></html>` });
      return route.fulfill({ contentType: 'text/html', body: shell('loaded-' + posts.length, token) });
    });
    await page.goto(origin + '/commpilot/Reseller/Profile/');
    if (behavior === 'timeout') await page.clock.install();
    if (mode.startsWith('prototype-')) await page.addScriptTag({ path: path.join(__dirname, 'fixtures/commpilot-prototype-1.6.1.js') });
    await page.evaluate(() => {
      const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
      window.frameDeadlines = new Set();
      window.setTimeout = (callback, delay, ...args) => {
        let id;
        id = schedule(() => { frameDeadlines.delete(id); callback(...args); }, delay);
        if (delay === 90000) frameDeadlines.add(id);
        return id;
      };
      window.clearTimeout = id => { frameDeadlines.delete(id); cancel(id); };
    });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    if (behavior === 'timeout') {
      const sent = page.waitForRequest(request => request.method() === 'POST');
      await page.evaluate(url => redirectPost(url, { key: 'fixture-group' }), entry);
      await sent;
      assert.equal(await page.locator('form[target^=cpFrame]').count(), 1, 'the test observes the actual native frame form');
      await page.clock.runFor(90100);
      assert.match(await page.locator('.cp-upload-notice').innerText(), /did not answer/);
      assert.equal(await page.locator('#current').innerText(), 'start');
      assert.equal(posts.length, 1, 'a timeout cannot replay the request');
      assert.equal(await page.locator('[name=description]').inputValue(), 'Preserve this draft');
    } else {
      for (let visit = 0; visit < 5; visit++) {
        const count = posts.length + (behavior === 'redirect' ? 2 : 1);
        await page.evaluate(({ entry, visit }) => redirectPost(entry, { key: 'fixture-' + visit }), { entry, visit });
        await page.waitForFunction(marker => document.querySelector('#current')?.textContent === marker, 'loaded-' + count);
      }
      assert.equal(posts.length, behavior === 'redirect' ? 10 : 5);
      assert.deepEqual(posts.map(post => post.data.formtokenserial), posts.map((_, index) => 'token-' + index),
        'every frame and redirect uses the immediately preceding token');
    }
    assert.equal(await page.locator('iframe[name^=cpFrame]').count(), 0);
    assert.equal(await page.locator('form[target^=cpFrame]').count(), 0, 'completed or abandoned frame forms are removed');
    assert.equal(await page.evaluate(() => frameDeadlines.size), 0, 'completed frame requests do not retain 90-second timers');
    assert.deepEqual(errors, []);
  } finally { release(); await browser.close(); }
});
