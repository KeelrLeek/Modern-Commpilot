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
const MODIFY = '/commpilot/Reseller/Groups/Modify/index.jsp';

// Rows as CommPilot renders them: each link wires its row's redirectPost; keys carry CommPilot's \u escapes.
function rows(pageNo) {
  return [1, 2].map(i => {
    const name = `Group ${pageNo}-${i}`;
    return `<tr id="Row${i}" class="unselected"><td width="20">&nbsp;</td><td>
      <a id="Row${i}Col0" class="tableLink">${name}</a>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('Row${i}Col0').addEventListener('click', function () {
          redirectPost('${MODIFY}', { name: 'Reseller', key: 'SP\\u003E\\u0025${name}', P_key: 'SP\\u003E\\u0025${name}', } ); }); });</script>
      </td></tr>`;
  }).join('');
}
function listPage(pageNo, total, token) {
  return `<!doctype html><html><head><title>Groups</title></head><body id="initBody.menuTemplate">
    <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
    <table><tr><td width="82%" valign="top"><form name="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="${token}">
      <table width="100%"><tbody><tr><td class="screenName">Groups</td></tr><tr><td class="enduserbody">
        <table id="searchTable"><tbody><tr id="tr0"><td><input name="findKey0" value="GroupId">
          <input name="findOp0" value="STARTS_WITH"><input name="findValue0" value=""></td></tr></tbody></table>
        <table width="100%"><tbody><tr><td class="listHeader"></td><td class="listHeader">Group ID</td></tr>${rows(pageNo)}</tbody></table>
        <table class="enduserbody"><tbody><tr><td></td><td>[ Page ${pageNo} of ${total} ]</td><td></td></tr></tbody></table>
      </td></tr></tbody></table>
      <script>function doPage(value) { var parmsArray = { returnPage: '/Reseller/Groups/', tableName: 'resellerGroupTable', value: value };
        redirectPost('/commpilot/Common/page.jsp', parmsArray); }</script>
    </form></td></tr></table>
    <script>window.redirectPost = window.redirectPost || function () {};</script></body></html>`;
}

async function fixture({ total = 3, empty = 0, slow = 0 } = {}) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const posts = [];
  let serial = 0;
  await page.route('https://apps-sbx.avpaas.io/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const body = new URLSearchParams(req.postData() || '');
    if (req.method() === 'POST') posts.push({ path: url.pathname, value: body.get('value'), key: body.get('key'), token: body.get('formtokenserial') });
    if (url.pathname === '/commpilot/Common/page.jsp') {
      const value = Number(body.get('value'));
      if (slow && value === 1) await new Promise(r => setTimeout(r, slow));
      const html = listPage(value + 1, total, `tok-${++serial}`);
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: value + 1 === empty ? html.replace(/<tr id="Row[\s\S]*?<\/tr>/g, '') : html });
    }
    if (req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'text/html',
        body: listPage(1, 1, `tok-${++serial}`).replace('Groups</td>', 'Opened</td>') });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: listPage(1, total, 'tok-0') });
  });
  await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  return { browser, page, posts };
}
const fillState = page => page.evaluate(() => document.querySelector('table:has(> tbody > tr[id^="Row"])')?.dataset.cpFill);

test('a paged list fetches its other pages in order, threading the token, and each added row opens its own page', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const { browser, page, posts } = await fixture();
  try {
    await page.waitForFunction(() => document.querySelector('table[data-cp-fill]')?.dataset.cpFill === 'done', null, { timeout: 15000 });
    const walk = posts.filter(p => p.path === '/commpilot/Common/page.jsp');
    assert.deepEqual(walk.map(p => [p.value, p.token]), [['1', 'tok-0'], ['2', 'tok-1'], ['0', 'tok-2']],
      'pages 2 and 3, then page 1 again, each with the token the previous response issued');
    assert.equal(await page.evaluate(() => document.getElementsByName('formtokenserial')[0].value), 'tok-3');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('tr[id^="Row"]')].map(tr => tr.id + ':' + tr.querySelector('a').textContent.trim())),
      ['Row1:Group 1-1', 'Row2:Group 1-2', 'Row3:Group 2-1', 'Row4:Group 2-2', 'Row5:Group 3-1', 'Row6:Group 3-2']);
    assert.equal(await page.locator('#Row5Col0').count(), 1, 'link ids follow the new row ids');
    await page.locator('#Row5Col0').click();
    await page.waitForFunction(() => /Opened/.test(document.querySelector('td.screenName')?.textContent || ''), null, { timeout: 15000 });
    const opened = posts.find(p => p.path === MODIFY);
    assert.equal(opened.key, 'SP>%Group 3-1', 'the added row posts its own decoded key');
    assert.equal(opened.token, 'tok-3', 'with the latest token');
  } finally { await browser.close(); }
});

test('a fetched page without rows puts the list back as CommPilot showed it', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const { browser, page } = await fixture({ total: 3, empty: 3 });
  try {
    await page.waitForFunction(() => document.querySelector('table[data-cp-fill]')?.dataset.cpFill === 'failed', null, { timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('tr[id^="Row"]')].map(tr => tr.id)), ['Row1', 'Row2']);
    assert.match(await page.locator('td.enduserbody').first().innerText(), /\[ Page 1 of 3 \]/);
  } finally { await browser.close(); }
});

test('navigating while the list fills stops it and waits for its request, so the token is never spent twice', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const { browser, page, posts } = await fixture({ total: 4, slow: 700 });
  try {
    // As soon as the first page request is on the wire (its response is held for 700ms), open another page.
    for (let i = 0; i < 200 && !posts.some(p => p.path === '/commpilot/Common/page.jsp'); i++) await new Promise(r => setTimeout(r, 25));
    await page.evaluate(() => window.redirectPost('/commpilot/Reseller/Profile/', {}));
    await page.waitForFunction(() => /Opened/.test(document.querySelector('td.screenName')?.textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const pageHops = posts.filter(p => p.path === '/commpilot/Common/page.jsp');
    const nav = posts.find(p => p.path === '/commpilot/Reseller/Profile/');
    assert.deepEqual(pageHops.map(p => p.value), ['1'], 'no page request after the navigation');
    assert.equal(nav.token, 'tok-1', 'the navigation carries the token the in-flight page request returned');
    assert.equal(await fillState(page), undefined, 'the new page has no fill in progress');
  } finally { await browser.close(); }
});

test('a bulk-tool search during a fill waits its turn, and a navigation right after it waits for the search', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const { browser, page, posts } = await fixture({ total: 4, slow: 700 });
  try {
    for (let i = 0; i < 200 && !posts.some(p => p.path === '/commpilot/Common/page.jsp'); i++) await new Promise(r => setTimeout(r, 25));
    await page.evaluate(() => { window.cpListSearch([], {}).catch(() => {}); window.redirectPost('/commpilot/Reseller/Profile/', {}); });
    for (let i = 0; i < 400 && !posts.some(p => p.path === '/commpilot/Reseller/Profile/'); i++) await new Promise(r => setTimeout(r, 25));
    await page.waitForTimeout(500);
    assert.deepEqual(posts.map(p => [p.path, p.token]), [
      ['/commpilot/Common/page.jsp', 'tok-0'],
      ['/commpilot/Reseller/Groups/', 'tok-1'],
      ['/commpilot/Reseller/Profile/', 'tok-2'],
    ], 'fill page, then the search, then the navigation — each with the token the one before it returned');
  } finally { await browser.close(); }
});
