const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

test('an aborted key transaction returns an error and does not block later saved-sign-in requests', async () => {
  let handler, key, abortNext = true, closed = 0;
  const storage = {};
  const db = {close:()=>{closed++;},transaction:(name,mode)=>{
    const tx = {objectStore:()=>({
      get:()=>{const request={};queueMicrotask(()=>{request.result=key;request.onsuccess();});return request;},
      put:value=>queueMicrotask(()=>{
        if(abortNext){abortNext=false;tx.error=new DOMException('Transaction cancelled','AbortError');tx.onabort?.();}
        else{key=value;tx.oncomplete();}
      })
    })};return tx;
  }};
  const sandbox={URL,Set,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,
    indexedDB:{open:()=>{const request={result:db};queueMicrotask(()=>request.onsuccess());return request;}},
    chrome:{runtime:{onMessage:{addListener:callback=>{handler=callback;}}},storage:{local:{
      get:(name,done)=>queueMicrotask(()=>done({[name]:storage[name]})),
      set:(data,done)=>{Object.assign(storage,data);queueMicrotask(done);},
      remove:(name,done)=>{delete storage[name];queueMicrotask(done);}
    }}}
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/bg/credential-bridge.js'),'utf8'),sandbox);
  const send=message=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Credential request never settled after transaction abort')),1500);
    handler({kind:'bwCredential',...message},{tab:{id:1},url:'https://apps-sbx.avpaas.io/commpilot/Login/'},result=>{clearTimeout(timer);resolve(result);});
  });
  const account={op:'add',user:'fixture-user',password:'fixture-password',mode:'auto'};
  const failed=await send(account);
  assert.equal(failed.ok,false);
  assert.match(failed.error,/Could not open encrypted saved sign-ins/);
  assert.equal(Object.keys(storage).length,0,'do not save ciphertext with an uncommitted key');
  const added=await send(account);
  assert.equal(added.ok,true);
  assert.equal(closed,2,'each attempted database handle is closed');
  assert.equal(JSON.stringify(storage).includes('fixture-password'),false);
  const listed=await send({op:'list'});
  assert.equal(listed.profiles.length,1);
  const unlocked=await send({op:'unlock',id:added.id});
  assert.equal(unlocked.password,'fixture-password');
});
