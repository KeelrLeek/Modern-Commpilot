const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const extension=path.resolve(process.env.BW_TEST_EXTENSION_PATH||root);
const full=process.env.BW_TEST_FULL_EXTENSION==='1';
const origin='https://apps-sbx.avpaas.io';
const sp='/commpilot/Reseller/ServiceProviders/Modify/index.jsp';
const group='/commpilot/ServiceProvider/Members/Modify/index.jsp';
const user='/commpilot/Group/Members/Modify/index.jsp';
const profile='/commpilot/User/Profile/';
const home='/commpilot/Reseller/Profile/';
async function setup({boards=false,wrongRestore=false,descriptions=false,userNames=false,holdFirstProfile=false}={}){
 const options={executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true};
 let browser,context;
 if(full){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bw-recent-'));
  context=await chromium.launchPersistentContext(temp,{...options,viewport:{width:1100,height:800},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  assert.ok(await worker.evaluate(()=>chrome.runtime.getManifest().content_scripts.some(entry=>entry.js?.includes('src/content/recent-history.js'))),'loaded extension contains shared history module: '+extension);
  await worker.evaluate(()=>chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['ruleset_1']}));
  await worker.evaluate(()=>chrome.storage.local.set({cpThemePalette:'graphite',cpSettings:{peek:false}}));
  browser={close:async()=>{await context.close();assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'bw-recent-'));fs.rmSync(temp,{recursive:true,force:true});}};
 }else{
  browser=await chromium.launch(options);
  context=await browser.newContext({viewport:{width:1100,height:800}});
 }
 const page=await context.newPage();
 await page.addInitScript(()=>{
  window.nativeFallbacks=[];
  window.redirectPost=(url,params)=>window.nativeFallbacks.push({url,params});
 });
 let level='R', selectedGroup='', selectedUser='', token=0, saves=0, reject=false, validContext=true, userEntries=0;
 const posts=[];
 let releaseProfile, profileHeld=false;
 const profileGate=new Promise(resolve=>{releaseProfile=resolve;});
 const html=(title,boardFolder)=>{
  const names=['Reseller'];
  if(level!=='R')names.push('Acme SP');
  if(level==='U')names.push(selectedGroup,'Users');
  if(level==='G'){};
  const entity=level==='G'?selectedGroup:level==='U'?selectedUser:'';
  const links=boards?(level==='U'?['Profile','Incoming Calls','Call Control']:[level+' Profile','Resources','Services']):['Profile'];
  const sidebar=links.map((label,i)=>`<a class="${i?'leftnavfolder':'leftnavfolderopen'}" data-cp-folder="${level}${i}" data-cp-menuid="${{R:8,S:2,G:1,U:0}[level]}">${label}</a>`).join('');
  const menu=boardFolder?`<table><tr><td class="menuCategory">Basic</td></tr><tr><td><a class="navMenuItem" name="/User/Profile/" onclick="redirectPost('${profile}',{})">Profile</a></td></tr><tr><td>Configure the selected user.</td></tr></table>`:
   userNames&&title==='Profile'&&level==='U'?`<input name="firstName" value="${selectedUser}"><input name="lastName" value="Example">`:'';
  const tip=descriptions?`<tr><td class="tip"><strong>${title}</strong>${title} allows you to view and maintain your profile information.</td></tr>`:'';
  return `<!doctype html><html data-cp-direction="graphite"><head><title>${title}</title></head><body id="initBody.menuTemplate"><table><tr><td class="headerBar">${names.map(n=>'<a class="headerAuthLevelLink">'+n+'</a>').join(' &gt; ')}${entity?'<span class="headerAuthLevel" data-cp-extension-state="done">'+entity+'</span>':''}</td></tr></table><form name="leftNavForm">${sidebar}</form><table><tr><td width="82%" valign="top"><form name="mainForm" method="post"><input name="formtokenserial" value="t-${++token}" type="hidden"><table><tr><td class="screenName">${title}</td></tr>${tip}<tr><td class="enduserbody">${menu||`<div id="selected">${selectedUser||selectedGroup||level}</div><input name="description" value="Draft"><input type="password" name="password" value="do-not-store"><input type="submit" name="apply" value="Apply">`}</td></tr></table></form></td></tr></table><script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;
 };
 await page.route(origin+'/**',async route=>{
  const req=route.request(), url=new URL(req.url()), data=new URLSearchParams(req.postData()||'');
  if(req.method()==='POST'){
   posts.push({url:url.pathname,search:url.search,params:Object.fromEntries(data)});
   assert.equal(data.get('formtokenserial'),'t-'+token,'every POST threads the latest token; recent fixture routes: '+
    JSON.stringify(posts.slice(-8).map(post=>({path:post.url,folder:post.params.folder}))));
  }
  if(reject && url.pathname===profile)return route.fulfill({status:500,body:'Failed'});
  if(data.has('apply'))saves++;
  const folder=data.get('folder')||'';
  if(url.pathname.includes('folder_contents')){
   if(boards && /^[SGU]/.test(folder)){validContext=false;}
   else{level='R';selectedGroup='';selectedUser='';validContext=true;}
  }
  if(url.pathname===sp){level='S';selectedGroup='';selectedUser='';validContext=true;}
  if(url.pathname===group){if(!boards)assert.equal(level,'S');level='G';selectedGroup=data.get('key').split('>%').at(-1);selectedUser='';validContext=true;}
  if(url.pathname===user){if(!boards)assert.equal(level,'G');assert.ok(data.get('key').includes('>%'+selectedGroup+'>%'));level='U';selectedUser=data.get('key').split('>%').at(-1);validContext=true;
   if(wrongRestore && ++userEntries>1){level='G';selectedUser='';}
  }
  if(url.pathname.startsWith('/commpilot/User/')){assert.equal(level,'U','user context restored before page opens');assert.equal(validContext,true,'folder reads must restore the user before opening another page');}
  const board=boards && ([sp,group,user].includes(url.pathname)||/^[SGU]/.test(folder));
  const body=html(url.pathname===profile?'Profile':url.pathname===home?'Reseller Profile':'Location',board);
  if(holdFirstProfile && url.pathname===profile && !profileHeld){profileHeld=true;await profileGate;}
  return route.fulfill({status:200,contentType:'text/html',body});
 });
 await page.goto(origin+home);
 if(!full){
  for(const file of ['native-theme.css','theme-palettes.css','page-baseline.css'])await page.addStyleTag({path:path.join(extension,'src/content',file)});
  for(const file of ['recent-history.js','pjax.js','crumbs.js'])await page.addScriptTag({path:path.join(extension,'src/content',file)});
 }
 await page.locator('button.cp-bc-history').waitFor();
 const nav=async(url,params={})=>{
  const before=token;
  await page.evaluate(({url,params})=>window.redirectPost(url,params),{url,params});
  await page.waitForFunction(({url,before})=>location.pathname===url && document.documentElement.dataset.cpNav!=='busy' && document.querySelector('input[name="formtokenserial"]')?.value!=='t-'+before,{url,before});
 };
 const visit=async(g,u)=>{await nav(sp,{key:'Acme SP',P_key:'Acme SP'});await nav(group,{key:'Acme SP>%'+g});await nav(user,{key:'Acme SP>%'+g+'>%'+u});await nav(profile);};
 return{browser,page,nav,visit,posts,releaseProfile,getSaves:()=>saves,getGroup:()=>selectedGroup,getContext:()=>({level,selectedUser,validContext}),setReject:v=>reject=v,close:()=>{releaseProfile();return browser.close();}};
}
test('leaving a user board retains the token from its cancelled background name read',async()=>{
 const f=await setup({boards:true,userNames:true,holdFirstProfile:true});try{
  f.page.setDefaultTimeout(6000);
  await f.nav(sp,{key:'Acme SP'});await f.nav(group,{key:'Acme SP>%Group A'});
  const read=f.page.waitForRequest(request=>new URL(request.url()).pathname===profile);
  await f.nav(user,{key:'Acme SP>%Group A>%Alice'});await read;
  const opening=f.nav(profile);
  // Observe the queued navigation before releasing the already-consumed token.
  await f.page.waitForTimeout(100);
  assert.equal(f.posts.filter(post=>post.url===profile).length,1);
  f.releaseProfile();await opening;
  assert.equal(f.posts.filter(post=>post.url===profile).length,2);
  await f.nav('/commpilot/User/DND/');
  assert.equal(f.getContext().selectedUser,'Alice');
  assert.equal(f.getSaves(),0);
  assert.ok(f.posts.every(post=>!/(?:Login|Logout)/i.test(post.url)));
 }finally{await f.close();}
});
for(const url of ['/commpilot/%4cogout/','/commpilot/Group/Members/%41dd/index.jsp',
 '/commpilot/Group/Profile/?apply=1','/commpilot/Group/Profile/?unknownAction=delete'])
test('recent locations reject an encoded mutation route: '+url,async()=>{
 const f=await setup();try{
  const before=f.posts.length;
  await f.page.evaluate(url=>{
   sessionStorage.setItem('cp-recent-locations',JSON.stringify([{id:'damaged',label:'Old location',nav:{url,params:{}},chain:[]} ]));
   window.postMessage({__cpRecentOpen:'damaged'},location.origin);
  },url);
  await f.page.waitForTimeout(250);
  assert.equal(await f.page.evaluate(()=>window.nativeFallbacks.length),0,'unsafe saved paths must not reach native navigation');
  assert.equal(f.posts.length,before,'unsafe saved paths must not send a POST');
 }finally{await f.close();}
});

test('recent locations record and restore a read-only calling-plan tab query',async()=>{
 const f=await setup();try{
  const target='/commpilot/Group/Calling_Plan/Outgoing/index.jsp?TransferForward=1&isEnh=true';
  await f.nav(sp,{key:'Acme SP'});await f.nav(group,{key:'Acme SP>%Group A'});
  await f.page.evaluate(target=>window.redirectPost(target,{}),target);
  await f.page.waitForFunction(target=>location.pathname+location.search===target&&document.documentElement.dataset.cpNav!=='busy',target);
  await f.page.waitForTimeout(100);
  const saved=await f.page.evaluate(target=>JSON.parse(sessionStorage.getItem('cp-recent-locations')||'[]').find(r=>r.nav.url===target),target);
  assert.ok(saved,'read-only tab is recorded instead of silently omitted');
  await f.nav('/commpilot/Group/Profile/');
  await f.page.evaluate(id=>window.postMessage({__cpRecentOpen:id},location.origin),saved.id);
  await f.page.waitForFunction(target=>location.pathname+location.search===target&&document.documentElement.dataset.cpNav!=='busy',target);
  assert.equal(f.posts.at(-1).search,'?TransferForward=1&isEnh=true');
  assert.equal(f.getContext().level,'G');
  assert.equal(f.getSaves(),0);
 }finally{await f.close();}
});

test('history menu still opens when the current browser state has damaged ancestry',async()=>{
 const f=await setup();try{
  const errors=[];f.page.on('pageerror',error=>errors.push(error.message));
  await f.visit('Group A','Alice');
  await f.page.evaluate(()=>history.replaceState({...history.state,cpRecentChain:[null]},'',location.href));
  await f.page.locator('button.cp-bc-history').click();
  assert.ok(await f.page.locator('#cp-bc-history-menu button[data-recent-id]').count()>0);
  assert.deepEqual(errors,[]);
 }finally{await f.close();}
});

test('user boards load names through the serialized read queue and preserve the next user navigation',async()=>{
 const f=await setup({boards:true,userNames:true});try{
  if(!full)await f.page.addScriptTag({path:path.join(extension,'src/content/enhancer.js')});
  await f.nav(sp,{key:'Acme SP'});await f.nav(group,{key:'Acme SP>%Group A'});await f.nav(user,{key:'Acme SP>%Group A>%Alice'});
  await f.page.waitForFunction(()=>document.querySelector('.cp-name-chip')?.textContent==='Alice Example');
  assert.equal(f.getContext().selectedUser,'Alice');
  await f.page.locator('button.cp-bc-history').click();
  await f.page.getByRole('menuitemcheckbox',{name:'Include menu visits'}).check();
  assert.equal(await f.page.getByRole('group',{name:'User Alice',exact:true}).locator('.cp-history-location-title').textContent(),'Alice Example');
  await f.page.keyboard.press('Escape');
  await f.page.locator('.cp-console a.navMenuItem').first().click();
  await f.page.waitForFunction(()=>location.pathname==='/commpilot/User/Profile/' && document.querySelector('.cp-name-chip')?.textContent==='Alice Example');
  await f.nav('/commpilot/User/DND/');
  assert.equal(f.getContext().validContext,true);
  assert.equal(f.getSaves(),0);
 }finally{await f.close();}
});

test('history labels exclude the page info description and controls, whether the info card is hidden or open',async()=>{
 const f=await setup({descriptions:true});try{
  if(!full)await f.page.addScriptTag({path:path.join(extension,'src/content/forms.js')});
  await f.visit('Group A','Alice');
  await f.nav('/commpilot/User/DND/');
  await f.page.locator('.cp-frame-about').waitFor({state:'attached'});
  assert.match(await f.page.locator('td.screenName').textContent(),/allows you to view/,'fixture contains description inside the title cell');
  for(const open of [false,true]){
   if(open)await f.page.locator('.cp-frame-info').click();
   await f.page.evaluate(()=>{
    const action=document.createElement('button');action.textContent='Extra action';action.type='button';
    document.querySelector('td.screenName').appendChild(action);
    document.dispatchEvent(new Event('cp:recent-record'));
   });
   await f.page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cp-recent-locations')).find(row=>row.nav.url==='/commpilot/User/DND/')?.label==='Location');
   assert.equal(await f.page.locator('.cp-frame-about').isVisible(),open,'capturing a title leaves the real info card intact');
  }
  const id=await f.page.evaluate(()=>JSON.parse(sessionStorage.getItem('cp-recent-locations')).find(row=>row.nav.url==='/commpilot/User/DND/').id);
  await f.page.locator('button.cp-bc-history').click();
  assert.equal(await f.page.locator('#cp-bc-history-menu button[data-recent-id="'+id+'"] strong').textContent(),'Location');
  assert.equal(await f.page.locator('#cp-bc-history-menu').getByText(/allows you to view/).count(),0);
 }finally{await f.close();}
});

test('history from a fresh sign-in restores a user board and keeps the next page in that user context',async()=>{
 const f=await setup({boards:true});try{
  await f.page.evaluate(({sp,group,user})=>sessionStorage.setItem('cp-recent-locations',JSON.stringify(['Alice','Bob'].map((name,index)=>{
   const groupName='Group '+(index?'B':'A');
   return {id:'saved-user-'+name,label:'User menu',context:'Acme SP › '+groupName+' › '+name,nav:{url:user,params:{key:'Acme SP>%'+groupName+'>%'+name}},chain:[
    {url:'/commpilot/Common/folder_contents.jsp',params:{folder:'R0',menuId:'8'}},
    {url:sp,params:{key:'Acme SP'}},{url:group,params:{key:'Acme SP>%'+groupName}}]};
  }))),{sp,group,user});
  // First restore from the sign-in landing; then change users with the same sidebar signature.
  for(const [name,groupName] of [['Alice','Group A'],['Bob','Group B']]){
   await f.page.locator('button.cp-bc-history').click();
   await f.page.getByRole('menuitemcheckbox',{name:'Include menu visits'}).check();
   await f.page.locator('#cp-bc-history-menu button[data-recent-id="saved-user-'+name+'"]').click({noWaitAfter:true});
   await f.page.waitForFunction(()=>document.querySelectorAll('.cp-console-body[data-cp-loaded="1"]').length===3);
   await f.page.locator('td.headerBar [data-cp-crumb-menu]').waitFor();
   assert.deepEqual(f.getContext(),{level:'U',selectedUser:name,validContext:true},'completed board restores the user, not its parent group');
   const restore=f.posts.filter(p=>[sp,group,user].includes(p.url)).at(-1);
   assert.equal(restore.url,user);
   assert.equal(restore.params.key,'Acme SP>%'+groupName+'>%'+name);
   await f.page.locator('.cp-console a.navMenuItem').first().click();
   await f.page.waitForFunction(name=>location.pathname==='/commpilot/User/Profile/'&&document.querySelector('#selected')?.textContent===name,name);
   await f.nav('/commpilot/User/DND/');
   assert.equal(await f.page.locator('#selected').textContent(),name);
  }
 }finally{await f.close();}
});
test('a wrong-level board restore blocks the next option instead of posting with a missing user',async()=>{
 const f=await setup({boards:true,wrongRestore:true});try{
  await f.page.evaluate(({sp,group,user})=>sessionStorage.setItem('cp-recent-locations',JSON.stringify([{
   id:'bad-board-restore',label:'User menu',nav:{url:user,params:{key:'Acme SP>%Group A>%Alice'}},chain:[
    {url:sp,params:{key:'Acme SP'}},{url:group,params:{key:'Acme SP>%Group A'}}]
  }])),{sp,group,user});
  await f.page.locator('button.cp-bc-history').click();
  await f.page.getByRole('menuitemcheckbox',{name:'Include menu visits'}).check();
  await f.page.locator('#cp-bc-history-menu button[data-recent-id="bad-board-restore"]').click({noWaitAfter:true});
  await f.page.locator('.cp-console-error').waitFor();
  const before=f.posts.length;
  await f.page.locator('.cp-console a.navMenuItem').first().click();
  assert.equal(f.posts.length,before,'no user request is sent with the wrong entity context');
  assert.notEqual(new URL(f.page.url()).pathname,'/commpilot/Login/');
 }finally{await f.close();}
});

test('location headings open the user, group and provider base with only their parent context restored',async()=>{
 const f=await setup({boards:true});try{
  await f.page.evaluate(({sp,group,user})=>{
   const chain=[{url:'/commpilot/Common/folder_contents.jsp',params:{folder:'R0',menuId:'8'}},
    {url:sp,params:{key:'Acme SP'}},{url:group,params:{key:'Acme SP>%Group A'}},{url:user,params:{key:'Acme SP>%Group A>%Alice'}}];
   sessionStorage.setItem('cp-recent-locations',JSON.stringify([
    {id:'alice-passwords',label:'Passwords',context:'Reseller › Acme SP › Group A › Alice',nav:{url:'/commpilot/User/Passwords/',params:{}},chain},
    {id:'group-profile',label:'Profile',context:'Reseller › Acme SP › Group A',nav:{url:'/commpilot/Group/Profile/',params:{}},chain:chain.slice(0,3)},
    {id:'provider-profile',label:'Profile',context:'Reseller › Acme SP',nav:{url:'/commpilot/ServiceProvider/Profile/',params:{}},chain:chain.slice(0,2)}
   ]));
  },{sp,group,user});
  for(const [label,url,level]of [['user Alice',user,'U'],['group Group A',group,'G'],['service provider Acme SP',sp,'S']]){
   await f.page.locator('button.cp-bc-history').click();
   const before=f.posts.length;
   const heading=f.page.getByRole('menuitem',{name:'Open '+label,exact:true});
   if(level==='U'){await heading.focus();await f.page.keyboard.press('Enter');}else await heading.click();
   await f.page.waitForFunction(url=>location.pathname===url && document.documentElement.dataset.cpNav!=='busy' && document.querySelectorAll('.cp-console-body[data-cp-loaded="1"]').length===3,url);
   await f.page.locator('td.headerBar [data-cp-crumb-menu]').waitFor();
   assert.equal(f.getContext().level,level);
   assert.equal(f.getContext().validContext,true,label+' base board restores its entity after menu reads: '+JSON.stringify(f.posts.slice(before)));
   const firstEntity=f.posts.slice(before).filter(p=>[sp,group,user].includes(p.url));
   assert.equal(firstEntity[0].url,sp,'ancestry begins at service provider');
   assert.equal(firstEntity.at(-1).url,url,'board finishes in the selected base context');
   assert.equal(await f.page.locator('#cp-bc-history-menu').isVisible(),false);
   if(level==='U'){
    await f.page.locator('.cp-console a.navMenuItem').first().click();
    await f.page.waitForFunction(()=>location.pathname==='/commpilot/User/Profile/' && document.querySelector('#selected')?.textContent==='Alice');
    await f.nav('/commpilot/User/DND/');
    assert.equal(f.getContext().selectedUser,'Alice');
   }
  }
  assert.equal(f.getSaves(),0,'heading jumps never submit form changes');
 }finally{await f.close();}
});
test('recent locations distinguish users, restore full ancestry invisibly, and never replay a save',async()=>{
 const f=await setup();try{
  await f.visit('Group A','Alice');
  await f.page.locator('input[name="description"]').fill('Secret draft');
  const oldToken=await f.page.locator('input[name="formtokenserial"]').inputValue();
  await f.page.locator('input[name="apply"]').click();
  await f.page.waitForFunction(old=>document.documentElement.dataset.cpNav!=='busy' && document.querySelector('[name="formtokenserial"]').value!==old,oldToken);
  await f.visit('Group B','Bob');
  const spacing=await f.page.evaluate(()=>{
   const button=document.querySelector('button.cp-bc-history'), next=button.nextElementSibling;
   const a=button.getBoundingClientRect(),b=next.getBoundingClientRect(),s=getComputedStyle(button);
   return {clear:a.right<=b.left,button:a.toJSON(),next:b.toJSON(),position:s.position,margin:s.margin,width:s.width,display:s.display,bar:getComputedStyle(button.parentElement).display};
  });
  assert.equal(spacing.clear,true,JSON.stringify(spacing));
  await f.page.locator('button.cp-bc-history').click();
  assert.equal(await f.page.locator('button.cp-bc-history').evaluate(el=>el.getBoundingClientRect().right<=el.nextElementSibling.getBoundingClientRect().left),true,'opening history does not overlap the first breadcrumb');
  const alice=f.page.getByRole('group',{name:'User Alice',exact:true}).locator('button[data-recent-id]').filter({has:f.page.locator('strong',{hasText:/^Profile$/})});
  assert.equal(await alice.count(),1,await f.page.evaluate(()=>sessionStorage.getItem('cp-recent-locations')));
  await f.page.screenshot({path:path.join(root,'dev-preview/sca-designs/recent-locations.png'),animations:'disabled'});
  await f.page.evaluate(()=>{window.returnPaints=[];new MutationObserver(()=>window.returnPaints.push(document.querySelector('#selected')?.textContent)).observe(document.querySelector('td[width="82%"]'),{childList:true,subtree:true});});
  const before=f.posts.length;
  await alice.click({noWaitAfter:true});
  await f.page.waitForFunction(()=>location.pathname==='/commpilot/User/Profile/'&&document.querySelector('#selected')?.textContent==='Alice');
  assert.deepEqual(f.posts.slice(before).map(p=>p.url),['/commpilot/Common/folder_contents.jsp',sp,group,user,profile]);
  assert.ok((await f.page.evaluate(()=>window.returnPaints)).every(text=>text==='Alice'),'only final destination paints');
  assert.equal(f.getSaves(),1);
  const stored=await f.page.evaluate(()=>sessionStorage.getItem('cp-recent-locations'));
  for(const secret of ['do-not-store','Secret draft','password','formtokenserial','description'])assert.ok(!stored.includes(secret),secret+' excluded');
  assert.equal(await f.page.locator('button.cp-bc-history').getAttribute('aria-expanded'),'false');
  await f.page.goBack();
  await f.page.waitForFunction(()=>document.querySelector('#selected')?.textContent==='Bob');
  assert.equal(f.getSaves(),1,'Back after a history jump also restores the previous user without saving');
 }finally{await f.close();}
});
test('history menu supports keyboard, refresh, viewport bounds and clearing',async()=>{
 const f=await setup();try{
  await f.visit('Group A','Alice');
  await f.page.locator('button.cp-bc-history').focus();
  await f.page.keyboard.press('ArrowDown');
  assert.equal(await f.page.locator('#cp-bc-history-menu').isVisible(),true);
  await f.page.keyboard.press('End');
  assert.equal(await f.page.evaluate(()=>document.activeElement===document.querySelector('#cp-bc-history-menu button:last-child')||document.activeElement.matches('input[aria-label="Include menu visits"]')),true);
  await f.page.keyboard.press('Escape');
  assert.equal(await f.page.locator('button.cp-bc-history').evaluate(el=>el===document.activeElement),true);
  await f.page.reload();
  if(!full){
   for(const file of ['native-theme.css','theme-palettes.css','page-baseline.css'])await f.page.addStyleTag({path:path.join(extension,'src/content',file)});
   for(const file of ['recent-history.js','pjax.js','crumbs.js'])await f.page.addScriptTag({path:path.join(extension,'src/content',file)});
  }
  await f.page.setViewportSize({width:390,height:600});
  await f.page.locator('button.cp-bc-history').click();
  assert.ok(await f.page.locator('#cp-bc-history-menu button[data-recent-id]').count()>1,'survives refresh');
  assert.equal(await f.page.locator('#cp-bc-history-menu').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),true);
  await f.page.locator('.cp-history-clear').click();
  await f.page.waitForFunction(()=>!sessionStorage.getItem('cp-recent-locations'));
  await f.page.locator('button.cp-bc-history').click();
  assert.equal(await f.page.locator('.cp-history-empty').isVisible(),true);
  await f.page.mouse.click(385,590);
  assert.equal(await f.page.locator('#cp-bc-history-menu').isVisible(),false);
 }finally{await f.close();}
});
test('grouped history carries old visits forward and distinguishes same-name group and provider',async()=>{
 const f=await setup();try{
  await f.page.evaluate(({sp,group,user})=>{
   const context='Reseller › Trifecta Solutions › RSG › 8164127594@phonenetwork.net';
   const chain=[{url:sp,params:{key:'Trifecta Solutions'}},{url:group,params:{key:'Trifecta Solutions>%RSG'}},{url:user,params:{key:'Trifecta Solutions>%RSG>%8164127594@phonenetwork.net'}}];
   const record=(id,label,url,params={},trail=context,entries=chain)=>({id,label,context:trail,nav:{url,params},chain:entries,at:Date.now()-60000});
   sessionStorage.setItem('cp-recent-locations',JSON.stringify([
    record('passwords','Passwords','/commpilot/User/Passwords/'),record('repeat-passwords','Passwords','/commpilot/User/Passwords/index.jsp'),
    record('profile','Profile','/commpilot/User/Profile/'),record('schedules','Schedules','/commpilot/User/Schedules/'),record('assign','Assign Services','/commpilot/User/AssignServices/'),
    record('user-menu','Profile',user,{key:'Trifecta Solutions>%RSG>%8164127594@phonenetwork.net'}),
    record('group-users','Users','/commpilot/Group/Members/',{},'Reseller › Trifecta Solutions › RSG',chain.slice(0,2)),
    record('other-group','Profile','/commpilot/Group/Profile/',{},'Reseller › Trifecta Solutions › Trifecta Solutions',[{url:group,params:{key:'Trifecta Solutions>%Trifecta Solutions'}}]),
    record('groups','Groups','/commpilot/ServiceProvider/Members/',{},'Reseller › Trifecta Solutions',chain.slice(0,1)),
    record('repeat-groups','Groups','/commpilot/Common/find.jsp',{returnPage:'/ServiceProvider/Members/',key:'0',value:'test'},'Reseller › Trifecta Solutions',chain.slice(0,1)),
    record('provider','Profile','/commpilot/ServiceProvider/Profile/',{},'Reseller › Trifecta Solutions',chain.slice(0,1))
   ]));
  },{sp,group,user});
  await f.page.evaluate(()=>document.dispatchEvent(new Event('cp:recent-change')));
  await f.page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('cp-recent-locations')).length===9);
  assert.equal(await f.page.evaluate(()=>JSON.parse(sessionStorage.getItem('cp-recent-locations'))[0].id),'passwords','cleanup retains the newest original navigation target');
  await f.page.locator('button.cp-bc-history').click();
  const menu=f.page.locator('#cp-bc-history-menu');
  assert.equal(await menu.locator('.cp-history-location').count(),4);
  assert.equal(await menu.locator('button[data-recent-id]').count(),8,'duplicates and menu visits are omitted');
  assert.equal(await f.page.getByRole('group',{name:'Group Trifecta Solutions',exact:true}).count(),1);
  assert.equal(await f.page.getByRole('group',{name:'Service provider Trifecta Solutions',exact:true}).count(),1);
  assert.equal(await menu.locator('button[data-recent-id] svg').count(),8,'every page has an icon');
  assert.equal(await menu.locator('.cp-history-location-meta').first().textContent(),'User · RSG');
  await f.page.getByRole('menuitemcheckbox',{name:'Include menu visits'}).check();
  assert.equal(await menu.locator('button[data-recent-id]').count(),9,'menu visits remain available on request');
  await f.page.getByRole('menuitemcheckbox',{name:'Include menu visits'}).uncheck();
  await f.page.evaluate(()=>document.documentElement.dataset.cpDirection='rosepine-light');
  await menu.screenshot({path:path.join(root,'dev-preview/history-designs/implemented-b-light.png'),animations:'disabled'});
  await f.page.evaluate(()=>document.documentElement.dataset.cpDirection='graphite');
  await menu.screenshot({path:path.join(root,'dev-preview/history-designs/implemented-b-dark.png'),animations:'disabled'});
 }finally{await f.close();}
});
test('repeated entity navigation keeps one history menu and bounded page DOM without stale context',async t=>{
 const visits=Number(process.env.BW_SOAK_VISITS||20);
 assert.ok(Number.isInteger(visits)&&visits>=20&&visits<=500,'BW_SOAK_VISITS must be an integer from 20 to 500');
 const boards=process.env.BW_SOAK_BOARDS==='1';
 const f=await setup({boards});try{
  const errors=[];f.page.on('pageerror',error=>errors.push(error.message));
  await f.visit('Group 0','User 0');
  const sizes=[];
  const heap=process.env.BW_SOAK_HEAP==='1'?await f.page.context().newCDPSession(f.page):null;
  const samples=[];
  for(let i=0;i<visits;i++){
   await f.visit('Group '+i,'User '+i);
   await f.page.locator('button.cp-bc-history').click();
   assert.equal(await f.page.locator('#cp-bc-history-menu').count(),1);
   await f.page.keyboard.press('Escape');
   sizes.push(await f.page.evaluate(()=>{
    const menus=Object.keys(sessionStorage).filter(key=>key.startsWith('cp-page-menu:'));
    return {nodes:document.querySelectorAll('*').length,scripts:document.scripts.length,
     recent:JSON.parse(sessionStorage.getItem('cp-recent-locations')||'[]').length,
     menuRecords:menus.length,menuChars:menus.reduce((sum,key)=>sum+(sessionStorage.getItem(key)||'').length,0)};
   }));
   assert.equal(f.getContext().selectedUser,'User '+i);
   assert.equal(f.getGroup(),'Group '+i);
   if(heap && ((i+1)%50===0 || i===visits-1)){
    await heap.send('HeapProfiler.collectGarbage');
    const memory=await heap.send('Runtime.getHeapUsage');
    const dom=await heap.send('Memory.getDOMCounters');
    const sample={visits:i+1,...memory,...dom,menuRecords:sizes.at(-1).menuRecords,menuChars:sizes.at(-1).menuChars};samples.push(sample);
    t.diagnostic('heap '+JSON.stringify(sample));
   }
  }
  t.diagnostic(JSON.stringify({visits,boards,requests:f.posts.length,first:sizes[0],last:sizes.at(-1),maxNodes:Math.max(...sizes.map(s=>s.nodes))}));
  assert.ok(sizes.every(s=>s.recent<=30),'recent records remain bounded across distinct entities');
  assert.ok(sizes.every(s=>s.menuRecords<=64),'page-menu caches remain bounded across distinct entities');
  assert.equal(sizes.at(-1).scripts,sizes[0].scripts,'native scripts do not accumulate after swaps');
  // History grows to its cap; compare after that rather than the first menu.
  assert.ok(sizes.at(-1).nodes<=sizes[10].nodes+12,'page DOM remains bounded after history reaches its cap');
  assert.equal(f.getSaves(),0);
  assert.deepEqual(await f.page.evaluate(()=>window.nativeFallbacks),[],'navigation never falls out of the shell');
  assert.ok(f.posts.every(post=>!/(?:Login|Logout)/i.test(post.url)),'ordinary visits do not invoke authentication endpoints');
  assert.deepEqual(errors,[]);
  if(heap)await heap.detach();
 }finally{await f.close();}
});

test('a failed history return preserves the current page and can be retried',async()=>{
 const f=await setup();try{
  await f.visit('Group A','Alice');
  await f.visit('Group B','Bob');
  f.setReject(true);
  await f.page.locator('button.cp-bc-history').click();
  const alice=f.page.getByRole('group',{name:'User Alice',exact:true}).locator('button[data-recent-id]').filter({has:f.page.locator('strong',{hasText:/^Profile$/})});
  await alice.click({noWaitAfter:true});
  await f.page.locator('.cp-alert').waitFor({state:'attached'});
  assert.equal(await f.page.locator('#selected').textContent(),'Bob');
  assert.equal(await f.page.locator('input[name="apply"]').isDisabled(),true,'a failed return cannot save Bob’s fields into Alice’s context');
  assert.equal(f.getSaves(),0);
  f.setReject(false);
  await f.nav(profile);
  assert.equal(await f.page.locator('#selected').textContent(),'Bob','ordinary navigation restores the visible user after a failed return');
  await f.page.locator('button.cp-bc-history').click();
  await alice.click({noWaitAfter:true});
  await f.page.waitForFunction(()=>document.querySelector('#selected')?.textContent==='Alice');
 }finally{await f.close();}
});
