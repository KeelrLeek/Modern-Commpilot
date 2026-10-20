/* Design B: users and numbers → department passwords → review → checked native saves. */
(function () {
  'use strict';
  if (window!==window.top || window.__cpUserBulkLoaded) return;
  window.__cpUserBulkLoaded=true;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const steps=['User','Alternate ID','VVX','Authentication','Teams SCA','Verify'];
  const icons={users:'<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 3a4 4 0 0 1 0 8M19 15a6 6 0 0 1 3 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',paste:'<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/>',down:'<path d="m7 10 5 5 5-5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4L19 6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',phone:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h8M9 17h6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'};
  const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.check}</svg>`;
  const format=n=>n?'+1 '+n.slice(0,3)+'-'+n.slice(3,6)+'-'+n.slice(6):'';
  let root=null, lease, engine, users=[], passwords=new Map(), pools=new Map(), stage=0, busy=false, pause=false, running=false, nextId=1, chosen=null, pickerState=null, notice='', returnNav;
  const $=s=>root.querySelector(s), depts=()=>engine.departments.map(d=>d.name), used=()=>depts().filter(d=>users.some(u=>u.dept===d));
  const extension=u=>u.number?u.number.slice(-5):'—';
  const complete=u=>u.first.trim()&&u.last.trim()&&u.first.length<=30&&u.last.length<=30&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)&&
    pools.get(u.dept)?.includes(u.number)&&!users.some(x=>x!==u&&(x.email.toLowerCase()===u.email.toLowerCase()||x.number&&(x.number===u.number||extension(x)===extension(u))));
  const ready=()=>users.length>0&&users.every(complete);
  function btn(action,label,extra='') { return `<button type="button" data-action="${action}" ${extra}>${label}</button>`; }
  function rules() { return `<div class="configuration-line"><span>${icon('phone')}VVX primary + Teams SCA for every user</span><span>${icon('users')}Service packs assigned by group</span><span>${icon('lock')}MAC addresses added later</span></div>`; }
  function table() {
    return `<div class="table-scroll"><table class="users-table"><colgroup><col class="c-index"><col class="c-first"><col class="c-last"><col class="c-email"><col class="c-dept"><col class="c-phone"><col class="c-ext"><col class="c-more"></colgroup><thead><tr>${['#','First name','Last name','Email / alternate ID','Department','Available phone number','Extension',''].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${users.map((u,i)=>`<tr data-row="${u.id}"><td>${i+1}</td>${['first','last','email'].map(f=>`<td><input data-field="${f}" data-user="${u.id}" value="${esc(u[f])}" aria-label="${f==='first'?'First name':f==='last'?'Last name':'Email'} for user ${i+1}" ${f==='email'?'type="email" maxlength="80"':'maxlength="30"'} autocomplete="off"></td>`).join('')}<td><select data-field="dept" data-user="${u.id}" aria-label="Department for user ${i+1}"><option value="">Choose department</option>${depts().map(d=>`<option ${u.dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select></td><td><button type="button" class="number-trigger ${u.number?'':'placeholder'}" data-pick="${u.id}" aria-haspopup="dialog" aria-expanded="false" ${!u.dept?'disabled':''}><span>${esc(format(u.number)||'Choose number')}</span>${icon('down')}</button></td><td class="derived">${extension(u)}</td><td>${btn('remove',icon('close'),`class="icon-button" data-user="${u.id}" aria-label="Remove user ${i+1}"`)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function editing() { return `<section class="card"><header class="card-heading"><div><strong>Users to create</strong><span class="count">${users.length} users · ${used().length} departments</span></div><div class="actions">${btn('add',icon('plus')+'Add user')}${btn('paste',icon('paste')+'Paste users')}</div></header>${table()}<div class="table-foot"><span class="batch-summary">${users.filter(complete).length} of ${users.length} ready · choose every number manually</span>${btn('add','Add another user','class="quiet"')}</div>${rules()}</section>`; }
  function credentialPage() { return `<section class="card"><header class="card-heading"><div><strong>Department SIP passwords</strong><span class="count">${used().length} departments</span></div><span class="muted">${users.length} users</span></header><div class="credential-page"><p>Enter the SIP authentication password to use for users in each department.</p><div class="credentials">${used().map((d,i)=>`<div class="credential"><label for="cp-ub-secret-${i}">${esc(d)}<small>${users.filter(u=>u.dept===d).length} users</small></label><div class="password-field"><input id="cp-ub-secret-${i}" type="password" data-password="${esc(d)}" value="${esc(passwords.get(d)||'')}" autocomplete="new-password" aria-label="SIP password for ${esc(d)}">${btn('reveal',icon('eye'),`data-secret="${i}" aria-label="Show SIP password for ${esc(d)}"`)}</div></div>`).join('')}</div></div><div class="configuration-line">${icon('lock')}Portal login uses the standard RSG initial password. Passwords are kept only while this batch is open.</div></section>`; }
  function review() { return `<section class="card"><header class="card-heading"><div><strong>Review before creating</strong><span class="count">Every number was selected manually</span></div><span class="muted">Native checks completed</span></header><div class="review-summary"><strong>${users.length} users</strong><span>${used().length} departments</span><span>${users.length*2} device profiles</span><span>${used().length} SIP passwords entered</span></div><div class="table-scroll"><table class="review-table"><thead><tr><th>User</th><th>User ID / phone number</th><th>Extension</th><th>Device profiles</th><th>Check</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.first)} ${esc(u.last)}<small>${esc(u.dept)} · ${esc(u.email)}</small></td><td>${u.number}@${esc(engine.domain)}<small>${format(u.number)}</small></td><td>${extension(u)}</td><td>RSG VVX ${extension(u)}<small>RSG Teams ${extension(u)}</small></td><td>${btn('details','View setup',`class="quiet" data-user="${u.id}"`)}</td></tr>`).join('')}</tbody></table></div><div class="rules-grid"><div><span>Primary in Addresses</span><strong>Trifecta PolycomVVX400 (Reseller)</strong></div><div><span>Shared call appearance</span><strong>Trifecta Teams (Reseller)</strong></div><div><span>Alternate user ID</span><strong>Same as the entered email</strong></div><div><span>VVX line/port</span><strong>User ID number</strong></div><div><span>Teams line/port</span><strong>User ID number + _Teams</strong></div><div><span>On a failed user</span><strong>Continue the batch; retry the failed step</strong></div></div>${rules()}</section>`; }
  function runView() {
    const done=users.filter(u=>u.steps.every(s=>s==='done')).length, failed=users.filter(u=>u.steps.includes('failed')).length;
    const progress=100*users.reduce((n,u)=>n+u.steps.filter(s=>s==='done').length,0)/(6*users.length);
    return `<section class="card"><div class="run-top"><div class="run-summary"><strong>${running?(pause?'Pausing after the current step':'Creating '+users.length+' users'):done+' configured · '+failed+' needs attention'}</strong><span>Completed steps are preserved for retry</span></div><progress max="100" value="${progress}" aria-label="Batch configuration progress"></progress></div><div class="table-scroll"><table class="run-table"><thead><tr><th>User</th>${['User','Alt. ID','VVX','Auth.','Teams','Verify'].map(s=>`<th class="step-cell">${s}</th>`).join('')}<th>Status</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.first)} ${esc(u.last)}<small>${esc(u.dept)} · ext ${extension(u)}</small></td>${u.steps.map((s,i)=>`<td class="step-cell"><span class="${s}" aria-label="${steps[i]}: ${s}">${s==='done'?icon('check'):s==='failed'?icon('close'):s==='running'?'…':'—'}</span></td>`).join('')}<td><span class="${u.error?'failed':'muted'}">${esc(u.error|| (u.steps.every(s=>s==='done')?'Configured':u.steps.includes('running')?steps[u.steps.indexOf('running')]:'Queued'))}</span>${btn('details','Details',`class="quiet" data-user="${u.id}"`)}</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>Saved configuration is checked. SIP passwords cannot be read back; registration and calling tests are not performed.</span></div></section>`;
  }
  function render() {
    if (!root) return;
    chosen=null;pickerState=null;
    root.innerHTML=`<header class="page-heading"><div>${icon('users')}<h2>Bulk user creation</h2></div><div class="page-actions">${stage>0&&stage<3?btn('back','Back',busy?'disabled':''):''}${stage===3?btn('primary',running?(pause?'Resume batch':'Pause batch'):pause?'Resume batch':users.some(u=>u.error)?'Retry failed users':'Done','class="primary"'):btn('primary',stage<0?(busy?'Loading…':'Retry loading'):stage===0?'Continue to passwords':stage===1?'Review '+users.length+' users':'Create '+users.length+' users','class="primary"')}${btn('close',stage===3?'Close':'Cancel',busy||running?'disabled':'class="quiet"')}</div></header><nav class="stepper" aria-label="Bulk creation steps">${['Users & numbers','Department passwords','Review & create'].map((s,i)=>`<span ${i===Math.min(stage,2)?'aria-current="step"':''}><b>${i+1}</b>${s}</span>`).join('')}</nav><p class="notice" role="status" aria-live="polite">${esc(notice)}</p><div class="batch-content">${busy&&stage<0?'<p>Loading the RSG group configuration…</p>':stage===0?editing():stage===1?credentialPage():stage===2?review():stage===3?runView():''}</div><footer class="workspace-foot"><span>RSG · ${esc(engine?.domain||'')}</span><span>${stage===3?'Keep this tab open until the batch finishes.':'Review every user before creating.'}</span></footer><section class="picker" role="dialog" aria-label="Choose available number" hidden></section><section class="subdialog" role="dialog" aria-modal="true" hidden></section>`;
    headerState();
  }
  function headerState() {
    if (!root) return;
    const primary=$('[data-action="primary"]');
    primary.disabled=busy || (stage===0&&!ready()) || (stage===1&&!used().every(d=>passwords.get(d)?.trim()));
    const status=$('.notice');status.textContent=notice;
    const summary=$('.batch-summary');if(summary)summary.textContent=users.filter(complete).length+' of '+users.length+' ready · choose every number manually';
    root.setAttribute('aria-busy',String(busy));
    const content=$('.batch-content');if(content)content.inert=busy;
  }
  async function work(fn) {
    if (busy) return;
    busy=true;headerState();root.classList.add('is-busy');
    try { await fn(); }
    catch(e) { notice=safeError(e); }
    finally { busy=false;root?.classList.remove('is-busy');render(); }
  }
  function safeError(e) { let message=String(e?.message||'This step could not be confirmed.');for (const p of ['Easy1234',...passwords.values()]) if(p) message=message.split(p).join('[hidden]');return message; }
  function addRow() { users.push({id:nextId++,first:'',last:'',email:'',dept:'',number:'',steps:Array(6).fill('queued'),error:''}); }
  function details(u) {
    const d=$('.subdialog');d.hidden=false;
    d.innerHTML=`<header><h3>${esc(u.first)} ${esc(u.last)}</h3>${btn('dismiss',icon('close'),'class="icon-button" aria-label="Close setup details"')}</header><dl>${Object.entries({'User ID':u.number+'@'+engine.domain,'Department':u.dept,'Email / alternate ID':u.email,'Phone number':format(u.number),'Extension':extension(u),'Primary profile':'RSG VVX '+extension(u),'Primary type':engine.types.vvx,'VVX line/port':u.number,'Teams profile':'RSG Teams '+extension(u),'Teams type':engine.types.teams,'Teams line/port':u.number+'_Teams','MAC address':'Associate later'}).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${stage===3?`<p>${esc(u.error||(u.steps.every(s=>s==='done')?'Saved configuration checked. Registration and calling tests were not performed.':'Setup is not complete. Completed steps are preserved.'))}</p><ul>${u.steps.map((s,i)=>`<li>${steps[i]}: ${s}</li>`).join('')}</ul>`:''}${btn('dismiss','Done','class="primary"')}`;
    d.querySelector('button').focus();
  }
  function paste() {
    const d=$('.subdialog');d.hidden=false;d.innerHTML=`<header><h3>Paste users</h3>${btn('dismiss',icon('close'),'class="icon-button" aria-label="Close paste users"')}</header><p>Paste four columns from Excel: first name, last name, email, department. Choose each phone number afterward.</p><textarea rows="8" aria-label="User rows"></textarea><p class="paste-error" role="alert"></p><footer>${btn('dismiss','Cancel')}${btn('import','Add pasted users','class="primary"')}</footer>`;d.querySelector('textarea').focus();
  }
  function importRows() {
    const lines=$('.subdialog textarea').value.trim().split(/\r?\n/).filter(Boolean), batch=[];
    if (!lines.length||users.length+lines.length>200) throw Error('Paste 1–200 users per batch.');
    for (let i=0;i<lines.length;i++) {
      const cols=lines[i].split('\t').map(s=>s.trim()), [first,last,email,dept]=cols;
      if (cols.length!==4||!first||!last||first.length>30||last.length>30||!depts().includes(dept)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Row '+(i+1)+': check names, email and the exact department name.');
      if ([...users,...batch].some(u=>u.email.toLowerCase()===email.toLowerCase())) throw Error('Row '+(i+1)+': duplicate email.');
      batch.push({id:nextId++,first,last,email,dept,number:'',steps:Array(6).fill('queued'),error:''});
    }
    users=users.filter(u=>u.first||u.last||u.email||u.number).concat(batch);render();
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
    p.innerHTML=`<header><strong>${esc(u.dept)}</strong>${btn('hide-picker',icon('close'),'class="icon-button" aria-label="Close number picker"')}</header><div class="picker-search">${icon('search')}<input type="search" aria-label="Search available numbers" placeholder="Search phone numbers"></div><p>Only numbers with a blank User ID in this department are shown. User ID and extension follow your choice.</p><div class="number-options"></div>`;
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
      $('.number-options').innerHTML=`<p role="alert">${esc(pickerState.error)}</p>${btn('retry-picker','Retry loading numbers')}`;positionPicker();return;
    }
    const candidates=(pools.get(u.dept)||[]).filter(n=>n.includes(query.replace(/\D/g,'')));
    $('.number-options').innerHTML=candidates.slice(0,100).map(n=>{
      const inUse=users.some(x=>x!==u&&x.number&&(x.number===n||extension(x)===n.slice(-5)));
      return btn('number',`<span>${format(n)}</span><small>${inUse?'Used in batch':'ext '+n.slice(-5)}</small>`,`data-number="${n}" ${inUse?'disabled':''}`);
    }).join('')||'<p>'+((pools.get(u.dept)||[]).length?'No matching unassigned numbers.':'No unassigned numbers found in this department.')+'</p>';
    if(candidates.length>100) $('.number-options').insertAdjacentHTML('beforeend','<p>Showing 100 numbers. Type more digits to narrow the list.</p>');
    positionPicker();
  }
  async function runBatch() {
    if (running) return;
    running=true;pause=false;notice='';render();
    for (const u of users) {
      if (pause) break;
      u.error='';
      for (let i=0;i<6;i++) {
        if (pause) break;
        if (u.steps[i]==='done') continue;
        u.steps[i]='running';render();
        try { await engine.step(u,i,passwords.get(u.dept));u.steps[i]='done'; }
        catch (e) {u.steps[i]='failed';u.error=safeError(e);if(lease.needsRecovery)pause=true;break;}
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
      passwords.clear();users=[];pools.clear();root.close();root.remove();root=null;engine=null;lease=null;
      document.dispatchEvent(new Event('cp:reskin'));
    });
    mount();
  }
  async function primary() {
    if(stage<0) await loadSetup();
    else if(stage===0) { users.forEach(u=>{u.first=u.first.trim();u.last=u.last.trim();u.email=u.email.trim();});stage=1;notice='';render(); }
    else if(stage===1) await work(async()=>{notice='Checking numbers, User IDs and device profile names…';headerState();await engine.preflight(users,(u,msg)=>{notice=u.first+' '+u.last+': '+msg;headerState();});stage=2;notice='Review the full configuration, then choose Create.';});
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
    root.addEventListener('cancel',e=>{e.preventDefault();if (!busy&&!running)close();});
    root.addEventListener('keydown',e=>{
      const popup=$('.subdialog:not([hidden])');
      if(e.key==='Escape'&&(popup||chosen)) {e.preventDefault();if(popup)popup.hidden=true;else hidePicker();return;}
      if(popup&&e.key==='Tab') {
        const focusable=[...popup.querySelectorAll('button:not(:disabled),input,textarea,select')],first=focusable[0],last=focusable.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
      if(chosen&&e.target.type==='search'&&['Enter','ArrowDown'].includes(e.key)) {
        const first=$('.number-options button:not(:disabled)');if(first){e.preventDefault();if(e.key==='Enter')first.click();else first.focus();}
      }
    });
    root.addEventListener('input',e=>{
      const t=e.target;
      if(t.dataset.password!==undefined) {passwords.set(t.dataset.password,t.value);headerState();return;}
      if(t.closest('.picker')&&t.type==='search') {numberOptions(t.value);return;}
      if(t.dataset.field&&t.dataset.field!=='dept') {const u=users.find(u=>u.id===+t.dataset.user);u[t.dataset.field]=t.value;headerState();}
    });
    root.addEventListener('change',e=>{const t=e.target;if(t.dataset.field==='dept') {const u=users.find(u=>u.id===+t.dataset.user);u.dept=t.value;u.number='';render();}});
    root.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b||b.disabled)return;
      if(b.dataset.pick) {await picker(users.find(u=>u.id===+b.dataset.pick));return;}
      const a=b.dataset.action;
      if((busy||running)&&!['primary','details','dismiss','hide-picker'].includes(a))return;
      if(a==='primary')await primary();else if(a==='close')await close();else if(a==='back'){stage--;notice='';render();}
      else if(a==='add'){if(users.length<200)addRow();render();}
      else if(a==='remove'){users=users.filter(u=>u.id!==+b.dataset.user);render();}
      else if(a==='paste')paste();else if(a==='import'){try{importRows();}catch(e){$('.paste-error').textContent=safeError(e);}}
      else if(a==='details')details(users.find(u=>u.id===+b.dataset.user));
      else if(a==='dismiss'){$('.subdialog').hidden=true;}
      else if(a==='reveal'){const input=$('#cp-ub-secret-'+b.dataset.secret);input.type=input.type==='password'?'text':'password';b.setAttribute('aria-label',(input.type==='password'?'Show':'Hide')+' SIP password');}
      else if(a==='number'){const u=users.find(u=>u.id===chosen);u.number=b.dataset.number;render();}
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
    document.body.append(root);root.showModal();stage=-1;busy=false;notice='';render();bind();
    returnNav={url:'/commpilot/Group/Members/',params:{}};
    await loadSetup();
  }
  async function loadSetup() {
    if(busy||running)return;
    busy=true;notice='';render();
    try {
      if(!lease){lease=await window.cpAcquireUserBulk();engine=window.cpCreateRsgBulkEngine(lease);}
      if(lease.needsRecovery)await lease.recover();
      await engine.initialize();users=[];passwords=new Map();pools=new Map();addRow();stage=0;
    }
    catch(e){notice=safeError(e);stage=-1;}
    finally{busy=false;render();}
  }
  function mount() {
    if(root)return;
    const path=document.documentElement.getAttribute('data-cp-path')||location.pathname;
    if(!/^\/commpilot\/Group\/Members\/(?:index\.jsp)?$/.test(path))return;
    if(![...document.querySelectorAll('.headerAuthLevelLink,.cp-bc-seg')].some(e=>e.textContent.trim()==='RSG'))return;
    const cell=document.querySelector('td[width="82%"]'),add=cell?.querySelector('[name="add"]');
    if(!add||document.getElementById('cp-user-bulk-launch'))return;
    const b=document.createElement('button');b.id='cp-user-bulk-launch';b.type='button';b.textContent='Bulk create users';b.addEventListener('click',open);add.insertAdjacentElement('afterend',b);
  }
  window.addEventListener('beforeunload',e=>{if(root&&(running||users.some(u=>u.createAttempted))){e.preventDefault();e.returnValue='';}});
  window.addEventListener('resize',positionPicker);
  mount();document.addEventListener('cp:reskin',()=>setTimeout(mount,0));
})();
