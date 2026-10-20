const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright-core');
const root = path.resolve(__dirname,'..');
const extension = path.resolve(process.env.BW_TEST_EXTENSION_PATH || root);
const origin = 'https://apps-sbx.avpaas.io';
const base = '/commpilot/Group/DeviceInventory/Modify/';
const profile = base + 'Profile/index.jsp';
const groupList = '/commpilot/Group/DeviceInventory/';
const sca = '/commpilot/User/SCAP/';
const appearance = sca + 'Modify/index.jsp';
const userEntry = '/commpilot/Group/Members/Modify/index.jsp';
const servlet = '/commpilot/servlet/DeviceInventoryProvisionServlet';
const device = 'Desk & Mobile 7014';
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sections = [['Profile','Profile'],['Users','Users'],['Files','Files'],['CustomTags','Custom Tags'],['TagSet','Tag Set'],['AvailableCustomTags','Available Custom Tags'],['NativeTagsWithLogic','Native Tags With Logic'],['TrunkGroups','Trunk Groups']];

async function setup({multipart = true,start = sca} = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'bw-device-editor-'));
  const context = await chromium.launchPersistentContext(temp,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    viewport:{width:1440,height:1050},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({cpThemePalette:'rosepine-light',cpSettings:{peek:false}}));
    // The production rules replay cold GETs as native POSTs. This isolated mock server starts with a GET fixture.
    await worker.evaluate(() => chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['ruleset_1']}));
    const posts = [], saves = [], held = new Map(), pageResponses = new Map(), dropped = new Set();
    let serverContext = 'user', serial = 0, failure = false, lastEntryToken = '';
    const shell = (title,content,folder='Call Control') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body id="initBody.menuTemplate">
      <table><tr><td class="headerBar"><a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel" data-cp-extension-state="done" data-cp-number="2055557014">TestUser</span></td></tr></table>
      <table height="100%"><tr><td width="18%"><form name="leftNavForm"><a class="leftnavfolderopen">${folder}</a></form></td><td width="82%" valign="top">${content}</td></tr></table>
      <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
    const frame = (title,contents,action='',formExtra='') => `<form name="mainForm" method="post" action="${action}" ${formExtra}>
      <input type="hidden" name="formtokenserial" value="t-${++serial}"><table width="100%"><tr><td class="screenName">${title}</td></tr>
      <tr><td class="tip">Manage this device profile.</td></tr><tr id="buttonbartop"><td class="buttonbar">
      <input type="submit" name="ok" value="OK"><input type="submit" name="apply" value="Apply"><input type="button" name="cancel" value="Cancel" onclick="redirectPost('${groupList}',{})">
      </td></tr><tr><td class="enduserbody">${contents}</td></tr></table></form>`;
    const source = (isAppearance) => shell(isAppearance ? 'Shared Call Appearance Modify' : 'Shared Call Appearance',
      frame(isAppearance ? 'Shared Call Appearance Modify' : 'Shared Call Appearance',`<div id="sca-source">${isAppearance ? 'Appearance' : 'SCA list'}</div>
        <a id="configure" class="headerLink" onclick="redirectPost('${profile}',{key:'${esc(device)}',P_key:'${esc(device)}',name:'${esc(device)}',P_name:'${esc(device)}'})">Configure Identity/Device Profile</a>`));
    const editor = section => {
      const tabs = `<table id="legacy-tabs"><tr>${sections.map(([id,label],i) => id === section ? `<td class="tabActive">${label}</td>` : `<td class="tab"><img src="/tab-left.gif"><a class="tab" id="tab-${id}">${label}</a><img src="/tab-right.gif"></td>`).join('')}</tr></table>`;
      const wiring = sections.filter(([id]) => id !== section).map(([id]) => {
        // Real pages wire UUID links at DOMContentLoaded, sometimes after long hover handlers and escaped URLs.
        const target = id === 'Files' ? '../Files/index.jsp' : (base.replace('/commpilot','') + id + '/index.jsp').replaceAll('/','\\u002F');
        const handler = id === 'CustomTags' ? `redirectPost('${base}CustomTags/index.jsp',{key:'Desk & Mobile 7014'});` : `TabSubmit('${target}');`;
        return `<script>document.addEventListener('DOMContentLoaded',function(){var elem=document.getElementById('tab-${id}');
          elem.addEventListener('mouseover',function(){/* ${'native hover wiring '.repeat(40)} */});
          elem.addEventListener('click',function(){${handler}});});</script>`;
      }).join('');
      const details = section === 'Profile' ? `<table><tr><td>Identity/Device Profile Name:</td><td>${esc(device)}</td></tr>
        <tr><td>Identity/Device Profile Type:</td><td>Connect - Mobile</td></tr><tr><td>Protocol:</td><td><select name="protocol"><option>SIP 2.0</option></select></td></tr>
        <tr><td colspan="2"><table width="100%"><tr><td align="right"><table><tr><td>Host Name/IP Address:</td><td><input name="ipAddress" value=""></td></tr></table></td><td align="right"><table><tr><td>Port:</td><td><input name="port" value="5060" size="6"></td></tr></table></td></tr></table></td></tr>
        <tr><td>Description:</td><td><input id="description" name="description" value="${esc(saves.at(-1)?.description || 'Saved description')}"></td></tr></table>
        <fieldset><legend>Authentication</legend><table><tr><td>Credentials:</td><td><input type="radio" name="credentials" value="type" checked>Use type credentials<input type="radio" name="credentials" value="custom">Use custom credentials</td></tr></table></fieldset>` :
        `<table><tr><td>${sections.find(([id])=>id===section)?.[1]}:</td><td><input id="description" name="description" value="${esc(saves.at(-1)?.description || 'Saved description')}"></td></tr></table>`;
      return shell('Identity/Device Profile Modify',frame('Identity/Device Profile Modify',
        `<input type="hidden" name="deviceName" value="${esc(device)}"><input type="hidden" name="buttonClicked" value="">${tabs}${wiring}${details}<div id="current-section">${section}</div>`,
        multipart ? servlet : base + section + '/index.jsp',multipart ? 'enctype="multipart/form-data"' : '') +
        `<script>function TabSubmit(url){document.forms.mainForm.tabPage.value=url;document.forms.mainForm.submit();}
        window.originalDeviceInput=document.forms.mainForm.elements.deviceName;</script>`,'Resources');
    };
    const list = () => shell('Identity/Device Profiles',`<input name="formtokenserial" value="t-${++serial}"><div id="group-list">Group device inventory</div>`,'Resources');
    await context.route(origin+'/**',async route=>{
      const req = route.request(), pathname = new URL(req.url()).pathname;
      if (req.resourceType() === 'image') return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
      const raw = req.postData() || '';
      const data = new URLSearchParams(raw);
      const read = key => /multipart\/form-data/.test(req.headers()['content-type'] || '') ?
        new RegExp('name="'+key+'"\\r\\n\\r\\n([^\\r]*)').exec(raw)?.[1] || '' : data.get(key) || '';
      const action = ['ok','apply'].find(key => !!read(key)) || '';
      if (req.method() === 'POST') posts.push({path:pathname,params:Object.fromEntries(data),raw});
      if (held.has(pathname)) await held.get(pathname).promise;
      if (dropped.delete(pathname)) return route.abort('failed');
      if (pageResponses.has(pathname)) return route.fulfill({contentType:'text/html',...pageResponses.get(pathname)});
      if (pathname === servlet || pathname.startsWith(base) && action) {
        if (failure) return route.fulfill({status:500,contentType:'text/html',body:'Server rejected the save'});
        saves.push({action,description:read('description')});
        serverContext='device';
        return route.fulfill({status:200,contentType:'text/html',body:pathname === servlet ?
          `<html><body><input name="formtokenserial" value="t-${++serial}"><script>redirectPost('${groupList}',{});</script></body></html>` : list()});
      }
      let html;
      if (pathname === userEntry) {serverContext='user';lastEntryToken='t-'+ ++serial;html=shell('User context',`<input name="formtokenserial" value="${lastEntryToken}"><div id="user-entry">User context restored</div><script>window.userEntryScriptRan=true;</script>`);}
      else if (pathname === sca || pathname === appearance) {
        if (serverContext !== 'user') return route.fulfill({status:500,contentType:'text/html',body:'Wrong user context'});
        html=source(pathname === appearance);
      } else if (pathname === '/commpilot/Common/find.jsp' && data.get('returnPage')?.includes('/DeviceInventory/Modify/')) {
        serverContext='device';html=editor('Files');
      } else if (pathname.startsWith(base)) {serverContext='device';html=editor(pathname.slice(base.length).split('/')[0]);}
      else if (pathname === groupList) {serverContext='group';html=list();}
      else html=shell('Other',`<input name="formtokenserial" value="t-${++serial}">`);
      return route.fulfill({status:200,contentType:'text/html',body:html});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror',e=>console.log('device fixture page error:',e.message));
    await page.goto(origin+start);
    await page.waitForFunction(()=>typeof window.redirectPost === 'function' && document.querySelector('.cp-frame-head, #group-list')).catch(async e=>{console.log(await page.evaluate(()=>({url:location.pathname,theme:document.documentElement.dataset.cpDirection,content:document.body.innerText.slice(0,700),frames:document.querySelectorAll('.cp-frame-head').length})));console.log('initial requests',posts.map(p=>({path:p.path,params:p.params})));throw e;});
    if (start !== groupList) {
      await page.evaluate(entry => history.replaceState({...history.state,cpNav:{url:location.pathname,params:location.pathname.includes('/Modify/') ? {key:'appearance-7014'} : {},entry:{url:entry,params:{key:'TestUser',P_key:'TestUser'}}}},'',location.href),userEntry);
      await page.locator('#configure').click();
    } else await page.evaluate(({profile,device})=>window.redirectPost(profile,{key:device,P_key:device,name:device,P_name:device}),{profile,device});
    try {
      await page.locator('#current-section').waitFor();
      await page.locator('.cp-device-tabs').waitFor();
    } catch(error) {
      console.log('device fixture state:',await page.evaluate(()=>({url:location.pathname,title:document.title,path:document.documentElement.dataset.cpPath,form:!!document.forms.mainForm,fx:document.querySelectorAll('.fx').length,tabs:document.querySelectorAll('a.tab, td.tabActive').length,content:document.querySelector('td[width="82%"]')?.innerText.slice(0,700)})));
      throw error;
    }
    await page.evaluate(()=>window.initialDeviceDocument=document);
    return {page,posts,saves,worker,setFailure:value=>{failure=value;},entryToken:()=>lastEntryToken,
      hold:pathname=>{let release;const promise=new Promise(resolve=>{release=()=>{held.delete(pathname);resolve();};});held.set(pathname,{promise,release});return release;},
      setPageResponse:(pathname,response)=>{if(response)pageResponses.set(pathname,response);else pageResponses.delete(pathname);},
      dropNext:pathname=>dropped.add(pathname),
      close:async()=>{for(const gate of held.values())gate.release();await context.close();fs.rmSync(temp,{recursive:true,force:true});}};
  } catch(e) {await context.close();fs.rmSync(temp,{recursive:true,force:true});throw e;}
}

test('device profile tabs work with escaped, relative and long native wiring without submitting draft edits',async()=>{
  const f=await setup();
  try {
    await f.page.locator('#description').fill('UNSAVED draft');
    assert.equal(await f.page.locator('.fx-jump').count(),0,'one clear native tab navigation');
    assert.equal(await f.page.locator('.cp-device-editor .fx-facts .fx-fact').count(),2,'device identity uses the shared facts strip');
    assert.equal(await f.page.locator('.cp-device-endpoint input').count(),2);
    for(const [id] of sections.slice(1)) {
      await f.page.locator(`#tab-${id}`).click();
      await f.page.waitForFunction(id=>document.querySelector('#current-section')?.textContent===id,id);
      assert.equal(await f.page.evaluate(()=>document===window.initialDeviceDocument),true);
      assert.equal(await f.page.locator('.cp-device-tabs [aria-current="page"]').count(),1);
      const sent=f.posts.at(-1);
      assert.equal(sent.params.key,device);
      assert.equal(sent.params.description,undefined,'tab navigation does not submit editable fields');
    }
    await f.page.locator('#tab-Profile').focus();
    await f.page.keyboard.press('Enter');
    await f.page.waitForFunction(()=>document.querySelector('#current-section')?.textContent==='Profile');
    assert.equal(f.saves.length,0);
    assert.equal(await f.page.locator('#description').inputValue(),'Saved description');
    await f.page.mouse.move(5,5);
    await f.page.screenshot({path:path.join(root,'dev-preview/sca-designs/device-profile.png'),fullPage:true,animations:'disabled'});
    for(const width of [1024,768,390]) {
      await f.page.setViewportSize({width,height:900});
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow at '+width);
    }
  } finally {await f.close();}
});

for(const start of [sca,appearance]) test('device OK restores user context and returns to '+start,async()=>{
  const f=await setup({start});
  try {
    await f.page.locator('#description').fill('Saved via OK');
    await f.page.locator('.cp-frame-actions input[name="ok"]').click();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,start);
    assert.deepEqual(f.posts.slice(-2).map(p=>p.path),[userEntry,start]);
    assert.equal(f.saves.length,1);
    assert.equal(f.saves[0].description,'Saved via OK');
    if(start===appearance) assert.equal(f.posts.at(-1).params.key,'appearance-7014');
    assert.equal(await f.page.evaluate(()=>document===window.initialDeviceDocument),true);
    assert.equal(await f.page.locator('#group-list').count(),0);
  } finally {await f.close();}
});

for(const multipart of [true,false]) for(const action of ['ok','cancel']) test(`device ${action} returns atomically to SCA Modify with delayed responses (${multipart?'multipart':'regular'})`,async()=>{
  const f=await setup({start:appearance,multipart});
  try {
    const releaseEntry=f.hold(userEntry), releaseAppearance=f.hold(appearance);
    await f.page.evaluate(()=>{
      window.returnPaints=[];
      const record=()=>{
        if(document.querySelector('#user-entry'))window.returnPaints.push('user home');
        if(document.querySelector('#group-list'))window.returnPaints.push('group inventory');
      };
      new MutationObserver(record).observe(document.body,{childList:true,subtree:true});
      window.returnHistory=[];
      for(const method of ['pushState','replaceState']) {
        const original=history[method];
        history[method]=function(state,title,url){window.returnHistory.push(String(url));return original.apply(this,arguments);};
      }
    });
    await f.page.locator('.cp-frame-actions input[name="'+action+'"]').click({noWaitAfter:true});
    for(let i=0;i<100 && !f.posts.some(p=>p.path===userEntry);i++)await new Promise(r=>setTimeout(r,20));
    assert.ok(f.posts.some(p=>p.path===userEntry));
    assert.equal(new URL(f.page.url()).pathname,profile,'device stays visible while user context is restored');
    if(action==='cancel')await f.page.locator('.cp-frame-actions input[name="cancel"]').click({noWaitAfter:true});
    await f.page.locator('.cp-frame-actions input[name="ok"]').evaluate(button=>button.click());
    await f.page.evaluate(()=>document.forms.mainForm.requestSubmit(document.forms.mainForm.elements.ok));
    releaseEntry();
    for(let i=0;i<100 && !f.posts.some(p=>p.path===appearance);i++)await new Promise(r=>setTimeout(r,20));
    assert.ok(f.posts.some(p=>p.path===appearance),'final appearance requested');
    assert.deepEqual(await f.page.evaluate(()=>window.returnPaints),[],'intermediate user and group pages never enter the live DOM');
    assert.equal(await f.page.evaluate(()=>!!window.userEntryScriptRan),false,'intermediate menu scripts never execute');
    assert.equal(new URL(f.page.url()).pathname,profile,'URL remains on device until final appearance arrives');
    assert.equal(f.posts.filter(p=>p.path===userEntry).length,1,'repeated Cancel does not duplicate context restoration');
    releaseAppearance();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,appearance);
    assert.deepEqual(await f.page.evaluate(()=>window.returnPaints),[]);
    assert.equal(await f.page.evaluate(entry=>window.returnHistory.some(url=>url.includes(entry)),userEntry),false);
    assert.equal(await f.page.evaluate(()=>history.state.cpNav.entry.url),userEntry);
    assert.equal(f.posts.at(-1).params.key,'appearance-7014');
    assert.equal(f.posts.at(-1).params.formtokenserial,f.entryToken(),'final request uses the restored context token');
    assert.equal(f.saves.length,action==='ok'?1:0);
  } finally {await f.close();}
});

test('Apply stays on the active device tab; Cancel returns to SCA without saving draft changes',async()=>{
  const f=await setup({start:appearance});
  try {
    await f.page.locator('#tab-Files').click();
    await f.page.waitForFunction(()=>document.querySelector('#current-section')?.textContent==='Files');
    await f.page.locator('#description').fill('Applied files setting');
    await f.page.locator('.cp-frame-actions input[name="apply"]').click();
    await f.page.waitForFunction(()=>document.querySelector('#current-section')?.textContent==='Files' && document.querySelector('#description')?.value==='Applied files setting');
    assert.equal(f.saves.length,1);
    assert.equal(new URL(f.page.url()).pathname,base+'Files/index.jsp');
    await f.page.locator('#description').fill('Unsaved after Apply');
    await f.page.locator('.cp-frame-actions input[name="cancel"]').click();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,appearance);
    assert.equal(f.saves.length,1,'Cancel does not save');
  } finally {await f.close();}
});

for(const action of ['ok','cancel']) test('failed context restore after '+action+' stays on the device editor and allows a clean Cancel retry',async()=>{
  const f=await setup({start:appearance});
  try {
    f.setPageResponse(userEntry,{status:500,body:'<html><head><title>Context error</title></head><body><table><tr><td width="82%"><input name="formtokenserial" value="context-error-token"><div class="error">The server could not restore the selected user. The current device editor must stay open until the user context can be restored safely.</div></td></tr></table></body></html>'});
    await f.page.locator('#description').fill('Unsaved draft');
    await f.page.locator('.cp-frame-actions input[name="'+action+'"]').click({noWaitAfter:true});
    await f.page.locator('.cp-upload-notice').waitFor({state:'attached'});
    assert.equal(new URL(f.page.url()).pathname,profile);
    assert.equal(await f.page.locator('#description').inputValue(),'Unsaved draft');
    await f.page.waitForFunction(()=>!document.forms.mainForm.elements.ok.disabled);
    assert.equal(f.posts.filter(p=>p.path===appearance).length,0,'no final request after failed context restore');
    f.setPageResponse(userEntry,null);
    await f.page.locator('.cp-frame-actions input[name="cancel"]').click();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,appearance);
    assert.equal(f.saves.length,action==='ok'?1:0);
  } finally {await f.close();}
});

test('a user home response cannot replace the requested SCA Modify destination',async()=>{
  const f=await setup({start:appearance});
  try {
    f.setPageResponse(appearance,{status:200,body:'<html><head><title>User Profile</title></head><body><table><tr><td width="82%"><input name="formtokenserial" value="wrong-page-token"><div id="user-entry">Wrong user home</div></td></tr></table></body></html>'});
    await f.page.locator('.cp-frame-actions input[name="cancel"]').click();
    await f.page.locator('.cp-upload-notice').waitFor({state:'attached'});
    assert.equal(new URL(f.page.url()).pathname,profile);
    assert.equal(await f.page.locator('#user-entry').count(),0,'wrong destination is not painted');
    assert.equal(await f.page.locator('input[name="formtokenserial"]').first().inputValue(),'wrong-page-token');
    f.setPageResponse(appearance,null);
    await f.page.locator('.cp-frame-actions input[name="cancel"]').click();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,appearance);
  } finally {await f.close();}
});

for(const delayed of [userEntry,appearance]) test('a newer navigation supersedes a delayed SCA return at '+delayed,async()=>{
  const f=await setup({start:appearance});
  try {
    const releaseReturn=f.hold(delayed);
    await f.page.locator('.cp-frame-actions input[name="cancel"]').evaluate(button=>button.click());
    for(let i=0;i<100 && !f.posts.some(p=>p.path===delayed);i++)await new Promise(r=>setTimeout(r,20));
    assert.ok(f.posts.some(p=>p.path===delayed));
    const oldToken=await f.page.locator('input[name="formtokenserial"]').first().inputValue();
    const other='/commpilot/User/Profile/';
    await f.page.evaluate(url=>window.redirectPost(url,{}),other);
    releaseReturn();
    await f.page.waitForURL('**'+other);
    assert.equal(f.posts.filter(p=>p.path===appearance).length,delayed===appearance?1:0,'stale return never starts a further SCA request');
    assert.notEqual(f.posts.at(-1).params.formtokenserial,oldToken,'new navigation uses the context response token');
    assert.equal(await f.page.locator('#user-entry').count(),0);
    assert.equal(await f.page.evaluate(()=>!!window.userEntryScriptRan),false);
  } finally {await f.close();}
});

test('a dropped SCA return request retries navigation without resending the device save',async()=>{
  const f=await setup({start:appearance});
  try {
    f.dropNext(appearance);
    await f.page.locator('.cp-frame-actions input[name="ok"]').click({noWaitAfter:true});
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,appearance);
    assert.equal(f.saves.length,1,'the save is not retried');
    assert.equal(f.posts.filter(p=>p.path===appearance).length,2,'only the failed read is retried');
    assert.equal(f.posts.filter(p=>p.path===userEntry).length,2,'retry restores the same user context');
    assert.equal(await f.page.evaluate(()=>!!window.userEntryScriptRan),false);
  } finally {await f.close();}
});

test('device profile opened from group inventory keeps its native group return',async()=>{
  const f=await setup({start:groupList});
  try {
    await f.page.locator('#description').fill('Group Apply stays here');
    await f.page.locator('.cp-frame-actions input[name="apply"]').click();
    await f.page.waitForFunction(()=>document.querySelector('#description')?.value==='Group Apply stays here');
    assert.equal(new URL(f.page.url()).pathname,profile,'Apply stays on the editor even when opened from inventory');
    await f.page.locator('.cp-frame-actions input[name="ok"]').click();
    await f.page.locator('#group-list').waitFor();
    assert.equal(new URL(f.page.url()).pathname,groupList);
    assert.equal(f.saves.length,2);
    assert.equal(f.posts.filter(p=>p.path===userEntry).length,0);
  } finally {await f.close();}
});

test('a failed device save leaves the editor and unsaved changes intact',async()=>{
  const f=await setup();
  try {
    f.setFailure(true);
    await f.page.locator('#description').fill('Keep this draft');
    await f.page.locator('.cp-frame-actions input[name="ok"]').click();
    await f.page.locator('.cp-upload-notice').waitFor({state:'attached'});
    assert.equal(new URL(f.page.url()).pathname,profile);
    assert.equal(await f.page.locator('#description').inputValue(),'Keep this draft');
    assert.equal(f.saves.length,0);
    assert.equal(f.posts.filter(p=>p.path===userEntry).length,0);
  } finally {await f.close();}
});

test('regular device form saves use the same SCA return as multipart saves',async()=>{
  const f=await setup({multipart:false});
  try {
    await f.page.locator('#description').fill('Regular form saved');
    await f.page.locator('.cp-frame-actions input[name="ok"]').click();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,sca);
    assert.equal(f.saves.length,1);
    assert.equal(f.saves[0].description,'Regular form saved');
  } finally {await f.close();}
});

test('device return origin survives a page reload and stays attached to the same appearance',async()=>{
  const f=await setup({start:appearance});
  try {
    await f.page.evaluate(()=>history.replaceState(null,'',location.href));
    await f.page.reload();
    await f.page.locator('.cp-device-tabs').waitFor();
    assert.equal(await f.page.evaluate(()=>history.state.cpDeviceOrigin?.back?.params?.key),'appearance-7014');
    await f.page.locator('.cp-frame-actions input[name="cancel"]').click();
    await f.page.locator('#sca-source').waitFor();
    assert.equal(new URL(f.page.url()).pathname,appearance);
    assert.equal(f.saves.length,0);
  } finally {await f.close();}
});

test('repeated device visits retain the same SCA appearance and user context',async()=>{
  const f=await setup({start:appearance});
  try {
    for(let visit=0;visit<3;visit++) {
      await f.page.locator('#tab-Files').click();
      await f.page.waitForFunction(()=>document.querySelector('#current-section')?.textContent==='Files');
      await f.page.locator('.cp-frame-actions input[name="cancel"]').click({noWaitAfter:true});
      await f.page.locator('#sca-source').waitFor();
      assert.equal(new URL(f.page.url()).pathname,appearance);
      assert.equal(f.posts.at(-1).params.key,'appearance-7014');
      assert.equal(await f.page.evaluate(()=>history.state.cpNav.entry.params.key),'TestUser');
      assert.equal(await f.page.evaluate(()=>!!window.userEntryScriptRan),false);
      if(visit<2) {
        await f.page.locator('#configure').click();
        await f.page.locator('.cp-device-tabs').waitFor();
      }
    }
    assert.equal(f.saves.length,0);
  } finally {await f.close();}
});

test('filtered device tabs keep profile identity and the SCA return through Common/find.jsp',async()=>{
  const f=await setup({start:appearance});
  try {
    await f.page.locator('#tab-Files').click();
    await f.page.waitForFunction(()=>document.querySelector('#current-section')?.textContent==='Files');
    await f.page.evaluate(()=>window.redirectPost('/commpilot/Common/find.jsp',{
      returnPage:'/Group/DeviceInventory/Modify/Files/',tableName:'deviceFiles',key:'0',op:'2',value:'config'}));
    await f.page.waitForFunction(()=>location.pathname==='/commpilot/Common/find.jsp' && !!document.querySelector('.cp-device-tabs'));
    assert.equal(await f.page.evaluate(()=>history.state.cpDeviceOrigin?.back?.params?.key),'appearance-7014');
    await f.page.locator('#tab-CustomTags').click();
    await f.page.waitForFunction(()=>document.querySelector('#current-section')?.textContent==='CustomTags');
    assert.equal(f.posts.at(-1).params.key,device,'the filter column key is not the device identity');
    assert.equal(await f.page.evaluate(()=>history.state.cpDeviceOrigin?.back?.params?.key),'appearance-7014','origin is retained after leaving filtered files');
    await f.page.locator('.cp-frame-actions input[name="cancel"]').click();
    await f.page.locator('#sca-source').waitFor().catch(async error=>{console.log('filtered return state',await f.page.evaluate(()=>({url:location.pathname,state:history.state,notice:document.querySelector('.cp-upload-notice')?.textContent})),f.posts.slice(-4).map(p=>({path:p.path,params:p.params})));throw error;});
    assert.equal(new URL(f.page.url()).pathname,appearance);
    assert.equal(f.saves.length,0);
  } finally {await f.close();}
});
