const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);

// CommPilot's page shell with the 2.0 theme active.
function shell(body) {
  return `<!doctype html><html data-cp-direction="atlas"><head><title>Page</title></head>
    <body id="initBody.menuTemplate"><table height="100%"><tbody><tr>
    <td width="82%" valign="top">${body}</td></tr></tbody></table></body></html>`;
}

// The Groups search criteria as CommPilot renders them (trimmed), with its own addRow / onSearch.
const searchPage = shell(`<form name="mainForm"><table class="list" width="100%"><tbody>
  <tr id="trHeader" class="listHeader"><td colspan="6">Enter search criteria below</td></tr>
  <tr id="tr0"><td id="td00" align="center"><select id="findKey0" name="findKey0"><option>Group ID</option></select></td>
    <td id="td01" align="center"><select id="findOp0" name="findOp0"><option>Starts With</option></select></td>
    <td id="td02" align="center"><input type="text" id="findValue0" name="findValue0" size="30"></td>
    <td id="td03" align="center"> </td>
    <td id="td04" align="center"><input type="button" class="bwbutton" id="add0" value="+" onclick="addRow(this)"></td>
    <td id="td05" align="center"><input type="submit" class="bwbutton" id="search0" name="search" value="Search"
      onclick="window.searched = (window.searched || 0) + 1; return false;"></td></tr>
  </tbody></table></form>
  <script>
    function addRow(button) {
      const tbody = button.closest('tbody'); const n = tbody.querySelectorAll('tr[id^="tr"]:not(#trHeader)').length;
      const tr = document.createElement('tr'); tr.id = 'tr' + n;
      tr.innerHTML = '<td><select name="findKey' + n + '"><option>Group ID</option></select></td>' +
        '<td><input type="text" name="findValue' + n + '"></td><td><input type="button" value="+" onclick="addRow(this)"></td>';
      button.value = '-'; tbody.appendChild(tr);
    }
  </script>`);

test('form refresh notifications coalesce and decorate the current page after replacement', async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, searchPage);
    await page.locator('.cp-searchbar').waitFor();
    await page.evaluate(() => {
      window.formPasses = 0;
      const query = Element.prototype.querySelector;
      Element.prototype.querySelector = function (selector) {
        if (selector === '#search0') window.formPasses++;
        return query.call(this, selector);
      };
      for (let i = 0; i < 30; i++) {
        for (const event of ['cp:reskin', 'cp:morphed', 'cp:theme-change'])
          document.dispatchEvent(new Event(event));
      }
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const passes = await page.evaluate(() => window.formPasses);
    t.diagnostic(`90 notifications produced ${passes} form decoration passes`);
    assert.equal(passes, 1);
    await page.evaluate(html => {
      document.dispatchEvent(new Event('cp:reskin'));
      const replacement = new DOMParser().parseFromString(html, 'text/html');
      document.querySelector('td[width="82%"]')
        .replaceWith(replacement.querySelector('td[width="82%"]'));
      document.dispatchEvent(new Event('cp:morphed'));
    }, searchPage);
    await page.locator('.cp-searchbar').waitFor();
    assert.equal(await page.locator('.cp-searchbar-wrap').count(), 1);
    await page.locator('#search0').click();
    assert.equal(await page.evaluate(() => window.searched), 1, 'native search still receives the click');
  } finally { await browser.close(); }
});

// Call Forwarding Always as CommPilot renders it (trimmed), with a native rule: the number is only
// editable while forwarding is On.
const settingsBody = `<form name="mainForm" id="mainForm" method="post">
  <input type="hidden" name="formtokenserial" value="t1">
  <table width="100%"><tbody><tr><td class="screenName">Call Forwarding Always</td></tr>
  <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr>
    <td width="20"></td><td width="100%"><table><tbody>
      <tr><td colspan="2">&nbsp;</td></tr>
      <tr><td align="right">Call Forwarding Always: </td>
        <td align="left"><input type="radio" name="active" id="active_true" value="true"> On<input type="radio" name="active" id="active_false" value="false" checked=""> Off</td></tr>
      <tr><td align="right" nowrap="nowrap">* Calls Forward to phone number / SIP-URI: </td>
        <td align="left"><input type="text" name="forwardedToNumber" id="forwardedToNumber" value="" size="30" disabled></td></tr>
      <tr><td align="right"><input type="checkbox" name="ringSplash" id="ringSplash" value="on"></td>
        <td align="left">Play Ring Reminder when a call is forwarded</td></tr>
      <tr><td colspan="2">&nbsp;</td></tr>
    </tbody></table></td></tr></tbody></table></td></tr>
  <tr><td class="buttonbar"><input type="submit" name="apply" value="Apply"></td></tr></tbody></table></form>
  <script>
    for (const radio of document.querySelectorAll('input[name="active"]'))
      radio.addEventListener('click', () => { document.getElementById('forwardedToNumber').disabled = radio.value !== 'true'; });
  </script>`;

async function open(browser, html) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('https://apps-sbx.avpaas.io/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/Page/', { waitUntil: 'domcontentloaded' });
  for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
    await page.addStyleTag({ path: path.join(root, 'src/content', file) });
  await page.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
  return page;
}

test('list search criteria become one toolbar line that still drives CommPilot’s + and Search', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, searchPage);
    await page.locator('table.cp-searchbar').waitFor({ state: 'attached' });
    const layout = await page.evaluate(() => ({
      caption: getComputedStyle(document.getElementById('trHeader')).display,
      value: document.getElementById('findValue0').getBoundingClientRect(),
      search: document.getElementById('search0').getBoundingClientRect(),
      nativePlus: getComputedStyle(document.getElementById('add0')).display
    }));
    assert.equal(layout.caption, 'none', 'the “Enter search criteria below” caption is hidden');
    assert.ok(Math.abs(layout.value.top - layout.search.top) < 12, 'value and Search share one line');
    assert.ok(layout.search.left > layout.value.right && layout.search.left - layout.value.right < 40, 'Search follows the value');
    assert.equal(layout.nativePlus, 'none');
    await page.getByRole('button', { name: '+ Add criteria' }).click();
    assert.equal(await page.locator('tr#tr1').count(), 1, 'CommPilot’s own addRow ran');
    assert.equal(await page.getByRole('button', { name: '+ Add criteria' }).isVisible(), true, 'a new “+” exists, so the button stays');
    await page.locator('#search0').click();
    assert.equal(await page.evaluate(() => window.searched), 1, 'Search still runs CommPilot’s handler');
  } finally { await browser.close(); }
});

// The Users search row with CommPilot's own getChoice (trimmed to four fields): picking a field builds the row a new
// operator list and a new value box, an empty text box or a list of values.
const usersSearchPage = shell(`<form name="mainForm"><table class="list" width="100%"><tbody>
  <tr id="trHeader" class="listHeader"><td colspan="6">Enter search criteria below</td></tr>
  <tr id="tr0"><td id="td00" align="center"><select id="findKey0" name="findKey0">
      <option value="UserID" selected>User ID</option><option value="UserLastName">Last Name</option>
      <option value="Extension">Extension</option><option value="ExactUserDepartment">Department</option></select></td>
    <td id="td01" align="center"><select id="findOp0" name="findOp0"><option value="STARTS_WITH" selected>Starts With</option>
      <option value="CONTAINS">Contains</option><option value="EQUAL_TO">Equal To</option></select></td>
    <td id="td02" align="center"><input type="text" id="findValue0" name="findValue0" value="" maxlength="161" size="30"></td>
    <td id="td03" align="center"></td><td id="td04" align="center"></td>
    <td id="td05" align="center"><input type="submit" class="bwbutton" id="search0" name="search" value="Search"></td></tr>
  <tr id="trLast"><td colspan="6"></td></tr>
  </tbody></table></form>
  <script>
    var findOp = [], findValue = [];
    var findOpEqualTO = document.createElement('select'); findOpEqualTO.options[0] = new Option('Equal To', 'EQUAL_TO');
    var findOpFull = document.createElement('select');
    findOpFull.options[0] = new Option('Starts With', 'STARTS_WITH'); findOpFull.options[1] = new Option('Contains', 'CONTAINS');
    findOpFull.options[2] = new Option('Equal To', 'EQUAL_TO');
    [161, 30, 20].forEach(function (max, i) {
      findOp[i] = findOpFull; findValue[i] = document.createElement('input'); findValue[i].setAttribute('type', 'text');
      findValue[i].setAttribute('maxLength', max);
    });
    findOp[3] = findOpEqualTO; findValue[3] = document.createElement('select');
    findValue[3].options[0] = new Option('Basement', 'G+Basement'); findValue[3].options[1] = new Option('Front Counter', 'G+Front Counter');
    function getChoice(e) {
      var rowNum = e.target.id.substring(7), index = e.target.selectedIndex;
      var findOpOld = document.getElementById('findOp' + rowNum), findOpNew = document.createElement('select');
      for (var i = 0; i < findOp[index].length; i++) findOpNew.options[i] = new Option(findOp[index].options[i].text, findOp[index].options[i].value);
      findOpNew.setAttribute('id', 'findOp' + rowNum); findOpNew.setAttribute('name', 'findOp' + rowNum);
      findOpOld.parentNode.replaceChild(findOpNew, findOpOld);
      var findValueOld = document.getElementById('findValue' + rowNum), sample = findValue[index], findValueNew;
      if (sample.tagName == 'SELECT') {
        findValueNew = document.createElement('select');
        for (var j = 0; j < sample.length; j++) findValueNew.options[j] = new Option(sample.options[j].text, sample.options[j].value);
      } else {
        findValueNew = document.createElement('input'); findValueNew.setAttribute('type', 'text');
        findValueNew.setAttribute('maxLength', sample.maxLength);
      }
      findValueNew.setAttribute('id', 'findValue' + rowNum); findValueNew.setAttribute('name', 'findValue' + rowNum);
      findValueOld.parentNode.replaceChild(findValueNew, findValueOld);
    }
    document.getElementById('findKey0').addEventListener('change', function (event) { getChoice(event); });
  </script>`);

test('search design A resets native criteria without resetting the current form token',async()=>{
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try{
    const page=await open(browser,usersSearchPage);
    await page.evaluate(()=>{
      const form=document.querySelector('form[name="mainForm"]');
      const token=document.createElement('input');token.type='hidden';token.name='formtokenserial';token.defaultValue='spent-token';token.value='current-token';form.appendChild(token);
      form.addEventListener('submit',event=>{event.preventDefault();window.searchSnapshot=Object.fromEntries(new FormData(form));});
    });
    await page.locator('#findKey0').selectOption('UserLastName');
    await page.locator('#findOp0').selectOption('CONTAINS');
    await page.locator('#findValue0').fill('Example');
    await page.getByRole('button',{name:'Reset',exact:true}).click();
    const result=await page.evaluate(()=>window.searchSnapshot);
    assert.equal(result.formtokenserial,'current-token');assert.equal(result.findKey0,'UserID');assert.equal(result.findValue0,'');assert.equal(result.findOp0,'STARTS_WITH');
  }finally{await browser.close();}
});

test('changing a search field keeps the text typed and the operator picked', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, usersSearchPage);
    await page.addStyleTag({ path: path.join(root, 'src/content/enhancer.css') });   // the searchable dropdowns
    await page.addScriptTag({ path: path.join(root, 'src/content/enhancer.js') });
    const pick = async (id, label) => {
      await page.locator(`#${id}`).locator('xpath=..').locator('.bw-select-trigger').click();
      await page.locator('.bw-search-result', { hasText: label }).first().click();
      await page.waitForTimeout(100);
    };
    const row = () => page.evaluate(() => {
      const box = document.getElementById('findValue0'), ops = document.getElementById('findOp0');
      return { box: box.tagName, value: box.value, op: ops.value,
        shown: ops.closest('.bw-select-shell')?.querySelector('.bw-select-trigger')?.getAttribute('aria-label') };
    });
    await page.locator('#findOp0[data-bw-searchable="1"]').waitFor({ state: 'attached' });
    await page.locator('#findValue0').fill('smith');
    await pick('findOp0', 'Contains');
    await pick('findKey0', 'Last Name');
    assert.deepEqual(await row(), { box: 'INPUT', value: 'smith', op: 'CONTAINS', shown: 'findOp0: Contains. Search options' }, 'a new box, the same text and operator');
    await pick('findKey0', 'Department');
    assert.deepEqual((({ box, op }) => ({ box, op }))(await row()), { box: 'SELECT', op: 'EQUAL_TO' }, 'a list of values takes no text');
    await pick('findKey0', 'User ID');
    assert.deepEqual(await row(), { box: 'INPUT', value: 'smith', op: 'CONTAINS', shown: 'findOp0: Contains. Search options' }, 'both come back after the list');
    // A plain change of the native select, as a script makes it, carries the text too; it is cut to the new box's length.
    await page.locator('#findValue0').fill('a-very-long-search-text-here');
    await page.evaluate(() => { const key = document.getElementById('findKey0'); key.value = 'Extension'; key.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal((await row()).value, 'a-very-long-search-t', 'Extension holds 20 characters');
    await pick('findKey0', 'Last Name');
    await page.locator('#findValue0').fill('');
    await pick('findKey0', 'User ID');
    assert.equal((await row()).value, '', 'a box emptied on purpose stays empty');
  } finally { await browser.close(); }
});

test('settings forms become aligned rows whose controls are CommPilot’s own inputs', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, shell(settingsBody));
    await page.locator('.fx').waitFor();
    assert.deepEqual(await page.locator('.fx .fx-item > .fx-label').allInnerTexts(),
      ['Call Forwarding Always', 'Calls Forward to phone number / SIP-URI*']);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('td.enduserbody > table.fx-native')).display), 'none');
    // Two short choices are one segmented control; the real radios sit behind their labels.
    assert.deepEqual(await page.locator('.fx-seg .fx-opt').allInnerTexts(), ['On', 'Off']);
    // On | Off is colour-coded like the board's switches: the chosen side in the theme's On or Off colour.
    const lit = () => page.evaluate(() => [...document.querySelectorAll('.fx-seg .fx-opt')].map(opt => ({ tone: opt.dataset.tone,
      color: getComputedStyle(opt).color, on: getComputedStyle(document.body).getPropertyValue('--d-on').trim(),
      off: getComputedStyle(document.body).getPropertyValue('--d-off').trim() })));
    const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
    let tones = await lit();
    assert.deepEqual(tones.map(t => t.tone), ['on', 'off']);
    assert.equal(hex(tones[1].color), tones[1].off, 'Off, chosen, is in the Off colour');
    const number = page.locator('.fx input[name="forwardedToNumber"]');
    assert.equal(await number.isDisabled(), true, 'the real number field moved into the layout, still disabled while Off');
    await page.locator('.fx-seg .fx-opt', { hasText: 'On' }).click();
    assert.equal(await page.evaluate(() => document.getElementById('active_true').checked), true);
    tones = await lit();
    assert.equal(hex(tones[0].color), tones[0].on, 'On, chosen, is in the On colour');
    assert.notEqual(hex(tones[1].color), tones[1].off, 'Off is quiet once not chosen');
    assert.equal(await number.isEnabled(), true, 'CommPilot’s own script enabled the number');
    await number.fill('2125550100');
    // The checkbox is a switch beside its words; a click on the words toggles it.
    assert.equal(await page.locator('.fx-check input#ringSplash').evaluate(el => el.classList.contains('fx-switch')), true);
    await page.locator('.fx-check-text', { hasText: 'Play Ring Reminder' }).click();
    assert.equal(await page.evaluate(() => document.getElementById('ringSplash').checked), true);
    const sent = await page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm)));
    assert.deepEqual({ active: sent.active, number: sent.forwardedToNumber, splash: sent.ringSplash, token: sent.formtokenserial },
      { active: 'true', number: '2125550100', splash: 'on', token: 't1' }, 'the form submits the values chosen in the layout');
    // PJAX swaps the content and dispatches cp:reskin: the new page gets its layout once.
    await page.evaluate(body => {
      document.querySelector('td[width="82%"]').innerHTML = body;
      document.dispatchEvent(new Event('cp:reskin'));
    }, settingsBody);
    await page.waitForFunction(() => document.querySelectorAll('.fx').length === 1 && document.querySelector('.fx input[name="forwardedToNumber"]'));
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.fx').count(), 1);
  } finally { await browser.close(); }
});

// Assign Domains as CommPilot renders it (trimmed), with a stand-in for its picklist script.
const pickPage = shell(`<form name="mainForm"><input name="toAdd" type="hidden" value=""><input name="toRemove" type="hidden" value="">
  <table cellspacing="0" width="100%" class="enduserbody"><tbody>
  <tr><td class="listHeader" width="50%">Group Available Domains</td><td class="listHeader">&nbsp;</td><td class="listHeader" width="50%">Group Assigned Domains</td></tr>
  <tr><td><select name="availableList" id="availableList" size="11" multiple>
      <option value="a.example.com">a.example.com</option><option value="b.example.com">b.example.com</option><option value="c.example.com">c.example.com</option></select></td>
    <td><table><tbody><tr><td><input class="bwbutton" type="button" value="Add&nbsp;&gt;" id="PICKLIST_addDomain"></td></tr>
      <tr><td><input class="bwbutton" type="button" value="Remove&nbsp;&lt;" id="PICKLIST_removeDomain"></td></tr>
      <tr><td><input class="bwbutton" type="button" value="Add All&nbsp;&gt;&gt;" id="PICKLIST_selectAllDomain"></td></tr>
      <tr><td><input class="bwbutton" type="button" value="Remove All&nbsp;&lt;&lt;" id="PICKLIST_removeAllDomain"></td></tr></tbody></table></td>
    <td><select name="assignedList" id="assignedList" size="11" multiple><option value="sandbox.example.com*">sandbox.example.com*</option></select></td></tr>
  <tr><td colspan="2"></td><td><i>*=Default Domain</i></td></tr></tbody></table></form>
  <script>
    const move = (from, to, all, field) => {
      for (const o of [...document.getElementById(from).options]) if (all || o.selected) {
        o.selected = false; document.getElementById(to).appendChild(o);
        const f = document.forms.mainForm[field]; f.value = f.value ? f.value + ',' + o.value : o.value;
      }
    };
    document.getElementById('PICKLIST_addDomain').addEventListener('click', () => move('availableList', 'assignedList', false, 'toAdd'));
    document.getElementById('PICKLIST_removeDomain').addEventListener('click', () => move('assignedList', 'availableList', false, 'toRemove'));
    document.getElementById('PICKLIST_selectAllDomain').addEventListener('click', () => move('availableList', 'assignedList', true, 'toAdd'));
    document.getElementById('PICKLIST_removeAllDomain').addEventListener('click', () => move('assignedList', 'availableList', true, 'toRemove'));
  </script>`);

test('Available / Assigned lists become paired cards that drive CommPilot’s own picklist', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, pickPage);
    await page.locator('.cp-dl').waitFor();
    const count = side => page.locator('.cp-dl-pane').nth(side).locator('.cp-dl-count').innerText();
    assert.equal(await page.locator('.cp-dl-title').first().innerText(), 'Group Available Domains');
    assert.equal(await count(0), '3');
    assert.equal(await count(1), '1');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('availableList').closest('tr')).display), 'none');
    assert.equal(await page.getByText('*=Default Domain').isVisible(), true, 'CommPilot’s note row stays');
    assert.deepEqual(await page.locator('.cp-dl-move').allInnerTexts(), ['Add ›', 'Add all »', '‹ Remove', '« Remove all']);

    const b = page.getByRole('option', { name: 'b.example.com' });
    await b.click();
    assert.equal(await b.getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.querySelector('#availableList option[value="b.example.com"]').selected), true);
    await page.getByRole('button', { name: 'Add ›' }).click();
    assert.equal(await count(1), '2', 'CommPilot’s Add moved it');
    assert.equal(await page.evaluate(() => document.forms.mainForm.toAdd.value), 'b.example.com');

    await page.getByRole('searchbox', { name: 'Filter Group Available Domains' }).fill('c.ex');
    assert.equal(await page.locator('.cp-dl-pane').first().getByRole('option').count(), 1);
    await page.getByRole('option', { name: 'c.example.com' }).dblclick();
    assert.equal(await count(1), '3', 'double-click moves one item');
    assert.equal(await page.evaluate(() => document.forms.mainForm.toAdd.value), 'b.example.com,c.example.com');

    await page.getByRole('button', { name: '« Remove all' }).click();
    assert.equal(await count(0), '4');
    assert.equal(await count(1), '0');
    assert.equal(await page.locator('.cp-dl-pane').nth(1).getByText('Nothing here').isVisible(), true);
  } finally { await browser.close(); }
});

test('picklist Add follows the native selection-dependent disabled state', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const html = pickPage.replace('id="PICKLIST_addDomain"', 'id="PICKLIST_addDomain" disabled')
      .replace('</body>', '<script>document.getElementById("availableList").addEventListener("change",function(){' +
        'document.getElementById("PICKLIST_addDomain").disabled=!this.selectedOptions.length;});</script></body>');
    const page = await open(browser, html);
    const add = page.getByRole('button', { name: 'Add ›', exact: true });
    assert.equal(await add.isDisabled(), true);
    await page.getByRole('option', { name: 'b.example.com' }).click();
    await page.waitForFunction(() => !document.querySelector('.cp-dl-move').disabled, null, { timeout: 2000 });
    await add.click();
    assert.equal(await page.evaluate(() => document.forms.mainForm.toAdd.value), 'b.example.com');
  } finally { await browser.close(); }
});

test('picklist buttons follow native disabled changes made after layout', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, pickPage);
    await page.locator('.cp-dl').waitFor();
    for (const disabled of [true, false]) {
      await page.evaluate(disabled => { document.querySelector('#PICKLIST_addDomain').disabled = disabled; }, disabled);
      await page.waitForFunction(disabled => document.querySelector('.cp-dl-move').disabled === disabled,
        disabled, { timeout: 2000 });
    }
  } finally { await browser.close(); }
});

for (const mode of ['option', 'select']) test(`picklist cannot select or move a natively disabled ${mode}`, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const html = mode === 'option' ? pickPage.replace('<option value="b.example.com">', '<option disabled value="b.example.com">') :
      pickPage.replace('id="availableList"', 'id="availableList" disabled');
    const page = await open(browser, html);
    await page.locator('.cp-dl').waitFor();
    await page.getByRole('option', { name: 'b.example.com' }).evaluate(el => {
      el.click();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(await page.evaluate(() => document.querySelector('#availableList option[value="b.example.com"]')?.selected), false);
    assert.equal(await page.evaluate(() => document.forms.mainForm.toAdd.value), '');
    assert.equal(await page.getByRole('option', { name: 'b.example.com' }).getAttribute('aria-disabled'), 'true');
    const style = await page.getByRole('option', { name: 'b.example.com' }).evaluate(el => {
      const disabled = getComputedStyle(el), peer = getComputedStyle(document.querySelector('.cp-dl-pane:last-child .cp-dl-row'));
      return { opacity: disabled.opacity, cursor: disabled.cursor, font: disabled.fontFamily, size: disabled.fontSize,
        peerFont: peer.fontFamily, peerSize: peer.fontSize };
    });
    assert.equal(style.opacity, '0.5'); assert.equal(style.cursor, 'not-allowed');
    assert.equal(style.font, style.peerFont); assert.equal(style.size, style.peerSize);
    await page.evaluate(mode => {
      const select = document.querySelector('#availableList');
      (mode === 'option' ? select.querySelector('[value="b.example.com"]') : select).disabled = false;
    }, mode);
    await page.waitForFunction(() => [...document.querySelectorAll('.cp-dl-row')].some(el =>
      el.textContent === 'b.example.com' && el.getAttribute('aria-disabled') === 'false'));
    await page.getByRole('option', { name: 'b.example.com' }).click();
    await page.getByRole('button', { name: 'Add ›', exact: true }).click();
    assert.equal(await page.evaluate(() => document.forms.mainForm.toAdd.value), 'b.example.com', 'native enablement restores normal use');
  } finally { await browser.close(); }
});

// A schedule event as CommPilot renders it (trimmed), with stand-ins for its own scripts: Repeats shows the
// matching pattern row, All Day disables the times.
const dayBox = (day, on) => `<td><input type="checkbox" name="recurWeekly${day}" id="recurWeekly${day}" value="checked"${on ? ' checked' : ''}></td><td>${day}</td>`;
const eventPage = shell(`<form name="mainForm"><input type="hidden" name="use24HourNotation" value="false">
  <input type="hidden" name="startTime_hour" value="8"><input type="hidden" name="startTime_minute" value="0">
  <input type="hidden" name="endTime_hour" value="17"><input type="hidden" name="endTime_minute" value="0">
  <table><tbody><tr><td class="enduserbody">
  <table class="enduserbody"><tbody><tr><td align="right">Schedule Name: </td><td align="left">Business Hours</td></tr>
    <tr><td align="right">* Event Name: </td><td align="left"><input type="text" name="eventName" id="eventName" value="Monday through Friday"></td></tr></tbody></table>
  <table class="enduserbody"><tbody><tr><td colspan="10"><fieldset><legend>Event Details</legend><table><tbody>
    <tr><td colspan="8"><b>Event Time: </b></td></tr>
    <tr><td>* Start Date: </td><td><input type="text" name="startDate" id="startDate" value="1/22/2024">
        <input type="hidden" name="startDate_month" value="1"><input type="hidden" name="startDate_day" value="22"><input type="hidden" name="startDate_year" value="2024"> (mm/dd/yyyy)</td>
      <td>* Start Time: </td><td><input type="text" name="startTime" id="startTime" value="8:00"><select name="startAmpm" id="startAmpm"><option value="AM" selected>AM</option><option value="PM">PM</option></select></td>
      <td><input type="checkbox" name="allDayEvent" id="allDayEvent" value="checked"></td><td>All Day Event</td></tr>
    <tr><td>* End Date: </td><td><input type="text" name="endDate" id="endDate" value="1/22/2024">
        <input type="hidden" name="endDate_month" value="1"><input type="hidden" name="endDate_day" value="22"><input type="hidden" name="endDate_year" value="2024"></td>
      <td>* End Time: </td><td><input type="text" name="endTime" id="endTime" value="5:00"><select name="endAmpm" id="endAmpm"><option value="AM">AM</option><option value="PM" selected>PM</option></select></td></tr>
    <tr><td>Duration: </td><td id="durationTime">9 hours</td></tr>
    <tr><td colspan="8"><b>Recurrence Pattern: </b></td></tr>
    <tr><td>Recurs: </td><td><select name="recurType" id="recurType"><option value="Never">Never</option><option value="Daily">Daily</option>
      <option value="Weekly" selected>Weekly</option><option value="Monthly">Monthly</option><option value="Yearly">Yearly</option></select></td></tr>
    <tr id="rowDaily" style="display:none"><td>Every: </td><td><input type="text" name="recurDailyInterval" id="recurDailyInterval" value="1"> day(s)</td></tr>
    <tr id="rowWeekly"><td>Every: </td><td><table><tbody><tr><td><input type="text" name="recurWeeklyInterval" id="recurWeeklyInterval" value="1"></td><td>week(s) on:</td>
      ${dayBox('Sunday')}${dayBox('Monday', 1)}${dayBox('Tuesday', 1)}${dayBox('Wednesday', 1)}${dayBox('Thursday', 1)}${dayBox('Friday', 1)}${dayBox('Saturday')}</tr></tbody></table></td></tr>
    <tr id="rowMonthly" style="display:none"><td>Every: </td><td><input type="text" name="recurMonthlyInterval" value="1"> month(s)</td></tr>
    <tr id="rangeRow"><td>Ends: </td><td><input type="radio" name="endType" value="Never" checked> Never</td></tr>
  </tbody></table></fieldset></td></tr></tbody></table></td></tr></tbody></table></form>
  <script>
    document.getElementById('recurType').addEventListener('change', e => {
      for (const kind of ['Daily', 'Weekly', 'Monthly']) document.getElementById('row' + kind).style.display = e.target.value === kind ? '' : 'none';
    });
    document.getElementById('allDayEvent').addEventListener('click', e => {
      for (const id of ['startTime', 'endTime', 'startAmpm', 'endAmpm']) document.getElementById(id).disabled = e.target.checked;
    });
  </script>`);

for (const name of ['startDate', 'endDate', 'startTime', 'endTime']) {
  for (const h24 of name.endsWith('Time') ? [false, true] : [false]) {
    test(`clearing schedule ${name} clears native values and can be corrected (${h24 ? '24-hour' : '12-hour'})`, async () => {
      const browser = await chromium.launch({ executablePath: browserPath, headless: true });
      try {
        const html = h24 ? eventPage.replace('name="use24HourNotation" value="false"',
          'name="use24HourNotation" value="true"').replace('id="endTime" value="5:00"', 'id="endTime" value="17:00"') : eventPage;
        const page = await open(browser, html), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const date = name.endsWith('Date'), label = (name.startsWith('start') ? 'Start ' : 'End ') + (date ? 'date' : 'time');
        const input = page.getByLabel(label, { exact: true });
        const names = [name, ...(date ? ['month', 'day', 'year'] : ['hour', 'minute']).map(part => name + '_' + part)];
        const values = () => page.evaluate(names => names.map(n => document.forms.mainForm.elements.namedItem(n).value), names);
        await input.fill('');
        await input.dispatchEvent('change');
        assert.deepEqual(await values(), names.map(() => ''), 'the submitted native fields match the cleared picker');
        assert.doesNotMatch(await page.locator('.cp-ev-sum').innerText(), /NaN|undefined|Invalid Date/);
        await input.fill(date ? '2026-10-22' : '13:15');
        await input.dispatchEvent('change');
        assert.deepEqual(await values(), date ? ['10/22/2026', '10', '22', '2026'] :
          [h24 ? '13:15' : '1:15', '13', '15'], 'correcting the empty field restores native date/time parts');
        assert.deepEqual(errors, []);
      } finally { await browser.close(); }
    });
  }
}

test('the schedule event editor shows a summary and pickers that write CommPilot’s own fields', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, eventPage);
    await page.locator('.cp-ev').waitFor();
    const summary = () => page.locator('.cp-ev-sum').innerText();
    assert.equal(await summary(), 'Every week on weekdays, 8:00 AM – 5:00 PM, from Jan 22, 2024.');
    assert.equal(await page.locator('.cp-ev input[name="eventName"]').inputValue(), 'Monday through Friday', 'the real name field moved in');
    assert.equal(await page.locator('.cp-ev-static').innerText(), 'Business Hours');
    const value = name => page.evaluate(n => document.forms.mainForm[n].value, name);

    await page.getByLabel('Start date').fill('2024-01-29');
    await page.getByLabel('Start date').dispatchEvent('change');
    assert.equal(await value('startDate'), '1/29/2024');
    assert.deepEqual([await value('startDate_month'), await value('startDate_day'), await value('startDate_year')], ['1', '29', '2024']);
    await page.getByLabel('End time').fill('13:15');
    await page.getByLabel('End time').dispatchEvent('change');
    assert.deepEqual([await value('endTime'), await value('endAmpm'), await value('endTime_hour')], ['1:15', 'PM', '13']);
    assert.equal(await summary(), 'Every week on weekdays, 8:00 AM – 1:15 PM, from Jan 29, 2024.');

    await page.getByRole('button', { name: 'Saturday' }).click();
    assert.equal(await page.evaluate(() => document.getElementById('recurWeeklySaturday').checked), true);
    assert.match(await summary(), /^Every week on Mon, Tue, Wed, Thu, Fri, Sat,/);

    await page.getByRole('switch', { name: 'All day' }).click();
    assert.equal(await page.evaluate(() => document.getElementById('allDayEvent').checked), true);
    assert.equal(await page.getByLabel('Start time').isDisabled(), true, 'CommPilot disabled the times, so do the pickers');
    assert.match(await summary(), /, all day, /);

    await page.getByRole('radio', { name: 'Monthly' }).click();
    assert.equal(await value('recurType'), 'Monthly');
    assert.equal(await page.locator('#rowMonthly').isVisible(), true, 'CommPilot’s own Monthly row is shown below the card');
    assert.equal(await page.getByRole('button', { name: 'Saturday' }).isVisible(), false, 'the weekly row hides');
    assert.equal(await page.locator('#rangeRow').isVisible(), true, 'the recurrence range stays native');
    assert.equal(await page.locator('#durationTime').isVisible(), false);
  } finally { await browser.close(); }
});

// The Groups list after a search, as CommPilot frames it (trimmed): spacer rows, the action bar above and its copy
// below, the results with zero-width separator columns and row Edit links, the empty band under the results,
// the pager, and the older one-line Find form.
const listPage = shell(`<form name="mainForm" id="mainForm" method="post"><input type="hidden" name="formtokenserial" value="t1">
  <table width="100%" border="0" cellpadding="0"><tbody>
  <tr><td height="10"></td></tr>
  <tr><td class="screenName">Groups</td></tr>
  <tr><td height="5"></td></tr>
  <tr><td class="tip">Search for groups in the reseller.</td></tr>
  <tr><td height="5"></td></tr>
  <tr id="buttonbartop"><td class="buttonbar"> <input type="button" name="ok" value="OK" onclick="window.okClicks = (window.okClicks || 0) + 1"> </td></tr>
  <tr><td class="enduserbody">
    <table width="100%" border="0" cellpadding="2"><tbody>
      <tr><td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="20" height="1" border="0"></td>
        <td class="listHeader">Group ID</td><td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="0" height="1"></td>
        <td class="listHeader">Edit</td></tr>
      <tr id="Row1" class="unselected"><td width="20"></td><td><a class="tableLink" href="#">Empire Records</a></td><td width="0"></td>
        <td class="unselected"><a class="headerLink" href="#">Edit</a></td></tr>
      <tr id="Row2" class="unselected"><td width="20"></td><td><a class="tableLink" href="#">Quick Stop</a></td><td width="0"></td>
        <td class="unselected"><a class="headerLink" href="#">Edit</a></td></tr>
    </tbody></table>
    <table width="100%" border="0" cellpadding="0"><tbody><tr><td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="1" height="2"></td></tr></tbody></table>
    <table class="enduserbody" width="100%" border="0" cellpadding="3"><tbody><tr>
      <td width="33%"></td><td width="33%" align="center">[ Page 1 of 1 ]</td><td width="33%"></td></tr></tbody></table>
    <table class="enduserbody" width="100%" border="0" cellpadding="0"><tbody><tr>
      <td><select name="findKey"><option>Group ID</option></select></td><td><input type="text" name="findValue"></td>
      <td><a id="findButton" class="headerLink" href="#">Find</a></td></tr></tbody></table>
  </td></tr>
  <tr id="buttonbarbottom"><td class="buttonbar"> <input type="button" name="ok" value="OK"> </td></tr>
  </tbody></table></form>`);

test('the shared page frame: actions beside the title, one flat card, compact rows, a footer pager', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, listPage);
    await page.locator('table.cp-frame').waitFor({ state: 'attached' });
    const ok = page.locator('td.screenName .cp-frame-actions input[name="ok"]');
    assert.equal(await ok.count(), 1, 'the top bar’s OK moved beside the title');
    assert.equal(await page.evaluate(() => document.forms.mainForm.contains(document.querySelector('.cp-frame-actions input'))), true, 'and stays in the form');
    await ok.click();
    assert.equal(await page.evaluate(() => window.okClicks), 1, 'CommPilot’s own handler still runs');
    const frame = await page.evaluate(() => {
      const shown = el => el && getComputedStyle(el).display !== 'none';
      const body = document.querySelector('td.cp-frame-body');
      const results = document.querySelector('table.cp-frame-results');
      const pager = document.querySelector('table.cp-frame-pager');
      const edit = document.querySelector('#Row1 a.headerLink');
      const find = document.getElementById('findButton');
      return {
        bars: [shown(document.getElementById('buttonbartop')), shown(document.getElementById('buttonbarbottom'))],
        spacers: [...document.querySelectorAll('table.cp-frame > tbody > tr')].filter(tr => shown(tr) && !tr.textContent.trim() && !tr.querySelector('input, table')).length,
        sticky: getComputedStyle(document.querySelector('td.screenName')).position,
        rowHeight: document.getElementById('Row1').getBoundingClientRect().height,
        editBorder: getComputedStyle(edit).borderTopWidth, editDisplay: getComputedStyle(edit).display,
        findDisplay: getComputedStyle(find).display, findBorder: getComputedStyle(find).borderTopWidth,
        rule: shown(document.querySelector('table.cp-frame-rule')),
        pagerText: pager.textContent.replace(/\s+/g, ' ').trim(),
        bleed: [results.getBoundingClientRect().width, pager.getBoundingClientRect().width, body.clientWidth],
        innerCard: [getComputedStyle(pager).borderLeftWidth, getComputedStyle(pager).backgroundColor],
        findLine: [document.querySelector('table.cp-findline').getBoundingClientRect().width, body.getBoundingClientRect().width],
        frameWidth: [document.querySelector('table.cp-frame').getBoundingClientRect().width, document.forms.mainForm.getBoundingClientRect().width],
      };
    });
    assert.deepEqual(frame.bars, [false, false], 'both native action bars hide once their buttons moved');
    assert.equal(frame.spacers, 0, 'spacer rows add no height');
    assert.equal(frame.sticky, 'sticky', 'the title row with the actions stays in reach while scrolling');
    assert.ok(frame.rowHeight <= 34, `result rows are compact (${frame.rowHeight}px)`);
    assert.deepEqual([frame.editBorder, frame.editDisplay], ['0px', 'inline'], 'a row’s Edit is a plain link, not a header pill');
    assert.deepEqual([frame.findDisplay, frame.findBorder], ['inline-flex', '1px'], 'Find outside the rows is a compact button');
    assert.equal(frame.rule, false, 'the empty band under the results is gone');
    assert.equal(frame.pagerText, '[ Page 1 of 1 ]', 'CommPilot’s pager text stays as served (bulk tools read it)');
    assert.ok(Math.abs(frame.bleed[0] - frame.bleed[2]) < 2 && Math.abs(frame.bleed[1] - frame.bleed[2]) < 2, 'results and pager run edge to edge in the card');
    assert.deepEqual(frame.innerCard, ['0px', 'rgba(0, 0, 0, 0)'], 'no card inside the card');
    assert.ok(frame.findLine[0] < frame.findLine[1] / 2, 'the Find line packs together');
    assert.ok(Math.abs(frame.frameWidth[0] - frame.frameWidth[1]) < 1, 'the frame uses the full width');
  } finally { await browser.close(); }
});

test('the shared page frame keeps a bar with text in it; the form under it becomes aligned rows and sections', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, shell(`<form name="mainForm"><table width="100%"><tbody>
      <tr><td class="screenName">Profile</td></tr>
      <tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="apply" value="Apply"> Changes apply at midnight</td></tr>
      <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr><td width="20"><img src="/commpilot/Graphics/onepx.gif" width="20" height="1"></td>
        <td width="100%"><table><tbody>
          <tr><td colspan="2">&nbsp;</td></tr>
          <tr><td>Group Name:</td><td><input type="text" name="groupName"></td></tr>
          <tr><td colspan="2">&nbsp;</td></tr>
        </tbody></table>
        <fieldset><legend>User Limits</legend><table><tbody><tr><td>Limited To:</td><td><input type="text" name="limit"></td></tr></tbody></table></fieldset>
      </td></tr></tbody></table></td></tr>
      <tr id="buttonbarbottom"><td class="buttonbar"><input type="submit" name="apply" value="Apply"></td></tr>
      </tbody></table></form>`));
    await page.locator('table.cp-frame').waitFor({ state: 'attached' });
    const state = await page.evaluate(() => ({
      moved: document.querySelectorAll('.cp-frame-actions input').length,
      bars: [...document.querySelectorAll('#buttonbartop, #buttonbarbottom')].map(tr => getComputedStyle(tr).display !== 'none'),
      barBackground: getComputedStyle(document.querySelector('#buttonbartop td')).backgroundColor,
      sections: [...document.querySelectorAll('.fx > .fx-sec')].map(sec => sec.dataset.title || ''),
      labels: [...document.querySelectorAll('.fx .fx-item > .fx-label')].map(l => l.textContent),
      native: getComputedStyle(document.querySelector('td.enduserbody > table.fx-native')).display,
    }));
    assert.equal(state.moved, 0, 'a bar with text is not taken apart');
    assert.deepEqual(state.bars, [true, true]);
    assert.equal(state.barBackground, 'rgba(0, 0, 0, 0)', 'it is a plain row of controls, not a band');
    assert.deepEqual(state.sections, ['', 'User Limits'], 'the fields, then the fieldset as a titled section');
    assert.deepEqual(state.labels, ['Group Name', 'Limited To']);
    assert.equal(state.native, 'none', 'CommPilot’s emptied tables stay in the form, hidden');
  } finally { await browser.close(); }
});

// Profile as CommPilot renders it (trimmed): read-only IDs with "Change … (Also saves current screen data)" links,
// two fields to a row, a note under a field, a fieldset, and an address's second line under the first.
const profilePage = shell(`<form name="mainForm" id="mainForm" method="post"><table width="100%"><tbody>
  <tr><td class="screenName">Profile</td></tr>
  <tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="ok" value="OK"> <input type="submit" name="apply" value="Apply"></td></tr>
  <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr><td width="20"></td><td width="100%">
    <table><tbody>
      <tr><td align="right">Group: </td><td align="left">Stan Mikita Donuts</td></tr>
      <tr><td align="right">User ID: </td><td align="left">SMDonuts21</td>
        <td colspan="2" align="center"><a class="nestedLink" id="changeUser">Change User ID (Also saves current screen data)</a></td></tr>
      <tr id="nameRow"><td align="right" nowrap>* Last Name: </td><td align="left"><input type="text" name="lastName" id="lastName" value="Campbell" size="30" maxlength="30"></td>
        <td align="right" nowrap>* First Name: </td><td align="left"><input type="text" name="firstName" id="firstName" value="Wayne" size="30" maxlength="30"></td></tr>
      <tr><td align="right">Calling Line ID Phone Number: </td><td align="left"><input type="text" name="clid" value="" size="23" maxlength="23"></td></tr>
      <tr><td></td><td align="left">Phone number is stored as typed</td></tr>
      <tr id="deptRow"><td align="right">Department: </td><td align="left" id="deptCell"><select name="dept"><option>Basement</option><option>Lobby</option></select></td></tr>
    </tbody></table>
    <table width="100%"><tbody><tr><td width="100%"><fieldset class="fldsetline"><legend class="fldset"> Additional Information </legend>
      <table><tbody>
        <tr><td align="right" nowrap>E-mail: </td><td align="left" colspan="3"><input type="text" name="email" value="wayne@example.com" size="50" maxlength="80"></td></tr>
        <tr><td align="right" nowrap>Address: </td><td align="left" colspan="3"><input type="text" name="addressLine1" value="" size="68" maxlength="80"></td></tr>
        <tr><td width="20"></td><td align="left" colspan="3"><input type="text" name="addressLine2" value="" size="68" maxlength="80"></td></tr>
      </tbody></table></fieldset></td></tr></tbody></table>
  </td></tr></tbody></table></td></tr>
  </tbody></table></form>
  <script>document.getElementById('changeUser').addEventListener('click', () => { window.changed = (window.changed || 0) + 1; });</script>`);

test('a big form: IDs in a strip, Change buttons that say they save, pairs kept, sections, chips and unsaved changes', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, profilePage);
    await page.locator('.fx').waitFor();
    // The page's own script fills a field before you touch anything: not your change.
    await page.evaluate(() => { document.querySelector('input[name="clid"]').value = '+12125550100'; document.querySelector('input[name="clid"]').dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.fx-item.is-dirty').count(), 0);
    const facts = await page.locator('.fx-facts .fx-fact').evaluateAll(els => els.map(el => [el.querySelector('.fx-fact-k').textContent,
      el.querySelector('.fx-fact-v').textContent, el.querySelector('.fx-linkbtn')?.textContent || '']));
    assert.deepEqual(facts, [['Group', 'Stan Mikita Donuts', ''], ['User ID', 'SMDonuts21', 'Change User ID']]);
    const change = page.locator('.fx-fact a.fx-linkbtn.fx-saves');
    assert.match(await change.evaluate(el => getComputedStyle(el, '::after').content), /saves first/);
    await change.click();
    assert.equal(await page.evaluate(() => window.changed), 1, 'CommPilot’s own handler still runs');
    // Last Name and First Name came from one CommPilot row: one line, side by side.
    const pair = await page.evaluate(() => {
      const line = document.getElementById('lastName').closest('.fx-line');
      const [a, b] = [document.getElementById('lastName'), document.getElementById('firstName')].map(el => el.getBoundingClientRect());
      return { same: line === document.getElementById('firstName').closest('.fx-line'), top: Math.abs(a.top - b.top), right: b.left > a.right };
    });
    assert.deepEqual([pair.same, pair.top < 2, pair.right], [true, true, true]);
    assert.equal(await page.locator('.fx-field', { has: page.locator('input[name="clid"]') }).locator('.fx-hint').innerText(), 'Phone number is stored as typed');
    assert.equal(await page.locator('.fx-sec[data-title="Additional Information"] .fx-sec-title').innerText(), 'ADDITIONAL INFORMATION');
    assert.equal(await page.locator('.fx-field', { has: page.locator('input[name="addressLine1"]') }).locator('input[name="addressLine2"]').count(), 1,
      'the second address line sits under the first, in the same field');
    // The header, built after the layout: chips for the sections, a count of unsaved changes.
    assert.deepEqual(await page.locator('.cp-frame-head .fx-jump-chip').allInnerTexts(), ['Details', 'Additional Information']);
    assert.equal(await page.locator('.fx-unsaved').count(), 0);
    await page.locator('input[name="lastName"]').fill('Campbell Jr');
    await page.locator('.fx select[name="dept"]').selectOption('Lobby');
    await page.waitForFunction(() => document.querySelector('.fx-unsaved')?.textContent === '2 unsaved changes');
    assert.equal(await page.locator('.fx-item.is-dirty').count(), 2);
    assert.equal(await page.evaluate(() => document.querySelector('.fx-unsaved').closest('.cp-frame-actions') !== null), true);
    await page.locator('input[name="lastName"]').fill('Campbell');
    await page.waitForFunction(() => document.querySelector('.fx-unsaved')?.textContent === '1 unsaved change');
  } finally { await browser.close(); }
});

test('the layout follows CommPilot: rows it hides and shows, controls it puts into a cell', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, profilePage);
    await page.locator('.fx').waitFor();
    const dept = page.locator('.fx-field', { has: page.locator('[name="dept"]') });
    await page.evaluate(() => { document.getElementById('deptRow').style.display = 'none'; });
    await page.waitForFunction(() => document.querySelector('.fx select[name="dept"]').closest('.fx-item').hidden);
    await page.evaluate(() => { document.getElementById('deptRow').style.display = ''; });
    await page.waitForFunction(() => !document.querySelector('.fx select[name="dept"]').closest('.fx-item').hidden);
    // A script that rebuilds the cell: the new list replaces the old one in the layout (never two of the same name).
    await page.evaluate(() => { document.getElementById('deptCell').innerHTML = '<select name="dept"><option>Garage</option></select>'; });
    await page.waitForFunction(() => document.querySelectorAll('select[name="dept"]').length === 1 &&
      document.querySelector('.fx select[name="dept"]')?.value === 'Garage');
    assert.equal(await dept.isVisible(), true);
    // A control put into a cell that was empty when the page opened (a port list for a device type) joins its row's
    // field; one in a brand-new row comes in with its row. Neither is left hidden in CommPilot's table.
    await page.evaluate(() => {
      const row = document.getElementById('deptRow');
      const cell = document.createElement('td');
      row.appendChild(cell);
      cell.innerHTML = '<select name="portNumber"><option>1</option><option>2</option></select>';
      const extra = document.createElement('tr');
      extra.innerHTML = '<td>Port:</td><td><input type="text" name="portOther" value="5060"></td>';
      row.parentNode.appendChild(extra);
    });
    await page.waitForFunction(() => document.querySelector('.fx select[name="portNumber"]') && document.querySelector('.fx input[name="portOther"]'));
    assert.equal(await page.evaluate(() => document.querySelector('.fx select[name="portNumber"]').closest('.fx-item') ===
      document.querySelector('.fx select[name="dept"]').closest('.fx-item')), true, 'the port list sits with its row’s field');
    assert.equal(await page.locator('.fx input[name="portOther"]').isVisible(), true);
    // A list page has nothing to lay out: it keeps today's look.
    const list = await open(browser, listPage);
    await list.locator('table.cp-frame').waitFor({ state: 'attached' });
    assert.equal(await list.locator('.fx').count(), 0);
  } finally { await browser.close(); }
});

test('an empty list shows what will be there (headings’ words only, not their scripts), with its own Add; Add is not a second green button', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, shell(`<form name="mainForm"><table width="100%"><tbody>
      <tr><td class="screenName">Call Notify</td></tr>
      <tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="apply" value="Apply"> <input type="button" name="add" value="Add" onclick="window.adds = (window.adds || 0) + 1"></td></tr>
      <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr><td width="20"></td><td width="100%">
        <table><tbody><tr><td align="right">* Send e-mail to: </td><td align="left"><input type="text" name="email" size="40"></td></tr></tbody></table>
        <table width="100%"><tbody><tr><td class="listHeader">Active</td><td class="listHeader"><a class="listSortHeader" id="sortDesc">Description</a><script>document.addEventListener('DOMContentLoaded', function () { var elem = document.getElementById('sortDesc'); });</script></td><td class="listHeader">Calls from</td><td class="listHeader">Edit</td></tr>
          <tr><td colspan="4">No Entries Present</td></tr></tbody></table>
      </td></tr></tbody></table></td></tr></tbody></table></form>`));
    await page.locator('.fx-empty').waitFor();
    assert.equal(await page.locator('.fx-empty-words').innerText(), 'Nothing here yet\nEntries you add show here with their description, calls from.');
    await page.getByRole('button', { name: '+ Add' }).click();
    assert.equal(await page.evaluate(() => window.adds), 1, 'it presses CommPilot’s own Add');
    const colors = await page.evaluate(() => ['apply', 'add'].map(n => getComputedStyle(document.querySelector(`.cp-frame-actions input[name="${n}"]`)).backgroundColor));
    assert.notEqual(colors[0], colors[1], 'Apply keeps the action colour; Add is outlined');
  } finally { await browser.close(); }
});

test('radio options keep their words however CommPilot writes them', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, shell(`<form name="mainForm"><table width="100%"><tbody>
      <tr><td class="screenName">Addresses</td></tr>
      <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr><td width="20"></td><td width="100%"><table><tbody>
        <tr><td align="left"><input type="radio" name="a" id="a1" value="1" checked> Identity/Device Profile&nbsp;&nbsp;&nbsp;<input type="radio" name="a" id="a2" value="2"> Trunking&nbsp;&nbsp;&nbsp;<input type="radio" name="a" id="a3" value="3"> None&nbsp;&nbsp;&nbsp;</td></tr>
        <tr><td align="right">Device: </td><td align="left"><input type="radio" name="b" id="b1" value="1" checked><label for="b1">Identity/Device Profile Name</label>&nbsp;<input type="radio" name="b" id="b2" value="2"><label for="b2">Trunking Group Name</label></td></tr>
        <tr><td align="right">Mode: </td><td align="left"><input type="radio" name="c" id="c1" value="1" checked><span>Use the group's setting</span><br><input type="radio" name="c" id="c2" value="2"><span>Use this user's own setting</span></td></tr>
        <tr><td align="right">Wrapped: </td><td align="left"><label><input type="radio" name="d" id="d1" value="1" checked> Every day all day</label> <label><input type="radio" name="d" id="d2" value="2"> Weekdays only, business hours</label></td></tr>
      </tbody></table></td></tr></tbody></table></td></tr></tbody></table></form>`));
    await page.locator('.fx').waitFor();
    const groups = await page.locator('.fx-choice .fx-opts').evaluateAll(gs => gs.map(g => [...g.querySelectorAll('.fx-opt')].map(o => o.textContent.replace(/\s+/g, ' ').trim())));
    assert.deepEqual(groups, [['Identity/Device Profile', 'Trunking', 'None'], ['Identity/Device Profile Name', 'Trunking Group Name'],
      ['Use the group’s setting'.replace('’', "'"), "Use this user's own setting"], ['Every day all day', 'Weekdays only, business hours']]);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('table.fx-native')].map(t => t.textContent.replace(/\s+/g, '')).join('')),
      'Device:Mode:Wrapped:', 'only the labels (copied, not moved) stay in CommPilot’s hidden table');
    await page.locator('.fx-opt', { hasText: 'Trunking Group Name' }).click();
    await page.locator('.fx-opt', { hasText: 'Weekdays only' }).click();
    assert.deepEqual(await page.evaluate(() => [document.getElementById('b2').checked, document.getElementById('d2').checked]), [true, true]);
  } finally { await browser.close(); }
});
