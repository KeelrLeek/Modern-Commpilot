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

test('small settings forms become rows whose controls drive CommPilot’s own inputs', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await open(browser, shell(settingsBody));
    await page.locator('.cp-set').waitFor();
    assert.equal(await page.locator('.cp-set-row').count(), 3);
    assert.equal(await page.locator('.cp-set-head').innerText(), 'Call Forwarding Always');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('table.cp-set-native')).display), 'none');
    const off = page.getByRole('radio', { name: 'Off' });
    const on = page.getByRole('radio', { name: 'On' });
    assert.equal(await off.getAttribute('aria-checked'), 'true');
    const number = page.locator('.cp-set input[name="forwardedToNumber"]');
    assert.equal(await number.isDisabled(), true, 'the real number field moved into the card, still disabled while Off');
    await on.click();
    assert.equal(await page.evaluate(() => document.getElementById('active_true').checked), true);
    assert.equal(await on.getAttribute('aria-checked'), 'true');
    assert.equal(await number.isEnabled(), true, 'CommPilot’s own script enabled the number');
    await number.fill('2125550100');
    const reminder = page.getByRole('switch', { name: 'Play Ring Reminder when a call is forwarded' });
    await reminder.click();
    assert.equal(await reminder.getAttribute('aria-checked'), 'true');
    const sent = await page.evaluate(() => Object.fromEntries(new FormData(document.forms.mainForm)));
    assert.deepEqual({ active: sent.active, number: sent.forwardedToNumber, splash: sent.ringSplash },
      { active: 'true', number: '2125550100', splash: 'on' }, 'the form submits the values chosen in the card');
    // PJAX swaps the content and dispatches cp:reskin: the new page gets its card once.
    await page.evaluate(body => {
      document.querySelector('td[width="82%"]').innerHTML = body;
      document.dispatchEvent(new Event('cp:reskin'));
    }, settingsBody);
    await page.waitForFunction(() => document.querySelectorAll('.cp-set').length === 1);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.cp-set').count(), 1);
  } finally { await browser.close(); }
});

test('forms outside the simple settings pattern keep CommPilot’s layout', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const withPassword = settingsBody.replace('<input type="text" name="forwardedToNumber"', '<input type="password" name="pin"><input type="text" name="forwardedToNumber"');
    const nested = settingsBody.replace('Play Ring Reminder when a call is forwarded', '<table><tr><td>nested</td></tr></table>');
    for (const body of [withPassword, nested]) {
      const page = await open(browser, shell(body));
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.cp-set').count(), 0);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('td.enduserbody table table')).display), 'table');
      await page.close();
    }
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

test('the shared page frame keeps a bar with text in it, and turns blank rows and fieldsets into light sections', async () => {
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
      gaps: [...document.querySelectorAll('tr.cp-frame-gap')].map(tr => Math.round(tr.getBoundingClientRect().height)),
      indent: document.querySelector('td[width="20"]').getBoundingClientRect().width,
      fieldset: ['borderLeftWidth', 'borderTopWidth', 'backgroundColor'].map(k => getComputedStyle(document.querySelector('fieldset'))[k]),
    }));
    assert.equal(state.moved, 0, 'a bar with text is not taken apart');
    assert.deepEqual(state.bars, [true, true]);
    assert.equal(state.barBackground, 'rgba(0, 0, 0, 0)', 'it is a plain row of controls, not a band');
    assert.equal(state.gaps.length, 2, 'the &nbsp; rows become gaps');
    assert.ok(state.gaps.every(h => h <= 8), `gaps are small (${state.gaps})`);
    assert.equal(state.indent, 0, 'CommPilot’s 20px indent column gives way to the card’s inset');
    assert.deepEqual(state.fieldset, ['0px', '1px', 'rgba(0, 0, 0, 0)'], 'a fieldset is a labelled divider, not a box');
  } finally { await browser.close(); }
});
