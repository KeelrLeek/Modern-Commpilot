const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const first = '/commpilot/User/Passwords/', next = '/commpilot/User/Authentication/';
const scriptPath = first + 'fixture.js';

for (const mode of ['pending', 'newest-click', 'timed-out', 'timeout-while-queued', 'failed-script', 'bulk-acquire', 'bulk-acquire-timeout'])
test(`an ordinary page script (${mode}) cannot replace the next page validator`, async () => {
  const timesOut = mode === 'timed-out' || mode === 'timeout-while-queued' || mode === 'bulk-acquire-timeout';
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage(), posts = [];
    page.setDefaultTimeout(6000);
    let token = 0;
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin);
      if (url.pathname === scriptPath) {
        await held;
        if (mode === 'failed-script') return route.abort('failed');
        return route.fulfill({ contentType: 'application/javascript', body:
          "window.lateOrdinaryScript=true;window.validate=function(){return 'passwords';};" });
      }
      if (request.method() === 'POST') {
        assert.equal(new URLSearchParams(request.postData() || '').get('formtokenserial'), 'fixture-' + token);
        posts.push(url.pathname);
      }
      const script = url.pathname === first ? `<script src="${scriptPath}"></script>` :
        "<script>window.validate=function(){return 'authentication';};</script>";
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
        <input name="formtokenserial" value="fixture-${++token}"><table><tr><td width="82%">
        <div id="marker">${url.pathname}</div><form name="mainForm"><input name="username"></form>${script}
        </td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>` });
    });
    await page.goto(origin + '/commpilot/User/Profile/');
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    if (timesOut) await page.clock.install();
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === scriptPath);
    await page.evaluate(url => redirectPost(url, {}), first); await requested;
    if (mode.startsWith('bulk-acquire')) {
      await page.evaluate(() => {
        window.pendingBulk = cpAcquireUserBulk().then(lease => { window.testLease = lease; })
          .catch(error => { window.testBulkError = error.message; });
      });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => !!window.testLease), false, 'bulk acquisition waits for the current native initializer');
      if (timesOut) {
        await page.clock.runFor(15100);
        await page.waitForFunction(() => window.testBulkError);
        assert.match(await page.evaluate(() => testBulkError), /native script is still loading/);
        assert.deepEqual(posts, [first], 'timed-out initialization never dispatches a bulk request');
      }
      release();
      if (timesOut) {
        await page.waitForFunction(() => window.lateOrdinaryScript);
        await page.evaluate(async () => { window.testLease = await cpAcquireUserBulk(); });
      }
      await page.waitForFunction(() => !!window.testLease);
      await page.evaluate(async next => { await testLease.navigate(next, {}); testLease.release(); }, next);
      assert.equal(await page.evaluate(() => validate()), 'authentication');
      assert.deepEqual(posts, [first, next]);
      return;
    }
    if (mode === 'timed-out') await page.clock.runFor(15100);
    if (mode === 'newest-click') await page.evaluate(() => redirectPost('/commpilot/User/Other/', {}));
    await page.evaluate(url => redirectPost(url, {}), next);
    if (mode === 'timeout-while-queued') await page.clock.runFor(15100);
    await page.waitForTimeout(300);
    assert.deepEqual(posts, [first], 'only the newest navigation may run once the native script settles');
    if (timesOut) assert.match(await page.locator('.cp-upload-notice').innerText(), /native script is still loading/);
    release();
    if (timesOut) {
      await page.waitForFunction(() => window.lateOrdinaryScript);
      await page.evaluate(url => redirectPost(url, {}), next);
    }
    await page.waitForFunction(next => document.querySelector('#marker')?.textContent === next, next);
    assert.equal(await page.evaluate(() => validate()), 'authentication');
    assert.deepEqual(posts, [first, next]);
  } finally { release(); await browser.close(); }
});
