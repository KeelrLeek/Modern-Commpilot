const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {chromium} = require('playwright-core');
const extension = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..'));
const origin = 'https://apps-sbx.avpaas.io';

test('the manifest-loaded recovery page escapes to login with native redirect rules enabled', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-recovery-login-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(temporary, {headless: true,
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({cpUpdatePreferences: {automatic: false, channel: 'stable'},
        cpThemePalette: 'atlas', cpSettings: {font: 'arial'}});
      await chrome.alarms.clearAll();
    });
    const requests = [], errors = [];
    await context.route('https://**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort('blockedbyclient');
      requests.push({path: url.pathname, method: request.method()});
      if (url.pathname === '/commpilot/servlet/Login') return route.fulfill({contentType: 'text/html', body:
        '<input name="formtokenserial" value="fresh"><script>redirectPost("/commpilot/Common/folder_contents.jsp",{folder:"G0",menuId:"2"});</script>'});
      if (url.pathname === '/commpilot/Group/Members/Modify/index.jsp')
        return route.fulfill({status: 500, body: 'Fixture entity unavailable'});
      if (url.pathname === '/commpilot/Common/styles.css')
        return route.fulfill({contentType: 'text/css', body: 'body { margin: 0; }'});
      if (url.pathname === '/commpilot/Login/')
        return route.fulfill({contentType: 'text/html', body: '<html><body><h1>Fixture sign-in page</h1></body></html>'});
      return route.fulfill({status: 404, body: 'Unrecognized fixture request'});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fixture-seeded')) {
        sessionStorage.setItem('fixture-seeded', '1');
        sessionStorage.setItem('cp-last-nav', JSON.stringify({url: '/commpilot/User/Addresses/',
          entry: {url: '/commpilot/Group/Members/Modify/index.jsp', params: {key: 'fixture-user'}}}));
      }
    });
    await page.goto(origin + '/commpilot/Common/styles.css');
    await page.getByRole('button', {name: 'Go to login', exact: true}).waitFor();
    const before = requests.length;
    await page.getByRole('button', {name: 'Go to login', exact: true}).click();
    await page.waitForURL(origin + '/commpilot/Login/');
    await page.getByRole('heading', {name: 'Fixture sign-in page'}).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-last-nav')), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-pending-return')), null);
    assert.equal(requests.slice(before).some(request => request.method === 'POST'), false);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('bw-recovery-login-'));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
