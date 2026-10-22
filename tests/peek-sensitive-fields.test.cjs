const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',folder='/commpilot/Common/folder_contents.jsp',profile='/commpilot/Reseller/Profile/';
for(const type of ['password','hidden'])test(`reseller Peek preserves visible text without exposing a native ${type} field`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()==='POST')posts.push(request.postData());
      const content=url.pathname===profile?`<form name="mainForm"><table>
        <tr><td>Name:</td><td><input type="text" name="displayName" value="Fixture tenant"></td></tr>
        <tr><td>Private value:</td><td><input type="${type}" name="privateValue" value="fixture-private-value"></td></tr>
        </table></form>`:`<table><tr><td class="menuCategory">Basic</td></tr>
        <tr><td><a class="navMenuItem" name="/Reseller/Profile/" onclick="redirectPost('${profile}',{})">Profile</a></td></tr>
        <tr><td>Tenant profile.</td></tr></table>`;
      return route.fulfill({contentType:'text/html',body:`<html><body>
        <form name="leftNavForm"><a class="leftnavfolderopen" onclick="redirectPost('${folder}',{folder:'R0',menuId:'8'})">Profile</a></form>
        <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%" valign="top">${content}</td></tr></table>
        <script>window.redirectPost=function(){};</script></body></html>`});
    });
    await page.goto(origin+folder);await page.addScriptTag({path:path.join(root,'src/content/pjax.js')});
    await page.locator('.cp-leaf-ready').waitFor({timeout:6000});
    assert.equal(await page.locator('.cp-leaf-defpill').filter({hasText:'Fixture tenant'}).count(),1);
    assert.equal(await page.locator('.cp-leaf-ready').innerText().then(text=>text.includes('fixture-private-value')),false);
    assert.equal(await page.locator('.cp-leaf-row').count(),1);
    assert.ok(posts.every(body=>!new URLSearchParams(body).has('apply')),'preview does not save anything');
  }finally{await browser.close();}
});
