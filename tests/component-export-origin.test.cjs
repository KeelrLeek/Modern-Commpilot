const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',landing='/commpilot/System/DeviceTypes/Modify/index.jsp';
for(const contextPath of ['https://other.invalid/commpilot','//other.invalid/commpilot'])
test(`component export rejects foreign context ${contextPath} and permits a valid retry`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),foreign=[],localPosts=[];
    const wiring=context=>`document.getElementById('fixture-export').onclick=function(){exportComponent('Fixture',${JSON.stringify(context)},'/System/DeviceTypes/Modify','formtokenserial');};`;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)foreign.push(req.url());
      if(req.method()==='POST'){
        if(url.origin===origin)localPosts.push(req.url());
        return route.fulfill({contentType:'text/xml',headers:{'access-control-allow-origin':origin},body:'<result><proxy>'+origin+'/commpilot/download/fixture.zip</proxy></result>'});
      }
      if(url.pathname.endsWith('fixture.zip'))return route.fulfill({contentType:'application/zip',headers:{'content-disposition':'attachment; filename="fixture.zip"'},body:'PK-fixture'});
      return route.fulfill({contentType:'text/html',body:`<html><body><form name="leftNavForm"></form><table><tr><td width="82%">
        <form name="mainForm"><input name="formtokenserial" value="fixture-token"><input name="export" id="fixture-export" type="button" value="Export"></form>
        <script id="fixture-wiring">${wiring(contextPath)}</script></td></tr></table><script>window.redirectPost=function(){};</script></body></html>`});
    });
    await page.goto(origin+landing);await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    const outcome=Promise.race([
      page.waitForRequest(req=>new URL(req.url()).origin!==origin,{timeout:5000}).then(()=> 'foreign request'),
      page.locator('.cp-upload-notice').waitFor({timeout:5000}).then(()=> 'notice')
    ]);
    await page.locator('#fixture-export').click();assert.equal(await outcome,'notice');
    assert.deepEqual(foreign,[]);assert.equal(localPosts.length,0);
    assert.match(await page.locator('.cp-upload-notice').innerText(),/origin|address/i);
    await page.locator('#fixture-wiring').evaluate((el,text)=>{el.textContent=text;},wiring('/commpilot'));
    const downloaded=page.waitForEvent('download',{timeout:5000});await page.locator('#fixture-export').click();
    assert.equal((await downloaded).suggestedFilename(),'fixture.zip');assert.equal(localPosts.length,1);
    assert.equal(new URL(localPosts[0]).searchParams.get('formtokenserial'),'fixture-token');
  }finally{await browser.close();}
});
