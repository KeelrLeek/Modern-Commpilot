const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const runtimeRoot=process.env.CP_BULK_RUNTIME||root;
const recordedFields=require('./fixtures/rsg-recorded-fields.json');
const nativeDocumentGuard=fs.readFileSync(path.join(__dirname,'fixtures/commpilot-document-guard.js'),'utf8').replace(/^\/\/[^\n]*\n/,'');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const R={users:'/commpilot/Group/Members/',add:'/commpilot/Group/Members/Add/index.jsp',profile:'/commpilot/User/Profile/',
  numbers:'/commpilot/Group/GroupDnManagement/index.jsp',devices:'/commpilot/Group/DeviceInventory/',alternate:'/commpilot/User/AlternateUserIDs/',
  addresses:'/commpilot/User/Addresses/',auth:'/commpilot/User/Authentication/',sca:'/commpilot/User/SCAP/',scaAdd:'/commpilot/User/SCAP/Add/index.jsp',scaModify:'/commpilot/User/SCAP/Modify/index.jsp',entry:'/commpilot/Group/Members/Modify/index.jsp'};
const htmlEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(name,value='',type='text',extra='')=>`<input id="${htmlEsc(type==='radio'?name+'_'+value:name)}" name="${name}" type="${type}" value="${htmlEsc(value)}" ${extra}>`;
const select=(name,options,value)=>`<select id="${name}" name="${name}">${options.map(([v,label])=>`<option value="${htmlEsc(v)}" ${v===value?'selected':''}>${htmlEsc(label)}</option>`).join('')}</select>`;
const contractForRoute=route=>recordedFields.pages.find(p=>p.name===({[R.add]:'user-add',[R.alternate]:'alternate-id',[R.addresses]:'addresses',[R.auth]:'authentication',[R.scaAdd]:'teams-add',[R.scaModify]:'teams-add'}[route]))?.controls||[];
const depts=[['dept44','Corporate 44'],['dept46','Corporate 46'],['deptCarmel','AliveRisk - Carmel']];
const numberDeptKey=dept=>'G+Trifecta Solutions+RSG+'+dept;
const op=()=>select('findOp0',[['EQUAL_TO','Equal To']],'EQUAL_TO')+input('findValue0');
const search=fields=>`<div id="search0">${select('findKey0',fields,fields[0][0])}${op()}</div>`;
function table(headers,rows) {
  return `<table id="searchTable"><tr>${headers.map(h=>`<td class="listHeader"><a class="listSortHeader">${h}</a></td>`).join('')}</tr>${rows.length?rows.map((r,i)=>`<tr id="Row${i}">${r.cells.map(c=>`<td><a class="tableLink">${htmlEsc(c)}</a></td>`).join('')}${r.drill?`<script>var f=function(){redirectPost('${r.drill}',{key:'${r.key}',P_key:'${r.key}'});};</script>`:''}</tr>`).join(''):'<tr><td>No Entries Present</td></tr>'}</table>`;
}
function nativeNumberTable(rows,headerMode='spaced') {
  const headers=['Phone Numbers','User ID','Last Name','First Name','Extension','Department','Activated'];
  // Native Numbers rows interleave spacer cells and inline drill-in scripts. Scripts are
  // not columns, and their text is not the displayed value of an otherwise blank User ID.
  const cells=(values,header)=>'<td width="20"'+(header?' class="listHeader"':'')+'></td>'+values.map((v,i)=>
    `<td${header?' class="listHeader"':''}><a class="${header?'listSortHeader':'tableLink'}">${htmlEsc(v)}</a><script>var nativeCell${i}=function(){return 'native wiring';};</script></td>`+
    (i<values.length-1?'<td width="0"'+(header?' class="listHeader"':'')+'></td>':'')).join('');
  const header=headerMode==='spaced'?cells(headers,true):headers.filter(h=>headerMode!=='missing-user'||h!=='User ID').map(h=>`<td class="listHeader"><a class="listSortHeader">${h}</a></td>`).join('');
  return '<table><tr>'+header+'</tr>'+rows.map((r,i)=>`<tr id="Row${i}">${cells([r.phone,r.user,'','','',r.dept,r.active||''],false)}<script>var nativeRow${i}=function(){};</script></tr>`).join('')+'</table>';
}
async function fixture(page,{failAuth=true,fullSkin=false,numberRows=null,numberPageSize=Infinity,failNumberPage=false,numberSearchGate=null,numberHeaderMode='spaced',deviceLineMode='dual',deviceDomainValue='native.example.test',scaLineSuffix=true,nativeScriptDependencies=false,localUserIds=false}={}) {
  const state={serial:1,requests:[],users:new Map(),devices:new Map(),selected:null,badTokens:0,authFailures:0,assets:[]};
  const numbers=[['3125550101','Corporate 44'],['3125550102','Corporate 44'],['4155550103','Corporate 46']];
  const person=()=>state.users.get(state.selected);
  function render(route, error='') {
    let body='', title='Users', u=person();
    const actions=add=>input('buttonClicked','','hidden')+input('ok','OK','submit',`onclick="this.form.elements.buttonClicked.value='ok'"`)+(add?'':input('apply','Apply','submit',`onclick="this.form.elements.buttonClicked.value='apply'"`));
    if(route===R.add) {
      title='User Add';body=actions(true)+input('name')+select('domain',[['phonenetwork.net','phonenetwork.net']],'phonenetwork.net')+
        ['unicodeFirstName','unicodeLastName','firstName','lastName','nameDialingFirstName','nameDialingLastName','clidPhone','email'].map(n=>input(n)).join('')+
        input('password','','password')+input('echoPassword','','password')+select('deptEncodedKey',depts,'dept44')+select('language',[['English','English']],'English')+select('timeZone',[['America/Chicago','America/Chicago']],'America/Chicago');
    } else if(route===R.users) {
      body=input('add','Add','button')+search([['UserID','User ID'],['Extension','Extension']])+table(['User ID','First Name'],[...state.users.entries()].filter(([id,p])=>{
        if (!state.lastSearch) return true;
        return state.lastSearch.findKey0==='Extension'?p.extension===state.lastSearch.findValue0:id+'@phonenetwork.net'===state.lastSearch.findValue0;
      }).map(([id,p])=>({cells:[localUserIds?id:id+'@phonenetwork.net',p.first],drill:R.entry,key:id})));
    } else if(route===R.entry||route===R.profile) {
      title='Profile';body=actions()+input('unicodeFirstName',u?.first)+input('unicodeLastName',u?.last)+input('firstName',u?.clidFirst)+input('lastName',u?.clidLast)+input('email',u?.email)+select('deptEncodedKey',depts,u?.deptKey);
    } else if(route===R.numbers) {
      // Match the recorded native page: encoded department values, a results table with NO searchTable ID,
      // blank User ID cells, and a server paging descriptor. The old simplified fixture missed this shape.
      const rows=(numberRows||numbers.map(([n,d])=>({phone:'+1-'+n,dept:d,user:[...state.users.values()].find(p=>p.number===n)?n+'@phonenetwork.net':'',active:'✓'})))
        .filter(r=>!state.lastSearch||numberDeptKey(r.dept)===state.lastSearch.findValue0);
      const page=state.numberPage||0,total=Math.max(1,Math.ceil(rows.length/numberPageSize));
      const pageRows=Number.isFinite(numberPageSize)?rows.slice(page*numberPageSize,(page+1)*numberPageSize):rows;
      title='Numbers';body='<div id="search0">'+select('findKey0',[['ExactDnDepartment','Department']],'ExactDnDepartment')+
        select('findOp0',[['EQUAL_TO','Equal To']],'EQUAL_TO')+select('findValue0',depts.map(([,d])=>[numberDeptKey(d),d]),numberDeptKey('Corporate 44'))+'</div>'+
        nativeNumberTable(pageRows,numberHeaderMode)+
        `<div>Page ${page+1} of ${total}</div><script>var paging={returnPage:'/Group/GroupDnManagement/index.jsp',tableName:'groupDnTable'};</script>`;
    } else if(route===R.devices) {
      title='Identity/Device Profiles';body=search([['DeviceName','Identity/Device Profile Name']])+table(['Identity/Device Profile Name','Identity/Device Profile Type'],[...state.devices.entries()].filter(([name])=>!state.lastSearch||name===state.lastSearch.findValue0).map(([name,type])=>({cells:[name,type]})));
    } else if(route===R.alternate) {title='Alternate User IDs';body=actions()+input('alt1',u?.alternate||'');}
    else if(route===R.auth) {title='Authentication';body=actions()+input('username',u?.auth||'')+input('newPassword','','password')+input('newPasswordConfirm','','password');}
    else if(route===R.scaModify) {
      title='Shared Call Appearance Modify';body=actions()+
        '<table><tr><td>Identity/Device Profile Name:</td><td>'+htmlEsc(u.teams.name+' (Group)')+'</td></tr><tr><td>Line/Port:</td><td>'+htmlEsc(u.teams.line+(u.teams.domain?'@'+u.teams.domain:''))+'</td></tr></table>'+
        ['activeEndpoint','allowOrigination','allowTermination'].map(n=>input(n,'','checkbox',u.teams[n]?'checked':'')).join('');
    }
    else if(route===R.addresses||route===R.scaAdd) {
      title=route===R.addresses?'Addresses':route===R.scaAdd?'Shared Call Appearance Add':'Shared Call Appearance Modify';
      const kind=route===R.addresses?'vvx':'teams',device=u?.[kind], current=device?.name+' (Group)';
      body=actions(route===R.scaAdd);
      if(kind==='vvx') body+=select('phoneNumber',[['None','None'],...numbers.map(([n])=>[n,n])],u?.number||'None')+input('extension',u?.extension||'')+
        input('deviceChoice','None','radio',!device?'checked':'')+input('deviceChoice','Device Profile','radio',device?'checked':'');
      body+=select('deviceName',[['None','None'],['New Device','New Identity/Device Profile (Group)'],...[...state.devices.keys()].map(n=>[n+' (Group)',n+' (Group)'])],device?current:'None')+
        input('newDeviceName')+select('newDeviceType',[['Trifecta PolycomVVX400','Trifecta PolycomVVX400 (Reseller)'],['Trifecta Teams','Trifecta Teams (Reseller)']],'Trifecta PolycomVVX400')+
        (deviceLineMode!=='qualified'?`<div id="trDeviceLinePort" ${deviceLineMode==='dual'?'style="display:none"':''}>${input('deviceLinePort',device?.line||'')}</div>`:'')+
        (deviceLineMode!=='plain'?`<div id="trDeviceLinePortDomain" class="fx-item fx-field"><label class="fx-label" for="deviceLinePortDomain">Line/Port*</label>${input('deviceLinePortDomain',device?.line||'')}${select('deviceDomain',[[deviceDomainValue,deviceDomainValue]],deviceDomainValue)}</div>`:'')+input('macAddress')+input('linePort',device?.line||'','hidden');
      if(kind==='teams') body+=['activeEndpoint','allowOrigination','allowTermination'].map(n=>input(n,'','checkbox',device&&!device[n]?'':'checked')).join('');
    } else if(route===R.sca) {
      title='Shared Call Appearance';body=table(['Identity/Device Profile Type','Identity/Device Profile Name','Line/Port'],u?.teams?[{cells:['Trifecta Teams',u.teams.name+' (Group)',u.teams.line+(scaLineSuffix&&u.teams.domain?'@'+u.teams.domain:'')],drill:R.scaModify,key:[u.teams.name,u.teams.line,'empty_staticSipUrl','empty_portNumberStr','false','empty_staticSipPath'].join('\\u003C!\\u003E')}]:[]);
    } else throw Error('Unhandled fixture route '+route);
    // Required labels/limits come from the recording, not from the engine's field list.
    const contract=contractForRoute(route);
    for(const c of contract) {
      if(c.required&&!c.visibleByInlineStyles&&!['deviceLinePort','deviceLinePortDomain'].includes(c.name)&&!body.includes(`name="${c.name}"`))
        body+=`<div style="display:none">${input(c.name)}</div>`;
      if(c.label&&body.includes(`name="${c.name}"`))body+=`<label for="${c.name}">${htmlEsc(c.label)}</label>`;
    }
    const limits=`for(var c of ${JSON.stringify(contract.map(c=>({name:c.name,maxLength:c.maxLength})) )}){var field=document.forms.mainForm.elements[c.name];if(field&&field.tagName==='INPUT'&&c.maxLength>=0)field.maxLength=c.maxLength;}`;
    let validation=route===R.add?`window.validateForm=function(f){window.bulkNativeValidationCalls=(window.bulkNativeValidationCalls||0)+1;if(window.bulkBlockValidation){var error=document.createElement('div');error.className='errorMsg';error.textContent='Native validation: caller ID name is invalid.';f.prepend(error);return false;}var missing=[];if(!f.elements.firstName.value)missing.push('Calling Line ID First Name is a required field');if(!f.elements.lastName.value)missing.push('Calling Line ID Last Name is a required field');if(missing.length){alert('Page cannot be submitted:\\n'+missing.join('\\n'));return false;}return true;};`:'window.validateForm=function(){return true;};';
    // Observed on the live sandbox: the visible input commits on blur; native
    // validation reads hidden linePort, not either displayed deviceLinePort box.
    if([R.addresses,R.scaAdd].includes(route))validation=`window.setLinePort=function(port){document.forms.mainForm.linePort.value=port.value;};for(var name of ['deviceLinePort','deviceLinePortDomain'])document.getElementById(name)?.addEventListener('blur',function(){setLinePort(this);});window.validateForm=function(f){if(!f.linePort.value){alert('Must specify the Line/Port for using a device profile.');return false;}return true;};document.getElementById('deviceDomain')?.addEventListener('change',function(){window.bulkDeviceDomainChanges=(window.bulkDeviceDomainChanges||0)+1;for(var name of ['deviceLinePort','deviceLinePortDomain']){var field=document.getElementById(name);if(field)field.value='';}document.forms.mainForm.linePort.value='';});`;
    const faultInjection=`for(var button of document.forms.mainForm.querySelectorAll('[name="ok"],[name="apply"]'))button.addEventListener('click',function(){var fault=window.bulkBeforeSaveFault;if(!fault)return;for(var e of document.forms.mainForm.elements){if(e.name!==fault.name)continue;if(fault.reveal)e.closest('div').style.display='block';else if(e.type==='radio'||e.type==='checkbox')e.checked=false;else e.value=fault.value||'';}});`;
    // Real validators are body scripts that depend on helpers in the document head.
    // A list landing deliberately has none of these globals loaded yet.
    const dependencies=nativeScriptDependencies&&route!==R.users;
    const head=`<style id="antiCrossFraming">body{display:none}</style><script>${nativeDocumentGuard}</script>`+(dependencies?`<script src="/commpilot/Scripts/native-utils.js"></script><script src="/commpilot/Scripts/native-dependent.js"></script><script>window.nativePage=${JSON.stringify(route)};window.nativeBodyReady=false;window.nativeDclReady=false;window.nativeLoadReady=false;document.addEventListener('DOMContentLoaded',function(){${state.failNativeInitializer?"throw Error('Fixture native initializer failed');":''}if(!nativeBodyReady)throw Error('DCL ran before page scripts');window.nativeDclReady=true;});window.addEventListener('load',function(){if(!nativeDclReady)throw Error('load ran before DCL');window.nativeLoadReady=true;});</script>`:'');
    const bodyDeps=dependencies?'<script src="/commpilot/Scripts/native-body-first.js"></script><script src="/commpilot/Scripts/native-body-second.js"></script>':'';
    if(dependencies)validation+=`var baseValidate=window.validateForm;window.validateForm=function(f){if(trim(' ready ')!=='ready'||nativePage!==${JSON.stringify(route)}||!nativeBodyReady||!nativeLoadReady)throw Error('Native validation dependencies are not ready');return baseValidate(f);};`;
    validation+=`if(window.bulkValidationMode==='missing')window.validateForm=undefined;else if(window.bulkValidationMode==='undefined')window.validateForm=function(){};`;
    return `<!doctype html><html data-cp-direction="snes-dark" data-cp-font="inter"><head><title>${title}</title>${head}</head><body id="initBody.menuTemplate"><a class="headerAuthLevelLink">RSG</a><form name="leftNavForm"></form>${input('formtokenserial','t'+state.serial,'hidden')}<table style="width:100%"><tr><td width="82%" valign="top"><form name="mainForm" id="mainForm" method="post">${input('formtokenserial','t'+state.serial,'hidden')}<table><tr><td class="screenName">${title}</td></tr></table>${error?'<div class="errorMsg">'+htmlEsc(error)+'</div>':''}${body}${bodyDeps}<script>${limits}${validation}${faultInjection}document.getElementById('mainForm').addEventListener('submit',function(e){if(!window.validateForm(this))e.preventDefault();});</script></form></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
  }
  await page.route('https://apps-sbx.avpaas.io/**',async route=>{
    const req=route.request(),url=new URL(req.url()),params=Object.fromEntries(new URLSearchParams(req.postData()||''));
    if(url.pathname.startsWith('/commpilot/Scripts/')) {
      state.assets.push(url.pathname);
      await new Promise(resolve=>setTimeout(resolve,url.pathname.endsWith('native-utils.js')?150:40));
      if(state.failNativeScript){await route.fulfill({status:503,body:'Dependency unavailable'});return;}
      const scripts={
        'native-utils.js':"window.nativeUtilsInstalls=(window.nativeUtilsInstalls||0)+1;function trim(value){return value.replace(/^\\s+|\\s+$/g,'');}",
        'native-dependent.js':"window.nativeDependency=trim(' ready ');",
        'native-body-first.js':"if(nativeDependency!=='ready')throw Error('Head scripts out of order');window.nativeBodyFirst=nativePage;",
        'native-body-second.js':"if(nativeBodyFirst!==nativePage)throw Error('Body scripts out of order');window.nativeBodyReady=true;"
      };
      await route.fulfill({status:200,contentType:'text/javascript',body:scripts[url.pathname.split('/').pop()]});return;
    }
    if(req.method()==='POST') {
      if(params.formtokenserial!=='t'+state.serial) {state.badTokens++;await route.fulfill({status:500,body:'stale token'});return;}
      state.serial++;state.requests.push({path:url.pathname,params});
    }
    if(url.pathname==='/commpilot/servlet/Login') {
      await route.fulfill({status:200,contentType:'text/html',body:input('formtokenserial','t'+state.serial,'hidden')+"<script>redirectPost('/commpilot/Common/folder_contents.jsp',{});</script>"});return;
    }
    let target=url.pathname, error='';state.lastSearch=params.search?params:null;
    if(target===R.numbers&&params.search&&numberSearchGate) await numberSearchGate;
    if(target===R.numbers&&params.search&&state.failNumberSearch) {
      await route.fulfill({status:500,body:'Numbers lookup unavailable'});return;
    }
    if(target===R.numbers) {state.numberPage=0;state.numberSearch=state.lastSearch;}
    if(target==='/commpilot/Common/page.jsp') {
      assert.equal(params.returnPage,'/Group/GroupDnManagement/index.jsp');
      if(failNumberPage) {await route.fulfill({status:500,body:'Number page unavailable'});return;}
      target=R.numbers;state.numberPage=Number(params.value);state.lastSearch=state.numberSearch;
    }
    if(target===R.entry) state.selected=params.key;
    if(target===R.scaModify) {
      const u=person();
      assert.equal(params.key,[u.teams.name,u.teams.line,'empty_staticSipUrl','empty_portNumberStr','false','empty_staticSipPath'].join('<!>'),'SCA row keys must decode both angle brackets before navigation');
      assert.equal(params.P_key,params.key);
    }
    if(params.ok||params.apply) {
      const u=person();
      if(target===R.add) {
        assert.equal(params.password,'Easy1234');assert.equal(params.echoPassword,'Easy1234');assert.equal(params.timeZone,'America/Chicago');assert.equal(params.language,'English');
        if(!params.firstName||!params.lastName) error='[Error 5001] Calling Line ID First Name and Last Name are required.';
        else if(state.rejectAddError) error=state.rejectAddError;
        else if(state.users.has(params.name)) error='User exists';
        else state.users.set(params.name,{first:params.unicodeFirstName,last:params.unicodeLastName,clidFirst:params.firstName,clidLast:params.lastName,email:params.email,deptKey:params.deptEncodedKey});
        if(!error){target=R.users;if(state.failNativeScriptAfterAdd)state.failNativeScript=true;}
      } else if(target===R.alternate) u.alternate=params.alt1;
      else if(target===R.auth) {
        if(failAuth&&state.selected==='4155550103'&&!state.authFailures++) error='Authentication refused';
        else {assert.equal(params.newPassword,params.newPasswordConfirm);u.auth=params.username;}
      } else if(target===R.addresses||target===R.scaAdd) {
        assert.equal(params.deviceName,'New Device');assert.equal(params.macAddress,'');
        const expectedLine=state.selected+(target===R.scaAdd?'_Teams':'');
        assert.equal(params.linePort,expectedLine,'the native hidden Line/Port payload must be committed before validation/save');
        if(deviceLineMode!=='qualified')assert.equal(params.deviceLinePort,expectedLine,'the native Line/Port must contain the exact local line value');
        if(deviceLineMode!=='plain')assert.equal(params.deviceLinePortDomain,expectedLine,'the alternate Line/Port control must contain the same local line value');
        assert.equal(params.deviceDomain,deviceLineMode==='plain'?undefined:deviceDomainValue,'leave the native device domain unchanged');
        state.devices.set(params.newDeviceName,params.newDeviceType);
        const kind=target===R.addresses?'vvx':'teams';
        u[kind]={name:params.newDeviceName,line:params.deviceLinePort||params.deviceLinePortDomain,domain:params.deviceDomain,...Object.fromEntries(['activeEndpoint','allowOrigination','allowTermination'].map(n=>[n,Object.hasOwn(params,n)]))};
        if(kind==='vvx'){u.number=params.phoneNumber;u.extension=params.extension;}
        else target=R.sca;
      }
    }
    if(state.dropNextSave&&(params.ok||params.apply)) {state.dropNextSave=false;await route.abort('failed');return;}
    await route.fulfill({status:200,contentType:'text/html',body:render(target,error)});
  });
  await page.goto('https://apps-sbx.avpaas.io'+R.users);
  for(const file of ['pjax.js','user-bulk-engine.js','user-bulk.js'])await page.addScriptTag({path:path.join(runtimeRoot,'src/content',file)});
  for(const file of ['native-theme.css','theme-palettes.css','page-baseline.css','forms.css','user-bulk.css'])await page.addStyleTag({path:path.join(runtimeRoot,'src/content',file)});
  if(fullSkin)for(const file of ['enhancer.js','forms.js','lists.js'])await page.addScriptTag({path:path.join(runtimeRoot,'src/content',file)});
  return state;
}

test('guided RSG batch uses rotating native tokens, verifies saves, continues failures, and retries without duplicates',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    const state=await fixture(page,{fullSkin:true});
    await page.locator('#cp-user-bulk-launch').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk [data-field="first"]'));
    assert.equal(state.users.size,0,'opening and editing must be read-only');
    await page.locator('#cp-user-bulk [data-action="paste"]').click();
    await page.locator('#cp-user-bulk textarea').fill('Alex\tMorgan\talex@example.test\tCorporate 44\nCasey\tReed\tcasey@example.test\tCorporate 46\nJordan\tEllis\tjordan@example.test\tCorporate 44');
    await page.locator('#cp-user-bulk [data-action="import"]').click();
    for(const [i,number]of [[0,'3125550101'],[1,'4155550103'],[2,'3125550102']]){
      await page.locator('#cp-user-bulk [data-pick]').nth(i).click();
      await page.locator(`#cp-user-bulk [data-number="${number}"]`).click();
    }
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    for(const d of ['Corporate 44','Corporate 46'])await page.getByRole('textbox',{name:'SIP password for '+d,exact:true}).fill('fixture-'+d);
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .review-table'));
    assert.equal(state.users.size,0,'preflight must not create users or device profiles');assert.equal(state.devices.size,0);
    const writes=()=>state.requests.filter(r=>r.params.ok||r.params.apply);
    assert.equal(writes().length,0);
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.includes('Batch finished with'),null,{timeout:60000});
    assert.equal(state.users.size,3,await page.locator('#cp-user-bulk .run-table').innerText());assert.equal(state.devices.size,5);
    assert.equal(await page.evaluate(()=>window.bulkNativeValidationCalls),3,'each Add must run native validation exactly once before serialization');
    for(const write of writes().filter(r=>r.path===R.add)) {
      assert.equal(write.params.firstName,write.params.unicodeFirstName,'Calling Line ID First Name must be explicitly populated before validation');
      assert.equal(write.params.lastName,write.params.unicodeLastName);
      assert.equal(write.params.nameDialingFirstName,'','do not invent additional name-dialing defaults');
    }
    assert.equal(state.users.get('3125550101').teams.name,'RSG Teams 50101');
    assert.equal(state.users.get('4155550103').auth,undefined);
    assert.equal(state.users.get('3125550102').auth,'3125550102','the next user must continue after a failure');
    assert.equal(state.badTokens,0);
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.startsWith('All users configured'),null,{timeout:60000});
    assert.equal(state.devices.size,6);assert.equal(state.users.size,3);
    assert.equal(writes().filter(r=>r.path===R.add).length,3,'retry must not repeat successful user creation');
    assert.equal(writes().filter(r=>r.path===R.addresses).length,3,'retry must not repeat successful VVX creation');
    assert.equal(state.users.get('4155550103').teams.line,'4155550103_Teams');
    assert.equal(state.users.get('4155550103').alternate,'casey@example.test');
    assert.equal(state.badTokens,0);assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>window.bulkDeviceDomainChanges||0),0,'bulk provisioning must not change device domains');
    assert.deepEqual(dialogs,[],'a valid batch must not trigger missing Calling Line ID name alerts');
    const stores=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
    assert.ok(!stores.includes('fixture-Corporate'),'SIP secrets must never enter persistent storage');
    await page.screenshot({path:path.join(root,'dev-preview/bulk-user-designs/implemented-b-run.png')});
    await page.locator('#cp-user-bulk [data-action="close"]').click();
    await page.waitForFunction(()=>!document.querySelector('#cp-user-bulk'));
    assert.equal(await page.evaluate(async()=>{const lease=await cpAcquireUserBulk();lease.release();return true;}),true,'closing must release the transport');
  } finally {await browser.close();}
});

module.exports={fixture,R};

test('bulk navigation loads missing native head helpers and ordered page scripts before validating each save',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const state=await fixture(page,{failAuth:false,fullSkin:true,nativeScriptDependencies:true});
    assert.equal(await page.locator('#antiCrossFraming').count(),0,'the captured native guard must run only on the original document load');
    assert.equal(await page.evaluate(()=>typeof window.trim),'undefined','the Users landing must reproduce a cold validator dependency');
    const failure=await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);
      try {
        await engine.initialize();
        for(const number of ['3125550101','3125550102']) {
          const user={first:'Alex',last:'Morgan',email:number+'@example.test',dept:'Corporate 44',number};
          for(let step=0;step<6;step++)await engine.step(user,step,'fixture-secret');
        }
        return null;
      }catch(e){return e.message;}finally{lease.release();}
    });
    assert.equal(failure,null);assert.equal(state.users.size,2);assert.equal(state.devices.size,4);
    assert.equal(await page.evaluate(()=>window.nativeUtilsInstalls),1,'shared head libraries must not be installed repeatedly in the active document');
    assert.equal(await page.locator('#antiCrossFraming').count(),0,'PJAX must not recreate the document-level protection element');
    assert.equal(state.badTokens,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('startup failures identify the script or initializer and Retry loading opens the editor without saving',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    for(const mode of ['network','initializer']) {
      const page=await browser.newPage();const state=await fixture(page,{nativeScriptDependencies:true});
      if(mode==='network')state.failNativeScript=true;else state.failNativeInitializer=true;
      await page.locator('#cp-user-bulk-launch').click();
      await page.getByRole('button',{name:'Retry loading',exact:true}).waitFor();
      const notice=await page.locator('#cp-user-bulk .notice').innerText();
      if(mode==='network')assert.match(notice,/native-utils\.js/);
      else {assert.match(notice,/DOMContentLoaded handler failed/);assert.match(notice,/Fixture native initializer failed/);assert.match(notice,/head script 4/);}
      assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
      state.failNativeScript=false;state.failNativeInitializer=false;
      await page.getByRole('button',{name:'Retry loading',exact:true}).click();
      await page.locator('#cp-user-bulk [data-field="first"]').waitFor();
      assert.equal(state.users.size,0);assert.equal(state.devices.size,0);assert.equal(state.badTokens,0);
      await page.locator('#cp-user-bulk [data-action="close"]').click();
      await page.waitForFunction(()=>!document.getElementById('cp-user-bulk'));await page.close();
    }
  }finally{await browser.close();}
});

test('a missing native script blocks all saves and can be loaded on an explicit retry',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{nativeScriptDependencies:true});
    state.failNativeScript=true;
    const failure=await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);window.bulkDependencyTest={lease,engine};
      try{await engine.initialize();return null;}catch(e){return e.message;}
    });
    assert.match(failure,/native.*script.*load/i);
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
    state.failNativeScript=false;
    await page.evaluate(async()=>{
      const {lease,engine}=bulkDependencyTest;
      try{await lease.recover();await engine.initialize();await engine.step({first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'},0);}finally{lease.release();}
    });
    assert.equal(state.users.size,1);assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1);assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('script failure after a successful Add is recovered by readback without repeating creation',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{failAuth:false,nativeScriptDependencies:true});
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      window.bulkAfterSaveTest={lease,engine,user:{first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'}};
    });
    state.failNativeScriptAfterAdd=true;
    const failure=await page.evaluate(async()=>{try{await bulkAfterSaveTest.engine.step(bulkAfterSaveTest.user,0);return null;}catch(e){return e.message;}});
    assert.match(failure,/native.*script.*load/i);assert.doesNotMatch(failure,/No save was sent/);
    assert.equal(state.users.size,1,'the server saved the user before the response script failed');
    state.failNativeScript=false;state.failNativeScriptAfterAdd=false;
    await page.evaluate(async()=>{const {lease,engine,user}=bulkAfterSaveTest;try{await lease.recover();for(let step=0;step<6;step++)await engine.step(user,step,'fixture-secret');}finally{lease.release();}});
    assert.equal(state.users.size,1);assert.equal(state.devices.size,2);
    assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1);assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('native fixtures retain every recorded required control, label and input limit',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page);
    await page.evaluate(async()=>{window.contractLease=await cpAcquireUserBulk();});
    for(const route of [R.add,R.alternate,R.addresses,R.auth,R.scaAdd]) {
      await page.evaluate(async route=>contractLease.navigate(route),route);
      const controls=contractForRoute(route).filter(c=>c.required);
      const actual=await page.evaluate(controls=>controls.map(c=>{
        const e=[...document.forms.mainForm.elements].find(e=>e.name===c.name);
        return {name:c.name,present:!!e,star:e?[...e.labels].some(l=>l.textContent.includes('*')):false,max:e?.maxLength};
      }),controls);
      for(const c of controls) {
        const found=actual.find(e=>e.name===c.name);
        assert.ok(found.present,route+' must include the recording\'s '+c.name);
        assert.ok(found.star,route+' must retain the required marker on '+c.name);
        if(c.maxLength>=0)assert.equal(found.max,c.maxLength,route+' '+c.name+' native limit');
      }
    }
    await page.evaluate(()=>contractLease.release());
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
  }finally{await browser.close();}
});

test('each recorded required or configured field is checked again after the native save click',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage(),dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
    const state=await fixture(page,{failAuth:false});
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      window.bulkAudit={lease,engine,user:{first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'}};
    });
    const fieldsByStep=[
      ['name','domain','unicodeFirstName','unicodeLastName','firstName','lastName','clidPhone','email','deptEncodedKey','password','echoPassword'],
      ['alt1'],
      ['phoneNumber','extension','deviceChoice','deviceName','newDeviceName','newDeviceType','deviceLinePort','deviceLinePortDomain','macAddress'],
      ['username','newPassword','newPasswordConfirm'],
      ['deviceName','newDeviceName','newDeviceType','deviceLinePort','deviceLinePortDomain','activeEndpoint','allowOrigination','allowTermination']
    ];
    for(let step=0;step<fieldsByStep.length;step++) {
      for(const name of fieldsByStep[step]) {
        const before=state.requests.filter(r=>r.params.ok||r.params.apply).length;
        const error=await page.evaluate(async({step,name})=>{
          window.bulkBeforeSaveFault={name,value:name==='macAddress'?'BADMAC':''};
          try{await bulkAudit.engine.step(bulkAudit.user,step,'fixture-secret');return null;}catch(e){return e.message;}
        },{step,name});
        assert.match(error||'',/No save was sent/,`step ${step}: ${name} must block an incomplete native form`);
        assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,before,`step ${step}: ${name} sent a bad save`);
        assert.equal(await page.evaluate(()=>bulkAudit.lease.needsRecovery),false);
      }
      await page.evaluate(async step=>{window.bulkBeforeSaveFault=null;await bulkAudit.engine.step(bulkAudit.user,step,'fixture-secret');},step);
    }
    await page.evaluate(async()=>{await bulkAudit.engine.step(bulkAudit.user,5);bulkAudit.lease.release();});
    assert.deepEqual(dialogs,[]);assert.equal(state.users.size,1);assert.equal(state.devices.size,2);assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('conditional required fields block saving only when native device controls make them visible',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage(),dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
    const state=await fixture(page,{failAuth:false});
    const error=await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      const user={first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'};
      window.bulkConditional={lease,engine,user};await engine.step(user,0);await engine.step(user,1);
      window.bulkBeforeSaveFault={name:'ipAddressRequired',reveal:true};
      try{await engine.step(user,2);return null;}catch(e){return e.message;}
    });
    assert.match(error,/Required CommPilot fields are empty: Host Name\/IP Address/);
    assert.equal(state.devices.size,0);assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,2);
    await page.evaluate(async()=>{window.bulkBeforeSaveFault=null;await bulkConditional.engine.step(bulkConditional.user,2);bulkConditional.lease.release();});
    assert.equal(state.devices.size,1);assert.deepEqual(dialogs,[]);assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('VVX and Teams set local Line/Port values with either native input layout and no domain requirement',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    for(const [deviceLineMode,deviceDomainValue]of [['plain','native.example.test'],['qualified','native.example.test'],['dual','']]) {
      const page=await browser.newPage(),dialogs=[];
      page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
      const state=await fixture(page,{failAuth:false,deviceLineMode,deviceDomainValue,scaLineSuffix:deviceLineMode==='qualified'});
      await page.evaluate(async()=>{
        const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
        const user={first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'};
        for(let step=0;step<6;step++)await engine.step(user,step,'fixture-secret');
        lease.release();
      });
      const saved=state.users.get('3125550101');
      assert.equal(saved.vvx.line,'3125550101');assert.equal(saved.teams.line,'3125550101_Teams');
      assert.equal(saved.vvx.domain,deviceLineMode==='plain'?undefined:deviceDomainValue);
      assert.equal(saved.teams.domain,deviceLineMode==='plain'?undefined:deviceDomainValue);
      assert.equal(state.devices.size,2);assert.equal(state.badTokens,0);assert.deepEqual(dialogs,[]);
      assert.equal(await page.evaluate(()=>window.bulkDeviceDomainChanges||0),0);
      assert.equal(state.requests.filter(r=>(r.path===R.addresses||r.path===R.scaAdd)&&(r.params.ok||r.params.apply)).length,2);
      await page.close();
    }
  }finally{await browser.close();}
});

test('default-domain local User IDs reopen and retry without creating a duplicate',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{failAuth:false,localUserIds:true});
    const result=await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      const user={first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'};
      await engine.preflight([user]);
      for(let step=0;step<6;step++)await engine.step(user,step,'fixture-secret');
      await engine.step(user,0);
      let collision;try{await engine.step({...user,createAttempted:false},0);}catch(e){collision=e.message;}
      lease.release();return collision;
    });
    assert.match(result,/already exists; it was not created by this batch/);
    assert.equal(state.users.size,1);assert.equal(state.devices.size,2);
    assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1);
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('bulk search and provisioning survive CommPilot Prototype 1.6.1 collection overrides',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{failAuth:false,fullSkin:true});
    // The real dependency loaded by Addresses overwrites Array#map/filter/some.
    await page.addScriptTag({path:path.join(__dirname,'fixtures/commpilot-prototype-1.6.1.js')});
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      const user={first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'};
      await engine.preflight([user]);
      for(let step=0;step<6;step++)await engine.step(user,step,'fixture-secret');
      lease.release();
    });
    assert.equal(state.users.size,1);assert.equal(state.devices.size,2);assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('a saved caller-ID name mismatch blocks subsequent provisioning before another save',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page);
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      const user={first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'};
      window.bulkNameTest={lease,engine,user};await engine.step(user,0);
    });
    assert.equal(state.users.get('3125550101').clidFirst,'Alex');
    assert.equal(state.users.get('3125550101').clidLast,'Morgan');
    state.users.get('3125550101').clidFirst='Unexpected';
    const failure=await page.evaluate(async()=>{try{await bulkNameTest.engine.step(bulkNameTest.user,1);return null;}catch(e){return e.message;}finally{bulkNameTest.lease.release();}});
    assert.match(failure,/Calling Line ID First Name did not match the saved configuration/);
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,1,'do not continue provisioning when saved required names are wrong');
    assert.equal(state.users.get('3125550101').alternate,undefined);
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('verification rejects a wrong saved VVX or Teams Line/Port without sending another save',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{failAuth:false});
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      const user={first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'};
      window.bulkLineTest={lease,engine,user};for(let step=0;step<6;step++)await engine.step(user,step,'fixture-secret');
    });
    const saves=state.requests.filter(r=>r.params.ok||r.params.apply).length,saved=state.users.get('3125550101');
    saved.vvx.line='3125550999';
    const primaryFailure=await page.evaluate(async()=>{try{await bulkLineTest.engine.step(bulkLineTest.user,5);return null;}catch(e){return e.message;}});
    assert.match(primaryFailure,/saved primary VVX configuration did not match/);
    saved.vvx.line='3125550101';saved.teams.line='3125550101_Wrong';
    const teamsFailure=await page.evaluate(async()=>{try{await bulkLineTest.engine.step(bulkLineTest.user,5);return null;}catch(e){return e.message;}finally{bulkLineTest.lease.release();}});
    assert.match(teamsFailure,/Teams line\/port does not match/);
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,saves);
    assert.equal(state.badTokens,0);
  }finally{await browser.close();}
});

test('native validation can block an Add without sending a save, then allow a corrected retry',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page);
    const failure=await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      window.bulkValidationTest={lease,engine,user:{first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'}};
      window.bulkBlockValidation=true;
      try {await engine.step(bulkValidationTest.user,0);return null;}catch(e){return e.message;}
    });
    assert.match(failure,/Native validation: caller ID name is invalid/);
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
    assert.equal(state.users.size,0);
    assert.equal(await page.evaluate(()=>bulkValidationTest.lease.needsRecovery),false);
    await page.evaluate(async()=>{window.bulkBlockValidation=false;await bulkValidationTest.engine.step(bulkValidationTest.user,0);bulkValidationTest.lease.release();});
    assert.equal(state.users.size,1);assert.equal(state.badTokens,0);
    assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1);
    assert.equal(await page.evaluate(()=>window.bulkNativeValidationCalls),2);
  }finally{await browser.close();}
});

test('an unavailable validator or undefined validation result cannot submit a bulk user',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page);
    await page.evaluate(async()=>{
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      window.bulkInvalidValidator={lease,engine,user:{first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'}};
    });
    for(const mode of ['missing','undefined']) {
      const failure=await page.evaluate(async mode=>{window.bulkValidationMode=mode;const {engine,user}=bulkInvalidValidator;try{await engine.step(user,0);return null;}catch(e){return e.message;}},mode);
      assert.match(failure,/CommPilot form validation failed/);
      assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
    }
    await page.evaluate(async()=>{window.bulkValidationMode=null;const {lease,engine,user}=bulkInvalidValidator;try{await engine.step(user,0);}finally{lease.release();}});
    assert.equal(state.users.size,1);assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1);
  }finally{await browser.close();}
});

test('server rejection details remain readable with credentials hidden, and rejected users can retry',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{failAuth:false});
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="first"]');
    for(const [f,val]of [['first','Alex'],['last','Morgan'],['email','alex@example.test']])await page.locator(`#cp-user-bulk [data-field="${f}"]`).fill(val);
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
    await page.locator('#cp-user-bulk [data-pick]').click();await page.locator('#cp-user-bulk [data-number="3125550101"]').click();
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.getByRole('textbox',{name:'SIP password for Corporate 44',exact:true}).fill('fixture-secret');
    await page.locator('#cp-user-bulk [data-action="primary"]').click();await page.locator('#cp-user-bulk .review-table').waitFor();
    state.rejectAddError='[Error 4999] Department user limit reached. Easy1234 fixture-secret';
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.includes('Batch finished with'));
    const shown=await page.locator('#cp-user-bulk .run-table').innerText();
    assert.match(shown,/\[Error 4999\] Department user limit reached/);assert.doesNotMatch(shown,/Easy1234|fixture-secret/);
    await page.locator('#cp-user-bulk [data-action="details"]').click();
    assert.match(await page.locator('#cp-user-bulk .subdialog').innerText(),/\[Error 4999\] Department user limit reached/);
    assert.doesNotMatch(await page.locator('#cp-user-bulk .subdialog').innerText(),/Easy1234|fixture-secret/);
    assert.equal(state.users.size,0);assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1);
    await page.locator('#cp-user-bulk [data-action="dismiss"]').first().click();state.rejectAddError='';
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.startsWith('All users configured'));
    assert.equal(state.users.size,1);assert.equal(state.devices.size,2);assert.equal(state.badTokens,0);
    assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,2,'only the explicit retry may repeat a rejected Add');
  }finally{await browser.close();}
});

test('Choose number opens during loading and remains anchored after a slow lookup in a scrolled batch',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const state=await fixture(page,{fullSkin:true,numberSearchGate:gate});
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="dept"]');
    await page.locator('#cp-user-bulk [data-action="paste"]').click();
    await page.locator('#cp-user-bulk textarea').fill(Array.from({length:24},(_,i)=>`Alex\tPerson${i}\tperson${i}@example.test\tCorporate 44`).join('\n'));
    await page.locator('#cp-user-bulk [data-action="import"]').click();
    await page.locator('#cp-user-bulk [data-pick]').last().click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk').getAttribute('aria-busy')==='true');
    await page.locator('#cp-user-bulk .picker').waitFor({state:'visible',timeout:1500});
    assert.match(await page.locator('#cp-user-bulk .picker').innerText(),/Loading/);
    await page.evaluate(()=>{window.bulkTableBeforeLookup=document.querySelector('#cp-user-bulk .users-table');window.bulkScrollBeforeLookup=document.querySelector('#cp-user-bulk').scrollTop;});
    await page.locator('#cp-user-bulk .picker input').fill('0102');release();
    await page.locator('#cp-user-bulk [data-number="3125550102"]').waitFor();
    const bounds=await page.evaluate(()=>{
      const root=document.querySelector('#cp-user-bulk'),p=root.querySelector('.picker').getBoundingClientRect();
      return {same:bulkTableBeforeLookup===root.querySelector('.users-table'),delta:Math.abs(root.scrollTop-bulkScrollBeforeLookup),visible:p.top>=0&&p.bottom<=innerHeight&&p.left>=0&&p.right<=innerWidth};
    });
    assert.equal(bounds.same,true,'loading must not rebuild the form and discard the dropdown');
    assert.ok(bounds.delta<2,'lookup completion must preserve the scrolled row');assert.ok(bounds.visible,'the dropdown must stay in the viewport');
    await page.screenshot({path:path.join(root,'dev-preview/bulk-user-designs/number-picker-scrolled.png')});
    assert.deepEqual(await page.locator('#cp-user-bulk [data-number]').evaluateAll(nodes=>nodes.map(n=>n.dataset.number)),['3125550102']);
    await page.locator('#cp-user-bulk [data-number="3125550102"]').click();
    assert.equal(await page.locator('#cp-user-bulk [data-pick]').last().innerText(),'+1 312-555-0102');
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
  } finally {release();await browser.close();}
});

test('a failed number lookup stays visible in the picker and can be retried without a second Choose click',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page);state.failNumberSearch=true;
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="dept"]');
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
    await page.locator('#cp-user-bulk [data-pick]').click();
    await page.locator('#cp-user-bulk .picker [role="alert"]').waitFor({state:'visible',timeout:3000});
    assert.equal(await page.locator('#cp-user-bulk .picker').isVisible(),true);
    state.failNumberSearch=false;
    await page.locator('#cp-user-bulk [data-action="retry-picker"]').click();
    await page.locator('#cp-user-bulk [data-number="3125550101"]').waitFor();
    assert.equal(state.badTokens,0);assert.equal(state.users.size,0);
  }finally{await browser.close();}
});

test('closing a pending picker does not reopen it; reopening uses the completed department pool',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  try {
    const page=await browser.newPage();const state=await fixture(page,{numberSearchGate:gate});
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="dept"]');
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
    await page.locator('#cp-user-bulk [data-pick]').click();
    await page.locator('#cp-user-bulk .picker').waitFor();
    await page.locator('#cp-user-bulk [data-action="hide-picker"]').click();release();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('#cp-user-bulk .picker').isVisible(),false);
    const count=state.requests.length;
    await page.locator('#cp-user-bulk [data-pick]').click();
    await page.locator('#cp-user-bulk [data-number="3125550101"]').waitFor();
    assert.equal(state.requests.length,count,'reopening the same department must not reload native pages');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cp-user-bulk .picker').isVisible(),false);
    assert.equal(await page.locator('#cp-user-bulk [data-pick]').getAttribute('aria-expanded'),'false');
    assert.equal(state.badTokens,0);assert.equal(state.users.size,0);
  }finally{release();await browser.close();}
});

test('number picker resolves encoded departments and only offers blank User IDs across all native pages',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();
    const numberRows=[
      {phone:'+1-3125550101',dept:'AliveRisk - Carmel',user:'occupied@phonenetwork.net',active:'✓'},
      {phone:'+1-3125550102',dept:'AliveRisk - Carmel',user:'',active:''},
      {phone:'+1-3125550103 - +1-3125550106',dept:'AliveRisk - Carmel',user:'',active:'✓'},
      {phone:'+1-3125550105',dept:'AliveRisk - Carmel',user:'other-user@phonenetwork.net',active:'✓'},
      {phone:'+1-3125550107',dept:'AliveRisk - Carmel',user:'\u00a0',active:'✓'},
      {phone:'+1-3125559990',dept:'Corporate 44',user:'',active:'✓'}
    ];
    const state=await fixture(page,{fullSkin:true,numberRows,numberPageSize:2});
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="dept"]');
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'AliveRisk - Carmel'});
    await page.locator('#cp-user-bulk [data-pick]').click();await page.waitForSelector('#cp-user-bulk [data-number]');
    assert.deepEqual(await page.locator('#cp-user-bulk [data-number]').evaluateAll(nodes=>nodes.map(n=>n.dataset.number)),
      ['3125550102','3125550103','3125550104','3125550106','3125550107']);
    const query=state.requests.find(r=>r.path===R.numbers&&r.params.search);
    assert.equal(query.params.findKey0,'ExactDnDepartment');
    assert.equal(query.params.findValue0,'G+Trifecta Solutions+RSG+AliveRisk - Carmel');
    assert.equal(state.requests.filter(r=>r.path==='/commpilot/Common/page.jsp').length,2,'availability must include every result page');
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0,'loading numbers must be read-only');
    await page.locator('#cp-user-bulk .picker input').fill('0104');
    assert.deepEqual(await page.locator('#cp-user-bulk [data-number]').evaluateAll(nodes=>nodes.map(n=>n.dataset.number)),['3125550104']);
    await page.locator('#cp-user-bulk [data-action="hide-picker"]').click();
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
    await page.locator('#cp-user-bulk [data-pick]').click();await page.waitForSelector('#cp-user-bulk [data-number="3125559990"]');
    assert.equal(await page.locator('#cp-user-bulk [data-number]').count(),1,'another department must not leak into the picker');
    await page.locator('#cp-user-bulk [data-action="hide-picker"]').click();
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'AliveRisk - Carmel'});
    await page.locator('#cp-user-bulk [data-pick]').click();await page.locator('#cp-user-bulk [data-number="3125550102"]').click();
    for(const [key,val]of [['first','Alex'],['last','Morgan'],['email','alex@example.test']])await page.locator(`#cp-user-bulk [data-field="${key}"]`).fill(val);
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.getByRole('textbox',{name:'SIP password for AliveRisk - Carmel',exact:true}).fill('fixture-only');
    numberRows[1].user='new-assignment@phonenetwork.net';
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.includes('no longer available'));
    assert.equal(state.users.size,0);assert.equal(state.badTokens,0);
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0,'a number assigned after selection must block creation');
  }finally{await browser.close();}
});

test('number parsing handles compact headings with native spacer cells and refuses a missing User ID column',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    for(const numberHeaderMode of ['compact','missing-user']) {
      const page=await browser.newPage();
      const state=await fixture(page,{numberHeaderMode,numberRows:[
        {phone:'+1-3125550101',user:'occupied@phonenetwork.net',dept:'Corporate 44'},
        {phone:'+1-3125550102',user:'',dept:'Corporate 44'}]});
      await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="dept"]');
      await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
      await page.locator('#cp-user-bulk [data-pick]').click();
      if(numberHeaderMode==='compact') {
        await page.locator('#cp-user-bulk [data-number="3125550102"]').waitFor({timeout:5000});
        assert.deepEqual(await page.locator('#cp-user-bulk [data-number]').evaluateAll(nodes=>nodes.map(n=>n.dataset.number)),['3125550102']);
      } else {
        await page.locator('#cp-user-bulk .picker [role="alert"]').waitFor({timeout:5000});
        assert.match(await page.locator('#cp-user-bulk .picker [role="alert"]').innerText(),/table structure changed/);
        assert.equal(await page.locator('#cp-user-bulk [data-number]').count(),0,'unverifiable User ID columns cannot be treated as blank');
      }
      assert.equal(state.badTokens,0);assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
      await page.close();
    }
  }finally{await browser.close();}
});

test('an incomplete number search never exposes a partial availability pool',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{numberPageSize:1,failNumberPage:true});
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="dept"]');
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
    await page.locator('#cp-user-bulk [data-pick]').click();
    await page.locator('#cp-user-bulk .picker [role="alert"]').waitFor({timeout:5000});
    assert.match(await page.locator('#cp-user-bulk .picker [role="alert"]').innerText(),/complete search/);
    assert.equal(await page.locator('#cp-user-bulk [data-number]').count(),0);
    assert.equal(state.users.size,0);assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
  }finally{await browser.close();}
});

test('a profile-name conflict blocks the review before any creation',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page);
    state.devices.set('RSG VVX 50101','Trifecta PolycomVVX400');
    await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk [data-field="first"]');
    for(const [f,val]of [['first','Alex'],['last','Morgan'],['email','alex@example.test']])await page.locator(`#cp-user-bulk [data-field="${f}"]`).fill(val);
    await page.locator('#cp-user-bulk [data-field="dept"]').selectOption({label:'Corporate 44'});
    await page.locator('#cp-user-bulk [data-pick]').click();await page.locator('#cp-user-bulk [data-number="3125550101"]').click();
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.getByRole('textbox',{name:'SIP password for Corporate 44',exact:true}).fill('fixture-password');
    await page.locator('#cp-user-bulk [data-action="primary"]').click();
    await page.waitForFunction(()=>document.querySelector('#cp-user-bulk .notice')?.textContent.includes('already exists'));
    assert.equal(state.requests.filter(r=>r.params.ok||r.params.apply).length,0);
    assert.equal(state.users.size,0);
    assert.equal(await page.locator('#cp-user-bulk .review-table').count(),0);
  }finally{await browser.close();}
});

test('an uncertain save is not replayed; manual recovery reads the saved user before resuming',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();const state=await fixture(page,{failAuth:false});
    const result=await page.evaluate(async()=>{
      history.pushState(history.state,'',location.pathname+'?previous');
      history.pushState(history.state,'',location.pathname);
      const lease=await cpAcquireUserBulk(),engine=cpCreateRsgBulkEngine(lease);await engine.initialize();
      window.bulkTest={lease,engine,user:{first:'Alex',last:'Morgan',email:'alex@example.test',dept:'Corporate 44',number:'3125550101'}};
      const before=location.pathname;
      redirectPost('/commpilot/User/Authentication/',{});
      return {before,after:location.pathname};
    });
    assert.equal(result.before,result.after,'unrelated navigation cannot take over the bulk token');
    const requestCount=state.requests.length;
    await page.evaluate(()=>history.back());
    await page.waitForFunction(()=>location.pathname==='/commpilot/Group/Members/');
    assert.equal(state.requests.length,requestCount,'browser Back cannot change the server entity while the batch owns a form');
    state.dropNextSave=true;
    const failure=await page.evaluate(async()=>{try{await bulkTest.engine.step(bulkTest.user,0);return null;}catch(e){return e.message;}});
    assert.match(failure,/could not be confirmed/);
    assert.equal(state.users.size,1);
    assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1,'an uncertain Add must never be automatically replayed');
    assert.equal(await page.evaluate(()=>bulkTest.lease.needsRecovery),true);
    await page.evaluate(async()=>{await bulkTest.lease.recover();await bulkTest.engine.step(bulkTest.user,0);bulkTest.lease.release();});
    assert.equal(state.users.size,1);assert.equal(state.badTokens,0);
    assert.equal(state.requests.filter(r=>r.path===R.add&&r.params.ok).length,1,'recovery must use the existing saved user');
  }finally{await browser.close();}
});

test('bulk typography matches native controls and rows in Inter, Geist and Arial',async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1000}});await fixture(page);
    const props=['font-family','font-size','font-weight','font-style','line-height','letter-spacing'];
    const faces=['Inter','Geist'].map(name=>`@font-face{font-family:${name};font-weight:100 900;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(root,'assets/fonts',name+'Variable.woff2')).toString('base64')})}`).join('');
    await page.addStyleTag({content:faces+'html{--cp-font:Inter,sans-serif}body,body :not(#cp-font#cp-font#cp-font,svg,svg *){font-family:var(--cp-font)!important}'});
    for(const font of ['Inter','Geist','Arial']) {
      await page.evaluate(async font=>{
        document.documentElement.style.setProperty('--cp-font',font+',sans-serif');await document.fonts.load('13px '+font);await document.fonts.ready;
        const cell=document.querySelector('td[width="82%"]');cell.insertAdjacentHTML('beforeend','<div class="cp-frame-head"><span class="cp-frame-title">Native title</span><span class="cp-frame-actions"><input type="button" name="ok" value="OK"></span></div><table class="cp-frame-results"><tr id="RowReference"><td>Native row</td></tr></table>');
      },font);
      const expected=await page.evaluate(props=>{
        const c=document.querySelector('td[width="82%"]'),nodes={title:c.querySelector('.cp-frame-title'),input:c.querySelector('input[type="text"],select'),button:c.querySelector('.cp-frame-actions input'),row:c.querySelector('tr[id^="Row"]>td:last-child'),column:c.querySelector('.listHeader')};
        return Object.fromEntries(Object.entries(nodes).map(([k,n])=>[k,Object.fromEntries(props.map(p=>[p,getComputedStyle(n).getPropertyValue(p)]))]));
      },props);
      await page.locator('#cp-user-bulk-launch').click();await page.waitForSelector('#cp-user-bulk .users-table');
      const actual=await page.evaluate(props=>{
        const c=document.querySelector('#cp-user-bulk'),nodes={title:c.querySelector('h2'),input:c.querySelector('[data-field="first"]'),button:c.querySelector('[data-action="primary"]'),row:c.querySelector('tbody tr td:nth-child(7)'),column:c.querySelector('th')};
        return Object.fromEntries(Object.entries(nodes).map(([k,n])=>[k,Object.fromEntries(props.map(p=>[p,getComputedStyle(n).getPropertyValue(p)]))]));
      },props);
      assert.deepEqual(actual,expected,font+' must use the same native type measurements');
      await page.screenshot({path:path.join(root,'dev-preview/bulk-user-designs/implemented-b-'+font.toLowerCase()+'.png')});
      await page.locator('#cp-user-bulk [data-action="close"]').click();await page.waitForFunction(()=>!document.querySelector('#cp-user-bulk'));
    }
  }finally{await browser.close();}
});
