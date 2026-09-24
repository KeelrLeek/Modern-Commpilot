// Inspect and later verify Shared Call Appearance Add on the saved sandbox user.
const { chromium } = require('playwright-core');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) throw new Error('Set BW_LIVE_PROFILE to the saved sandbox test profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let stage = 'launch';
const recent = [];
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
  const page = await context.newPage();
  page.on('response', response => {
    if (response.request().method() === 'POST') {
      const item = { path: new URL(response.url()).pathname, status: response.status() };
      recent.push(item);
      if (item.path === '/commpilot/User/index.jsp') response.text().then(html => {
        item.hasContent = html.includes('width="82%"');
        item.hasLogin = /Please login again|not authorized to access the system/i.test(html);
        item.stub = /redirectPost\s*\(\s*['"]([^'"]+)/.exec(html)?.[1] || '';
        const at = html.indexOf('redirectPost(');
        item.stubContext = at < 0 ? '' : html.slice(at, at + 350);
      }).catch(() => {});
      if (recent.length > 14) recent.shift();
    }
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
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Users")').click();
    stage = 'users list';
    await waitPath(page, '/commpilot/Group/Members/');
    await page.locator('#search0').click();
    await page.waitForTimeout(1200);
    await page.locator('a:text-is("SMDonuts21")').click();
    stage = 'user entry';
    await waitPath(page, '/commpilot/Group/Members/Modify/index.jsp');
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
    const form = await page.evaluate(() => ({
      path: location.pathname,
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
    if (!['blank', 'create'].includes(process.env.BW_SCAP_MODE)) {
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
    const testLinePort = process.env.BW_SCAP_MODE === 'create' ?
      `pjaxscatest${Date.now().toString(36).slice(-7)}` : '';
    if (testLinePort) {
      const portFields = await page.locator('form[name="mainForm"] input').evaluateAll(inputs =>
        inputs.filter(input => input.type === 'text' || /lineport/i.test(input.name)).map(input => ({
          name: input.name, type: input.type, visible: !!input.getClientRects().length,
          outer: input.outerHTML.slice(0, 300) })));
      console.log(JSON.stringify({ event: 'port-fields', portFields }));
      await page.locator('form[name="mainForm"] input[name="deviceLinePortDomain"]:visible').fill(testLinePort);
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
    console.log(JSON.stringify({ event: process.env.BW_SCAP_MODE === 'create' ? 'scap-create-submit' : 'scap-blank-submit',
      testLinePort, response: response?.status() || null,
      fieldsSent: response ? [...new Set(new URLSearchParams(response.request().postData() || '').keys())] : [],
      relevantValues: response ? Object.fromEntries([...new URLSearchParams(response.request().postData() || '')]
        .filter(([key]) => /(?:lineport|devicename|buttonclicked|\bok\b)/i.test(key))) : {},
      dialogs, after }));
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', stage, error: error.message, recent }));
  process.exitCode = 1; });
