const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',list='/commpilot/Group/Members/';

for(const mode of ['unknown total','unknown total with ID fallback','failed range with unknown total','known total','atomic reveal']){
  test('large search completion: '+mode,async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    try{
      const page=await browser.newPage(),errors=[],badTokens=[];let serial=0,failures=0;
      page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');
        assert.equal(url.origin,origin);assert.equal(url.pathname,list);
        const value=params.get('findValue0')||'',op=params.get('findOp0')||'STARTS_WITH';
        if(req.method()==='POST'){
          if(params.get('formtokenserial')!=='token-'+serial){badTokens.push(params.get('formtokenserial'));return route.fulfill({status:409,body:'Stale token'});}
          if(mode==='failed range with unknown total'&&value==='a'){
            failures++;return route.fulfill({status:503,body:'Synthetic unavailable range'});
          }
          serial++;
        }
        const idFallback=mode==='unknown total with ID fallback';
        const people=(idFallback?['Alice','Bob','Émile']:['Alice','Bob']).map((name,i)=>({name,id:(1000+i)+'@fixture.test'}));
        const rows=people.filter(person=>{
          const field=params.get('findKey0')==='UserID'?person.id:person.name.toLowerCase();
          return value&&(op==='EQUAL_TO'?field===value:field.startsWith(value));
        });
        const unknown=mode.includes('unknown');
        const message=!value?'<td class="error"><span class="Failure">[Error 4027] Please narrow your search'+(unknown?'':', there are 2 matching records')+'.</span></td>':'';
        const results=value?`<table><tbody><tr><td class="listHeader">User ID</td><td class="listHeader">First Name</td></tr>${rows.map((person,i)=>`<tr id="Row${i+1}"><td><a class="tableLink" id="Row${i+1}Col0">${person.id}</a></td><td><a class="tableLink">${person.name}</a></td></tr>`).join('')||'<tr><td>No Entries Present</td></tr>'}</tbody></table><p>[ Page 1 of 1 ]</p>`:'';
        return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body>
          <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><table><tr><td width="82%">
          <form name="mainForm"><input name="formtokenserial" value="token-${serial}" type="hidden"><input name="rowNum" value="0" type="hidden">
          <table id="searchTable"><tr><td><select name="findKey0"><option value="UserFirstName">First Name</option>${idFallback?'<option value="UserID">User ID</option>':''}</select>
          <select name="findOp0"><option value="STARTS_WITH">Starts With</option></select><input name="findValue0" value=""></td></tr></table>
          <table><tr>${message}</tr></table>${results}
          <script>function doPage(value){var p={returnPage:'/Group/Members/',tableName:'groupUserList',value:value};redirectPost('/commpilot/Common/page.jsp',p);}</script>
          </form></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
      });
      await page.goto(origin+list);
      await page.evaluate(()=>{
        window.fixtureRowAnimations=[];const animate=Element.prototype.animate;
        Element.prototype.animate=function(keyframes,options){
          if(this.matches('tr[id^="Row"]'))fixtureRowAnimations.push({id:this.id,keyframes,options});
          return animate.call(this,keyframes,options);
        };
      });
      await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
      await page.locator('.cp-sweep-go').click();
      await page.locator('.cp-sweep-shown').waitFor({timeout:30000});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const title=await page.locator('.cp-sweep-shown .cp-alert-title').textContent();
      const body=await page.locator('.cp-sweep-shown .cp-alert-body').textContent();
      if(mode.includes('unknown')){
        assert.notEqual(title,'All results loaded','an unknown total cannot establish complete results');
        if(mode.startsWith('failed')){
          assert.equal(failures,2,'the failed read has only its existing bounded retry');
          assert.match(title,/incomplete|missing|did not finish|could not/i);
        }else assert.match(body,/total.*unavailable|total.*unknown|did not provide.*total/i);
      }else assert.equal(title,'All results loaded');
      if(mode==='atomic reveal')assert.deepEqual(await page.evaluate(()=>fixtureRowAnimations),[],
        'the completed table must reveal together, without a staggered per-row animation');
      if(mode==='unknown total with ID fallback'){
        assert.equal(await page.locator('.cp-sweep-table tr[id^="Row"]').count(),2);
        await page.getByRole('button',{name:'Search by User ID',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.cp-sweep-shown .cp-alert-body')?.textContent.startsWith('3 loaded'));
        assert.equal(await page.locator('.cp-sweep-table tr[id^="Row"]').count(),3);
        assert.ok((await page.locator('.cp-sweep-table').textContent()).includes('Émile'));
        assert.notEqual(await page.locator('.cp-sweep-shown .cp-alert-title').textContent(),'All results loaded');
      }
      assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}
