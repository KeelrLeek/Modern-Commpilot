const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const destination='/commpilot/Group/Profile/';
const shell = marker => `<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%"><form name="mainForm">
  <p id="marker">${marker}</p></form></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;

for(const transport of ['fetch','frame']) for(const encoding of ['unicode','escaped-quote','other-quote','literal-backslash'])
test(`${transport} native redirect preserves ${encoding} in the entity key`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    const first=transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/';
    const literal=encoding==='unicode'?String.raw`'Provider\u003E\u0025User\u0040phonenetwork.net'`:
      encoding==='escaped-quote'?String.raw`'Provider>%O\'Brien'`:
      encoding==='other-quote'?`"Provider>%O'Brien"`:String.raw`'Provider>%literal\\u0040'`;
    const expected=encoding==='unicode'?'Provider>%User@phonenetwork.net':encoding==='literal-backslash'?String.raw`Provider>%literal\u0040`:"Provider>%O'Brien";
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,data:Object.fromEntries(new URLSearchParams(req.postData()))});
      if(url.pathname===first)return route.fulfill({contentType:'text/html',body:`<html><body><input name="formtokenserial" value="stub-token"><script>redirectPost('${destination}',{key:${literal},P_key:${literal}});</script></body></html>`});
      return route.fulfill({contentType:'text/html',body:shell(url.pathname===destination?'done':'start')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(first=>redirectPost(first,{}),first);
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='done',null,{timeout:6000});
    assert.equal(posts.length,2);
    assert.deepEqual(posts[1].data,{key:expected,P_key:expected,formtokenserial:'stub-token'});
  }finally{await browser.close();}
});
