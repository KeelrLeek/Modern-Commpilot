const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const edge = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const pjax = path.resolve(__dirname, '../src/content/pjax.js');
const bulk = path.resolve(__dirname, '../src/content/profile-bulk.js');

test('profile cleanup previews name-contains matches, keeps used profiles, and verifies deletes', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/DeviceInventory/';
    const profile = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
    const users = '/commpilot/Group/DeviceInventory/Modify/Users/';
    const html = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="add" type="button" value="Add"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.evaluate(({ list, profile, users }) => {
      const profiles = {
        'RSU Teams 31489': { type: 'Tirecta Teams', lines: 1, users: 1 },
        'RSG UC1 31489': { type: 'Connect - Mobile', lines: 0, users: 0 },
        'RSG VVX 31489': { type: 'TF_Polycom_VVX400', lines: 0, users: 0, refuse: true }
      };
      window.profileSearches = [];
      window.deletedProfiles = [];
      window.confirm = () => true;
      let current = '';
      window.cpListSearch = async criteria => {
        if (location.pathname === users) return { tooMany: false,
          rows: Array(profiles[current]?.users || 0).fill({ cells: [current] }) };
        const criterion = criteria[0];
        window.profileSearches.push(criterion);
        return { tooMany: false, rows: Object.entries(profiles)
          .filter(([name]) => criterion.op === 'CONTAINS' ?
            name.includes(criterion.value) : name === criterion.value)
          .map(([name, details]) => ({ cells: [name, details.type],
            drill: { url: profile, params: { name, P_name: name, key: name, P_key: name } } })) };
      };
      window.redirectPost = (url, params) => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const cell = document.querySelector('td[width="82%"]');
        if (url === list) cell.innerHTML =
          '<form name="mainForm"><input name="add" type="button" value="Add"></form>';
        else {
          current = params.key;
          if (url === users) cell.innerHTML =
            '<form name="mainForm"><input name="findKey0" value="UserID"></form>';
          else {
            const details = profiles[current];
            cell.innerHTML = `<div>Identity/Device Profile Modify</div>
              <div>Assigned Lines/Ports: ${details.lines}</div>
              <form name="mainForm"><input name="deviceName" type="hidden" value="${current}">
              <input name="key" type="hidden" value="${current}">
              <input name="delete" type="button" value="Delete"></form>`;
            cell.querySelector('input[name="delete"]').addEventListener('click', () => {
              if (details.refuse || details.lines || details.users)
                cell.insertAdjacentHTML('afterbegin', '<div>Cannot delete this profile.</div>');
              else {
                delete profiles[current];
                window.deletedProfiles.push(current);
                history.pushState(null, '', list);
                document.documentElement.setAttribute('data-cp-path', list);
                cell.innerHTML =
                  '<form name="mainForm"><input name="add" type="button" value="Add"></form>';
              }
              document.dispatchEvent(new Event('cp:reskin'));
            });
          }
        }
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { list, profile, users });
    await page.locator('#cp-bulk-profile-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Extensions', headers: ['Extension'], rows: [['31489']],
      widths: [22], textColumns: [0]
    }])]);
    await page.locator('.cp-profile-bulk-dialog input[type="file"]').setInputFiles({
      name: 'extensions.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Review every matching profile'));
    const preview = await page.locator('.cp-bulk-preview').innerText();
    assert.match(preview, /2 ready to delete · 1 in use/);
    assert.match(preview, /RSU Teams 31489[\s\S]*In use — kept/);
    assert.ok((await page.evaluate(() => window.profileSearches))
      .some(item => item.key === 'DeviceName' && item.op === 'CONTAINS' && item.value === '31489'));
    await page.locator('.cp-profile-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('1 deleted and verified'));
    const result = await page.locator('.cp-bulk-preview').innerText();
    assert.match(result, /1 deleted · 1 refused/);
    assert.match(result, /RSG UC1 31489[\s\S]*Deleted and verified/);
    assert.match(result, /RSG VVX 31489[\s\S]*CommPilot refused deletion/);
    assert.deepEqual(await page.evaluate(() => window.deletedProfiles), ['RSG UC1 31489']);
  } finally { await browser.close(); }
});
