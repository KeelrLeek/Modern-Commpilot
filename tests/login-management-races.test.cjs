const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<body id="loginBody"><form name="loginForm"><table><tr><td>' +
      '<input name="EnteredUserID"><input name="Password" type="password"></td></tr>' +
      '<tr><td class="logintext3"><a id="native-login">Login</a></td></tr></table></form></body>' }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/');
    await page.evaluate(() => {
      window.pending = []; window.holdLists = false; window.signIns = 0;
      window.accounts = ['alpha', 'beta'];
      const profiles = () => accounts.map(id => ({ id, user: id, mode: 'auto', hasPin: false }));
      window.cpToasts = { show() {}, dismiss() {} };
      window.chrome = { runtime: { getManifest: () => ({ version: '0.3.82' }), sendMessage: (message, done) => {
        if (message.op === 'list' && !holdLists) done({ ok: true, profiles: profiles() });
        else pending.push({ message, done });
      } } };
      window.finishRequest = (op, index = 0, accountNames = accounts) => {
        const item = pending.filter(item => item.message.op === op && !item.finished)[index];
        if (!item) throw Error('Missing pending fixture request: ' + op);
        item.finished = true;
        if (op === 'remove') accounts = accounts.filter(id => id !== item.message.id);
        if (op === 'add') accounts.push(item.message.user);
        item.done(op === 'list' ? { ok: true, profiles: accountNames.map(id => ({ id, user: id, mode: 'auto', hasPin: false })) } : { ok: true });
      };
      document.querySelector('#native-login').addEventListener('click', () => signIns++);
    });
    await page.addScriptTag({ path: path.join(root, 'src/content/login.js') });
    await page.getByRole('button', { name: 'Manage saved sign-ins', exact: true }).click();
    await check(page);
    assert.equal(await page.evaluate(() => signIns), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function draft(page) {
  await page.getByRole('button', { name: 'Add a saved sign-in', exact: true }).click();
  await page.locator('.cp-login-panel').getByLabel('User ID', { exact: true }).fill('new-draft');
}

test('a completed removal does not replace a newer saved-sign-in draft', () => fixture(async page => {
  await page.getByRole('button', { name: 'Remove alpha', exact: true }).click();
  await draft(page);
  await page.evaluate(() => finishRequest('remove'));
  assert.equal(await page.evaluate(() => document.querySelector('.cp-login-panel h2')?.textContent), 'Save a sign-in');
  assert.equal(await page.locator('.cp-login-panel').getByLabel('User ID', { exact: true }).inputValue(), 'new-draft');
  assert.deepEqual(await page.evaluate(() => accounts), ['beta']);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Remove alpha', exact: true }).count(), 0);
}));

test('a delayed account list does not replace a newer saved-sign-in draft', () => fixture(async page => {
  await page.evaluate(() => { holdLists = true; });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await draft(page);
  await page.evaluate(() => finishRequest('list'));
  assert.equal(await page.evaluate(() => document.querySelector('.cp-login-panel h2')?.textContent), 'Save a sign-in');
  assert.equal(await page.locator('.cp-login-panel').getByLabel('User ID', { exact: true }).inputValue(), 'new-draft');
}));

test('out-of-order account lists keep the newest requested result', () => fixture(async page => {
  await page.evaluate(() => { holdLists = true; });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => finishRequest('list', 1, ['beta']));
  await page.evaluate(() => finishRequest('list', 0, ['alpha', 'beta']));
  assert.equal(await page.locator('.cp-login-acct[data-id="alpha"]').count(), 0);
  assert.equal(await page.locator('.cp-login-acct[data-id="beta"]').count(), 1);
}));

test('an active removal still refreshes the saved account manager', () => fixture(async page => {
  await page.getByRole('button', { name: 'Remove alpha', exact: true }).click();
  await page.evaluate(() => finishRequest('remove'));
  assert.equal(await page.getByRole('button', { name: 'Remove alpha', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Remove beta', exact: true }).count(), 1);
}));

test('two removals completing around a manager refresh both update the final list', () => fixture(async page => {
  await page.getByRole('button', { name: 'Remove alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Remove beta', exact: true }).click();
  await page.evaluate(() => finishRequest('remove'));
  await page.evaluate(() => finishRequest('remove'));
  assert.equal(await page.locator('.cp-login-mrow').count(), 0);
  assert.equal(await page.locator('.cp-login-empty').innerText(), 'None saved in this browser yet.');
}));

async function submitDraft(page) {
  await page.locator('.cp-login-panel').getByLabel('Password', { exact: true }).fill('synthetic-secret');
  await page.locator('.cp-login-panel select').selectOption('auto');
  await page.getByRole('button', { name: 'Save sign-in', exact: true }).click();
}

test('an older completed Add preserves a different saved-sign-in draft', () => fixture(async page => {
  await draft(page); await submitDraft(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await draft(page);
  await page.locator('.cp-login-panel').getByLabel('User ID', { exact: true }).fill('second-draft');
  await page.evaluate(() => finishRequest('add'));
  assert.equal(await page.evaluate(() => document.querySelector('.cp-login-panel h2')?.textContent), 'Save a sign-in');
  assert.equal(await page.locator('.cp-login-panel').getByLabel('User ID', { exact: true }).inputValue(), 'second-draft');
}));

test('an active completed Add returns to the updated account choices without signing in', () => fixture(async page => {
  await draft(page); await submitDraft(page);
  await page.evaluate(() => finishRequest('add'));
  assert.equal(await page.locator('.cp-login-acct[data-id="new-draft"]').count(), 1);
}));
