const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const shell=marker=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture"><table><tr><td width="82%"><form name="mainForm"><p id="marker">${marker}</p>
  <input name="description" value="Keep draft"></form></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
for(const action of ['apply','save','submit'])test('a native '+action+' action with a lost response is never resent',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST'){
        posts.push(Object.fromEntries(new URLSearchParams(req.postData()||'')));
        if(posts.length===1)return route.abort('connectionreset');
      }
      return route.fulfill({contentType:'text/html',body:shell(req.method()==='POST'?'resent':'start')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(action=>redirectPost('/commpilot/User/Profile/',{[action]:'Save',description:'Native value'}),action);
    await page.waitForFunction(()=>document.querySelector('.cp-upload-notice')||document.querySelector('#marker')?.textContent==='resent');
    await page.waitForTimeout(350);
    assert.equal(posts.length,1,'an accepted native write cannot be retried when only its response was lost');
    assert.equal(posts[0][action],'Save');
    assert.match(await page.locator('.cp-upload-notice').innerText(),/save.*not.*confirmed|not sent again/i);
    assert.equal(await page.locator('[name="description"]').inputValue(),'Keep draft');
  }finally{await browser.close();}
});

for(const action of ['save','submit','buttonClicked:Save','buttonClicked:Submit'])test('history never replays a successful native '+action+' action',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage();let writes=0;
    const [key,button]=action.split(':'),params={[key]:button||'Save',description:'New value'};
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url()),data=new URLSearchParams(req.postData()||'');assert.equal(url.origin,origin);
      if(req.method()==='POST'&&(data.has('save')||data.has('submit')||data.get('buttonClicked')))writes++;
      const marker=url.pathname.endsWith('/DND/')?'DND'+(writes?' saved':''):'Profile';
      return route.fulfill({contentType:'text/html',body:shell(marker)});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>redirectPost('/commpilot/User/DND/',{}));
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='DND');
    const length=await page.evaluate(()=>history.length);
    await page.evaluate(params=>redirectPost('/commpilot/User/DND/',params),params);
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='DND saved');
    assert.equal(await page.evaluate(()=>history.length),length,'a write replaces the current navigation entry');
    await page.evaluate(()=>history.back());
    await page.waitForFunction(()=>location.pathname==='/commpilot/User/Profile/'&&document.querySelector('#marker')?.textContent==='Profile');
    await page.evaluate(()=>history.forward());
    await page.waitForFunction(()=>location.pathname==='/commpilot/User/DND/'&&document.querySelector('#marker')?.textContent==='DND saved');
    assert.equal(writes,1);
  }finally{await browser.close();}
});
