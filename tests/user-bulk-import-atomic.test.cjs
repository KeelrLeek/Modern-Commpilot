const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture } = require('./fixtures/bulk-group-harness.cjs');

async function editor(check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), state = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=prefix]').fill('AZ');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=numberMode]').selectOption('none');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-start]').fill('9999');
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-field=first]').fill('Existing');
    await page.locator('[data-field=last]').fill('Draft');
    await page.locator('[data-field=email]').fill('existing@example.test');
    await page.locator('[data-field=dept]').selectOption({ label: 'Operations' });
    await page.locator('[data-field=extension]').fill('1234');
    await check(page);
    assert.equal(state.writes.length, 0, 'editing does not write to the PBX');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

const rows = 'First\tPasted\tfirst@example.test\tOperations\nSecond\tPasted\tsecond@example.test\tOperations';
async function paste(page, value) {
  await page.locator('[data-action=paste]').click();
  await page.getByRole('textbox', { name: 'User rows' }).fill(value);
  await page.locator('[data-action=import]').click();
}

test('extension exhaustion rejects the entire paste and preserves the previous batch after a render', () => editor(async page => {
  await paste(page, rows);
  assert.match(await page.locator('.paste-error').innerText(), /No next extension/);
  await page.locator('.subdialog [data-action=dismiss]').last().click();
  await page.locator('[data-action=save-defaults]').click();
  await page.waitForFunction(() => document.querySelector('.notice')?.textContent.includes('Group defaults saved'));
  assert.deepEqual(await page.locator('[data-field=email]').evaluateAll(nodes => nodes.map(n => n.value)),
    ['existing@example.test'], 'a rejected paste never becomes hidden batch state');
  assert.equal(await page.locator('[data-field=extension]').inputValue(), '1234');
}));

test('a rejected exhausted paste can be corrected without false duplicate-email errors', () => editor(async page => {
  await paste(page, rows);
  assert.match(await page.locator('.paste-error').innerText(), /No next extension/);
  await page.getByRole('textbox', { name: 'User rows' }).fill(rows.split('\n')[0]);
  await page.locator('[data-action=import]').click();
  assert.equal(await page.locator('.subdialog').isHidden(), true,
    'the corrected one-row paste fits: ' + await page.evaluate(() => document.querySelector('.paste-error')?.textContent || ''));
  assert.deepEqual(await page.locator('[data-field=email]').evaluateAll(nodes => nodes.map(n => n.value)),
    ['existing@example.test', 'first@example.test']);
  assert.deepEqual(await page.locator('[data-field=extension]').evaluateAll(nodes => nodes.map(n => n.value)),
    ['1234', '9999']);
}));

test('a fitting paste uses the final available extension and retains the existing draft', () => editor(async page => {
  await paste(page, rows.split('\n')[0]);
  assert.equal(await page.locator('.subdialog').isHidden(), true);
  assert.deepEqual(await page.locator('[data-field=extension]').evaluateAll(nodes => nodes.map(n => n.value)),
    ['1234', '9999']);
}));
