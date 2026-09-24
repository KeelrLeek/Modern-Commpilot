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

test('an external BroadWorks script wires its DOMContentLoaded pick-list handler after PJAX', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const formPath = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const scriptPath = '/commpilot/Group/GroupDnManagement/Nested/validate.js';
    const formPage = `<!doctype html><html><head><title>Assign Numbers Modify</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Resources</a></form>
      <input name="formtokenserial" value="token-2">
      <table><tr><td width="82%"><form name="mainForm" method="post">
      <select name="assignedList" multiple><option value="+12244830007">+12244830007</option></select>
      <input type="button" id="PICKLIST_addNumbers" value="Add >"></form>
      <script src="${scriptPath}"></script></td></tr></table></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', async route => {
      const target = new URL(route.request().url()).pathname;
      if (target === scriptPath) {
        await new Promise(resolve => setTimeout(resolve, 80));
        return route.fulfill({ status: 200, contentType: 'application/javascript',
          body: `document.addEventListener('DOMContentLoaded',function(){
            document.getElementById('PICKLIST_addNumbers').addEventListener('click',function(){
              window.added=(window.added||0)+1;
            });
          });` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: route.request().method() === 'POST' ? formPage : start });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/',
      { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document;
      window.redirectPost('/commpilot/Group/GroupDnManagement/Nested/index.jsp', {}); });
    await page.locator('#PICKLIST_addNumbers').waitFor();
    await page.waitForFunction(() => typeof window.added === 'undefined' &&
      !!document.querySelector('script[src$="validate.js"]')._cpLoaded);
    await page.locator('#PICKLIST_addNumbers').click();
    assert.equal(await page.evaluate(() => window.added), 1);
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), formPath);
  } finally { await browser.close(); }
});

test('multipart import follows its token-bearing stub in-shell and Back does not resend the file', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const importPath = '/commpilot/Operator/System/DeviceTags/Import/index.jsp';
    const servletPath = '/commpilot/servlet/DeviceManagementImportServlet';
    const importPage = `<!doctype html><html><head><title>Tag Sets Import</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Resources</a></form>
      <input name="formtokenserial" value="token-1">
      <table><tr><td width="82%"><form name="mainForm" method="post"
        action="${servletPath}" enctype="multipart/form-data">
        <input name="formtokenserial" value="token-1"><input type="file" name="fileName">
        <input type="submit" name="ok" value="OK"></form></td></tr></table>
      <script>window.redirectPost=function(url,params){window.nativeNavigation={url,params};};</script>
      </body></html>`;
    const resultPage = `<!doctype html><html><head><title>Tag Sets Import</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Resources</a></form>
      <input name="formtokenserial" value="token-3">
      <table><tr><td width="82%"><div id="upload-result">Invalid archive</div></td></tr></table>
      </body></html>`;
    const stub = `<html><body><input name="formtokenserial" value="token-2">
      <script>redirectPost('${importPath}', {});</script></body></html>`;
    let servletPosts = 0;
    const followTokens = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === servletPath && request.method() === 'POST') {
        servletPosts++;
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(Buffer.from('not-a-real-archive')));
        return route.fulfill({ status: 200, contentType: 'text/html', body: stub });
      }
      if (pathname === importPath && request.method() === 'POST') {
        followTokens.push(new URLSearchParams(request.postData()).get('formtokenserial'));
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: followTokens.length === 1 ? resultPage : importPage });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: importPage });
    });
    await page.goto(`https://apps-sbx.avpaas.io${importPath}`,
      { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('input[type="file"]').setInputFiles({ name: 'invalid.zip',
      mimeType: 'application/zip', buffer: Buffer.from('not-a-real-archive') });
    await page.locator('input[type="submit"]').click();
    await page.locator('#upload-result').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), importPath);
    assert.deepEqual(followTokens, ['token-2']);
    assert.equal(servletPosts, 1);
    await page.goBack();
    await page.locator('input[type="file"]').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
});

test('Shared Call Appearance Add returns to its list URL after a successful save', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const listPath = '/commpilot/User/SCAP/';
    const addPath = '/commpilot/User/SCAP/Add/index.jsp';
    const shell = content => `<!doctype html><html><head><title>Shared Call Appearance</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Call Control</a></form>
      <input name="formtokenserial" value="test-token">
      <table><tr><td width="82%">${content}</td></tr></table>
      <script>window.redirectPost=function(url,params){window.nativeNavigation={url,params};};</script>
      </body></html>`;
    const list = shell('<h1>Shared Call Appearance</h1><input type="button" name="add" value="Add">' +
      '<div id="saved-row">Saved appearance</div>');
    const add = shell('<h1>Shared Call Appearance Add</h1><form name="mainForm" method="post">' +
      '<input name="deviceLinePortDomain" value="testline"><input type="submit" name="ok" value="OK"></form>');
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push(pathname);
      const body = pathname === addPath && request.method() === 'POST' &&
        new URLSearchParams(request.postData() || '').has('ok') ? list :
        pathname === addPath ? add : list;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto(`https://apps-sbx.avpaas.io${listPath}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(url => window.redirectPost(url, {}), addPath);
    await page.locator('form[name="mainForm"] input[name="ok"]').click();
    await page.locator('#saved-row').waitFor();
    assert.equal(await page.evaluate(() => location.pathname), listPath);
    assert.deepEqual(posts, [addPath, addPath]);
    await page.evaluate(() => window.redirectPost('Add/index.jsp', {}));
    await page.waitForFunction(path => location.pathname === path, addPath);
    assert.deepEqual(posts, [addPath, addPath, addPath]);
  } finally { await browser.close(); }
});

test('Answer Confirmation saves a multipart form with no selected file in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const pathname = '/commpilot/ServiceProvider/AnswerConfirmation/';
    const servlet = '/commpilot/servlet/AnswerConfirmationServlet';
    const shell = token => `<!doctype html><html><head><title>Answer Confirmation</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Utilities</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="radio" name="answerConfirmationSelection" value="system" checked>
      <input type="file" name="file_answerConfirmationSelection">
      <input type="submit" name="apply" value="Apply"></form>
      <div id="saved">${token === 'token-3' ? 'Saved' : ''}</div></td></tr></table>
      <script>window.redirectPost=function(url,params){window.nativeNavigation={url,params};};</script>
      </body></html>`;
    let servletPosts = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const target = new URL(request.url()).pathname;
      if (target === servlet && request.method() === 'POST') {
        servletPosts++;
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(Buffer.from('name="apply"')));
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${pathname}', {});</script></body></html>` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(request.method() === 'POST' ? 'token-3' : 'token-1') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${pathname}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('input[name="apply"]').click();
    await page.locator('#saved:text-is("Saved")').waitFor();
    assert.equal(await page.evaluate(() => location.pathname), pathname);
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
});

test('Device Profile Delete multipart servlet returns to the list in shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const profile = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
    const list = '/commpilot/Group/DeviceInventory/';
    const servlet = '/commpilot/servlet/DeviceInventoryProvisionServlet';
    const shell = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
      <input name="formtokenserial" type="hidden" value="token-1">
      <input name="deviceName" type="hidden" value="TEST 99999">
      <input name="delete" type="submit" value="Delete"></form></td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const listHtml = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-3"><table><tr><td width="82%">
      <div id="profile-list">Identity/Device Profiles</div></td></tr></table></body></html>`;
    let servletPosts = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === servlet && request.method() === 'POST') {
        servletPosts++;
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(Buffer.from('name="delete"')));
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${list}', {});</script></body></html>` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === list ? listHtml : shell });
    });
    await page.goto(`https://apps-sbx.avpaas.io${profile}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('input[name="delete"]').click();
    await page.locator('#profile-list').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), list);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
});

test('Device Profile Users tab opens with profile identity only', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/DeviceInventory/';
    const profile = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
    const users = '/commpilot/Group/DeviceInventory/Modify/Users/';
    const shell = `<html><head><title>Identity/Device Profile Modify</title></head><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="key" value="TEST 99999">
      <input name="P_key" value="TEST 99999"><input name="description" value="Do not save"></form>
      <a class="tab" id="anchor-users">Users</a>
      <script>var wiring = "anchor-users TabSubmit('/Group/DeviceInventory/Modify/Users/')";</script>
      </td></tr></table>
      </body></html>`;
    const usersHtml = `<html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-2"><table><tr><td width="82%">
      <div id="users-tab">Users</div></td></tr></table></body></html>`;
    const listHtml = `<html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="add" type="button" value="Add"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push({ pathname,
        params: Object.fromEntries(new URLSearchParams(request.postData())) });
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === users ? usersHtml : pathname === list ? listHtml : shell });
    });
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(target => window.redirectPost(target,
      { key: 'TEST 99999', P_key: 'TEST 99999' }), profile);
    await page.locator('#anchor-users').waitFor();
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('#anchor-users').click();
    await page.locator('#users-tab').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), users);
    assert.equal(posts.length, 2);
    assert.equal(posts[1].pathname, users);
    assert.equal(posts[1].params.key, 'TEST 99999');
    assert.equal(posts[1].params.description, undefined);
  } finally { await browser.close(); }
});

test('Device Configuration sends selected file bytes and returns in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const formPath = '/commpilot/Group/DefaultConfig/Nested/Files/Modify/index.jsp';
    const listPath = '/commpilot/Group/DefaultConfig/Nested/Files/';
    const servlet = '/commpilot/servlet/SystemDmsFileProvisionServlet';
    const shell = (token, done = false) => `<!doctype html><html><head><title>Device Configuration</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Utilities</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      ${done ? '<div id="files">Device Configuration Files</div>' : `<form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="configurationMode" value="custom">
      <input type="file" name="fileName"><input type="submit" name="ok" value="OK"></form>`}
      </td></tr></table><script>window.redirectPost=function(url,params){window.nativeNavigation={url,params};};</script>
      </body></html>`;
    const contents = Buffer.from('test-device-config=1\n');
    let servletPosts = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const target = new URL(request.url()).pathname;
      if (target === servlet && request.method() === 'POST') {
        servletPosts++;
        const body = request.postDataBuffer();
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(body.includes(contents), 'selected file bytes should be sent');
        assert.ok(body.includes(Buffer.from('name="ok"')), 'clicked submitter should be sent');
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${listPath}', {});</script></body></html>` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(request.method() === 'POST' ? 'token-3' : 'token-1', target === listPath) });
    });
    await page.goto(`https://apps-sbx.avpaas.io${formPath}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('input[name="fileName"]').setInputFiles({
      name: 'test.cfg', mimeType: 'text/plain', buffer: contents });
    await page.locator('input[name="ok"]').click();
    await page.locator('#files').waitFor();
    assert.equal(await page.evaluate(() => location.pathname), listPath);
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
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

for (const scenario of [
  { name: 'Assign Xsi Policy Profile',
    start: '/commpilot/Group/AssignXsiPolicyProfile/Group/',
    next: '/commpilot/Group/AssignXsiPolicyProfile/User/',
    before: 'Group Xsi Policy Profile', after: 'User Xsi Policy Profile',
    handler: 'tabSubmit', relative: '../User/' },
  { name: 'Tag Set Modify',
    start: '/commpilot/Operator/System/DeviceTags/Modify/TagSet/index.jsp',
    next: '/commpilot/Operator/System/DeviceTags/Modify/Regions/',
    before: 'Tags', after: 'Regions',
    handler: 'TabSubmit', relative: '../Regions/' }
]) {
  test(`${scenario.name} tab switches in-shell and Back restores the first tab`, async () => {
    assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      const posts = [];
      const tabPage = (active, sibling, token) => `<!doctype html><html><head><title>Tabbed settings</title></head><body>
        <table><tr><td class="headerBar">Settings</td></tr></table>
        <input name="formtokenserial" value="${token}">
        <table><tr><td width="82%"><form name="mainForm" method="post">
          <table><tr><td class="tabActive">${active}</td><td><a class="tab" id="sibling-tab">${sibling}</a></td></tr></table>
          <input name="newTagSetName" value="unchanged">
        </form></td></tr></table>
        <script>window.redirectPost=function(url,params){window.nativeNavigation={url,params};};
          window.${scenario.handler}=function(){document.forms.mainForm.submit();};
          document.addEventListener('DOMContentLoaded',function(){
            document.getElementById('sibling-tab').addEventListener('click',function(){
              ${scenario.handler}('${scenario.relative}');
            });
          });</script>
      </body></html>`;
      await page.route('https://apps-sbx.avpaas.io/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (route.request().method() === 'POST') posts.push(pathname);
        if (route.request().method() === 'POST' && pathname !== scenario.start && pathname !== scenario.next)
          return route.fulfill({ status: 500, body: 'Unexpected tab target' });
        const active = pathname === scenario.next ? scenario.after : scenario.before;
        const sibling = pathname === scenario.next ? scenario.before : scenario.after;
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: tabPage(active, sibling, pathname === scenario.next ? 'token-2' : 'token-1') });
      });
      await page.goto('https://apps-sbx.avpaas.io' + scenario.start,
        { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ path: pjaxPath });
      await page.evaluate(() => { window.initialDocument = document; });
      await page.locator('#sibling-tab').click();
      await page.locator('.tabActive').filter({ hasText: scenario.after }).waitFor();
      assert.equal(await page.evaluate(() => document === window.initialDocument), true);
      assert.equal(await page.evaluate(() => location.pathname), scenario.next);
      assert.deepEqual(posts, [scenario.next]);
      await page.goBack();
      await page.locator('.tabActive').filter({ hasText: scenario.before }).waitFor();
      assert.equal(await page.evaluate(() => document === window.initialDocument), true);
      assert.equal(await page.evaluate(() => location.pathname), scenario.start);
    } finally {
      await browser.close();
    }
  });
}

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
