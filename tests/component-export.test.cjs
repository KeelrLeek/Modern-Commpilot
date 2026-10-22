const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const pjax = process.env.BW_TEST_PJAX_PATH || path.resolve(__dirname, '../src/content/pjax.js');

async function fixture({ status = 200, hold = false, postStatus = 200, noProxy = false, html = false, timeout = false } = {}, check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage();
    if (timeout) await page.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 300000) window.expireExport = () => callback(...args);
        return original(callback, delay, ...args);
      };
    });
    let posts = 0, noticeFirst, deadlineFired = false;
    const first = new Promise(resolve => { noticeFirst = resolve; });
    const downloads = [];
    page.on('download', download => downloads.push(download));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST' && url.searchParams.has('export')) {
        posts++; noticeFirst();
        // Expire only after observing the request. A 100ms wall-clock shortcut
        // can abort before Playwright receives it under parallel test load.
        if (timeout && !deadlineFired) {
          deadlineFired = true;
          await page.evaluate(() => window.expireExport());
        }
        if (hold) await barrier;
        return route.fulfill({ status: postStatus, contentType: 'text/xml', body: noProxy ? '<result>Error</result>' :
          '<result><proxy>https://apps-sbx.avpaas.io/commpilot/download/fixture.zip</proxy></result>' }).catch(() => {});
      }
      if (url.pathname === '/commpilot/download/fixture.zip') return route.fulfill({ status,
        contentType: status === 200 && !html ? 'application/zip' : 'text/html',
        headers: { 'content-disposition': 'attachment; filename="fixture.zip"', ...(status === 302 ? { location: '/commpilot/Login/' } : {}) },
        body: status === 200 ? 'PK-fixture-content' : '<html>Download could not be generated</html>' });
      return route.fulfill({ contentType: 'text/html', body:
        '<html><body><form name="leftNavForm"></form><table><tr><td width="82%">' +
        '<form name="mainForm"><input name="formtokenserial" value="t0">' +
        '<input id="fixture-export" name="export" type="button" value="Export"></form></td></tr></table>' +
        '<script>window.redirectPost=function(){}; document.getElementById("fixture-export").addEventListener("click",function(){' +
        'exportComponent("FixtureDevice","/commpilot","/System/DeviceTypes/Modify","formtokenserial");});</script></body></html>' });
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/System/DeviceTypes/Modify/index.jsp');
    await page.addScriptTag({ path: pjax });
    await check({ page, downloads, first, release, posts: () => posts,
      recover: () => { status=200; postStatus=200; noProxy=false; html=false; hold=false; release(); } });
  } finally { release(); await browser.close(); }
}

for (const status of [403, 404, 503]) test(`component export never downloads an HTTP ${status} error page as a ZIP`,
  () => fixture({ status }, async ({ page, downloads }) => {
    const outcome = Promise.race([
      page.waitForEvent('download', { timeout: 5000 }).then(() => 'download'),
      page.locator('.cp-upload-notice').waitFor({ timeout: 5000 }).then(() => 'notice')
    ]);
    await page.locator('#fixture-export').click();
    assert.equal(await outcome, 'notice');
    assert.equal(downloads.length, 0);
    assert.match(await page.locator('.cp-upload-notice').innerText(), /export|download/i);
    assert.doesNotMatch(await page.locator('.cp-upload-notice').innerText(), /session.*expired|sign in again/i);
  }));

test('repeated component export clicks do not send concurrent token-bearing requests',
  () => fixture({ hold: true }, async ({ page, first, release, posts }) => {
    await page.evaluate(() => { const button=document.querySelector('#fixture-export');button.click();button.click(); });
    await first;
    await page.waitForTimeout(200);
    assert.equal(posts(), 1);
    const downloaded = page.waitForEvent('download');
    release();
    assert.equal((await downloaded).suggestedFilename(), 'fixture.zip');
  }));

test('a successful component export retains the server filename and permits the next export',
  () => fixture({}, async ({ page, posts }) => {
    for (let i=0;i<2;i++) {
      const downloaded = page.waitForEvent('download');
      await page.locator('#fixture-export').click();
      assert.equal((await downloaded).suggestedFilename(), 'fixture.zip');
    }
    assert.equal(posts(), 2);
  }));

for (const [label, options] of [
  ['failed export response', { postStatus: 503 }],
  ['missing download link', { noProxy: true }],
  ['redirected download', { status: 302 }],
  ['HTML response with a success status', { html: true }],
  ['request deadline', { hold: true, timeout: true }]
]) test(`component export releases its operation after ${label} and permits an explicit retry`,
  () => fixture(options, async ({ page, downloads, posts, recover }) => {
    await page.locator('#fixture-export').click();
    await page.locator('.cp-upload-notice').waitFor({ timeout: 5000 });
    assert.equal(downloads.length, 0);
    assert.equal(posts(), 1, 'a failed export is not automatically replayed');
    recover();
    const downloaded = page.waitForEvent('download');
    await page.locator('#fixture-export').click();
    assert.equal((await downloaded).suggestedFilename(), 'fixture.zip');
    assert.equal(posts(), 2, 'the explicit retry acquires and releases the export operation');
  }));
