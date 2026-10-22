const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',list='/commpilot/Group/DnManagement/';
const wiring=(returnPage,table)=>`<script>function doPage(value){var params={returnPage:'${returnPage}',tableName:'${table}',value:value};redirectPost('/commpilot/Common/page.jsp',params);}</script>`;

for(const mode of ['stale head after navigation','head-only native page','inert JSON metadata','inert noModule metadata'])test(`list collection uses current metadata with ${mode}`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],badTokens=[],errors=[];let serial=0;
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url()),data=new URLSearchParams(req.postData()||'');assert.equal(url.origin,origin);
      if(req.method()==='POST'){
        posts.push({path:url.pathname,params:Object.fromEntries(data)});
        if(data.get('formtokenserial')!=='fixture-'+serial)badTokens.push(url.pathname);
        serial++;
      }
      const current=url.pathname===list||url.pathname==='/commpilot/Common/page.jsp',number=Number(data.get('value')||0)+1;
      const inert=mode.startsWith('inert ')?wiring('/Wrong/','wrongTable').replace('<script>',mode==='inert JSON metadata'?'<script type="application/json">':'<script nomodule>'):'';
      const correct=inert+wiring('/Group/DnManagement/','groupDnTable');
      const head=mode==='head-only native page'?correct:wiring('/Reseller/Groups/','oldGroupsTable');
      const content=current?`<table><tr><td class="listHeader">Phone number</td></tr>
        <tr id="Row1"><td><a class="tableLink">312555${number}001</a></td></tr><tr id="Row2"><td><a class="tableLink">312555${number}002</a></td></tr></table>
        <p>Page ${number} of 2</p>${mode==='head-only native page'?'':correct}`:'<p id="initial">Old list</p>';
      return route.fulfill({contentType:'text/html',body:`<html><head>${head}</head><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><table><tr><td width="82%"><form name="mainForm">
        <input name="formtokenserial" value="fixture-${serial}">${content}</form></td></tr></table>
        <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
    });
    await page.goto(origin+(mode==='head-only native page'?list:'/commpilot/Reseller/Groups/'));
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    if(mode!=='head-only native page')await page.evaluate(list=>redirectPost(list,{}),list);
    await page.waitForFunction(()=>['done','failed'].includes(document.querySelector('table[data-cp-fill]')?.dataset.cpFill),null,{timeout:6000});
    assert.equal(await page.locator('table[data-cp-fill]').getAttribute('data-cp-fill'),'done');
    const pages=posts.filter(post=>post.path==='/commpilot/Common/page.jsp');
    assert.deepEqual(pages.map(post=>post.params.value),['1','0']);
    for(const post of pages){assert.equal(post.params.returnPage,'/Group/DnManagement/');assert.equal(post.params.tableName,'groupDnTable');}
    assert.equal(await page.locator('tr[id^="Row"]').count(),4);
    assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
