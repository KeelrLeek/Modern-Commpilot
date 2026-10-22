const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {fixture,R}=require('./fixtures/bulk-group-harness.cjs');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

for(const guard of ['disabled','revert']){
  test(`a ${guard} voicemail choice stops before the native save-first link`,async()=>{
    const browser=await chromium.launch({executablePath,headless:true});
    try{
      const page=await browser.newPage(),state=await fixture(page,{vmChoiceGuard:guard});
      await setup(page);await run(page,0,['user','alternate']);
      const before=state.writes.length;
      const failure=await run(page,0,['voicemail']).then(()=>'',error=>error.message);
      assert.ok(failure,'the requested voicemail choice was not applied');
      assert.equal(state.writes.slice(before).length,0,'no save-first action may submit a locked or reverted choice');
      assert.match(failure,guard==='disabled'?/locked.*vm_active/:/changed.*vm_active/);
    }finally{await browser.close();}
  });
}
async function setup(page){
  return page.evaluate(async()=>{
    window.lease=await cpAcquireUserBulk();window.engine=cpCreateBulkEngine(lease);window.info=await engine.initialize();
    window.config={...CpBulkModel.initial(info),prefix:'AZindust',prefixChosen:true,devicePrefix:'AZ',voicemail:'on',primary:true,primaryType:CpBulkModel.catalog.vvx.type};
    window.credentials={web:'Easy1234',sip:{Operations:'Sip-Test-A1'},mailbox:'Mail-Test-A1',device:'Device-Test-A1'};
    window.batch=[
      {first:'Alex',last:'Example',email:'alex@example.test',dept:'Operations',number:'',extension:'1234'},
      {first:'Blair',last:'Example',email:'blair@example.test',dept:'Operations',number:'3125550199',extension:'1235',voicemail:'off',primary:false,sca:['mobile']}
    ];
    await engine.preflightGroup(batch,config,credentials);
    batch.forEach(u=>u.completed=[]);
    return info;
  });
}
async function run(page,index,keys){
  return page.evaluate(async({index,keys})=>{
    const u=batch[index];
    for(const key of keys||CpBulkModel.steps(u.plan).map(s=>s.key)){
      if(u.completed.includes(key))continue;
      await engine.stepGroup(u,key,credentials);u.completed.push(key);
    }
    return u.completed;
  },{index,keys});
}
test('mixed DID and extension-only batch provisions selected devices, mailbox, portal PIN and IM&P in order',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page,{addressesReturnsProfile:true,truncateLines:true,nativeHeadValidators:true});
    await setup(page);await run(page,0);await run(page,1);
    assert.equal(state.badTokens,0);
    const a=state.users.get('AZindust1234'),b=state.users.get('AZindust1235');
    assert.equal(a.number,'');assert.equal(a.caller,'3125550100');assert.equal(a.extension,'1234');
    assert.equal(b.number,'3125550199');assert.equal(b.caller,'+13125550199');assert.equal(b.primary,undefined);
    assert.equal(a.primary.line,'AZindust1234');assert.equal(a.sca.length,2);assert.equal(b.sca.length,1);
    assert.equal(state.devices.get('AZ WX 1234').username,'AZ_WX_1234');
    assert.equal(state.devices.get('AZ WXPC 1234').username,'AZ_WXPC_1234');
    assert.equal(a.mailbox,'AZindust1234@trifecta.avpaas.io');assert.equal(a.pin,'54321');assert.equal(a.vm,true);
    assert.equal(b.vm,false);assert.equal(b.mailbox,undefined);assert.equal(b.pin,undefined);
    assert.equal(a.imp,true);assert.equal(b.imp,true);
    for(const id of ['AZindust1234','AZindust1235']){
      const writes=state.writes.filter(w=>w.user===id);
      assert.equal(writes.at(-1).route,R.imp);
      const firstAccess=writes.findIndex(w=>w.route===R.deviceModify),lastSca=writes.findLastIndex(w=>w.route===R.scaAdd);
      assert.ok(firstAccess>lastSca);
    }
    assert.equal(state.writes.find(w=>w.route===R.portal).params.pwdType,'VoicePortal');
    const addCount=state.writes.filter(w=>w.route===R.add).length;
    await page.evaluate(()=>engine.stepGroup(batch[0],'user',credentials));
    assert.equal(state.writes.filter(w=>w.route===R.add).length,addCount);
  }finally{await browser.close();}
});
test('Webex access failure prevents IM&P, other users can finish, and retry preserves appearances',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);await setup(page);
    state.rejectRoute=R.deviceModify;
    await assert.rejects(run(page,0),/Rejected native step/);
    assert.equal(state.users.get('AZindust1234').imp,undefined);
    state.rejectRoute=null;
    await run(page,1);await run(page,0);
    assert.equal(state.users.get('AZindust1234').sca.length,2);
    assert.equal(state.users.get('AZindust1235').imp,true);
    assert.equal(state.writes.filter(w=>w.route===R.add).length,2);
  }finally{await browser.close();}
});
test('an uncertain credential save requires acknowledgement rather than replaying a password reset',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);await setup(page);
    await run(page,0,['user','alternate','addresses']);
    state.dropRoute=R.auth;
    await assert.rejects(run(page,0,['auth']));
    assert.equal(await page.evaluate(()=>batch[0].uncertainSecret),'auth');
    const saves=state.writes.filter(w=>w.route===R.auth).length;
    await page.evaluate(()=>lease.recover());
    await assert.rejects(run(page,0,['auth']),/unconfirmed/);
    assert.equal(state.writes.filter(w=>w.route===R.auth).length,saves);
  }finally{await browser.close();}
});
test('RSG setup never runs an unrestricted group user search',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page,{group:'RSG'});
    await page.evaluate(async()=>{window.lease=await cpAcquireUserBulk();window.engine=cpCreateBulkEngine(lease);await engine.initialize();});
    assert.equal(state.requests.filter(r=>r.route===R.users&&r.params.search).length,0);
  }finally{await browser.close();}
});
test('incompatible portal PIN and missing primary IM&P identity cannot produce a configured user',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page,{forbidPin:true});
    await assert.rejects(setup(page),/descending-digit/);assert.equal(state.writes.length,0);
    await page.close();
    const page2=await browser.newPage(),state2=await fixture(page2,{noImpId:true});
    await setup(page2);await assert.rejects(run(page2,1),/primary IM&P ID/);
    assert.equal(state2.users.get('AZindust1235').imp,undefined);
    assert.equal(state2.writes.some(w=>w.route===R.imp),false);
  }finally{await browser.close();}
});
test('saved defaults contain no passwords or per-user overrides and empty groups require a fresh start',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();await fixture(page);
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=numberMode]').waitFor();
    await page.locator('[data-setting=prefix]').fill('AZindust');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-start]').fill('1234');
    await page.locator('[data-action=save-defaults]').click();
    await page.waitForFunction(()=>document.querySelector('.notice').textContent.includes('saved'));
    const storage=await page.evaluate(()=>window.testStorage);
    assert.equal(Object.keys(storage).length,1);const serialized=JSON.stringify(storage);
    assert.ok(serialized.includes('AZindust'));assert.ok(!serialized.includes('Easy1234'));
    assert.ok(!serialized.includes('1234'));
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-field=first]').fill('Alex');
    await page.locator('[data-field=last]').fill('Example');
    await page.locator('[data-field=email]').fill('alex@example.test');
    await page.locator('[data-field=dept]').selectOption('Operations');
    assert.equal(await page.locator('[data-field=extension]').inputValue(),'1234');
    await page.locator('[data-action=options]').click();
    await page.locator('[data-user-sca][data-kind=desktop]').uncheck();
    await page.locator('[data-field=devicePassword]').fill('Never-store-this');
    await page.locator('.subdialog [data-action=dismiss]').last().click();
    await page.locator('[data-action=save-defaults]').click();
    await page.waitForFunction(()=>!document.querySelector('#cp-user-bulk').getAttribute('aria-busy')||document.querySelector('#cp-user-bulk').getAttribute('aria-busy')==='false');
    assert.ok(!JSON.stringify(await page.evaluate(()=>window.testStorage)).includes('Never-store-this'));
    await page.locator('[data-action=close]').click();
    await page.locator('#cp-user-bulk-launch').click();
    // Empty groups require a fresh start; a stale previous batch extension is never restored.
    await page.locator('[data-start]').waitFor();
    assert.equal(await page.locator('[data-start]').inputValue(),'');
    assert.equal(await page.locator('[data-setting=prefix]').inputValue(),'AZindust');
  }finally{await browser.close();}
});

test('a lost multipart response stops the batch and never repeats a device password save',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);await setup(page);
    await run(page,1,['user','alternate','addresses','auth','sca:mobile']);
    state.dropRoute=R.deviceModify;
    await assert.rejects(run(page,1,['access:mobile']),/response was lost/);
    assert.equal(await page.evaluate(()=>batch[1].uncertainSecret),'access:mobile');
    assert.equal(state.devices.get('AZ WX 1235').username,'AZ_WX_1235','server accepted before response was lost');
    const before=state.writes.length;
    await page.evaluate(()=>lease.recover());
    await assert.rejects(run(page,1,['access:mobile']),/unconfirmed/);
    assert.equal(state.writes.length,before);
    assert.equal(state.users.get('AZindust1235').imp,undefined);
  }finally{await browser.close();}
});

test('returning groups reuse defaults, suggest a fresh next extension, and isolate other groups',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);
    state.users.set('AZindust1233',{first:'Existing',last:'User',email:'existing@example.test',extension:'1233',sca:[]});
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=prefix]').waitFor();
    assert.equal(await page.locator('[data-setting=prefix]').inputValue(),'AZindust');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-action=save-defaults]').click();
    await page.waitForFunction(()=>document.querySelector('.notice').textContent.includes('saved'));
    await page.locator('[data-action=primary]').click();
    assert.equal(await page.locator('[data-field=extension]').inputValue(),'1234');
    await page.locator('[data-action=add]').first().click();
    await page.locator('[data-action=settings]').click();
    await page.locator('[data-start]').fill('1235');await page.locator('[data-action=primary]').click();
    assert.deepEqual(await page.locator('[data-field=extension]').evaluateAll(nodes=>nodes.map(n=>n.value)),['1235','1236']);
    await page.locator('[data-action=close]').click();
    state.users.set('AZindust1234',{first:'Another',last:'User',email:'another@example.test',extension:'1234',sca:[]});
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-field=extension]').waitFor();
    assert.equal(await page.locator('[data-field=extension]').inputValue(),'1235');
    assert.equal(await page.locator('[data-setting=prefix]').count(),0,'saved group skips setup');
    await page.locator('[data-action=close]').click();
    // Close restores the native page asynchronously before releasing the bulk lease. A real user cannot
    // navigate through the still-open modal; this direct redirectPost call must also wait for it to close.
    await page.locator('#cp-user-bulk').waitFor({state:'detached'});
    state.group='Different';await page.evaluate(()=>redirectPost('/commpilot/Group/Members/',{}));
    await page.waitForFunction(()=>document.querySelector('.headerBar').textContent.includes('Different'));
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=devicePrefix]').waitFor();
    assert.equal(await page.locator('[data-setting=devicePrefix]').inputValue(),'','other group cannot inherit device prefix');
    assert.equal(state.writes.length,0);
  }finally{await browser.close();}
});

async function openBatch(page,numberMode){
  await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=prefix]').waitFor();
  await page.locator('[data-setting=prefix]').fill('AZindust');await page.locator('[data-prefix-confirm]').check();
  await page.locator('[data-setting=devicePrefix]').fill('AZ');await page.locator('[data-setting=voicemail]').selectOption('off');
  await page.locator('[data-setting=numberMode]').selectOption(numberMode);
  await page.locator('[data-start]').fill('1234');await page.locator('[data-action=primary]').click();
  for(const [field,value]of [['first','Alex'],['last','Example'],['email','alex@example.test']])await page.locator('[data-field='+field+']').fill(value);
  await page.locator('[data-field=dept]').selectOption('Operations');
}
async function toReview(page){
  await page.locator('[data-action=primary]').click();
  await page.locator('[data-credential=device]').fill('Device-Test-A1');
  await page.locator('[data-password=Operations]').fill('Sip-Test-A1');
}
const idle=page=>page.waitForFunction(()=>document.querySelector('#cp-user-bulk').getAttribute('aria-busy')==='false',null,{timeout:30000});

for(const numberMode of ['mixed','all']){
  test(`Enter in the ${numberMode} number search only picks a matching number`,async()=>{
    const browser=await chromium.launch({executablePath,headless:true});
    try{
      const page=await browser.newPage(),state=await fixture(page,{numbers:['3125550198','3125550199']});
      page.setDefaultTimeout(6000);
      await openBatch(page,numberMode);
      const pick=page.locator('[data-pick]'),search=page.locator('.picker input'),lookups=()=>state.requests.filter(r=>r.route===R.numbers).length;
      await pick.click();await page.locator('[data-number="3125550198"]').click();
      await pick.click();await search.fill('0199');await search.press('Enter');
      assert.equal(await pick.innerText(),'3125550199','Enter chooses the only matching number');
      const before=lookups();
      await pick.click();await search.fill('7777');await search.press('Enter');
      assert.equal(await search.inputValue(),'7777','Enter without a match keeps the search open');
      assert.equal(lookups(),before,'Enter never starts a native number lookup');
      await page.locator('[data-action=hide-picker]').click();
      assert.equal(await pick.innerText(),'3125550199','Enter without a match keeps the chosen number');
      if(numberMode==='mixed'){
        await pick.click();await search.press('ArrowDown');
        assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'no-number','ArrowDown still reaches every option');
        await page.keyboard.press('Enter');
        assert.equal(await pick.innerText(),'No personal number','an explicit choice can still clear the number');
      }
      assert.equal(state.writes.length,0);
    }finally{await browser.close();}
  });
}

test('Review checks the session again after a lost preflight navigation',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);
    await openBatch(page,'none');await toReview(page);
    state.dropNavigation={route:R.users,user:null};
    await page.locator('[data-action=primary]').click();await idle(page);
    assert.match(await page.locator('.notice').textContent(),/could not be confirmed/);
    assert.equal(state.dropNavigation,null,'only one navigation is lost');
    await page.locator('[data-action=primary]').click();await idle(page);
    assert.equal(await page.locator('.review-table').count(),1,await page.locator('.notice').textContent());
    assert.equal(state.badTokens,0);assert.equal(state.writes.length,0);
  }finally{await browser.close();}
});

test('a paused batch with a started user closes only after confirmation and leaves a fresh token',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);
    page.setDefaultTimeout(10000);
    await openBatch(page,'none');await toReview(page);
    await page.locator('[data-action=primary]').click();await page.locator('.review-table').waitFor();
    state.dropRoute=R.auth;
    await page.locator('[data-action=primary]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.startsWith('Batch paused'),null,{timeout:30000});
    const batch=page.locator('#cp-user-bulk'),confirm=page.locator('.subdialog [data-action=confirm-close]'),requests=state.requests.length;
    await page.keyboard.press('Escape');
    assert.equal(await confirm.isVisible(),true,'Escape asks before discarding users already started on the PBX');
    await page.keyboard.press('Escape');
    assert.equal(await confirm.isVisible(),false,'Escape dismisses the question');
    for(let i=0;i<4;i++)await page.keyboard.press('Escape');
    assert.equal(await confirm.isVisible(),false);
    assert.equal(await batch.evaluate(n=>n.isConnected&&n.open),true,'repeated Escape keeps the paused batch open');
    await page.locator('[data-action=details]').first().click();
    assert.equal(await page.locator('[data-action=ack-secret]').count(),1,'the uncertain save can still be verified');
    await page.keyboard.press('Escape');
    await page.locator('[data-action=close]').click();await confirm.waitFor();
    await page.locator('.subdialog footer [data-action=dismiss]').click();
    assert.equal(await batch.evaluate(n=>n.isConnected&&n.open),true);
    assert.equal(state.requests.length,requests,'nothing leaves the batch before confirmation');
    await page.locator('[data-action=close]').click();await confirm.click();
    await batch.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-cp-path')||location.pathname),R.users);
    assert.equal(await page.evaluate(()=>document.getElementsByName('formtokenserial')[0].value),'t'+state.serial,'the page keeps the current native token');
    await page.evaluate(()=>redirectPost('/commpilot/Group/Members/',{}));
    await page.locator('#cp-user-bulk-launch').waitFor();
    assert.equal(state.badTokens,0);
    assert.equal(state.writes.filter(w=>w.route===R.auth).length,1,'the lost save is never sent again');
  }finally{await browser.close();}
});

test('existing Webex enables IM&P last, while no Webex preserves IM&P without a write',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);await setup(page);
    await page.evaluate(async()=>{
      for(const u of batch){u.sca=[];u.primary=false;u.voicemail='off';}
      await engine.preflightGroup(batch,config,credentials);
    });
    const beforeImp=['user','alternate','addresses','auth','voicemail','verify'];
    await run(page,0,beforeImp);
    const a=state.users.get('AZindust1234');
    a.sca.push({name:'Existing Webex',type:'Connect - Mobile (System)',line:'existing'});
    await run(page,0,['imp']);assert.equal(a.imp,true);
    await run(page,1,beforeImp);state.users.get('AZindust1235').imp=true;
    const writes=state.writes.length;await run(page,1,['imp']);
    assert.equal(state.writes.length,writes);assert.equal(state.users.get('AZindust1235').imp,true);
  }finally{await browser.close();}
});

test('the group UI completes an extension-only Webex and voicemail user using per-user profile choices',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),state=await fixture(page);
    const nativeFont=await page.locator('input[name=findValue0]').evaluate(e=>{
      const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];
    });
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=prefix]').waitFor();
    await page.locator('[data-setting=prefix]').fill('AZindust');await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=devicePrefix]').fill('AZ');await page.locator('[data-setting=voicemail]').selectOption('on');
    await page.locator('[data-start]').fill('1234');
    const path=require('node:path'),fs=require('node:fs'),dir=path.resolve(__dirname,'../dev-preview/bulk-group-setup');
    fs.mkdirSync(dir,{recursive:true});
    await page.screenshot({path:path.join(dir,'implemented-setup-dark.png')});
    const font=await page.locator('[data-setting=prefix]').evaluate(e=>{
      const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];
    });
    assert.deepEqual(font,nativeFont);
    await page.locator('[data-action=primary]').click();
    for(const [field,value]of [['first','Alex'],['last','Example'],['email','alex@example.test']])await page.locator('[data-field='+field+']').fill(value);
    await page.locator('[data-field=dept]').selectOption('Operations');
    await page.locator('[data-action=options]').click();await page.locator('[data-user-sca][data-kind=desktop]').uncheck();
    await page.locator('.subdialog [data-action=dismiss]').last().click();
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-credential=mailbox]').fill('Mail-Test-A1');
    await page.locator('[data-credential=device]').fill('Device-Test-A1');
    await page.locator('[data-password=Operations]').fill('Sip-Test-A1');
    await page.locator('[data-action=primary]').click();await page.getByText('Review before creating',{exact:true}).waitFor();
    await page.evaluate(()=>document.documentElement.dataset.cpDirection='rosepine-light');
    await page.screenshot({path:path.join(dir,'implemented-review-light.png')});
    await page.locator('[data-action=primary]').click();
    await page.waitForFunction(()=>document.querySelector('.run-top strong')?.textContent==='1 configured · 0 need attention',null,{timeout:30000});
    assert.equal(state.users.get('AZindust1234').sca.length,1);
    assert.equal(state.users.get('AZindust1234').imp,true);
    assert.equal(state.users.get('AZindust1234').pin,'54321');
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});
