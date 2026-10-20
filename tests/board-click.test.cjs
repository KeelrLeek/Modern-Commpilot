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

// A board of four folders whose sections load slowly, one at a time, as on a busy CommPilot.
const FOLDERS = [['R0', 'Profile'], ['R1', 'Resources'], ['R2', 'Services'], ['R3', 'Utilities']];
const folderBoard = id => `<table width="100%"><tbody><tr>${column('Basic', Array.from({ length: 9 }, (_, i) => [`${id} option ${i + 1}`, `/Reseller/${id}/${i + 1}/`]))}</tr></tbody></table>`;
function multiShell(body, token) {
  return `<!doctype html><html><head><title>Reseller</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
    <form name="leftNavForm">${FOLDERS.map(([id, name], i) => `<table><tr><td class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}">
      <a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}" onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'8'})">${name}</a></td></tr></table>`).join('')}</form>
    <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
    <input type="hidden" name="formtokenserial" value="${token}">
    <script>window.redirectPost=function(){};</script>
  </body></html>`;
}

test('a sidebar folder picked while the board is still filling in is shown and stays at the top', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    let serial = 1;
    await page.route(origin + '/**', async route => {
      const req = route.request();
      const folder = (/folder=(R\d)/.exec(req.postData() || '') || [])[1] || 'R0';
      if (req.method() === 'POST') await new Promise(r => setTimeout(r, 700));   // each section takes a while
      return route.fulfill({ status: 200, contentType: 'text/html', body: multiShell(folderBoard(folder), 'token-' + (++serial)) });
    });
    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'graphite'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelectorAll('.cp-console-section').length === 4 &&
      document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    // Utilities has not appeared yet.
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cp-console-section[data-cp-folder="R3"]')).display), 'none');
    await page.locator('form[name="leftNavForm"] a', { hasText: 'Utilities' }).click();
    const shown = await page.evaluate(() => {
      const sec = document.querySelector('.cp-console-section[data-cp-folder="R3"]');
      return getComputedStyle(sec).display !== 'none' && getComputedStyle(sec).visibility === 'visible';
    });
    assert.equal(shown, true, 'the picked section shows at once');
    // Once everything has loaded (the sections above it included), Utilities is still the one at the top.
    await page.waitForFunction(() => [...document.querySelectorAll('.cp-console-body')].every(b => b.dataset.cpLoaded === '1'), null, { timeout: 15000 });
    await page.waitForTimeout(900);
    const offset = await page.evaluate(() => {
      const cons = document.querySelector('.cp-console');
      return Math.round(document.querySelector('.cp-console-section[data-cp-folder="R3"]').getBoundingClientRect().top - cons.getBoundingClientRect().top);
    });
    assert.ok(Math.abs(offset) <= 4, `Utilities sits at the top of the board (${offset}px off)`);
  } finally { await browser.close(); }
});

test('sidebar jumps survive refreshes during menu loading and override Back scroll restoration', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    let serial = 1;
    await page.route(origin + '/**', async route => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      const folder = (/folder=(R\d)/.exec(req.postData() || '') || [])[1] || 'R0';
      if (pathname === folderPath && req.method() === 'POST') await new Promise(r => setTimeout(r, 250));
      return route.fulfill({ status: 200, contentType: 'text/html', body: multiShell(
        pathname === folderPath ? folderBoard(folder) : '<h1 class="screenName">Option</h1>', 'token-' + (++serial)) });
    });
    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'graphite'; document.documentElement.dataset.cpRail = ''; });
    await page.evaluate(() => {
      const refreshed = new WeakSet();
      window.skeletonRefreshes = 0;
      new MutationObserver(() => {
        const board = document.querySelector('.cp-console');
        if (!board || refreshed.has(board) || board.querySelector('a.navMenuItem')) return;
        refreshed.add(board);
        window.skeletonRefreshes++;
        document.dispatchEvent(new Event('cp:reskin'));
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    const loaded = () => page.waitForFunction(() => document.querySelectorAll('.cp-console-body[data-cp-loaded="1"]').length === 4);
    const offset = folder => page.evaluate(folder => document.querySelector(`.cp-console-section[data-cp-folder="${folder}"]`).getBoundingClientRect().top -
      document.querySelector('.cp-console').getBoundingClientRect().top, folder);
    const sidebar = name => page.locator('form[name="leftNavForm"] a', { hasText: name });
    await loaded();
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => window.skeletonRefreshes > 0), 'a refresh arrived while the board had only loading placeholders');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cp-board-active')), true,
      'a refresh during loading preserves the board scroll layout');
    await sidebar('Utilities').click();
    await page.waitForFunction(() => Math.abs(document.querySelector('.cp-console-section[data-cp-folder="R3"]').getBoundingClientRect().top -
      document.querySelector('.cp-console').getBoundingClientRect().top) < 4);
    await page.locator('.cp-console-section[data-cp-folder="R3"] a.navMenuItem').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/R3/1/');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    await sidebar('Resources').click();
    await loaded();
    await page.waitForTimeout(1000);
    assert.ok(Math.abs(await offset('R1')) < 4, `Resources stays at the top after Back finishes (${await offset('R1')}px off)`);
    for (const [folder, name] of [['R3', 'Utilities'], ['R0', 'Profile'], ['R2', 'Services']]) {
      await sidebar(name).click();
      await page.waitForTimeout(800);
      assert.ok(Math.abs(await offset(folder)) < 4, `${name} still scrolls after returning to the board (${await offset(folder)}px off)`);
    }
    // Back still restores the previous section when there is no newer sidebar choice.
    await page.locator('.cp-console-section[data-cp-folder="R2"] a.navMenuItem').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/R2/1/');
    await page.goBack();
    await loaded();
    await page.waitForTimeout(1000);
    assert.ok(Math.abs(await offset('R2')) < 4, `Back without another sidebar click restores Services (${await offset('R2')}px off)`);
  } finally { await browser.close(); }
});

test('a sidebar swapped in by a level change still navigates, with no stamps and no CommPilot listeners on it', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const posts = [];
    let serial = 1;
    // A user-level settings page (no board): the sidebar's links are wired only by the script beside each one, and
    // here those scripts never attach anything, as after a swap whose wiring was not re-run.
    const folders = [['U0', 'Profile'], ['U1', 'Incoming Calls'], ['U4', 'Call Control']];
    const sidebar = folders.map(([id, name], i) => `<table><tr><td class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}">
      <a id="anchor_${id}" class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}">${name}</a>
      <script>if (false) { document.getElementById('anchor_${id}').addEventListener('click', function () {
        redirectPost('/commpilot/Common/folder_contents.jsp', {folder: '${id}', menuId: '0'}); }); }</script></td></tr></table>`).join('');
    const pageHtml = token => `<!doctype html><html><head><title>Profile</title></head><body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><span class="headerAuthLevel">SMDonuts21</span></td></tr></table>
      <form name="leftNavForm">${sidebar}</form>
      <table height="100%"><tr><td width="82%" valign="top"><form name="mainForm"><table><tr><td class="screenName">Profile</td></tr></table></form></td></tr></table>
      <input type="hidden" name="formtokenserial" value="${token}"><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route(origin + '/**', route => {
      const req = route.request();
      if (req.method() === 'POST') posts.push(new URL(req.url()).pathname + ' ' + (req.postData() || ''));
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml('token-' + (++serial)) });
    });
    await page.goto(origin + '/commpilot/User/Profile/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'graphite'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('a[data-cp-folder]').count(), 0, 'no board was built, so nothing is stamped yet');
    await page.locator('form[name="leftNavForm"] a', { hasText: 'Call Control' }).click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(800);
    assert.ok(posts.some(p => p.startsWith('/commpilot/Common/folder_contents.jsp') && /folder=U4/.test(p) && /menuId=0/.test(p)),
      'the click opened Call Control: ' + JSON.stringify(posts));
  } finally { await browser.close(); }
});
