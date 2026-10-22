const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../src/content/user-bulk-model.js');
const info={scope:{pbxOrigin:'https://apps-sbx.avpaas.io',serviceProviderId:'SP',groupId:'AZ'},
  domain:'phonenetwork.net',domains:['phonenetwork.net'],limits:{min:3,max:6,default:4},
  departments:[{name:'Operations',key:'ops'}],sample:[{id:'AZindust1233@phonenetwork.net',extension:'1233',phone:''}],highest:'1233',passcode:{minLen:'4',maxLen:'8'}};
const user={first:'Alex',last:'Example',email:'alex@example.test',dept:'Operations',number:'',extension:'1234',voicemail:'default',customId:''};
function config(){return {...model.initial(info),devicePrefix:'AZ',voicemail:'on'};}
test('group settings whitelist excludes all credentials, users, number pools and stale starting extension',()=>{
  const settings=model.snapshot({...config(),web:'secret',mailboxPassword:'secret',devicePassword:'secret',sip:{ops:'secret'},users:[user],start:'9999',highest:'9998',numbers:['1234567890']});
  assert.equal(Object.keys(settings).length,14);
  assert.equal(JSON.stringify(settings).includes('secret'),false);
  for(const key of ['web','mailboxPassword','devicePassword','sip','users','start','highest','numbers'])assert.equal(key in settings,false);
  const scope=info.scope;
  assert.notEqual(model.scopeKey(scope),model.scopeKey({...scope,groupId:'Other'}));
  assert.notEqual(model.scopeKey(scope),model.scopeKey({...scope,serviceProviderId:'Other'}));
  assert.notEqual(model.scopeKey(scope),model.scopeKey({...scope,pbxOrigin:'https://apps.avpaas.io'}));
  assert.throws(()=>model.scopeKey({groupId:'AZ'}));
});
test('prefix suggestions inspect at most five actual extension suffixes and exclude DID identities',()=>{
  assert.deepEqual(model.prefixes(info.sample),[{prefix:'AZindust',count:1}]);
  const mixed=[{id:'3125551234@phonenetwork.net',extension:'51234',phone:'+1-3125551234'},...info.sample,{id:'Other1235',extension:'1235'},...Array(6).fill(info.sample[0])];
  assert.deepEqual(model.prefixes(mixed),[{prefix:'AZindust',count:3},{prefix:'Other',count:1}]);
  assert.equal(model.initial({...info,sample:mixed}).prefixChosen,false);
});
test('next extension preserves padding and refuses exhaustion without wrapping',()=>{
  assert.equal(model.nextExtension('0099',4),'0100');
  assert.equal(model.nextExtension(null,4),'');
  assert.throws(()=>model.nextExtension('9999',4),/No next extension/);
});
test('extension-only and DID users resolve independently, with separate device prefix and exact suffix case',()=>{
  const c=config(),p=model.resolve(user,c,info);
  assert.equal(p.localId,'AZindust1234');assert.equal(p.number,'');
  assert.equal(p.mailbox,'AZindust1234@trifecta.avpaas.io');
  assert.deepEqual(p.profiles.map(d=>[d.name,d.line,d.username]),[
    ['AZ WX 1234','AZindust1234_WXmob','AZ_WX_1234'],['AZ WXPC 1234','AZindust1234_WXpc','AZ_WXPC_1234']]);
  const did=model.resolve({...user,number:'+1 (312) 555-0123',sca:['teams']},c,info);
  assert.equal(did.number,'3125550123');assert.equal(did.profiles[0].line,'AZindust1234_Teams');
  assert.equal(model.validate(user,c,info).length,0);
  assert.match(model.validate(user,{...c,idMode:'phone'},info).join(' '),/User ID/);
});
test('individual selections and per-user voicemail overrides determine the exact ordered workflow',()=>{
  const p=model.resolve({...user,sca:['mobile'],voicemail:'off'},config(),info);
  const keys=model.steps(p).map(s=>s.key);
  assert.deepEqual(keys,['user','alternate','addresses','auth','sca:mobile','access:mobile','verify','imp']);
  const both=model.steps(model.resolve(user,config(),info)).map(s=>s.key);
  assert.ok(both.indexOf('sca:desktop')<both.indexOf('access:mobile'));
  assert.ok(both.indexOf('pin')<both.indexOf('imp'));
  assert.equal(both.at(-1),'imp');
});
test('RSG defaults retain phone IDs, primary VVX and Teams with native voicemail off',()=>{
  const rsg={...info,scope:{...info.scope,groupId:'RSG'},limits:{min:3,max:6,default:5}};
  const c=model.initial(rsg),p=model.resolve({...user,number:'3125550123',extension:'50123'},c,rsg);
  assert.equal(c.extensionMode,'did');assert.equal(p.localId,'3125550123');
  assert.deepEqual(p.profiles.map(d=>d.name),['RSG VVX 50123','RSG Teams 50123']);
  assert.equal(p.voicemail,false);
  assert.equal(model.initial({...rsg,limits:{min:3,max:6,default:4}}).length,5,'RSG retains its last-five preset');
});
test('portal PIN is checked independently from web password rules',()=>{
  const p=model.resolve(user,config(),info);
  assert.match(model.pinErrors('54321',{minLen:6},p).join(' '),/length/);
  assert.match(model.pinErrors('54321',{notSequentialDigits:true,maxDescendingDigits:3},p).join(' '),/descending/);
  assert.match(model.pinErrors('54321',{notUserNumber:true},{extension:'54321'}).join(' '),/extension/);
  assert.deepEqual(model.pinErrors('54321',{minLen:4,maxLen:8},p),[]);
  assert.match(model.passwordErrors('easy1234',{containUpperAlpha:true,containUpperAlphaChars:1}).join(' '),/containUpperAlpha/);
  assert.deepEqual(model.passwordErrors('Easy1234',{minimumLength:6,containNumber:true,containUpperAlpha:true,containLowerAlpha:true}),[]);
});
