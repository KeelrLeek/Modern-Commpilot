const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';

for (const kind of ['activation', 'profiles']) for (const outcome of ['late-response', 'deadline']) test(`${kind} retains its dialog while a native read exceeds 30 seconds (${outcome})`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const list = kind === 'activation' ? '/commpilot/Group/DnActivation/' : '/commpilot/Group/DeviceInventory/';
  const profile = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
  const launch = kind === 'activation' ? '#cp-bulk-activation-launch' : '#cp-bulk-profile-launch';
  const dialog = kind === 'activation' ? '.cp-activation-bulk-dialog' : '.cp-profile-bulk-dialog';
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage(), posts = [];
    page.setDefaultTimeout(6000);
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin);
      if (request.method() === 'POST') {
        const data = new URLSearchParams(request.postData() || '');
        assert.ok(!['apply', 'ok', 'delete'].some(key => data.has(key)), 'fixture only authorizes reads');
        posts.push(url.pathname);
        await held;
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
        <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%">
        <form name="mainForm"><input name="ok" type="button" value="OK"><input name="add" type="button" value="Add"></form>
        </td></tr></table><script>window.redirectPost=function(){};</script></body></html>` });
    });
    await page.goto(origin + list);
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await page.addScriptTag({ path: path.join(runtime, 'src/content', kind === 'activation' ? 'number-activation-bulk.js' : 'profile-bulk.js') });
    await page.evaluate(profile => {
      window.cpListSearch = async () => ({ tooMany: false, rows: [{ cells: ['TRI WX 1234', 'Connect - Mobile'],
        drill: { url: profile, params: { key: 'TRI WX 1234', P_key: 'TRI WX 1234' } } }] });
    }, profile);
    await page.locator(launch).click();
    await page.clock.install();
    const sent = page.waitForRequest(request => request.method() === 'POST');
    if (kind === 'activation') await page.locator('[data-action="scan"]').click();
    else {
      const bytes = await page.evaluate(() => [...cpXlsxBuild([{ name: 'Extensions', headers: ['Extension'],
        rows: [['1234']], widths: [22], textColumns: [0] }])]);
      await page.locator(`${dialog} input[type="file"]`).setInputFiles({ name: 'profiles.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
    }
    await sent;
    await page.clock.runFor(31000);
    await page.locator('[data-action="close"]').evaluate(button => button.click());
    assert.equal(await page.locator(dialog).count(), 1, 'the dialog must still own the pending navigation');
    assert.equal(posts.length, 1, 'timeout cannot start a second request while the first is pending');
    if (outcome === 'late-response') release();
    else await page.clock.runFor(61000);
    await page.waitForFunction(() => {
      const close = document.querySelector('[data-action="close"]');
      return close && !close.disabled && close.textContent === 'Close';
    });
    if (outcome === 'deadline') assert.equal(posts.length, 1, 'the native deadline does not replay a read');
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.locator(dialog).count(), 0, 'ownership is released when the actual operation settles');
  } finally { release(); await browser.close(); }
});

for (const outcome of ['late-response', 'deadline']) test(`numbers sends no lookup with the token of a native read that exceeds 30 seconds (${outcome})`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const list = '/commpilot/Group/GroupDnManagement/index.jsp', edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
  const shell = (inner, token) => `<!doctype html><html><body><form name="leftNavForm"></form>
    <table><tr><td width="82%"><form name="mainForm" action="${list}" method="POST">
    <input name="formtokenserial" value="${token}"><table id="searchTable"><tr><td>
    <select name="findKey0"><option value="Dn" selected>Phone Number</option></select>
    <select name="findOp0"><option value="CONTAINS" selected>Contains</option></select>
    <input name="findValue0" value=""><input type="hidden" name="rowNum" value="0"></td></tr></table>
    <input name="ok" type="button" value="OK"></form>${inner}</td></tr></table>
    <script>window.redirectPost=function(){};</script></body></html>`;
  const row = phone => `<table><tr id="Row1"><td><a class="tableLink">${phone}</a></td>` +
    '<td><a class="tableLink"></a></td>'.repeat(4) + `<td><a class="tableLink">None</a><script>
    document.getElementById('Row1').onclick=function(){redirectPost('${edit}',{key:'${phone}',P_key:'${phone}'});};
    </script></td></tr></table><div>Page 1 of 1</div>`;
  let release, holding;
  const held = new Promise(resolve => { release = resolve; });
  const editHeld = new Promise(resolve => { holding = resolve; });
  try {
    const page = await browser.newPage(), posts = [];
    page.setDefaultTimeout(6000);
    // Each token is single-use: CommPilot replaces it on receipt and bounces a spent one to Login.
    let serial = 1, valid = 't0', editPending = false;
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (request.method() !== 'POST') return route.fulfill({ contentType: 'text/html', body: shell('', valid) });
      const data = new URLSearchParams(request.postData() || '');
      assert.ok(!['apply', 'ok', 'delete'].some(key => data.has(key)), 'fixture only authorizes reads');
      const spent = data.get('formtokenserial') !== valid;
      posts.push({ path: url.pathname, spent, whileEditPending: editPending });
      if (spent) return route.fulfill({ status: 302, headers: { Location: 'http://apps-sbx.avpaas.io/commpilot/Login/' }, body: '' });
      const next = valid = 't' + serial++;
      if (url.pathname === edit) {
        editPending = true;
        holding();
        await held;
        editPending = false;
        return route.fulfill({ contentType: 'text/html', body: shell('<select name="deptDropDownList">' +
          '<option value="0">None</option><option value="b">Basement</option></select>', next) }).catch(() => {});
      }
      const value = data.has('search') ? data.get('findValue0') : null;
      return route.fulfill({ contentType: 'text/html', body: shell(value === null ? '' : value ? row(value) :
        '<table><tr><td class="error">[Error 4027] Please narrow your search, there are 5,000 matching records.</td></tr></table>', next) });
    });
    await page.goto(origin + list);
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/number-bulk.js') });
    await page.locator('#cp-bulk-number-launch').click();
    await page.clock.install();
    const bytes = await page.evaluate(() => [...cpXlsxBuild([{ name: 'Assignments',
      headers: ['Phone Number', 'Department', 'Range End'], rows: [['2245550100', 'Basement', ''],
        ['2245550101', 'Basement', ''], ['2245550102', 'Basement', '']], widths: [23, 34, 23], textColumns: [0, 2] }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({ name: 'numbers.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
    await editHeld;
    const read = posts.length;   // the blank search (too many), the first lookup and the held Edit read
    await page.clock.runFor(31000);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.match(await page.locator('.cp-bulk-status').innerText(), /number 1 of 3/, 'the preview waits for the pending read');
    assert.equal(posts.length, read, 'no lookup goes out while the Edit read still owns the token');
    assert.equal(await page.locator('[data-action="close"]').isDisabled(), true);
    if (outcome === 'late-response') release();
    else await page.clock.runFor(61000);
    await page.waitForFunction(() => !document.querySelector('[data-action="close"]').disabled);
    assert.deepEqual(posts.filter(post => post.spent || post.whileEditPending), [], 'every request carries a live token');
    if (outcome === 'late-response') {
      assert.match(await page.locator('.cp-bulk-preview').innerText(), /3 to change · 0 already correct · 0 errors/);
      assert.equal(await page.evaluate(() => location.pathname), list);
    } else {
      assert.equal(posts.length, read, 'an unanswered read stops the preview instead of looking up more numbers');
      assert.match(await page.locator('.cp-bulk-status').innerText(), /did not return a page/);
    }
  } finally { release(); await browser.close(); }
});
