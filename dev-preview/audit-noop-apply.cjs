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
async function exercisePhoneList(page, personal = false) {
  const listPath = personal ? '/commpilot/User/Phone_List/Personal/' : '/commpilot/Group/PhoneList/';
  const addPath = `${listPath}Add/index.jsp`;
  const modifyPath = `${listPath}Modify/index.jsp`;
  const label = personal ? 'Personal Phone List' : 'Common Phone List';
  const addCheck = personal ? 'discovered-610' : 'discovered-558';
  const modifyCheck = personal ? 'lifecycle:user-phone-list-modify' : 'discovered-504';
  const deleteCheck = personal ? 'lifecycle:user-phone-list-delete' : 'lifecycle:group-phone-list-delete';
  const name = `PJAX Audit Contact ${Date.now().toString(36)}`;
  const number = '+1-2025550101';
  let created = false, deleted = false;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(name);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(350);
    }
    return aaRowId(page, name);
  }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, addPath);
    await page.locator('td[width="82%"] input[name="newEntryName"]').fill(name);
    await page.locator('td[width="82%"] input[name="newEntryNumber"]').fill(number);
    await page.evaluate(() => { window.__phoneListDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === addPath,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__phoneListDocument,
      error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '',
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 450) }));
    created = found?.status() === 200 && state.sameDocument &&
      state.path === listPath && !!await locate();
    writeDeep(addCheck, created ? 'passed' : 'failed',
      `${label} Add HTTP ${found?.status() || 'none'}; ${state.sameDocument ?
        'same document' : 'reload'}; ${created ? 'saved row found' :
        `row missing at ${state.path}: ${state.error || state.text.slice(0, 150)}`}.`);
    if (!created) return;
    const rowId = await locate();
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await waitPath(page, modifyPath);
    writeDeep(modifyCheck, 'passed', `Disposable contact ${name} opened its Modify page.`);
  } finally {
    try {
      await openFolder(page);
      await page.locator(`td[width="82%"] a.navMenuItem:text-is("${label}")`).click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await waitPath(page, modifyPath);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      deleted = !(await locate());
      writeDeep(deleteCheck, deleted ? 'passed' : 'failed',
        `Disposable ${label} contact ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep(deleteCheck, 'failed',
        `Disposable ${label} cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseContactDirectory(page) {
  const name = `PJAX Audit Directory ${Date.now().toString(36)}`;
  const listPath = '/commpilot/Group/CustomContactDir/';
  const modifyPath = '/commpilot/Group/CustomContactDir/Modify/index.jsp';
  let created = false;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(name);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(350);
    }
    return aaRowId(page, name);
  }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, '/commpilot/Group/CustomContactDir/Add/index.jsp');
    await page.locator('td[width="82%"] input[name="directoryName"]').fill(name);
    await page.evaluate(() => { window.__contactDirectoryDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/commpilot/Group/CustomContactDir/Add/index.jsp',
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__contactDirectoryDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 500) }));
    created = found?.status() === 200 && state.sameDocument && state.path === listPath &&
      !!await locate();
    writeDeep('discovered-560', created ? 'passed' : 'failed',
      `Custom Contact Directory Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'saved row found' : `not saved at ${state.path}: ${state.text.slice(0, 170)}`}.`);
    if (!created) return;
    const rowId = await locate();
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await waitPath(page, modifyPath);
    writeDeep('lifecycle:group-custom-directory-modify', 'passed',
      `Disposable custom directory ${name} opened its Modify page.`);
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Custom Contact Directories")').click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await waitPath(page, modifyPath);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      const deleted = !(await locate());
      writeDeep('lifecycle:group-custom-directory-delete', deleted ? 'passed' : 'failed',
        `Disposable custom directory ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep('lifecycle:group-custom-directory-delete', 'failed',
        `Disposable custom directory cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseDigitString(page, pinhole = false) {
  const label = pinhole ? 'Pinhole Digit Strings' : 'Digit Strings';
  const listPath = `/commpilot/Group/Calling_Plan/${pinhole ? 'PinholeDigitStrings' : 'DigitStrings'}/`;
  const name = `pjaxds${Date.now().toString(36)}`;
  const pattern = `99${String(Date.now()).slice(-7)}`;
  const addCheck = pinhole ? 'discovered-556' : 'discovered-555';
  let created = false;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(name);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(350);
    }
    return aaRowId(page, name);
  }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    await page.locator('td[width="82%"] input[name="stringName"]').fill(name);
    await page.locator('td[width="82%"] input[name="pattern"]').fill(pattern);
    await page.evaluate(() => { window.__digitStringDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__digitStringDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 430) }));
    created = found?.status() === 200 && state.sameDocument && state.path === listPath &&
      !!await locate();
    writeDeep(addCheck, created ? 'passed' : 'failed',
      `${label} Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'saved row found' : `not saved at ${state.path}: ${state.text.slice(0, 145)}`}.`);
    if (!created) return;
    const rowId = await locate();
    console.log(JSON.stringify({ event: 'digit-string-row', label, name, rowId,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1600)) }));
  } finally {
    try {
      await openFolder(page);
      await page.locator(`td[width="82%"] a.navMenuItem:text-is("${label}")`).click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        const edit = page.locator(`#${rowId} a.headerLink`).last();
        if (await edit.count()) {
          await edit.click();
          await waitPath(page, `${listPath}Modify/index.jsp`);
          page.once('dialog', dialog => dialog.accept());
          await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
          await waitPath(page, listPath);
        }
      }
      const deleted = !(await locate());
      writeDeep(`lifecycle:${pinhole ? 'pinhole-' : ''}digit-string-delete`, deleted ? 'passed' : 'failed',
        `Disposable ${label} ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep(`lifecycle:${pinhole ? 'pinhole-' : ''}digit-string-delete`, 'failed',
        `Disposable ${label} cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseDialableCallerId(page) {
  const listPath = `/commpilot/${level.replace(' ', '')}/DialableCallerID/`;
  const name = `pjaxcid${Date.now().toString(36)}`;
  const addCheck = level === 'Group' ? 'discovered-570' : 'discovered-598';
  let created = false;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(name);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(350);
    }
    return aaRowId(page, name);
  }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    await page.locator('td[width="82%"] input[name="name"]').fill(name);
    await page.evaluate(() => { window.__dialableCallerIdDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__dialableCallerIdDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 430) }));
    created = found?.status() === 200 && state.sameDocument && state.path === listPath &&
      !!await locate();
    writeDeep(addCheck, created ? 'passed' : 'failed',
      `${level} Dialable Caller ID Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'saved row found' : `not saved at ${state.path}: ${state.text.slice(0, 145)}`}.`);
    if (!created) return;
    const rowId = await locate();
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await waitPath(page, `${listPath}Modify/index.jsp`);
    writeDeep(`lifecycle:${level.replace(/\s+/g, '-').toLowerCase()}-dialable-caller-id-modify`,
      'passed', `Disposable Dialable Caller ID criteria ${name} opened Modify.`);
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Dialable Caller ID")').click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await waitPath(page, `${listPath}Modify/index.jsp`);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      const deleted = !(await locate());
      writeDeep(`lifecycle:${level.replace(/\s+/g, '-').toLowerCase()}-dialable-caller-id-delete`,
        deleted ? 'passed' : 'failed',
        `Disposable ${level} Dialable Caller ID criteria ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep(`lifecycle:${level.replace(/\s+/g, '-').toLowerCase()}-dialable-caller-id-delete`,
        'failed', `Disposable Dialable Caller ID cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseCommBarringCode(page) {
  const listPath = '/commpilot/Group/CommBarringAuthCodes/';
  const code = `98${String(Date.now()).slice(-6)}`;
  let created = false;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(code);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(350);
    }
    return aaRowId(page, code);
  }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    await page.locator('td[width="82%"] input[name="code"]').fill(code);
    await page.locator('td[width="82%"] input[name="codeDesc"]').fill('PJAX Audit disposable');
    await page.evaluate(() => { window.__commBarringDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(550);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__commBarringDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 430) }));
    created = found?.status() === 200 && state.sameDocument && state.path === listPath &&
      !!await locate();
    writeDeep('discovered-566', created ? 'passed' : 'failed',
      `Communication Barring Authorization Code Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'saved row found' : `not saved at ${state.path}: ${state.text.slice(0, 145)}`}.`);
    if (created) console.log(JSON.stringify({ event: 'comm-barring-code-row', code,
      html: await page.locator(`#${await locate()}`).evaluate(item => item.outerHTML.slice(0, 1500)) }));
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Communication Barring Authorization Codes")').click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        const edit = page.locator(`#${rowId} a.headerLink`).last();
        if (await edit.count()) {
          await edit.click();
          await waitPath(page, `${listPath}Modify/index.jsp`);
          page.once('dialog', dialog => dialog.accept());
          await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
          await waitPath(page, listPath);
        } else {
          const checkbox = page.locator(`#${rowId} input[type="checkbox"]`).first();
          if (await checkbox.count()) await checkbox.check();
          const remove = page.locator('td[width="82%"] input[name="delete"], td[width="82%"] input[name="remove"]').first();
          if (await remove.count()) { page.once('dialog', dialog => dialog.accept()); await remove.click(); }
        }
      }
      const deleted = !(await locate());
      writeDeep('lifecycle:group-comm-barring-code-delete', deleted ? 'passed' : 'failed',
        `Disposable Communication Barring code ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep('lifecycle:group-comm-barring-code-delete', 'failed',
        `Disposable Communication Barring code cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseDialPlanAccessCode(page) {
  const listPath = `/commpilot/${level.replace(' ', '')}/DialPlanPolicy/`;
  const code = `98${String(Date.now()).slice(-3)}`;
  const check = level === 'Group' ? 'discovered-567' : 'discovered-597';
  async function locate() { return aaRowId(page, code); }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    await page.locator('td[width="82%"] input[name="accessCode"]').fill(code);
    await page.locator('td[width="82%"] input[name="description"]').fill('PJAX Audit disposable');
    await page.evaluate(() => { window.__dialPlanCodeDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(650);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__dialPlanCodeDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(-1100) }));
    const rowId = await locate();
    const created = found?.status() === 200 && state.sameDocument &&
      state.path === listPath && !!rowId;
    writeDeep(check, created ? 'passed' : 'failed',
      `${level} Dial Plan access code Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? `saved row ${rowId} found` : `not found at ${state.path}: ${state.text.slice(-180)}`}.`);
    if (created) console.log(JSON.stringify({ event: 'dial-plan-code-row', level, code, rowId,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1500)) }));
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Dial Plan Policy")').click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        const edit = page.locator(`#${rowId} a.headerLink`).last();
        if (await edit.count()) {
          await edit.click();
          await waitPath(page, `${listPath}Modify/index.jsp`);
          page.once('dialog', dialog => dialog.accept());
          await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
          await waitPath(page, listPath);
        } else {
          const checkbox = page.locator(`#${rowId} input[type="checkbox"]`).first();
          if (await checkbox.count()) await checkbox.check();
          const remove = page.locator('td[width="82%"] input[name="delete"], td[width="82%"] input[name="remove"]').first();
          if (await remove.count()) { page.once('dialog', dialog => dialog.accept()); await remove.click(); }
        }
      }
      const deleted = !(await locate());
      writeDeep(`lifecycle:${level.replace(/\s+/g, '-').toLowerCase()}-dial-plan-code-delete`,
        deleted ? 'passed' : 'failed',
        `Disposable ${level} Dial Plan code ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep(`lifecycle:${level.replace(/\s+/g, '-').toLowerCase()}-dial-plan-code-delete`,
        'failed', `Disposable Dial Plan code cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseVirtualOnNet(page) {
  const listPath = '/commpilot/Group/VirtualOnNet/';
  const suffix = String(Date.now()).slice(-6);
  const lastName = `PJAXAudit${suffix}`;
  const phone = `+1-202555${suffix.slice(-4)}`;
  const extension = `8${suffix.slice(-3)}`;
  async function locate() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(lastName);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(350);
    }
    return aaRowId(page, lastName);
  }
  try {
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    for (const [name, value] of Object.entries({ lastName, firstName: 'Test',
      clidLastName: 'PJAX Audit', clidFirstName: 'Test', phoneNumber: phone, extension }))
      await page.locator(`td[width="82%"] input[name="${name}"]`).fill(value);
    await page.locator('td[width="82%"] select[name="virtualOnNetCallTypeName"]').selectOption('Virtual On-Net');
    await page.evaluate(() => { window.__virtualOnNetDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__virtualOnNetDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 500) }));
    // CommPilot can expose the list URL before its immediate search controls
    // settle. Read back through a fresh list GET after checking the PJAX swap.
    if (state.path === listPath) {
      await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    }
    const rowId = state.path === listPath ? await locate() : '';
    const created = found?.status() === 200 && state.sameDocument && !!rowId;
    writeDeep('discovered-568', created ? 'passed' : 'failed',
      `Virtual On-Net Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'saved row found' : `not saved at ${state.path}: ${state.text.slice(0, 170)}`}.`);
    if (created) console.log(JSON.stringify({ event: 'virtual-on-net-row', lastName, phone, extension,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1600)) }));
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Virtual On-Net Enterprise Extensions")').click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await waitPath(page, `${listPath}Modify/index.jsp`);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      const deleted = !(await locate());
      writeDeep('lifecycle:group-virtual-on-net-delete', deleted ? 'passed' : 'failed',
        `Disposable Virtual On-Net user ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep('lifecycle:group-virtual-on-net-delete', 'failed',
        `Disposable Virtual On-Net cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseVirtualOnNetRange(page) {
  const listPath = '/commpilot/Group/VirtualOnNet/';
  const seed = String(Date.now()).slice(-4);
  const start = Math.min(9998, Math.floor(Number(seed) / 2) * 2);
  const minPhone = `+1-202555${String(start).padStart(4, '0')}`;
  const maxPhone = `+1-202555${String(start + 1).padStart(4, '0')}`;
  const minExtension = String(8000 + start % 1000);
  const maxExtension = String(8001 + start % 1000);
  const lastName = `PJAXRange${seed}`;
  async function findRows() {
    const find = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await find.count()) {
      await find.fill(lastName);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(1000);
    }
    return [await aaRowId(page, minPhone), await aaRowId(page, maxPhone)];
  }
  try {
    await page.locator('td[width="82%"] input[name="addRange"]:visible').first().click();
    await waitPath(page, `${listPath}AddRange/index.jsp`);
    for (const [name, value] of Object.entries({ lastName, firstName: 'Test',
      clidLastName: 'PJAX Audit', clidFirstName: 'Test', minPhoneNumber: minPhone,
      maxPhoneNumber: maxPhone, minExtension, maxExtension }))
      await page.locator(`td[width="82%"] input[name="${name}"]`).fill(value);
    await page.locator('td[width="82%"] select[name="virtualOnNetCallTypeName"]').selectOption('Virtual On-Net');
    await page.evaluate(() => { window.__virtualOnNetRangeDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}AddRange/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__virtualOnNetRangeDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1000),
      error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
    const rows = await page.locator('td[width="82%"] input[name="findValue0"]').count() ?
      await findRows() : ['', ''];
    const created = found?.status() === 200 && state.sameDocument && rows.every(Boolean);
    writeDeep('discovered-569', created ? 'passed' : 'failed',
      `Virtual On-Net range Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? `both saved numbers found at ${state.path}` :
        `rows ${rows.join('/') || 'none'} at ${state.path}: ${state.error || state.text.slice(0, 280)}`}.`);
    console.log(JSON.stringify({ event: 'virtual-on-net-range', lastName,
      minPhone, maxPhone, minExtension, maxExtension, rows, state,
      responseText: found ? (await found.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        .match(/.{0,100}(?:fail|error|invalid|saved|created|added|range).{0,130}/ig)?.slice(-10) : [] }));
  } finally {
    try {
      for (const phone of [minPhone, maxPhone]) {
        await openFolder(page);
        await page.locator('td[width="82%"] a.navMenuItem:text-is("Virtual On-Net Enterprise Extensions")').click();
        await waitPath(page, listPath);
        const rows = await findRows();
        const rowId = rows[phone === minPhone ? 0 : 1];
        if (!rowId) continue;
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await waitPath(page, `${listPath}Modify/index.jsp`);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Virtual On-Net Enterprise Extensions")').click();
      await waitPath(page, listPath);
      const deleted = (await findRows()).every(value => !value);
      writeDeep('lifecycle:group-virtual-on-net-range-delete', deleted ? 'passed' : 'failed',
        `Disposable two-number Virtual On-Net range ${deleted ? 'is absent' : 'still has rows'} after Delete.`);
    } catch (error) {
      writeDeep('lifecycle:group-virtual-on-net-range-delete', 'failed',
        `Disposable Virtual On-Net range cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseSpeedDial100(page) {
  const listPath = '/commpilot/User/SC100/';
  const description = `PJAXSD${Date.now().toString(36)}`;
  const number = '+1-2025550101';
  let code = '';
  async function locate() { return aaRowId(page, description); }
  try {
    await page.locator('td[width="82%"] input[value="Add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    code = await page.locator('td[width="82%"] select[name="avSpeedCodes"]').inputValue();
    await page.locator('td[width="82%"] input[name="description"]').fill(description);
    await page.locator('td[width="82%"] input[name="number"]').fill(number);
    await page.evaluate(() => { window.__speedDialDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__speedDialDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 530) }));
    const rowId = state.path === listPath ? await locate() : '';
    const created = found?.status() === 200 && state.sameDocument && !!rowId;
    writeDeep('discovered-609', created ? 'passed' : 'failed',
      `Speed Dial 100 Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? `saved code ${code} found` : `not saved at ${state.path}: ${state.text.slice(0, 165)}`}.`);
    if (created) console.log(JSON.stringify({ event: 'speed-dial-row', code, description,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1300)) }));
  } finally {
    try {
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Speed Dial 100")').click();
      await waitPath(page, listPath);
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await waitPath(page, `${listPath}Modify/index.jsp`);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      const deleted = !(await locate());
      writeDeep('lifecycle:user-speed-dial-100-delete', deleted ? 'passed' : 'failed',
        `Disposable Speed Dial 100 code ${code} ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep('lifecycle:user-speed-dial-100-delete', 'failed',
        `Disposable Speed Dial 100 cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseDeviceProfile(page) {
  const listPath = '/commpilot/Group/DeviceInventory/';
  const name = `PJAX Audit Profile ${Date.now().toString(36)}`;
  async function locate() {
    await page.locator('td[width="82%"] select[name="findOp0"]').waitFor({
      state: 'attached', timeout: 12000 });
    const key = page.locator('td[width="82%"] select[name="findKey0"]');
    if (await key.count()) {
      const option = await key.locator('option').filter({ hasText: /Identity\/Device Profile Name/ }).first().getAttribute('value');
      if (option) await key.selectOption(option);
    }
    const op = page.locator('td[width="82%"] select[name="findOp0"]');
    if (await op.count()) await op.selectOption('CONTAINS');
    await page.locator('td[width="82%"] input[name="findValue0"]').fill(name);
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      /\/commpilot\/(?:Common\/find|Group\/DeviceInventory)/.test(new URL(item.url()).pathname),
    { timeout: 12000 }).catch(() => null);
    await page.locator('td[width="82%"] #search0').click();
    await response;
    await page.waitForTimeout(500);
    return aaRowId(page, name);
  }
  try {
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, `${listPath}Add/index.jsp`);
    await page.locator('td[width="82%"] input[name="deviceName"]').fill(name);
    await page.locator('td[width="82%"] select[name="deviceType"]').selectOption('TF_SBX_Polycom_VVX400');
    await page.evaluate(() => { window.__deviceProfileDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === `${listPath}Add/index.jsp`,
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForFunction(path => location.pathname === path ||
      /Failed to add|Error \d+|Invalid/.test(document.querySelector('td[width="82%"]')?.innerText || ''),
    listPath, { timeout: 12000 }).catch(() => null);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__deviceProfileDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1300),
      tail: document.querySelector('td[width="82%"]')?.innerText?.slice(-1200),
      messages: document.querySelector('td[width="82%"]')?.innerText
        ?.match(/.{0,100}(?:fail|error|invalid|required|cannot|already exists).{0,160}/ig)?.slice(-12),
      alert: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
    console.log(JSON.stringify({ event: 'device-profile-submit', name,
      status: found?.status() || null, state,
      responseMatches: found ? (await found.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        .match(/.{0,100}(?:fail|error|invalid|require|missing|access device).{0,170}/ig)?.slice(-12) : [] }));
    const rowId = state.path === listPath ? await locate() : '';
    const created = found?.status() === 200 && state.sameDocument && !!rowId;
    writeDeep('discovered-519', created ? 'passed' : 'failed',
      `Group Device Profile Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'saved profile found' : `not saved at ${state.path}: ${state.text.slice(0, 170)}`}.`);
    if (created) console.log(JSON.stringify({ event: 'device-profile-row', name, rowId,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1450)) }));
  } finally {
    try {
      await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.headerLink`).last().click();
        await page.waitForFunction(() => location.pathname.includes('/Group/DeviceInventory/Modify/'),
          null, { timeout: 15000 });
        const deleteButton = page.locator('td[width="82%"] input[name="delete"]:visible').first();
        if (!await deleteButton.count()) {
          const tab = page.locator('td[width="82%"] a.tab:text-is("Profile")');
          if (await tab.count()) await tab.click();
        }
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
        await waitPath(page, listPath);
      }
      const deleted = !(await locate());
      writeDeep('lifecycle:group-device-profile-delete', deleted ? 'passed' : 'failed',
        `Disposable Device Profile ${deleted ? 'is absent' : 'still exists'} after Delete.`);
    } catch (error) {
      writeDeep('lifecycle:group-device-profile-delete', 'failed',
        `Disposable Device Profile cleanup needs inspection: ${error.message.slice(0, 150)}`);
    }
  }
}
async function exerciseSacGroup(page) {
  const listPath = '/commpilot/Group/SACGroup/';
  const formPath = `${listPath}Add/index.jsp`;
  const name = `PJAX Audit SAC ${Date.now().toString(36)}`;
  try {
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="sacName"]').fill(name);
    await page.locator('td[width="82%"] input[name="maxSessions"]').fill('1');
    await page.evaluate(() => { window.__bwSacDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwSacDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 800) }));
    console.log(JSON.stringify({ event: 'sac-submit', name,
      status: found?.status() || null, state }));
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), name, { timeout: 8000 }).catch(() => null);
    const rowId = await aaRowId(page, name);
    const created = found?.status() === 200 && state.sameDocument && !!rowId;
    writeDeep('discovered-542', created ? 'passed' : 'failed',
      `Session Admission Control Group Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'fresh list readback found the saved group' : 'saved group not found'}.`);
    if (rowId) console.log(JSON.stringify({ event: 'sac-row', name,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1800)) }));
  } finally {
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), name, { timeout: 8000 }).catch(() => null);
    const rowId = await aaRowId(page, name);
    if (rowId) {
      const row = page.locator(`#${rowId}`);
      const checkbox = row.locator('input[type="checkbox"]');
      if (await checkbox.count()) {
        await checkbox.check();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="apply"]:visible').first().click();
        await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      }
    }
    const deleted = !!rowId && !await aaRowId(page, name);
    writeDeep('lifecycle:group-sac-delete', deleted ? 'passed' : 'failed',
      `Disposable Session Admission Control Group ${deleted ? 'is absent' : 'still exists'} after cleanup.`);
  }
}
async function exerciseEmergencyZone(page) {
  const listPath = '/commpilot/Group/EmergencyZones/';
  const formPath = `${listPath}Add/index.jsp`;
  const address = '192.0.2.254';
  let rowSeen = false;
  try {
    if (await aaRowId(page, address)) throw new Error(`Emergency zone ${address} already exists`);
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="entryType"][value="ipaddress"]').check();
    await page.locator('td[width="82%"] input[name="homeZoneEntry"]').fill(address);
    await page.evaluate(() => { window.__bwEmergencyDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwEmergencyDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 900) }));
    console.log(JSON.stringify({ event: 'emergency-zone-submit', address,
      status: found?.status() || null, state }));
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), address, { timeout: 8000 }).catch(() => null);
    rowSeen = !!await aaRowId(page, address);
    writeDeep('discovered-532', found?.status() === 200 && state.sameDocument && rowSeen ?
      'passed' : 'failed', `Emergency Zones Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${rowSeen ? 'fresh list readback found the new address' : 'address not found'}.`);
  } finally {
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), address, { timeout: 8000 }).catch(() => null);
    const rowId = await aaRowId(page, address);
    if (rowId) {
      console.log(JSON.stringify({ event: 'emergency-zone-row', address,
        html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1000)) }));
      const checkbox = page.locator(`#${rowId} input[type="checkbox"]`);
      if (await checkbox.count()) {
        await checkbox.check();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('td[width="82%"] input[name="apply"]:visible').first().click();
        await page.waitForTimeout(500);
        await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      }
    }
    const deleted = !!rowId && !await aaRowId(page, address);
    writeDeep('lifecycle:group-emergency-zone-delete', deleted ? 'passed' : 'failed',
      `Disposable home-zone address ${address} ${deleted ? 'is absent' : 'still exists'} after cleanup.`);
  }
}
async function exerciseMwiTemplate(page) {
  const listPath = '/commpilot/Group/MWIMobile/';
  const formPath = `${listPath}AddModify/index.jsp`;
  const label = 'Default';
  let created = false;
  try {
    if (await aaRowId(page, label)) throw new Error('A Default MWI template already exists');
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="prefix0"]').fill('PJAX Audit ');
    await page.evaluate(() => { window.__bwMwiDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwMwiDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1000) }));
    console.log(JSON.stringify({ event: 'mwi-template-submit',
      status: found?.status() || null, state }));
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), label, { timeout: 8000 }).catch(() => null);
    created = !!await aaRowId(page, label);
    writeDeep('discovered-539', found?.status() === 200 && state.sameDocument && created ?
      'passed' : 'failed', `Group MWI template Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${created ? 'fresh list readback found Default template' : 'template not found'}.`);
  } finally {
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), label, { timeout: 8000 }).catch(() => null);
    const rowId = await aaRowId(page, label);
    if (rowId) {
      console.log(JSON.stringify({ event: 'mwi-template-row',
        html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1800)) }));
      await page.locator(`#${rowId} a.tableLink`).first().click();
      await waitPath(page, formPath);
      console.log(JSON.stringify({ event: 'mwi-template-modify',
        state: await page.evaluate(() => ({ path: location.pathname,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
            .map(item => item.name) })) }));
      const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (await button.count()) {
        page.once('dialog', dialog => dialog.accept());
        await button.click();
        await page.waitForTimeout(500);
      }
      await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    }
    const deleted = !!rowId && !await aaRowId(page, label);
    writeDeep('lifecycle:group-mwi-template-delete', deleted ? 'passed' : 'failed',
      `Disposable Default MWI template ${deleted ? 'is absent' : 'still exists'} after cleanup.`);
  }
}
async function exerciseRoutePoint(page) {
  const listPath = '/commpilot/Group/RoutePoint/';
  const formPath = `${listPath}AddModify/index.jsp`;
  const suffix = Date.now().toString(36);
  const id = `pjaxrp${suffix}`;
  const name = `PJAX Audit Route Point ${suffix}`;
  const password = `Audit${suffix}Z7!`;
  let saved = false;
  const locate = () => page.evaluate(value =>
    [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .find(row => row.outerHTML.includes(value))?.id || '', id);
  try {
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, formPath);
    await page.locator('td[width="82%"] input[name="userId"]').fill(id);
    await page.locator('td[width="82%"] input[name="unicodeLastName"]').fill(name);
    await page.locator('td[width="82%"] input[name="clidLastName"]').fill('PJAX Audit');
    await page.locator('td[width="82%"] input[name="clidFirstName"]').fill('RP');
    await page.locator('td[width="82%"] input[name="password"]').fill(password);
    await page.locator('td[width="82%"] input[name="echoPassword"]').fill(password);
    await page.evaluate(() => { window.__bwRoutePointDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const found = await response;
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwRoutePointDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1000),
      error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
    console.log(JSON.stringify({ event: 'route-point-submit', id, name,
      status: found?.status() || null, state }));
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.outerHTML.includes(value)), id, { timeout: 8000 }).catch(() => null);
    saved = !!await locate();
    writeDeep('discovered-540', found?.status() === 200 && state.sameDocument && saved ?
      'passed' : 'failed', `Route Point Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${saved ? 'fresh list readback found the route point' :
        `route point not found; ${state.path}; ${state.error || state.text?.slice(0, 160)}`}.`);
  } finally {
    try {
      await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
        .some(row => row.outerHTML.includes(value)), id, { timeout: 8000 }).catch(() => null);
      const rowId = await locate();
      if (rowId) {
        await page.locator(`#${rowId} a.tableLink`).first().click();
        await page.waitForFunction(value => location.pathname !== value,
          listPath, { timeout: 12000 });
        console.log(JSON.stringify({ event: 'route-point-open', id,
          state: await page.evaluate(() => ({ path: location.pathname,
            text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 450),
            buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
              .map(item => item.name) })) }));
        let deleteButton = page.locator('td[width="82%"] input[name="delete"]:visible').first();
        if (!await deleteButton.count()) {
          const profile = page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")');
          if (await profile.count()) {
            await profile.click();
            await page.waitForFunction(value => location.pathname !== value,
              '/commpilot/Group/RoutePoint/EditRedirect/index.jsp',
              { timeout: 12000 }).catch(() => null);
          }
          deleteButton = page.locator('td[width="82%"] input[name="delete"]:visible').first();
        }
        if (await deleteButton.count()) {
          page.once('dialog', dialog => dialog.accept());
          await deleteButton.click();
          await page.waitForTimeout(500);
        }
        await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      }
      const deleted = !!rowId && !await locate();
      writeDeep('lifecycle:group-route-point-delete', deleted ? 'passed' : 'failed',
        `Disposable Route Point ${name} ${deleted ? 'is absent' : 'still exists'} after cleanup.`);
    } catch (error) {
      writeDeep('lifecycle:group-route-point-delete', 'failed',
        `Route Point ${name} cleanup needs inspection: ${error.message.slice(0, 170)}`);
    }
  }
}
async function exerciseUserCriterion(page, kind) {
  const types = {
    'Call Me Now - Off': { list: 'CallMeNow', checks: ['discovered-599', 'discovered-625', 'discovered-634'], slug: 'call-me-now' },
    'Priority Alert - Off': { list: 'PRCW', checks: ['discovered-603', 'discovered-628', 'discovered-637'], slug: 'priority-alert' },
    'Selective Acceptance - Off': { list: 'SCA', checks: ['discovered-604', 'discovered-629', 'discovered-638'], slug: 'selective-acceptance' },
    'Selective Rejection - Off': { list: 'SCR', checks: ['discovered-605', 'discovered-630', 'discovered-639'], slug: 'selective-rejection' },
    'Personal Assistant - Off': { list: 'PersonalAssistant', checks: ['discovered-601'],
      slug: 'personal-assistant', field: 'criteriaName' }
  };
  const type = types[kind];
  if (!type) throw new Error(`Unknown criterion ${kind}`);
  const levelIndex = ['User', 'Hunt Group', 'Call Center'].indexOf(level);
  const checkId = type.checks[levelIndex];
  const levelSlug = level.toLowerCase().replace(/\W+/g, '-');
  const name = `PJAX ${type.slug.slice(0, 5)} ${Date.now().toString(36)}`;
  const listPath = `/commpilot/User/${type.list}/`;
  const addPath = `${listPath}Add/index.jsp`;
  async function locate() {
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), name, { timeout: 8000 }).catch(() => null);
    return aaRowId(page, name);
  }
  try {
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, addPath);
    await page.locator(`td[width="82%"] input[name="${type.field || 'description'}"]`).fill(name);
    const allow = page.locator('td[width="82%"] input[name="blacklistSelection"][value="false"]');
    if (await allow.count()) await allow.check();
    await page.evaluate(() => { window.__bwCriterionDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === addPath, { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click({ noWaitAfter: true });
    const found = await response;
    await page.waitForTimeout(700);
    const body = found ? await found.text().catch(() => '') : '';
    const state = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: document === window.__bwCriterionDocument,
      text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 750) }));
    console.log(JSON.stringify({ event: 'criterion-submit', kind, name,
      status: found?.status() || null, responsePath: found ? new URL(found.url()).pathname : '',
      responseLength: body.length, responseType: found?.headers()['content-type'] || '',
      responseTitle: /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1],
      responseHasList: /<h1[^>]*>Personal Assistant<\/h1>/i.test(body) ||
        /Additional Schedule Selective Criteria/.test(body),
      redirectTargets: [...body.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)]
        .slice(0, 4).map(match => match[1]),
      responsePreview: kind === 'Personal Assistant - Off' ? body
        .replace(/<input\b[^>]*>/gi, '<input>')
        .replace(/formtokenserial.{0,100}/gi, '[redacted]')
        .slice(0, 900) : undefined, state }));
    await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
    const rowId = await locate();
    writeDeep(checkId, found?.status() === 200 && state.sameDocument && !!rowId ?
      'passed' : 'failed', `${kind} Add HTTP ${found?.status() || 'none'}; ` +
      `${state.sameDocument ? 'same document' : 'reload'}; ` +
      `${rowId ? 'fresh list readback found the criterion' :
        `criterion not found at ${state.path}: ${state.text?.slice(0, 130)}`}.`);
  } finally {
    try {
      await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      const rowId = await locate();
      if (rowId) {
        console.log(JSON.stringify({ event: 'criterion-row', kind, name,
          html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1100)) }));
        await page.locator(`#${rowId} a.tableLink`).first().click();
        await page.waitForFunction(value => location.pathname !== value,
          listPath, { timeout: 12000 });
        console.log(JSON.stringify({ event: 'criterion-modify', kind, name,
          state: await page.evaluate(() => ({ path: location.pathname,
            buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
              .map(item => item.name) })) }));
        const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
        let deleteState = null;
        if (await button.count()) {
          await page.evaluate(() => { window.__bwCriterionDeleteDocument = document; });
          const deleteResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
            new URL(item.url()).pathname === `${listPath}Modify/index.jsp`,
          { timeout: 15000 }).catch(() => null);
          page.once('dialog', dialog => dialog.accept());
          await button.click({ noWaitAfter: true });
          await page.waitForTimeout(600);
          const foundDelete = await deleteResponse;
          deleteState = await page.evaluate(() => ({ path: location.pathname,
            sameDocument: document === window.__bwCriterionDeleteDocument,
            text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 250) }));
          console.log(JSON.stringify({ event: 'criterion-delete', kind, name,
            status: foundDelete?.status() || null, state: deleteState }));
        }
        await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
        const absent = !(await locate());
        const deletePass = absent && (!deleteState ||
          (deleteState.sameDocument && deleteState.path === listPath));
        writeDeep(`lifecycle:${levelSlug}-${type.slug}-delete`, deletePass ? 'passed' : 'failed',
          `Disposable ${kind} criterion ${name} ${absent ? 'is absent' : 'still exists'} after Delete; ` +
          `${deleteState ? `${deleteState.sameDocument ? 'same document' : 'reload'} at ${deleteState.path}` :
            'no Delete control'}.`);
        return;
      }
      writeDeep(`lifecycle:${levelSlug}-${type.slug}-delete`, 'failed',
        `Disposable ${kind} criterion ${name} was not found for Delete.`);
    } catch (error) {
      writeDeep(`lifecycle:${levelSlug}-${type.slug}-delete`, 'failed',
        `${kind} criterion ${name} cleanup needs inspection: ${error.message.slice(0, 160)}`);
    }
  }
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
  if (process.env.BW_VON_FIND_LASTNAME && level === 'Group' &&
      folder === 'Profile' && label === 'Virtual On-Net Enterprise Extensions') {
    const value = process.env.BW_VON_FIND_LASTNAME;
    await page.locator('td[width="82%"] input[name="findValue0"]').fill(value);
    await page.locator('td[width="82%"] #search0').click();
    await page.waitForTimeout(500);
    console.log(JSON.stringify({ event: 'von-find', value,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1200),
        rows: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .map(item => ({ id: item.id, text: item.textContent.trim().slice(0, 250) })) })) }));
    return;
  }
  if (process.env.BW_VON_CLEAN_LASTNAME && level === 'Group' &&
      folder === 'Profile' && label === 'Virtual On-Net Enterprise Extensions') {
    const value = process.env.BW_VON_CLEAN_LASTNAME;
    const find = async () => {
      await page.locator('td[width="82%"] input[name="findValue0"]').fill(value);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(1000);
      return page.evaluate(name => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
        .filter(row => row.textContent.includes(name)).map(row => row.id), value);
    };
    const deleted = [];
    for (let i = 0; i < 6; i++) {
      const rows = await find();
      if (!rows.length) break;
      await page.locator(`#${rows[0]} a.headerLink`).last().click();
      await waitPath(page, '/commpilot/Group/VirtualOnNet/Modify/index.jsp');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
      await waitPath(page, '/commpilot/Group/VirtualOnNet/');
      deleted.push(rows[0]);
    }
    console.log(JSON.stringify({ event: 'von-clean', value, deleted, remaining: await find() }));
    return;
  }
  if (process.env.BW_DEVICE_PROFILE_FIND_NAME && level === 'Group' &&
      folder === 'Resources' && label === 'Identity/Device Profiles') {
    const name = process.env.BW_DEVICE_PROFILE_FIND_NAME;
    await page.locator('td[width="82%"] select[name="findOp0"]').selectOption('CONTAINS');
    await page.locator('td[width="82%"] input[name="findValue0"]').fill(name);
    await page.locator('td[width="82%"] #search0').click();
    await page.waitForTimeout(1000);
    const rowId = await aaRowId(page, name);
    console.log(JSON.stringify({ event: 'device-profile-find', name, rowId,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(-500) })) }));
    if (rowId && process.env.BW_DEVICE_PROFILE_CLEAN === '1') {
      await page.locator(`#${rowId} a.headerLink`).last().click();
      await page.waitForFunction(() => location.pathname.includes('/Group/DeviceInventory/Modify/'),
        null, { timeout: 15000 });
      console.log(JSON.stringify({ event: 'device-profile-clean-modify', name,
        state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 600),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
            .map(item => item.name) })) }));
      page.once('dialog', dialog => dialog.accept());
      await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
      await waitPath(page, '/commpilot/Group/DeviceInventory/');
      await page.locator('td[width="82%"] input[name="findValue0"]').fill(name);
      await page.locator('td[width="82%"] #search0').click();
      await page.waitForTimeout(1000);
      console.log(JSON.stringify({ event: 'device-profile-clean-result', name,
        remaining: await aaRowId(page, name) }));
    }
    return;
  }
  if (process.env.BW_SAC_CLEAN_NAME && level === 'Group' &&
      folder === 'Services' && label === 'Session Admission Control Group') {
    const name = process.env.BW_SAC_CLEAN_NAME;
    const rowId = await aaRowId(page, name);
    console.log(JSON.stringify({ event: 'sac-clean-find', name, rowId }));
    if (rowId) {
      await page.locator(`#${rowId} input[type="checkbox"]`).check();
      page.once('dialog', dialog => dialog.accept());
      await page.locator('td[width="82%"] input[name="apply"]:visible').first().click();
      await page.waitForTimeout(600);
      await page.goto(new URL('/commpilot/Group/SACGroup/', page.url()).href,
        { waitUntil: 'domcontentloaded' });
      console.log(JSON.stringify({ event: 'sac-clean-result', name,
        remaining: await aaRowId(page, name),
        text: await page.locator('td[width="82%"]').innerText().then(x => x.slice(-350)) }));
    }
    return;
  }
  if (process.env.BW_EMERGENCY_ZONE_CLEAN_ADDRESS && level === 'Group' &&
      folder === 'Services' && label === 'Emergency Zones') {
    const address = process.env.BW_EMERGENCY_ZONE_CLEAN_ADDRESS;
    const rowId = await aaRowId(page, address);
    console.log(JSON.stringify({ event: 'emergency-zone-clean-find', address, rowId }));
    if (rowId) {
      await page.locator(`#${rowId} input[type="checkbox"]`).check();
      page.once('dialog', dialog => dialog.accept());
      await page.locator('td[width="82%"] input[name="apply"]:visible').first().click();
      await page.waitForTimeout(500);
      await page.goto(new URL('/commpilot/Group/EmergencyZones/', page.url()).href,
        { waitUntil: 'domcontentloaded' });
      console.log(JSON.stringify({ event: 'emergency-zone-clean-result', address,
        remaining: await aaRowId(page, address),
        text: await page.locator('td[width="82%"]').innerText().then(x => x.slice(-400)) }));
    }
    return;
  }
  if (process.env.BW_MWI_CLEAN_DEFAULT === '1' && level === 'Group' &&
      folder === 'Services' && label === 'MWI Delivery to Mobile Endpoint') {
    const rowId = await aaRowId(page, 'Default');
    console.log(JSON.stringify({ event: 'mwi-clean-find', rowId }));
    if (rowId) {
      await page.locator(`#${rowId} a.tableLink`).first().click();
      await waitPath(page, '/commpilot/Group/MWIMobile/AddModify/index.jsp');
      console.log(JSON.stringify({ event: 'mwi-clean-modify',
        state: await page.evaluate(() => ({ path: location.pathname,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
            .map(item => item.name) })) }));
      const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (await button.count()) {
        page.once('dialog', dialog => dialog.accept());
        await button.click();
        await page.waitForTimeout(500);
        await page.goto(new URL('/commpilot/Group/MWIMobile/', page.url()).href,
          { waitUntil: 'domcontentloaded' });
        console.log(JSON.stringify({ event: 'mwi-clean-result',
          remaining: await aaRowId(page, 'Default'),
          text: await page.locator('td[width="82%"]').innerText().then(x => x.slice(-350)) }));
      }
    }
    return;
  }
  if (process.env.BW_ROUTE_POINT_CLEAN_ID && level === 'Group' &&
      folder === 'Services' && label === 'Route Point') {
    const id = process.env.BW_ROUTE_POINT_CLEAN_ID;
    const locate = () => page.evaluate(value =>
      [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
        .find(row => row.outerHTML.includes(value))?.id || '', id);
    const rowId = await locate();
    console.log(JSON.stringify({ event: 'route-point-clean-find', id, rowId }));
    if (rowId) {
      await page.locator(`#${rowId} a.tableLink`).first().click();
      await waitPath(page, '/commpilot/Group/RoutePoint/EditRedirect/index.jsp');
      const profile = page.locator('td[width="82%"] a.navMenuItem:text-is("Profile")');
      if (await profile.count()) {
        await profile.click();
        await page.waitForFunction(value => location.pathname !== value,
          '/commpilot/Group/RoutePoint/EditRedirect/index.jsp',
          { timeout: 12000 }).catch(() => null);
      }
      console.log(JSON.stringify({ event: 'route-point-clean-profile', id,
        state: await page.evaluate(() => ({ path: location.pathname,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
            .map(item => item.name) })) }));
      const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (await button.count()) {
        page.once('dialog', dialog => dialog.accept());
        await button.click();
        await page.waitForTimeout(500);
        await page.goto(new URL('/commpilot/Group/RoutePoint/', page.url()).href,
          { waitUntil: 'domcontentloaded' });
        console.log(JSON.stringify({ event: 'route-point-clean-result', id,
          remaining: await locate(),
          text: await page.locator('td[width="82%"]').innerText().then(x => x.slice(-350)) }));
      }
    }
    return;
  }
  if (process.env.BW_PERSONAL_ASSISTANT_CLEAN_NAME && level === 'User' &&
      folder === 'Incoming Calls' && label.startsWith('Personal Assistant - ')) {
    const name = process.env.BW_PERSONAL_ASSISTANT_CLEAN_NAME;
    const rowId = await aaRowId(page, name);
    console.log(JSON.stringify({ event: 'personal-assistant-clean-find', name, rowId,
      path: new URL(page.url()).pathname }));
    if (rowId) {
      await page.locator(`#${rowId} a.tableLink`).first().click();
      await waitPath(page, '/commpilot/User/PersonalAssistant/Modify/index.jsp');
      console.log(JSON.stringify({ event: 'personal-assistant-clean-modify', name,
        state: await page.evaluate(() => ({ path: location.pathname,
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
            .map(item => item.name) })) }));
      const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (await button.count()) {
        page.once('dialog', dialog => dialog.accept());
        await button.click({ noWaitAfter: true });
        await page.waitForTimeout(600);
      }
      await page.goto(new URL('/commpilot/User/PersonalAssistant/', page.url()).href,
        { waitUntil: 'domcontentloaded' });
    }
    console.log(JSON.stringify({ event: 'personal-assistant-clean-result', name,
      remaining: await aaRowId(page, name),
      menu: await page.locator('td[width="82%"] a.navMenuItem').evaluateAll(items =>
        items.map(item => item.textContent.trim()).filter(x => x.startsWith('Personal Assistant'))),
      text: await page.locator('td[width="82%"]').innerText().then(x => x.slice(-450)) }));
    return;
  }
  if (process.env.BW_DIAL_PLAN_CLEAN_CODE && folder === 'Profile' && label === 'Dial Plan Policy') {
    const code = process.env.BW_DIAL_PLAN_CLEAN_CODE;
    const rowId = await aaRowId(page, code);
    console.log(JSON.stringify({ event: 'dial-plan-clean-row', level, code, rowId,
      html: rowId ? await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 1500)) : '' }));
    if (rowId) {
      await page.locator(`#${rowId} a.headerLink`).last().click();
      await page.waitForTimeout(500);
      console.log(JSON.stringify({ event: 'dial-plan-clean-modify', level, code,
        state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"]')]
            .map(item => ({ name: item.name, value: item.value })) })) }));
      page.once('dialog', dialog => dialog.accept());
      await page.locator('td[width="82%"] input[name="delete"]:visible').first().click();
      await page.waitForTimeout(500);
    }
    console.log(JSON.stringify({ event: 'dial-plan-clean-result', level, code,
      state: await page.evaluate(() => ({ path: location.pathname,
        matches: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .filter(row => row.textContent.includes(code)).length })) }));
    return;
  }
  if (process.env.BW_INSPECT_SIMPLE_LIST === '1') {
    console.log(JSON.stringify({ event: 'simple-list-inspect', level, folder, label,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700),
        controls: [...document.querySelectorAll('td[width="82%"] input, td[width="82%"] select')]
          .filter(item => item.getClientRects().length)
          .map(item => ({ name: item.name, type: item.type, value: item.value })).slice(0, 30),
        rows: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .slice(0, 2).map(item => item.outerHTML.slice(0, 1200)) })) }));
    return;
  }
  if (process.env.BW_INSPECT_SEARCH_LIST === '1') {
    const value = process.env.BW_INSPECT_SEARCH_VALUE || '';
    const field = page.locator('td[width="82%"] input[name="findValue0"]');
    if (await field.count()) await field.fill(value);
    const search = page.locator('td[width="82%"] #search0, td[width="82%"] input[name="search"]:visible').first();
    const searchCount = await search.count();
    if (searchCount) await search.click();
    if (value) await page.waitForFunction(value =>
      [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
        .some(row => row.textContent.includes(value)), value,
    { timeout: 8000 }).catch(() => null);
    else await page.waitForTimeout(600);
    console.log(JSON.stringify({ event: 'search-list-inspect', level, folder, label, value, searchCount,
      state: await page.evaluate(() => ({ path: location.pathname,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(-900),
        rows: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .slice(0, 3).map(item => item.outerHTML.slice(0, 2000)) })) }));
    return;
  }
  if (process.env.BW_INSPECT_NUMBER_EDIT === '1' && level === 'Group' &&
      folder === 'Resources' && label === 'Numbers') {
    const number = '+1-2244830030';
    await page.locator('td[width="82%"] input[name="findValue0"]').fill('2244830030');
    await page.locator('td[width="82%"] input[name="search"]:visible').first().click();
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), number, { timeout: 12000 });
    const rowId = await aaRowId(page, number);
    console.log(JSON.stringify({ event: 'number-edit-row', number, rowId,
      html: await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(-1700)) }));
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await waitPath(page, '/commpilot/Group/GroupDnManagement/Nested/index.jsp');
    console.log(JSON.stringify({ event: 'number-edit-form', number,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1100),
        forms: [...document.querySelectorAll('td[width="82%"] form')].map(form => ({
          action: form.getAttribute('action'), enctype: form.enctype,
          fields: [...form.elements].filter(item => item.name && item.type !== 'hidden')
            .map(item => ({ name: item.name, type: item.type, value: item.value })) })),
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"]')]
          .map(item => ({ name: item.name, value: item.value, onclick: String(item.onclick || '').slice(0, 250) })) })) }));
    if (process.env.BW_NUMBER_EDIT_SAVE_NOOP === '1') {
      await page.evaluate(() => { window.__bwNumberNoopDocument = document; });
      const response = page.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname === '/commpilot/Group/GroupDnManagement/Nested/index.jsp',
      { timeout: 15000 }).catch(() => null);
      await page.locator('td[width="82%"] input[name="ok"]:visible').first().click({ noWaitAfter: true });
      const found = await response;
      await page.waitForFunction(() => location.pathname ===
        '/commpilot/Group/GroupDnManagement/index.jsp', null,
      { timeout: 12000 }).catch(() => null);
      console.log(JSON.stringify({ event: 'number-edit-noop-save', number,
        status: found?.status() || null,
        state: await page.evaluate(() => ({ path: location.pathname,
          sameDocument: document === window.__bwNumberNoopDocument,
          title: document.title,
          listSearch: !!document.querySelector('td[width="82%"] input[name="search"]') })) }));
      return;
    }
    if (process.env.BW_NUMBER_DEPT_INSPECT === '1') {
      await page.locator('td[width="82%"] select[name="deptDropDownList"]').selectOption({ label: 'Basement' });
      await page.waitForTimeout(450);
      console.log(JSON.stringify({ event: 'number-edit-basement',
        state: await page.evaluate(() => ({ path: location.pathname,
          selects: [...document.querySelectorAll('td[width="82%"] select')]
            .map(item => ({ name: item.name, value: item.value,
              options: [...item.options].map(option => ({ value: option.value,
                text: option.textContent.trim() })).slice(0, 5) })) })) }));
      const left = page.locator('td[width="82%"] select[name="assignedList"]');
      if (await left.count() && await left.locator('option').count()) {
        await left.selectOption({ index: 0 });
        await page.locator('td[width="82%"] input[type="button"][value^="Add"]').first().click();
        await page.waitForFunction(value => [...document.querySelectorAll(
          'td[width="82%"] select[name="unassignList"] option')]
          .some(option => option.value === value), number,
        { timeout: 8000 }).catch(() => null);
      }
      console.log(JSON.stringify({ event: 'number-edit-add-preview',
        state: await page.evaluate(() => ({ path: location.pathname,
          selects: [...document.querySelectorAll('td[width="82%"] select')]
            .map(item => ({ name: item.name, value: item.value,
              options: [...item.options].map(option => ({ value: option.value,
                text: option.textContent.trim() })).slice(0, 5) })) })) }));
    }
    return;
  }
  if (process.env.BW_NUMBER_DEPARTMENT_CYCLE === '1' && level === 'Group' &&
      folder === 'Resources' && label === 'Numbers') {
    const number = '+1-2244830030';
    const listPath = '/commpilot/Group/GroupDnManagement/index.jsp';
    const formPath = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
    async function search() {
      if (new URL(page.url()).pathname !== listPath)
        await page.goto(new URL(listPath, page.url()).href, { waitUntil: 'domcontentloaded' });
      await page.locator('td[width="82%"] input[name="findValue0"]').fill('2244830030');
      await page.locator('td[width="82%"] input[name="search"]:visible').first().click();
      await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
        .some(row => row.textContent.includes(value)), number, { timeout: 12000 });
      const rowId = await aaRowId(page, number);
      return { rowId, text: await page.locator(`#${rowId}`).innerText() };
    }
    async function open() {
      const row = await search();
      await page.locator(`#${row.rowId} a.headerLink`).last().click();
      await waitPath(page, formPath);
      return row;
    }
    async function save() {
      await page.evaluate(() => { window.__bwNumberDocument = document; });
      const response = page.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname === formPath, { timeout: 15000 }).catch(() => null);
      await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
      const found = await response;
      await page.waitForFunction(value => location.pathname === value,
        listPath, { timeout: 12000 }).catch(() => null);
      const state = await page.evaluate(() => ({ path: location.pathname,
        sameDocument: document === window.__bwNumberDocument }));
      return { status: found?.status() || null, ...state };
    }
    let before, after, saved, restored, restoreSave;
    try {
      const row = await open();
      before = row.text;
      if (before.includes('Basement')) throw new Error('Test number is already in Basement');
      await page.locator('td[width="82%"] select[name="deptDropDownList"]')
        .selectOption({ label: 'Basement' });
      await page.locator('td[width="82%"] select[name="assignedList"]')
        .selectOption(number);
      await page.locator('td[width="82%"] input[type="button"][value^="Add"]').first().click();
      await page.waitForFunction(value => [...document.querySelectorAll(
        'td[width="82%"] select[name="unassignList"] option')]
        .some(option => option.value === value), number, { timeout: 12000 });
      saved = await save();
      after = (await search()).text;
      console.log(JSON.stringify({ event: 'number-department-assigned', number,
        before: before.slice(0, 250), after: after.slice(0, 250), saved }));
      writeDeep('discovered-823', saved.status === 200 && saved.sameDocument &&
        after.includes('Basement') ? 'passed' : 'failed',
      `Numbers Edit moved ${number} into Basement; POST HTTP ${saved.status}; ` +
      `${saved.sameDocument ? 'same document' : 'reload'}; ` +
      `${after.includes('Basement') ? 'fresh list readback matched' : 'readback did not match'}.`);
    } finally {
      try {
        const current = await search();
        if (current.text.includes('Basement')) {
          await page.locator(`#${current.rowId} a.headerLink`).last().click();
          await waitPath(page, formPath);
          await page.locator('td[width="82%"] select[name="deptDropDownList"]')
            .selectOption({ label: 'None' });
          await page.locator('td[width="82%"] select[name="assignedList"]')
            .selectOption(number);
          await page.locator('td[width="82%"] input[type="button"][value^="Add"]').first().click();
          await page.waitForFunction(value => [...document.querySelectorAll(
            'td[width="82%"] select[name="unassignList"] option')]
            .some(option => option.value === value), number, { timeout: 12000 });
          restoreSave = await save();
        }
        restored = (await search()).text;
        const pass = !restored.includes('Basement');
        writeDeep('lifecycle:group-number-department-restore', pass ? 'passed' : 'failed',
          `Number ${number} ${pass ? 'returned to its original no-department state' :
            'still appears in Basement'} after reverse transfer; HTTP ${restoreSave?.status || 'not needed'}.`);
        console.log(JSON.stringify({ event: 'number-department-restored', number,
          restored: restored.slice(0, 250), restoreSave }));
      } catch (error) {
        writeDeep('lifecycle:group-number-department-restore', 'failed',
          `Number ${number} restore needs inspection: ${error.message.slice(0, 180)}`);
      }
    }
    return;
  }
  if (process.env.BW_NUMBER_DEPARTMENT_RESTORE === '1' && level === 'Group' &&
      folder === 'Resources' && label === 'Numbers') {
    const number = '+1-2244830030';
    await page.locator('td[width="82%"] input[name="findValue0"]').fill('2244830030');
    await page.locator('td[width="82%"] input[name="search"]:visible').first().click();
    await page.waitForFunction(value => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
      .some(row => row.textContent.includes(value)), number, { timeout: 12000 });
    const rowId = await aaRowId(page, number);
    const before = await page.locator(`#${rowId}`).innerText();
    if (!before.includes('Basement')) {
      console.log(JSON.stringify({ event: 'number-department-restore-skip', number,
        reason: 'already absent from Basement', before }));
      return;
    }
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await waitPath(page, '/commpilot/Group/GroupDnManagement/Nested/index.jsp');
    await page.locator('td[width="82%"] select[name="deptDropDownList"]')
      .selectOption({ label: 'None' });
    await page.locator('td[width="82%"] select[name="assignedList"]')
      .selectOption(number);
    await page.locator('td[width="82%"] input[type="button"][value^="Add"]').first().click();
    await page.waitForFunction(value => [...document.querySelectorAll(
      'td[width="82%"] select[name="unassignList"] option')]
      .some(option => option.value === value), number, { timeout: 12000 });
    await page.evaluate(() => { window.__bwNumberRestoreDocument = document; });
    const response = page.waitForResponse(item => item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/commpilot/Group/GroupDnManagement/Nested/index.jsp',
    { timeout: 15000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click({ noWaitAfter: true });
    const found = await response;
    await page.waitForTimeout(600);
    console.log(JSON.stringify({ event: 'number-department-restore-submit', number,
      status: found?.status() || null,
      state: await page.evaluate(() => ({ path: location.pathname,
        sameDocument: document === window.__bwNumberRestoreDocument,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(-650) })) }));
    return;
  }
  if (process.env.BW_INSPECT_ADD_RANGE === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Virtual On-Net Enterprise Extensions') {
    await page.locator('td[width="82%"] input[name="addRange"]:visible').first().click();
    await waitPath(page, '/commpilot/Group/VirtualOnNet/AddRange/index.jsp');
    console.log(JSON.stringify({ event: 'add-range-inspect',
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1000),
        fields: [...document.querySelectorAll('td[width="82%"] form input, td[width="82%"] form select')]
          .filter(item => item.name && item.type !== 'hidden')
          .map(item => ({ name: item.name, type: item.type, value: item.value,
            options: item.tagName === 'SELECT' ? [...item.options].map(option => option.value).slice(0, 8) : undefined })) })) }));
    return;
  }
  if (process.env.BW_SCA_POLICY_PROBE === '1' && level === 'User' &&
      folder === 'Call Control' && label === 'Shared Call Appearance') {
    await page.locator('td[width="82%"] a.headerLink:text-is("Configure device policies")').click();
    await waitPath(page, '/commpilot/User/DevicePolicies/');
    console.log(JSON.stringify({ event: 'sca-policy-form',
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 950),
        controls: [...document.querySelectorAll('td[width="82%"] form input, td[width="82%"] form select')]
          .filter(item => item.name && item.type !== 'hidden')
          .map(item => ({ name: item.name, type: item.type, value: item.value,
            checked: item.checked, options: item.tagName === 'SELECT' ?
              [...item.options].map(option => option.value).slice(0, 12) : undefined })) })) }));
    if (process.env.BW_SCA_POLICY_APPLY === '1') {
      const values = () => page.evaluate(() => [...document.querySelectorAll(
        'td[width="82%"] form input[type="radio"], td[width="82%"] form input[type="checkbox"]')]
        .map(item => [item.name, item.value, item.checked]));
      const before = await values();
      await page.evaluate(() => { window.__scaPolicyDocument = document; });
      const response = page.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname === '/commpilot/User/DevicePolicies/',
      { timeout: 15000 }).catch(() => null);
      await page.locator('td[width="82%"] input[name="apply"]:visible').first().click();
      const found = await response;
      await page.waitForTimeout(650);
      const after = await values();
      const saved = await page.evaluate(() => ({ path: location.pathname,
        sameDocument: document === window.__scaPolicyDocument,
        saved: /\bSaved\b/.test(document.querySelector('td[width="82%"]')?.innerText || ''),
        error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '' }));
      await openFolder(page);
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Shared Call Appearance")').click();
      await waitPath(page, '/commpilot/User/SCAP/');
      await page.locator('td[width="82%"] a.headerLink:text-is("Configure device policies")').click();
      await waitPath(page, '/commpilot/User/DevicePolicies/');
      const readback = await values();
      const pass = found?.status() === 200 && saved.sameDocument && saved.saved &&
        !saved.error && JSON.stringify(before) === JSON.stringify(after) &&
        JSON.stringify(before) === JSON.stringify(readback);
      const detail = `Device Policies no-change Apply HTTP ${found?.status() || 'none'} at ${saved.path}; ` +
        `${saved.sameDocument ? 'same document' : 'reloaded'}; ` +
        `${saved.saved ? 'Saved' : 'no Saved message'}; ` +
        `${JSON.stringify(before) === JSON.stringify(readback) ? 'fresh readback matched' : 'fresh readback differed'}` +
        `${saved.error ? `; ${saved.error.slice(0, 120)}` : ''}.`;
      writeDeep('discovered-616', pass ? 'passed' : 'failed', detail);
      console.log(JSON.stringify({ event: 'sca-policy-apply', pass, detail }));
    }
    return;
  }
  if (process.env.BW_TRUNK_GROUP_PROBE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Trunk Group') {
    const name = `PJAX-Audit-TG-${Date.now().toString(36)}`;
    await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    await waitPath(page, '/commpilot/Group/TrunkGroup/Add/index.jsp');
    await page.locator('td[width="82%"] input[name="newName"]').fill(name);
    await page.locator('td[width="82%"] input[name="maxActiveCalls"]').fill('0');
    const pilot = page.locator('td[width="82%"] input[name="addPilotUser"]');
    if (await pilot.isChecked()) await pilot.uncheck();
    const none = page.locator('td[width="82%"] input[name="deviceCategory"][value="none"]');
    if (await none.count()) await none.check();
    const selected = await page.evaluate(() => ({ pilot: document.querySelector('input[name="addPilotUser"]')?.checked,
      device: document.querySelector('input[name="deviceCategory"]:checked')?.value || '' }));
    const responses = [];
    const dialogs = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.evaluate(() => {
      window.__trunkSubmitEvents = [];
      document.addEventListener('submit', event => window.__trunkSubmitEvents.push({
        defaultPrevented: event.defaultPrevented, target: event.target?.getAttribute('action'),
        submitter: event.submitter?.name
      }), true);
    });
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    page.on('response', item => {
      if (item.request().method() === 'POST')
        responses.push({ path: new URL(item.url()).pathname, status: item.status() });
    });
    const postPromise = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname.includes('/TrunkGroup/'), { timeout: 5000 }).catch(() => null);
    await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    const postResponse = await postPromise;
    await page.waitForTimeout(950);
    console.log(JSON.stringify({ event: 'trunk-group-create', name, selected, responses, dialogs, errors,
      postText: (await postResponse?.text().catch(() => '') || '').match(/.{0,100}(?:error|require|invalid|missing|incorrect).{0,180}/ig)?.slice(0, 12),
      state: await page.evaluate(value => ({ path: location.pathname, title: document.title,
        events: window.__trunkSubmitEvents,
        form: [...document.querySelectorAll('td[width="82%"] form')].map(f => ({ action: f.action,
          rawAction: f.getAttribute('action'), onsubmit: f.getAttribute('onsubmit'), method: f.method })),
        button: document.querySelector('td[width="82%"] input[name="ok"]')?.outerHTML,
        first: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 900),
        rowId: [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .find(row => row.textContent.includes(value))?.id || '',
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(-1400),
        invalid: [...document.querySelectorAll('td[width="82%"] :invalid')].map(el => el.name)
      }), name) }));
    return;
  }
  if (process.env.BW_TRUNK_CLEAN_NAME && level === 'Group' &&
      folder === 'Services' && label === 'Enterprise Trunk') {
    const name = process.env.BW_TRUNK_CLEAN_NAME;
    const rowId = await aaRowId(page, name);
    console.log(JSON.stringify({ event: 'trunk-clean-row', name, rowId, path: entry.path,
      html: rowId ? await page.locator(`#${rowId}`).evaluate(item => item.outerHTML.slice(0, 2200)) : '' }));
    if (!rowId) return;
    await page.locator(`#${rowId} a.headerLink`).last().click();
    await page.waitForFunction(() => !!document.querySelector('td[width="82%"] input[name="delete"]'),
      null, { timeout: 15000 });
    console.log(JSON.stringify({ event: 'trunk-clean-detail', name,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700),
        deleteButton: document.querySelector('td[width="82%"] input[name="delete"]')?.outerHTML || '',
        formOnSubmit: document.querySelector('td[width="82%"] input[name="delete"]')?.form?.getAttribute('onsubmit') || '',
        deleteWiring: (() => { const id = document.querySelector('td[width="82%"] input[name="delete"]')?.id;
          return [...document.querySelectorAll('td[width="82%"] script')]
            .map(item => item.textContent || '').find(item => id && item.includes(id))?.slice(0, 1100) || ''; })(),
        hidden: [...document.querySelectorAll('td[width="82%"] form input[type="hidden"]')]
          .map(item => ({ name: item.name, value: item.name === 'formtokenserial' ? '[token]' : item.value })),
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="submit"], td[width="82%"] input[type="button"]')]
          .filter(item => item.getClientRects().length)
          .map(item => ({ name: item.name, value: item.value })) })) }));
    if (process.env.BW_TRUNK_CLEAN_APPLY === '1') {
      await page.evaluate(() => { window.__trunkApplyDocument = document; });
      const response = page.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname.includes('/EnterpriseTrunk/'),
      { timeout: 15000 }).catch(() => null);
      await page.locator('td[width="82%"] input[name="apply"]:visible').first().click();
      const found = await response;
      await page.waitForTimeout(800);
      console.log(JSON.stringify({ event: 'trunk-existing-apply', name,
        status: found?.status() || null,
        postedPath: found ? new URL(found.url()).pathname : '',
        state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
          sameDocument: document === window.__trunkApplyDocument,
          error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '',
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 550) })) }));
      return;
    }
    if (process.env.BW_TRUNK_EXISTING_TAB) {
      const tab = process.env.BW_TRUNK_EXISTING_TAB;
      const posts = [];
      const listener = item => {
        if (item.request().method() === 'POST')
          posts.push({ path: new URL(item.url()).pathname, status: item.status() });
      };
      page.on('response', listener);
      await page.locator(`td[width="82%"] a.tab:text-is("${tab}")`).click();
      await page.waitForTimeout(950);
      page.off('response', listener);
      console.log(JSON.stringify({ event: 'trunk-existing-tab', name, tab, posts,
        state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
          active: document.querySelector('.tabActive')?.textContent?.trim() || '',
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 500) })) }));
      return;
    }
    if (process.env.BW_TRUNK_CLEAN_DELETE === '1') {
      const button = page.locator('td[width="82%"] input[name="delete"]:visible').first();
      if (!await button.count()) throw new Error('Trunk Edit has no Delete button');
      if (process.env.BW_TRUNK_DIRECT_CONTROLLER === '1')
        await button.evaluate(item => item.form.setAttribute('action',
          '/commpilot/Group/EnterpriseTrunk/AddUsingWeightedRouting/AddModify/'));
      if (process.env.BW_TRUNK_NATIVE_DELETE === '1')
        await page.evaluate(() => window.addEventListener('submit', event => event.stopPropagation(), true));
      page.once('dialog', dialog => dialog.accept());
      const postResponses = [];
      const postListener = item => {
        if (item.request().method() === 'POST')
          postResponses.push({ path: new URL(item.url()).pathname, status: item.status() });
      };
      page.on('response', postListener);
      const response = page.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname.includes('/EnterpriseTrunk/'),
      { timeout: 15000 }).catch(() => null);
      await button.click();
      if (process.env.BW_TRUNK_NATIVE_DELETE === '1') {
        await page.waitForTimeout(2200);
        console.log(JSON.stringify({ event: 'trunk-native-delete-result', name, postResponses,
          state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
            text: document.body?.innerText?.slice(0, 850) || '' })).catch(() => ({ path: new URL(page.url()).pathname })) }));
        page.off('response', postListener);
        return;
      }
      const found = await response;
      const rawHtml = found ? await found.text() : '';
      const rawText = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const stubIndex = rawHtml.indexOf('/commpilot/Group/EnterpriseTrunk/AddUsingWeightedRouting/AddModify/');
      await page.waitForTimeout(650);
      page.off('response', postListener);
      console.log(JSON.stringify({ event: 'trunk-clean-deleted', name,
        httpStatus: found?.status() || null,
        postResponses, rawStart: rawText.slice(0, 350),
        stubTargets: [...rawHtml.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/g)]
          .map(item => ({ target: item[1], fields: item[2].replace(/formtokenserial[^,}\n]*/g, 'formtokenserial:[token]')
            .slice(0, 500) })),
        stub: stubIndex >= 0 ? rawHtml.slice(Math.max(0, stubIndex - 50), stubIndex + 650)
          .replace(/formtokenserial[^,}\n]*/g, 'formtokenserial:[token]') : '',
        submitted: found ? [...new URLSearchParams(found.request().postData() || '')]
          .filter(item => item[0] !== 'formtokenserial') : [],
        rawMatches: rawText.match(/.{0,100}(?:error|cannot|fail|delete|assign|validation).{0,170}/ig)?.slice(-12) || [],
        state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
          error: document.querySelector('.cp-alert-error')?.textContent?.trim() || '',
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 700) })) }));
    }
    return;
  }
  if (process.env.BW_TRUNK_TAB_PROBE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Enterprise Trunk') {
    const ordered = process.env.BW_TRUNK_ROUTING === 'ordered';
    const target = process.env.BW_TRUNK_TARGET || 'Assign Priorities';
    const id = `PJAX-Audit-Trunk-${Date.now().toString(36)}`;
    const addName = ordered ? 'addByOrderedRouting' : 'addByWeightedRouting';
    await page.locator(`td[width="82%"] input[name="${addName}"]`).first().click();
    const addPath = new URL(page.url()).pathname;
    await page.locator('td[width="82%"] input[name="enterpriseTrunkName"]').fill(id);
    await page.evaluate(() => { window.__bwTrunkDocument = document; });
    const posts = [];
    const listener = response => {
      if (response.request().method() === 'POST')
        posts.push({ path: new URL(response.url()).pathname, status: response.status() });
    };
    page.on('response', listener);
    if (process.env.BW_TRUNK_SAVE_PROBE === '1')
      await page.locator('td[width="82%"] input[name="ok"]:visible').first().click();
    else await page.locator(`td[width="82%"] a.tab:text-is("${target}")`).click();
    await page.waitForTimeout(1700);
    page.off('response', listener);
    console.log(JSON.stringify({ event: 'trunk-tab-probe', id, ordered, target, addPath, posts,
      state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
        sameDocument: document === window.__bwTrunkDocument,
        text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 650),
        active: document.querySelector('.tabActive')?.textContent?.trim() || '' })) }));
    return;
  }
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
      ['Auto Attendant', 'Hunt Group', 'Call Centers', 'Enterprise Trunk', 'Trunk Group'].includes(label)) {
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
  if (process.env.BW_PHONE_LIST_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Utilities' && label === 'Common Phone List') {
    await exercisePhoneList(page);
    return;
  }
  if (process.env.BW_PHONE_LIST_LIFECYCLE === '1' && level === 'User' &&
      folder === 'Outgoing Calls' && label === 'Personal Phone List') {
    await exercisePhoneList(page, true);
    return;
  }
  if (process.env.BW_CONTACT_DIRECTORY_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Utilities' && label === 'Custom Contact Directories') {
    await exerciseContactDirectory(page);
    return;
  }
  if (process.env.BW_DIGIT_STRING_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Calling Plan' && ['Digit Strings', 'Pinhole Digit Strings'].includes(label)) {
    await exerciseDigitString(page, label === 'Pinhole Digit Strings');
    return;
  }
  if (process.env.BW_DIALABLE_CALLER_ID_LIFECYCLE === '1' &&
      ['Group', 'Service Provider'].includes(level) && folder === 'Profile' &&
      label === 'Dialable Caller ID') {
    await exerciseDialableCallerId(page);
    return;
  }
  if (process.env.BW_COMM_BARRING_CODE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Communication Barring Authorization Codes') {
    await exerciseCommBarringCode(page);
    return;
  }
  if (process.env.BW_DIAL_PLAN_CODE_LIFECYCLE === '1' &&
      ['Group', 'Service Provider'].includes(level) && folder === 'Profile' &&
      label === 'Dial Plan Policy') {
    await exerciseDialPlanAccessCode(page);
    return;
  }
  if (process.env.BW_VIRTUAL_ONNET_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Virtual On-Net Enterprise Extensions') {
    await exerciseVirtualOnNet(page);
    return;
  }
  if (process.env.BW_VIRTUAL_ONNET_RANGE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Profile' && label === 'Virtual On-Net Enterprise Extensions') {
    await exerciseVirtualOnNetRange(page);
    return;
  }
  if (process.env.BW_SPEED_DIAL_LIFECYCLE === '1' && level === 'User' &&
      folder === 'Outgoing Calls' && label === 'Speed Dial 100') {
    await exerciseSpeedDial100(page);
    return;
  }
  if (process.env.BW_DEVICE_PROFILE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Resources' && label === 'Identity/Device Profiles') {
    await exerciseDeviceProfile(page);
    return;
  }
  if (process.env.BW_SAC_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Session Admission Control Group') {
    await exerciseSacGroup(page);
    return;
  }
  if (process.env.BW_EMERGENCY_ZONE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Emergency Zones') {
    await exerciseEmergencyZone(page);
    return;
  }
  if (process.env.BW_MWI_TEMPLATE_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'MWI Delivery to Mobile Endpoint') {
    await exerciseMwiTemplate(page);
    return;
  }
  if (process.env.BW_ROUTE_POINT_LIFECYCLE === '1' && level === 'Group' &&
      folder === 'Services' && label === 'Route Point') {
    await exerciseRoutePoint(page);
    return;
  }
  if (process.env.BW_USER_CRITERION_LIFECYCLE === '1' &&
      ['User', 'Hunt Group', 'Call Center'].includes(level) &&
      folder === 'Incoming Calls' && ['Call Me Now - Off', 'Priority Alert - Off',
        'Selective Acceptance - Off', 'Selective Rejection - Off',
        'Personal Assistant - Off'].includes(label) &&
      (label !== 'Personal Assistant - Off' || level === 'User')) {
    await exerciseUserCriterion(page, label);
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
        onsubmit: form.getAttribute('onsubmit'),
        fields: [...form.elements].filter(item => item.name && item.type !== 'hidden')
          .map(item => ({ name: item.name, type: item.type, value: item.value?.slice(0, 80),
            onclick: item.type === 'submit' ? item.getAttribute('onclick') : undefined,
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
          process.env.BW_TRUNK_TAB_PROBE === '1' ||
          process.env.BW_TRUNK_CLEAN_NAME ||
          process.env.BW_TRUNK_GROUP_PROBE === '1' ||
          process.env.BW_SCA_POLICY_PROBE === '1' ||
          process.env.BW_PHONE_LIST_LIFECYCLE === '1' ||
          process.env.BW_CONTACT_DIRECTORY_LIFECYCLE === '1' ||
          process.env.BW_DIGIT_STRING_LIFECYCLE === '1' ||
          process.env.BW_DIALABLE_CALLER_ID_LIFECYCLE === '1' ||
          process.env.BW_INSPECT_SIMPLE_LIST === '1' ||
          process.env.BW_INSPECT_SEARCH_LIST === '1' ||
          process.env.BW_INSPECT_NUMBER_EDIT === '1' ||
          process.env.BW_NUMBER_DEPARTMENT_CYCLE === '1' ||
          process.env.BW_NUMBER_DEPARTMENT_RESTORE === '1' ||
          process.env.BW_INSPECT_ADD_RANGE === '1' ||
          process.env.BW_COMM_BARRING_CODE_LIFECYCLE === '1' ||
          process.env.BW_DIAL_PLAN_CODE_LIFECYCLE === '1' ||
          process.env.BW_DIAL_PLAN_CLEAN_CODE ||
          process.env.BW_VIRTUAL_ONNET_LIFECYCLE === '1' ||
          process.env.BW_VIRTUAL_ONNET_RANGE_LIFECYCLE === '1' ||
          process.env.BW_VON_FIND_LASTNAME ||
          process.env.BW_VON_CLEAN_LASTNAME ||
          process.env.BW_SPEED_DIAL_LIFECYCLE === '1' ||
          process.env.BW_DEVICE_PROFILE_LIFECYCLE === '1' ||
          process.env.BW_SAC_LIFECYCLE === '1' ||
          process.env.BW_EMERGENCY_ZONE_LIFECYCLE === '1' ||
          process.env.BW_MWI_TEMPLATE_LIFECYCLE === '1' ||
          process.env.BW_ROUTE_POINT_LIFECYCLE === '1' ||
          process.env.BW_USER_CRITERION_LIFECYCLE === '1' ||
          process.env.BW_ROUTE_POINT_CLEAN_ID ||
          process.env.BW_PERSONAL_ASSISTANT_CLEAN_NAME ||
          process.env.BW_MWI_CLEAN_DEFAULT === '1' ||
          process.env.BW_EMERGENCY_ZONE_CLEAN_ADDRESS ||
          process.env.BW_SAC_CLEAN_NAME ||
          process.env.BW_DEVICE_PROFILE_FIND_NAME ||
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
