const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

async function fixture(blockStorage) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <body id="initBody.menuTemplate"><table><tr><td class="headerBar">
    <span class="headerBarWelcome">Welcome Fixture</span>
    <a class="headerLink" id="sign-out" onclick="window.nativeClicks++;return false">[Logout]</a>
    </td></tr></table><script>window.nativeClicks=0;</script></body>` }));
  await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
  if (blockStorage) await page.evaluate(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Storage is unavailable', 'QuotaExceededError'); };
  });
  await page.addScriptTag({ path: path.resolve(__dirname, '../src/content/logout-confirm.js') });
  return { page, errors, close: () => browser.close() };
}

test('confirmed logout still invokes the native action once when session storage is unavailable', async () => {
  const f = await fixture(true);
  try {
    await f.page.locator('#sign-out').click();
    await f.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    assert.equal(await f.page.evaluate(() => nativeClicks), 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Escape and Stay here preserve the session and return keyboard focus', async () => {
  const f = await fixture(false);
  try {
    await f.page.locator('#sign-out').focus();
    await f.page.keyboard.press('Enter');
    await f.page.keyboard.press('Escape');
    assert.equal(await f.page.getByRole('dialog').count(), 0);
    assert.equal(await f.page.evaluate(() => document.activeElement.id), 'sign-out');
    await f.page.keyboard.press('Space');
    await f.page.getByRole('button', { name: 'Stay here' }).click();
    assert.equal(await f.page.evaluate(() => nativeClicks), 0);
    assert.equal(await f.page.evaluate(() => sessionStorage.getItem('cp-signing-out')), null);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
