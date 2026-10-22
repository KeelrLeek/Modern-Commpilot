const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
test('native loading preserves browser-supported legacy script types and ignores inactive tags',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),requested=[];
    const mime=['application/ecmascript','application/javascript','application/x-ecmascript','application/x-javascript',
      'text/ecmascript','text/javascript',...Array.from({length:6},(_,i)=>`text/javascript1.${i}`),
      'text/jscript','text/livescript','text/x-ecmascript','text/x-javascript'];
    const active=mime.map(type=>`type="${type}"`).concat(['','type=""','type="  TEXT/JAVASCRIPT  "','language="javascript1.5"','for="window" event="onload()"']);
    const ignored=['type="application/json"','type="  "','type=" module "','type="text/javascript; charset=utf-8"',
      'language="vbscript"','nomodule','for="document" event="onload"','for="window" event="onclick"'];
    const scripts=active.map((attrs,i)=>`<script ${attrs} src="native-${i}.js"></script>`).join('')+
      ignored.map((attrs,i)=>`<script ${attrs} src="ignored-${i}.js"></script>`).join('')+
      '<script>window.nativeComplete=window.executed.slice();</script>';
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,'https://apps-sbx.avpaas.io');
      if(url.pathname.endsWith('.js')){requested.push(url.pathname.split('/').pop());const index=/native-(\d+)/.exec(url.pathname)?.[1];
        return route.fulfill({contentType:'application/javascript',body:`window.executed.push(${index===undefined?-1:Number(index)});`});}
      return route.fulfill({contentType:'text/html',body:`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
        <input name="formtokenserial" value="fixture"><table><tr><td width="82%"><h1>Page</h1>${url.pathname.includes('Authentication')?scripts:''}</td></tr></table>
        <script>window.executed=[];window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
    });
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>redirectPost('/commpilot/User/Authentication/',{}));
    await page.waitForFunction(()=>Array.isArray(window.nativeComplete));
    assert.deepEqual(await page.evaluate(()=>window.nativeComplete),active.map((_,i)=>i));
    assert.deepEqual(requested,active.map((_,i)=>`native-${i}.js`));
    assert.equal(await page.locator('td[width="82%"] .cp-upload-notice').count(),0);
  }finally{await browser.close();}
});
