const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const extension=path.resolve(process.env.BW_TEST_EXTENSION_PATH||root);
const origin='https://apps-sbx.avpaas.io';
const profile='/commpilot/User/Profile/';
const esc=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
async function setup(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bw-user-name-'));
 const context=await chromium.launchPersistentContext(temp,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1440,height:800},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const close=async()=>{await context.close();assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'bw-user-name-'));fs.rmSync(temp,{recursive:true,force:true});};
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['ruleset_1']}));
  await worker.evaluate(()=>chrome.storage.local.set({cpThemePalette:'graphite',cpSettings:{peek:false}}));
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
  let serial=0,saved={first:'Mary',last:'Jones'},saves=0,profileReads=0;
  await context.route(origin+'/**',route=>{
   const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');
   if(url.pathname===profile)profileReads++;
   const submit=url.pathname===profile&&(params.has('apply')||params.has('ok'));
   const failed=submit&&params.get('firstName')==='reject';
   if(submit&&!failed){saved={first:params.get('firstName').trim(),last:params.get('lastName').trim()};saves++;}
   const other=url.pathname==='/commpilot/User/Other/',list=url.pathname==='/commpilot/Group/Members/';
   const show=url.pathname===profile&&(!submit||failed||params.has('apply'));
   const values=failed?{first:params.get('firstName'),last:params.get('lastName')}:saved;
   const form=show?`<table><tr><td class="screenName">Profile</td></tr><tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="ok" value="OK"><input type="submit" name="apply" value="Apply"></td></tr>${failed?'<tr><td class="error"><span class="Failure">Invalid name</span></td></tr>':''}<tr><td class="enduserbody"><label>First Name<input id="firstName" name="firstName" value="${esc(values.first)}"></label><label>Last Name<input id="lastName" name="lastName" value="${esc(values.last)}"></label></td></tr></table>`:'<table><tr><td class="screenName">Settings</td></tr><tr><td class="enduserbody">Settings</td></tr></table>';
   const table=`<table><tr><td class="listHeader">User ID</td><td class="listHeader">First Name</td><td class="listHeader">Last Name</td><td class="listHeader">Extension</td><td class="listHeader">Phone Number</td></tr><tr id="Row0"><td><a class="tableLink" onclick="redirectPost('/commpilot/User/DND/',{})">NewUser</a></td><td>Updated</td><td>From List</td><td>7014</td><td>2055550142</td></tr></table>`;
   return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><title>Profile</title></head><body id="initBody.menuTemplate"><table><tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a><a class="headerAuthLevelLink">Provider</a><a class="headerAuthLevelLink">Group</a>${list?'':'<a class="headerAuthLevelLink">Users</a><span class="headerAuthLevel" data-cp-extension-state="done" data-cp-extension="7014" data-cp-number="2055550142">'+(other?'OtherUser':'NewUser')+'</span>'}</td></tr></table><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><table><tr><td width="82%"><form name="mainForm" method="post"><input type="hidden" name="formtokenserial" value="t-${++serial}">${list?table:form}</form></td></tr></table><script>window.redirectPost=function(){};</script></body></html>`});
  });
  const page=await context.newPage();await page.goto(origin+profile);await page.locator('.cp-name-chip').waitFor();
  const nav=async url=>{await page.evaluate(url=>window.redirectPost(url,{}),url);await page.waitForFunction(url=>location.pathname===url&&document.documentElement.dataset.cpNav!=='busy',url);};
  return{page,nav,close,saves:()=>saves,profileReads:()=>profileReads};
 }catch(error){await close();throw error;}
}
test('saved names appear in the breadcrumb and history, update after Apply/OK, and remain isolated by user',async()=>{
 const f=await setup();try{
  const chip=f.page.locator('.cp-name-chip');
  assert.equal(await chip.textContent(),'Mary Jones');
  assert.equal((await f.page.locator('span.headerAuthLevel').textContent()).trim(),'NewUser','native ID remains untouched');
  await chip.click();assert.equal(await f.page.evaluate(()=>navigator.clipboard.readText()),'Mary Jones');
  await f.page.locator('#firstName').fill('Draft');
  assert.equal(await chip.textContent(),'Mary Jones','typing does not change the saved name');
  await f.page.locator('#firstName').fill('Anne');await f.page.locator('#lastName').fill('Smith');
  await f.page.locator('input[name="apply"]').click();
  await f.page.waitForFunction(()=>document.querySelector('.cp-name-chip')?.textContent==='Anne Smith');
  await f.nav('/commpilot/User/DND/');
  assert.equal(await chip.textContent(),'Anne Smith');
  await f.page.locator('button.cp-bc-history').click();
  const group=f.page.getByRole('group',{name:'User NewUser',exact:true});
  assert.equal(await group.locator('.cp-history-location-title').textContent(),'Anne Smith');
  assert.equal(await group.locator('.cp-history-location-id').textContent(),'NewUser');
  await f.page.evaluate(()=>document.documentElement.dataset.cpDirection='rosepine-light');
  await f.page.screenshot({path:path.join(root,'dev-preview/history-designs/name-breadcrumb-light.png'),animations:'disabled'});
  await f.page.evaluate(()=>document.documentElement.dataset.cpDirection='graphite');
  await f.page.screenshot({path:path.join(root,'dev-preview/history-designs/name-breadcrumb-dark.png'),animations:'disabled'});
  await f.page.keyboard.press('Escape');
  await f.nav(profile);await f.page.locator('#firstName').fill('reject');
  await f.page.locator('input[name="apply"]').click();await f.page.locator('.Failure').waitFor({state:'attached'});
  assert.equal(await chip.textContent(),'Anne Smith','rejected changes keep the saved name');
  await f.nav(profile);await f.page.locator('#firstName').fill('Jo');await f.page.locator('#lastName').fill('Lee');
  await f.page.locator('input[name="ok"]').click();
  await f.page.waitForFunction(()=>document.querySelector('.cp-name-chip')?.textContent==='Jo Lee');
  await f.nav('/commpilot/User/Other/');await chip.waitFor({state:'detached'});
  await f.nav('/commpilot/User/DND/');await chip.waitFor();assert.equal(await chip.textContent(),'Jo Lee');
  await f.nav(profile);await f.page.locator('#firstName').fill('');await f.page.locator('#lastName').fill('');
  await f.page.locator('input[name="apply"]').click();await chip.waitFor({state:'detached'});
  await f.page.locator('button.cp-bc-history').click();
  assert.equal(await f.page.getByRole('group',{name:'User NewUser',exact:true}).locator('.cp-history-location-title').textContent(),'NewUser','empty names fall back to user ID');
  assert.equal(f.saves(),3);
 }finally{await f.close();}
});
test('Users list names populate the breadcrumb and history without a Profile request',async()=>{
 const f=await setup();try{
  const before=f.profileReads();
  await f.nav('/commpilot/Group/Members/');await f.page.locator('#Row0 a').click();
  await f.page.waitForFunction(()=>document.querySelector('.cp-name-chip')?.textContent==='Updated From List');
  await f.page.locator('button.cp-bc-history').click();
  assert.equal(await f.page.getByRole('group',{name:'User NewUser',exact:true}).locator('.cp-history-location-title').textContent(),'Updated From List');
  assert.equal(f.profileReads(),before);
 }finally{await f.close();}
});
