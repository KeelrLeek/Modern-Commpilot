// Read-only sandbox probe for Group Numbers and Assign Numbers.
const { chromium } = require('playwright-core');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) throw new Error('Set BW_LIVE_PROFILE to the saved sandbox profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const waitPath = (page, expected) => page.waitForFunction(pathname =>
  location.pathname === pathname && !!document.querySelector('td[width="82%"]'),
expected, { timeout: 25000 });
const snapshot = page => page.evaluate(() => ({
  path: location.pathname, title: document.title,
  content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 1400),
  forms: [...document.querySelectorAll('td[width="82%"] form')].map(form => ({
    name: form.name, action: form.getAttribute('action'), method: form.method,
    controls: [...form.elements].filter(el => el.name && el.type !== 'hidden' && el.type !== 'password')
      .map(el => ({ name: el.name, type: el.type, label: el.value?.slice(0, 70),
        options: el.tagName === 'SELECT' ? [...el.options].slice(0, 12).map(o =>
          ({ text: o.textContent.trim(), value: o.value })) : undefined })) })),
  links: [...document.querySelectorAll('td[width="82%"] a')]
    .filter(el => el.getClientRects().length).slice(0, 25)
    .map(el => ({ text: el.textContent.trim().slice(0, 80), id: el.id,
      onclick: el.getAttribute('onclick')?.slice(0, 180) }))
}));

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: true, viewport: null,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const page = await context.newPage();
  page.on('close', () => console.log(JSON.stringify({ event: 'number-page-closed' })));
  page.on('crash', () => console.log(JSON.stringify({ event: 'number-page-crashed' })));
  context.on('close', () => console.log(JSON.stringify({ event: 'number-context-closed' })));
  page.on('pageerror', error => console.log(JSON.stringify({ event: 'page-error',
    message: error.message.slice(0, 500) })));
  page.on('response', response => {
    if (new URL(response.url()).pathname !== '/commpilot/Group/GroupDnManagement/index.jsp' ||
        response.request().method() !== 'POST') return;
    const body = new URLSearchParams(response.request().postData() || '');
    body.delete('formtokenserial');
    console.log(JSON.stringify({ event: 'numbers-post', status: response.status(),
      fields: Object.fromEntries(body) }));
  });
  for (const old of context.pages()) if (old !== page) await old.close();
  let stage = 'login';
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
    if (new URL(page.url()).hostname !== 'apps-sbx.avpaas.io') throw Error('Sandbox only');
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
    stage = 'service provider';
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Test_SP")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
    stage = 'group';
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
    await waitPath(page, '/commpilot/ServiceProvider/Members/');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Stan Mikita Donuts")').click();
    await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
    stage = 'resources';
    await page.locator('a.leftnavfolder, a.leftnavfolderopen')
      .filter({ hasText: /^\s*Resources\s*$/ }).click();
    await page.waitForFunction(() => document.title.trim() === 'Resources',
      null, { timeout: 25000 });
    const label = process.env.BW_NUMBER_PAGE === 'assign' ? 'Assign Numbers' : 'Numbers';
    await page.locator('td[width="82%"] a.navMenuItem').filter({ hasText:
      new RegExp(`^\\s*${label}\\s*$`) }).click();
    stage = label;
    await waitPath(page, label === 'Numbers' ?
      '/commpilot/Group/GroupDnManagement/index.jsp' : '/commpilot/Group/DnManagement/');
    console.log(JSON.stringify({ event: 'number-page', page: await snapshot(page) }));
    if (process.env.BW_NUMBER_ACTION === 'direct') {
      await page.evaluate(() => window.redirectPost(
        '/commpilot/Group/GroupDnManagement/Nested/index.jsp',
        { key: '+1-2244830007', P_key: '+1-2244830007' }));
      await waitPath(page, '/commpilot/Group/GroupDnManagement/Nested/index.jsp');
      console.log(JSON.stringify({ event: 'number-direct', page: await snapshot(page) }));
      return;
    }
    if (process.env.BW_NUMBER_BULK === '1') {
      await page.locator('#cp-bulk-number-launch').waitFor({ timeout: 15000 });
      await page.locator('#cp-bulk-number-launch').click();
      const bytes = await page.evaluate(({ target, range }) => [...window.cpXlsxBuild([{
        name: 'Assignments', headers: range ? ['Phone Number', 'Department', 'Range End'] :
          ['Phone Number', 'Department'],
        rows: range === 'missing' ? [['+1-2244830007', 'Basement', '+1-2244830009']] :
          range === 'valid' ? [['+1-2244830007', target, '+1-2244830007'],
            ['+1-2244830030', target, '+1-2244830030']] :
            [['+1-2244830007', target]],
        widths: range ? [23, 34, 23] : [23, 34], textColumns: range ? [0, 2] : [0]
      }])], { target: process.env.BW_NUMBER_BULK_TARGET || 'Basement',
        range: process.env.BW_NUMBER_BULK_RANGE || '' });
      if (process.env.BW_NUMBER_BULK_APPLY !== '1' &&
          process.env.BW_NUMBER_BULK_DIRECT !== '1' &&
          !process.env.BW_NUMBER_BULK_RANGE) {
        const templateDownload = page.waitForEvent('download', { timeout: 10000 });
        await page.locator('.cp-bulk-dialog [data-action="template"]').click();
        const download = await templateDownload;
        console.log(JSON.stringify({ event: 'number-bulk-template',
          filename: download.suggestedFilename(), pageClosed: page.isClosed(),
          path: new URL(page.url()).pathname }));
      }
      if (process.env.BW_NUMBER_BULK_DIRECT === '1')
        await page.evaluate(() => {
          const original = window.cpListSearch;
          let first = true;
          window.cpListSearch = (...args) => {
            if (first) { first = false; return Promise.resolve({ tooMany: true }); }
            return original(...args);
          };
        });
      if (process.env.BW_NUMBER_BULK_VERIFY_EXACT === '1')
        await page.evaluate(() => {
          const original = window.cpListSearch;
          let blankSearches = 0;
          window.cpListSearch = (criteria, options) => {
            if (!criteria.length && ++blankSearches === 2)
              return Promise.resolve({ tooMany: true });
            return original(criteria, options);
          };
        });
      await page.locator('.cp-bulk-dialog input[type="file"]').setInputFiles({
        name: 'test-number-assignments.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(bytes) });
      await page.waitForFunction(() => /Review the changes|All requested numbers|Fix \d+ number|not found|unavailable|missing|stopped/i
        .test(document.querySelector('.cp-bulk-status')?.textContent || ''),
      null, { timeout: 30000 });
      console.log(JSON.stringify({ event: 'number-bulk-preview',
        path: new URL(page.url()).pathname,
        status: await page.locator('.cp-bulk-status').innerText(),
        progress: await page.locator('.cp-bulk-progress').innerText(),
        preview: (await page.locator('.cp-bulk-preview').innerText()).slice(0, 1300),
        applyEnabled: await page.locator('.cp-bulk-dialog [data-action="apply"]').isEnabled() }));
      if (process.env.BW_NUMBER_BULK_APPLY === '1') {
        if (!await page.locator('.cp-bulk-dialog [data-action="apply"]').isEnabled())
          throw Error('Bulk preview is not ready');
        await page.locator('.cp-bulk-dialog [data-action="apply"]').click();
        await page.waitForFunction(() => /Verified \d+ assignments?\.|Stopped:|readback was unavailable|did not match/i
          .test(document.querySelector('.cp-bulk-status')?.textContent || ''),
        null, { timeout: 45000 });
        console.log(JSON.stringify({ event: 'number-bulk-result',
          path: new URL(page.url()).pathname,
          status: await page.locator('.cp-bulk-status').innerText(),
          progress: await page.locator('.cp-bulk-progress').innerText(),
          preview: (await page.locator('.cp-bulk-preview').innerText()).slice(0, 1000) }));
        await waitPath(page, '/commpilot/Group/GroupDnManagement/index.jsp');
        console.log(JSON.stringify({ event: 'number-bulk-returned',
          path: new URL(page.url()).pathname }));
      }
      return;
    }
    if (process.env.BW_NUMBER_LISTSEARCH === '1') {
      const result = await page.evaluate(() => window.cpListSearch([], {})
        .then(data => ({ headers: data.headers, rows: data.rows.slice(0, 4),
          rowCount: data.rows.length, totalPages: data.totalPages,
          tooMany: data.tooMany || false })));
      console.log(JSON.stringify({ event: 'number-list-search', result }));
      return;
    }
    if (process.env.BW_NUMBER_EXACT === '1') {
      const result = await page.evaluate(() => window.cpListSearch([{
        key: 'Dn', op: 'EQUAL_TO', value: '+1-2244830007'
      }], {}).then(data => ({ rows: data.rows, tooMany: data.tooMany || false })));
      console.log(JSON.stringify({ event: 'number-exact-search', result }));
      return;
    }
    if (process.env.BW_NUMBER_CONTAINS === '1') {
      const result = await page.evaluate(() => window.cpListSearch([{
        key: 'Dn', op: 'CONTAINS', value: '4830007'
      }], {}).then(data => ({ rows: data.rows, tooMany: data.tooMany || false })));
      console.log(JSON.stringify({ event: 'number-contains-search', result }));
      return;
    }
    if (process.env.BW_NUMBER_ACTION === 'search-edit') {
      await page.locator('td[width="82%"] select[name="findKey0"]').selectOption(
        process.env.BW_NUMBER_SEARCH_KEY || 'Dn');
      await page.locator('td[width="82%"] input[name="findValue0"]').fill(
        process.env.BW_NUMBER_SEARCH_VALUE ?? '224483');
      if (process.env.BW_NUMBER_NATIVE_SEARCH === '1') {
        const navigation = page.waitForNavigation({ timeout: 20000 });
        await page.evaluate(() => {
          const form = document.forms.mainForm;
          const hidden = document.createElement('input');
          hidden.type = 'hidden'; hidden.name = 'search'; hidden.value = 'Search';
          form.appendChild(hidden);
          form.submit();
        });
        const response = await navigation;
        console.log(JSON.stringify({ event: 'number-native-search',
          status: response?.status(), page: await snapshot(page) }));
        return;
      }
      await page.locator('td[width="82%"] input[name="search"]').click();
      stage = 'numbers search';
      await page.waitForTimeout(700);
      console.log(JSON.stringify({ event: 'number-search', page: await snapshot(page) }));
      await page.locator('td[width="82%"] a:text-is("Edit")').first().waitFor({ timeout: 20000 });
      await page.locator('td[width="82%"] a:text-is("Edit")').first().click();
      stage = 'numbers edit';
      await page.waitForFunction(() => location.pathname !==
        '/commpilot/Group/GroupDnManagement/index.jsp', null, { timeout: 25000 });
      console.log(JSON.stringify({ event: 'number-edit', page: await snapshot(page) }));
      const detail = await page.evaluate(() => ({
        hiddenNames: [...document.querySelectorAll('form[name="mainForm"] input[type="hidden"]')]
          .map(el => el.name),
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"], td[width="82%"] button')]
          .filter(el => el.getClientRects().length)
          .map(el => ({ name: el.name, value: el.value || el.textContent?.trim(),
            onclick: el.getAttribute('onclick'), outer: el.outerHTML.slice(0, 420) })),
        selects: [...document.querySelectorAll('td[width="82%"] select')]
          .map(el => ({ name: el.name, multiple: el.multiple, selected: [...el.selectedOptions]
            .map(o => o.value), options: [...el.options].map(o => ({ value: o.value,
              text: o.textContent.trim() })) }))
      }));
      console.log(JSON.stringify({ event: 'number-edit-detail', detail }));
      if (process.env.BW_NUMBER_INSPECT_SCRIPTS === '1') {
        const scripts = await page.evaluate(() => [...document.scripts]
          .map(script => ({ src: script.getAttribute('src') || '',
            text: (script.textContent || '').slice(0, 200) }))
          .slice(-35));
        console.log(JSON.stringify({ event: 'number-edit-scripts', scripts }));
      }
      if (process.env.BW_NUMBER_INSPECT_JS === '1') {
        const js = await page.evaluate(async () => {
          const source = await fetch('/commpilot/Group/GroupDnManagement/Nested/validate.js')
            .then(response => response.text());
          return source.split('\n').map((line, i) => ({ i: i + 1, line: line.trim() }))
            .filter(item => /PICKLIST|addNumbers|removeNumbers|toAdd|toRemove|assignedList|unassignList/i
              .test(item.line)).slice(0, 65);
        });
        console.log(JSON.stringify({ event: 'number-edit-js', js }));
      }
      if (process.env.BW_NUMBER_INSPECT_JS === 'full') {
        const source = await page.evaluate(() =>
          fetch('/commpilot/Group/GroupDnManagement/Nested/validate.js')
            .then(response => response.text()));
        console.log(JSON.stringify({ event: 'number-edit-js-full', source: source.slice(0, 9000) }));
      }
      if (process.env.BW_NUMBER_PICK === '1') {
        await page.evaluate(() => { window.numberDoc = document; window.numberReskins = 0;
          document.addEventListener('cp:reskin', () => { window.numberReskins++; }); });
        const currentDept = await page.locator('select[name="deptDropDownList"]')
          .evaluate(el => el.selectedOptions[0]?.textContent.trim());
        if (process.env.BW_NUMBER_EXPECT_CURRENT && currentDept !==
            process.env.BW_NUMBER_EXPECT_CURRENT)
          throw Error('Unexpected current department; refusing test change');
        await page.locator('select[name="deptDropDownList"]').selectOption({
          label: process.env.BW_NUMBER_TARGET_DEPT || 'Basement' });
        await page.locator('select[name="assignedList"]').selectOption('+1-2244830007');
        console.log(JSON.stringify({ event: 'number-before-pick',
          selected: await page.locator('select[name="assignedList"]').evaluate(el =>
            [...el.selectedOptions].map(option => option.value)) }));
        const responsePromise = page.waitForResponse(response => response.request().method() ===
          'POST' && new URL(response.url()).pathname ===
          '/commpilot/Group/GroupDnManagement/Nested/index.jsp', { timeout: 8000 })
          .catch(() => null);
        await page.locator('#PICKLIST_addNumbers').click({ noWaitAfter: true });
        const response = await responsePromise;
        if (response) await page.waitForFunction(() => window.numberReskins > 0 ||
          location.pathname === '/commpilot/Login/', null, { timeout: 12000 }).catch(() => {});
        const picked = await page.evaluate(() => ({
          path: location.pathname,
          sameDocument: document === window.numberDoc,
          reskins: window.numberReskins || 0,
          toAdd: document.querySelector('input[name="toAdd"]')?.value,
          toRemove: document.querySelector('input[name="toRemove"]')?.value,
          selectedDepartment: document.querySelector('select[name="deptDropDownList"]')?.value,
          assigned: [...document.querySelector('select[name="assignedList"]')?.options || []]
            .map(o => o.value),
          assignedSelected: [...document.querySelector('select[name="assignedList"]')?.selectedOptions || []]
            .map(o => o.value),
          target: [...document.querySelector('select[name="unassignList"]')?.options || []]
            .map(o => o.value),
          targetSelected: [...document.querySelector('select[name="unassignList"]')?.selectedOptions || []]
            .map(o => o.value)
        }));
        const fields = response ? new URLSearchParams(response.request().postData() || '') : null;
        if (fields) fields.delete('formtokenserial');
        console.log(JSON.stringify({ event: 'number-picked', response: response?.status(),
          fields: fields ? Object.fromEntries(fields) : null, picked }));
        if (process.env.BW_NUMBER_SAVE === '1') {
          if (response?.status() !== 200 || !picked.target.includes('+1-2244830007'))
            throw Error('Number was not staged for Basement; refusing save');
          const before = await page.evaluate(() => window.numberReskins);
          const saveResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
            new URL(item.url()).pathname ===
            '/commpilot/Group/GroupDnManagement/Nested/index.jsp', { timeout: 10000 });
          await page.locator('form[name="mainForm"] input[name="apply"]:visible').first()
            .click({ noWaitAfter: true });
          const saved = await saveResponse;
          await page.waitForFunction(count => (window.numberReskins || 0) > count ||
            location.pathname === '/commpilot/Login/', before, { timeout: 15000 });
          console.log(JSON.stringify({ event: 'number-save', status: saved.status(),
            path: new URL(page.url()).pathname,
            sameDocument: await page.evaluate(() => document === window.numberDoc),
            content: (await page.locator('td[width="82%"]').innerText()).slice(0, 550) }));
        }
      }
      if (process.env.BW_NUMBER_REMOVE === '1') {
        await page.evaluate(() => { window.numberDoc = document; window.numberReskins = 0;
          document.addEventListener('cp:reskin', () => { window.numberReskins++; }); });
        const selectedDept = await page.locator('select[name="deptDropDownList"]')
          .evaluate(el => el.selectedOptions[0]?.textContent.trim());
        const targetOptions = await page.locator('select[name="unassignList"]')
          .evaluate(el => [...el.options].map(option => option.value));
        if (selectedDept !== 'Basement' || !targetOptions.includes('+1-2244830007'))
          throw Error('Test number is not assigned to Basement; refusing cleanup');
        await page.locator('select[name="unassignList"]').selectOption('+1-2244830007');
        const responsePromise = page.waitForResponse(response => response.request().method() ===
          'POST' && new URL(response.url()).pathname ===
          '/commpilot/Group/GroupDnManagement/Nested/index.jsp', { timeout: 8000 });
        await page.locator('#PICKLIST_removeNumbers').click({ noWaitAfter: true });
        const response = await responsePromise;
        await page.waitForFunction(() => window.numberReskins > 0, null, { timeout: 12000 });
        console.log(JSON.stringify({ event: 'number-removed', status: response.status(),
          sameDocument: await page.evaluate(() => document === window.numberDoc),
          page: await snapshot(page) }));
      }
    }
    if (process.env.BW_NUMBER_ACTION === 'add') {
      const add = page.locator('td[width="82%"] input[name="add"]:visible').first();
      await add.click({ noWaitAfter: true });
      stage = 'add';
      await page.waitForFunction(() => location.pathname !== '/commpilot/Group/DnManagement/' &&
        location.pathname !== '/commpilot/Group/GroupDnManagement/index.jsp',
      null, { timeout: 25000 });
      console.log(JSON.stringify({ event: 'number-add', page: await snapshot(page) }));
      if (process.env.BW_NUMBER_INSPECT_SCRIPTS === '1')
        console.log(JSON.stringify({ event: 'number-add-scripts', details: await page.evaluate(() => ({
          scripts: [...document.scripts].map(script => script.getAttribute('src')).filter(Boolean),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"]')]
            .map(button => ({ id: button.id, value: button.value }))
        })) }));
      if (process.env.BW_NUMBER_INSPECT_JS === '1')
        console.log(JSON.stringify({ event: 'number-add-js', source: await page.evaluate(async () => {
          const source = await fetch('/commpilot/Group/DnManagement/Add/validate.js')
            .then(response => response.text());
          return source.split('\n').map((line, i) => ({ line: i + 1, text: line.trim() }))
            .filter(item => /DOMContentLoaded|PICKLIST|addNumbers|addFirst|toAdd|assignedList/i
              .test(item.text)).slice(0, 80);
        }) }));
    }
    if (process.env.BW_NUMBER_ACTION === 'edit') {
      await page.locator('td[width="82%"] a:text-is("Edit")').first().click();
      stage = 'edit';
      await page.waitForFunction(() => location.pathname !== '/commpilot/Group/DnManagement/' &&
        location.pathname !== '/commpilot/Group/GroupDnManagement/index.jsp',
      null, { timeout: 25000 });
      console.log(JSON.stringify({ event: 'number-edit', page: await snapshot(page) }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'fatal', stage, path: new URL(page.url()).pathname,
      error: error.message }));
    process.exitCode = 1;
  } finally { await context.close(); }
})();
