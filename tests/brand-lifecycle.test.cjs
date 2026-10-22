const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

test('header replacements release detached logo observers and leaving the app releases the last one',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();
    const header='<table><tr><td class="headerBar"><a class="headerLink">Home</a></td></tr></table>';
    await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<html data-cp-direction="atlas"><body id="initBody.menuTemplate">${header}</body></html>`}));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
    await page.evaluate(()=>{
      window.observed=new Set();
      const Native=ResizeObserver;
      window.ResizeObserver=class extends Native{
        observe(target,options){observed.add(target);super.observe(target,options);}
        unobserve(target){observed.delete(target);super.unobserve(target);}
      };
      window.chrome={runtime:{getManifest:()=>({version:'0.3.82'}),getURL:p=>'/ext/'+p,sendMessage:(m,done)=>done?.()},
        storage:{local:{get:(k,done)=>done({})},onChanged:{addListener:()=>{}}}};
    });
    await page.addScriptTag({path:path.resolve(__dirname,'../src/content/brand.js')});
    const counts=await page.evaluate(async header=>{
      for(let i=0;i<8;i++){
        document.body.innerHTML=header;document.dispatchEvent(new Event('cp:morphed'));
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      }
      return {total:observed.size,detached:[...observed].filter(el=>!el.isConnected).length};
    },header);
    assert.deepEqual(counts,{total:1,detached:0});
    await page.evaluate(async()=>{
      document.body.id='loginBody';document.dispatchEvent(new Event('cp:reskin'));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    });
    assert.equal(await page.evaluate(()=>observed.size),0);
  }finally{await browser.close();}
});
