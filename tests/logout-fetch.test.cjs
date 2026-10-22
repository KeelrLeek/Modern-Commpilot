const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(mode, check, logoutUrl) {
  const browser = await chromium.launch({ headless: true, executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<html><head><title>Fixture</title></head><body id="initBody.menuTemplate">' +
      '<table><tr><td class="headerBar"><span class="headerBarWelcome">Welcome Fixture</span>' +
      '<a class="headerLink" id="logout" onclick="redirectPost(\'/commpilot/servlet/Logout\', {}); return false">[Logout]</a>' +
      '</td></tr></table><form name="leftNavForm"></form><input name="formtokenserial" value="fixture-token">' +
      '<script>window.nativeLogoutCalls=0;window.redirectPost=function(){nativeLogoutCalls++};</script></body></html>' }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
    await page.evaluate(mode => {
      window.fixtureMode = mode;
      window.logoutRequests = [];
      window.logoutAborts = 0;
      const fetch = window.fetch, timeout = window.setTimeout;
      window.setTimeout = (fn, delay, ...args) => timeout(fn, delay === 30000 ? 100 : delay, ...args);
      window.fetch = (url, init) => {
        if (!String(url).includes('/servlet/Logout')) return fetch(url, init);
        window.logoutRequests.push({ url: String(url), body: init.body, redirect: init.redirect });
        if (window.fixtureMode === 'hold') return new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            window.logoutAborts++;
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
        if (window.fixtureMode === 'network') return Promise.reject(new TypeError('Synthetic network failure'));
        if (window.fixtureMode === 'redirect') return Promise.resolve({ type: 'opaqueredirect', status: 0, ok: false });
        return Promise.resolve(new Response('Fixture', { status: Number(window.fixtureMode) || 200 }));
      };
    }, mode);
    await page.addScriptTag({ path: path.join(root, 'src/content/logout-confirm.js') });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    if (logoutUrl) await page.locator('#logout').evaluate((el, url) => {
      el.setAttribute('onclick', 'redirectPost(' + JSON.stringify(url) + ', {}); return false');
    }, logoutUrl);
    await page.locator('#logout').click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await check(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

for (const mode of ['503', '403', 'network', 'hold']) {
  test(`intentional sign-out ${mode} failure stays recoverable without an automatic second POST`, () =>
    fixture(mode, async page => {
      await page.getByRole('button', { name: 'Retry sign out', exact: true }).waitFor({ timeout: 3000 });
      assert.equal(new URL(page.url()).pathname, '/commpilot/User/Profile/');
      const state = await page.evaluate(() => ({ requests: logoutRequests, native: nativeLogoutCalls,
        aborts: logoutAborts, busy: document.querySelector('[role=dialog]').getAttribute('aria-busy') }));
      assert.equal(state.requests.length, 1);
      assert.equal(state.native, 0);
      assert.equal(state.busy, null);
      assert.equal(state.requests[0].body, 'formtokenserial=fixture-token');
      if (mode === 'hold') assert.equal(state.aborts, 1);
      const message = await page.locator('.cp-native-logout-copy').innerText();
      assert.match(message, /not confirmed/i);
      if (/^\d+$/.test(mode)) assert.match(message, new RegExp(`HTTP ${mode}`));
      if (mode === 'hold') assert.match(message, /timed out/i);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'logout');
    }));
}

test('an explicit retry sends one new sign-out request after a failed attempt', () => fixture('503', async page => {
  await page.getByRole('button', { name: 'Retry sign out', exact: true }).waitFor({ timeout: 3000 });
  await page.evaluate(() => { window.fixtureMode = '200'; });
  await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
  assert.equal(await page.evaluate(() => logoutRequests.length), 2);
  await page.waitForURL('**/commpilot/Login/', { timeout: 5000 });
}));

for (const mode of ['200', '401', 'redirect']) {
  test(`successful or already-ended sign-out ${mode} opens Login`, () => fixture(mode, async page => {
    assert.equal(await page.evaluate(() => logoutRequests.length), 1);
    await page.waitForURL('**/commpilot/Login/', { timeout: 5000 });
  }));
}

for (const target of ['https://other.invalid/commpilot/servlet/Logout','//other.invalid/commpilot/servlet/Logout']) {
  test(`intentional sign-out rejects foreign target ${target} without sending its token`, () => fixture('200', async page => {
    await page.getByRole('button', {name:'Retry sign out',exact:true}).waitFor({timeout:3000});
    assert.equal(await page.evaluate(()=>logoutRequests.length),0);
    assert.equal(new URL(page.url()).pathname,'/commpilot/User/Profile/');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.getByRole('dialog').count(),0);
  },target));
}
