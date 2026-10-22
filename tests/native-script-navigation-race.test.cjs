const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const vm = '/commpilot/User/VM/General/', destination = '/commpilot/User/Authentication/';
const scriptPath = vm + 'validate.js';
const shell = (token, marker, head = '', bodyScript = '') => '<html><head>' + head + '</head><body>' +
  '<form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>' +
  '<input name="formtokenserial" value="' + token + '"><table><tr><td width="82%"><form name="mainForm">' +
  '<div id="marker">' + marker + '</div><input name="username"></form><script>' + bodyScript +
  '</script></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>';

for (const mode of ['pending', 'newest-click', 'timed-out', 'timeout-while-queued']) test(`leaving a page with a ${mode} native validator preserves the destination validator`, async () => {
  const timesOut = mode === 'timed-out' || mode === 'timeout-while-queued';
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let releaseScript;
  try {
    const page = await browser.newPage(), errors = [], posts = [];
    page.setDefaultTimeout(6000);
    let serial = 1;
    const held = new Promise(resolve => { releaseScript = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === scriptPath) {
        await held;
        return route.fulfill({ contentType: 'application/javascript', body:
          "window.delayedValidatorLoaded=true;window.validate=function(){return 'voicemail';};" });
      }
      if (request.method() === 'POST') {
        posts.push(url.pathname);
        assert.equal(new URLSearchParams(request.postData()).get('formtokenserial'), 'script-' + serial);
        serial++;
      }
      const body = url.pathname === vm ? shell('script-' + serial, 'voice', '<script src="' + scriptPath + '"></script>') :
        shell('script-' + serial, url.pathname === destination ? 'destination' : 'start', '',
          "window.validate=function(){return 'authentication';};");
      return route.fulfill({ contentType: 'text/html', body });
    });
    await page.goto(origin + '/commpilot/User/Profile/');
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    if (timesOut) await page.clock.install();
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === scriptPath, { timeout: 6000 });
    await page.evaluate(url => redirectPost(url, {}), vm);
    await requested;
    if (mode === 'timed-out') {
      await page.clock.runFor(15100);
      assert.match(await page.locator('.cp-alert-error').innerText(), /timed out/);
    }
    if (mode === 'newest-click') await page.evaluate(() => redirectPost('/commpilot/User/Passwords/', {}));
    await page.evaluate(url => redirectPost(url, {}), destination);
    if (mode === 'timeout-while-queued') await page.clock.runFor(15100);
    await page.waitForTimeout(300);
    assert.deepEqual(posts, [vm], 'a pending native script holds navigation before another request is sent');
    if (timesOut) {
      assert.match(await page.locator('.cp-upload-notice').innerText(), /native script is still loading/);
      assert.equal(await page.locator('#marker').innerText(), 'voice');
    }
    releaseScript();
    if (timesOut) {
      await page.waitForFunction(() => window.delayedValidatorLoaded);
      await page.evaluate(url => redirectPost(url, {}), destination);
    }
    await page.waitForFunction(() => document.querySelector('#marker')?.textContent === 'destination' && window.delayedValidatorLoaded);
    assert.equal(await page.evaluate(() => validate()), 'authentication',
      'a late validator from the abandoned page must not replace the current page validator');
    assert.equal(await page.locator('td[width="82%"]').evaluate(cell => cell.inert), false);
    assert.deepEqual(posts, [vm, destination]);
    assert.deepEqual(errors, []);
  } finally { releaseScript?.(); await browser.close(); }
});
