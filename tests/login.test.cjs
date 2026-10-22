const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright-core');

const root = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..'));
const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);

// CommPilot's Login page as it comes (the table, the message cell, the legal notice), with its own handlers: Enter
// anywhere on the page and the Login link submit the form. Here "submitting" keeps what was sent, and with `posts` sends the
// form for real as CommPilot does. Served without a charset, its © reads as Â©, as on the live site.
const loginPage = (message, posts) => `<html><head><title>Login</title></head><body id="loginBody" bgcolor="#FFFFFF"><br />
  <form name="loginForm" method="post" action="/commpilot/servlet/Login">
    <input type="hidden" name="formtokenserial" value="1:2"><input type="hidden" name="domain" value=""><input type="hidden" name="UserID" value="">
    <table width="800" height="460" cellspacing="0" cellpadding="0" background="/commpilot/Graphics/login.gif">
      <tr><td width="20" height="60">&nbsp;</td><td colspan="2"><img src="/commpilot/conf/clientLogo.gif"></td></tr>
      <tr><td width="20" height="40">&nbsp;</td><td colspan="2" class="loginerror" align="left">${message || '&nbsp;'}</td></tr>
      <tr><td valign="top" colspan="3" height="180"><table cellspacing="0" cellpadding="0"><tr><td width="250"><table>
        <tr><td class="logintext">User&#x20;ID</td><td><input type="text" name="EnteredUserID" size="16" maxlength="161" autocomplete="off"></td></tr>
        <tr><td class="logintext">Password</td><td><input type="password" name="Password" size="16" autocomplete="new-password"></td></tr>
        <tr><td>&nbsp;</td><td class=logintext2><input type="checkbox" name="rememberPass">Remember&#x20;Password</td></tr>
      </table></td><td valign="top" width="120"><table width="100%"><tr><td height=40 align=center class="logintext3"><a id="link_1">Login</a></td></tr></table></td></tr></table></td></tr>
      <tr><td width="20">&nbsp;</td><td class="copyright" colspan="2" height="60">Copyright&#x20;©&#x20;2020&#x20;Cisco&#x20;and&#x2F;or&#x20;its&#x20;affiliates.<br/>
        <span class="copyrighttext">PROPRIETARY&#x20;AND&#x20;CONFIDENTIAL.</span><br /><span class="copyrighttext">All&#x20;rights&#x20;reserved.</span></td></tr>
    </table>
  </form>
  <script>
    window.sent = [];
    function submitForm() { window.sent.push({ user: document.loginForm.EnteredUserID.value, password: document.loginForm.Password.value });${posts ? ' document.loginForm.submit();' : ''} }
    document.addEventListener('DOMContentLoaded', function () {
      document.getElementById('loginBody').addEventListener('keypress', function (e) { if (e.keyCode == 13) submitForm(); });
      document.getElementById('link_1').addEventListener('click', function () { submitForm(); });
    });
  </script></body></html>`;

test('the Login page: CommPilot’s form in the Focus design, its message as a toast, and the extras', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-login-test-'));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
  let context, message = '';
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      viewport: { width: 1200, height: 900 },
      reducedMotion: 'no-preference',
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    await context.route('https://apps-sbx.avpaas.io/commpilot/Login/', route => route.fulfill({ contentType: 'text/html', body: loginPage(message) }));
    await context.route(/\/commpilot\/(Graphics|conf)\//, route => route.fulfill({ status: 404, body: '' }));
    const page = await context.newPage();
    // Observe the animation lifecycle in the document. A delayed assertion
    // must not require a 600ms transient class to still be present.
    await page.addInitScript(() => {
      window.loginShake = { started: false, ended: false };
      new MutationObserver(records => {
        for (const record of records) {
          if (!record.target.classList?.contains('cp-login')) continue;
          const shaking = record.target.classList.contains('is-shaking');
          if (shaking) window.loginShake.started = true;
          if (/(?:^|\s)is-shaking(?:\s|$)/.test(record.oldValue || '') && !shaking)
            window.loginShake.ended = true;
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.locator('.cp-login').waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection);

    // The page: the tile on its line, the title, the site and version; CommPilot's own fields and link, still in its form.
    const look = await page.evaluate(() => {
      const form = document.forms.loginForm, box = document.querySelector('.cp-login').getBoundingClientRect();
      return {
        title: document.querySelector('.cp-login-title').textContent, meta: document.querySelector('.cp-login-meta').textContent,
        tile: !!document.querySelector('.cp-login-tile svg'), line: !!document.querySelector('.cp-login-horizon .cp-login-load'),
        inForm: form.contains(form.elements.EnteredUserID) && form.elements.EnteredUserID.closest('.cp-login') !== null &&
          form.elements.Password.closest('.cp-login') !== null && form.querySelector('#link_1').closest('.cp-login') !== null,
        tableShown: getComputedStyle(form.querySelector('table[background]')).display !== 'none',
        remember: !!form.querySelector('input[name="rememberPass"]'),
        centre: Math.round(box.left + box.width / 2), scroll: document.documentElement.scrollWidth > innerWidth,
        canvas: getComputedStyle(document.body).backgroundColor, focus: document.activeElement?.name,
        save: document.querySelector('.cp-login-save')?.hidden === false,
        legal: document.querySelector('.cp-login-legal summary').textContent, legalOpen: document.querySelector('.cp-login-legal details').open,
      };
    });
    assert.equal(look.title, 'Sign in to CommPilot');
    assert.equal(look.meta, `apps-sbx.avpaas · v${version}`);
    assert.deepEqual([look.tile, look.line, look.inForm, look.tableShown, look.remember], [true, true, true, false, false]);
    assert.equal(look.centre, 600, 'one column in the middle');
    assert.equal(look.scroll, false);
    assert.equal(look.canvas, 'rgb(237, 242, 247)', 'the palette’s canvas (Atlas)');
    assert.equal(look.focus, 'EnteredUserID');
    assert.equal(look.save, true, 'no saved sign-ins yet: an offer to save one');
    assert.match(look.legal, /^Copyright © 2020 Cisco and\/or its affiliates\.\s*Legal notice$/, 'the notice’s first line, © mended');
    assert.equal(look.legalOpen, false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.cp-toast').length), 0, 'no message, no toast');

    // Show password, and Caps Lock.
    await page.locator('#cp-login-password').fill('secret-pw');
    await page.getByRole('button', { name: 'Show password' }).click();
    assert.equal(await page.locator('#cp-login-password').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    assert.equal(await page.locator('#cp-login-password').getAttribute('type'), 'password');
    const caps = on => page.evaluate(on => document.querySelector('#cp-login-password')
      .dispatchEvent(new KeyboardEvent('keyup', { key: 'a', modifierCapsLock: on, bubbles: true })), on);
    await caps(true);
    assert.equal(await page.locator('.cp-login-fields .cp-login-caps').isVisible(), true);
    await caps(false);
    assert.equal(await page.locator('.cp-login-fields .cp-login-caps').isVisible(), false);

    // Enter on the legal notice opens it and sends nothing; Sign in from the keyboard sends the form once and waits.
    await page.locator('.cp-login-legal summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('.cp-login-legal details').open), true);
    assert.deepEqual(await page.evaluate(() => window.sent), []);
    await page.locator('#cp-login-user').fill('admin.one');
    await page.locator('#cp-login-password').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'link_1', 'Sign in takes the keyboard');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.sent), [{ user: 'admin.one', password: 'secret-pw' }]);
    const busy = await page.evaluate(() => ({ progress: document.documentElement.dataset.cpProgress,
      text: document.querySelector('.cp-login-submit').textContent.trim(), busy: document.querySelector('.cp-login').classList.contains('is-busy') }));
    assert.deepEqual(busy, { progress: 'on', text: 'Signing in…', busy: true });

    // A slow response must not let repeated keyboard activation submit credentials twice.
    await page.keyboard.press('Enter');
    await page.locator('#cp-login-password').press('Enter');
    await page.locator('#link_1').evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.sent.length), 1, 'one native submit while sign-in is pending');
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.locator('#cp-login-password').press('Enter');
    assert.equal(await page.evaluate(() => window.sent.length), 2, 'returning from browser history permits a new sign-in');

    // CommPilot says no: the page again, its message a toast, the form shakes, the User ID is back, and typing clears it.
    message = 'Invalid user ID or password.';
    await page.reload();
    await page.locator('#cp-toasts .cp-toast').waitFor();
    await page.waitForFunction(() => window.loginShake.ended);
    const failed = await page.evaluate(() => ({
      kind: document.querySelector('#cp-toasts .cp-toast').className.match(/cp-toast-(error|warning|info)/)[1],
      title: document.querySelector('#cp-toasts .cp-toast-title').textContent, body: document.querySelector('#cp-toasts .cp-toast-body').textContent,
      user: document.querySelector('#cp-login-user').value, focus: document.activeElement.id,
      shook: window.loginShake.started, progress: document.documentElement.dataset.cpProgress || null,
      messageShown: !!document.querySelector('td.loginerror').offsetParent }));
    assert.deepEqual(failed, { kind: 'error', title: 'Couldn’t sign in', body: 'Invalid user ID or password.', user: 'admin.one',
      focus: 'cp-login-password', shook: true, progress: null, messageShown: false });
    assert.equal(await page.locator('.cp-login.is-shaking').count(), 0, 'the animation also finishes');
    await page.keyboard.type('x');
    await page.waitForFunction(() => !document.querySelector('#cp-toasts .cp-toast:not(.cp-toast-leaving)'), null, { timeout: 3000 });

    // A session that ended is a warning, and nothing shakes.
    message = 'Your session has expired. Please login again.';
    await page.reload();
    await page.locator('#cp-toasts .cp-toast').waitFor();
    assert.deepEqual(await page.evaluate(() => ({ kind: document.querySelector('#cp-toasts .cp-toast').className.match(/cp-toast-(error|warning|info)/)[1],
      title: document.querySelector('#cp-toasts .cp-toast-title').textContent, shook: document.querySelector('.cp-login').classList.contains('is-shaking') })),
    { kind: 'warning', title: 'You were signed out', shook: false });
    assert.equal(await page.evaluate(() => loginShake.started), false, 'session expiry never triggers the error shake');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

// A slow CommPilot: the sign-in is never answered, so the page stays until the browser's Stop (or Esc) cancels it.
test('Enter outside the form signs in once, and a stopped sign-in can be sent again', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-login-test-'));
  const posts = [], held = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    await context.route('https://apps-sbx.avpaas.io/commpilot/Login/', route => route.fulfill({ contentType: 'text/html',
      body: loginPage('Invalid user ID or password.', true) }));
    await context.route(/\/commpilot\/(Graphics|conf)\//, route => route.fulfill({ status: 404, body: '' }));
    await context.route('https://apps-sbx.avpaas.io/commpilot/servlet/Login', route => {
      posts.push(new URLSearchParams(route.request().postData()).get('EnteredUserID'));
      held.push(route);
    });
    // A sign-in that failed: the User ID typed last time is back and nothing has been typed yet.
    await context.addInitScript(() => { try { localStorage.setItem('cpLoginUser', 'admin.one'); } catch (_) {} });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const state = () => page.evaluate(() => ({ busy: document.querySelector('.cp-login').classList.contains('is-busy'),
      text: document.querySelector('.cp-login-submit').textContent.trim(), progress: document.documentElement.dataset.cpProgress || null }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.locator('#cp-toasts .cp-toast-close').waitFor();

    // Enter on the message's Dismiss, reached with Tab from the Password field, only closes the message.
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cp-login-password');
    for (let i = 0; i < 8 && await page.evaluate(() => document.activeElement.getAttribute('aria-label')) !== 'Dismiss'; i++)
      await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Dismiss');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert.deepEqual(posts, [], 'Dismiss sends no sign-in');
    assert.equal(await page.locator('#cp-toasts .cp-toast:not(.cp-toast-leaving)').count(), 0, 'the message goes');

    // Enter with the page itself focused is CommPilot's sign-in: sent once however often it is pressed, and it waits.
    await page.locator('#cp-login-password').fill('fixture-pw');
    await page.mouse.click(30, 870);   // the empty canvas
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert.deepEqual(posts, ['admin.one'], 'one sign-in for two presses');
    await cdp.send('Page.stopLoading');   // the browser's Stop: the sign-in is cancelled and this page stays
    assert.deepEqual(await state(), { busy: true, text: 'Signing in…', progress: 'on' });

    // Stopped, a press soon after still waits for the first; Esc (the browser's Stop key) gives Sign in back at once.
    await page.locator('#link_1').click({ noWaitAfter: true });
    await page.waitForTimeout(300);
    assert.equal(posts.length, 1, 'a second press soon after the first sends nothing');
    await page.keyboard.press('Escape');
    assert.deepEqual(await state(), { busy: false, text: 'Sign in', progress: null });
    await page.locator('#link_1').click({ noWaitAfter: true });
    await page.waitForTimeout(500);
    assert.equal(posts.length, 2, 'signing in again after Esc');
    await cdp.send('Page.stopLoading');

    // The Stop button tells the page nothing: it still says Signing in…, and after a few seconds a press signs in again.
    await page.waitForTimeout(8500);
    assert.equal((await state()).busy, true);
    await page.locator('#link_1').click({ noWaitAfter: true });
    await page.waitForTimeout(500);
    assert.equal(posts.length, 3, 'a deliberate retry after a stopped sign-in is sent');
    await cdp.send('Page.stopLoading');
  } finally {
    for (const route of held) await route.abort().catch(() => {});
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('encrypted vault accepts requests only from the known HTTPS login page', () => {
  const code = fs.readFileSync(path.join(root, 'src/bg/credential-bridge.js'), 'utf8');
  let handler;
  const sandbox = {
    URL, Set, TextEncoder, TextDecoder,
    chrome: { runtime: {
      onMessage: { addListener: callback => { handler = callback; } }
    } }
  };
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof handler, 'function');
  const reply = [];
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://evil.example/commpilot/Login/' }, result => reply.push(result));
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/User/Profile/' }, result => reply.push(result));
  handler({ kind: 'bwCredential', op: 'unrecognized' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/Login/' }, result => reply.push(result));
  assert.equal(reply.length, 3);
  assert.ok(reply.every(result => result.ok === false));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.permissions.includes('nativeMessaging'), false);
});
