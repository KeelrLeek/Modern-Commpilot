const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const target = '/commpilot/User/Authentication/';

for (const mode of ['success', 'prototype-success', 'first-load-error', 'second-load-error', 'initializer-error'])
test(`ordinary native dependencies retain document order (${mode})`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin);
      if (url.pathname === target + 'first.js') {
        await held;
        if (mode === 'first-load-error') return route.abort('failed');
        return route.fulfill({ contentType: 'application/javascript', body:
          "nativeOrder.push('first');window.nativeDependency=function(){return 'new';};" +
          "document.addEventListener('DOMContentLoaded',function(){nativeOrder.push('first-dcl');});" +
          "window.addEventListener('load',function(){nativeOrder.push('load');});" });
      }
      if (url.pathname === target + 'second.js') {
        if (mode === 'second-load-error') return route.abort('failed');
        return route.fulfill({ contentType: 'application/javascript', body:
          "nativeOrder.push('second:'+nativeDependency());window.nextDependency=function(){return 'ready';};" });
      }
      const scripts = url.pathname === target ? `<script src="first.js"></script>
        <script>nativeOrder.push('between:'+nativeDependency());${mode === 'initializer-error' ? "throw Error('fixture initializer failed');" : ''}</script>
        <script src="second.js"></script><script>nativeOrder.push('last:'+nextDependency());
        document.addEventListener('DOMContentLoaded',function(){nativeOrder.push('dcl');});</script>` :
        "<script>window.nativeOrder=[];window.nativeDependency=function(){return 'old';};</script>";
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        ${url.pathname === target ? '<script>window.unrequestedHead=true;</script>' : ''}</head><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
        <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%">
        <form name="mainForm"><input name="username"><button type="button" id="pending-action"
        onclick="nativeOrder.push('native-action')">Apply</button></form>${scripts}</td></tr></table>
        <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>` });
    });
    await page.goto(origin + '/commpilot/User/Profile/');
    if (mode === 'prototype-success') await page.addScriptTag({ path: path.join(__dirname, 'fixtures/commpilot-prototype-1.6.1.js') });
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === target + 'first.js');
    await page.evaluate(target => redirectPost(target, {}), target); await requested;
    await page.waitForTimeout(250);
    const attemptClick = async () => {
      const box = await page.locator('#pending-action').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    await attemptClick();
    assert.deepEqual(await page.evaluate(() => nativeOrder), [], 'inline code waits for its preceding dependency');
    release();
    if (mode.endsWith('success')) {
      await page.waitForFunction(() => nativeOrder.includes('load'));
      assert.deepEqual(await page.evaluate(() => nativeOrder),
        ['first', 'between:new', 'second:new', 'last:ready', 'first-dcl', 'dcl', 'load']);
      await attemptClick();
      assert.equal(await page.evaluate(() => nativeOrder.at(-1)), 'native-action', 'the ready native form becomes interactive');
      assert.deepEqual(errors, []);
    } else {
      const notice = page.locator('.cp-alert-error');
      await notice.waitFor();
      assert.match(await notice.innerText(), /could not initialize|initialization failed/i);
      assert.doesNotMatch(await notice.innerText(), /Voice Management/i);
      await attemptClick();
      assert.deepEqual(await page.evaluate(() => nativeOrder),
        mode === 'first-load-error' ? [] : ['first', 'between:new']);
      assert.deepEqual(errors, mode === 'initializer-error' ? ['fixture initializer failed'] : []);
    }
    assert.equal(await page.evaluate(() => !!window.unrequestedHead), false,
      'ordinary body dependency loading does not activate unrelated head scripts');
  } finally { release(); await browser.close(); }
});
