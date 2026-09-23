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

test('native login is centered with a collapsed saved sign-ins drawer', async () => {
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
    await page.getByRole('button', { name: 'Add login' }).click();
    await page.getByRole('button', { name: 'Save login' }).click();
    await page.getByText('Enter User ID and Password.').waitFor();
    assert.equal(await page.evaluate(() => window.loginClicks || 0), 0);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('credential bridge accepts only the known HTTPS login page', () => {
  const code = fs.readFileSync(path.join(root, 'src/bg/credential-bridge.js'), 'utf8');
  let handler;
  const forwarded = [];
  const sandbox = {
    URL,
    Set,
    chrome: { runtime: {
      onMessage: { addListener: callback => { handler = callback; } },
      sendNativeMessage: (host, message, callback) => {
        forwarded.push({ host, message });
        callback({ ok: true, found: false });
      }
    } }
  };
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof handler, 'function');
  const reply = [];
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://evil.example/commpilot/Login/' }, result => reply.push(result));
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/User/Profile/' }, result => reply.push(result));
  assert.equal(forwarded.length, 0);
  handler({ kind: 'bwCredential', op: 'list', origin: 'https://evil.example' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/Login/' }, result => reply.push(result));
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].message.origin, 'https://apps-sbx.avpaas.io');
  handler({ kind: 'bwCredential', op: 'add', user: 'test', password: 'secret', pin: '123' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/Login/' }, result => reply.push(result));
  assert.equal(forwarded.length, 1, 'short PIN must never reach the native helper');
  handler({ kind: 'bwCredential', op: 'list' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/Login/' }, result => reply.push(result));
  assert.equal(forwarded.length, 2);
  assert.equal(forwarded[1].message.op, 'list');
});
