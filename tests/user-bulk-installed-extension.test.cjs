const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright-core');
const {fixture,R}=require('./fixtures/bulk-group-harness.cjs');
const extension=path.resolve(process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..'));

async function installed(run){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bw-bulk-installed-'));
  const context=await chromium.launchPersistentContext(temp,{headless:true,
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--disable-background-networking'],viewport:{width:1400,height:1000}});
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
    assert.ok(manifest.content_scripts.some(s=>s.world==='MAIN'&&s.js?.includes('src/content/user-bulk-engine.js')));
    assert.ok(manifest.content_scripts.some(s=>!s.world&&s.js?.includes('src/content/user-bulk-storage.js')));
    await worker.evaluate(async()=>{
      await chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['ruleset_1']});
      await chrome.alarms.clearAll();
      await chrome.storage.local.set({cpThemePalette:'graphite',cpSettings:{peek:false}});
    });
    // Every page request is synthetic. Unknown destinations are refused.
    await context.route('https://**/*',route=>route.abort('blockedbyclient'));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await run({page,worker});
    assert.deepEqual(errors,[]);
  }finally{
    await context.close();
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'bw-bulk-installed-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

test('installed extension provisions a mixed batch through its real manifest worlds',async()=>installed(async({page})=>{
  const state=await fixture(page,{extensionLoaded:true,addressesReturnsProfile:true,truncateLines:true,nativeHeadValidators:true});
  await page.evaluate(async()=>{
    const lease=await cpAcquireUserBulk(),engine=cpCreateBulkEngine(lease),info=await engine.initialize();
    const config={...CpBulkModel.initial(info),prefix:'AZindust',prefixChosen:true,devicePrefix:'AZ',voicemail:'on',primary:true,primaryType:CpBulkModel.catalog.vvx.type};
    const credentials={web:'Easy1234',sip:{Operations:'Synthetic-Sip-A1'},mailbox:'Synthetic-Mail-A1',device:'Synthetic-Device-A1'};
    const batch=[
      {first:'Alex',last:'Example',email:'alex@example.test',dept:'Operations',number:'',extension:'1234'},
      {first:'Blair',last:'Example',email:'blair@example.test',dept:'Operations',number:'3125550199',extension:'1235',voicemail:'off',primary:false,sca:['mobile']}
    ];
    try{
      await engine.preflightGroup(batch,config,credentials);
      for(const u of batch)for(const step of CpBulkModel.steps(u.plan))await engine.stepGroup(u,step.key,credentials);
    }finally{lease.release();}
  });
  assert.equal(state.badTokens,0);
  const a=state.users.get('AZindust1234'),b=state.users.get('AZindust1235');
  assert.equal(a.number,'');assert.equal(a.caller,'3125550100');assert.equal(a.extension,'1234');
  assert.equal(a.primary.line,'AZindust1234');assert.equal(a.sca.length,2);
  assert.equal(a.mailbox,'AZindust1234@trifecta.avpaas.io');assert.equal(a.pin,'54321');assert.equal(a.vm,true);
  assert.equal(b.number,'3125550199');assert.equal(b.primary,undefined);assert.equal(b.sca.length,1);
  assert.equal(b.vm,false);assert.equal(b.mailbox,undefined);assert.equal(b.pin,undefined);
  for(const [name,username]of [['AZ WX 1234','AZ_WX_1234'],['AZ WXPC 1234','AZ_WXPC_1234'],['AZ WX 1235','AZ_WX_1235']])assert.equal(state.devices.get(name).username,username);
  for(const id of ['AZindust1234','AZindust1235']){
    const writes=state.writes.filter(w=>w.user===id);
    assert.equal(state.users.get(id).imp,true);assert.equal(writes.at(-1).route,R.imp);
    assert.ok(writes.findIndex(w=>w.route===R.deviceModify)>writes.findLastIndex(w=>w.route===R.scaAdd));
  }
}));

test('installed group defaults cross the isolated storage bridge and survive reopening',async()=>installed(async({page,worker})=>{
  await fixture(page,{extensionLoaded:true});
  await page.locator('#cp-user-bulk-launch').click();
  await page.locator('[data-setting=prefix]').fill('AZindust');
  await page.locator('[data-prefix-confirm]').check();
  await page.locator('[data-setting=devicePrefix]').fill('AZ');
  await page.locator('[data-setting=voicemail]').selectOption('off');
  await page.locator('[data-start]').fill('1234');
  await page.locator('[data-action=save-defaults]').click();
  await page.waitForFunction(()=>document.querySelector('.notice')?.textContent.includes('saved'));
  const entries=await worker.evaluate(async()=>Object.entries(await chrome.storage.local.get(null)).filter(([key])=>key.startsWith('cp.bulk.defaults.v1:')));
  assert.equal(entries.length,1);
  assert.equal(entries[0][1].settings.prefix,'AZindust');assert.equal(entries[0][1].settings.devicePrefix,'AZ');
  assert.equal(entries[0][1].settings.voicemail,'off');assert.equal(Object.keys(entries[0][1].settings).length,14);
  assert.ok(!JSON.stringify(entries).includes('Easy1234'));assert.ok(!JSON.stringify(entries).includes('1234'));
  await page.locator('[data-action=close]').click();
  await page.locator('#cp-user-bulk').waitFor({state:'detached'});
  await page.locator('#cp-user-bulk-launch').click();
  await page.locator('[data-setting=prefix]').waitFor();
  assert.equal(await page.locator('[data-setting=prefix]').inputValue(),'AZindust');
  assert.equal(await page.locator('[data-setting=devicePrefix]').inputValue(),'AZ');
  assert.equal(await page.locator('[data-start]').inputValue(),'','a previous batch start is not persisted');
}));
