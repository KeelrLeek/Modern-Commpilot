// Inspect and later verify Shared Call Appearance Add on the saved sandbox user.
const { chromium } = require('playwright-core');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) throw new Error('Set BW_LIVE_PROFILE to the saved sandbox test profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let stage = 'launch';
const recent = [];
const requestEvents = [];
const pjaxMessages = [];
const startedAt = Date.now();
const tokenIds = new Map();
const tokenId = value => {
  if (!value) return 0;
  if (!tokenIds.has(value)) tokenIds.set(value, tokenIds.size + 1);
  return tokenIds.get(value);
};
const waitPath = async (page, pathname) => page.waitForFunction(expected =>
  location.pathname === expected && !!document.querySelector('td[width="82%"]'),
pathname, { timeout: 25000 }).catch(async error => {
  const state = await page.evaluate(() => ({ path: location.pathname, title: document.title,
    text: document.querySelector('td[width="82%"]')?.innerText?.trim().slice(0, 300) })).catch(() => ({}));
  throw new Error(`${error.message}; state=${JSON.stringify(state)}`);
});

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: true, viewport: null, acceptDownloads: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  if (process.env.BW_SCAP_DEBUG === '1')
    await context.addInitScript(() => localStorage.setItem('cpDebug', '1'));
  const page = await context.newPage();
  if (process.env.BW_SCAP_INSPECT_USER_FRAME === '1') {
    let userStubSeen = false;
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/commpilot/User/index.jsp' &&
          response.request().method() === 'POST') userStubSeen = true;
    });
    await page.route('**/commpilot/Common/folder_contents.jsp', async route => {
      if (!userStubSeen || route.request().method() !== 'POST')
        return route.continue();
      const response = await route.fetch({ maxRedirects: 0 });
      const headers = response.headers();
      let location = '';
      if (headers.location) {
        try { const redirect = new URL(headers.location, response.url());
          location = `${redirect.protocol}//${redirect.host}${redirect.pathname}`; }
        catch (e) { location = 'unparseable'; }
      }
      console.log(JSON.stringify({ event: 'user-folder-http', status: response.status(),
        location, csp: headers['content-security-policy'] || '',
        xFrameOptions: headers['x-frame-options'] || '' }));
      if (response.status() === 302 && process.env.BW_SCAP_RETRY_USER_FRAME === '1') {
        await new Promise(resolve => setTimeout(resolve, 500));
        const second = await route.fetch({ maxRedirects: 0 });
        console.log(JSON.stringify({ event: 'user-folder-retry', status: second.status() }));
        await route.fulfill({ response: second });
      } else await route.fulfill({ response });
    });
  }
  page.on('console', message => {
    if (message.text().startsWith('[pjax]')) {
      pjaxMessages.push({ ms: Date.now() - startedAt, text: message.text().slice(0, 260) });
      if (pjaxMessages.length > 100) pjaxMessages.shift();
    }
  });
  page.on('response', response => {
    if (response.request().method() === 'POST') {
      const item = { ms: Date.now() - startedAt, path: new URL(response.url()).pathname, status: response.status(),
        requestTokenId: tokenId(new URLSearchParams(response.request().postData() || '').get('formtokenserial')) };
      recent.push(item);
      if (item.path === '/commpilot/Group/Members/Modify/index.jsp' ||
          item.path === '/commpilot/User/index.jsp' ||
          item.path === '/commpilot/Common/folder_contents.jsp') response.text().then(html => {
        item.hasContent = html.includes('width="82%"');
        item.hasLogin = /Please login again|not authorized to access the system/i.test(html);
        item.hasToken = /name=["']formtokenserial["']/i.test(html);
        const tokenTag = /<input\b[^>]*name=["']formtokenserial["'][^>]*>/i.exec(html)?.[0] || '';
        item.responseTokenId = tokenId(/\bvalue=["']([^"']+)/i.exec(tokenTag)?.[1]);
        item.length = html.length;
        if (item.path !== '/commpilot/User/index.jsp') return;
        item.stub = /redirectPost\s*\(\s*['"]([^'"]+)/.exec(html)?.[1] || '';
        const at = html.indexOf('redirectPost(');
        item.stubContext = at < 0 ? '' : html.slice(at, at + 350);
        item.callContexts = [...html.matchAll(/redirectPost\s*\(\s*['"]/g)]
          .map(match => html.slice(match.index, match.index + 240)).slice(-3);
      }).catch(() => {});
      if (recent.length > 14) recent.shift();
    }
  });
  page.on('request', request => {
    if (request.method() === 'POST') {
      requestEvents.push({ ms: Date.now() - startedAt,
        path: new URL(request.url()).pathname, event: 'sent' });
      if (requestEvents.length > 24) requestEvents.shift();
    }
  });
  page.on('requestfailed', request => {
    requestEvents.push({ ms: Date.now() - startedAt,
      path: new URL(request.url()).pathname, event: 'failed', reason: request.failure()?.errorText,
      redirectTo: request.redirectedTo() ?
        new URL(request.redirectedTo().url()).pathname : undefined });
    if (requestEvents.length > 24) requestEvents.shift();
  });
  for (const old of context.pages()) if (old !== page) await old.close();
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
    if (new URL(page.url()).hostname !== 'apps-sbx.avpaas.io')
      throw new Error('SCA probe must run on the sandbox');
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    stage = 'reseller profile';
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
    stage = 'service providers list';
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Test_SP")').click();
    stage = 'service provider entry';
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
    stage = 'groups list';
    await waitPath(page, '/commpilot/ServiceProvider/Members/');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Stan Mikita Donuts")').click();
    stage = 'group entry';
    await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
    if (['inspect-profiles', 'inspect-profile-edit', 'delete-one-profile', 'cleanup-profiles'].includes(process.env.BW_SCAP_MODE)) {
      await page.locator('a.leftnavfolder, a.leftnavfolderopen')
        .filter({ hasText: /^\s*Resources\s*$/ }).click();
      await page.waitForFunction(() => document.title.trim() === 'Resources', null, { timeout: 25000 });
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Identity/Device Profiles")').click();
      await waitPath(page, '/commpilot/Group/DeviceInventory/');
      if (await page.locator('#search0').count()) await page.locator('#search0').click();
      await page.locator('td[width="82%"] input[name="findValue0"]:visible').fill('PJAX SCAP Test');
      await page.locator('td[width="82%"] input[name="search"]:visible').click();
      await page.waitForFunction(() => document.querySelector('td[width="82%"]')?.innerText
        .includes('PJAX SCAP Test'), null, { timeout: 15000 }).catch(() => {});
      const details = await page.evaluate(() => ({ path: location.pathname,
        rows: [...document.querySelectorAll('td[width="82%"] tr')]
          .filter(row => row.innerText.includes('PJAX SCAP Test'))
          .map(row => ({ text: row.innerText.trim().slice(0, 250),
            links: [...row.querySelectorAll('a')].map(link => ({ text: link.textContent.trim(),
              id: link.id, href: link.getAttribute('href') })),
            controls: [...row.querySelectorAll('input')]
              .map(input => ({ name: input.name, type: input.type, value: input.value })) })),
        searchControls: [...document.querySelectorAll('td[width="82%"] input, td[width="82%"] select')]
          .filter(item => item.getClientRects().length && /search|find|rownum/i.test(item.name || item.id || ''))
          .map(item => ({ name: item.name, type: item.type, value: item.value,
            options: item.tagName === 'SELECT' ? [...item.options].map(option => option.textContent.trim()) : undefined })),
        buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]')]
          .map(input => ({ name: input.name, value: input.value })) }));
      console.log(JSON.stringify({ event: 'device-profile-inventory', details }));
      if (['inspect-profile-edit', 'delete-one-profile'].includes(process.env.BW_SCAP_MODE)) {
        const targetProfile = process.env.BW_SCAP_PROFILE_NAME || 'PJAX SCAP Test ufkf7hh';
        if (!/^PJAX SCAP Test [a-z0-9]{7}$/.test(targetProfile))
          throw new Error('Refusing to open a profile outside this probe’s test names');
        await page.locator('td[width="82%"] tr')
          .filter({ hasText: targetProfile }).last()
          .locator('a:text-is("Edit")').click();
        await page.waitForFunction(() => location.pathname !== '/commpilot/Group/DeviceInventory/' &&
          !!document.querySelector('td[width="82%"]'), null, { timeout: 15000 });
        const edit = await page.evaluate(() => ({ path: location.pathname,
          text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 700),
          buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]')]
            .map(input => ({ name: input.name, value: input.value })) }));
        console.log(JSON.stringify({ event: 'device-profile-edit', edit }));
        if (process.env.BW_SCAP_MODE === 'delete-one-profile') {
          if (!edit.text.includes('Assigned Lines/Ports:\t0') ||
              !edit.text.includes(targetProfile))
            throw new Error('Test profile still has assigned ports or the wrong profile opened');
          page.on('dialog', dialog => dialog.accept());
          await page.locator('td[width="82%"] input[name="delete"]:visible').first()
            .click({ noWaitAfter: true });
          await page.waitForFunction(() => location.pathname === '/commpilot/Group/DeviceInventory/' ||
            !!document.querySelector('td[width="82%"]')?.innerText.includes('Deleted'),
          null, { timeout: 15000 }).catch(() => {});
          console.log(JSON.stringify({ event: 'device-profile-delete',
            after: await page.evaluate(() => ({ path: location.pathname,
              text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 400) })) }));
        }
      }
      return;
    }
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Users")').click();
    stage = 'users list';
    await waitPath(page, '/commpilot/Group/Members/');
    await page.locator('#search0').click();
    await page.waitForTimeout(1200);
    await page.locator('a:text-is("SMDonuts21")').click();
    stage = 'user entry';
    await waitPath(page, '/commpilot/Group/Members/Modify/index.jsp');
    if (process.env.BW_SCAP_MODE === 'entry-check') {
      console.log(JSON.stringify({ event: 'user-entry-check', status: 'pass',
        ms: Date.now() - startedAt, path: new URL(page.url()).pathname,
        posts: recent.map(item => ({ path: item.path, status: item.status,
          requestTokenId: item.requestTokenId, responseTokenId: item.responseTokenId })) }));
      return;
    }
    await page.locator('a.leftnavfolder, a.leftnavfolderopen')
      .filter({ hasText: /^\s*Call Control\s*$/ }).click();
    stage = 'call control folder';
    await page.waitForFunction(() => document.title.trim() === 'Call Control',
      null, { timeout: 25000 });
    await page.locator('td[width="82%"] a.navMenuItem')
      .filter({ hasText: /^\s*Shared Call Appearance\s*$/ }).click();
    stage = 'shared call appearance list';
    await waitPath(page, '/commpilot/User/SCAP/');
    const list = await page.evaluate(() => ({
      path: location.pathname,
      rows: document.querySelectorAll('td[width="82%"] a[id^="Row"]').length,
      buttons: [...document.querySelectorAll('td[width="82%"] input[type="button"], td[width="82%"] button')]
        .filter(item => item.getClientRects().length)
        .map(item => ({ name: item.name || '', label: (item.value || item.textContent || '').trim() }))
        .filter(item => /^(?:add|search|find|delete|apply|ok)$/i.test(item.label)).slice(0, 12)
    }));
    if (process.env.BW_SCAP_MODE === 'navigate') {
      await page.evaluate(() => { window.__bwScapMarker = Date.now(); });
      await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
      await waitPath(page, '/commpilot/User/SCAP/Add/index.jsp');
      console.log(JSON.stringify({ event: 'scap-add-navigation', path: new URL(page.url()).pathname,
        sameDocument: await page.evaluate(() => !!window.__bwScapMarker), recent }));
      return;
    }
    if (['cleanup-inspect', 'cleanup'].includes(process.env.BW_SCAP_MODE)) {
      if (process.env.BW_SCAP_MODE === 'cleanup') {
        const before = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] input[type="checkbox"]')]
          .filter(input => input.name.includes('pjaxscatest')).map(input => input.name));
        if (!before.length || before.length > 20)
          throw new Error(`Expected 1–20 named test appearances, found ${before.length}`);
        await page.locator('td[width="82%"] input[type="checkbox"][name*="pjaxscatest"]')
          .evaluateAll(inputs => inputs.forEach(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }));
        page.on('dialog', dialog => dialog.accept());
        const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/commpilot/User/SCAP/', { timeout: 20000 }).catch(() => null);
        await page.locator('td[width="82%"] input[name="apply"]:visible').first().click({ noWaitAfter: true });
        const response = await responsePromise;
        await page.waitForFunction(() => !document.querySelector('td[width="82%"] input[type="checkbox"][name*="pjaxscatest"]'),
          null, { timeout: 15000 }).catch(() => {});
        const after = await page.evaluate(() => ({ path: location.pathname,
          remaining: [...document.querySelectorAll('td[width="82%"] input[type="checkbox"][name*="pjaxscatest"]')]
            .map(input => input.name), content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 700) }));
        console.log(JSON.stringify({ event: 'cleanup', selected: before.length,
          response: response?.status() || null, after }));
        return;
      }
      const rows = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] tr')]
        .filter(row => row.innerText.includes('pjaxscatest'))
        .map(row => ({ text: row.innerText.trim().slice(0, 220),
          inputs: [...row.querySelectorAll('input')].map(input => input.outerHTML.slice(0, 300)) })));
      const buttons = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] input, td[width="82%"] button, td[width="82%"] a')]
        .filter(input => /delete/i.test(input.value || input.textContent || ''))
        .map(input => input.outerHTML.slice(0, 300)));
      const deleteContext = await page.evaluate(() => {
        const html = document.querySelector('td[width="82%"]')?.innerHTML || '';
        const at = html.indexOf('Delete'); return at < 0 ? '' : html.slice(Math.max(0, at - 240), at + 360);
      });
      const allControls = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] input, td[width="82%"] button')]
        .filter(input => input.type !== 'hidden' && !/^(?:checkbox_|hiddenCheckbox_)/.test(input.name || ''))
        .map(input => ({ name: input.name, type: input.type, value: input.value, id: input.id })).slice(0, 70));
      console.log(JSON.stringify({ event: 'cleanup-inspect', list, rows: rows.slice(1), buttons, deleteContext, allControls }));
      return;
    }
    await page.evaluate(() => window.redirectPost('/commpilot/User/SCAP/Add/index.jsp', {}));
    stage = 'shared call appearance add';
    await waitPath(page, '/commpilot/User/SCAP/Add/index.jsp');
    if (process.env.BW_SCAP_MODE === 'inspect-types') {
      const groups = await page.evaluate(() => {
        const device = document.querySelector('form[name="mainForm"] select[name="deviceName"]');
        const type = document.querySelector('form[name="mainForm"] select[name="newDeviceType"]');
        device.value = 'New Device'; device.dispatchEvent(new Event('change', { bubbles: true }));
        const grouped = new Map();
        for (let i = 0; i < type.options.length; i++) {
          type.selectedIndex = i; type.dispatchEvent(new Event('change', { bubbles: true }));
          const visible = [...document.querySelectorAll('form[name="mainForm"] input[type="text"]')]
            .filter(input => input.getClientRects().length).map(input => input.name).sort();
          const key = visible.join(',');
          if (!grouped.has(key)) grouped.set(key, { fields: visible, types: [] });
          grouped.get(key).types.push(type.options[i].textContent.trim());
        }
        return [...grouped.values()].map(item => ({ fields: item.fields,
          count: item.types.length, examples: item.types.slice(0, 15) }));
      });
      console.log(JSON.stringify({ event: 'scap-type-field-groups', groups,
        recent: process.env.BW_SCAP_DEBUG === '1' ? recent.slice(-5) : undefined }));
      return;
    }
    if (process.env.BW_SCAP_MODE === 'inspect-new') {
      await page.locator('form[name="mainForm"] select[name="deviceName"]')
        .selectOption({ index: 5 });
      const matchingTypes = await page.locator('form[name="mainForm"] select[name="newDeviceType"]')
        .evaluate(select => [...select.options].map(option => ({ text: option.textContent.trim(), value: option.value }))
          .filter(option => /VVX.?400|VVX.?410/i.test(option.text)));
      if (matchingTypes.length && process.env.BW_SCAP_SELECT_VVX === '1')
        await page.locator('form[name="mainForm"] select[name="newDeviceType"]')
          .selectOption(matchingTypes[0].value);
      const controls = await page.locator('form[name="mainForm"] input, form[name="mainForm"] select')
        .evaluateAll(elements => elements.filter(item => item.getClientRects().length)
          .map(item => ({ name: item.name, type: item.type, required: item.required || false,
            options: item.tagName === 'SELECT' ? [...item.options].slice(0, 8)
              .map(option => option.textContent.trim()) : undefined })));
      const screenshot = path.join(process.env.TEMP, 'bw-scap-new-device-sandbox.png');
      await page.locator('td[width="82%"]').screenshot({ path: screenshot });
      console.log(JSON.stringify({ event: 'scap-new-device-inspect', matchingTypes, controls, screenshot }));
      return;
    }
    const form = await page.evaluate(() => ({
      path: location.pathname,
      deviceOptions: [...(document.querySelector('select[name="deviceName"]')?.options || [])]
        .map(option => ({ label: option.textContent.trim(), value: option.value })),
      forms: [...document.querySelectorAll('td[width="82%"] form')].map(form => ({
        name: form.getAttribute('name') || '', action: form.getAttribute('action') || '',
        method: form.getAttribute('method') || '', enctype: form.getAttribute('enctype') || '',
        controls: [...form.querySelectorAll('input, select, textarea, button')]
          .filter(item => item.name && item.type !== 'hidden' && item.type !== 'password')
          .map(item => ({ name: item.name, type: item.type || item.tagName,
            required: item.required || false,
            options: item.tagName === 'SELECT' ? item.options.length : undefined,
            selectedIndex: item.tagName === 'SELECT' ? item.selectedIndex : undefined,
            label: item.type === 'submit' || item.type === 'button' ? item.value : undefined }))
      }))
    }));
    const screenshot = path.join(process.env.TEMP, 'bw-scap-add-sandbox.png');
    await page.locator('td[width="82%"]').screenshot({ path: screenshot });
    if (!['blank', 'create', 'create-new', 'create-new-repeat'].includes(process.env.BW_SCAP_MODE)) {
      const visibleInputs = await page.locator('form[name="mainForm"] input').evaluateAll(inputs =>
        inputs.filter(input => input.type === 'text' && input.getClientRects().length)
          .map(input => ({ name: input.name, value: input.value,
            rect: { x: input.getBoundingClientRect().x, y: input.getBoundingClientRect().y },
            context: input.parentElement?.parentElement?.textContent?.trim().slice(0, 160) })));
      console.log(JSON.stringify({ event: 'scap-add-inspect', list, form, visibleInputs, screenshot }));
      return;
    }
    const dialogs = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message().slice(0, 220)); dialog.accept(); });
    await page.evaluate(() => {
      window.__bwScapMarker = Date.now();
      window.__bwScapReskins = 0;
      document.addEventListener('cp:reskin', () => { window.__bwScapReskins++; });
    });
    const testLinePort = ['create', 'create-new', 'create-new-repeat'].includes(process.env.BW_SCAP_MODE) ?
      `pjaxscatest${Date.now().toString(36).slice(-7)}` : '';
    const testProfileName = ['create-new', 'create-new-repeat'].includes(process.env.BW_SCAP_MODE) ?
      `PJAX SCAP Test ${testLinePort.slice(-7)}` : '';
    if (testLinePort) {
      if (testProfileName) {
        await page.locator('form[name="mainForm"] select[name="deviceName"]')
          .selectOption('New Device');
        await page.locator('form[name="mainForm"] select[name="newDeviceType"]')
          .selectOption(process.env.BW_SCAP_NEW_TYPE_INDEX != null ?
            { index: Number(process.env.BW_SCAP_NEW_TYPE_INDEX) } : 'TF_SBX_Polycom_VVX400');
        await page.locator('form[name="mainForm"] input[name="newDeviceName"]:visible')
          .fill(testProfileName);
      } else if (process.env.BW_SCAP_DEVICE_INDEX)
        await page.locator('form[name="mainForm"] select[name="deviceName"]')
          .selectOption({ index: Number(process.env.BW_SCAP_DEVICE_INDEX) });
      const portFields = await page.locator('form[name="mainForm"] input').evaluateAll(inputs =>
        inputs.filter(input => input.type === 'text' || /lineport/i.test(input.name)).map(input => ({
          name: input.name, type: input.type, visible: !!input.getClientRects().length,
          outer: input.outerHTML.slice(0, 300) })));
      console.log(JSON.stringify({ event: 'port-fields', portFields }));
      await page.locator('form[name="mainForm"] input[name="deviceLinePort"]:visible, form[name="mainForm"] input[name="deviceLinePortDomain"]:visible')
        .fill(testLinePort);
    }
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/commpilot/User/SCAP/Add/index.jsp',
    { timeout: 20000 }).catch(() => null);
    await page.locator('form[name="mainForm"] input[name="ok"]:visible').first()
      .click({ noWaitAfter: true });
    const response = await responsePromise;
    if (response?.status() === 200) await page.waitForFunction(() =>
      (window.__bwScapReskins || 0) > 0 || location.pathname === '/commpilot/Login/',
    null, { timeout: 15000 }).catch(() => {});
    const after = await page.evaluate(() => ({ path: location.pathname,
      title: document.title.trim(), sameDocument: !!window.__bwScapMarker,
      reskins: window.__bwScapReskins || 0,
      content: document.querySelector('td[width="82%"]')?.innerText?.trim().slice(0, 1000),
      listShape: { searchTable: !!document.querySelector('#searchTable'),
        findKey: !!document.querySelector('select[name="findKey0"]'),
        findValue: !!document.querySelector('input[name="findValue0"]'),
        add: [...document.querySelectorAll('input[name="add"]')].map(el => el.outerHTML.slice(0, 300)),
        rows: document.querySelectorAll('td[width="82%"] a[id^="Row"]').length },
      errors: [...document.querySelectorAll('.error, .errorMsg, .cp-alert-error')]
        .map(item => (item.textContent || '').trim().slice(0, 220)).filter(Boolean).slice(0, 3) }));
    console.log(JSON.stringify({ event: process.env.BW_SCAP_MODE === 'blank' ? 'scap-blank-submit' : 'scap-create-submit',
      testLinePort, testProfileName, response: response?.status() || null,
      fieldsSent: response ? [...new Set(new URLSearchParams(response.request().postData() || '').keys())] : [],
      relevantValues: response ? Object.fromEntries([...new URLSearchParams(response.request().postData() || '')]
        .filter(([key]) => /(?:lineport|devicename|buttonclicked|\bok\b)/i.test(key))) : {},
      dialogs, after }));
    if (process.env.BW_SCAP_MODE === 'create-new-repeat') {
      if (after.path !== '/commpilot/User/SCAP/' || !after.content?.includes(testLinePort))
        throw new Error('First new profile did not appear in the SCA list');
      await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
      await waitPath(page, '/commpilot/User/SCAP/Add/index.jsp');
      const secondPort = `pjaxscatest${Date.now().toString(36).slice(-7)}`;
      const secondProfile = `PJAX SCAP Test ${secondPort.slice(-7)}`;
      await page.locator('form[name="mainForm"] select[name="deviceName"]').selectOption('New Device');
      await page.locator('form[name="mainForm"] select[name="newDeviceType"]')
        .selectOption('TF_SBX_Polycom_VVX400');
      await page.locator('form[name="mainForm"] input[name="newDeviceName"]:visible')
        .fill(secondProfile);
      await page.locator('form[name="mainForm"] input[name="deviceLinePortDomain"]:visible')
        .fill(secondPort);
      const secondResponsePromise = page.waitForResponse(item => item.request().method() === 'POST' &&
        new URL(item.url()).pathname === '/commpilot/User/SCAP/Add/index.jsp', { timeout: 20000 });
      const startReskins = await page.evaluate(() => window.__bwScapReskins || 0);
      await page.locator('form[name="mainForm"] input[name="ok"]:visible').first()
        .click({ noWaitAfter: true });
      const secondResponse = await secondResponsePromise;
      await page.waitForFunction(start => (window.__bwScapReskins || 0) > start,
        startReskins, { timeout: 15000 });
      const secondAfter = await page.evaluate(() => ({ path: location.pathname,
        sameDocument: !!window.__bwScapMarker,
        text: document.querySelector('td[width="82%"]')?.innerText || '' }));
      console.log(JSON.stringify({ event: 'scap-new-profile-repeat', secondPort, secondProfile,
        response: secondResponse.status(), path: secondAfter.path,
        sameDocument: secondAfter.sameDocument,
        bothListed: secondAfter.text.includes(testLinePort) && secondAfter.text.includes(secondPort) }));
    }
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', stage, error: error.message,
  recent: process.env.BW_SCAP_CONCISE === '1' ? recent.slice(-4) : recent,
  requestEvents: process.env.BW_SCAP_CONCISE === '1' ? requestEvents.slice(-6) : requestEvents,
  pjaxMessages: process.env.BW_SCAP_CONCISE === '1' ? pjaxMessages.slice(-8) : pjaxMessages.slice(-35) }));
  process.exitCode = 1; });
