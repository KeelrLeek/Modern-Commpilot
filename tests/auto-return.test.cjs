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
const origin = 'https://apps-sbx.avpaas.io';
const folderPath = '/commpilot/Common/folder_contents.jsp';
const spEntry = '/commpilot/Reseller/ServiceProviders/Modify/';     // opened from the reseller level
const groupEntry = '/commpilot/ServiceProvider/Members/Modify/';    // opened from a service provider
const MENU_ERROR = 'Error loading the menu. Summary: [Error 6004] OCI XML Request validation error Details: Element has ' +
  'xsi:nil attribute but is not nillable in element command <serviceProviderId xsi:nil="true"/>';

const levels = {
  R: { menuId: '8', folders: [['R0', 'Profile'], ['R1', 'Resources']] },
  S: { menuId: '2', folders: [['S0', 'Profile'], ['S1', 'Communication Barring']] },
  G: { menuId: '1', folders: [['G0', 'Profile'], ['G1', 'Call Center']] }
};
function levelShell(level, title) {
  const { menuId, folders } = levels[level];
  return `<!doctype html><html><head><title>${title}</title></head>
    <body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><span class="headerAuthLevel">${level}</span></td></tr></table>
      <form name="leftNavForm">${folders.map(([id, label], i) =>
        `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}"
          onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'${menuId}'})">${label}</a>`).join('')}</form>
      <input name="formtokenserial" value="token-1">
      <table height="100%"><tr><td width="82%" valign="top"><h1>${title}</h1></td></tr></table>
      <script>window.redirectPost=function(){};</script>
    </body></html>`;
}
// CommPilot's Login page (trimmed): its message cell is always there, empty unless something went wrong.
const loginPage = message => `<html><head><title>Login</title></head><body id="loginBody"><form name="loginForm">
  <table><tr><td class="loginerror">${message || ''}</td></tr></table>
  <input name="UserID"><input type="password" name="password"></form></body></html>`;

// One tab: signed out on the Login page (with a saved place and, maybe, CommPilot's message), then signed in at
// the reseller home. Every request is answered by the level it opens; the log shows what pjax.js asked for.
async function signBackIn(browser, { saved, returnAt, message, entry }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const requests = [];
  await page.route(origin + '/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const params = new URLSearchParams(request.postData() || '');
    if (request.method() === 'POST') requests.push({ pathname, params });
    if (pathname.startsWith('/commpilot/Login/')) return route.fulfill({ status: 200, contentType: 'text/html', body: loginPage(message) });
    if (entry && pathname === spEntry && await entry(route)) return;
    const level = pathname === spEntry || pathname.startsWith('/commpilot/ServiceProvider/') ? 'S'
      : pathname === groupEntry || pathname.startsWith('/commpilot/Group/') ? 'G'
      : params.get('folder')?.[0] || 'R';
    return route.fulfill({ status: 200, contentType: 'text/html', body: levelShell(level, level + ' ' + pathname) });
  });
  await page.goto(origin + '/commpilot/Login/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([nav, at]) => {
    sessionStorage.setItem('cp-last-nav', JSON.stringify(nav));
    if (at) sessionStorage.setItem('cp-return-at', String(at));
  }, [saved, returnAt ? Date.now() - returnAt : 0]);
  await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  const onLogin = await page.evaluate(() => ({ pending: sessionStorage.getItem('cp-pending-return'), saved: sessionStorage.getItem('cp-last-nav') }));
  await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });   // signed in: the reseller home
  await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  await page.waitForTimeout(1500);
  return { page, requests, onLogin };
}

test('signing back in reopens the last page when the home level can open it', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const saved = { url: '/commpilot/ServiceProvider/Profile/', params: {}, entry: { url: spEntry, params: { key: 'Test_SP' } } };
    const { page, requests, onLogin } = await signBackIn(browser, { saved });
    assert.equal(onLogin.pending, '1', 'the Login page marks the place to return to');
    const asked = requests.map(r => r.pathname);
    const at = asked.indexOf(spEntry);
    assert.ok(at !== -1, 'the service provider is opened first');
    assert.equal(requests[at].params.get('key'), 'Test_SP');
    assert.ok(asked.indexOf('/commpilot/ServiceProvider/Profile/') > at, 'then the page');
    assert.ok(await page.evaluate(() => sessionStorage.getItem('cp-return-at')), 'the try is noted, in case it fails');
  } finally { await browser.close(); }
});

// The service provider's entry answers with an error, or the user opens another folder while it loads. The saved
// page must not follow the user's own click afterwards: it would replace the page they chose and be posted without
// the entry that sets its context.
for (const mode of ['fails', 'is overtaken']) test(`a return whose entry ${mode} is not finished after the user’s next click`, async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  let release = () => {};
  try {
    const held = new Promise(resolve => { release = resolve; });
    const saved = { url: '/commpilot/ServiceProvider/Profile/', params: {}, entry: { url: spEntry, params: { key: 'Test_SP' } } };
    const { page, requests } = await signBackIn(browser, { saved, entry: async route => {
      if (mode === 'is overtaken') { await held; return false; }
      await route.fulfill({ status: 500, contentType: 'text/html', body: '<html><body>Server error</body></html>' });
      return true;
    } });
    assert.ok(requests.some(r => r.pathname === spEntry), 'the return was started');
    const before = requests.length;
    await page.locator('form[name="leftNavForm"] a', { hasText: 'Resources' }).click();
    release();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    await page.waitForTimeout(800);   // a chained follow-up is posted right after the swap
    assert.deepEqual(requests.slice(before).map(r => r.pathname + ' ' + (r.params.get('folder') || '')), [folderPath + ' R1'],
      'only the folder the user opened is posted');
    const lastNav = JSON.parse(await page.evaluate(() => sessionStorage.getItem('cp-last-nav')));
    assert.equal(lastNav.params.folder, 'R1', 'Reload reopens the folder on screen');
  } finally { release(); await browser.close(); }
});

test('a group’s page is not reopened from the reseller home, where CommPilot would sign the new session out', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const saved = { url: '/commpilot/Group/Profile/', params: {}, entry: { url: groupEntry, params: { key: 'Test_Group' } } };
    const { page, requests } = await signBackIn(browser, { saved });
    assert.deepEqual(requests.filter(r => !r.pathname.startsWith(folderPath)).map(r => r.pathname), [],
      'no group or group page is asked for');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-last-nav')), null, 'the place is forgotten, so Reload stays home too');
  } finally { await browser.close(); }
});

test('a return that ends back on the Login page, or CommPilot’s menu error there, stops the returns', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const saved = { url: '/commpilot/ServiceProvider/Profile/', params: {}, entry: { url: spEntry, params: { key: 'Test_SP' } } };
    // Signed out again seconds after a return: the return failed. Sign-in then stays home.
    const failed = await signBackIn(browser, { saved, returnAt: 5000 });
    assert.deepEqual(failed.onLogin, { pending: null, saved: null });
    assert.equal(failed.requests.some(r => r.pathname === spEntry), false);
    await failed.page.close();
    // CommPilot's "Error loading the menu" on the Login page, however it came about.
    const menuError = await signBackIn(browser, { saved, message: MENU_ERROR });
    assert.deepEqual(menuError.onLogin, { pending: null, saved: null });
    assert.equal(menuError.requests.some(r => r.pathname === spEntry), false);
    await menuError.page.close();
    // A return that worked long ago does not stop the next one.
    const later = await signBackIn(browser, { saved, returnAt: 30 * 60000 });
    assert.equal(later.onLogin.pending, '1');
    assert.ok(later.requests.some(r => r.pathname === spEntry));
  } finally { await browser.close(); }
});

for (const [name, saved] of [
  ['apply payload', {url:'/commpilot/Reseller/Profile/',params:{apply:'Apply',password:'fixture-private'}}],
  ['delete payload', {url:'/commpilot/Reseller/Profile/',params:{buttonClicked:'delete',key:'Fixture'}}],
  ['add route', {url:'/commpilot/Reseller/ServiceProviders/Add/',params:{}}],
  ['query action', {url:'/commpilot/Reseller/Profile/?apply=1',params:{}}],
  ['serialized form', {url:'/commpilot/Reseller/Profile/',params:{__cpFormEntries:[['apply','Apply'],['password','fixture-private']]}}],
  ['mutating entry', {url:'/commpilot/ServiceProvider/Profile/',params:{},entry:{url:spEntry,params:{key:'Fixture',delete:'Delete'}}}]
]) test(`signing back in refuses a saved ${name}`, async () => {
  const browser = await chromium.launch({executablePath:browserPath,headless:true});
  try {
    const {page, requests} = await signBackIn(browser,{saved});
    assert.deepEqual(requests,[], 'restoring a session must not send a saved mutation');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('cp-last-nav')),null);
  } finally { await browser.close(); }
});

test('signing back in strips stale form fields and tokens while retaining the entity key',async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {
    const saved={url:'/commpilot/ServiceProvider/Profile/',params:{description:'fixture-private',password:'fixture-private',formtokenserial:'old-token'},
      entry:{url:spEntry,params:{key:'Fixture',password:'fixture-private',formtokenserial:'old-token'}}};
    const {requests}=await signBackIn(browser,{saved});
    assert.equal(requests.length,2);
    assert.equal(requests[0].params.get('key'),'Fixture');
    for(const request of requests){
      assert.equal(request.params.has('password'),false);
      assert.equal(request.params.has('description'),false);
      assert.equal(request.params.get('formtokenserial'),'token-1');
    }
  }finally{await browser.close();}
});
