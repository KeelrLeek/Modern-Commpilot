const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extensionPath = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
const hosts = [
  'apps.avpaas.io', 'apps01.avpaas.io', 'apps02.avpaas.io', 'apps-sbx.avpaas.io',
  'phone.tripbx.com', 'phone1.tripbx.com', 'phone2.tripbx.com'
];
const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(fs.existsSync);

const manyOptions = Array.from({ length: 3500 }, (_, i) => {
  const number = 2056000000 + i;
  return `<option value="${number}">${number} (Birmingham)</option>`;
}).join('');
const fixture = `<!doctype html><html><head><title>BroadWorks fixture</title></head><body>
  <table><tbody><tr><td class="headerBar">
    <a class="headerAuthLevelLink">Reseller</a> &gt;
    <a class="headerAuthLevelLink">Trifecta_Sandbox_SP</a> &gt;
    <a class="headerAuthLevelLink">Quick Stop</a> &gt;
    <a class="headerAuthLevelLink">Users</a> :
    <span dir="ltr" class="headerAuthLevel"> QuickStop101</span>
  </td></tr></tbody></table>
  <label for="extension">Extension</label><input id="extension" name="extension" value="101">
  <a class="navMenuitem" id="on">Call Forwarding - On</a>
  <a class="navMenuitem" id="off">Voice Mail - Off</a>
  <label for="line">Phone Number</label>
  <select id="line"><option value="">None</option>${manyOptions}</select>
  <select id="keyboard" aria-label="Keyboard choices">
    <option value="a">Choice A</option>
    <option value="b" disabled>Choice B</option>
    <option value="c">Choice C</option>
  </select>
  <div role="listbox" id="custom" aria-label="Customer list">
    <div role="option">Socius Birmingham</div>
    <div role="option">Socius Dallas</div>
    <div role="option">Inventory</div>
  </div>
</body></html>`;

const usersSearchFixture = `<!doctype html><html><head><title>Users</title></head><body>
  <div class="navMenu" id="users-navigation">
    <a class="navMenuitem" id="users-status">Call Forwarding - On</a>
  </div>
  <h1>Users</h1>
  <form id="users-search" action="/commpilot/Group/Members/index.jsp" method="post">
    <div id="criteria">
      <select id="search-field" name="searchField">
        <option value="userId">User ID</option><option value="lastName">Last Name</option>
      </select>
      <select id="search-mode" name="searchMode">
        <option value="startsWith">Starts With</option><option value="contains">Contains</option>
      </select>
      <input id="search-value" name="searchValue" type="text">
      <button id="add-criterion" type="button">+</button>
      <button id="submit-search" name="search" value="Search" type="submit">Search</button>
    </div>
  </form>
</body></html>`;

let context;
let userDataDir;

test.before(async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to a Chrome or Chromium executable');
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadworks-extension-test-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  await context.route(/^https:\/\/(?:apps(?:01|02|-sbx)?\.avpaas\.io|phone(?:1|2)?\.tripbx\.com)\/.*$/, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await context.route('https://example.org/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
});

test.after(async () => {
  await context?.close();
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

async function openPage(host = hosts[0]) {
  const page = await context.newPage();
  await page.goto(`https://${host}/test`, { waitUntil: 'domcontentloaded' });
  await page.locator('#line[data-bw-searchable]').waitFor({ timeout: 5000 });
  return page;
}

function dropdownTrigger(page, id) {
  return page.locator(`#${id}`).locator('xpath=..').locator('.bw-select-trigger');
}

async function readClipboard(page) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin
  });
  return page.evaluate(() => navigator.clipboard.readText());
}

test('search trigger covers the visible dropdown itself', async () => {
  const page = await openPage();
  const select = page.locator('#line');
  const trigger = dropdownTrigger(page, 'line');
  const selectBox = await select.boundingBox();
  const triggerBox = await trigger.boundingBox();
  assert.ok(selectBox && triggerBox);
  const overlapWidth = Math.max(0, Math.min(selectBox.x + selectBox.width,
    triggerBox.x + triggerBox.width) - Math.max(selectBox.x, triggerBox.x));
  const overlapHeight = Math.max(0, Math.min(selectBox.y + selectBox.height,
    triggerBox.y + triggerBox.height) - Math.max(selectBox.y, triggerBox.y));
  assert.ok(overlapWidth >= selectBox.width * 0.9);
  assert.ok(overlapHeight >= selectBox.height * 0.9);
  assert.equal(await select.evaluate(el => getComputedStyle(el).visibility), 'visible');
  await page.close();
});

test('manifest and real extension injection cover production and sandbox hosts', async () => {
  const enhancerScript = manifest.content_scripts.find(script =>
    script.js && script.js.includes('src/content/enhancer.js'));
  assert.deepEqual(enhancerScript.matches,
    hosts.map(host => `https://${host}/*`));
  for (const host of hosts) {
    const page = await openPage(host);
    assert.equal(await page.locator('#line').isVisible(), true, host);
    assert.equal(await dropdownTrigger(page, 'line').count(), 1, host);
    await dropdownTrigger(page, 'line').click();
    assert.equal(await page.locator('.bw-search-popover:visible').count(), 1, host);
    assert.equal(await page.locator('.bw-search-toggle').count(), 0, host);
    await page.close();
  }
  const other = await context.newPage();
  await other.goto('https://example.org/test', { waitUntil: 'domcontentloaded' });
  await other.locator('#line').click();
  assert.equal(await other.locator('.bw-search-popover').count(), 0);
  assert.equal(await other.locator('.bw-select-trigger').count(), 0);
  await other.close();
});

test('On/Off links are colored and react to text changes', async () => {
  const page = await openPage();
  const on = page.locator('#on .bw-on-off-status');
  const off = page.locator('#off .bw-on-off-status');
  await on.waitFor();
  assert.equal(await on.evaluate(el => getComputedStyle(el).color), 'rgb(76, 175, 80)');
  assert.equal(await off.evaluate(el => getComputedStyle(el).color), 'rgb(244, 67, 54)');
  await page.locator('#on').evaluate(el => { el.textContent = 'Call Forwarding - Off'; });
  await page.locator('#on .bw-on-off-status[data-bw-state="off"]').waitFor();
  assert.equal(await page.locator('#on .bw-on-off-status').count(), 1);
  await page.close();
});

test('On/Off text split across nested markup stays nested and recolors after replacement', async () => {
  const page = await openPage();
  const markup = '<span class="label">Call Forwarding <i class="separator"> - </i>' +
    '<b class="state">On</b></span>';
  await page.evaluate(html => {
    const anchor = document.createElement('a');
    anchor.id = 'split';
    anchor.className = 'navMenuitem';
    anchor.innerHTML = html;
    document.body.append(anchor);
  }, markup);
  const anchor = page.locator('#split');
  const state = anchor.locator('.state .bw-on-off-status[data-bw-state="on"]');
  await state.waitFor();
  assert.equal(await anchor.locator('.label > .separator').count(), 1);
  assert.equal(await anchor.locator('.label > .state').count(), 1);
  assert.equal(await state.evaluate(el => getComputedStyle(el).color), 'rgb(76, 175, 80)');

  await anchor.evaluate((element, html) => { element.innerHTML = html; }, markup);
  await state.waitFor();
  assert.equal(await anchor.locator('.label > .separator').count(), 1);
  assert.equal(await anchor.locator('.label > .state').count(), 1);
  assert.equal(await state.evaluate(el => getComputedStyle(el).color), 'rgb(76, 175, 80)');
  await page.close();
});

test('Users search gets the searchable dropdowns while its form keeps only CommPilot’s own controls', async () => {
  for (const pathname of ['/commpilot/Group/Members/', '/commpilot/Group/Members/index.jsp']) {
    const page = await context.newPage();
    let submission;
    await page.route('**/commpilot/Group/Members/**', async route => {
      if (route.request().method() === 'POST') {
        submission = route.request().postData();
        await route.fulfill({ status: 200, contentType: 'text/html', body: 'Search complete' });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/html', body: usersSearchFixture });
      }
    });
    // The PJAX extension protects direct GETs to POST-only CommPilot pages. Start
    // on the allowed login path, then put this static fixture at the target path.
    await page.goto('https://apps02.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(path => history.replaceState(null, '', path), pathname);
    await page.evaluate(html => {
      document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    }, usersSearchFixture);
    await page.locator('#users-status .bw-on-off-status[data-bw-state="on"]').waitFor();

    await page.locator('#search-mode[data-bw-searchable="1"]').waitFor();
    assert.equal(await page.locator('#criteria .bw-select-shell > select').count(), 2, pathname);
    assert.equal(await page.locator('#criteria .bw-select-trigger[role="combobox"]').count(), 2, pathname);
    assert.equal(await page.locator('.bw-menu-search').count(), 0, 'its menus keep no filter field');
    assert.deepEqual(await page.locator('#users-search').evaluate(form =>
      Array.from(form.elements, element => element.name || element.id)),
    ['searchField', 'searchMode', 'searchValue', 'add-criterion', 'search'], 'the dropdowns add nothing to the form');

    // CommPilot's getChoice(): picking a field swaps the match list for a new one, in place, through its parent
    // (`old.parentNode.replaceChild(new, old)`). The new list must survive and get the searchable dropdown too.
    await page.evaluate(() => document.getElementById('search-field').addEventListener('change', event => {
      const old = document.getElementById('search-mode');
      const fresh = document.createElement('select');
      fresh.id = 'search-mode'; fresh.name = 'searchMode';
      fresh.innerHTML = event.target.value === 'lastName'
        ? '<option value="startsWith">Starts With</option><option value="contains">Contains</option><option value="equalTo">Equal To</option>'
        : '<option value="equalTo">Equal To</option>';
      old.parentNode.replaceChild(fresh, old);
    }));
    await page.locator('#search-field').locator('xpath=..').locator('.bw-select-trigger').click();
    await page.locator('.bw-search-result', { hasText: 'Last Name' }).click();
    await page.waitForFunction(() => document.getElementById('search-mode')?.closest('.bw-select-shell') &&
      document.getElementById('search-mode').dataset.bwSearchable === '1');
    assert.equal(await page.locator('#criteria .bw-select-shell .bw-select-shell').count(), 0, 'no shell left inside another');
    assert.equal(await page.locator('[name="searchMode"]').count(), 1, 'CommPilot’s new match list is still in the form');
    await page.locator('#search-mode').locator('xpath=..').locator('.bw-select-trigger').click();
    await page.locator('.bw-search-result', { hasText: 'Contains' }).click();
    await page.locator('#search-value').fill('QuickStop101');
    await page.locator('#submit-search').click();
    assert.equal(submission,
      'searchField=lastName&searchMode=contains&searchValue=QuickStop101&search=Search',
      pathname);
    await page.close();
  }
});

test('navigation menu keeps its original children while On/Off statuses are colored', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const nav = document.createElement('div');
    nav.className = 'navMenu';
    nav.id = 'feature-navigation';
    nav.innerHTML = '<a class="navMenuitem" id="nav-on">Feature A - On</a>' +
      '<a class="navMenuitem" id="nav-off">Feature B - Off</a>';
    document.body.append(nav);
  });
  const on = page.locator('#nav-on .bw-on-off-status[data-bw-state="on"]');
  const off = page.locator('#nav-off .bw-on-off-status[data-bw-state="off"]');
  await on.waitFor();
  await off.waitFor();
  assert.deepEqual(await page.locator('#feature-navigation').evaluate(nav =>
    Array.from(nav.children, child => child.id)), ['nav-on', 'nav-off']);
  assert.equal(await page.locator('#feature-navigation .bw-menu-search').count(), 0);
  assert.equal(await on.evaluate(el => getComputedStyle(el).color), 'rgb(76, 175, 80)');
  assert.equal(await off.evaluate(el => getComputedStyle(el).color), 'rgb(244, 67, 54)');
  await page.close();
});

test('breadcrumb buttons copy the exact user ID and extension', async () => {
  const page = await openPage();
  const userButton = page.locator('td.headerBar [data-bw-copy="user-id"]');
  const extensionButton = page.locator('td.headerBar [data-bw-copy="extension"]');
  await userButton.waitFor();
  await extensionButton.waitFor();
  assert.equal(await userButton.isVisible(), true);
  assert.equal(await extensionButton.isVisible(), true);
  if (process.env.BW_COPY_PREVIEW) {
    await page.locator('td.headerBar').screenshot({
      path: path.join(__dirname, 'copy-preview-light.png')
    });
    await page.locator('td.headerBar').evaluate(header => {
      header.style.backgroundColor = '#24466e';
      header.style.color = '#fff';
      header.style.font = '12px Arial, sans-serif';
      header.style.padding = '8px 4px';
      header.append(document.createTextNode(' '));
    });
    await page.locator('td.headerBar .bw-copy-controls[data-bw-theme="dark"]').waitFor();
    await page.locator('td.headerBar').screenshot({
      path: path.join(__dirname, 'copy-preview-dark.png')
    });
  }

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin
  });
  await userButton.click();
  assert.equal(await readClipboard(page), 'QuickStop101');
  await extensionButton.click();
  assert.equal(await readClipboard(page), '101');
  await page.close();
});

test('Copy User ID omits the @domain suffix', async () => {
  const page = await openPage();
  const userButton = page.locator('td.headerBar [data-bw-copy="user-id"]');
  await page.locator('td.headerBar .headerAuthLevel').evaluate(span => {
    span.textContent = ' 3122160773@phonenetwork.net';
  });
  assert.equal(await page.locator('td.headerBar .headerAuthLevel').evaluate(span => span.textContent.trim()),
    '3122160773@phonenetwork.net');
  await userButton.click();
  assert.equal(await readClipboard(page), '3122160773');
  await page.close();
});

test('extension remains copyable after navigating away from Addresses for the same user', async () => {
  const page = await openPage();
  const extensionButton = page.locator('td.headerBar [data-bw-copy="extension"]');
  await extensionButton.waitFor();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin
  });
  await extensionButton.click();
  assert.equal(await readClipboard(page), '101');

  const withoutExtension = fixture.replace(
    '<label for="extension">Extension</label><input id="extension" name="extension" value="101">', '');
  await page.route('https://apps.avpaas.io/no-extension', route => route.fulfill({
    status: 200, contentType: 'text/html', body: withoutExtension
  }));
  await page.goto('https://apps.avpaas.io/no-extension', { waitUntil: 'domcontentloaded' });
  await extensionButton.waitFor();
  assert.equal(await extensionButton.isEnabled(), true);
  await extensionButton.click();
  assert.equal(await readClipboard(page), '101');

  await page.route('https://apps.avpaas.io/other-user', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: withoutExtension.replace('QuickStop101', 'AnotherUser')
  }));
  await page.goto('https://apps.avpaas.io/other-user', { waitUntil: 'domcontentloaded' });
  await page.locator('#line[data-bw-searchable]').waitFor();
  assert.equal(await extensionButton.count() === 0 || await extensionButton.isDisabled(), true);
  await page.close();
});

test('extension cache stays available for the same user and never leaks to another user', async () => {
  const page = await openPage();
  const userButton = page.locator('td.headerBar [data-bw-copy="user-id"]');
  const extensionButton = page.locator('td.headerBar [data-bw-copy="extension"]');
  await extensionButton.waitFor();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin
  });

  await page.locator('#extension').evaluate(input => input.remove());
  await extensionButton.click();
  assert.equal(await readClipboard(page), '101');

  await page.locator('td.headerBar .headerAuthLevel').evaluate(span => {
    span.textContent = ' AnotherUser';
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('td.headerBar [data-bw-copy="extension"]');
    return !button || button.disabled || button.getAttribute('aria-disabled') === 'true';
  });
  await userButton.click();
  assert.equal(await readClipboard(page), 'AnotherUser');

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'extension';
    input.name = 'extension';
    input.value = '222';
    document.body.append(input);
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('td.headerBar [data-bw-copy="extension"]');
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  });
  await extensionButton.click();
  assert.equal(await readClipboard(page), '222');
  await page.close();
});

test('a user opened from a Users list has the extension shown in that list', async () => {
  const page = await context.newPage();
  const withoutExtension = fixture.replace(
    '<label for="extension">Extension</label><input id="extension" name="extension" value="101">', '');
  const list = `<table><tbody><tr><td class="listHeader">User ID</td><td class="listHeader">Last Name</td>
    <td class="listHeader">Phone Number</td><td class="listHeader">Extension</td></tr>
    <tr id="Row0"><td><a class="tableLink" href="#">ListedUser</a></td><td>Listed</td><td>2055550142</td><td>4417</td></tr>
    </tbody></table>`;
  await page.route('https://apps.avpaas.io/users-list', route => route.fulfill({
    status: 200, contentType: 'text/html', body: withoutExtension.replace('</body>', list + '</body>')
  }));
  await page.route('https://apps.avpaas.io/listed-user', route => route.fulfill({
    status: 200, contentType: 'text/html', body: withoutExtension.replace('QuickStop101', 'ListedUser')
  }));
  await page.goto('https://apps.avpaas.io/users-list', { waitUntil: 'domcontentloaded' });
  await page.locator('#line[data-bw-searchable]').waitFor();
  await page.locator('#Row0 td').nth(1).click();
  await page.goto('https://apps.avpaas.io/listed-user', { waitUntil: 'domcontentloaded' });
  const extensionButton = page.locator('td.headerBar [data-bw-copy="extension"]');
  await extensionButton.waitFor();
  assert.equal(await extensionButton.isEnabled(), true);
  await extensionButton.click();
  assert.equal(await readClipboard(page), '4417');
  await page.close();
});

test('copy controls appear only for a Users breadcrumb', async () => {
  const page = await context.newPage();
  await page.route('https://apps.avpaas.io/group-test', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: fixture.replace('<a class="headerAuthLevelLink">Users</a>',
      '<a class="headerAuthLevelLink">Groups</a>')
  }));
  await page.goto('https://apps.avpaas.io/group-test', { waitUntil: 'domcontentloaded' });
  await page.locator('#line[data-bw-searchable]').waitFor();
  assert.equal(await page.locator('td.headerBar [data-bw-copy]').count(), 0);
  await page.close();
});

test('all options in a large native dropdown remain reachable by scrolling', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    window.selectionEvents = [];
    for (const type of ['input', 'change']) {
      document.querySelector('#line').addEventListener(type, event =>
        window.selectionEvents.push({ type, value: event.target.value }));
    }
  });
  await dropdownTrigger(page, 'line').click();
  assert.equal(await page.locator('.bw-search-input').evaluate(el => document.activeElement === el), true);
  const summary = await page.locator('.bw-search-summary').innerText();
  assert.match(summary, /3501 matching options/);
  assert.doesNotMatch(summary, /first|type more/i);
  assert.ok(await page.locator('.bw-search-result').count() < 50,
    'only visible rows should be mounted');
  const results = page.locator('.bw-search-results');
  await results.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const lastOption = page.locator('.bw-search-result', { hasText: '2056003499 (Birmingham)' });
  await lastOption.waitFor({ state: 'visible' });
  const resultBox = await results.boundingBox();
  const lastBox = await lastOption.boundingBox();
  assert.ok(resultBox && lastBox && lastBox.y < resultBox.y + resultBox.height &&
    lastBox.y + lastBox.height > resultBox.y, 'last option is visible after scrolling');
  await lastOption.click();
  assert.equal(await page.locator('#line').inputValue(), '2056003499');
  assert.deepEqual(await page.evaluate(() => window.selectionEvents), [
    { type: 'input', value: '2056003499' },
    { type: 'change', value: '2056003499' }
  ]);
  await page.close();
});

test('a dropdown with 18,609 matches opens quickly and keeps distant choices reachable', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'huge';
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 18609; index++) {
      fragment.append(new Option(`Service ${String(index).padStart(5, '0')}`, String(index)));
    }
    select.append(fragment);
    document.body.append(select);
  });
  await page.locator('#huge[data-bw-searchable]').waitFor();
  const openMs = await dropdownTrigger(page, 'huge').evaluate(trigger => {
    const started = performance.now();
    trigger.click();
    return performance.now() - started;
  });
  assert.ok(openMs < 1000, `opening 18,609 options took ${openMs.toFixed(0)} ms`);
  assert.match(await page.locator('.bw-search-summary').innerText(), /18609 matching options/);
  assert.ok(await page.locator('.bw-search-result').count() < 50);
  await page.locator('.bw-search-results').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const last = page.locator('.bw-search-result', { hasText: 'Service 18608' });
  await last.waitFor({ state: 'visible' });
  await last.click();
  assert.equal(await page.locator('#huge').inputValue(), '18608');
  await page.close();
});

test('search narrows thousands of native options and selects a late match', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    window.selectionEvents = [];
    for (const type of ['input', 'change']) {
      document.querySelector('#line').addEventListener(type, event =>
        window.selectionEvents.push({ type, value: event.target.value }));
    }
  });
  await dropdownTrigger(page, 'line').click();
  await page.locator('.bw-search-input').fill('2056002999');
  assert.equal(await page.locator('.bw-search-result').count(), 1);
  await page.locator('.bw-search-result').click();
  assert.equal(await page.locator('#line').inputValue(), '2056002999');
  assert.deepEqual(await page.evaluate(() => window.selectionEvents), [
    { type: 'input', value: '2056002999' },
    { type: 'change', value: '2056002999' }
  ]);
  await page.close();
});

test('associated label opens the dropdown search', async () => {
  const page = await openPage();
  await page.locator('label[for="line"]').click();
  const input = page.locator('.bw-search-input');
  await input.waitFor({ state: 'visible' });
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  await page.close();
});

test('required select validity updates after choosing a searched option', async () => {
  const page = await openPage();
  const select = page.locator('#line');
  await select.evaluate(el => { el.required = true; });
  assert.equal(await select.evaluate(el => el.checkValidity()), false);
  await dropdownTrigger(page, 'line').click();
  await page.locator('.bw-search-input').fill('2056002999');
  await page.locator('.bw-search-result').click();
  assert.equal(await select.inputValue(), '2056002999');
  assert.equal(await select.evaluate(el => el.checkValidity()), true);
  await page.close();
});

test('keyboard navigation skips disabled options and Escape closes the search', async () => {
  const page = await openPage();
  const trigger = dropdownTrigger(page, 'keyboard');
  await trigger.focus();
  await trigger.press('ArrowDown');
  const input = page.locator('.bw-search-input');
  await input.waitFor({ state: 'visible' });
  await input.fill('Choice');
  await input.press('ArrowDown');
  await input.press('Enter');
  assert.equal(await page.locator('#keyboard').inputValue(), 'c');
  await trigger.press('Enter');
  await input.waitFor({ state: 'visible' });
  await input.press('Escape');
  assert.equal(await page.locator('.bw-search-popover').isVisible(), false);
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  await page.close();
});

test('Space opens search from the original select without changing its value', async () => {
  const page = await openPage();
  const select = page.locator('#keyboard');
  const trigger = dropdownTrigger(page, 'keyboard');
  await trigger.focus();
  await trigger.press('Space');
  const input = page.locator('.bw-search-input');
  await input.waitFor({ state: 'visible' });
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  assert.equal(await select.inputValue(), 'a');
  await input.press('Escape');
  assert.equal(await select.inputValue(), 'a');
  await page.close();
});

test('selects and options added later are enhanced and refreshed', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'late';
    select.innerHTML = '<option value="first">First</option>';
    document.body.append(select);
  });
  await page.locator('#late[data-bw-searchable]').waitFor();
  await dropdownTrigger(page, 'late').click();
  await page.evaluate(() => {
    document.querySelector('#late').add(new Option('Late addition', 'late'));
  });
  await page.locator('.bw-search-input').fill('Late addition');
  await page.locator('.bw-search-result', { hasText: 'Late addition' }).waitFor();
  await page.locator('.bw-search-result').click();
  assert.equal(await page.locator('#late').inputValue(), 'late');
  await page.close();
});

test('dropdown overlay follows hidden, disabled, and resized controls', async () => {
  const page = await openPage();
  const select = page.locator('#keyboard');
  const trigger = dropdownTrigger(page, 'keyboard');
  await select.evaluate(el => { el.disabled = true; });
  await page.waitForFunction(() => document.querySelector('#keyboard')
    .parentElement.querySelector('.bw-select-trigger').getAttribute('aria-disabled') === 'true');
  assert.equal(await trigger.isDisabled(), true);

  await select.evaluate(el => { el.disabled = false; el.style.display = 'none'; });
  await trigger.waitFor({ state: 'hidden' });

  await select.evaluate(el => { el.style.display = ''; el.style.width = '300px'; });
  await trigger.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const select = document.querySelector('#keyboard');
    const trigger = select.parentElement.querySelector('.bw-select-trigger');
    return Math.abs(select.getBoundingClientRect().width -
      trigger.getBoundingClientRect().width) < 2;
  });
  assert.ok((await trigger.boundingBox()).width >= 298);
  await page.close();
});

test('removing an enhanced select closes its search and leaves no orphan control', async () => {
  const page = await openPage();
  const baselineTriggers = await page.locator('.bw-select-trigger').count();
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'orphan';
    select.setAttribute('aria-label', 'Orphan choice');
    select.innerHTML = '<option>Only option</option>';
    document.body.append(select);
  });
  await page.locator('#orphan[data-bw-searchable]').waitFor();
  assert.equal(await page.locator('.bw-select-trigger').count(), baselineTriggers + 1);
  await dropdownTrigger(page, 'orphan').click();
  await page.locator('.bw-search-popover:visible').waitFor();
  await page.locator('#orphan').evaluate(select => select.remove());
  await page.locator('.bw-search-popover').waitFor({ state: 'hidden' });
  await page.waitForFunction(expected => document.querySelectorAll('.bw-select-trigger').length === expected,
    baselineTriggers);
  assert.equal(await page.locator('.bw-search-toggle').count(), 0);
  await page.close();
});

test('custom listboxes filter options and dynamic menus are enhanced', async () => {
  const page = await openPage();
  const menu = page.locator('#custom');
  const input = menu.locator('.bw-menu-search-input');
  await input.waitFor();
  await input.fill('Dallas');
  assert.equal(await menu.locator('[role="option"]:visible').count(), 1);
  assert.equal(await menu.locator('[role="option"]:visible').innerText(), 'Socius Dallas');
  await input.press('Escape');
  assert.equal(await menu.locator('[role="option"]:visible').count(), 3);
  await page.evaluate(() => {
    const menu = document.createElement('div');
    menu.id = 'late-menu';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = '<div role="option">Alpha</div><div role="option">Beta</div>';
    document.body.append(menu);
  });
  const lateInput = page.locator('#late-menu .bw-menu-search-input');
  await lateInput.waitFor();
  await lateInput.fill('Beta');
  assert.equal(await page.locator('#late-menu [role="option"]:visible').innerText(), 'Beta');
  // The extension's own pick lists (forms.js .cp-dl) already have a Filter field: no second search box.
  await page.evaluate(() => {
    const pick = document.createElement('div');
    pick.className = 'cp-dl';
    pick.innerHTML = '<div class="cp-dl-list" id="pick-list" role="listbox">' +
      '<div class="cp-dl-row" role="option">Alpha</div><div class="cp-dl-row" role="option">Beta</div></div>';
    document.body.append(pick);
    const control = document.createElement('div');
    control.id = 'after-pick';
    control.setAttribute('role', 'listbox');
    control.innerHTML = '<div role="option">One</div><div role="option">Two</div>';
    document.body.append(control);
  });
  await page.locator('#after-pick .bw-menu-search-input').waitFor();
  assert.equal(await page.locator('#pick-list .bw-menu-search').count(), 0);
  await page.close();
});

test('Enter in a custom menu search does not submit its surrounding form', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    window.menuFormSubmissions = 0;
    const form = document.createElement('form');
    form.id = 'menu-form';
    form.action = '/should-not-submit';
    form.innerHTML = '<div role="listbox" id="form-menu">' +
      '<div role="option">Alpha</div><div role="option">Beta</div></div>';
    form.addEventListener('submit', event => {
      event.preventDefault();
      window.menuFormSubmissions += 1;
    });
    document.body.append(form);
  });
  const search = page.locator('#form-menu .bw-menu-search-input');
  await search.waitFor();
  await search.fill('Beta');
  await search.press('Enter');
  assert.equal(await page.evaluate(() => window.menuFormSubmissions), 0);
  assert.equal(await page.locator('#form-menu [role="option"]:visible').innerText(), 'Beta');
  await page.close();
});

test('a dropdown with a “New …” option offers it as a button at the top of its list', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'device';
    select.setAttribute('aria-label', 'Identity/Device Profile Name');
    // As CommPilot lists them: devices by name (some named "New …"), then its own create option, whose value is a code.
    select.innerHTML = ['SMD VVX 21 (Group)', 'New 1148 (Group)', 'New 1270 (Group)', 'ZT VVX 52132 (Group)']
      .map(name => `<option value="${name}">${name}</option>`).join('') + '<option value="New Device">New Identity/Device Profile (Group)</option>';
    select.addEventListener('change', () => { window.deviceChanges = (window.deviceChanges || 0) + 1; });
    document.body.append(select);
  });
  await page.locator('#device[data-bw-searchable]').waitFor();
  await page.locator('#device').locator('xpath=..').locator('.bw-select-trigger').click();
  const create = page.locator('.bw-search-create-btn');
  assert.deepEqual(await create.allInnerTexts(), ['+ New Identity/Device Profile'], 'only CommPilot’s create option, not devices named “New …”');
  assert.equal(await create.getAttribute('title'), 'New Identity/Device Profile (Group)');
  assert.equal(await page.locator('.bw-search-result', { hasText: 'New Identity/Device Profile' }).count(), 1, 'the option stays in the list');
  await create.click();
  assert.equal(await page.locator('#device').inputValue(), 'New Device');
  assert.equal(await page.evaluate(() => window.deviceChanges), 1, 'CommPilot’s own change handler runs, as when the option is picked');
  assert.equal(await page.locator('.bw-search-popover').isHidden(), true);
  // A dropdown without such an option shows no button, nor does a list of names that start with "New".
  await page.locator('#line').locator('xpath=..').locator('.bw-select-trigger').click();
  assert.equal(await page.locator('.bw-search-create-btn').count(), 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const states = document.createElement('select');
    states.id = 'state';
    states.setAttribute('aria-label', 'State/Province');
    states.innerHTML = ['Nevada', 'New Hampshire', 'New Jersey', 'New York'].map(n => `<option value="${n}">${n}</option>`).join('');
    document.body.append(states);
  });
  await page.locator('#state[data-bw-searchable]').waitFor();
  await page.locator('#state').locator('xpath=..').locator('.bw-select-trigger').click();
  assert.equal(await page.locator('.bw-search-create-btn').count(), 0, 'New Jersey is a state, not a way to make one');
  await page.close();
});

test('New Identity/Device Profile stays responsive with 17,270 options, from either control', async t => {
  const page = await openPage();
  try {
    await page.evaluate(() => {
      const select = document.createElement('select');
      select.id = 'device';
      select.setAttribute('aria-label', 'Identity/Device Profile Name');
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 17269; i++) fragment.append(new Option(`Device ${i} (Group)`, String(i)));
      fragment.append(new Option('New Identity/Device Profile (Group)', 'New Device'));
      select.append(fragment);
      const field = document.createElement('input');
      field.id = 'newDeviceName';
      field.hidden = true;
      window.deviceEvents = [];
      for (const type of ['input', 'change']) select.addEventListener(type, () => {
        window.deviceEvents.push(type);
        if (type === 'change') {
          field.hidden = select.value !== 'New Device';
          if (!field.hidden) field.focus();
        }
      });
      document.body.append(select, field);
    });
    await page.locator('#device[data-bw-searchable]').waitFor();
    for (const control of ['button', 'option']) {
      await page.locator('#device').evaluate(select => { select.selectedIndex = 0; });
      await dropdownTrigger(page, 'device').click();
      if (control === 'option') {
        await page.locator('.bw-search-results').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.locator('.bw-search-result', { hasText: 'New Identity/Device Profile' }).waitFor({ state: 'visible' });
      }
      const target = control === 'button' ? page.locator('.bw-search-create-btn') :
        page.locator('.bw-search-result', { hasText: 'New Identity/Device Profile' });
      const elapsed = await target.evaluate(button => new Promise(resolve => {
        const started = performance.now();
        button.click();
        setTimeout(() => resolve(performance.now() - started), 0);
      }));
      t.diagnostic(`${control}: click through next event-loop turn took ${elapsed.toFixed(1)} ms`);
      assert.ok(elapsed < 1000, `${control} blocked the tab for ${elapsed.toFixed(0)} ms`);
      assert.equal(await page.locator('#device').inputValue(), 'New Device');
      assert.equal(await page.locator('#newDeviceName').isVisible(), true, 'the native change handler reveals the new-device fields');
      assert.equal(await page.locator('#newDeviceName').evaluate(el => document.activeElement === el), true,
        'closing the search does not steal focus from the native new-device field');
      assert.equal(await page.locator('.bw-search-popover').isHidden(), true);
    }
    assert.deepEqual(await page.evaluate(() => window.deviceEvents), ['input', 'change', 'input', 'change']);
    const reopenMs = await dropdownTrigger(page, 'device').evaluate(trigger => {
      const started = performance.now();
      trigger.click();
      return performance.now() - started;
    });
    t.diagnostic(`reopening on the final option took ${reopenMs.toFixed(1)} ms`);
    assert.ok(reopenMs < 1000, `opening with the final item selected blocked the tab for ${reopenMs.toFixed(0)} ms`);
    assert.equal(await page.locator('.bw-search-result[aria-selected="true"]').innerText(), 'New Identity/Device Profile (Group)');
  } finally { await page.close(); }
});

test('a long list opens on its current value, not at the top', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'dept';
    select.setAttribute('aria-label', 'Department');
    select.innerHTML = Array.from({ length: 172 }, (_, i) => `<option${i === 120 ? ' selected' : ''}>Department ${i + 1}</option>`).join('');
    document.body.append(select);
  });
  await page.locator('#dept[data-bw-searchable]').waitFor();
  await page.locator('#dept').locator('xpath=..').locator('.bw-select-trigger').click();
  const current = page.locator('.bw-search-result[aria-selected="true"]');
  await current.waitFor();
  assert.equal(await current.innerText(), 'Department 121');
  const inView = await page.evaluate(() => {
    const box = document.querySelector('.bw-search-results').getBoundingClientRect();
    const row = document.querySelector('.bw-search-result[aria-selected="true"]').getBoundingClientRect();
    return row.top >= box.top && row.bottom <= box.bottom;
  });
  assert.equal(inView, true, 'the current value is in view when the list opens');
  await page.keyboard.press('Escape');
  await page.close();
});
