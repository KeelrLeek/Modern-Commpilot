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

// A confirmed sign-out forgets this tab's return page just before Login opens. A page request still settling, or
// one sent, while Login loads must not store it again: the next sign-in in this tab would reopen that page.
for (const late of ['fails', 'is sent']) {
  test(`a page request that ${late} after a confirmed sign-out stores no return page`, async () => {
    const browser = await chromium.launch({ headless: true, executablePath:
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let token = 0, releaseCli, cliHeld = new Promise(resolve => { releaseCli = resolve; });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://apps-sbx.avpaas.io') return route.abort();
        if (url.pathname === '/commpilot/Login/') {
          // Login is still loading while the old page's request fails.
          if (late === 'fails') releaseCli();
          await new Promise(resolve => setTimeout(resolve, 600));
          return route.fulfill({ contentType: 'text/html', body:
            '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' });
        }
        if (url.pathname === '/commpilot/User/CLI/') {
          await cliHeld;
          return route.fulfill({ status: 500, contentType: 'text/html', body: '<!doctype html><title>Error</title>' });
        }
        if (route.request().method() === 'POST') token++;
        return route.fulfill({ contentType: 'text/html', body:
          '<!doctype html><html><head><title>Fixture</title></head><body><form name="leftNavForm"></form>' +
          '<table><tr><td width="82%"><form name="mainForm"><input name="formtokenserial" value="token-' + token + '">' +
          '<p id="marker">' + url.pathname + '</p></form></td></tr></table>' +
          '<script>window.redirectPost=function(){};</script></body></html>' });
      });
      await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
      await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
      await page.evaluate(() => redirectPost('/commpilot/User/DND/', {}));
      await page.waitForFunction(() => document.querySelector('#marker')?.textContent === '/commpilot/User/DND/' &&
        !document.documentElement.hasAttribute('data-cp-nav'));
      const signedOut = page.waitForResponse(response => response.url().includes('/servlet/Logout'));
      await page.evaluate(late => {
        // 'is sent': once the sign-out has cleared the return page, as Login loads, the page sends a request.
        const poll = late === 'is sent' && setInterval(() => {
          if (sessionStorage.getItem('cp-last-nav')) return;
          clearInterval(poll);
          redirectPost('/commpilot/User/CLI/', {});
        }, 10);
        sessionStorage.setItem('cp-signing-out', String(Date.now()));
        redirectPost('/commpilot/servlet/Logout', {});
      }, late);
      await signedOut;
      // 'fails': CommPilot confirmed the sign-out; a page request starts during the hold before Login.
      if (late === 'fails') await page.evaluate(() => redirectPost('/commpilot/User/CLI/', {}));
      await page.waitForURL('**/commpilot/Login/');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-last-nav')), null);
      // pjax's Login hook would arm the return to a kept page for the next sign-in.
      await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
      assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-pending-return')), null);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
