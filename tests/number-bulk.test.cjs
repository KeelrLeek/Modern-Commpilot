const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const edge = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const pjax = path.join(runtime, 'src/content/pjax.js');
const bulk = path.join(runtime, 'src/content/number-bulk.js');

test('bulk number preview expands ranges, marks missing numbers, and blocks Apply', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const html = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="ok" value="OK" type="button"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.evaluate(({ list, edit }) => {
      window.cpListSearch = async () => ({ tooMany: false, rows: [{
        cells: ['+1-2244830007', '', '', '', '', 'None'],
        drill: { url: edit, params: { key: '+1-2244830007', P_key: '+1-2244830007' } }
      }] });
      window.redirectPost = url => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        document.querySelector('td[width="82%"]').innerHTML = url === edit ?
          '<form name="mainForm"><select name="deptDropDownList"><option value="0">None</option><option value="basement">Basement</option></select></form>' :
          '<form name="mainForm"><input name="ok" value="OK" type="button"></form>';
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { list, edit });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['+1-2244830007', 'Basement', '+1-2244830009']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'ranges.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Fix 2 numbers'));
    const preview = await page.locator('.cp-bulk-preview').innerText();
    assert.match(preview, /1 to change · 0 already correct · 2 errors/);
    assert.match(preview, /2244830008[\s\S]*Number was not found/);
    assert.match(preview, /2244830009[\s\S]*Number was not found/);
    assert.match(await page.locator('.cp-bulk-progress').innerText(), /3 \/ 3 \(100%\)/);
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    const large = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['+1-2244830007', 'Basement', '+1-2244830107']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'larger-range.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(large) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Fix 100 numbers'));
    assert.match(await page.locator('.cp-bulk-pages').innerText(), /page 1 of 2/);
    await page.locator('.cp-bulk-pages button:text-is("Next")').click();
    assert.match(await page.locator('.cp-bulk-pages').innerText(), /page 2 of 2/);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /2244830007[\s\S]*Ready/);
  } finally { await browser.close(); }
});

test('large-group lookup finds international numbers stored with a country-code hyphen', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const html = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="ok" value="OK" type="button"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.evaluate(({ edit }) => {
      const values = [
        ['+44-2030233343', 'RSUM - London'],
        ['+44-2030233344', 'RSUM - London'],
        ['+34-910603947', 'Barcelona'],
        ['+44-2045747110', 'Innovisk - UK']
      ];
      window.lookupCriteria = [];
      window.lookupNavigations = [];
      window.cpListSearch = async criteria => {
        if (!criteria.some(item => item.value)) return { tooMany: true };
        window.lookupCriteria.push(criteria[0]);
        const { op, value } = criteria[0];
        return { rows: values.filter(([phone]) => (op === 'EQUAL_TO' && phone === value) ||
          (op === 'CONTAINS' && phone.includes(value))).map(([phone, department]) => ({
          cells: [phone, '', '', '', '', department],
          drill: { url: edit, params: { key: phone, P_key: phone,
            name: department, P_name: department } }
        })) };
      };
      window.redirectPost = (url, params) => {
        window.lookupNavigations.push(url);
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const options = ['None', ...new Set(values.map(row => row[1]))]
          .map(name => `<option value="${name}" ${name === params?.name ? 'selected' : ''}>${name}</option>`)
          .join('');
        document.querySelector('td[width="82%"]').innerHTML = url === edit ?
          `<form name="mainForm"><select name="deptDropDownList">${options}</select></form>` :
          '<form name="mainForm"><input name="ok" value="OK" type="button"></form>';
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { edit });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['442030233343', 'RSUM - London', '442030233344'],
        ['34910603947', 'Barcelona', ''],
        ['442045747110', 'Innovisk - UK', '']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'international.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('All requested numbers are already'));
    const preview = await page.locator('.cp-bulk-preview').innerText();
    assert.match(preview, /0 to change · 4 already correct · 0 errors/);
    assert.match(preview, /442030233343[\s\S]*RSUM - London[\s\S]*Already correct/);
    assert.match(preview, /442030233344[\s\S]*RSUM - London[\s\S]*Already correct/);
    assert.match(preview, /34910603947[\s\S]*Barcelona[\s\S]*Already correct/);
    assert.match(preview, /442045747110[\s\S]*Innovisk - UK[\s\S]*Already correct/);
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    assert.ok((await page.evaluate(() => window.lookupCriteria))
      .some(criteria => criteria.op === 'EQUAL_TO' && criteria.value === '+44-2030233343'));
    assert.deepEqual(await page.evaluate(() => window.lookupNavigations), [edit, list],
      'read the group department choices once per preview, not once per number');
  } finally { await browser.close(); }
});

test('bulk save checks the Numbers list when the Edit dropdown shows a different department', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const html = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="ok" value="OK" type="button"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.evaluate(({ list, edit }) => {
      const numbers = ['+1-2244830007', '+1-2244830030'];
      window.departmentsByNumber = Object.fromEntries(numbers.map(phone => [phone, 'None']));
      window.savedNumbers = [];
      window.cpListSearch = async criteria => ({ tooMany: false, rows: numbers
        .filter(phone => !criteria.some(item => item.value) || criteria[0].op === 'EQUAL_TO' &&
          criteria[0].value === phone || criteria[0].op === 'CONTAINS' &&
          phone.includes(criteria[0].value))
        .map(phone => ({ cells: [phone, '', '', '', '', window.departmentsByNumber[phone]],
          drill: { url: edit, params: { key: phone, P_key: phone } } })) });
      window.redirectPost = (url, params) => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const cell = document.querySelector('td[width="82%"]');
        if (url === list) cell.innerHTML =
          '<form name="mainForm"><input name="ok" value="OK" type="button"></form>';
        else {
          const phone = params.key;
          // The second Edit form chooses Basement as its pick-list context even
          // though the authoritative Numbers list still says None.
          const selected = phone === numbers[1] ? 'Basement' : 'None';
          cell.innerHTML = `<form name="mainForm"><select name="deptDropDownList">
            <option value="none" ${selected === 'None' ? 'selected' : ''}>None</option>
            <option value="basement" ${selected === 'Basement' ? 'selected' : ''}>Basement</option>
            </select><select name="assignedList"><option value="${phone}">${phone}</option></select>
            <select name="unassignList"></select><input name="toAdd" type="hidden">
            <input name="action" type="hidden"><input name="apply" type="button" value="Apply"></form>`;
          const form = document.forms.mainForm;
          form.requestSubmit = () => {
            form.elements.unassignList.add(new Option(phone, phone));
            document.dispatchEvent(new Event('cp:reskin'));
          };
          form.elements.apply.addEventListener('click', () => {
            window.departmentsByNumber[phone] = form.elements.deptDropDownList.selectedOptions[0].textContent;
            window.savedNumbers.push(phone);
            cell.insertAdjacentHTML('afterbegin', '<span>Saved</span>');
            document.dispatchEvent(new Event('cp:reskin'));
          });
        }
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { list, edit });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['2244830007', 'Basement', ''], ['2244830030', 'Basement', '']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'two-numbers.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Review the changes'));
    await page.locator('.cp-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Verified 2 assignments'));
    assert.deepEqual(await page.evaluate(() => window.savedNumbers),
      ['+1-2244830007', '+1-2244830030']);
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /0 errors · 2 verified/);
    const retry = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['2244830007', 'None', '']], widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'changed-during-run.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(retry) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Review the changes'));
    await page.evaluate(() => { window.departmentsByNumber['+1-2244830007'] = 'Other'; });
    await page.locator('.cp-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('now belongs to Other'));
    assert.match(await page.locator('.cp-bulk-status').innerText(), /Row 2 · \+1-2244830007/);
    assert.equal((await page.evaluate(() => window.savedNumbers)).length, 2);
  } finally { await browser.close(); }
});

test('bulk save reopens the Numbers list before reading back after CommPilot returns no page', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const html = `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">
      <form name="mainForm"><input name="ok" value="OK" type="button"></form>
      </td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.evaluate(({ list, edit }) => {
      const numbers = ['+1-2244830007', '+1-2244830030'];
      const departments = Object.fromEntries(numbers.map(phone => [phone, 'None']));
      window.requests = [];
      window.cpListSearch = async criteria => {
        window.requests.push('search ' + (criteria[0]?.value || 'all'));
        return { tooMany: false, rows: numbers.filter(phone => !criteria.some(item => item.value) ||
          phone === criteria[0].value).map(phone => ({ cells: [phone, '', '', '', '', departments[phone]],
          drill: { url: edit, params: { key: phone, P_key: phone } } })) };
      };
      window.redirectPost = (url, params) => {
        window.requests.push('open ' + (url === list ? 'list' : params.key));
        // CommPilot never answers the second number's Edit read.
        if (window.requests.some(entry => entry === 'save ' + numbers[0]) && params?.key === numbers[1]) return;
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const cell = document.querySelector('td[width="82%"]');
        if (url === list) cell.innerHTML = '<form name="mainForm"><input name="ok" value="OK" type="button"></form>';
        else {
          const phone = params.key;
          cell.innerHTML = `<form name="mainForm"><select name="deptDropDownList">
            <option value="none">None</option><option value="basement">Basement</option></select>
            <select name="assignedList"><option value="${phone}">${phone}</option></select>
            <select name="unassignList"></select><input name="toAdd" type="hidden">
            <input name="action" type="hidden"><input name="apply" type="button" value="Apply"></form>`;
          const form = document.forms.mainForm;
          form.requestSubmit = () => {
            form.elements.unassignList.add(new Option(phone, phone));
            document.dispatchEvent(new Event('cp:reskin'));
          };
          form.elements.apply.addEventListener('click', () => {
            window.requests.push('save ' + phone);
            departments[phone] = form.elements.deptDropDownList.selectedOptions[0].textContent;
            cell.insertAdjacentHTML('afterbegin', '<span>Saved</span>');
            document.dispatchEvent(new Event('cp:reskin'));
          });
        }
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { list, edit });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['2244830007', 'Basement', ''], ['2244830030', 'Basement', '']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'two-numbers.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-status')?.textContent
      .includes('Review the changes'));
    await page.clock.install();
    await page.locator('.cp-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => window.requests.at(-1) === 'open +1-2244830030');
    const unanswered = (await page.evaluate(() => window.requests)).length;
    await page.clock.runFor(31000);
    await page.waitForFunction(() => !document.querySelector('.cp-bulk-status').textContent.startsWith('Saving '));
    assert.match(await page.locator('.cp-bulk-status').innerText(), /did not return a page[\s\S]*1 earlier assignment verified/);
    assert.deepEqual((await page.evaluate(() => window.requests)).slice(unanswered, unanswered + 2),
      ['open list', 'search all'], 'the readback reopens the list before it searches with the page token');
  } finally { await browser.close(); }
});

test('bulk numbers preview and readback search every group number, not the Numbers search', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Edge or Chrome');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const list = '/commpilot/Group/GroupDnManagement/index.jsp';
    const edit = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    const departments = { '+1-2245550100': 'None', '+1-2246660100': 'None' };
    const searches = [];
    // The user searched Phone Number contains 555, and CommPilot shows that search on the list again.
    const listCell = rows => `<form name="mainForm"><table id="searchTable"><tr><td>
      <select name="findKey0"><option value="Dn" selected>Phone Number</option></select>
      <select name="findOp0"><option value="CONTAINS" selected>Contains</option></select>
      <input name="findValue0" value="555"><input type="hidden" name="rowNum" value="0"></td></tr></table>
      <input name="ok" value="OK" type="button"></form>` + (rows ? `<table>${rows}</table><div>Page 1 of 1</div>` : '');
    const html = cell => `<!doctype html><html><body><form name="leftNavForm"></form>
      <input name="formtokenserial" value="token-1"><table><tr><td width="82%">${cell}</td></tr></table>
      <script>window.redirectPost=function(){};</script></body></html>`;
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fulfill({ contentType: 'text/html', body: html(listCell()) });
      const data = Object.fromEntries(new URLSearchParams(request.postData() || ''));
      searches.push(data);
      const rows = Object.entries(departments).filter(([phone]) => data.findOp0 === 'EQUAL_TO' ?
        phone === data.findValue0 : data.findOp0 === 'CONTAINS' ?
          phone.replace(/\D/g, '').includes(data.findValue0) : phone.startsWith(data.findValue0))
        .map(([phone, department], index) => `<tr id="Row${index}"><td><a class="tableLink">${phone}</a></td>` +
          '<td><a class="tableLink"></a></td>'.repeat(4) + `<td><a class="tableLink">${department}</a><script>
          document.getElementById('Row${index}').onclick=function(){redirectPost('${edit}',{key:'${phone}',P_key:'${phone}'});};
          </script></td></tr>`).join('');
      return route.fulfill({ contentType: 'text/html', body: html(listCell(rows || '<tr><td>No Entries Present</td></tr>')) });
    });
    await page.goto(`https://apps-sbx.avpaas.io${list}`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: pjax });
    await page.addScriptTag({ path: bulk });
    await page.exposeFunction('saveDepartment', (phone, department) => { departments[phone] = department; });
    await page.evaluate(({ list, edit, cell }) => {
      window.redirectPost = (url, params) => {
        history.pushState(null, '', url);
        document.documentElement.setAttribute('data-cp-path', url);
        const content = document.querySelector('td[width="82%"]');
        if (url === list) content.innerHTML = cell;
        else {
          const phone = params.key;
          content.innerHTML = `<form name="mainForm"><select name="deptDropDownList">
            <option value="none">None</option><option value="basement">Basement</option></select>
            <select name="assignedList"><option value="${phone}">${phone}</option></select>
            <select name="unassignList"></select><input name="toAdd" type="hidden">
            <input name="action" type="hidden"><input name="apply" type="button" value="Apply"></form>`;
          const form = document.forms.mainForm;
          form.requestSubmit = () => {
            form.elements.unassignList.add(new Option(phone, phone));
            document.dispatchEvent(new Event('cp:reskin'));
          };
          form.elements.apply.addEventListener('click', async () => {
            await window.saveDepartment(phone, form.elements.deptDropDownList.selectedOptions[0].textContent);
            content.insertAdjacentHTML('afterbegin', '<span>Saved</span>');
            document.dispatchEvent(new Event('cp:reskin'));
          });
        }
        document.dispatchEvent(new Event('cp:reskin'));
      };
    }, { list, edit, cell: listCell() });
    await page.locator('#cp-bulk-number-launch').click();
    const bytes = await page.evaluate(() => [...window.cpXlsxBuild([{
      name: 'Assignments', headers: ['Phone Number', 'Department', 'Range End'],
      rows: [['2245550100', 'Basement', ''], ['2246660100', 'Basement', '']],
      widths: [23, 34, 23], textColumns: [0, 2]
    }])]);
    await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
      name: 'outside-search.xlsx', mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => document.querySelector('.cp-bulk-dialog input[type="file"]').value === '');
    assert.match(await page.locator('.cp-bulk-preview').innerText(), /2 to change · 0 already correct · 0 errors/);
    const blank = ({ findKey0, findOp0, findValue0, rowNum }) => ({ findKey0, findOp0, findValue0, rowNum });
    assert.deepEqual(blank(searches[0]), { findKey0: 'Dn', findOp0: 'STARTS_WITH', findValue0: '', rowNum: '0' },
      'the preview reads every group number');
    await page.locator('.cp-bulk-dialog [data-action="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('.cp-bulk-status').textContent.startsWith('Saving '));
    assert.match(await page.locator('.cp-bulk-status').innerText(), /Verified 2 assignments/);
    assert.deepEqual(blank(searches.filter(search => !search.findValue0.startsWith('+')).at(-1)),
      { findKey0: 'Dn', findOp0: 'STARTS_WITH', findValue0: '', rowNum: '0' }, 'the readback reads every group number');
  } finally { await browser.close(); }
});
