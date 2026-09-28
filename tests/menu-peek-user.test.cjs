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
const userEntry = '/commpilot/Group/Members/Modify/index.jsp';
const routes = {
  dense: '/User/Profile/',
  acr: '/User/ACR/',
  dnd: '/User/DND/',
  cw: '/User/CW/',
  remote: '/User/RemoteOffice/',
  always: '/User/CF/Always/',
  busy: '/User/CF/Busy/',
  unreachable: '/User/CF/Not_Reachable/',
  portal: '/User/VoicePortalCalling/'
};

function menu(items) {
  return `<table width="100%"><tbody><tr><td width="100%" valign="TOP"><table width="100%"><tbody>
    <tr><td class="menuCategory">Basic</td></tr>
    ${items.map(([label, target]) => `<tr><td><a class="navMenuItem" name="${target}"
      onclick="redirectPost('/commpilot${target}', {})">${label}</a></td></tr>
      <tr><td>Configure ${label.toLowerCase()}.</td></tr>`).join('')}
    </tbody></table></td></tr></tbody></table>`;
}

function shell(body, { title = 'Profile', user = false } = {}) {
  const nav = user ? [
    ['U0', 'Profile'], ['U1', 'Incoming Calls'], ['U2', 'Call Control'], ['U3', 'Messaging']
  ] : [['R0', 'Reseller Profile']];
  const menuId = user ? '0' : '8';
  return `<!doctype html><html><head><title>${title}</title></head>
    <body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><span class="headerAuthLevel">${user ? 'TriSandbox1002' : 'Reseller'}</span></td></tr></table>
      <form name="leftNavForm">${nav.map(([id, label], i) =>
        `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}"
          onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'${menuId}'})">${label}</a>`
      ).join('')}</form>
      <input name="formtokenserial" value="token-1">
      <table height="100%"><tr><td width="82%" valign="top" style="width:1000px">${body}</td></tr></table>
      <script>window.redirectPost=function(){};</script>
    </body></html>`;
}

function radio(name, current) {
  return `<input type="radio" name="${name}" value="true"${current ? ' checked' : ''}>
    <input type="radio" name="${name}" value="false"${current ? '' : ' checked'}>`;
}

function checkbox(name, current) {
  return `<input type="checkbox" name="${name}" value="on"${current ? ' checked' : ''}>`;
}

function formFor(route, values) {
  const state = values[route];
  let fields = '';
  if (route === routes.dense) {
    fields = Array.from({ length: 16 }, (_, i) =>
      `<input type="text" name="profileField${i}" value="value${i}">`).join('');
  } else if (route === routes.acr || route === routes.portal) {
    fields = radio('active', state.active);
  } else if (route === routes.dnd) {
    fields = radio('active', state.active) + checkbox('ringSplash', state.ringSplash);
  } else if (route === routes.cw) {
    fields = radio('active', state.active) + checkbox('disableCLID', state.disableCLID);
  } else if (route === routes.remote) {
    fields = radio('active', state.active) +
      `<input type="text" name="remoteOfficeNumber" value="${state.remoteOfficeNumber}">`;
  } else if ([routes.always, routes.busy, routes.unreachable].includes(route)) {
    fields = radio('active', state.active) +
      `<input type="text" name="forwardedToNumber" value="${state.forwardedToNumber}">` +
      (route === routes.always ? checkbox('ringSplash', state.ringSplash) : '');
  }
  return `<form name="mainForm" method="post">${fields}
    <input type="submit" name="apply" value="Apply"></form>`;
}

test('User Peek keeps only compact settings and verifies radio, checkbox, and text edits in PJAX', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const userMenus = {
      U0: menu([['Profile', routes.dense]]),
      U1: menu([['Anonymous Rejection', routes.acr], ['Do Not Disturb', routes.dnd],
        ['Call Forwarding Always', routes.always], ['Call Forwarding Busy', routes.busy],
        ['Call Forwarding Not Reachable', routes.unreachable]]),
      U2: menu([['Call Waiting', routes.cw], ['Remote Office', routes.remote]]),
      U3: menu([['Voice Portal Calling', routes.portal]])
    };
    const values = {
      [routes.acr]: { active: false },
      [routes.dnd]: { active: false, ringSplash: false },
      [routes.cw]: { active: true, disableCLID: false },
      [routes.remote]: { active: false, remoteOfficeNumber: '' },
      [routes.always]: { active: false, forwardedToNumber: '', ringSplash: false },
      [routes.busy]: { active: false, forwardedToNumber: '' },
      [routes.unreachable]: { active: false, forwardedToNumber: '' },
      [routes.portal]: { active: true }
    };
    let context = 'reseller';
    const requests = [];
    await page.route(origin + '/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const params = new URLSearchParams(request.postData() || '');
      requests.push({ pathname, params, context });
      const respond = (body, title, user = true) => route.fulfill({
        status: 200, contentType: 'text/html', body: shell(body, { title, user })
      });
      if (pathname === userEntry) {
        context = 'user';
        return respond(userMenus.U0, 'User Profile');
      }
      if (pathname === folderPath && /^U\d+$/.test(params.get('folder') || '')) {
        context = 'folder:' + params.get('folder');
        return respond(userMenus[params.get('folder')], 'User ' + params.get('folder'));
      }
      if (pathname === folderPath) return respond(menu([['Users', '/Reseller/Users/']]), 'Profile', false);
      const routeName = pathname.replace(/^\/commpilot/, '');
      if (context !== 'user') return respond('<h1>Wrong user context</h1>', 'Unavailable');
      if (routeName in values || routeName === routes.dense) {
        if (params.has('apply')) {
          const state = values[routeName];
          if (state) {
            if ('active' in state) state.active = params.get('active') === 'true';
            if ('ringSplash' in state) state.ringSplash = params.has('ringSplash');
            if ('disableCLID' in state) state.disableCLID = params.has('disableCLID');
            if ('remoteOfficeNumber' in state) state.remoteOfficeNumber = params.get('remoteOfficeNumber') || '';
            if ('forwardedToNumber' in state) state.forwardedToNumber = params.get('forwardedToNumber') || '';
          }
        }
        return respond(formFor(routeName, values), routeName.split('/').filter(Boolean).at(-1));
      }
      return respond('<h1>Unknown route</h1>', 'Unknown');
    });

    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'nord'; });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')
      ?.dataset.cpLoaded === '1');
    await page.waitForTimeout(400);
    await page.evaluate(url => window.redirectPost(url, { key: 'Trifecta_Sandbox_SP>%Trifecta_Sandbox_Group>%TriSandbox1002' }), userEntry);
    await page.waitForFunction(url => location.pathname === url && document.querySelector('.cp-console-section[data-cp-folder="U0"]'),
      userEntry, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.cp-console-section .cp-console-body[data-cp-loaded="1"]').length === 4,
      null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.cp-leaf-summary').length === 8,
      null, { timeout: 10000 });

    const expected = [
      [routes.acr, 1], [routes.dnd, 2], [routes.cw, 2], [routes.remote, 2],
      [routes.always, 3], [routes.busy, 2], [routes.unreachable, 2], [routes.portal, 1]
    ];
    const boxFor = target => page.locator(`a[name="${target}"]`)
      .locator('xpath=ancestor::tr[1]/following-sibling::tr[1]//div[contains(@class,"cp-leaf-summary")]');
    for (const [target, count] of expected) {
      const box = boxFor(target);
      await box.scrollIntoViewIfNeeded();
      await page.waitForFunction(target => {
        const anchor = document.querySelector(`a[name="${target}"]`);
        return anchor?.closest('tr')?.nextElementSibling?.querySelector('.cp-leaf-summary')?.getAttribute('aria-busy') === 'false';
      }, target, { timeout: 10000 });
      assert.equal(await box.locator('.cp-leaf-row').count(), count, target);
      assert.ok(count <= 3, target);
    }
    assert.equal(await boxFor(routes.dense).count(), 0, 'dense User Profile must stay a native page');
    assert.equal(requests.some(r => r.pathname === '/commpilot' + routes.dense), false,
      'dense User Profile must not be fetched for Peek');
    assert.ok(requests.filter(r => r.pathname === userEntry).length >= 2,
      'the User entry must be replayed after folder prefetch');
    for (const [target] of expected) {
      assert.equal(requests.find(r => r.pathname === '/commpilot' + target)?.context, 'user',
        `Peek read ${target} before restoring the User context`);
    }

    const dnd = boxFor(routes.dnd);
    const dndActive = dnd.locator('.cp-leaf-row').nth(0);
    await dndActive.getByRole('button', { name: 'Edit value' }).click();
    await dndActive.locator('select.cp-leaf-editin').selectOption('true');
    await dndActive.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelector('a[name="/User/DND/"]')
      ?.closest('tr')?.nextElementSibling?.querySelector('.cp-leaf-defpill')?.textContent === 'On');
    assert.equal(values[routes.dnd].active, true);
    const dndRadioApply = requests.find(r => r.pathname === '/commpilot' + routes.dnd && r.params.has('apply'));
    assert.equal(dndRadioApply?.params.get('active'), 'true');
    assert.equal(dndRadioApply?.params.has('ringSplash'), false);
    assert.ok(requests.filter(r => r.pathname === '/commpilot' + routes.dnd && !r.params.has('apply')).length >= 3,
      'initial read, fresh form, and verification read must all use PJAX');

    const dndSplash = dnd.locator('.cp-leaf-row').nth(1);
    await dndSplash.getByRole('button', { name: 'Edit value' }).click();
    await dndSplash.locator('select.cp-leaf-editin').selectOption('true');
    await dndSplash.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelector('a[name="/User/DND/"]')
      ?.closest('tr')?.nextElementSibling?.querySelectorAll('.cp-leaf-defpill')[1]?.textContent === 'On');
    assert.equal(values[routes.dnd].ringSplash, true);
    const dndApplies = requests.filter(r => r.pathname === '/commpilot' + routes.dnd && r.params.has('apply'));
    assert.equal(dndApplies.at(-1).params.get('active'), 'true');
    assert.equal(dndApplies.at(-1).params.get('ringSplash'), 'on');

    const remote = boxFor(routes.remote);
    await remote.locator('.cp-leaf-row').nth(1).getByRole('button', { name: 'Edit value' }).click();
    await remote.locator('input.cp-leaf-editin').fill('12025550123');
    await remote.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelector('a[name="/User/RemoteOffice/"]')
      ?.closest('tr')?.nextElementSibling?.querySelectorAll('.cp-leaf-defpill')[1]?.textContent === '12025550123');
    assert.equal(values[routes.remote].remoteOfficeNumber, '12025550123');
    const remoteApply = requests.find(r => r.pathname === '/commpilot' + routes.remote && r.params.has('apply'));
    assert.equal(remoteApply?.params.get('active'), 'false');
    assert.equal(remoteApply?.params.get('remoteOfficeNumber'), '12025550123');
    assert.equal(await page.evaluate(() => location.pathname), userEntry,
      'inline edits must keep the User board in place');

    const portal = page.locator(`a[name="${routes.portal}"]`);
    const portalDescription = portal.locator('xpath=ancestor::tr[1]/following-sibling::tr[1]/td[1]');
    await portalDescription.click({ position: { x: 160, y: 10 } });
    await page.waitForFunction(target => location.pathname === target, '/commpilot' + routes.portal);
    assert.equal(await page.title(), 'VoicePortalCalling');
    assert.equal(requests.at(-1).pathname, '/commpilot' + routes.portal,
      'normal option navigation should still use PJAX');
  } finally { await browser.close(); }
});

test('a user board reads the user’s extension from Addresses first, in the user’s context', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const userMenus = {
      U0: menu([['Profile', routes.dense]]),
      U1: menu([['Do Not Disturb', routes.dnd]]),
      U2: menu([['Call Waiting', routes.cw]]),
      U3: menu([['Voice Portal Calling', routes.portal]])
    };
    let context = 'reseller', serial = 1;
    const requests = [];
    await page.route(origin + '/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const params = new URLSearchParams(request.postData() || '');
      requests.push({ pathname, context, token: params.get('formtokenserial') });
      const respond = (body, title, user = true) => route.fulfill({
        status: 200, contentType: 'text/html',
        body: shell(body, { title, user }).replace('value="token-1"', `value="token-${++serial}"`)
      });
      if (pathname === userEntry) { context = 'user'; return respond(userMenus.U0, 'User Profile'); }
      if (pathname === folderPath && /^U\d+$/.test(params.get('folder') || '')) {
        context = 'folder:' + params.get('folder');
        return respond(userMenus[params.get('folder')], 'User ' + params.get('folder'));
      }
      if (pathname === folderPath) return respond(menu([['Users', '/Reseller/Users/']]), 'Profile', false);
      if (context !== 'user') return respond('<h1>Wrong user context</h1>', 'Unavailable');
      if (pathname === '/commpilot/User/Addresses/') {
        return respond('<form name="mainForm"><input type="text" name="extension" id="extension" value="1002" size="4"></form>', 'Addresses');
      }
      const routeName = pathname.replace(/^\/commpilot/, '');
      if (routeName === routes.dnd || routeName === routes.cw || routeName === routes.portal) {
        return respond(`<form name="mainForm">${radio('active', false)}</form>`, 'Settings');
      }
      return respond('<h1>Unknown route</h1>', 'Unknown');
    });

    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    await page.evaluate(() => {
      document.documentElement.dataset.cpDirection = 'nord';
      window.extensionEvents = 0;
      document.addEventListener('cp:user-extension', () => { window.extensionEvents++; });
    });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelector('.cp-console-section[data-cp-folder="R0"] .cp-console-body')
      ?.dataset.cpLoaded === '1');
    const readsBefore = requests.filter(r => r.pathname === '/commpilot/User/Addresses/').length;
    assert.equal(readsBefore, 0, 'a reseller board does not read an extension');
    await page.waitForTimeout(400);
    await page.evaluate(url => window.redirectPost(url, { key: 'Trifecta_Sandbox_SP>%Trifecta_Sandbox_Group>%TriSandbox1002' }), userEntry);
    await page.waitForFunction(() => document.querySelector('td.headerBar span.headerAuthLevel')
      ?.getAttribute('data-cp-extension-state') === 'done', null, { timeout: 20000 });
    const id = await page.evaluate(() => {
      const el = document.querySelector('td.headerBar span.headerAuthLevel');
      return { ext: el.getAttribute('data-cp-extension'), events: window.extensionEvents, token: document.getElementsByName('formtokenserial')[0].value };
    });
    assert.equal(id.ext, '1002');
    assert.equal(id.events, 2, 'loading, then done');
    const reads = requests.filter(r => r.pathname === '/commpilot/User/Addresses/');
    assert.equal(reads.length, 1);
    assert.equal(reads[0].context, 'user', 'the read waits until the user context is restored');
    const peek = requests.findIndex(r => r.pathname === '/commpilot' + routes.dnd);
    assert.ok(peek === -1 || requests.indexOf(reads[0]) < peek, 'the extension is read before Peek');
    const next = requests.find((r, i) => i > requests.indexOf(reads[0]) && r.token);
    if (next) assert.notEqual(next.token, reads[0].token, 'the Addresses response’s token is threaded on');
    assert.equal(await page.evaluate(() => location.pathname), userEntry, 'the board stays in place');
  } finally { await browser.close(); }
});
