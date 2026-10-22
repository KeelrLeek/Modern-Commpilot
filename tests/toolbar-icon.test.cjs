const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright-core');
const art = require('../scripts/make-icons.cjs');

const root = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const extensionPath = process.env.EXTENSION_PATH || root;
const iconCode = fs.readFileSync(path.join(root, 'src/bg/icon.js'), 'utf8');
const bridgeCode = fs.readFileSync(path.join(root, 'src/bg/credential-bridge.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const tab = { tab: { id: 7 }, url: 'https://apps-sbx.avpaas.io/commpilot/User/Profile/' };
// Any CSS colours: icon.js paints whatever the page reports.
const warm = { tile: '#123456', ink: 'rgb(250, 250, 250)', accent: 'hsl(20 60% 45%)' };
const cool = { tile: 'teal', ink: '#000', accent: 'rgb(0, 128, 128)' };
const plain = value => JSON.parse(JSON.stringify(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(read, done) {
  const end = Date.now() + 5000;
  let value = await read();
  while (!done(value) && Date.now() < end) { await pause(50); value = await read(); }
  return value;
}

// The fake canvas reads these colours and ignores any other fillStyle, as a real canvas ignores a non-colour.
const pixels = { black: [0, 0, 0, 255], white: [255, 255, 255, 255], '#000': [0, 0, 0, 255], '#123456': [18, 52, 86, 255],
  'rgb(250, 250, 250)': [250, 250, 250, 255], 'hsl(20 60% 45%)': [184, 97, 46, 255],
  teal: [0, 128, 128, 255], 'rgb(0, 128, 128)': [0, 128, 128, 255] };

class FakePath { constructor(d) { this.d = d; } }
// Records each drawing call with the state it used; getImageData hands the record back, or a
// 1x1 canvas's one pixel.
class FakeCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    const ops = [], size = this.width;
    let fill = 'black';
    return {
      get fillStyle() { return fill; },
      set fillStyle(value) { if (Object.hasOwn(pixels, value)) fill = value; },
      strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      fillRect() {},
      scale(x, y) { ops.push(['scale', x, y]); },
      fill(shape) { ops.push(['fill', shape.d, this.fillStyle, this.globalAlpha]); },
      clip(shape) { ops.push(['clip', shape.d]); },
      stroke(shape) {
        ops.push(['stroke', shape.d, this.strokeStyle, this.globalAlpha, this.lineWidth, this.lineCap, this.lineJoin]);
      },
      getImageData(x, y, width, height) { return size === 1 ? { data: pixels[fill] } : { size, width, height, ops }; }
    };
  }
}

// A background page with just enough chrome.* for icon.js. Storage answers later, as the real one does.
function background({ stored, canvas = true, action: override = {}, globals = {} } = {}) {
  const calls = [], queue = [], listeners = [], replies = [];
  const storage = stored ? { cpIconColors: stored } : {};
  const action = {};
  for (const method of ['setIcon', 'setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor'])
    action[method] = override[method] || ((details, done) => { calls.push([method, plain(details)]); done?.(); });
  const chrome = {
    action,
    runtime: {
      lastError: undefined,
      onMessage: { addListener: fn => listeners.push(fn) },
      onStartup: { addListener: fn => { chrome.startup = fn; } },
      onInstalled: { addListener: fn => { chrome.installed = fn; } }
    },
    storage: { local: {
      get: (key, done) => queue.push(() => done({ [key]: storage[key] })),
      set: (values, done) => { calls.push(['store', plain(values)]); Object.assign(storage, values); queue.push(() => done?.()); }
    } }
  };
  const context = vm.createContext({ chrome, URL, TextEncoder, TextDecoder,
    ...(canvas ? { OffscreenCanvas: FakeCanvas, Path2D: FakePath } : {}), ...globals });
  return {
    calls, chrome, context, listeners,
    run: code => vm.runInContext(code, context),
    settle: () => { while (queue.length) queue.shift()(); },
    send: (message, sender = tab) => listeners.map(fn => fn(message, sender, answer => replies.push(answer))),
    replies,
    icons: () => calls.filter(([method]) => method === 'setIcon').map(([, details]) => details.imageData)
  };
}

function painted(image, colors, size) {
  assert.equal(image.width, size);
  assert.deepEqual(image.ops, [
    ['scale', size / 24, size / 24],
    ['fill', art.TILE, colors.tile, 1],
    ['clip', art.TILE],
    ['fill', art.GROUND, colors.ink, 0.26],
    ['stroke', art.LINE, colors.ink, 1, 2.6, 'round', 'round']
  ]);
}

test('toolbar tile is painted at startup from the colours the page last reported', () => {
  const page = background({ stored: warm });
  page.run(iconCode);
  assert.deepEqual(page.calls, [], 'nothing is drawn before storage answers');
  page.settle();
  const icons = page.icons();
  assert.equal(icons.length, 1);
  assert.deepEqual(Object.keys(icons[0]), ['16', '32']);
  painted(icons[0][16], warm, 16);
  painted(icons[0][32], warm, 32);
  assert.deepEqual(page.calls.filter(([method]) => method.startsWith('setBadge')), [
    ['setBadgeBackgroundColor', { color: pixels[warm.accent] }],
    ['setBadgeTextColor', { color: pixels[warm.ink] }]
  ]);
  page.chrome.startup();
  page.chrome.installed({ reason: 'update' });
  page.settle();
  assert.equal(page.icons().length, 1, 'the same colours are not painted twice');
});

test('with no stored colours the manifest PNGs and default badge colours stay', () => {
  const page = background();
  page.run(iconCode);
  page.settle();
  page.chrome.startup();
  page.settle();
  assert.deepEqual(page.calls, []);
});

test('a page palette report is stored and repaints the button; repeats cost nothing', () => {
  const page = background({ stored: warm });
  page.run(iconCode);
  // The report lands before the stored copy is read, so the older stored colours must not win.
  assert.deepEqual(page.send({ kind: 'cpPalette', palette: 'ocean', colors: { ...cool, ink: ' #000 ' } }), [false]);
  page.settle();
  assert.deepEqual(page.calls.filter(([method]) => method === 'store'), [['store', { cpIconColors: cool }]]);
  assert.equal(page.icons().length, 1);
  painted(page.icons()[0][32], cool, 32);
  page.send({ kind: 'cpPalette', palette: 'ocean', colors: cool });
  page.settle();
  assert.equal(page.calls.filter(([method]) => method === 'store').length, 1);
  assert.equal(page.icons().length, 1);
  page.send({ kind: 'cpPalette', colors: warm });
  page.settle();
  painted(page.icons()[1][16], warm, 16);
  assert.deepEqual(page.calls.filter(([method]) => method === 'setBadgeBackgroundColor').at(-1)[1],
    { color: pixels[warm.accent] });
  const before = page.calls.length;
  for (const colors of [undefined, 'red', { tile: 'red', ink: 'white' }, { ...cool, accent: 7 },
    { ...cool, tile: 'x'.repeat(65) }, { ...cool, ink: '   ' }, { ...cool, accent: 'not-a-colour' }])
    page.send({ kind: 'cpPalette', colors });
  page.send({ kind: 'cpPalette', colors: cool }, { url: 'chrome-extension://id/src/popup/popup.html' });
  page.settle();
  assert.equal(page.calls.length, before, 'unusable reports and reports without a tab change nothing');
  assert.deepEqual(page.replies, []);
});

test('sandbox pages get an SBX badge on their own tab and live pages clear it', () => {
  const page = background();
  page.run(iconCode);
  page.settle();
  assert.deepEqual(page.send({ kind: 'cpEnv', env: 'sandbox' }), [false]);
  assert.deepEqual(page.send({ kind: 'cpEnv', env: 'live' }, { tab: { id: 9 } }), [false]);
  page.send({ kind: 'cpEnv', env: 'staging' });
  page.send({ kind: 'cpEnv', env: 'sandbox' });
  assert.deepEqual(page.calls, [
    ['setBadgeText', { tabId: 7, text: 'SBX' }],
    ['setBadgeText', { tabId: 9, text: '' }],
    ['setBadgeText', { tabId: 7, text: 'SBX' }]
  ]);
  assert.deepEqual(page.replies, []);
});

test('other message kinds and senders pass through untouched', () => {
  const page = background({ stored: warm });
  page.run(iconCode);
  page.settle();
  const before = page.calls.length;
  for (const message of [undefined, null, 'cpEnv', {}, { kind: 'bwCredential', op: 'list' },
    { kind: 'cpenv', env: 'sandbox' }])
    assert.deepEqual(page.send(message), [false]);
  assert.deepEqual(page.send({ kind: 'cpEnv', env: 'sandbox' }, {}), [false]);
  assert.deepEqual(page.send({ kind: 'cpEnv', env: 'sandbox' }, { tab: { id: -1 } }), [false]);
  assert.deepEqual(page.send({ kind: 'cpEnv', env: 'sandbox' }, null), [false]);
  assert.equal(page.calls.length, before);
  assert.deepEqual(page.replies, []);
});

test('missing canvas support or failing action calls never throw out of a listener', async () => {
  const bare = background({ stored: warm, canvas: false });
  bare.run(iconCode);
  bare.settle();
  bare.send({ kind: 'cpPalette', colors: cool });
  bare.settle();
  assert.deepEqual(bare.icons(), [], 'the manifest PNGs stay');
  assert.deepEqual(bare.calls.filter(([method]) => method === 'setBadgeBackgroundColor'),
    [['setBadgeBackgroundColor', { color: warm.accent }], ['setBadgeBackgroundColor', { color: cool.accent }]],
    'without a canvas the badge gets the colour as written');

  const rejected = [];
  const onRejection = reason => rejected.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    const page = background({ stored: warm, action: {
      setIcon: () => { throw new TypeError('bad icon'); },
      setBadgeText: () => Promise.reject(new Error('tab closed')),
      setBadgeBackgroundColor: (details, done) => {
        page.chrome.runtime.lastError = { message: 'no colour' };
        done();
        page.chrome.runtime.lastError = undefined;
      }
    } });
    page.chrome.action.setBadgeTextColor = undefined;
    page.run(iconCode);
    page.settle();
    page.send({ kind: 'cpEnv', env: 'sandbox' });
    page.send({ kind: 'cpPalette', colors: cool });
    page.settle();
    const broken = background({ canvas: true, globals: { OffscreenCanvas: class { getContext() { throw new Error('no 2d'); } } } });
    broken.run(iconCode);
    broken.send({ kind: 'cpPalette', colors: cool });
    assert.deepEqual(broken.calls, [], 'colours the canvas cannot read are refused');
    const pathless = background({ globals: { Path2D: class { constructor() { throw new Error('no paths'); } } } });
    pathless.run(iconCode);
    pathless.send({ kind: 'cpPalette', colors: cool });
    assert.deepEqual(pathless.icons(), []);
    assert.deepEqual(pathless.calls.filter(([method]) => method === 'setBadgeBackgroundColor'),
      [['setBadgeBackgroundColor', { color: cool.accent }]]);
    await pause(20);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  assert.deepEqual(rejected, []);
});

test('Chrome and Firefox load the icon, update checker and vault listeners together', () => {
  assert.equal(manifest.background.service_worker, 'src/bg/credential-bridge.js');
  assert.deepEqual(manifest.background.scripts, ['src/bg/icon.js', 'src/bg/updates.js', 'src/bg/credential-bridge.js']);
  const imported = [];
  const worker = background({ stored: warm, globals: { importScripts: (...urls) => {
    for (const url of urls) {
      imported.push(url);
      worker.run(fs.readFileSync(path.join(root, url), 'utf8'));
    }
  } } });
  worker.run(bridgeCode);
  assert.deepEqual(imported, ['/src/bg/icon.js', '/src/bg/updates.js']);
  // The Firefox event page: both files in one page, with no importScripts.
  const eventPage = background({ stored: warm });
  for (const code of [iconCode, fs.readFileSync(path.join(root, 'src/bg/updates.js'), 'utf8'), bridgeCode]) eventPage.run(code);
  for (const page of [worker, eventPage]) {
    page.settle();
    assert.equal(page.listeners.length, 3);
    assert.equal(page.icons().length, 1);
    assert.deepEqual(page.send({ kind: 'cpEnv', env: 'sandbox' }), [false, false, false]);
    assert.deepEqual(page.replies, [], 'the vault ignores the badge message');
    page.send({ kind: 'bwCredential', op: 'list' });
    assert.deepEqual(plain(page.replies), [{ ok: false, error: 'Unauthorized credential request' }],
      'the vault still answers its own kind, once');
  }
});

test('icon.js hard-codes no palette colours', () => {
  assert.doesNotMatch(iconCode, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(iconCode, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[\d.]/i);
});

test('every palette in theme-palettes.css has both favicons, drawn from its tokens', () => {
  const css = fs.readFileSync(art.cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const named = [...new Set([...css.matchAll(/data-cp-direction="([^"]*)"/g)].map(match => match[1]))];
  const palettes = art.readPalettes(css);
  assert.ok(named.length >= 1);
  assert.deepEqual(Object.keys(palettes).sort(), named.sort());
  assert.ok(palettes.atlas, 'Atlas, the default, is drawn in the static PNGs');
  const ids = [];
  for (const name of named) {
    for (const suffix of ['', '-sbx']) {
      const file = path.join(art.iconDir, `pulse-${name}${suffix}.svg`);
      assert.ok(fs.existsSync(file), `missing ${path.basename(file)}; run node scripts/make-icons.cjs`);
      const svg = fs.readFileSync(file, 'utf8');
      assert.equal(svg, art.faviconSvg(name, palettes[name], suffix === '-sbx'),
        `${path.basename(file)} is out of date; run node scripts/make-icons.cjs`);
      const id = svg.match(/<clipPath id="([^"]+)"/)[1];
      assert.match(svg, new RegExp(`clip-path="url\\(#${id}\\)"`));
      ids.push(id);
    }
    assert.ok(fs.readFileSync(path.join(art.iconDir, `pulse-${name}.svg`), 'utf8')
      .includes(`fill="${palettes[name].tile}"`));
    assert.doesNotMatch(fs.readFileSync(path.join(art.iconDir, `pulse-${name}-sbx.svg`), 'utf8'), /fill-opacity/);
  }
  assert.equal(new Set(ids).size, ids.length, 'clipPath ids are unique across favicons');
});

test('a palette added to the stylesheet is picked up from its first token block', () => {
  const css = `/* html[data-cp-direction="ghost"] */
    html[data-cp-direction="ocean"] body[id="initBody.menuTemplate"] {
      --d-accent:#0af; --d-accent-soft:#fff; --d-action:#036; --d-action-text:#e0f0ff; --d-active-icon:#123;
    }
    html[data-cp-direction="ocean"] body[id="initBody.menuTemplate"] { --d-accent:#f00; --d-action:#f00; --d-action-text:#f00; }
    html[data-cp-direction="ocean"] body[id="initBody.menuTemplate"] .headerBar { color:var(--d-accent); }
    @media (prefers-contrast: more) {
      html[data-cp-direction="dune"] body[id="initBody.menuTemplate"],
      html[data-cp-direction="moss"] body[id="initBody.menuTemplate"] { --d-action:rgb(1 2 3); --d-action-text:white; --d-accent:#abc }
    }`;
  assert.deepEqual(art.readPalettes(css), {
    ocean: { tile: '#036', ink: '#e0f0ff', accent: '#0af' },
    dune: { tile: 'rgb(1 2 3)', ink: 'white', accent: '#abc' },
    moss: { tile: 'rgb(1 2 3)', ink: 'white', accent: '#abc' }
  });
  assert.throws(() => art.readPalettes(css + 'html[data-cp-direction="bare"] body { color:red; }'), /no .* block for: bare/);
  assert.throws(() => art.readPalettes('html[data-cp-direction="x"] body[id="initBody.menuTemplate"] ' +
    '{ --d-action:var(--y); --d-action-text:#fff; --d-accent:#fff; }'), /literal colours/);
});

test('manifest names the Pulse PNGs and only the expected storage, update-alarm and request-rule permissions', () => {
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'declarativeNetRequest']);
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  assert.deepEqual(Object.keys(manifest.action.default_icon), ['16', '32']);
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    for (const [size, file] of Object.entries(icons)) {
      const png = fs.readFileSync(path.join(root, file));
      assert.equal(png.subarray(1, 4).toString(), 'PNG', file);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [+size, +size], file);
      assert.equal(png[25], 6, `${file} has an alpha channel for its transparent corners`);
    }
  }
});

test('the extension worker paints the toolbar and badges its own tab', { skip: !chromePath }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-toolbar-icon-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.match(worker.url(), /\/src\/bg\/credential-bridge\.js$/);
    // Watch setIcon from here on: what it was given and whether the browser took it.
    await worker.evaluate(() => {
      self.iconCalls = [];
      const setIcon = chrome.action.setIcon.bind(chrome.action);
      chrome.action.setIcon = (details, done) => setIcon(details, (...args) => {
        const image = details.imageData[32], pixel = (x, y) => Array.from(image.data.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
        self.iconCalls.push({ sizes: Object.keys(details.imageData), corner: pixel(0, 0), tile: pixel(8, 4),
          error: chrome.runtime.lastError?.message ?? null });
        done?.(...args);
      });
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    // The accent is in a syntax the badge call cannot parse itself; icon.js hands it [r, g, b, a].
    const tabId = await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ kind: 'cpPalette', palette: 'test',
        colors: { tile: '#a54d37', ink: '#ffffff', accent: 'rgb(173 84 62)' } });
      await chrome.runtime.sendMessage({ kind: 'cpEnv', env: 'sandbox' });
      return (await chrome.tabs.getCurrent()).id;
    });
    const state = () => worker.evaluate(async id => ({
      icons: self.iconCalls,
      stored: (await chrome.storage.local.get('cpIconColors')).cpIconColors,
      badge: await chrome.action.getBadgeText({ tabId: id }),
      elsewhere: await chrome.action.getBadgeText({}),
      background: await chrome.action.getBadgeBackgroundColor({ tabId: id })
    }), tabId);
    assert.deepEqual(await eventually(state, now => now.icons.length && now.badge), {
      icons: [{ sizes: ['16', '32'], corner: [0, 0, 0, 0], tile: [165, 77, 55, 255], error: null }],
      stored: { tile: '#a54d37', ink: '#ffffff', accent: 'rgb(173 84 62)' },
      badge: 'SBX', elsewhere: '', background: [173, 84, 62, 255]
    });
    await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'cpEnv', env: 'live' }));
    assert.equal((await eventually(state, now => !now.badge)).badge, '');
    assert.deepEqual(await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'bwCredential', op: 'list' })),
      { ok: false, error: 'Unauthorized credential request' }, 'the vault listener still runs beside icon.js');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
