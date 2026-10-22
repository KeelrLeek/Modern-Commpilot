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

function shell(body, title, token) {
  return `<!doctype html><html><head><title>${title}</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
    <form name="leftNavForm"><a class="leftnavfolderopen" onclick="redirectPost('${folderPath}', {folder:'R0', menuId:'8'})">Reseller</a></form>
    <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
    <input type="hidden" name="formtokenserial" value="${token}">
    <script>window.redirectPost=function(){};</script>
  </body></html>`;
}
const board = `<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table width="100%"><tbody>
  <tr><td class="menuCategory">Basic</td></tr>
  <tr><td><a class="navMenuItem" name="/Reseller/Groups/" onclick="redirectPost('/commpilot/Reseller/Groups/', {})">Groups</a></td></tr>
  <tr><td>Configure groups.</td></tr>
  <tr><td><a class="navMenuItem" name="/Reseller/Admins/" onclick="redirectPost('/commpilot/Reseller/Admins/', {})">Administrators</a></td></tr>
  <tr><td>Configure administrators.</td></tr>
</tbody></table></td></tr></tbody></table>`;

test('a click on a page link shows a loading bar until the page is on screen', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let serial = 1;
    await page.route(origin + '/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const token = 'token-' + (++serial);
      if (pathname === '/commpilot/Reseller/Groups/') {
        await new Promise(resolve => setTimeout(resolve, 1500));   // a slow CommPilot page
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell('<h1 class="screenName">Groups</h1>', 'Groups', token) });
      }
      if (pathname === '/commpilot/Reseller/Admins/') {
        await new Promise(resolve => setTimeout(resolve, 500));
        return route.fulfill({ status: 500, contentType: 'text/html', body: 'Internal error' });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell(board, 'Reseller', token) });
    });
    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'atlas'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    await page.waitForTimeout(500);

    const bar = () => page.evaluate(() => {
      const el = document.getElementById('cp-progress');
      if (!el) return { on: false, width: 0 };
      return {
        on: el.classList.contains('cp-progress-on'), done: el.classList.contains('cp-progress-done'),
        width: new DOMMatrix(getComputedStyle(el).transform).a, top: el.getBoundingClientRect().top,
        color: getComputedStyle(el).backgroundColor, busy: document.documentElement.dataset.cpNav || null,
        rootProgress: document.documentElement.style.getPropertyValue('--cp-progress'),
      };
    });

    // A menu board option: the bar starts with the click and keeps moving while CommPilot works.
    await page.locator('a.navMenuItem[name="/Reseller/Groups/"]').first().click();
    const early = await bar();
    assert.equal(early.on, true, 'showing right after the click');
    assert.equal(early.busy, 'busy');
    assert.equal(early.top, 0, 'along the top of the window');
    assert.equal(early.color, 'rgb(8, 127, 137)', 'in the palette’s accent');
    await page.waitForTimeout(700);
    const later = await bar();
    assert.ok(later.width > early.width && later.width < 0.95, `still creeping forward (${early.width} → ${later.width})`);
    // Each tick moves the bar alone: an inherited variable on <html> would restyle the whole page 5 times a second.
    assert.deepEqual([early.rootProgress, later.rootProgress], ['', ''], 'the progress is not published on <html>');
    await page.waitForFunction(() => document.querySelector('.screenName')?.textContent === 'Groups');
    await page.waitForFunction(() => !document.getElementById('cp-progress').classList.contains('cp-progress-on'), null, { timeout: 2000 });
    assert.equal((await bar()).busy, null, 'the wait is over');

    // A failed page ends the bar too.
    await page.evaluate(url => window.redirectPost(url, { folder: 'R0', menuId: '8' }), folderPath);
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    await page.waitForFunction(() => !document.getElementById('cp-progress').classList.contains('cp-progress-on'), null, { timeout: 2000 });
    await page.waitForTimeout(500);
    await page.locator('a.navMenuItem[name="/Reseller/Admins/"]').first().click();
    assert.equal((await bar()).on, true);
    await page.waitForFunction(() => !document.getElementById('cp-progress').classList.contains('cp-progress-on') &&
      !document.documentElement.dataset.cpNav, null, { timeout: 4000 });
  } finally { await browser.close(); }
});
