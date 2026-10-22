const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const routes=['/commpilot/User/Profile/','/commpilot/User/DND/','/commpilot/User/CLI/','/commpilot/User/Authentication/'];

test('mixed navigation, rapid clicks, history and explicit saves preserve tokens and never replay a save',async t=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],badTokens=[],errors=[],auth=[],saves=new Map();
    let token=0,seed=0x12345678;
    const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
    const steps=Math.max(1,Number(process.env.BW_NAV_SEQUENCE_STEPS)||80);
    page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');
      assert.equal(url.origin,origin);
      if(/Login|Logout/.test(url.pathname))auth.push(url.pathname);
      if(req.method()==='POST'){
        posts.push({path:url.pathname,params:Object.fromEntries(params)});
        if(params.get('formtokenserial')!=='fixture-'+token){
          badTokens.push({path:url.pathname,expected:token,actual:params.get('formtokenserial')});
          return route.fulfill({status:409,body:'Fixture token mismatch'});
        }
        token++;
        const id=params.get('fixtureSaveId');
        if(params.has('apply'))saves.set(id,(saves.get(id)||0)+1);
        await new Promise(resolve=>setTimeout(resolve,params.has('apply')?70:7*(posts.length%5)));
      }
      return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Navigation fixture</title></head><body>
        <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form><table><tr><td width="82%"><form name="mainForm">
        <input name="formtokenserial" value="fixture-${token}"><p id="marker">${url.pathname}</p>
        <input name="description" value="Fixture"><input name="apply" type="submit" value="Apply"></form></td></tr></table>
        <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
    });
    await page.goto(origin+routes[0]);
    await page.evaluate(()=>{
      window.fixtureDocument=document;window.fixtureHistory=[location.href];window.fixtureIndex=0;window.fixturePops=0;
      window.addEventListener('popstate',()=>fixturePops++);
      const push=history.pushState,replace=history.replaceState;
      history.pushState=function(...args){
        const result=push.apply(this,args);fixtureHistory.splice(fixtureIndex+1);fixtureHistory.push(location.href);fixtureIndex++;
        return result;
      };
      history.replaceState=function(...args){const result=replace.apply(this,args);fixtureHistory[fixtureIndex]=location.href;return result;};
    });
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    const settle=async target=>{
      await page.waitForFunction(target=>!document.documentElement.hasAttribute('data-cp-nav')&&
        document.querySelector('#marker')?.textContent===target&&location.pathname===target,target);
      assert.equal(await page.evaluate(()=>document===fixtureDocument),true,'navigation stays in the original document');
      assert.deepEqual(badTokens,[]);
      assert.equal(await page.locator('[name="formtokenserial"]').inputValue(),'fixture-'+token);
    };
    const move=async target=>{await page.evaluate(target=>redirectPost(target,{}),target);await settle(target);};
    await move(routes[1]);
    const expectedSaves=[];
    for(let step=0;step<steps;step++){
      const mode=random(5),current=await page.evaluate(()=>location.pathname);
      let target=routes[random(routes.length)];
      if(target===current)target=routes[(routes.indexOf(target)+1)%routes.length];
      if(mode===0){await move(target);}
      else if(mode===1){
        await page.evaluate(({routes,target})=>{redirectPost(routes[0],{});redirectPost(routes[2],{});redirectPost(target,{});},{routes,target});
        await settle(target);
      }else if(mode===2){
        const id='save-'+step;expectedSaves.push(id);
        const sent=page.waitForRequest(req=>req.method()==='POST'&&new URLSearchParams(req.postData()||'').get('fixtureSaveId')===id);
        await page.evaluate(({current,id})=>redirectPost(current,{apply:'Apply',description:'Fixture',fixtureSaveId:id}),{current,id});
        await sent;await move(target);
      }else{
        const direction=mode===3?-1:1;
        const historyTarget=await page.evaluate(direction=>{
          const next=fixtureIndex+direction;
          if(next<0||next>=fixtureHistory.length)return null;
          fixtureIndex=next;const target=new URL(fixtureHistory[next]).pathname,pop=fixturePops+1;
          history.go(direction);return {target,pop};
        },direction);
        if(historyTarget){
          await page.waitForFunction(pop=>fixturePops>=pop,historyTarget.pop);
          await settle(historyTarget.target);
        }else await move(target);
      }
      assert.deepEqual(errors,[]);assert.deepEqual(auth,[]);
    }
    assert.deepEqual([...saves.keys()].sort(),expectedSaves.sort());
    for(const [id,count] of saves)assert.equal(count,1,id+' is sent exactly once');
    assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);assert.deepEqual(auth,[]);
    t.diagnostic(JSON.stringify({steps,posts:posts.length,saves:saves.size,browser:path.basename(process.env.CHROME_PATH||'msedge.exe')}));
  }finally{await browser.close();}
});
