const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const origin='https://apps-sbx.avpaas.io', destination='/commpilot/Group/Profile/';
const shell=marker=>`<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%"><p id="marker">${marker}</p></td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;

for(const transport of ['fetch','frame'])for(const actual of [true,false])
test(`${transport} ignores redirect examples ${actual?'before a real redirect':'without a real redirect'}`,async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage(),posts=[],errors=[];
    const first=transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/';
    const fake="redirectPost('/commpilot/User/Delete/',{key:'Wrong'});";
    const script='/*'+fake+'*/\n//'+fake+'\nconst quoted='+JSON.stringify(fake)+';const template=`'+fake+'`;'+
      (actual?`redirectPost('${destination}',{key:'Selected'});`:'');
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
      if(req.method()==='POST')posts.push({path:url.pathname,params:Object.fromEntries(new URLSearchParams(req.postData()))});
      const body=url.pathname===first?`<html><body><input name="formtokenserial" value="stub-token"><script>${script}</script></body></html>`:
        shell(url.pathname===destination?'done':url.pathname==='/commpilot/User/Delete/'?'wrong':'start');
      return route.fulfill({contentType:'text/html',body});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(first=>redirectPost(first,{}),first);
    await page.waitForFunction(()=>['done','wrong'].includes(document.querySelector('#marker')?.textContent)||document.querySelector('.cp-upload-notice'),null,{timeout:6000});
    // A token-bearing incomplete read may use the existing one-time recovery
    // retry. Neither attempt may execute the comment/string's fake target.
    assert.deepEqual(posts.map(post=>post.path),actual?[first,destination]:[first,first]);
    assert.equal(await page.locator('#marker').innerText(),actual?'done':'start');
    if(actual)assert.deepEqual(posts[1].params,{key:'Selected',formtokenserial:'stub-token'});
    else {
      assert.equal(posts[1].params.formtokenserial,'stub-token');
      assert.match(await page.locator('.cp-upload-notice').innerText(),/could not|unavailable|usable|incomplete/i);
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
