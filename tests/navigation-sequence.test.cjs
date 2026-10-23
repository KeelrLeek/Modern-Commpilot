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

// CommPilot answers a save slowly. A repeated OK/Apply/Enter must not queue the same save behind it: the queued
// copy would carry the token the first response rotated in, so CommPilot would accept it a second time.
async function slowSaves({signOut=false}={}){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage(),posts=[],badTokens=[],errors=[],server={token:0,fail:false,hold:false,delay:700,answered:0};
  page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');
    assert.equal(url.origin,origin);
    let marker=url.pathname;
    if(req.method()==='POST'){
      posts.push({path:url.pathname,params:Object.fromEntries(params),at:Date.now()});
      if(params.get('formtokenserial')!=='token-'+server.token){
        badTokens.push(params.get('formtokenserial'));
        return route.fulfill({status:409,body:'Fixture token mismatch'});
      }
      if(params.has('ok')||params.has('apply')){
        if(server.hold===true)await new Promise(()=>{});   // CommPilot never answers this save
        await (server.hold||new Promise(resolve=>setTimeout(resolve,server.delay)));
        if(server.fail){server.fail=false;return route.fulfill({status:500,body:'Fixture server error'});}
        marker='saved '+posts.length;
        server.answered=Date.now();
      }
      server.token++;
    }
    // The native header [Logout] link, confirmed in logout-confirm.js's dialog.
    const header=signOut?`<table><tr><td class="headerBar"><span class="headerBarWelcome">Welcome Fixture</span>
      <a class="headerLink" id="native-logout" onclick="redirectPost('/commpilot/servlet/Logout', {});return false;">[Logout]</a></td></tr></table>`:'';
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Save fixture</title></head><body${signOut?' id="initBody.menuTemplate"':''}>${header}
      <form name="leftNavForm"><a class="leftnavfolder">Profile</a></form><table><tr><td width="82%"><form name="mainForm" method="post">
      <input name="formtokenserial" value="token-${server.token}"><p id="marker">${marker}</p><input name="phoneNumber" value="2025550123">
      <input name="ok" type="submit" value="OK"><input name="apply" type="submit" value="Apply"></form></td></tr></table>
      <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
  });
  await page.goto(origin+routes[0]);
  await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
  if(signOut)await page.addScriptTag({path:path.join(runtime,'src/content/logout-confirm.js')});
  const settle=async()=>{
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cp-nav'));
    await page.waitForTimeout(900);   // a queued repeat would be sent once the first response arrives
  };
  const writes=()=>posts.filter(post=>post.params.ok||post.params.apply);
  return {browser,page,posts,badTokens,errors,server,settle,writes};
}

for(const gesture of ['double-click','Enter twice','OK then Apply'])test(`${gesture} while a save is pending sends the save once`,async()=>{
  const f=await slowSaves();
  try{
    if(gesture==='double-click')await f.page.locator('input[name="ok"]').dblclick();
    else if(gesture==='Enter twice'){
      await f.page.locator('input[name="phoneNumber"]').press('Enter');
      await f.page.waitForTimeout(150);
      await f.page.locator('input[name="phoneNumber"]').press('Enter');
    }else{
      await f.page.locator('input[name="ok"]').click();
      await f.page.waitForTimeout(150);
      await f.page.locator('input[name="apply"]').click();
    }
    await f.settle();
    assert.equal(f.writes().length,1,'one gesture sends one save');
    assert.equal(await f.page.locator('#marker').textContent(),'saved 1','the first save’s response is shown');
    assert.deepEqual(f.badTokens,[]);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}
});

test('a failed save can be sent again, and other navigation still overtakes a pending save',async()=>{
  const f=await slowSaves();
  try{
    f.server.fail=true;
    await f.page.locator('input[name="ok"]').click();
    await f.page.locator('.cp-alert').waitFor();
    await f.settle();
    await f.page.locator('input[name="ok"]').click();
    await f.settle();
    assert.equal(f.writes().length,2,'the save is free again after its failure');
    assert.equal(await f.page.locator('#marker').textContent(),'saved 2');
    const before=f.posts.length;
    await f.page.locator('input[name="apply"]').click();
    await f.page.waitForTimeout(150);
    await f.page.evaluate(target=>redirectPost(target,{}),routes[1]);
    await f.page.waitForFunction(target=>document.querySelector('#marker')?.textContent===target&&location.pathname===target,routes[1]);
    assert.deepEqual(f.posts.slice(before).map(post=>post.path),[routes[0],routes[1]],'the newer page waits for the save, then opens');
    assert.deepEqual(f.badTokens,[]);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}
});

// Sign out confirmed while a save waits for CommPilot. Like a newer click, the sign-out waits for the save's answer
// and posts the token it brought, once; the save is never sent again. One that never answers leaves the sign-out
// unconfirmed and retryable instead of posting the token that save already spent.
const signOutDuringSave=async f=>{
  await f.page.locator('input[name="ok"]').click();
  await f.page.waitForTimeout(150);
  await f.page.locator('#native-logout').click();
  await f.page.getByRole('button',{name:'Sign out',exact:true}).click();
};
const logouts=f=>f.posts.filter(post=>post.path==='/commpilot/servlet/Logout');

test('Sign out while a save is pending signs out after the save answers, with its new token',async()=>{
  const f=await slowSaves({signOut:true});
  try{
    f.server.delay=2000;
    await signOutDuringSave(f);
    await f.page.waitForURL(origin+'/commpilot/Login/');
    assert.equal(f.writes().length,1,'the save is sent once');
    assert.equal(logouts(f).length,1,'one sign-out request');
    assert.ok(f.server.answered&&logouts(f)[0].at>=f.server.answered,'the sign-out waits for the save’s answer');
    assert.equal(logouts(f)[0].params.formtokenserial,'token-1','the sign-out carries the token the save’s answer brought');
    assert.deepEqual(f.badTokens,[]);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}
});

test('Sign out while a save never answers sends no sign-out and offers Retry',async()=>{
  const f=await slowSaves({signOut:true});
  try{
    f.server.hold=true;
    await signOutDuringSave(f);
    await f.page.getByRole('button',{name:'Retry sign out',exact:true}).waitFor({timeout:12000});
    assert.match(await f.page.locator('.cp-native-logout-copy').innerText(),/still running.*not confirmed/);
    assert.deepEqual(f.posts.map(post=>post.path),[routes[0]],'only the save was sent');
    assert.equal(new URL(f.page.url()).pathname,routes[0]);
    assert.deepEqual(f.badTokens,[]);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}
});

// A click that waits behind a slower save gives up after about 5 s without sending anything. The save keeps the
// page: its loading line stays, a repeated OK is still ignored, and its own response or error is shown.
for(const fail of [false,true])test(`a click that gives up behind a slow save leaves the page to that save${fail?' (server error)':''}`,async()=>{
  const f=await slowSaves();
  let release;
  f.server.hold=new Promise(resolve=>{release=resolve;});f.server.fail=fail;
  try{
    await f.page.clock.install();
    const sent=f.page.waitForRequest(req=>new URLSearchParams(req.postData()||'').has('ok'));
    await f.page.locator('input[name="ok"]').click();
    await sent;
    await f.page.evaluate(target=>redirectPost(target,{}),routes[1]);
    await f.page.clock.runFor(5400);
    assert.match(await f.page.locator('.cp-upload-notice').textContent(),/previous.*request.*still running/i);
    assert.equal(await f.page.evaluate(()=>document.documentElement.getAttribute('data-cp-nav')),'busy','the save keeps the loading line');
    await f.page.locator('input[name="ok"]').click();
    release();
    if(fail)await f.page.locator('.cp-alert[data-cp-nav-error]').waitFor();
    else await f.page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='saved 1');
    await f.settle();
    assert.equal(f.writes().length,1,'the save is sent once');
    assert.deepEqual(f.posts.map(post=>post.path),[routes[0]],'the click that gave up sent nothing');
    assert.deepEqual(f.badTokens,[]);assert.deepEqual(f.errors,[]);
  }finally{release();await f.browser.close();}
});
