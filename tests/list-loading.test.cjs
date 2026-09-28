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
const LIST = '/commpilot/Reseller/Groups/';

// A CommPilot results page (trimmed) with 20 rows per page; later pages carry longer names, which would widen
// the first column if the table re-laid itself out as they arrived.
function rows(pageNo) {
  return Array.from({ length: 20 }, (_, i) => {
    const n = i + 1, name = pageNo === 3 ? `A much longer group name number ${n} on page three` : `Group ${pageNo}-${n}`;
    const link = (id, text) => `<a id="${id}" class="${text === 'Edit' ? 'headerLink' : 'tableLink'}">${text}</a>
      <script>document.addEventListener('DOMContentLoaded', function () { document.getElementById('${id}')
        .addEventListener('click', function () { redirectPost('/commpilot/Reseller/Groups/Modify/index.jsp', { key: '${name}' }); }); });</script>`;
    return `<tr id="Row${n}" class="unselected"><td width="20">&nbsp;</td><td>${link(`Row${n}Col0`, name)}</td>
      <td width="0">&nbsp;</td><td>${link(`Row${n}Col1`, 'Service Provider')}</td><td width="0">&nbsp;</td>
      <td class="unselected">${link(`link_${pageNo}_${n}`, 'Edit')}</td></tr>`;
  }).join('');
}
function page(token, results) {
  return `<!doctype html><html data-cp-direction="graphite"><head><title>Groups</title></head><body id="initBody.menuTemplate">
    <table height="100%"><tbody><tr><td class="headandfoot" width="18%"><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form></td>
    <td width="82%" valign="top"><form name="mainForm" method="post"><input type="hidden" name="formtokenserial" value="${token}">
      <table width="100%"><tbody>
        <tr><td class="screenName">Groups</td></tr>
        <tr id="buttonbartop"><td class="buttonbar"><input type="button" name="ok" value="OK"></td></tr>
        <tr><td class="enduserbody">
          <table id="searchTable" class="enduserbody"><tbody><tr id="tr0">
            <td><select name="findKey0"><option value="GroupId">Group ID</option></select></td>
            <td><input type="text" id="findValue0" name="findValue0"></td>
            <td><input type="submit" id="search0" name="search" value="Search"></td></tr></tbody></table>
          ${results ? `<table width="100%" cellpadding="2"><tbody>
            <tr><td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="20" height="1"></td><td class="listHeader">Group ID</td>
              <td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="0" height="1"></td><td class="listHeader">Organization Type</td>
              <td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="0" height="1"></td><td class="listHeader">Edit</td></tr>
            ${rows(results.page)}</tbody></table>
          <table class="enduserbody" width="100%"><tbody><tr><td width="33%"></td><td width="33%">[ Page ${results.page} of 3 ]</td><td width="33%"></td></tr></tbody></table>` : ''}
        </td></tr>
        <tr id="buttonbarbottom"><td class="buttonbar"><input type="button" name="ok" value="OK"></td></tr>
      </tbody></table>
      <script>function doPage(value) { var parmsArray = { returnPage: '/Reseller/Groups/', tableName: 'resellerGroupTable', value: value };
        redirectPost('/commpilot/Common/page.jsp', parmsArray); }</script>
    </form></td></tr></tbody></table>
    <script>window.redirectPost = window.redirectPost || function () {};</script></body></html>`;
}

test('a search shows it is working, then paints its results once in their final form, and nothing moves while the rest loads', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    let serial = 0;
    await tab.route('https://apps-sbx.avpaas.io/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      const body = new URLSearchParams(req.postData() || '');
      if (url.pathname === '/commpilot/Common/page.jsp') {
        await new Promise(r => setTimeout(r, 250));
        return route.fulfill({ status: 200, contentType: 'text/html', body: page(`tok-${++serial}`, { page: Number(body.get('value')) + 1 }) });
      }
      if (req.method() === 'POST' && body.get('search')) {
        await new Promise(r => setTimeout(r, 700));   // CommPilot takes a moment to search
        return route.fulfill({ status: 200, contentType: 'text/html', body: page(`tok-${++serial}`, { page: 1 }) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: page('tok-0', null) });
    });
    await tab.goto('https://apps-sbx.avpaas.io' + LIST, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
      await tab.addStyleTag({ path: path.join(root, 'src/content', file) });
    await tab.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await tab.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
    await tab.addScriptTag({ path: path.join(root, 'src/content/lists.js') });
    // What the first frame after the results arrive shows (this listener runs after lists.js's, same frame).
    await tab.evaluate(() => {
      document.addEventListener('cp:reskin', () => requestAnimationFrame(() => {
        const rows = [...document.querySelectorAll('tr[id^="Row"]')];
        window.firstFrame = {
          shown: rows.filter(tr => getComputedStyle(tr).display !== 'none').length,
          edit: [...document.querySelectorAll('td.listHeader')].some(td => td.textContent.trim() === 'Edit' && getComputedStyle(td).display !== 'none'),
          pager: document.querySelector('.cp-pager')?.textContent.replace(/\s+/g, ' ').trim() || null,
          nativePager: [...document.querySelectorAll('table')].some(t => /\[ Page 1 of 3 \]/.test(t.textContent) && getComputedStyle(t).display !== 'none' && !t.querySelector('table')),
          scroll: (c => c.scrollHeight - c.clientHeight)(document.querySelector('td[width="82%"]')),
        };
      }), { once: true });
    });

    await tab.locator('#search0').click();
    await tab.waitForTimeout(400);
    const waiting = await tab.evaluate(() => ({
      busy: document.documentElement.dataset.cpNav,
      // the loading bar along the top of the window: showing (it fades in) and on its way
      bar: (bar => !!bar && Number(getComputedStyle(bar).opacity) > 0.5 &&
        new DOMMatrix(getComputedStyle(bar).transform).a > 0.1)(document.getElementById('cp-progress')),
    }));
    assert.deepEqual(waiting, { busy: 'busy', bar: true }, 'the page shows it is waiting for CommPilot');

    await tab.waitForFunction(() => window.firstFrame);
    const first = await tab.evaluate(() => window.firstFrame);
    assert.equal(first.edit, false, 'Edit is already gone in the first frame');
    assert.equal(first.nativePager, false, 'CommPilot’s pager is already replaced');
    assert.ok(first.shown > 5 && first.shown < 20, `already paged to the window (${first.shown} rows)`);
    assert.ok(first.scroll <= 0, 'and the page does not scroll');
    assert.match(first.pager, /^Loading more results/);
    assert.equal(await tab.evaluate(() => document.documentElement.dataset.cpNav), undefined, 'the wait is over');
    await tab.waitForFunction(() => !document.getElementById('cp-progress').classList.contains('cp-progress-on'),
      null, { timeout: 2000 });   // the bar filled and faded

    const layout = () => tab.evaluate(() => ({
      columns: [...document.querySelectorAll('td.listHeader')].filter(td => getComputedStyle(td).display !== 'none')
        .map(td => Math.round(td.getBoundingClientRect().left)),
      shown: [...document.querySelectorAll('tr[id^="Row"]')].filter(tr => getComputedStyle(tr).display !== 'none').map(tr => tr.id),
    }));
    const before = await layout();
    const during = [];
    while (await tab.evaluate(() => document.querySelector('table[data-cp-fill]')?.dataset.cpFill) === 'loading') {
      during.push(await layout());
      await tab.waitForTimeout(60);
    }
    assert.ok(during.length > 3, 'sampled while the other pages loaded');
    for (const sample of during) assert.deepEqual(sample, before, 'nothing moved while the other pages loaded');
    const after = await layout();
    assert.deepEqual(after, before, 'nor when they finished');
    assert.match(await tab.locator('.cp-pager').innerText(), new RegExp(`1–${before.shown.length} of 60`));
  } finally { await browser.close(); }
});
