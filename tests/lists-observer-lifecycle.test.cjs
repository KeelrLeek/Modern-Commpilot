const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(check) {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<html data-cp-direction="graphite"><body id="initBody.menuTemplate"><table><tr><td width="82%"></td></tr></table></body></html>' }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Members/');
    await page.evaluate(() => {
      const NativeObserver = window.ResizeObserver;
      window.resizeTargets = new Set();
      window.ResizeObserver = class extends NativeObserver {
        constructor(callback) { super(callback); this.targets = new Set(); }
        observe(target, ...args) { this.targets.add(target); resizeTargets.add(target); super.observe(target, ...args); }
        disconnect() { for (const target of this.targets) resizeTargets.delete(target); this.targets.clear(); super.disconnect(); }
      };
      window.listHTML = '<table id="results" data-cp-fill="done"><tbody><tr><td class="listHeader">User ID</td></tr>' +
        Array.from({ length: 25 }, (_, i) => '<tr id="Row' + i + '"><td><a class="tableLink">Fixture ' + i + '</a></td></tr>').join('') + '</tbody></table>';
      document.querySelector('td[width="82%"]') .innerHTML = listHTML;
      window.swapContent = html => {
        const next = document.createElement('td'); next.setAttribute('width', '82%'); next.innerHTML = html;
        document.querySelector('td[width="82%"]') .replaceWith(next);
        document.dispatchEvent(new Event('cp:reskin'));
      };
    });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.addScriptTag({ path: path.join(root, 'src/content/lists.js') });
    await page.waitForFunction(() => document.querySelector('#results')?.dataset.cpResultsReady === 'true');
    assert.equal(await page.evaluate(() => resizeTargets.size), 1);
    await check(page, errors);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
test('malformed local paging events leave results usable and valid paging still works', () => fixture(async (page, errors) => {
  const accepted = await page.evaluate(() => {
    for (const detail of [null, 'null', '[]', '17', '{broken', '{"offset":-1}']) {
      const event = new CustomEvent('cp:list-page', { detail, cancelable: true });
      document.dispatchEvent(event);
      if (event.defaultPrevented) throw Error('Malformed paging request was accepted');
    }
    const table = document.querySelector('#results');
    table.dataset.cpReturnPage = '/Group/Members/'; table.dataset.cpTableName = 'fixture';
    const event = new CustomEvent('cp:list-page', { cancelable: true,
      detail: JSON.stringify({ offset: 10000, returnPage: '/Group/Members/', tableName: 'fixture' }) });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(accepted, true, 'a valid local page request remains handled');
  assert.deepEqual(errors, [], 'malformed events must not throw');
  await page.waitForTimeout(500);
  const snapshot = await page.evaluate(() => ({
    visible: [...document.querySelectorAll('#results tr[id^="Row"]')].filter(row => !row.classList.contains('cp-row-off')).map(row => row.id),
    pager: document.querySelector('.cp-pager')?.textContent,
    sizes: [document.querySelector('td[width="82%"]').clientHeight, document.querySelector('#results').getBoundingClientRect().height]
  }));
  assert.ok(snapshot.visible.includes('Row24'), JSON.stringify(snapshot));
}));
for (const destination of ['console', 'form', 'no-content']) {
  test(`leaving results for ${destination} releases the observed list and can observe the next results`, () => fixture(async page => {
    await page.evaluate(destination => {
      if (destination === 'no-content') {
        document.querySelector('td[width="82%"]') .remove();
        document.dispatchEvent(new Event('cp:reskin'));
      } else swapContent(destination === 'console' ? '<div class="cp-console">Group overview</div>' : '<form><input name="firstName"></form>');
    }, destination);
    await settle(page);
    assert.deepEqual(await page.evaluate(() => [...resizeTargets].map(target => target.isConnected)), [],
      'a non-list page must not retain or observe the old list container');
    await page.evaluate(destination => {
      if (destination === 'no-content') {
        const cell = document.createElement('td'); cell.setAttribute('width', '82%');
        document.querySelector('tr').appendChild(cell);
      }
      swapContent(listHTML);
    }, destination);
    await page.waitForFunction(() => document.querySelector('#results')?.dataset.cpResultsReady === 'true');
    assert.deepEqual(await page.evaluate(() => [...resizeTargets].map(target => target.isConnected)), [true]);
    assert.equal(await page.locator('.cp-pager').count(), 1);
  }));
}
