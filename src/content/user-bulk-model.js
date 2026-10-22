/* Shared, non-secret group settings and deterministic per-user provisioning plans. */
(function(root,factory){
  const model=factory(typeof module==='object'&&module.exports?require('./user-bulk-phone.js'):root.CpBulkPhone);
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.CpBulkModel=model;
})(typeof window==='object'?window:globalThis,function(phone){
  'use strict';
  const catalog=Object.freeze({
    vvx:{label:'Primary device',token:'VVX',suffix:'',type:'Trifecta PolycomVVX400 (Reseller)'},
    teams:{label:'Teams SCA',token:'Teams',suffix:'_Teams',type:'Trifecta Teams (Reseller)'},
    mobile:{label:'Webex mobile SCA',token:'WX',suffix:'_WXmob',type:'Connect - Mobile (System)',access:true},
    desktop:{label:'Webex desktop SCA',token:'WXPC',suffix:'_WXpc',type:'Business Communicator - PC (System)',access:true}
  });
  const enums={numberMode:['mixed','none','all'],extensionMode:['next','did','manual'],
    idMode:['prefix','phone','manual'],callerMode:['did','default'],voicemail:['','off','on']};
  const digits=phone.key;
  function snapshot(config){
    const result={};
    for(const [key,values]of Object.entries(enums))if(values.includes(config[key]))result[key]=config[key];
    for(const key of ['prefix','devicePrefix','primaryType','primaryToken','domain'])
      if(typeof config[key]==='string')result[key]=config[key].trim().slice(0,161);
    if(typeof config.prefixChosen==='boolean')result.prefixChosen=config.prefixChosen;
    if(typeof config.primary==='boolean')result.primary=config.primary;
    if(Number.isInteger(Number(config.length))&&Number(config.length)>0&&Number(config.length)<=10)result.length=Number(config.length);
    if(Array.isArray(config.sca))result.sca=['teams','mobile','desktop'].filter(k=>config.sca.includes(k));
    return result;
  }
  function scopeKey(scope){
    if(!scope||['pbxOrigin','serviceProviderId','groupId'].some(k=>typeof scope[k]!=='string'||!scope[k]||scope[k].length>512))
      throw Error('The stable group identity is unavailable. Reopen the group’s Users page.');
    return 'cp.bulk.defaults.v1:'+JSON.stringify([scope.pbxOrigin,scope.serviceProviderId,scope.groupId]);
  }
  function prefixes(sample){
    const found=new Map();
    for(const u of sample.slice(0,5)){
      const id=String(u.id||'').split('@')[0],ext=String(u.extension||'');
      if(!ext||!id.endsWith(ext)||id===phone.localId(u.phone)||/^\d{10,15}$/.test(id))continue;
      const prefix=id.slice(0,-ext.length);
      found.set(prefix,(found.get(prefix)||0)+1);
    }
    return [...found].map(([prefix,count])=>({prefix,count}));
  }
  function initial(info){
    const rsg=info.scope.groupId==='RSG',suggestions=prefixes(info.sample||[]);
    return {numberMode:rsg?'all':'mixed',extensionMode:rsg?'did':'next',length:rsg?5:info.limits.default,
      idMode:rsg?'phone':'prefix',prefix:suggestions.length===1?suggestions[0].prefix:'',
      prefixChosen:suggestions.length===1,devicePrefix:rsg?'RSG':'',callerMode:'did',voicemail:rsg?'off':'',
      primary:rsg,primaryType:rsg?catalog.vvx.type:'',primaryToken:'VVX',domain:info.domain,
      sca:rsg?['teams']:['mobile','desktop']};
  }
  function nextExtension(highest,length){
    if(highest===null||highest===undefined||highest==='')return '';
    const n=BigInt(highest)+1n,limit=10n**BigInt(length);
    if(n>=limit)throw Error('No next extension fits the selected length. Enter an available extension or change the group setup.');
    return String(n).padStart(length,'0');
  }
  function setupErrors(config,info){
    const errors=[];
    if(Object.keys(snapshot(config)).length!==14)errors.push('Review the complete group setup.');
    if(config.length<info.limits.min||config.length>info.limits.max)errors.push('Choose an extension length within the live group limits.');
    if(!(info.domains||[info.domain]).includes(config.domain))errors.push('Choose an available group domain.');
    if(config.idMode==='prefix'&&!config.prefixChosen)errors.push('Confirm the User ID prefix.');
    if(!['on','off'].includes(config.voicemail))errors.push('Choose the native voicemail default.');
    if((config.primary||config.sca?.length)&&!config.devicePrefix.trim())errors.push('Enter the device-name prefix.');
    const types=[...(config.primary?[config.primaryType]:[]),...(config.sca||[]).map(k=>catalog[k]?.type)];
    for(const type of types)if(!type||info.deviceTypes&&!info.deviceTypes.includes(type))errors.push('Choose an available device type'+(type?': '+type:'.'));
    return errors;
  }
  function resolve(u,config,info){
    const number=u.number?digits(u.number):'',extension=String(u.extension||'').trim();
    const localId=(config.idMode==='phone'?phone.localId(number):config.idMode==='manual'?u.customId:config.prefix+extension)||'';
    const sca=Array.isArray(u.sca)?u.sca:config.sca,primary=u.primary??config.primary;
    const selected=[...(primary?['vvx']:[]),...['teams','mobile','desktop'].filter(k=>sca.includes(k))];
    const profiles=selected.map(kind=>{
      const c=catalog[kind],name=[config.devicePrefix.trim(),kind==='vvx'?config.primaryToken:c.token,extension].filter(Boolean).join(' ');
      return {kind,name,type:kind==='vvx'?config.primaryType:c.type,line:localId+c.suffix,access:!!c.access,username:name.replace(/ /g,'_')};
    });
    return {localId,domain:config.domain||info.domain,number,extension,profiles,
      voicemail:(u.voicemail&&u.voicemail!=='default'?u.voicemail:config.voicemail)==='on',
      callerMode:config.callerMode,caller:String(u.caller||'').trim(),mailbox:localId+'@trifecta.avpaas.io'};
  }
  function validate(u,config,info){
    const p=resolve(u,config,info),errors=[];
    if(!u.first?.trim()||!u.last?.trim()||u.first.length>30||u.last.length>30)errors.push('Enter first and last names, up to 30 characters each.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email||'')||u.email.length>80)errors.push('Enter a valid email / alternate ID.');
    if(!info.departments.some(d=>d.name===u.dept))errors.push('Choose a department.');
    if(!/^\d+$/.test(p.extension)||p.extension.length<info.limits.min||p.extension.length>info.limits.max)errors.push('Extension must contain '+info.limits.min+'–'+info.limits.max+' digits.');
    if(config.numberMode==='all'&&!p.number)errors.push('Choose a personal number.');
    if(config.numberMode==='none'&&p.number)errors.push('This setup uses extension-only users.');
    if(u.number&&!p.number)errors.push('Choose a valid personal number.');
    if(!p.localId||/[\s@<>]/.test(p.localId)||p.localId.length>161)errors.push('Enter a valid local User ID.');
    if(config.idMode==='prefix'&&!config.prefixChosen)errors.push('Confirm the User ID prefix.');
    if(!(info.domains||[info.domain]).includes(p.domain))errors.push('Choose an available group domain.');
    if(!['on','off'].includes(u.voicemail&&u.voicemail!=='default'?u.voicemail:config.voicemail))errors.push('Choose whether native voicemail is On or Off.');
    if(p.profiles.length&&!config.devicePrefix.trim())errors.push('Enter the device-name prefix.');
    if(p.profiles.some(d=>!d.type||!d.name||d.name.length>80||d.line.length>161))errors.push('Check device type and profile-name lengths.');
    if(p.voicemail)errors.push(...pinErrors('54321',info.passcode||{},p));
    return errors;
  }
  function passwordErrors(password,rules={},localId=''){
    const errors=[];
    if(!password||password.length<Number(rules.minimumLength||0))errors.push('The initial web password does not meet the group minimum length.');
    for(const [key,re]of [['containNumber',/\d/g],['containUpperAlpha',/[A-Z]/g],['containLowerAlpha',/[a-z]/g],['containNonAlphaNum',/[^A-Za-z0-9]/g]]){
      if(rules[key]&&(password.match(re)||[]).length<Number(rules[key+'Chars']||1))errors.push('The initial web password does not meet the group '+key+' rule.');
    }
    if(rules.notUserId&&localId&&password.toLowerCase().includes(localId.toLowerCase()))errors.push('The initial web password cannot contain the User ID.');
    return errors;
  }
  function pinErrors(pin,rules,p){
    const errors=[];
    if(!/^\d+$/.test(pin)||pin.length<Number(rules.minLen||0)||pin.length>Number(rules.maxLen||30))errors.push('Portal PIN 54321 conflicts with the group passcode length rules.');
    const numbers=[p.extension,p.number].filter(Boolean);
    if(rules.notUserNumber&&numbers.includes(pin)||rules.notReverseUserNumber&&numbers.some(n=>[...n].reverse().join('')===pin))errors.push('Portal PIN 54321 conflicts with this user’s extension/number rule.');
    if(rules.notSequentialDigits&&Number(rules.maxDescendingDigits)<5)errors.push('Portal PIN 54321 conflicts with the group descending-digit rule.');
    return errors;
  }
  function steps(plan){
    return [
      {key:'user',label:'User'},{key:'alternate',label:'Alternate ID'},{key:'addresses',label:'Addresses / primary device'},
      {key:'auth',label:'SIP authentication'},
      ...plan.profiles.filter(p=>p.kind!=='vvx').map(p=>({key:'sca:'+p.kind,label:catalog[p.kind].label})),
      ...plan.profiles.filter(p=>p.access).map(p=>({key:'access:'+p.kind,label:catalog[p.kind].label.replace(' SCA','')+' access'})),
      ...(plan.voicemail?[{key:'voicemail',label:'Voice Management'},{key:'mailbox',label:'Mailbox settings'},{key:'pin',label:'Voice portal PIN'}]:[]),
      {key:'verify',label:'Verify saved setup'},{key:'imp',label:'Integrated IM&P (last)'}
    ];
  }
  return {catalog,digits,snapshot,scopeKey,prefixes,initial,nextExtension,setupErrors,resolve,validate,passwordErrors,pinErrors,steps};
});
