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

// A user's Profile (served as the main page) with the parts that used to disagree: the breadcrumb (Inter), the page title (Geist) and
// CommPilot's own tables and form controls (Arial). A code sample keeps its monospace.
const page = `<!doctype html><html><head><title>Profile</title></head><body id="initBody.menuTemplate">
  <table><tr><td class="headerBar" id="crumbs"><img src="/commpilot/Graphics/onepx.gif" width="2" height="1">
    <a class="headerAuthLevelLink">Reseller</a> &gt;&nbsp;<a class="headerAuthLevelLink">Trifecta_Sandbox_Group</a> &gt;&nbsp;<a class="headerAuthLevelLink">Users</a> :<span dir="ltr" class="headerAuthLevel"> TriSandbox1002</span></td>
    <td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr>
    <tr><td class="headerBar"><span class="headerBarWelcome">Welcome Test User</span></td></tr></table>
  <table height="100%"><tr><td class="headandfoot" width="18%">
    <form name="leftNavForm"><a class="leftnavfolder">Profile</a><a class="leftnavfolder">Incoming Calls</a></form>
  </td><td width="82%" valign="top">
    <table><tr><td class="screenName">Profile</td></tr></table>
    <form><table><tr><td class="formLabel">First Name:</td><td><input type="text" name="firstName" value="Test"></td></tr>
      <tr><td class="formLabel">Time Zone:</td><td><select><option>(GMT-06:00) Central Time</option></select></td></tr></table>
      <input type="button" value="OK"> <button type="button">Cancel</button></form>
    <table class="dataTable"><tr><th>Phone Number</th><th>Extension</th></tr><tr><td>205-555-0102</td><td>0102</td></tr></table>
    <code id="sample-code">*72 205-555-0102</code>
  </td></tr></table>
</body></html>`;

test('Settings opens as a window and its font becomes the font of every part of every CommPilot page', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-font-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: browserPath, headless: true, viewport: { width: 1400, height: 900 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    // Nothing leaves the test: any other CommPilot address gets an empty page.
    await context.route(origin + '/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    await context.route(origin + '/commpilot/Common/folder_contents.jsp', route => route.fulfill({ status: 200, contentType: 'text/html',
      headers: { 'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" },
      body: page }));
    await context.route(origin + '/commpilot/Login/', route => route.fulfill({ status: 200, contentType: 'text/html', body:
      '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' }));
    // Signed in the way CommPilot does it: the login page posts to the main page.
    async function openApp(target) {
      await target.goto(origin + '/commpilot/Login/');
      await target.evaluate(() => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/commpilot/Common/folder_contents.jsp';
        document.body.append(form);
        form.submit();
      });
      await target.waitForFunction(() => document.body?.id === 'initBody.menuTemplate');
    }
    const tab = await context.newPage();
    await openApp(tab);
    await tab.locator('#crumbs .cp-bc').waitFor();
    await tab.waitForFunction(() => document.documentElement.getAttribute('data-cp-font') === 'inter');

    // Every element (and its ::before/::after) uses one font; code keeps its own.
    const fonts = () => tab.evaluate(() => {
      const skip = el => el.closest('svg, code, pre, kbd, samp, .cp-font-sample, .cp-brand');   // the logo keeps its lettering
      const families = new Map();
      const note = (family, where) => { if (!families.has(family)) families.set(family, where); };
      for (const el of document.body.querySelectorAll('*')) {
        if (skip(el) || el.closest('.cp-settings-overlay[hidden]')) continue;
        const where = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
        note(getComputedStyle(el).fontFamily, where);
        for (const pseudo of ['::before', '::after']) {
          const style = getComputedStyle(el, pseudo);
          if (style.content !== 'none' && style.content !== 'normal') note(style.fontFamily, where + pseudo);
        }
      }
      const pill = document.querySelector('#crumbs .cp-bc a.headerAuthLevelLink');
      return { families: Object.fromEntries(families), pill: getComputedStyle(pill).fontFamily,
        title: getComputedStyle(document.querySelector('td.screenName')).fontFamily,
        input: getComputedStyle(document.querySelector('input[name="firstName"]')).fontFamily,
        code: getComputedStyle(document.getElementById('sample-code')).fontFamily };
    });
    const inter = await fonts();
    assert.deepEqual(Object.keys(inter.families).length, 1, `one font on the page: ${JSON.stringify(inter.families)}`);
    assert.match(inter.pill, /^"?Inter"?,/);
    assert.equal(inter.title, inter.pill, 'the page title matches the breadcrumb');
    assert.equal(inter.input, inter.pill, 'CommPilot’s own form controls match the breadcrumb');
    assert.match(inter.code, /mono/i, 'code keeps its monospace');

    // The window: centred over a backdrop that covers the page, like the sign-out confirmation.
    const button = tab.getByRole('button', { name: 'Settings' });
    await button.click();
    const dialog = tab.getByRole('dialog', { name: 'Settings' });
    await dialog.waitFor();
    const layout = await tab.evaluate(async () => {
      // Font/style hydration can replace an animation, rejecting its finished
      // promise with AbortError. Wait for settling, then verify actual geometry.
      await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
      const overlay = document.querySelector('.cp-settings-overlay').getBoundingClientRect();
      const box = document.getElementById('cp-appearance-panel').getBoundingClientRect();
      return { overlay: [overlay.left, overlay.top, overlay.width, overlay.height], view: [innerWidth, innerHeight],
        centreX: box.left + box.width / 2 - innerWidth / 2, centreY: box.top + box.height / 2 - innerHeight / 2,
        width: box.width, fits: box.top >= 0 && box.bottom <= innerHeight,
        fonts: document.querySelectorAll('.cp-font-option').length };
    });
    assert.deepEqual(layout.overlay, [0, 0, ...layout.view], 'the backdrop covers the page');
    assert.ok(Math.abs(layout.centreX) <= 1 && Math.abs(layout.centreY) <= 1, `the window is centred: ${JSON.stringify(layout)}`);
    assert.ok(layout.width > 600 && layout.fits, JSON.stringify(layout));
    assert.equal(layout.fonts, 15);

    // Each choice previews in its own face.
    const previews = await tab.evaluate(() => [...document.querySelectorAll('.cp-font-option')].map(option =>
      [option.dataset.font, getComputedStyle(option.querySelector('.cp-font-name')).fontFamily.split(',')[0].replace(/"/g, '')]));
    assert.deepEqual(Object.fromEntries(previews.filter(([id]) => ['inter', 'roboto', 'atkinson', 'arial'].includes(id))),
      { inter: 'Inter', roboto: 'Roboto Variable', atkinson: 'Atkinson Hyperlegible Next Variable', arial: 'Arial' });

    // Choosing Roboto changes every part of the page at once, and the packaged face really loads.
    await dialog.getByText('Roboto', { exact: true }).click();
    await tab.waitForFunction(() => document.documentElement.getAttribute('data-cp-font') === 'roboto');
    await dialog.getByText('Roboto is now the font across CommPilot.').waitFor();
    const roboto = await fonts();
    assert.equal(Object.keys(roboto.families).length, 1, JSON.stringify(roboto.families));
    assert.match(roboto.pill, /^"Roboto Variable",/);
    assert.equal(roboto.title, roboto.pill);
    assert.match(await tab.evaluate(() => getComputedStyle(document.querySelector('.cp-brand-name')).fontFamily), /^"?Inter"?,/,
      'the CommPilot logo keeps its own lettering');
    const loaded = await tab.evaluate(async () => {
      await document.fonts.load('600 14px "Roboto Variable"');
      return [...document.fonts].filter(face => face.family.replace(/"/g, '') === 'Roboto Variable').map(face => face.status);
    });
    assert.deepEqual(loaded, ['loaded'], 'the Roboto file loads from the extension under CommPilot’s content policy');

    // Escape closes the window and returns to the Settings button; the backdrop and Done close it too.
    await tab.keyboard.press('Escape');
    assert.equal(await dialog.isHidden(), true);
    assert.equal(await tab.evaluate(() => document.activeElement.id), 'cp-appearance-toggle');
    await button.click();
    await dialog.waitFor();
    // Tab stays inside the window.
    for (let i = 0; i < 12; i++) await tab.keyboard.press('Tab');
    assert.equal(await tab.evaluate(() => !!document.activeElement.closest('#cp-appearance-panel')), true);
    await tab.mouse.click(10, 450);
    assert.equal(await dialog.isHidden(), true, 'a click on the backdrop closes the window');
    await button.click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    assert.equal(await dialog.isHidden(), true);

    // A new tab opens in the chosen font.
    const second = await context.newPage();
    await openApp(second);
    await second.waitForFunction(() => document.documentElement.getAttribute('data-cp-font') === 'roboto');
    assert.match(await second.evaluate(() => getComputedStyle(document.querySelector('td.screenName')).fontFamily), /^"Roboto Variable",/);

    // A system font works the same way; back to Inter.
    await button.click();
    await dialog.getByText('Arial', { exact: true }).click();
    await second.waitForFunction(() => document.documentElement.getAttribute('data-cp-font') === 'arial');
    assert.match((await fonts()).pill, /^Arial,/);
    await dialog.getByText('Inter', { exact: true }).click();
    await second.waitForFunction(() => document.documentElement.getAttribute('data-cp-font') === 'inter');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
