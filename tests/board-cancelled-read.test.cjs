const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const folder = '/commpilot/Common/folder_contents.jsp';
const destination = '/commpilot/Reseller/Test/';

test('leaving a reseller board retains the token from its cancelled folder read', async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage(), posts = [], errors = [], badTokens = [];
    page.setDefaultTimeout(6000);
    let token = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin);
      const data = new URLSearchParams(request.postData() || '');
      if (request.method() === 'POST') {
        posts.push({ path: url.pathname, folder: data.get('folder') });
        if (data.get('formtokenserial') !== 'fixture-' + token) {
          badTokens.push(url.pathname);
          return route.fulfill({ status: 409, body: 'Fixture rejected a stale token' });
        }
      }
      const body = `<!doctype html><html><body>
        <form name="leftNavForm"><a class="leftnavfolderopen" data-cp-folder="R0" data-cp-menuid="8">Profile</a>
        <a class="leftnavfolder" data-cp-folder="R1" data-cp-menuid="8">Resources</a></form>
        <input name="formtokenserial" value="fixture-${++token}">
        <table><tr><td width="82%" valign="top">${url.pathname === destination ? '<div id="destination">Ready</div>' :
        `<table><tr><td class="menuCategory">Basic</td></tr><tr><td><a class="navMenuItem" name="/Reseller/Test/"
        onclick="redirectPost('${destination}',{})">Test option</a></td></tr><tr><td>Fixture description</td></tr></table>`}
        </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
      if (data.get('folder') === 'R1') await held;
      return route.fulfill({ contentType: 'text/html', body });
    });
    await page.goto(origin + folder);
    const backgroundRead = page.waitForRequest(request => new URLSearchParams(request.postData() || '').get('folder') === 'R1');
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await backgroundRead;
    await page.evaluate(url => redirectPost(url, {}), destination);
    await page.waitForTimeout(100);
    assert.equal(posts.filter(post => post.path === destination).length, 0, 'navigation drains the outstanding board read');
    release();
    try {
      await page.waitForFunction(() => document.querySelector('#destination') || document.querySelector('.cp-upload-notice'));
    } catch (error) {
      assert.deepEqual(badTokens, [], 'the cancelled folder read must still refresh the token');
      throw error;
    }
    assert.deepEqual(badTokens, [], 'the cancelled folder read must still refresh the token');
    assert.equal(await page.locator('#destination').innerText(), 'Ready');
    assert.equal(posts.filter(post => post.path === destination).length, 1);
    assert.ok(posts.every(post => !/(?:Login|Logout)/i.test(post.path)));
    assert.deepEqual(errors, []);
  } finally { release(); await browser.close(); }
});
