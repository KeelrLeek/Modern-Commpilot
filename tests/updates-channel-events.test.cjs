const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const state = channel => ({ ok: true, preferences: { channel, automatic: true }, installed: '0.3.82', available: true,
  cache: { checkedAt: 1, release: { version: '0.3.83', url: `https://example.test/${channel}.zip`, notesUrl: `https://example.test/${channel}` } } });

async function fixture(check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="panel"></div>');
    await page.evaluate(() => {
      window.requests = []; window.replies = [];
      window.chrome = { runtime: { sendMessage(message, reply) { requests.push(message); replies.push(reply); } },
        storage: { onChanged: { addListener(fn) { window.storageChanged = fn; } } } };
    });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/updates.js') });
    await page.evaluate(() => {
      const panel = document.querySelector('#panel'); panel.innerHTML = cpUpdatesUI.markup();
      cpUpdatesUI.mount(panel); cpUpdatesUI.refresh();
    });
    await page.evaluate(state => window.replies.shift()(state), state('stable'));
    await page.waitForFunction(() => document.querySelector('.cp-updates').getAttribute('aria-busy') === 'false');
    await check(page);
  } finally { await browser.close(); }
}

test('an unrelated nightly cache notification leaves the Stable download and status alone', () => fixture(async page => {
  const before = await page.locator('.cp-update-status').textContent();
  await page.evaluate(() => storageChanged({ cpUpdateNightly: { newValue: { checkedAt: 2 } } }, 'local'));
  assert.equal(await page.evaluate(() => requests.length), 1, 'do not request Stable again when only Nightly changed');
  assert.equal(await page.locator('.cp-update-download').getAttribute('href'), 'https://example.test/stable.zip');
  assert.equal(await page.locator('.cp-update-status').textContent(), before);
}));

test('current-channel cache notifications still refresh update availability', () => fixture(async page => {
  await page.evaluate(() => storageChanged({ cpUpdateStable: { newValue: { checkedAt: 2 } } }, 'local'));
  assert.equal(await page.evaluate(() => requests.length), 2);
  assert.equal(await page.locator('.cp-update-download').getAttribute('href'), null);
  await page.evaluate(state => replies.shift()(state), state('stable'));
  await page.waitForFunction(() => document.querySelector('.cp-updates').getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('.cp-update-download').getAttribute('href'), 'https://example.test/stable.zip');
}));

test('Check for updates keeps keyboard focus and ignores presses while it is checking', () => fixture(async page => {
  const button = () => page.evaluate(() => {
    const check = document.querySelector('.cp-update-check');
    return { focused: document.activeElement === check, busy: check.getAttribute('aria-disabled'), requests: requests.length };
  });
  await page.locator('.cp-update-check').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await button(), { focused: true, busy: 'true', requests: 2 });
  assert.equal(await page.evaluate(() => requests[1].op), 'check');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => requests.length), 2, 'a press while checking does not start another check');
  await page.evaluate(state => replies.shift()(state), state('stable'));
  await page.waitForFunction(() => document.querySelector('.cp-updates').getAttribute('aria-busy') === 'false');
  assert.deepEqual(await button(), { focused: true, busy: null, requests: 2 });
}));

test('shared preference notifications can switch the selected channel', () => fixture(async page => {
  await page.evaluate(() => storageChanged({ cpUpdatePreferences: { newValue: { channel: 'nightly' } } }, 'local'));
  assert.equal(await page.evaluate(() => requests.length), 2);
  await page.evaluate(state => replies.shift()(state), state('nightly'));
  await page.waitForFunction(() => document.querySelector('.cp-updates').getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('[value="nightly"]').isChecked(), true);
  assert.equal(await page.locator('.cp-update-download').getAttribute('href'), 'https://example.test/nightly.zip');
}));
