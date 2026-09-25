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
        local: { get: (_, done) => done({ cpThemePalette: 'atlas' }) },
        onChanged: { addListener: fn => { listener = fn; } }
      };
      window.__choosePalette = value => listener({ cpThemePalette: { newValue: value } }, 'local');
    });
    await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: `<!doctype html><html><body id="initBody.menuTemplate">
        <table><tr><td class="headerBar"><img src="/conf/clientLogo.gif"></td></tr></table>
        <table height="100%"><tbody><tr><td class="headandfoot" width="18%">
          <form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
        </td><td width="82%" valign="top"><h1 class="screenName">Profile</h1></td></tr></tbody></table>
      </body></html>`
    }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Common/folder_contents.jsp');
    await page.addStyleTag({ path: path.join(root, 'src/content/native-theme.css') });
    await page.addStyleTag({ path: path.join(root, 'src/content/theme-palettes.css') });
    await page.addScriptTag({ path: path.join(root, 'src/content/theme-settings.js') });
    const snapshot = () => page.evaluate(() => ({
      palette: document.documentElement.dataset.cpDirection || 'midnight',
      background: getComputedStyle(document.body).backgroundColor,
      shellTop: document.body.style.getPropertyValue('--cp-shell-top')
    }));
    await page.waitForFunction(() => document.body.style.getPropertyValue('--cp-shell-top'));
    const initial = await snapshot();
    assert.equal(initial.palette, 'atlas');
    assert.equal(initial.background, 'rgb(237, 242, 247)');
    assert.match(initial.shellTop, /^\d+px$/);
    await page.evaluate(() => window.__choosePalette('graphite'));
    assert.equal((await snapshot()).background, 'rgb(21, 25, 29)');
    await page.evaluate(() => window.__choosePalette('terra'));
    assert.equal((await snapshot()).background, 'rgb(235, 230, 220)');
    await page.evaluate(() => window.__choosePalette('midnight'));
    assert.deepEqual((await snapshot()).palette, 'midnight');
    assert.equal((await snapshot()).background, 'rgb(11, 21, 37)');

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
      route.fulfill({ status: 200, contentType: 'text/html', body:
        `<!doctype html><html><title>Profile</title><body id="initBody.menuTemplate">
          <table><tr><td class="headerBar"><img src="/conf/clientLogo.gif"></td></tr></table>
          <table height="100%"><tr><td class="headandfoot" width="18%">
            <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form>
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
    const popup = await context.newPage();
    await popup.goto('chrome-extension://gahgpfcnalnjfnlchhlhknidgnpllojg/src/popup/popup.html');
    await popup.locator('input[value="midnight"]:checked').waitFor();
    await popup.locator('label[for="palette-atlas"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'atlas');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(237, 242, 247)');
    await popup.locator('label[for="palette-terra"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'terra');
    const second = await context.newPage();
    await openApp(second);
    await second.waitForFunction(() => document.documentElement.dataset.cpDirection === 'terra');
    assert.equal(await second.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(235, 230, 220)');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
