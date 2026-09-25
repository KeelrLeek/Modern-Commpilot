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
const routes = {
  dense: '/Group/Profile/',
  policy: '/Group/DeviceActivationPolicy/',
  extension: '/Group/ExtensionMgmt/',
  reporting: '/Group/Call_Center/ExternalReporting/',
  emergency: '/Group/EmergencyCallNotification/'
};

function shell(body, { title = 'Profile', group = false } = {}) {
  const nav = group ? [
    ['G0', 'Profile'], ['G1', 'Utilities']
  ] : [['R0', 'Reseller Profile']];
  const menuId = group ? '1' : '8';
  return `<!doctype html><html><head><title>${title}</title></head>
    <body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><span class="headerAuthLevel">${group ? 'Trifecta_Sandbox_Group' : 'Reseller'}</span></td></tr></table>
      <form name="leftNavForm">${nav.map(([id, label], i) =>
        `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}" onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'${menuId}'})">${label}</a>`
      ).join('')}</form>
      <input name="formtokenserial" value="token-1">
      <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script>
    </body></html>`;
}

function menu(items) {
  return `<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table width="100%"><tbody>
    <tr><td class="menuCategory">Basic</td></tr>
    ${items.map(([label, target]) => `<tr><td><a class="navMenuItem" name="${target}">${label}</a></td></tr>
      <tr><td>Configure ${label.toLowerCase()}.</td></tr>`).join('')}
    </tbody></table></td></tr></tbody></table>`;
}

test('Group Peek reserves compact docks, restores entity context, and verifies an email edit', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    const groupMenus = {
      G0: menu([['Profile', routes.dense], ['Activation Code Device Onboarding Policies', routes.policy],
        ['Extension Dialing', routes.extension], ['External Reporting Settings', routes.reporting],
        ['Emergency Call Notification', routes.emergency]]),
      G1: menu([['Other setting', '/Group/Other/']])
    };
    let context = 'reseller';
    let email = 'before@example.com';
    const requests = [];
    await page.route(origin + '/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const params = new URLSearchParams(request.postData() || '');
      requests.push({ pathname, params, context });
      const respond = (body, title, group = true) => route.fulfill({
        status: 200, contentType: 'text/html', body: shell(body, { title, group })
      });
      if (pathname === groupEntry) {
        context = 'group';
        return respond(groupMenus.G0, 'Group Profile');
      }
      if (pathname === folderPath && /^G\d+$/.test(params.get('folder') || '')) {
        context = 'folder:' + params.get('folder');
        return respond(groupMenus[params.get('folder')], 'Group ' + params.get('folder'));
      }
      if (pathname === folderPath) return respond(menu([['Groups', '/Reseller/Groups/']]), 'Profile', false);
      if (context !== 'group') return respond('<h1>Wrong entity context</h1>', 'Unavailable');
      if (pathname === '/commpilot' + routes.policy) return respond(
        '<form name="mainForm"><input type="radio" name="useServiceProviderSettings" value="true" checked>' +
        '<input type="radio" name="useServiceProviderSettings" value="false">' +
        '<input type="checkbox" name="allowActivationRequestByUser">' +
        '<input type="checkbox" name="sendActivationCodeInEmail"></form>', 'Activation Policy');
      if (pathname === '/commpilot' + routes.extension) return respond(
        '<form name="mainForm"><select name="groupExtMinLength"><option selected>3</option></select>' +
        '<select name="groupExtMaxLength"><option selected>6</option></select>' +
        '<select name="groupExtDefaultLength"><option selected>4</option></select></form>', 'Extension Dialing');
      if (pathname === '/commpilot' + routes.reporting) return respond(
        '<form name="mainForm"><input type="radio" name="reportingChoice" value="Off">' +
        '<input type="radio" name="reportingChoice" value="Enhanced" checked></form>', 'External Reporting');
      if (pathname === '/commpilot' + routes.emergency) {
        if (params.has('apply')) email = params.get('emergencyCallNotifyEmailAddress');
        return respond('<form name="mainForm"><input type="checkbox" name="sendEmergencyCallNotificationEmail" checked>' +
          `<input type="text" name="emergencyCallNotifyEmailAddress" value="${email}">` +
          '<input type="submit" name="apply" value="Apply"></form>', 'Emergency Call Notification');
      }
      if (pathname === '/commpilot' + routes.dense) return respond(
        '<form name="mainForm">' + Array.from({ length: 16 }, (_, i) =>
          `<input type="text" name="field${i}" value="value${i}">`).join('') + '</form>', 'Group Profile');
      return respond('<h1>Unknown route</h1>', 'Unknown');
    });

    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'nord'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')?.dataset.cpLoaded === '1');
    await page.waitForTimeout(450);
    await page.evaluate(url => window.redirectPost(url, { key: 'Trifecta_Sandbox_Group' }), groupEntry);
    await page.waitForFunction(url => location.pathname === url && document.querySelector('.cp-console-section[data-cp-folder="G0"]'), groupEntry);
    await page.waitForFunction(() => document.querySelectorAll('.cp-console-section .cp-console-body[data-cp-loaded="1"]').length === 2, null,
      { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.cp-leaf-summary').length === 4, null,
      { timeout: 10000 });
    const expected = [
      [routes.policy, 3], [routes.extension, 3], [routes.reporting, 1], [routes.emergency, 2]
    ];
    for (const [target, count] of expected) {
      const box = page.locator(`a[name="${target}"]`).locator('xpath=ancestor::tr[1]/following-sibling::tr[1]//div[contains(@class,"cp-leaf-summary")]');
      await box.scrollIntoViewIfNeeded();
      await box.waitFor();
      await page.waitForFunction(path => {
        const a = document.querySelector(`a[name="${path}"]`);
        return a?.closest('tr')?.nextElementSibling?.querySelector('.cp-leaf-summary')?.getAttribute('aria-busy') === 'false';
      }, target, { timeout: 30000 });
      assert.equal(await box.locator('.cp-leaf-row').count(), count, target);
      assert.equal(await box.locator('.cp-leaf-skeleton-row').count(), 0, target);
    }
    assert.equal(await page.locator(`a[name="${routes.dense}"]`).locator('xpath=ancestor::tr[1]/following-sibling::tr[1]//div[contains(@class,"cp-leaf-summary")]').count(), 0);
    assert.equal(requests.some(r => r.pathname === '/commpilot' + routes.dense), false,
      'dense Group Profile should not be fetched for Peek');
    assert.ok(requests.filter(r => r.pathname === groupEntry).length >= 2,
      'the Group entry should be replayed after folder prefetch');
    for (const [target] of expected) {
      const firstRead = requests.find(r => r.pathname === '/commpilot' + target);
      assert.equal(firstRead?.context, 'group', `Peek read ${target} before restoring Group context`);
    }
    const reporting = page.locator(`a[name="${routes.reporting}"]`).locator('xpath=ancestor::tr[1]/following-sibling::tr[1]//div[contains(@class,"cp-leaf-summary")]');
    assert.match(await reporting.innerText(), /Enhanced/);
    const emergency = page.locator(`a[name="${routes.emergency}"]`).locator('xpath=ancestor::tr[1]/following-sibling::tr[1]//div[contains(@class,"cp-leaf-summary")]');
    await emergency.getByRole('button', { name: 'Edit value' }).click();
    await emergency.locator('input.cp-leaf-editin').fill('after@example.com');
    await emergency.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelector('a[name="/Group/EmergencyCallNotification/"]')
      ?.closest('tr')?.nextElementSibling?.querySelector('.cp-leaf-defpill')?.textContent === 'after@example.com');
    assert.equal(email, 'after@example.com');
    assert.equal(await page.evaluate(() => location.pathname), groupEntry,
      'inline editing must leave the Group board in place');
    assert.equal(requests.filter(r => r.pathname === '/commpilot' + routes.emergency && r.params.has('apply')).length, 1);
    assert.ok(requests.filter(r => r.pathname === '/commpilot' + routes.emergency && !r.params.has('apply')).length >= 3,
      'Peek read, save refresh, and verification read must all use PJAX');
  } finally { await browser.close(); }
});
