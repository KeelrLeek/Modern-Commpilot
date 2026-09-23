const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const origin = 'https://apps-sbx.avpaas.io';

test('encrypted vault stores ciphertext and supports PIN sign-in', { skip: !fs.existsSync(edge) }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-vault-test-'));
  const username = 'codex-dummy-' + Date.now();
  const secret = 'disposable-test-password';
  const vaultPassword = 'test only strong vault passphrase 2026';
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
    await page.getByLabel('Vault password', { exact: true }).fill(vaultPassword);
    await page.getByLabel('Confirm vault password').fill(vaultPassword);
    await page.getByRole('button', { name: 'Create vault' }).click();
    await page.getByRole('button', { name: 'Add login' }).click();
    await page.getByLabel('User ID').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(secret);
    await page.getByLabel('Quick PIN (optional)').fill('2468');
    await page.getByRole('button', { name: 'Save login' }).click();
    await page.getByRole('button', { name: username }).waitFor();

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const stored = await worker.evaluate(() => new Promise(resolve =>
      chrome.storage.local.get('bwEncryptedVaultV1', resolve)));
    const diskValue = JSON.stringify(stored);
    assert.ok(stored.bwEncryptedVaultV1?.data, 'vault ciphertext must be persisted');
    for (const value of [username, secret, vaultPassword, '2468']) {
      assert.equal(diskValue.includes(value), false, 'plaintext must not appear in storage');
    }

    await page.getByRole('button', { name: 'Lock saved sign-ins' }).click();
    await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
    await page.getByLabel('Vault password', { exact: true }).fill('incorrect vault password');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByText('Incorrect vault password.').waitFor();
    await page.getByLabel('Vault password', { exact: true }).fill(vaultPassword);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
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
  }
});
