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
