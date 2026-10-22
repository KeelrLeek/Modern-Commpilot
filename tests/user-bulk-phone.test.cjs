const {test}=require('node:test'),assert=require('node:assert/strict');
const phone=require('../src/content/user-bulk-phone.js');
test('phone identity preserves North American IDs and explicit international country codes',()=>{
  for(const input of ['3125550199','+1 (312) 555-0199','0013125550199']){
    assert.equal(phone.key(input),'3125550199');assert.equal(phone.caller(input),'+13125550199');
  }
  for(const input of ['+44 20 7946 0123','442079460123','0044 20 7946 0123','+44 (0)20 7946 0123']){
    assert.equal(phone.key(input),'442079460123');assert.equal(phone.localId(input),'442079460123');
    assert.equal(phone.caller(input),'442079460123');assert.equal(phone.display(input),'442079460123');
  }
  for(const method of ['key','localId','caller','display'])assert.equal(phone[method]('+44 5583 726655'),'445583726655');
  assert.equal(phone.caller('+45 32 12 34 56'),'4532123456','ten international digits must not receive US +1');
  assert.equal(phone.caller(phone.key('+45 32 12 34 56'),phone.isInternational('+45 32 12 34 56')),'4532123456');
  assert.equal(phone.key('+49 30 123456'),'4930123456');
  assert.equal(phone.key('+61 2 5550 1234'),'61255501234');
  assert.equal(phone.key('02079460123'),'02079460123','keep a PBX national number intact without inventing a country');
  for(const input of ['None','1234','+0123456789','+442079460123abc','+1234567890123456'])assert.equal(phone.key(input),'');
});
test('international ranges preserve identity, leading zeros and bounds',()=>{
  for(const input of ['44-2079460123–44-2079460125','44-2079460123—44-2079460125',
    '44-2079460123-44-2079460125','44‑2079460123 - 44‑2079460125'])
    assert.deepEqual(phone.expand(input),['442079460123','442079460124','442079460125']);
  for(const input of ['44‑2079460123','44–2079460123'])assert.equal(phone.key(input),'442079460123');
  assert.deepEqual(phone.expand('+44 20 7946 0123 - +44 20 7946 0125'),['442079460123','442079460124','442079460125']);
  assert.deepEqual(phone.expand('+1-3125550197 – +1-3125550199'),['3125550197','3125550198','3125550199']);
  assert.deepEqual(phone.expand('02079460123 - 02079460124'),['02079460123','02079460124']);
  assert.deepEqual(phone.expand('+45 32123456'),['4532123456']);
  assert.deepEqual(phone.expand('not a number'),[]);
  assert.throws(()=>phone.expand('+442079460123 - +442079470125'),/too large/);
});
test('range country context comes from the raw range ends and ambiguous ten digits are not guessed',()=>{
  for(const input of ['+45-32123456 - +45-32123458','+45-32123456–+45-32123458','+45-32123456-+45-32123458',
    '+45-32123456 ‑ +45-32123458','+45 32123456 − +45 32123458','+4532123456-+4532123458']){
    const entry=phone.expandEntry(input);
    assert.deepEqual(entry,{numbers:['4532123456','4532123457','4532123458'],international:true},input);
    assert.equal(phone.caller(entry.numbers[0],entry.international),'4532123456',input);
  }
  for(const input of ['+1-3125550197 – +1-3125550199','+13125550197-+13125550199','3125550197 - 3125550199']){
    const entry=phone.expandEntry(input);
    assert.deepEqual(entry,{numbers:['3125550197','3125550198','3125550199'],international:false},input);
    assert.equal(phone.caller(entry.numbers[0],entry.international),'+13125550197',input);
  }
  for(const input of ['312-555-0100','1-3125550100','+1 (312) 555-0100']){
    assert.deepEqual(phone.expandEntry(input),{numbers:['3125550100'],international:false},input);
    assert.equal(phone.caller(input),'+13125550100',input);
  }
  assert.deepEqual(phone.expandEntry('44-2079460123–44-2079460125'),
    {numbers:['442079460123','442079460124','442079460125'],international:true});
  // Without + or 00, a country code and eight digits look like a US number.
  for(const input of ['45-32123456','45‑32123456','45-32123456–45-32123458','45-32123456 - 45-32123458'])
    assert.deepEqual(phone.expandEntry(input),{numbers:[],international:false},input);
});
