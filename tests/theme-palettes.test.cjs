const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);

test('palette follows stored setting through changes and PJAX shell replacement', async () => {
  assert.ok(edge, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
      let listener;
      window.chrome.storage = {
        local: {
          get: (_, done) => done({}),
          set: (value, done) => {
            listener({ cpThemePalette: { newValue: value.cpThemePalette } }, 'local');
            done();
          }
        },
        onChanged: { addListener: fn => { listener = fn; } }
      };
      window.chrome.runtime = { getURL: path => `chrome-extension://test/${path}` };
      window.__choosePalette = value => listener({ cpThemePalette: { newValue: value } }, 'local');
    });
    await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: `<!doctype html><html><body id="initBody.menuTemplate">
        <table><tr><td class="headerBar"><img src="/conf/clientLogo.gif"></td>
        <td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr></table>
        <table height="100%"><tbody><tr><td class="headandfoot" width="18%">
          <form name="leftNavForm">${['Profile', 'Incoming Calls', 'Outgoing Calls', 'Call Control',
            'Calling Plans', 'Client Applications', 'Messaging', 'Utilities']
              .map(label => `<a class="leftnavfolder" href="#">${label}</a>`).join('')}</form>
        </td><td width="82%" valign="top"><h1 class="screenName">Profile</h1></td></tr></tbody></table>
      </body></html>`
    }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Common/folder_contents.jsp');
    await page.addStyleTag({ path: path.join(root, 'src/content/native-theme.css') });
    await page.addStyleTag({ path: path.join(root, 'src/content/theme-palettes.css') });
    await page.addStyleTag({ path: path.join(root, 'src/content/theme-settings.css') });
    await page.addScriptTag({ path: path.join(root, 'src/content/theme-settings.js') });
    await page.addScriptTag({ path: path.join(root, 'src/content/theme-icons.js') });
    await page.addScriptTag({ path: path.join(root, 'src/content/native-theme.js') });
    const snapshot = () => page.evaluate(() => ({
      palette: document.documentElement.dataset.cpDirection || 'unset',
      background: getComputedStyle(document.body).backgroundColor,
      shellTop: document.body.style.getPropertyValue('--cp-shell-top')
    }));
    await page.waitForFunction(() => document.body.style.getPropertyValue('--cp-shell-top'));
    const initial = await snapshot();
    assert.equal(initial.palette, 'atlas');
    assert.equal(initial.background, 'rgb(237, 242, 247)');
    assert.match(initial.shellTop, /^\d+px$/);
    await page.waitForFunction(() => [...document.querySelectorAll('a.leftnavfolder')]
      .every(link => link.dataset.cpNavIcon &&
        getComputedStyle(link, '::before').backgroundImage.includes('/assets/icons/palette-')));
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('dialog', { name: 'Appearance settings' }).waitFor();
    await page.getByText('Graphite', { exact: true }).click();
    assert.equal((await snapshot()).background, 'rgb(21, 25, 29)');
    assert.equal(await page.locator('#cp-appearance-panel input[value="graphite"]').isChecked(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cp-appearance-panel').isHidden(), true);
    await page.evaluate(() => {
      document.querySelector('#cp-appearance-toggle').parentElement.innerHTML =
        '<a class="headerLink">Help</a><a class="headerLink">Home</a>';
      document.querySelector('form[name="leftNavForm"]').innerHTML =
        ['Profile', 'Incoming Calls', 'Outgoing Calls', 'Call Control', 'Calling Plans',
          'Client Applications', 'Messaging', 'Utilities']
          .map(label => `<a class="leftnavfolder" href="#">${label}</a>`).join('');
      document.dispatchEvent(new Event('cp:morphed'));
    });
    await page.getByRole('button', { name: 'Appearance' }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('a.leftnavfolder')]
      .every(link => link.dataset.cpNavIcon &&
        getComputedStyle(link, '::before').backgroundImage.includes('/assets/icons/palette-')));
    await page.evaluate(() => window.__choosePalette('graphite'));
    assert.equal((await snapshot()).background, 'rgb(21, 25, 29)');
    await page.evaluate(() => window.__choosePalette('terra'));
    assert.equal((await snapshot()).background, 'rgb(235, 230, 220)');
    await page.evaluate(() => window.__choosePalette('nord'));
    assert.deepEqual((await snapshot()).palette, 'nord');
    assert.equal((await snapshot()).background, 'rgb(46, 52, 64)');
    const nordShell = await page.evaluate(() => ({
      direction: document.documentElement.dataset.cpDirection,
      canvas: getComputedStyle(document.body).getPropertyValue('--d-canvas').trim(),
      sidebarRadius: getComputedStyle(document.querySelector('a.leftnavfolder')).borderRadius,
      mainBackgroundImage: getComputedStyle(document.querySelector('td[width="82%"][valign="top"]')).backgroundImage,
      helpIcon: getComputedStyle(document.querySelector('td.headerBar a.headerLink'), '::before').backgroundImage
    }));
    assert.equal(nordShell.direction, 'nord');
    assert.equal(nordShell.canvas, '#2e3440');
    assert.equal(nordShell.sidebarRadius, '13px');
    assert.equal(nordShell.mainBackgroundImage, 'none');
    assert.match(nordShell.helpIcon, /assets\/icons\/palette-help\.svg/);
    await page.evaluate(() => window.__choosePalette('midnight'));
    assert.equal((await snapshot()).palette, 'nord', 'saved Midnight selections migrate to Nord');

    await page.evaluate(() => {
      const shell = document.body.querySelector('table[height="100%"]');
      const spacer = document.createElement('div');
      spacer.style.height = '37px';
      shell.before(spacer);
      document.dispatchEvent(new Event('cp:morphed'));
    });
    await page.waitForTimeout(100);
    const shellState = await page.evaluate(() => ({
      measured: document.body.style.getPropertyValue('--cp-shell-top'),
      actual: document.body.querySelector('table[height="100%"]').getBoundingClientRect().top
    }));
    assert.equal(shellState.measured, `${Math.round(shellState.actual)}px`);
  } finally { await browser.close(); }
});

test('native sidebar separates selected and hovered rows in every palette', async () => {
  assert.ok(edge, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const folders = ['Profile', 'Calling Plans', 'Messaging', 'Utilities'];
    const rows = folders.map((label, index) => `<tr><td class="${index ? 'leftnavfolder' : 'leftnavfolderopen'}">
      <a class="${index ? 'leftnavfolder' : 'leftnavfolderopen'}" data-cp-nav-icon="profile" href="#">${label}</a>
    </td></tr>`).join('');
    await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: `<!doctype html><html data-cp-direction="nord"><body id="initBody.menuTemplate">
        <table height="100%" width="100%"><tr><td class="headandfoot" width="18%">
          <form name="leftNavForm"><b><table width="100%">${rows}</table></b></form>
        </td><td width="82%" valign="top">Profile</td></tr></table>
      </body></html>`
    }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Common/folder_contents.jsp');
    await page.addStyleTag({ path: path.join(root, 'src/content/native-theme.css') });
    await page.addStyleTag({ path: path.join(root, 'src/content/theme-palettes.css') });
    for (const palette of ['nord', 'atlas', 'graphite', 'terra']) {
      await page.evaluate(value => { document.documentElement.dataset.cpDirection = value; }, palette);
      for (const width of [1024, 1280, 1920]) {
        await page.setViewportSize({ width, height: width === 1024 ? 768 : 800 });
        await page.locator('a.leftnavfolder').first().hover();
        const state = await page.evaluate(() => {
          const links = [...document.querySelectorAll('form[name="leftNavForm"] a')];
          const active = links[0], hovered = links[1];
          const gap = hovered.getBoundingClientRect().top - active.getBoundingClientRect().bottom;
          return {
            gap, activeBackground: getComputedStyle(active).backgroundColor,
            hoverBackground: getComputedStyle(hovered).backgroundColor,
            clipped: links.filter(link => link.scrollWidth > link.clientWidth + 2 || link.scrollHeight > link.clientHeight + 2)
              .map(link => link.textContent.trim()),
            overflow: document.documentElement.scrollWidth > innerWidth + 2
          };
        });
        assert.ok(state.gap >= 8, `${palette} ${width}px sidebar gap was ${state.gap}px`);
        assert.notEqual(state.activeBackground, state.hoverBackground, `${palette} active and hover should be distinct`);
        assert.deepEqual(state.clipped, [], `${palette} ${width}px clipped sidebar labels`);
        assert.equal(state.overflow, false, `${palette} ${width}px page overflow`);
      }
    }
  } finally { await browser.close(); }
});

test('extension popup changes the active CommPilot page and keeps the choice in a new tab', async () => {
  assert.ok(edge, 'Edge or Chrome is required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-theme-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: edge,
      headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    await context.route('https://apps-sbx.avpaas.io/commpilot/Common/folder_contents.jsp', route =>
      route.fulfill({ status: 200, contentType: 'text/html',
        headers: { 'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" },
        body:
        `<!doctype html><html><title>Profile</title><body id="initBody.menuTemplate">
          <table><tr><td class="headerBar"><img src="/conf/clientLogo.gif"></td>
            <td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr>
            <tr><td class="headerBar"><span class="headerBarWelcome">Welcome Test User</span></td></tr></table>
          <table height="100%"><tr><td class="headandfoot" width="18%">
            <form name="leftNavForm"><a class="leftnavfolder">Profile</a><a class="leftnavfolder">Incoming Calls</a></form>
          </td><td width="82%" valign="top"><h1 class="screenName">Profile</h1></td></tr></table>
        </body></html>` }));
    await context.route('https://apps-sbx.avpaas.io/commpilot/Login/', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body:
        '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' }));
    async function openApp(target) {
      await target.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
      await target.evaluate(() => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/commpilot/Common/folder_contents.jsp';
        document.body.append(form);
        form.submit();
      });
      await target.waitForFunction(() => document.body.id === 'initBody.menuTemplate');
    }
    const page = await context.newPage();
    await openApp(page);
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'atlas');
    async function assertIconsLoad(palette) {
      await page.waitForFunction(() => {
        const targets = [
          ...document.querySelectorAll('a.leftnavfolder, td.headerBar a.headerLink'),
          document.querySelector('.headerBarWelcome')
        ];
        return targets.length === 5 && targets.every(target =>
          getComputedStyle(target, '::before').backgroundImage.includes('chrome-extension://'));
      });
      const iconLoads = await page.evaluate(async () => {
        const sources = [...document.querySelectorAll('a.leftnavfolder, td.headerBar a.headerLink')]
          .map(link => getComputedStyle(link, '::before').backgroundImage.match(/url\("?([^"\)]+)/)?.[1]);
        sources.push(getComputedStyle(document.querySelector('.headerBarWelcome'), '::before')
          .backgroundImage.match(/url\("?([^"\)]+)/)?.[1]);
        return Promise.all(sources.map(src => new Promise(resolve => {
          const image = new Image();
          image.onload = () => resolve({ src, loaded: image.naturalWidth > 0 });
          image.onerror = () => resolve({ src, loaded: false });
          image.src = src;
        })));
      });
      assert.equal(iconLoads.length, 5);
      assert.ok(iconLoads.every(({ src, loaded }) => src?.startsWith('chrome-extension://') && loaded),
        `${palette} icons must load with CommPilot's CSP: ${JSON.stringify(iconLoads)}`);
    }
    await assertIconsLoad('Atlas');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('dialog', { name: 'Appearance settings' }).getByText('Graphite', { exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'graphite');
    await assertIconsLoad('Graphite');
    const popup = await context.newPage();
    await popup.goto('chrome-extension://gahgpfcnalnjfnlchhlhknidgnpllojg/src/popup/popup.html');
    await popup.locator('input[value="graphite"]:checked').waitFor();
    await popup.locator('label[for="palette-atlas"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'atlas');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(237, 242, 247)');
    await popup.locator('label[for="palette-terra"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'terra');
    const second = await context.newPage();
    await openApp(second);
    await second.waitForFunction(() => document.documentElement.dataset.cpDirection === 'terra');
    assert.equal(await second.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(235, 230, 220)');
    await popup.evaluate(() => new Promise(resolve => chrome.storage.local.set({ cpThemePalette: 'midnight' }, resolve)));
    const legacy = await context.newPage();
    await openApp(legacy);
    await legacy.waitForFunction(() => document.documentElement.dataset.cpDirection === 'nord');
    await popup.waitForFunction(() => new Promise(resolve => chrome.storage.local.get('cpThemePalette', value =>
      resolve(value.cpThemePalette === 'nord'))));
    await popup.locator('input[value="nord"]:checked').waitFor();
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
