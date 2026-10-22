const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',list='/commpilot/Reseller/Groups/',target=list+'Modify/index.jsp';
const keys=["SP>%O'Brien",'SP>%Other"Name',String.raw`SP>%literal\u0040`,String.raw`SP>%literal\x40`,'SP>%value}),key:"wrong"'];
const row=(key,index)=>`<tr id="Row${index}"><td><a class="tableLink" id="Row${index}Col0">Group ${index}</a>
  <script>document.getElementById('Row${index}Col0').addEventListener('click',function(){redirectPost('${target}',{key:${JSON.stringify(key)},P_key:${JSON.stringify(key)}});});</script></td></tr>`;
const shell=content=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture"><table><tr><td width="82%">${content}</td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;

for(const kind of ['search','paged'])test(`complex row identifiers survive ${kind} results and the navigation POST`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),opened=[];
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData());assert.equal(url.origin,origin);
      if(url.pathname===target){opened.push({key:params.get('key'),P_key:params.get('P_key')});return route.fulfill({contentType:'text/html',body:shell(`<p id="opened" data-step="${opened.length}">Opened</p>`)});}
      const pageNo=url.pathname.endsWith('page.jsp')?Number(params.get('value'))+1:1;
      const rows=kind==='search'?keys.map((key,i)=>row(key,i+1)).join(''):pageNo===1?row('Initial',1):row(keys[4],1);
      return route.fulfill({contentType:'text/html',body:shell(`<form name="mainForm"><table>${rows}</table>
        <p>Page ${pageNo} of ${kind==='paged'?2:1}</p></form><script>function doPage(value){var parmsArray={returnPage:'/Reseller/Groups/',tableName:'resellerGroupTable',value:value};}</script>`)});
    });
    await page.goto(origin+list);await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    if(kind==='search'){
      const found=await page.evaluate(async()=>cpListSearch([],{ctx:{landing:location.href,baseParams:{}}}));
      assert.deepEqual(found.rows.map(r=>r.drill.params.key),keys);
      for(const [index,item] of found.rows.entries()){
        await page.evaluate(drill=>redirectPost(drill.url,drill.params),item.drill);
        await page.waitForFunction(count=>Number(document.querySelector('#opened')?.dataset.step)===count,index+1);
      }
    }else{
      await page.waitForFunction(()=>document.querySelector('table[data-cp-fill]')?.dataset.cpFill==='done');
      await page.locator('#Row2Col0').click();
    }
    await page.locator('#opened').waitFor();
    assert.deepEqual(opened,kind==='paged'?[{key:keys[4],P_key:keys[4]}]:keys.map(key=>({key,P_key:key})));
  }finally{await browser.close();}
});
