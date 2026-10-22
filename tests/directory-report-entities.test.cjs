const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(runtime,'src/content/pjax.js'),'utf8');
const start=source.indexOf('    function cpUxpDecodeEnt(s) {'),end=source.indexOf('    function cpUxpReportFetch(',start);
assert.ok(start>=0&&end>start);
const api=vm.runInNewContext(source.slice(start,end)+'\n({decode:cpUxpDecodeEnt,report:cpUxpParseReport});');

test('directory text preserves named entities and decodes exactly one layer',()=>{
  assert.equal(api.decode('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;'),'A & B <C> "D" \'E\'');
  assert.equal(api.decode('&amp;#128512;'),'&#128512;');
  assert.equal(api.decode('Jos&#233;'),'José');
});
test('directory report preserves full Unicode characters in decimal entities',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(api.report('<colHeading>Name</colHeading><row><col>&#128512; &#131072;</col></row>'))),{
    headings:['Name'],rows:[['😀 𠀀']]
  });
});
test('directory report preserves hexadecimal entities in headings and values',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(api.report('<colHeading>Pr&#xE9;nom</colHeading><row><col>Jos&#xe9; &#x1F600;</col></row>'))),{
    headings:['Prénom'],rows:[['José 😀']]
  });
});
test('escaped directory data islands retain encoded Unicode names',()=>{
  const inner='<colHeading>Name</colHeading><row><col>&#128512;</col></row>';
  const escaped=inner.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  assert.deepEqual(JSON.parse(JSON.stringify(api.report('<textarea>'+escaped+'</textarea>'))),{headings:['Name'],rows:[['😀']]});
});
test('out-of-range directory entities remain visible without throwing or wrapping',()=>{
  for(const value of ['&#1114112;','&#x110000;','&#999999999999999999999999999999999999;'])assert.equal(api.decode(value),value);
});
