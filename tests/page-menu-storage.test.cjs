const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const prefix='cp-page-menu:',currentKey=prefix+'Profile|Reseller';
const origin='https://apps-sbx.avpaas.io',folder='/commpilot/Common/folder_contents.jsp';
function shell(body,entity='Reseller'){return `<html><body><table><tr><td class="headerBar"><span class="headerAuthLevel">${entity}</span></td></tr></table>
  <form name="leftNavForm"><a class="leftnavfolderopen" onclick="redirectPost('${folder}',{folder:'R0',menuId:'8'})">Profile</a></form>
  <input name="formtokenserial" value="fixture-token"><table height="100%"><tr><td width="82%" valign="top">${body}</td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;}
const menu=`<table><tr><td class="menuCategory">BASIC</td></tr><tr><td><a class="navMenuItem" id="groups" name="/Reseller/Groups/"
  onclick="redirectPost('/commpilot/Reseller/Groups/',{})">Groups</a></td></tr><tr><td>Group list</td></tr>
  <tr><td><a class="navMenuItem" id="admins" name="/Reseller/Admins/" onclick="redirectPost('/commpilot/Reseller/Admins/',{mode:'list'})">Administrators</a></td></tr>
  <tr><td>Administrator list</td></tr></table>`;
async function fixture(mode,check){
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(5000);
    await page.route('**/*',route=>{
      const pathname=new URL(route.request().url()).pathname;
      return route.fulfill({contentType:'text/html',body:shell(pathname===folder?menu:'<h1>Opened</h1>')});
    });
    await page.goto(origin+folder);
    await page.evaluate(({mode,prefix})=>{
      sessionStorage.setItem('fixture-group-defaults','preserve defaults');
      const count=mode==='many'?80:mode==='saturated'?3:0;
      for(let i=0;i<count;i++)sessionStorage.setItem(prefix+'old-'+i,JSON.stringify({cachedAt:i+1,folders:[]}));
      const set=Storage.prototype.setItem;window.fixtureMenuWrites=0;
      Storage.prototype.setItem=function(key,value){
        if(this===sessionStorage&&key.startsWith(prefix)){
          window.fixtureMenuWrites++;
          if(mode==='blocked'||mode==='saturated'&&Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)).length>=3)
            throw new DOMException('Fixture storage quota','QuotaExceededError');
        }
        return set.call(this,key,value);
      };
    },{mode,prefix});
    await page.addScriptTag({path:path.join(root,'src/content/pjax.js')});
    await page.waitForFunction(()=>fixtureMenuWrites>0);
    await check(page);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixture-group-defaults')),'preserve defaults');
  }finally{await browser.close();}
}
test('page-menu cache stays bounded across many entity keys and retains the current menu',()=>fixture('many',async page=>{
  const state=await page.evaluate(({prefix,currentKey})=>({keys:Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)),current:sessionStorage.getItem(currentKey)}),{prefix,currentKey});
  assert.ok(state.keys.length<=64,`expected at most 64 page menus, got ${state.keys.length}`);
  assert.ok(state.current);assert.equal(await page.locator('[data-cp-crumb-menu]').count(),1);
}));
test('page-menu quota recovery evicts only an older menu and saves the current menu',()=>fixture('saturated',async page=>{
  assert.ok(await page.evaluate(key=>sessionStorage.getItem(key),currentKey));
  assert.equal(await page.evaluate(prefix=>Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)).length,prefix),3);
  assert.equal(await page.locator('[data-cp-crumb-menu]').count(),1);
}));
test('a storage write failure still permits the current entity menu and page navigation',()=>fixture('blocked',async page=>{
  assert.equal(await page.locator('[data-cp-crumb-menu]').count(),1);
  await page.locator('[data-cp-crumb-menu]').click();
  await page.getByRole('dialog',{name:'Pages at this level'}).getByRole('button',{name:'Administrators',exact:true}).click();
  await page.waitForFunction(()=>location.pathname==='/commpilot/Reseller/Admins/');
  await page.locator('.cp-page-pill').waitFor();
  assert.equal(await page.locator('.cp-page-pill').innerText(),'Administrators');
  // A memory fallback must not turn another entity's pages into this entity's menu.
  await page.route(origin+'/commpilot/Reseller/Groups/',route=>route.fulfill({contentType:'text/html',body:shell('<h1>Other entity</h1>','Other Entity')}));
  await page.evaluate(()=>redirectPost('/commpilot/Reseller/Groups/',{}));
  await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Other entity');
  assert.equal(await page.locator('.cp-page-pill').count(),0);
}));
