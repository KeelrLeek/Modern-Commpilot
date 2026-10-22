const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const root=path.resolve(__dirname,'..'), origin='https://apps-sbx.avpaas.io';
const pjaxPath=process.env.BW_TEST_PJAX_PATH||path.join(root,'src/content/pjax.js');
const initial='/commpilot/User/Profile/', target='/commpilot/User/DND/';
const shell=token=>`<!doctype html><html><head><title>Settings</title></head><body>
  <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <table><tr><td width="82%"><form name="mainForm" method="post">
  <input type="hidden" name="formtokenserial" value="${token}"><input name="draft" value="Fixture draft">
  <table><tr><td class="screenName">Settings</td></tr></table></form></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;

for(const {navigated,start} of [{navigated:false,start:initial},
  {navigated:false,start:'/commpilot/User/OutgoingCallingPlan/?TransferForward=1&isEnh=true'},
  {navigated:true,start:initial}]) {
  test(`in-shell reload ${navigated?'after navigation':'on '+start} preserves its location and history depth`,async()=>{
    const browser=await chromium.launch({executablePath,headless:true});
    try{
      const page=await browser.newPage(),posts=[];
      await page.route(origin+'/**',route=>{
        if(route.request().method()==='POST'){
          const url=new URL(route.request().url());posts.push(url.pathname+url.search);
        }
        return route.fulfill({contentType:'text/html',body:shell('token-'+posts.length)});
      });
      await page.goto(origin+start);
      await page.addScriptTag({path:pjaxPath});
      if(navigated){
        await page.evaluate(url=>redirectPost(url,{}),target);
        await page.waitForFunction(()=>document.querySelector('[name=formtokenserial]').value==='token-1');
      }
      const depth=await page.evaluate(()=>history.length),count=posts.length;
      await page.keyboard.press('F5');
      await page.waitForFunction(n=>document.querySelector('[name=formtokenserial]').value==='token-'+n,count+1);
      assert.equal(posts.at(-1),navigated?target:start,'refresh must preserve its native location and query');
      assert.equal(await page.evaluate(()=>history.length),depth,'refresh must replace the current entry');
      assert.equal(posts.length,count+1,'one refresh sends one read');
    }finally{await browser.close();}
  });
}

test('a failed reload does not make a later ordinary navigation replace history',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();let fail=false,count=0;
    await page.route(origin+'/**',route=>{
      if(route.request().method()==='POST')count++;
      return route.fulfill({status:fail?403:200,contentType:'text/html',body:fail?'Forbidden':shell('token-'+count)});
    });
    await page.goto(origin+initial);
    await page.addScriptTag({path:pjaxPath});
    await page.evaluate(url=>redirectPost(url,{}),target);
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cp-nav') &&
      document.querySelector('[name=formtokenserial]').value==='token-1');
    const depth=await page.evaluate(()=>history.length);
    fail=true;
    const rejected=page.waitForResponse(response=>response.status()===403);
    await page.keyboard.press('F5');
    await rejected;
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cp-nav'));
    fail=false;
    await page.evaluate(url=>redirectPost(url,{}),target);
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cp-nav') &&
      document.querySelector('[name=formtokenserial]').value==='token-3');
    assert.equal(await page.evaluate(()=>history.length),depth+1,'the failed refresh must release its replace-history flag');
  }finally{await browser.close();}
});

test('a queued reload does not override a newer navigation while the earlier request drains',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  let release;
  try{
    const page=await browser.newPage(),posts=[],other='/commpilot/User/CallForwardingAlways/';
    const gate=new Promise(resolve=>{release=resolve;});
    await page.route(origin+'/**',async route=>{
      const request=route.request();
      if(request.method()==='POST'){
        posts.push(new URL(request.url()).pathname);
        if(posts.length===1)await gate;
      }
      await route.fulfill({contentType:'text/html',body:shell('token-'+posts.length)});
    });
    await page.goto(origin+initial);
    await page.addScriptTag({path:pjaxPath});
    const requestReady=page.waitForRequest(req=>req.method()==='POST');
    await page.evaluate(url=>{redirectPost(url,{});},target);
    await requestReady;
    await page.keyboard.press('F5');
    await page.evaluate(url=>{redirectPost(url,{});},other);
    release();
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cp-nav') &&
      Number(document.querySelector('[name=formtokenserial]').value.split('-')[1])>=2);
    assert.deepEqual(posts,[target,other],'the newer click owns the pending navigation');
    assert.equal(new URL(page.url()).pathname,other);
  }finally{release?.();await browser.close();}
});
