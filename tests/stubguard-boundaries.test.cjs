const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';
const home = '/commpilot/Common/folder_contents.jsp';
const entry = '/commpilot/Group/Members/Modify/index.jsp';
const destination = '/commpilot/User/Addresses/';

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
  await page.addScriptTag({ path: path.join(process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..'),'src/content/stubguard.js') });
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

test('recovery pause uses the shared font and palette and Retry reloads without resending a form', async () => {
  const f = await fixture({ url: destination, entry: { url: entry } }, { entryError: true });
  try {
    await f.page.locator('#cp-recovery-error').waitFor();
    for (const file of ['skin.css', 'theme-palettes.css', 'page-baseline.css'])
      await f.page.addStyleTag({ path: path.resolve(__dirname, '../src/content', file) });
    await f.page.evaluate(() => {
      window.chrome = { runtime: { getURL: file => location.origin + '/' + file } };
      document.documentElement.dataset.cpFont = 'arial';
    });
    await f.page.addScriptTag({ path: path.resolve(__dirname, '../src/content/fonts.js') });
    for (const palette of ['atlas', 'graphite']) {
      await f.page.evaluate(palette => {
        document.documentElement.dataset.cpDirection = palette;
        document.dispatchEvent(new Event('cp:theme-change'));
      }, palette);
      await f.page.waitForFunction(() => document.querySelector('#cp-recovery-error')
        .getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
      const style = await f.page.evaluate(() => {
        const panel = document.querySelector('#cp-recovery-error'), button = panel.querySelector('button');
        const body = getComputedStyle(document.body), text = getComputedStyle(panel.querySelector('.cp-alert-body'));
        return { bodyFont: body.fontFamily, textFont: text.fontFamily, buttonFont: getComputedStyle(button).fontFamily,
          canvas: getComputedStyle(document.documentElement).backgroundColor, bodyBackground: body.backgroundColor,
          buttonColor: getComputedStyle(button).color, buttonBackground: getComputedStyle(button).backgroundColor,
          buttonSize: getComputedStyle(button).fontSize, buttonWeight: getComputedStyle(button).fontWeight,
          background: getComputedStyle(panel).backgroundColor, color: text.color,
          titleSize: getComputedStyle(panel.querySelector('.cp-alert-title')).fontSize,
          textSize: text.fontSize, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.match(style.bodyFont, /Arial/);
      assert.equal(style.textFont, style.bodyFont);
      assert.equal(style.buttonFont, style.bodyFont);
      assert.equal(style.buttonSize, '12.5px');
      assert.equal(style.buttonWeight, '700');
      assert.equal(style.canvas, style.bodyBackground, 'scrollbar gutters match the recovery page palette');
      assert.equal(style.titleSize, '14px');
      assert.equal(style.textSize, '13px');
      assert.notEqual(style.background, style.color);
      const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255)
        .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
        .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const ink = luminance(style.buttonColor), paper = luminance(style.buttonBackground);
      assert.ok((Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05) >= 4.5,
        `Retry text stays readable: ${palette}, ${style.buttonColor} on ${style.buttonBackground}`);
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
