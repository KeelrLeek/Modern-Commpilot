const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

// A small ZIP whose central directory understates the worksheet's actual decompressed size.
// The oversized payload is a single XML comment, not millions of DOM nodes.
function workbook(kind, padding, extra = '', shared = '') {
  const values = kind === 'number' ? [['Phone Number','Department','Range End'],['3125550199','None','']] : [['Extension'],['1234']];
  const rows=values.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('');
  const xml=Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><!--${'x'.repeat(padding)}--><sheetData>${rows}${extra}</sheetData></worksheet>`);
  const entries=[['xl/worksheets/sheet1.xml',xml],...(shared?[['xl/sharedStrings.xml',Buffer.from(shared)]]:[])];
  const locals=[],directory=[];let offset=0;
  for(const [filename,payload]of entries){
    const data=deflateRawSync(payload),name=Buffer.from(filename);let crc=0xffffffff;
    for(const byte of payload){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const declared=Math.min(payload.length,1024);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(declared,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(declared,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,data);directory.push(central,name);offset+=local.length+name.length+data.length;
  }
  const index=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,index,end]);
}

for(const kind of ['number','profile']) for(const oversized of [true,false]) test(`${kind} import ${oversized?'rejects oversized actual decompression before any PBX lookup':'accepts a normal compressed worksheet'}`,async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage(),list=kind==='number'?'/commpilot/Group/GroupDnManagement/index.jsp':'/commpilot/Group/DeviceInventory/';
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<table><tr><td width="82%"><form name="mainForm"><input name="ok" type="button" value="OK"><input name="add" type="button" value="Add"></form></td></tr></table>'}));
    await page.goto('https://apps-sbx.avpaas.io'+list);
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>{
      window.lookups=0;window.cpListSearch=async()=>{lookups++;return {tooMany:false,rows:[]};};
      window.redirectPost=url=>{history.replaceState(null,'',url);document.documentElement.setAttribute('data-cp-path',url);document.dispatchEvent(new Event('cp:reskin'));};
    });
    await page.addScriptTag({path:path.join(runtime,`src/content/${kind}-bulk.js`)});
    await page.locator(`#cp-bulk-${kind}-launch`).click();
    const bytes=workbook(kind,oversized?13*1024*1024:0);
    assert.ok(bytes.length<64*1024,'fixture is small on disk and in the upload');
    await page.locator('.cp-bulk-dialog input[type=file]').setInputFiles({name:'oversized.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
    await page.waitForFunction(()=>!document.querySelector('.cp-bulk-dialog [data-action=close]').disabled);
    if(oversized){
      assert.match(await page.locator('.cp-bulk-status').textContent(),/too large/i);
      assert.equal(await page.evaluate(()=>lookups),0);
    }else{
      assert.doesNotMatch(await page.locator('.cp-bulk-status').textContent(),/too large|invalid|compression/i);
      assert.ok(await page.evaluate(()=>lookups)>0,'the normal worksheet reaches read-only preview');
    }
    assert.equal(await page.locator('.cp-bulk-dialog [data-action=apply]').isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

for(const kind of ['number','profile'])for(const fault of ['boolean','shared-string','valid-shared-string'])test(`${kind} import ${fault==='valid-shared-string'?'accepts a valid shared string':`rejects a ${fault} cell before any partial preview`}`,async()=>{
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(5000);
    const list=kind==='number'?'/commpilot/Group/GroupDnManagement/index.jsp':'/commpilot/Group/DeviceInventory/';
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<table><tr><td width="82%"><form name="mainForm"><input name="ok" type="button" value="OK"><input name="add" type="button" value="Add"></form></td></tr></table>'}));
    await page.goto('https://apps-sbx.avpaas.io'+list);
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(()=>{
      window.lookups=0;window.cpListSearch=async()=>{lookups++;return {tooMany:false,rows:[]};};
      window.redirectPost=url=>{history.replaceState(null,'',url);document.documentElement.setAttribute('data-cp-path',url);document.dispatchEvent(new Event('cp:reskin'));};
    });
    await page.addScriptTag({path:path.join(runtime,`src/content/${kind}-bulk.js`)});
    await page.locator(`#cp-bulk-${kind}-launch`).click();
    const valid=fault==='valid-shared-string';
    const extra=`<row r="3"><c r="A3" t="${fault==='boolean'?'b':'s'}"><v>${fault==='boolean'?'1':valid?'0':'99'}</v></c>${kind==='number'?'<c r="B3" t="inlineStr"><is><t>None</t></is></c>':''}</row>`;
    const shared=valid?`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>${kind==='number'?'3125550198':'5678'}</t></si></sst>`:'';
    await page.locator('.cp-bulk-dialog input[type=file]').setInputFiles({name:'cell-types.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook(kind,0,extra,shared)});
    await page.waitForFunction(()=>!document.querySelector('.cp-bulk-dialog [data-action=close]').disabled);
    if(valid){
      assert.ok(await page.evaluate(()=>lookups)>0,'valid shared strings reach the read-only preview');
      assert.doesNotMatch(await page.locator('.cp-bulk-status').innerText(),/missing shared string|must contain text/i);
    }else{
      assert.equal(await page.evaluate(()=>lookups),0,'a malformed cell must stop the entire import before PBX lookup');
      assert.match(await page.locator('.cp-bulk-status').innerText(),/A3/);
    }
    assert.equal(await page.locator('.cp-bulk-dialog [data-action=apply]').isDisabled(),true);
  }finally{await browser.close();}
});
