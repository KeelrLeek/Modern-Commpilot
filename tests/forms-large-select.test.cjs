const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

test('large native selects keep their values and labels through form layout', async t => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const source = fs.readFileSync(path.join(runtime, 'src/content/forms.js'), 'utf8');
    const options = Array.from({ length: 17270 }, (_, i) => `<option value="d${i}" ${i === 123 ? 'selected' : ''}>Department ${i}</option>`).join('');
    const elapsed = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html data-cp-direction="atlas"><body id="initBody.menuTemplate">
        <table><tr><td width="82%"><form name="mainForm"><table><tr><td class="screenName">Large group</td></tr>
        <tr><td class="enduserbody"><fieldset><legend>Settings</legend><table>
        <tr><td>Department:</td><td><select name="department">${options}</select>
        <span style="display: none">Hidden helper</span><button type="button">Native helper</button></td></tr>
        <tr><td>Note:</td><td><input name="note" value="Draft"><span> Visible <b>hint</b></span>
        <script type="application/json">{"ignored":"script text"}</script></td></tr></table></fieldset>
        </td></tr></table></form></td></tr></table></body></html>`);
      elapsed.push(await page.evaluate(source => { const start = performance.now(); (0, eval)(source); return performance.now() - start; }, source));
      assert.equal(await page.locator('.fx select[name=department] option').count(), 17270);
      assert.equal(await page.locator('.fx select[name=department]').inputValue(), 'd123');
      assert.deepEqual(await page.locator('.fx .fx-item > .fx-label').allTextContents(), ['Department', 'Note']);
      assert.equal(await page.locator('[name=note]').inputValue(), 'Draft');
      await page.locator('[name=department]').selectOption('d17269');
      assert.deepEqual(await page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm))),
        { department: 'd17269', note: 'Draft' });
      await page.close();
    }
    t.diagnostic('17,270-option form layout milliseconds: ' + elapsed.map(ms => ms.toFixed(1)).join(', '));
  } finally { await browser.close(); }
});
