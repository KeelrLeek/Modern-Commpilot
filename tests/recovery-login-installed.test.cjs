const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {chromium} = require('playwright-core');
const extension = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..'));
const origin = 'https://apps-sbx.avpaas.io';
// Fixtures answer every routed request. The resolver keeps anything unrouted, the update check included, off the network.
const args = ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--host-resolver-rules=MAP * ~NOTFOUND'];

test('the manifest-loaded recovery page escapes to login with native redirect rules enabled', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-recovery-login-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(temporary, {headless: true,
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args});
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

const folderPath = '/commpilot/Common/folder_contents.jsp';
const spEntry = '/commpilot/Reseller/ServiceProviders/Modify/';
const levels = {R: {menuId: '8', folders: ['R0', 'R1']}, S: {menuId: '2', folders: ['S0', 'S1']}};
const levelShell = (level, title) => `<!doctype html><html><head><title>${title}</title></head><body id="initBody.menuTemplate">
  <form name="leftNavForm">${levels[level].folders.map((id, i) => `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}"
    onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'${levels[level].menuId}'})">${id}</a>`).join('')}</form>
  <input name="formtokenserial" value="signed-in">
  <table height="100%"><tr><td width="82%" valign="top"><h1>${title}</h1></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;
const loginPage = '<html><head><title>Login</title></head><body id="loginBody"><form name="loginForm">' +
  '<table><tr><td class="loginerror"></td></tr></table><input name="UserID"><input type="password" name="password"></form></body></html>';

test('the manifest-loaded recovery sends an expired session to sign-in and reopens the saved page afterwards', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-recovery-login-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(temporary, {headless: true,
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async origin => {
      await chrome.storage.local.set({cpUpdatePreferences: {automatic: false, channel: 'stable'},
        ['cpRecoverToken:' + origin]: 'token-before-expiry'});
      await chrome.alarms.clearAll();
    }, origin);
    let signedIn = false;
    const requests = [], errors = [];
    await context.route('https://**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort('blockedbyclient');
      requests.push({path: url.pathname, method: request.method(), signedIn,
        key: new URLSearchParams(request.postData() || '').get('key')});
      if (url.pathname === '/commpilot/Common/styles.css')
        return route.fulfill({contentType: 'text/css', body: 'body { margin: 0; }'});
      if (url.pathname === '/commpilot/Login/') return route.fulfill({contentType: 'text/html', body: loginPage});
      // Expired: the session check and every POST get CommPilot's hard-coded http:// Login redirect.
      if (!signedIn) return route.fulfill({status: 302, headers: {location: 'http://apps-sbx.avpaas.io/commpilot/Login/'}, body: ''});
      const level = url.pathname === spEntry || url.pathname.startsWith('/commpilot/ServiceProvider/') ? 'S' : 'R';
      return route.fulfill({contentType: 'text/html', body: levelShell(level, level + ' ' + url.pathname)});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fixture-seeded')) {
        sessionStorage.setItem('fixture-seeded', '1');
        sessionStorage.setItem('cp-last-nav', JSON.stringify({url: '/commpilot/ServiceProvider/Profile/', params: {},
          entry: {url: '/commpilot/Reseller/ServiceProviders/Modify/', params: {key: 'Fixture_SP'}}}));
      }
    });
    // A browser Reload or restored tab is a main-frame GET; the redirect rules send it to the recovery interstitial.
    await page.goto(origin + '/commpilot/ServiceProvider/Profile/');
    await page.waitForURL(origin + '/commpilot/Login/');
    await page.waitForFunction(() => sessionStorage.getItem('cp-pending-return') === '1');
    assert.ok(requests.some(request => request.path === '/commpilot/servlet/Login'), 'the session was checked');
    assert.deepEqual(requests.filter(request => request.method === 'POST'), [], 'nothing is posted with the expired token');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('bwManualLogoutAt')), null,
      'an expired session does not hold the automatic saved sign-in');
    // Signing in lands on the reseller home by POST; the saved service provider page then reopens.
    signedIn = true;
    await page.evaluate(folderPath => {
      const form = document.createElement('form');
      form.method = 'POST'; form.action = folderPath;
      for (const [name, value] of [['folder', 'R0'], ['menuId', '8']])
        form.append(Object.assign(document.createElement('input'), {type: 'hidden', name, value}));
      document.body.append(form);
      HTMLFormElement.prototype.submit.call(form);
    }, folderPath);
    await page.waitForURL(origin + folderPath);
    const posts = () => requests.filter(request => request.signedIn && request.method === 'POST');
    for (const end = Date.now() + 15000; Date.now() < end &&
      !posts().some(request => request.path === '/commpilot/ServiceProvider/Profile/');) await page.waitForTimeout(100);
    const asked = posts().map(request => request.path);
    const at = asked.indexOf(spEntry);
    assert.ok(at !== -1, 'the service provider is opened first');
    assert.equal(posts()[at].key, 'Fixture_SP');
    assert.ok(asked.indexOf('/commpilot/ServiceProvider/Profile/') > at, 'then the page');
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('bw-recovery-login-'));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
