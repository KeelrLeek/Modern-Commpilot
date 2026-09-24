const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const edge = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const bulk = path.resolve(__dirname, '../src/content/number-activation-bulk.js');

async function fixture(badPage = false, rangeAsOne = false) {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const page = await browser.newPage();
  const list = '/commpilot/Group/DnActivation/';
  await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><html><body><table><tr><td width="82%"></td></tr></table></body></html>'
  }));
  await page.goto(`https://apps-sbx.avpaas.io${list}`);
  await page.evaluate(({ badPage, rangeAsOne }) => {
    const LIST = '/commpilot/Group/DnActivation/';
    const MODIFY = '/commpilot/Group/DnActivation/Modify/index.jsp';
    const cell = document.querySelector('td[width="82%"]');
    const data = [
      { label: '+1-1111111111', numbers: ['+1-1111111111'], active: true },
      { label: '+1-2222222222 - +1-2222222223',
        numbers: rangeAsOne ? ['+1-2222222222 - +1-2222222223'] :
          ['+1-2222222222', '+1-2222222223'], active: false },
      { label: '+1-3333333333', numbers: ['+1-3333333333'], active: true },
      { label: '+1-4444444444', numbers: ['+1-4444444444'], active: false },
      { label: '+1-5555555555', numbers: ['+1-5555555555'], active: true }
    ];
    let pageIndex = 0, found = null, current = null, staged = false;
    window.calls = [];
    window.confirm = () => true;
    const selected = () => found ? data.filter(item =>
      item.label === found.value || (found.op === '2' && item.label.includes(found.value))) :
      data.slice(pageIndex * 2, pageIndex * 2 + 2);
    const listView = () => {
      cell.innerHTML = `<form name="mainForm"><input name="ok" type="button" value="OK"></form>
        <div>[ Page ${found ? 1 : badPage && pageIndex === 1 ? 1 : pageIndex + 1} of ${found ? 1 : 3} ]</div>`;
    };
    const editView = () => {
      const left = staged || current.active ? [] : current.numbers;
      const right = staged || current.active ? current.numbers : [];
      const options = values => values.map(v => `<option value="${v}">${v}</option>`).join('');
      cell.innerHTML = `<form name="mainForm"><input name="action" type="hidden">
        <input name="toAdd" type="hidden"><select name="deactivatedList" multiple>
        ${options(left)}</select><select name="activatedList" multiple>${options(right)}</select>
        <input id="PICKLIST_addNumbers" type="button" value="Add >">
        <input name="ok" type="button" value="OK"></form>`;
      cell.querySelector('#PICKLIST_addNumbers').addEventListener('click', () => {
        window.calls.push('add:' + current.label);
        staged = true; editView(); document.dispatchEvent(new Event('cp:reskin'));
      });
      cell.querySelector('input[name="ok"]').addEventListener('click', () => {
        window.calls.push('save:' + current.label);
        current.active = staged || current.active;
        found = null; staged = false; history.pushState(null, '', LIST);
        document.documentElement.setAttribute('data-cp-path', LIST);
        listView(); document.dispatchEvent(new Event('cp:reskin'));
      });
    };
    listView();
    window.cpListSearch = async () => ({ tooMany: false, rows: selected().map(item => ({
      cells: [item.label, item.active ? '✓' : ''],
      drill: { url: MODIFY, params: { key: item.label,
        P_key: item.label, activated: String(item.active), P_activated: String(item.active) } }
    })) });
    window.redirectPost = (url, params = {}) => {
      window.calls.push(url + (params.value != null ? ':' + params.value : ''));
      if (url === '/commpilot/Common/page.jsp') {
        pageIndex = Number(params.value); found = null; url = LIST;
      } else if (url === '/commpilot/Common/find.jsp') {
        found = { value: params.value, op: params.op }; pageIndex = 0;
      } else if (url === LIST) { found = null; pageIndex = 0; }
      history.pushState(null, '', url);
      document.documentElement.setAttribute('data-cp-path', url);
      if (url === MODIFY) {
        current = data.find(item => item.label === params.key); staged = false; editView();
      } else listView();
      document.dispatchEvent(new Event('cp:reskin'));
    };
  }, { badPage, rangeAsOne });
  await page.addScriptTag({ path: bulk });
  return { browser, page };
}

test('activation scans all pages and range members, then saves and verifies each row', async () => {
  const { browser, page } = await fixture();
  try {
    await page.locator('#cp-bulk-activation-launch').click();
    await page.locator('.cp-activation-bulk-dialog [data-action="scan"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-activation-bulk-dialog [data-action="scan"]').disabled);
    assert.match(await page.locator('.cp-bulk-status').innerText(), /Found 3 deactivated numbers in 2 rows across 3 pages/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /\+1-2222222222, \+1-2222222223/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /2 rows · 0 rows verified/);
    await page.locator('.cp-activation-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-activation-bulk-dialog [data-action="scan"]').disabled);
    assert.match(await page.locator('.cp-bulk-status').innerText(), /2 rows saved and verified · 0 errors/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /Saved and verified/);
    const calls = await page.evaluate(() => window.calls);
    assert.ok(calls.includes('/commpilot/Common/page.jsp:1'));
    assert.ok(calls.includes('/commpilot/Common/page.jsp:2'));
    assert.equal(calls.filter(c => c.startsWith('save:')).length, 2);
  } finally { await browser.close(); }
});

test('activation refuses to apply when a list page cannot be verified', async () => {
  const { browser, page } = await fixture(true);
  try {
    await page.locator('#cp-bulk-activation-launch').click();
    await page.locator('.cp-activation-bulk-dialog [data-action="scan"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-activation-bulk-dialog [data-action="scan"]').disabled);
    assert.match(await page.locator('.cp-bulk-status').innerText(), /changed the list while scanning page 2/);
    assert.equal(await page.locator('.cp-activation-bulk-dialog [data-action="apply"]').isDisabled(), true);
    assert.equal((await page.evaluate(() => window.calls)).filter(c => c.startsWith('save:')).length, 0);
  } finally { await browser.close(); }
});

test('activation counts a compact CommPilot range as its individual numbers', async () => {
  const { browser, page } = await fixture(false, true);
  try {
    await page.locator('#cp-bulk-activation-launch').click();
    await page.locator('.cp-activation-bulk-dialog [data-action="scan"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-activation-bulk-dialog [data-action="scan"]').disabled);
    assert.match(await page.locator('.cp-bulk-status').innerText(), /Found 3 deactivated numbers in 2 rows/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /2 numbers: \+1-2222222222 - \+1-2222222223/);
    await page.locator('.cp-activation-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-activation-bulk-dialog [data-action="scan"]').disabled);
    assert.match(await page.locator('.cp-bulk-status').innerText(), /2 rows saved and verified · 0 errors/);
  } finally { await browser.close(); }
});
