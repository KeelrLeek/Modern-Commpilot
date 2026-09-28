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
