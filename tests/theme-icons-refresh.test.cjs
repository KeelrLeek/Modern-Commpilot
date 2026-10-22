const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

async function fixture(withNative = false) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<html data-cp-direction="atlas"><body id="initBody.menuTemplate">
    <form name="leftNavForm"><a class="leftnavfolder" data-cp-nav-icon="profile">Profile</a></form>
    <a id="first" class="listSortHeader">Name<img src="uparrow.gif"></a>
    <a id="second" class="listSortHeader">Number</a>
    </body></html>`);
  await page.evaluate(() => {
    window.chrome = { runtime: { getURL: path => 'https://fixture.invalid/' + path } };
    window.iconPasses = 0;
    window.nativePasses = 0;
    const select = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => {
      if (selector === 'a[data-cp-nav-icon]') iconPasses++;
      if (selector.startsWith('form[name="leftNavForm"]')) nativePasses++;
      return select(selector);
    };
  });
  if (withNative) await page.addScriptTag({ path: path.resolve(__dirname, '../src/content/native-theme.js') });
  await page.addScriptTag({ path: path.resolve(__dirname, '../src/content/theme-icons.js') });
  return { page, close: () => browser.close() };
}
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('sort chevrons follow a changed native direction and move to the new sorted column', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => {
      document.querySelector('#first img').src = 'downarrow.gif';
      document.dispatchEvent(new Event('cp:reskin'));
    });
    await frame(f.page);
    assert.match(await f.page.locator('#first .cp-sort-ico').getAttribute('style'), /sort-desc\.svg/);
    await f.page.evaluate(() => {
      document.querySelector('#second').append(document.querySelector('#first img'));
      document.dispatchEvent(new Event('cp:morphed'));
    });
    await frame(f.page);
    assert.equal(await f.page.locator('#first .cp-sort-ico').count(), 0);
    assert.equal(await f.page.locator('#second .cp-sort-ico').count(), 1);
    assert.match(await f.page.locator('#second img').getAttribute('src'), /downarrow\.gif/);
  } finally { await f.close(); }
});

for (const withNative of [false, true]) test(`one frame coalesces notification bursts (native navigation ${withNative ? 'loaded' : 'absent'})`, async t => {
  const f = await fixture(withNative);
  try {
    await f.page.evaluate(() => {
      iconPasses = 0; nativePasses = 0;
      for (let i = 0; i < 25; i++) {
        for (const name of ['cp:reskin', 'cp:morphed', 'cp:theme-change', 'cp:navigation-decorated'])
          document.dispatchEvent(new Event(name));
      }
    });
    await frame(f.page);
    const passes = await f.page.evaluate(() => iconPasses);
    t.diagnostic(`100 notifications produced ${passes} decoration passes`);
    const nativePasses = await f.page.evaluate(() => window.nativePasses);
    t.diagnostic(`Native navigation decoration passes: ${nativePasses}`);
    if (withNative) assert.equal(nativePasses, 1);
    assert.equal(passes, 1);
    assert.equal(await f.page.locator('.cp-sort-ico').count(), 1);
  } finally { await f.close(); }
});
