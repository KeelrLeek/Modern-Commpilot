const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

for (const mode of ['outer-disabled', 'nested-disabled', 'dynamic', 'own-disabled', 'legend-control', 'visibility', 'hidden-only', 'facts-hidden'])
test(`form layout preserves native fieldset semantics: ${mode}`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), errors = [], posts = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    const html = `<html data-cp-direction="atlas"><body id="initBody.menuTemplate">
      <table><tr><td width="82%" valign="top"><form name="mainForm"><table><tr><td class="screenName">Policy</td></tr>
      <tr><td class="enduserbody">${mode === 'hidden-only' || mode === 'facts-hidden' ?
        `<fieldset id="metadata"><legend>Metadata</legend><input type="hidden" name="nativeMetadata" value="preserve-me">
        ${mode === 'facts-hidden' ? '<table><tr><td>Identifier:</td><td>Fixture ID</td></tr></table>' : ''}</fieldset>` : ''}
      <fieldset id="nativeOuter" ${mode === 'outer-disabled' || mode === 'legend-control' ? 'disabled' : ''}>
      <legend>Policy ${mode === 'legend-control' ? '<input name="legendControl" value="legend-value" aria-label="Legend control">' : ''}</legend>
      <table id="outerTable"><tr id="descriptionRow"><td>Description:</td><td id="descriptionCell"><input id="description" name="description" value="draft"></td></tr>
      <tr><td>Independent:</td><td><input id="independent" name="independent" value="locked" disabled></td></tr></table>
      <fieldset id="nativeInner" ${mode === 'nested-disabled' ? 'disabled' : ''}><legend>Nested</legend>
      <table><tr><td>Nested field:</td><td><input id="nested" name="nested" value="nested-value"></td></tr></table>
      </fieldset><table><tr><td>After nested:</td><td><input name="afterNested" value="after"></td></tr></table>
      <input type="hidden" name="hiddenValue" value="hidden"></fieldset></td></tr></table></form></td></tr></table></body></html>`;
    await page.route('**/*', route => {
      if (route.request().method() === 'POST') posts.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Profile/');
    const formData = () => page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm)));
    const before = await formData();
    await page.evaluate(() => { window.originalFieldsets = [...document.querySelectorAll('fieldset')]; });
    await page.addStyleTag({ path: path.join(runtime, 'src/content/forms.css') });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/forms.js') });
    if (mode === 'legend-control')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    else await page.waitForFunction(() => document.querySelector('.fx'));
    assert.deepEqual(await formData(), before, 'layout cannot change which native fields are submitted');
    assert.equal(await page.evaluate(() => originalFieldsets.every(fs => fs === document.getElementById(fs.id))), true,
      'native scripts retain their actual fieldsets');
    assert.equal(await page.locator('#independent').isDisabled(), true, 'an individually disabled field stays disabled');
    if (mode === 'hidden-only' || mode === 'facts-hidden') {
      assert.equal(await page.locator('#metadata').count(), 1);
      assert.equal(await page.locator('#metadata').isVisible(), false, 'metadata-only fieldsets stay visually empty');
      assert.equal(await page.getByRole('button', { name: 'Metadata', exact: true }).count(), 0);
    }
    if (mode === 'dynamic') {
      for (const disabled of [true, false, true, false]) {
        const immediate = await page.evaluate(disabled => {
          document.querySelector('#nativeOuter').disabled = disabled;
          return Object.fromEntries(new FormData(document.forms.mainForm));
        }, disabled);
        assert.deepEqual(immediate, disabled ? {} : before, 'native disable and submit in the same task stays correct');
        await page.waitForFunction(disabled => document.querySelector('#description').matches(':disabled') === disabled, disabled,
          { timeout: 1500 });
        assert.equal(await page.locator('#nested').isDisabled(), disabled, 'nested controls inherit the outer state');
        assert.deepEqual(await formData(), disabled ? {} : before);
        assert.equal(await page.locator('#independent').isDisabled(), true);
      }
      await page.evaluate(() => {
        document.querySelector('#descriptionCell').innerHTML = '<input id="description" name="description" value="replacement">';
        document.querySelector('#outerTable tbody').insertAdjacentHTML('beforeend',
          '<tr><td>Added:</td><td><input name="added" value="added-value"></td></tr>');
      });
      await page.waitForFunction(() => document.querySelectorAll('[name=description]').length === 1 &&
        document.querySelector('[name=added]')?.getBoundingClientRect().height > 0);
      assert.equal(await page.locator('#description').inputValue(), 'replacement');
      const changed = { ...before, description: 'replacement', added: 'added-value' };
      assert.deepEqual(await formData(), changed, 'native replacement and newly inserted rows stay usable');
      assert.deepEqual(await page.evaluate(() => {
        document.querySelector('#nativeOuter').disabled = true;
        return Object.fromEntries(new FormData(document.forms.mainForm));
      }), {}, 'new native controls still inherit the disabled fieldset');
    }
    if (mode === 'legend-control') {
      assert.equal(await page.locator('[name=legendControl]').isVisible(), true, 'controls in the first legend remain usable');
      assert.equal(await page.locator('[name=legendControl]').isEnabled(), true, 'the native first-legend exception is preserved');
      await page.locator('[name=legendControl]').fill('updated');
      assert.deepEqual(await formData(), { legendControl: 'updated' });
    }
    if (mode === 'visibility') {
      for (const hidden of [true, false, true, false]) {
        await page.evaluate(hidden => { document.querySelector('#descriptionRow').style.display = hidden ? 'none' : ''; }, hidden);
        await page.waitForFunction(hidden => document.querySelector('#description').getBoundingClientRect().height === 0 ? hidden : !hidden,
          hidden, { timeout: 1500 });
        assert.equal(await page.locator('#description').isVisible(), !hidden);
        assert.deepEqual(await formData(), before, 'visibility changes do not change native submission eligibility');
      }
    }
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
