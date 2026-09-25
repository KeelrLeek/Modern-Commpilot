const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);

test('native login is centered with saved sign-ins and no setup password', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-login-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    await context.route('https://apps-sbx.avpaas.io/commpilot/Login/', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><body id="loginBody" bgcolor="#FFFFFF"><br>
        <form name="loginForm" method="post" action="/commpilot/servlet/Login">
          <table width="800" height="460"><tr><td><input name="EnteredUserID"></td></tr>
          <tr><td><input name="Password" type="password"></td></tr>
          <tr><td class="logintext2"><input name="rememberPass" type="checkbox">Remember Password</td></tr>
          <tr><td class="logintext3"><a id="native-login" onclick="window.loginClicks=(window.loginClicks||0)+1">Login</a></td></tr></table>
        </form></body>`
    }));
    const page = await context.newPage();
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.locator('.bw-saved-trigger').waitFor();
    const photoUrl = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--cp-login-photo').match(/url\("([^"]+)"\)/)?.[1]);
    assert.match(photoUrl, /^chrome-extension:\/\/.*\/assets\/login\/comm-pilot-women-transparent\.png$/);
    const photoSize = await page.evaluate(url => new Promise((resolve, reject) => {
      const photo = new Image();
      photo.onload = () => resolve([photo.naturalWidth, photo.naturalHeight]);
      photo.onerror = () => reject(new Error('Transparent login photo did not load'));
      photo.src = url;
    }), photoUrl);
    assert.deepEqual(photoSize, [354, 263]);
    const photoFile = fs.readFileSync(path.join(root, 'assets/login/comm-pilot-women-transparent.png'));
    assert.equal(photoFile[25], 6, 'PNG must have an alpha channel');
    const box = await page.locator('form[name="loginForm"]').boundingBox();
    assert.ok(Math.abs(box.x - 200) <= 1, `login form x=${box.x}`);
    assert.ok(Math.abs(box.y - (900 - box.height) / 2) <= 1, `login form y=${box.y}`);
    assert.equal(await page.locator('#native-login').count(), 1);
    assert.equal(await page.locator('input[name="rememberPass"]').count(), 0);
    assert.equal(await page.locator('.bw-login-auto-choice').count(), 0);
    assert.equal(await page.locator('.bw-saved-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => window.loginClicks || 0), 0);
    await page.locator('.bw-saved-trigger').focus();
    await page.keyboard.press('Enter');
    await page.locator('.bw-saved-panel').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Add login' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create vault' }).count(), 0);
    assert.equal(await page.evaluate(() => window.loginClicks || 0), 0);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('encrypted vault accepts requests only from the known HTTPS login page', () => {
  const code = fs.readFileSync(path.join(root, 'src/bg/credential-bridge.js'), 'utf8');
  let handler;
  const sandbox = {
    URL, Set, TextEncoder, TextDecoder,
    chrome: { runtime: {
      onMessage: { addListener: callback => { handler = callback; } }
    } }
  };
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof handler, 'function');
  const reply = [];
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://evil.example/commpilot/Login/' }, result => reply.push(result));
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/User/Profile/' }, result => reply.push(result));
  handler({ kind: 'bwCredential', op: 'unrecognized' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/Login/' }, result => reply.push(result));
  assert.equal(reply.length, 3);
  assert.ok(reply.every(result => result.ok === false));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.permissions.includes('nativeMessaging'), false);
});
