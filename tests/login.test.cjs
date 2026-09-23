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

test('native login form is centered and requires credentials before saving', async () => {
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
          <tr><td class="logintext3"><a id="native-login">Login</a></td></tr></table>
        </form></body>`
    }));
    const page = await context.newPage();
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.locator('.bw-login-auto-choice').waitFor();
    const box = await page.locator('form[name="loginForm"]').boundingBox();
    assert.ok(Math.abs(box.x - 200) <= 1, `login form x=${box.x}`);
    assert.ok(Math.abs(box.y - 220) <= 1, `login form y=${box.y}`);
    assert.equal(await page.locator('#native-login').count(), 1);
    await page.locator('.bw-login-auto-choice input').click();
    assert.equal(await page.locator('.bw-login-auto-choice input').isChecked(), false);
    await page.getByText('Enter User ID and Password first.').waitFor();
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
  handler({ kind: 'bwCredential', op: 'get' },
    { tab: {}, url: 'https://evil.example/commpilot/Login/' }, result => reply.push(result));
  handler({ kind: 'bwCredential', op: 'get' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/User/Profile/' }, result => reply.push(result));
  assert.equal(forwarded.length, 0);
  handler({ kind: 'bwCredential', op: 'get', origin: 'https://evil.example' },
    { tab: {}, url: 'https://apps-sbx.avpaas.io/commpilot/Login/' }, result => reply.push(result));
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].message.origin, 'https://apps-sbx.avpaas.io');
});
