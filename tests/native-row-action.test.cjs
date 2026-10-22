const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',target='/commpilot/Reseller/Groups/Modify/index.jsp';
for(const mode of ['quoted-key','ID-prefix','long-handler','stale-head','head-only','inert-json','inert-nomodule'])test(`native row click uses its exact action (${mode})`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],key=mode==='quoted-key'?"SP>%O'Brien":'SP>%Fixture';
    const wiring=(id,value,padding='')=>`if(window.nativeHandlerReady){document.getElementById('${id}').onclick=function(){${padding}redirectPost('${target}',{key:${JSON.stringify(value)},P_key:${JSON.stringify(value)}});};}`;
    const content=`<table><tr id="Row1"><td><a class="tableLink" id="Row1Col0">Open group</a></td></tr></table>
      ${mode==='ID-prefix'?`<script>${wiring('Row1Col0Other','Wrong')}</script>`:''}
      ${mode.startsWith('inert-')?`<script ${mode==='inert-json'?'type="application/json"':'nomodule'}>${wiring('Row1Col0','Wrong')}</script>`:''}
      ${mode==='head-only'?'':`<script>${mode==='stale-head'?'window.nativeHandlerReady=true;':''}${wiring('Row1Col0',key,mode==='long-handler'?'/*'+'x'.repeat(500)+'*/':'')}</script>`}`;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,params:Object.fromEntries(new URLSearchParams(req.postData()))});
      return route.fulfill({contentType:'text/html',body:`<html><head>${mode==='stale-head'||mode==='head-only'?`<script>${wiring('Row1Col0',mode==='stale-head'?'WrongPreviousPage':key)}</script>`:''}</head><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
        <input name="formtokenserial" value="fixture"><table><tr><td width="82%">${req.method()==='POST'?'<p id="opened">Opened</p>':content}</td></tr></table>
        <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
    });
    await page.goto(origin+'/commpilot/Reseller/Groups/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.locator('#Row1Col0').click();
    await page.locator('#opened').waitFor({timeout:4000});
    assert.equal(posts.length,1);assert.equal(posts[0].path,target);
    assert.equal(posts[0].params.key,key);assert.equal(posts[0].params.P_key,key);
  }finally{await browser.close();}
});
