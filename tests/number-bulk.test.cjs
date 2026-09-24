const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const edge = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const pjax = path.resolve(__dirname, '../src/content/pjax.js');
const bulk = path.resolve(__dirname, '../src/content/number-bulk.js');

test('bulk number preview expands ranges, marks missing numbers, and blocks Apply', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const html = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="ok" value="OK" type="button"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.evaluate(({ list, edit }) => {
      window.cpListSearch = async () => ({ tooMany: false, rows: [{
        cells: ['+1-2244830007', '', '', '', '', 'None'],
        drill: { url: edit, params: { key: '+1-2244830007', P_key: '+1-2244830007' } }
      }] });
      window.redirectPost = url => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        document.querySelector('td[width="82%"]').innerHTML = url === edit ?
          '<form name="mainForm"><select name="deptDropDownList"><option value="0">None</option><option value="basement">Basement</option></select></form>' :
          '<form name="mainForm"><input name="ok" value="OK" type="button"></form>';
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { list, edit });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['+1-2244830007', 'Basement', '+1-2244830009']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'ranges.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Fix 2 numbers'));
    const preview = await page.locator('.cp-bulk-preview').innerText();
    assert.match(preview, /1 to change · 0 already correct · 2 errors/);
    assert.match(preview, /2244830008[\s\S]*Number was not found/);
    assert.match(preview, /2244830009[\s\S]*Number was not found/);
    assert.match(await page.locator('.cp-bulk-progress').innerText(), /3 \/ 3 \(100%\)/);
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    const large = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['+1-2244830007', 'Basement', '+1-2244830107']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'larger-range.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(large) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Fix 100 numbers'));
    assert.match(await page.locator('.cp-bulk-pages').innerText(), /page 1 of 2/);
    await page.locator('.cp-bulk-pages button:text-is("Next")').click();
    assert.match(await page.locator('.cp-bulk-pages').innerText(), /page 2 of 2/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /2244830007[\s\S]*Ready/);
  } finally { await browser.close(); }
});
