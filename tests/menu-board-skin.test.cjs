const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);

function column(width, title) {
  return `<td width="${width}" valign="TOP"><table width="100%"><tbody>
    <tr><td class="menuCategory">Basic</td></tr>
    <tr><td height="5"></td></tr>
    <tr><td align="left"><a class="navMenuItem">${title}</a></td></tr>
    <tr><td align="left">Configure ${title}.</td></tr>
  </tbody></table></td>`;
}

test('Basic-only board folders use the same skinned column as two-column folders', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(`<html data-cp-direction="nord"><body id="initBody.menuTemplate">
      <div class="cp-console" style="width:1000px">
        <section class="cp-console-section"><div class="cp-console-body" id="paired">
          <table width="100%"><tbody><tr>${column('50%', 'Resources')}${column('50%', 'Advanced')}</tr></tbody></table>
        </div></section>
        <section class="cp-console-section"><div class="cp-console-body" id="basic-only">
          <table width="100%"><tbody><tr>${column('100%', 'Services')}</tr></tbody></table>
        </div></section>
      </div></body></html>`);
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css']) {
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    }
    for (const palette of ['nord', 'atlas', 'graphite', 'terra']) {
      await page.evaluate(value => { document.documentElement.dataset.cpDirection = value; }, palette);
      const result = await page.evaluate(() => {
        const read = id => {
          const table = document.querySelector(`#${id} td[valign="TOP"] > table`);
          const linkCell = table.querySelector('tr:has(a.navMenuItem) td');
          return {
            width: table.getBoundingClientRect().width,
            border: getComputedStyle(table).borderTopWidth,
            surface: getComputedStyle(table).backgroundColor,
            arrow: getComputedStyle(linkCell, '::after').content
          };
        };
        return { paired: read('paired'), basic: read('basic-only') };
      });
      assert.ok(Math.abs(result.paired.width - result.basic.width) < 2, `${palette}: ${JSON.stringify(result)}`);
      assert.equal(result.basic.border, result.paired.border, palette);
      assert.equal(result.basic.surface, result.paired.surface, palette);
      assert.deepEqual([result.basic.arrow, result.paired.arrow], ['none', 'none'], `${palette}: option cards have no arrow`);
      assert.notEqual(result.basic.border, '0px', palette);
    }
  } finally {
    await browser.close();
  }
});
