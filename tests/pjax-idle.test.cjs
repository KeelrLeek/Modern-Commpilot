const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const shell = (token, marker) => `<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="${token}"><table><tr><td width="82%"><form name="mainForm">
  <div id="marker">${marker}</div><input name="description" value="Unsaved draft"></form></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;

test('long idle periods produce one passive warning without requests, logout or draft changes', async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), requests = [], errors = [];
    await page.clock.install();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(); requests.push({ method: request.method(), url: request.url() });
      if (request.method() === 'POST') {
        const params = new URLSearchParams(request.postData());
        assert.equal(params.get('formtokenserial'), 'idle-1');
        assert.equal(params.has('description'), false, 'a page read never submits the draft');
        return route.fulfill({ contentType: 'text/html', body: shell('idle-2', 'loaded') });
      }
      return route.fulfill({ contentType: 'text/html', body: shell('idle-1', 'start') });
    });
    await page.goto(origin + '/commpilot/User/Profile/');
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    const before = requests.length;
    for (let interval = 0; interval < 4; interval++) {
      await page.clock.fastForward(25 * 60 * 1000);
      assert.equal(await page.locator('#cp-idle-warn').count(), 1);
      assert.equal(requests.length, before, 'the idle watchdog must never send keepalive or sign-in requests');
      assert.equal(await page.locator('[name="description"]').inputValue(), 'Unsaved draft');
      assert.equal(new URL(page.url()).pathname, '/commpilot/User/Profile/');
    }
    await page.evaluate(() => redirectPost('/commpilot/User/DND/', {}));
    await page.waitForFunction(() => document.querySelector('#marker')?.textContent === 'loaded');
    assert.equal(await page.locator('#cp-idle-warn').count(), 0, 'an acknowledged page read clears the stale warning');
    assert.equal(requests.length, before + 1);
    assert.equal(requests.some(request => /\/(?:Login|Logout)\//i.test(request.url)), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
