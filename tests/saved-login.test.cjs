const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const helperExe = path.join(process.env.LOCALAPPDATA || '', 'BroadWorksEnhancer', 'CredentialHost', 'BroadWorksCredentialHost.exe');
const enabled = process.platform === 'win32' && fs.existsSync(edge) && fs.existsSync(helperExe);
const origin = 'https://apps-sbx.avpaas.io';

function host(message) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperExe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error('Native helper exited with code ' + code));
      const bytes = Buffer.concat(chunks);
      if (bytes.length < 4) return reject(new Error('Native helper returned no message'));
      resolve(JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32LE(0)).toString('utf8')));
    });
    const payload = Buffer.from(JSON.stringify({ origin, ...message }), 'utf8');
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);
    child.stdin.end(frame);
  });
}

test('saved login supports PIN sign-in and removal through the browser', { skip: !enabled }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-saved-test-'));
  const username = 'codex-dummy-' + Date.now();
  const secret = 'disposable-test-password';
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: edge,
      headless: true,
      viewport: { width: 1200, height: 850 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    await context.route(origin + '/commpilot/Login/', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><body id="loginBody"><form name="loginForm">
        <table width="800" height="460">
          <tr><td><input name="EnteredUserID"></td></tr>
          <tr><td><input type="password" name="Password"></td></tr>
          <tr><td><input type="checkbox" name="rememberPass">Remember Password</td></tr>
          <tr><td class="logintext3"><a onclick="window.submitted={user:document.loginForm.EnteredUserID.value,password:document.loginForm.Password.value}">Login</a></td></tr>
        </table></form></body>`
    }));
    const page = await context.newPage();
    await page.goto(origin + '/commpilot/Login/');
    await page.getByRole('button', { name: 'Saved sign-ins' }).click();
    await page.getByRole('button', { name: 'Add login' }).click();
    await page.getByLabel('User ID').fill(username);
    await page.getByLabel('Password').fill(secret);
    await page.getByLabel('Quick PIN (optional)').fill('2468');
    await page.getByRole('button', { name: 'Save login' }).click();
    await page.getByRole('button', { name: username }).waitFor();
    await page.getByRole('button', { name: username }).click();
    await page.getByLabel('Quick PIN', { exact: true }).fill('1111');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Incorrect PIN').waitFor();
    assert.equal(await page.evaluate(() => window.submitted || null), null);
    await page.getByLabel('Quick PIN', { exact: true }).fill('2468');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForFunction(() => !!window.submitted);
    assert.deepEqual(await page.evaluate(() => window.submitted), { user: username, password: secret });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: username }).waitFor({ state: 'detached' });
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
    const result = await host({ op: 'list' });
    for (const account of result.profiles || []) {
      if (account.user === username) await host({ op: 'remove', id: account.id });
    }
  }
});
