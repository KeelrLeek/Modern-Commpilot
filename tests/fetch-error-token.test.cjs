const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const shell=(marker,token)=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
<input name="formtokenserial" value="${token}"><table><tr><td width="82%"><p id="marker">${marker}</p><input name="draft" value="Keep draft"></td></tr></table>
<script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;

for(const status of [400,403,500,503])test('fetch HTTP '+status+' retains its replacement token without following the error stub',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),requests=[];let serial=1;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');assert.equal(url.origin,origin);
      requests.push({path:url.pathname,method:req.method(),token:params.get('formtokenserial')});
      if(req.method()==='POST'){
        if(params.get('formtokenserial')!=='t'+serial)return route.fulfill({status:401,body:'Expired token'});
        serial++;
      }
      if(url.pathname==='/commpilot/User/DND/')return route.fulfill({status,contentType:'text/html',body:
        '<html><body><input name="formtokenserial" value="t'+serial+'">Server rejected this page<script>redirectPost("/commpilot/User/Unexpected/",{key:"wrong"});</script></body></html>'});
      if(url.pathname==='/commpilot/Login/')return route.fulfill({contentType:'text/html',body:'<html><body>Sign in</body></html>'});
      return route.fulfill({contentType:'text/html',body:shell(req.method()==='POST'?'next page':'start','t'+serial)});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>redirectPost('/commpilot/User/DND/',{}));
    await page.locator('[data-cp-nav-error]').waitFor();
    assert.equal(await page.locator('#marker').innerText(),'start');
    assert.equal(await page.locator('[name=draft]').inputValue(),'Keep draft');
    assert.match(await page.locator('[data-cp-nav-error]').innerText(),new RegExp('HTTP '+status));
    await page.evaluate(()=>redirectPost('/commpilot/User/Profile/',{}));
    await page.waitForFunction(()=>location.pathname==='/commpilot/Login/'||document.querySelector('#marker')?.textContent==='next page');
    assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>({path:r.path,token:r.token})),[
      {path:'/commpilot/User/DND/',token:'t1'},{path:'/commpilot/User/Profile/',token:'t2'}]);
    assert.equal(await page.locator('#marker').innerText(),'next page');
    assert.equal(requests.some(r=>/Login|Logout|Unexpected/.test(r.path)),false);
  }finally{await browser.close();}
});

test('an unreadable HTTP error body remains an HTTP failure and is not automatically retried',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),requests=[];
    await page.route('**/*',route=>{
      const req=route.request();assert.equal(new URL(req.url()).origin,origin);requests.push(req.url());
      return route.fulfill({contentType:'text/html',body:shell('start','t1')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.evaluate(()=>{
      const nativeFetch=window.fetch;window.errorFetches=0;
      window.fetch=function(url,options){
        if(String(url).includes('/User/DND/')){
          window.errorFetches++;
          const response=new Response(null,{status:503});
          response.text=()=>Promise.reject(new TypeError('Synthetic response body interruption'));
          return Promise.resolve(response);
        }
        return nativeFetch.call(this,url,options);
      };
    });
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>redirectPost('/commpilot/User/DND/',{}));
    await page.locator('[data-cp-nav-error]').waitFor();
    assert.match(await page.locator('[data-cp-nav-error]').innerText(),/HTTP 503/);
    assert.equal(await page.locator('#marker').innerText(),'start');
    assert.equal(await page.evaluate(()=>errorFetches),1);
    assert.equal(requests.some(url=>/Login|Logout/.test(url)),false);
  }finally{await browser.close();}
});

for(const transport of ['fetch','frame'])test('HTTP errors do not adopt authentication-form tokens over '+transport,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),requests=[];
    const target=transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/';
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);requests.push(url.pathname);
      if(req.method()==='POST')return route.fulfill({status:403,contentType:'text/html',body:
        '<html><head><title>CommPilot Login</title></head><body><form action="/commpilot/Login/"><input type="password"><input name="formtokenserial" value="authentication-token"></form></body></html>'});
      return route.fulfill({contentType:'text/html',body:shell('start','application-token')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(target=>redirectPost(target,{key:'Fixture'}),target);
    await page.locator('[data-cp-nav-error]').waitFor();
    assert.match(await page.locator('[data-cp-nav-error]').innerText(),/HTTP 403/);
    assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'application-token');
    assert.equal(await page.locator('#marker').innerText(),'start');
    assert.deepEqual(requests,['/commpilot/User/Profile/',target]);
  }finally{await browser.close();}
});
