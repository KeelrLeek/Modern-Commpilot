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

// CommPilot's crumb cell at user level (trimmed): level links separated by ">" text, the Users list link, ": id".
const trail = (group = 'Trifecta_Sandbox_Group') => `<img src="/commpilot/Graphics/onepx.gif" width="2" height="1">
  <a class="headerAuthLevelLink" id="lvl-reseller">Reseller</a> &gt;&nbsp;<a class="headerAuthLevelLink">Trifecta_Sandbox_SP</a> &gt;&nbsp;<a class="headerAuthLevelLink" id="lvl-group">${group}</a> &gt;&nbsp;<a class="headerAuthLevelLink">Users</a> :<span dir="ltr" class="headerAuthLevel"> TriSandbox1002</span>`;
const shell = `<!doctype html><html data-cp-direction="graphite"><head><title>Profile</title></head><body id="initBody.menuTemplate">
  <table><tr><td class="headerBar" id="crumbs">${trail()}</td><td class="headerBar"><span class="headerBarWelcome">Welcome</span></td></tr></table>
  <table height="100%"><tr><td width="82%" valign="top"><table><tr><td class="screenName">Profile</td></tr></table></td></tr></table>
  <script>window.clicked = []; document.getElementById('lvl-group').addEventListener('click', () => window.clicked.push('group'));</script>
</body></html>`;

test('the breadcrumb is the alpha pill trail, built from CommPilot’s own links', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 600 } });
    await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/', { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.addScriptTag({ path: path.join(root, 'src/content/crumbs.js') });
    await page.locator('#crumbs .cp-bc').waitFor();
    const read = () => page.evaluate(() => {
      const bar = document.querySelector('#crumbs .cp-bc');
      const shown = el => getComputedStyle(el).display !== 'none';
      return {
        inCell: bar.closest('td') === document.getElementById('crumbs'),
        pills: [...bar.children].filter(el => !el.matches('.cp-bc-lead, .cp-bc-sep') && shown(el)).map(el => el.textContent.trim()),
        arrows: [...bar.querySelectorAll('.cp-bc-sep')].filter(shown).length,
        current: bar.querySelector('.cp-bc-cur')?.textContent.trim(),
        lead: !!bar.querySelector('.cp-bc-lead svg'),
        separatorsHidden: getComputedStyle(document.getElementById('crumbs')).fontSize === '0px',
        usersKept: [...document.querySelectorAll('#crumbs a.headerAuthLevelLink')].some(a => a.textContent === 'Users'),
        usersBeforeId: (() => { const u = [...document.querySelectorAll('#crumbs a.headerAuthLevelLink')].find(a => a.textContent === 'Users');
          const id = document.querySelector('#crumbs span.headerAuthLevel');
          return u && id ? !!(u.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING) : null; })(),
        idCase: (id => id && getComputedStyle(id).textTransform)(document.querySelector('#crumbs span.headerAuthLevel')),
      };
    });
    const first = await read();
    assert.deepEqual(first.pills, ['Reseller', 'Trifecta_Sandbox_SP', 'Trifecta_Sandbox_Group', 'TriSandbox1002'],
      'the Users list link only repeats the user’s id, as in the alpha');
    assert.equal(first.arrows, 3);
    assert.equal(first.current, 'TriSandbox1002');
    assert.equal(first.idCase, 'none', 'an id keeps its own case');
    assert.ok(first.inCell && first.lead && first.separatorsHidden);
    assert.ok(first.usersKept && first.usersBeforeId, 'the Users link stays in the page, before the id, for Copy User ID');

    await page.locator('#lvl-group').click();
    assert.deepEqual(await page.evaluate(() => window.clicked), ['group'], 'a level still runs CommPilot’s own click');

    // pjax.js adds the page pill after the page opens: it becomes the current place.
    await page.evaluate(() => {
      const pill = document.createElement('button');
      pill.type = 'button'; pill.className = 'cp-page-pill'; pill.innerHTML = '<span>Profile</span>';
      const anchor = document.querySelector('#crumbs span.headerAuthLevel');
      anchor.parentNode.insertBefore(pill, anchor.nextSibling);
    });
    await page.waitForFunction(() => document.querySelector('#crumbs .cp-bc-cur')?.textContent.trim() === 'Profile');
    assert.deepEqual((await read()).pills.slice(-2), ['TriSandbox1002', 'Profile']);

    // pjax.js rewrites the header for the next page: the trail follows.
    await page.evaluate(html => { document.getElementById('crumbs').innerHTML = html; }, trail('Other_Group').replace(/ &gt;&nbsp;<a class="headerAuthLevelLink">Users<\/a> :<span[^>]*> TriSandbox1002<\/span>/, ''));
    await page.waitForFunction(() => document.querySelector('#crumbs .cp-bc-cur')?.textContent.trim() === 'Other_Group');
    assert.deepEqual((await read()).pills, ['Reseller', 'Trifecta_Sandbox_SP', 'Other_Group']);
  } finally { await browser.close(); }
});
