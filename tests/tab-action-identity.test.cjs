const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
for(const dialect of ['TabSubmit','tabSubmit'])for(const mode of ['basic','ID-prefix','comment'])
test(`${dialect} selects only the clicked tab and preserves its native payload (${mode})`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    const landing='/commpilot/Group/AssignXsiPolicyProfile/Group/',target='/commpilot/Group/AssignXsiPolicyProfile/User/';
    const wiring=(id,value)=>`document.getElementById('${id}').onclick=function(){${dialect}('${value}');};`;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,params:Object.fromEntries(new URLSearchParams(req.postData()))});
      return route.fulfill({contentType:'text/html',body:`<html><body><form name="leftNavForm"></form><input name="formtokenserial" value="fixture-token">
        <table><tr><td width="82%"><form name="mainForm"><input name="defaultProfile" value="draft-must-not-save">
        ${req.method()==='POST'?'<p id="opened">Opened</p>':'<a class="tab" id="user-tab">User</a>'}</form></td></tr></table>
        <script>window.redirectPost=function(){};</script>
        ${mode==='ID-prefix'?`<script>if(window.nativeHandlerReady){${wiring('user-tab-other','../Wrong/')}}</script>`:''}
        <script>${mode==='comment'?'/*'+wiring('user-tab','../Wrong/')+'*/':''}
        if(window.nativeHandlerReady){${wiring('user-tab','../User/')}}</script></body></html>`});
    });
    await page.goto(origin+landing);await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.locator('#user-tab').click();await page.locator('#opened').waitFor({timeout:4000});
    assert.deepEqual(posts,[{path:target,params:dialect==='tabSubmit'?{formtokenserial:'fixture-token'}:
      {defaultProfile:'draft-must-not-save',tabPage:'../User/',formtokenserial:'fixture-token'}}]);
  }finally{await browser.close();}
});
