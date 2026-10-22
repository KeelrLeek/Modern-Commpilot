const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',landing='/commpilot/Reseller/DeviceType/',
  entry='/commpilot/Operator/System/DeviceType/Modify/index.jsp',target='/commpilot/Operator/System/DeviceType/Profile/index.jsp';
for(const mode of ['basic','quoted-key','ID-prefix','long-handler','multiple-options'])
test(`device-type drill preserves the selected profile and Back destination (${mode})`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],key=mode==='quoted-key'?"Fixture O'Brien":'FixtureDevice';
    const wiring=(id,value,padding='')=>`if(window.nativeHandlerReady){document.getElementById('${id}').onclick=function(){${padding}redirectPost('Profile/index.jsp',{key:${JSON.stringify(value)}});};}`;
    const menu=`<a id="link_profile">Profile</a>${mode==='multiple-options'?'<a id="link_other">Other</a>':''}
      ${mode==='ID-prefix'?`<script>${wiring('link_profile_other','WrongDevice')}</script>`:''}
      <script>${wiring('link_profile',key,mode==='long-handler'?'/*'+'x'.repeat(600)+'*/':'')}</script>`;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,params:Object.fromEntries(new URLSearchParams(req.postData()))});
      const content=url.pathname===entry?menu:url.pathname===target?'<p id="opened">Profile</p>':'<p id="list">Device types</p>';
      return route.fulfill({contentType:'text/html',body:`<html><body><form name="leftNavForm"></form><input name="formtokenserial" value="${url.pathname===entry?'entry-token':'fixture-token'}">
        <table><tr><td width="82%">${content}</td></tr></table><script>window.redirectPost=function(){};</script></body></html>`});
    });
    await page.goto(origin+landing);await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(url=>window.redirectPost(url,{}),entry);
    if(mode==='multiple-options'){
      await page.locator('#link_other').waitFor();assert.equal(posts.length,1);assert.equal(new URL(page.url()).pathname,entry);return;
    }
    await page.locator('#opened').waitFor({timeout:5000});
    assert.deepEqual(posts,[{path:entry,params:{formtokenserial:'fixture-token'}},
      {path:target,params:{key,formtokenserial:'entry-token'}}]);
    await page.goBack();await page.locator('#list').waitFor({timeout:5000});
    assert.equal(new URL(page.url()).pathname,landing);
  }finally{await browser.close();}
});
