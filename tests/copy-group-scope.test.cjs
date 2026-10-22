const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

for (const targetGroup of ['Group A', 'Group B']) {
  test(`a listed extension is adopted only in its own group: ${targetGroup}`, async () => {
    const browser = await chromium.launch({ headless: true, executablePath:
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><body><table><tr><td class="headerBar" id="crumb">' +
        '<a class="headerAuthLevelLink">Provider</a><span class="headerAuthLevel">Group A</span>' +
        '</td></tr></table><table><tr><td class="listHeader">User ID</td><td class="listHeader">Extension</td>' +
        '<td class="listHeader">Phone Number</td></tr><tr id="Row0"><td><a id="open">SharedId</a></td>' +
        '<td>1234</td><td>+44 20 1234 5678</td></tr></table></body>' }));
      await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Members/');
      await page.addScriptTag({ path: path.join(root, 'src/content/enhancer.js') });
      await page.locator('#open').click();
      await page.evaluate(targetGroup => {
        document.querySelector('#crumb').innerHTML =
          '<a class="headerAuthLevelLink">Provider</a><a class="headerAuthLevelLink">' + targetGroup + '</a>' +
          '<a class="headerAuthLevelLink">Users</a><span class="headerAuthLevel">SharedId</span>';
      }, targetGroup);
      const copy = page.getByRole('button', { name: 'Copy Extension', exact: true });
      await copy.waitFor();
      assert.equal(await copy.isDisabled(), targetGroup !== 'Group A');
      const cached = await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('bw-extension:')).map(key => [key, sessionStorage.getItem(key)]));
      if (targetGroup === 'Group A') {
        assert.ok(cached.some(([, value]) => value === '1234'));
        assert.ok(cached.some(([, value]) => value === '442012345678'));
      } else assert.deepEqual(cached, [], 'neither extension nor phone number leaks into another group');
    } finally { await browser.close(); }
  });
}
