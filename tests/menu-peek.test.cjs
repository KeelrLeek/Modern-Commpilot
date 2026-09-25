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
const leafPath = '/commpilot/Reseller/CallNotify/';

function shell(body, title = 'Profile') {
  return `<!doctype html><html><head><title>${title}</title></head>
    <body id="initBody.menuTemplate">
      <table><tr><td class="headerBar">Reseller</td></tr></table>
      <form name="leftNavForm"><a class="leftnavfolderopen"
        onclick="redirectPost('${folderPath}', {folder:'R0', menuId:'8'})">Profile</a></form>
      <input name="formtokenserial" value="token-1">
      <table><tr><td width="82%" valign="top">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script>
    </body></html>`;
}

const menu = shell(`<table><tbody><tr><td width="100%" valign="TOP"><table><tbody>
  <tr><td class="menuCategory">Basic</td></tr>
  <tr><td><a class="navMenuItem" id="link_notify" name="/Reseller/CallNotify/">Call Notify</a>
    <script>document.addEventListener('DOMContentLoaded',function(){
      document.getElementById('link_notify').addEventListener('click',function(){
        redirectPost('${leafPath}',{});
      });
    });</script></td></tr>
  <tr><td>Configure call notification settings.</td></tr>
  </tbody></table></td></tr></tbody></table>`);

test('Peek edits are verified from a fresh page and a full option row navigates through PJAX', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    let current = 'original@example.com';
    const requests = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      const params = new URLSearchParams(req.postData() || '');
      requests.push({ pathname, params });
      if (pathname === leafPath) {
        if (params.has('apply')) current = params.get('defaultFromEmailAddress');
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
          `<form name="mainForm" method="post"><input type="text" name="defaultFromEmailAddress" value="${current}">` +
          '<input type="submit" name="apply" value="Apply"></form>', 'Call Notify') });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: menu });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.locator('.cp-leaf-defpill').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('.cp-leaf-defpill').innerText(), current);
    await page.getByRole('button', { name: 'Edit value' }).click();
    await page.locator('input.cp-leaf-editin').fill('updated@example.com');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelector('.cp-leaf-defpill')?.textContent === 'updated@example.com');
    assert.equal(current, 'updated@example.com');
    assert.equal(requests.filter(r => r.pathname === leafPath && r.params.has('apply')).length, 1);
    assert.ok(requests.filter(r => r.pathname === leafPath && !r.params.has('apply')).length >= 3);
    const cell = page.locator('.cp-console-body a.navMenuItem').locator('xpath=ancestor::tr[1]/following-sibling::tr[1]/td[1]');
    await cell.click();
    await page.waitForFunction(pathname => location.pathname === pathname, leafPath);
    assert.equal(await page.title(), 'Call Notify');
    await page.evaluate(() => history.back());
    await page.locator('.cp-console-body a.navMenuItem').waitFor();
    assert.equal(await page.title(), 'Profile');
  } finally {
    await browser.close();
  }
});

test('opening an option while Peek reads it waits for the token-bearing request', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    let leafRequests = 0;
    await page.route('https://apps-sbx.avpaas.io/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === leafPath) {
        leafRequests++;
        if (leafRequests === 1) await new Promise(resolve => setTimeout(resolve, 500));
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
          '<form name="mainForm"><input type="text" name="defaultFromEmailAddress" value="original@example.com"></form>',
          'Call Notify') });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: menu });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.locator('.cp-leaf-loading').waitFor();
    for (let attempt = 0; attempt < 50 && leafRequests === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(leafRequests, 1);
    const cell = page.locator('.cp-console-body a.navMenuItem').locator('xpath=ancestor::tr[1]/following-sibling::tr[1]/td[1]');
    await cell.click();
    await page.waitForFunction(pathname => location.pathname === pathname, leafPath, { timeout: 10000 });
    assert.equal(await page.title(), 'Call Notify');
    assert.equal(leafRequests, 2);
  } finally { await browser.close(); }
});
