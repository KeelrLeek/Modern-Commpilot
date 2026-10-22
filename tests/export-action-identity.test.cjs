const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',landing='/commpilot/System/DeviceTypes/Modify/index.jsp';
for(const mode of ['quoted-device','ID-prefix','long-handler','inline'])test(`native export downloads the selected device (${mode})`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],device=mode==='quoted-device'?"Fixture O'Brien":'FixtureDevice';
    const call=value=>`exportComponent(${JSON.stringify(value)},'/commpilot','/System/DeviceTypes/Modify','formtokenserial');`;
    const wiring=(id,value,padding='')=>`if(window.nativeHandlerReady){document.getElementById('${id}').onclick=function(){${padding}${call(value)}};}`;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST'){
        posts.push({path:url.pathname,params:Object.fromEntries(url.searchParams)});
        return route.fulfill({contentType:'text/xml',body:'<result><proxy>'+origin+'/commpilot/download/fixture.zip</proxy></result>'});
      }
      if(url.pathname.endsWith('fixture.zip'))return route.fulfill({contentType:'application/zip',headers:{'content-disposition':'attachment; filename="fixture.zip"'},body:'PK-fixture'});
      return route.fulfill({contentType:'text/html',body:`<html><body><form name="leftNavForm"></form><table><tr><td width="82%">
        <form name="mainForm"><input name="formtokenserial" value="fixture-token">
        <input id="fixture-export" name="export" type="button" value="Export"></form></td></tr></table>
        <script>window.redirectPost=function(){};</script>
        ${mode==='ID-prefix'?`<script>${wiring('fixture-export-other','WrongDevice')}</script>`:''}
        ${mode==='inline'?'':`<script>${wiring('fixture-export',device,mode==='long-handler'?'/*'+'x'.repeat(600)+'*/':'')}</script>`}</body></html>`});
    });
    await page.goto(origin+landing);
    // Model native inline wiring after an in-shell swap, without executing it.
    if(mode==='inline')await page.locator('#fixture-export').evaluate((el,src)=>{el.removeAttribute('id');el.setAttribute('onclick',src);},call(device));
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    const downloaded=page.waitForEvent('download',{timeout:4000});
    await page.locator('input[name="export"]').click();
    assert.equal((await downloaded).suggestedFilename(),'fixture.zip');
    assert.deepEqual(posts,[{path:landing,params:{key:device,export:'',formtokenserial:'fixture-token'}}]);
  }finally{await browser.close();}
});
