const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
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

for (const variant of ['inline', 'inline-complex', 'script-complex', 'script-after-other-binding', 'script-inert-json', 'script-inert-nomodule']) test(`a ${variant} native page-menu target retains its exact context parameters`, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage(), requests = [];
    const expectedKey=variant==='inline'?'SP>%Fixture':String.raw`SP>%O'Brien }),key:"wrong" literal\u0040`;
    const payload=variant==='inline'?"{mode:'list', key:'SP\\u003E\\u0025Fixture', P_key:'SP\\u003E\\u0025Fixture'}":`{mode:'list',key:${JSON.stringify(expectedKey)},P_key:${JSON.stringify(expectedKey)}}`;
    let inlineMenu = variant.startsWith('script-')?menu([['BASIC','link_admins','Administrators','/commpilot/Reseller/Admins/',payload]])
      .replace('<script>',variant==='script-after-other-binding'?'<script>document.getElementById("unrelated-help")?.addEventListener("click",function(){return false;});':'<script>'):`<table><tr><td class="menuCategory">BASIC</td></tr><tr><td>
      <a class="navMenuItem" id="link_admins" name="/Reseller/Admins/"
        onclick="redirectPost('/commpilot/Reseller/Admins/', ${payload.replace(/&/g,'&amp;').replace(/"/g,'&quot;')})">Administrators</a>
      </td></tr><tr><td>Manage administrators.</td></tr></table>`;
    if(variant.startsWith('script-inert-'))inlineMenu+=`<script ${variant==='script-inert-json'?'type="application/json"':'nomodule'}>
      window.inertWiringRan=true;document.getElementById('link_admins').onclick=function(){redirectPost('/commpilot/Reseller/Admins/',{key:'Wrong'});};</script>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const params = new URLSearchParams(request.postData() || '');
      if (request.method() === 'POST') requests.push({ pathname, params: Object.fromEntries(params) });
      return route.fulfill({ contentType: 'text/html', body: shell(pathname === folderPath ?
        (params.get('folder') === 'R1' ? menus.R1 : inlineMenu) : '<h1>Administrators</h1>', 'Profile') });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folderPath);
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'atlas'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => Object.keys(sessionStorage).some(key => key.startsWith('cp-page-menu:')));
    assert.equal(await page.evaluate(()=>window.inertWiringRan),undefined,'inactive script text must never become executable wiring');
    const params = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage)
      .find(key => key.startsWith('cp-page-menu:')))).folders[0].options.find(option => option.label === 'Administrators').params);
    assert.deepEqual(params, { mode: 'list', key: expectedKey, P_key: expectedKey });
    await page.locator('td.headerBar span.headerAuthLevel[data-cp-crumb-menu]').click();
    await page.getByRole('dialog', { name: 'Pages at this level' }).getByRole('button', { name: 'Administrators', exact: true }).click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/Admins/');
    const target = requests.filter(request => request.pathname === '/commpilot/Reseller/Admins/');
    assert.equal(target.length, 1);
    assert.deepEqual({ mode: target[0].params.mode, key: target[0].params.key, P_key: target[0].params.P_key }, params);
  } finally { await browser.close(); }
});
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

test('a board’s options become a breadcrumb menu: a ⌄ on the board’s last pill, and the page pill on the level’s other pages', async () => {
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
    await page.addStyleTag({ path: path.join(root, 'src/content/native-theme.css') });
    await page.addStyleTag({ path: path.join(root, 'src/content/theme-palettes.css') });
    await page.addStyleTag({ path: path.join(root, 'src/content/menu-board.css') });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'atlas'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => Object.keys(sessionStorage).some(k => k.startsWith('cp-page-menu:')), null, { timeout: 15000 });
    assert.equal(await page.locator('.cp-page-pill').count(), 0, 'the board itself gets no pill');
    // The board (the level's base menu) gets the same menu on its last breadcrumb pill: a ⌄ inside it, like the page pill.
    const caret = page.locator('td.headerBar span.headerAuthLevel[data-cp-crumb-menu]');
    await caret.waitFor();
    assert.deepEqual(await page.evaluate(() => {
      const pill = document.querySelector('td.headerBar span.headerAuthLevel');
      return { text: pill.textContent.trim(), caret: pill.lastElementChild?.matches('svg.cp-crumb-caret'), box: !!document.querySelector('.cp-crumb-menu') };
    }), { text: 'Reseller', caret: true, box: false }, 'the ⌄ is inside the pill and adds no text');
    await caret.click();
    const boardMenu = page.getByRole('dialog', { name: 'Pages at this level' });
    await boardMenu.waitFor();
    assert.equal(await boardMenu.getByRole('button', { name: 'Profile' }).getAttribute('aria-pressed'), 'true', 'it opens on the folder at the top');
    assert.equal(await boardMenu.locator('[aria-current="page"]').count(), 0, 'nothing is the current page on a board');
    assert.equal(await caret.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await boardMenu.count(), 0);
    assert.equal(await caret.getAttribute('aria-expanded'), 'false');
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith('cp-page-menu:')))));
    assert.deepEqual(stored.folders.map(f => f.name), ['Profile', 'Resources']);
    assert.deepEqual(stored.folders[0].options.find(o => o.label === 'Administrators'),
      { label: 'Administrators', group: 'Advanced', url: '/commpilot/Reseller/Admins/', params: { mode: 'list' } });

    await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Domains/', {}));
    await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/Domains/');
    const pill = page.locator('.cp-page-pill');
    await pill.waitFor();
    assert.equal(await pill.innerText(), 'Domains');
    const look = () => page.evaluate(() => {
      const pill = document.querySelector('.cp-page-pill'), arrow = pill.querySelector('svg');
      return { ring: getComputedStyle(pill).boxShadow, border: getComputedStyle(pill).borderTopColor,
        turn: getComputedStyle(arrow).transform, timing: getComputedStyle(arrow).transitionDuration };
    });
    await page.mouse.move(5, 790);
    const closed = await look();
    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Pages at this level' });
    await dialog.waitFor();
    await page.mouse.move(5, 790);   // the pointer off the pill, as when reading the menu
    await page.waitForTimeout(300);
    const open = await look();
    // Open: the arrow has turned over in place (animated), and the pill wears no ring or new border.
    assert.equal(open.turn, 'matrix(-1, 0, 0, -1, 0, 0)');
    assert.equal(closed.turn, 'none');
    assert.equal(open.timing, '0.2s');
    assert.equal(open.ring, closed.ring);
    assert.equal(open.border, closed.border);
    assert.equal(await dialog.getByRole('button', { name: 'Resources' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.locator('[aria-current="page"]').innerText(), 'Domains');
    assert.equal(await dialog.locator('.cp-page-tab > .cp-page-icon svg').count(),2);
    assert.equal(await dialog.locator('.cp-page-item > .cp-page-icon svg').count(),await dialog.locator('.cp-page-item').count(),'every option has an icon');
    assert.deepEqual(await dialog.evaluate(el=>{
      const tab=getComputedStyle(el.querySelector('.cp-page-tab[aria-pressed="true"]')),item=getComputedStyle(el.querySelector('.cp-page-item[aria-current="page"]'));
      return {background:tab.backgroundColor===item.backgroundColor,color:tab.color===item.color,shadow:tab.boxShadow};
    }),{background:true,color:true,shadow:'none'},'category and current page use one selection style');
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

    // The user menu wraps eight categories. Keep its actual long labels in the visual check, including
    // a focused but unselected category: the old generic button focus paint left a second highlight behind.
    await page.evaluate(()=>{
      const key=Object.keys(sessionStorage).find(k=>k.startsWith('cp-page-menu:'));
      const names=['Profile','Incoming Calls','Outgoing Calls','Call Control','Calling Plans','Client Applications','Messaging','Utilities'];
      const incoming=['Calling Name Delivery','Calling Number Delivery','Call Forwarding Always','Call Forwarding Always Secondary','Call Forwarding Busy','Call Forwarding No Answer','Call Forwarding Not Reachable','Connected Line Identification Restriction','External Calling Line ID Delivery','Internal Calling Line ID Delivery'];
      sessionStorage.setItem(key,JSON.stringify({folders:names.map(name=>({name,options:(name==='Incoming Calls'?incoming:[name]).map(label=>({label,group:'Basic',url:label==='Call Forwarding Always'?'/commpilot/User/CF/Always/':'/commpilot/User/Profile/',params:{}}))}))}));
      window.redirectPost('/commpilot/User/CF/Always/',{});
    });
    await page.waitForFunction(()=>location.pathname==='/commpilot/User/CF/Always/');
    await page.locator('.cp-page-pill').click();
    const userMenu=page.getByRole('dialog',{name:'Pages at this level'});
    await userMenu.getByRole('button',{name:'Messaging',exact:true}).focus();
    await page.mouse.move(5,790);
    assert.equal(await userMenu.locator('.cp-page-tab').evaluateAll(tabs=>tabs.filter(t=>getComputedStyle(t).backgroundColor!=='rgba(0, 0, 0, 0)').length),1,'only the selected category keeps its fill');
    assert.equal(await userMenu.locator('.cp-page-tab .cp-page-icon svg').count(),8);
    assert.equal(await userMenu.locator('.cp-page-item .cp-page-icon svg').count(),10);
    await userMenu.screenshot({path:path.join(root,'dev-preview/sca-designs/page-dropdown-light.png'),animations:'disabled'});
    await page.evaluate(()=>document.documentElement.dataset.cpDirection='graphite');
    await userMenu.screenshot({path:path.join(root,'dev-preview/sca-designs/page-dropdown-dark.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:700});
    await page.keyboard.press('Escape');
    await page.locator('.cp-page-pill').click();
    assert.equal(await userMenu.evaluate(el=>{const r=el.getBoundingClientRect();return r.width<=innerWidth-24&&r.left>=0&&r.right<=innerWidth;}),true,'menu fits a narrow viewport');
  } finally { await browser.close(); }
});
