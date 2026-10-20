/* RSG provisioning through CommPilot's own forms, validation and PJAX transport. */
(function () {
  'use strict';
  if (window !== window.top) return;
  const routes = Object.freeze({ users:'/commpilot/Group/Members/', add:'/commpilot/Group/Members/Add/index.jsp',
    numbers:'/commpilot/Group/GroupDnManagement/index.jsp', profile:'/commpilot/User/Profile/',
    alternate:'/commpilot/User/AlternateUserIDs/', addresses:'/commpilot/User/Addresses/',
    auth:'/commpilot/User/Authentication/', sca:'/commpilot/User/SCAP/', scaAdd:'/commpilot/User/SCAP/Add/index.jsp',
    devices:'/commpilot/Group/DeviceInventory/' });
  const types = { vvx:'Trifecta PolycomVVX400 (Reseller)', teams:'Trifecta Teams (Reseller)' };
  const text = s => String(s ?? '').replace(/\s+/g,' ').trim();
  const digits = s => { const n=String(s??'').replace(/\D/g,''); return n.length===11&&n[0]==='1'?n.slice(1):n; };
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
      el.click(); return;
    }
    if (el.disabled || el.readOnly) {
      if (el.value===val) return;
      throw Error('CommPilot has locked the '+name+' field.');
    }
    if (el.tagName==='SELECT' && ![...el.options].some(o=>o.value===val)) throw Error('The required '+name+' option is unavailable.');
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
    const matches=[...field(name).options].filter(o=>text(o.textContent)===label&&!o.disabled);
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
      if(!el.name||el.disabled||['hidden','button','submit','reset'].includes(el.type))continue;
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
    const parts=s.split(/\s+-\s+/).map(digits);
    if (parts.some(p=>!/^\d{10}$/.test(p))||parts.length>2) return [];
    if (parts.length===1) return parts;
    const start=Number(parts[0]), end=Number(parts[1]);
    if (end<start||end-start>10000) throw Error('A number range is too large to inspect safely.');
    return Array.from({length:end-start+1},(_,i)=>String(start+i));
  }
  window.cpCreateRsgBulkEngine = function (lease) {
    let domain='', departments=[], available=new Map();
    const entries=new Map();
    async function go(url,params) { await lease.navigate(url,params); requireSaved(); }
    async function save(check=()=>{}) {
      requireSaved();
      check();
      requireNativeFields(form());
      const button=form()?.querySelector('[name="apply"], [name="ok"]');
      if (!button||button.disabled) throw Error('The native save button is unavailable.');
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
    }
    async function search(label, term) {
      const select=field('findKey0');
      const match=[...select.options].find(o=>text(o.textContent)===label);
      if (!match) throw Error('Native search does not support '+label+'.');
      set('findKey0',match.value);
      const op=[...field('findOp0').options].find(o=>/equal to/i.test(o.textContent));
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
      const result=await lease.search([{key:match.value,op:op.value,value:query}],{ctx,onDoc:doc=>{pages++;raw.push(doc);}});
      if (result.tooMany || result.totalPages>500 || (pages && pages!==result.totalPages))
        throw Error('CommPilot did not return the complete search. No creation was attempted.');
      return {...result,raw};
    }
    async function findUser(u) {
      await go(routes.users);
      const result=await search('User ID',u.number+'@'+domain);
      // The exact, domain-qualified search can return the local ID when this is
      // the system's default domain. Match the User ID column, not another cell.
      const column=result.headers.findIndex(h=>text(h)==='User ID');
      if(column<0)throw Error('CommPilot did not provide the User ID column.');
      const found=result.rows.filter(r=>[u.number,u.number+'@'+domain].includes(text(r.cells[column])));
      if (found.length>1) throw Error('Several users matched this ID.');
      return found[0]||null;
    }
    async function openUser(u) {
      const row=entries.get(u.number)||await findUser(u);
      if (!row?.drill || !/\/Group\/Members\/Modify\//.test(row.drill.url)) throw Error('The expected user could not be opened.');
      entries.set(u.number,row);
      await go(row.drill.url,row.drill.params);
      await go(routes.profile);
      equal(value('unicodeFirstName'),u.first,'First name'); equal(value('unicodeLastName'),u.last,'Last name');
      equal(value('firstName'),u.first,'Calling Line ID First Name');
      equal(value('lastName'),u.last,'Calling Line ID Last Name');
      equal(value('email').toLowerCase(),u.email.toLowerCase(),'Email');
      const dept=field('deptEncodedKey');
      equal(text(dept.selectedOptions[0]?.textContent),u.dept,'Department');
    }
    async function loadNumbers(dept) {
      await go(routes.numbers);
      const result=await search('Department',dept);
      const rows=result.raw.flatMap(nativeRows);
      // An empty server result is fine. Never interpret an unparsed nonempty result as an available number.
      if (result.rows.length&&!rows.length) throw Error('The number availability table could not be inspected.');
      const assigned=new Set(rows.filter(r=>r.user).flatMap(r=>expandPhone(r.phone)));
      const pool=[...new Set(rows.filter(r=>!r.user&&r.dept===dept).flatMap(r=>expandPhone(r.phone)))]
        .filter(number=>!assigned.has(number)).sort();
      available.set(dept,pool); return pool;
    }
    async function profileExists(name) {
      await go(routes.devices);
      const result=await search('Identity/Device Profile Name',name);
      return result.rows.some(r=>text(r.cells[0])===name);
    }
    async function checkProfileType(u,kind) {
      await go(routes.devices);
      const name='RSG '+(kind==='vvx'?'VVX ':'Teams ')+u.number.slice(-5);
      const result=await search('Identity/Device Profile Name',name);
      const rows=result.rows.filter(r=>text(r.cells[0])===name);
      const clean=s=>text(s).replace(/\s*\(Reseller\)$/,'');
      if (rows.length!==1 || !rows[0].cells.some(c=>clean(c)===clean(types[kind])))
        throw Error('The saved '+name+' device type could not be verified.');
      await openUser(u);
    }
    async function checkExtension(u) {
      await go(routes.users);
      const result=await search('Extension',u.number.slice(-5));
      if (result.rows.length) throw Error('Extension '+u.number.slice(-5)+' is already in use.');
    }
    const deviceLine=(u,kind)=>u.number+(kind==='teams'?'_Teams':'');
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
      requireExpected({deviceName:'New Device',newDeviceName:'RSG '+(kind==='vvx'?'VVX ':'Teams ')+u.number.slice(-5)});
      if(text(field('newDeviceType').selectedOptions[0]?.textContent)!==types[kind])
        throw Error('The native '+(kind==='vvx'?'VVX':'Teams')+' device type changed before saving. No save was sent.');
      if(field('macAddress',true)&&value('macAddress')!=='')throw Error('MAC address must be blank for this setup. No save was sent.');
      if(kind==='vvx') {
        if(digits(value('phoneNumber'))!==u.number||value('extension')!==u.number.slice(-5)||value('deviceChoice')!=='Device Profile')
          throw Error('The native phone number, extension or primary device choice changed before saving. No save was sent.');
      } else for(const name of ['activeEndpoint','allowOrigination','allowTermination'])
        if(!field(name).checked)throw Error('The Teams '+name+' setting is off. No save was sent.');
    }
    function deviceMatches(u,kind) {
      const chosen=field('deviceName',true);
      const name='RSG '+(kind==='vvx'?'VVX ':'Teams ')+u.number.slice(-5);
      if(kind==='teams'&&!chosen&&!lineFields().length) {
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
      set('newDeviceName','RSG '+(kind==='vvx'?'VVX ':'Teams ')+u.number.slice(-5));
      option('newDeviceType',types[kind]);
      if (field('macAddress',true)) set('macAddress','');
      // Native blur handlers copy these controls into hidden linePort, which
      // the validator/server actually use. Leave deviceDomain unchanged.
      const fields=lineFields();
      if(!fields.length)throw Error('The native Line/Port field is unavailable. No save was sent.');
      for(const e of fields)set(e.name,deviceLine(u,kind));
      requireDeviceLine(u,kind);
    }
    function refuseExistingDevice(u,kind) {
      const name='RSG '+(kind==='vvx'?'VVX ':'Teams ')+u.number.slice(-5);
      if ([...field('deviceName').options].some(o=>text(o.textContent)===name+' (Group)'||text(o.textContent)===name))
        throw Error(name+' already exists but is not assigned as expected. Review it before retrying.');
    }
    async function checkAddresses(u,loaded=false) {
      if (!loaded) await go(routes.addresses);
      equal(digits(value('phoneNumber')),u.number,'Phone number');
      equal(value('extension'),u.number.slice(-5),'Extension');
      if (value('deviceChoice')!=='Device Profile'||!deviceMatches(u,'vvx')) throw Error('The saved primary VVX configuration did not match.');
      await checkProfileType(u,'vvx');
    }
    async function scaRow(u) {
      await go(routes.sca);
      const result=await lease.search([],{});
      if (result.tooMany || result.totalPages>1) throw Error('The complete SCA list could not be verified.');
      const name='RSG Teams '+u.number.slice(-5), line=deviceLine(u,'teams');
      const rows=result.rows.filter(r=>r.cells.some(c=>text(c)===name||text(c)===name+' (Group)'));
      if (rows.length>1) throw Error('Duplicate Teams appearances need review.');
      if (!rows.length) return null;
      if (!rows[0].cells.some(c=>matchesLine(text(c),line))) throw Error('The Teams line/port does not match.');
      if (!rows[0].drill) throw Error('The Teams appearance cannot be opened for verification.');
      return rows[0];
    }
    async function checkTeams(u) {
      const row=await scaRow(u);
      if (!row) throw Error('The Teams appearance is missing.');
      await go(row.drill.url,row.drill.params);
      if (!deviceMatches(u,'teams')) throw Error('The Teams profile or line/port did not match.');
      for (const name of ['activeEndpoint','allowOrigination','allowTermination'])
        if (!field(name).checked) throw Error('The saved Teams '+name+' setting is off.');
      await checkProfileType(u,'teams');
    }
    const api={ routes, types, get domain(){return domain;}, get departments(){return departments;},
      async initialize() {
        if (![...document.querySelectorAll('.headerAuthLevelLink,.cp-bc-seg')].some(e=>text(e.textContent)==='RSG'))
          throw Error('Open the RSG group’s Users page to use this setup.');
        await go(routes.add);
        const domains=[...field('domain').options].filter(o=>o.value&&!o.disabled);
        if (domains.length!==1) throw Error('Choose the group User ID domain in CommPilot first; multiple domains are not supported yet.');
        domain=domains[0].value;
        departments=[...field('deptEncodedKey').options].filter(o=>o.value&&text(o.textContent)&&!/^none$/i.test(text(o.textContent)))
          .map(o=>({name:text(o.textContent),key:o.value}));
        if (!departments.length||new Set(departments.map(d=>d.name)).size!==departments.length) throw Error('Unique native departments are required.');
        await go(routes.users); return {domain,departments};
      }, loadNumbers,
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
          const pool=await loadNumbers(u.dept);
          if (!pool.includes(u.number)) throw Error('The selected phone number is no longer available.');
          await checkExtension(u);
          await go(routes.add);
          set('name',u.number);set('domain',domain);set('unicodeFirstName',u.first);set('unicodeLastName',u.last);
          // These are separate required fields. Native validation checks them;
          // it does not copy the display name into the Calling Line ID name.
          set('firstName',u.first);set('lastName',u.last);
          set('clidPhone','+1'+u.number);set('email',u.email);
          set('deptEncodedKey',departments.find(d=>d.name===u.dept).key);
          set('password','Easy1234');set('echoPassword','Easy1234');
          // Keep the native language/time zone and optional name-dialing defaults.
          const expected={name:u.number,domain,unicodeFirstName:u.first,unicodeLastName:u.last,firstName:u.first,lastName:u.last,
            clidPhone:'+1'+u.number,email:u.email,deptEncodedKey:departments.find(d=>d.name===u.dept).key,password:'Easy1234',echoPassword:'Easy1234'};
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
            if (digits(value('phoneNumber')) && /^\d{10}$/.test(digits(value('phoneNumber')))&&digits(value('phoneNumber'))!==u.number)
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
          await go(routes.auth);set('username',u.number);set('newPassword',password);set('newPasswordConfirm',password);
          await save(()=>requireExpected({username:u.number,newPassword:password,newPasswordConfirm:password}));
          await go(routes.auth);equal(value('username'),u.number,'SIP authentication username');
        } else if (index===4) {
          if (!await scaRow(u)) {
            await go(routes.scaAdd);refuseExistingDevice(u,'teams');configureDevice(u,'teams');
            for (const name of ['activeEndpoint','allowOrigination','allowTermination']) { const e=field(name);if (!e.checked) e.click(); }
            await save(()=>requireNewDevice(u,'teams'));
          }
          await checkTeams(u);
        } else if (index===5) {
          await go(routes.alternate);equal(value('alt1').toLowerCase(),u.email.toLowerCase(),'Alternate ID');
          await checkAddresses(u); await go(routes.auth);equal(value('username'),u.number,'SIP authentication username');
          await checkTeams(u);
        }
      }
    };
    return api;
  };
})();
