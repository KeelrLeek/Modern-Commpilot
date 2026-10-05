const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;

// A user's page with CommPilot's header (trimmed): the site's logo cell | Help, Home on the first row; the trail |
// Welcome + Logout on the second. The sandbox serves Cisco's logo in the first cell; the main site serves nothing there.
const page = logo => `<!doctype html><html><head><title>Call Forwarding Always</title></head><body id="initBody.menuTemplate">
  <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr><td colspan="3">
  <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody>
    <tr><td class="headerBar" colspan="2"><img src="/commpilot/Graphics/onepx.gif" width="2" height="2"></td></tr>
    <tr><td align="left" valign="middle" class="headerBar">${logo ? '<img src="/commpilot/conf/clientLogo.gif">' : ''}</td>
      <td valign="middle" align="right" class="headerBar"><a class="headerLink" onclick="window.opened = 'Help'">Help</a>&nbsp;&nbsp;<a class="headerLink" onclick="window.opened = (window.opened || 0) + 1">Home</a></td>
      <td class="headerBar"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1"></td></tr>
    <tr><td class="headerBar" colspan="3"><img src="/commpilot/Graphics/onepx.gif" width="2" height="5"></td></tr>
    <tr><td class="headerBar"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1">
        <a class="headerAuthLevelLink">Reseller</a> &gt;&nbsp;<a class="headerAuthLevelLink">Trifecta_Sandbox_SP</a> &gt;&nbsp;<a class="headerAuthLevelLink">Users</a> :<span dir="ltr" class="headerAuthLevel"> TriSandbox1002</span></td>
      <td class="headerBar" align="right"><span class="headerBarWelcome">Welcome&nbsp;Kolozsi Kyle&nbsp;</span> <a class="headerLink" id="native-logout">[Logout]</a></td>
      <td class="headerBar"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1"></td></tr>
  </tbody></table></td></tr></tbody></table>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" height="100%"><tbody><tr>
    <td width="18%" valign="top" class="headandfoot"><form name="leftNavForm"><b><table><tbody><tr><td class="navOptions">Options:</td></tr>
      <tr><td class="leftnavfolderopen"><a class="leftnavfolderopen">Incoming Calls</a></td></tr></tbody></table></b></form></td>
    <td width="82%" valign="top"><form name="mainForm"><input type="hidden" name="formtokenserial" value="t1">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tbody><tr><td class="screenName">Call Forwarding Always</td></tr>
      <tr><td class="enduserbody">Settings</td></tr></tbody></table></form></td></tr></tbody></table>
  <script>window.redirectPost = function () {};</script>
</body></html>`;

async function route(context, origin, logo) {
  await context.route(origin + '/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  await context.route(origin + '/commpilot/Common/folder_contents.jsp', r => r.fulfill({ status: 200, contentType: 'text/html', body: page(logo) }));
  // A slow CommPilot page, opened in place by pjax.js.
  await context.route(origin + '/commpilot/User/Profile/', async r => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    r.fulfill({ status: 200, contentType: 'text/html', body: page(logo).replace(/Call Forwarding Always/g, 'Profile') });
  });
  await context.route(origin + '/commpilot/Login/', r => r.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' }));
}

async function openApp(context, origin, width, height) {
  const tab = await context.newPage();
  await tab.setViewportSize({ width, height });
  await tab.goto(origin + '/commpilot/Login/');
  await tab.evaluate(() => {
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/commpilot/Common/folder_contents.jsp';
    document.body.append(form); form.submit();
  });
  await tab.waitForFunction(() => document.body?.id === 'initBody.menuTemplate' && document.getElementById('cp-account') &&
    document.querySelector('td.headerBar > .cp-brand'));
  await tab.waitForTimeout(1500);   // the trace's first sweep and the dot
  return tab;
}

const bar = tab => tab.evaluate(() => {
  const r = el => el.getBoundingClientRect();
  const brand = document.querySelector('.cp-brand'), cell = brand.parentElement, row = r(cell);
  const buttons = [...cell.querySelectorAll(':is(a.headerLink, #cp-help-tips, #cp-appearance-toggle, #cp-account)')]
    .filter(b => getComputedStyle(b).display !== 'none');
  const edge = r(brand.querySelector('.cp-brand-edge')), dot = r(brand.querySelector('.cp-brand-dot'));
  return {
    first: cell.firstElementChild === brand,
    others: [...cell.parentElement.children].filter(c => c !== cell).map(c => getComputedStyle(c).display),
    left: Math.round(r(brand).left),
    middle: Math.round(r(brand).top + r(brand).height / 2 - row.top),
    buttonsRight: Math.round(innerWidth - r(buttons.at(-1)).right),
    clear: r(buttons[0]).left - r(brand).right,
    env: brand.dataset.env,
    tag: brand.querySelector('.cp-brand-tag').textContent,
    row: Math.round(row.height),
    edge: [Math.round(edge.left), Math.round(edge.bottom - row.bottom), Math.round(edge.right - r(brand).right)],
    dot: Math.round(dot.top + dot.height / 2 - row.bottom),
    font: getComputedStyle(brand.querySelector('.cp-brand-name')).fontFamily,
    favicon: document.getElementById('cp-favicon')?.getAttribute('href') || '',
    isNew: brand.classList.contains('cp-brand-new'),
  };
});

test('the logo: the same top bar on every CommPilot site, which site it is, the trace on the bar’s edge, Home', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-brand-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: browserPath, headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
    await route(context, 'https://apps-sbx.avpaas.io', true);
    await route(context, 'https://apps.avpaas.io', false);

    // The sandbox: Cisco's logo cell gives way to ours; the buttons stay on the right.
    const sbx = await openApp(context, 'https://apps-sbx.avpaas.io', 1920, 1080);
    const s = await bar(sbx);
    assert.equal(s.first, true, 'the logo leads the buttons’ cell');
    assert.ok(s.others.every(d => d === 'none'), `the site’s logo cell and spacers are hidden (${s.others})`);
    assert.deepEqual([s.left, s.buttonsRight], [27, 27], 'logo on the left, buttons on the right, one gutter');
    assert.ok(Math.abs(s.middle - s.row / 2) <= 1, `the logo is centred in the row (${s.middle} of ${s.row})`);
    assert.deepEqual([s.env, s.tag], ['sandbox', `v${version} · apps-sbx.avpaas`], 'the version and the site, no LIVE/SANDBOX label');
    assert.equal(s.row, 70);
    assert.deepEqual(s.edge, [0, 0, 0], 'the trace runs from the window’s edge to the logo’s end, on the bar’s bottom edge');
    assert.equal(s.dot, -1, 'the dot sits on the trace');
    assert.match(s.favicon, /\/assets\/icons\/theme-atlas-sbx\.svg$/, "the tab shows the theme's icon, with the sandbox's dot");
    assert.equal(s.isNew, true, 'a new version: the dot wears its ring');

    // The logo is the Home button: a click or Enter presses CommPilot's own Home link; a modified click does not.
    await sbx.locator('.cp-brand .cp-brand-name').click();
    await sbx.locator('.cp-brand .cp-brand-name').click({ modifiers: ['Control'] });
    await sbx.locator('.cp-brand').focus();
    await sbx.keyboard.press('Enter');
    assert.equal(await sbx.evaluate(() => window.opened), 2);
    assert.match(await sbx.locator('.cp-brand').getAttribute('title'), new RegExp(`^Home · CommPilot Enhancer ${version.replace(/\./g, '\\.')}$`));

    // The trace is the loading bar: while CommPilot works a line runs along it from the left (no bar along the top
    // of the window); when the page lands the line reaches the dot, which pings, and the trace is whole again.
    const loading = () => sbx.evaluate(() => {
      const load = document.querySelector('.cp-brand-load'), trace = document.querySelector('.cp-brand-trace');
      return { state: document.documentElement.dataset.cpProgress || null, bar: !!document.getElementById('cp-progress'),
        load: getComputedStyle(load).visibility === 'visible' ? +(1 - parseFloat(getComputedStyle(load).strokeDashoffset)).toFixed(2) : null,
        trace: getComputedStyle(trace).visibility,
        ping: document.querySelector('.cp-brand-ping').getAnimations().some(a => a.animationName === 'cp-brand-ping') };
    });
    await sbx.evaluate(() => window.redirectPost('/commpilot/User/Profile/', {}));
    await sbx.waitForTimeout(700);
    const busy = await loading();
    assert.deepEqual([busy.state, busy.bar, busy.trace], ['on', false, 'hidden'], 'loading: the logo’s line, no top bar');
    assert.ok(busy.load > 0.1 && busy.load < 0.92, `the line is on its way (${busy.load})`);
    await sbx.waitForFunction(() => document.documentElement.dataset.cpProgress === 'done');
    await sbx.waitForTimeout(300);
    const landed = await loading();
    assert.deepEqual([landed.load, landed.ping], [1, true], 'landed: the line reaches the dot, which pings');
    await sbx.waitForFunction(() => !document.documentElement.dataset.cpProgress, null, { timeout: 3000 });
    assert.deepEqual(await loading(), { state: null, bar: false, load: null, trace: 'visible', ping: false });
    assert.equal(await sbx.evaluate(() => document.querySelector('td.screenName').textContent), 'Profile');

    // The account menu says which site; Settings shows the tile, and About (seeing it takes the dot's ring off).
    await sbx.locator('#cp-account').click();
    assert.match(await sbx.getByRole('menu').textContent(), /Signed in to CommPilot · Sandbox/);
    await sbx.keyboard.press('Escape');
    await sbx.locator('#cp-appearance-toggle').click();
    const dialog = sbx.getByRole('dialog', { name: 'Settings' });
    await dialog.waitFor();
    assert.equal(await dialog.locator('.cp-settings-icon.cp-settings-pulse svg').count(), 1);
    const about = dialog.getByRole('region', { name: 'About' });
    assert.match(await about.textContent(), new RegExp(`CommPilot Enhancer ${version.replace(/\./g, '\\.')}.*apps-sbx\\.avpaas\\.io`));
    assert.ok(await about.getByRole('listitem').count() >= 1, 'what is new in this version');
    await sbx.waitForFunction(() => !document.querySelector('.cp-brand').classList.contains('cp-brand-new'));
    await sbx.keyboard.press('Escape');

    // One column down the left edge: the breadcrumb's leading icon over the sidebar's icons, open or folded.
    const column = () => sbx.evaluate(() => {
      const r = el => el.getBoundingClientRect(), link = document.querySelector('a.leftnavfolderopen'), cs = getComputedStyle(link);
      const lead = r(document.querySelector('.cp-bc-lead'));
      return [Math.round(lead.left + lead.width / 2), Math.round(r(link).left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + 9)];
    });
    assert.deepEqual(await column(), [34, 34]);
    await sbx.locator('.cp-side-toggle').click();
    await sbx.waitForTimeout(450);
    assert.deepEqual(await column(), [34, 34], 'folded to the rail, still one column');
    await sbx.locator('.cp-side-toggle').click();
    await sbx.waitForTimeout(450);

    // The site font setting leaves the logo's lettering alone.
    await sbx.evaluate(() => document.documentElement.setAttribute('data-cp-font', 'verdana'));
    assert.match((await bar(sbx)).font, /^"?Inter"?/);

    // The main site: no logo of its own, yet the same bar: our logo on the left, the buttons on the right.
    const main = await openApp(context, 'https://apps.avpaas.io', 1920, 1080);
    const m = await bar(main);
    assert.deepEqual([m.left, m.buttonsRight, m.env, m.tag], [27, 27, 'live', `v${version} · apps.avpaas`]);
    assert.match(m.favicon, /\/assets\/icons\/theme-atlas\.svg$/, "the tab shows the theme's icon");
    assert.equal(m.isNew, false, 'About was seen (the version is remembered across tabs)');
    await main.locator('#cp-account').click();
    assert.match(await main.getByRole('menu').textContent(), /Signed in to CommPilot(?! ·)/);

    // A 4:3 window with a short screen: the row is 52px and the trace still lies on its edge, clear of the buttons.
    const small = await openApp(context, 'https://apps.avpaas.io', 1024, 768);
    const w = await bar(small);
    assert.deepEqual([w.row, w.edge, w.dot], [52, [0, 0, 0], -1]);
    assert.ok(w.clear > 100, `the logo stays clear of the buttons (${w.clear}px)`);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
