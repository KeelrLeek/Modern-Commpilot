const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',destination='/commpilot/Group/Profile/';
const cases=[
  ['JSON data','type="application/json"'],['plain text','type="text/plain"'],
  ['legacy noModule','nomodule'],['import map','type="importmap"'],
  ['non-JavaScript language','language="vbscript"'],['external script fallback text','src="example.js"'],
  ['frame plain text','type="text/plain"','frame'],['frame noModule','nomodule','frame'],
  ['module redirect','type="module"',null,true],['legacy JavaScript MIME','type="text/javascript1.5"',null,true]
];
for(const [name,attributes,transport,executable]of cases){
  test('native redirect '+(executable?'accepts ':'ignores ')+name,async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    try{
      const page=await browser.newPage(),posts=[],errors=[];
      const first=transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/';
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
        if(req.method()==='POST')posts.push({path:url.pathname,params:Object.fromEntries(new URLSearchParams(req.postData()||''))});
        const body=url.pathname===first?`<html><body><input name="formtokenserial" value="stub-token">
          <script ${attributes}>redirectPost('${executable?destination:'/commpilot/User/Delete/'}',{key:'${executable?'Selected':'Wrong'}'});</script>
          ${executable?'':`<script>redirectPost('${destination}',{key:'Selected'});</script>`}</body></html>`:
          `<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form><input name="formtokenserial" value="fixture-token">
          <table><tr><td width="82%"><p id="marker">${url.pathname===destination?'done':url.pathname==='/commpilot/User/Delete/'?'wrong':'start'}</p></td></tr></table>
          <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
        return route.fulfill({contentType:'text/html',body});
      });
      await page.goto(origin+'/commpilot/User/Profile/');await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
      await page.evaluate(first=>redirectPost(first,{}),first);
      await page.waitForFunction(()=>['done','wrong'].includes(document.querySelector('#marker')?.textContent));
      assert.deepEqual(posts.map(p=>p.path),[first,destination]);
      assert.deepEqual(posts[1].params,{key:'Selected',formtokenserial:'stub-token'});
      assert.equal(await page.locator('#marker').textContent(),'done');assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}
