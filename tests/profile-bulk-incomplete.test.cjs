const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(brokenAt, check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/DeviceInventory/';
    const profile = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
    const users = '/commpilot/Group/DeviceInventory/Modify/Users/';
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<html><body><form name="leftNavForm"></form><input name="formtokenserial" value="t1">' +
      '<table><tr><td width="82%"><form name="mainForm"><input name="add" type="button" value="Add">' +
      '</form></td></tr></table><script>window.redirectPost=function(){};</script></body></html>' }));
    await page.goto('https://apps-sbx.avpaas.io' + list);
    for (const name of ['pjax.js', 'profile-bulk.js'])
      await page.addScriptTag({ path: path.join(runtime, 'src/content', name) });
    await page.evaluate(({ brokenAt, list, profile, users }) => {
      const name = 'TRI WX 1234';
      window.fixturePhase = 'preview';
      window.fixtureDeletes = 0;
      window.confirm = () => true;
      window.cpListSearch = async () => ({ tooMany: false,
        rows: location.pathname === users ? [] : [{ cells: [name, 'Connect - Mobile'],
          drill: window.fixturePhase === brokenAt ? null :
            { url: profile, params: { key: name, P_key: name } } }] });
      let failedReturns = 0;
      const navigate = url => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const cell = document.querySelector('td[width="82%"]');
        cell.innerHTML = url === profile ?
          `<div>Assigned Lines/Ports: 0</div><form name="mainForm">
          <input name="deviceName" type="hidden" value="${name}">
          <input name="delete" type="button" value="Delete"></form>` :
          '<form name="mainForm"><input name="add" type="button" value="Add"></form>';
        if (url === profile && window.fixturePhase === 'apply') {
          const button = cell.querySelector('[name="delete"]');
          if (brokenAt === 'disabled-button') button.disabled = true;
          if (brokenAt === 'disabled-fieldset') {
            const policy = document.createElement('fieldset'); policy.disabled = true;
            button.before(policy); policy.appendChild(button);
          }
        }
        if (url === profile) cell.querySelector('[name="delete"]').addEventListener('click', () => {
          window.fixtureDeletes++;
          window.fixturePhase = 'verify';
          // The profile remains present; its search result loses its Edit link.
          cell.insertAdjacentHTML('afterbegin', '<div>Cannot delete this profile.</div>');
          document.dispatchEvent(new Event('cp:reskin'));
        });
        document.dispatchEvent(new Event('cp:reskin'));
      };
      window.redirectPost = url => {
        if (brokenAt === 'return' && window.fixturePhase === 'verify' && url === list) {
          if (failedReturns++ < 2) throw Error('The profile list could not be opened.');
          window.fixtureReturnPending = true;
          window.fixtureReleaseReturn = () => { window.fixtureReturnPending = false; navigate(url); };
          return;
        }
        navigate(url);
      };
    }, { brokenAt, list, profile, users });
    await page.locator('#cp-bulk-profile-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Extensions', headers: ['Extension'], rows: [['1234']], widths: [22], textColumns: [0]
    }])]);
    await page.locator('.cp-profile-bulk-dialog input[type="file"]').setInputFiles({
      name: 'profiles.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-profile-bulk-dialog input[type="file"]').value === '');
    await check(page);
  } finally { await browser.close(); }
}

for (const policy of ['disabled-button', 'disabled-fieldset']) test(`profile cleanup explains a native ${policy} without waiting for a navigation that was never sent`, () => fixture(policy, async page => {
  await page.evaluate(() => { window.fixturePhase = 'apply'; });
  await page.locator('[data-action="apply"]').click();
  await page.waitForFunction(() => document.querySelector('.cp-bulk-status').textContent.includes('deleted and verified'), null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => window.fixtureDeletes), 0);
  assert.match(await page.locator('.cp-bulk-preview').innerText(), /disabled/i);
  assert.equal(await page.locator('[data-action="close"]').isEnabled(), true);
}));

test('profile preview reports an unreadable Edit target instead of declaring no matches',
  () => fixture('preview', async page => {
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /Edit target/i);
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixtureDeletes), 0);
  }));

test('profile disappearance of the Edit target after preview cannot become Already absent',
  () => fixture('apply', async page => {
    await page.evaluate(() => { window.fixturePhase = 'apply'; });
    await page.locator('[data-action="apply"]').click();
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status').textContent.includes('deleted and verified'));
    assert.equal(await page.evaluate(() => window.fixtureDeletes), 0);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /Edit target/i);
    assert.doesNotMatch(await page.locator('.cp-bulk-preview').innerText(), /Already absent|Deleted and verified/);
  }));

test('profile deletion cannot be verified when a remaining row lacks its Edit target',
  () => fixture('verify', async page => {
    await page.locator('[data-action="apply"]').click();
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status').textContent.includes('deleted and verified'));
    assert.equal(await page.evaluate(() => window.fixtureDeletes), 1);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /0 deleted/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /1 unverified/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /Edit target/i);
  }));

test('profile cleanup keeps its dialog until the final return navigation settles',
  () => fixture('return', async page => {
    await page.locator('[data-action="apply"]').click();
    await page.waitForFunction(() => window.fixtureReturnPending === true);
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.locator('.cp-profile-bulk-dialog').count(), 1,
      'an unfinished native return must retain the dialog and its navigation guard');
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    await page.evaluate(() => fixtureReleaseReturn());
    await page.waitForFunction(() => document.querySelector('[data-action="close"]')?.textContent === 'Close');
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /1 unverified/);
    assert.equal(await page.evaluate(() => fixtureDeletes), 1, 'uncertain deletion is never replayed');
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.locator('.cp-profile-bulk-dialog').count(), 0);
  }));
