const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const home = '/commpilot/Common/folder_contents.jsp';
const entry = '/commpilot/Group/Members/Modify/index.jsp';
const destination = '/commpilot/User/Addresses/';

// How CommPilot answers a signed-out session: its hard-coded http:// Login redirect, a 401, a redirect stub to
// Login, or the sign-in form itself.
function signedOut(route, shape) {
  if (shape === 302) return route.fulfill({ status: 302, headers: { location: 'http://apps-sbx.avpaas.io/commpilot/Login/' }, body: '' });
  if (shape === 401) return route.fulfill({ status: 401, body: 'Not signed in' });
  if (shape === 'stub') return route.fulfill({ status: 200, contentType: 'text/html',
    body: `<input name="formtokenserial" value="login-context"><script>redirectPost('/commpilot/Login/', {});</script>` });
  return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head><title>Login</title></head><body>' +
    '<form name="loginForm"><input name="UserID"><input type="password" name="password"></form></body></html>' });
}

async function fixture(nav, options = {}) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  if (options.clock) await page.clock.install();
  const requests = [], errors = [];
  let release, began;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { began = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    requests.push({ url: req.url(), method: req.method() });
    if (options.slow === 'harvest' && url.pathname === '/commpilot/servlet/Login' || options.slow === 'entry' && url.pathname === entry) {
      began(); await held;
    }
    if (options.entryError && url.pathname === entry) return route.fulfill({ status: 500, body: 'Entity could not be loaded' });
    if (options.expired && (url.pathname === '/commpilot/servlet/Login' || url.pathname === entry)) return signedOut(route, options.expired);
    if (options.entrySignedOut && url.pathname === entry) return signedOut(route, options.entrySignedOut);
    if (url.pathname === '/commpilot/servlet/Login' && options.harvestError) {
      const attempts = requests.filter(r => r.url === origin + '/commpilot/servlet/Login').length;
      if (options.harvestError === 'network' || options.harvestError === 'transient' && attempts === 1) return route.abort('connectionreset');
      if (typeof options.harvestError === 'number') return route.fulfill({status:options.harvestError,body:'Refresh failed'});
    }
    const body = url.pathname === '/commpilot/servlet/Login'
      ? `<input name="formtokenserial" value="harvested"><script>redirectPost('${home}', {folder:'${options.homeFolder || 'R0'}',menuId:'${options.homeMenu || '8'}'});</script>`
      : '<html><body><table><tr><td width="82%"><input name="formtokenserial" value="entered"></td></tr></table></body></html>';
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto(origin + '/commpilot/Common/styles.css');
  await page.evaluate(({nav, bridgeNav}) => {
    sessionStorage.setItem('cp-last-nav', JSON.stringify(nav));
    window.submissions = [];
    HTMLFormElement.prototype.submit = function () {
      submissions.push({ url: this.action, data: Object.fromEntries(new FormData(this)) });
    };
    addEventListener('message', event => {
      if (event.data?.__cpStubNavQuery) postMessage({ __cpStubNavReply: { token: 'stored', nav: bridgeNav || null } }, location.origin);
    });
  }, {nav, bridgeNav:options.bridgeNav});
  await page.addScriptTag({ path: path.join(runtime, 'src/content/stubguard.js') });
  return { page, requests, errors, started, release, close: async () => { release(); await browser.close(); } };
}

test('reload recovery enters the user first, threads its token, and preserves read-only query tabs', async () => {
  const f = await fixture({ url: destination + '?tab=details', params: { menuId: '2' },
    entry: { url: entry, params: { key: 'SP>%Group>%User' } } });
  try {
    await f.page.waitForFunction(() => submissions.length === 1);
    const sent = await f.page.evaluate(() => submissions[0]);
    assert.equal(sent.url, origin + destination + '?tab=details');
    assert.equal(sent.data.formtokenserial, 'entered');
    assert.ok(f.requests.some(r => r.url === origin + entry && r.method === 'POST'));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const [folder, menu] of [['G0', '2'], ['U0', '1']]) test(`empty recovery uses the authenticated ${folder} home rather than reseller R0`, async () => {
  const f = await fixture(null, { homeFolder: folder, homeMenu: menu });
  try {
    await f.page.waitForFunction(() => submissions.length === 1);
    const sent = await f.page.evaluate(() => submissions[0]);
    assert.equal(sent.url, origin + home);
    assert.equal(sent.data.folder, folder);
    assert.equal(sent.data.menuId, menu);
    assert.equal(sent.data.formtokenserial, 'harvested');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a tab without its own location never reopens another tab’s saved user', async () => {
  const f = await fixture(null, { homeFolder:'G0',homeMenu:'2',bridgeNav:{url:destination,entry:{url:entry,params:{key:'OtherUser'}}} });
  try {
    await f.page.waitForFunction(() => submissions.length === 1);
    const sent = await f.page.evaluate(() => submissions[0]);
    assert.equal(sent.url, origin + home);
    assert.equal(sent.data.folder, 'G0');
    assert.equal(f.requests.some(r => r.url === origin + entry && r.method === 'POST'), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

const invalid = [
  ['saved PIN payload', {url:destination,params:{pin:'fixture-private'}}],
  ['saved passcode payload', {url:destination,params:{newPasscode:'fixture-private'}}],
  ['query passcode payload', {url:destination+'?voicePortalPasscode=fixture-private'}],
  ['passcode in required ancestry', {url:destination,entry:{url:entry,params:{passcode:'fixture-private'}}}],
  ['protocol-relative foreign target', { url: '//other.invalid/commpilot/User/Profile/' }],
  ['backslash foreign target', { url: '\\\\other.invalid\\commpilot\\User\\Profile\\' }],
  ['script target', { url: 'javascript:alert(1)' }],
  ['logout target', { url: '/commpilot/Logout/' }],
  ['encoded logout target', { url: '/commpilot/%4cogout/' }],
  ['saved Apply payload', { url: destination, params: { apply: 'Apply', extension: '1234' } }],
  ['query Delete payload', { url: destination + '?delete=Delete' }],
  ['foreign entity entry', { url: destination, entry: { url: '//other.invalid/commpilot/Group/Members/Modify/' } }]
];
for (const [name, nav] of invalid) test(`reload recovery rejects ${name} and uses the home fallback`, async () => {
  const f = await fixture(nav);
  try {
    await f.page.waitForFunction(() => submissions.length > 0);
    const sent = await f.page.evaluate(() => submissions);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, origin + home);
    assert.equal(sent[0].data.folder, 'R0');
    assert.equal(f.requests.some(r => new URL(r.url).origin !== origin), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const failure of ['network', 403, 503]) test(`reload recovery pauses after a ${failure} session check instead of using a possibly stale token`, async () => {
  const f = await fixture({url:destination}, {harvestError:failure});
  try {
    await f.page.waitForFunction(() => submissions.length || document.querySelector('#cp-recovery-error'));
    assert.equal(await f.page.evaluate(() => submissions.length), 0);
    assert.match(await f.page.locator('#cp-recovery-error').textContent(), /session|refresh/i);
    assert.equal(f.requests.filter(r=>r.url===origin+'/commpilot/servlet/Login').length, failure==='network'?2:1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('an explicit unauthenticated recovery response keeps the one native expiry fallback', async () => {
  const f = await fixture({url:destination}, {harvestError:401});
  try {
    await f.page.waitForFunction(() => submissions.length === 1);
    assert.equal(await f.page.evaluate(() => submissions[0].url), origin + destination);
    assert.equal(f.requests.filter(r=>r.url===origin+'/commpilot/servlet/Login').length,1);
    assert.equal(await f.page.locator('#cp-recovery-error').count(),0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('reload recovery retries a dropped first connection once and uses the successful fresh token', async () => {
  const f = await fixture({url:destination}, {harvestError:'transient'});
  try {
    await f.page.waitForFunction(() => submissions.length === 1);
    assert.equal(await f.page.evaluate(() => submissions[0].data.formtokenserial),'harvested');
    assert.equal(f.requests.filter(r=>r.url===origin+'/commpilot/servlet/Login').length,2);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a failed entity restore pauses recovery instead of posting the final page in an unknown context', async () => {
  const f = await fixture({ url: destination, entry: { url: entry, params: { key: 'SP>%Group>%User' } } }, { entryError: true });
  try {
    await f.page.waitForFunction(() => submissions.length || document.querySelector('#cp-recovery-error'));
    assert.equal(await f.page.evaluate(() => submissions.length), 0);
    assert.match(await f.page.locator('#cp-recovery-error').textContent(), /could not restore/i);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

// Recovery either reaches sign-in, pauses, or posts the page (the fixture records native submissions).
const recoveryOutcome = page => Promise.race([
  page.waitForURL('**/commpilot/Login/').then(() => 'login'),
  page.locator('#cp-recovery-error').waitFor().then(() => 'paused'),
  page.waitForFunction(() => window.submissions?.length).then(() => 'posted')]);
const requested = f => f.requests.map(r => r.method + ' ' + new URL(r.url).pathname);
const savedReturn = page => page.evaluate(() => ({ nav: JSON.parse(sessionStorage.getItem('cp-last-nav') || 'null'),
  replayAt: sessionStorage.getItem('cp-replay-at'), reloadNav: sessionStorage.getItem('cp-reload-nav'),
  manualLogoutAt: sessionStorage.getItem('bwManualLogoutAt') }));

for (const shape of [302, 401, 'form'])
test(`an expired session on a saved user’s page goes to sign-in without posting and keeps its return: ${shape}`, async () => {
  const f = await fixture({ url: destination, entry: { url: entry, params: { key: 'SP>%Group>%User' } } }, { expired: shape });
  try {
    assert.equal(await recoveryOutcome(f.page), 'login');
    assert.deepEqual(requested(f), ['GET /commpilot/Common/styles.css', 'GET /commpilot/servlet/Login', 'GET /commpilot/Login/'],
      'no user/group POST is sent with a token the server already rejected');
    const saved = await savedReturn(f.page);
    assert.equal(saved.nav?.url, destination, 'the sign-in can still reopen the page');
    assert.equal(saved.nav?.entry?.url, entry);
    assert.equal(saved.replayAt, null);
    assert.equal(saved.manualLogoutAt, null, 'an expired session does not hold the automatic saved sign-in');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const shape of [302, 'stub', 'form'])
test(`a user restore that CommPilot answers with sign-in goes to Login instead of pausing: ${shape}`, async () => {
  const f = await fixture({ url: destination, entry: { url: entry, params: { key: 'SP>%Group>%User' } } }, { entrySignedOut: shape });
  try {
    assert.equal(await recoveryOutcome(f.page), 'login');
    assert.deepEqual(requested(f), ['GET /commpilot/Common/styles.css', 'GET /commpilot/servlet/Login',
      'POST ' + entry, 'GET /commpilot/Login/'], 'the destination is never posted in an unknown context');
    const saved = await savedReturn(f.page);
    assert.equal(saved.nav?.entry?.url, entry);
    assert.equal(saved.replayAt, null);
    assert.equal(saved.reloadNav, null);
    assert.equal(saved.manualLogoutAt, null);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const mode of ['entity', 'server', 'storage-unavailable'])
test(`paused recovery offers a direct login escape without replaying the failed page: ${mode}`, async () => {
  const f = await fixture({ url: destination, entry: { url: entry, params: { key: 'fixture-user' } } },
    mode === 'server' ? { harvestError: 503 } : { entryError: true });
  try {
    await f.page.locator('#cp-recovery-error').waitFor();
    const keys = ['cp-last-nav', 'cp-pending-return', 'cp-return-at', 'cp-replay-at',
      'cp-reload-nav', 'cp-stub-tries', 'cp-stub-tries-at'];
    await f.page.evaluate(({ keys, blocked }) => {
      for (const key of keys) sessionStorage.setItem(key, 'stale-recovery');
      sessionStorage.setItem('unrelated-preference', 'keep');
      if (blocked) {
        Storage.prototype.removeItem = function () { throw new DOMException('Storage blocked', 'SecurityError'); };
        Storage.prototype.setItem = function () { throw new DOMException('Storage blocked', 'SecurityError'); };
      }
    }, { keys, blocked: mode === 'storage-unavailable' });
    const before = f.requests.length;
    const login = f.page.getByRole('button', { name: 'Go to login', exact: true });
    await login.waitFor({ timeout: 2000 });
    await Promise.all([f.page.waitForURL('**/commpilot/Login/'), login.click()]);
    assert.deepEqual(f.requests.slice(before), [{ url: origin + '/commpilot/Login/', method: 'GET' }]);
    if (mode !== 'storage-unavailable') {
      const state = await f.page.evaluate(keys => ({ remaining: keys.filter(key => sessionStorage.getItem(key)),
        unrelated: sessionStorage.getItem('unrelated-preference'), manualAt: Number(sessionStorage.getItem('bwManualLogoutAt')) }), keys);
      assert.deepEqual(state.remaining, []);
      assert.equal(state.unrelated, 'keep');
      assert.ok(Math.abs(Date.now() - state.manualAt) < 10000, 'saved sign-in does not immediately undo the explicit login choice');
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const slow of ['harvest', 'entry']) test(`a hung ${slow} pauses recovery without a stale fallback POST or late replay`, async () => {
  const f = await fixture({ url: destination, entry: { url: entry, params: { key: 'SP>%Group>%User' } } }, { slow, clock: true });
  try {
    await f.started;
    await f.page.clock.fastForward(13000);
    await f.page.waitForFunction(() => submissions.length || document.querySelector('#cp-recovery-error'), null, { timeout: 2000 });
    assert.equal(await f.page.evaluate(() => submissions.length), 0);
    assert.match(await f.page.locator('#cp-recovery-error').textContent(), /recovery|restore/i);
    f.release();
    await f.page.clock.runFor(500);
    assert.equal(await f.page.evaluate(() => submissions.length), 0, 'late completion cannot replay after the failure state');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

// The stylesheets the extension injects into the recovery interstitial, read from manifest.json so the style
// checks see what users see (skin.css, for one, is no longer loaded).
function interstitialCss() {
  const page = origin + '/commpilot/Common/styles.css';
  const covers = glob => new RegExp('^' + glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(page);
  return JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8')).content_scripts
    .filter(script => script.matches.some(covers) && !(script.exclude_matches || []).some(covers))
    .flatMap(script => script.css || []);
}

test('recovery pause uses the shared font and palette and Retry reloads without resending a form', async () => {
  const f = await fixture({ url: destination, entry: { url: entry } }, { entryError: true });
  try {
    await f.page.locator('#cp-recovery-error').waitFor();
    const css = interstitialCss();
    assert.ok(css.includes('src/content/theme-palettes.css') && css.includes('src/content/page-baseline.css'));
    for (const file of css) await f.page.addStyleTag({ path: path.join(runtime, file) });
    await f.page.evaluate(() => {
      window.chrome = { runtime: { getURL: file => location.origin + '/' + file } };
      document.documentElement.dataset.cpFont = 'arial';
    });
    await f.page.addScriptTag({ path: path.join(runtime, 'src/content/fonts.js') });
    const retry = f.page.getByRole('button', { name: 'Retry recovery', exact: true });
    const login = f.page.getByRole('button', { name: 'Go to login', exact: true });
    assert.equal(await f.page.locator('#cp-recovery-error button').count(), 2);
    const look = button => button.evaluate(element => {
      const s = getComputedStyle(element);
      return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, fontStyle: s.fontStyle, lineHeight: s.lineHeight,
        padding: s.padding, radius: s.borderRadius, border: [s.borderStyle, s.borderWidth, s.borderColor].join(' '),
        color: s.color, background: s.backgroundColor };
    });
    for (const palette of ['atlas', 'graphite']) {
      await f.page.evaluate(palette => {
        document.documentElement.dataset.cpDirection = palette;
        document.dispatchEvent(new Event('cp:theme-change'));
      }, palette);
      await f.page.waitForFunction(() => document.querySelector('#cp-recovery-error')
        .getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
      const style = await f.page.evaluate(() => {
        const panel = document.querySelector('#cp-recovery-error');
        const body = getComputedStyle(document.body), text = getComputedStyle(panel.querySelector('.cp-alert-body'));
        return { bodyFont: body.fontFamily, textFont: text.fontFamily,
          titleFont: getComputedStyle(panel.querySelector('.cp-alert-title')).fontFamily,
          canvas: getComputedStyle(document.documentElement).backgroundColor, bodyBackground: body.backgroundColor,
          background: getComputedStyle(panel).backgroundColor, color: text.color,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      const button = await look(retry);
      assert.match(style.bodyFont, /Arial/);
      assert.equal(style.textFont, style.bodyFont);
      assert.equal(style.titleFont, style.bodyFont);
      assert.equal(button.font, style.bodyFont);
      assert.deepEqual(await look(login), button, 'Go to login is the same control as Retry');
      assert.equal(style.canvas, style.bodyBackground, 'scrollbar gutters match the recovery page palette');
      assert.notEqual(style.background, style.color);
      const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255)
        .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
        .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const ink = luminance(button.color), paper = luminance(button.background);
      assert.ok((Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05) >= 4.5,
        `Retry text stays readable: ${palette}, ${button.color} on ${button.background}`);
      assert.equal(style.overflow, false);
      await f.page.screenshot({ path: path.resolve(__dirname, '../dev-preview/overnight-hardening-2026-10-21/recovery-pause-' + palette + '.png') });
    }
    const posts = f.requests.filter(r => r.method === 'POST').length;
    await Promise.all([f.page.waitForNavigation(), f.page.getByRole('button', { name: 'Retry recovery' }).click()]);
    assert.equal(f.requests.filter(r => r.method === 'POST').length, posts);
    assert.equal(new URL(f.page.url()).pathname, '/commpilot/Common/styles.css');
    assert.equal(await f.page.evaluate(() => sessionStorage.getItem('cp-stub-tries')), '0');
  } finally { await f.close(); }
});
