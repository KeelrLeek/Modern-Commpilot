const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

for (const [palette, width] of [['atlas', 1600], ['rosepine-dark', 860]])
test(`native fieldsets retain shared form styling at ${width}px in ${palette}`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html data-cp-direction="${palette}"><body id="initBody.menuTemplate"><table width="100%"><tr><td width="82%" valign="top">
      <form name="mainForm"><table width="100%"><tr><td class="screenName">Group settings</td></tr>
      <tr><td class="enduserbody"><fieldset id="limits"><legend>User limits</legend>
      <table><tr><td>Group name:</td><td><input name="groupName" value="Fixture group"></td></tr></table>
      <fieldset id="advanced"><legend>Advanced</legend><table><tr><td>Limit:</td><td><input name="limit" value="25"></td></tr></table></fieldset>
      <table><tr><td>Description:</td><td><input name="description" value="After nested settings"></td></tr></table>
      <table id="rawList"><tr><td class="listHeader">Name</td><td class="listHeader">Status</td></tr>
      <tr id="Row1"><td>Example</td><td>Enabled</td></tr></table>
      </fieldset></td></tr></table></form></td></tr></table></body></html>` }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Profile/');
    for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
      await page.addStyleTag({ path: path.join(runtime, 'src/content', file) });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/forms.js') });
    await page.locator('.fx').waitFor();
    assert.equal(await page.locator('#rawList').isVisible(), true, 'native list content inside a section remains visible');
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      sections: [...document.querySelectorAll('fieldset.fx-sec')].map(fs => {
        const style = getComputedStyle(fs), rect = fs.getBoundingClientRect();
        return { border: style.borderTopWidth, background: style.backgroundColor, right: rect.right, left: rect.left };
      }),
      fields: [...document.querySelectorAll('.fx input')].map(input => {
        const style = getComputedStyle(input), rect = input.getBoundingClientRect();
        return { font: style.fontFamily, size: style.fontSize, top: rect.top, bottom: rect.bottom, right: rect.right };
      })
    }));
    assert.equal(metrics.overflow, false);
    assert.equal(metrics.sections.length, 2);
    for (const section of metrics.sections) {
      assert.equal(section.border, '0px', 'native fieldsets do not add a second section border');
      assert.equal(section.background, 'rgba(0, 0, 0, 0)');
      assert.ok(section.right <= width && section.left >= 0);
    }
    assert.equal(metrics.fields.length, 3);
    assert.equal(new Set(metrics.fields.map(field => field.font + '|' + field.size)).size, 1);
    assert.ok(metrics.fields[1].top >= metrics.fields[0].bottom);
    assert.ok(metrics.fields[2].top >= metrics.fields[1].bottom, 'fields after nested sections retain their reading order');
    assert.ok(metrics.fields.every(field => field.right <= width));
    if (process.env.BW_AUDIT_SCREENSHOT_DIR)
      await page.screenshot({ path: path.join(process.env.BW_AUDIT_SCREENSHOT_DIR, `fieldset-${palette}-${width}.png`), fullPage: true });
  } finally { await browser.close(); }
});
