// Headless, sandbox-only final-action probe. Defaults to Group Assign Numbers Add.
const { chromium } = require('playwright-core');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) throw new Error('Set BW_LIVE_PROFILE to the saved sandbox Edge profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const target = process.argv[2] || 'group-number-add';
const waitPath = (page, expected) => page.waitForFunction(pathname =>
  location.pathname === pathname && !!document.querySelector('td[width="82%"]'),
expected, { timeout: 25000 });
const state = page => page.evaluate(() => ({
  path: location.pathname, title: document.title.trim(),
  body: (document.querySelector('td[width="82%"]')?.innerText || '').slice(0, 1600),
  buttons: [...document.querySelectorAll('td[width="82%"] button, td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]')]
    .filter(x => x.getClientRects().length).map(x => ({ label: (x.innerText || x.value || '').trim(),
      id: x.id, name: x.name, type: x.type, onclick: x.getAttribute('onclick')?.slice(0, 200) })),
  forms: [...document.querySelectorAll('td[width="82%"] form')].map(f => ({
    name: f.name, action: f.getAttribute('action'), method: f.method,
    onsubmit:f.getAttribute('onsubmit'),
    special:[...f.querySelectorAll('input[type="hidden"]')].filter(x =>
      /^(buttonClicked|action|toAdd|toRemove)$/.test(x.name)).map(x => ({name:x.name,value:x.value})),
    fields: [...f.elements].filter(x => x.name && x.type !== 'hidden').slice(0, 30)
      .map(x => ({name:x.name,type:x.type,value:x.value?.slice(0,80),
        optionCount:x.tagName === 'SELECT' ? x.options.length : undefined,
        options:x.tagName === 'SELECT' ? [...x.options].slice(0,8).map(o =>
          ({text:o.textContent.trim().slice(0,65),value:o.value,selected:o.selected})) : undefined})) })),
  script: [...document.querySelectorAll('td[width="82%"] script')]
    .map(s => s.textContent || '').filter(s => /buttonClicked|PICKLIST_addNumbers|addEventListener\(.?click/.test(s))
    .map(s => s.slice(0,2200)).slice(0,5)
}));

(async () => {
  const context = await chromium.launchPersistentContext(profile, { executablePath: edge,
    headless: true, viewport: null,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const page = await context.newPage();
  for (const old of context.pages()) if (old !== page) await old.close();
  page.on('framenavigated', frame => { if (frame === page.mainFrame())
    console.log(JSON.stringify({ event: 'main-frame', url: frame.url() })); });
  page.on('pageerror', error => console.log(JSON.stringify({event:'page-error',message:error.message.slice(0,350)})));
  page.on('console', message => { if (message.type() === 'warning' && /\[pjax\]/.test(message.text()))
    console.log(JSON.stringify({event:'pjax-warning',message:message.text().slice(0,350)})); });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname === 'apps-sbx.avpaas.io' && response.request().method() === 'POST') {
      const post = {event:'post',path:url.pathname,status:response.status()};
      if (/DnManagement\/Add/.test(url.pathname)) {
        const body = new URLSearchParams(response.request().postData() || '');
        body.delete('formtokenserial');
        post.params = [...body.entries()].slice(0,30);
      }
      console.log(JSON.stringify(post));
    }
  });
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', {waitUntil:'commit'});
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, {timeout:30000});
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Test_SP")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
    if (target.startsWith('sp-number-')) {
      await page.locator('a.leftnavfolder, a.leftnavfolderopen').filter({hasText:/^\s*Resources\s*$/}).click();
      await page.waitForFunction(() => document.title.trim() === 'Resources',null,{timeout:25000});
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Numbers")').click();
      await waitPath(page,'/commpilot/ServiceProvider/DnManagement/');
    } else {
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
      await waitPath(page,'/commpilot/ServiceProvider/Members/');
      await page.locator('#search0').click();
      await page.locator('a:text-is("Stan Mikita Donuts")').click();
      await waitPath(page,'/commpilot/ServiceProvider/Members/Modify/index.jsp');
      await page.locator('a.leftnavfolder, a.leftnavfolderopen').filter({hasText:/^\s*Resources\s*$/}).click();
      await page.waitForFunction(() => document.title.trim() === 'Resources',null,{timeout:25000});
      const activation = target.startsWith('group-activation');
      await page.locator(`td[width="82%"] a.navMenuItem:text-is("${activation ? 'Activate Numbers' : 'Assign Numbers'}")`).click();
      await waitPath(page,activation ? '/commpilot/Group/DnActivation/' : '/commpilot/Group/DnManagement/');
    }
    console.log(JSON.stringify({event:'list',state:await state(page)}));
    if (target.startsWith('group-number-delete') || target.startsWith('sp-number-delete')) {
      const rows = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
        .filter(row => /224483099[89]/.test(row.innerText)).map(row => ({
          text:row.innerText.trim(),id:row.id,
          checkboxes:[...row.querySelectorAll('input[type="checkbox"]')].map(input =>
            ({name:input.name,value:input.value,checked:input.checked})) })));
      console.log(JSON.stringify({event:'fixture-rows',rows}));
      if (target.endsWith('delete-apply')) {
        if (rows.length !== 1 || !/^\+1-2244830998 - \+1-2244830999\b/.test(rows[0].text) ||
            rows[0].checkboxes.length !== 1) throw new Error('Fixture range is not the expected sole row');
        page.on('dialog', dialog => dialog.accept());
        await page.locator(`#${rows[0].id} input[type="checkbox"]`).check();
        await page.locator('td[width="82%"] input[name="apply"]').first().click();
        await page.waitForTimeout(1400);
        console.log(JSON.stringify({event:'fixture-delete',state:await state(page)}));
        const after = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] tr[id^="Row"]')]
          .filter(row => /224483099[89]/.test(row.innerText)).map(row => row.innerText.trim()));
        console.log(JSON.stringify({event:'fixture-delete-readback',rows:after}));
      }
      return;
    }
    if (target.startsWith('group-activation')) {
      console.log(JSON.stringify({event:'activation-list',row:await page.evaluate(() => {
        const row = [...document.querySelectorAll('td[width="82%"] tr')]
          .filter(x => x.innerText.includes('2244830998')).sort((a,b) =>
            a.innerText.length-b.innerText.length)[0];
        return row?.outerHTML.slice(0,1800) || null;
      })}));
      const row = page.locator('tr[id^="Row"]').filter({hasText:'2244830998'}).first();
      await row.locator('a:text-is("Edit")').click();
      await waitPath(page,'/commpilot/Group/DnActivation/Modify/index.jsp');
      console.log(JSON.stringify({event:'activation-modify',state:await state(page)}));
      if (['group-activation-save', 'group-activation-deactivate', 'group-activation-ok-only'].includes(target)) {
        if (target === 'group-activation-save') {
          await page.locator('#PICKLIST_selectAllNumber').click();
          await page.waitForTimeout(900);
          console.log(JSON.stringify({event:'activation-staged',state:await state(page)}));
        }
        if (target === 'group-activation-deactivate') {
          await page.locator('#PICKLIST_removeAllNumber').click();
          await page.waitForTimeout(900);
          console.log(JSON.stringify({event:'activation-staged',state:await state(page)}));
        }
        await page.locator('td[width="82%"] input[value="OK"]').first().click();
        await page.waitForTimeout(1500);
        console.log(JSON.stringify({event:'activation-save',state:await state(page)}));
        if (new URL(page.url()).pathname === '/commpilot/Group/DnActivation/') {
          console.log(JSON.stringify({event:'activation-readback',row:await page.evaluate(() => {
            const row = [...document.querySelectorAll('tr[id^="Row"]')]
              .find(x => x.innerText.includes('2244830998'));
            return {text:row?.innerText || '',html:row?.outerHTML.slice(0,2200) || ''};
          })}));
        }
      }
      return;
    }
    if (target === 'sp-number-create') {
      const dn = process.env.BW_TEST_DN;
      if (!/^\+1-\d{10}$/.test(dn || '')) throw new Error('Set BW_TEST_DN to +1-XXXXXXXXXX');
      const before = await page.evaluate(value => window.cpListSearch([
        {key:'Dn',op:'EQUAL_TO',value}],{}),dn);
      console.log(JSON.stringify({event:'preflight',dn,rows:before.rows?.length,
        matches:before.rows?.map(row => row.cells?.join(' ') || JSON.stringify(row)).slice(0,4),
        tooMany:before.tooMany || false}));
      if (before.rows?.length) throw new Error('Fixture DN already exists in SP');
    }
    await page.locator('td[width="82%"] input[value="Add"], td[width="82%"] button:text-is("Add")').first().click();
    await waitPath(page,target.startsWith('sp-number-') ?
      '/commpilot/ServiceProvider/DnManagement/Add/index.jsp' : '/commpilot/Group/DnManagement/Add/index.jsp');
    console.log(JSON.stringify({event:'add',state:await state(page)}));
    if (target === 'group-number-assign') {
      const dn = process.env.BW_TEST_DN;
      if (!/^\+1-\d{10}$/.test(dn || '')) throw new Error('Set BW_TEST_DN to +1-XXXXXXXXXX');
      await page.locator('select[name="firstList"]').selectOption(dn);
      await page.locator('#PICKLIST_addFirstNumbers').click();
      await page.waitForTimeout(900);
      console.log(JSON.stringify({event:'picked',state:await state(page)}));
      await page.locator('select[name="assignedList"]').selectOption(dn);
      await page.locator('#PICKLIST_addNumbers').click();
      await page.waitForTimeout(900);
      console.log(JSON.stringify({event:'staged',state:await state(page)}));
      if (process.env.BW_FORCE_BUTTON_CLICKED === '1')
        console.log(JSON.stringify({event:'force-button',result:await page.evaluate(() => {
          const inputs = [...document.querySelectorAll('form[name="mainForm"] input[name="buttonClicked"]')];
          const before = inputs.map(input => input.value);
          inputs.forEach(input => {input.value = 'ok';});
          return {before,after:inputs.map(input => input.value)};
        })}));
      await page.locator('td[width="82%"] input[value="OK"]').first().click();
      await page.waitForTimeout(1500);
      console.log(JSON.stringify({event:'assign',state:await state(page)}));
      if (new URL(page.url()).pathname === '/commpilot/Group/DnManagement/') {
        const after = await page.evaluate(value => window.cpListSearch([
          {key:'Dn',op:'EQUAL_TO',value}],{}),dn);
        console.log(JSON.stringify({event:'group-readback',dn,rows:after.rows?.length,
          matches:after.rows?.map(row => row.cells?.join(' ') || JSON.stringify(row)).slice(0,4)}));
      }
      return;
    }
    if (target === 'sp-number-create') {
      const dn = process.env.BW_TEST_DN;
      await page.locator('td[width="82%"] input[name="dn1"]').fill(dn);
      await page.locator('td[width="82%"] input[value="OK"]').first().click();
      await page.waitForTimeout(1800);
      console.log(JSON.stringify({event:'create',state:await state(page)}));
      if (new URL(page.url()).pathname === '/commpilot/ServiceProvider/DnManagement/') {
        const after = await page.evaluate(value => window.cpListSearch([
          {key:'Dn',op:'EQUAL_TO',value}],{}),dn);
        console.log(JSON.stringify({event:'readback',dn,rows:after.rows?.length,
          matches:after.rows?.map(row => row.cells?.join(' ') || JSON.stringify(row)).slice(0,4),
          tooMany:after.tooMany || false}));
      }
      return;
    }
    if (process.env.BW_DEEP_EMPTY_SUBMIT === '1') {
      await page.locator('td[width="82%"] input[value="OK"], td[width="82%"] button:text-is("OK")').first().click();
      await page.waitForTimeout(1500);
      console.log(JSON.stringify({event:'empty-submit',state:await state(page)}));
    }
    const cancel = page.locator('td[width="82%"] input[value="Cancel"], td[width="82%"] button:text-is("Cancel")').first();
    if (await cancel.count()) {
      await cancel.click();
      await page.waitForTimeout(800);
      console.log(JSON.stringify({event:'cancel',state:await state(page)}));
    }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
