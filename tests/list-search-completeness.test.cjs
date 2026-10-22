const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const pjax = process.env.BW_TEST_PJAX_PATH || path.resolve(__dirname, '../src/content/pjax.js');

function response(page, total, token, { empty = false, missing = false, noDescriptor = false } = {}) {
  return `<html><body><form name="leftNavForm"></form><table><tr><td width="82%">
    <form name="mainForm"><input name="formtokenserial" value="${token}"><table>
    ${missing ? '<tr><td class="error">Failed to read the requested list.</td></tr>' : empty ?
      '<tr><td>No Entries Present</td></tr>' :
      `<tr id="Row1"><td><a class="tableLink">Result ${page}</a></td></tr>`}
    <tr><td>Page ${page} of ${total}</td></tr></table></form>
    ${noDescriptor ? '' : `<script>function doPage(value) { var p = {
      returnPage: '/Group/Users/', tableName: 'groupUserTable', value: value }; }</script>`}
    </td></tr></table></body></html>`;
}

async function fixture(kind) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const posts = [];
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.method() !== 'POST' && kind.startsWith('client-')) return route.fulfill({ contentType: 'text/html',
        body: response(1, 1, 't0', { empty: kind === 'client-empty', missing: kind !== 'client-empty' })
          .replace(kind === 'client-pending' ? 'Failed to read the requested list.' : 'NO_REPLACEMENT', '') });
      if (request.method() !== 'POST') return route.fulfill({ contentType: 'text/html', body:
        '<html><body><form name="leftNavForm"></form><table><tr><td width="82%">' +
        '<form name="mainForm"><input name="formtokenserial" value="t0"></form>' +
        '</td></tr></table><script>window.redirectPost=function(){};</script></body></html>' });
      const params = new URLSearchParams(request.postData());
      posts.push({ token: params.get('formtokenserial'), page: params.get('value') });
      const n = params.has('value') ? Number(params.get('value')) + 1 : 1;
      const total = kind === 'cap' ? 501 : ['native-error', 'empty'].includes(kind) ? 1 : 3;
      return route.fulfill({ contentType: 'text/html', body: response(
        kind === 'wrong-page' && n === 2 ? 1 : n, total, `t${posts.length}`, {
          empty: kind === 'empty' || kind === 'missing-page' && n === 2,
          missing: kind === 'native-error', noDescriptor: kind === 'no-descriptor'
        }) });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Profile/');
    await page.evaluate(() => { window.redirectPost = function () {}; });
    await page.addScriptTag({ path: pjax });
    await page.waitForFunction(() => typeof window.cpListSearch === 'function');
    const result = await page.evaluate(async kind => {
      const controller = new AbortController();
      if (kind === 'cancelled-first') controller.abort();
      try {
        const found = await cpListSearch([], {
          ctx: kind.startsWith('client-') ? undefined : { landing: location.origin + '/commpilot/Group/Users/', baseParams: {} },
          signal: controller.signal,
          onPage: () => { if (kind === 'cancelled-later') controller.abort(); }
        });
        return { rows: found.rows.map(row => row.cells[0]), total: found.totalPages,
          token: document.querySelector('[name="formtokenserial"]').value };
      } catch (error) { return { error: error.message,
        token: document.querySelector('[name="formtokenserial"]').value }; }
    }, kind);
    return { result, posts };
  } finally { await browser.close(); }
}

for (const kind of ['native-error', 'missing-page', 'wrong-page', 'no-descriptor', 'cap',
  'cancelled-first', 'cancelled-later']) test(`list search rejects incomplete results: ${kind}`, async () => {
  const { result, posts } = await fixture(kind);
  assert.ok(result.error, JSON.stringify(result));
  assert.match(result.error, /\[search\]/);
  assert.equal(result.rows, undefined, 'partial data must not masquerade as a complete result');
  if (kind === 'cancelled-first') assert.equal(posts.length, 0);
  if (['cap', 'no-descriptor', 'native-error', 'cancelled-later'].includes(kind)) assert.equal(posts.length, 1);
  if (['missing-page', 'wrong-page'].includes(kind)) {
    assert.equal(posts.length, 2);
    assert.equal(result.token, 't2', 'keep the latest token even when the data is rejected');
  }
});

test('list search returns complete pages using each freshly rotated token', async () => {
  const { result, posts } = await fixture('complete');
  assert.deepEqual(result, { rows: ['Result 1', 'Result 2', 'Result 3'], total: 3, token: 't3' });
  assert.deepEqual(posts, [{ token: 't0', page: null }, { token: 't1', page: '1' }, { token: 't2', page: '2' }]);
});

test('list search accepts an explicit native empty-result marker', async () => {
  const { result, posts } = await fixture('empty');
  assert.deepEqual(result, { rows: [], total: 1, token: 't1' });
  assert.equal(posts.length, 1);
});

for (const kind of ['client-error', 'client-pending']) test(`client-rendered list rejects an unconfirmed empty state: ${kind}`, async () => {
  const { result, posts } = await fixture(kind);
  assert.ok(result.error, JSON.stringify(result));
  assert.match(result.error, /\[search\]/);
  assert.equal(result.rows, undefined);
  assert.equal(posts.length, 0);
});

test('client-rendered list accepts an explicit native empty-result marker', async () => {
  const { result, posts } = await fixture('client-empty');
  assert.deepEqual(result, { rows: [], total: 1, token: 't0' });
  assert.equal(posts.length, 0);
});
