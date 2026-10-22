// Native contracts observed on apps-sbx, 2026-10-20. Network and secrets are synthetic.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),base='https://apps-sbx.avpaas.io';
const runtimeRoot=process.env.BW_TEST_EXTENSION_PATH||root;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(n,v='',t='text',extra='')=>`<input name="${n}" id="${n}_${esc(v)}" type="${t}" value="${esc(v)}" ${extra}>`;
const select=(n,rows,v)=>`<select name="${n}">${rows.map(([value,label])=>`<option value="${esc(value)}" ${value===v?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
const table=(headers,rows)=>`<table id="searchTable"><tr>${headers.map(h=>`<td class="listHeader"><a class="listSortHeader">${h}</a></td>`).join('')}</tr>${rows.map((r,i)=>`<tr id="Row${i}">${r.cells.map(c=>`<td><a class="tableLink">${esc(c)}</a></td>`).join('')}${r.url?`<script>function row${i}(){redirectPost(${JSON.stringify(r.url)},{key:${JSON.stringify(r.key)},P_key:${JSON.stringify(r.key)}});}</script>`:''}</tr>`).join('')}${!rows.length?'<tr><td>No Entries Present</td></tr>':''}</table>`;
const P='/commpilot/',R={users:P+'Group/Members/',add:P+'Group/Members/Add/index.jsp',entry:P+'Group/Members/Modify/index.jsp',profile:P+'User/Profile/',
  addresses:P+'User/Addresses/',alternate:P+'User/AlternateUserIDs/',auth:P+'User/Authentication/',sca:P+'User/SCAP/',scaAdd:P+'User/SCAP/Add/index.jsp',scaModify:P+'User/SCAP/Modify/index.jsp',
  devices:P+'Group/DeviceInventory/',deviceAdd:P+'Group/DeviceInventory/Add/index.jsp',deviceModify:P+'Group/DeviceInventory/Modify/Profile/index.jsp',
  numbers:P+'Group/GroupDnManagement/index.jsp',extension:P+'Group/ExtensionMgmt/',password:P+'Common/Password_Rules/index.jsp',passcode:P+'Common/PasscodeRules/index.jsp',
  vm:P+'User/VM/General/',mailbox:P+'User/VM/General/Nested/index.jsp',portal:P+'User/Password/',imp:P+'User/IntegratedIMP/'};
const TYPES=['Trifecta PolycomVVX400 (Reseller)','Trifecta Teams (Reseller)','Connect - Mobile (System)','Business Communicator - PC (System)'];
async function fixture(page,options={}){
  const state={serial:1,group:options.group||'AZ',selected:null,device:null,sca:null,advanced:false,users:new Map(),devices:new Map(),requests:[],writes:[],badTokens:0,storage:{}};
  const user=()=>state.users.get(state.selected);
  const department='Operations',deptKey='G+SP+'+state.group+'+Operations';
  const numbers=options.numbers||['3125550199'];
  const search=fields=>select('findKey0',fields,fields[0][0])+select('findOp0',[['STARTS_WITH','Starts With'],['EQUAL_TO','Equal To']],'EQUAL_TO')+input('findValue0');
  const actions=()=>input('buttonClicked','','hidden')+input('apply','Apply','submit')+input('ok','OK','submit');
  function render(route,error=''){
    let body='',script='',title='Users';const u=user(),a=actions(),device=state.devices.get(state.device);
    if(route===R.users){
      body=input('add','Add','button')+search([['UserID','User ID'],['Extension','Extension']])+table(['User ID','Last Name','First Name','Phone Number','Extension','Department'],
        [...state.users].filter(([id,p])=>!state.query?.findValue0||(state.query.findKey0==='Extension'?p.extension===state.query.findValue0:[id,id+'@phonenetwork.net'].includes(state.query.findValue0))).map(([id,p])=>({
          cells:[id,p.last,p.first,p.number,p.extension,department],url:R.entry,key:'SP>%'+state.group+'>%'+id})));
    }else if(route===R.extension){title='Extension Dialing';body=a+['groupExtMinLength','groupExtMaxLength','groupExtDefaultLength'].map((n,i)=>select(n,[['3','3'],['4','4'],['5','5'],['6','6']],['3','6','4'][i])).join('');}
    else if(route===R.password){title='Password Rules';body=a+select('minimumLength',[['6','6']],'6')+input('containUpperAlpha','true','checkbox','checked')+select('containUpperAlphaChars',[['1','1']],'1');}
    else if(route===R.passcode){title='Passcode Rules';body=a+select('minLen',[['4','4']],'4')+select('maxLen',[['15','15']],'15')+input('notSequentialDigits','true','checkbox',options.forbidPin?'checked':'')+select('maxDescendingDigits',[['3','3']],'3');}
    else if(route===R.deviceAdd){title='Device Add';body=a+select('deviceType',TYPES.map(t=>[t,t]),TYPES[0]);}
    else if(route===R.add||route===R.profile||route===R.entry){
      title=route===R.add?'User Add':'Profile';body=a;
      if(route===R.add)body+=input('name')+select('domain',[['phonenetwork.net','phonenetwork.net']],'phonenetwork.net')+input('password','','password')+input('echoPassword','','password');
      for(const [n,v]of Object.entries({unicodeFirstName:u?.first,unicodeLastName:u?.last,firstName:u?.first,lastName:u?.last,email:u?.email,clidPhone:u?.caller||options.caller||'3125550100'}))body+=input(n,v||'');
      body+=select('deptEncodedKey',[[deptKey,department]],deptKey);
    }else if(route===R.alternate){title='Alternate ID';body=a+input('alt1',u?.alt||'');}
    else if(route===R.auth){title='Authentication';body=a+input('username',u?.auth||'')+input('newPassword','','password')+input('newPasswordConfirm','','password');}
    else if(route===R.addresses||route===R.scaAdd){
      title=route===R.addresses?'Addresses':'Shared Call Appearance Add';const primary=route===R.addresses,p=primary?u?.primary:null;
      body=a;
      if(primary)body+=select('phoneNumber',[['None','None'],...numbers.map(n=>[n,n])],u?.number||'None')+input('extension',u?.extension||'')+
        input('deviceChoice','None','radio',p?'':'checked')+input('deviceChoice','Device Profile','radio',p?'checked':'');
      body+=select('deviceName',[['None','None'],['New Device','New Identity/Device Profile (Group)'],...[...state.devices.keys()].map(n=>[n+' (Group)',n+' (Group)'])],p?p.name+' (Group)':'None')+
        input('newDeviceName')+select('newDeviceType',TYPES.map(t=>[t,t]),TYPES[0])+input('macAddress')+
        input('deviceLinePortDomain',p?.line||'')+select('deviceDomain',[['phonenetwork.net','phonenetwork.net']],'phonenetwork.net')+input('linePort',p?.line||'','hidden');
      if(!primary)body+=['activeEndpoint','allowOrigination','allowTermination'].map(n=>input(n,'true','checkbox','checked')).join('');
      script+=`document.querySelector('[name=deviceLinePortDomain]').addEventListener('blur',function(){document.querySelector('[name=linePort]').value=this.value;});`;
    }else if(route===R.sca){
      title='Shared Call Appearance';body=table(['Identity/Device Profile Type','Identity/Device Profile Name','Line/Port'],(u?.sca||[]).map(p=>({cells:[p.type.replace(/ \((System|Reseller)\)$/,''),p.name+' (Group)',options.truncateLines?p.line.slice(0,12)+'...':p.line+'@phonenetwork.net'],url:R.scaModify,key:p.name})));
    }else if(route===R.scaModify){
      title='Shared Call Appearance Modify';const p=u.sca.find(p=>p.name===state.sca);
      body=a+`<table><tr><td>Identity/Device Profile Name:</td><td>${esc(p.name)} (Group)</td></tr><tr><td>Line/Port:</td><td>${esc(p.line)}@phonenetwork.net</td></tr></table>`+
        input('configure','Configure Identity/Device Profile','button')+['activeEndpoint','allowOrigination','allowTermination'].map(n=>input(n,'true','checkbox','checked')).join('');
      script+=`document.querySelector('[name=configure]').onclick=()=>redirectPost(${JSON.stringify(R.deviceModify)},{key:${JSON.stringify(p.name)}});`;
    }else if(route===R.devices){
      title='Device Profiles';body=search([['DeviceName','Identity/Device Profile Name']])+table(['Identity/Device Profile Name','Identity/Device Profile Type'],[...state.devices.values()].filter(p=>!state.query?.findValue0||p.name===state.query.findValue0).map(p=>({cells:[p.name,p.type.replace(/ \((System|Reseller)\)$/,'')]})));
    }else if(route===R.deviceModify){
      title='Identity/Device Profile Modify';body=a+input('deviceName',device.name,'hidden')+input('custom',device.username?'true':'false','hidden')+input('credentialsHaveChanged','false','hidden')+
        input('credentialType','profileTypeCredentials','radio',device.username?'':'checked')+input('credentialType','customCredentials','radio',device.username?'checked':'')+
        input('deviceUserName',device.username||'','text',device.username?'':'disabled')+input('devicePassword','','password',device.username?'':'disabled')+input('devicePasswordConfirm','','password',device.username?'':'disabled');
      script+=`document.querySelector('[name=credentialType][value=customCredentials]').onclick=()=>{for(const n of ['deviceUserName','devicePassword','devicePasswordConfirm'])document.querySelector('[name='+n+']').disabled=false;document.querySelector('[name=custom]').value='true';};document.querySelector('[name=deviceUserName]').onchange=()=>document.querySelector('[name=credentialsHaveChanged]').value='true';`;
    }else if(route===R.numbers){
      title='Numbers';body=search([['Department','Department'],['Dn','Phone Number']])+table(['Phone Numbers','User ID','Department'],options.numberRows||numbers.map(n=>({cells:[n,[...state.users.values()].some(p=>p.number===n)?'assigned':'',department]})));
    }else if(route===R.vm){
      title='Voice Management';body=a+input('vm_active','true','radio',(u?.vm?'checked ':'')+(options.vmChoiceGuard==='disabled'?'disabled':''))+input('vm_active','false','radio',u?.vm?'':'checked')+
        input('vm_storage','voicePortal','radio','checked')+input('chkFlg','','hidden')+'<a id="advanced">Advanced Settings (Also saves current screen data)</a>';
      script+=`document.querySelector('#advanced').onclick=()=>{document.querySelector('[name=chkFlg]').value='advanced';document.querySelector('form[name=mainForm]').submit();};`;
      if(options.vmChoiceGuard==='revert')script+=`document.querySelector('[name=vm_active][value=true]').onclick=event=>event.preventDefault();`;
    }else if(route===R.mailbox){
      title='Voice Management Advanced Settings';body=a+input('mailserver','default','radio','checked')+input('emailAddressOnDefaultMS',u?.mailbox||'')+
        input('userIdOnDefaultMS',u?.mailbox||'')+input('fakePasswordOnDefaultMS','','password')+input('newPasswordOnDefaultMS','','hidden')+input('passwordOnDefaultMSChanged','false','hidden');
      script+=`document.querySelector('[name=fakePasswordOnDefaultMS]').onchange=function(){document.querySelector('[name=newPasswordOnDefaultMS]').value=this.value;document.querySelector('[name=passwordOnDefaultMSChanged]').value='true';};`;
    }else if(route===R.portal){
      title='Passwords';body=a+input('pwdType','WebAccessPswd','radio','checked')+input('pwdType','VoicePortal','radio')+input('newPassword','','password')+input('newPasswordConfirm','','password');
    }else if(route===R.imp){
      title='Integrated IM&P';body=a+input('active','true','radio',u?.imp?'checked':'')+input('active','false','radio',u?.imp?'':'checked')+`<p>IM&amp;P ID: ${options.noImpId?'':esc(state.selected)+'@trifectaphone.com (Primary)'}</p>`;
    }else throw Error('Unexpected native route '+route);
    const skin=`<style>body{font:13px Arial}td{font:inherit}input,button,select{font:inherit}</style>`;
    const validate=`window.validateForm=function(f){${options.nativeHeadValidators?`if(window.nativePageMarker!==${JSON.stringify(route)})throw Error('Stale native page validator');`:''}${route===R.add?"if(!f.elements.firstName.value||!f.elements.lastName.value)return false;":''}${[R.addresses,R.scaAdd].includes(route)?`if(f.elements.deviceName.value==='New Device'&&!f.elements.linePort.value)return false;`:''}return true;};`;
    const head=options.nativeHeadValidators?`<script src="${route===R.vm?'/CommPilot/':'/commpilot/'}Test/PageGuard.js?page=${encodeURIComponent(route)}"></script>`:'';
    return `<!doctype html><html data-cp-direction="snes-dark"><head><title>${title}</title>${skin}${head}</head><body id="initBody.menuTemplate"><table><tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a><a class="headerAuthLevelLink">SP</a><a class="headerAuthLevelLink">${state.group}</a></td></tr></table>
      <form name="leftNavForm"></form>${input('formtokenserial','t'+state.serial,'hidden')}<table width="100%"><tr><td width="82%"><form name="mainForm" id="mainForm" method="post" ${route===R.deviceModify?'action="/commpilot/servlet/DeviceInventoryProvisionServlet" enctype="multipart/form-data"':''}>${input('formtokenserial','t'+state.serial,'hidden')}<table><tr><td class="screenName">${title}</td></tr></table>${error?'<div class="errorMsg">'+esc(error)+'</div>':''}${body}
      <script>window.redirectPost=window.redirectPost||function(){};${validate}${script}document.querySelectorAll('[name=apply],[name=ok]').forEach(b=>b.onclick=()=>document.querySelector('[name=buttonClicked]').value=b.name);document.querySelector('form[name=mainForm]').addEventListener('submit',e=>{if(!validateForm(e.target))e.preventDefault();});</script></form></td></tr></table></body></html>`;
  }
  await page.route(base+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),raw=req.postData()||'';
    if(url.pathname==='/commpilot/Test/PageGuard.js')return route.fulfill({contentType:'application/javascript',body:'window.nativePageMarker='+JSON.stringify(url.searchParams.get('page'))+';'});
    if(url.pathname.startsWith('/CommPilot/'))return route.fulfill({status:403,body:'Incorrect application root case'});
    let p=Object.fromEntries(new URLSearchParams(raw));
    const multipart=req.headers()['content-type']?.match(/boundary=([^;]+)/)?.[1];
    if(multipart){
      p={};for(const chunk of raw.split('--'+multipart)){const match=chunk.match(/name="([^"]+)"[^\r]*\r\n\r\n([\s\S]*?)\r\n$/);if(match)p[match[1]]=match[2];}
    }
    if(url.pathname==='/commpilot/servlet/Login')return route.fulfill({status:200,contentType:'text/html',body:input('formtokenserial','t'+state.serial,'hidden')+"<script>redirectPost('/commpilot/Common/folder_contents.jsp',{});</script>"});
    if(req.method()==='POST'){
      if(p.formtokenserial!=='t'+state.serial){state.badTokens++;return route.fulfill({status:500,body:'Stale token'});}
      state.serial++;
    }
    state.requests.push({route:url.pathname,params:p});
    if(state.dropNavigation?.route===url.pathname&&state.dropNavigation.user===state.selected){state.dropNavigation=null;return route.abort();}
    const devicePost=url.pathname==='/commpilot/servlet/DeviceInventoryProvisionServlet';
    let target=devicePost?R.deviceModify:url.pathname,error='';state.query=p.search?p:null;
    if(target===R.entry){state.selected=p.key.split('>%').at(-1);state.deviceContext=false;}
    if(state.deviceContext&&target.startsWith('/commpilot/User/'))return route.fulfill({contentType:'text/html',body:render(R.deviceModify,'User context was not restored after Device Modify')});
    if(target===R.scaModify)state.sca=p.key;
    if(target===R.deviceModify){state.device=p.key||p.deviceName||state.device;state.deviceContext=true;}
    const writing=p.apply||p.ok||p.chkFlg==='advanced';
    if(target===R.vm)state.advanced=!!p.chkFlg||!!p.mailserver;
    if(writing){
      state.writes.push({route:target,user:target===R.add?p.name:state.selected,params:p});
      const u=user();
      if(state.rejectRoute===target)error='Rejected native step';
      else if(target===R.add){
        state.users.set(p.name,{first:p.unicodeFirstName,last:p.unicodeLastName,email:p.email,caller:p.clidPhone,sca:[],vm:false});target=R.users;
      }else if(target===R.alternate)u.alt=p.alt1;
      else if(target===R.auth)u.auth=p.username;
      else if(target===R.addresses||target===R.scaAdd){
        if(target===R.addresses){u.number=p.phoneNumber==='None'?'':p.phoneNumber;u.extension=p.extension;}
        if(p.deviceName==='New Device'){
          const d={name:p.newDeviceName,type:p.newDeviceType,line:p.linePort};
          state.devices.set(d.name,d);
          if(target===R.addresses)u.primary=d;else u.sca.push(d);
        }
        target=target===R.scaAdd?R.sca:options.addressesReturnsProfile?R.profile:R.addresses;
      }else if(target===R.deviceModify)deviceSave(state.devices.get(state.device),p);
      else if(target===R.vm){if(p.vm_active!==undefined)u.vm=p.vm_active==='true';}
      else if(target===R.mailbox)u.mailbox=p.emailAddressOnDefaultMS;
      else if(target===R.portal)u.pin=p.newPassword;
      else if(target===R.imp)u.imp=p.active==='true';
      if(state.dropRoute===(devicePost?R.deviceModify:url.pathname)){state.dropRoute=null;return route.abort();}
    }
    if(devicePost){
      if(error)state.deviceError=error;
      return route.fulfill({status:200,contentType:'text/html',body:input('formtokenserial','t'+state.serial,'hidden')+`<script>redirectPost(${JSON.stringify(R.devices)},{});</script>`});
    }
    if(target===R.vm&&p.chkFlg==='advanced'&&!error)return route.fulfill({contentType:'text/html',body:input('formtokenserial','t'+state.serial,'hidden')+`<script>redirectPost(${JSON.stringify(R.mailbox)},{});</script>`});
    if(target===R.deviceModify&&state.deviceError){error=state.deviceError;state.deviceError=null;}
    await route.fulfill({status:200,contentType:'text/html',body:render(target,error)});
  });
  function deviceSave(d,p){d.username=p.deviceUserName;d.credentialType=p.credentialType;}
  await page.goto(base+R.users);
  if(options.extensionLoaded){
    // Exercise the manifest's real MAIN/ISOLATED split without injecting a
    // second runtime or replacing the extension's chrome.storage bridge.
    await page.waitForFunction(()=>typeof cpAcquireUserBulk==='function'&&typeof cpCreateBulkEngine==='function'&&document.querySelector('#cp-user-bulk-launch'));
    return state;
  }
  await page.evaluate(()=>{window.testStorage={};window.chrome={storage:{local:{async get(k){return {[k]:window.testStorage[k]};},async set(v){Object.assign(window.testStorage,v);}}}};});
  for(const file of ['user-bulk-phone.js','user-bulk-model.js','user-bulk-storage.js','pjax.js','user-bulk-engine.js','user-bulk.js'])await page.addScriptTag({path:path.join(runtimeRoot,'src/content',file)});
  for(const file of ['native-theme.css','theme-palettes.css','page-baseline.css','forms.css','user-bulk.css'])await page.addStyleTag({path:path.join(runtimeRoot,'src/content',file)});
  if(options.fullSkin)for(const file of ['enhancer.js','forms.js','lists.js'])await page.addScriptTag({path:path.join(runtimeRoot,'src/content',file)});
  if(options.prototype)await page.addScriptTag({path:path.join(root,'tests/fixtures/commpilot-prototype-1.6.1.js')});
  return state;
}
module.exports={fixture,R,root,TYPES};
