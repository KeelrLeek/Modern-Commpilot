const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><body><fieldset id="choices"><legend>Choices</legend>' +
      '<select id="choice" aria-label="Device"><option value="a">Alpha</option>' +
      '<optgroup label="Other"><option value="b" disabled>Beta</option><option value="c">Charlie</option></optgroup>' +
      '</select></fieldset></body>' }));
    await page.goto('https://apps-sbx.avpaas.io/fixture');
    await page.addStyleTag({ path: path.join(root, 'src/content/enhancer.css') });
    await page.addScriptTag({ path: path.join(root, 'src/content/enhancer.js') });
    await page.locator('.bw-select-trigger').waitFor();
    await check(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('searchable select mirrors later native fieldset disable and enable', () => fixture(async page => {
  await page.locator('#choices').evaluate(el => { el.disabled = true; });
  await page.waitForFunction(() => document.querySelector('.bw-select-trigger').getAttribute('aria-disabled') === 'true', null, { timeout: 1500 });
  assert.equal(await page.locator('.bw-select-trigger').getAttribute('tabindex'), '-1');
  await page.locator('#choices').evaluate(el => { el.disabled = false; });
  await page.waitForFunction(() => document.querySelector('.bw-select-trigger').getAttribute('aria-disabled') === 'false');
  await page.locator('.bw-select-trigger').click();
  assert.equal(await page.locator('#bw-search-popover').isVisible(), true);
}));

test('disabling a fieldset closes its already-open select search', () => fixture(async page => {
  await page.locator('.bw-select-trigger').click();
  await page.locator('#choices').evaluate(el => { el.disabled = true; });
  await page.waitForFunction(() => document.querySelector('#bw-search-popover').hidden, null, { timeout: 1500 });
  assert.equal(await page.locator('#choice').inputValue(), 'a');
}));

test('a newly enabled native option becomes selectable without reopening search', () => fixture(async page => {
  await page.locator('.bw-select-trigger').click();
  await page.locator('#choice option[value=b]').evaluate(el => { el.disabled = false; });
  await page.waitForFunction(() => [...document.querySelectorAll('.bw-search-result')].some(el => el.querySelector('.bw-result-text')?.textContent === 'Beta' && !el.disabled), null, { timeout: 1500 });
  await page.locator('.bw-search-result', { hasText: 'Beta' }).click();
  assert.equal(await page.locator('#choice').inputValue(), 'b');
}));

test('an optgroup disabled while search is open updates its visible choices', () => fixture(async page => {
  await page.locator('.bw-select-trigger').click();
  await page.locator('#choice optgroup').evaluate(el => { el.disabled = true; });
  await page.waitForFunction(() => [...document.querySelectorAll('.bw-search-result')].some(el => el.querySelector('.bw-result-text')?.textContent === 'Charlie' && el.disabled), null, { timeout: 1500 });
  assert.equal(await page.locator('#choice').inputValue(), 'a');
}));

test('New Device still selects its native option after the option list changes', () => fixture(async page => {
  await page.locator('#choice').evaluate(el => el.append(new Option('New Identity/Device Profile (Group)', 'New Device')));
  await page.locator('.bw-select-trigger').click();
  await page.locator('#choice').evaluate(el => el.prepend(new Option('Newly loaded profile', 'existing')));
  await page.locator('.bw-search-result', { hasText: 'Newly loaded profile' }).waitFor();
  await page.locator('.bw-search-create-btn').click();
  assert.equal(await page.locator('#choice').inputValue(), 'New Device');
}));

test('a select in a disabled fieldset first legend remains usable', () => fixture(async page => {
  await page.locator('#choices').evaluate(el => {
    el.querySelector('legend').append(el.querySelector('.bw-select-shell'));
    el.disabled = true;
  });
  await page.locator('.bw-select-trigger').click();
  await page.locator('.bw-search-result', { hasText: 'Charlie' }).click();
  assert.equal(await page.locator('#choice').inputValue(), 'c');
}));
