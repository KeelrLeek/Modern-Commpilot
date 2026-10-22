const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',entry='/commpilot/Reseller/Groups/Modify/index.jsp';
const shell=marker=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture"><table><tr><td width="82%"><p id="marker">${marker}</p><input name="description" value="Keep draft"></td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
for(const status of [403,500,503])for(const bodyType of ['stub','content'])test('frame HTTP '+status+' '+bodyType+' preserves the current page without redirecting or retrying',async t=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      requests.push({path:url.pathname,method:req.method()});
      if(url.pathname===entry)return route.fulfill({status,contentType:'text/html',body:bodyType==='content'?shell('error page'):
        '<html><body>Server error<script>redirectPost("/commpilot/Group/Profile/",{key:"Unexpected"});</script></body></html>'});
      return route.fulfill({contentType:'text/html',body:shell(url.pathname==='/commpilot/Reseller/Profile/'?'start':'unexpected redirect')});
    });
    await page.goto(origin+'/commpilot/Reseller/Profile/');
    await page.evaluate(()=>{
      window.frameStatuses=[];
      document.addEventListener('load',event=>{
        if(!event.target.matches?.('iframe[name^="cpFrame"]'))return;
        try{
          const frame=event.target.contentWindow;
          if(frame.location.href!=='about:blank')frameStatuses.push({path:frame.location.pathname,status:frame.performance.getEntriesByType('navigation')[0]?.responseStatus??null});
        }catch{}
      },true);
    });
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(entry=>redirectPost(entry,{key:'Fixture'}),entry);
    await page.waitForFunction(()=>document.querySelector('[data-cp-nav-error]')||document.querySelector('#marker')?.textContent!=='start');
    t.diagnostic('frame status observations '+JSON.stringify(await page.evaluate(()=>frameStatuses)));
    assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>r.path),[entry]);
    assert.equal(await page.locator('#marker').innerText(),'start');
    assert.equal(await page.locator('[name="description"]').inputValue(),'Keep draft');
    assert.match(await page.locator('[data-cp-nav-error]').innerText(),new RegExp('HTTP '+status));
    assert.equal(requests.some(r=>/\/(?:Login|Logout|servlet\/Login)\/?$/.test(r.path)),false);
    assert.equal(await page.locator('iframe[name^=cpFrame],form[target^=cpFrame]').count(),0);
  }finally{await browser.close();}
});

for(const mode of ['missing','throws'])test('successful frame navigation still works when response status is '+mode,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>{
      assert.equal(new URL(route.request().url()).origin,origin);
      return route.fulfill({contentType:'text/html',body:shell(route.request().method()==='POST'?'loaded':'start')});
    });
    await page.goto(origin+'/commpilot/Reseller/Profile/');
    await page.evaluate(mode=>{
      window.statusSuppressed=false;
      document.addEventListener('load',event=>{
        if(!event.target.matches?.('iframe[name^="cpFrame"]'))return;
        const frame=event.target.contentWindow;
        if(frame.location.href==='about:blank')return;
        Object.defineProperty(frame.PerformanceResourceTiming.prototype,'responseStatus',{configurable:true,get(){
          if(mode==='throws')throw new Error('Synthetic unsupported timing getter');
          return undefined;
        }});
        window.statusSuppressed=true;
      },true);
    },mode);
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(entry=>redirectPost(entry,{key:'Fixture'}),entry);
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='loaded');
    assert.equal(await page.evaluate(()=>statusSuppressed),true);
    assert.equal(await page.locator('[data-cp-nav-error],.cp-upload-notice,iframe[name^=cpFrame],form[target^=cpFrame]').count(),0);
  }finally{await browser.close();}
});

for(const save of [false,true])test('explicit frame HTTP 401 '+(save?'does not replay a write':'still opens sign-in'),async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);requests.push({path:url.pathname,method:req.method()});
      if(url.pathname===entry)return route.fulfill({status:401,contentType:'text/html',body:'<html><body>Unauthorized</body></html>'});
      if(url.pathname==='/commpilot/Login/')return route.fulfill({contentType:'text/html',body:'<html><head><title>Login</title></head><body>Sign in</body></html>'});
      return route.fulfill({contentType:'text/html',body:shell('start')});
    });
    await page.goto(origin+'/commpilot/Reseller/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(({entry,save})=>redirectPost(entry,save?{key:'Fixture',apply:'Apply'}:{key:'Fixture'}),{entry,save});
    if(save){
      await page.locator('.cp-upload-notice').waitFor();
      assert.match(await page.locator('.cp-upload-notice').innerText(),/save.*not.*confirmed|not sent again/i);
      assert.equal(await page.locator('#marker').innerText(),'start');
    }else await page.waitForURL(origin+'/commpilot/Login/');
    assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>r.path),[entry]);
    assert.equal(requests.some(r=>r.path==='/commpilot/servlet/Login'),false,'an explicit HTTP 401 needs no speculative recovery request');
  }finally{await browser.close();}
});
