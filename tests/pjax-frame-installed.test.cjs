const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extension = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.join(__dirname, '..'));
const origin = 'https://apps-sbx.avpaas.io';
const home = '/commpilot/Reseller/Profile/';
const sp = '/commpilot/Reseller/ServiceProviders/Modify/index.jsp';
const group = '/commpilot/ServiceProvider/Members/Modify/index.jsp';
const user = '/commpilot/Group/Members/Modify/index.jsp';
// Each level's own folders, as in CommPilot: pjax.js keeps a sidebar whose folder names have not changed.
const folders = { R: ['Profile', 'Resources'], S: ['Profile', 'Resources', 'Utilities'], G: ['Profile', 'Resources', 'Calling Plans'],
  U: ['Profile', 'Incoming Calls', 'Call Control'] };
const menuIds = { R: 8, S: 2, G: 1, U: 0 };

// CommPilot's shell with a menu board: Help/Home and the trail in the header, "- On"/"- Off" options, the page's own
// inline script and, on the entries, two native selects. pjax.js loads the S/G/U entries and their folders through
// its hidden sandboxed frame, which Chrome also gives the extension's all-frames content scripts.
function html(state, title, folderIndex, selects) {
  const trail = ['Reseller'];
  if (state.level !== 'R') trail.push('Acme SP');
  if (state.level === 'U') trail.push(state.group, 'Users');
  const entity = state.level === 'G' ? state.group : state.level === 'U' ? state.user : '';
  const side = folders[state.level].map((label, i) => {
    const cls = i === folderIndex ? 'leftnavfolderopen' : 'leftnavfolder';
    return `<tr><td class="${cls}"><a class="${cls}" href="#" data-cp-folder="${state.level}${i}" data-cp-menuid="${menuIds[state.level]}">${label}</a></td></tr>`;
  }).join('');
  const items = [0, 1, 2].map(i => `<tr><td><a class="navMenuItem" href="#" onclick="redirectPost('/commpilot/User/Profile/',{});return false;">` +
    `Option ${i}${['', ' - On', ' - Off'][i]}</a></td></tr><tr><td class="tip">Configure option ${i}.</td></tr>`).join('');
  const native = selects ? '<select name="first"><option>One</option><option selected>Two</option></select>' +
    '<select name="second"><option selected>Red</option><option>Blue</option></select>' : '';
  return `<!doctype html><html><head><title>${title}</title></head><body id="initBody.menuTemplate">` +
    `<table><tr><td class="headerBar"><a class="headerLink" href="#">Help</a> <a class="headerLink" href="#">Home</a></td>` +
    `<td class="headerBar"><span class="headerBarWelcome">Welcome Jane Admin</span> <a href="#">Logout</a></td></tr>` +
    `<tr><td class="headerBar" colspan="2">${trail.map(n => `<a class="headerAuthLevelLink">${n}</a>`).join(' &gt; ')}` +
    `${entity ? ` : <span class="headerAuthLevel">${entity}</span>` : ''}</td></tr></table>` +
    `<table><tr><td valign="top"><form name="leftNavForm"><table><tr><td class="navOptions">Options:</td></tr>${side}</table></form></td>` +
    `<td width="82%" valign="top"><form name="mainForm" method="post"><input name="formtokenserial" value="t-${++state.token}" type="hidden">` +
    `<table><tr><td class="screenName">${title}</td></tr><tr><td class="enduserbody"><table><tr><td class="menuCategory">Basic</td></tr>` +
    `${items}</table>${native}</td></tr></table></form></td></tr></table>` +
    '<script>window.redirectPost=window.redirectPost||function(){};</script></body></html>';
}

test('pjax.js’s hidden transport frames run none of the extension, so the page gets CommPilot’s own markup', { timeout: 120000 }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-frame-installed-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: { width: 1300, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['ruleset_1'] });
      await chrome.storage.local.set({ cpThemePalette: 'graphite', cpSettings: { peek: false } });
    });
    const state = { level: 'R', group: '', user: '', token: 0 };
    const frameScripts = { documents: 0, own: 0 };
    let inflight = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return route.continue();
      if (url.origin !== origin) return route.abort('blockedbyclient');
      inflight++;
      try {
        const data = new URLSearchParams(request.postData() || '');
        const folder = /^([RSGU])(\d+)$/.exec(data.get('folder') || '');
        let title = 'Reseller Profile', index = 0, entry = false;
        if (url.pathname === sp) { Object.assign(state, { level: 'S', group: '', user: '' }); title = 'Service Provider Profile'; entry = true; }
        else if (url.pathname === group) { Object.assign(state, { level: 'G', group: data.get('key').split('>%').at(-1), user: '' }); title = 'Group Profile'; entry = true; }
        else if (url.pathname === user) { Object.assign(state, { level: 'U', user: data.get('key').split('>%').at(-1) }); title = 'User Profile'; entry = true; }
        else if (folder) { if (folder[1] === 'R') Object.assign(state, { level: 'R', group: '', user: '' }); title = 'Menu'; index = Number(folder[2]); }
        const body = html(state, title, index, entry);
        let framed = false;
        try { framed = !!request.frame().parentFrame(); } catch (_) {}
        if (framed) {
          frameScripts.documents++;
          frameScripts.own += (body.match(/<script\b|\sonclick=/g) || []).length;   // the page's own, blocked by the sandbox
        }
        return await route.fulfill({ status: 200, contentType: 'text/html', body });
      } finally { inflight--; }
    });
    const page = await context.newPage();
    const errors = [];
    let blocked = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/Blocked script execution/.test(message.text())) blocked++; });
    // What pjax.js reads from each frame: it serializes the frame's document and parses it in the page.
    await page.addInitScript(() => {
      window.redirectPost = () => {};
      if (window.top !== window) return;
      window.frameDocuments = [];
      const parse = DOMParser.prototype.parseFromString;
      DOMParser.prototype.parseFromString = function (markup, type) {
        if (/initBody\.menuTemplate/.test(markup)) window.frameDocuments.push(String(markup));
        return parse.call(this, markup, type);
      };
    });
    await page.goto(origin + home);
    await page.locator('button.cp-bc-history').waitFor({ timeout: 20000 });
    const settle = async () => { for (let quiet = 0; quiet < 6;) { await page.waitForTimeout(50); quiet = inflight ? 0 : quiet + 1; } };
    const open = async (url, params) => {
      const before = state.token;
      await page.evaluate(({ url, params }) => window.redirectPost(url, params), { url, params });
      await page.waitForFunction(({ url, before }) => location.pathname === url && document.documentElement.dataset.cpNav !== 'busy' &&
        document.querySelector('input[name="formtokenserial"]')?.value !== 't-' + before, { url, before }, { timeout: 30000 });
      await settle();
    };
    await page.evaluate(() => { window.frameDocuments = []; });
    await open(sp, { key: 'Acme SP' });
    await open(group, { key: 'Acme SP>%Group A' });
    await open(user, { key: 'Acme SP>%Group A>%alice@x.example' });

    const parsed = await page.evaluate(() => window.frameDocuments);
    assert.ok(frameScripts.documents >= 3 && parsed.length >= 3, `the entries came through the frame (${frameScripts.documents}, ${parsed.length})`);
    const marks = ['cp-appearance-toggle', 'cp-side-menu', 'id="cp-account"', 'id="cp-fonts"', 'cp-board-icons', 'bw-on-off-status', 'bw-select-shell'];
    const leaked = marks.filter(mark => parsed.some(markup => markup.includes(mark)));
    assert.deepEqual(leaked, [], 'no extension markup in what the frames hand to the page');
    assert.ok(blocked <= frameScripts.own, `only the page’s own scripts are blocked in the frames (${blocked} of ${frameScripts.own})`);

    // The page itself is enhanced once: one dropdown per native select, and it opens; the options' On/Off still show.
    const content = await page.evaluate(() => {
      const cell = document.querySelector('td[width="82%"]');
      return { selects: cell.querySelectorAll('select').length, shells: cell.querySelectorAll('.bw-select-shell').length,
        triggers: cell.querySelectorAll('.bw-select-trigger').length, nested: cell.querySelectorAll('.bw-select-shell .bw-select-shell').length,
        onOff: cell.querySelectorAll('a.navMenuItem .bw-on-off-status').length > 0,
        nestedOnOff: cell.querySelectorAll('.bw-on-off-status .bw-on-off-status').length,
        toggles: document.querySelectorAll('#cp-appearance-toggle').length, sideMenus: document.querySelectorAll('.cp-side-menu').length };
    });
    assert.deepEqual(content, { selects: 2, shells: 2, triggers: 2, nested: 0, onOff: true, nestedOnOff: 0, toggles: 1, sideMenus: 1 });
    const box = await page.locator('td[width="82%"] .bw-select-trigger').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.bw-search-popover').waitFor({ state: 'visible', timeout: 3000 });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
