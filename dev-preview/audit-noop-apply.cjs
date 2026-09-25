// Exercise existing sandbox settings forms with their current values and
// record the server response. Add, Delete, imports, and file forms are skipped.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const auditFile = path.join(__dirname, 'pjax-deep-action-audit.json');
const routeFile = path.join(__dirname, 'pjax-route-audit.json');
const profile = process.env.BW_LIVE_PROFILE;
const level = process.env.BW_APPLY_LEVEL || 'Group';
const folder = process.argv[2] || 'Profile';
const onlyLabel = process.argv[3] || '';
if (!profile) throw new Error('Set BW_LIVE_PROFILE to the saved sandbox Edge profile');
if (!['Reseller', 'Service Provider', 'Group', 'User', 'Auto Attendant', 'Hunt Group',
  'Call Center'].includes(level)) throw new Error(`Unknown level: ${level}`);

function writeOutcome(label, outcome, detail) {
  const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
  const route = JSON.parse(fs.readFileSync(routeFile, 'utf8')).routes
    .find(item => item.area === `${level} / ${folder}` && item.label === label && item.kind !== 'interaction');
  const id = `apply:${route?.id || label.replace(/\W+/g, '-')}`;
  let check = audit.checks.find(item => item.id === id);
  if (!check) {
    check = { id, area: `${level} / ${folder}`, label: `${label} › Apply current values`,
      path: route?.path || '', sourcePath: route?.path || '', kind: 'interaction',
      family: 'Edit / save', deep: true, submitControls: 1 };
    audit.checks.push(check);
  }
  check.status = outcome;
  check.detail = detail;
  check.checkedAt = new Date().toISOString();
  const pageCheck = route && audit.checks.find(item => item.id === route.id);
  if (pageCheck && outcome === 'passed' && pageCheck.status === 'pending') {
    pageCheck.status = 'passed';
    pageCheck.detail = `Page navigation and current-values Apply verified. ${detail}`;
    pageCheck.checkedAt = check.checkedAt;
  }
  audit.updated = check.checkedAt;
  audit.current = check.label;
  audit.currentNote = detail;
  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'apply-check', id, label, status: outcome, detail }));
}
function writeDeep(id, outcome, detail) {
  const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
  let check = audit.checks.find(item => item.id === id);
  if (!check) {
    check = { id, area: `${level} / ${folder}`, label: id.replace(/[-:]/g, ' '),
      kind: 'action-check', family: 'Action and readback', deep: true, submitControls: 1 };
    audit.checks.push(check);
  }
  check.status = outcome;
  check.detail = detail;
  check.checkedAt = new Date().toISOString();
  audit.updated = check.checkedAt;
  audit.current = check.label;
  audit.currentNote = detail;
  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'deep-check', id, status: outcome, detail }));
}

async function waitPath(page, expected) {
  try {
    await page.waitForFunction(value => location.pathname === value &&
      !!document.querySelector('td[width="82%"]'), expected, { timeout: 20000 });
  } catch (error) {
    throw new Error(`Expected ${expected}; at ${new URL(page.url()).pathname}, ` +
      `title ${await page.title().catch(() => '')}: ${error.message.slice(0, 70)}`);
  }
}
async function enterLevel(page) {
  await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
  await page.locator('button.bw-saved-account-name').first().click();
  await page.waitForFunction(() => document.title === 'Profile' &&
    location.pathname === '/commpilot/Common/folder_contents.jsp');
  if (level === 'Reseller') return;
  await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
  await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
  await page.locator('#search0').click();
  await page.locator('a:text-is("Test_SP")').click();
  await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
  if (level === 'Service Provider') return;
  await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
  await waitPath(page, '/commpilot/ServiceProvider/Members/');
  await page.locator('#search0').click();
  await page.locator('a:text-is("Stan Mikita Donuts")').click();
  await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
  if (level === 'Group') return;
  if (level === 'User') {
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Users")').click();
    await waitPath(page, '/commpilot/Group/Members/');
    await page.locator('#search0').click();
    await page.locator('a:text-is("SMDonuts21")').click();
    await waitPath(page, '/commpilot/Group/Members/Modify/index.jsp');
    return;
  }
  const groupFolder = level === 'Call Center' ? 'Call Center' : 'Services';
  await page.locator('a.leftnavfolder, a.leftnavfolderopen')
    .filter({ hasText: new RegExp(`^\\s*${groupFolder}\\s*$`) }).click();
  await page.waitForFunction(value => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
    document.title === value, groupFolder, { timeout: 20000 });
  const menuLabel = level === 'Call Center' ? 'Call Centers' : level;
  const menuPath = level === 'Auto Attendant' ? '/commpilot/Group/Auto_Attendant/' :
    level === 'Hunt Group' ? '/commpilot/Group/Hunt_Group/' : '/commpilot/Group/Call_Center/';
  await page.locator('td[width="82%"] a.navMenuItem').filter({ hasText: new RegExp(`^${menuLabel}$`) }).click();
  await waitPath(page, menuPath);
  await page.locator('a#Row1Col1').click();
  const entry = level === 'Auto Attendant' ? '/commpilot/Group/Auto_Attendant/EditRedirect/index.jsp' :
    level === 'Hunt Group' ? '/commpilot/Group/Hunt_Group/EditRedirect/index.jsp' :
      '/commpilot/Group/Call_Center/EditRedirect/index.jsp';
  await waitPath(page, entry);
}
async function openFolder(page) {
  await page.locator('a.leftnavfolder, a.leftnavfolderopen')
    .filter({ hasText: new RegExp(`^\\s*${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).click();
  await page.waitForFunction(value => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
    document.title === value, folder, { timeout: 20000 });
}
async function formState(page) {
  return page.evaluate(() => {
    const form = document.querySelector('td[width="82%"] form[name="mainForm"]');
    if (!form) return null;
    return [...form.elements].filter(element => element.name &&
      !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(element.type))
      .map(element => ({ name: element.name, value: element.value,
        checked: ['checkbox', 'radio'].includes(element.type) ? element.checked : undefined,
        selected: element.multiple ? [...element.options].filter(option => option.selected)
          .map(option => option.value) : undefined }));
  });
}
async function scheduleRows(page, name) {
  const find = page.locator('td[width="82%"] input[name="findValue0"]');
  if (await find.count()) {
    await find.fill(name);
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      /\/commpilot\/(?:Common\/find|Group\/Schedules)/.test(new URL(item.url()).pathname),
    { timeout: 12000 }).catch(() => null);
    await page.locator('td[width="82%"] #search0').click();
    await response;
  }
  return page.locator('td[width="82%"] a.tableLink').filter({ hasText: name });
}
async function deleteScheduleRow(page, name) {
  const row = page.locator('td[width="82%"] tr[id^="Row"]').filter({ hasText: name });
  if (await row.count() !== 1) throw new Error(`Expected exactly one disposable schedule row for ${name}`);
  await row.locator('input[type="checkbox"]').check();
  page.once('dialog', dialog => dialog.accept());
  const response = page.waitForResponse(item => item.request().method() === 'POST' &&
    new URL(item.url()).pathname === '/commpilot/Group/Schedules/',
  { timeout: 15000 }).catch(() => null);
  await page.locator('td[width="82%"] input[name="apply"]').first().click();
  const found = await response;
  await waitPath(page, '/commpilot/Group/Schedules/');
  return found?.status() === 200 && await (await scheduleRows(page, name)).count() === 0;
}
async function exerciseSchedule(page) {
  const name = `PJAX-Audit-${Date.now().toString(36)}`;
  let created = false, modified = false, deleted = false;
  try {
    if (await (await scheduleRows(page, name)).count())
      throw new Error('Disposable schedule name already exists');
    await page.locator('td[width="82%"] input[value="Add"]').first().click();
    await waitPath(page, '/commpilot/Group/Schedules/Add/index.jsp');
    await page.locator('td[width="82%"] input[name="scheduleName"]').fill(name);
    await page.locator('td[width="82%"] input[name="scheduleType"][value="Time"]').check();
    await page.evaluate(() => { window.__bwScheduleDocument = document; });
    const save = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname.includes('/Group/Schedules/Add/'),
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const saveResponse = await save;
    await page.waitForFunction(() => location.pathname === '/commpilot/Group/Schedules/' &&
      !!document.querySelector('td[width="82%"]'), null, { timeout: 15000 });
    const sameDocument = await page.evaluate(() => document === window.__bwScheduleDocument);
    const row = await scheduleRows(page, name);
    created = saveResponse?.status() === 200 && sameDocument && await row.count() === 1;
    writeDeep('discovered-517', created ? 'passed' : 'failed',
      `Disposable Time schedule Add returned HTTP ${saveResponse?.status() || 'none'}; ` +
      `${sameDocument ? 'same document' : 'reload'}; search found ${await row.count()} row(s).`);
    if (!created) return;
    await row.first().click();
    await waitPath(page, '/commpilot/Group/Schedules/Modify/index.jsp');
    modified = await page.locator('td[width="82%"] input[name="scheduleName"]').inputValue() === name;
    writeDeep('schedule-modify', modified ? 'passed' : 'failed',
      `Disposable schedule opened its Modify page ${modified ? 'with the saved name' : 'without the saved name'}.`);
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Schedules")').click();
      await waitPath(page, '/commpilot/Group/Schedules/');
      const row = await scheduleRows(page, name);
      if (await row.count() === 1) deleted = await deleteScheduleRow(page, name);
      else deleted = true;
      writeDeep('lifecycle:group-schedule-delete', deleted ? 'passed' : 'failed',
        `Disposable schedule ${deleted ? 'was absent after Delete and a fresh search' :
          'was still present after the cleanup attempt'}.`);
    } catch (error) {
      writeDeep('lifecycle:group-schedule-delete', 'failed',
        `Disposable schedule cleanup needs inspection: ${error.message.slice(0, 180)}`);
    }
  }
}
async function exerciseDepartment(page) {
  const name = `PJAX Audit Dept ${Date.now().toString(36)}`;
  let created = false, opened = false, deleted = false;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(name);
      const response = page.waitForResponse(item => item.request().method() === 'POST' &&
        /\/commpilot\/(?:Common\/find|Group\/Departments)/.test(new URL(item.url()).pathname),
      { timeout: 12000 }).catch(() => null);
      await page.locator('td[width="82%"] #search0').click();
      await response;
    }
    return page.locator('td[width="82%"] a.tableLink').filter({ hasText: name });
  }
  try {
    if (await (await locate()).count()) throw new Error('Disposable department already exists');
    await page.locator('td[width="82%"] input[value="Add"]').first().click();
    await waitPath(page, '/commpilot/Group/Departments/Add/index.jsp');
    await page.locator('td[width="82%"] input[name="deptName"]').fill(name);
    await page.evaluate(() => { window.__bwDepartmentDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/commpilot/Group/Departments/Add/index.jsp',
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await waitPath(page, '/commpilot/Group/Departments/');
    const sameDocument = await page.evaluate(() => document === window.__bwDepartmentDocument);
    created = found?.status() === 200 && sameDocument && await (await locate()).count() === 1;
    writeDeep('discovered-565', created ? 'passed' : 'failed',
      `Disposable department Add returned HTTP ${found?.status() || 'none'}; ` +
      `${sameDocument ? 'same document' : 'reload'}; search found ${await (await locate()).count()} row(s).`);
    if (!created) return;
    await (await locate()).first().click();
    await waitPath(page, '/commpilot/Group/Departments/Modify/index.jsp');
    opened = await page.locator('td[width="82%"] input[name="deptName"]').inputValue() === name;
    writeDeep('discovered-507', opened ? 'passed' : 'failed',
      `Disposable department Modify ${opened ? 'showed the saved name' : 'did not show the saved name'}.`);
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Departments")').click();
      await waitPath(page, '/commpilot/Group/Departments/');
      const row = await locate();
      if (await row.count() === 1) {
        await row.first().click();
        await waitPath(page, '/commpilot/Group/Departments/Modify/index.jsp');
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]').first().click();
        await waitPath(page, '/commpilot/Group/Departments/');
        deleted = await (await locate()).count() === 0;
      } else deleted = true;
      writeDeep('lifecycle:group-department-delete', deleted ? 'passed' : 'failed',
        `Disposable department ${deleted ? 'deleted and absent after a fresh search' :
          'still present after the cleanup attempt'}.`);
    } catch (error) {
      writeDeep('lifecycle:group-department-delete', 'failed',
        `Disposable department cleanup needs inspection: ${error.message.slice(0, 180)}`);
    }
  }
}
async function aaRowId(page, id) {
  return page.evaluate(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
    .find(row => row.textContent.includes(value))?.id || '', id);
}
async function exerciseAutoAttendant(page) {
  const suffix = Date.now().toString(36);
  const id = `pjaxaa${suffix}`;
  const name = `PJAX Audit AA ${suffix}`;
  let created = false, opened = false, deleted = false;
  try {
    if (await aaRowId(page, id)) throw new Error(`Disposable Auto Attendant ${id} already exists`);
    await page.locator('td[width="82%"] input[name="addBasic"]').first().click();
    await waitPath(page, '/commpilot/Group/Auto_Attendant/Add/index.jsp');
    await page.locator('td[width="82%"] input[name="userId"]').fill(id);
    await page.locator('td[width="82%"] input[name="unicodeLastName"]').fill(name);
    await page.locator('td[width="82%"] input[name="clidLastName"]').fill('PJAX Audit');
    await page.locator('td[width="82%"] input[name="clidFirstName"]').fill('AA');
    await page.evaluate(() => { window.__bwAADocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/commpilot/Group/Auto_Attendant/Add/index.jsp',
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await page.waitForFunction(() => location.pathname === '/commpilot/Group/Auto_Attendant/' ||
      !!document.querySelector('.cp-alert-error'), null, { timeout: 15000 }).catch(() => {});
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwAADocument,
      error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
    created = found?.status() === 200 && state.sameDocument &&
      state.path === '/commpilot/Group/Auto_Attendant/' && !!await aaRowId(page, id);
    writeDeep('discovered-524', created ? 'passed' : 'failed',
      `Disposable Auto Attendant ${id} Add returned HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ${created ?
        'created row found' : `current page ${state.path}${state.error ? `; ${state.error.slice(0, 140)}` : ''}`}.`);
    if (!created) return;
    await page.locator(`#${await aaRowId(page, id)} a.tableLink`).first().click();
    await waitPath(page, '/commpilot/Group/Auto_Attendant/EditRedirect/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
    await waitPath(page, '/commpilot/Group/Auto_Attendant/Modify/index.jsp');
    opened = await page.locator('td[width="82%"] input[name="unicodeLastName"]').inputValue() === name;
    writeDeep('discovered-642', opened ? 'passed' : 'failed',
      `Disposable Auto Attendant ${id} Profile Modify ${opened ? 'displayed' : 'did not display'} the saved name.`);
  } finally {
    try {
      // Restore Group context before opening the owning list; sandbox token
      // bounces sometimes make the first re-entry land on Login.
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await enterLevel(page); break; }
        catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(500); }
      }
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Auto Attendant")').click();
      await waitPath(page, '/commpilot/Group/Auto_Attendant/');
      const rowId = await aaRowId(page, id);
      if (rowId) {
        await page.locator(`#${rowId} a.tableLink`).first().click();
        await waitPath(page, '/commpilot/Group/Auto_Attendant/EditRedirect/index.jsp');
        await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
        await waitPath(page, '/commpilot/Group/Auto_Attendant/Modify/index.jsp');
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]').first().click();
        await waitPath(page, '/commpilot/Group/Auto_Attendant/');
        deleted = !await aaRowId(page, id);
      } else deleted = true;
      writeDeep('lifecycle:auto-attendant-delete', deleted ? 'passed' : 'failed',
        `Disposable Auto Attendant ${id} ${deleted ? 'is absent after Delete' : 'remains in the sandbox list'}.`);
    } catch (error) {
      writeDeep('lifecycle:auto-attendant-delete', 'failed',
        `Disposable Auto Attendant ${id} cleanup needs inspection: ${error.message.slice(0, 180)}`);
    }
  }
}
async function exerciseHuntGroup(page) {
  const suffix = Date.now().toString(36);
  const id = `pjaxhg${suffix}`;
  const name = `PJAX Audit HG ${suffix}`;
  let created = false, opened = false, deleted = false;
  try {
    if (await aaRowId(page, id)) throw new Error(`Disposable Hunt Group ${id} already exists`);
    await page.locator('td[width="82%"] input[name="add"]').first().click();
    await waitPath(page, '/commpilot/Group/Hunt_Group/Add/index.jsp');
    await page.locator('td[width="82%"] input[name="userId"]').fill(id);
    await page.locator('td[width="82%"] input[name="unicodeLastName"]').fill(name);
    await page.locator('td[width="82%"] input[name="clidLastName"]').fill('PJAX Audit');
    await page.locator('td[width="82%"] input[name="clidFirstName"]').fill('HG');
    await page.evaluate(() => { window.__bwHGDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/commpilot/Group/Hunt_Group/Add/index.jsp',
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await page.waitForFunction(() => location.pathname === '/commpilot/Group/Hunt_Group/' ||
      !!document.querySelector('.cp-alert-error'), null, { timeout: 15000 }).catch(() => {});
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwHGDocument,
      error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
    created = found?.status() === 200 && state.sameDocument &&
      state.path === '/commpilot/Group/Hunt_Group/' && !!await aaRowId(page, id);
    writeDeep('discovered-527', created ? 'passed' : 'failed',
      `Disposable Hunt Group ${id} Add returned HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ${created ?
        'created row found' : `current page ${state.path}${state.error ? `; ${state.error.slice(0, 140)}` : ''}`}.`);
    if (!created) return;
    await page.locator(`#${await aaRowId(page, id)} a.tableLink`).first().click();
    await waitPath(page, '/commpilot/Group/Hunt_Group/EditRedirect/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
    await waitPath(page, '/commpilot/Group/Hunt_Group/Modify/index.jsp');
    opened = await page.locator('td[width="82%"] input[name="unicodeLastName"]').inputValue() === name;
    writeDeep('discovered-658', opened ? 'passed' : 'failed',
      `Disposable Hunt Group ${id} Profile Modify ${opened ? 'displayed' : 'did not display'} the saved name.`);
  } finally {
    try {
      if (new URL(page.url()).pathname !== '/commpilot/Group/Hunt_Group/Modify/index.jsp') {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await enterLevel(page); break; }
          catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(500); }
        }
        await openFolder(page);
        await page.locator('td[width="82%"] a.navMenuItem:text-is("Hunt Group")').click();
        await waitPath(page, '/commpilot/Group/Hunt_Group/');
        const rowId = await aaRowId(page, id);
        if (rowId) {
          await page.locator(`#${rowId} a.tableLink`).first().click();
          await waitPath(page, '/commpilot/Group/Hunt_Group/EditRedirect/index.jsp');
          await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
          await waitPath(page, '/commpilot/Group/Hunt_Group/Modify/index.jsp');
        }
      }
      if (new URL(page.url()).pathname === '/commpilot/Group/Hunt_Group/Modify/index.jsp') {
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]').first().click();
        await waitPath(page, '/commpilot/Group/Hunt_Group/');
      }
      if (new URL(page.url()).pathname === '/commpilot/Group/Hunt_Group/')
        deleted = !await aaRowId(page, id);
      writeDeep('lifecycle:hunt-group-delete', deleted ? 'passed' : 'failed',
        `Disposable Hunt Group ${id} ${deleted ? 'is absent after Delete' : 'remains or could not be verified'}.`);
    } catch (error) {
      writeDeep('lifecycle:hunt-group-delete', 'failed',
        `Disposable Hunt Group ${id} cleanup needs inspection: ${error.message.slice(0, 180)}`);
    }
  }
}
async function exerciseCallCenter(page) {
  const suffix = Date.now().toString(36);
  const id = `pjaxcc${suffix}`;
  const name = `PJAX Audit CC ${suffix}`;
  const password = `Audit${suffix}Z7!`;
  const listPath = '/commpilot/Group/Call_Center/';
  const formPath = '/commpilot/Group/Call_Center/AddModify/index.jsp';
  let created = false, opened = false, deleted = false;
  try {
    await page.locator('td[width="82%"] input[name="addBasic"]').first().click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="userId"]').fill(id);
    await page.locator('td[width="82%"] input[name="unicodeLastName"]').fill(name);
    await page.locator('td[width="82%"] input[name="clidLastName"]').fill('PJAX Audit');
    await page.locator('td[width="82%"] input[name="clidFirstName"]').fill('CC');
    await page.locator('td[width="82%"] input[name="password"]').fill(password);
    await page.locator('td[width="82%"] input[name="echoPassword"]').fill(password);
    await page.evaluate(() => { window.__bwCCDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await page.waitForFunction(() => location.pathname === '/commpilot/Group/Call_Center/' ||
      !!document.querySelector('.cp-alert-error'), null, { timeout: 15000 }).catch(() => {});
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwCCDocument,
      error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '',
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 350) || '' }));
    created = found?.status() === 200 && state.sameDocument &&
      state.path === listPath && !!await aaRowId(page, id);
    writeDeep('discovered-545', created ? 'passed' : 'failed',
      `Disposable Call Center ${id} Add returned HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ${created ?
        'created row found' : `current page ${state.path}${state.error ? `; ${state.error.slice(0, 140)}` :
          `; ${state.text.slice(0, 140)}`}`}.`);
    if (!created) return;
    await page.locator(`#${await aaRowId(page, id)} a.tableLink`).first().click();
    await waitPath(page, '/commpilot/Group/Call_Center/EditRedirect/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
    await waitPath(page, formPath);
    opened = await page.locator('td[width="82%"] input[name="unicodeLastName"]').inputValue() === name;
    writeDeep('discovered-478', opened ? 'passed' : 'failed',
      `Disposable Call Center ${id} Profile ${opened ? 'displayed' : 'did not display'} the saved name.`);
  } finally {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await enterLevel(page); break; }
        catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(500); }
      }
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Call Centers")').click();
      await waitPath(page, listPath);
      const rowId = await aaRowId(page, id);
      if (rowId) {
        await page.locator(`#${rowId} a.tableLink`).first().click();
        await waitPath(page, '/commpilot/Group/Call_Center/EditRedirect/index.jsp');
        await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
        await waitPath(page, formPath);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]').first().click();
        await waitPath(page, listPath);
        deleted = !await aaRowId(page, id);
      } else deleted = true;
      writeDeep('lifecycle:call-center-delete', deleted ? 'passed' : 'failed',
        `Disposable Call Center ${id} ${deleted ? 'is absent after Delete' : 'remains in the sandbox list'}.`);
    } catch (error) {
      writeDeep('lifecycle:call-center-delete', 'failed',
        `Disposable Call Center ${id} cleanup needs inspection: ${error.message.slice(0, 180)}`);
    }
  }
}
async function exerciseSimpleService(page, kind) {
  const types = {
    'Call Park': { slug: 'call-park', list: 'CallPark', field: 'callParkGroupName', check: 'discovered-525' },
    'Call Pickup': { slug: 'call-pickup', list: 'CPU', field: 'cpuGroupName', check: 'discovered-526' },
    'Call Capacity': { slug: 'call-capacity', list: 'Call_Capacity', field: 'ccmGroupName', check: 'discovered-531' },
    'Series Completion': { slug: 'series-completion', list: 'SeriesComplete',
      field: 'seriesCompleteGroupName', check: 'discovered-541', add: 'AddModify/index.jsp' }
  };
  const type = types[kind];
  if (!type) throw new Error(`Unknown simple service ${kind}`);
  const suffix = Date.now().toString(36);
  const name = `PJAX Audit ${kind} ${suffix}`;
  const listPath = `/commpilot/Group/${type.list}/`;
  const formPath = `${listPath}${type.add || 'Add/index.jsp'}`;
  const field = type.field;
  const check = type.check;
  let created = false, deleted = false;
  try {
    await page.locator('td[width="82%"] input[name="add"]').first().click();
    await waitPath(page, formPath);
    await page.locator(`td[width="82%"] input[name="${field}"]`).fill(name);
    if (kind === 'Call Capacity')
      await page.locator('td[width="82%"] input[name="maxCalls"]').fill('1');
    await page.evaluate(() => { window.__bwSimpleDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwSimpleDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 450) || '' }));
    created = found?.status() === 200 && state.sameDocument && !!await aaRowId(page, name);
    writeDeep(check, created ? 'passed' : 'blocked',
      `${kind} Add with a disposable name returned HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ${created ? 'created row found' :
        `no created row; ${state.path}; ${state.text.slice(0, 180)}`}.`);
  } finally {
    try {
      if (new URL(page.url()).pathname !== listPath) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await enterLevel(page); break; }
          catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(500); }
        }
        await openFolder(page);
        await page.locator(`td[width="82%"] a.navMenuItem:text-is("${kind}")`).click();
        await waitPath(page, listPath);
      }
      const rowId = await aaRowId(page, name);
      if (rowId) {
        await page.locator(`#${rowId} a.tableLink`).first().click();
        await page.waitForFunction(value => location.pathname !== value &&
          !!document.querySelector('td[width="82%"]'), listPath, { timeout: 15000 });
        const deleteButton = page.locator('td[width="82%"] input[name="delete"]:visible').first();
        if (await deleteButton.count()) {
          page.once('dialog', dialog => dialog.accept());
          await deleteButton.click();
          await waitPath(page, listPath);
        } else {
          console.log(JSON.stringify({ event: 'simple-service-no-delete', kind, name,
            path: new URL(page.url()).pathname,
            buttons: await page.locator('td[width="82%"] input[type="submit"]:visible')
              .evaluateAll(items => items.map(item => ({ name: item.name, value: item.value }))) }));
        }
      }
      if (new URL(page.url()).pathname !== listPath) {
        await enterLevel(page);
        await openFolder(page);
        await page.locator(`td[width="82%"] a.navMenuItem:text-is("${kind}")`).click();
        await waitPath(page, listPath);
      }
      deleted = !await aaRowId(page, name);
      writeDeep(`lifecycle:${type.slug}-delete`, deleted ? 'passed' : 'failed',
        `Disposable ${kind} ${name} ${deleted ? 'is absent' : 'still appears'} after cleanup.`);
    } catch (error) {
      writeDeep(`lifecycle:${type.slug}-delete`, 'failed',
        `Disposable ${kind} ${name} cleanup needs inspection: ${error.message.slice(0, 160)}`);
    }
  }
}
async function exerciseUserService(page, kind) {
  const types = {
    'VoiceXML': { slug: 'voice-xml', list: 'Voice_XML', check: 'discovered-529' },
    'BroadWorks Anywhere': { slug: 'broadworks-anywhere', list: 'BroadWorksAnywhere', check: 'discovered-530' },
    'Find-me/Follow-me': { slug: 'find-me-follow-me', list: 'FindMeFollowMe', check: 'discovered-535' },
    'Flexible Seating Host': { slug: 'flexible-seating-host', list: 'FlexibleSeatingHost', check: 'discovered-536' },
    'Group Paging': { slug: 'group-paging', list: 'GroupPaging', check: 'discovered-537' },
    'Instant Group Call': { slug: 'instant-group-call', list: 'InstantGroupCall', check: 'discovered-538' }
  };
  const type = types[kind];
  if (!type) throw new Error(`Unknown user service ${kind}`);
  const suffix = Date.now().toString(36);
  const id = `pjax${type.slug.replace(/-/g, '').slice(0, 5)}${suffix}`;
  const name = `PJAX Audit ${kind} ${suffix}`;
  const basePath = `/commpilot/Group/${type.list}/`;
  const listPath = ['VoiceXML', 'Instant Group Call'].includes(kind) ? `${basePath}index.jsp` : basePath;
  const formPath = `${basePath}Add/index.jsp`;
  let created = false, deleted = false;
  try {
    const add = page.locator('td[width="82%"] input[type="button"][value^="Add"]').first();
    await add.click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="userId"]').fill(id);
    await page.locator('td[width="82%"] input[name="unicodeLastName"]').fill(name);
    await page.locator('td[width="82%"] input[name="clidLastName"]').fill('PJAX Audit');
    await page.locator('td[width="82%"] input[name="clidFirstName"]').fill('Svc');
    await page.evaluate(() => { window.__bwServiceDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await page.waitForTimeout(650);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwServiceDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 420) || '' }));
    created = found?.status() === 200 && state.sameDocument && !!await aaRowId(page, id);
    writeDeep(type.check, created ? 'passed' : 'blocked',
      `${kind} Add returned HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ${created ? 'created row found' :
        `no created row at ${state.path}; ${state.text.slice(0, 170)}`}.`);
  } finally {
    try {
      if (new URL(page.url()).pathname !== listPath) {
        await enterLevel(page);
        await openFolder(page);
        await page.locator(`td[width="82%"] a.navMenuItem:text-is("${kind}")`).click();
        await waitPath(page, listPath);
      }
      const rowId = await aaRowId(page, id);
      if (rowId) {
        await page.locator(`#${rowId} a.tableLink`).first().click();
        await page.waitForFunction(value => location.pathname !== value, listPath, { timeout: 15000 });
        await page.waitForTimeout(350);
        const profile = page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")');
        if (new URL(page.url()).pathname.includes('/EditRedirect/'))
          await profile.waitFor({ state: 'visible', timeout: 15000 });
        if (await profile.count()) {
          await profile.click();
          await page.waitForFunction(() => !!document.querySelector('td[width="82%"] input[name="delete"]'),
            null, { timeout: 15000 });
        }
        const remove = page.locator('td[width="82%"] input[name="delete"]:visible').first();
        if (!await remove.count()) throw new Error(`No Delete on ${new URL(page.url()).pathname}`);
        page.once('dialog', dialog => dialog.accept());
        await remove.click();
        await page.waitForTimeout(650);
        console.log(JSON.stringify({ event: 'user-service-after-delete', kind, id,
          state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
            listAdd: !!document.querySelector('td[width="82%"] input[name="add"],td[width="82%"] input[name="addBasic"]'),
            hasRow: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
              .some(row => row.textContent.includes('PJAX Audit')) })) }));
      }
      if (new URL(page.url()).pathname !== listPath) {
        await enterLevel(page);
        await openFolder(page);
        await page.locator(`td[width="82%"] a.navMenuItem:text-is("${kind}")`).click();
        await waitPath(page, listPath);
      }
      deleted = !await aaRowId(page, id);
      writeDeep(`lifecycle:${type.slug}-delete`, deleted ? 'passed' : 'failed',
        `Disposable ${kind} ${id} ${deleted ? 'is absent' : 'remains'} after cleanup.`);
    } catch (error) {
      writeDeep(`lifecycle:${type.slug}-delete`, 'failed',
        `Disposable ${kind} ${id} cleanup needs inspection: ${error.message.slice(0, 160)}`);
    }
  }
}
async function exerciseCallCenterCode(page, kind) {
  const unavailable = kind === 'Agent Unavailable Codes';
  const slug = unavailable ? 'UnavailableCodes' : 'DispositionCodes';
  const check = unavailable ? 'discovered-549' : 'discovered-550';
  const code = `PJAX${Date.now().toString(36).slice(-6)}`;
  const listPath = `/commpilot/Group/Call_Center/${slug}/`;
  const formPath = `${listPath}Add/index.jsp`;
  let created = false, deleted = false;
  try {
    await page.locator('td[width="82%"] input[type="button"][value^="Add"]').first().click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="code"]').fill(code);
    await page.locator('td[width="82%"] input[name="description"]').fill('Disposable PJAX audit code');
    await page.evaluate(() => { window.__bwCodeDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]').first().click();
    const found = await response;
    await page.waitForTimeout(650);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwCodeDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 300) || '' }));
    created = found?.status() === 200 && state.sameDocument && !!await aaRowId(page, code);
    writeDeep(check, created ? 'passed' : 'blocked',
      `${kind} Add returned HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ${created ? 'created row found' :
        `no row at ${state.path}; ${state.text.slice(0, 130)}`}.`);
  } finally {
    try {
      if (new URL(page.url()).pathname !== listPath) {
        await enterLevel(page);
        await openFolder(page);
        await page.locator(`td[width="82%"] a.navMenuItem:text-is("${kind}")`).click();
        await waitPath(page, listPath);
      }
      const rowId = await aaRowId(page, code);
      if (rowId) {
        const edit = page.locator(`#${rowId} a.headerLink`).last();
        await (await edit.count() ? edit : page.locator(`#${rowId} a.tableLink`).first()).click();
        await page.waitForFunction(value => location.pathname !== value &&
          !!document.querySelector('td[width="82%"] input[name="delete"]'),
        listPath, { timeout: 15000 });
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await page.waitForTimeout(550);
      }
      if (new URL(page.url()).pathname !== listPath) {
        await enterLevel(page);
        await openFolder(page);
        await page.locator(`td[width="82%"] a.navMenuItem:text-is("${kind}")`).click();
        await waitPath(page, listPath);
      }
      deleted = !await aaRowId(page, code);
      writeDeep(`lifecycle:${unavailable ? 'unavailable' : 'disposition'}-code-delete`,
        deleted ? 'passed' : 'failed',
        `Disposable ${kind} ${code} ${deleted ? 'is absent' : 'remains'} after cleanup.`);
    } catch (error) {
      writeDeep(`lifecycle:${unavailable ? 'unavailable' : 'disposition'}-code-delete`, 'failed',
        `Disposable ${kind} ${code} cleanup needs inspection: ${error.message.slice(0, 160)}`);
    }
  }
}
async function probe(page, label) {
  const link = page.locator('td[width="82%"] a.navMenuItem').filter({ hasText: new RegExp(
    `^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
  await link.click();
  await page.waitForFunction(() => location.pathname !== '/commpilot/Common/folder_contents.jsp' &&
    !!document.querySelector('td[width="82%"]'), null, { timeout: 20000 });
  const entry = await page.evaluate(() => ({ path: location.pathname, title: document.title }));
  if (process.env.BW_CC_CODE_CLEAN_ID && level === 'Group' && folder === 'Call Center' &&
      ['Agent Unavailable Codes', 'Call Disposition Codes'].includes(label)) {
    const code = process.env.BW_CC_CODE_CLEAN_ID;
    const rowId = await aaRowId(page, code.slice(0, 10));
    console.log(JSON.stringify({ event: 'cc-code-inspect', label, code,
      state: await page.evaluate(value => ({ path: location.pathname,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1100),
        rowId: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .find(row => row.textContent.includes(value))?.id || '',
        fields: [...document.querySelectorAll('td[width="82%"] input')]
          .filter(item => /find|search/i.test(item.name || item.id || ''))
          .map(item => ({ name: item.name, id: item.id, value: item.value })) }), code) }));
    if (rowId && process.env.BW_CC_CODE_CLEAN_DELETE === '1') {
      await page.locator(`#${rowId} a.headerLink`).last().click();
      await page.waitForFunction(() => !!document.querySelector('td[width="82%"] input[name="delete"]'),
        null, { timeout: 15000 });
      page.once('dialog', dialog => dialog.accept());
      await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
      await page.waitForTimeout(600);
      console.log(JSON.stringify({ event: 'cc-code-delete', label, code,
        path: new URL(page.url()).pathname }));
    }
    return;
  }
  if (process.env.BW_USER_SERVICE_CLEAN_ID && level === 'Group' && folder === 'Services') {
    const id = process.env.BW_USER_SERVICE_CLEAN_ID;
    if (process.env.BW_USER_SERVICE_FIND_ID === '1') {
      await page.locator('td[width="82%"] input[name="findValue0"]').fill(id);
      await page.locator('td[width="82%"] input[name="search"]').first().click();
      await page.waitForTimeout(1700);
    }
    let rowId = await aaRowId(page, id);
    if (!rowId && process.env.BW_USER_SERVICE_FIND_ID === '1') {
      const rows = page.locator('td[width="82%"] tr[id^="Row"]');
      if (await rows.count() === 1) rowId = await rows.first().getAttribute('id');
    }
    console.log(JSON.stringify({ event: 'user-service-clean', label, id,
      path: entry.path, rowId,
      state: await page.evaluate(() => ({
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 900),
        search: [...document.querySelectorAll('td[width="82%"] input')]
          .filter(item => /find|search/i.test(item.name || item.id || ''))
          .map(item => ({ name: item.name, id: item.id, type: item.type, value: item.value })),
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
          .map(item => ({ name: item.name, value: item.value })) })) }));
    if (rowId && process.env.BW_USER_SERVICE_CLEAN_DELETE === '1') {
      await page.locator(`#${rowId} a.tableLink`).first().click();
      await page.waitForFunction(value => location.pathname !== value, entry.path, { timeout: 15000 });
      await page.waitForTimeout(350);
      const profile = page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")');
      if (new URL(page.url()).pathname.includes('/EditRedirect/'))
        await profile.waitFor({ state: 'visible', timeout: 15000 });
      if (await profile.count()) {
        await profile.click();
        await page.waitForFunction(() => !!document.querySelector('td[width="82%"] input[name="delete"]'),
          null, { timeout: 15000 });
      }
      console.log(JSON.stringify({ event: 'user-service-clean-detail', label, id,
        state: await page.evaluate(() => ({ path: location.pathname,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 650),
          links: [...document.querySelectorAll('td[width="82%"] a')]
            .filter(item => item.getClientRects().length)
            .map(item => ({ text: item.textContent.trim(), className: item.className })) })) }));
      const remove = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (!await remove.count()) throw new Error(`No Delete button at ${new URL(page.url()).pathname}`);
      page.once('dialog', dialog => dialog.accept());
      await remove.click();
      await page.waitForTimeout(600);
      console.log(JSON.stringify({ event: 'user-service-clean-delete', label, id,
        path: new URL(page.url()).pathname }));
    }
    return;
  }
  if (process.env.BW_SIMPLE_CLEAN_NAME && level === 'Group' &&
      folder === 'Services' && ['Call Pickup', 'Call Park'].includes(label)) {
    const name = process.env.BW_SIMPLE_CLEAN_NAME;
    const rowId = await aaRowId(page, name);
    if (!rowId) {
      console.log(JSON.stringify({ event: 'simple-clean', name, status: 'absent' }));
      return;
    }
    console.log(JSON.stringify({ event: 'simple-clean-row', name,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 2300)),
      idCount: await page.locator(`#${rowId} a.tableLink`).first().evaluate(item =>
        document.querySelectorAll(`#${item.id}`).length) }));
    await page.waitForTimeout(5000);
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await page.waitForTimeout(650);
    console.log(JSON.stringify({ event: 'simple-clean-inspect', name,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 550),
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"],td[width="82%"] input[type="button"]')]
          .filter(item => item.getClientRects().length)
          .map(item => ({ name: item.name, value: item.value })) })) }));
    if (process.env.BW_SIMPLE_CLEAN_DELETE === '1') {
      const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (!await button.count()) throw new Error('No Delete button on disposable service Modify form');
      page.once('dialog', dialog => dialog.accept());
      await button.click();
      await page.waitForTimeout(650);
      console.log(JSON.stringify({ event: 'simple-clean-delete', name,
        path: new URL(page.url()).pathname }));
    }
    return;
  }
  if (process.env.BW_AA_CLEAN_ID && level === 'Group' && folder === 'Services' &&
      label === 'Auto Attendant') {
    const id = process.env.BW_AA_CLEAN_ID;
    if (!/^pjaxaa[a-z0-9]+$/.test(id)) throw new Error('Unsafe disposable Auto Attendant ID');
    const rowId = await aaRowId(page, id);
    console.log(JSON.stringify({ event: 'aa-clean-preflight', id, rowId }));
    if (!rowId) {
      writeDeep('lifecycle:auto-attendant-delete', 'passed',
        `Disposable Auto Attendant ${id} is absent from the sandbox list.`);
      return;
    }
    await page.locator(`#${rowId} a.tableLink`).first().click();
    await waitPath(page, '/commpilot/Group/Auto_Attendant/EditRedirect/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")').click();
    await waitPath(page, '/commpilot/Group/Auto_Attendant/Modify/index.jsp');
    page.once('dialog', dialog => dialog.accept());
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname.startsWith('/commpilot/Group/Auto_Attendant/Modify/'),
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="delete"]').first().click();
    const found = await response;
    await page.waitForTimeout(800);
    console.log(JSON.stringify({ event: 'aa-clean-delete', id,
      status: found?.status() || null,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 650) })) }));
    return;
  }
  if (process.env.BW_INSPECT_SERVICE_LIST === '1' &&
      ['Auto Attendant', 'Hunt Group', 'Call Centers'].includes(label)) {
    console.log(JSON.stringify({ event: 'service-list-inspect', label,
      ...await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 700),
        fields: [...document.querySelectorAll('td[width="82%"] input, td[width="82%"] select')]
          .filter(item => item.getClientRects().length)
          .slice(0, 25).map(item => ({ name: item.name, value: item.value, type: item.type })),
        rows: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .slice(0, 3).map(item => item.outerHTML.slice(0, 1700)) })) }));
    return;
  }
  if (process.env.BW_INSPECT_PROFILE_BUTTONS === '1' && label === 'Profile' &&
      ['Auto Attendant', 'Hunt Group', 'Call Center'].includes(level)) {
    console.log(JSON.stringify({ event: 'profile-buttons', level, ...await page.evaluate(() => ({
      path: location.pathname, title: document.title,
      buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"], td[width="82%"] input[type="button"]')]
        .filter(item => item.getClientRects().length)
        .map(item => ({ name: item.name, value: item.value, type: item.type })),
      textFields: [...document.querySelectorAll('td[width="82%"] input[type="text"]')]
        .slice(0, 8).map(item => ({ name: item.name, value: item.value })) })) }));
    return;
  }
  if (process.env.BW_INSPECT_DEPARTMENT_MODIFY === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Departments') {
    await page.locator('td[width="82%"] a.tableLink:text-is("Basement")').first().click();
    await waitPath(page, '/commpilot/Group/Departments/Modify/index.jsp');
    console.log(JSON.stringify({ event: 'department-modify-inspect', ...await page.evaluate(() => ({
      path: location.pathname, title: document.title,
      text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 600),
      buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"], td[width="82%"] input[type="button"]')]
        .filter(item => item.getClientRects().length)
        .map(item => ({ name: item.name, value: item.value, type: item.type })) })) }));
    return;
  }
  if (process.env.BW_CLEAN_SCHEDULE_DRAFTS === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Schedules') {
    const rows = await scheduleRows(page, 'PJAX-Audit-');
    const names = await rows.allTextContents();
    if (names.length !== 1) throw new Error(`Expected one disposable schedule, found ${names.length}`);
    const deleted = await deleteScheduleRow(page, names[0].trim());
    writeDeep('lifecycle:group-schedule-delete', deleted ? 'passed' : 'failed',
      `Disposable schedule ${names[0].trim()} ${deleted ? 'deleted and absent on fresh search' : 'still present'}.`);
    return;
  }
  if ((process.env.BW_INSPECT_SCHEDULE_MODIFY === '1' ||
      process.env.BW_INSPECT_SCHEDULE_LIST === '1') && level === 'Group' &&
      folder === 'Profile' && label === 'Schedules') {
    const rows = await scheduleRows(page, 'PJAX-Audit-');
    console.log(JSON.stringify({ event: 'schedule-drafts', count: await rows.count(),
      names: await rows.allTextContents() }));
    if (process.env.BW_INSPECT_SCHEDULE_LIST === '1') {
      console.log(JSON.stringify({ event: 'schedule-list-inspect', ...await page.evaluate(() => ({
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"], td[width="82%"] input[type="button"], td[width="82%"] button')]
          .filter(item => item.getClientRects().length)
          .map(item => ({ name: item.name, value: item.value, type: item.type, id: item.id })),
        rows: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .filter(item => item.innerText.includes('PJAX-Audit-'))
          .map(item => item.outerHTML.slice(0, 1500)) })) }));
    } else if (await rows.count()) {
      await rows.first().click();
      await waitPath(page, '/commpilot/Group/Schedules/Modify/index.jsp');
      console.log(JSON.stringify({ event: 'schedule-modify-inspect',
        ...await page.evaluate(() => ({ path: location.pathname, title: document.title,
          text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 700),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"], td[width="82%"] input[type="button"], td[width="82%"] button')]
            .filter(item => item.getClientRects().length)
            .map(item => ({ name: item.name, value: item.value, type: item.type, id: item.id })) })) }));
    }
    return;
  }
  if (process.env.BW_SCHEDULE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Schedules') {
    await exerciseSchedule(page);
    return;
  }
  if (process.env.BW_DEPARTMENT_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Departments') {
    await exerciseDepartment(page);
    return;
  }
  if (process.env.BW_AA_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Auto Attendant') {
    await exerciseAutoAttendant(page);
    return;
  }
  if (process.env.BW_HG_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Hunt Group') {
    await exerciseHuntGroup(page);
    return;
  }
  if (process.env.BW_CC_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Call Center' && label === 'Call Centers') {
    await exerciseCallCenter(page);
    return;
  }
  if (process.env.BW_SIMPLE_SERVICE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && ['Call Pickup', 'Call Park', 'Call Capacity', 'Series Completion'].includes(label)) {
    await exerciseSimpleService(page, label);
    return;
  }
  if (process.env.BW_USER_SERVICE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && ['VoiceXML', 'BroadWorks Anywhere', 'Find-me/Follow-me',
        'Flexible Seating Host', 'Group Paging', 'Instant Group Call'].includes(label)) {
    await exerciseUserService(page, label);
    return;
  }
  if (process.env.BW_CC_CODE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Call Center' &&
      ['Agent Unavailable Codes', 'Call Disposition Codes'].includes(label)) {
    await exerciseCallCenterCode(page, label);
    return;
  }
  if (process.env.BW_INSPECT_ADD === '1' || process.env.BW_INSPECT_ADD_ALL === '1') {
    const add = page.locator('td[width="82%"] input[type="button"][value^="Add"], ' +
      'td[width="82%"] input[type="submit"][value^="Add"], ' +
      'td[width="82%"] button:text-is("Add")').first();
    if (!await add.count()) {
      console.log(JSON.stringify({ event: 'add-inspect', label, status: 'no-add', path: entry.path }));
      return;
    }
    await add.click();
    await page.waitForFunction(value => location.pathname !== value &&
      !!document.querySelector('td[width="82%"]'), entry.path, { timeout: 15000 });
    console.log(JSON.stringify({ event: 'add-inspect', label, ...await page.evaluate(() => ({
      path: location.pathname, title: document.title,
      text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 1400),
      forms: [...document.querySelectorAll('td[width="82%"] form')].map(form => ({
        name: form.name, action: form.getAttribute('action'), enctype: form.enctype,
        fields: [...form.elements].filter(item => item.name && item.type !== 'hidden')
          .map(item => ({ name: item.name, type: item.type, value: item.value?.slice(0, 80),
            options: item.tagName === 'SELECT' ? [...item.options].slice(0, 10)
              .map(option => ({ value: option.value, label: option.textContent.trim() })) : undefined }))
      })) })) }));
    return;
  }
  const apply = page.locator('td[width="82%"] form[name="mainForm"] input[name="apply"][type="submit"]:visible').first();
  const hasFile = await page.locator('td[width="82%"] form[name="mainForm"] input[type="file"]').count() > 0;
  const hasPassword = await page.locator('td[width="82%"] form[name="mainForm"] input[type="password"]').count() > 0;
  const unsuitable = /\/Add\/|\/Import\/|\/New\//i.test(entry.path) ||
    /\b(?:Add|Import|New)\b/i.test(entry.title) || hasPassword ||
    (hasFile && process.env.BW_ALLOW_EMPTY_FILE_FORM !== '1');
  if (unsuitable || !await apply.count()) {
    console.log(JSON.stringify({ event: 'apply-skip', label, path: entry.path,
      reason: unsuitable ? 'creation-or-file-form' : 'no-apply',
      title: entry.title, hasFile, hasPassword }));
    return;
  }
  const before = await formState(page);
  if (!before?.length) {
    console.log(JSON.stringify({ event: 'apply-skip', label, path: entry.path, reason: 'no-editable-fields' }));
    return;
  }
  if (process.env.BW_APPLY_INSPECT === '1')
    console.log(JSON.stringify({ event: 'apply-form', label, ...await page.evaluate(() => {
      const form = document.querySelector('td[width="82%"] form[name="mainForm"]');
      const apply = form.querySelector('input[name="apply"]');
      return { action: form.getAttribute('action'), method: form.method,
        enctype: form.enctype, applyType: apply.type, applyOnclick: String(apply.onclick || ''),
        onsubmit: String(form.onsubmit || ''),
        controls: [...form.elements].filter(item => item.name)
          .map(item => ({ name: item.name, type: item.type })).slice(0, 30) };
    }) }));
  if (process.env.BW_NATIVE_ONLY === '1') {
    const browser = await chromium.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true });
    try {
      const nativeContext = await browser.newContext({ storageState: await page.context().storageState() });
      const nativePage = await nativeContext.newPage();
      await nativePage.route('https://apps-sbx.avpaas.io/bw-native-test', route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }));
      await nativePage.goto('https://apps-sbx.avpaas.io/bw-native-test',
        { waitUntil: 'domcontentloaded' });
      await nativePage.evaluate(value => history.replaceState(null, '', value), entry.path);
      await nativePage.setContent(await page.content(), { waitUntil: 'domcontentloaded' });
      const response = nativePage.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname === entry.path, { timeout: 15000 }).catch(() => null);
      await nativePage.locator('td[width="82%"] form[name="mainForm"] input[name="apply"]').first().click();
      const found = await response;
      const sent = new URLSearchParams(found?.request().postData() || '');
      const nativeHtml = await found?.text().catch(() => '') || '';
      console.log(JSON.stringify({ event: 'native-apply', label,
        status: found?.status() || null, path: new URL(nativePage.url()).pathname,
        title: await nativePage.title(), sentNames: [...sent.keys()],
        responseLength: nativeHtml.length,
        redirects: [...nativeHtml.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)]
          .slice(0, 4).map(match => match[1]),
        sent: Object.fromEntries(['buttonClicked', 'priorityValues', 'policy', 'ccPriority0']
          .map(name => [name, sent.getAll(name)])) }));
      await nativeContext.close();
    } finally { await browser.close(); }
    return;
  }
  await page.evaluate(() => { window.__bwApplyDocument = document; });
  const response = page.waitForResponse(item => item.request().method() === 'POST' &&
    new URL(item.url()).pathname.startsWith('/commpilot/'), { timeout: 15000 }).catch(() => null);
  await apply.click();
  const found = await response;
  if (!found) {
    writeOutcome(label, 'failed', 'Apply did not produce a CommPilot POST within 15 seconds.');
    return;
  }
  if (process.env.BW_APPLY_INSPECT === '1') {
    const html = await found.text().catch(() => '');
    console.log(JSON.stringify({ event: 'apply-response', label,
      path: new URL(found.url()).pathname, status: found.status(), length: html.length,
      title: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '',
      sentNames: [...new URLSearchParams(found.request().postData() || '').keys()],
      sent: Object.fromEntries(['buttonClicked', 'priorityValues', 'policy', 'ccPriority0']
        .map(name => [name, new URLSearchParams(found.request().postData() || '').getAll(name)])),
      redirects: [...html.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)]
        .slice(0, 4).map(match => match[1]),
      location: found.headers().location || null }));
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const after = await page.evaluate(() => ({ path: location.pathname, title: document.title,
    sameDocument: document === window.__bwApplyDocument,
    error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
  const values = await formState(page);
  const sameValues = JSON.stringify(before) === JSON.stringify(values);
  if (!sameValues && process.env.BW_APPLY_INSPECT === '1')
    console.log(JSON.stringify({ event: 'apply-value-diff', label,
      differences: before.map((field, index) => ({ name: field.name,
        before: field.value, after: values?.[index]?.value,
        checkedBefore: field.checked, checkedAfter: values?.[index]?.checked }))
        .filter(item => item.before !== item.after || item.checkedBefore !== item.checkedAfter)
        .slice(0, 14) }));
  const responsePass = found.status() === 200 && after.sameDocument && !after.error &&
    after.path === entry.path && sameValues;
  let readback = false;
  let readbackStatus = null;
  let readbackDifferences = [];
  if (responsePass) {
    await openFolder(page);
    const revisit = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === entry.path, { timeout: 15000 }).catch(() => null);
    await link.click();
    const reopened = await revisit;
    await waitPath(page, entry.path);
    readbackStatus = reopened?.status() || null;
    const freshValues = await formState(page);
    readback = readbackStatus === 200 && JSON.stringify(before) === JSON.stringify(freshValues);
    if (!readback && process.env.BW_APPLY_INSPECT === '1')
      readbackDifferences = before.map((field, index) => ({ name: field.name,
        before: field.value, after: freshValues?.[index]?.value }))
        .filter(item => item.before !== item.after).slice(0, 12);
  }
  const pass = responsePass && readback;
  if (process.env.BW_APPLY_INSPECT === '1' && !pass)
    console.log(JSON.stringify({ event: 'apply-readback', label,
      responsePass, readbackStatus, readbackDifferences }));
  let nativeComparison = '';
  if (!pass && process.env.BW_COMPARE_NATIVE === '1') {
    const browser = await chromium.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true });
    try {
      const nativeContext = await browser.newContext({ storageState: await page.context().storageState() });
      const nativePage = await nativeContext.newPage();
      const entrance = await nativePage.goto(`https://apps-sbx.avpaas.io${entry.path}`,
        { waitUntil: 'domcontentloaded' }).catch(() => null);
      const nativeForm = nativePage.locator('td[width="82%"] form[name="mainForm"] input[name="apply"][type="submit"]:visible').first();
      if (entrance?.status() === 200 && await nativeForm.count()) {
        const nativeResponse = nativePage.waitForResponse(item => item.request().method() === 'POST' &&
          new URL(item.url()).pathname === entry.path, { timeout: 15000 }).catch(() => null);
        await nativeForm.click();
        const nativeResult = await nativeResponse;
        nativeComparison = ` Native unextended Apply returned HTTP ${nativeResult?.status() || 'none'}.`;
      } else nativeComparison = ` Native unextended entry returned HTTP ${entrance?.status() || 'none'}.`;
      await nativeContext.close();
    } finally { await browser.close(); }
  }
  writeOutcome(label, pass ? 'passed' : 'failed',
    `Apply returned HTTP ${found.status()} at ${after.path}; ` +
    `${after.sameDocument ? 'same document' : 'document reloaded'}; ` +
    `${sameValues ? 'editable values preserved' : 'editable values differ'}; ` +
    `${readback ? 'fresh readback matched' : 'fresh readback missing or different'}${after.error ?
      `; ${after.error.slice(0, 140)}` : ''}.${nativeComparison}`);
}

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const page = await context.newPage();
  for (const old of context.pages()) if (old !== page) await old.close();
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await enterLevel(page); break; }
      catch (error) {
        if (attempt === 3) throw error;
        console.log(JSON.stringify({ event: 'entry-retry', level,
          attempt: attempt + 1, message: error.message.slice(0, 150) }));
        await page.waitForTimeout(500);
      }
    }
    await openFolder(page);
    const labels = await page.locator('td[width="82%"] a.navMenuItem').evaluateAll(links =>
      links.map(link => link.textContent.trim()).filter(Boolean));
    for (const label of labels) {
      if (onlyLabel && label !== onlyLabel) continue;
      try { await probe(page, label); }
      catch (error) {
        writeOutcome(label, 'failed', `Probe failed: ${error.message.slice(0, 180)}`);
      }
      if (process.env.BW_NATIVE_ONLY === '1' || process.env.BW_INSPECT_ADD === '1' ||
          process.env.BW_INSPECT_SERVICE_LIST === '1' ||
          process.env.BW_AA_CLEAN_ID ||
          process.env.BW_SIMPLE_CLEAN_NAME ||
          process.env.BW_USER_SERVICE_CLEAN_ID ||
          process.env.BW_CC_CODE_CLEAN_ID ||
          process.env.BW_INSPECT_PROFILE_BUTTONS === '1' ||
          process.env.BW_INSPECT_DEPARTMENT_MODIFY === '1' ||
          process.env.BW_INSPECT_SCHEDULE_MODIFY === '1' ||
          process.env.BW_INSPECT_SCHEDULE_LIST === '1' ||
          process.env.BW_CLEAN_SCHEDULE_DRAFTS === '1' ||
          process.env.BW_SCHEDULE_LIFECYCLE === '1' ||
          process.env.BW_DEPARTMENT_LIFECYCLE === '1' ||
          process.env.BW_AA_LIFECYCLE === '1' || process.env.BW_HG_LIFECYCLE === '1' ||
          process.env.BW_CC_LIFECYCLE === '1' ||
          process.env.BW_SIMPLE_SERVICE_LIFECYCLE === '1') break;
      if (process.env.BW_USER_SERVICE_LIFECYCLE === '1') break;
      if (process.env.BW_CC_CODE_LIFECYCLE === '1') break;
      if (new URL(page.url()).pathname === '/commpilot/Login/') {
        console.log(JSON.stringify({ event: 'session-ended', label }));
        break;
      }
      try { await openFolder(page); }
      catch (error) {
        console.log(JSON.stringify({ event: 'folder-reentry-failed', label,
          message: error.message.slice(0, 180) }));
        break;
      }
    }
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message }));
  process.exitCode = 1; });
