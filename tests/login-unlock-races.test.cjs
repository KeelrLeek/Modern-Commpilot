const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(automatic, check, pinMode = false) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<body id="loginBody"><form name="loginForm"><table>' +
      '<tr><td><input name="EnteredUserID"><input name="Password" type="password"></td></tr>' +
      '<tr><td class="logintext3"><a id="native-login">Login</a></td></tr></table></form></body>' }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.evaluate(({automatic, pinMode}) => {
      window.pendingUnlocks = [];
      window.sent = [];
      window.notices = [];
      window.cpToasts = { show: message => { notices.push(message); }, dismiss() {} };
      const profiles = (automatic ? ['alpha'] : ['alpha', 'beta']).map(id =>
        ({ id, user: id, mode: pinMode ? 'pin' : 'auto', hasPin: pinMode }));
      window.chrome = { runtime: { getManifest: () => ({ version: '0.3.82' }),
        sendMessage: (message, done) => {
          if (message.op === 'list') done({ ok: true, profiles });
          else if (message.op === 'unlock') pendingUnlocks.push({ id: message.id, done });
        } } };
      window.finishUnlock = (index, success = true) => {
        const { id, done } = pendingUnlocks[index];
        done(success ? { ok: true, user: id, password: 'fixture-secret-' + id } :
          { ok: false, error: 'Fixture unlock failed' });
      };
      document.querySelector('#native-login').addEventListener('click', () => {
        sent.push({ user: document.forms.loginForm.elements.EnteredUserID.value,
          password: document.forms.loginForm.elements.Password.value });
      });
    }, {automatic, pinMode});
    await page.addScriptTag({ path: path.join(runtime, 'src/content/login.js') });
    await page.locator('.cp-login').waitFor();
    await check(page);
  } finally { await browser.close(); }
}

test('typing a manual sign-in cancels a pending automatic unlock', () => fixture(true, async page => {
  assert.equal(await page.evaluate(() => pendingUnlocks.length), 1);
  await page.locator('#cp-login-user').fill('manual-user');
  await page.locator('#cp-login-password').fill('manual-fixture-secret');
  await page.evaluate(() => finishUnlock(0));
  assert.deepEqual(await page.evaluate(() => sent), []);
  assert.equal(await page.locator('#cp-login-user').inputValue(), 'manual-user');
  assert.equal(await page.locator('#cp-login-password').inputValue(), 'manual-fixture-secret');
  assert.equal(await page.locator('.cp-login-acct.is-busy').count(), 0);
}));

test('choosing another saved account makes an older unlock response obsolete', () => fixture(false, async page => {
  await page.getByRole('button', { name: 'Continue as alpha' }).click();
  await page.getByRole('button', { name: 'Continue as beta' }).click();
  await page.evaluate(() => finishUnlock(0));
  assert.deepEqual(await page.evaluate(() => sent), []);
  await page.evaluate(() => finishUnlock(1));
  assert.deepEqual(await page.evaluate(() => sent), [{ user: 'beta', password: 'fixture-secret-beta' }]);
}));

test('leaving the account picker prevents a pending unlock from signing in', () => fixture(false, async page => {
  await page.getByRole('button', { name: 'Continue as alpha' }).click();
  await page.getByRole('button', { name: 'Manage saved sign-ins' }).click();
  await page.evaluate(() => finishUnlock(0));
  assert.deepEqual(await page.evaluate(() => sent), []);
  assert.equal(await page.locator('#cp-login-password').inputValue(), '');
}));

test('an active failed unlock can be retried and submits the chosen account once', () => fixture(false, async page => {
  await page.getByRole('button', { name: 'Continue as alpha' }).click();
  await page.evaluate(() => finishUnlock(0, false));
  await page.getByRole('button', { name: 'Continue as alpha' }).click();
  await page.evaluate(() => finishUnlock(1));
  assert.deepEqual(await page.evaluate(() => sent), [{ user: 'alpha', password: 'fixture-secret-alpha' }]);
}));

test('editing the PIN supersedes its pending unlock without clearing the new PIN', () => fixture(false, async page => {
  await page.getByRole('button', { name: 'Continue as alpha' }).click();
  const pin = page.getByLabel('PIN for alpha');
  await pin.fill('1111');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await pin.fill('2222');
  await page.evaluate(() => finishUnlock(0, false));
  assert.equal(await pin.inputValue(), '2222');
  assert.deepEqual(await page.evaluate(() => notices), []);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.evaluate(() => finishUnlock(1));
  assert.deepEqual(await page.evaluate(() => sent), [{ user: 'alpha', password: 'fixture-secret-alpha' }]);
}, true));

test('restoring the login page from browser history cancels its pending unlock', () => fixture(true, async page => {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    finishUnlock(0);
  });
  assert.deepEqual(await page.evaluate(() => sent), []);
  assert.equal(await page.locator('.cp-login-acct.is-busy').count(), 0);
}));
