const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

for (const mode of ['fieldset', 'dynamic', 'option', 'optgroup'])
test(`schedule editor respects native ${mode} state`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const weekly = `<option value="Weekly" ${mode === 'option' ? 'disabled' : ''}>Weekly</option>`;
    const html = `<html data-cp-direction="atlas"><body id="initBody.menuTemplate"><table><tr><td width="82%">
      <form name="mainForm"><input type="hidden" name="use24HourNotation" value="true">
      <table><tr><td class="enduserbody"><table class="enduserbody"><tr><td>Event:</td>
      <td><input name="eventName" value="Fixture"></td></tr></table><table class="enduserbody"><tr><td>
      <fieldset id="eventPolicy" ${mode === 'fieldset' ? 'disabled' : ''}><legend>Event details</legend><table>
      <tr><td>Start:</td><td><input name="startDate" value="10/21/2026"><input name="startTime" value="8:00"></td></tr>
      <tr><td>End:</td><td><input name="endDate" value="10/21/2026"><input name="endTime" value="17:00"></td></tr>
      <tr><td>All day:</td><td><input name="allDayEvent" type="checkbox"></td></tr>
      <tr><td>Repeats:</td><td><select name="recurType"><option value="Daily" selected>Daily</option>
      ${mode === 'optgroup' ? '<optgroup label="Locked" disabled>' + weekly + '</optgroup>' : weekly}</select></td></tr>
      <tr id="rowDaily"><td>Every:</td><td><input name="recurDailyInterval" value="1"></td></tr>
      <tr id="rowWeekly"><td>Every:</td><td><input name="recurWeeklyInterval" value="1">
      <input type="checkbox" name="recurWeeklyMonday" checked></td></tr></table></fieldset>
      </td></tr></table></td></tr></table></form></td></tr></table></body></html>`;
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Schedules/Events/Modify/');
    const initial = await page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm)));
    await page.addStyleTag({ path: path.join(runtime, 'src/content/forms.css') });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/forms.js') });
    await page.locator('.cp-ev').waitFor();
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm))), initial,
      'rendering the schedule preserves native submission eligibility');
    if (mode === 'fieldset' || mode === 'dynamic') {
      for (const disabled of mode === 'fieldset' ? [true, false] : [true, false, true]) {
        await page.evaluate(disabled => { document.querySelector('#eventPolicy').disabled = disabled; }, disabled);
        await page.waitForFunction(disabled => document.querySelector('[aria-label="Start date"]').matches(':disabled') === disabled,
          disabled, { timeout: 1500 });
        for (const label of ['Start date', 'End date', 'Start time', 'End time', 'All day'])
          assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), disabled, label);
        assert.equal(await page.getByRole('radio', { name: 'Daily', exact: true }).isDisabled(), disabled);
        assert.equal(await page.locator('[name=recurDailyInterval]').isDisabled(), disabled);
        assert.equal(await page.getByLabel('Daily interval', { exact: true }).isDisabled(), disabled);
        const data = await page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm)));
        assert.equal(Object.hasOwn(data, 'recurDailyInterval'), !disabled);
        if (!disabled) {
          await page.getByLabel('Daily interval', { exact: true }).fill('3');
          await page.getByLabel('Daily interval', { exact: true }).dispatchEvent('change');
          assert.equal(await page.locator('[name=recurDailyInterval]').inputValue(), '3');
          assert.match(await page.locator('.cp-ev-sum').innerText(), /Every 3 days/);
        }
      }
    } else {
      const button = page.getByRole('radio', { name: 'Weekly', exact: true });
      assert.equal(await button.isDisabled(), true);
      await button.evaluate(button => button.click());
      assert.equal(await page.locator('[name=recurType]').inputValue(), 'Daily');
      await page.evaluate(mode => {
        const target = mode === 'option' ? document.querySelector('[value=Weekly]') : document.querySelector('optgroup');
        target.disabled = false;
      }, mode);
      await page.waitForFunction(() => ![...document.querySelectorAll('.cp-seg-opt')].find(b => b.textContent === 'Weekly').disabled);
      await button.click();
      assert.equal(await page.locator('[name=recurType]').inputValue(), 'Weekly');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
