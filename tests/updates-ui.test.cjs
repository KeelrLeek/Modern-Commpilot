const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright-core');
const root = path.resolve(__dirname, '..');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';
const html = `<!doctype html><html><head><title>Profile</title></head><body id="initBody.menuTemplate">
<table><tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a> &gt;
<span class="headerAuthLevel">Test Group</span></td>
<td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr></table>
<table height="100%"><tr><td width="18%"><form name="leftNavForm"><a class="leftnavfolder">Profile</a></form></td>
<td width="82%" valign="top"><table><tr><td class="screenName">Profile</td></tr></table>
<form name="mainForm"><table><tr><td class="formLabel">First Name:</td><td><input value="Test"></td></tr></table>
<button type="button">Apply</button></form></td></tr></table></body></html>`;
const bootstrap = `
globalThis.updateFixture = {stable:'0.3.82',nightly:null,mode:'normal',calls:[]};
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.github.com/repos/KeelrLeek/Modern-Commpilot/releases/')) throw Error('Unexpected network request');
  const fixture=globalThis.updateFixture;
  fixture.calls.push(String(url));
  const nightly=String(url).endsWith('/nightly'), version=nightly?fixture.nightly:fixture.stable;
  if(fixture.mode==='offline') throw Error('Network offline');
  if(fixture.mode==='delayed'&&nightly) await new Promise(resolve=>{fixture.finish=resolve});
  if(!version)return new Response('{}',{status:404});
  const tag=nightly?'nightly':'v'+version+'-pjax-preview';
  const name='BroadWorks-Enhancer-PJAX-Preview-'+version+(nightly?'-nightly':'')+'.zip';
  const base='https://github.com/KeelrLeek/Modern-Commpilot/releases';
  return new Response(JSON.stringify({draft:false,prerelease:nightly,tag_name:tag,published_at:'2026-10-20T10:00:00Z',
    html_url:base+'/tag/'+tag,body:'## Improvements\\n- Consistent fonts.\\n<img src=x onerror="window.badNotes=true">',
    assets:[{name,state:'uploaded',size:12345,browser_download_url:base+'/download/'+tag+'/'+name}]}),
    {status:200,headers:{'Content-Type':'application/json'}});
};
importScripts('/src/bg/credential-bridge.js');`;

test('Updates works inside Settings, isolates channels and errors, and matches shared type in light and dark themes', async()=>{
  assert.ok(executablePath);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bw-updates-test-'));
  const extension=path.join(temporary,'extension');
  fs.mkdirSync(extension);
  fs.cpSync(path.join(root,'src'),path.join(extension,'src'),{recursive:true});
  for(const folder of ['icons','fonts']){
    fs.cpSync(path.join(root,'assets',folder),path.join(extension,'assets',folder),{recursive:true});
  }
  fs.mkdirSync(path.join(extension,'assets','help'),{recursive:true});
  fs.copyFileSync(path.join(root,'assets/help/help-content.json'),path.join(extension,'assets/help/help-content.json'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  manifest.background.service_worker='fixture-loader.js';
  fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension,'fixture-loader.js'),bootstrap);
  let context;
  try{
    context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{executablePath,headless:true,
      viewport:{width:1400,height:950},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const posts=[];
    await context.route(origin+'/**',route=>{
      if(route.request().method()==='POST')posts.push({url:route.request().url(),body:route.request().postData()});
      return route.fulfill({status:200,contentType:'text/html',body:html,
        headers:{'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self'"}});
    });
    const page=await context.newPage();
    await page.goto(origin+'/commpilot/Group/Profile/');
    const settings=page.getByRole('button',{name:'Settings',exact:true});
    await settings.click();
    const panel=page.getByRole('dialog',{name:'Settings',exact:true});
    await panel.getByRole('button',{name:'Updates',exact:true}).click();
    const updates=panel.getByRole('region',{name:'Updates',exact:true});
    await updates.getByText('You’re up to date on Stable.',{exact:true}).waitFor();
    const initialPosts=posts.slice();
    assert.equal(await updates.locator('[name="cp-update-channel"][value="stable"]').isChecked(),true);
    assert.equal(await updates.locator('.cp-update-download').isVisible(),false);
    await updates.locator('[name="cp-update-automatic"]').uncheck();
    await page.waitForFunction(()=>document.querySelector('.cp-updates').getAttribute('aria-busy')==='false');

    async function scenario(values,channel='Stable'){
      await worker.evaluate(async({values,channel})=>{
        Object.assign(globalThis.updateFixture,values);
        await chrome.storage.local.remove('cpUpdate'+channel);
      },{values,channel});
      await page.waitForFunction(()=>document.querySelector('.cp-updates').getAttribute('aria-busy')==='false');
    }
    await scenario({stable:'0.3.83'});
    await updates.getByRole('button',{name:'Check for updates',exact:true}).click();
    await updates.getByText('Stable update available: 0.3.83',{exact:true}).waitFor();
    assert.match(await updates.locator('.cp-update-download').getAttribute('href'),/\/v0\.3\.83-pjax-preview\/BroadWorks-Enhancer-PJAX-Preview-0\.3\.83\.zip$/);
    await updates.locator('.cp-update-notes summary').click();
    assert.equal(await updates.locator('.cp-update-notes img').count(),0,'release notes are never HTML');
    assert.equal(await page.evaluate(()=>window.badNotes),undefined);

    const screenshots=path.join(root,'dev-preview/update-checker');
    fs.mkdirSync(screenshots,{recursive:true});
    for(const font of ['inter','geist','arial']){
      for(const palette of ['graphite','rosepine-light']){
        await worker.evaluate(async({font,palette})=>{
          const stored=await chrome.storage.local.get('cpSettings');
          await chrome.storage.local.set({cpSettings:{...stored.cpSettings,font},cpThemePalette:palette});
        },{font,palette});
        await page.waitForFunction(({font,palette})=>document.documentElement.dataset.cpFont===font&&document.documentElement.dataset.cpDirection===palette,{font,palette});
        await page.evaluate(()=>document.fonts.ready);
        const metrics=await page.evaluate(()=>{
          const pick=selector=>{const s=getComputedStyle(document.querySelector(selector));return {
            family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,style:s.fontStyle,line:s.lineHeight,
            radius:s.borderRadius,padding:s.padding}};
          return {check:pick('.cp-update-check'),copy:pick('.cp-about-copy'),download:pick('.cp-update-download'),
            channel:pick('.cp-updates .cp-theme-mode label'),theme:pick('[aria-label="Theme"] .cp-theme-mode label')};
        });
        assert.deepEqual(metrics.check,metrics.copy,`${font}/${palette}: update button matches About`);
        assert.deepEqual(metrics.download,metrics.copy,`${font}/${palette}: download matches existing button`);
        assert.deepEqual(metrics.channel,metrics.theme,`${font}/${palette}: channel matches theme segments`);
        if(font==='inter'){
          await panel.getByRole('button',{name:'Updates',exact:true}).click();
          await panel.screenshot({path:path.join(screenshots,`settings-${palette}.png`)});
        }
      }
    }
    await updates.locator('[value="nightly"]').check();
    await updates.getByRole('button',{name:'Check for updates',exact:true}).click();
    await updates.getByText('No nightly release has been published yet.',{exact:true}).waitFor();
    assert.equal(await updates.locator('.cp-update-download').isVisible(),false);
    await scenario({nightly:'0.3.83.1'},'Nightly');
    await updates.getByRole('button',{name:'Check for updates',exact:true}).click();
    await updates.getByText('Nightly update available: 0.3.83.1',{exact:true}).waitFor();
    await scenario({mode:'offline'},'Nightly');
    await updates.getByRole('button',{name:'Check for updates',exact:true}).click();
    await updates.getByText('Could not reach GitHub. Check your connection and try again.',{exact:true}).waitFor();
    assert.equal(await updates.locator('.cp-update-download').isVisible(),false);

    // An old channel's delayed response must never restore its Download link over the current channel.
    await scenario({mode:'delayed'},'Nightly');
    await updates.locator('[name="cp-update-automatic"]').check();
    await worker.evaluate(async()=>{
      for(let attempt=0;attempt<200;attempt++){
        if(typeof globalThis.updateFixture.finish==='function')return;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      throw Error('Nightly request did not start');
    });
    await updates.locator('[value="stable"]').check();
    await updates.getByText('Stable update available: 0.3.83',{exact:true}).waitFor();
    await worker.evaluate(()=>{globalThis.updateFixture.mode='normal';globalThis.updateFixture.finish()});
    await page.waitForFunction(()=>document.querySelector('.cp-updates').getAttribute('aria-busy')==='false');
    assert.equal(await updates.locator('[value="stable"]').isChecked(),true);
    assert.match(await updates.locator('.cp-update-download').getAttribute('href'),/v0\.3\.83-pjax-preview/);

    await page.setViewportSize({width:480,height:800});
    await panel.getByRole('button',{name:'Updates',exact:true}).click();
    assert.equal(await page.evaluate(()=>{
      const panel=document.querySelector('#cp-appearance-panel'),body=panel.querySelector('.cp-settings-body');
      return panel.getBoundingClientRect().right<=innerWidth&&body.scrollWidth<=body.clientWidth+1;
    }),true,'narrow Settings stays inside the viewport without horizontal overflow');
    await updates.locator('.cp-update-help summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await updates.locator('.cp-update-help').getAttribute('open'),'');
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'cp-appearance-toggle');
    assert.deepEqual(posts,initialPosts,'checking and selecting channels never submit CommPilot forms');
  }finally{
    await context?.close();
    const resolved=path.resolve(temporary);
    assert.ok(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('bw-updates-test-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
