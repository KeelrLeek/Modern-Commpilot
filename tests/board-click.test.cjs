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
const origin = 'https://apps-sbx.avpaas.io';
const folderPath = '/commpilot/Common/folder_contents.jsp';

// CommPilot's folder menu: Basic and Advanced side by side in one layout row; here Basic is the shorter column.
const column = (title, items) => `<td width="50%" valign="TOP"><table width="100%"><tbody>
  <tr><td class="menuCategory">${title}</td></tr>
  ${items.map(([label, target]) => `<tr><td><a class="navMenuItem" name="${target}"
    onclick="redirectPost('/commpilot${target}', {})">${label}</a></td></tr><tr><td>About ${label.toLowerCase()}.</td></tr>`).join('')}
  </tbody></table></td>`;
const board = `<table width="100%"><tbody><tr>
  ${column('Basic', [['Branding', '/Reseller/Branding/']])}
  ${column('Advanced', [['Groups', '/Reseller/Groups/'], ['Administrators', '/Reseller/Admins/'], ['Schedules', '/Reseller/Schedules/'],
    ['Services', '/Reseller/Services/'], ['Call Policies', '/Reseller/CallPolicies/']])}
</tr></tbody></table>`;
function shell(body, token) {
  return `<!doctype html><html><head><title>Reseller</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
    <form name="leftNavForm"><a class="leftnavfolderopen" onclick="redirectPost('${folderPath}', {folder:'R0', menuId:'8'})">Reseller</a></form>
    <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
    <input type="hidden" name="formtokenserial" value="${token}">
    <script>window.redirectPost=function(){};</script>
  </body></html>`;
}

test('only an option row opens its option; the empty space under a shorter column does nothing', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let serial = 1;
    const opened = [];
    await page.route(origin + '/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname !== folderPath) opened.push(pathname);
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: shell(pathname === folderPath ? board : '<h1 class="screenName">Page</h1>', 'token-' + (++serial)) });
    });
    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'graphite'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    await page.waitForTimeout(500);

    // The empty space under Basic, beside the longer Advanced column.
    const empty = await page.evaluate(() => {
      const basic = document.querySelector('.cp-console-body a.navMenuItem[name="/Reseller/Branding/"]').closest('td[valign="TOP"]');
      const card = basic.querySelector(':scope > table').getBoundingClientRect(), cell = basic.getBoundingClientRect();
      return { x: card.left + card.width / 2, y: (card.bottom + cell.bottom) / 2, room: cell.bottom - card.bottom,
        cursor: getComputedStyle(basic).cursor };
    });
    assert.ok(empty.room > 60, `the columns differ in height (${empty.room}px of empty space)`);
    assert.notEqual(empty.cursor, 'pointer', 'the empty space does not look clickable');
    await page.mouse.click(empty.x, empty.y);
    await page.waitForTimeout(800);
    assert.deepEqual(opened, [], 'a click on the empty space opens nothing');
    assert.equal(await page.evaluate(() => location.pathname), folderPath, 'still on the menu board');

    // An option's description row still opens that option.
    await page.getByRole('cell', { name: 'About administrators.', exact: true }).click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/Admins/');
    assert.deepEqual(opened, ['/commpilot/Reseller/Admins/']);
  } finally { await browser.close(); }
});
