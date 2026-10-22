const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const shell=(marker,token)=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="${token}"><table><tr><td width="82%"><form name="mainForm">
  <p id="marker">${marker}</p><input name="description" value="Preserve draft"></form></td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
for(const transport of ['fetch','frame'])for(const mode of ['at-limit','loop'])
test(`${transport} ${mode} redirect chain has a bounded request count without a new login check`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage();let posts=0,checks=0;
    const entry=transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/';
    const stub=(target,token)=>`<html><body><input name="formtokenserial" value="${token}"><script>redirectPost('${target}',{key:'fixture'});</script></body></html>`;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(url.pathname==='/commpilot/servlet/Login'){checks++;return route.fulfill({contentType:'text/html',body:stub('/commpilot/Common/folder_contents.jsp','harvest-token')});}
      if(req.method()==='POST'){
        posts++;
        return route.fulfill({contentType:'text/html',body:mode==='at-limit'&&posts===5?shell('loaded','token-'+posts):stub(entry,'token-'+posts)});
      }
      return route.fulfill({contentType:'text/html',body:shell('original','token-0')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(entry=>redirectPost(entry,{key:'fixture'}),entry);
    await page.waitForFunction(()=>document.querySelector('#marker')?.textContent==='loaded'||document.querySelector('.cp-upload-notice'),null,{timeout:12000});
    assert.equal(posts,5,'do not repeat the entire failed chain');assert.equal(checks,0,'a redirect limit is not an authentication failure');
    assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'token-5');
    if(mode==='loop'){
      assert.equal(await page.locator('#marker').innerText(),'original');
      assert.equal(await page.locator('[name=description]').inputValue(),'Preserve draft');
      assert.match(await page.locator('.cp-upload-notice').innerText(),/redirect/i);
    }
    assert.equal(await page.locator('iframe[name^=cpFrame],form[target^=cpFrame]').count(),0);
  }finally{await browser.close();}
});
