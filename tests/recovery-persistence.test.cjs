const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

test('an idle tab does not overwrite a newer recovery token and a changed token is persisted once',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();
    await page.clock.install();
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body id="initBody.menuTemplate"><input name="formtokenserial" value="old-tab-token"><table><tr><td width="82%">Fixture</td></tr></table></body></html>'}));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
    await page.evaluate(()=>{
      window.saved={};window.writes=[];
      window.chrome={runtime:{getURL:p=>'/ext/'+p,getManifest:()=>({version:'0.3.82'})},storage:{local:{
        set:(data,done)=>{Object.assign(saved,data);writes.push(data);done?.();},
        get:(keys,done)=>done(saved),remove:(keys,done)=>{for(const key of keys)delete saved[key];done?.();}
      }}};
    });
    for(const file of ['recovery-bridge.js','skin.js'])await page.addScriptTag({path:path.resolve(__dirname,'../src/content',file)});
    await page.evaluate(()=>{saved['cpRecoverToken:'+location.origin]='newer-tab-token';writes.length=0;});
    await page.clock.fastForward(31000);
    await page.evaluate(()=>{document.dispatchEvent(new Event('cp:reskin'));document.dispatchEvent(new Event('cp:morphed'));});
    assert.equal(await page.evaluate(()=>saved['cpRecoverToken:'+location.origin]),'newer-tab-token','unchanged page state must not replace a newer token from another tab');
    assert.equal(await page.evaluate(()=>writes.length),0,'unchanged recovery state produces no storage writes');
    await page.evaluate(()=>{
      document.querySelector('[name=formtokenserial]').value='fresh-local-token';
      document.dispatchEvent(new Event('cp:reskin'));document.dispatchEvent(new Event('cp:morphed'));
    });
    assert.equal(await page.evaluate(()=>saved['cpRecoverToken:'+location.origin]),'fresh-local-token');
    assert.equal(await page.evaluate(()=>writes.length),1,'the bridge is the sole persistence owner');
  }finally{await browser.close();}
});
