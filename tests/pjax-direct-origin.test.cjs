const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const shell=marker=>`<html><body><form name="leftNavForm"></form><input name="formtokenserial" value="fixture-token">
  <table><tr><td width="82%"><p id="marker">${marker}</p><input name="description" value="Preserve draft"></td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
for(const transport of ['fetch','frame'])for(const spelling of ['absolute','protocol-relative','backslash'])
test(`${transport} refuses a direct foreign ${spelling} target without sending the application token`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),foreign=[];
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)foreign.push({url:req.url(),body:req.postData()});
      return route.fulfill({contentType:'text/html',headers:{'access-control-allow-origin':origin},body:shell(url.origin===origin?'original':'unexpected')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    const target=(spelling==='absolute'?'https://other.invalid':spelling==='protocol-relative'?'//other.invalid':'/\\other.invalid')+
      (transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/');
    const outcome=Promise.race([
      page.waitForRequest(req=>new URL(req.url()).origin!==origin,{timeout:5000}).then(()=> 'foreign request'),
      page.locator('.cp-upload-notice').waitFor({timeout:5000}).then(()=> 'notice')
    ]);
    await page.evaluate(target=>window.redirectPost(target,{key:'fixture'}),target);
    assert.equal(await outcome,'notice');assert.deepEqual(foreign,[]);
    assert.equal(await page.locator('#marker').innerText(),'original');
    assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'fixture-token');
    assert.equal(await page.locator('[name=description]').inputValue(),'Preserve draft');
    assert.match(await page.locator('.cp-upload-notice').innerText(),/origin|address/i);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('cp-last-nav')?.includes('other.invalid')||false),false);
  }finally{await browser.close();}
});
for(const spelling of ['absolute','protocol-relative'])test(`same-origin ${spelling} native navigation still works`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    await page.route('**/*',route=>{
      const req=route.request();assert.equal(new URL(req.url()).origin,origin);
      if(req.method()==='POST')posts.push(Object.fromEntries(new URLSearchParams(req.postData())));
      return route.fulfill({contentType:'text/html',body:shell(req.method()==='POST'?'opened':'original')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(target=>window.redirectPost(target,{key:'fixture'}),(spelling==='absolute'?origin:'//apps-sbx.avpaas.io')+'/commpilot/User/DND/');
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='opened');
    assert.deepEqual(posts,[{key:'fixture',formtokenserial:'fixture-token'}]);
  }finally{await browser.close();}
});

test('list search rejects a foreign landing before sending its token or search criteria',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),foreign=[];
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)foreign.push({url:req.url(),body:req.postData()});
      return route.fulfill({contentType:'text/html',headers:{'access-control-allow-origin':origin},body:shell('original')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    const error=await page.evaluate(async()=>{
      try{await cpListSearch([{key:'User ID',value:'fixture-user'}],{ctx:{landing:'https://other.invalid/commpilot/Group/Members/',baseParams:{}}});return null;}
      catch(error){return error.message;}
    });
    assert.deepEqual(foreign,[]);assert.ok(error);
    assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'fixture-token');
  }finally{await browser.close();}
});
