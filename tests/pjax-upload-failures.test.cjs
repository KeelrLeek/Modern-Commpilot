const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const origin='https://apps-sbx.avpaas.io',start='/commpilot/User/MusicOnHold/',servlet='/commpilot/servlet/MusicOnHoldUserServlet';
const script=process.env.BW_TEST_PJAX_PATH||path.resolve(__dirname,'../src/content/pjax.js');
const shell=`<!doctype html><html><head><title>Music on Hold</title></head><body>
 <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
 <table><tr><td width="82%"><form name="mainForm" method="post" enctype="multipart/form-data" action="${servlet}">
 <input name="formtokenserial" value="fixture-token" type="hidden"><input name="description" value="Unsaved fixture draft">
 <input type="submit" name="apply" value="Apply"><input type="submit" name="delete" value="Delete" disabled>
 </form></td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
async function fixture(reply){
 const browser=await chromium.launch({executablePath,headless:true}),page=await browser.newPage(),posts=[];
 await page.route(origin+'/**',async route=>{
   const url=new URL(route.request().url()).pathname;
   if(route.request().method()==='POST')posts.push(url);
   if(url===servlet)return reply(route);
   return route.fulfill({contentType:'text/html',body:shell});
 });
 await page.goto(origin+start);await page.addScriptTag({path:script});
 return {page,posts,browser};
}

for(const status of [401,403,503])test(`multipart HTTP ${status} reports the failure without replay`,async()=>{
 const f=await fixture(route=>route.fulfill({status,body:'Fixture failure'}));
 try{
   await f.page.locator('[name=apply]').click();
   const message=await f.page.locator('.cp-upload-notice').innerText();
   if(status===401)assert.match(message,/sign in/i);
   else assert.doesNotMatch(message,/session ended|sign in/i,'HTTP failure alone does not establish expired authentication');
   assert.deepEqual(f.posts,[servlet]);
   assert.equal(await f.page.locator('[name=description]').inputValue(),'Unsaved fixture draft');
 }finally{await f.browser.close();}
});

test('an upload failure restores only buttons that were enabled before submission',async()=>{
 const f=await fixture(route=>route.fulfill({status:503,body:'Unavailable'}));
 try{
   await f.page.locator('[name=apply]').click();
   await f.page.locator('.cp-upload-notice').waitFor();
   assert.equal(await f.page.locator('[name=apply]').isDisabled(),false);
   assert.equal(await f.page.locator('[name=delete]').isDisabled(),true,'native-disabled actions must stay disabled');
 }finally{await f.browser.close();}
});

test('a hung manual upload releases its form and token lock without a replay',async()=>{
 let release,started;
 const held=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 const f=await fixture(async route=>{started();await held;await route.abort().catch(()=>{});});
 try{
   await f.page.clock.install();
   await f.page.locator('[name=apply]').click();await began;
   await f.page.clock.fastForward(301000);
   assert.equal(await f.page.locator('form[name=mainForm]').getAttribute('aria-busy'),null,'stalled uploads must release the form');
   assert.match(await f.page.locator('.cp-upload-notice').innerText(),/timed out/i);
   assert.deepEqual(f.posts,[servlet],'no automatic resend');
   assert.equal(await f.page.locator('[name=description]').inputValue(),'Unsaved fixture draft');
   await f.page.evaluate(()=>{redirectPost('/commpilot/User/DND/',{});});
   await f.page.waitForFunction(()=>location.pathname==='/commpilot/User/DND/');
   assert.deepEqual(f.posts,[servlet,'/commpilot/User/DND/'],'the transport lock is released for a later action');
 }finally{release();await f.browser.close();}
});
