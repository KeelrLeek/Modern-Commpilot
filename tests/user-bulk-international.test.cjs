const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {fixture,R}=require('./fixtures/bulk-group-harness.cjs');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

test('three ready RSG users can continue after saving defaults with the native skin and Prototype loaded',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
    const state=await fixture(page,{group:'RSG',fullSkin:true,prototype:true,numbers:['3125550197','3125550198','3125550199']});
    await page.locator('#cp-user-bulk-launch').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk')?.getAttribute('aria-busy')==='false',null,{timeout:5000}).catch(async e=>{throw Error(JSON.stringify({errors,html:await page.locator('#cp-user-bulk').innerText(),requests:state.requests.slice(-3)}));});
    assert.equal(await page.locator('[data-setting=prefix]').count(),1,JSON.stringify({errors,notice:await page.locator('.notice').textContent()}));
    await page.locator('[data-action=save-defaults]').click();
    await page.waitForFunction(()=>document.querySelector('.notice').textContent.includes('saved'));
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-action=paste]').click();
    await page.locator('.subdialog textarea').fill('Alex\tExample\talex@example.test\tOperations\nBlair\tExample\tblair@example.test\tOperations\nCasey\tExample\tcasey@example.test\tOperations');
    await page.locator('[data-action=import]').click();
    for(const [i,n]of ['3125550197','3125550198','3125550199'].entries()){
      await page.locator('[data-pick]').nth(i).click();await page.locator('[data-number="'+n+'"]').click();
    }
    assert.match(await page.locator('.batch-summary').innerText(),/3 of 3 ready/);
    assert.equal(await page.locator('[data-action=primary]').isEnabled(),true,JSON.stringify(errors));
    await page.locator('[data-action=save-defaults]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('[data-action=primary]').isEnabled(),true);
    await page.locator('[data-action=primary]').click({timeout:4000});
    await page.locator('[data-credential=web]').waitFor({timeout:4000});
    assert.equal(state.writes.length,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('international lookup excludes assigned numbers and other departments, including overlapping ranges',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();await fixture(page,{prototype:true,numberRows:[
      {cells:['+44 20 7946 0123 - +44 20 7946 0125','','Operations']},
      {cells:['0044 20 7946 0124','existing@phonenetwork.net','Operations']},
      {cells:['+44 20 7946 0126','','Other']},
      {cells:['+45 32 12 34 56','','Operations']},
      {cells:['+1 312 555 0199','','Operations']}
    ]});
    const pool=await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateBulkEngine(lease);await engine.initialize();
      const numbers=await engine.loadNumbers('Operations');lease.release();return numbers;
    });
    assert.deepEqual([...pool].sort(),['442079460123','442079460125','4532123456','3125550199'].sort());
  }finally{await browser.close();}
});

test('London DID completes lookup, review and native provisioning with correct caller ID and Line/Ports',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page,{group:'RSG',fullSkin:true,prototype:true,numbers:['+44 20 7946 0123']});
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=prefix]').waitFor();
    await page.locator('[data-action=primary]').click();
    for(const [f,v]of [['first','London'],['last','Example'],['email','london@example.test']])await page.locator('[data-field='+f+']').fill(v);
    await page.locator('[data-field=dept]').selectOption('Operations');await page.locator('[data-pick]').click();
    await page.locator('.picker input').fill('+44 20');
    assert.equal(await page.locator('[data-number="442079460123"] span').textContent(),'442079460123');
    await page.locator('[data-number="442079460123"]').click();
    assert.equal(await page.locator('[data-field=extension]').inputValue(),'60123');
    assert.match(await page.locator('.batch-summary').textContent(),/1 of 1 ready/);
    await page.locator('[data-action=primary]').click();await page.locator('[data-password=Operations]').fill('Sip-London-A1');
    await page.locator('[data-action=primary]').click();await page.locator('.review-table').waitFor();
    assert.match(await page.locator('.review-table').textContent(),/442079460123@phonenetwork.net/);
    await page.locator('[data-action=primary]').click();
    await page.waitForFunction(()=>document.querySelector('.run-top strong')?.textContent==='1 configured · 0 need attention');
    const u=state.users.get('442079460123');
    // Select the PBX's existing option value; generated fields use raw digits.
    assert.equal(u.number,'+44 20 7946 0123');assert.equal(u.caller,'442079460123');assert.equal(u.extension,'60123');
    assert.equal(u.auth,'442079460123');assert.equal(u.primary.line,'442079460123');assert.equal(u.sca[0].line,'442079460123_Teams');
    assert.equal(state.requests.filter(r=>[R.vm,R.mailbox,R.portal].includes(r.route)).length,0,'unselected voicemail must make no setup or verification visits');
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('ten-digit international numbers retain native country context for raw caller ID',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page,{group:'RSG',numbers:['+45 32 12 34 56']});
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateBulkEngine(lease),info=await engine.initialize();
      const config=CpBulkModel.initial(info),credentials={web:'Easy1234',sip:{Operations:'Sip-Test-A1'}};
      const user={first:'Danish',last:'Example',email:'danish@example.test',dept:'Operations',number:'4532123456',extension:'23456'};
      await engine.preflightGroup([user],config,credentials);
      for(const step of CpBulkModel.steps(user.plan))await engine.stepGroup(user,step.key,credentials);
      lease.release();
    });
    const u=state.users.get('4532123456');
    assert.equal(u.caller,'4532123456');assert.equal(u.auth,'4532123456');
    assert.equal(u.primary.line,'4532123456');assert.equal(u.sca[0].line,'4532123456_Teams');
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('a third-user navigation failure exports its exact step and transport state without secrets; retry retains history',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),state=await fixture(page,{group:'RSG',numbers:['3125550197','3125550198','3125550199']});
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=prefix]').waitFor();
    await page.locator('[data-action=primary]').click();await page.locator('[data-action=paste]').click();
    await page.locator('.subdialog textarea').fill('Alex\tExample\talex@example.test\tOperations\nBlair\tExample\tblair@example.test\tOperations\nCasey\tExample\tcasey@example.test\tOperations');
    await page.locator('[data-action=import]').click();
    for(const [i,n]of ['3125550197','3125550198','3125550199'].entries()){
      await page.locator('[data-pick]').nth(i).click();await page.locator('[data-number="'+n+'"]').click();
    }
    await page.locator('[data-action=primary]').click();await page.locator('[data-password=Operations]').fill('DoNotLog-Sip-A1');
    await page.locator('[data-credential=web]').fill('DoNotLog-Web-A1');
    await page.locator('[data-action=primary]').click();await page.locator('.review-table').waitFor();
    state.dropNavigation={route:R.auth,user:'3125550199'};
    await page.locator('[data-action=primary]').click();
    await page.waitForFunction(()=>document.querySelector('.notice')?.textContent.startsWith('Batch paused'),null,{timeout:30000});
    assert.equal(await page.locator('.run-top strong').textContent(),'2 configured · 1 need attention');
    await page.locator('[data-action=details]').nth(2).click();
    assert.match(await page.locator('.diagnostic-log').textContent(),/SIP authentication · navigation · failed/);
    const downloadPromise=page.waitForEvent('download');await page.locator('[data-action=download-user-log]').click();
    const download=await downloadPromise,fs=require('node:fs'),text=fs.readFileSync(await download.path(),'utf8'),report=JSON.parse(text);
    assert.equal(report.users.length,1);
    const failure=report.users[0].events.find(e=>e.operation==='navigation'&&e.status==='failed');
    assert.equal(failure.step,'auth');assert.equal(failure.target,R.auth);
    assert.equal(failure.transport.pageSwapped,false);assert.equal(failure.transport.navigationStarted,true);
    assert.equal(failure.transport.phase,'page confirmation');assert.equal(failure.needsRecovery,true);
    assert.deepEqual(failure.transport.requests,[{path:R.auth,method:'POST',status:null,responseType:null,failure:'Network request failed'}]);
    for(const secret of ['DoNotLog-Sip-A1','DoNotLog-Web-A1','Easy1234','formtokenserial'])assert.ok(!text.includes(secret));
    await page.evaluate(()=>document.documentElement.dataset.cpDirection='rosepine-light');
    await page.screenshot({path:require('node:path').resolve(__dirname,'../dev-preview/bulk-group-setup/diagnostic-timeline-light.png')});
    await page.locator('.subdialog [data-action=dismiss]').last().click();
    await page.locator('[data-action=primary]').click();
    await page.waitForFunction(()=>document.querySelector('.run-top strong')?.textContent==='3 configured · 0 need attention',null,{timeout:30000});
    const batchDownload=page.waitForEvent('download');await page.locator('[data-action=download-log]').click();
    const finalReport=JSON.parse(fs.readFileSync(await (await batchDownload).path(),'utf8'));
    assert.equal(finalReport.users.length,3);
    assert.ok(finalReport.users[2].events.some(e=>e.step==='auth'&&e.operation==='step'&&e.status==='confirmed'&&e.attempt===2));
    assert.equal(state.writes.filter(w=>w.route===R.add).length,3,'retry must not recreate users');
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});
