const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../src/bg/updates.js'), 'utf8');
const base = 'https://github.com/KeelrLeek/Modern-Commpilot/releases';
function release(version = '0.3.82', nightly = false) {
  const tag = nightly ? 'nightly' : `v${version}-pjax-preview`;
  const name = `BroadWorks-Enhancer-PJAX-Preview-${version}${nightly ? '-nightly' : ''}.zip`;
  return {draft:false, prerelease:nightly, tag_name:tag, published_at:'2026-10-20T10:00:00Z',
    html_url:`${base}/tag/${tag}`, body:'Release notes', assets:[{name, state:'uploaded', size:1234,
      browser_download_url:`${base}/download/${tag}/${name}`}]};
}
function harness(fetcher = async () => ({status:200, data:release()}), initial = {}) {
  let clock = Date.parse('2026-10-20T12:00:00Z');
  const store = {cpUpdatePreferences:{channel:'stable', automatic:false}, ...structuredClone(initial)};
  const calls = [], alarms = new Map(), events = {};
  let handler;
  const runtime = {id:'test-extension', getManifest:()=>({version:'0.3.82'}),
    onMessage:{addListener:fn=>{handler=fn}},
    onStartup:{addListener:fn=>{events.startup=fn}}, onInstalled:{addListener:fn=>{events.installed=fn}}};
  vm.runInNewContext(code, {URL, AbortController, setTimeout, clearTimeout,
    Date:class extends Date {static now(){return clock}},
    chrome:{runtime, storage:{local:{
      get:(key, callback)=>queueMicrotask(()=>callback({[key]:structuredClone(store[key])})),
      set:(values, callback)=>{Object.assign(store, structuredClone(values));queueMicrotask(callback)}
    }}, alarms:{
      get:async name=>alarms.get(name), create:async(name, value)=>{alarms.set(name,value)},
      clear:async name=>alarms.delete(name), onAlarm:{addListener:fn=>{events.alarm=fn}}
    }},
    fetch:async(url, options)=>{
      calls.push({url, options});
      const result=await fetcher(url, options);
      return {status:result.status, ok:result.status>=200&&result.status<300,
        headers:new Headers(result.headers), text:async()=>result.text??JSON.stringify(result.data)};
    }
  });
  const sender={id:'test-extension',tab:{id:1},frameId:0,url:'https://apps.avpaas.io/commpilot/User/Profile/'};
  return {store,calls,alarms,events,advance:ms=>{clock+=ms}, request:(message={}, from=sender)=>new Promise(resolve=>{
    handler({kind:'cpUpdates',op:'check',...message},from,value=>resolve(structuredClone(value)));
  })};
}
test('stable checks the public latest release, compares numeric versions, caches results, and sends no site data', async()=>{
  const h=harness();
  const first=await h.request();
  assert.equal(first.ok,true);
  assert.equal(first.available,false);
  assert.equal(first.cache.release.version,'0.3.82');
  await h.request();
  assert.equal(h.calls.length,1,'repeated manual checks are throttled');
  assert.equal(h.calls[0].url,'https://api.github.com/repos/KeelrLeek/Modern-Commpilot/releases/latest');
  assert.equal(h.calls[0].options.credentials,'omit');
  assert.equal(h.calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(h.calls[0].options.redirect,'error');
  assert.equal(h.calls[0].options.body,undefined);
  assert.equal(h.calls[0].options.headers.Authorization,undefined);
  for(const [version, available, newerInstalled] of [['0.3.9',false,true],['0.3.83',true,false],['0.3.82.1',true,false]]){
    const value=await harness(async()=>({status:200,data:release(version)})).request();
    assert.equal(value.available,available,version);
    assert.equal(value.newerInstalled,newerInstalled,version);
  }
});
test('nightly is a distinct opt-in channel and an unpublished nightly never falls back to an old beta', async()=>{
  const h=harness(async url=>url.endsWith('nightly')?{status:404}:{status:200,data:release()});
  await h.request();
  await h.request({op:'preferences',patch:{channel:'nightly'}});
  const state=await h.request();
  assert.equal(state.preferences.channel,'nightly');
  assert.equal(state.available,false);
  assert.equal(state.cache.release,null);
  assert.equal(state.cache.error,'');
  assert.match(h.calls[1].url,/\/releases\/tags\/nightly$/);
  await h.request({op:'preferences',patch:{channel:'stable'}});
  assert.equal((await h.request({op:'state'})).cache.release.version,'0.3.82');
  const nightly=harness(async()=>({status:200,data:release('0.3.83.12',true)}),
    {cpUpdatePreferences:{channel:'nightly',automatic:false}});
  assert.equal((await nightly.request()).available,true);
});
test('wrong-channel releases, mismatched ZIPs and unsafe download URLs are rejected', async()=>{
  const mutations=[
    data=>{data.prerelease=true},
    data=>{data.draft=true},
    data=>{data.assets[0].browser_download_url='https://evil.example/update.zip'},
    data=>{data.html_url='javascript:alert(1)'},
    data=>{data.assets[0].state='new'},
    data=>{data.assets.push({...data.assets[0]})},
    data=>{data.assets[0].name='BroadWorks-Enhancer-PJAX-Preview-0.3.90.zip'},
    data=>{data.tag_name='v99999.3.82'; data.assets=[]}
  ];
  for(const mutate of mutations){
    const data=release();mutate(data);
    const result=await harness(async()=>({status:200,data})).request();
    assert.equal(result.available,false);
    assert.ok(result.cache.error);
    assert.equal(result.cache.release,null);
  }
});
test('an offline or rate-limited check never claims up to date and retains the previous successful check', async()=>{
  let fail=false;
  const h=harness(async()=>{
    if(fail) throw Error('Network offline');
    return {status:200,data:release('0.3.83')};
  });
  const saved=await h.request();
  h.advance(31000);fail=true;
  const offline=await h.request();
  assert.match(offline.cache.error,/Could not reach GitHub/);
  assert.equal(offline.available,true,'the update found earlier keeps its download beside the error');
  assert.equal(offline.cache.checkedAt,saved.cache.checkedAt);
  await h.request();
  assert.equal(h.calls.length,2,'repeated manual checks are still throttled after a failure');
  const limited=harness(async()=>({status:403,headers:{'retry-after':'3600'}}));
  assert.match((await limited.request()).cache.error,/limiting update checks/);
  limited.advance(31*60*1000);
  await limited.request();
  assert.equal(limited.calls.length,1);
  const invalid=await harness(async()=>({status:200,text:'<html>not JSON</html>'})).request();
  assert.match(invalid.cache.error,/invalid release information/);
});
test('after a failed automatic check a known update stays downloadable and a manual check retries at once', async()=>{
  let fail=false;
  const h=harness(async()=>{
    if(fail) throw Error('Network offline');
    return {status:200,data:release('0.3.83')};
  },{cpUpdatePreferences:{channel:'stable',automatic:true}});
  assert.equal((await h.request()).available,true);
  h.advance(25*60*60*1000);fail=true;
  h.events.alarm({name:'cp-update-check'});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(h.calls.length,2);
  h.advance(2*60*1000);fail=false;
  const offline=await h.request({op:'state'});
  assert.equal(h.calls.length,2,'automatic checks still back off after a failure');
  assert.match(offline.cache.error,/Could not reach GitHub/);
  assert.equal(offline.available,true,'the update found earlier keeps its download');
  const retried=await h.request();
  assert.equal(h.calls.length,3,'a manual check is not held off by a network failure');
  assert.equal(retried.cache.error,'');
  assert.equal(retried.available,true);
});
test('concurrent tabs share one request; automatic checks are daily and can be disabled', async()=>{
  let finish;
  const h=harness(()=>new Promise(resolve=>{finish=resolve}));
  const first=h.request(), second=h.request();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.length,1);
  finish({status:200,data:release()});
  assert.deepEqual(await first,await second);
  await h.request({op:'preferences',patch:{automatic:true}});
  assert.equal(h.alarms.get('cp-update-check').periodInMinutes,1440);
  await h.request({op:'state'});
  assert.equal(h.calls.length,1);
  await h.request({op:'preferences',patch:{automatic:false}});
  assert.equal(h.alarms.size,0);
  h.advance(2*24*60*60*1000);
  await h.request({op:'state'});
  assert.equal(h.calls.length,1);
});
test('the background boundary refuses foreign senders, subframes and invalid channel settings',async()=>{
  const h=harness();
  for(const sender of [
    {id:'other',tab:{},frameId:0,url:'https://apps.avpaas.io/commpilot/User/'},
    {id:'test-extension',tab:{},frameId:1,url:'https://apps.avpaas.io/commpilot/User/'},
    {id:'test-extension',tab:{},frameId:0,url:'https://evil.example/commpilot/User/'},
    {id:'test-extension',tab:{},frameId:0,url:'http://apps.avpaas.io/commpilot/User/'}
  ]) assert.equal((await h.request({},sender)).ok,false);
  for(const patch of [null, true, 1, 'stable', [], {channel:'beta'},{automatic:'yes'},{url:'https://evil.example'}]){
    assert.equal((await h.request({op:'preferences',patch})).ok,false);
  }
  assert.equal(h.calls.length,0);
});
