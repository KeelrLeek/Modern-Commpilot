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

// A CommPilot result list as the server renders it (trimmed): a header row, then rows whose links each carry a
// wiring script that opens the row's own page, and an Edit link in the last column.
function row(n, name, target = name) {
  const link = (id, text) => `<a id="${id}" class="${text === 'Edit' ? 'headerLink' : 'tableLink'}">${text}</a>
    <script>document.getElementById('${id}').addEventListener('click', function () {
      redirectPost('/commpilot/Reseller/Groups/Modify/index.jsp', { key: '${text === 'Edit' ? target : name}' }); });</script>`;
  return `<tr id="Row${n}" class="unselected"><td width="20">&nbsp;</td><td>${link(`Row${n}Col0`, name)}</td>
    <td width="0">&nbsp;</td><td>${link(`Row${n}Col1`, String((n * 7) % 13))}</td><td width="0">&nbsp;</td>
    <td class="unselected">${link(`link_${n}`, 'Edit')}</td></tr>`;
}
function listPage(rows, { pager = 'Page 1 of 1', fill = '' } = {}) {
  return `<!doctype html><html data-cp-direction="graphite"><head><title>Groups</title></head>
    <body id="initBody.menuTemplate"><table height="100%"><tbody><tr><td width="82%" valign="top">
    <form name="mainForm"><table width="100%"><tbody>
      <tr><td class="screenName">Groups</td></tr>
      <tr id="buttonbartop"><td class="buttonbar"><input type="button" name="ok" value="OK"></td></tr>
      <tr><td class="enduserbody">
        <table width="100%" cellpadding="2" ${fill ? `data-cp-fill="${fill}"` : ''}><tbody>
          <tr><td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="20" height="1"></td>
            <td class="listHeader"><a class="listSortHeader" id="sortId">Group ID<img src="/commpilot/Graphics/uparrow.gif"></a></td>
            <td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="0" height="1"></td>
            <td class="listHeader"><a class="listSortHeader" id="sortLimit">User Limit</a></td>
            <td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="0" height="1"></td>
            <td class="listHeader">Edit</td></tr>
          ${rows}
        </tbody></table>
        <table class="enduserbody" width="100%"><tbody><tr><td width="33%"></td><td width="33%">[ ${pager} ]</td><td width="33%"></td></tr></tbody></table>
      </td></tr>
    </tbody></table></form>
    </td></tr></tbody></table>
    <script>window.opened = []; window.redirectPost = (url, params) => window.opened.push(params.key);
      window.serverSorts = 0;   // CommPilot's doSort(): a second search
      for (const id of ['sortId', 'sortLimit']) document.getElementById(id).addEventListener('click', () => window.serverSorts++);</script>
    </body></html>`;
}
const names = n => Array.from({ length: n }, (_, i) => row(i + 1, `Group ${String(i + 1).padStart(2, '0')}`)).join('');

async function open(browser, html, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/', { waitUntil: 'domcontentloaded' });
  for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
    await page.addStyleTag({ path: path.join(root, 'src/content', file) });
  await page.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
  await page.addScriptTag({ path: path.join(root, 'src/content/lists.js') });
  await page.locator('tr.cp-row-link').first().waitFor({ state: 'attached' });
  return page;
}
const shown = page => page.evaluate(() => [...document.querySelectorAll('tr[id^="Row"]')]
  .filter(tr => getComputedStyle(tr).display !== 'none').map(tr => tr.id));

test('a whole result row opens its page, by click or keyboard, and Edit goes where it repeats the row', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, listPage(names(3)));
    await page.locator('#Row2 > td').nth(3).click({ position: { x: 60, y: 5 } });   // the cell, beside its text
    assert.deepEqual(await page.evaluate(() => window.opened), ['Group 02'], 'the row opened through its own link');
    await page.locator('#Row3').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.opened), ['Group 02', 'Group 03']);
    const edit = await page.evaluate(() => [...document.querySelectorAll('table.cp-frame-results > tbody > tr')].map(tr => getComputedStyle(tr.lastElementChild).display));
    assert.ok(edit.every(d => d === 'none'), 'the Edit column is hidden on every row');
    // CommPilot's own hover script swaps the link class to tableLinkHover while the pointer is on it.
    await page.hover('#Row1Col0');
    await page.evaluate(() => { document.querySelector('#Row1Col0').className = 'tableLinkHover'; });
    await page.waitForTimeout(400);   // the theme's colour transition from the link colour
    const hover = await page.evaluate(() => {
      const link = document.querySelector('#Row1Col0');
      return [getComputedStyle(link).color, getComputedStyle(link.closest('td')).color, getComputedStyle(document.getElementById('Row1')).cursor];
    });
    assert.equal(hover[0], hover[1], 'row text keeps the row colour');
    assert.equal(hover[2], 'pointer');
    await page.close();

    // One row whose Edit opens a different page than its name: Edit stays, and that row is not a whole-row link.
    const mixed = await open(browser, listPage(row(1, 'Group 01') + row(2, 'Group 02', 'Somewhere else')));
    assert.equal(await mixed.evaluate(() => getComputedStyle(document.querySelector('#Row1 > td:last-child')).display), 'table-cell');
    assert.deepEqual(await mixed.evaluate(() => [...document.querySelectorAll('tr.cp-row-link')].map(tr => tr.id)), ['Row1']);
  } finally { await browser.close(); }
});

test('a list shows as many rows as fit the window, pages the rest, and refits on resize', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, listPage(names(60), { pager: 'Page 1 of 3', fill: 'done' }));
    await page.locator('.cp-pager').waitFor();
    await page.waitForTimeout(300);
    const first = await shown(page);
    const scroll = await page.evaluate(() => { const c = document.querySelector('td[width="82%"]'); return c.scrollHeight - c.clientHeight; });
    assert.ok(first.length >= 8 && first.length < 60, `a window's worth of rows (${first.length})`);
    assert.equal(first[0], 'Row1');
    assert.ok(scroll <= 0, `the page does not scroll (${scroll}px)`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('table.cp-pager-native')).display), 'none',
      'CommPilot’s 20-row pager is replaced');
    assert.match(await page.locator('.cp-pager').innerText(), new RegExp(`1–${first.length} of 60`));
    // The page reaches the bottom of the window: the pager sits right under the last row, and what is left under
    // the list is the page's own margin, not a row's worth of empty space.
    const fit = await page.evaluate(() => {
      const cell = document.querySelector('td[width="82%"]');
      const rows = [...document.querySelectorAll('tr[id^="Row"]')].filter(tr => getComputedStyle(tr).display !== 'none');
      const last = rows.at(-1).getBoundingClientRect(), pager = document.querySelector('.cp-pager').getBoundingClientRect();
      const form = cell.querySelector('form').getBoundingClientRect();
      return { gap: pager.top - last.bottom, left: cell.getBoundingClientRect().bottom - parseFloat(getComputedStyle(cell).paddingBottom) - form.bottom,
        row: last.height };
    });
    assert.ok(Math.abs(fit.gap) <= 1, `no gap between the last row and the pager (${fit.gap}px)`);
    assert.ok(fit.left >= 0 && fit.left < 2, `no space left under the list (${fit.left}px)`);
    await page.getByRole('button', { name: 'Next page' }).click();
    assert.equal((await shown(page))[0], `Row${first.length + 1}`);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.waitForFunction(n => [...document.querySelectorAll('tr[id^="Row"]')]
      .filter(tr => getComputedStyle(tr).display !== 'none').length > n, first.length);
    const taller = await shown(page);
    assert.ok(taller.length > first.length, `a taller window shows more rows (${taller.length})`);
    assert.ok(taller.includes(`Row${first.length + 1}`), 'and keeps the row you were on in view');
  } finally { await browser.close(); }
});

test('a list whose other pages are not all here keeps CommPilot’s own pager', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const fill of ['', 'failed']) {
      const page = await open(browser, listPage(names(20), { pager: 'Page 1 of 3', fill }));
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.cp-pager').count(), 0, `no lists.js pager (fill “${fill}”)`);
      assert.equal((await shown(page)).length, 20);
      assert.match(await page.locator('td.cp-frame-body').innerText(), /\[ Page 1 of 3 \]/);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('with the whole list here, a column header sorts it in place (no second search), and the pager has first and last', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, listPage(names(60), { pager: 'Page 1 of 3', fill: 'done' }));
    await page.locator('.cp-pager').waitFor();
    await page.waitForTimeout(300);
    const firstName = () => page.evaluate(() => document.querySelector('tr[id^="Row"]:not(.cp-row-off) a.tableLink').textContent);
    const limits = () => page.evaluate(() => [...document.querySelectorAll('tr[id^="Row"]')].map(tr => Number(tr.querySelectorAll('a.tableLink')[1].textContent)));

    await page.locator('#sortId').click();   // already CommPilot's ascending sort: now descending
    assert.equal(await page.evaluate(() => window.serverSorts), 0, 'no second search');
    assert.equal(await firstName(), 'Group 60');
    assert.equal(await page.evaluate(() => document.querySelector('#sortId').closest('td').getAttribute('aria-sort')), 'descending');

    await page.getByRole('button', { name: 'Next page' }).click();
    await page.locator('#sortLimit').click();
    const sorted = await limits();
    assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b), 'rows ordered by the number in that column');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('tr[id^="Row"]')].findIndex(tr => !tr.classList.contains('cp-row-off'))), 0,
      'back on the first page');
    assert.equal(await page.evaluate(() => window.serverSorts), 0);

    const pageLabel = () => page.locator('.cp-pager-page').innerText();
    await page.getByRole('button', { name: 'Last page' }).click();
    const total = (await pageLabel()).match(/of (\d+)/)[1];
    assert.equal(await pageLabel(), `Page ${total} of ${total}`);
    assert.equal(await page.getByRole('button', { name: 'Last page' }).isDisabled(), true);
    await page.getByRole('button', { name: 'First page' }).click();
    assert.equal(await pageLabel(), `Page 1 of ${total}`);
    assert.equal(await page.getByRole('button', { name: 'First page' }).isDisabled(), true);
    const centered = await page.evaluate(() => {
      const bar = document.querySelector('.cp-pager').getBoundingClientRect(), nav = document.querySelector('.cp-pager-nav').getBoundingClientRect();
      return Math.abs((nav.left + nav.right) / 2 - (bar.left + bar.right) / 2);
    });
    assert.ok(centered < 2, `the page selector sits in the middle (${centered}px off)`);

    // Back from a row reloads the list in CommPilot's order: the sort chosen here comes back with it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
    await page.addScriptTag({ path: path.join(root, 'src/content/lists.js') });
    await page.locator('.cp-pager').waitFor();
    const again = await limits();
    assert.deepEqual(again, [...again].sort((a, b) => a - b), 'the list comes back in the order chosen');
    assert.equal(await page.evaluate(() => document.querySelector('#sortLimit').closest('td').getAttribute('aria-sort')), 'ascending');
  } finally { await browser.close(); }
});

test('a list CommPilot still pages itself keeps CommPilot’s own sort', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, listPage(names(20), { pager: 'Page 1 of 3', fill: 'failed' }));
    await page.waitForTimeout(300);
    await page.locator('#sortLimit').click();
    assert.equal(await page.evaluate(() => window.serverSorts), 1, 'CommPilot sorts (its list is not all here)');
  } finally { await browser.close(); }
});
