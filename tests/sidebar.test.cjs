const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';

// A user's page as CommPilot serves it (trimmed): the header, and the left navigation with its "Options:" cell and
// folders (one open, one with a long name).
const folders = ['Profile', 'Incoming Calls', 'Outgoing Calls', 'Call Control', 'Communication Barring', 'Utilities'];
const page = `<!doctype html><html><head><title>Call Forwarding Always</title></head><body id="initBody.menuTemplate">
  <table><tr><td class="headerBar"><img src="/conf/clientLogo.gif"></td>
    <td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr></table>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" height="100%"><tbody><tr>
    <td width="18%" valign="top" class="headandfoot"><form name="leftNavForm" method="post"><b>
      <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr><td class="navOptions">Options:</td></tr>
      ${folders.map(name => {
        const cls = name === 'Incoming Calls' ? 'leftnavfolderopen' : 'leftnavfolder';
        return `<tr><td class="${cls}" nowrap=""><a class="${cls}" href="#">${name}</a></td></tr>`;
      }).join('')}
      </tbody></table></b></form></td>
    <td width="82%" valign="top"><h1 class="screenName">Call Forwarding Always</h1></td></tr></tbody></table>
</body></html>`;

async function open(browser, width, height, stored) {
  const tab = await browser.newPage({ viewport: { width, height } });
  if (Number(process.env.BW_TEST_SIDEBAR_CPU_RATE) > 1) {
    const session = await tab.context().newCDPSession(tab);
    await session.send('Emulation.setCPUThrottlingRate', {rate: Number(process.env.BW_TEST_SIDEBAR_CPU_RATE)});
  }
  await tab.addInitScript(saved => {
    let listener;
    const store = { cpThemePalette: 'graphite', cpSettings: saved };
    window.__store = store;
    window.chrome = Object.assign(window.chrome || {}, {
      runtime: { getURL: p => `https://apps-sbx.avpaas.io/ext/${p}` },
      storage: { local: { get: (_, done) => done({ ...store }),
        set: (value, done) => { Object.assign(store, value); for (const k in value) listener?.({ [k]: { newValue: value[k] } }, 'local'); done?.(); } },
        onChanged: { addListener: fn => { listener = fn; } } },
    });
  }, stored || null);
  await tab.route(origin + '/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/ext/'))
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, pathname.slice(5))) });
    return route.fulfill({ status: 200, contentType: 'text/html', body: page });
  });
  await tab.goto(origin + '/commpilot/User/CF/Always/', { waitUntil: 'domcontentloaded' });
  for (const file of ['native-theme.css', 'theme-palettes.css', 'theme-settings.css'])
    await tab.addStyleTag({ path: path.join(root, 'src/content', file) });
  for (const file of ['fonts.js', 'themes.js', 'theme-settings.js', 'native-theme.js', 'theme-icons.js'])
    await tab.addScriptTag({ path: path.join(root, 'src/content', file) });
  await tab.waitForFunction(() => document.documentElement.dataset.cpDirection === 'graphite');
  return tab;
}

const side = tab => tab.evaluate(async () => {
  await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));   // row fills fade in
  const cell = document.querySelector('td.headandfoot[width="18%"]');
  const open = document.querySelector('a.leftnavfolderopen');
  const long = [...document.querySelectorAll('form[name="leftNavForm"] a')].find(a => a.textContent === 'Communication Barring');
  return { width: Math.round(cell.getBoundingClientRect().width), rail: document.documentElement.hasAttribute('data-cp-rail'),
    forced: document.documentElement.hasAttribute('data-cp-rail-forced'),
    options: getComputedStyle(document.querySelector('td.navOptions')).fontSize,
    menu: document.querySelector('.cp-side-menu') && getComputedStyle(document.querySelector('.cp-side-menu')).display,
    label: document.querySelector('.cp-side-menu-label') && (getComputedStyle(document.querySelector('.cp-side-menu-label')).opacity === '0' ? 'hidden' : 'shown'),
    button: document.querySelector('.cp-side-toggle')?.getAttribute('aria-label'),
    names: getComputedStyle(open).color === 'rgba(0, 0, 0, 0)' ? 'hidden' : 'shown',
    clipped: long.scrollWidth > long.clientWidth + 1,
    openFill: getComputedStyle(open).backgroundColor, restFill: getComputedStyle(long).backgroundColor,
    bar: [getComputedStyle(open, '::after').content, getComputedStyle(open).boxShadow, getComputedStyle(open).borderLeftColor],
    page: Math.round(document.querySelector('td[width="82%"]').getBoundingClientRect().left) };
});

test('the sidebar: a quiet list under a Menu header that folds it to icons, the rail on small windows', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    // A wide window: the full list, a Menu header instead of "Options:", the open folder a soft fill with no side bar.
    const tab = await open(browser, 1400, 800);
    await tab.locator('.cp-side-toggle').waitFor();
    const full = await side(tab);
    assert.equal(full.rail, false);
    assert.ok(full.width >= 210 && full.width <= 264, `a full-width sidebar (${full.width}px)`);
    assert.equal(full.options, '0px', '“Options:” is gone');
    assert.deepEqual([full.menu, full.label, full.button], ['flex', 'shown', 'Collapse the menu']);
    assert.equal(full.names, 'shown');
    assert.equal(full.clipped, false, 'long names fit');
    assert.notEqual(full.openFill, full.restFill, 'the open folder is highlighted');
    assert.deepEqual(full.bar, ['none', 'none', 'rgba(0, 0, 0, 0)'], 'no side bar, shadow or border on it');

    // Folding: animated (the column narrows over a moment), icons only, remembered, names beside the icons on hover.
    // Observe the actual CSS transition at its midpoint. A wall-clock sleep
    // after a Playwright click can sample after the animation has already ended.
    const midway = await tab.evaluate(() => {
      const cell = document.querySelector('td.headandfoot[width="18%"]');
      document.querySelector('.cp-side-toggle').click();
      const animations = cell.getAnimations();
      const widths = animations.filter(animation => ['width', 'flex-basis'].includes(animation.transitionProperty));
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
      }
      const width = Math.round(cell.getBoundingClientRect().width);
      for (const animation of animations) animation.play();
      return {width, transitions: widths.length};
    });
    assert.ok(midway.transitions > 0, 'folding has a real width transition');
    assert.ok(midway.width > 68 && midway.width < full.width, `the sidebar narrows over a moment (${midway.width}px midway)`);
    const folded = await side(tab);
    assert.deepEqual([folded.rail, folded.forced, folded.width, folded.names, folded.label, folded.button],
      [true, false, 68, 'hidden', 'hidden', 'Expand the menu']);
    assert.equal(folded.page, 68, 'the page takes the room');
    assert.deepEqual(await tab.evaluate(() => window.__store.cpSettings.side), 'rail', 'saved with the other settings');
    const link = tab.locator('form[name="leftNavForm"] a', { hasText: 'Outgoing Calls' });
    await link.hover();
    const tip = tab.locator('#cp-side-tip');
    await tip.waitFor();
    const placed = await tab.evaluate(() => {
      const t = document.getElementById('cp-side-tip').getBoundingClientRect();
      const a = [...document.querySelectorAll('form[name="leftNavForm"] a')].find(a => a.textContent === 'Outgoing Calls').getBoundingClientRect();
      return { text: document.getElementById('cp-side-tip').textContent, right: t.left > a.right, level: Math.abs((t.top + t.bottom) / 2 - (a.top + a.bottom) / 2) <= 1 };
    });
    assert.deepEqual(placed, { text: 'Outgoing Calls', right: true, level: true }, 'the name beside its icon');
    await tab.mouse.move(700, 400);
    assert.equal(await tip.isVisible(), false);

    // The next page opens folded; expanding brings the names back.
    const next = await open(browser, 1400, 800, { peek: true, font: 'inter', side: 'rail' });
    await next.locator('.cp-side-toggle').waitFor();
    assert.equal((await side(next)).width, 68, 'the fold is remembered');
    await next.getByRole('button', { name: 'Expand the menu' }).click();
    assert.equal((await side(next)).rail, false);

    // A 4:3 window: always the rail, never names cut off under the page; no fold button there.
    const small = await open(browser, 1024, 768);
    await small.locator('.cp-side-toggle').waitFor({ state: 'attached' });
    const four = await side(small);
    assert.deepEqual([four.rail, four.forced, four.width, four.names, four.menu, four.page], [true, true, 68, 'hidden', 'none', 68]);
    await small.setViewportSize({ width: 1400, height: 800 });
    await small.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-rail'));
    assert.ok((await side(small)).width >= 210, 'wider again: the full list returns');

    // Just above the rail (the narrowest full sidebar): a long name wraps, and nothing, the fold button included,
    // runs past the sidebar's edge.
    await small.setViewportSize({ width: 1134, height: 767 });
    await small.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-rail'));
    const narrow = await small.evaluate(() => {
      const edge = document.querySelector('td.headandfoot[width="18%"]').getBoundingClientRect().right;
      const parts = [...document.querySelectorAll('form[name="leftNavForm"] :is(a, .cp-side-toggle)')];
      return { out: parts.filter(el => el.getBoundingClientRect().right > edge + 0.5 || el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim() || 'fold button') };
    });
    assert.deepEqual(narrow.out, [], 'nothing cut off at the sidebar’s edge');
  } finally { await browser.close(); }
});

test('the sidebar folders take keyboard focus without an href, and Enter presses them', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const tab = await open(browser, 1400, 800);
    await tab.locator('.cp-side-toggle').waitFor();
    // Live CommPilot folder links have no href, so the browser leaves them out of the Tab order.
    await tab.evaluate(() => {
      window.pressed = [];
      for (const link of document.querySelectorAll('form[name="leftNavForm"] a')) {
        link.removeAttribute('href');
        link.addEventListener('click', () => window.pressed.push(link.textContent.trim()));
      }
      document.dispatchEvent(new Event('cp:reskin'));
    });
    await tab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await tab.locator('.cp-side-toggle').focus();
    const reached = [];
    for (let i = 0; i < 3; i++) {
      await tab.keyboard.press('Tab');
      reached.push(await tab.evaluate(() => document.activeElement.textContent.trim()));
    }
    assert.deepEqual(reached, ['Profile', 'Incoming Calls', 'Outgoing Calls'], 'Tab walks the folders in order');
    assert.equal(await tab.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'the sidebar’s own focus ring');
    await tab.keyboard.press('Enter');
    assert.deepEqual(await tab.evaluate(() => window.pressed), ['Outgoing Calls'], 'Enter presses the folder once');
  } finally { await browser.close(); }
});

test('a folder clicked in the rail does not bring its name back when the window is focused again; Tab still shows it', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const tab = await open(browser, 1024, 768);   // a 4:3 window: always the rail
    await tab.waitForFunction(() => document.documentElement.hasAttribute('data-cp-rail'));
    await tab.evaluate(() => {
      for (const link of document.querySelectorAll('form[name="leftNavForm"] a')) link.removeAttribute('href');
      document.dispatchEvent(new Event('cp:reskin'));
    });
    await tab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const tip = () => tab.evaluate(() => { const t = document.getElementById('cp-side-tip'); return t && !t.hidden ? t.textContent : null; });
    await tab.locator('form[name="leftNavForm"] a', { hasText: 'Outgoing Calls' }).click();
    await tab.mouse.move(700, 400);
    assert.equal(await tip(), null, 'a click puts the name away');
    // Another tab in front and back again: the browser focuses the clicked folder once more.
    const cdp = await tab.context().newCDPSession(tab);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await tab.evaluate(() => { window.refocused = false; document.addEventListener('focusin', () => { window.refocused = true; }); });
    const [other] = await Promise.all([tab.waitForEvent('popup'), tab.evaluate(() => { window.open('about:blank'); })]);
    await other.bringToFront();
    await tab.bringToFront();
    await tab.waitForFunction(() => window.refocused && document.activeElement.textContent === 'Outgoing Calls');
    assert.equal(await tip(), null, 'no name left over the page');
    await tab.keyboard.press('Tab');
    assert.equal(await tip(), 'Call Control', 'keyboard focus shows the name');
  } finally { await browser.close(); }
});
