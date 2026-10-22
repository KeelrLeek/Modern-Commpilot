const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');

async function fixture(options, check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<html><body><form name="leftNavForm"></form><input name="formtokenserial" value="t1">' +
      '<table><tr><td width="82%"><form name="mainForm"><input name="ok" type="button" value="OK">' +
      '</form></td></tr></table><script>window.redirectPost=function(){};</script></body></html>' }));
    await page.goto('https://apps-sbx.avpaas.io' + list);
    for (const name of ['pjax.js', 'number-bulk.js'])
      await page.addScriptTag({ path: path.join(runtime, 'src/content', name) });
    await page.evaluate(({ options, list, edit }) => {
      const phone = '+1-2244830007';
      window.fixturePhase = 'preview';
      window.fixtureWrites = 0;
      window.fixtureLookupAttempts = 0;
      window.fixtureDepartment = options.initial || '';
      window.cpListSearch = async criteria => {
        const all = !criteria.some(item => item.value);
        if (options.direct && all) return { tooMany: true };
        if (options.searchErrorAt && !all) {
          window.fixtureLookupAttempts++;
          if (window.fixtureLookupAttempts === options.searchErrorAt) throw Error('Fixture number lookup interrupted.');
          return { tooMany: false, rows: [] };
        }
        const cells = [phone, '', '', '', ''];
        if (window.fixturePhase !== options.incompleteAt) cells.push(window.fixtureDepartment);
        return { tooMany: false, rows: [{ cells,
          drill: { url: edit, params: { key: phone, P_key: phone } } }] };
      };
      window.redirectPost = url => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const cell = document.querySelector('td[width="82%"]');
        cell.innerHTML = url === list ?
          '<form name="mainForm"><input name="ok" value="OK" type="button"></form>' :
          `<form name="mainForm"><select name="deptDropDownList"><option value="none">None</option>
          <option value="basement">Basement</option></select>
          <select name="assignedList"><option value="${phone}">${phone}</option></select>
          <select name="unassignList"></select><input name="toAdd" type="hidden">
          <input name="action" type="hidden"><input name="apply" type="button" value="Apply"></form>`;
        if (url === edit) {
          const form = document.forms.mainForm;
          form.requestSubmit = () => {
            form.elements.unassignList.add(new Option(phone, phone));
            document.dispatchEvent(new Event('cp:reskin'));
          };
          form.elements.apply.addEventListener('click', () => {
            window.fixtureWrites++;
            window.fixtureDepartment = form.elements.deptDropDownList.selectedOptions[0].textContent;
            window.fixturePhase = 'verify';
            cell.insertAdjacentHTML('afterbegin', '<span>Saved</span>');
            document.dispatchEvent(new Event('cp:reskin'));
          });
        }
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { options, list, edit });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(target => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['2244830007', target, '']], widths: [23, 34, 23], textColumns: [0, 2]
    }])], options.target || 'Basement');
    const file = page.locator('.cp-bulk-dialog input[type="file"]');
    await file.setInputFiles({ name: 'assign.xlsx', mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-dialog input[type="file"]').value === '');
    await check(page);
  } finally { await browser.close(); }
}

for(const attempt of [1,2])test(`direct number lookup stops format fallbacks when attempt ${attempt} fails`,
  () => fixture({ direct: true, searchErrorAt: attempt }, async page => {
    assert.equal(await page.evaluate(() => window.fixtureLookupAttempts), attempt, 'a failed read is not an empty match that justifies another format request');
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /lookup interrupted/i);
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixtureWrites), 0);
  }));

for (const direct of [false, true]) test(`${direct ? 'direct' : 'group'} number lookup rejects a missing Department cell`,
  () => fixture({ direct, incompleteAt: 'preview' }, async page => {
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    assert.match(await page.locator('.cp-bulk-dialog').innerText(), /department column/i);
    assert.equal(await page.evaluate(() => window.fixtureWrites), 0);
  }));

test('number assignment stops before saving if the Department cell disappears after preview',
  () => fixture({ incompleteAt: 'apply' }, async page => {
    await page.evaluate(() => { window.fixturePhase = 'apply'; });
    await page.locator('[data-action="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-bulk-status').textContent.startsWith('Saving '));
    assert.equal(await page.evaluate(() => window.fixtureWrites), 0);
    assert.match(await page.locator('.cp-bulk-dialog').innerText(), /department column/i);
  }));

test('number readback cannot verify None from a missing Department cell',
  () => fixture({ incompleteAt: 'verify', initial: 'Basement', target: 'None' }, async page => {
    await page.locator('[data-action="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-bulk-status').textContent.startsWith('Saving '));
    assert.equal(await page.evaluate(() => window.fixtureWrites), 1);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /0 verified · 1 unverified/);
    assert.match(await page.locator('.cp-bulk-dialog').innerText(), /department column/i);
  }));

test('a present blank Department cell still supports assignment and independent readback',
  () => fixture({}, async page => {
    await page.locator('[data-action="apply"]').click();
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status').textContent.includes('Verified 1 assignment'));
    assert.equal(await page.evaluate(() => window.fixtureWrites), 1);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /1 verified · 0 unverified/);
  }));
