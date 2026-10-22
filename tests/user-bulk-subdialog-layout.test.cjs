const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture } = require('./fixtures/bulk-group-harness.cjs');

async function editor(theme, viewport, check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(7000);
    const state = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(theme => { document.documentElement.dataset.cpDirection = theme; }, theme);
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=prefix]').fill('AZ');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=numberMode]').selectOption('none');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-setting=primary]').selectOption('false');
    for (const checkbox of await page.locator('[data-sca]').all()) await checkbox.uncheck();
    await page.locator('[data-action=primary]').click();
    await check(page);
    assert.equal(state.writes.length, 0);
    assert.equal(state.badTokens, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

for (const theme of ['snes-dark', 'atlas']) for (const viewport of [
  { width: 1500, height: 1000 }, { width: 840, height: 650 }
]) test(`bulk subdialog retains palette and stays within ${theme} ${viewport.width}px viewport`, () =>
  editor(theme, viewport, async page => {
    for (const action of ['options', 'paste']) {
      await page.locator(`[data-action=${action}]`).first().click();
      const layout = await page.locator('.subdialog').evaluate(dialog => {
        const rect = dialog.getBoundingClientRect(), style = getComputedStyle(dialog);
        const parent = getComputedStyle(document.querySelector('#cp-user-bulk'));
        const probe = document.createElement('div');
        probe.style.background = 'var(--d-surface)'; dialog.appendChild(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor; probe.remove();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
          background: style.backgroundColor, expectedBackground, color: style.color, parentColor: parent.color,
          font: style.fontFamily, parentFont: parent.fontFamily, overflow: dialog.scrollWidth - dialog.clientWidth,
          label: document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent };
      });
      assert.ok(layout.x >= 0 && layout.y >= 0 && layout.right <= viewport.width && layout.bottom <= viewport.height,
        JSON.stringify(layout));
      assert.ok(layout.overflow <= 1, 'subdialog content fits without horizontal scrolling');
      assert.equal(layout.background, layout.expectedBackground);
      assert.equal(layout.color, layout.parentColor);
      assert.equal(layout.font, layout.parentFont);
      assert.ok(layout.label?.trim());
      if (process.env.BW_AUDIT_SCREENSHOT_DIR && viewport.width === 1500)
        await page.screenshot({ path: `${process.env.BW_AUDIT_SCREENSHOT_DIR}/bulk-${action}-${theme}.png` });
      await page.keyboard.press('Escape');
    }
  }));

test('review Details closes without creating users or losing the review action', () =>
  editor('snes-dark', { width: 1500, height: 1000 }, async page => {
    await page.locator('[data-field=first]').fill('Review');
    await page.locator('[data-field=last]').fill('Fixture');
    await page.locator('[data-field=email]').fill('review@example.test');
    await page.locator('[data-field=dept]').selectOption({ label: 'Operations' });
    await page.locator('[data-field=extension]').fill('1234');
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-password="Operations"]').fill('Sip-Test-A1');
    await page.locator('[data-action=primary]').click();
    const details = page.locator('[data-action=details]').first();
    await details.waitFor();
    await details.click();
    assert.match(await page.locator('.subdialog').innerText(), /AZ.*@phonenetwork\.net/);
    const create = page.locator('[data-action=primary]'), rect = await create.boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    assert.equal(await page.locator('.subdialog').isVisible(), true, 'Create behind Details does not run');
    await page.keyboard.press('Escape');
    assert.equal(await details.evaluate(node => document.activeElement === node), true);
    assert.equal(await create.isEnabled(), true);
    assert.match(await create.innerText(), /Create 1 users/);
  }));
