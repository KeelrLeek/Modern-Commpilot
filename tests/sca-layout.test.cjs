const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const extension = path.resolve(process.env.BW_TEST_EXTENSION_PATH || root);
const origin = 'https://apps-sbx.avpaas.io';
const scaPath = '/commpilot/User/SCAP/';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const labels = ['Alert all appearances for Click-to-Dial calls', 'Alert all appearances for Group Paging calls',
  'Allow Call Retrieve from another location', 'Allow bridging between locations', 'Enable Call Park notification'];
const initialDevices = [
  {id:'pc',type:'Business Communicator - PC',name:'AZ WXPC 4647 (Group)',line:'224254647_Wxpc@phonenetwork.net'},
  {id:'mobile',type:'Connect - Mobile',name:'AZ UC1mob 4647 (Group)',line:'224254647_UCmob@phonenetwork.net'}
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fixture({devices = initialDevices, flags = [], tone = 'none', arrangement = 'true', query = '', pages = 1, title = 'Shared Call Appearance', extra = '', legacy = false} = {}) {
  const rows = devices.filter(d => !query || d.name.toLowerCase().includes(query.toLowerCase()));
  const findRow = legacy ? `<td><select name="findKey"><option value="name">Identity/Device Profile Name</option><option value="type">Identity/Device Profile Type</option></select></td>
    <td><select name="findOp"><option value="CONTAINS">Contains</option><option value="STARTS_WITH">Starts With</option></select></td><td><input name="findValue" type="text" value="${escape(query)}"></td>
    <td><a id="findButton" class="headerLink" href="#" onclick="doFind();return false">Find</a></td><td><a id="findAllButton" class="headerLink" href="#" onclick="doFindAll();return false">Find All</a></td>` :
    `<td><select name="findKey0"><option value="name">Identity/Device Profile Name</option><option value="type">Identity/Device Profile Type</option></select></td>
    <td><select name="findOp0"><option value="CONTAINS">Contains</option><option value="STARTS_WITH">Starts With</option></select></td>
    <td><input name="findValue0" type="text" value="${escape(query)}"></td><td><input type="submit" name="findButton" value="Find"></td><td><input type="submit" name="findAllButton" value="Find All"></td>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel" data-cp-extension-state="done">PreviewUser</span></td></tr></table>
    <table height="100%"><tr><td width="18%"><form name="leftNavForm"><a class="leftnavfolderopen">Call Control</a></form></td><td width="82%" valign="top">
    <form name="mainForm" method="post" action="${scaPath}"><input type="hidden" name="formtokenserial" value="native-token">
    <table width="100%"><tr><td class="screenName">${title}</td></tr>${legacy ? '<tr><td class="tip">Manage the device profiles that share this user’s line.</td></tr>' : ''}<tr id="buttonbartop"><td class="buttonbar">
    <input type="submit" name="ok" value="OK"><input type="submit" name="apply" value="Apply">
    <input type="button" name="add" value="Add" onclick="redirectPost('/commpilot/User/SCAP/Add/index.jsp',{})"><input type="button" name="cancel" value="Cancel" onclick="window.nativeCancel=true">
    </td></tr><tr><td class="enduserbody"><table class="enduserbody"><tr><td width="20"></td><td width="100%">
    <table><tbody>${labels.map((label,i) => `<tr><td></td><td><input type="checkbox" id="option${i}" name="option${i}" value="true"${flags.includes(i) ? ' checked' : ''}> ${label}</td></tr>`).join('')}
    <tr><td>Multiple Call Arrangement:</td><td><input type="radio" id="arrangementOn" name="multipleCallArrangement" value="true"${arrangement === 'true' ? ' checked' : ''}> On <input type="radio" id="arrangementOff" name="multipleCallArrangement" value="false"${arrangement === 'false' ? ' checked' : ''}> Off</td></tr>
    <tr><td>Bridge Warning tone</td><td><input type="radio" name="bridgeWarningTone" value="none"${tone === 'none' ? ' checked' : ''}> None</td></tr>
    <tr><td></td><td><input type="radio" name="bridgeWarningTone" value="barge"${tone === 'barge' ? ' checked' : ''}> Barge-in only</td></tr>
    <tr><td></td><td><input type="radio" name="bridgeWarningTone" value="repeat"${tone === 'repeat' ? ' checked' : ''}> Barge-in and repeat every 30 seconds</td></tr>
    <tr><td>Device Policies</td><td>— <a class="headerLink" id="policies" onclick="window.nativePolicies=(window.nativePolicies||0)+1;return false">Configure device policies</a></td></tr></tbody></table>
    ${extra}
    <table class="list" width="100%" id="native-results"><tbody><tr>${['Delete','Identity/Device Profile Type','Identity/Device Profile Name','Line/Port'].map((h,i) => `<td class="listHeader">${i === 1 ? `<a class="listSortHeader" href="#" onclick="return false">${h}</a>` : h}</td>`).join('')}</tr>
    ${rows.length ? rows.map((d,i) => `<tr id="Row${i}"><td><input type="checkbox" name="delete" value="${d.id}" aria-label="Delete ${escape(d.name)}"></td><td><a class="tableLink" href="#" onclick="window.nativeDetail='${d.id}';return false">${escape(d.type)}</a></td><td><a class="tableLink" href="#" onclick="window.nativeDetail='${d.id}';return false">${escape(d.name)}</a></td><td>${escape(d.line)}</td></tr>`).join('') : '<tr><td colspan="4">No Entries Present</td></tr>'}</tbody></table>
    <table id="native-pager"><tr><td>[ Page 1 of ${pages} ]</td></tr></table>
    <table id="native-find"><tr>${findRow}</tr></table>
    </td></tr></table></td></tr><tr id="buttonbarbottom"><td class="buttonbar"><input type="submit" name="apply" value="Apply"></td></tr></table></form></td></tr></table>
    <script>window.redirectPost=function(){};window.nativeInputs=Object.fromEntries([...document.querySelectorAll('input[id]')].map(e=>[e.id,e]));
    document.getElementById('option0').addEventListener('change',()=>window.nativeChanges=(window.nativeChanges||0)+1);
    function doFind(){const f=document.forms.mainForm;redirectPost('/commpilot/Common/find.jsp',{returnPage:'/User/SCAP/',tableName:'userScaTable',key:f.elements.findKey.value,op:f.elements.findOp.value,value:f.elements.findValue.value});}
    function doFindAll(){redirectPost('/commpilot/Common/findAll.jsp',{returnPage:'/User/SCAP/',tableName:'userScaTable'});}
    </script></body></html>`;
}

async function open(config = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'bw-sca-'));
  const context = await chromium.launchPersistentContext(temp,{executablePath:edge,headless:true,viewport:{width:1440,height:1050},
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({cpThemePalette:'rosepine-light',cpSettings:{peek:false}}));
    let saved = {devices:initialDevices.map(d => ({...d})),flags:[],tone:'none',...config};
    const posts = [];
    await context.route(origin + '/**', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.resourceType() === 'image') return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
      const data = new URLSearchParams(request.postData() || '');
      if (request.method() === 'POST') posts.push({pathname:url.pathname,fields:[...data]});
      if (config.pages > 1 && url.pathname === '/commpilot/Common/page.jsp')
        return route.fulfill({status:503,contentType:'text/plain',body:'Additional result pages unavailable'});
      if (data.has('apply') || data.has('ok')) saved = {...saved,flags:labels.map((_,i) => i).filter(i => data.has('option'+i)),
        tone:data.get('bridgeWarningTone'),arrangement:data.get('multipleCallArrangement'),devices:saved.devices.filter(d => !data.getAll('delete').includes(d.id))};
      return route.fulfill({status:200,contentType:'text/html',body:fixture({...saved,query:url.pathname.endsWith('/Common/find.jsp') ? data.get('value') : data.has('findButton') ? data.get('findValue0') : ''})});
    });
    const page = await context.newPage();
    await page.goto(origin + scaPath);
    await page.locator('.cp-frame-head').waitFor();
    return {page,posts,worker,close:async () => {await context.close();fs.rmSync(temp,{recursive:true,force:true});}};
  } catch(error) {await context.close();fs.rmSync(temp,{recursive:true,force:true});throw error;}
}

test('selected SCA B keeps native controls and submits settings, deletion, and Find correctly', async () => {
  const f = await open();
  try {
    const {page} = f;
    await page.locator('.cp-sca').waitFor();
    assert.equal(await page.locator('.cp-sca-options input[type="checkbox"]').count(),5);
    assert.equal(await page.evaluate(() => Object.entries(window.nativeInputs).every(([id,input]) => document.getElementById(id) === input)),true,'moves the original controls');
    assert.deepEqual(await page.locator('.cp-frame-actions input').evaluateAll(els => els.map(el => el.value)),['OK','Apply','Add','Cancel']);
    await page.locator('#option0').check();
    assert.equal(await page.evaluate(() => window.nativeChanges),1,'preserves listeners');
    await page.locator('[name="bridgeWarningTone"][value="repeat"]').check();
    await page.locator('#arrangementOff').check();
    await page.locator('#policies').click();
    assert.equal(await page.evaluate(() => window.nativePolicies),1);
    await page.locator('#Row0 input[type="checkbox"]').check();
    assert.equal(f.posts.filter(p => p.fields.some(([key]) => key === 'apply' || key === 'ok')).length,0,'checking Delete does not save');
    const response = page.waitForResponse(r => r.url().includes('/SCAP/') && r.request().method() === 'POST');
    await page.locator('.cp-frame-actions input[name="apply"]').click();
    await response;
    await page.waitForFunction(() => document.querySelector('.cp-sca-table')?.querySelectorAll('tr[id^="Row"]').length === 1);
    const apply = new URLSearchParams(f.posts.at(-1).fields);
    assert.equal(apply.get('option0'),'true');
    assert.equal(apply.get('bridgeWarningTone'),'repeat');
    assert.equal(apply.get('multipleCallArrangement'),'false');
    assert.deepEqual(apply.getAll('delete'),['pc']);
    assert.equal(apply.get('formtokenserial'),'native-token');
    await page.locator('.cp-sca-find [name="findValue0"]').fill('no-match');
    const found = page.waitForResponse(r => r.request().method() === 'POST');
    await page.locator('[name="findButton"]').click();
    await found;
    await page.locator('.fx-empty').waitFor();
    assert.equal(new URLSearchParams(f.posts.at(-1).fields).get('findValue0'),'no-match');
    assert.equal(await page.locator('.cp-sca').count(),1,'search response retains layout');
    const all = page.waitForResponse(r => r.request().method() === 'POST');
    await page.locator('[name="findAllButton"]').click();
    await all;
    await page.locator('.cp-sca-table tr[id^="Row"]').waitFor();
    assert.equal(await page.locator('#option0').isChecked(),true);
    await page.locator('.cp-frame-actions input[name="cancel"]').click();
    assert.equal(await page.evaluate(() => window.nativeCancel),true);
  } finally {await f.close();}
});

test('SCA B stays idempotent across reskins and themes, with responsive grouping and the existing pager', async () => {
  const f = await open();
  try {
    const {page} = f;
    await page.locator('.cp-sca').waitFor();
    for (let i = 0; i < 3; i++) await page.evaluate(() => {document.dispatchEvent(new Event('cp:reskin'));document.dispatchEvent(new Event('cp:theme-change'));});
    assert.equal(await page.locator('.cp-sca-settings').count(),1);
    assert.equal(await page.locator('.cp-sca-settings > .cp-sca-arrangement').count(),1);
    assert.equal(await page.locator('[name="option0"]').count(),1);
    assert.equal(await page.locator('.cp-sca-options').evaluate(el => getComputedStyle(el).gridAutoFlow),'column');
    assert.equal(await page.locator('#native-pager').evaluate(el => getComputedStyle(el).display),'none');
    assert.equal(await page.locator('.cp-pager').count(),1);
    assert.equal(await page.evaluate(() => {
      const b = s => document.querySelector(s).getBoundingClientRect();
      return b('.cp-sca-options').bottom <= b('.cp-sca-arrangement').top && b('.cp-sca-arrangement').bottom <= b('.cp-sca-tone').top && b('.cp-sca-tone').bottom <= b('.cp-sca-policies').top && b('.cp-sca-table').bottom <= b('.cp-sca-find').top;
    }),true,'selected layout order');
    await page.screenshot({path:path.join(root,'dev-preview/sca-designs/implemented-b.png'),fullPage:true});
    for (const width of [1024,768,390]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'no page overflow at '+width);
      assert.equal(await page.locator('[name="findButton"]').isVisible(),true);
    }
    assert.equal(await page.locator('.cp-sca-options').evaluate(el => getComputedStyle(el).gridAutoFlow),'row');
    await f.worker.evaluate(() => chrome.storage.local.set({cpThemePalette:'nord'}));
    await page.waitForFunction(() => document.documentElement.dataset.cpDirection === 'nord');
    await page.setViewportSize({width:1440,height:1050});
    await page.evaluate(() => {for(const a of document.getAnimations()) if(a.effect?.getTiming().iterations !== Infinity) a.finish();});
    assert.equal(await page.locator('.cp-sca-table tr[id^="Row"] a').first().evaluate(el => getComputedStyle(el).color),'rgb(136, 192, 208)','device links use the dark palette accent');
    assert.equal(await page.locator('.cp-sca-find [name="findAllButton"]').evaluate(el => getComputedStyle(el).backgroundColor),'rgb(59, 66, 82)','buttons use the dark palette surface');
    await page.screenshot({path:path.join(root,'dev-preview/sca-designs/implemented-b-dark.png'),fullPage:true,animations:'disabled'});
    await page.evaluate(() => history.replaceState(null,'','/commpilot/Common/find.jsp'));
    await page.evaluate(() => document.dispatchEvent(new Event('cp:reskin')));
    assert.equal(await page.locator('.cp-sca').count(),1);
  } finally {await f.close();}
});

test('SCA B preserves empty states, extra fields, incomplete server paging, and leaves Add alone', async () => {
  const f = await open({devices:[],extra:'<table><tr><td>Additional setting:</td><td><input name="futureSetting" value="keep me"></td></tr></table>'});
  try {
    await f.page.locator('.cp-sca').waitFor();
    assert.equal(await f.page.locator('.fx-empty').isVisible(),true);
    assert.equal(await f.page.locator('[name="futureSetting"]').isVisible(),true,'unknown settings remain available');
    assert.equal(await f.page.locator('.cp-sca-find').isVisible(),true);
  } finally {await f.close();}
  const paged = await open({pages:3});
  try {
    await paged.page.locator('.cp-sca').waitFor();
    await paged.page.locator('#native-pager').waitFor({state:'visible'});
    assert.equal(await paged.page.locator('#native-pager').isVisible(),true,'keeps server paging until the whole list is available');
    assert.equal(await paged.page.locator('.cp-pager').count(),0);
  } finally {await paged.close();}
  const add = await open({title:'Shared Call Appearance Add'});
  try {assert.equal(await add.page.locator('.cp-sca').count(),0);} finally {await add.close();}
});

test('native legacy Find links activate SCA B and retain their Common/find.jsp handlers', async () => {
  const f = await open({legacy:true});
  try {
    const {page} = f;
    assert.equal(await page.locator('.cp-sca').count(),1,'legacy Find is an anchor, not an input button');
    assert.equal(await page.locator('.cp-sca-find a#findButton').count(),1);
    await page.locator('[name="findValue"]').fill('UC1mob');
    const found = page.waitForResponse(r => r.url().includes('/Common/find.jsp') && r.request().method() === 'POST');
    await page.locator('#findButton').click();
    await found;
    await page.waitForFunction(() => document.querySelector('.cp-sca-table')?.querySelectorAll('tr[id^="Row"]').length === 1);
    assert.equal(await page.locator('.cp-sca').count(),1,'fresh native Find response activates the layout');
    assert.equal(new URLSearchParams(f.posts.at(-1).fields).get('value'),'UC1mob');
    assert.equal(new URLSearchParams(f.posts.at(-1).fields).get('tableName'),'userScaTable');
    const all = page.waitForResponse(r => r.url().includes('/Common/findAll.jsp') && r.request().method() === 'POST');
    await page.locator('#findAllButton').click();
    await all;
    await page.waitForFunction(() => document.querySelector('.cp-sca-table')?.querySelectorAll('tr[id^="Row"]').length === 2);
    assert.equal(await page.locator('.cp-sca-find').count(),1);
    await page.screenshot({path:path.join(root,'dev-preview/sca-designs/implemented-b-legacy.png'),fullPage:true,animations:'disabled'});
  } finally {await f.close();}
});

test('SCA typography and density match shared page styles and follow the selected font', async () => {
  const f = await open({legacy:true});
  try {
    const {page} = f;
    await page.locator('.cp-sca').waitFor();
    // Render the ordinary shared classes outside SCA, so this compares against the rest of the app's CSS.
    await page.evaluate(() => {
      const reference = document.createElement('div');
      reference.id = 'shared-style-reference';
      reference.style.cssText = 'position:absolute;left:-10000px;top:0;width:1100px';
      reference.innerHTML = `<div class="fx"><h3 class="fx-sec-title">Section</h3><p class="fx-hint">Caption</p>
        <label class="fx-check-label">Setting</label><label class="fx-opt">Choice</label><div class="fx-label">Field</div></div>
        <table><tr><td class="listHeader">Delete</td><td class="listHeader">Type</td><td class="listHeader">Name</td><td class="listHeader">Line/Port</td></tr>
        <tr id="RowStyleReference"><td></td><td>Type</td><td>Name</td><td>Line/Port</td></tr></table>
        <a class="headerLink">Find</a><input type="text"><select><option>Field</option></select>`;
      document.querySelector('td[width="82%"]').appendChild(reference);
    });
    const compare = async () => page.evaluate(() => {
      const pairs = [
        ['.cp-sca-heading h3','#shared-style-reference .fx-sec-title',['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing']],
        ['.cp-sca-heading p','#shared-style-reference .fx-hint',['fontFamily','fontSize','lineHeight']],
        ['.cp-sca-options .fx-check-label','#shared-style-reference .fx-check-label',['fontFamily','fontSize','fontWeight','lineHeight']],
        ['.cp-sca-tone .fx-opt','#shared-style-reference .fx-opt',['fontFamily','fontSize','fontWeight','lineHeight']],
        ['.cp-sca-tone .fx-label','#shared-style-reference .fx-label',['fontFamily','fontSize','fontWeight']],
        ['.cp-sca-table td.listHeader','#shared-style-reference td.listHeader',['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','paddingTop','paddingLeft','textTransform']],
        ['.cp-sca-table tr[id^="Row"] td:nth-child(3)','#RowStyleReference td:nth-child(3)',['fontFamily','fontSize','lineHeight','paddingTop','paddingBottom','paddingLeft']],
        ['.cp-sca-find #findButton','#shared-style-reference a.headerLink',['fontFamily','fontSize','fontWeight','lineHeight','minHeight']],
        ['.cp-sca-find input[type="text"]','#shared-style-reference input',['fontFamily','fontSize','lineHeight','minHeight']],
        ['.cp-sca-find select','#shared-style-reference select',['fontFamily','fontSize','lineHeight','minHeight']]
      ];
      return pairs.flatMap(([actual,reference,properties]) => {
        const a = getComputedStyle(document.querySelector(actual)), b = getComputedStyle(document.querySelector(reference));
        return properties.filter(property => a[property] !== b[property]).map(property => ({actual,property,sca:a[property],shared:b[property]}));
      });
    });
    assert.deepEqual(await compare(),[],'desktop uses shared type and spacing');
    await page.setViewportSize({width:1440,height:800});
    assert.deepEqual(await compare(),[],'compact screens use shared control heights and row padding');
    await f.worker.evaluate(() => chrome.storage.local.set({cpSettings:{peek:false,font:'arial'}}));
    await page.waitForFunction(() => document.documentElement.dataset.cpFont === 'arial');
    assert.deepEqual(await compare(),[],'font preference applies consistently');
    assert.match(await page.locator('.cp-sca-options .fx-check-label').first().evaluate(el => getComputedStyle(el).fontFamily),/Arial/);
  } finally {await f.close();}
});
