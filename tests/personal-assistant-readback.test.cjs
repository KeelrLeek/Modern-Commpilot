const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',list='/commpilot/User/PersonalAssistant/';
const shell=(content,token='token-0')=>`<html><head><title>Personal Assistant</title></head><body>
  <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><input name="formtokenserial" value="${token}">
  <table><tr><td width="82%">${content}</td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
for(const mode of ['add-exact','add-near-match','add-error','add-missing','delete-near-match','delete-remains','delete-error','delete-paged','delete-empty','delete-incomplete','delete-network','delete-http','delete-auth'])
test(`Personal Assistant verifies exact saved state (${mode})`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage();let writes=0,reads=0,readToken;
    const adding=mode.startsWith('add-'),editor=list+(adding?'Add':'Modify')+'/index.jsp';
    const action=adding?'ok':'delete';
    const confirmed=mode==='add-exact'||mode==='delete-near-match'||mode==='delete-empty';
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST'&&url.pathname===editor&&new URLSearchParams(req.postData()).has(action)){
        writes++;
        return route.fulfill({contentType:'text/html',body:adding?'<script>top.location.replace("../");</script>':shell('<div class="error">Invalid selective criteria name Sales</div>','token-1')});
      }
      if(req.method()==='POST'&&url.pathname===list){
        reads++;readToken=new URLSearchParams(req.postData()).get("formtokenserial");
        if(mode==='delete-network')return route.abort('failed');
        if(mode==='delete-http')return route.fulfill({status:503,body:'Unavailable'});
        if(mode==='delete-auth')return route.fulfill({contentType:'text/html',body:'<html><head><title>Login</title></head><body><input name="formtokenserial" value="login-token"></body></html>'});
        const row=mode==='add-exact'||mode==='delete-remains'?'Sales':mode.includes('near-match')?'Sales2':'Other';
        const content='<h1>Personal Assistant</h1><input type="button" name="add" value="Add">'+
          (mode.endsWith('error')?`<span class="Failure">${adding?'Cannot read Sales settings.':'Cannot load settings.'}</span>`:
          mode==='delete-empty'?'<table><tr><td>No Entries Present</td></tr></table>':
          mode==='delete-incomplete'?'':
          `<table id="searchTable"><tr id="Row0"><td>${row}</td></tr></table>${mode==='delete-paged'?'Page 1 of 2':''}`);
        return route.fulfill({contentType:'text/html',body:shell(content,'token-2')});
      }
      return route.fulfill({contentType:'text/html',body:shell(url.pathname===list?'<h1>Personal Assistant</h1><input type="button" name="add" value="Add">':`<form name="mainForm" method="post"><input name="criteriaName" value="Sales"><input type="submit" name="${action}" value="${action}"></form>`)});
    });
    await page.goto(origin+list);await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(editor=>redirectPost(editor,{}),editor);
    await page.locator(`[name="${action}"]`).click();
    await page.waitForFunction(list=>location.pathname===list||document.querySelector('.cp-upload-notice'),list,{timeout:6000});
    assert.equal(writes,1);assert.equal(reads,1);assert.equal(readToken,adding?"token-0":"token-1","readback uses the latest save response token");
    assert.equal(await page.locator('[name=formtokenserial]').inputValue(),['delete-network','delete-http','delete-auth'].includes(mode)?'token-1':'token-2','readback retains the latest application token even if verification fails');
    if(confirmed){assert.equal(new URL(page.url()).pathname,list);assert.equal(await page.locator('.cp-upload-notice').count(),0);}
    else{assert.equal(new URL(page.url()).pathname,editor);assert.match(await page.locator('.cp-upload-notice').innerText(),/could not|not be verified/i);}
  }finally{await browser.close();}
});
