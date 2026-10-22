const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const paths=['/commpilot/User/Profile/','/commpilot/User/DND/','/commpilot/User/CLI/','/commpilot/User/Authentication/'];

for(const scenario of ['two Back actions','Back then a new click','save then Back and Forward']){
  test(scenario+' drains the dispatched request and keeps the final history location',async t=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    let release;
    try{
      const page=await browser.newPage(),posts=[],badTokens=[],errors=[],auth=[];
      let serial=0,holdNext=false,saves=0,held;
      page.setDefaultTimeout(7000);
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');
        assert.equal(url.origin,origin);
        if(/Login|Logout/.test(url.pathname))auth.push(url.pathname);
        if(req.method()==='POST'){
          posts.push({path:url.pathname,params:Object.fromEntries(params)});
          if(params.get('formtokenserial')!=='token-'+serial){
            badTokens.push({expected:serial,actual:params.get('formtokenserial')});
            return route.fulfill({status:409,body:'Unexpected stale token'});
          }
          serial++;
          if(params.has('apply'))saves++;
        }
        const responseSerial=serial;
        if(holdNext&&req.method()==='POST'){
          holdNext=false;
          const gate=new Promise(resolve=>{release=resolve;});
          held();await gate;
        }
        await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Overlap fixture</title></head><body>
          <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form><table><tr><td width="82%"><form name="mainForm">
          <input name="formtokenserial" value="token-${responseSerial}"><p id="marker">${url.pathname}</p>
          <input name="description" value="Fixture"><input name="apply" type="submit" value="Apply"></form></td></tr></table>
          <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
      });
      await page.goto(origin+paths[0]);
      await page.evaluate(()=>{
        window.fixtureDocument=document;window.fixturePops=0;
        window.addEventListener('popstate',()=>fixturePops++);
      });
      await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
      const settle=async target=>{
        await page.waitForFunction(target=>!document.documentElement.hasAttribute('data-cp-nav')&&
          location.pathname===target&&document.querySelector('#marker')?.textContent===target,target);
        assert.equal(await page.evaluate(()=>document===fixtureDocument),true);
        assert.equal(await page.locator('[name="formtokenserial"]').inputValue(),'token-'+serial);
      };
      const move=async target=>{await page.evaluate(target=>redirectPost(target,{}),target);await settle(target);};
      const traverse=async direction=>{
        const next=await page.evaluate(direction=>{const next=fixturePops+1;history.go(direction);return next;},direction);
        await page.waitForFunction(next=>fixturePops>=next,next);
      };
      for(const target of paths.slice(1))await move(target);
      const initialLength=await page.evaluate(()=>history.length),before=posts.length;
      const dispatched=new Promise(resolve=>{held=resolve;});holdNext=true;
      if(scenario==='save then Back and Forward'){
        await page.evaluate(target=>redirectPost(target,{apply:'Apply',description:'Changed once'}),paths[3]);
        await dispatched;
        await traverse(-1);await traverse(1);
      }else{
        await traverse(-1);await dispatched;
        if(scenario==='two Back actions')await traverse(-1);
        else await page.evaluate(target=>redirectPost(target,{}),paths[0]);
      }
      // A queued navigation must not race the single-use token of the held response.
      await page.waitForTimeout(80);
      assert.equal(posts.length,before+1);
      release();release=null;
      const target=scenario==='two Back actions'?paths[1]:scenario==='Back then a new click'?paths[0]:paths[3];
      await settle(target);
      assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);assert.deepEqual(auth,[]);
      assert.equal(saves,scenario==='save then Back and Forward'?1:0);
      assert.equal(await page.evaluate(()=>history.length),initialLength);
      // Walk forward/back again to detect an entry overwritten during the overlap.
      if(scenario==='two Back actions'){
        await traverse(1);await settle(paths[2]);await traverse(1);await settle(paths[3]);
      }else if(scenario==='save then Back and Forward'){
        await traverse(-1);await settle(paths[2]);await traverse(1);await settle(paths[3]);
        assert.equal(saves,1);
      }
      assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);assert.deepEqual(auth,[]);
      t.diagnostic(JSON.stringify({scenario,posts:posts.length,saves}));
    }finally{if(release)release();await browser.close();}
  });
}
