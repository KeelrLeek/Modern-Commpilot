const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const script=process.env.BW_TEST_PJAX_PATH||path.join(process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..'),'src/content/pjax.js');
const origin='https://apps-sbx.avpaas.io',start='/commpilot/User/MusicOnHold/',next='/commpilot/User/DND/',servlet='/commpilot/servlet/MusicOnHoldUserServlet';

for(const scenario of ['superseded redirect','superseded validation page','validation then navigation','normal redirect']){
  test('multipart response retains its fresh token: '+scenario,async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    let release;
    try{
      const page=await browser.newPage(),posts=[],badTokens=[],auth=[],errors=[];
      let serial=0,started;
      const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
      page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
      const shell=(pathname,token)=>`<!doctype html><html><head><title>Upload fixture</title></head><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><table><tr><td width="82%">
        <form name="mainForm" method="post" enctype="multipart/form-data" action="${servlet}">
        <input name="formtokenserial" type="hidden" value="token-${token}"><p id="marker">${pathname}</p>
        <input name="description" value="Fixture draft"><input type="submit" name="apply" value="Apply"></form>
        </td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
        if(/Login|Logout/.test(url.pathname))auth.push(url.pathname);
        if(req.method()==='POST'){
          const value=url.pathname===servlet?/name="formtokenserial"\r?\n\r?\n([^\r\n]*)/.exec(req.postData()||'')?.[1]:new URLSearchParams(req.postData()||'').get('formtokenserial');
          posts.push({path:url.pathname,token:value});
          if(value!=='token-'+serial){badTokens.push({path:url.pathname,expected:serial,actual:value});return route.fulfill({status:409,body:'Stale fixture token'});}
          serial++;
        }
        const responseSerial=serial;
        if(url.pathname===servlet){
          started();await gate;
          const body=scenario.includes('validation')?
            shell(start,responseSerial).replace('<p id="marker">','<span class="Failure">Fixture validation failure</span><p id="marker">'):
            `<html><body><input name="formtokenserial" value="token-${responseSerial}"><script>redirectPost('${start}',{});</script></body></html>`;
          return route.fulfill({contentType:'text/html',body});
        }
        return route.fulfill({contentType:'text/html',body:shell(url.pathname,responseSerial)});
      });
      await page.goto(origin+start);await page.evaluate(()=>{window.fixtureDocument=document;});
      await page.addScriptTag({path:script});
      await page.locator('[name=apply]').click();await began;
      if(scenario.startsWith('superseded')){
        await page.evaluate(target=>redirectPost(target,{}),next);
        await page.waitForTimeout(70);assert.equal(posts.length,1,'navigation waits for the upload response');
      }
      const following=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===(scenario==='normal redirect'?start:next));
      release();release=null;
      if(scenario==='validation then navigation'){
        await page.locator('.cp-upload-notice').waitFor();
        await page.evaluate(target=>redirectPost(target,{}),next);
      }
      await following;
      await page.waitForFunction(()=>!window.cpHasPendingNativeRequest());
      assert.deepEqual(badTokens,[],'the upload response token must be retained even when its page is not shown');
      assert.deepEqual(posts.map(p=>p.path),[servlet,scenario==='normal redirect'?start:next]);
      assert.equal(await page.locator('#marker').textContent(),scenario==='normal redirect'?start:next);
      assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'token-'+serial);
      assert.equal(await page.evaluate(()=>document===fixtureDocument),true);
      assert.deepEqual(errors,[]);assert.deepEqual(auth,[]);
    }finally{if(release)release();await browser.close();}
  });
}

// A click or F5 that waits behind a slower upload gives up after about 5 s without sending anything. The upload
// keeps the page: its loading line stays, and its result still opens once, with no second upload.
for(const trigger of ['click','F5']){
  test('an upload outlasting a '+trigger+' that gives up still opens its result',async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    let release;
    try{
      const page=await browser.newPage(),posts=[],badTokens=[],errors=[];
      let serial=0,started;
      const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
      page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
      const shell=(pathname,token)=>`<!doctype html><html><head><title>Upload fixture</title></head><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><table><tr><td width="82%">
        <form name="mainForm" method="post" enctype="multipart/form-data" action="${servlet}">
        <input name="formtokenserial" type="hidden" value="token-${token}"><p id="marker">${pathname}</p>
        <input name="description" value="Fixture draft"><input type="submit" name="apply" value="Apply"></form>
        </td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
        if(req.method()==='POST'){
          const value=url.pathname===servlet?/name="formtokenserial"\r?\n\r?\n([^\r\n]*)/.exec(req.postData()||'')?.[1]:new URLSearchParams(req.postData()||'').get('formtokenserial');
          posts.push(url.pathname);
          if(value!=='token-'+serial){badTokens.push({path:url.pathname,expected:serial,actual:value});return route.fulfill({status:409,body:'Stale fixture token'});}
          serial++;
        }
        const responseSerial=serial;
        if(url.pathname===servlet){
          started();await gate;
          return route.fulfill({contentType:'text/html',body:`<html><body><input name="formtokenserial" value="token-${responseSerial}"><script>redirectPost('${start}',{});</script></body></html>`});
        }
        return route.fulfill({contentType:'text/html',body:shell(url.pathname,responseSerial)});
      });
      await page.goto(origin+start);
      await page.addScriptTag({path:script});
      await page.clock.install();
      await page.locator('[name=apply]').click();await began;
      assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-cp-nav')),'busy','an upload shows the loading line');
      if(trigger==='F5')await page.keyboard.press('F5');
      else await page.evaluate(target=>redirectPost(target,{}),next);
      await page.clock.runFor(trigger==='F5'?7200:5400);
      assert.match(await page.locator('.cp-upload-notice').textContent(),/previous.*request.*still running/i);
      assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-cp-nav')),'busy','the upload keeps the loading line');
      release();release=null;
      await page.waitForFunction(()=>!window.cpHasPendingNativeRequest()&&!document.documentElement.hasAttribute('data-cp-nav'));
      assert.deepEqual(posts,[servlet,start],'the upload result opens, and nothing else is sent');
      assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'token-'+serial);
      assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);
    }finally{if(release)release();await browser.close();}
  });
}
