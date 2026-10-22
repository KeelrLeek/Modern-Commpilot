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
    assert.ok(metrics.calls<=400,`one edit rebuilt ${metrics.calls} plans for 199 users`);
    const primary=page.locator('[data-action=primary]');
    assert.equal(await primary.isDisabled(),false);
    const emails=page.locator('[data-field=email]');
    await emails.nth(1).fill('PERSON0@example.test');
    assert.equal(await primary.isDisabled(),true,'email duplicates are case insensitive');
    assert.match(await page.locator('.batch-summary').innerText(),/^197 of 199 ready/);
    await emails.nth(1).fill('person1@example.test');
    assert.equal(await primary.isDisabled(),false,'clearing a duplicate refreshes readiness');
    const extensions=page.locator('[data-field=extension]');
    const original=await extensions.nth(1).inputValue();
    await extensions.nth(1).fill(await extensions.first().inputValue());
    assert.equal(await primary.isDisabled(),true,'extension and derived ID conflicts remain blocked');
    await extensions.nth(1).fill(original);
    assert.equal(await primary.isDisabled(),false);
  }finally{await browser.close();}
});
