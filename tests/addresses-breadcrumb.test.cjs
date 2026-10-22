const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname,'..'));
const origin = 'https://apps-sbx.avpaas.io';
const addresses = '/commpilot/User/Addresses/';
const profilePath = '/commpilot/User/Profile/';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const esc = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

async function fixture(initial = {extension:'',number:''}, renderDelay = 0) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'bw-address-crumb-'));
  const context = await chromium.launchPersistentContext(temp, {
    executablePath:edge, headless:true, viewport:{width:1280,height:800},
    args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // This mock server starts with a GET; native cold-GET recovery has its own tests.
    await worker.evaluate(()=>chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['ruleset_1']}));
    await worker.evaluate(() => chrome.storage.local.set({cpThemePalette:'graphite',cpSettings:{peek:false}}));
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
    let saved = {...initial}, serial = 0;
    const requests = [];
    await context.route(origin + '/**', route => {
      const req = route.request(), pathname = new URL(req.url()).pathname;
      if (req.resourceType() === 'image') return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
      const params = new URLSearchParams(req.postData() || '');
      const submitted = pathname === addresses && (params.has('apply') || params.has('ok'));
      if (req.method() === 'POST') requests.push({pathname,submitted});
      const failed = submitted && params.get('extension') === 'reject';
      if (submitted && !failed) saved = {extension:params.get('extension').trim(),number:params.get('phoneNumber')};
      const showForm = pathname === addresses && (!submitted || failed || params.has('apply'));
      const user = pathname.endsWith('/Other/') ? 'OtherUser' : 'NewUser';
      const draft = failed ? {extension:params.get('extension'),number:params.get('phoneNumber')} : saved;
      const marker = serial === 0 ? ` data-cp-extension-state="done" data-cp-extension="${esc(initial.extension)}" data-cp-number="${esc(initial.number)}"` : '';
      const form = `<form name="mainForm" method="post"><input type="hidden" name="formtokenserial" value="t-${++serial}">
        <table><tr><td class="screenName">Addresses</td></tr><tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="ok" value="OK"><input type="submit" name="apply" value="Apply"></td></tr>
        ${failed ? '<tr><td class="error"><span class="Failure">Invalid extension</span></td></tr>' : ''}
        <tr><td class="enduserbody"><table><tr><td>Phone Number:</td><td><select id="phoneNumber" name="phoneNumber">${['','2055550142','2055550143'].map(n => `<option value="${n}"${n === draft.number ? ' selected' : ''}>${n || 'None'}</option>`).join('')}</select></td></tr>
        <tr><td>Extension:</td><td><input type="text" id="extension" name="extension" value="${esc(draft.extension)}"></td></tr></table></td></tr></table></form>`;
      return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><title>${showForm ? 'Addresses' : 'Profile'}</title></head><body id="initBody.menuTemplate">
        <table><tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a> &gt; <a class="headerAuthLevelLink">Provider</a> &gt; <a class="headerAuthLevelLink">Group</a> &gt; <a class="headerAuthLevelLink">Users</a> : <span class="headerAuthLevel"${marker}>${user}</span></td></tr></table>
        <table height="100%"><tr><td class="headandfoot" width="18%"><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form></td><td width="82%" valign="top">${showForm ? form : '<h1 class="screenName">Profile</h1><input name="formtokenserial" value="t-' + serial + '">'}</td></tr></table>
        <script>window.redirectPost=function(){};</script></body></html>`});
    });
    const page = await context.newPage();
    await page.goto(origin + profilePath);
    await page.locator('.cp-ext-chip').waitFor();
    assert.equal(page.url(),origin+profilePath,'the mock starts on its requested Profile page');
    if (renderDelay) {
      const cdp=await context.newCDPSession(page),contexts=[];
      cdp.on('Runtime.executionContextCreated',event=>contexts.push(event.context));
      await cdp.send('Runtime.enable');
      let patched=0;
      for(const executionContext of contexts){
        const check=await cdp.send('Runtime.evaluate',{contextId:executionContext.id,expression:'typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id'});
        if(!check.result.value)continue;
        await cdp.send('Runtime.evaluate',{contextId:executionContext.id,expression:`(()=>{const request=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>request(timestamp=>setTimeout(()=>callback(timestamp),${renderDelay}));})()`});
        patched++;
      }
      assert.ok(patched>0,'exercise rendering in the isolated extension context');
    }
    const nav = async url => {
      await page.evaluate(url => window.redirectPost(url,{}),url);
      await page.waitForFunction(url => document.documentElement.getAttribute('data-cp-path') === url,url);
      // Navigation commits before the isolated content script paints the header.
      await page.locator('.cp-ext-chip b').waitFor({state:'attached'});
    };
    return {page,nav,requests,close:async () => { await context.close(); fs.rmSync(temp,{recursive:true,force:true}); }};
  } catch(error) { await context.close(); fs.rmSync(temp,{recursive:true,force:true}); throw error; }
}

const values = page => page.evaluate(() => ({extension:document.querySelector('.cp-ext-chip b')?.textContent || '',number:document.querySelector('.cp-num-chip b')?.textContent || ''}));

for (const action of ['apply','ok']) test(`${action} refreshes a new user's breadcrumb with saved Addresses values`, async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await values(f.page),{extension:'–',number:''});
    await f.nav(addresses);
    await f.page.locator('#extension').fill(action === 'apply' ? ' 1042 ' : '1042');
    await f.page.locator('#phoneNumber').selectOption('2055550142');
    assert.deepEqual(await values(f.page),{extension:'–',number:''},'draft values are not presented as saved');
    await f.page.locator(`input[name="${action}"]`).click();
    await f.page.waitForFunction(() => document.querySelector('.cp-ext-chip b')?.textContent === '1042' && document.querySelector('.cp-num-chip b')?.textContent === '205-555-0142');
    await f.page.locator('.cp-ext-chip').click();
    assert.equal(await f.page.evaluate(() => navigator.clipboard.readText()),'1042');
    await f.page.locator('.cp-num-chip').click();
    assert.equal(await f.page.evaluate(() => navigator.clipboard.readText()),'2055550142');
    await f.nav(profilePath);
    assert.deepEqual(await values(f.page),{extension:'1042',number:'205-555-0142'},'values persist on the next page');
    assert.equal(f.requests.filter(r => r.submitted).length,1,'refresh does not submit again');
    assert.equal(f.requests.filter(r => r.pathname === addresses).length,2,'the breadcrumb does not trigger another expensive Addresses read');
    await f.nav('/commpilot/User/Other/');
    await f.page.waitForFunction(() => document.querySelector('.cp-ext-chip b')?.textContent === '–' && !document.querySelector('.cp-num-chip'));
  } finally { await f.close(); }
});

test('a rejected Addresses save keeps the saved breadcrumb, and clearing values removes them', async () => {
  const f = await fixture({extension:'1042',number:'2055550142'},120);
  try {
    await f.page.evaluate(()=>{
      window.rejectedIdentityPainted=false;
      new MutationObserver(()=>{
        if(document.querySelector('.cp-ext-chip b')?.textContent==='reject'||
          document.querySelector('.cp-num-chip b')?.textContent==='205-555-0143')window.rejectedIdentityPainted=true;
      }).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
    });
    await f.nav(addresses);
    await f.page.locator('#extension').fill('reject');
    await f.page.locator('#phoneNumber').selectOption('2055550143');
    await f.page.locator('input[name="apply"]').click();
    await f.page.locator('.Failure').waitFor({state:'attached'});
    await f.page.locator('.cp-ext-chip b').waitFor({state:'attached'});
    assert.deepEqual(await values(f.page),{extension:'1042',number:'205-555-0142'},'a validation error does not change the saved identity');
    await f.nav(profilePath);
    assert.deepEqual(await values(f.page),{extension:'1042',number:'205-555-0142'});
    await f.nav(addresses);
    await f.page.locator('#extension').fill('');
    await f.page.locator('#phoneNumber').selectOption('');
    await f.page.locator('input[name="apply"]').click();
    await f.page.waitForFunction(() => document.querySelector('.cp-ext-chip b')?.textContent === '–' && !document.querySelector('.cp-num-chip'));
    await f.nav(profilePath);
    assert.deepEqual(await values(f.page),{extension:'–',number:''});
    assert.equal(await f.page.evaluate(()=>window.rejectedIdentityPainted),false,'rejected fields never appear as the saved identity');
  } finally { await f.close(); }
});
