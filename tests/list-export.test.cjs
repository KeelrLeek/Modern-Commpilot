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
const LIST = '/commpilot/Group/DnManagement/';

// A CommPilot Numbers search (trimmed): 20 rows a page, a check image for Activated, an Edit column, spacer columns.
function rows(pageNo) {
  return Array.from({ length: 20 }, (_, i) => {
    const n = i + 1, number = `+1-63081${String(pageNo).padStart(3, '0')}${String(n).padStart(2, '0')}`;
    return `<tr id="Row${n}" class="unselected"><td width="20">&nbsp;</td><td><a id="Row${n}Col0" class="tableLink">${number}</a>
      <script>document.addEventListener('DOMContentLoaded', function () { document.getElementById('Row${n}Col0')
        .addEventListener('click', function () { redirectPost('/commpilot/Group/DnManagement/Modify/', { key: '${number}' }); }); });</script></td>
      <td width="0">&nbsp;</td><td>user${pageNo}-${n}@example.net</td><td width="0">&nbsp;</td><td>${n === 3 ? '&nbsp;' : String(100 + n)}</td>
      <td width="0">&nbsp;</td><td>${n % 2 ? '<img src="/commpilot/Graphics/check.gif">' : '&nbsp;'}</td>
      <td width="0">&nbsp;</td><td class="unselected"><a id="edit_${pageNo}_${n}" class="headerLink">Edit</a></td></tr>`;
  }).join('');
}
function page(token, pageNo, total) {
  return `<!doctype html><html data-cp-direction="graphite"><head><title>Stan Mikita Donuts: Numbers</title></head><body id="initBody.menuTemplate">
    <table height="100%"><tbody><tr><td class="headandfoot" width="18%"><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form></td>
    <td width="82%" valign="top"><form name="mainForm" method="post"><input type="hidden" name="formtokenserial" value="${token}">
      <table width="100%"><tbody>
        <tr><td class="screenName">Numbers</td></tr>
        <tr><td class="enduserbody">
          <table width="100%" cellpadding="2"><tbody>
            <tr><td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="20" height="1"></td><td class="listHeader">Phone Numbers</td>
              <td class="listHeader">&nbsp;</td><td class="listHeader">User ID</td><td class="listHeader">&nbsp;</td><td class="listHeader">Extension</td>
              <td class="listHeader">&nbsp;</td><td class="listHeader">Activated</td><td class="listHeader">&nbsp;</td><td class="listHeader">Edit</td></tr>
            ${rows(pageNo)}</tbody></table>
          <table class="enduserbody" width="100%"><tbody><tr><td width="33%"></td><td width="33%">[ Page ${pageNo} of ${total} ]</td><td width="33%"></td></tr></tbody></table>
        </td></tr>
      </tbody></table>
      <script>function doPage(value) { var parmsArray = { returnPage: '/Group/DnManagement/', tableName: 'groupDnTable', value: value };
        redirectPost('/commpilot/Common/page.jsp', parmsArray); }</script>
    </form></td></tr></tbody></table>
    <script>window.redirectPost = window.redirectPost || function () {};</script></body></html>`;
}
// The workbook is stored, not compressed: its sheet's cells are readable as text.
function sheetCells(file) {
  const xml = fs.readFileSync(file).toString('utf8');
  const data = xml.slice(xml.indexOf('<sheetData>'), xml.indexOf('</sheetData>'));
  return [...data.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)].map(([, , cells]) =>
    [...cells.matchAll(/<c r="[A-Z]+\d+" s="\d+"(?:\/>|(?: t="inlineStr")?>(?:<is><t xml:space="preserve">([\s\S]*?)<\/t><\/is>|<v>([\s\S]*?)<\/v>)<\/c>)/g)]
      .map(m => m[1] ?? m[2] ?? ''));
}

async function open(browser, total, pageLog) {
  const tab = await browser.newPage({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  let serial = 0;
  await tab.route('https://apps-sbx.avpaas.io/**', route => {
    const url = new URL(route.request().url());
    const body = new URLSearchParams(route.request().postData() || '');
    if (url.pathname === '/commpilot/Common/page.jsp') {
      pageLog?.push(Number(body.get('value')));
      return route.fulfill({ status: 200, contentType: 'text/html', body: page(`tok-${++serial}`, Number(body.get('value')) + 1, total) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: page('tok-0', 1, total) });
  });
  await tab.goto('https://apps-sbx.avpaas.io' + LIST, { waitUntil: 'domcontentloaded' });
  for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css'])
    await tab.addStyleTag({ path: path.join(root, 'src/content', file) });
  await tab.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  await tab.addScriptTag({ path: path.join(root, 'src/content/lists.js') });
  return tab;
}

test('a search with its pages all here exports every row, in the columns shown, as an Excel workbook', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const tab = await open(browser, 3);
    const button = tab.locator('.cp-pager .cp-pager-end button.cp-export-btn');
    await button.waitFor();
    await tab.waitForFunction(() => document.querySelector('table[data-cp-fill]')?.dataset.cpFill === 'done');
    await tab.waitForFunction(() => !document.querySelector('button.cp-export-btn').disabled);
    const [download] = await Promise.all([tab.waitForEvent('download'), button.click()]);
    assert.match(download.suggestedFilename(), /^Stan Mikita Donuts - Numbers \d{4}-\d{2}-\d{2}\.xlsx$/);
    const cells = sheetCells(await download.path());
    assert.deepEqual(cells[0], ['Phone Numbers', 'User ID', 'Extension', 'Activated'], 'named columns only: no Edit, no spacers');
    assert.equal(cells.length, 1 + 60, 'all three pages');
    assert.deepEqual(cells[1], ['+1-6308100101', 'user1-1@example.net', '101', 'Yes']);
    assert.deepEqual(cells[3], ['+1-6308100103', 'user1-3@example.net', '', 'Yes'], 'an empty cell stays empty');
    assert.deepEqual(cells[2].slice(3), [''], 'no check image, no Yes');
    assert.equal(cells[60][0], '+1-6308100320');
    await tab.waitForFunction(() => /Exported 60/.test(document.querySelector('button.cp-export-btn').textContent));
  } finally { await browser.close(); }
});

test('a search too long to bring in is walked page by page for the export, and CommPilot’s list is left where it was', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const pages = [];
    const tab = await open(browser, 51, pages);   // over the 50 pages the list fill brings in
    const button = tab.locator('.cp-export-row button.cp-export-btn');
    await button.waitFor();
    assert.equal(await tab.locator('.cp-pager').count(), 0, 'CommPilot’s own pager stays');
    const [download] = await Promise.all([tab.waitForEvent('download', { timeout: 60000 }), button.click()]);
    const cells = sheetCells(await download.path());
    assert.equal(cells.length, 1 + 51 * 20, 'every page');
    assert.equal(cells[1][0], '+1-6308100101');
    assert.equal(cells[51 * 20][0], '+1-6308105120');
    assert.deepEqual(pages, [...Array(51).keys(), 0], 'pages 1 to 51 in order, then back to page 1');
  } finally { await browser.close(); }
});
