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
const origin = 'https://apps-sbx.avpaas.io';

// A user's page with CommPilot's header as served (trimmed): logo | Help, Home on the first row; the trail (with the
// Users link and the user's id) | Welcome + Logout on the second, spacer cells between.
const page = `<!doctype html><html><head><title>Call Forwarding Always</title></head><body id="initBody.menuTemplate">
  <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr><td colspan="3">
  <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody>
    <tr><td class="headerBar" colspan="2"><img src="/commpilot/Graphics/onepx.gif" width="2" height="2"></td></tr>
    <tr><td align="left" valign="middle" class="headerBar"><img src="/commpilot/conf/clientLogo.gif"></td>
      <td valign="middle" align="right" class="headerBar"><a class="headerLink">Help</a>&nbsp;&nbsp;<a class="headerLink">Home</a></td>
      <td class="headerBar"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1"></td></tr>
    <tr><td class="headerBar" colspan="3"><img src="/commpilot/Graphics/onepx.gif" width="2" height="5"></td></tr>
    <tr><td class="headerBar"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1">
        <a class="headerAuthLevelLink" onclick="window.opened = 'Reseller'">Reseller</a> &gt;&nbsp;<a class="headerAuthLevelLink" onclick="window.opened = 'SP'">Trifecta_Sandbox_SP</a> &gt;&nbsp;<a class="headerAuthLevelLink" onclick="window.opened = 'Group'">Trifecta_Sandbox_Group</a> &gt;&nbsp;<a class="headerAuthLevelLink">Users</a> :<span dir="ltr" class="headerAuthLevel"> TriSandbox1002</span></td>
      <td class="headerBar" align="right"><span class="headerBarWelcome">Welcome&nbsp;Kolozsi Kyle&nbsp;</span> <a class="headerLink" id="native-logout">[Logout]</a></td>
      <td class="headerBar"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1"></td></tr>
  </tbody></table></td></tr></tbody></table>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" height="100%"><tbody><tr>
    <td width="18%" valign="top" class="headandfoot"><form name="leftNavForm"><b><table><tbody><tr><td class="navOptions">Options:</td></tr>
      <tr><td class="leftnavfolderopen"><a class="leftnavfolderopen">Incoming Calls</a></td></tr></tbody></table></b></form></td>
    <td width="82%" valign="top"><form name="mainForm"><input type="hidden" name="formtokenserial" value="t1">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tbody><tr><td class="screenName">Call Forwarding Always</td></tr>
      <tr><td class="enduserbody">Settings</td></tr></tbody></table></form></td></tr></tbody></table>
</body></html>`;

async function openApp(context, width, height) {
  const tab = await context.newPage();
  await tab.setViewportSize({ width, height });
  await tab.goto(origin + '/commpilot/Login/');
  await tab.evaluate(() => {
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/commpilot/Common/folder_contents.jsp';
    document.body.append(form); form.submit();
  });
  await tab.waitForFunction(() => document.body?.id === 'initBody.menuTemplate' && document.getElementById('cp-account') &&
    document.querySelector('td.headerBar .cp-bc'));
  // pjax.js adds the page pill on a content page: the longest trail.
  await tab.evaluate(() => {
    const pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'cp-page-pill'; pill.innerHTML = '<span>Call Forwarding Always</span>';
    document.querySelector('td.headerBar span.headerAuthLevel').after(pill);
  });
  await tab.waitForFunction(() => document.querySelector('.cp-bc .cp-bc-cur')?.textContent.trim() === 'Call Forwarding Always');
  await tab.waitForTimeout(400);
  return tab;
}

const bar = tab => tab.evaluate(() => {
  const r = el => el.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('td.headerBar:not(:has(.headerBarWelcome)) :is(a.headerLink, #cp-appearance-toggle, #cp-account)')];
  const rows = [...document.querySelector('td.headerBar').closest('table').querySelectorAll(':scope > tbody > tr')]
    .filter(tr => getComputedStyle(tr).display !== 'none');
  const trail = document.querySelector('td.headerBar .cp-bc');
  const shown = el => !!el && getComputedStyle(el).display !== 'none';
  return {
    labels: buttons.map(b => b.id === 'cp-account' ? 'account' : (b.textContent.trim() || b.title)),
    heights: [...new Set(buttons.map(b => Math.round(r(b).height)))],
    radii: [...new Set(buttons.map(b => getComputedStyle(b).borderTopLeftRadius))],
    gaps: [...new Set(buttons.slice(1).map((b, i) => Math.round(r(b).left - r(buttons[i]).right)))],
    inView: buttons.every(b => r(b).right <= innerWidth && r(b).left >= 0),
    iconOnly: buttons.filter(b => b.id !== 'cp-account').map(b => getComputedStyle(b).fontSize === '0px' && Math.round(r(b).width) === 34),
    titles: buttons.filter(b => b.id !== 'cp-account').map(b => b.title),
    accountName: shown(document.querySelector('#cp-account .cp-account-name')),
    account: (a => [Math.round(r(a).width), Math.round(r(a).height), !!a.querySelector('svg.cp-account-icon')])(document.getElementById('cp-account')),
    rows: rows.map(tr => Math.round(r(tr).height)),
    trailLines: Math.round(r(trail).height) <= 30,
    trailFits: trail.closest('td').scrollWidth <= trail.closest('td').clientWidth + 1,
    more: shown(document.querySelector('.cp-bc-more')),
    folded: [...trail.querySelectorAll('a.headerAuthLevelLink.cp-bc-folded')].map(a => a.textContent.trim()),
    welcome: shown(document.querySelector('.headerBarWelcome').closest('td')),
  };
});

test('the top bar: two rows sized on their own, one shape for its buttons, an account menu, a trail on one line', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-topbar-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: browserPath, headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
    await context.route(origin + '/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    await context.route(origin + '/commpilot/Common/folder_contents.jsp', route => route.fulfill({ status: 200, contentType: 'text/html', body: page }));
    await context.route(origin + '/commpilot/Login/', route => route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' }));

    // A wide window: names on the buttons, the full trail, the welcome cell folded into the account button.
    const wide = await openApp(context, 1920, 1080);
    const w = await bar(wide);
    assert.deepEqual(w.labels, ['Help', 'Home', 'Settings', 'account']);
    assert.deepEqual([w.heights, w.radii, w.gaps], [[34], ['10px'], [8]], 'one height, one shape, even spacing');
    assert.equal(w.inView, true);
    assert.deepEqual(w.iconOnly, [false, false, false]);
    assert.equal(w.accountName, true);
    assert.equal(w.welcome, false, 'the welcome cell gives way to the account button');
    assert.deepEqual([w.more, w.folded, w.trailFits, w.trailLines], [false, [], true, true], 'the whole trail on one line');

    // The account menu: who is signed in, and Sign out (CommPilot's own link, so it still asks first).
    await wide.locator('#cp-account').click();
    const menu = wide.getByRole('menu');
    await menu.waitFor();
    assert.match(await menu.textContent(), /Kolozsi Kyle/);
    await wide.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    await wide.locator('#cp-account').click();
    await wide.getByRole('menuitem', { name: 'Sign out' }).click();
    await wide.getByRole('dialog', { name: 'Sign out of CommPilot?' }).waitFor();
    await wide.getByRole('button', { name: 'Stay here' }).click();

    // A page swap can carry the old copy toolbar in with the header: it never shows.
    await wide.evaluate(() => document.querySelector('td.headerBar:has(.cp-bc)').insertAdjacentHTML('beforeend',
      '<span class="bw-copy-controls" data-bw-owned="1"><button type="button">Copy User ID</button><button type="button">Copy Extension</button></span>'));
    await wide.waitForTimeout(300);
    assert.equal(await wide.locator('.bw-copy-controls').count(), 0, 'the old toolbar is taken out');
    assert.equal(await wide.locator('.cp-copy-id').count(), 1, 'the pill’s copy icon stays');

    // A 4:3 window: icons with their names on hover, initials, and a trail that folds into "…" instead of wrapping.
    const small = await openApp(context, 1024, 768);
    const s = await bar(small);
    assert.equal(s.inView, true, 'nothing pushed off the edge');
    assert.deepEqual([s.heights, s.radii, s.gaps], [[34], ['10px'], [8]]);
    assert.deepEqual(s.iconOnly, [true, true, true]);
    assert.deepEqual(s.titles, ['Help', 'Home', 'Settings · Atlas']);
    assert.equal(s.accountName, false);
    assert.deepEqual(s.account, [34, 34, true], 'the account button: its icon in the same 34px square as the others');
    assert.equal(s.trailFits && s.trailLines, true, 'the trail keeps one line');
    assert.equal(s.more, true);
    assert.ok(s.folded.length >= 1 && s.folded[0] === 'Trifecta_Sandbox_SP', `levels fold, earliest first (${s.folded})`);
    await small.locator('.cp-bc-more').click();
    const hidden = small.locator('#cp-bc-more-menu');
    await hidden.waitFor();
    assert.equal((await hidden.getByRole('menuitem').allTextContents())[0], 'Trifecta_Sandbox_SP');
    await hidden.getByRole('menuitem', { name: 'Trifecta_Sandbox_SP' }).click();
    assert.equal(await small.evaluate(() => window.opened), 'SP', 'a folded level opens with CommPilot’s own link');

    // Wider again: everything unfolds.
    await small.setViewportSize({ width: 1920, height: 1080 });
    await small.waitForFunction(() => !document.querySelector('.cp-bc a.cp-bc-folded'));
    assert.deepEqual((await bar(small)).iconOnly, [false, false, false]);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
