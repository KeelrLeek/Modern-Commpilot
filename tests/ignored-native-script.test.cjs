const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
for(const kind of ['metadata','metadata-module','nomodule','nomodule-module','voice-nomodule'])test(`browser-ignored ${kind} script cannot strand navigation`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],ignored=[];
    await page.addInitScript(()=>{const timeout=window.setTimeout;window.setTimeout=(fn,delay,...args)=>timeout(fn,delay===15000?250:delay,...args);});
    const first=kind==='voice-nomodule'?'/commpilot/User/VM/':'/commpilot/User/Authentication/';
    const last='/commpilot/User/DND/';
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(url.pathname.endsWith('ignored.js')){ignored.push(url.pathname);return route.fulfill({contentType:'application/javascript',body:'window.ignoredScriptRan=true;'});}
      if(req.method()==='POST')posts.push(url.pathname);
      const inactive=kind.startsWith('metadata')?'<script id="config" type="application/json" src="ignored.js">{"mode":"keep"}</script>':'<script nomodule src="ignored.js"></script>';
      const scripts=url.pathname===first?inactive+(kind.endsWith('-module')?'<script type="module">window.moduleReady=true;</script>':''):'';
      return route.fulfill({contentType:'text/html',body:`<html><head>${kind==='voice-nomodule'?scripts:''}</head><body>
        <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><input name="formtokenserial" value="fixture">
        <table><tr><td width="82%"><p id="marker">${url.pathname}</p><form name="mainForm"><input name="description"></form>${kind==='voice-nomodule'?'':scripts}</td></tr></table>
        <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
    });
    await page.goto(origin+'/commpilot/User/Profile/');await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(first=>redirectPost(first,{}),first);
    await page.waitForFunction(first=>document.querySelector('#marker')?.textContent===first,first);
    await page.waitForTimeout(400);
    assert.deepEqual(ignored,[]);assert.equal(await page.evaluate(()=>!!window.ignoredScriptRan),false);
    if(kind.startsWith('metadata'))assert.equal(await page.locator('#config').textContent(),'{"mode":"keep"}');
    await page.evaluate(last=>redirectPost(last,{}),last);
    await page.waitForFunction(last=>document.querySelector('#marker')?.textContent===last,last,{timeout:2000});
    assert.deepEqual(posts,[first,last]);
  }finally{await browser.close();}
});
