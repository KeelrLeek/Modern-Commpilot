const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture } = require('./fixtures/bulk-group-harness.cjs');

async function editor(check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(6000);
    const state = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=prefix]').fill('AZ');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=numberMode]').selectOption('none');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-action=primary]').click();
    await check(page);
    assert.equal(state.writes.length, 0, 'modal editing does not provision anything');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

for (const action of ['options', 'paste']) {
  test(`bulk ${action} blocks background mouse and programmatic focus`, () => editor(async page => {
    const opener = page.locator(`[data-action=${action}]`).first();
    const background = page.locator('[data-action=add]').first();
    await opener.click();
    const rect = await background.boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    assert.equal(await page.locator('[data-field=first]').count(), 1, 'background Add cannot change the draft');
    assert.equal(await page.locator('.subdialog').isVisible(), true);
    await background.evaluate(node => node.focus());
    assert.equal(await page.evaluate(() => document.querySelector('.subdialog').contains(document.activeElement)), true,
      'focus remains in the active subdialog');
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      assert.equal(await page.evaluate(() => document.querySelector('.subdialog').contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.subdialog').isHidden(), true);
    assert.equal(await opener.evaluate(node => document.activeElement === node), true, 'Escape returns to the opener');
    assert.equal(await page.locator('#cp-user-bulk').isVisible(), true, 'Escape does not close the parent batch');
    await background.click();
    assert.equal(await page.locator('[data-field=first]').count(), 2, 'the parent works after closing the subdialog');
  }));

  test(`bulk ${action} explicit close restores focus and can reopen`, () => editor(async page => {
    const opener = page.locator(`[data-action=${action}]`).first();
    for (let cycle = 0; cycle < 2; cycle++) {
      await opener.click();
      if (action === 'options') await page.locator('[data-action=inherit]').click();
      await page.locator('.subdialog [data-action=dismiss]').last().click();
      assert.equal(await opener.evaluate(node => document.activeElement === node), true);
      assert.equal(await page.locator('.subdialog').isHidden(), true);
    }
  }));
}

test('successful paste removes the subdialog without leaving the batch inert', () => editor(async page => {
  await page.locator('[data-action=paste]').click();
  await page.getByRole('textbox', { name: 'User rows' }).fill('One\tPasted\tone@example.test\tOperations');
  await page.locator('[data-action=import]').click();
  assert.equal(await page.locator('.subdialog').isHidden(), true);
  await page.locator('[data-action=add]').first().click();
  assert.equal(await page.locator('[data-field=first]').count(), 2);
}));
