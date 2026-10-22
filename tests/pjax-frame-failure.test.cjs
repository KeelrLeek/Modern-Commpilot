const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const entry = '/commpilot/Reseller/Groups/Modify/index.jsp';
const start = '/commpilot/Reseller/Profile/';
const shell = `<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%">
  <form name="mainForm"><input name="description" value="Keep my draft"><p>Starting page</p></form>
  </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;

for (const failure of ['connectionreset', 'failed', 'explicit-expiry', 'short-expiry', 'incomplete', 'authenticated-quote']) test(`frame navigation handles ${failure} without guessing session state`, async () => {
  const expired = failure === 'explicit-expiry' || failure === 'short-expiry';
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), requests = [], errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      requests.push({ path: pathname, method: request.method() });
      if (pathname === entry) {
        if (failure === 'incomplete') return route.fulfill({ contentType: 'text/html', body: '<html><body>Incomplete response</body></html>' });
        if (failure === 'authenticated-quote') return route.fulfill({ contentType: 'text/html', body: shell.replace('Starting page', 'Help: Please login again after changing credentials.') });
        if (!expired) return route.abort(failure);
        return route.fulfill({ contentType: 'text/html', body:
          `<html><body>Please login again<!--${'expired session '.repeat(failure === 'short-expiry' ? 0 : 30)}--></body></html>` });
      }
      // A working session can still suffer a frame network error. The old recovery
      // path harvested this valid token, replayed the failed frame, then forced Login.
      if (pathname === '/commpilot/servlet/Login' && !expired)
        return route.fulfill({ contentType: 'text/html', body:
          '<html><body><input name="formtokenserial" value="fresh-session-token"><script>redirectPost("/commpilot/Common/folder_contents.jsp",{folder:"R0",menuId:"8"});</script></body></html>' });
      if (/\/Login\/?$/.test(pathname)) return route.fulfill({ status: 401, contentType: 'text/html',
        body: '<html><body><form name="loginForm">Sign in</form></body></html>' });
      return route.fulfill({ contentType: 'text/html', body: shell });
    });
    await page.goto(origin + start);
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await page.evaluate(url => redirectPost(url, { key: 'fixture-group' }), entry);
    await page.waitForFunction(entry => document.querySelector('.cp-upload-notice') || /\/Login\/?$/.test(location.pathname) || location.pathname === entry, entry);
    if (expired) {
      assert.equal(new URL(page.url()).pathname, '/commpilot/Login/');
      assert.ok(requests.some(request => request.path === '/commpilot/servlet/Login'));
    } else {
      assert.equal(requests.some(request => request.path === '/commpilot/Login/'), false,
        'an unreadable frame is not evidence of an expired session: ' + requests.map(request => request.method + ' ' + request.path).join(' -> '));
      assert.equal(requests.filter(request => request.path === '/commpilot/servlet/Login').length, failure === 'incomplete' ? 1 : 0,
        'only an incomplete read may check for a fresh application token');
      assert.equal(new URL(page.url()).pathname, failure === 'authenticated-quote' ? entry : start);
      if (failure !== 'authenticated-quote') assert.match(await page.locator('.cp-upload-notice').innerText(), /could not.*load|could not.*read|unavailable|interrupted|incomplete/i);
      assert.equal(await page.locator('[name=description]').inputValue(), 'Keep my draft');
      assert.equal(await page.locator('iframe[name^=cpFrame],form[target^=cpFrame]').count(), 0);
    }
    assert.equal(requests.filter(request => request.method === 'POST').length, failure === 'incomplete' ? 2 : 1, 'only an incomplete read with a freshly checked token may retry once');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
