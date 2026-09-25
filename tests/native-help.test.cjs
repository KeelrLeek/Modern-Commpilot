const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const root = path.resolve(__dirname, '..');

test('contextual Help explains native menu items and survives a PJAX sidebar swap', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const help = fs.readFileSync(path.join(root, 'assets/help/help-content.json'), 'utf8');
    const shell = `<!doctype html><html><body>
      <div class="sidebar"><form name="leftNavForm">
        <a class="leftnavfolder" href="#">Profile</a>
        <a class="navMenuItem" name="/Reseller/Groups/" href="#">Groups</a>
      </form></div>
      <a id="native-help" href="#">Help</a>
      <script>window.nativeHelpClicks = 0;
        document.getElementById('native-help').onclick = () => window.nativeHelpClicks++;</script>
    </body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: route.request().url().endsWith('help-content.json')
        ? 'application/json' : 'text/html',
      body: route.request().url().endsWith('help-content.json') ? help : shell }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Reseller/Groups/');
    await page.evaluate(() => {
      globalThis.chrome.runtime = { getURL: () =>
        'https://apps-sbx.avpaas.io/help-content.json' };
    });
    await page.addStyleTag({ path: path.join(root, 'src/content/native-help.css') });
    await page.addScriptTag({ path: path.join(root, 'src/content/native-help.js') });
    const toggle = page.locator('#cp-native-help-toggle');
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await page.locator('a.navMenuItem').hover();
    await page.locator('#cp-native-help-tip:not([hidden])').waitFor();
    assert.match(await page.locator('#cp-native-help-tip').innerText(), /A Group is the site\/location level/);
    await page.locator('#native-help').click();
    assert.equal(await page.evaluate(() => window.nativeHelpClicks), 1);
    await page.evaluate(() => {
      document.querySelector('.sidebar').innerHTML = `<form name="leftNavForm">
        <a class="leftnavfolder" href="#">Profile</a>
        <a class="navMenuItem" name="/Reseller/Groups/" href="#">Groups</a>
      </form>`;
      document.dispatchEvent(new Event('cp:reskin'));
    });
    await page.locator('#cp-native-help-toggle').waitFor();
    assert.equal(await page.locator('#cp-native-help-toggle').count(), 1);
    assert.equal(await page.locator('#cp-native-help-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('a.leftnavfolder').hover();
    await page.locator('#cp-native-help-tip:not([hidden])').waitFor();
    assert.match(await page.locator('#cp-native-help-tip').innerText(), /Profile/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cp-native-help-toggle').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => {
      history.replaceState(null, '', '/commpilot/Group/CompanyDir/');
      document.dispatchEvent(new Event('cp:reskin'));
    });
    await page.waitForFunction(() => !document.getElementById('cp-native-help-toggle'));
    await page.evaluate(() => {
      history.replaceState(null, '', '/commpilot/Reseller/Groups/');
      document.dispatchEvent(new Event('cp:reskin'));
    });
    await page.locator('#cp-native-help-toggle').waitFor();
  } finally { await browser.close(); }
});
