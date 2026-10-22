const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',entry='/commpilot/Reseller/Groups/Modify/index.jsp';
const shell=(marker,token)=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="${token}"><table><tr><td width="82%"><p id="marker">${marker}</p></td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
for(const flow of ['direct','redirect'])for(const field of ['ordinary','submit','appendChild','parentNode','remove'])test(flow+' frame transport preserves a native field named '+field,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],errors=[];page.setDefaultTimeout(5000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,params:Object.fromEntries(new URLSearchParams(req.postData()||''))});
      if(flow==='redirect'&&url.pathname===entry)return route.fulfill({contentType:'text/html',body:
        `<html><body><input name="formtokenserial" value="token-${posts.length}"><script>redirectPost('/commpilot/Group/Profile/',{key:'Fixture',${field}:'native-value'});</script></body></html>`});
      return route.fulfill({contentType:'text/html',body:shell(req.method()==='POST'?'loaded-'+posts.length:'start','token-'+posts.length)});
    });
    await page.goto(origin+'/commpilot/Reseller/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(({entry,field,flow})=>redirectPost(entry,flow==='direct'?{key:'Fixture',[field]:'native-value'}:{key:'Fixture'}),{entry,field,flow});
    const count=flow==='direct'?1:2;
    await page.waitForFunction(count=>document.querySelector('#marker')?.textContent==='loaded-'+count,count);
    assert.equal(posts.length,count);assert.equal(posts.at(-1).params[field],'native-value');
    assert.equal(posts[0].params.formtokenserial,'token-0');
    assert.equal(await page.locator('iframe[name^=cpFrame],form[target^=cpFrame]').count(),0);
    await page.evaluate(()=>redirectPost('/commpilot/Group/Profile/',{}));
    await page.waitForFunction(count=>document.querySelector('#marker')?.textContent==='loaded-'+(count+1),count);
    assert.equal(posts[count].params.formtokenserial,'token-'+count,'the frame released ownership and retained its response token');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('a synchronous frame submit failure releases transport ownership and temporary nodes',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];page.setDefaultTimeout(5000);
    await page.route('**/*',route=>{
      const req=route.request();assert.equal(new URL(req.url()).origin,origin);
      if(req.method()==='POST')posts.push(req.url());
      return route.fulfill({contentType:'text/html',body:shell(req.method()==='POST'?'next':'start','fixture')});
    });
    await page.goto(origin+'/commpilot/Reseller/Profile/');
    await page.evaluate(()=>{
      const submit=HTMLFormElement.prototype.submit;window.nativeSubmitAttempts=0;
      HTMLFormElement.prototype.submit=function(){
        if((this.getAttribute('target')||'').startsWith('cpFrame')){
          window.nativeSubmitAttempts++;throw new TypeError('Synthetic native submit failure');
        }
        return submit.apply(this,arguments);
      };
    });
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(entry=>redirectPost(entry,{key:'Fixture'}),entry);
    await page.waitForFunction(()=>window.nativeSubmitAttempts===1);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('iframe[name^=cpFrame],form[target^=cpFrame]').count(),0);
    assert.equal(posts.length,0,'a failed local submission cannot have reached the PBX');
    assert.equal(await page.locator('#marker').innerText(),'start');
    assert.match(await page.locator('.cp-upload-notice').innerText(),/could not|failed/i);
    await page.evaluate(()=>redirectPost('/commpilot/Group/Profile/',{}));
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='next');
    assert.equal(posts.length,1);assert.equal(await page.evaluate(()=>nativeSubmitAttempts),1);
  }finally{await browser.close();}
});
