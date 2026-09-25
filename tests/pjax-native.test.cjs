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

test('Virtual On-Net Add Range reanchors a successful list response but keeps validation errors on the form', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const listPath = '/commpilot/Group/VirtualOnNet/';
    const addPath = `${listPath}AddRange/index.jsp`;
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <input name="formtokenserial" value="token"><table><tr><td width="82%">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const list = shell('Virtual On-Net Users', '<h1>Virtual On-Net Users</h1>' +
      '<input type="button" name="add" value="Add"><input type="button" name="addRange" value="Add Range">');
    const form = error => shell('Virtual On-Net Users Range Add', '<h1>Add Range</h1>' +
      (error ? '<p id="validation-error">Invalid range</p>' : '') +
      '<form name="mainForm" method="post"><input name="lastName" value="Audit">' +
      '<input type="submit" name="ok" value="OK"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const submitted = request.method() === 'POST' &&
        new URLSearchParams(request.postData() || '').has('ok');
      const invalid = new URLSearchParams(request.postData() || '').get('lastName') === 'invalid';
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === addPath ? submitted ? invalid ? form(true) : list : form(false) : list });
    });
    await page.goto(`https://apps-sbx.avpaas.io${listPath}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, {}), addPath);
    await page.getByRole('heading', { name: 'Add Range' }).waitFor();
    await page.locator('input[name="ok"]').click();
    await page.getByRole('heading', { name: 'Virtual On-Net Users' }).waitFor();
    assert.equal(await page.evaluate(() => location.pathname), listPath);
    await page.evaluate(pathname => window.redirectPost(pathname, {}), addPath);
    await page.getByRole('heading', { name: 'Add Range' }).waitFor();
    await page.locator('input[name="lastName"]').fill('invalid');
    await page.locator('input[name="ok"]').click();
    await page.locator('#validation-error').waitFor();
    assert.equal(await page.evaluate(() => location.pathname), addPath);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  } finally { await browser.close(); }
});

test('Group Numbers Edit reanchors a saved list response while keeping validation on the edit form', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const listPath = '/commpilot/Group/GroupDnManagement/index.jsp';
    const editPath = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <input name="formtokenserial" value="token"><table><tr><td width="82%">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const list = shell('Numbers', '<h1>Numbers</h1><select name="findKey0"><option>Phone Number</option></select>');
    const edit = error => shell('Assign Numbers Modify', '<h1>Assign Numbers Modify</h1>' +
      (error ? '<p id="validation-error">Invalid department</p>' : '') +
      '<form name="mainForm" method="post"><input name="department" value="None">' +
      '<input type="submit" name="ok" value="OK"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const submitted = request.method() === 'POST' &&
        new URLSearchParams(request.postData() || '').has('ok');
      const invalid = new URLSearchParams(request.postData() || '').get('department') === 'invalid';
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === editPath ? submitted ? invalid ? edit(true) : list : edit(false) : list });
    });
    await page.goto(`https://apps-sbx.avpaas.io${listPath}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, { key: '+1-2244830030' }), editPath);
    await page.getByRole('heading', { name: 'Assign Numbers Modify' }).waitFor();
    await page.locator('input[name="ok"]').click();
    await page.getByRole('heading', { name: 'Numbers' }).waitFor();
    assert.equal(await page.evaluate(() => location.pathname), listPath);
    await page.evaluate(pathname => window.redirectPost(pathname, { key: '+1-2244830030' }), editPath);
    await page.getByRole('heading', { name: 'Assign Numbers Modify' }).waitFor();
    await page.locator('input[name="department"]').fill('invalid');
    await page.locator('input[name="ok"]').click();
    await page.locator('#validation-error').waitFor();
    assert.equal(await page.evaluate(() => location.pathname), editPath);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  } finally { await browser.close(); }
});

test('service Add and Modify Delete return to their Group list URLs', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const service of ['Auto_Attendant', 'Hunt_Group', 'Call_Center', 'Voice_XML']) {
      const page = await browser.newPage();
      const basePath = `/commpilot/Group/${service}/`;
      const listPath = service === 'Voice_XML' ? `${basePath}index.jsp` : basePath;
      const formPath = service === 'Call_Center' ? `${basePath}AddModify/index.jsp` :
        `${basePath}Add/index.jsp`;
      const modifyPath = service === 'Call_Center' ? formPath : `${basePath}Modify/index.jsp`;
      const addName = ['Hunt_Group', 'Voice_XML'].includes(service) ? 'add' : 'addBasic';
      const shell = content => `<!doctype html><html><head><title>${service}</title></head><body>
        <form name="leftNavForm"></form><input name="formtokenserial" value="token">
        <table><tr><td width="82%">${content}</td></tr></table>
        <script>window.redirectPost=function(){};</script></body></html>`;
      const list = shell(`<h1>Service list</h1><input type="button" name="${addName}" value="Add">`);
      const form = shell('<h1>Service form</h1><form name="mainForm" method="post">' +
        '<input name="unicodeLastName" value="Audit"><input type="submit" name="ok" value="OK">' +
        '<input type="submit" name="delete" value="Delete"></form>');
      await page.route('https://apps-sbx.avpaas.io/**', route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        const submitted = request.method() === 'POST' &&
          /(?:^|&)(?:ok|delete)=/.test(request.postData() || '');
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: pathname === listPath || submitted ? list : form });
      });
      await page.goto(`https://apps-sbx.avpaas.io${listPath}`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ path: pjaxPath });
      await page.evaluate(() => { window.initialDocument = document; });
      await page.evaluate(pathname => window.redirectPost(pathname, {}), formPath);
      await page.getByRole('heading', { name: 'Service form' }).waitFor();
      await page.locator('input[name="ok"]').click();
      await page.getByRole('heading', { name: 'Service list' }).waitFor();
      assert.equal(await page.evaluate(() => location.pathname), listPath, `${service} Add`);
      await page.evaluate(pathname => window.redirectPost(pathname, {}), modifyPath);
      await page.getByRole('heading', { name: 'Service form' }).waitFor();
      await page.locator('input[name="delete"]').click();
      await page.getByRole('heading', { name: 'Service list' }).waitFor();
      assert.equal(await page.evaluate(() => location.pathname), listPath, `${service} Delete`);
      assert.equal(await page.evaluate(() => document === window.initialDocument), true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('a list value opens its row detail even when its legacy click listener is missing', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const listPath = '/commpilot/Group/CPU/';
    const modifyPath = '/commpilot/Group/CPU/Modify/index.jsp';
    const shell = body => `<!doctype html><html><head><title>Call Pickup</title></head><body>
      <input name="formtokenserial" value="token"><table><tr><td width="82%">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const list = shell('<h1>Call Pickup</h1><table><tr id="Row1"><td>' +
      '<a id="Row1Col0" class="tableLink">Audit group</a>' +
      '<script>document.addEventListener("DOMContentLoaded", function () {' +
      'document.getElementById("Row1Col0").addEventListener("click", function () {' +
      `redirectPost('${modifyPath}', { key: 'Audit group', P_key: 'Audit group' });` +
      '});});</script></td></tr></table>');
    const seen = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') seen.push({ pathname,
        params: new URLSearchParams(request.postData() || '') });
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === modifyPath ? shell('<h1>Call Pickup Modify</h1>') : list });
    });
    await page.goto(`https://apps-sbx.avpaas.io${listPath}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.locator('#Row1Col0').click();
    await page.getByRole('heading', { name: 'Call Pickup Modify' }).waitFor();
    assert.equal(await page.evaluate(() => location.pathname), modifyPath);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].params.get('key'), 'Audit group');
  } finally { await browser.close(); }
});

test('Enterprise Trunk final actions post to the routing controller', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const type of ['weighted', 'ordered']) {
      const page = await browser.newPage();
      const modifyPath = '/commpilot/Group/EnterpriseTrunk/Modify/index.jsp';
      const controller = `/commpilot/Group/EnterpriseTrunk/AddUsing${type === 'weighted' ?
        'Weighted' : 'Ordered'}Routing/AddModify/`;
      const listPath = '/commpilot/Group/EnterpriseTrunk/';
      const shell = body => `<!doctype html><html><head><title>Enterprise Trunk</title></head><body>
        <input name="formtokenserial" value="token"><table><tr><td width="82%">${body}</td></tr></table>
        <script>window.redirectPost=function(){};</script></body></html>`;
      const modify = shell('<h1>Modify Enterprise Trunk</h1><form name="mainForm" method="post">' +
        `<input type="hidden" name="enterpriseTrunkType" value="${type}">` +
        `<input type="hidden" name="enterpriseTrunkType" value="${type}">` +
        '<input type="hidden" name="buttonClicked" value="delete">' +
        '<input type="submit" name="delete" value="Delete"></form>');
      const list = shell('<h1>Enterprise Trunk list</h1>' +
        '<input type="button" name="addByWeightedRouting" value="Add By Weighted Routing">');
      const posts = [];
      await page.route('https://apps-sbx.avpaas.io/**', route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (request.method() === 'POST') posts.push(pathname);
        const body = pathname === controller ? '<html><body><input name="formtokenserial" value="token2">' +
          `<script>redirectPost('${listPath}', {});</script></body></html>` :
          pathname === listPath ? list : modify;
        return route.fulfill({ status: 200, contentType: 'text/html', body });
      });
      await page.goto(`https://apps-sbx.avpaas.io${modifyPath}`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ path: pjaxPath });
      await page.evaluate(() => { window.initialDocument = document; });
      await page.locator('input[name="delete"]').click();
      await page.getByRole('heading', { name: 'Enterprise Trunk list' }).waitFor();
      await page.waitForFunction(pathname => location.pathname === pathname, listPath);
      assert.deepEqual(posts, [controller, listPath]);
      assert.equal(await page.evaluate(() => location.pathname), listPath);
      assert.equal(await page.evaluate(() => document === window.initialDocument), true);
      await page.close();
    }
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

test('Audio, User Ringback, Auto Attendant, and Call Center multipart Apply stays in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const scenario of [
      { path: '/commpilot/Group/PreAlertingAnnouncement/', servlet: 'PreAlertingAnnouncementGroupServlet' },
      { path: '/commpilot/User/PreAlertingAnnouncement/', servlet: 'PreAlertingAnnouncementUserServlet' },
      { path: '/commpilot/Group/CustomRingback/', servlet: 'CustomRingbackGroupServlet' },
      { path: '/commpilot/User/CustomRingback/', servlet: 'CustomRingbackUserServlet' },
      { path: '/commpilot/Group/VPBranding/', servlet: 'VPBrandingServlet' },
      { path: '/commpilot/Group/Auto_Attendant/MenuBusinessHours/index.jsp', servlet: 'AASubscriptionServlet' },
      { path: '/commpilot/Group/Call_Center/RoutingPolicies/Overflow/', servlet: 'CallCenterOverflowRoutingPolicyServlet' },
      { path: '/commpilot/Group/Call_Center/RoutingPolicies/Stranded/', servlet: 'CallCenterStrandedCallsRoutingPolicyServlet' },
      { path: '/commpilot/Group/Call_Center/RoutingPolicies/StrandedUnavailable/', servlet: 'CallCenterStrandedCallsUnavailableRoutingPolicyServlet' }
    ]) {
      const page = await browser.newPage();
      const servlet = `/commpilot/servlet/${scenario.servlet}`;
      const shell = token => `<!doctype html><html><head><title>Group audio settings</title></head><body>
        <form name="leftNavForm"><a class="leftnavfolder">Services</a></form>
        <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
        <form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
        <input type="hidden" name="formtokenserial" value="${token}">
        <input type="radio" name="audioSelection" value="system" checked>
        <input type="submit" name="apply" value="Apply"></form>
        <div id="saved">${token === 'token-3' ? 'Saved' : ''}</div></td></tr></table>
        <script>window.redirectPost=function(){};</script></body></html>`;
      let servletPosts = 0;
      await page.route('https://apps-sbx.avpaas.io/**', route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname === servlet && request.method() === 'POST') {
          servletPosts++;
          assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
          assert.ok(request.postDataBuffer().includes(Buffer.from('name="apply"')));
          return route.fulfill({ status: 200, contentType: 'text/html',
            body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
              `redirectPost('${scenario.path}', {});</script></body></html>` });
        }
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: shell(request.method() === 'POST' ? 'token-3' : 'token-1') });
      });
      await page.goto(`https://apps-sbx.avpaas.io${scenario.path}`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ path: pjaxPath });
      await page.evaluate(() => { window.originalDocument = document; });
      await page.locator('input[name="apply"]').click();
      await page.locator('#saved:text-is("Saved")').waitFor();
      assert.equal(await page.evaluate(() => document === window.originalDocument), true);
      assert.equal(servletPosts, 1);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('ordinary form Apply preserves repeated hidden fields and token order', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const pathname = '/commpilot/Group/Call_Center/RoutingPriority/';
    const shell = token => `<!doctype html><html><head><title>Routing Priority</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Call Center</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <form name="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="buttonClicked" value="">
      <input type="submit" name="apply" value="Apply">
      <input type="hidden" name="numRows" value="1">
      <input type="hidden" name="priorityValues" value="">
      <input type="radio" name="policy" value="priority" checked>
      <input type="text" name="ccPriority0" value="1">
      <input type="hidden" name="buttonClicked" value="">
      </form><div id="saved">${token === 'token-2' ? 'Saved' : ''}</div>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    let postCount = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      if (request.method() === 'POST') {
        postCount++;
        const fields = new URLSearchParams(request.postData() || '');
        assert.deepEqual([...fields.keys()], ['formtokenserial', 'buttonClicked', 'apply',
          'numRows', 'priorityValues', 'policy', 'ccPriority0', 'buttonClicked']);
        assert.deepEqual(fields.getAll('buttonClicked'), ['', '']);
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell('token-2') });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell('token-1') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${pathname}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('input[name="apply"]').click();
    await page.locator('#saved:text-is("Saved")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(postCount, 1);
  } finally { await browser.close(); }
});

test('Music on Hold tab submits its multipart servlet in-shell and Back restores General', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const general = '/commpilot/User/MOHUser/';
    const internal = '/commpilot/User/MOHUser/Internal/index.jsp';
    const servlet = '/commpilot/servlet/MusicOnHoldUserServlet';
    const shell = (active, token) => `<!doctype html><html><head><title>Music/Video On Hold</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Call Control</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <div id="view">${active === 'internal' ? 'Internal Calls Settings' : 'General Settings'}</div>
      <form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="tabPage" value="${active}">
      <a class="tab${active === 'internal' ? 'Active' : ''}" id="internal-tab" href="#">Internal Calls Settings</a>
      </form></td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    let servletPosts = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === servlet && request.method() === 'POST') {
        servletPosts++;
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(Buffer.from('name="tabPage"')));
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${internal}', {});</script></body></html>` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(path === internal ? 'internal' : 'general', request.method() === 'POST' ? 'token-3' : 'token-1') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${general}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document;
      document.querySelector('form[name="mainForm"] [name="tabPage"]').value = 'internal';
      document.querySelector('form[name="mainForm"]').submit(); });
    await page.locator('#view:text-is("Internal Calls Settings")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), internal);
    assert.equal(servletPosts, 1);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(path => location.pathname === path &&
      document.querySelector('#view')?.textContent === 'General Settings', general);
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
});

test('Group Music on Hold saves a multipart form without a file in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const add = '/commpilot/Group/MusicOnHold/Add/index.jsp';
    const list = '/commpilot/Group/MusicOnHold/index.jsp';
    const servlet = '/commpilot/servlet/MusicOnHoldServlet';
    const addHtml = `<!doctype html><html><head><title>Music On Hold Add</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Services</a></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
      <input type="hidden" name="formtokenserial" value="token-1">
      <select name="deptEncodedKey"><option value="Basement" selected>Basement</option></select>
      <input type="radio" name="musicOnHoldSourceRadioBtn" value="System" checked>
      <input name="ok" type="submit" value="OK"></form></td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    let servletPosts = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === servlet && request.method() === 'POST') {
        servletPosts++;
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(Buffer.from('name="deptEncodedKey"')));
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${list}', {});</script></body></html>` });
      }
      if (pathname === list) return route.fulfill({ status: 200, contentType: 'text/html',
        body: '<html><head><title>Music On Hold</title></head><body><table><tr><td width="82%">' +
          '<div id="department-row">Basement</div></td></tr></table>' +
          '<input name="formtokenserial" value="token-3"></body></html>' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: addHtml });
    });
    await page.goto(`https://apps-sbx.avpaas.io${add}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('input[name="ok"]').click();
    await page.locator('#department-row:text-is("Basement")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), list);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
});

test('Call Center Announcements short tab ID posts its servlet in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const entrance = '/commpilot/User/Announcements/Entrance/';
    const estimated = '/commpilot/User/Announcements/EstimatedWait/index.jsp';
    const servlet = '/commpilot/servlet/CallCenterAnnouncementsEntranceServlet';
    const shell = (isEstimated, token) => `<!doctype html><html><head><title>Announcements</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <div class="tabActive">${isEstimated ? 'Estimated Wait Message' : 'Entrance Message'}</div>
      <form name="mainForm" action="${servlet}" method="post" enctype="multipart/form-data">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="tabPage" value="">
      ${isEstimated ? '' : '<a class="tab" id="estimated-tab">Estimated Wait Message</a>'}
      </form></td></tr></table>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('estimated-tab')?.addEventListener('click', function () { TabSubmit('estimatedwait'); });
      }); window.redirectPost=function(){};</script></body></html>`;
    let servletPosts = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === servlet && request.method() === 'POST') {
        servletPosts++;
        assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(Buffer.from('name="tabPage"')));
        assert.ok(request.postDataBuffer().includes(Buffer.from('estimatedwait')));
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${estimated}', {});</script></body></html>` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(path === estimated, request.method() === 'POST' ? 'token-3' : 'token-1') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${entrance}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('#estimated-tab').click();
    await page.locator('.tabActive:text-is("Estimated Wait Message")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), estimated);
    assert.equal(servletPosts, 1);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(path => location.pathname === path &&
      document.querySelector('.tabActive')?.textContent === 'Entrance Message', entrance);
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(servletPosts, 1);
  } finally { await browser.close(); }
});

test('Executive Alerting tab uses its controller and keeps the tab URL and Back', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const root = '/commpilot/User/Executive/';
    const alerting = `${root}Alerting/`;
    const shell = (active, token) => `<!doctype html><html><head><title>Executive</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Call Control</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <div class="tabActive">${active}</div><form name="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="tabPage" value="">
      ${active === 'Assistants' ? '<a class="tab" id="alerting-tab">Alerting</a>' : ''}
      </form></td></tr></table><script>
      document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('alerting-tab')?.addEventListener('click', function () {
          TabSubmit('/commpilot/User/Executive/Alerting/'); }); });
      window.redirectPost=function(){};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push({ pathname, body: request.postData() || '' });
      if (pathname === root && request.method() === 'POST' &&
          new URLSearchParams(request.postData() || '').get('tabPage') === alerting)
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${alerting}', {});</script></body></html>` });
      if (pathname === alerting && new URLSearchParams(request.postData() || '').has('tabPage'))
        return route.fulfill({ status: 500, contentType: 'text/html', body: 'Direct tab POST rejected' });
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(pathname === alerting ? 'Alerting' : 'Assistants',
          request.method() === 'POST' ? 'token-3' : 'token-1') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${root}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('#alerting-tab').click();
    await page.locator('.tabActive:text-is("Alerting")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), alerting);
    assert.equal(posts[0].pathname, root);
    assert.equal(new URLSearchParams(posts[0].body).get('tabPage'), alerting);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(path => location.pathname === path &&
      document.querySelector('.tabActive')?.textContent === 'Assistants', root);
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
  } finally { await browser.close(); }
});

test('Call Park Add short tab ID posts the Add controller in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const add = '/commpilot/Group/CallPark/Add/index.jsp';
    const shell = (active, token) => `<!doctype html><html><head><title>Call Park Add</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Services</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <div class="tabActive">${active}</div><form name="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="tabPage" value="">
      <input name="callParkGroupName" value="PJAX Audit Draft">
      ${active === 'Profile' ? '<a class="tab" id="alternate-tab">Alternate Recall User</a>' : ''}
      </form></td></tr></table><script>
      window.validate=function(){ throw new ReferenceError('trim is not defined'); };
      document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('alternate-tab')?.addEventListener('click', function () {
          TabSubmit('altRecallUser'); }); });
      window.redirectPost=function(){};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push({ pathname, body: request.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
        request.method() === 'POST' ? 'Alternate Recall User' : 'Profile',
        request.method() === 'POST' ? 'token-2' : 'token-1') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${add}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('#alternate-tab').click();
    await page.locator('.tabActive:text-is("Alternate Recall User")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].pathname, add);
    assert.equal(new URLSearchParams(posts[0].body).get('tabPage'), 'altRecallUser');
  } finally { await browser.close(); }
});

test('Digit Pattern Criteria short tab ID posts Modify controller in-shell', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const modify = '/commpilot/ServiceProvider/CommBarring/DigitPatternCriteria/Modify/index.jsp';
    const patterns = '/commpilot/ServiceProvider/CommBarring/DigitPatternCriteria/DigitPatterns/';
    const shell = (active, token) => `<!doctype html><html><head><title>Digit Pattern Criteria</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Communication Barring</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <div class="tabActive">${active}</div><form name="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="${token}">
      <input type="hidden" name="tabPage" value="">
      <input type="hidden" name="key" value="PJAX test criterion">
      ${active === 'General' ? '<a class="tab" id="patterns-tab">Digit Patterns</a>' : ''}
      ${active === 'Digit Patterns' ? '<input name="digitPattern"><input name="add" type="submit" value="Add">' : ''}
      </form></td></tr></table><script>
      document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('patterns-tab')?.addEventListener('click', function () {
          TabSubmit('digitpatterns'); }); });
      window.redirectPost=function(){};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push({ pathname, body: request.postData() || '' });
      if (pathname === modify && request.method() === 'POST')
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<html><body><input name="formtokenserial" value="token-2"><script>` +
            `redirectPost('${patterns}', {});</script></body></html>` });
      if (pathname === modify) return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell('General', 'token-1') });
      if (pathname === patterns) return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell('Digit Patterns', request.method() === 'POST' ? 'token-3' : 'token-2') });
      return route.fulfill({ status: 404, contentType: 'text/html', body: 'Invalid tab URL' });
    });
    await page.goto(`https://apps-sbx.avpaas.io${modify}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.originalDocument = document; });
    await page.locator('#patterns-tab').click();
    await page.locator('.tabActive:text-is("Digit Patterns")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), patterns);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].pathname, modify);
    assert.equal(new URLSearchParams(posts[0].body).get('tabPage'), 'digitpatterns');
    assert.equal(new URLSearchParams(posts[0].body).get('key'), 'PJAX test criterion');
    await page.locator('input[name="digitPattern"]').fill('987654321');
    await page.locator('input[name="add"]').click();
    await page.waitForFunction(() =>
      document.querySelector('input[name="formtokenserial"]')?.value === 'token-3');
    assert.equal(posts.at(-1).pathname, patterns);
    assert.equal(new URLSearchParams(posts.at(-1).body).get('digitPattern'), '987654321');
  } finally { await browser.close(); }
});

test('navigation waits for an already sent search POST to rotate the token', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/Members/';
    const next = '/commpilot/User/Addresses/';
    const shell = (token, content) => `<!doctype html><html><head><title>Users</title></head><body>
      <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form>
      <input name="formtokenserial" value="${token}"><table><tr><td width="82%">
      <form name="mainForm" method="post"><input name="formtokenserial" value="${token}">
      <input name="findKey0" value="UserID"><input name="findOp0" value="STARTS_WITH">
      <input name="findValue0" value=""></form><div id="view">${content}</div></td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') {
        const form = new URLSearchParams(request.postData() || '');
        posts.push({ pathname, token: form.get('formtokenserial') });
        if (pathname === list) {
          await new Promise(resolve => setTimeout(resolve, 350));
          return route.fulfill({ status: 200, contentType: 'text/html', body: shell('token-2', 'Search result') });
        }
        if (pathname === next) return route.fulfill({ status: 200, contentType: 'text/html',
          body: shell('token-3', 'Addresses') });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell('token-1', 'Users') });
    });
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(target => {
      window.originalDocument = document;
      window.cpListSearch([], {}).catch(() => {});
      window.redirectPost(target, {});
    }, next);
    await page.locator('#view:text-is("Addresses")').waitFor();
    assert.equal(await page.evaluate(() => document === window.originalDocument), true);
    assert.deepEqual(posts, [
      { pathname: list, token: 'token-1' },
      { pathname: next, token: 'token-2' }
    ]);
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

test('Scheduled Reports Completed tab stays inside its folder and Back restores Active', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/CCScheduledReports/';
    const completed = '/commpilot/Group/CCScheduledReports/Completed/';
    const shell = active => `<!doctype html><html><head><title>Scheduled Reports</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Group</span></td></tr></table>
      <form name="leftNavForm"><a class="leftnavfolder">Call Center</a></form>
      <input name="formtokenserial" value="token"><table><tr><td width="82%">
      <form name="mainForm"><span class="tabActive">${active}</span>
      <a id="report-tab" class="tab">${active === 'Active' ? 'Completed' : 'Active'}</a></form>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('report-tab').addEventListener('click', function () {
          TabSubmit('../${active === 'Active' ? 'Completed' : 'Active'}/');
        });
      });</script></td></tr></table>
      <script>window.redirectPost = function() {};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      return route.fulfill({status:200,contentType:'text/html',
        body:shell(pathname === completed ? 'Completed' : 'Active')});
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, {waitUntil:'domcontentloaded'});
    await page.addScriptTag({path:pjaxPath});
    await page.evaluate(() => {window.initialDocument=document;});
    await page.locator('#report-tab').click();
    await page.waitForFunction(pathname => location.pathname === pathname, completed);
    assert.equal(posts[0],completed);
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
    await page.goBack();
    await page.waitForFunction(pathname => location.pathname === pathname &&
      !!document.querySelector('.tabActive')?.textContent.includes('Active'),list);
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
  } finally { await browser.close(); }
});

test('Calling Plan query-string tab stays in PJAX and Back restores Originating', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({executablePath:chromePath,headless:true});
  try {
    const page = await browser.newPage();
    const pathname = '/commpilot/Group/Calling_Plan/Outgoing/index.jsp';
    const target = pathname + '?TransferForward=1&isEnh=true';
    const shell = forwarded => `<!doctype html><html><head><title>Outgoing Calling Plan</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Group</span></td></tr></table>
      <form name="leftNavForm"><a class="leftnavfolder">Calling Plan</a></form>
      <input name="formtokenserial" value="token"><table><tr><td width="82%">
      <form name="mainForm"><span class="tabActive">${forwarded ? 'Initiating Call Forwards/Transfers' : 'Originating'}</span>
      <a id="calling-tab" class="tab">${forwarded ? 'Originating' : 'Initiating Call Forwards/Transfers'}</a></form>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('calling-tab').addEventListener('click', function () {
          TabSubmit('${forwarded ? pathname : target}');
        });
      });</script></td></tr></table>
      <script>window.redirectPost = function() {};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      if (route.request().method() === 'POST') posts.push(route.request().url());
      return route.fulfill({status:200,contentType:'text/html',
        body:shell(new URL(route.request().url()).searchParams.has('TransferForward'))});
    });
    await page.goto('https://apps-sbx.avpaas.io' + pathname,{waitUntil:'domcontentloaded'});
    await page.addScriptTag({path:pjaxPath});
    await page.evaluate(() => {window.initialDocument=document;});
    await page.locator('#calling-tab').click();
    await page.waitForFunction(() => location.search.includes('TransferForward=1'));
    assert.equal(new URL(posts[0]).pathname + new URL(posts[0]).search,target);
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
    await page.goBack();
    await page.waitForFunction(() => !location.search &&
      document.querySelector('.tabActive')?.textContent === 'Originating');
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
  } finally {await browser.close();}
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

test('Xsi Policy Profile tab after Find resolves from the list landing', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({executablePath:chromePath,headless:true});
  try {
    const page = await browser.newPage();
    const group = '/commpilot/ServiceProvider/XsiPolicyProfile/Group/';
    const user = '/commpilot/ServiceProvider/XsiPolicyProfile/User/';
    const find = '/commpilot/Common/find.jsp';
    const shell = active => `<!doctype html><html><head><title>Xsi Policy Profile</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Service Provider</span></td></tr></table>
      <form name="leftNavForm"><a class="leftnavfolder">Resources</a></form>
      <input name="formtokenserial" value="token"><table><tr><td width="82%">
      <form name="mainForm"><span class="tabActive">${active} Xsi Policy Profile</span>
      <a id="xsi-tab" class="tab">${active === 'Group' ? 'User' : 'Group'} Xsi Policy Profile</a></form>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('xsi-tab').addEventListener('click', function () {
          tabSubmit('../${active === 'Group' ? 'User' : 'Group'}/');
        });
      });</script></td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      const body = pathname === find ? '<!doctype html><input name="formtokenserial" value="token">' +
        '<script>redirectPost("/commpilot/ServiceProvider/XsiPolicyProfile/Group/",{});</script>' :
        shell(pathname === user ? 'User' : 'Group');
      return route.fulfill({status:200,contentType:'text/html',body});
    });
    await page.goto('https://apps-sbx.avpaas.io' + group,{waitUntil:'domcontentloaded'});
    await page.addScriptTag({path:pjaxPath});
    await page.evaluate(() => {window.initialDocument=document;window.redirectPost('/commpilot/Common/find.jsp',{});});
    await page.waitForFunction(pathname => location.pathname === pathname,find);
    await page.locator('#xsi-tab').click();
    await page.waitForFunction(pathname => location.pathname === pathname,user);
    assert.deepEqual(posts.slice(0,3),[find,group,user]);
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
    await page.goBack();
    await page.waitForFunction(pathname => location.pathname === pathname &&
      document.querySelector('.tabActive')?.textContent.includes('Group'),find);
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
  } finally {await browser.close();}
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

test('activation Modify OK returns to the list URL after the server renders search controls', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/DnActivation/';
    const modify = '/commpilot/Group/DnActivation/Modify/index.jsp';
    const shell = (title, content) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Group</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%">${content}</td></tr></table>
      <script>window.redirectPost = function() {};</script>
    </body></html>`;
    const listBody = shell('Activate Numbers', '<h1>Activate Numbers</h1><form name="mainForm">' +
      '<select name="findKey"><option>Phone Numbers</option></select>' +
      '<a id="edit">Edit</a></form>');
    const modifyBody = shell('Activate Numbers Modify', '<h1>Activate Numbers Modify</h1>' +
      '<form name="mainForm" method="post"><input type="hidden" name="buttonClicked" value="">' +
      '<input type="submit" name="ok" value="OK"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const submitted = pathname === modify && (request.postData() || '').includes('ok=OK');
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === list || submitted ? listBody : modifyBody });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, { key: '+1-2244830998' }), modify);
    await page.getByRole('heading', { name: 'Activate Numbers Modify' }).waitFor();
    await page.locator('input[name="ok"]').click();
    await page.getByRole('heading', { name: 'Activate Numbers', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => location.pathname), list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  } finally { await browser.close(); }
});

test('Tag Set Add and filtered Apply keep their owning controller in PJAX', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const parent = '/commpilot/Operator/System/DeviceTags/Modify/TagSet/index.jsp';
    const add = '/commpilot/Operator/System/DeviceTags/Modify/TagSet/Add/index.jsp';
    const find = '/commpilot/Common/find.jsp';
    const posts = [];
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const parentBody = shell('Device Management Tag Sets Modify',
      '<h1>Device Management Tag Sets Modify</h1>' +
      '<form name="mainForm" method="post"><input name="newTagSetName" value="Audit Set">' +
      '<input name="checkbox_%PJAX_AUDIT%" type="checkbox">' +
      '<input name="findValue"><input name="apply" type="submit" value="Apply"></form>');
    const addBody = shell('Device Management Tag Sets Add Tag',
      '<h1>Device Management Tag Sets Add Tag</h1><form name="mainForm" method="post">' +
      '<input name="tagName"><input name="tagValue">' +
      '<input name="ok" type="submit" value="OK"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push({ pathname, body: request.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === add && !(request.postData() || '').includes('ok=OK') ?
          addBody : parentBody });
    });
    await page.goto('https://apps-sbx.avpaas.io' + parent, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, {}), add);
    await page.getByRole('heading', { name: 'Device Management Tag Sets Add Tag' }).waitFor();
    await page.locator('input[name="tagName"]').fill('PJAX_AUDIT');
    await page.locator('input[name="tagValue"]').fill('AUDIT_ONLY');
    await page.locator('input[name="ok"]').click();
    await page.getByRole('heading', { name: 'Device Management Tag Sets Modify' }).waitFor();
    assert.equal(await page.evaluate(() => location.pathname), parent);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.ok(posts.some(post => post.pathname === add &&
      post.body.includes('tagName=PJAX_AUDIT') && post.body.includes('ok=OK')));

    await page.evaluate(pathname => window.redirectPost(pathname, {}), find);
    await page.waitForFunction(pathname => location.pathname === pathname, find);
    await page.locator('input[name="checkbox_%PJAX_AUDIT%"]').check();
    await page.locator('input[name="apply"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, parent);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.ok(posts.some(post => post.pathname === parent &&
      post.body.includes('checkbox_%25PJAX_AUDIT%25=on') && post.body.includes('apply=Apply')));
  } finally {
    await browser.close();
  }
});

test('Hunt Group Profile Apply keeps Modify URL when its form has an embedded search', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const folder = '/commpilot/Common/folder_contents.jsp';
    const modify = '/commpilot/Group/Hunt_Group/Modify/index.jsp';
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Hunt Group</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    const profile = shell('StanMikitaHG: Hunt Group Profile',
      '<h1>Hunt Group Profile</h1><form name="mainForm" method="post">' +
      '<input name="unicodeLastName" value="Stan Mikita">' +
      '<select name="findKey0"><option>Agent</option></select>' +
      '<input name="apply" type="submit" value="Apply"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === modify ? profile : shell('Folder', '<h1>Folder</h1>') });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folder, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, {}), modify);
    await page.getByRole('heading', { name: 'Hunt Group Profile' }).waitFor();
    const saved = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === modify);
    await page.locator('input[name="apply"]').click();
    await saved;
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), modify);
  } finally {
    await browser.close();
  }
});

test('Service Pack Migration wizard keeps its named popup target', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const base = '/commpilot/ServiceProvider/ServicePackMigration/';
    await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: `<!doctype html><html><head><title>Migration</title></head>
        <body><table><tr><td class="headerBar">Service Provider</td></tr></table>
        <form name="leftNavForm"></form><input name="formtokenserial" value="token">
        <table><tr><td width="82%"><h1>Migration</h1></td></tr></table>
        <script>window.redirectPost=function(url,params){window.nativeNavigation={url,params};};</script>
        </body></html>`
    }));
    await page.goto('https://apps-sbx.avpaas.io' + base, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => {
      window.wizardWin = { win: { closed: false } };
      window.initialDocument = document;
      window.redirectPost('Wizard/index.jsp', {});
    });
    assert.equal(await page.evaluate(() => window.nativeNavigation.url),
      '/commpilot/ServiceProvider/ServicePackMigration/Wizard/index.jsp');
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.evaluate(() => location.pathname), base);
  } finally { await browser.close(); }
});

test('filtered Reseller Tag Sets Delete posts to its owning list', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Reseller/DeviceTags/';
    const find = '/commpilot/Common/find.jsp';
    const posts = [];
    const html = `<!doctype html><html><head><title>Device Management Tag Sets</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
      <form name="leftNavForm"></form><table><tr><td width="82%">
      <h1>Device Management Tag Sets</h1><form name="mainForm" method="post">
      <input name="hiddenCheckbox_PJAX_AUDIT_SET" type="checkbox" value="true">
      <input name="apply" type="submit" value="Apply"></form></td></tr></table>
      <input name="formtokenserial" value="token">
      <script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const req = route.request();
      if (req.method() === 'POST') posts.push({
        path: new URL(req.url()).pathname, body: req.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, {
      returnPage: '/Reseller/DeviceTags/', tableName: 'resellerTagSetTable',
      key: '2', op: '2', value: 'PJAX_AUDIT_SET'
    }), find);
    await page.waitForFunction(pathname => location.pathname === pathname, find);
    await page.locator('input[name="hiddenCheckbox_PJAX_AUDIT_SET"]').check();
    await page.locator('input[name="apply"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.ok(posts.some(post => post.path === list &&
      post.body.includes('hiddenCheckbox_PJAX_AUDIT_SET=true') &&
      post.body.includes('apply=Apply')));
    assert.ok(!posts.some(post => post.path === find && post.body.includes('apply=Apply')));
  } finally { await browser.close(); }
});

test('filtered Device Families Delete uses its returnPage controller', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Reseller/DeviceFamilies/';
    const find = '/commpilot/Common/find.jsp';
    const posts = [];
    const html = `<!doctype html><html><head><title>Device Management Device Families</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
      <form name="leftNavForm"></form><table><tr><td width="82%">
      <h1>Device Management Device Families</h1><form name="mainForm" method="post">
      <input name="hiddenCheckbox_PJAX_AUDIT_FAMILY" type="checkbox" value="true">
      <input name="apply" type="submit" value="Apply"></form></td></tr></table>
      <input name="formtokenserial" value="token">
      <script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      if (request.method() === 'POST') posts.push({ path: new URL(request.url()).pathname,
        body: request.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, {
      returnPage: '/Reseller/DeviceFamilies/', tableName: 'resellerDeviceFamilyTable',
      key: '2', op: '2', value: 'PJAX_AUDIT_FAMILY'
    }), find);
    await page.waitForFunction(pathname => location.pathname === pathname, find);
    await page.locator('input[name="hiddenCheckbox_PJAX_AUDIT_FAMILY"]').check();
    await page.locator('input[name="apply"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.ok(posts.some(post => post.path === list &&
      post.body.includes('hiddenCheckbox_PJAX_AUDIT_FAMILY=true') &&
      post.body.includes('apply=Apply')));
  } finally { await browser.close(); }
});

test('Communication Barring profile selection and Delete survive a filtered list', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/ServiceProvider/CommBarring/Profiles/';
    const find = '/commpilot/Common/find.jsp';
    const general = `${list}General/index.jsp`;
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Service Provider</span></td></tr></table>
      <form name="leftNavForm"></form><table><tr><td width="82%">${body}</td></tr></table>
      <input name="formtokenserial" value="token">
      <script>window.redirectPost=function(){};</script></body></html>`;
    const listHtml = shell('Communication Barring Profiles',
      '<h1>Communication Barring Profiles</h1><form name="mainForm" method="post">' +
      '<input name="profileSelected" type="hidden" value="">' +
      '<input id="PJAX Audit CB" name="checkbox___DFLT_COL_ID____DELIMITER__PJAX Audit CB" ' +
      'type="checkbox"><input name="hiddenCheckbox_PJAX Audit CB" type="hidden" value="true">' +
      '<input name="add" type="button" value="Add">' +
      '<input name="apply" type="submit" value="Apply"></form>');
    const generalHtml = shell('Communication Barring Profile',
      '<h1>Communication Barring Profile</h1><form name="mainForm" method="post">' +
      '<input name="delete" type="submit" value="Delete"></form>');
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'POST') posts.push({ path, body: req.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: path === general && !(req.postData() || '').includes('delete=Delete') ?
          generalHtml : listHtml });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, {
      returnPage: '/ServiceProvider/CommBarring/Profiles/', tableName: 'spCBProfileTable',
      key: '1', op: '2', value: 'PJAX Audit CB'
    }), find);
    await page.waitForFunction(pathname => location.pathname === pathname, find);
    await page.locator('input[type="checkbox"]').check();
    assert.equal(await page.locator('input[name="profileSelected"]').inputValue(), 'PJAX Audit CB');
    await page.locator('input[type="checkbox"]').uncheck();
    assert.equal(await page.locator('input[name="profileSelected"]').inputValue(), '');
    await page.evaluate(pathname => window.redirectPost(pathname, {}), general);
    await page.waitForFunction(pathname => location.pathname === pathname, general);
    await page.locator('input[name="delete"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.ok(posts.some(post => post.path === general && post.body.includes('delete=Delete')));
  } finally { await browser.close(); }
});

test('User Profile Delete returns to the owning Group Users list', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/Members/';
    const modify = '/commpilot/Group/Members/Modify/index.jsp';
    const profile = '/commpilot/User/Profile/';
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Group</span></td></tr></table>
      <form name="leftNavForm"></form><table><tr><td width="82%">${body}</td></tr></table>
      <input name="formtokenserial" value="token">
      <script>window.redirectPost=function(){};</script></body></html>`;
    const listHtml = shell('Group Users', '<h1>Users</h1><form name="mainForm">' +
      '<select name="findKey0"><option>User ID</option></select>' +
      '<input name="findValue0"><input name="add" type="button" value="Add"></form>');
    const profileHtml = shell('User Profile', '<h1>User Profile</h1>' +
      '<form name="mainForm" method="post"><input name="unicodeLastName" value="Audit">' +
      '<input name="delete" type="submit" value="Delete"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === profile && !(request.postData() || '').includes('delete=Delete') ?
          profileHtml : pathname === modify ? shell('User entry', '<h1>User entry</h1>') : listHtml });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, { key: 'pjaxaudit' }), modify);
    await page.waitForFunction(pathname => location.pathname === pathname, modify);
    await page.evaluate(pathname => window.redirectPost(pathname, {}), profile);
    await page.waitForFunction(pathname => location.pathname === pathname, profile);
    await page.locator('input[name="delete"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.getByRole('heading', { name: 'Users' }).count(), 1);
  } finally { await browser.close(); }
});

test('Group Administrator Delete posts to Modify rather than its context endpoint', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const context = '/commpilot/Group/Admins/modify.jsp';
    const modify = '/commpilot/Group/Admins/Modify/';
    const list = '/commpilot/Group/Admins/';
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Group</span></td></tr></table>
      <form name="leftNavForm"></form><table><tr><td width="82%">${body}</td></tr></table>
      <input name="formtokenserial" value="token">
      <script>window.redirectPost=function(){};</script></body></html>`;
    const form = shell('Administrator Modify', '<h1>Administrator Modify</h1>' +
      '<form name="mainForm" method="post"><input name="userId" value="pjaxadm">' +
      '<input name="password" type="password"><input name="delete" type="submit" value="Delete"></form>');
    const listing = shell('Administrators', '<h1>Administrators</h1>' +
      '<form name="mainForm"><input name="add" type="button" value="Add"></form>');
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST') posts.push(path);
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: path === context ? form : listing });
    });
    await page.goto('https://apps-sbx.avpaas.io' + context, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.locator('input[name="delete"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.ok(posts.includes(modify));
    assert.ok(!posts.includes(context));
  } finally { await browser.close(); }
});

test('Group Profile Delete returns to the Service Provider Groups list', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/ServiceProvider/Members/';
    const modify = '/commpilot/ServiceProvider/Members/Modify/index.jsp';
    const profile = '/commpilot/Group/Profile/';
    const shell = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Service Provider</span></td></tr></table>
      <form name="leftNavForm"></form><table><tr><td width="82%">${body}</td></tr></table>
      <input name="formtokenserial" value="token">
      <script>window.redirectPost=function(){};</script></body></html>`;
    const listHtml = shell('Groups', '<h1>Groups</h1><form name="mainForm">' +
      '<select name="findKey0"><option>Group ID</option></select>' +
      '<input name="findValue0"><input name="add" type="button" value="Add"></form>');
    const profileHtml = shell('Group Profile', '<h1>Group Profile</h1>' +
      '<form name="mainForm" method="post"><input name="unicodeCompanyName" value="Audit">' +
      '<input name="delete" type="submit" value="Delete"></form>');
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: pathname === profile && !(request.postData() || '').includes('delete=Delete') ?
          profileHtml : pathname === modify ? shell('Group entry', '<h1>Group entry</h1>') : listHtml });
    });
    await page.goto('https://apps-sbx.avpaas.io' + list, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(pathname => window.redirectPost(pathname, { key: 'pjaxgrp' }), modify);
    await page.waitForFunction(pathname => location.pathname === pathname, modify);
    await page.evaluate(pathname => window.redirectPost(pathname, {}), profile);
    await page.waitForFunction(pathname => location.pathname === pathname, profile);
    await page.locator('input[name="delete"]').click();
    await page.waitForFunction(pathname => location.pathname === pathname, list);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
    assert.equal(await page.getByRole('heading', { name: 'Groups' }).count(), 1);
  } finally { await browser.close(); }
});

test('Back from a Group child restores User context before replaying Addresses', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const startPath = '/commpilot/Group/Members/';
    const entryPath = '/commpilot/Group/Members/Modify/index.jsp';
    const addressesPath = '/commpilot/User/Addresses/';
    const childPath = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
    const posts = [];
    let context = 'group';
    const shell = (title, folder, body, script = '') => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">${title}</span></td></tr></table>
      <form name="leftNavForm"><a class="leftnavfolder">${folder}</a></form>
      <input name="formtokenserial" value="token"><table><tr><td width="82%"><h1>${body}</h1>${script}</td></tr></table>
      <script>window.redirectPost = function() {};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      let body;
      if (pathname === entryPath) {
        context = 'user';
        body = shell('User menu', 'User Profile', 'User menu');
      } else if (pathname === childPath) {
        context = 'device';
        body = shell('Device profile', 'Device Resources', 'Device profile');
      } else if (pathname === addressesPath) {
        body = context === 'user' ? shell('Addresses', 'User Profile', 'Addresses') :
          shell('Addresses', 'User Profile', 'Addresses',
            '<script>window.redirectPost("/commpilot/Login/", {});</script>');
      } else body = shell('Group members', 'Group Profile', 'Group members');
      return route.fulfill({status:200,contentType:'text/html',body});
    });
    await page.goto('https://apps-sbx.avpaas.io' + startPath, {waitUntil:'domcontentloaded'});
    await page.addScriptTag({path:pjaxPath});
    await page.evaluate(() => {window.initialDocument=document;});
    await page.evaluate(pathname => window.redirectPost(pathname,{key:'test-user'}),entryPath);
    await page.getByRole('heading',{name:'User menu'}).waitFor();
    await page.evaluate(pathname => window.redirectPost(pathname,{}),addressesPath);
    await page.getByRole('heading',{name:'Addresses'}).waitFor();
    await page.evaluate(pathname => window.redirectPost(pathname,{name:'test-device'}),childPath);
    await page.getByRole('heading',{name:'Device profile'}).waitFor();
    const beforeBack = posts.length;
    await page.goBack();
    await page.getByRole('heading',{name:'Addresses'}).waitFor();
    assert.deepEqual(posts.slice(beforeBack),[entryPath,addressesPath]);
    assert.equal(await page.evaluate(() => location.pathname),addressesPath);
    assert.equal(await page.evaluate(() => document === window.initialDocument),true);
  } finally { await browser.close(); }
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

test('Personal Assistant script redirect after Add reads back the saved rule without a second POST or Login', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const listPath = '/commpilot/User/PersonalAssistant/';
    const addPath = `${listPath}Add/index.jsp`;
    let addPosts = 0;
    let listReads = 0;
    let saved = false;
    const shell = (title, content) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Test User</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%">${content}</td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === addPath && request.method() === 'POST' &&
          new URLSearchParams(request.postData() || '').has('ok')) {
        addPosts++;
        saved = true;
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: '<script>top.location.replace("../");</script>' });
      }
      if (pathname === listPath && request.method() === 'POST') listReads++;
      const content = pathname === addPath ?
        '<form name="mainForm" method="POST"><input name="criteriaName"><input type="submit" name="ok" value="OK"></form>' :
        `<h1>Personal Assistant</h1><input type="button" name="add" value="Add">${saved ?
          '<table><tr id="Row1"><td>PJAX saved criterion</td></tr></table>' : ''}`;
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(pathname === addPath ? 'Personal Assistant Schedule Selective Criteria Add' :
          'Personal Assistant', content) });
    });
    await page.goto(`https://apps-sbx.avpaas.io${listPath}`);
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(url => window.redirectPost(url, {}), addPath);
    await page.locator('input[name="criteriaName"]').fill('PJAX saved criterion');
    await page.locator('input[name="ok"]').click();
    await page.waitForFunction(path => location.pathname === path &&
      document.querySelector('#Row1')?.textContent.includes('PJAX saved criterion'), listPath);
    assert.equal(addPosts, 1);
    assert.ok(listReads >= 1);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  } finally { await browser.close(); }
});

test('Personal Assistant Delete replaces the stale invalid-criterion page with the verified list', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const listPath = '/commpilot/User/PersonalAssistant/';
    const modifyPath = `${listPath}Modify/index.jsp`;
    let deleted = false;
    let deletes = 0;
    const shell = (title, content) => `<!doctype html><html><head><title>${title}</title></head><body>
      <table><tr><td class="headerBar"><span class="headerAuthLevel">Test User</span></td></tr></table>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%">${content}</td></tr></table>
      <script>window.redirectPost = function(url, params) { window.nativeNavigation = {url, params}; };</script>
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const params = new URLSearchParams(request.postData() || '');
      if (pathname === modifyPath && params.has('delete')) {
        deletes++;
        deleted = true;
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
          'Personal Assistant Schedule Selective Criteria Modify',
          '<h1>Personal Assistant Schedule Selective Criteria Modify</h1>' +
          '<p>Failed to read: [Error 5021] Invalid selective criteria name PJAX delete criterion.</p>') });
      }
      const content = pathname === modifyPath ?
        '<form name="mainForm" method="POST"><input name="criteriaName" value="PJAX delete criterion">' +
          '<input type="submit" name="delete" value="Delete"></form>' :
        `<h1>Personal Assistant</h1><input type="button" name="add" value="Add">${deleted ? '' :
          '<table><tr id="Row1"><td>PJAX delete criterion</td></tr></table>'}`;
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(pathname === modifyPath ? 'Personal Assistant Schedule Selective Criteria Modify' :
          'Personal Assistant', content) });
    });
    await page.goto(`https://apps-sbx.avpaas.io${listPath}`);
    await page.addScriptTag({ path: pjaxPath });
    await page.evaluate(() => { window.initialDocument = document; });
    await page.evaluate(url => window.redirectPost(url, { key: 'PJAX delete criterion' }), modifyPath);
    await page.locator('input[name="delete"]').click();
    await page.waitForFunction(path => location.pathname === path &&
      !!document.querySelector('h1') && !document.querySelector('#Row1'), listPath);
    assert.equal(deletes, 1);
    assert.equal(await page.evaluate(() => document === window.initialDocument), true);
  } finally { await browser.close(); }
});

test('native Group Directory exposes the legacy two-workbook export without the old grid', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    const directory = `<!doctype html><html><head><title>Test Group: Group Directory</title></head><body>
      <form name="leftNavForm"></form><input name="formtokenserial" value="token">
      <table><tr><td width="82%"><form name="mainForm">
        <input name="formtokenserial" value="token"><input name="xslURL" value="bglist_detail.xsl">
        <table id="searchTable"><tr><td><select id="findKey0" name="findKey0">
          <option value="UserLastName">Last Name</option>
          <option value="ExactUserDepartment">Department</option>
        </select><input name="findValue0"></td></tr></table>
      </form></td></tr></table>
      <script>window.redirectPost = function() {};</script></body></html>`;
    const report = `<report><colHeading>Name</colHeading><colHeading>User Id</colHeading>
      <colHeading>First Name</colHeading><colHeading>Last Name</colHeading>
      <colHeading>Service Name</colHeading><colHeading>Department</colHeading>
      <colHeading>Number</colHeading><colHeading>Extension</colHeading>
      <colHeading>E-mail Address</colHeading>
      <row><col>Doe, Jane</col><col>jane@example.test</col><col>Jane</col><col>Doe</col><col/>
      <col>Support</col><col>+15551230000</col><col>1000</col><col>jane@example.test</col></row>
      <row><col>Support Queue</col><col>queue@example.test</col><col/><col/><col>Hunt Group</col>
      <col>Support</col><col>+15551230001</col><col>1001</col><col/></row></report>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      if (new URL(request.url()).pathname === '/commpilot/servlet/ClientBGListServlet') {
        requests.push(new URLSearchParams(request.postData() || ''));
        return route.fulfill({ status: 200, contentType: 'text/xml', body: report });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: directory });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/CompanyDir/');
    await page.addScriptTag({ path: pjaxPath });
    await page.locator('#cp-native-directory-export').waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('cp:reskin')));
    assert.equal(await page.locator('#cp-native-directory-export').count(), 1);
    await page.locator('#cp-native-directory-export').click();
    await page.locator('.cp-uxp-start').click();
    await page.getByText('Export complete', { exact: true }).waitFor();
    assert.match(await page.locator('.cp-uxp-n').innerText(), /1 users exported/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].get('xslURL'), 'bglist_detail.xsl');
    assert.equal(requests[0].get('formtokenserial'), 'token');
    await page.locator('.cp-uxp-cancel').click();
    await page.locator('#cp-native-directory-export').click();
    await page.locator('input[name="cp-uxp-mode"][value="all"]').check();
    await page.locator('.cp-uxp-start').click();
    await page.getByText('Export complete', { exact: true }).waitFor();
    assert.match(await page.locator('.cp-uxp-n').innerText(), /2 entries exported/);
    assert.equal(requests.length, 2);
  } finally { await browser.close(); }
});
