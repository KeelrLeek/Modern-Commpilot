const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

async function fixture() {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ contentType:'text/html',body:
    '<body id="initBody.menuTemplate"><table><tr><td class="headerBar"><a class="headerLink">Help</a></td></tr></table><form name="leftNavForm"></form><table><td width="82%">Fixture</td></table></body>' }));
  await page.goto('https://apps-sbx.avpaas.io/commpilot/User/Profile/');
  await page.evaluate(() => {
    window.writes = [];
    window.stored = {cpThemePalette:'atlas',cpSettings:{font:'inter',side:'full',peek:true,debug:false}};
    window.cpFontChoices = [{id:'inter',label:'Inter'},{id:'geist',label:'Geist'},{id:'arial',label:'Arial'}];
    window.chrome = {runtime:{getURL:p=>'/ext/'+p,getManifest:()=>({version:'0.3.82'})},storage:{
      local:{get:(keys,done)=>{window.load = value=>done(value||stored);},set:(data,done)=>writes.push({data,done})},
      onChanged:{addListener:listener=>{window.changed=listener;}}
    }};
    window.finishWrite = (index,error) => {
      const write=writes[index];
      if(error) chrome.runtime.lastError={message:error};
      else { Object.assign(stored,write.data);changed(Object.fromEntries(Object.entries(write.data).map(([k,v])=>[k,{newValue:v}])),'local'); }
      write.done?.();delete chrome.runtime.lastError;
    };
  });
  await page.addScriptTag({path:path.join(root,'src/content/themes.js')});
  await page.addScriptTag({path:path.join(root,'src/content/theme-settings.js')});
  await page.locator('#cp-appearance-toggle').click();
  // Exercise actual change listeners without hover previews or CSS layout affecting the timing fixtures.
  const choose = (name,value) => page.evaluate(({name,value})=>{
    const input=document.querySelector(`input[name="${name}"][value="${value}"]`);
    if(!input) throw Error('Missing setting '+name+' '+value);
    input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
  },{name,value});
  return {page,choose,errors,close:()=>browser.close()};
}

test('Settings serializes rapid theme changes and ignores an older save notification', async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>load());
    await f.choose('cp-theme','graphite');await f.choose('cp-theme-mode','dark');
    assert.equal(await f.page.evaluate(()=>writes.length),1);
    await f.page.evaluate(()=>finishWrite(0));
    assert.equal(await f.page.getAttribute('html','data-cp-direction'),'graphite');
    await f.page.evaluate(()=>finishWrite(1));
    assert.equal(await f.page.evaluate(()=>stored.cpThemePalette),'graphite');
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('Settings keeps the latest font through an older failure and restores the saved font if the latest fails',async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>load());
    await f.choose('cp-font','arial');await f.choose('cp-font','geist');
    await f.page.evaluate(()=>finishWrite(0,'Temporary failure'));
    assert.equal(await f.page.getAttribute('html','data-cp-font'),'geist');
    await f.page.evaluate(()=>finishWrite(1));
    await f.choose('cp-font','arial');await f.page.evaluate(()=>finishWrite(2,'Quota exceeded'));
    assert.equal(await f.page.getAttribute('html','data-cp-font'),'geist');
    assert.equal(await f.page.evaluate(()=>stored.cpSettings.font),'geist');
    assert.match(await f.page.locator('.cp-appearance-status').textContent(),/Could not save/);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('Settings ignores a delayed startup read after local or external changes',async()=>{
  const f=await fixture();try{
    await f.choose('cp-font','arial');
    await f.page.evaluate(()=>{changed({cpThemePalette:{newValue:'nord'}},'local');load();});
    assert.equal(await f.page.getAttribute('html','data-cp-font'),'arial');
    assert.equal(await f.page.getAttribute('html','data-cp-direction'),'nord');
    await f.page.evaluate(()=>finishWrite(0));
    assert.equal(await f.page.evaluate(()=>stored.cpSettings.font),'arial');
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

for (const mode of ['throws', 'callback-error']) test(`Settings still opens when the About badge cannot be saved: ${mode}`, async()=>{
  const f=await fixture();try{
    await f.page.locator('.cp-settings-close').click();
    await f.page.evaluate(mode=>{
      window.cpBrand={seenKey:'cpVersionSeen',version:'0.3.82'};
      window.badgeWrites=0;window.badgeErrorReads=0;
      chrome.storage.local.set=(data,done)=>{
        window.badgeWrites++;
        if(mode==='throws')throw Error('Extension context invalidated.');
        if(typeof done!=='function')return Promise.reject(Error('Storage unavailable.'));
        Object.defineProperty(chrome.runtime,'lastError',{configurable:true,get:()=>{
          window.badgeErrorReads++;return {message:'Storage unavailable.'};
        }});
        done();delete chrome.runtime.lastError;
      };
    },mode);
    await f.page.locator('#cp-appearance-toggle').click();
    assert.equal(await f.page.locator('.cp-settings-overlay').isVisible(),true);
    assert.equal(await f.page.locator('#cp-appearance-toggle').getAttribute('aria-expanded'),'true');
    assert.equal(await f.page.evaluate(()=>badgeWrites),1);
    if(mode==='callback-error')assert.ok(await f.page.evaluate(()=>badgeErrorReads)>0);
    assert.deepEqual(f.errors,[]);
    await f.page.locator('.cp-settings-close').click();
    assert.equal(await f.page.locator('.cp-settings-overlay').isVisible(),false);
  }finally{await f.close();}
});
