const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..'));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const origin = 'https://apps-sbx.avpaas.io';

test('saved sign-ins: Continue as rows, a PIN box, Manage to add and remove, and the only automatic one signing in by itself', { skip: !fs.existsSync(edge) }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-vault-test-'));
  const pinUser = 'codex-pin-' + Date.now();
  const autoUser = 'codex-auto-' + Date.now();
  const secret = 'disposable-test-password';
  const changed = 'disposable-changed-password';
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: edge,
      headless: true,
      viewport: { width: 1200, height: 850 },
      // The resolver keeps anything unrouted, the update check included, off the network.
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--host-resolver-rules=MAP * ~NOTFOUND']
    });
    await context.route('https://**/*', route => route.abort('blockedbyclient'));
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
    // None saved yet: the page offers to save one.
    await page.getByRole('button', { name: 'Save a sign-in for next time' }).click();
    let form = page.locator('.cp-login-panel');
    await form.getByLabel('User ID').fill(pinUser);
    await form.getByLabel('Password', { exact: true }).fill(secret);
    await form.getByLabel('Four-digit PIN', { exact: true }).fill('2468');
    await form.getByRole('button', { name: 'Save sign-in' }).click();
    // A PIN account opens its PIN box; a wrong PIN is a toast and sends nothing.
    await page.getByRole('button', { name: `Continue as ${pinUser}` }).click();
    await page.getByLabel(`PIN for ${pinUser}`).fill('1111');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('#cp-toasts .cp-toast-error .cp-toast-body', { hasText: 'Incorrect PIN' }).waitFor();
    assert.equal(await page.evaluate(() => window.submitted || null), null);
    await page.getByLabel(`PIN for ${pinUser}`).fill('2468');
    await page.getByLabel(`PIN for ${pinUser}`).press('Enter');
    await page.waitForFunction(() => !!window.submitted);
    assert.deepEqual(await page.evaluate(() => window.submitted), { user: pinUser, password: secret });

    await page.getByRole('button', { name: 'Manage saved sign-ins' }).click();
    await page.getByRole('button', { name: 'Add a saved sign-in' }).click();
    form = page.locator('.cp-login-panel');
    await form.getByLabel('User ID').fill(autoUser);
    await form.getByLabel('Password', { exact: true }).fill(secret);
    await form.locator('select').selectOption('auto');   // CommPilot-style list under the searchable dropdown
    await form.getByRole('button', { name: 'Save sign-in' }).click();
    await page.getByRole('button', { name: `Continue as ${autoUser}` }).waitFor();
    // Saved again after a password change: the same sign-in, updated, not a second one beside it.
    await page.getByRole('button', { name: 'Manage saved sign-ins' }).click();
    await page.getByRole('button', { name: 'Add a saved sign-in' }).click();
    form = page.locator('.cp-login-panel');
    await form.getByLabel('User ID').fill(autoUser);
    await form.getByLabel('Password', { exact: true }).fill(changed);
    await form.locator('select').selectOption('auto');
    await form.getByRole('button', { name: 'Save sign-in' }).click();
    await page.locator('#cp-toasts .cp-toast-body', { hasText: `Updated: ${autoUser}.` }).waitFor();
    await page.getByRole('button', { name: `Continue as ${autoUser}` }).waitFor();
    assert.equal(await page.locator('.cp-login-acct').count(), 2, 'one row each');

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const stored = await worker.evaluate(() => new Promise(resolve =>
      chrome.storage.local.get('bwEncryptedVaultV2', resolve)));
    const diskValue = JSON.stringify(stored);
    assert.ok(stored.bwEncryptedVaultV2?.data, 'vault ciphertext must be persisted');
    for (const value of [pinUser, autoUser, secret, changed, '2468']) {
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
    await page.getByRole('button', { name: `Continue as ${autoUser}` }).waitFor();
    assert.equal(await page.evaluate(() => window.submitted || null), null, 'two saved sign-ins wait for a choice');
    await page.getByRole('button', { name: `Continue as ${autoUser}` }).click();
    await page.waitForFunction(() => !!window.submitted);
    assert.equal((await page.evaluate(() => window.submitted)).user, autoUser);

    await page.getByRole('button', { name: 'Manage saved sign-ins' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: `Remove ${pinUser}` }).click();
    await page.getByRole('button', { name: `Remove ${pinUser}` }).waitFor({ state: 'detached' });
    // The only one left signs in by itself when the page opens.
    await page.reload();
    await page.waitForFunction(name => window.submitted?.user === name, autoUser);
    assert.equal((await page.evaluate(() => window.submitted)).password, changed, 'with the password saved last');
    // A sign-out (or Go to login from a paused recovery) holds it for a minute, so the explicit choice is not undone.
    const reopen = async manualLogoutAgo => {
      await page.evaluate(ago => {
        sessionStorage.removeItem('bwAutoLoginAttempt');
        sessionStorage.setItem('bwManualLogoutAt', String(Date.now() - ago));
      }, manualLogoutAgo);
      await page.reload();
    };
    await reopen(0);
    // The rows and the automatic decision come from the same vault answer.
    await page.getByRole('button', { name: `Continue as ${autoUser}` }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.submitted || null), null, 'a recent sign-out waits for a choice');
    await reopen(61000);
    await page.waitForFunction(name => window.submitted?.user === name, autoUser);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
