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

function menu(items) {
  return `<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table width="100%"><tbody>
    <tr><td class="menuCategory">Basic</td></tr>
    ${items.map(([label, target]) => `<tr><td><a class="navMenuItem" name="${target}"
      onclick="redirectPost('/commpilot${target}', {})">${label}</a></td></tr><tr><td>About ${label}.</td></tr>`).join('')}
    </tbody></table></td></tr></tbody></table>`;
}
function shell(body, { group, token }) {
  const nav = group ? [['G0', 'Profile'], ['G1', 'Resources']] : [['R0', 'Reseller Profile']];
  return `<!doctype html><html><head><title>${group ? 'Group' : 'Reseller'}</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar">${group ? '<a class="headerAuthLevelLink">Reseller</a> &gt; <span class="headerAuthLevel">Big_Group</span>' :
      '<span class="headerAuthLevel">Reseller</span>'}</td></tr></table>
    <form name="leftNavForm">${nav.map(([id, label], i) => `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}"
      onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'${group ? 1 : 8}'})">${label}</a>`).join('')}</form>
    <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
    <input type="hidden" name="formtokenserial" value="${token}">
    <script>window.redirectPost=function(){};</script>
  </body></html>`;
}

// A big customer's group can take CommPilot longer than the 8 seconds pjax.js used to allow for opening it. Giving up
// then retried beside the request CommPilot was still working on, with a token it had replaced: signed out.
test('a slow group still opens, with no second request while CommPilot works', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let serial = 1, group = false;
    const requests = [];
    await page.route(origin + '/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      requests.push({ pathname, at: Date.now() });
      const token = 'token-' + (++serial);
      if (pathname === groupEntry) {
        group = true;
        await new Promise(resolve => setTimeout(resolve, 10000));   // longer than the old 8 s limit
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(menu([['Profile', '/Group/Profile/']]), { group, token }) });
      }
      if (/Login/.test(pathname)) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Login</body></html>' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell(menu([['Profile', group ? '/Group/Profile/' : '/Reseller/Profile/']]), { group, token }) });
    });
    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'atlas'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    await page.waitForTimeout(400);

    await page.evaluate(url => window.redirectPost(url, { key: 'Big_SP>%Big_Group' }), groupEntry);
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="G0"]'), null, { timeout: 30000 });
    const entries = requests.filter(r => r.pathname === groupEntry);
    assert.equal(entries.length >= 1, true);
    const first = entries[0].at;
    assert.equal(requests.filter(r => r.at < first + 10000 && r.at > first).length, 0,
      'nothing else is sent while CommPilot is still answering');
    assert.equal(requests.some(r => /Login/.test(r.pathname)), false, 'never a fresh-token request or the sign-in page');
    assert.equal(new URL(page.url()).pathname.includes('Login'), false);
  } finally { await browser.close(); }
});
