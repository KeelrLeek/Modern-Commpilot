const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const window={};window.top=window;
const scope={window};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/content/recent-history.js'),'utf8'),scope);
const history=scope.cpRecentHistory;
const sp='/commpilot/Reseller/ServiceProviders/Modify/index.jsp';
const group='/commpilot/ServiceProvider/Members/Modify/index.jsp';
const user='/commpilot/Group/Members/Modify/index.jsp';
function row(id,url,params={},context='Reseller › Acme › RSG › alice@example.net',chain=[]){return{id,label:'Profile',nav:{url,params},context,chain};}

test('history merges repeated searches and equivalent parent-entry encodings',()=>{
 const context='Reseller › Acme';
 const rows=[row('latest','/commpilot/Common/find.jsp',{returnPage:'/ServiceProvider/Members/',key:'0',op:'2',value:'sales'},context,[{url:sp,params:{P_key:'Acme'}}]),
  row('old-list','/commpilot/ServiceProvider/Members/index.jsp',{},context,[{url:sp,params:{key:'Acme',P_key:'Acme'}}]),
  row('old-search','/commpilot/Common/findAll.jsp',{returnPage:'ServiceProvider/Members/',tableName:'groupTable'},context,[{url:sp,params:{key:'Acme'}}])];
 assert.equal(history.unique(rows).length,1);
 assert.equal(history.unique(rows)[0].id,'latest','newest navigation remains the replay target');
});

test('different calling-plan tabs remain distinct while reordered query flags merge',()=>{
 const base='/commpilot/Group/Calling_Plan/Outgoing/index.jsp';
 const rows=[row('forward',base+'?TransferForward=1&isEnh=true'),
  row('alias',base+'?isEnh=true&TransferForward=1'),row('originating',base+'?isEnh=true')];
 assert.deepEqual(Array.from(history.unique(rows),r=>r.id),['forward','originating']);
});

test('same-name users, groups and service providers stay distinct',()=>{
 const rows=[row('user','/commpilot/User/Profile/',{},'Reseller › Acme › Acme › Acme'),
  row('group','/commpilot/Group/Profile/',{},'Reseller › Acme › Acme'),
  row('provider','/commpilot/ServiceProvider/Profile/',{},'Reseller › Acme')];
 const groups=history.groups(rows,'');
 assert.equal(groups.length,3);
 assert.deepEqual(Array.from(groups,g=>g.type),['User','Group','Service provider']);
 assert.deepEqual(Array.from(groups,g=>g.name),['Acme','Acme','Acme']);
 assert.equal(new Set(groups.map(g=>g.key)).size,3);
});

test('grouped history migrates old rows, merges aliases and separates different appearances',()=>{
 const chain=[{url:sp,params:{key:'Acme'}},{url:group,params:{key:'Acme>%RSG'}},{url:user,params:{key:'Acme>%RSG>%alice@example.net'}}];
 const first=row('appearance-one','/commpilot/User/SCAP/Modify/index.jsp',{key:'appearance-one'},undefined,chain);
 const alias={...first,id:'alias',nav:{url:'/commpilot/User/SCAP/Modify/',params:{P_key:'appearance-one'}}};
 const second={...first,id:'appearance-two',nav:{url:first.nav.url,params:{key:'appearance-two'}}};
 const menu=row('user-menu',user,{key:'Acme>%RSG>%alice@example.net'});
 const rows=[first,alias,second,menu];
 assert.equal(history.groups(rows,'')[0].rows.length,2);
 assert.equal(history.groups(rows,'',true)[0].rows.length,3);
 const place=history.place(first);
 assert.equal(place.name,'alice');assert.equal(place.full,'alice@example.net');assert.equal(place.parent,'RSG');
 assert.equal(history.isMenu(menu),true);
});

test('a damaged current history chain cannot crash presentation or supply partial ancestry',()=>{
 const current=row('current','/commpilot/User/Profile/',{},'Reseller › Acme › Sales › alice@example.net',
  [{url:user,params:{key:'Acme>%Support>%bob@example.net'}},null]);
 const result=history.place(current);
 assert.equal(result.full,'alice@example.net');
 assert.equal(result.parent,'Sales','use visible context instead of retaining part of a damaged chain');
});

test('current location sorts first without merging users from different groups',()=>{
 const one=row('one','/commpilot/User/Profile/',{},'Reseller › Acme › Sales › alice@example.net');
 const two=row('two','/commpilot/User/Profile/',{},'Reseller › Acme › Support › alice@example.net');
 const groups=history.groups([one,two],history.place(two).key);
 assert.equal(groups.length,2);assert.equal(groups[0].parent,'Support');assert.equal(groups[1].parent,'Sales');
});

test('location headings choose their own entity entry rather than a parent or a subpage',()=>{
 const chain=[{url:'/commpilot/Common/folder_contents.jsp',params:{folder:'R0',menuId:'8'}},
  {url:sp,params:{key:'Acme'}},{url:group,params:{key:'Acme>%RSG'}},{url:user,params:{key:'Acme>%RSG>%alice@example.net'}}];
 assert.equal(history.homeIndex(row('user','/commpilot/User/Passwords/',{},undefined,chain)),3);
 assert.equal(history.homeIndex(row('group','/commpilot/Group/Profile/',{},'Reseller › Acme › RSG',chain.slice(0,3))),2);
 assert.equal(history.homeIndex(row('sp','/commpilot/ServiceProvider/Profile/',{},'Reseller › Acme',chain.slice(0,2))),1);
 assert.equal(history.homeIndex(row('menu',user,{key:'Acme>%RSG>%alice@example.net'},undefined,chain.slice(0,3))),3);
 assert.equal(history.homeIndex(row('root','/commpilot/Reseller/Profile/',{},'Reseller',chain.slice(0,1))),0);
 assert.equal(history.homeIndex(row('missing','/commpilot/User/Passwords/',{},undefined,chain.slice(0,3))),-1,'missing user entry must not open its parent group');
});

test('saved Profile labels with embedded descriptions are repaired without changing navigation',()=>{
 for(const level of ['User','Group','ServiceProvider','Reseller']){
  const saved={...row(level,'/commpilot/'+level+'/Profile/index.jsp'),label:'ProfileProfile allows you to view and maintain your profile information.'};
  const repaired=history.unique([saved])[0];
  assert.equal(repaired.label,'Profile');
  assert.equal(repaired.id,saved.id);
  assert.equal(repaired.nav,saved.nav);
  assert.equal(repaired.chain,saved.chain);
  assert.equal(saved.label.includes('allows'),true,'cleanup does not mutate the original record');
 }
 const other={...row('other','/commpilot/User/SCAP/Modify/'),label:'Shared Call Appearance Modify'};
 assert.equal(history.unique([other])[0].label,other.label,'other page names remain intact');
});

test('names are display metadata while user IDs remain the location and destination identity',()=>{
 const first={...row('old','/commpilot/User/Profile/'),userName:'Mary Jones'};
 const renamed={...first,id:'new',userName:'Anne Smith'};
 assert.equal(history.destination(first),history.destination(renamed));
 const group=history.groups([renamed,first],'')[0];
 assert.equal(group.userName,'Anne Smith');assert.equal(group.full,'alice@example.net');
 assert.equal(group.rows.length,1);
});

test('a header changing before history commits cannot rename the previous user with the same ID in another group',()=>{
 const make=groupName=>({...row(groupName,'/commpilot/User/Profile/',{},'Reseller › Acme › '+groupName+' › alice@example.net',[
  {url:sp,params:{key:'Acme'}},{url:group,params:{key:'Acme>%'+groupName}},{url:user,params:{key:'Acme>%'+groupName+'>%alice@example.net'}}]),userName:groupName==='Group A'?'Original User':undefined});
 const first=make('Group A'),second=make('Group B');
 let saved=JSON.stringify([second,first]);
 const events={};
 const id={textContent:'alice@example.net',getAttribute:name=>({'data-cp-name-state':'done','data-cp-user-name':'Different User'}[name])};
 const cell={querySelector:()=>id,querySelectorAll:()=>['Reseller','Acme','Group B','Users'].map(textContent=>({textContent})).concat(id)};
 const state={cpNav:first.nav,cpRecentChain:first.chain};
 const isolated={window,history:{state},document:{querySelectorAll:()=>[cell],addEventListener:(name,handler)=>events[name]=handler},
  sessionStorage:{getItem:()=>saved,setItem:(_key,value)=>saved=value}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/content/recent-history.js'),'utf8'),isolated);
 assert.equal(JSON.parse(saved).find(row=>row.id==='Group A').userName,'Original User');
 assert.equal(JSON.parse(saved).find(row=>row.id==='Group B').userName,undefined);
 state.cpRecentChain=second.chain;events['cp:user-name']();
 assert.equal(JSON.parse(saved).find(row=>row.id==='Group A').userName,'Original User');
 assert.equal(JSON.parse(saved).find(row=>row.id==='Group B').userName,'Different User');
});

test('corrupt saved history rows do not hide valid visits or supply broken ancestry',()=>{
 const good=row('valid','/commpilot/User/Profile/');
 const malformed=[null,{id:'no-nav'},{id:'text-nav',nav:'invalid'},
  {...good,id:'number-url',nav:{url:123}},
  {...good,id:'object-chain',chain:{}},
  {...good,id:'null-entry',chain:[null]},
  {...good,id:'invalid-entry',chain:[{url:123}]}];
 assert.deepEqual(Array.from(history.unique([...malformed,good]),value=>value.id),['valid']);
 assert.equal(history.groups([...malformed,good],'').length,1);
 assert.equal(history.unique(null).length,0);
 assert.equal(history.unique({}).length,0);
 const legacy={...good,id:'legacy'};delete legacy.chain;
 assert.equal(history.unique([legacy]).length,1,'old valid rows without ancestry remain visible');
});
