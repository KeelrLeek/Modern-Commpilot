// Probes sandbox import handling with files that contain no importable records.
const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
const kind = process.env.BW_UPLOAD_PROBE_KIND || 'tag-sets';
const kinds = {
  'device-types': { area: 'Reseller / Resources', folder: 'Resources', label: 'Identity/Device Profile Types',
    list: '/commpilot/Reseller/DeviceType/',
    import: '/commpilot/Operator/System/DeviceType/Import/index.jsp',
    servlet: '/commpilot/servlet/DeviceManagementImportServlet',
    fileName: 'fileName', name: 'pjax-audit-invalid.zip',
    mimeType: 'application/zip', bytes: 'THIS IS NOT A ZIP ARCHIVE AND CONTAINS NO IMPORT RECORDS' },
  'device-families': { area: 'Reseller / Resources', folder: 'Resources', label: 'Device Management Device Families',
    list: '/commpilot/Reseller/DeviceFamilies/',
    import: '/commpilot/Operator/System/DeviceFamilies/Import/index.jsp',
    servlet: '/commpilot/servlet/DeviceManagementImportServlet',
    fileName: 'fileName', name: 'pjax-audit-invalid.zip',
    mimeType: 'application/zip', bytes: 'THIS IS NOT A ZIP ARCHIVE AND CONTAINS NO IMPORT RECORDS' },
  'tag-sets': { area: 'Reseller / Resources', folder: 'Resources', label: 'Device Management Tag Sets',
    list: '/commpilot/Reseller/DeviceTags/',
    import: '/commpilot/Operator/System/DeviceTags/Import/index.jsp',
    servlet: '/commpilot/servlet/DeviceManagementImportServlet',
    fileName: 'fileName', name: 'pjax-audit-invalid.zip',
    mimeType: 'application/zip', bytes: 'THIS IS NOT A ZIP ARCHIVE AND CONTAINS NO IMPORT RECORDS' },
  'group-phone-list': { area: 'Group / Utilities', folder: 'Utilities', label: 'Common Phone List',
    list: '/commpilot/Group/PhoneList/', import: '/commpilot/Group/PhoneList/Nested/',
    servlet: '/commpilot/servlet/PhoneListImportServlet',
    fileName: 'phoneListFile', name: 'pjax-audit-empty.csv', mimeType: 'text/csv', bytes: '' },
  'user-phone-list': { area: 'User / Outgoing Calls', folder: 'Outgoing Calls', label: 'Personal Phone List',
    list: '/commpilot/User/Phone_List/Personal/',
    import: '/commpilot/User/Phone_List/Personal/Nested/',
    servlet: '/commpilot/servlet/PhoneListImportServlet',
    fileName: 'phoneListFile', name: 'pjax-audit-empty.csv', mimeType: 'text/csv', bytes: '' }
};
const spec = kinds[kind];
if (!spec) throw new Error(`Unknown upload probe kind: ${kind}`);
if (!profile || process.env.BW_INVALID_UPLOAD_PROBE !== '1')
  throw new Error('Set BW_LIVE_PROFILE and BW_INVALID_UPLOAD_PROBE=1 to run this sandbox probe');

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: true, viewport: null, acceptDownloads: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const page = await context.newPage();
  for (const oldPage of context.pages()) if (oldPage !== page) await oldPage.close();
  const navigations = [];
  const uploadCalls = [];
  let servletPosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' &&
        new URL(request.url()).pathname === spec.servlet)
      servletPosts++;
  });
  page.on('console', message => {
    if (message.text().startsWith('[upload-probe] '))
      uploadCalls.push(message.text().slice(15));
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
  });
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
    if (new URL(page.url()).hostname !== 'apps-sbx.avpaas.io')
      throw new Error('Probe must stay on the CommPilot sandbox');
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
    if (kind === 'group-phone-list' || kind === 'user-phone-list') {
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
      await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/ServiceProviders/index.jsp');
      await page.locator('#search0').click();
      await page.locator('a:text-is("Test_SP")').click();
      await page.waitForFunction(() => location.pathname === '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
      await page.waitForFunction(() => location.pathname === '/commpilot/ServiceProvider/Members/');
      await page.locator('#search0').click();
      await page.locator('a:text-is("Stan Mikita Donuts")').click();
      await page.waitForFunction(() => location.pathname === '/commpilot/ServiceProvider/Members/Modify/index.jsp');
      if (kind === 'user-phone-list') {
        await page.locator('td[width="82%"] a.navMenuItem:text-is("Users")').click();
        await page.waitForFunction(() => location.pathname === '/commpilot/Group/Members/');
        await page.locator('#search0').click();
        await page.locator('a:text-is("SMDonuts21")').click();
        await page.waitForFunction(() => location.pathname === '/commpilot/Group/Members/Modify/index.jsp');
      }
    }
    await page.locator('a.leftnavfolder, a.leftnavfolderopen')
      .filter({ hasText: new RegExp(`^\\s*${spec.folder}\\s*$`) }).click();
    await page.waitForFunction(expected => document.title.trim() === expected,
      spec.folder, { timeout: 20000 });
    await page.locator('td[width="82%"] a.navMenuItem')
      .filter({ hasText: new RegExp(`^\\s*${spec.label}\\s*$`) }).click();
    await page.waitForFunction(expected => location.pathname === expected,
      spec.list, { timeout: 20000 });
    await page.evaluate(target => window.redirectPost(target, {}), spec.import);
    await page.waitForFunction(expected =>
      location.pathname === expected &&
      !!document.querySelector('form[name="mainForm"] input[type="file"]'),
    spec.import, { timeout: 20000 });
    if (process.env.BW_INSPECT_IMPORT === '1') {
      console.log(JSON.stringify({ event: 'import-inspect', kind,
        state: await page.evaluate(() => ({ path: location.pathname, title: document.title,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 1800),
          links: [...document.querySelectorAll('a')]
            .filter(item => /help|download|csv/i.test(item.textContent || item.title || ''))
            .map(item => ({ text: item.textContent.trim(), href: item.getAttribute('href'),
              onclick: item.getAttribute('onclick') })),
          fields: [...document.querySelectorAll('form[name="mainForm"] input')]
            .filter(item => item.name && item.type !== 'hidden')
            .map(item => ({ name: item.name, type: item.type, value: item.value })) })) }));
      return;
    }
    if (process.env.BW_INSPECT_HELP === '1') {
      const popup = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await page.locator('a:text-is("Help")').first().click();
      const helpPage = await popup;
      if (helpPage) {
        await helpPage.waitForLoadState('domcontentloaded').catch(() => null);
        await helpPage.waitForTimeout(1200);
      }
      console.log(JSON.stringify({ event: 'import-help', kind,
        state: helpPage ? { url: helpPage.url(), title: await helpPage.title(),
          text: (await helpPage.locator('body').innerText().catch(() => '')).slice(0, 5000) } :
          { path: new URL(page.url()).pathname,
            text: (await page.locator('body').innerText()).slice(0, 5000) } }));
      return;
    }
    if (process.env.BW_VALID_PHONE_IMPORT === '1') {
      if (!['group-phone-list', 'user-phone-list'].includes(kind))
        throw new Error('Valid phone import probe requires a phone-list kind');
      const name = `PJAX Audit Import ${Date.now().toString(36)}`;
      const number = '2025550199';
      const csv = `"Name","Number"\r\n"${name}","${number}"\r\n`;
      const locate = () => page.evaluate(value =>
        [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .find(row => row.textContent.includes(value))?.id || '', name);
      try {
        await page.locator('form[name="mainForm"] input[type="file"]').setInputFiles({
          name: 'pjax-audit-one.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
        await page.evaluate(() => { window.__bwValidImportDocument = document; });
        const responsePromise = page.waitForResponse(response =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === spec.servlet, { timeout: 20000 });
        await page.locator('form[name="mainForm"] input[name="ok"]:visible').first().click({ noWaitAfter: true });
        const response = await responsePromise;
        await page.waitForTimeout(700);
        const state = await page.evaluate(() => ({ path: location.pathname, title: document.title,
          sameDocument: document === window.__bwValidImportDocument,
          text: document.querySelector('td[width="82%"]')?.innerText?.slice(0, 900) }));
        await page.goto(new URL(spec.list, page.url()).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(value =>
          [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
            .some(row => row.textContent.includes(value)), name,
        { timeout: 8000 }).catch(() => null);
        console.log(JSON.stringify({ event: 'valid-phone-import', kind, name, number,
          responseStatus: response.status(), state, rowId: await locate() }));
      } finally {
        await page.goto(new URL(spec.list, page.url()).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(value =>
          [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
            .some(row => row.textContent.includes(value)), name,
        { timeout: 8000 }).catch(() => null);
        const rowId = await locate();
        if (rowId) {
          await page.locator(`#${rowId} a.tableLink`).first().click();
          await page.waitForFunction(value => location.pathname !== value,
            spec.list, { timeout: 12000 });
          const deleteButton = page.locator('td[width="82%"] input[name="delete"]:visible').first();
          if (await deleteButton.count()) {
            page.once('dialog', dialog => dialog.accept());
            await deleteButton.click({ noWaitAfter: true });
            await page.waitForTimeout(600);
          }
          await page.goto(new URL(spec.list, page.url()).href, { waitUntil: 'domcontentloaded' });
        }
        console.log(JSON.stringify({ event: 'valid-phone-import-cleanup', kind, name,
          rowSeen: !!rowId, remaining: await locate() }));
      }
      return;
    }
    if (process.env.BW_PROBE_CANCEL === '1') {
      const beforeCancel = await page.evaluate(() => {
        window.__bwCancelMarker = Date.now();
        window.__bwCancelReskins = 0;
        document.addEventListener('cp:reskin', () => { window.__bwCancelReskins++; });
        return { path: location.pathname, historyLength: history.length };
      });
      await page.locator('form[name="mainForm"] input[name="cancel"]:visible').first()
        .click({ noWaitAfter: true });
      await page.waitForFunction(expected => location.pathname === expected &&
        (window.__bwCancelReskins || 0) > 0, spec.list, { timeout: 15000 });
      const afterCancel = await page.evaluate(() => ({ path: location.pathname,
        sameDocument: !!window.__bwCancelMarker,
        historyLength: history.length, reskins: window.__bwCancelReskins || 0 }));
      if (!afterCancel.sameDocument || afterCancel.path !== spec.list || servletPosts !== 0)
        throw new Error('Cancel did not return to its list in the PJAX document');
      const auditPath = path.join(__dirname, 'pjax-route-audit.json');
      const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
      const route = audit.routes.find(item => item.area === spec.area && item.path === spec.import &&
        item.sourcePath === spec.list && item.kind === 'action');
      if (!route) throw new Error('Import route is missing from the visual audit');
      route.cancelCheck = { status: 'pass', path: afterCancel.path,
        sameDocument: true, servletPosts: 0, at: new Date().toISOString() };
      audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
      fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
      console.log(JSON.stringify({ event: 'import-cancel-probe', kind,
        before: beforeCancel, after: afterCancel, servletPosts }));
      return;
    }
    const before = await page.evaluate(() => {
      window.__bwUploadProbeMarker = Date.now();
      window.__bwUploadReskins = 0;
      document.addEventListener('cp:reskin', () => { window.__bwUploadReskins++; });
      window.__bwUploadCalls = [];
      document.addEventListener('submit', () => console.log('[upload-probe] submit-event'), true);
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function () {
        console.log('[upload-probe] direct-submit');
        return originalSubmit.apply(this, arguments);
      };
      return { path: location.pathname, historyLength: history.length };
    });
    await page.locator('form[name="mainForm"] input[type="file"]').setInputFiles({
      name: spec.name, mimeType: spec.mimeType, buffer: Buffer.from(spec.bytes)
    });
    const responsePromise = page.waitForResponse(response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === spec.servlet,
    { timeout: 20000 });
    await page.locator('form[name="mainForm"] input[name="ok"]:visible').first()
      .click({ noWaitAfter: true });
    const response = await responsePromise;
    const responseBody = await response.text().catch(() => '');
    await page.waitForFunction(() => (window.__bwUploadReskins || 0) > 0 ||
      location.pathname === '/commpilot/Login/', null, { timeout: 15000 });
    const after = await page.evaluate(() => ({ path: location.pathname,
      title: document.title.trim(), historyLength: history.length,
      sameDocument: !!window.__bwUploadProbeMarker,
      reskins: window.__bwUploadReskins || 0,
      contentPresent: !!document.querySelector('td[width="82%"]'),
      errorMessage: [...document.querySelectorAll('.error, .errorMsg, .cp-alert-error')]
        .map(item => (item.textContent || '').trim().slice(0, 130)).filter(Boolean).slice(0, 2) }))
      .catch(error => ({ error: error.message.slice(0, 160) }));
    if (!after.sameDocument || !after.contentPresent ||
        (kind === 'tag-sets' && !after.errorMessage?.length) ||
        after.reskins < 1 || servletPosts !== 1)
      throw new Error('Upload result did not render in the PJAX document');
    await page.goBack();
    await page.waitForFunction(({ count, expected }) => (window.__bwUploadReskins || 0) > count &&
      location.pathname === expected &&
      !!document.querySelector('form[name="mainForm"] input[type="file"]'),
    { count: after.reskins, expected: spec.import }, { timeout: 15000 });
    const back = await page.evaluate(() => ({ path: location.pathname,
      sameDocument: !!window.__bwUploadProbeMarker,
      reskins: window.__bwUploadReskins || 0 }));
    if (!back.sameDocument || servletPosts !== 1)
      throw new Error('Back reloaded the page or repeated the file upload');
    const auditPath = path.join(__dirname, 'pjax-route-audit.json');
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    const uploadRoute = audit.routes.find(item => item.area === spec.area && item.path === spec.import &&
      item.sourcePath === spec.list && item.kind === 'action');
    if (!uploadRoute) throw new Error('Upload route is missing from the visual audit');
    uploadRoute.uploadCheck = { status: 'validation-pass',
      case: spec.bytes ? 'invalid archive' : 'empty CSV',
      httpStatus: response.status(), sameDocument: after.sameDocument,
      reskinned: after.reskins > 0, backStatus: 'pass', servletPosts,
      successfulImportTested: false, at: new Date().toISOString() };
    audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
    console.log(JSON.stringify({ event: 'invalid-upload-probe', kind, before, after,
      back, servletPosts, uploadCalls,
      response: { status: response.status(), type: response.headers()['content-type'] || '',
        location: response.headers().location ?
          new URL(response.headers().location, page.url()).pathname : null,
        title: /<title[^>]*>([^<]*)<\/title>/i.exec(responseBody)?.[1] || '',
        hasContentCell: /<td[^>]*width=["']?82%/i.test(responseBody),
        hasToken: /name=["']formtokenserial["']/i.test(responseBody),
        redirects: [...responseBody.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)]
          .slice(0, 3).map(match => match[1]) },
      navigations }));
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message }));
  process.exitCode = 1; });
