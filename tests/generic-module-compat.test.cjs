const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname, '..');
test('ordinary pages retain inline module execution alongside a classic dependency',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,'https://apps-sbx.avpaas.io');
      if(url.pathname.endsWith('native.js'))return route.fulfill({contentType:'application/javascript',body:'window.classicReady=true;'});
      const scripts=url.pathname.includes('Authentication')?'<script src="native.js"></script><script type="module">window.nativeModuleReady=true;</script>':'';
      return route.fulfill({contentType:'text/html',body:`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
        <input name="formtokenserial" value="fixture"><table><tr><td width="82%"><form name="mainForm"><input name="username"></form>${scripts}</td></tr></table>
        <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>redirectPost('/commpilot/User/Authentication/',{}));
    await page.waitForFunction(()=>window.classicReady);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>!!window.nativeModuleReady),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
