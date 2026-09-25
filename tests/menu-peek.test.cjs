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
    await page.waitForFunction(() => {
      const dock = document.querySelector('.cp-leaf-summary');
      return dock?.querySelector('.cp-leaf-row') && !dock.style.height && !dock.style.overflow;
    });
    assert.equal(await page.locator('.cp-leaf-key').innerText(), 'Current ·');
    assert.equal(await page.locator('.cp-leaf-valwrap').evaluate(wrap =>
      wrap.lastElementChild?.classList.contains('cp-leaf-act')), true);
    assert.equal(await page.locator('.cp-leaf-defpill').innerText(), current);
    await page.getByRole('button', { name: 'Edit value' }).click();
    assert.equal(await page.locator('.cp-leaf-valwrap').evaluate(wrap =>
      wrap.firstElementChild?.classList.contains('cp-leaf-hidden') &&
      wrap.querySelector('input.cp-leaf-editin')?.nextElementSibling?.title === 'Save'), true);
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
    await page.locator('.cp-leaf-loading').waitFor({ state: 'attached' });
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

test('Peek reserves its space during section reveal but waits to read until the board is ready', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const twoFolderMenu = menu.replace('Profile</a></form>',
      `Profile</a><a class="leftnavfolder"
        onclick="redirectPost('${folderPath}', {folder:'R1', menuId:'8'})">Resources</a></form>`);
    let finishSecond;
    const secondFolder = new Promise(resolve => { finishSecond = resolve; });
    let leafReads = 0;
    await page.route('https://apps-sbx.avpaas.io/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const params = new URLSearchParams(route.request().postData() || '');
      if (pathname === leafPath) {
        leafReads++;
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
          '<form name="mainForm"><input type="text" name="defaultFromEmailAddress" value="ready@example.com"></form>',
          'Call Notify') });
      }
      if (params.get('folder') === 'R1') await secondFolder;
      return route.fulfill({ status: 200, contentType: 'text/html', body: twoFolderMenu });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.locator('.cp-console-section[data-cp-folder="R0"] .cp-leaf-loading').waitFor({ state: 'attached' });
    assert.equal(leafReads, 0);
    assert.equal(await page.locator('.cp-console-section[data-cp-folder="R0"] .cp-leaf-summary').count(), 1);
    finishSecond();
    await page.locator('.cp-console-section[data-cp-folder="R0"] .cp-leaf-defpill').waitFor();
    assert.ok(leafReads >= 1);
  } finally { await browser.close(); }
});

test('two- and three-value Peek docks keep later options still while the whole result appears', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  let releaseProfile;
  let releaseVm;
  const profileGate = new Promise(resolve => { releaseProfile = resolve; });
  const vmGate = new Promise(resolve => { releaseVm = resolve; });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    const multiMenu = shell(`<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table width="100%"><tbody>
      <tr><td class="menuCategory">Basic</td></tr>
      <tr><td><a class="navMenuItem" name="/Reseller/Profile/">Profile</a></td></tr>
      <tr><td>Display reseller profile.</td></tr>
      <tr><td><a class="navMenuItem" name="/Reseller/VM/">Voice Messaging</a></td></tr>
      <tr><td>Configure voice messaging.</td></tr>
      <tr><td><a class="navMenuItem" name="/Reseller/Next/">Next option</a></td></tr>
      <tr><td>Keep this option in place.</td></tr>
    </tbody></table></td></tr></tbody></table>`);
    await page.route('https://apps-sbx.avpaas.io/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/commpilot/Reseller/Profile/') {
        await profileGate;
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
          '<table><tr><td>Reseller ID:</td><td>Trifecta_Sandbox</td></tr><tr><td>Name:</td><td>Trifecta Sandbox</td></tr></table>', 'Profile') });
      }
      if (pathname === '/commpilot/Reseller/VM/') {
        await vmGate;
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell(
          '<form name="mainForm"><input type="text" name="delivery" value="delivery@example.com">' +
          '<input type="text" name="notification" value="notification@example.com">' +
          '<input type="text" name="lockout" value="lockout@example.com"></form>', 'Voice Messaging') });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: multiMenu });
    });
    await page.goto('https://apps-sbx.avpaas.io' + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'nord'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelectorAll('.cp-leaf-summary[data-cp-peek-started]').length === 2);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600); // let the board's own section entrance finish before measuring Peek
    const geometry = () => page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.cp-leaf-summary')];
      const links = [...document.querySelectorAll('.cp-console-body a.navMenuItem')];
      return {
        heights: boxes.map(box => box.getBoundingClientRect().height),
        widths: boxes.map(box => box.getBoundingClientRect().width),
        skeletons: boxes.map(box => box.querySelectorAll('.cp-leaf-skeleton-row').length),
        voiceTop: links.find(a => a.textContent.trim() === 'Voice Messaging')?.getBoundingClientRect().top,
        nextTop: links.find(a => a.textContent.trim() === 'Next option')?.getBoundingClientRect().top,
        voiceOffset: links.find(a => a.textContent.trim() === 'Voice Messaging')?.closest('tr')?.offsetTop,
        nextOffset: links.find(a => a.textContent.trim() === 'Next option')?.closest('tr')?.offsetTop
      };
    });
    const before = await geometry();
    assert.deepEqual(before.skeletons, [2, 3]);
    assert.deepEqual(before.heights, [86, 128]);
    const busyClickCanceled = await page.locator('.cp-leaf-summary').nth(1).locator('.cp-leaf-loading')
      .evaluate(loading => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        loading.dispatchEvent(event);
        return event.defaultPrevented;
      });
    assert.equal(busyClickCanceled, true, 'clicks during the Peek reveal must not open the option');
    releaseProfile();
    await page.waitForFunction(() => document.querySelectorAll('.cp-leaf-summary')[0]?.getAttribute('aria-busy') === 'false');
    const afterProfile = await geometry();
    assert.equal(await page.locator('.cp-leaf-summary').nth(0).locator('.cp-leaf-row').count(), 2);
    assert.ok(Math.abs(afterProfile.heights[0] - before.heights[0]) < 1, JSON.stringify({ before, afterProfile }));
    assert.ok(Math.abs(afterProfile.widths[0] - before.widths[0]) < 1, JSON.stringify({ before, afterProfile }));
    assert.ok(Math.abs(afterProfile.voiceOffset - before.voiceOffset) < 1, JSON.stringify({ before, afterProfile }));
    releaseVm();
    await page.waitForFunction(() => document.querySelectorAll('.cp-leaf-summary')[1]?.getAttribute('aria-busy') === 'false');
    const afterVm = await geometry();
    assert.equal(await page.locator('.cp-leaf-summary').nth(1).locator('.cp-leaf-row').count(), 3);
    assert.ok(Math.abs(afterVm.heights[1] - before.heights[1]) < 1, JSON.stringify({ before, afterVm }));
    assert.ok(Math.abs(afterVm.widths[1] - before.widths[1]) < 1, JSON.stringify({ before, afterVm }));
    assert.ok(Math.abs(afterVm.nextOffset - before.nextOffset) < 1, JSON.stringify({ before, afterVm }));
    assert.equal(await page.locator('.cp-leaf-summary').nth(1).evaluate(box => box.getAnimations({ subtree: true }).length), 0);
    await page.locator('.cp-leaf-summary').nth(1).locator('.cp-leaf-row').nth(1)
      .getByRole('button', { name: 'Edit value' }).click();
    assert.equal(await page.locator('.cp-leaf-editin').inputValue(), 'notification@example.com');
    await page.locator('.cp-leaf-editin').press('Escape');
    assert.equal(await page.locator('.cp-leaf-summary').nth(1).locator('.cp-leaf-row').nth(1)
      .locator('.cp-leaf-defpill').innerText(), 'notification@example.com');
  } finally {
    releaseProfile();
    releaseVm();
    await browser.close();
  }
});
