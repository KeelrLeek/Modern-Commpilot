/* Phone identity shared by lookup, plans, display and native form readback. */
(function(root,factory){
  const phone=factory();
  if(typeof module==='object'&&module.exports)module.exports=phone;
  else root.CpBulkPhone=phone;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function parse(value){
    let s=String(value??'').trim();
    // An optional national trunk marker is not part of an international number.
    if(/^(?:\+|00)/.test(s))s=s.replace(/\(0\)/g,'');
    s=s.replace(/[\s().\-\u2010-\u2015\u2212]/g,'').replace(/^00/,'+');
    if(!/^\+?\d{6,15}$/.test(s))return {number:'',international:false};
    const explicit=s[0]==='+',n=s.replace(/^\+/,'');
    if(explicit&&n[0]==='0')return {number:'',international:false};
    // Keep the existing North American local IDs. Other countries retain their
    // country code, with digits only in generated identifiers and fields.
    if(n.length===11&&n[0]==='1')return {number:n.slice(1),international:false};
    return {number:n,international:explicit||(n.length!==10&&n[0]!=='0')};
  }
  const key=value=>parse(value).number, localId=key, display=key;
  const isInternational=value=>parse(value).international;
  function caller(value,international=false){
    const p=parse(value),n=p.number;
    return !international&&!p.international&&n.length===10&&n[0]!=='0'?'+1'+n:n;
  }
  function expand(value){
    const source=String(value).trim();
    let pieces=source.split(/\s+[-\u2010-\u2015\u2212]\s+|\s*[–—]\s*/);
    // A dash can also separate country code from national digits. Treat it as
    // a range only when both sides are full numbers, never as a lost country code.
    if(pieces.length===2&&pieces.some(p=>!key(p)))pieces=[source];
    if(pieces.length===1&&!key(source)){
      const candidates=[];
      for(let i=0;i<source.length;i++)if(source[i]==='-'){
        const a=key(source.slice(0,i)),b=key(source.slice(i+1));
        if(a&&b&&a.length===b.length)candidates.push([a,b]);
      }
      if(candidates.length===1)pieces=candidates[0];
    }
    const parts=pieces.map(key);
    if(parts.length>2||parts.some(n=>!n))return [];
    if(parts.length===1)return parts;
    const [a,b]=parts;
    if(a.length!==b.length)throw Error('The native phone number range needs review.');
    const start=BigInt(a),end=BigInt(b),count=end-start+1n,width=a.length;
    if(count<1n||count>10001n)throw Error('A number range is too large to inspect safely.');
    // CommPilot Prototype replaces Array.from and ignores its mapping callback.
    const result=[];
    for(let n=start;n<=end;n++)result.push(String(n).padStart(width,'0'));
    return result;
  }
  return {key,localId,caller,display,expand,isInternational};
});
