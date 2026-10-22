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
const START = '/commpilot/Reseller/Profile/';
const DND = '/commpilot/User/DND/';

function shell(title, token, body) {
  return `<!doctype html><html><head><title>${title}</title></head><body id="initBody.menuTemplate">
    <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
    <table><tr><td width="82%" valign="top"><form name="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="${token}">
      <table width="100%"><tbody><tr><td class="screenName">${title}</td></tr><tr><td class="enduserbody">${body}</td></tr></tbody></table>
    </form></td></tr></table>
    <script>window.redirectPost = window.redirectPost || function () {};</script></body></html>`;
}

for (const submitMethod of ['submit', 'requestSubmit']) {
  test(`a ${submitMethod} without an action button never stores or replays credential fields`, async () => {
    const browser = await chromium.launch({ executablePath: browserPath, headless: true });
    try {
      const page = await browser.newPage();
      const posts = [];
      const target = '/commpilot/User/Password/';
      const secret = 'fixture-private-value';
      await page.route('https://apps-sbx.avpaas.io/**', route => {
        const req = route.request();
        const pathname = new URL(req.url()).pathname;
        const body = new URLSearchParams(req.postData() || '');
        if (req.method() === 'POST') posts.push({pathname, credential: body.get('newPassword')});
        return route.fulfill({status: 200, contentType: 'text/html', body:
          shell(pathname === target ? 'Password settings' : 'Start', `tok-${posts.length}`,
            pathname === target ? `<input type="password" name="newPassword" value="">` : 'Start page')
            .replace('>Profile</a>', body.has('newPassword') ? '>Security</a>' : '>Profile</a>')});
      });
      await page.goto('https://apps-sbx.avpaas.io' + START);
      await page.evaluate(() => {
        window.recoveryMessages = [];
        addEventListener('message', event => {
          if (event.data?.__cpRecoverNav) window.recoveryMessages.push(event.data.__cpRecoverNav);
        });
      });
      await page.addScriptTag({path: path.join(root, 'src/content/pjax.js')});
      await page.evaluate(url => window.redirectPost(url, {}), target);
      await page.locator('[name="newPassword"]').waitFor();
      const depth = await page.evaluate(() => history.length);
      await page.locator('[name="newPassword"]').fill(secret);
      await page.evaluate(method => document.forms.mainForm[method](), submitMethod);
      await page.waitForFunction(() => document.querySelector('[name="formtokenserial"]').value === 'tok-2');
      assert.equal(await page.evaluate(() => history.length), depth, 'a form save must not add a replayable history step');
      await page.evaluate(url => window.redirectPost(url, {}), DND);
      await page.waitForFunction(() => document.querySelector('[name="formtokenserial"]').value === 'tok-3');
      const persisted = await page.evaluate(() => ({
        state: history.state,
        recovery: sessionStorage.getItem('cp-last-nav'),
        messages: window.recoveryMessages
      }));
      assert.equal(JSON.stringify(persisted).includes(secret), false, 'submitted credential must not enter history or recovery storage');
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/commpilot/User/Password/' &&
        document.querySelector('[name="formtokenserial"]').value === 'tok-4');
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/Profile/' &&
        document.querySelector('[name="formtokenserial"]').value === 'tok-5');
      await page.goForward();
      await page.waitForFunction(() => location.pathname === '/commpilot/User/Password/' &&
        document.querySelector('[name="formtokenserial"]').value === 'tok-7');
      assert.equal(posts.filter(p => p.credential === secret).length, 1, 'Back/Forward must not repeat the save');
      // This fixture changes the sidebar, so Forward first restores its read-only context.
      assert.deepEqual(posts.map(p => p.pathname), [target, target, DND, target, START, DND, target]);
    } finally { await browser.close(); }
  });
}

test('Back after saving a page goes to the page before it and never re-sends a save', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    let splash = false, serial = 0;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      const body = new URLSearchParams(req.postData() || '');
      if (req.method() === 'POST') posts.push({ pathname, apply: body.has('apply'), ringSplash: body.get('ringSplash') });
      if (pathname === DND) {
        if (body.has('apply')) splash = body.get('ringSplash') === 'on';
        return route.fulfill({ status: 200, contentType: 'text/html', body: shell('Do Not Disturb', `tok-${++serial}`,
          `<input type="checkbox" name="ringSplash" id="ringSplash" ${splash ? 'checked' : ''}> Play Ring Reminder
           <input type="submit" name="apply" value="Apply">`) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell('Start', `tok-${++serial}`, 'Start page') });
    });
    await page.goto('https://apps-sbx.avpaas.io' + START, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    const title = () => page.evaluate(() => document.querySelector('td.screenName')?.textContent);
    await page.evaluate(url => window.redirectPost(url, {}), DND);
    await page.waitForFunction(() => document.querySelector('td.screenName')?.textContent === 'Do Not Disturb');
    const depth = await page.evaluate(() => history.length);

    for (const want of [true, false]) {
      await page.locator('#ringSplash').setChecked(want);
      await page.locator('input[name="apply"]').click();
      await page.waitForFunction(w => document.getElementById('ringSplash')?.checked === w &&
        document.getElementsByName('formtokenserial')[0].value !== 'x', want);
      await page.waitForTimeout(300);
      assert.equal(splash, want, 'the Apply saved');
    }
    assert.equal(await page.evaluate(() => history.length), depth, 'saving adds no Back steps');
    assert.equal(await page.evaluate(() => history.state?.cpNav?.params?.apply), undefined, 'the entry holds no save');

    const sent = posts.length;
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('td.screenName')?.textContent === 'Start', null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const after = posts.slice(sent);
    assert.deepEqual(after.map(p => p.pathname), [START], 'Back reopened the page before, and nothing else');
    assert.equal(after.some(p => p.apply), false, 'no save was re-sent');
    assert.equal(splash, false, 'the saved value stayed as last saved');
    assert.equal(await title(), 'Start');
  } finally { await browser.close(); }
});
