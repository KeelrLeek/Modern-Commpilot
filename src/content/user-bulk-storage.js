/* Isolated-world persistence. Only the explicit non-secret settings schema crosses this bridge. */
(()=>{
  'use strict';
  if(window!==window.top)return;
  const model=window.CpBulkModel;
  window.addEventListener('message',async event=>{
    const m=event.data;
    if(event.source!==window||event.origin!==location.origin||m?.type!=='cp:bulk-defaults:request'||
      !/^[a-z0-9-]{1,80}$/i.test(m.id||'')||!['load','save'].includes(m.action))return;
    let result,error;
    try{
      if(m.scope?.pbxOrigin!==location.origin)throw Error('Incorrect PBX scope.');
      const key=model.scopeKey(m.scope);
      if(m.action==='save'){
        const settings=model.snapshot(m.settings||{});
        if(Object.keys(settings).length!==14)throw Error('Review the complete group setup before saving.');
        await chrome.storage.local.set({[key]:{version:1,settings}});
      }
      const saved=(await chrome.storage.local.get(key))[key];
      if(saved&&saved.version!==1)throw Error('Saved defaults require review.');
      result=saved?model.snapshot(saved.settings):null;
      if(result&&Object.keys(result).length!==14)throw Error('Saved defaults are incomplete; review the group setup.');
    }catch(e){error='Group defaults could not be '+(m.action==='save'?'saved':'loaded')+'. '+e.message;}
    window.postMessage({type:'cp:bulk-defaults:response',id:m.id,result,error},location.origin);
  });
})();
