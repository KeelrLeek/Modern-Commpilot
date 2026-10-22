const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io';
const start='/commpilot/Reseller/Profile/';
const target='/commpilot/Reseller/Resources/';
function shell(title){return `<html><body><form name="leftNavForm"></form><table><tr><td width="82%"><h1>${title}</h1>
  <form name="mainForm"><input name="formtokenserial" value="fixture-current-token"></form></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;}
for(const [label,nav] of [
  ['apply',{url:target,params:{apply:'Apply',description:'stale edit'}}],
  ['delete',{url:target,params:{buttonClicked:'delete',key:'Fixture'}}],
  ['serialized save',{url:target,params:{__cpFormEntries:[['apply','Apply'],['description','stale edit']]}}],
  ['credential payload',{url:target,params:{newPassword:'fixture-private'}}],
  ['query action',{url:target+'?delete=1',params:{}}],
  ['mutating entity entry',{url:'/commpilot/User/Profile/',params:{},entry:{url:'/commpilot/Group/Members/Modify/',params:{key:'Fixture',delete:'Delete'}}}]
])test(`browser Back refuses an older history entry containing ${label}`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    await page.route('**/*',route=>{
      const request=route.request();
      if(request.method()==='POST')posts.push({url:request.url(),params:Object.fromEntries(new URLSearchParams(request.postData()||''))});
      return route.fulfill({contentType:'text/html',body:shell(request.method()==='POST'?'Replayed':'Current page')});
    });
    await page.goto(origin+start);await page.addScriptTag({path:path.join(root,'src/content/pjax.js')});
    await page.evaluate(nav=>{
      document.documentElement.setAttribute('data-cp-path','/commpilot/Reseller/Profile/');
      history.replaceState({cpNav:nav},'',nav.url);
      history.pushState({cpNav:{url:'/commpilot/Reseller/Profile/',params:{}}},'','/commpilot/Reseller/Profile/');
      history.back();
    },nav);
    await page.waitForTimeout(500);
    assert.deepEqual(posts,[],'a browser history replay must not submit a saved mutation or credential');
    assert.equal(await page.locator('h1').innerText(),'Current page');
    assert.equal(new URL(page.url()).pathname,start,'the address must still describe the page on screen');
    assert.match(await page.locator('.cp-upload-notice').innerText(),/history|reopen/i);
  }finally{await browser.close();}
});

for(const [label,params] of [['apply',{apply:'Apply'}],['credential',{password:'fixture-private'}]])
test(`F5 refuses a legacy reload marker containing a ${label} payload`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    await page.route('**/*',route=>{
      const request=route.request();if(request.method()==='POST')posts.push(request.postData());
      return route.fulfill({contentType:'text/html',body:shell('Current page')});
    });
    await page.goto(origin+start);
    await page.evaluate(({url,params})=>sessionStorage.setItem('cp-reload-nav',JSON.stringify({url,params,at:Date.now()})),{url:start,params});
    await page.addScriptTag({path:path.join(root,'src/content/pjax.js')});
    await page.keyboard.press('F5');await page.waitForTimeout(500);
    assert.deepEqual(posts,[]);
    assert.match(await page.locator('.cp-upload-notice').innerText(),/reload|reopen/i);
  }finally{await browser.close();}
});

test('browser Back preserves a native serialized search and its criteria',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[];
    await page.route('**/*',route=>{
      const request=route.request();
      if(request.method()==='POST')posts.push(Object.fromEntries(new URLSearchParams(request.postData()||'')));
      return route.fulfill({contentType:'text/html',body:shell(request.method()==='POST'?'Search restored':'Current page')});
    });
    await page.goto(origin+start);await page.addScriptTag({path:path.join(root,'src/content/pjax.js')});
    await page.evaluate(()=>{
      const url='/commpilot/Common/find.jsp';
      history.replaceState({cpNav:{url,params:{__cpFormEntries:[['findKey0','UserLastName'],['findOp0','STARTS_WITH'],['findValue0','Fixture'],['buttonClicked',''],['formtokenserial','stale-token']]}}},'',url);
      history.pushState({cpNav:{url:'/commpilot/Reseller/Profile/',params:{}}},'','/commpilot/Reseller/Profile/');history.back();
    });
    await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Search restored');
    assert.equal(posts.length,1);
    assert.equal(posts[0].findValue0,'Fixture');
    assert.equal(posts[0].findKey0,'UserLastName');
    assert.equal(posts[0].formtokenserial,'fixture-current-token');
  }finally{await browser.close();}
});
