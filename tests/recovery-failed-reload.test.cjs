const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(runtime, 'src/content/stubguard.js'), 'utf8');
const origin = 'https://apps-sbx.avpaas.io';
const destination = '/commpilot/User/Addresses/';
const entry = '/commpilot/Group/Members/Modify/index.jsp';

for (const mode of ['network', 'server', 'entity', 'unresolved-loop'])
test(`reloading a paused recovery preserves session handling: ${mode}`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), requests = [], errors = [];
    page.setDefaultTimeout(6000);
    let healthy = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin);
      requests.push(url.pathname);
      if (url.pathname === '/commpilot/servlet/Login') {
        if (!healthy && mode === 'network') return route.abort('connectionreset');
        if (!healthy && mode === 'server') return route.fulfill({ status: 503, body: 'Unavailable' });
        return route.fulfill({ contentType: 'text/html', body:
          '<input name="formtokenserial" value="fresh"><script>redirectPost("/commpilot/Common/folder_contents.jsp",{folder:"G0",menuId:"2"});</script>' });
      }
      if (url.pathname === entry) return route.fulfill({ status: healthy ? 200 : 500, contentType: 'text/html',
        body: healthy ? '<table><tr><td width="82%"><input name="formtokenserial" value="entered"></td></tr></table>' : 'Entity unavailable' });
      return route.fulfill({ contentType: 'text/html', body: '<html><body>Fixture</body></html>' });
    });
    const bootstrap = ({ mode, destination, entry }) => {
      if (!sessionStorage.getItem('fixture-initialized')) {
        sessionStorage.setItem('fixture-initialized', '1');
        sessionStorage.setItem('cp-last-nav', JSON.stringify({ url: destination,
          entry: mode === 'entity' ? { url: entry, params: { key: 'fixture-user' } } : null }));
        if (mode === 'unresolved-loop') {
          sessionStorage.setItem('cp-stub-tries', '2');
          sessionStorage.setItem('cp-stub-tries-at', String(Date.now()));
        }
      }
      window.submissions = [];
      HTMLFormElement.prototype.submit = function () {
        submissions.push({ url: this.action, data: Object.fromEntries(new FormData(this)) });
      };
      addEventListener('message', event => {
        if (event.data?.__cpStubNavQuery)
          postMessage({ __cpStubNavReply: { token: 'stored' } }, location.origin);
      });
    };
    await page.addInitScript({ content: `(${bootstrap.toString()})(${JSON.stringify({ mode, destination, entry })});\n${script}` });
    await page.goto(origin + '/commpilot/Common/styles.css');
    if (mode === 'unresolved-loop') {
      await page.waitForURL('**/commpilot/Login/');
      assert.equal(requests.includes('/commpilot/servlet/Login'), false, 'a genuine unresolved native replay loop remains bounded');
    } else {
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('#cp-recovery-error').waitFor();
        assert.equal(await page.evaluate(() => submissions.length), 0);
        if (!attempt) await page.reload();
      }
      healthy = true;
      await page.reload();
      await page.waitForFunction(() => submissions.length || location.pathname === '/commpilot/Login/');
      assert.equal(requests.includes('/commpilot/Login/'), false,
        'transport or entity-read failures must not masquerade as repeated expired-session replays');
      assert.equal(await page.evaluate(() => submissions[0]?.url), origin + destination);
      assert.equal(await page.evaluate(() => submissions[0]?.data.formtokenserial), mode === 'entity' ? 'entered' : 'fresh');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
