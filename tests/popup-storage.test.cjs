const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const art = require('../scripts/make-icons.cjs');

const root = path.resolve(__dirname, '..');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

async function fixture() {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent(fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  await page.evaluate(() => {
    window.writes = [];
    window.sent = [];
    window.stored = 'atlas';
    window.chrome = { runtime: { sendMessage: (message, done) => { sent.push(message); done(); } }, storage: {
      local: { get: (key, done) => { window.load = value => done({ [key]: value }); },
        set: (data, done) => window.writes.push({ data, done }) },
      onChanged: { addListener: listener => { window.changed = listener; } }
    } };
    window.finishWrite = (index, error) => {
      const write = writes[index];
      if (error) chrome.runtime.lastError = { message: error };
      else {
        stored = write.data.cpThemePalette;
        changed({ cpThemePalette: { newValue: stored } }, 'local');
      }
      write.done();
      delete chrome.runtime.lastError;
    };
  });
  await page.addScriptTag({ path: path.join(root, 'src/content/themes.js') });
  await page.addScriptTag({ path: path.join(root, 'src/popup/popup.js') });
  return { page, errors, close: () => browser.close() };
}

test('rapid theme and mode changes keep the latest complete choice through delayed saves', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => load('atlas'));
    await f.page.check('#palette-graphite');
    await f.page.check('input[name="mode"][value="dark"]');
    assert.equal(await f.page.getAttribute('html', 'data-cp-palette'), 'graphite');
    assert.equal(await f.page.evaluate(() => writes.length), 1, 'writes are serialized');
    await f.page.evaluate(() => finishWrite(0));
    assert.equal(await f.page.getAttribute('html', 'data-cp-palette'), 'graphite', 'older storage notification cannot reset a pending choice');
    await f.page.evaluate(() => finishWrite(1));
    assert.equal(await f.page.evaluate(() => stored), 'graphite');
    assert.match(await f.page.textContent('#save-status'), /Duke, dark is active/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a delayed initial preference read does not reset the chosen mode or saving status', async () => {
  const f = await fixture();
  try {
    await f.page.check('input[name="mode"][value="dark"]');
    await f.page.evaluate(() => load('atlas'));
    assert.match(await f.page.textContent('#save-status'), /Saving/);
    await f.page.check('#palette-terra');
    assert.equal(await f.page.getAttribute('html', 'data-cp-palette'), 'terra-dark');
    await f.page.evaluate(() => finishWrite(0));
    await f.page.evaluate(() => finishWrite(1));
    assert.equal(await f.page.evaluate(() => stored), 'terra-dark');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a failed older write still saves the latest choice, and a failed latest write restores the saved choice', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => load('nord'));
    await f.page.check('#palette-graphite');
    await f.page.check('#palette-terra');
    await f.page.evaluate(() => finishWrite(0, 'Temporary failure'));
    assert.equal(await f.page.getAttribute('html', 'data-cp-palette'), 'terra-dark');
    await f.page.evaluate(() => finishWrite(1));
    await f.page.check('#palette-dmg');
    await f.page.evaluate(() => finishWrite(2, 'Quota exceeded'));
    assert.equal(await f.page.getAttribute('html', 'data-cp-palette'), 'terra-dark');
    assert.match(await f.page.textContent('#save-status'), /Could not save/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a saved choice reports its colours for the toolbar button; superseded and failed saves do not', async () => {
  const f = await fixture();
  try {
    await f.page.addStyleTag({ path: path.join(root, 'src/content/theme-palettes.css') });
    await f.page.evaluate(() => load('atlas'));
    await f.page.check('#palette-graphite');
    await f.page.check('input[name="mode"][value="dark"]');
    await f.page.evaluate(() => finishWrite(0));
    assert.deepEqual(await f.page.evaluate(() => sent), [], 'the superseded light side is not reported');
    await f.page.evaluate(() => finishWrite(1));
    const palettes = art.readPalettes(fs.readFileSync(art.cssFile, 'utf8'));
    assert.deepEqual(await f.page.evaluate(() => sent),
      [{ kind: 'cpPalette', palette: 'graphite', colors: palettes.graphite }], 'the colours a CommPilot page reports');
    await f.page.check('#palette-terra');
    await f.page.evaluate(() => finishWrite(2, 'Quota exceeded'));
    assert.equal(await f.page.evaluate(() => sent.length), 1, 'a failed save keeps the button as it was');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('an external preference change wins over a stale initial read while idle', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => {
      changed({ cpThemePalette: { newValue: 'nord' } }, 'local');
      load('atlas');
    });
    assert.equal(await f.page.getAttribute('html', 'data-cp-palette'), 'nord');
    await f.page.check('#palette-dmg');
    await f.page.evaluate(() => finishWrite(0));
    assert.equal(await f.page.evaluate(() => stored), 'dmg-dark');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
