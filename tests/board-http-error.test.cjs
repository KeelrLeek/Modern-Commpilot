const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',folderPath='/commpilot/Common/folder_contents.jsp',entry='/commpilot/Group/Members/Modify/index.jsp';
function shell(folder,token,errorContent=false){
  return `<html><head><title>User Profile</title></head><body><table><tr><td class="headerBar"><span class="headerAuthLevel">Fixture</span></td></tr></table>
  <form name="leftNavForm">${['U0','U1'].map((id,i)=>`<a class="${id===folder?'leftnavfolderopen':'leftnavfolder'}" onclick="redirectPost('${folderPath}',{folder:'${id}',menuId:'0'})">${i?'Incoming Calls':'Profile'}</a>`).join('')}</form>
  <input name="formtokenserial" value="${token}"><table><tr><td width="82%" valign="top"><table><tr><td class="menuCategory">Basic</td></tr>
  <tr><td><a class="navMenuItem" name="/User/${folder}/" onclick="redirectPost('/commpilot/User/${folder}/',{})">${errorContent?'Error response option':folder+' option'}</a></td></tr><tr><td>Fixture description</td></tr></table></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;
}
for(const [stage,status] of [['prefetch',500],['restore',500],['restore',200]])test('board '+stage+' HTTP '+status+' keeps menu readiness consistent with the response',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];let serial=0;
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url()),params=new URLSearchParams(req.postData()||'');assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,folder:params.get('folder')});
      const folder=params.get('folder')||'U0';
      const fail=req.method()==='POST'&&(stage==='prefetch'?url.pathname===folderPath&&folder==='U1':url.pathname===entry);
      return route.fulfill({status:fail?status:200,contentType:'text/html',body:shell(folder,'t'+(++serial),fail&&status>=400)});
    });
    await page.goto(origin+folderPath);
    await page.evaluate(entry=>sessionStorage.setItem('cp-reload-nav',JSON.stringify({url:entry,params:{key:'Fixture'},at:Date.now()})),entry);
    const restored=page.waitForResponse(r=>new URL(r.url()).pathname===entry&&r.request().method()==='POST');
    await page.addStyleTag({path:path.join(runtime,'src/content/menu-board.css')});
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await restored;
    await page.waitForFunction(()=>!document.querySelector('iframe[name^=cpFrame]'));
    assert.equal(await page.locator('.cp-console-error').count(),status>=400?1:0,'only successful reads can leave the board ready');
    assert.equal(await page.getByText('Error response option',{exact:true}).count(),0,'error-page controls cannot become working board options');
    if(status===200)assert.equal(await page.locator('.cp-console-body[data-cp-loaded="1"]').count(),2);
    assert.equal(posts.filter(p=>p.path===entry).length,1,'no automatic context-restore retry');
    assert.equal(posts.some(p=>/Login|Logout/.test(p.path)),false);
  }finally{await browser.close();}
});
