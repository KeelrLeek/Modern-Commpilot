const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const pjaxPath = path.resolve(__dirname, '../src/content/pjax.js');
const start = `<!doctype html><html><head><title>Users</title></head><body>
<table><tr><td class="headerBar"><img alt="spacer"></td></tr>
<tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a> &gt;
<a class="headerAuthLevelLink">Acme SP</a> &gt; <a class="headerAuthLevelLink">Acme Group</a> &gt;
<a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel">Old User</span></td></tr></table>
<form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
<input name="formtokenserial" value="token-1">
<table><tr><td width="82%"><div id="view">Original page</div></td></tr></table>
<script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
</body></html>`;
const next = `<!doctype html><html><head><title>Addresses</title></head><body>
<table><tr><td class="headerBar"><img alt="spacer"></td></tr>
<tr><td class="headerBar"><a class="headerAuthLevelLink" id="new-reseller">Reseller</a> &gt;
<a class="headerAuthLevelLink">Acme SP</a> &gt; <a class="headerAuthLevelLink">Acme Group</a> &gt;
<a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel">New User</span>
<script>document.addEventListener('DOMContentLoaded',function(){document.getElementById('new-reseller').addEventListener('click',function(){window.nativeCrumbClicks=(window.nativeCrumbClicks||0)+1;});});</script>
</td></tr></table>
<form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
<input name="formtokenserial" value="token-2">
<table><tr><td width="82%"><div id="view">Address settings</div></td></tr></table>
</body></html>`;

test('PJAX swaps content, header, token, and URL without a document reload', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage();
  let requests = 0;
  await page.route('https://apps-sbx.avpaas.io/**', route => {
    if (route.request().method() === 'POST') {
      requests++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: next });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: start });
  });
  await page.goto('https://apps-sbx.avpaas.io/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => history.replaceState(null, '', '/commpilot/Reseller/Groups/'));
  // CommPilot's Prototype library overrides Array.find and requires Array.each.
  // Calling that method with a NodeList used to skip the native header refresh.
  await page.evaluate(() => {
    const nativeFind = Array.prototype.find;
    Array.prototype.find = function (...args) {
      if (!Array.isArray(this)) throw new TypeError('this.each is not a function');
      return nativeFind.apply(this, args);
    };
  });
  await page.addScriptTag({ path: pjaxPath });
  const initialDocument = await page.evaluate(() => { window.initialDocument = document; return location.href; });
  await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Admins/', {}));
  await page.getByText('Address settings').waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.locator('td.headerBar:has(.headerAuthLevel)').innerText(),
    'Reseller > Acme SP > Acme Group > Users : New User');
  await page.locator('#new-reseller').click();
  assert.equal(await page.evaluate(() => window.nativeCrumbClicks), 1);
  assert.equal(await page.locator('[name="formtokenserial"]').inputValue(), 'token-2');
  assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  assert.equal(await page.evaluate(() => location.pathname), '/commpilot/Reseller/Admins/');
  assert.ok(initialDocument.endsWith('/commpilot/Reseller/Groups/'));
  await browser.close();
});

test('PJAX leaves the current page intact after a server error', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage();
  await page.route('https://apps-sbx.avpaas.io/**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 500, body: 'Unavailable' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: start });
  });
  await page.goto('https://apps-sbx.avpaas.io/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => history.replaceState(null, '', '/commpilot/Reseller/Groups/'));
  await page.addScriptTag({ path: pjaxPath });
  await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Admins/', {}));
  await page.locator('.cp-alert-error').waitFor();
  assert.equal(await page.locator('#view').innerText(), 'Original page');
  assert.equal(await page.evaluate(() => location.pathname), '/commpilot/Reseller/Groups/');
  await browser.close();
});

test('an expired session opens sign-in once without replaying the rejected POST', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    let posts = 0;
    const loginPage = '<!doctype html><html><head><title>Login</title></head><body>Sign in</body></html>';
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      if (route.request().method() === 'POST') posts++;
      const body = new URL(route.request().url()).pathname === '/commpilot/Reseller/Groups/' ?
        start : loginPage;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/',
      { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Admins/', {}));
    await page.waitForURL('**/commpilot/Login/');
    assert.equal(posts, 1);
    assert.equal(await page.title(), 'Login');
  } finally {
    await browser.close();
  }
});

test('PJAX retains navigation coverage across the existing page families', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      if (route.request().method() === 'POST') {
        requests.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: 'text/html', body: next });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: start });
    });
    await page.goto('https://apps-sbx.avpaas.io/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => history.replaceState(null, '', '/commpilot/Reseller/Groups/'));
    await page.addScriptTag({ path: pjaxPath });
    const routes = [
      '/commpilot/Reseller/Admins/',
      '/commpilot/ServiceProvider/Members/',
      '/commpilot/Group/Members/',
      '/commpilot/Group/Members/Modify/',
      '/commpilot/User/Profile/',
      '/commpilot/Reseller/DeviceManagement/DeviceType/Profile/',
      '/commpilot/ServiceProvider/CallingPlan/Outgoing/AuthorizationCodes/',
      '/commpilot/Group/CommunicationBarring/Outgoing/Criteria/',
      '/commpilot/User/CallControl/CallForwarding/Always/',
      '/commpilot/Operator/System/DeviceFamilies/Modify/Profile/',
      '/commpilot/Common/findAll.jsp',
      '/commpilot/Common/DeviceProfileAuthPasswordRules/index.jsp',
      '/commpilot/Common/Password_Rules/index.jsp',
      '/commpilot/Common/PasscodeRules/index.jsp',
      '/commpilot/Common/SipAuthPasswordRules/index.jsp',
      '/commpilot/Intercept/index.jsp',
      '/commpilot/Operator/System/DeviceType/Add/'
    ];
    for (const target of routes) {
      const expectedCount = requests.length + 1;
      const response = page.waitForResponse(r => r.request().method() === 'POST' &&
        new URL(r.url()).pathname === target, { timeout: 5000 });
      await page.evaluate(url => window.redirectPost(url, {}), target);
      await response;
      // Fetches are recorded by the route before the content swaps.
      assert.equal(requests[expectedCount - 1], target, `${target} must stay on PJAX transport`);
      await page.waitForFunction(url => location.pathname === url, target, { timeout: 5000 });
    }
  } finally {
    await browser.close();
  }
});

test('Scheduled Reports Add resolves its legacy relative target to the real form', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      if (route.request().method() === 'POST') {
        posts.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: 'text/html', body: next });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: start });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/CCScheduledReports/',
      { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => window.redirectPost('../Add/index.jsp', {}));
    await page.waitForFunction(() => location.pathname ===
      '/commpilot/Group/CCScheduledReports/Add/index.jsp');
    assert.deepEqual(posts, ['/commpilot/Group/CCScheduledReports/Add/index.jsp']);
  } finally {
    await browser.close();
  }
});

test('Scheduled Reports Search follows its malformed root stub within the folder', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    const list = '/commpilot/Group/CCScheduledReports/';
    const index = '/commpilot/Group/CCScheduledReports/index.jsp';
    const stub = '<!doctype html><html><body><input name="formtokenserial" value="token-2">' +
      '<script>redirectPost("\\u002Findex.jsp", {buttonClicked:"search"});</script></body></html>';
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      const body = route.request().method() !== 'POST' ? start : pathname === list ? stub : next;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; window.redirectPost(location.pathname, { search: 'Search' }); });
    await page.getByText('Address settings').waitFor();
    assert.deepEqual(posts, [list, index]);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), list);
  } finally {
    await browser.close();
  }
});

test('Back replays a Find landing whose history entry lost its PJAX state', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    const landing = '/commpilot/User/Schedules/';
    const find = '/commpilot/Common/find.jsp';
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      const body = route.request().method() === 'POST' && pathname === find ? next : start;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto('https://apps-sbx.avpaas.io' + landing, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => {
      window.initialDocument = document;
      window.redirectPost('/commpilot/Common/find.jsp', {});
      history.replaceState(null, '', location.pathname);
    });
    await page.getByText('Address settings').waitFor();
    await page.goBack();
    await page.getByText('Original page').waitFor();
    assert.deepEqual(posts, [find, landing]);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.evaluate(() => history.state?.cpNav?.url), landing);
  } finally {
    await browser.close();
  }
});

test('Group Members search keeps its form POST in shell and uses the rotated token', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    const membersPage = (token, label) => `<!doctype html><html><head><title>Users</title></head><body>
      <table><tr><td class="headerBar">Group &gt; Users</td></tr></table>
      <table><tr><td width="82%"><form name="mainForm" method="post"
        action="/commpilot/Group/Members/index.jsp">
        <input type="hidden" name="action" value="find">
        <input type="hidden" name="formtokenserial" value="${token}">
        <input name="findValue0" value="Smith">
        <button type="submit" name="search" value="Search">Search</button>
        <div id="result">${label}</div>
      </form></td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      if (route.request().method() === 'POST') {
        posts.push({ path: new URL(route.request().url()).pathname,
          params: new URLSearchParams(route.request().postData()) });
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: membersPage(`token-${posts.length + 1}`, `Search ${posts.length}`) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: membersPage('token-1', 'Before') });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Members/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByText('Search 1').waitFor();
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByText('Search 2').waitFor();

    assert.equal(posts.length, 2);
    assert.deepEqual(posts.map(post => post.path), [
      '/commpilot/Group/Members/index.jsp', '/commpilot/Group/Members/index.jsp']);
    assert.deepEqual(posts.map(post => post.params.get('formtokenserial')), ['token-1', 'token-2']);
    assert.ok(posts.every(post => post.params.get('findValue0') === 'Smith' &&
      post.params.get('search') === 'Search'));
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.locator('[name="formtokenserial"]').inputValue(), 'token-3');
  } finally {
    await browser.close();
  }
});

test('PJAX back and forward replay each page without losing forward history', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const pageHtml = label => `<!doctype html><html><head><title>${label}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">${label}</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%"><div id="view">${label}</div></td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const name = new URL(route.request().url()).pathname.split('/').filter(Boolean).at(-1);
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml(name) });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    const admin = '/commpilot/Reseller/Admins/';
    const devices = '/commpilot/Reseller/DeviceType/';
    await page.evaluate(url => window.redirectPost(url, {}), admin);
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'Admins', admin);
    await page.evaluate(url => window.redirectPost(url, {}), devices);
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'DeviceType', devices);
    await page.goBack();
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'Admins', admin);
    await page.goForward();
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'DeviceType', devices, { timeout: 5000 });
  } finally {
    await browser.close();
  }
});

test('direct relative POST auto-forward stays in shell and Back skips its intermediate page', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const parent = '/commpilot/Group/DefaultConfig/';
    const config = '/commpilot/Group/DefaultConfig/Nested/Configuration/index.jsp';
    const files = '/commpilot/Group/DefaultConfig/Nested/Files/';
    const posts = [];
    const shell = (label, script = '') => `<!doctype html><html><head><title>${label}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Group</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%"><div id="view">${label}</div>${script}</td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    const autoForward = `<script>document.addEventListener('DOMContentLoaded', function () {
      window.redirectPost = function (url) { window.nativeNavigation = url; };
      var form = document.createElement('form');
      form.method = 'post'; form.action = '../Files/';
      form.innerHTML = '<input name="key" value="device-1">';
      document.body.appendChild(form);
      form.submit();
    });</script>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      const label = pathname === parent ? 'Device Configuration' :
        pathname === config ? 'Intermediate Configuration' : 'Configuration Files';
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(label, pathname === config ? autoForward : '') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${parent}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(url => window.redirectPost(url, { key: 'device-1' }), config);
    await page.waitForFunction(pathname => location.pathname === pathname &&
      document.querySelector('#view')?.textContent === 'Configuration Files', files);
    assert.deepEqual(posts, [config, files]);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    await page.goBack();
    await page.waitForFunction(pathname => location.pathname === pathname &&
      document.querySelector('#view')?.textContent === 'Device Configuration', parent);
    assert.deepEqual(posts, [config, files, parent]);
  } finally {
    await browser.close();
  }
});

test('Back to the initial reseller Profile replays its folder parameters', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    const shell = label => `<!doctype html><html><head><title>${label}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%"><div id="view">${label}</div></td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push({ pathname,
        body: new URLSearchParams(route.request().postData() || '') });
      return route.fulfill({ status: 200, contentType: 'text/html', body:
        shell(pathname.includes('folder_contents') ? 'Profile' : 'Service Providers') });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Common/folder_contents.jsp',
      { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => window.redirectPost('/commpilot/Reseller/ServiceProviders/index.jsp', {}));
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.goBack();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.querySelector('#view')?.textContent === 'Profile');
    const back = posts.findLast(post => post.pathname === '/commpilot/Common/folder_contents.jsp');
    assert.ok(back);
    assert.equal(back.body.get('folder'), 'R0');
    assert.equal(back.body.get('menuId'), '8');
  } finally {
    await browser.close();
  }
});

test('back from a user page preserves forward history across iframe entry replay', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const appPage = label => `<!doctype html><html><head><title>${label}</title></head><body>
      <table><tr><td class="headerBar"><a class="headerAuthLevelLink">Users</a>
        <span class="headerAuthLevel">Test User</span></td></tr></table>
      <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form>
      <input name="formtokenserial" value="token">
      <table><tr><td width="82%"><div id="view">${label}</div></td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    const stub = `<!doctype html><html><head><title>Redirect</title></head><body>
      <input name="formtokenserial" value="token">
      <script>redirectPost('/commpilot/User/index.jsp', {userId:'Test User'});</script>
      <!-- ${'padding '.repeat(50)} -->
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname.includes('/Group/Members/Modify/') ? stub :
        pathname.includes('/User/Addresses/') ? appPage('Addresses') :
          pathname.includes('/User/index.jsp') ? appPage('User Menu') : appPage('Users List');
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Members/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    const entry = '/commpilot/Group/Members/Modify/index.jsp';
    const addresses = '/commpilot/User/Addresses/';
    await page.evaluate(url => window.redirectPost(url, { userId: 'Test User' }), entry);
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'User Menu', entry);
    const entryHistoryLength = await page.evaluate(() => history.length);
    await page.evaluate(url => window.redirectPost(url, {}), addresses);
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'Addresses', addresses);
    assert.equal(await page.evaluate(() => history.length), entryHistoryLength + 1);
    await page.goBack();
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'User Menu', entry);
    assert.equal(await page.evaluate(() => history.length), entryHistoryLength + 1);
    await page.goBack();
    await page.waitForFunction(() => location.pathname === '/commpilot/Group/Members/' &&
      document.querySelector('#view')?.textContent === 'Users List', null, { timeout: 5000 });
    await page.goForward();
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'User Menu', entry);
    await page.goForward();
    await page.waitForFunction(url => location.pathname === url && document.querySelector('#view')?.textContent === 'Addresses', addresses, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  } finally {
    await browser.close();
  }
});
