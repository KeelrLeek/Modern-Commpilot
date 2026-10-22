const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io',folder='/commpilot/Common/folder_contents.jsp';
const entry='/commpilot/Reseller/ServiceProviders/Modify/index.jsp',profile='/commpilot/ServiceProvider/Profile/';
test('a departed reseller reveal timer cannot finish a newer provider board or race its token',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  try{
    const page=await browser.newPage(),posts=[],badTokens=[],errors=[];let token=0,level='R';
    page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),data=new URLSearchParams(request.postData()||'');
      assert.equal(url.origin,origin);
      if(request.method()==='POST'){
        posts.push({path:url.pathname,folder:data.get('folder')});
        if(data.get('formtokenserial')!=='fixture-'+token){
          badTokens.push(url.pathname);return route.fulfill({status:409,body:'Fixture stale token'});
        }
      }
      if(url.pathname===entry)level='S';
      const menuId=level==='R'?'8':'2',names=level==='R'?['Reseller Profile','Reseller Resources']:['Provider Profile','Provider Resources','Provider Services'];
      const sidebar=names.map((name,i)=>`<a class="${i?'leftnavfolder':'leftnavfolderopen'}" onclick="redirectPost('${folder}',{folder:'${level}${i}',menuId:'${menuId}'})">${name}</a>`).join('');
      const content=url.pathname===profile?'<h1 id="opened">Provider profile</h1>':`<table><tr><td class="menuCategory">Basic</td></tr><tr><td>
        <a class="navMenuItem" name="/ServiceProvider/Profile/" onclick="redirectPost('${profile}',{})">Profile</a></td></tr><tr><td>Fixture option</td></tr></table>`;
      const body=`<html><body><table><tr><td class="headerBar"><span class="headerAuthLevel">${level==='R'?'Reseller':'Fixture SP'}</span></td></tr></table>
        <form name="leftNavForm">${sidebar}</form><input name="formtokenserial" value="fixture-${++token}">
        <table><tr><td width="82%" valign="top">${content}</td></tr></table><script>window.redirectPost=function(){};</script></body></html>`;
      if(data.get('folder')==='S1')await held;
      return route.fulfill({contentType:'text/html',body});
    });
    await page.goto(origin+folder);
    await page.evaluate(()=>{
      const timer=window.setTimeout;window.fixtureReveals=[];
      window.setTimeout=(fn,delay,...args)=>{
        if(delay===250&&String(fn).includes('cpRevealStep')){fixtureReveals.push(()=>fn(...args));return 0;}
        return timer(fn,delay,...args);
      };
    });
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.waitForFunction(()=>fixtureReveals.length===1);
    await page.evaluate(()=>{window.fixtureDepartedReveal=fixtureReveals.shift();});
    const pending=page.waitForRequest(req=>new URLSearchParams(req.postData()||'').get('folder')==='S1');
    await page.evaluate(url=>redirectPost(url,{key:'Fixture SP'}),entry);await pending;
    await page.waitForFunction(()=>document.querySelector('.cp-console-section[data-cp-folder="S0"]'));
    await page.evaluate(()=>fixtureDepartedReveal());await page.waitForTimeout(150);
    assert.equal(posts.filter(post=>post.path===entry).length,1,'the old reveal must not send the new board restoration early');
    assert.deepEqual(badTokens,[]);
    release();
    for(let i=0;i<20;i++){
      await page.evaluate(()=>fixtureReveals.shift()?.());
      if(await page.locator('[data-cp-crumb-menu]').count())break;
      await page.waitForTimeout(50);
    }
    await page.locator('[data-cp-crumb-menu]').waitFor();
    await page.evaluate(url=>redirectPost(url,{}),profile);await page.locator('#opened').waitFor();
    assert.equal(posts.filter(post=>post.path===entry).length,2,'the new board restores its own context exactly once');
    assert.deepEqual(badTokens,[]);assert.deepEqual(errors,[]);
    assert.ok(posts.every(post=>!/(?:Login|Logout)/i.test(post.path)));
  }finally{release();await browser.close();}
});
