// Read-only sandbox probe for group Identity/Device Profiles.
const { chromium } = require('playwright-core');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) throw Error('Set BW_LIVE_PROFILE to the saved sandbox profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const waitPath = (page, expected) => page.waitForFunction(pathname =>
  location.pathname === pathname && !!document.querySelector('td[width="82%"]'),
expected, { timeout: 25000 });

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: true, viewport: null,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const page = await context.newPage();
  page.on('dialog', async dialog => {
    console.log(JSON.stringify({ event: 'dialog', type: dialog.type(),
      message: dialog.message().slice(0, 250) }));
    if (process.env.BW_PROFILE_BULK_APPLY === '1' && dialog.type() === 'confirm')
      await dialog.accept();
    else await dialog.dismiss();
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const url = new URL(frame.url());
    if (url.hostname === 'apps-sbx.avpaas.io')
      console.log(JSON.stringify({ event: 'frame-nav', path: url.pathname }));
  });
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url());
    if (url.hostname !== 'apps-sbx.avpaas.io' ||
        (!url.pathname.includes('/DeviceInventory/') &&
        url.pathname !== '/commpilot/servlet/DeviceInventoryProvisionServlet')) return;
    const fields = new URLSearchParams(request.postData() || '');
    console.log(JSON.stringify({ event: 'post', path: url.pathname,
      fields: Object.fromEntries(['buttonClicked', 'tabPage', 'key', 'P_key',
        'delete', 'DIaction', 'modeChange', 'redirectPage', 'deviceName',
        'findKey0', 'findOp0', 'findValue0'].filter(name => fields.has(name))
        .map(name => [name, fields.get(name)])) }));
  });
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
    if (new URL(page.url()).hostname !== 'apps-sbx.avpaas.io') throw Error('Sandbox only');
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Test_SP")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
    await waitPath(page, '/commpilot/ServiceProvider/Members/');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Stan Mikita Donuts")').click();
    await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
    await page.locator('a.leftnavfolder, a.leftnavfolderopen')
      .filter({ hasText: /^\s*Resources\s*$/ }).click();
    await page.waitForFunction(() => document.title.trim() === 'Resources',
      null, { timeout: 25000 });
    await page.locator('td[width="82%"] a.navMenuItem')
      .filter({ hasText: /^\s*Identity\/Device Profiles\s*$/ }).click();
    await waitPath(page, '/commpilot/Group/DeviceInventory/');
    const list = await page.evaluate(() => ({
      path: location.pathname, title: document.title,
      search: [...document.querySelectorAll('select[name^="find"], input[name^="find"]')]
        .map(el => ({ name: el.name, value: el.value,
          options: el.tagName === 'SELECT' ? [...el.options].map(option =>
            ({ text: option.textContent.trim(), value: option.value })) : undefined })),
      content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 600)
    }));
    console.log(JSON.stringify({ event: 'profile-list', list }));
    if (process.env.BW_PROFILE_ADD_INSPECT === '1' || process.env.BW_PROFILE_CREATE_TEST === '1') {
      await page.locator('td[width="82%"] input[name="add"]').first().click();
      await waitPath(page, '/commpilot/Group/DeviceInventory/Add/index.jsp');
      const add = await page.evaluate(() => ({
        path: location.pathname,
        content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 1400),
        controls: [...document.querySelectorAll('td[width="82%"] form[name="mainForm"] input, td[width="82%"] form[name="mainForm"] select')]
          .filter(el => el.type !== 'hidden' && el.type !== 'password')
          .map(el => ({ name: el.name, type: el.type, value: el.value,
            options: el.tagName === 'SELECT' ? [...el.options].slice(0, 8)
              .map(o => ({ text: o.textContent.trim(), value: o.value })) : undefined }))
      }));
      console.log(JSON.stringify({ event: 'profile-add', add }));
      if (process.env.BW_PROFILE_CREATE_TEST === '1') {
        const name = 'CODEX CLEANUP TEST 99999';
        await page.locator('input[name="deviceName"]').fill(name);
        await page.locator('select[name="deviceType"]').selectOption('TF_SBX_Polycom_VVX400');
        await page.locator('form[name="mainForm"] input[name="ok"]').first().click();
        await page.waitForTimeout(900);
        console.log(JSON.stringify({ event: 'profile-created', path: new URL(page.url()).pathname,
          content: (await page.locator('td[width="82%"]').innerText()).slice(0, 900) }));
      }
      return;
    }
    if (process.env.BW_PROFILE_BULK === '1') {
      await page.locator('#cp-bulk-profile-launch').click();
      const bytes = await page.evaluate(extension => [...window.cpXlsxBuild([{
        name: 'Extensions', headers: ['Extension'], rows: [[extension]],
        widths: [22], textColumns: [0]
      }])], process.env.BW_PROFILE_EXT || '21');
      await page.locator('.cp-profile-bulk-dialog input[type="file"]').setInputFiles({
        name: 'sandbox-read-only.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(bytes)
      });
      await page.waitForFunction(() => /No unused matching profiles|Review every matching profile|Resolve the error rows/
        .test(document.querySelector('.cp-bulk-status')?.textContent || ''),
      null, { timeout: 30000 });
      console.log(JSON.stringify({ event: 'profile-bulk-preview',
        status: await page.locator('.cp-bulk-status').innerText(),
        preview: (await page.locator('.cp-bulk-preview').innerText()).slice(0, 1100),
        applyEnabled: await page.locator('.cp-profile-bulk-dialog [data-action="apply"]').isEnabled() }));
      if (process.env.BW_PROFILE_BULK_APPLY === '1') {
        const preview = await page.locator('.cp-bulk-preview').innerText();
        if (process.env.BW_PROFILE_EXT !== '99999' ||
            !/1 ready to delete · 0 in use/.test(preview) ||
            !preview.includes('CODEX CLEANUP TEST 99999'))
          throw Error('Refusing to delete anything except the disposable sandbox profile');
        await page.locator('.cp-profile-bulk-dialog [data-action="apply"]').click();
        await page.waitForFunction(() => !document.querySelector('.cp-bulk-status') ||
          /deleted and verified|errors or unverified/
          .test(document.querySelector('.cp-bulk-status')?.textContent || ''),
        null, { timeout: 30000 });
        console.log(JSON.stringify({ event: 'profile-bulk-result',
          status: await page.locator('.cp-bulk-status').first().innerText().catch(() => 'Modal disappeared'),
          preview: await page.locator('.cp-bulk-preview').first()
            .innerText().then(text => text.slice(0, 1100)).catch(() => '') }));
      }
      return;
    }
    const rows = await page.evaluate(() => window.cpListSearch([], {})
      .then(result => ({ tooMany: result.tooMany || false, count: result.rows.length,
        rows: result.rows.slice(0, 4) })));
    console.log(JSON.stringify({ event: 'profile-rows', rows }));
    if (!rows.rows.length || !rows.rows[0].drill) return;
    await page.evaluate(drill => window.redirectPost(drill.url, drill.params), rows.rows[0].drill);
    await page.waitForFunction(() => location.pathname !== '/commpilot/Group/DeviceInventory/',
      null, { timeout: 25000 });
    const detail = await page.evaluate(() => ({
      path: location.pathname, title: document.title,
      content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 1000),
      identity: { deviceName: document.forms.mainForm?.elements.namedItem('deviceName')?.value,
        key: document.forms.mainForm?.elements.namedItem('key')?.value },
      buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"], td[width="82%"] button')]
        .map(el => ({ name: el.name, type: el.type, value: el.value || el.textContent.trim(),
          onclick: el.getAttribute('onclick')?.slice(0, 300), outer: el.outerHTML.slice(0, 450) })),
      tabs: [...document.querySelectorAll('td[width="82%"] a')]
        .map(el => ({ text: el.textContent.trim(), href: el.getAttribute('href'),
          onclick: el.getAttribute('onclick')?.slice(0, 300), outer: el.outerHTML.slice(0, 450) }))
        .filter(el => el.text === 'Users' || el.text === 'Profile'),
      forms: [...document.querySelectorAll('td[width="82%"] form')]
        .map(el => ({ name: el.name, action: el.action, method: el.method,
          enctype: el.enctype, files: el.querySelectorAll('input[type="file"]').length,
          hidden: [...el.querySelectorAll('input[type="hidden"]')].map(input => input.name) }))
    }));
    console.log(JSON.stringify({ event: 'profile-detail', detail }));
    const deleteWire = await page.evaluate(() => {
      const id = document.querySelector('input[name="delete"]')?.id;
      return [...document.querySelectorAll('script:not([src])')]
        .map(script => script.textContent || '')
        .filter(source => source.includes(id) || /confirm\([^)]*[Dd]elet/.test(source))
        .map(source => source.slice(Math.max(0, source.indexOf(id) - 120),
          source.indexOf(id) + 500)).slice(0, 8);
    });
    console.log(JSON.stringify({ event: 'profile-delete-wiring', deleteWire }));
    const usersTab = page.locator('td[width="82%"] a').filter({ hasText: /^Users$/ }).first();
    if (await usersTab.count()) {
      await usersTab.click();
      await page.waitForFunction(() => location.pathname.includes('/Modify/Users/'),
        null, { timeout: 25000 });
      const users = await page.evaluate(() => ({ path: location.pathname,
        content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 1500),
        rows: [...document.querySelectorAll('td[width="82%"] tr')].slice(0, 12)
          .map(row => row.innerText.slice(0, 200)) }));
      console.log(JSON.stringify({ event: 'profile-users', users }));
      const assignments = await page.evaluate(() => window.cpListSearch([], {})
        .then(result => ({ tooMany: result.tooMany || false,
          count: result.rows.length, rows: result.rows.slice(0, 3) })));
      console.log(JSON.stringify({ event: 'profile-user-assignments', assignments }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'fatal', path: new URL(page.url()).pathname,
      title: await page.title().catch(() => ''),
      content: await page.locator('td[width="82%"]')
        .first().innerText({ timeout: 1000 }).then(text => text.slice(0, 800)).catch(() => ''),
      bulkStatus: await page.locator('.cp-bulk-status').first()
        .innerText({ timeout: 1000 }).catch(() => ''),
      bulkPreview: await page.locator('.cp-bulk-preview').first()
        .innerText({ timeout: 1000 }).then(text => text.slice(0, 900)).catch(() => ''),
      message: error.message }));
    process.exitCode = 1;
  } finally { await context.close(); }
})();
