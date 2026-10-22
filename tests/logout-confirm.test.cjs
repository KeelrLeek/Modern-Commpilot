const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);

test('native Logout confirms once, allows an explicit retry after HTTP failure, and opens Login directly', async () => {
  assert.ok(edge, 'Edge or Chrome is required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-logout-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: edge,
      headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    let logoutPosts = 0, logoutStatus = 503;
    const navigations = [];
    await context.route('https://apps-sbx.avpaas.io/commpilot/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/commpilot/Common/folder_contents.jsp') {
        return route.fulfill({ status: 200, contentType: 'text/html', body:
          `<!doctype html><html><title>Profile</title><body id="initBody.menuTemplate">
            <table><tr><td class="headerBar"><img src="/conf/clientLogo.gif"></td>
              <td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr>
              <tr><td class="headerBar"><span class="headerAuthLevel">Profile</span></td><td class="headerBar"><span class="headerBarWelcome">Welcome Test User</span>
              <a class="headerLink" id="native-logout" onclick="redirectPost('/commpilot/servlet/Logout', {});return false;">[Logout]</a></td></tr></table>
            <table height="100%"><tr><td class="headandfoot" width="18%">
              <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form>
            </td><td width="82%" valign="top"><h1 class="screenName">Profile</h1></td></tr></table>
            <input name="formtokenserial" value="test-token">
            <script>function redirectPost(url) {
              const form = document.createElement('form'); form.method='POST'; form.action=url;
              document.body.append(form); form.submit();
            }</script>
          </body></html>` });
      }
      if (url.pathname === '/commpilot/servlet/Logout') {
        if (route.request().method() === 'POST') logoutPosts++;
        return route.fulfill({ status: logoutStatus, contentType: 'text/html', body:
          '<!doctype html><title>Logout</title><body>Legacy logout page</body>' });
      }
      if (url.pathname === '/commpilot/Login/') {
        return route.fulfill({ status: 200, contentType: 'text/html', body:
          '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.evaluate(() => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/commpilot/Common/folder_contents.jsp';
      document.body.append(form);
      form.submit();
    });
    await page.waitForFunction(() => document.body.id === 'initBody.menuTemplate');
    await page.waitForFunction(() => String(window.redirectPost).includes('cpDclSpin'));
    // The page this tab would reopen after signing back in, inside a service provider.
    const lastNav = JSON.stringify({ url: '/commpilot/ServiceProvider/Profile/', params: {},
      entry: { url: '/commpilot/Reseller/ServiceProviders/Modify/', params: { key: 'Fixture_SP' } } });
    await page.evaluate(nav => sessionStorage.setItem('cp-last-nav', nav), lastNav);
    // Sign out lives in the top bar's account menu; it presses CommPilot's own Logout link (hidden in the page).
    assert.equal(await page.locator('#native-logout').isVisible(), false);
    const trigger = { click: async () => {
      await page.locator('#cp-account').click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
    } };
    await trigger.click();
    await page.getByRole('dialog', { name: 'Sign out of CommPilot?' }).waitFor();
    await page.getByRole('button', { name: 'Stay here' }).click();
    assert.equal(logoutPosts, 0);
    assert.equal(new URL(page.url()).pathname, '/commpilot/Common/folder_contents.jsp');

    await trigger.click();
    await page.getByRole('dialog', { name: 'Sign out of CommPilot?' })
      .getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Retry sign out', exact: true }).waitFor();
    assert.equal(logoutPosts, 1);
    assert.equal(new URL(page.url()).pathname, '/commpilot/Common/folder_contents.jsp');
    assert.match(await page.locator('.cp-native-logout-copy').innerText(), /HTTP 503/);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-last-nav')), lastNav,
      'a sign-out that did not happen keeps the page Reload recovers');
    logoutStatus = 200;
    await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
    await page.waitForURL('**/commpilot/Login/', { timeout: 15000 });
    assert.equal(logoutPosts, 2);
    assert.equal(navigations.includes('/commpilot/servlet/Logout'), false);
    assert.equal(await page.title(), 'Login');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cp-signing-out')), null);
    // A deliberate sign-out forgets the place to return to, so the next sign-in in this tab (possibly another
    // saved account) starts at home instead of opening the previous session's service provider.
    assert.deepEqual(await page.evaluate(() => ['cp-last-nav', 'cp-pending-return']
      .map(key => sessionStorage.getItem(key))), [null, null]);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
