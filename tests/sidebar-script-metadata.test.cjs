const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',folderPath='/commpilot/Common/folder_contents.jsp';
for(const [name,attributes]of [['ordinary wiring',null],['JSON data','type="application/json"'],['noModule','nomodule'],['external fallback','src="/fixture.js"']]){
  test('sidebar folder metadata ignores inactive scripts: '+name,async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    try{
      const page=await browser.newPage(),posts=[],errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const sidebar=[0,1].map(i=>{
        const bind=folder=>`document.getElementById('nav${i}').onclick=function(){redirectPost('${folderPath}',{folder:'${folder}',menuId:'8'});};`;
        return `<tr><td><a id="nav${i}" class="${i?'leftnavfolder':'leftnavfolderopen'}">${i?'Resources':'Profile'}</a>
          ${attributes===null?'':`<script ${attributes}>${bind('R9')}</script>`}<script>${bind('R'+i)}</script></td></tr>`;
      }).join('');
      await page.route('**/*',route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
        if(url.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:''});
        if(req.method()==='POST')posts.push(Object.fromEntries(new URLSearchParams(req.postData()||'')));
        return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-cp-direction="atlas"><body id="initBody.menuTemplate">
          <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
          <form name="leftNavForm"><table>${sidebar}</table></form><input name="formtokenserial" value="fixture">
          <table height="100%"><tr><td width="82%" valign="top"><table><tr><td class="menuCategory">Basic</td></tr>
          <tr><td><a class="navMenuItem" name="/Reseller/Groups/">Groups</a></td></tr><tr><td>Group settings.</td></tr></table></td></tr></table>
          <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`});
      });
      await page.goto(origin+folderPath);
      await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
      await page.waitForFunction(()=>document.querySelectorAll('form[name="leftNavForm"] [data-cp-folder]').length>=2);
      assert.deepEqual(await page.locator('form[name="leftNavForm"] a').evaluateAll(links=>links.map(a=>({folder:a.dataset.cpFolder,menuId:a.dataset.cpMenuid}))),[
        {folder:'R0',menuId:'8'},{folder:'R1',menuId:'8'}]);
      assert.ok(posts.every(p=>p.folder!=='R9'),'inactive metadata must never request the wrong folder');
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}
