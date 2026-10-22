const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(runtime,'src/content/pjax.js'),'utf8');
const start=src.indexOf('    var cpCrcT = null;'),end=src.indexOf('    window.cpXlsxBuild = cpXlsxBuild;',start);
assert.ok(start>=0&&end>start);
const api=vm.runInNewContext(src.slice(start,end)+'\n({zip:cpZipBytes,xlsx:cpXlsxBuild});',{TextEncoder,Blob});

// Read the ZIP directory and its referenced local records independently of the
// writer. Both records must advertise UTF-8 when names contain non-ASCII text.
function entries(bytes){
  const b=Buffer.from(bytes),eocd=b.length-22;
  assert.equal(b.readUInt32LE(eocd),0x06054b50);
  const count=b.readUInt16LE(eocd+10),out=[];
  let offset=b.readUInt32LE(eocd+16);
  for(let i=0;i<count;i++){
    assert.equal(b.readUInt32LE(offset),0x02014b50);
    const flags=b.readUInt16LE(offset+8),length=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32);
    const local=b.readUInt32LE(offset+42),raw=b.subarray(offset+46,offset+46+length);
    assert.equal(b.readUInt32LE(local),0x04034b50);
    assert.equal(b.readUInt16LE(local+6),flags,'local and central filename encodings agree');
    assert.equal(b.readUInt16LE(local+8),0,'stored entries are directly readable');
    if(raw.some(byte=>byte>=128))assert.ok(flags&0x800,'non-ASCII ZIP filenames need the UTF-8 flag');
    const name=raw.toString('utf8'),localNameLength=b.readUInt16LE(local+26),localExtra=b.readUInt16LE(local+28);
    assert.deepEqual(b.subarray(local+30,local+30+localNameLength),raw);
    const dataStart=local+30+localNameLength+localExtra,size=b.readUInt32LE(offset+24);
    out.push({name,data:b.subarray(dataStart,dataStart+size)});
    offset+=46+length+extra+comment;
  }
  return out;
}

test('ASCII ZIP entries remain readable with their original binary payload',()=>{
  const payload=Buffer.from([0,255,1,128]),read=entries(api.zip([{name:'Directory.xlsx',data:payload}]));
  assert.equal(read[0].name,'Directory.xlsx');assert.deepEqual(read[0].data,payload);
});

for(const name of ['Phone Directory - München.xlsx','Users Export FULL - 東京.xlsx','Directory - 😀.xlsx']){
  test('ZIP filename survives standard UTF-8 decoding: '+name,()=>{
    const workbook=api.xlsx([{name:'Users',headers:['Name'],rows:[['José 😀']]}]);
    const outer=entries(api.zip([{name,data:workbook}]));
    assert.equal(outer[0].name,name);
    const inner=entries(outer[0].data),sheet=inner.find(entry=>entry.name==='xl/worksheets/sheet1.xml');
    assert.ok(sheet);assert.ok(sheet.data.toString('utf8').includes('José 😀'));
  });
}
