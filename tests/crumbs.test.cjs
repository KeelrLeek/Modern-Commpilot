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
  <table><tr><td class="headerBar" id="crumbs">${trail()}</td><td class="headerBar"><span class="headerBarWelcome">Welcome</span> <a class="headerLink" id="signout">Sign out</a></td></tr></table>
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

test('the user-id pill copies the id, and the extension chip joined to it copies the extension', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 600 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://apps-sbx.avpaas.io' });
    const page = await context.newPage();
    await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/', { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    for (const file of ['enhancer.js', 'crumbs.js']) await page.addScriptTag({ path: path.join(root, 'src/content', file) });
    const chip = page.locator('#crumbs .cp-bc button.cp-ext-chip');
    await chip.waitFor();
    const read = () => page.evaluate(() => {
      const id = document.querySelector('#crumbs span.headerAuthLevel');
      const chip = document.querySelector('#crumbs button.cp-ext-chip');
      return {
        idText: id.textContent.trim(),
        idButton: !!id.querySelector(':scope > button.cp-copy-id svg'),
        joined: id.nextElementSibling === chip && id.parentElement.matches('.cp-bc'),
        chip: chip.textContent.replace(/\s+/g, ' ').trim(),
        disabled: chip.getAttribute('aria-disabled') === 'true',
        tip: chip.dataset.cpTip,
        spinner: !!chip.querySelector('.cp-ext-spin'),
        oldToolbar: !!document.querySelector('.bw-copy-controls'),
        borders: [...document.querySelectorAll('#crumbs .cp-bc :is(a.headerAuthLevelLink, span.headerAuthLevel)')]
          .filter(el => getComputedStyle(el).display !== 'none').map(el => getComputedStyle(el).borderTopWidth),
        chipBorder: getComputedStyle(chip).borderTopWidth,
        leadBorder: getComputedStyle(document.querySelector('#crumbs .cp-bc-lead')).borderTopWidth,
      };
    });
    const first = await read();
    assert.equal(first.idText, 'TriSandbox1002', 'the icon adds no text to the id the tools read');
    assert.ok(first.idButton && first.joined && !first.oldToolbar);
    assert.equal(first.chip, 'EXT –');
    assert.equal(first.disabled, true, 'no extension read yet');
    await chip.hover();
    await page.waitForFunction(() => document.querySelector('.cp-tip:not([hidden])')?.textContent === 'Open Profile > Addresses to load the extension');
    await chip.dispatchEvent('click');   // Playwright will not click an aria-disabled button
    assert.equal(await page.evaluate(() => navigator.clipboard.readText().catch(() => '')), '', 'nothing to copy yet');
    await page.mouse.move(0, 400);
    assert.deepEqual(first.borders, ['1px', '1px', '1px', '1px'], 'every pill has the header buttons’ border');
    assert.equal(first.chipBorder, '1px');
    assert.equal(first.leadBorder, '1px');
    // The border has to show: pills and chip are drawn like the header's Sign out button in every palette.
    await page.addStyleTag({ content: '* { transition: none !important; }' });   // read each palette, not the crossfade
    for (const palette of ['graphite', 'atlas', 'nord', 'terra']) {
      const looks = await page.evaluate(palette => {
        document.documentElement.dataset.cpDirection = palette;
        const look = el => { const cs = getComputedStyle(el); return cs.borderTopColor + ' on ' + cs.backgroundColor; };
        return {
          button: look(document.getElementById('signout')),
          pills: [...document.querySelectorAll('#crumbs .cp-bc :is(a.headerAuthLevelLink, span.headerAuthLevel, .cp-ext-chip):not(.cp-bc-cur)')]
            .filter(el => getComputedStyle(el).display !== 'none').map(look),
        };
      }, palette);
      assert.equal(looks.pills.length, 4, palette);
      for (const pill of looks.pills) assert.equal(pill, looks.button, palette);
    }
    await page.evaluate(() => { document.documentElement.dataset.cpDirection = 'graphite'; });

    // pjax.js reads the extension from Addresses and marks the id element.
    const mark = (state, ext) => page.evaluate(([state, ext]) => {
      const id = document.querySelector('#crumbs span.headerAuthLevel');
      id.setAttribute('data-cp-extension-state', state);
      if (ext !== undefined) id.setAttribute('data-cp-extension', ext);
      document.dispatchEvent(new Event('cp:user-extension'));
    }, [state, ext]);
    await mark('loading');
    await page.waitForFunction(() => document.querySelector('#crumbs .cp-ext-chip .cp-ext-spin'));
    assert.equal((await read()).chip, 'EXT …');
    await mark('done', '1002');
    await page.waitForFunction(() => document.querySelector('#crumbs .cp-ext-chip')?.textContent.includes('1002'));
    const loaded = await read();
    assert.equal(loaded.chip, 'EXT 1002');
    assert.equal(loaded.disabled, false);

    await chip.hover();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#crumbs :is(.cp-ext-chip, .cp-copy-id)')]
      .map(el => getComputedStyle(el).transform)), ['none', 'none'], 'no lift on hover');
    await chip.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '1002');
    await page.waitForFunction(() => document.querySelector('.cp-tip:not([hidden])')?.textContent === 'Copied 1002');
    await page.locator('#crumbs button.cp-copy-id').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'TriSandbox1002');

    // pjax.js rewrites the header on the user's next page: the extension comes from the session's memory.
    await page.evaluate(html => { document.getElementById('crumbs').innerHTML = html; }, trail());
    await page.waitForFunction(() => document.querySelector('#crumbs .cp-bc .cp-ext-chip')?.textContent.includes('1002'));
    assert.equal(await page.evaluate(() => document.querySelector('#crumbs span.headerAuthLevel')
      .getAttribute('data-cp-extension-state')), 'done', 'a remembered extension is not read again');
    assert.ok((await read()).joined);

    // Another user never shows this user's extension.
    await page.evaluate(html => { document.getElementById('crumbs').innerHTML = html; }, trail().replace('TriSandbox1002', 'TriSandbox1003'));
    await page.waitForFunction(() => document.querySelector('#crumbs .cp-bc span.headerAuthLevel')?.textContent.trim() === 'TriSandbox1003' &&
      document.querySelector('#crumbs .cp-ext-chip')?.textContent.replace(/\s+/g, ' ').trim() === 'EXT –');

    // Opened from a Users list: the row's extension is known, so pjax.js has nothing to read from Addresses.
    await page.evaluate(() => {
      const list = document.createElement('table');
      list.innerHTML = '<tbody><tr><td class="listHeader">User ID <script>void 0</script></td><td class="listHeader">Last Name</td>' +
        '<td class="listHeader">Extension</td></tr><tr id="Row0"><td><a class="tableLink">TriSandbox1004</a></td><td>Four</td>' +
        '<td>1004</td></tr><tr id="Row1"><td><a class="tableLink">TriSandbox1005</a></td><td>Five</td><td>&nbsp;</td></tr></tbody>';
      document.querySelector('td[width="82%"]').append(list);
    });
    const openListed = async (row, user) => {
      await page.click(`#${row} td:nth-child(2)`);
      await page.evaluate(html => { document.getElementById('crumbs').innerHTML = html; }, trail().replace('TriSandbox1002', user));
      await page.waitForFunction(user => document.querySelector('#crumbs .cp-bc span.headerAuthLevel')?.textContent.trim() === user &&
        document.querySelector('#crumbs .cp-ext-chip')?.dataset.state !== 'unknown', user);
      return page.evaluate(() => ({
        chip: document.querySelector('#crumbs .cp-ext-chip').textContent.replace(/\s+/g, ' ').trim(),
        tip: document.querySelector('#crumbs .cp-ext-chip').dataset.cpTip,
        state: document.querySelector('#crumbs span.headerAuthLevel').getAttribute('data-cp-extension-state'),
      }));
    };
    assert.deepEqual(await openListed('Row0', 'TriSandbox1004'), { chip: 'EXT 1004', tip: 'Copy extension 1004', state: 'done' });
    assert.deepEqual(await openListed('Row1', 'TriSandbox1005'), { chip: 'EXT –', tip: 'This user has no extension', state: 'done' },
      'a listed user without an extension is known too');
  } finally { await browser.close(); }
});
