/* Design B: users and numbers → department passwords → review → checked native saves. */
(function () {
  'use strict';
  if (window!==window.top || window.__cpUserBulkLoaded) return;
  window.__cpUserBulkLoaded=true;
  const model=window.CpBulkModel, general=!!model;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const steps=['User','Alternate ID','VVX','Authentication','Teams SCA','Verify'];
  const icons={users:'<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 3a4 4 0 0 1 0 8M19 15a6 6 0 0 1 3 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',paste:'<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/>',down:'<path d="m7 10 5 5 5-5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4L19 6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',phone:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h8M9 17h6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'};
  const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.check}</svg>`;
  const format=window.CpBulkPhone.display;
  let root=null, lease, engine, users=[], passwords=new Map(), pools=new Map(), stage=0, busy=false, pause=false, running=false, nextId=1, chosen=null, pickerState=null, notice='', returnNav;
  let info=null,config=null,savedDefaults=null,credentials={web:'Easy1234',mailbox:'',device:''},startingExtension='';
  let diagnosticUser=null,diagnosticStep=null,batchId='';
  const $=s=>root.querySelector(s), depts=()=>engine.departments.map(d=>d.name), used=()=>depts().filter(d=>users.some(u=>u.dept===d));
  const extension=u=>general?(u.extension||'—'):u.number?u.number.slice(-5):'—';
  const complete=u=>u.first.trim()&&u.last.trim()&&u.first.length<=30&&u.last.length<=30&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)&&
    pools.get(u.dept)?.includes(u.number)&&!users.some(x=>x!==u&&(x.email.toLowerCase()===u.email.toLowerCase()||x.number&&(x.number===u.number||extension(x)===extension(u))));
  function readyCount(){
    if(!general)return users.filter(complete).length;
    if(!info)return 0;
    // Build duplicate counts once per update instead of rebuilding both users' device plans for
    // every pair. Keep this snapshot local so edits, profile overrides and number reloads stay fresh.
    // CommPilot's Prototype replaces Array.from and ignores its mapping argument.
    const counts=[new Map(),new Map(),new Map(),new Map()],numberSets=new Map();
    const identifiers=users.map(u=>[u.email.toLowerCase(),u.extension,u.number,model.resolve(u,config,info).localId]);
    for(const keys of identifiers)keys.forEach((key,i)=>{if(key)counts[i].set(key,(counts[i].get(key)||0)+1);});
    let ready=0;
    for(let i=0;i<users.length;i++){
      const u=users[i];
      if(model.validate(u,config,info).length||identifiers[i].some((key,j)=>key&&counts[j].get(key)>1))continue;
      if(u.number){
        if(!numberSets.has(u.dept))numberSets.set(u.dept,new Set(pools.get(u.dept)||[]));
        if(!numberSets.get(u.dept).has(u.number))continue;
      }
      ready++;
    }
    return ready;
  }
  function btn(action,label,extra='') { return `<button type="button" data-action="${action}" ${extra}>${label}</button>`; }
  function rules() { return `<div class="configuration-line"><span>${icon('phone')}${general?'Profiles follow the selected group setup':'VVX primary + Teams SCA for every user'}</span><span>${icon('users')}Service packs assigned by group</span><span>${icon('lock')}MAC addresses added later</span></div>`; }
  const plan=u=>u.plan||model.resolve(u,config,info);
  const planSteps=u=>general?(u.workflow||model.steps(plan(u))):steps.map((label,i)=>({key:i,label}));
  function setting(label,key,options){
    return `<label>${esc(label)}<select data-setting="${key}">${options.map(([v,t])=>`<option value="${esc(v)}" ${String(config[key])===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
  }
  function settingInput(label,key,extra=''){
    return `<label>${esc(label)}<input data-setting="${key}" value="${esc(config[key])}" ${extra}></label>`;
  }
  function setupPage(){
    const suggestions=model.prefixes(info.sample);
    return `<section class="card"><header class="card-heading"><div><strong>${esc(info.scope.groupId)} · group setup</strong><span class="count">${savedDefaults?'Saved defaults loaded':'Choose this group’s defaults'}</span></div>${btn('save-defaults','Save group defaults')}</header>
      <div class="setup-grid">
      ${setting('Personal phone numbers','numberMode',[['mixed','Choose per user'],['none','Extension only'],['all','Every user has a DID']])}
      ${setting('User ID format','idMode',[['prefix','Prefix + extension'],['phone','Personal phone number'],['manual','Enter per user']])}
      ${settingInput('User ID prefix','prefix','maxlength="150"')}
      ${setting('User ID domain','domain',info.domains.map(d=>[d,d]))}
      ${setting('Extension suggestions','extensionMode',[['next','Next after the highest'],['did','Last digits of the DID'],['manual','Enter per user']])}
      ${setting('Suggested extension length','length',[...Array(info.limits.max-info.limits.min+1)].map((_,i)=>[i+info.limits.min,String(i+info.limits.min)]))}
      <label>Next extension for this batch<input data-start value="${esc(startingExtension)}" inputmode="numeric" placeholder="Enter a starting extension"></label>
      ${setting('Editable caller ID number','callerMode',[['did','Personal DID when present'],['default','Keep PBX default']])}
      ${setting('Native voicemail default','voicemail',[['','Choose On or Off'],['off','Off — skip setup'],['on','On']])}
      ${settingInput('Device-name prefix','devicePrefix','maxlength="80"')}
      ${setting('Primary device','primary',[[false,'No primary device'],[true,'Create primary device']])}
      ${setting('Primary device type','primaryType',[['','Choose a native device type'],...info.deviceTypes.map(t=>[t,t])])}
      ${settingInput('Primary profile name label','primaryToken','maxlength="30"')}
      </div><div class="setup-section"><strong>Shared call appearances</strong><div class="profile-checks">${['teams','mobile','desktop'].map(k=>`<label><input type="checkbox" data-sca="${k}" ${config.sca.includes(k)?'checked':''}>${esc(model.catalog[k].label)}<small>${esc(model.catalog[k].type)}</small></label>`).join('')}</div>
      <p>Webex device-access credentials are configured after the appearances. Integrated IM&amp;P is enabled last, keeping the PBX-selected primary ID.</p></div>
      <div class="setup-section"><strong>Live group rules</strong><p>Extension length: ${info.limits.min}–${info.limits.max}; default ${info.limits.default}. ${info.scope.groupId==='RSG'?'RSG uses a small loaded sample; no unrestricted user search.':'Highest existing extension: '+esc(info.highest||'none')+'.'} Caller ID: ${info.caller.locked?'controlled by the PBX':info.caller.value?'PBX default available':'editable; enter a shared number for extension-only users'}.</p>
      <p>Prefix sample: ${suggestions.length?suggestions.map(s=>`<button type="button" data-prefix="${esc(s.prefix)}">${esc(s.prefix||'(empty prefix)')} · ${s.count} matches</button>`).join(' '):'No unambiguous prefix found; enter and confirm one.'}</p>
      <label class="inline-check"><input type="checkbox" data-prefix-confirm ${config.prefixChosen?'checked':''}>I have checked the User ID prefix</label>
      <p>${info.sample.map(s=>esc(s.id)+' → '+esc(s.extension)).join(' · ')||'No users in the sample.'}</p>
      <p>Voicemail Off skips native voicemail setup and leaves the PBX default unchanged. Mailbox ID: local User ID + @trifecta.avpaas.io. Voice portal PIN: 54321, checked against this group’s passcode rules. Passwords are entered for each batch and are not saved with these defaults.</p></div></section>`;
  }
  function groupTable(){
    return `<div class="table-scroll"><table class="users-table group-users"><thead><tr>${['#','First name','Last name','Email / alternate ID','Department','Personal number','Extension','Setup'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${users.map((u,i)=>`<tr><td>${i+1}</td>${['first','last','email'].map(f=>`<td><input data-field="${f}" data-user="${u.id}" value="${esc(u[f])}" aria-label="${f==='first'?'First name':f==='last'?'Last name':'Email'} for user ${i+1}" maxlength="${f==='email'?80:30}"></td>`).join('')}
      <td><select data-field="dept" data-user="${u.id}" aria-label="Department for user ${i+1}"><option value="">Choose department</option>${depts().map(d=>`<option ${u.dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select></td>
      <td>${config.numberMode!=='none'?`<button type="button" class="number-trigger" data-pick="${u.id}" ${!u.dept?'disabled':''}><span>${esc(format(u.number)||(config.numberMode==='all'?'Choose number':'No personal number'))}</span>${icon('down')}</button>`:'Extension only'}</td>
      <td><input data-field="extension" data-user="${u.id}" value="${esc(u.extension)}" inputmode="numeric" aria-label="Extension for user ${i+1}"></td>
      <td>${btn('options','Options',`data-user="${u.id}"`)}${btn('remove',icon('close'),`class="icon-button" data-user="${u.id}" aria-label="Remove user ${i+1}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function groupReview(){
    return `<section class="card"><header class="card-heading"><strong>Review before creating</strong><span>Native identifier and availability checks passed</span></header><div class="table-scroll"><table class="review-table"><thead><tr><th>User</th><th>User ID / number</th><th>Profiles</th><th>Voicemail / IM&amp;P</th><th>Check</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.first+' '+u.last)}<small>${esc(u.dept)} · ext ${esc(extension(u))}</small></td><td>${esc(plan(u).localId+'@'+plan(u).domain)}<small>${esc(format(u.number)||'Extension only')}</small></td><td>${plan(u).profiles.map(p=>esc(p.name)).join('<br>')||'None'}</td><td>Voicemail ${plan(u).voicemail?'On':'setup skipped'}<small>${plan(u).profiles.some(p=>p.access)?'IM&P On after all setup succeeds':'Preserve IM&P; check existing Webex'}</small></td><td>${btn('details','View every step',`data-user="${u.id}"`)}</td></tr>`).join('')}</tbody></table></div>${rules()}</section>`;
  }
  function groupCredentials(){
    const secret=(label,key)=>`<label>${label}<input type="password" data-credential="${key}" value="${esc(credentials[key])}" autocomplete="new-password"></label>`;
    return `<section class="card"><header class="card-heading"><strong>Batch credentials</strong><span>Kept only while this batch is open</span></header><div class="setup-grid">
      ${secret('Initial web access password','web')}
      ${users.some(u=>plan(u).voicemail)?secret('Mailbox password','mailbox'):''}
      ${users.some(u=>plan(u).profiles.some(p=>p.access))?secret('Webex device-access password','device'):''}
      ${used().map(d=>`<label>${esc(d)} · SIP password<input type="password" data-password="${esc(d)}" value="${esc(passwords.get(d)||'')}" autocomplete="new-password"></label>`).join('')}</div>
      <div class="setup-section"><p>Mailbox and Webex passwords can be overridden per user. The voice portal PIN is 54321; web access uses the password entered above.</p>${users.map(u=>`${btn('options',esc(u.first+' '+u.last)+' · overrides',`data-user="${u.id}"`)}`).join(' ')}</div></section>`;
  }
  function groupRunView(){
    const total=users.reduce((n,u)=>n+u.steps.length,0),done=users.reduce((n,u)=>n+u.steps.filter(s=>s==='done').length,0);
    return `<section class="card"><div class="run-top"><strong>${users.filter(u=>u.steps.every(s=>s==='done')).length} configured · ${users.filter(u=>u.error).length} need attention</strong>${btn('download-log','Download batch report')}<progress max="${total||1}" value="${done}" aria-label="Batch configuration progress"></progress></div><table class="run-table"><thead><tr><th>User</th><th>Steps</th><th>Status</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.first+' '+u.last)}<small>${esc(uidDisplay(u))}</small></td><td>${u.steps.filter(s=>s==='done').length} / ${u.steps.length}</td><td><span class="${u.error?'failed':'muted'}">${esc(u.error||(u.steps.every(s=>s==='done')?'Configured':u.steps.includes('running')?planSteps(u)[u.steps.indexOf('running')].label:'Queued'))}</span>${btn('details','Details',`data-user="${u.id}"`)}</td></tr>`).join('')}</tbody></table><div class="table-foot">Saved settings and acknowledged credential saves are checked. Registration and calling tests remain separate.</div></section>`;
  }
  const uidDisplay=u=>plan(u).localId+'@'+plan(u).domain;
  async function defaultsRequest(action){
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('The extension settings bridge did not respond. Reload the extension and refresh CommPilot.'));},5000);
      function receive(e){const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.type!=='cp:bulk-defaults:response'||m.id!==id)return;
        clearTimeout(timeout);window.removeEventListener('message',receive);m.error?reject(Error(m.error)):resolve(m.result);}
      window.addEventListener('message',receive);
      window.postMessage({type:'cp:bulk-defaults:request',id,action,scope:info.scope,settings:action==='save'?model.snapshot(config):undefined},location.origin);
    });
  }
  function suggestExtension(u,peers=users){
    if(u.extensionEdited)return;
    if(config.extensionMode==='did'){u.extension=u.number?u.number.slice(-config.length):'';return;}
    if(config.extensionMode!=='next'||!startingExtension){u.extension='';return;}
    const taken=new Set([...(info.existingExtensions||[]),...peers.filter(x=>x!==u).map(x=>x.extension).filter(Boolean)]);
    let next=startingExtension;
    while(taken.has(next))next=model.nextExtension(next,config.length);
    if(next.length>config.length)throw Error('Starting extension exceeds the selected length.');
    u.extension=next;
  }
  function showSubdialog(d, focus='button'){
    d.hidden=false;
    const heading=d.querySelector('h3');
    if(heading){heading.id='cp-bulk-subdialog-title';d.setAttribute('aria-labelledby',heading.id);}
    d.oncancel=e=>{e.preventDefault();closeSubdialog();};
    // A visual backdrop alone does not stop clicks or focus on the batch behind it.
    // Keep the native modal open when refreshing per-user profile overrides.
    if(!d.open)d.showModal();
    d.querySelector(focus)?.focus();
  }
  function closeSubdialog(){
    const d=$('.subdialog');
    if(d?.open)d.close();
    if(d)d.hidden=true;
  }
  function userOptions(u){
    const d=$('.subdialog');
    d.innerHTML=`<header><h3>${esc((u.first+' '+u.last).trim()||'User setup')}</h3>${btn('dismiss',icon('close'),'class="icon-button" aria-label="Close user setup"')}</header>
      <div class="setup-grid">${config.idMode==='manual'?`<label>Local User ID<input data-field="customId" data-user="${u.id}" value="${esc(u.customId)}"></label>`:''}
      <label>Caller ID number if needed<input data-field="caller" data-user="${u.id}" value="${esc(info.caller.locked?info.caller.value:u.caller)}" placeholder="${esc(info.caller.value||'PBX default / personal DID')}" ${info.caller.locked?'readonly aria-describedby="cp-bulk-caller-policy"':''}>${info.caller.locked?'<small id="cp-bulk-caller-policy">Controlled by the PBX.</small>':''}</label>
      <label>Native voicemail<select data-field="voicemail" data-user="${u.id}">${[['default','Use group default'],['on','On'],['off','Off — skip setup']].map(([v,t])=>`<option value="${v}" ${u.voicemail===v?'selected':''}>${t}</option>`).join('')}</select></label>
      <label>Mailbox password override<input type="password" data-field="mailboxPassword" data-user="${u.id}" value="${esc(u.mailboxPassword)}" autocomplete="new-password"></label>
      <label>Webex device password override<input type="password" data-field="devicePassword" data-user="${u.id}" value="${esc(u.devicePassword)}" autocomplete="new-password"></label></div>
      <label class="inline-check"><input type="checkbox" data-user-primary="${u.id}" ${(u.primary??config.primary)?'checked':''}>Primary device</label>
      <div class="profile-checks">${['teams','mobile','desktop'].map(k=>`<label><input type="checkbox" data-user-sca="${u.id}" data-kind="${k}" ${(u.sca||config.sca).includes(k)?'checked':''}>${esc(model.catalog[k].label)}</label>`).join('')}</div>
      <p class="user-plan-summary">${esc(uidDisplay(u))}</p><p class="user-errors">${model.validate(u,config,info).map(esc).join('<br>')}</p>
      <footer>${btn('inherit','Use group profile defaults',`data-user="${u.id}"`)}${btn('dismiss','Done','class="primary"')}</footer>`;
    showSubdialog(d);
  }
  function table() {
    if(general)return groupTable();
    return `<div class="table-scroll"><table class="users-table"><colgroup><col class="c-index"><col class="c-first"><col class="c-last"><col class="c-email"><col class="c-dept"><col class="c-phone"><col class="c-ext"><col class="c-more"></colgroup><thead><tr>${['#','First name','Last name','Email / alternate ID','Department','Available phone number','Extension',''].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${users.map((u,i)=>`<tr data-row="${u.id}"><td>${i+1}</td>${['first','last','email'].map(f=>`<td><input data-field="${f}" data-user="${u.id}" value="${esc(u[f])}" aria-label="${f==='first'?'First name':f==='last'?'Last name':'Email'} for user ${i+1}" ${f==='email'?'type="email" maxlength="80"':'maxlength="30"'} autocomplete="off"></td>`).join('')}<td><select data-field="dept" data-user="${u.id}" aria-label="Department for user ${i+1}"><option value="">Choose department</option>${depts().map(d=>`<option ${u.dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select></td><td><button type="button" class="number-trigger ${u.number?'':'placeholder'}" data-pick="${u.id}" aria-haspopup="dialog" aria-expanded="false" ${!u.dept?'disabled':''}><span>${esc(format(u.number)||'Choose number')}</span>${icon('down')}</button></td><td class="derived">${extension(u)}</td><td>${btn('remove',icon('close'),`class="icon-button" data-user="${u.id}" aria-label="Remove user ${i+1}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function editing() { return `<section class="card"><header class="card-heading"><div><strong>Users to create</strong><span class="count">${users.length} users · ${used().length} departments</span></div><div class="actions">${btn('add',icon('plus')+'Add user')}${btn('paste',icon('paste')+'Paste users')}</div></header>${table()}<div class="table-foot"><span class="batch-summary">${readyCount()} of ${users.length} ready · choose every number manually</span>${btn('add','Add another user','class="quiet"')}</div>${rules()}</section>`; }
  function credentialPage() { if(general)return groupCredentials(); return `<section class="card"><header class="card-heading"><div><strong>Department SIP passwords</strong><span class="count">${used().length} departments</span></div><span class="muted">${users.length} users</span></header><div class="credential-page"><p>Enter the SIP authentication password to use for users in each department.</p><div class="credentials">${used().map((d,i)=>`<div class="credential"><label for="cp-ub-secret-${i}">${esc(d)}<small>${users.filter(u=>u.dept===d).length} users</small></label><div class="password-field"><input id="cp-ub-secret-${i}" type="password" data-password="${esc(d)}" value="${esc(passwords.get(d)||'')}" autocomplete="new-password" aria-label="SIP password for ${esc(d)}">${btn('reveal',icon('eye'),`data-secret="${i}" aria-label="Show SIP password for ${esc(d)}"`)}</div></div>`).join('')}</div></div><div class="configuration-line">${icon('lock')}Portal login uses the standard RSG initial password. Passwords are kept only while this batch is open.</div></section>`; }
  function review() { if(general)return groupReview(); return `<section class="card"><header class="card-heading"><div><strong>Review before creating</strong><span class="count">Every number was selected manually</span></div><span class="muted">Native checks completed</span></header><div class="review-summary"><strong>${users.length} users</strong><span>${used().length} departments</span><span>${users.length*2} device profiles</span><span>${used().length} SIP passwords entered</span></div><div class="table-scroll"><table class="review-table"><thead><tr><th>User</th><th>User ID / phone number</th><th>Extension</th><th>Device profiles</th><th>Check</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.first)} ${esc(u.last)}<small>${esc(u.dept)} · ${esc(u.email)}</small></td><td>${u.number}@${esc(engine.domain)}<small>${format(u.number)}</small></td><td>${extension(u)}</td><td>RSG VVX ${extension(u)}<small>RSG Teams ${extension(u)}</small></td><td>${btn('details','View setup',`class="quiet" data-user="${u.id}"`)}</td></tr>`).join('')}</tbody></table></div><div class="rules-grid"><div><span>Primary in Addresses</span><strong>Trifecta PolycomVVX400 (Reseller)</strong></div><div><span>Shared call appearance</span><strong>Trifecta Teams (Reseller)</strong></div><div><span>Alternate user ID</span><strong>Same as the entered email</strong></div><div><span>VVX line/port</span><strong>User ID number</strong></div><div><span>Teams line/port</span><strong>User ID number + _Teams</strong></div><div><span>On a failed user</span><strong>Continue the batch; retry the failed step</strong></div></div>${rules()}</section>`; }
  function runView() {
    if(general)return groupRunView();
    const done=users.filter(u=>u.steps.every(s=>s==='done')).length, failed=users.filter(u=>u.steps.includes('failed')).length;
    const progress=100*users.reduce((n,u)=>n+u.steps.filter(s=>s==='done').length,0)/(6*users.length);
    return `<section class="card"><div class="run-top"><div class="run-summary"><strong>${running?(pause?'Pausing after the current step':'Creating '+users.length+' users'):done+' configured · '+failed+' needs attention'}</strong><span>Completed steps are preserved for retry</span></div><progress max="100" value="${progress}" aria-label="Batch configuration progress"></progress></div><div class="table-scroll"><table class="run-table"><thead><tr><th>User</th>${['User','Alt. ID','VVX','Auth.','Teams','Verify'].map(s=>`<th class="step-cell">${s}</th>`).join('')}<th>Status</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.first)} ${esc(u.last)}<small>${esc(u.dept)} · ext ${extension(u)}</small></td>${u.steps.map((s,i)=>`<td class="step-cell"><span class="${s}" aria-label="${steps[i]}: ${s}">${s==='done'?icon('check'):s==='failed'?icon('close'):s==='running'?'…':'—'}</span></td>`).join('')}<td><span class="${u.error?'failed':'muted'}">${esc(u.error|| (u.steps.every(s=>s==='done')?'Configured':u.steps.includes('running')?steps[u.steps.indexOf('running')]:'Queued'))}</span>${btn('details','Details',`class="quiet" data-user="${u.id}"`)}</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>Saved configuration is checked. SIP passwords cannot be read back; registration and calling tests are not performed.</span></div></section>`;
  }
  function render() {
    if (!root) return;
    if(general){renderGroup();return;}
    chosen=null;pickerState=null;
    root.innerHTML=`<header class="page-heading"><div>${icon('users')}<h2>Bulk user creation</h2></div><div class="page-actions">${stage>0&&stage<3?btn('back','Back',busy?'disabled':''):''}${stage===3?btn('primary',running?(pause?'Resume batch':'Pause batch'):pause?'Resume batch':users.some(u=>u.error)?'Retry failed users':'Done','class="primary"'):btn('primary',stage<0?(busy?'Loading…':'Retry loading'):stage===0?'Continue to passwords':stage===1?'Review '+users.length+' users':'Create '+users.length+' users','class="primary"')}${btn('close',stage===3?'Close':'Cancel',busy||running?'disabled':'class="quiet"')}</div></header><nav class="stepper" aria-label="Bulk creation steps">${['Users & numbers','Department passwords','Review & create'].map((s,i)=>`<span ${i===Math.min(stage,2)?'aria-current="step"':''}><b>${i+1}</b>${s}</span>`).join('')}</nav><p class="notice" role="status" aria-live="polite">${esc(notice)}</p><div class="batch-content">${busy&&stage<0?'<p>Loading the RSG group configuration…</p>':stage===0?editing():stage===1?credentialPage():stage===2?review():stage===3?runView():''}</div><footer class="workspace-foot"><span>RSG · ${esc(engine?.domain||'')}</span><span>${stage===3?'Keep this tab open until the batch finishes.':'Review every user before creating.'}</span></footer><section class="picker" role="dialog" aria-label="Choose available number" hidden></section><dialog class="subdialog" hidden></dialog>`;
    headerState();
  }
  function headerState() {
    if (!root) return;
    const primary=$('[data-action="primary"]');
    const count=stage===0?readyCount():0;
    primary.disabled=busy || (stage===0&&(!users.length||count!==users.length)) || (stage===1&&!used().every(d=>passwords.get(d)?.trim()));
    const status=$('.notice');status.textContent=notice;
    const summary=$('.batch-summary');if(summary)summary.textContent=count+' of '+users.length+' ready · '+(general?'review each user’s extension and setup':'choose every number manually');
    root.setAttribute('aria-busy',String(busy));
    const content=$('.batch-content');if(content)content.inert=busy;
  }
  function renderGroup(){
    chosen=null;pickerState=null;
    const action=stage<0?(busy?'Loading…':'Retry loading'):stage===4?'Use this setup':stage===0?'Continue to passwords':
      stage===1?'Review '+users.length+' users':stage===2?'Create '+users.length+' users':
      running?(pause?'Resume batch':'Pause batch'):pause?'Resume batch':users.some(u=>u.error)?'Retry failed users':'Done';
    root.innerHTML=`<header class="page-heading"><div>${icon('users')}<h2>Bulk user creation</h2></div><div class="page-actions">
      ${stage>0&&stage<3?btn('back','Back',busy?'disabled':''):''}${btn('primary',action,'class="primary"')}${btn('close',stage===3?'Close':'Cancel',busy||running?'disabled':'class="quiet"')}</div></header>
      <nav class="stepper" aria-label="Bulk creation steps">${['Group setup','Users & numbers','Passwords','Review & create'].map((s,i)=>`<span ${i===(stage===4?0:Math.min(stage+1,3))?'aria-current="step"':''}><b>${i+1}</b>${s}</span>`).join('')}</nav>
      ${stage>=0&&stage<3?`<div class="defaults-bar"><span>${esc(info.scope.groupId)} · ${savedDefaults?'saved group defaults':'current batch setup'}</span><div>${btn('settings','Edit group setup')}${btn('save-defaults','Save defaults')}</div></div>`:''}
      <p class="notice" role="status" aria-live="polite">${esc(notice)}</p><div class="batch-content">${stage<0?(busy?'<p>Reading this group’s policies and available device types…</p>':''):stage===4?setupPage():stage===0?editing():stage===1?groupCredentials():stage===2?groupReview():groupRunView()}</div>
      <footer class="workspace-foot"><span>${esc(info?.scope.groupId||'')} · ${esc(config?.domain||'')}</span><span>${stage===3?'Keep this tab open until the batch finishes.':'Review every user before creating.'}</span></footer>
      <section class="picker" role="dialog" aria-label="Choose available number" hidden></section><dialog class="subdialog" hidden></dialog>`;
    headerState();
  }
  async function work(fn) {
    if (busy) return;
    busy=true;headerState();root.classList.add('is-busy');
    try { await fn(); }
    catch(e) { notice=safeError(e); }
    finally { busy=false;root?.classList.remove('is-busy');render(); }
  }
  function safeError(e) { let message=String(e?.message||'This step could not be confirmed.');for (const p of ['Easy1234',...passwords.values(),...Object.values(credentials),...users.flatMap(u=>[u.mailboxPassword,u.devicePassword])]) if(p) message=message.split(p).join('[hidden]');return message; }
  function addRow() {
    const u={id:nextId++,first:'',last:'',email:'',dept:'',number:'',steps:Array(6).fill('queued'),error:'',
      extension:'',customId:'',caller:'',voicemail:'default',primary:null,sca:null,mailboxPassword:'',devicePassword:''};
    users.push(u);if(general)suggestExtension(u);
  }
  function details(u) {
    if(general){groupDetails(u);return;}
    const d=$('.subdialog');
    d.innerHTML=`<header><h3>${esc(u.first)} ${esc(u.last)}</h3>${btn('dismiss',icon('close'),'class="icon-button" aria-label="Close setup details"')}</header><dl>${Object.entries({'User ID':u.number+'@'+engine.domain,'Department':u.dept,'Email / alternate ID':u.email,'Phone number':format(u.number),'Extension':extension(u),'Primary profile':'RSG VVX '+extension(u),'Primary type':engine.types.vvx,'VVX line/port':u.number,'Teams profile':'RSG Teams '+extension(u),'Teams type':engine.types.teams,'Teams line/port':u.number+'_Teams','MAC address':'Associate later'}).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${stage===3?`<p>${esc(u.error||(u.steps.every(s=>s==='done')?'Saved configuration checked. Registration and calling tests were not performed.':'Setup is not complete. Completed steps are preserved.'))}</p><ul>${u.steps.map((s,i)=>`<li>${steps[i]}: ${s}</li>`).join('')}</ul>`:''}${btn('dismiss','Done','class="primary"')}`;
    showSubdialog(d);
  }
  function groupDetails(u){
    const p=plan(u),d=$('.subdialog');
    const pairs=[['User ID',uidDisplay(u)],['Email / alternate ID',u.email],['Department',u.dept],['Phone number',format(u.number)||'None'],['Extension',p.extension],
      ['Caller ID',info.caller.locked?'PBX controlled':p.caller||(p.number&&p.callerMode==='did'?format(p.number):info.caller.value||'Needs review')],
      ...p.profiles.flatMap(d=>[[model.catalog[d.kind].label,d.name],[d.name+' · type',d.type],[d.name+' · Line/Port',d.line],...(d.access?[[d.name+' · access username',d.username]]:[])]),
      ['Native voicemail',p.voicemail?'On':'Setup skipped; PBX default retained'],...(p.voicemail?[['Mailbox email and User ID',p.mailbox],['Voice portal PIN','54321']]:[]),
      ['Integrated IM&P',p.profiles.some(d=>d.access)?'On last; preserve PBX primary ID':'Preserve; enable if existing Webex is found'],['MAC','Associate later']];
    d.innerHTML=`<header><h3>${esc(u.first+' '+u.last)}</h3>${btn('dismiss',icon('close'),'class="icon-button" aria-label="Close setup details"')}</header><dl>${pairs.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <p class="${u.error?'failed':''}">${esc(u.error||'Every step below must finish before this user is configured.')}</p>
      <ol>${planSteps(u).map((s,i)=>`<li>${esc(s.label)}${stage===3?' · '+esc(u.steps[i]):''}</li>`).join('')}</ol>
      ${diagnosticView(u)}
      ${u.uncertainSecret?`<p>A password save had an uncertain response. Verify that step in CommPilot before acknowledging it.</p>${btn('ack-secret','I verified the '+esc(u.uncertainSecret)+' save',`data-user="${u.id}"`)}`:''}
      ${btn('dismiss','Done')}`;
    showSubdialog(d);
  }
  function cleanDiagnostic(value){
    const secrets=['Easy1234',...passwords.values(),...Object.values(credentials),...users.flatMap(u=>[u.mailboxPassword,u.devicePassword]),
      ...[...document.querySelectorAll('input')].filter(n=>n.type==='password'||/token|secret|nonce|session/i.test(n.name)).map(n=>n.value)].filter(Boolean);
    const clean=v=>{
      if(typeof v==='string'){
        for(const secret of secrets)v=v.split(secret).join('[hidden]');
        return v.replace(/((?:formtoken\w*|password|authorization|cookie|sessionid)\s*[:=]\s*)[^\s&,;]+/gi,'$1[hidden]');
      }
      if(Array.isArray(v))return v.map(clean);
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)]));
      return v;
    };
    return clean(value);
  }
  function logDiagnostic(u,event){
    if(!u)return;
    const log=u.diagnostics||=([]);
    log.push(cleanDiagnostic({time:new Date().toISOString(),step:diagnosticStep?.key,label:diagnosticStep?.label,attempt:u.attempt||1,...event}));
    if(log.length>1000){log.shift();u.droppedDiagnostics=(u.droppedDiagnostics||0)+1;}
  }
  function diagnosticView(u){
    if(!u.diagnostics?.length)return '';
    return `<details class="diagnostic-log" ${u.error?'open':''}><summary>Diagnostic timeline · ${u.diagnostics.length} events</summary>
      <p>Latest event first. Includes page paths, step timing, response status and selected non-secret fields. Passwords and session tokens are excluded. Download before closing this batch.</p>
      ${btn('download-user-log','Download user report',`data-user="${u.id}"`)}<ol>${u.diagnostics.slice().reverse().map(e=>`<li class="${e.status==='failed'?'failed':''}"><strong>${esc(e.label||'Setup')} · ${esc(e.operation)} · ${esc(e.status)}</strong><small>${esc(e.time)}${e.durationMs!==undefined?' · '+e.durationMs+' ms':''} · attempt ${e.attempt}</small>${e.target||e.page?`<code>${esc(e.target||e.page)}</code>`:''}${e.message?`<p>${esc(e.message)}</p>`:''}${e.status==='failed'?`<pre>${esc(JSON.stringify({fields:e.fields,transport:e.transport,needsRecovery:e.needsRecovery},null,2))}</pre>`:''}</li>`).join('')}</ol></details>`;
  }
  function downloadDiagnostics(selected=users){
    const report=cleanDiagnostic({format:'commpilot-bulk-diagnostics-v1',batchId,exportedAt:new Date().toISOString(),scope:info?.scope,
      users:selected.map(u=>({userId:general?uidDisplay(u):window.CpBulkPhone.localId(u.number)+'@'+engine.domain,department:u.dept,
        expected:general?{phoneNumber:plan(u).number,extension:plan(u).extension,voicemailSetup:plan(u).voicemail,
          profiles:plan(u).profiles.map(p=>({name:p.name,type:p.type,linePort:p.line}))}:undefined,
        error:u.error||null,steps:planSteps(u).map((s,i)=>({step:s.key,label:s.label,status:u.steps[i]})),
        droppedEvents:u.droppedDiagnostics||0,events:u.diagnostics||[]}))});
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='CommPilot-bulk-diagnostics-'+batchId+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function paste() {
    const d=$('.subdialog');d.hidden=false;d.innerHTML=`<header><h3>Paste users</h3>${btn('dismiss',icon('close'),'class="icon-button" aria-label="Close paste users"')}</header><p>Paste four columns from Excel: first name, last name, email, department. Choose each phone number afterward.</p><textarea rows="8" aria-label="User rows"></textarea><p class="paste-error" role="alert"></p><footer>${btn('dismiss','Cancel')}${btn('import','Add pasted users','class="primary"')}</footer>`;showSubdialog(d,'textarea');
  }
  function importRows() {
    const lines=$('.subdialog textarea').value.trim().split(/\r?\n/).filter(Boolean), batch=[];
    const retained=users.filter(u=>u.first||u.last||u.email||u.number);
    if (!lines.length||retained.length+lines.length>200) throw Error('Paste 1–200 users per batch.');
    for (let i=0;i<lines.length;i++) {
      const cols=lines[i].split('\t').map(s=>s.trim()), [first,last,email,dept]=cols;
      if (cols.length!==4||!first||!last||first.length>30||last.length>30||!depts().includes(dept)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Row '+(i+1)+': check names, email and the exact department name.');
      if ([...users,...batch].some(u=>u.email.toLowerCase()===email.toLowerCase())) throw Error('Row '+(i+1)+': duplicate email.');
      batch.push({id:nextId+i,first,last,email,dept,number:'',steps:Array(6).fill('queued'),error:'',
        extension:'',customId:'',caller:'',voicemail:'default',primary:null,sca:null,mailboxPassword:'',devicePassword:''});
    }
    const candidate=retained.concat(batch);
    // Suggestions can fail when the selected extension range is exhausted.
    // Keep the existing batch intact until every pasted row is ready to add.
    if(general)for(const u of batch)suggestExtension(u,candidate);
    users=candidate;nextId+=batch.length;
    render();
  }
  function hidePicker() {
    const anchor=chosen&&$(`[data-pick="${chosen}"]`);
    anchor?.setAttribute('aria-expanded','false');
    chosen=null;pickerState=null;$('.picker').hidden=true;
    if(!busy)anchor?.focus({preventScroll:true});
  }
  function positionPicker() {
    if(!root||!chosen)return;
    const p=$('.picker'),a=$(`[data-pick="${chosen}"]`);if(!a||p.hidden)return;
    const r=a.getBoundingClientRect(),base=root.getBoundingClientRect();
    const left=Math.max(8,base.left+8),right=Math.min(innerWidth-8,base.right-8);
    const top=Math.max(8,base.top+8),bottom=Math.min(innerHeight-8,base.bottom-8);
    p.style.maxHeight=Math.max(100,bottom-top)+'px';
    const height=p.getBoundingClientRect().height,width=p.getBoundingClientRect().width;
    p.style.left=Math.max(left,Math.min(r.left,right-width))+'px';
    const y=r.bottom+5+height<=bottom?r.bottom+5:r.top-height-5;
    p.style.top=Math.max(top,Math.min(y,bottom-height))+'px';
  }
  async function picker(u) {
    if(busy||running||!u?.dept)return;
    if(chosen)hidePicker();
    const state=pickerState={query:'',loading:!pools.has(u.dept),error:''};
    chosen=u.id;const p=$('.picker');p.hidden=false;
    p.innerHTML=`<header><strong>${esc(u.dept)}</strong>${btn('hide-picker',icon('close'),'class="icon-button" aria-label="Close number picker"')}</header><div class="picker-search">${icon('search')}<input type="search" aria-label="Search available numbers" placeholder="Search phone numbers"></div><p>Only numbers with a blank User ID in this department are shown. ${general?'User ID and extension follow your group setup.':'User ID and extension follow your choice.'}</p><div class="number-options"></div>`;
    const a=$(`[data-pick="${u.id}"]`);a.setAttribute('aria-expanded','true');
    numberOptions('');p.querySelector('input').focus({preventScroll:true});
    if(!state.loading)return;
    // Keep the form and picker mounted while native pages are fetched. The generic
    // work() helper rebuilds the dialog and loses its scroll, focus and anchor.
    busy=true;headerState();
    try {
      if(lease.needsRecovery)await lease.recover();
      pools.set(u.dept,await engine.loadNumbers(u.dept));
    } catch(e) {state.error=safeError(e);}
    finally {
      busy=false;state.loading=false;headerState();
      // Closing a pending picker must not let its late response open it again.
      if(root&&pickerState===state)numberOptions(state.query);
    }
  }
  function numberOptions(query) {
    const u=users.find(u=>u.id===chosen);if (!u||!pickerState) return;
    pickerState.query=query;
    if(pickerState.loading) {
      $('.number-options').innerHTML='<p role="status">Loading available numbers…</p>';positionPicker();return;
    }
    if(pickerState.error) {
      $('.number-options').innerHTML=`<p role="alert">${esc(pickerState.error)}</p>${btn('retry-picker','Retry loading numbers')}${general&&config.numberMode==='mixed'?btn('no-number','No personal number'):''}`;positionPicker();return;
    }
    const candidates=(pools.get(u.dept)||[]).filter(n=>n.includes(query.replace(/\D/g,'')));
    $('.number-options').innerHTML=(general&&config.numberMode==='mixed'?btn('no-number','No personal number'):'')+candidates.slice(0,100).map(n=>{
      const inUse=users.some(x=>x!==u&&x.number&&(x.number===n||(!general||config.extensionMode==='did')&&extension(x)===n.slice(-(general?config.length:5))));
      return btn('number',`<span>${format(n)}</span><small>${inUse?'Used in batch':(!general||config.extensionMode==='did')?'ext '+n.slice(-(general?config.length:5)):''}</small>`,`data-number="${n}" ${inUse?'disabled':''}`);
    }).join('');
    if(!candidates.length)$('.number-options').insertAdjacentHTML('beforeend','<p>'+((pools.get(u.dept)||[]).length?'No matching unassigned numbers.':'No unassigned numbers found in this department.')+'</p>');
    if(candidates.length>100) $('.number-options').insertAdjacentHTML('beforeend','<p>Showing 100 numbers. Type more digits to narrow the list.</p>');
    positionPicker();
  }
  async function runBatch() {
    if (running) return;
    running=true;pause=false;notice='';render();
    for (const u of users) {
      if (pause) break;
      u.error='';
      for (let i=0;i<u.steps.length;i++) {
        if (pause) break;
        if (u.steps[i]==='done') continue;
        diagnosticUser=u;diagnosticStep=planSteps(u)[i];
        u.attempts||={};u.attempt=u.attempts[diagnosticStep.key]=(u.attempts[diagnosticStep.key]||0)+1;
        const started=Date.now();logDiagnostic(u,{operation:'step',status:'started'});
        u.steps[i]='running';render();
        try {
          if(general)await engine.stepGroup(u,planSteps(u)[i].key,{...credentials,sip:Object.fromEntries(passwords)});
          else await engine.step(u,i,passwords.get(u.dept));
          u.steps[i]='done';
          logDiagnostic(u,{operation:'step',status:'confirmed',durationMs:Date.now()-started});
        }
        catch (e) {
          logDiagnostic(u,{operation:'step',status:'failed',durationMs:Date.now()-started,message:e.message,...engine.diagnostics?.(),transport:e.bulkDiagnostic});
          u.steps[i]='failed';u.error=safeError(e);if(lease.needsRecovery)pause=true;break;
        }finally{diagnosticUser=null;diagnosticStep=null;}
        render();
      }
    }
    running=false;
    notice=pause?'Batch paused. Completed steps are preserved.':users.some(u=>u.error)?'Batch finished with users needing attention. Check details before retrying.':'All users configured. Registration and calling tests still need to be performed.';
    render();
  }
  async function close() {
    if (busy||running) return;
    await work(async()=>{
      if (lease) {
        try {await lease.navigate(returnNav.url,returnNav.params);} catch(e) { /* Keep the native session notice visible after closing. */ }
        lease.release();
      }
      passwords.clear();users=[];pools.clear();credentials={web:'Easy1234',mailbox:'',device:''};config=null;info=null;savedDefaults=null;startingExtension='';
      root.close();root.remove();root=null;engine=null;lease=null;
      document.dispatchEvent(new Event('cp:reskin'));
    });
    mount();
  }
  async function primary() {
    if(stage<0) await loadSetup();
    else if(general&&stage===4){
      const problems=model.setupErrors(config,info);
      if(problems.length){notice=problems.join(' ');headerState();return;}
      try{
        // Rebuild automatic suggestions in row order. Old suggestions must not
        // reserve numbers against one another after changing the batch start.
        for(const u of users){u.plan=null;if(!u.extensionEdited)u.extension='';}
        for(const u of users)suggestExtension(u);
        stage=0;notice='';render();
      }catch(e){notice=safeError(e);headerState();}
    }
    else if(stage===0) { users.forEach(u=>{u.first=u.first.trim();u.last=u.last.trim();u.email=u.email.trim();});stage=1;notice='';render(); }
    else if(stage===1) await work(async()=>{
      notice='Checking numbers, User IDs and device profile names…';headerState();
      const report=(u,msg)=>{notice=u.first+' '+u.last+': '+msg;headerState();};
      if(general){
        await engine.preflightGroup(users,config,{...credentials,sip:Object.fromEntries(passwords)},report);
        for(const u of users){u.workflow=model.steps(u.plan);u.steps=u.workflow.map(()=>'queued');}
      }else await engine.preflight(users,report);
      stage=2;notice='Review the full configuration, then choose Create.';
    });
    else if(stage===2) {stage=3;await runBatch();}
    else if(running) {pause=!pause;render();}
    else if(pause||users.some(u=>u.error)) {
      if (lease.needsRecovery) {await work(async()=>{await lease.recover();notice='Session checked. Resuming saved setup.';});if(lease.needsRecovery)return;}
      users.forEach(u=>{u.steps=u.steps.map(s=>s==='failed'?'queued':s);});await runBatch();
    }
    else await close();
  }
  function bind() {
    root.addEventListener('scroll',positionPicker,{passive:true});
    root.addEventListener('cancel',e=>{if(e.target!==root)return;e.preventDefault();if (!busy&&!running)close();});
    root.addEventListener('keydown',e=>{
      const popup=$('.subdialog:not([hidden])');
      if(e.key==='Escape'&&(popup||chosen)) {e.preventDefault();if(popup)closeSubdialog();else hidePicker();return;}
      if(popup&&e.key==='Tab') {
        const focusable=[...popup.querySelectorAll('button,input,textarea,select')].filter(n=>!n.matches(':disabled')&&n.getClientRects().length),first=focusable[0],last=focusable.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
      if(chosen&&e.target.type==='search'&&['Enter','ArrowDown'].includes(e.key)) {
        const first=$('.number-options button:not(:disabled)');if(first){e.preventDefault();if(e.key==='Enter')first.click();else first.focus();}
      }
    });
    root.addEventListener('input',e=>{
      const t=e.target;
      if(general){
        if(t.dataset.credential){credentials[t.dataset.credential]=t.value;return;}
        if(t.hasAttribute('data-start')){startingExtension=t.value.replace(/\D/g,'');return;}
        if(t.dataset.setting&&t.tagName==='INPUT'){config[t.dataset.setting]=t.value;users.forEach(u=>u.plan=null);return;}
      }
      if(t.dataset.password!==undefined) {passwords.set(t.dataset.password,t.value);headerState();return;}
      if(t.closest('.picker')&&t.type==='search') {numberOptions(t.value);return;}
      if(t.dataset.field&&t.dataset.field!=='dept') {
        const u=users.find(u=>u.id===+t.dataset.user);u[t.dataset.field]=t.value;
        if(general){u.plan=null;if(t.dataset.field==='extension')u.extensionEdited=true;
          const summary=$('.user-plan-summary');if(summary)summary.textContent=uidDisplay(u);
          const errors=$('.user-errors');if(errors)errors.textContent=model.validate(u,config,info).join(' ');
        }
        headerState();
      }
    });
    root.addEventListener('change',e=>{
      const t=e.target;
      if(general){
        if(t.dataset.setting&&t.tagName==='SELECT'){
          const key=t.dataset.setting;config[key]=key==='primary'?t.value==='true':key==='length'?Number(t.value):t.value;
          users.forEach(u=>u.plan=null);
          if(key==='length')try{startingExtension=model.nextExtension(info.highest,config.length);}catch(e){startingExtension='';notice=safeError(e);}
          if(key==='numberMode'&&config.numberMode==='none')users.forEach(u=>u.number='');
          render();return;
        }
        if(t.dataset.sca){config.sca=['teams','mobile','desktop'].filter(k=>k===t.dataset.sca?t.checked:config.sca.includes(k));users.forEach(u=>u.plan=null);return;}
        if(t.hasAttribute('data-prefix-confirm')){config.prefixChosen=t.checked;return;}
        if(t.dataset.userSca){const u=users.find(u=>u.id===+t.dataset.userSca);u.sca=['teams','mobile','desktop'].filter(k=>k===t.dataset.kind?t.checked:(u.sca||config.sca).includes(k));u.plan=null;headerState();return;}
        if(t.dataset.userPrimary){const u=users.find(u=>u.id===+t.dataset.userPrimary);u.primary=t.checked;u.plan=null;headerState();return;}
      }
      if(t.dataset.field==='dept') {const u=users.find(u=>u.id===+t.dataset.user);u.dept=t.value;u.number='';u.plan=null;if(general)suggestExtension(u);render();}
    });
    root.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b||b.disabled)return;
      if(b.dataset.pick) {await picker(users.find(u=>u.id===+b.dataset.pick));return;}
      if(general&&b.dataset.prefix!==undefined){config.prefix=b.dataset.prefix;config.prefixChosen=true;users.forEach(u=>u.plan=null);render();return;}
      const a=b.dataset.action;
      if((busy||running)&&!['primary','details','dismiss','hide-picker','download-log','download-user-log'].includes(a))return;
      if(a==='primary')await primary();else if(a==='close')await close();else if(a==='back'){stage--;if(general)users.forEach(u=>u.plan=null);notice='';render();}
      else if(a==='download-log')downloadDiagnostics();
      else if(a==='download-user-log')downloadDiagnostics(users.filter(u=>u.id===+b.dataset.user));
      else if(general&&a==='settings'){stage=4;users.forEach(u=>u.plan=null);render();}
      else if(general&&a==='save-defaults')await work(async()=>{
        const problems=model.setupErrors(config,info);if(problems.length)throw Error(problems.join(' '));
        savedDefaults=await defaultsRequest('save');notice='Group defaults saved in this browser. Passwords remain per batch.';
      });
      else if(general&&a==='options')userOptions(users.find(u=>u.id===+b.dataset.user));
      else if(general&&a==='inherit'){const u=users.find(u=>u.id===+b.dataset.user);u.sca=null;u.primary=null;u.plan=null;userOptions(u);}
      else if(general&&a==='ack-secret'){
        const u=users.find(u=>u.id===+b.dataset.user),key=u.uncertainSecret;
        (u.secretReceipts||=new Set()).add(key);const i=planSteps(u).findIndex(s=>s.key===key);if(i>=0)u.steps[i]='done';
        u.uncertainSecret=null;u.error='';render();
      }
      else if(a==='add'){try{if(users.length<200)addRow();}catch(e){notice=safeError(e);}render();}
      else if(a==='remove'){users=users.filter(u=>u.id!==+b.dataset.user);render();}
      else if(a==='paste')paste();else if(a==='import'){try{importRows();}catch(e){$('.paste-error').textContent=safeError(e);}}
      else if(a==='details')details(users.find(u=>u.id===+b.dataset.user));
      else if(a==='dismiss')closeSubdialog();
      else if(a==='reveal'){const input=$('#cp-ub-secret-'+b.dataset.secret);input.type=input.type==='password'?'text':'password';b.setAttribute('aria-label',(input.type==='password'?'Show':'Hide')+' SIP password');}
      else if(a==='number'||general&&a==='no-number'){const u=users.find(u=>u.id===chosen);u.number=a==='no-number'?'':b.dataset.number;
        if(general){u.plan=null;try{suggestExtension(u);}catch(e){notice=safeError(e);}}render();}
      else if(a==='hide-picker')hidePicker();
      else if(a==='retry-picker')await picker(users.find(u=>u.id===chosen));
    });
  }
  async function open() {
    if(root)return;
    const cell=document.querySelector('td[width="82%"]'),rect=cell.getBoundingClientRect();
    const reference={title:cell.querySelector('.cp-frame-title'),input:cell.querySelector('input[type="text"],select'),button:cell.querySelector('.cp-frame-actions input, input[name="ok"]'),row:cell.querySelector('tr[id^="Row"]>td:last-child'),column:cell.querySelector('.listHeader')};
    root=document.createElement('dialog');root.id='cp-user-bulk';root.setAttribute('aria-label','Bulk user creation');
    root.style.setProperty('--bulk-left',Math.max(0,rect.left)+'px');root.style.setProperty('--bulk-top',Math.max(0,rect.top)+'px');
    for(const [kind,node]of Object.entries(reference))if(node){const style=getComputedStyle(node);for(const prop of ['font-family','font-size','font-weight','font-style','line-height','letter-spacing'])root.style.setProperty('--bulk-'+kind+'-'+prop,style.getPropertyValue(prop));}
    document.body.append(root);root.showModal();stage=-1;busy=false;notice='';batchId=crypto.randomUUID();render();bind();
    returnNav={url:'/commpilot/Group/Members/',params:{}};
    await loadSetup();
  }
  async function loadSetup() {
    if(busy||running)return;
    busy=true;notice='';render();
    try {
      if(!lease){lease=await window.cpAcquireUserBulk();engine=general?window.cpCreateBulkEngine(lease):window.cpCreateRsgBulkEngine(lease);engine.observeDiagnostics?.(e=>logDiagnostic(diagnosticUser,e));}
      if(lease.needsRecovery)await lease.recover();
      const loaded=await engine.initialize();users=[];passwords=new Map();pools=new Map();
      if(general){
        info=loaded;config=model.initial(info);
        try{savedDefaults=await defaultsRequest('load');if(savedDefaults)Object.assign(config,savedDefaults);}catch(e){notice=safeError(e);}
        const problems=model.setupErrors(config,info),valid=!problems.length;
        if(savedDefaults&&!valid)notice='Review saved defaults against this group’s current settings. '+problems.join(' ');
        if(config.length<info.limits.min||config.length>info.limits.max)config.length=info.limits.default;
        if(!info.domains.includes(config.domain))config.domain=info.domain;
        try{startingExtension=model.nextExtension(info.highest,config.length);}catch(e){startingExtension='';notice=safeError(e);}
        addRow();stage=savedDefaults&&valid&&(config.extensionMode!=='next'||startingExtension)?0:4;
      }else{addRow();stage=0;}
    }
    catch(e){notice=safeError(e);stage=-1;}
    finally{busy=false;render();}
  }
  function mount() {
    if(root)return;
    const path=document.documentElement.getAttribute('data-cp-path')||location.pathname;
    if(!/^\/commpilot\/Group\/Members\/(?:index\.jsp)?$/.test(path))return;
    if(!general&&![...document.querySelectorAll('.headerAuthLevelLink,.cp-bc-seg')].some(e=>e.textContent.trim()==='RSG'))return;
    const cell=document.querySelector('td[width="82%"]'),add=cell?.querySelector('[name="add"]');
    if(!add||document.getElementById('cp-user-bulk-launch'))return;
    const b=document.createElement('button');b.id='cp-user-bulk-launch';b.type='button';b.textContent='Bulk create users';b.addEventListener('click',open);add.insertAdjacentElement('afterend',b);
  }
  window.addEventListener('beforeunload',e=>{if(root&&(running||users.some(u=>u.createAttempted))){e.preventDefault();e.returnValue='';}});
  window.addEventListener('resize',positionPicker);
  mount();document.addEventListener('cp:reskin',()=>setTimeout(mount,0));
})();
