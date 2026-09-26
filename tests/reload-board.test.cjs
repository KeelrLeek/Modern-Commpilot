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
const groupEntry = '/commpilot/Reseller/Groups/Modify/index.jsp';
const userEntry = '/commpilot/Group/Members/Modify/index.jsp';
const userKey = 'Trifecta_Sandbox_SP>%Trifecta_Sandbox_Group>%TriSandbox1002';

function menu(items) {
  return `<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table width="100%"><tbody>
    <tr><td class="menuCategory">Basic</td></tr>
    ${items.map(([label, target]) => `<tr><td><a class="navMenuItem" name="${target}"
      onclick="redirectPost('/commpilot${target}', {})">${label}</a></td></tr>
      <tr><td>Configure ${label.toLowerCase()}.</td></tr>`).join('')}
    </tbody></table></td></tr></tbody></table>`;
}

const userMenus = {
  U0: menu([['Addresses', '/User/Addresses/']]),
  U1: menu([['Call Forwarding Busy', '/User/CF/Busy/']]),
  U2: menu([['Call Waiting', '/User/CW/']])
};

function shell(body, title) {
  const nav = [['U0', 'Profile'], ['U1', 'Incoming Calls'], ['U2', 'Call Control']];
  return `<!doctype html><html><head><title>${title}</title></head>
    <body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><span class="headerAuthLevel">TriSandbox1002</span></td></tr></table>
      <form name="leftNavForm">${nav.map(([id, label], i) =>
        `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}"
          onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'0'})">${label}</a>`
      ).join('')}</form>
      <input name="formtokenserial" value="token-1">
      <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script>
    </body></html>`;
}

// Opens a fresh User-level folder page as the landing page of a native reload
// replay, optionally with stubguard's one-shot marker, then injects pjax.js.
async function landOnUserFolder(browser, marker) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const requests = [];
  await page.route(origin + '/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const params = new URLSearchParams(request.postData() || '');
    requests.push({ pathname, params });
    const respond = (body, title) => route.fulfill({ status: 200, contentType: 'text/html', body: shell(body, title) });
    if (pathname === userEntry) return respond(userMenus.U0, 'User Profile');
    if (pathname === folderPath) return respond(userMenus[params.get('folder') || 'U0'] || userMenus.U0, 'Folder');
    return respond('<h1>Page</h1>', 'Page');
  });
  await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
  await page.evaluate(value => {
    if (value) sessionStorage.setItem('cp-reload-nav', JSON.stringify({ ...value, at: Date.now() }));
  }, marker);
  await page.addStyleTag({ path: path.join(root, 'src/content/menu-board.css') });
  await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  return { page, requests };
}

test('a browser Reload landing at User level rebuilds the board and re-enters the replayed user', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    // Reload of the user board itself: the replayed Modify nav is the entity entry.
    const direct = await landOnUserFolder(browser, {
      url: userEntry, params: { key: userKey }, entry: { url: groupEntry, params: { key: 'group' } }
    });
    await direct.page.waitForFunction(() => document.querySelectorAll('.cp-console-section .cp-console-body[data-cp-loaded="1"]').length === 3,
      null, { timeout: 20000 });
    await direct.page.waitForTimeout(600);
    assert.equal(await direct.page.locator('.cp-console-error').count(), 0);
    const restore = direct.requests.filter(r => r.pathname === userEntry);
    assert.ok(restore.length >= 1, 'the board must re-enter the replayed user after its folder reads');
    assert.equal(restore.at(-1).params.get('key'), userKey);
    assert.equal(direct.requests.some(r => r.pathname === groupEntry), false,
      'the parent-level entry must not be used to restore a User board');
    assert.equal(await direct.page.evaluate(() => sessionStorage.getItem('cp-reload-nav')), null,
      'the reload marker is one-shot');
    const initialNav = await direct.page.evaluate(() => history.state?.cpNav);
    assert.equal(initialNav?.url, userEntry, 'Back to the reloaded page must replay the user, not reseller home');
    assert.equal(initialNav?.params?.key, userKey);
    assert.equal(initialNav?.entry, null, 'like an in-session entry, Back replays the user entry directly');
    await direct.page.close();

    // Reload of a folder_contents nav: its recorded entry restores the context.
    const folder = await landOnUserFolder(browser, {
      url: folderPath, params: { folder: 'U1', menuId: '0' }, entry: { url: userEntry, params: { key: userKey } }
    });
    await folder.page.waitForFunction(() => document.querySelectorAll('.cp-console-section .cp-console-body[data-cp-loaded="1"]').length === 3,
      null, { timeout: 20000 });
    await folder.page.waitForTimeout(600);
    assert.equal(folder.requests.filter(r => r.pathname === userEntry).at(-1)?.params.get('key'), userKey);
    await folder.page.close();

    // Without the marker the fresh page has no safe entry and keeps the native folder.
    const plain = await landOnUserFolder(browser, null);
    await plain.page.waitForTimeout(1500);
    assert.equal(await plain.page.locator('.cp-console-section').count(), 0);
    assert.equal(plain.requests.some(r => r.pathname === userEntry), false);
    await plain.page.close();

    // A stale marker is ignored.
    const old = await browser.newPage();
    await old.route(origin + '/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell(userMenus.U0, 'Folder') }));
    await old.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    await old.evaluate(value => sessionStorage.setItem('cp-reload-nav', JSON.stringify({ ...value, at: Date.now() - 120000 })),
      { url: userEntry, params: { key: userKey } });
    await old.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await old.waitForTimeout(1500);
    assert.equal(await old.locator('.cp-console-section').count(), 0, 'an expired marker must not seed the entry');
  } finally { await browser.close(); }
});

const levels = {
  // Folder names differ per level, as in CommPilot; pjax detects a level change by them.
  R: { menuId: '8', folders: [['R0', 'Profile'], ['R1', 'Resources']] },
  S: { menuId: '2', folders: [['S0', 'Profile'], ['S1', 'Communication Barring']] },
  G: { menuId: '1', folders: [['G0', 'Profile'], ['G1', 'Call Center']] },
  U: { menuId: '0', folders: [['U0', 'Profile'], ['U1', 'Incoming Calls']] }
};

function levelShell(level, title) {
  const { menuId, folders } = levels[level];
  return `<!doctype html><html><head><title>${title}</title></head>
    <body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><span class="headerAuthLevel">${level}</span></td></tr></table>
      <form name="leftNavForm">${folders.map(([id, label], i) =>
        `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}"
          onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'${menuId}'})">${label}</a>`
      ).join('')}</form>
      <input name="formtokenserial" value="token-1">
      <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${
        menu([[level + ' option', '/' + level + '/Option/']])}</td></tr></table>
      <script>window.redirectPost=function(){};</script>
    </body></html>`;
}

// Level answered by the fixture: user entry -> U, bare up-navs by menuId, folder reads by prefix.
function levelFor(pathname, params) {
  if (pathname === userEntry) return 'U';
  if (pathname !== folderPath) return null;
  const folder = params.get('folder');
  if (folder) return folder[0];
  return { 1: 'G', 2: 'S' }[params.get('menuId')] || 'R';
}

async function levelPage(browser, startLevel, marker) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const requests = [];
  let first = true;
  await page.route(origin + '/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const params = new URLSearchParams(request.postData() || '');
    requests.push({ pathname, params });
    const level = first ? startLevel : levelFor(pathname, params) || 'R';
    first = false;
    return route.fulfill({ status: 200, contentType: 'text/html', body: levelShell(level, level + ' page') });
  });
  await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
  await page.evaluate(value => {
    if (value) sessionStorage.setItem('cp-reload-nav', JSON.stringify({ ...value, at: Date.now() }));
  }, marker);
  await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  return { page, requests };
}

const boardAt = (page, level) => page.waitForFunction(l => {
  const sections = [...document.querySelectorAll('.cp-console-section')];
  return sections.length === 2 && sections[0].dataset.cpFolder[0] === l &&
    sections.every(s => s.querySelector('.cp-console-body')?.dataset.cpLoaded === '1');
}, level, { timeout: 20000 });

test('native breadcrumb up-navs keep a reloadable entity entry and restore their own level', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    // In session: enter a user, then climb with two native breadcrumb up-navs.
    const chain = await levelPage(browser, 'R', null);
    await boardAt(chain.page, 'R');
    await chain.page.waitForTimeout(400);
    await chain.page.evaluate(([url, key]) => window.redirectPost(url, { key }), [userEntry, userKey]);
    await boardAt(chain.page, 'U');
    await chain.page.waitForTimeout(600);
    await chain.page.evaluate(url => window.redirectPost(url, { menuId: '1', P_menuId: '1' }), folderPath);
    await boardAt(chain.page, 'G');
    await chain.page.waitForTimeout(600);
    await chain.page.evaluate(url => window.redirectPost(url, { menuId: '2', P_menuId: '2' }), folderPath);
    await boardAt(chain.page, 'S');
    const saved = await chain.page.evaluate(() => JSON.parse(sessionStorage.getItem('cp-last-nav')));
    assert.equal(saved.url, folderPath);
    assert.equal(saved.params.menuId, '2');
    assert.equal(saved.entry?.url, userEntry, 'a chained up-nav must recover from the last entered entity');
    assert.equal(saved.entry?.params?.key, userKey);
    await chain.page.close();

    // Reload landing at SP level from that nav: the board restores with the up-nav, never the user entry.
    const landing = await levelPage(browser, 'S',
      { url: folderPath, params: { menuId: '2', P_menuId: '2' }, entry: { url: userEntry, params: { key: userKey } } });
    await boardAt(landing.page, 'S');
    await landing.page.waitForTimeout(800);
    assert.equal(await landing.page.locator('.cp-console-error').count(), 0);
    const restore = landing.requests.filter(r => r.pathname === folderPath && !r.params.get('folder'));
    assert.ok(restore.length >= 2, 'the up-nav must be replayed to restore the SP context');
    assert.equal(restore.at(-1).params.get('menuId'), '2');
    assert.equal(landing.requests.some(r => r.pathname === userEntry), false,
      'an SP board must not restore into the user it climbed from');
    assert.equal(await landing.page.evaluate(() => history.state?.cpNav?.entry), null,
      'Back to the SP board must climb directly, not rebuild the user board first');
    await landing.page.close();
  } finally { await browser.close(); }
});
