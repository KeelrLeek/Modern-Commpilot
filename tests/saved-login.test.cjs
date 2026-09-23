const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const origin = 'https://apps-sbx.avpaas.io';

test('encrypted profiles support PIN, account choice, and automatic sign-in', { skip: !fs.existsSync(edge) }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-vault-test-'));
  const pinUser = 'codex-pin-' + Date.now();
  const autoUser = 'codex-auto-' + Date.now();
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
    await page.getByLabel('User ID').fill(pinUser);
    await page.getByLabel('Password', { exact: true }).fill(secret);
    await page.getByLabel('Four-digit PIN', { exact: true }).fill('2468');
    await page.getByRole('button', { name: 'Save login' }).click();
    await page.getByRole('button', { name: pinUser }).click();
    await page.getByLabel('Four-digit PIN', { exact: true }).fill('1111');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Incorrect PIN').waitFor();
    assert.equal(await page.evaluate(() => window.submitted || null), null);
    await page.getByLabel('Four-digit PIN', { exact: true }).fill('2468');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForFunction(() => !!window.submitted);
    assert.deepEqual(await page.evaluate(() => window.submitted), { user: pinUser, password: secret });

    await page.locator('.bw-saved-back').click();
    await page.getByRole('button', { name: 'Add login' }).click();
    await page.getByLabel('User ID').fill(autoUser);
    await page.getByLabel('Password', { exact: true }).fill(secret);
    await page.getByLabel('Sign-in option').selectOption('auto');
    await page.getByRole('button', { name: 'Save login' }).click();
    await page.getByRole('button', { name: autoUser }).waitFor();

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const stored = await worker.evaluate(() => new Promise(resolve =>
      chrome.storage.local.get('bwEncryptedVaultV2', resolve)));
    const diskValue = JSON.stringify(stored);
    assert.ok(stored.bwEncryptedVaultV2?.data, 'vault ciphertext must be persisted');
    for (const value of [pinUser, autoUser, secret, '2468']) {
      assert.equal(diskValue.includes(value), false, 'plaintext must not appear in storage');
    }
    const keyInfo = await worker.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('bwCredentialKeysV1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const get = open.result.transaction('keys').objectStore('keys').get('main');
        get.onsuccess = () => resolve({ extractable: get.result.extractable, type: get.result.type });
        get.onerror = () => reject(get.error);
      };
    }));
    assert.deepEqual(keyInfo, { extractable: false, type: 'secret' });

    await page.reload();
    await page.getByRole('button', { name: autoUser }).waitFor();
    assert.equal(await page.evaluate(() => window.submitted || null), null, 'multiple accounts require a choice');
    await page.getByRole('button', { name: autoUser }).click();
    await page.waitForFunction(() => !!window.submitted);
    assert.equal((await page.evaluate(() => window.submitted)).user, autoUser);

    await page.locator('.bw-saved-back').click();
    await page.getByRole('button', { name: pinUser }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: pinUser }).waitFor({ state: 'detached' });
    await page.reload();
    await page.waitForFunction(name => window.submitted?.user === name, autoUser);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
