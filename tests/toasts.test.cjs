const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';

// The service provider's Users list after CommPilot refused a search that matched too many users (trimmed): the
// message row sits between the description and the action bar, as CommPilot serves it.
const frame = message => `<form name="mainForm" method="post"><input type="hidden" name="formtokenserial" value="t1">
  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>
  <tr><td height="10"></td></tr>
  <tr><td class="screenName">Users</td></tr>
  <tr><td height="5"></td></tr>
  <tr><td class="tip">Add a new user or manage existing users.</td></tr>
  <tr><td height="5"></td></tr>
  ${message}
  <tr><td height="5"></td></tr>
  <tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="ok" value="OK"> <input type="submit" name="add" value="Add"></td></tr>
  <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr><td>User ID:</td><td><input type="text" name="findValue0"></td></tr></tbody></table></td></tr>
  </tbody></table></form>`;
const tooMany = '<tr><td class="error"><span class="Failure"><b>Failed to read: [Error 4027] Please narrow your search, there are 7792 matching records.</b></span></td></tr>';
const page = `<!doctype html><html data-cp-direction="graphite"><head><title>Users</title></head>
  <body id="initBody.menuTemplate"><table height="100%"><tbody><tr>
  <td class="headandfoot" width="18%"><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form></td>
  <td width="82%" valign="top">${frame(tooMany)}</td></tr></tbody></table></body></html>`;

test('CommPilot’s messages become toasts at the bottom of the page that go away by themselves', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await tab.route(origin + '/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: page }));
    await tab.goto(origin + '/commpilot/ServiceProvider/Users/', { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css', 'toasts.css'])
      await tab.addStyleTag({ path: path.join(root, 'src/content', file) });
    await tab.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
    await tab.addScriptTag({ path: path.join(root, 'src/content/toasts.js') });
    const toast = tab.locator('#cp-toasts .cp-toast');
    await toast.waitFor();
    await tab.evaluate(() => Promise.all(document.getAnimations().filter(a => a.animationName === 'cp-toast-in').map(a => a.finished)));

    // The refusal reads as advice: what happened, what to do, and CommPilot's code.
    const shown = await tab.evaluate(() => {
      const t = document.querySelector('#cp-toasts .cp-toast');
      const r = t.getBoundingClientRect(), cell = document.querySelector('td[width="82%"]').getBoundingClientRect();
      return { kind: t.className, role: t.getAttribute('role'), title: t.querySelector('.cp-toast-title').firstChild.textContent,
        code: t.querySelector('.cp-toast-code').textContent, body: t.querySelector('.cp-toast-body').textContent,
        bottom: innerHeight - r.bottom, centre: (r.left + r.right) / 2 - (cell.left + cell.right) / 2,
        row: getComputedStyle(document.querySelector('td.error').closest('tr')).display,
        kept: document.querySelector('td.error').textContent.includes('Error 4027') };
    });
    assert.equal(shown.kind, 'cp-toast cp-toast-warning');
    assert.equal(shown.role, 'alert');
    assert.equal(shown.title, 'Too many results');
    assert.equal(shown.code, 'Error 4027');
    assert.equal(shown.body, 'Please narrow your search, there are 7,792 matching records.');
    assert.equal(shown.bottom, 24, 'at the bottom of the window');
    assert.ok(Math.abs(shown.centre) <= 1, `centred under the page content (${shown.centre})`);
    assert.equal(shown.row, 'none', 'the message row leaves the page');
    assert.equal(shown.kept, true, 'but stays in it for CommPilot’s scripts');

    // It waits while pointed at, then goes by itself (lives shortened for the test).
    await tab.addStyleTag({ content: '#cp-toasts .cp-toast { --cp-toast-life: 700ms !important; }' });
    await toast.hover();
    await tab.waitForTimeout(1200);
    assert.equal(await toast.count(), 1, 'held while the pointer is on it');
    await tab.mouse.move(10, 10);
    await tab.waitForFunction(() => !document.querySelector('#cp-toasts .cp-toast'), null, { timeout: 3000 });

    // The next page's message is a toast of its own; showing it again does not stack a copy; × closes it at once.
    const next = frame('<tr><td class="informational">Your changes have been saved.</td></tr>');
    await tab.addStyleTag({ content: '#cp-toasts .cp-toast { --cp-toast-life: 60s !important; }' });
    await tab.evaluate(html => { document.querySelector('td[width="82%"]').innerHTML = html; }, next);
    await toast.waitFor();
    await tab.evaluate(html => { document.querySelector('td[width="82%"]').innerHTML = html; }, next);
    await tab.waitForTimeout(300);
    assert.equal(await toast.count(), 1, 'one toast for one message');
    assert.deepEqual(await toast.evaluate(t => [t.className, t.getAttribute('role'), t.querySelector('.cp-toast-title'),
      t.querySelector('.cp-toast-body').textContent]), ['cp-toast cp-toast-info', 'status', null, 'Your changes have been saved.']);
    await tab.getByRole('button', { name: 'Dismiss' }).click();
    await tab.waitForFunction(() => !document.querySelector('#cp-toasts .cp-toast'), null, { timeout: 2000 });

    // pjax.js's own notices come with their parts; one with an action keeps its button and stays until used.
    await tab.evaluate(() => {
      window.signIns = 0;
      const notice = document.createElement('div');
      notice.className = 'cp-alert cp-alert-warning';
      notice.innerHTML = '<div class="cp-alert-content"><div class="cp-alert-title">Session expired</div>' +
        '<div class="cp-alert-body">The server is rejecting requests. Sign in again to continue.</div></div>' +
        '<button type="button" class="cp-alert-act">Sign in</button>';
      notice.querySelector('.cp-alert-act').addEventListener('click', () => window.signIns++);
      const cell = document.querySelector('td[width="82%"]');
      cell.insertBefore(notice, cell.firstChild);
    });
    await toast.waitFor();
    assert.deepEqual(await toast.evaluate(t => [t.className, t.querySelector('.cp-toast-title').textContent,
      t.querySelector('.cp-toast-body').textContent, !!t.querySelector('.cp-toast-timer')]),
      ['cp-toast cp-toast-warning cp-toast-stays', 'Session expired', 'The server is rejecting requests. Sign in again to continue.', false]);
    assert.equal(await tab.locator('.cp-alert').isVisible(), false, 'the notice leaves the page');
    await tab.getByRole('button', { name: 'Sign in' }).click();
    assert.equal(await tab.evaluate(() => window.signIns), 1, 'the toast’s button is the notice’s own');
    await tab.waitForFunction(() => !document.querySelector('#cp-toasts .cp-toast'), null, { timeout: 2000 });

    // An add or edit window shows its own errors.
    await tab.evaluate(() => {
      const modal = document.createElement('div');
      modal.className = 'cp-modal';
      modal.innerHTML = '<table><tr><td class="error">Failed to add: [Error 4195] The start date and time must be before the end.</td></tr></table>';
      document.querySelector('td[width="82%"]').appendChild(modal);
    });
    await tab.waitForTimeout(300);
    assert.equal(await toast.count(), 0);
    assert.equal(await tab.locator('.cp-modal td.error').isVisible(), true);
  } finally { await browser.close(); }
});
