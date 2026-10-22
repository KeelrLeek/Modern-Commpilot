const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {fixture}=require('./fixtures/bulk-group-harness.cjs');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

test('the empty starter row does not reduce the 200-user paste limit',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();await fixture(page);
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=prefix]').fill('AZ');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=numberMode]').selectOption('none');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-start]').fill('1234');
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-action=paste]').click();
    await page.getByRole('textbox',{name:'User rows'}).fill(Array.from({length:200},(_,i)=>
      `Person${i}\tFixture\tperson${i}@example.test\tOperations`).join('\n'));
    await page.locator('[data-action=import]').click();
    assert.equal(await page.locator('[data-field=email]').count(),200,'the empty placeholder is replaced by the pasted batch');
    await page.locator('[data-action=paste]').click();
    await page.getByRole('textbox',{name:'User rows'}).fill('Overflow\tFixture\toverflow@example.test\tOperations');
    await page.locator('[data-action=import]').click();
    assert.match(await page.locator('.paste-error').innerText(),/200/);
    assert.equal(await page.locator('[data-field=email]').count(),200,'overflow leaves the existing batch intact');
  }finally{await browser.close();}
});

test('large-batch readiness resolves each user once per update and retains duplicate checks',async t=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();await fixture(page);
    await page.locator('#cp-user-bulk-launch').click();
    await page.locator('[data-setting=prefix]').fill('AZ');
    await page.locator('[data-setting=devicePrefix]').fill('AZ');
    await page.locator('[data-prefix-confirm]').check();
    await page.locator('[data-setting=numberMode]').selectOption('none');
    await page.locator('[data-setting=voicemail]').selectOption('off');
    await page.locator('[data-start]').fill('1234');
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-action=paste]').click();
    await page.getByRole('textbox',{name:'User rows'}).fill(Array.from({length:199},(_,i)=>
      `Person${i}\tFixture\tperson${i}@example.test\tOperations`).join('\n'));
    await page.locator('[data-action=import]').click();
    await page.waitForFunction(()=>document.querySelector('.batch-summary')?.textContent.startsWith('199 of 199 ready'));
    const metrics=await page.evaluate(()=>{
      const original=CpBulkModel.resolve;let calls=0;
      CpBulkModel.resolve=(...args)=>{calls++;return original(...args);};
      const input=document.querySelector('[data-field=first]');
      input.value='Updated';const start=performance.now();
      input.dispatchEvent(new Event('input',{bubbles:true}));
      return {calls,elapsedMs:performance.now()-start};
    });
    t.diagnostic(JSON.stringify(metrics));
    assert.ok(metrics.calls>=199,`one edit re-evaluated only ${metrics.calls} plans for 199 users`);
    assert.ok(metrics.calls<=400,`one edit rebuilt ${metrics.calls} plans for 199 users`);
    const primary=page.locator('[data-action=primary]'),notice=page.locator('#cp-user-bulk .notice'),summary=page.locator('.batch-summary');
    assert.equal(await primary.isDisabled(),false);
    const emails=page.locator('[data-field=email]');
    await emails.nth(1).fill('PERSON0@example.test');
    assert.equal(await primary.isDisabled(),false,'Continue remains available to explain validation errors');
    assert.match(await summary.innerText(),/^197 of 199 ready/,'editing refreshes readiness before another click');
    await primary.click();
    assert.match(await notice.innerText(),/Row 2:.*Duplicate email/);
    assert.equal(await page.locator('[data-field=email]').count(),199,'invalid rows cannot advance');
    assert.match(await summary.innerText(),/^197 of 199 ready/);
    await emails.nth(1).fill('person1@example.test');
    assert.match(await summary.innerText(),/^199 of 199 ready/,'clearing a duplicate refreshes readiness');
    assert.equal(await notice.textContent(),'','fixing the last invalid row clears the explanation without another click');
    const extensions=page.locator('[data-field=extension]');
    const original=await extensions.nth(1).inputValue();
    await extensions.nth(1).fill(await extensions.first().inputValue());
    await primary.click();
    assert.match(await notice.innerText(),/Duplicate extension/);
    assert.equal(await page.locator('[data-field=email]').count(),199,'extension conflicts cannot advance');
    await extensions.nth(1).fill(original);
    assert.match(await summary.innerText(),/^199 of 199 ready/);
    assert.doesNotMatch(await notice.textContent(),/Duplicate extension/);
    await emails.first().fill('person 0@example.test');
    await primary.click();
    assert.match(await notice.innerText(),/^Row 1:.*valid email/,'internal whitespace is not trimmed away');
    assert.equal(await page.locator('[data-field=email]').count(),199);
    await emails.first().fill(' person0@example.test ');
    await primary.click();
    await page.getByText('Batch credentials',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-field=email]').count(),0,'valid rows advance after trimming pasted whitespace');
  }finally{await browser.close();}
});

async function setup(page,{idMode='prefix',numberMode='none'}={}){
  await page.locator('#cp-user-bulk-launch').click();
  await page.locator('[data-setting=idMode]').selectOption(idMode);
  if(idMode==='prefix'){await page.locator('[data-setting=prefix]').fill('AZ');await page.locator('[data-prefix-confirm]').check();}
  await page.locator('[data-setting=devicePrefix]').fill('AZ');
  await page.locator('[data-setting=numberMode]').selectOption(numberMode);
  await page.locator('[data-setting=voicemail]').selectOption('off');
  await page.locator('[data-start]').fill('1234');
  await page.locator('[data-action=primary]').click();
}
async function fillRow(page,email='alex@example.test'){
  for(const [field,value]of [['first','Alex'],['last','Example'],['email',email]])await page.locator('[data-field='+field+']').fill(value);
  await page.locator('[data-field=dept]').selectOption('Operations');
}

test('Save defaults outcomes stay visible after Continue has explained row problems',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();await fixture(page);await setup(page);
    const notice=page.locator('#cp-user-bulk .notice'),save=page.locator('.defaults-bar [data-action=save-defaults]');
    const idle=()=>page.waitForFunction(()=>document.querySelector('#cp-user-bulk').getAttribute('aria-busy')==='false');
    await page.locator('[data-action=primary]').click();
    assert.match(await notice.textContent(),/^Row 1: Enter first and last names/);
    await fillRow(page);
    assert.equal(await notice.textContent(),'');
    await save.click();await idle();
    assert.match(await notice.textContent(),/^Group defaults saved in this browser\./);
    await page.evaluate(()=>{window.chrome.storage.local.set=async()=>{throw Error('QUOTA_BYTES quota exceeded');};});
    await save.click();await idle();
    assert.match(await notice.textContent(),/^Group defaults could not be saved\. QUOTA_BYTES/,'a failed save is not hidden');
    await page.locator('[data-field=email]').fill('');
    assert.match(await notice.textContent(),/^Group defaults could not be saved\..* Row 1: Enter a valid email/,'the action result and row problems are both announced');
  }finally{await browser.close();}
});

test('a large invalid batch names the first rows to fix and leaves an unchanged notice alone',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}});await fixture(page,{group:'RSG'});
    await page.locator('#cp-user-bulk-launch').click();await page.locator('[data-setting=prefix]').waitFor();
    await page.locator('[data-action=primary]').click();
    await page.locator('[data-action=paste]').click();
    await page.getByRole('textbox',{name:'User rows'}).fill(Array.from({length:199},(_,i)=>
      `Person${i}\tFixture\tperson${i}@example.test\tOperations`).join('\n'));
    await page.locator('[data-action=import]').click();
    await page.locator('[data-action=primary]').click();
    const text=await page.locator('#cp-user-bulk .notice').textContent();
    assert.match(text,/^Row 1: .*Choose a personal number\./);
    assert.match(text,/Row 5: [^]* 194 more rows need attention\.$/);
    assert.ok(!text.includes('Row 6:')&&text.length<1000,`the notice has ${text.length} characters`);
    assert.ok(await page.locator('#cp-user-bulk .table-scroll').evaluate(n=>n.getBoundingClientRect().top<innerHeight),'the users table stays in view');
    await page.evaluate(()=>{
      window.noticeMutations=0;
      new MutationObserver(records=>{window.noticeMutations+=records.length;}).observe(document.querySelector('#cp-user-bulk .notice'),{childList:true,characterData:true,subtree:true});
    });
    await page.locator('[data-field=first]').nth(5).click();await page.keyboard.type('abcde');
    assert.equal(await page.evaluate(()=>window.noticeMutations),0,'unchanged readiness is not rewritten in the live region');
    assert.equal(await page.locator('[data-field=email]').count(),199);
  }finally{await browser.close();}
});

test('a manual local User ID is trimmed like names and email while internal spaces stay invalid',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page);await setup(page,{idMode:'manual'});
    await fillRow(page,' alex@example.test ');
    for(const [id,advances]of [['alex example',false],['alex.example ',true]]){
      await page.locator('[data-action=options]').first().click();
      await page.locator('[data-field=customId]').fill(id);
      await page.locator('.subdialog footer [data-action=dismiss]').click();
      await page.locator('[data-action=primary]').click();
      assert.equal(await page.locator('[data-credential=web]').count(),advances?1:0,JSON.stringify(id));
      if(!advances)assert.match(await page.locator('#cp-user-bulk .notice').textContent(),/^Row 1: Enter a valid local User ID\./);
    }
    await page.locator('[data-credential=device]').fill('Device-Test-A1');
    await page.locator('[data-password=Operations]').fill('Sip-Test-A1');
    await page.locator('[data-action=primary]').click();await page.locator('.review-table').waitFor();
    assert.match(await page.locator('.review-table').textContent(),/alex\.example@phonenetwork\.net/);
    assert.equal(state.writes.length,0);
  }finally{await browser.close();}
});

test('a number removed from the department by Refresh numbers blocks Continue',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),state=await fixture(page,{numbers:['3125550198','3125550199']});
    await setup(page,{numberMode:'mixed'});await fillRow(page);
    await page.locator('[data-pick]').click();await page.locator('[data-number="3125550198"]').click();
    assert.match(await page.locator('.batch-summary').innerText(),/^1 of 1 ready/);
    state.users.set('AZ9999',{first:'Other',last:'User',email:'other@example.test',number:'3125550198',extension:'9999',sca:[]});
    await page.locator('[data-pick]').click();
    await page.getByRole('button',{name:'Refresh numbers',exact:true}).click();
    await page.locator('[data-number="3125550199"]').waitFor();
    assert.equal(await page.locator('[data-number="3125550198"]').count(),0);
    await page.locator('[data-action=hide-picker]').click();
    assert.match(await page.locator('.batch-summary').innerText(),/^0 of 1 ready/);
    await page.locator('[data-action=primary]').click();
    assert.match(await page.locator('#cp-user-bulk .notice').textContent(),/^Row 1: Choose an available number from this department again\./);
    assert.equal(await page.locator('[data-credential=web]').count(),0);
    assert.equal(state.writes.length,0);
  }finally{await browser.close();}
});
