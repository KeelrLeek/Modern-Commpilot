const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const folderPath = '/commpilot/Common/folder_contents.jsp';
const esc = url => url.replace(/\//g, '\\u002F');

// A folder menu as CommPilot renders it: category headings, links, and one wiring script per link.
function menu(items) {
  let rows = '', category = null;
  for (const [cat, id, label, url, params] of items) {
    if (cat !== category) { rows += `<tr><td class="menuCategory">${cat}</td></tr>`; category = cat; }
    rows += `<tr><td><a class="navMenuItem" id="${id}" name="${url.replace('/commpilot', '')}">${label}</a>
      <script>document.addEventListener('DOMContentLoaded', function () { var elem = document.getElementById('${id}');
        elem.addEventListener('click', function (event) { redirectPost('${esc(url)}', ${params || '{}'}); }); });</script></td></tr>
      <tr><td>About ${label}.</td></tr>`;
  }
  return `<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table><tbody>${rows}</tbody></table></td></tr></tbody></table>`;
}
const menus = {
  R0: menu([['BASIC', 'link_groups', 'Groups', '/commpilot/Reseller/Groups/'],
    ['ADVANCED', 'link_admins', 'Administrators', '/commpilot/Reseller/Admins/', "{mode:'list'}"]]),
  R1: menu([['BASIC', 'link_domains', 'Domains', '/commpilot/Reseller/Domains/'],
    ['BASIC', 'link_numbers', 'Numbers', '/commpilot/Reseller/DnManagement/']])
};
function shell(body, title) {
  return `<!doctype html><html><head><title>${title}</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
    <form name="leftNavForm">
      <a class="leftnavfolderopen" onclick="redirectPost('${folderPath}', {folder:'R0', menuId:'8'})">Profile</a>
      <a class="leftnavfolder" onclick="redirectPost('${folderPath}', {folder:'R1', menuId:'8'})">Resources</a></form>
    <input name="formtokenserial" value="token-1">
    <table height="100%"><tr><td width="82%" valign="top">${body}</td></tr></table>
    <script>window.redirectPost=function(){};</script></body></html>`;
}

test('a board page’s options become a breadcrumb page menu on the level’s other pages', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const requests = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      const params = new URLSearchParams(req.postData() || '');
      requests.push({ pathname, params });
      if (pathname === folderPath) return route.fulfill({ status: 200, contentType: 'text/html', body: shell(menus[params.get('folder') || 'R0'], 'Profile') });
      const title = pathname.split('/').filter(Boolean).pop();
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell(`<h1>${title}</h1>`, title) });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folderPath, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ path: path.join(root, 'src/content/menu-board.css') });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'atlas'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => Object.keys(sessionStorage).some(k => k.startsWith('cp-page-menu:')), null, { timeout: 15000 });
    assert.equal(await page.locator('.cp-page-pill').count(), 0, 'the board itself gets no pill');
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith('cp-page-menu:')))));
    assert.deepEqual(stored.folders.map(f => f.name), ['Profile', 'Resources']);
    assert.deepEqual(stored.folders[0].options.find(o => o.label === 'Administrators'),
      { label: 'Administrators', group: 'Advanced', url: '/commpilot/Reseller/Admins/', params: { mode: 'list' } });

    await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Domains/', {}));
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/Domains/');
    const pill = page.locator('.cp-page-pill');
    await pill.waitFor();
    assert.equal(await pill.innerText(), 'Domains');
    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Pages at this level' });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Resources' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.locator('[aria-current="page"]').innerText(), 'Domains');
    await dialog.getByRole('button', { name: 'Profile' }).click();
    assert.deepEqual(await dialog.locator('.cp-page-group').allInnerTexts(), ['BASIC', 'ADVANCED'], 'Basic and Advanced groups');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0, 'Escape closes the menu');
    await pill.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Administrators' }).click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/Admins/');
    const nav = requests.filter(r => r.pathname === '/commpilot/Reseller/Admins/').pop();
    assert.equal(nav.params.get('mode'), 'list', 'the option’s own redirectPost params were sent');
    await page.locator('.cp-page-pill').waitFor();
    assert.equal(await page.locator('.cp-page-pill').innerText(), 'Administrators');
  } finally { await browser.close(); }
});
