const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const extensionPath = process.env.EXTENSION_PATH || path.resolve(__dirname, '..');

function appPage(label, token) {
  return `<!doctype html><html><head><title>${label}</title>
    <link rel="stylesheet" href="/commpilot/Common/styles.css"></head><body>
    <table><tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a> &gt;
      <a class="headerAuthLevelLink">Users</a> :
      <span class="headerAuthLevel">${label}</span></td></tr></table>
    <form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
    <input name="formtokenserial" value="${token}">
    <table><tr><td width="82%"><table><tr><td class="screenName">${label}</td></tr></table>
      <a class="navMenuItem" id="feature">Call Forwarding - On</a>
      <div id="view">${label} content</div>
    </td></tr></table>
    <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
  </body></html>`;
}

test('packed preview retains PJAX and enhancer features on a CommPilot POST page', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'commpilot-pjax-preview-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://apps-sbx.avpaas.io/commpilot/**', route => {
      const url = new URL(route.request().url());
      requests.push([route.request().method(), url.pathname]);
      if (url.pathname === '/commpilot/Common/styles.css') {
        return route.fulfill({ status: 200, contentType: 'text/css', body:
          'body, td { font: 12px Arial, sans-serif; background: #232323; color: #fff; }' +
          ' .headerBar { background: #24436a; color: #fff; padding: 8px; }' +
          ' .headandfoot { background: #11243e; }' +
          ' a { color: #d6e5ff; }' });
      }
      const response = url.pathname.includes('/Login/')
        ? '<!doctype html><title>Login</title><body><div id="login">Login</div></body>'
        : appPage(url.pathname.includes('/Admins/') ? 'New User' : 'Old User',
            url.pathname.includes('/Admins/') ? 'token-2' : 'token-1');
      return route.fulfill({ status: 200, contentType: 'text/html', body: response });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/commpilot/Reseller/Groups/';
      document.body.append(form);
      form.submit();
    });
    await page.getByText('Old User content').waitFor();
    await page.locator('#feature .bw-on-off-status').waitFor();
    await page.waitForFunction(() => typeof window.redirectPost === 'function' &&
      String(window.redirectPost).includes('cpDclSpin'));
    await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Admins/', {}));
    await page.getByText('New User content').waitFor();
    await page.locator('#feature .bw-on-off-status').waitFor();
    assert.equal(await page.evaluate(() => location.pathname), '/commpilot/Reseller/Admins/');
    assert.equal(await page.locator('[name="formtokenserial"]').first().inputValue(), 'token-2');
    assert.equal(await page.locator('#feature .bw-on-off-status').count(), 1);
    assert.equal(await page.locator('.cp-topbar, .cp-console, .cp-breadcrumb, .cp-srch-grid').count(), 0);
    // No v1 skin: the page is in the Settings font (Inter unless changed), not v1's Nunito.
    assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /^"?Inter"?, "Segoe UI"/);
    assert.deepEqual(errors, []);
    await page.reload();
    await page.getByText('New User content').waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => location.pathname), '/commpilot/Reseller/Admins/');
    assert.ok(requests.filter(([method, pathname]) =>
      method === 'POST' && pathname === '/commpilot/Reseller/Admins/').length >= 2,
      `PJAX and recovery should each POST the requested page: ${JSON.stringify(requests)}`);
    if (process.env.PREVIEW_SCREENSHOT) {
      await page.screenshot({ path: process.env.PREVIEW_SCREENSHOT, fullPage: true });
    }
    await page.close();
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
