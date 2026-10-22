const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const valid = { name: 'Profile', options: [
  { label: 'Groups', group: 'Basic', url: '/commpilot/Reseller/Groups/', params: {} },
  { label: 'Administrators', group: 'Advanced', url: '/commpilot/Reseller/Admins/', params: { mode: 'list' } }
] };

async function fixture(data, check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), requests = [], errors = [], warnings = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    await page.route('**/*', route => {
      requests.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body id="initBody.menuTemplate">
        <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
        <form name="leftNavForm"><a class="leftnavfolder" onclick="redirectPost('/commpilot/Common/folder_contents.jsp',{folder:'R0',menuId:'8'})">Profile</a></form>
        <table><tr><td width="82%"><form name="mainForm"><h1>Groups</h1></form></td></tr></table>
        <script>window.redirectPost=function(){};</script></body></html>` });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/');
    await page.evaluate(data => sessionStorage.setItem('cp-page-menu:Profile|Reseller', JSON.stringify(data)), data);
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await check(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings.filter(message => /\[pjax\] (?:page|board) menu/.test(message)), [],
      'damaged cached entries do not repeatedly throw during decoration');
    assert.deepEqual(requests.filter(request => request.startsWith('POST ')), [], 'reading menus never submits a PBX request');
  } finally { await browser.close(); }
}

for (const [name, bad] of [
  ['null folder', null], ['folder without options', { name: 'Incomplete' }],
  ['non-array options', { name: 'Incomplete', options: {} }],
  ['null option', { name: 'Incomplete', options: [null] }]
]) test(`cached page menu keeps valid folders beside a ${name}`, () => fixture({ folders: [bad, valid] }, async page => {
  const pill = page.locator('.cp-page-pill');
  await pill.waitFor();
  assert.equal(await pill.innerText(), 'Groups');
  await pill.click();
  assert.deepEqual(await page.locator('.cp-page-item').allInnerTexts(), ['Groups', 'Administrators']);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.cp-page-menu').count(), 0);
}));

for (const folders of [{}, 'broken']) test(`invalid cached folders ${typeof folders} leave native navigation usable`, () =>
  fixture({ folders }, async page => {
    assert.equal(await page.locator('.cp-page-pill').count(), 0);
    assert.equal(await page.locator('a.leftnavfolder').innerText(), 'Profile');
    await page.evaluate(() => document.dispatchEvent(new Event('cp:reskin')));
  }));

test('a valid cached page menu still opens with its native options', () => fixture({ folders: [valid] }, async page => {
  await page.locator('.cp-page-pill').click();
  assert.deepEqual(await page.locator('.cp-page-item').allInnerTexts(), ['Groups', 'Administrators']);
}));
