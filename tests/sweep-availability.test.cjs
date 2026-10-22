const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',list='/commpilot/Group/Members/';

for(const mode of ['disabled fieldset','disabled select','disabled option','disabled optgroup','enabled controls']){
  test('large search respects native '+mode,async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    try{
      const page=await browser.newPage(),posts=[],errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
        if(req.method()==='POST')posts.push(Object.fromEntries(new URLSearchParams(req.postData()||'')));
        const first='<option value="UserFirstName"'+(mode==='disabled option'?' disabled':'')+'>First Name</option>';
        const fields='<option value="UserID">User ID</option>'+(mode==='disabled optgroup'?'<optgroup label="Unavailable" disabled>'+first+'</optgroup>':first);
        const result=req.method()==='POST'?'<table><tr><td class="listHeader">User ID</td></tr><tr><td>No Entries Present</td></tr></table><p>[ Page 1 of 1 ]</p>':'<table><tr><td class="error">[Error 4027] Please narrow your search, there are 1001 matching records.</td></tr></table>';
        return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body>
          <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><table><tr><td width="82%">
          <form name="mainForm"><input name="formtokenserial" value="fixture-token" type="hidden"><input name="rowNum" value="0" type="hidden">
          <fieldset ${mode==='disabled fieldset'?'disabled':''}><table id="searchTable"><tr><td>
          <select name="findKey0" ${mode==='disabled select'?'disabled':''}>${fields}</select><select name="findOp0"><option value="STARTS_WITH">Starts With</option></select>
          <input name="findValue0"></td></tr></table></fieldset>${result}
          <script>function doPage(value){var p={returnPage:'/Group/Members/',tableName:'groupUserList',value:value};redirectPost('/commpilot/Common/page.jsp',p);}</script>
          </form></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
      });
      await page.goto(origin+list);await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
      if(mode==='disabled fieldset'||mode==='disabled select'){
        assert.equal(await page.locator('.cp-sweep-go').count(),0,'disabled native search cannot be bypassed by Load all');
        assert.equal(posts.length,0);
      }else{
        const sent=page.waitForRequest(req=>req.method()==='POST');
        await page.locator('.cp-sweep-go').click();await sent;
        await page.evaluate(()=>window.cpSweepStop());
        assert.ok(posts.length>0);
        assert.equal(posts[0].findKey0,mode==='enabled controls'?'UserFirstName':'UserID');
      }
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}
