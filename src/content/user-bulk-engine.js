/* Provisioning through CommPilot's own forms, validation and PJAX transport. */
(function () {
  'use strict';
  if (window !== window.top) return;
  const routes = Object.freeze({ users:'/commpilot/Group/Members/', add:'/commpilot/Group/Members/Add/index.jsp',
    numbers:'/commpilot/Group/GroupDnManagement/index.jsp', profile:'/commpilot/User/Profile/',
    alternate:'/commpilot/User/AlternateUserIDs/', addresses:'/commpilot/User/Addresses/',
    auth:'/commpilot/User/Authentication/', sca:'/commpilot/User/SCAP/', scaAdd:'/commpilot/User/SCAP/Add/index.jsp',
    devices:'/commpilot/Group/DeviceInventory/', deviceAdd:'/commpilot/Group/DeviceInventory/Add/index.jsp',
    extensionRules:'/commpilot/Group/ExtensionMgmt/',
    passwordRules:'/commpilot/Common/Password_Rules/index.jsp?UserLevel=Group',
    passcodeRules:'/commpilot/Common/PasscodeRules/index.jsp?UserLevel=Group',
    vm:'/commpilot/User/VM/General/', portal:'/commpilot/User/Password/', imp:'/commpilot/User/IntegratedIMP/' });
  const types = { vvx:'Trifecta PolycomVVX400 (Reseller)', teams:'Trifecta Teams (Reseller)' };
  const text = s => String(s ?? '').replace(/\s+/g,' ').trim();
  const phone=window.CpBulkPhone, digits=phone.key;
  const form = () => document.querySelector('form[name="mainForm"]');
  function field(name, optional=false) {
    const el=[...(form()?.elements||[])].find(el=>el.name===name && !['submit','button'].includes(el.type));
    if (!el&&!optional) throw Error('CommPilot did not provide the '+name+' field. No save was sent.');
    return el;
  }
  function value(name) { const el=field(name,true); return el?.type==='radio'?
    [...form().elements].find(x=>x.name===name&&x.checked)?.value||'':el?.value||''; }
  function set(name, val) {
    let el=field(name);
    if (el.type==='radio') {
      el=[...form().elements].find(x=>x.name===name&&x.value===val);
      if (!el) throw Error('The required native '+name+' choice is unavailable.');
      if (el.matches(':disabled')) {
        if (el.checked) return;
        throw Error('CommPilot has locked the '+name+' field.');
      }
      el.click();
      // Native handlers can reject or rebuild a choice. Confirm the live group before a save-first
      // link (such as Voice Management Advanced Settings) can submit the remaining edited controls.
      if (value(name)!==val) throw Error('CommPilot changed the '+name+' value. Review this user.');
      return;
    }
    if (el.matches(':disabled') || el.readOnly) {
      if (el.value===val) return;
      throw Error('CommPilot has locked the '+name+' field.');
    }
    if (el.tagName==='SELECT' && ![...el.options].some(o=>o.value===val&&!o.matches(':disabled'))) throw Error('The required '+name+' option is unavailable.');
    if (el.maxLength>0 && String(val).length>el.maxLength) throw Error(name+' exceeds the native field length.');
    el.value=val;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    // Native Addresses/SCA controls commit to their hidden submission fields on
    // blur (setLinePort), not input/change. Commit like leaving the edited field
    // before running native validation; do not write hidden payloads ourselves.
    el.dispatchEvent(new FocusEvent('blur'));
    if (el.value!==val) throw Error('CommPilot changed the '+name+' value. Review this user.');
  }
  function option(name, label) {
    const matches=[...field(name).options].filter(o=>text(o.textContent)===label&&!o.matches(':disabled'));
    if (matches.length!==1) throw Error('Expected one native option: '+label+'.');
    set(name,matches[0].value);
  }
  function errors() {
    return [...new Set([...document.querySelectorAll('td[width="82%"] :is(.errorMessage,.error-message,.errorMsg,.Failure,.error,.cp-alert-error,.cp-upload-notice)')]
      .filter(e=>!e.closest('[hidden]')).map(cellText).filter(Boolean))].join(' ');
  }
  function requireSaved() { const message=errors();if(message)throw Error('CommPilot rejected this step: '+message); }
  function requireNativeFields(nativeForm) {
    const missing=[];
    for(const el of nativeForm.elements) {
      if(!el.name||el.matches(':disabled')||['hidden','button','submit','reset'].includes(el.type))continue;
      const cell=el.closest('td'),siblings=cell?[...cell.parentElement.children].filter(e=>e.tagName==='TD'):[];
      const previous=cell?siblings[siblings.indexOf(cell)-1]:null;
      const groupLabel=el.closest('.fx-item')?.querySelector('.fx-label');
      const ownsGroupLabel=groupLabel&&(!groupLabel.htmlFor||groupLabel.htmlFor===el.id);
      const firstInCell=cell?.querySelector('input:not([type="hidden"]):not([type="button"]):not([type="submit"]),select,textarea');
      // A Line/Port label belongs to its text box, not the adjacent optional
      // domain select. Only inherit a shared label for its own/first control.
      const label=[...(el.labels||[])].map(cellText).join(' ')||
        cellText((ownsGroupLabel?groupLabel:firstInCell===el?previous:null)||document.createElement('span'));
      if(!el.required&&el.getAttribute('aria-required')!=='true'&&!label.includes('*'))continue;
      // Native searchable selects can be visually hidden behind their trigger.
      // Hidden IP/trunking rows stay excluded; their required markers are conditional.
      const visible=el.closest('.bw-select-shell')||el;
      if(!visible.getClientRects().length||getComputedStyle(visible).visibility==='hidden'||visible.closest('[hidden]'))continue;
      const filled=el.type==='radio'?[...nativeForm.elements].some(e=>e.name===el.name&&e.checked):
        el.type==='checkbox'?el.checked:String(el.value||'').trim();
      if(!filled)missing.push((label||el.name).replace(/\*/g,'').replace(/:\s*$/,'').trim());
    }
    if(missing.length)throw Error('Required CommPilot fields are empty: '+[...new Set(missing)].join(', ')+'. No save was sent.');
  }
  function equal(actual, expected, label) { if (actual!==expected) throw Error(label+' did not match the saved configuration.'); }
  function cellText(cell) {
    // Raw CommPilot cells contain inline event-wiring scripts, even when the
    // displayed User ID is blank. Never treat that source text as an assignment.
    const copy=cell.cloneNode(true);
    copy.querySelectorAll('script,style,template').forEach(n=>n.remove());
    return text(copy.textContent);
  }
  function spacerCell(cell) {
    return !cellText(cell)&&!cell.querySelector('a.tableLink')&&
      (cell.getAttribute('data-cp-column')==='spacer'||['0','20'].includes(cell.getAttribute('width')));
  }
  function nativeRows(doc) {
    const rows=[...doc.querySelectorAll('tr[id^="Row"]')];
    return rows.map(row=>{
      const table=row.closest('table'), header=[...(table?.rows||[])].find(r=>
        [...r.cells].some(c=>c.matches('.listHeader,.listSortHeader')||c.querySelector('a.listSortHeader')));
      if (!header) throw Error('CommPilot did not provide number column headings.');
      // HTMLTableRowElement.cells excludes direct SCRIPT children. Keep real
      // empty cells: filtering by nonempty text would shift the User ID column.
      let headings=[...header.cells], cells=[...row.cells];
      if(headings.length!==cells.length) {
        headings=headings.filter(c=>!spacerCell(c));
        cells=cells.filter(c=>!spacerCell(c));
      }
      const labels=headings.map(c=>cellText(c).toLowerCase());
      const get=pattern=>{
        const indexes=labels.flatMap((label,i)=>pattern.test(label)?[i]:[]);
        return indexes.length===1?cells[indexes[0]]:null;
      };
      const phone=get(/phone number/), user=get(/^user id$/), dept=get(/^department$/);
      if (!phone||!user||!dept||cells.length!==labels.length) throw Error('The native Numbers table structure changed.');
      // Keep the blank User ID cell in its original column. Activation is separate from assignment.
      return { phone:cellText(phone), user:cellText(user), dept:cellText(dept) };
    });
  }
  function expandPhone(s) {
    return phone.expand(s);
  }
  window.cpCreateRsgBulkEngine = function (lease, options={}) {
    let domain='', departments=[], available=new Map();
    const internationalNumbers=new Map();
    const callerNumber=u=>phone.caller(u.number,internationalNumbers.get(u.dept)?.has(u.number));
    const model=window.CpBulkModel;
    let info=null;
    const uid=u=>u.plan?.localId??phone.localId(u.number);
    const ext=u=>u.plan?.extension??u.number.slice(-5);
    const profile=(u,kind)=>u.plan?.profiles.find(p=>p.kind===kind)||
      {name:'RSG '+(kind==='vvx'?'VVX ':'Teams ')+ext(u),type:types[kind],line:uid(u)+(kind==='teams'?'_Teams':'')};
    const entries=new Map();
    let diagnosticListener=null;
    const nativePath=()=>new URL(document.documentElement.getAttribute('data-cp-path')||location.href,location.href).pathname;
    function diagnostics(){
      // Deliberate allowlist: never include passwords, tokens, form payloads or HTML.
      const names=['name','domain','firstName','lastName','deptEncodedKey','phoneNumber','extension','deviceChoice',
        'deviceName','newDeviceName','newDeviceType','deviceLinePortDomain','deviceDomain','linePort',
        'vm_active','vm_storage','active','activeEndpoint','allowOrigination','allowTermination'];
      return {page:nativePath(),fields:names.filter(n=>field(n,true)).map(n=>({name:n,value:value(n),
        disabled:field(n).matches(':disabled'),readOnly:!!field(n).readOnly})),needsRecovery:!!lease.needsRecovery};
    }
    async function traced(operation,target,action){
      const started=Date.now();
      const emit=(status,extra={})=>{try{diagnosticListener?.({operation,target,status,...extra});}catch(_){};};
      emit('started',{page:nativePath()});
      try{const result=await action();emit('confirmed',{durationMs:Date.now()-started,page:nativePath()});return result;}
      catch(e){emit('failed',{durationMs:Date.now()-started,message:e.message,...diagnostics(),transport:e.bulkDiagnostic});throw e;}
    }
    async function go(url,params) {
      await traced('navigation',new URL(url,location.href).pathname,async()=>{
        await lease.navigate(url,params); requireSaved();
        if(info)assertScope(info.scope);
      });
    }
    function readScope() {
      const trail=[...document.querySelectorAll('.headerAuthLevelLink,span.headerAuthLevel')]
        .map(e=>text(e.textContent).replace(/^:\s*/, '')).filter(s=>s&&s!=='Users');
      // CommPilot's native ancestry displays entity IDs, not the editable Group Name.
      // This is the same SP>%Group key used by its native breadcrumb navigation.
      if(trail[0]==='Reseller'&&trail[1]&&trail[2])
        return {pbxOrigin:location.origin,serviceProviderId:trail[1],groupId:trail[2]};
      const context=history.state?.cpNav?.params;
      const key=context?.key||context?.P_key;
      if(key&&key.split('>%').length>=2){
        const [serviceProviderId,groupId]=key.split('>%');return {pbxOrigin:location.origin,serviceProviderId,groupId};
      }
      throw Error('The service provider and stable group ID could not be verified. Open this group from the Groups list.');
    }
    function assertScope(scope) {
      const current=readScope();
      if(model.scopeKey(current)!==model.scopeKey(scope))throw Error('CommPilot changed the group context. No further saves were sent.');
    }
    async function save(check=()=>{}) {
      return traced('save',nativePath(),async()=>{
      requireSaved();
      check();
      requireNativeFields(form());
      const button=form()?.querySelector('[name="apply"], [name="ok"]');
      if (!button||button.matches(':disabled')) throw Error('The native save button is unavailable.');
      await lease.action(()=>{
        const nativeForm=button.form;let failure=null,validated=false;
        // PJAX captures submit on document and stops the native form listeners.
        // Validate at window capture, after the button sets its native action and
        // before PJAX serializes. Keep CommPilot's own normalization/defaults.
        const validate=event=>{
          if(event.target!==nativeForm||validated)return;
          validated=true;
          try {
            check();
            requireNativeFields(nativeForm);
            if(typeof window.validateForm!=='function')
              throw Error('The native form validator is unavailable.');
            // CommPilot's own submit handler rejects every falsy result,
            // including undefined; match that contract before serialization.
            if(!window.validateForm(nativeForm))
              failure=Error(errors()||'CommPilot form validation failed. No save was sent.');
            if(!failure){check();requireNativeFields(nativeForm);}
          } catch(e) {failure=Error('CommPilot form validation failed. No save was sent. '+(e?.message||''));}
          if(failure){event.preventDefault();event.stopImmediatePropagation();}
        };
        window.addEventListener('submit',validate,true);
        try {button.click();if(failure)throw failure;}
        finally {window.removeEventListener('submit',validate,true);}
      });
      requireSaved();
      });
    }
    async function search(label, term, operator=/equal to/i) {
      const select=field('findKey0');
      const match=[...select.options].find(o=>text(o.textContent)===label);
      if (!match) throw Error('Native search does not support '+label+'.');
      set('findKey0',match.value);
      const op=[...field('findOp0').options].find(o=>operator.test(o.textContent));
      if (!op) throw Error('Native exact-match search is unavailable.');
      let query=term;
      const nativeValue=field('findValue0');
      if (nativeValue.tagName==='SELECT') {
        const choices=[...nativeValue.options].filter(o=>!o.disabled&&
          (o.value===term||text(o.textContent)===term));
        if (choices.length!==1) throw Error(label+' is not available as a unique native search option.');
        query=choices[0].value;
      }
      // These are server-backed findKey0 lists, even when the native results table has no ID.
      // Explicit context avoids the legacy numeric-column/client-list shortcut in cpListSearch.
      const ctx={landing:new URL(form().getAttribute('action')||location.href,location.href).href,
        baseParams:Object.fromEntries(new FormData(form()))};
      let pages=0, raw=[];
      const result=await traced('search',nativePath(),()=>lease.search([{key:match.value,op:op.value,value:query}],{ctx,onDoc:doc=>{pages++;raw.push(doc);}}));
      if (result.tooMany || result.totalPages>500 || (pages && pages!==result.totalPages))
        throw Error('CommPilot did not return the complete search. No creation was attempted.');
      return {...result,raw};
    }
    async function findUser(u) {
      await go(routes.users);
      const result=await search('User ID',uid(u)+'@'+(u.plan?.domain||domain));
      // The exact, domain-qualified search can return the local ID when this is
      // the system's default domain. Match the User ID column, not another cell.
      const column=result.headers.findIndex(h=>text(h)==='User ID');
      if(column<0)throw Error('CommPilot did not provide the User ID column.');
      const found=result.rows.filter(r=>[uid(u),uid(u)+'@'+(u.plan?.domain||domain)].includes(text(r.cells[column])));
      if (found.length>1) throw Error('Several users matched this ID.');
      return found[0]||null;
    }
    async function openUser(u) {
      const row=entries.get(uid(u))||await findUser(u);
      if (!row?.drill || !/\/Group\/Members\/Modify\//.test(row.drill.url)) throw Error('The expected user could not be opened.');
      entries.set(uid(u),row);
      await go(row.drill.url,row.drill.params);
      await go(routes.profile);
      equal(value('unicodeFirstName'),u.first,'First name'); equal(value('unicodeLastName'),u.last,'Last name');
      equal(value('firstName'),u.first,'Calling Line ID First Name');
      equal(value('lastName'),u.last,'Calling Line ID Last Name');
      equal(value('email').toLowerCase(),u.email.toLowerCase(),'Email');
      if(u.plan&&u.savedCaller!==undefined&&field('clidPhone',true))
        equal(value('clidPhone'),u.savedCaller,'Calling Line ID number');
      const dept=field('deptEncodedKey');
      equal(text(dept.selectedOptions[0]?.textContent),u.dept,'Department');
    }
    async function loadNumbers(dept) {
      await go(routes.numbers);
      const unassignedDepartment=options.general&&departments.some(d=>d.name===dept&&d.key==='');
      const result=unassignedDepartment?await search('Phone Number','',/starts with/i):await search('Department',dept);
      const rows=result.raw.flatMap(nativeRows);
      // An empty server result is fine. Never interpret an unparsed nonempty result as an available number.
      if (result.rows.length&&!rows.length) throw Error('The number availability table could not be inspected.');
      // The whole-group None lookup also returns other departments' unassigned rows.
      // Only assigned rows and this department's unassigned rows change the pool.
      const isEligible=r=>!r.user&&(unassignedDepartment?!r.dept||/^none$/i.test(r.dept):r.dept===dept);
      for(const row of rows)if((row.user||isEligible(row))&&!expandPhone(row.phone).length)
        throw Error('CommPilot returned a phone number format that could not be read: '+row.phone+'. No numbers were marked available.');
      const assigned=new Set(rows.filter(r=>r.user).flatMap(r=>expandPhone(r.phone)));
      const eligible=rows.filter(isEligible);
      const pool=[...new Set(eligible.flatMap(r=>expandPhone(r.phone)))]
        .filter(number=>!assigned.has(number)).sort();
      // Remember native country context separately from the digits-only value.
      // A +45 number can contain ten digits too; it must never receive US +1.
      internationalNumbers.set(dept,new Set(eligible.map(r=>phone.expandEntry(r.phone)).flatMap(e=>e.international?e.numbers:[])));
      available.set(dept,pool); return pool;
    }
    async function profileExists(name) {
      await go(routes.devices);
      const result=await search('Identity/Device Profile Name',name);
      return result.rows.some(r=>text(r.cells[0])===name);
    }
    async function checkProfileType(u,kind) {
      await go(routes.devices);
      const {name,type}=profile(u,kind);
      const result=await search('Identity/Device Profile Name',name);
      const rows=result.rows.filter(r=>text(r.cells[0])===name);
      const clean=s=>text(s).replace(/\s*\((?:Reseller|System|Group)\)$/,'');
      if (rows.length!==1 || !rows[0].cells.some(c=>clean(c)===clean(type)))
        throw Error('The saved '+name+' device type could not be verified.');
      await openUser(u);
    }
    async function checkExtension(u) {
      await go(routes.users);
      const result=await search('Extension',ext(u));
      if (result.rows.length) throw Error('Extension '+ext(u)+' is already in use.');
    }
    const deviceLine=(u,kind)=>profile(u,kind).line;
    function requireExpected(expected) {
      for(const [name,wanted]of Object.entries(expected))
        if(value(name)!==wanted)throw Error('The native '+name+' field changed before saving. No save was sent.');
    }
    const matchesLine=(actual,expected)=>actual===expected||
      (actual.startsWith(expected+'@')&&/^[^@\s]+@[^@\s]+$/.test(actual));
    function lineFields() { return ['deviceLinePort','deviceLinePortDomain'].map(n=>field(n,true)).filter(e=>e&&!e.disabled); }
    function lineMatches(u,kind) {
      const fields=lineFields(),canonical=fields.find(e=>e.name==='deviceLinePort')||fields[0];
      return !!canonical&&matchesLine(canonical.value,deviceLine(u,kind));
    }
    function requireDeviceLine(u,kind) {
      const fields=lineFields();
      if(!fields.length||!fields.every(e=>matchesLine(e.value,deviceLine(u,kind))))
        throw Error('The '+(kind==='vvx'?'VVX':'Teams SCA')+' Line/Port must be '+deviceLine(u,kind)+'. No save was sent.');
      const submitted=field('linePort',true);
      if(submitted&&!matchesLine(submitted.value,deviceLine(u,kind)))
        throw Error('CommPilot did not commit the '+(kind==='vvx'?'VVX':'Teams SCA')+' Line/Port to its submission field. No save was sent.');
    }
    function requireNewDevice(u,kind) {
      requireDeviceLine(u,kind);
      requireExpected({deviceName:'New Device',newDeviceName:profile(u,kind).name});
      if(text(field('newDeviceType').selectedOptions[0]?.textContent)!==profile(u,kind).type)
        throw Error('The native '+(kind==='vvx'?'VVX':'Teams')+' device type changed before saving. No save was sent.');
      if(field('macAddress',true)&&value('macAddress')!=='')throw Error('MAC address must be blank for this setup. No save was sent.');
      if(kind==='vvx') {
        if(digits(value('phoneNumber'))!==u.number||value('extension')!==ext(u)||value('deviceChoice')!=='Device Profile')
          throw Error('The native phone number, extension or primary device choice changed before saving. No save was sent.');
      } else for(const name of ['activeEndpoint','allowOrigination','allowTermination'])
        if(!field(name).checked)throw Error('The Teams '+name+' setting is off. No save was sent.');
    }
    function deviceMatches(u,kind) {
      const chosen=field('deviceName',true);
      const name=profile(u,kind).name;
      if(kind!=='vvx'&&!chosen&&!lineFields().length) {
        // SCA Modify is a read-only identity summary, unlike SCA Add/Addresses.
        // The form skinner moves native values into labelled fact blocks.
        const summary=label=>{
          const facts=[...form().querySelectorAll('.fx-fact')].filter(e=>text(e.querySelector('.fx-fact-k')?.textContent)===label);
          const fact=facts.length===1?facts[0].querySelector('.fx-fact-v'):null;
          if(fact)return cellText(fact);
          const labels=[...form().querySelectorAll('td')].filter(e=>cellText(e)===label+':');
          if(labels.length!==1)return '';
          const cells=[...labels[0].parentElement.cells],next=cells[cells.indexOf(labels[0])+1];
          return next?cellText(next):'';
        };
        const savedName=summary('Identity/Device Profile Name'),savedLine=summary('Line/Port');
        return (savedName===name||savedName===name+' (Group)')&&matchesLine(savedLine,deviceLine(u,kind));
      }
      const label=text(chosen?.selectedOptions?.[0]?.textContent||chosen?.value);
      return (label===name||label===name+' (Group)')&&lineMatches(u,kind);
    }
    function configureDevice(u,kind) {
      if (kind==='vvx') set('deviceChoice','Device Profile');
      const choices=[...field('deviceName').options].filter(o=>o.value==='New Device' && /group/i.test(o.textContent));
      if (choices.length!==1) throw Error('The native new Group device choice is unavailable.');
      set('deviceName',choices[0].value);
      set('newDeviceName',profile(u,kind).name);
      option('newDeviceType',profile(u,kind).type);
      if (field('macAddress',true)) set('macAddress','');
      // Native blur handlers copy these controls into hidden linePort, which
      // the validator/server actually use. Leave deviceDomain unchanged.
      const fields=lineFields();
      if(!fields.length)throw Error('The native Line/Port field is unavailable. No save was sent.');
      for(const e of fields)set(e.name,deviceLine(u,kind));
      requireDeviceLine(u,kind);
    }
    function refuseExistingDevice(u,kind) {
      const name=profile(u,kind).name;
      if ([...field('deviceName').options].some(o=>text(o.textContent)===name+' (Group)'||text(o.textContent)===name))
        throw Error(name+' already exists but is not assigned as expected. Review it before retrying.');
    }
    async function checkAddresses(u,loaded=false) {
      if (!loaded) await go(routes.addresses);
      equal(digits(value('phoneNumber')),u.number,'Phone number');
      equal(value('extension'),ext(u),'Extension');
      if(u.plan&&!u.plan.profiles.some(p=>p.kind==='vvx')){
        if(value('deviceChoice')!=='None')throw Error('An unexpected primary device or trunk is assigned.');
        return;
      }
      if (value('deviceChoice')!=='Device Profile'||!deviceMatches(u,'vvx')) throw Error('The saved primary VVX configuration did not match.');
      await checkProfileType(u,'vvx');
    }
    async function scaRow(u,kind='teams') {
      await go(routes.sca);
      const result=await lease.search([],{});
      if (result.tooMany || result.totalPages>1) throw Error('The complete SCA list could not be verified.');
      const name=profile(u,kind).name;
      if(u.plan)u.existingWebex=result.rows.some(r=>r.cells.some(c=>/^(?:Connect - Mobile|Business Communicator - PC)(?:\s*\((?:System|Group)\))?$/.test(text(c))));
      const rows=result.rows.filter(r=>r.cells.some(c=>text(c)===name||text(c)===name+' (Group)'));
      if (rows.length>1) throw Error('Duplicate '+name+' appearances need review.');
      if (!rows.length) return null;
      // Native SCA tables truncate long Line/Ports with "...". Open the unique
      // profile's Modify page and verify its full identity summary instead.
      if (!rows[0].drill) throw Error('The '+name+' appearance cannot be opened for verification.');
      return rows[0];
    }
    async function checkTeams(u,kind='teams') {
      const row=await scaRow(u,kind);
      if (!row) throw Error('The Teams appearance is missing.');
      await go(row.drill.url,row.drill.params);
      if (!deviceMatches(u,kind)) throw Error('The '+profile(u,kind).name+' profile or line/port did not match.');
      for (const name of ['activeEndpoint','allowOrigination','allowTermination'])
        if (!field(name).checked) throw Error('The saved Teams '+name+' setting is off.');
      if(field('useHotline',true)?.checked)throw Error('The saved appearance has Use Hotline enabled.');
      await checkProfileType(u,kind);
    }
    function policyValues() {
      return Object.fromEntries([...form().elements].filter(e=>e.name&&!['hidden','password','submit','button'].includes(e.type)&&
        (e.type!=='radio'||e.checked)).map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));
    }
    async function initializeGroup() {
      const scope=readScope();
      const loadedSample=[...document.querySelectorAll('tr[id^="Row"]')].slice(0,5).map(row=>{
        const cells=[...row.cells].filter(c=>!spacerCell(c)).map(cellText);
        return {id:cells[0],phone:cells[3],extension:cells[4]};
      });
      info={scope,sample:[],highest:null};
      await go(routes.extensionRules);
      info.limits={min:Number(value('groupExtMinLength')),max:Number(value('groupExtMaxLength')),default:Number(value('groupExtDefaultLength'))};
      if(!Object.values(info.limits).every(n=>Number.isSafeInteger(n)&&n>0)||
        info.limits.max<info.limits.min||info.limits.default<info.limits.min||info.limits.default>info.limits.max)
        throw Error('The group Extension Dialing limits could not be read.');
      await go(routes.passwordRules);info.password=policyValues();
      if(!info.password.minimumLength)throw Error('The group Password Rules could not be read.');
      await go(routes.passcodeRules);info.passcode=policyValues();
      if(!info.passcode.minLen||!info.passcode.maxLen)throw Error('The effective group Passcode Rules could not be read.');
      await go(routes.add);
      info.domains=[...field('domain').options].filter(o=>o.value&&!o.matches(':disabled')).map(o=>o.value);
      domain=value('domain');if(!info.domains.includes(domain))throw Error('Choose a valid native User ID domain first.');
      departments=[...field('deptEncodedKey').options].filter(o=>!o.matches(':disabled')&&text(o.textContent))
        .map(o=>({name:text(o.textContent),key:o.value}));
      if(!departments.length||new Set(departments.map(d=>d.name)).size!==departments.length)throw Error('Unique native departments are required.');
      info.domain=domain;info.departments=departments;
      const caller=field('clidPhone',true);
      info.caller={locked:!caller||caller.matches(':disabled')||caller.readOnly,value:caller?.value||''};
      await go(routes.deviceAdd);
      info.deviceTypes=[...field('deviceType').options].filter(o=>o.value&&!o.matches(':disabled')).map(o=>text(o.textContent));
      await go(routes.users);
      if(scope.groupId==='RSG')info.sample=loadedSample;
      else {
        const result=await search('User ID','',/starts with/i);
        const id=result.headers.findIndex(h=>text(h)==='User ID'),extension=result.headers.findIndex(h=>text(h)==='Extension'),phone=result.headers.findIndex(h=>text(h)==='Phone Number');
        if(id<0||extension<0)throw Error('The complete group user list did not include User ID and Extension columns.');
        const rows=result.rows.map(r=>({id:text(r.cells[id]),extension:text(r.cells[extension]),phone:text(r.cells[phone])}));
        info.sample=rows.slice(0,5);
        const extensions=rows.map(r=>r.extension).filter(e=>/^\d+$/.test(e));
        info.highest=extensions.length?extensions.reduce((a,b)=>BigInt(a)>BigInt(b)?a:b):null;
        info.existingExtensions=extensions;
      }
      return info;
    }
    async function preflightGroup(users,config,credentials,report=()=>{}) {
      if(!info)throw Error('Load this group’s setup first.');
      const ids=new Set(),extensions=new Set(),numbers=new Set(),emails=new Set(),names=new Set();
      for(const u of users){
        const problems=model.validate(u,config,info);
        if(problems.length)throw Error((u.first||'User')+': '+problems.join(' '));
        u.plan=model.resolve(u,config,info);
        u.number=u.plan.number;
        for(const [seen,item,label]of [[ids,uid(u).toLowerCase()+'@'+u.plan.domain.toLowerCase(),'User ID'],[extensions,ext(u),'Extension'],[emails,u.email.toLowerCase(),'Email']]){
          if(seen.has(item))throw Error('Duplicate '+label+' in this batch.');seen.add(item);
        }
        if(u.number){if(numbers.has(u.number))throw Error('Duplicate phone number in this batch.');numbers.add(u.number);}
        for(const p of u.plan.profiles){
          if(!info.deviceTypes.includes(p.type))throw Error('This group does not provide '+p.type+'. Review the selected profiles.');
          if(names.has(p.name.toLowerCase()))throw Error('Duplicate device profile name in this batch.');
          names.add(p.name.toLowerCase());
        }
        const web=credentials.web;
        const passwordProblems=model.passwordErrors(web,info.password,uid(u));
        if(passwordProblems.length)throw Error(passwordProblems.join(' '));
        if(!credentials.sip?.[u.dept])throw Error('Enter a SIP password for '+u.dept+'.');
        if(u.plan.voicemail&&!(u.mailboxPassword||credentials.mailbox))throw Error('Enter a mailbox password for '+u.first+'.');
        if(u.plan.profiles.some(p=>p.access)&&!(u.devicePassword||credentials.device))throw Error('Enter a Webex device-access password for '+u.first+'.');
        if(!info.caller.locked&&!info.caller.value&&!u.plan.caller&&!(u.plan.callerMode==='did'&&u.number))
          throw Error('The PBX caller ID is blank for '+u.first+'. Enter a caller ID number before creating this user.');
      }
      for(const dept of new Set(users.filter(u=>u.number).map(u=>u.dept)))await loadNumbers(dept);
      for(const u of users){
        report(u,'Checking identifiers, number availability and device names');
        if(u.number&&!available.get(u.dept)?.includes(u.number))throw Error('The selected number is no longer unassigned in '+u.dept+'.');
        if(await findUser(u))throw Error('User '+uid(u)+' already exists. No users were created.');
        await checkExtension(u);
        for(const p of u.plan.profiles)if(await profileExists(p.name))throw Error(p.name+' already exists. Resolve the conflict before creating.');
      }
    }
    async function advancedMailbox() {
      await go(routes.vm);
      await openAdvancedMailbox();
    }
    async function openAdvancedMailbox() {
      const links=[...form().querySelectorAll('a')].filter(a=>/^\s*Advanced Settings\b/.test(a.textContent));
      if(links.length!==1)throw Error('The native Voice Management Advanced Settings link is unavailable.');
      // This native handler validates, sets chkFlg=advanced and submits the current
      // form. PJAX follows the native response to General/Nested/index.jsp so
      // its mailbox validator and relative form action use the correct page.
      await traced('save and open advanced settings',nativePath(),()=>lease.action(()=>links[0].click()));
      requireSaved();assertScope(info.scope);field('mailserver');
    }
    function mailboxNames() {
      const server=value('mailserver');
      if(!['default','personal'].includes(server))throw Error('The native mailbox server selection is unavailable.');
      const suffix=server==='default'?'DefaultMS':'AlternateMS';
      return {email:'emailAddressOn'+suffix,id:'userIdOn'+suffix,fake:'fakePasswordOn'+suffix,password:'newPasswordOn'+suffix,changed:'passwordOn'+suffix+'Changed'};
    }
    function primaryImpId() {
      const candidates=[...form().querySelectorAll('select')].filter(e=>[...e.options].some(o=>/\(Primary\)/.test(o.textContent)));
      if(candidates.length===1){
        const selected=candidates[0].selectedOptions[0];
        if(!selected||!/\(Primary\)/.test(selected.textContent))throw Error('Review the PBX-selected primary IM&P ID.');
        return text(selected.textContent);
      }
      const content=cellText(form()),matches=content.match(/[^\s<>]+@[^\s<>]+\s*\(Primary\)/g)||[];
      if(matches.length!==1)throw Error('A PBX-selected primary IM&P ID is required. Review the native IM&P page.');
      return text(matches[0]);
    }
    async function secretSave(u,key,check) {
      if(u.uncertainSecret===key)throw Error('The previous '+key+' save is unconfirmed. Check it in CommPilot before acknowledging it in Details; it will not be submitted again automatically.');
      try{await save(check);}
      catch(e){if(lease.needsRecovery)u.uncertainSecret=key;throw e;}
      (u.secretReceipts||=new Set()).add(key);
    }
    async function openDeviceAccess(u,kind) {
      // Device Modify changes the PBX's server-side entity context. Restore the
      // user before opening an appearance, including consecutive readbacks.
      await openUser(u);
      const p=profile(u,kind),row=await scaRow(u,kind);
      if(!row)throw Error('Create '+p.name+' before configuring device access.');
      await go(row.drill.url,row.drill.params);
      if(!deviceMatches(u,kind))throw Error('The appearance does not match the selected profile.');
      const buttons=[...form().querySelectorAll('input[type=button],input[type=submit],button,a')]
        .filter(b=>/^\s*Configure Identity\/Device Profile\s*$/.test(b.value||b.textContent));
      if(buttons.length!==1)throw Error('The native Configure Identity/Device Profile action is unavailable.');
      await traced('open device profile',nativePath(),()=>lease.action(()=>buttons[0].click()));requireSaved();assertScope(info.scope);
      equal(value('deviceName'),p.name,'Device access profile');
      field('deviceUserName');field('credentialType');
    }
    async function deviceAccess(u,kind,credentials,verify=false) {
      const p=u.plan.profiles.find(p=>p.kind===kind&&p.access);
      if(!p)throw Error('This Webex device profile is not selected.');
      await openDeviceAccess(u,kind);
      if(!verify&&!u.secretReceipts?.has('access:'+kind)){
        const password=u.devicePassword||credentials.device;
        if(!password)throw Error('Enter the Webex device-access password.');
        set('credentialType','customCredentials');set('deviceUserName',p.username);
        set('devicePassword',password);set('devicePasswordConfirm',password);
        await secretSave(u,'access:'+kind,()=>requireExpected({deviceName:p.name,credentialType:'customCredentials',
          deviceUserName:p.username,devicePassword:password,devicePasswordConfirm:password,custom:'true',credentialsHaveChanged:'true'}));
        await openUser(u);await openDeviceAccess(u,kind);
      }
      equal(value('credentialType'),'customCredentials','Device access credential selection');
      equal(value('deviceUserName'),p.username,'Device access username');
    }
    async function stepGroup(u,key,credentials) {
      if(!u.plan)throw Error('Review and validate this user before creating.');
      if(key==='user')return api.step(u,0,credentials.web);
      // Unselected voicemail is not a request to alter the PBX's existing default.
      // Also guard stale workflow entries on retry before making any native request.
      if(['voicemail','mailbox','pin'].includes(key)&&!u.plan.voicemail)return;
      if(key==='alternate')return api.step(u,1);
      if(key.startsWith('access:'))return deviceAccess(u,key.slice(7),credentials);
      if(key==='pin'&&u.secretReceipts?.has(key))return;
      await openUser(u);
      if(key==='addresses'){
        await go(routes.addresses);
        const current=digits(value('phoneNumber'));
        if(current&&current!==u.number)throw Error('This user has a different assigned phone number.');
        const primary=u.plan.profiles.find(p=>p.kind==='vvx');
        const correctDevice=primary?deviceMatches(u,'vvx'):value('deviceChoice')==='None';
        if(current!==u.number||value('extension')!==ext(u)||!correctDevice){
          if(value('deviceChoice')!=='None'&&!correctDevice)throw Error('An existing primary device or trunk needs review.');
          const phone=[...field('phoneNumber').options].filter(o=>u.number?digits(o.value)===u.number:/^(?:None)?$/i.test(o.value));
          if(phone.length!==1)throw Error('The phone number / no-number choice is unavailable on Addresses.');
          set('phoneNumber',phone[0].value);set('extension',ext(u));
          if(primary&&!correctDevice){refuseExistingDevice(u,'vvx');configureDevice(u,'vvx');}
          await save(()=>{
            equal(digits(value('phoneNumber')),u.number,'Phone number');equal(value('extension'),ext(u),'Extension');
            if(primary&&!correctDevice)requireNewDevice(u,'vvx');
          });
        }
        // Some native Apply responses return the Profile board (particularly
        // extension-only users). Read Addresses again rather than treating that
        // board as an empty form or assuming the save response is the edit page.
        await checkAddresses(u);return;
      }
      if(key==='auth'){
        if(!credentials.sip?.[u.dept])throw Error('Enter the department SIP password.');
        await go(routes.auth);
        if(u.secretReceipts?.has(key)){equal(value('username'),uid(u),'SIP authentication username');return;}
        set('username',uid(u));
        set('newPassword',credentials.sip[u.dept]);set('newPasswordConfirm',credentials.sip[u.dept]);
        await secretSave(u,key,()=>requireExpected({username:uid(u),newPassword:credentials.sip[u.dept],newPasswordConfirm:credentials.sip[u.dept]}));
        await go(routes.auth);equal(value('username'),uid(u),'SIP authentication username');return;
      }
      if(key.startsWith('sca:')){
        const kind=key.slice(4);
        if(!u.plan.profiles.some(p=>p.kind===kind))throw Error('This appearance is not selected.');
        if(!await scaRow(u,kind)){
          await go(routes.scaAdd);refuseExistingDevice(u,kind);configureDevice(u,kind);
          for(const n of ['activeEndpoint','allowOrigination','allowTermination'])if(!field(n).checked)field(n).click();
          if(field('useHotline',true)?.checked)field('useHotline').click();
          await save(()=>requireNewDevice(u,kind));
        }
        await checkTeams(u,kind);return;
      }
      if(key==='voicemail'){
        await go(routes.vm);
        if(value('vm_active')!=='true'||value('vm_storage')!=='voicePortal'){
          set('vm_active','true');set('vm_storage','voicePortal');
          // The native save-first link postpones mailbox validation until its credentials are entered.
          await openAdvancedMailbox();
          await go(routes.vm);
        }
        equal(value('vm_active'),'true','Voice Management');return;
      }
      if(key==='mailbox'){
        await advancedMailbox();
        const n=mailboxNames(),password=u.mailboxPassword||credentials.mailbox;
        if(u.secretReceipts?.has(key)){equal(value(n.email),u.plan.mailbox,'Mailbox email');equal(value(n.id),u.plan.mailbox,'Mailbox User ID');return;}
        if(!password)throw Error('Enter the mailbox password.');
        set(n.email,u.plan.mailbox);set(n.id,u.plan.mailbox);set(n.fake,password);
        const expected={[n.email]:u.plan.mailbox,[n.id]:u.plan.mailbox,[n.password]:password,[n.changed]:'true'};
        await secretSave(u,key,()=>requireExpected(expected));
        await advancedMailbox();const saved=mailboxNames();
        equal(value(saved.email),u.plan.mailbox,'Mailbox email');equal(value(saved.id),u.plan.mailbox,'Mailbox User ID');return;
      }
      if(key==='pin'){
        if(u.secretReceipts?.has(key))return;
        const errors=model.pinErrors('54321',info.passcode,u.plan);if(errors.length)throw Error(errors.join(' '));
        await go(routes.portal);set('pwdType','VoicePortal');set('newPassword','54321');set('newPasswordConfirm','54321');
        await secretSave(u,key,()=>requireExpected({pwdType:'VoicePortal',newPassword:'54321',newPasswordConfirm:'54321'}));return;
      }
      if(key==='verify'){
        await go(routes.alternate);equal(value('alt1').toLowerCase(),u.email.toLowerCase(),'Alternate ID');
        await checkAddresses(u);await go(routes.auth);equal(value('username'),uid(u),'SIP authentication username');
        for(const p of u.plan.profiles.filter(p=>p.kind!=='vvx'))await checkTeams(u,p.kind);
        for(const p of u.plan.profiles.filter(p=>p.access))await deviceAccess(u,p.kind,credentials,true);
        if(u.plan.profiles.some(p=>p.access))await openUser(u);
        if(u.plan.voicemail){
          await go(routes.vm);equal(value('vm_active'),'true','Voice Management');equal(value('vm_storage'),'voicePortal','Voice message storage');
          await openAdvancedMailbox();const n=mailboxNames();equal(value(n.email),u.plan.mailbox,'Mailbox email');equal(value(n.id),u.plan.mailbox,'Mailbox User ID');
        }
        // The PIN and passwords cannot be read back. An acknowledged native save
        // is required; identifiers alone never prove that credentials were saved.
        for(const secret of ['auth',...u.plan.profiles.filter(p=>p.access).map(p=>'access:'+p.kind),...(u.plan.voicemail?['mailbox','pin']:[])])
          if(!u.secretReceipts?.has(secret))throw Error('The '+secret+' save still needs confirmation.');
        u.verified=true;return;
      }
      if(key==='imp'){
        if(!u.verified)throw Error('Verify all preceding setup before enabling Integrated IM&P.');
        await go(routes.sca);
        const list=await lease.search([],{});
        if(list.tooMany||list.totalPages>1)throw Error('The complete SCA list could not be verified.');
        const webex=u.plan.profiles.some(p=>p.access)||list.rows.some(r=>r.cells.some(c=>/^(?:Connect - Mobile|Business Communicator - PC)(?:\s*\((?:System|Group)\))?$/.test(text(c))));
        if(!webex)return;
        await go(routes.imp);const id=primaryImpId();
        if(value('active')!=='true'){set('active','true');await save(()=>{requireExpected({active:'true'});equal(primaryImpId(),id,'Primary IM&P ID');});}
        await go(routes.imp);equal(value('active'),'true','Integrated IM&P');equal(primaryImpId(),id,'Primary IM&P ID');return;
      }
      throw Error('Unknown provisioning step.');
    }
    const api={ routes, types, get domain(){return domain;}, get departments(){return departments;}, get info(){return info;},
      observeDiagnostics(listener){diagnosticListener=listener;}, diagnostics,
      async initialize() {
        if(options.general)return initializeGroup();
        if (![...document.querySelectorAll('.headerAuthLevelLink,.cp-bc-seg')].some(e=>text(e.textContent)==='RSG'))
          throw Error('Open the RSG group’s Users page to use this setup.');
        await go(routes.add);
        const domains=[...field('domain').options].filter(o=>o.value&&!o.matches(':disabled'));
        if (domains.length!==1) throw Error('Choose the group User ID domain in CommPilot first; multiple domains are not supported yet.');
        domain=domains[0].value;
        departments=[...field('deptEncodedKey').options].filter(o=>o.value&&!o.matches(':disabled')&&text(o.textContent)&&!/^none$/i.test(text(o.textContent)))
          .map(o=>({name:text(o.textContent),key:o.value}));
        if (!departments.length||new Set(departments.map(d=>d.name)).size!==departments.length) throw Error('Unique native departments are required.');
        await go(routes.users); return {domain,departments};
      }, loadNumbers,
      preflightGroup, stepGroup,
      async preflight(users,report=()=>{}) {
        for (const dept of new Set(users.map(u=>u.dept))) await loadNumbers(dept);
        for (const u of users) {
          report(u,'Checking number, User ID and device names');
          if (!available.get(u.dept)?.includes(u.number)) throw Error(u.number+' is no longer available in '+u.dept+'.');
          if (await findUser(u)) throw Error('User '+u.number+' already exists. No users were created.');
          await checkExtension(u);
          for (const kind of ['VVX','Teams']) if (await profileExists('RSG '+kind+' '+u.number.slice(-5)))
            throw Error('RSG '+kind+' '+u.number.slice(-5)+' already exists. Resolve the conflict before creating.');
        }
      },
      async step(u,index,password) {
        if (index===0) {
          const existing=await findUser(u);
          if (existing) { if (!u.createAttempted) throw Error('This User ID already exists; it was not created by this batch.'); await openUser(u); return; }
          if(u.number){
            const pool=await loadNumbers(u.dept);
            if (!pool.includes(u.number)) throw Error('The selected phone number is no longer available.');
          }
          await checkExtension(u);
          await go(routes.add);
          const userDomain=u.plan?.domain||domain,webPassword=u.plan?password:'Easy1234';
          if(!webPassword)throw Error('Enter the initial web access password.');
          set('name',uid(u));set('domain',userDomain);set('unicodeFirstName',u.first);set('unicodeLastName',u.last);
          // These are separate required fields. Native validation checks them;
          // it does not copy the display name into the Calling Line ID name.
          set('firstName',u.first);set('lastName',u.last);
          const caller=field('clidPhone',true);
          if(!u.plan)set('clidPhone',callerNumber(u));
          else if(caller&&!caller.matches(':disabled')&&!caller.readOnly){
            const desired=u.plan.caller||((u.plan.callerMode==='did'&&u.number)?callerNumber(u):caller.value);
            if(!desired)throw Error('The PBX caller ID is blank. Enter a caller ID number for this user before creating.');
            set('clidPhone',desired);
          }
          set('email',u.email);
          set('deptEncodedKey',departments.find(d=>d.name===u.dept).key);
          set('password',webPassword);set('echoPassword',webPassword);
          // Keep the native language/time zone and optional name-dialing defaults.
          const expected={name:uid(u),domain:userDomain,unicodeFirstName:u.first,unicodeLastName:u.last,firstName:u.first,lastName:u.last,
            email:u.email,deptEncodedKey:departments.find(d=>d.name===u.dept).key,password:webPassword,echoPassword:webPassword};
          if(caller)expected.clidPhone=caller.value;
          if(u.plan)u.savedCaller=caller?.value;
          u.createAttempted=true; await save(()=>requireExpected(expected)); await openUser(u); return;
        }
        await openUser(u);
        if (index===1) {
          await go(routes.alternate);
          const old=value('alt1'); if (old&&old.toLowerCase()!==u.email.toLowerCase()) throw Error('Alternate ID is already occupied.');
          if (!old) { set('alt1',u.email); await save(()=>requireExpected({alt1:u.email})); }
          await go(routes.alternate); equal(value('alt1').toLowerCase(),u.email.toLowerCase(),'Alternate ID');
        } else if (index===2) {
          await go(routes.addresses);
          if (!deviceMatches(u,'vvx')) {
            if (digits(value('phoneNumber')) && digits(value('phoneNumber'))!==u.number)
              throw Error('This user already has a different phone number.');
            if (value('deviceChoice')==='Device Profile') throw Error('An existing primary device needs review.');
            refuseExistingDevice(u,'vvx');
            const phone=[...field('phoneNumber').options].filter(o=>digits(o.value)===u.number);
            if (phone.length!==1) throw Error('The selected number is unavailable on Addresses.');
            set('phoneNumber',phone[0].value);set('extension',u.number.slice(-5));configureDevice(u,'vvx');await save(()=>requireNewDevice(u,'vvx'));
          }
          // Apply returns the current native Addresses form, so do not fetch its 17,000 options twice.
          await checkAddresses(u,!!field('phoneNumber',true));
        } else if (index===3) {
          if (!password) throw Error('Enter the department SIP password.');
          await go(routes.auth);set('username',uid(u));set('newPassword',password);set('newPasswordConfirm',password);
          await save(()=>requireExpected({username:uid(u),newPassword:password,newPasswordConfirm:password}));
          await go(routes.auth);equal(value('username'),uid(u),'SIP authentication username');
        } else if (index===4) {
          if (!await scaRow(u)) {
            await go(routes.scaAdd);refuseExistingDevice(u,'teams');configureDevice(u,'teams');
            for (const name of ['activeEndpoint','allowOrigination','allowTermination']) { const e=field(name);if (!e.checked) e.click(); }
            await save(()=>requireNewDevice(u,'teams'));
          }
          await checkTeams(u);
        } else if (index===5) {
          await go(routes.alternate);equal(value('alt1').toLowerCase(),u.email.toLowerCase(),'Alternate ID');
          await checkAddresses(u); await go(routes.auth);equal(value('username'),uid(u),'SIP authentication username');
          await checkTeams(u);
        }
      }
    };
    return api;
  };
  window.cpCreateBulkEngine=lease=>window.cpCreateRsgBulkEngine(lease,{general:true});
})();
