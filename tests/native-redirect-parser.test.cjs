const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(runtime, 'src/content/pjax.js'), 'utf8');
const parserStart = source.indexOf('    function cpExtractStub(doc) {');
const parserEnd = source.indexOf('    function cpBulkRequestDiagnostic', parserStart);
const decoderStart = source.indexOf('    function cpUnescapeJs(text) {');
const decoderEnd = source.indexOf('    // id →', decoderStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart && decoderStart >= 0 && decoderEnd > decoderStart);
const kindStart = source.indexOf('  function cpNativeScriptKind(script) {');
const kindEnd = source.indexOf('  // Re-execute scripts', kindStart);
assert.ok(kindStart >= 0 && kindEnd > kindStart);
const parse = vm.runInNewContext(source.slice(kindStart, kindEnd) + source.slice(decoderStart, decoderEnd) + source.slice(parserStart, parserEnd) + '\ncpExtractStub;');
const read = script => JSON.parse(JSON.stringify(parse({
  querySelectorAll: () => [{ textContent: script, getAttribute: () => null, hasAttribute: () => false }],
  getElementsByName: () => [{ value: 'fixture-token' }]
})));

test('native redirect parsing preserves mixed identifiers and quoted closing delimiters', () => {
  const fragments = ['Group', "O'Brien", '"quote"', String.raw`\u0040`, '>%', 'é', '東', '😀', '}),key:"other"', '{braces}', '/', ' '];
  for (let index = 0; index < 5000; index++) {
    const value = fragments[index % fragments.length] + fragments[Math.floor(index / fragments.length) % fragments.length] + index;
    const redirect = `redirectPost('/commpilot/Group/Profile/',{key:${JSON.stringify(value)},P_key:${JSON.stringify(value)}});`;
    assert.deepEqual(read(redirect), { target: '/commpilot/Group/Profile/', data: { key: value, P_key: value }, token: 'fixture-token' });
  }
});

test('native redirect parsing decodes a Unicode target and escaped quotes exactly once', () => {
  assert.deepEqual(read(String.raw`redirectPost('\u002Fcommpilot\u002FGroup\u002FProfile\u002F',{key:'Provider\u003E\u0025O\'Brien',P_key:'literal\\u0040'});`), {
    target: '/commpilot/Group/Profile/', data: { key: "Provider>%O'Brien", P_key: String.raw`literal\u0040` }, token: 'fixture-token'
  });
});

for (const kind of ['block comment', 'line comment', 'quoted string', 'template text']) {
  const fake = "redirectPost('/commpilot/User/Delete/',{key:'Wrong'});";
  const noise = kind === 'block comment' ? '/*' + fake + '*/' : kind === 'line comment' ? '//' + fake + '\n' :
    kind === 'quoted string' ? 'const example=' + JSON.stringify(fake) + ';' : 'const example=`' + fake + '`;';
  test(`native redirect stubs ignore a ${kind} before the actual navigation`, () => {
    assert.deepEqual(read(noise + "redirectPost('/commpilot/Group/Profile/',{key:'Selected'});"), {
      target: '/commpilot/Group/Profile/', data: {key:'Selected'}, token:'fixture-token'
    });
  });
  test(`native redirect stubs do not execute a ${kind} with no actual navigation`, () => {
    assert.equal(read(noise), null);
  });
}

test('a nonliteral redirect call cannot borrow a target from its string arguments',()=>{
  const example="redirectPost('/commpilot/User/Delete/',{key:'Wrong'});";
  assert.deepEqual(read('redirectPost(nextUrl,{description:'+JSON.stringify(example)+'});'+
    "redirectPost('/commpilot/Group/Profile/',{key:'Selected'});"),{
    target:'/commpilot/Group/Profile/',data:{key:'Selected'},token:'fixture-token'
  });
});

const rowStart = source.indexOf('    function cpRowDrill(tr) {');
const rowEnd = source.indexOf('    function cpListFillStart()', rowStart);
const searchStart = source.indexOf('    function cpSearchParseRows(doc) {');
const searchEnd = source.indexOf('    // Write the freshly-rotated', searchStart);
assert.ok(rowStart >= 0 && rowEnd > rowStart && searchStart >= 0 && searchEnd > searchStart);
const rowApi = vm.runInNewContext(source.slice(decoderStart, decoderEnd) + source.slice(parserStart, parserEnd) +
  source.slice(rowStart, rowEnd) + source.slice(searchStart, searchEnd) + '\n({drill:cpRowDrill, search:cpSearchParseRows});');

test('list row and search parsing preserve complete identifiers in both navigation paths', () => {
  const fragments = ["O'Brien", 'Other"Name', String.raw`literal\u0040`, String.raw`literal\x40`, 'value}),key:"wrong"', '東', '😀', '>%', '{braces}'];
  for (let index = 0; index < 5000; index++) {
    const key = fragments[index % fragments.length] + fragments[Math.floor(index / fragments.length) % fragments.length] + index;
    const row = { innerHTML: `<script>redirectPost('/commpilot/Group/Profile/',{key:${JSON.stringify(key)},P_key:${JSON.stringify(key)}});</script>`,
      querySelectorAll: () => [{ textContent: key }] };
    const expected = {url:'/commpilot/Group/Profile/',params:{key,P_key:key}};
    assert.deepEqual(JSON.parse(JSON.stringify(rowApi.drill(row))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(rowApi.search({querySelectorAll:()=>[row]})[0].drill)), expected);
  }
});

test('row keys decode native hex escapes without decoding a literal backslash twice', () => {
  const row = {innerHTML:String.raw`redirectPost('/commpilot/Group/Profile/',{key:'A\x40B',P_key:'A\\x40B'});`};
  assert.deepEqual(JSON.parse(JSON.stringify(rowApi.drill(row))), {
    url:'/commpilot/Group/Profile/',params:{key:'A@B',P_key:String.raw`A\x40B`}
  });
});

const menuStart=source.indexOf('    function cpWiringTargets(root) {');
const menuEnd=source.indexOf('    function cpOptionLabel(',menuStart);
assert.ok(menuStart>=0&&menuEnd>menuStart);
const bindingStart=source.indexOf('    function cpScriptBindings(text) {');
const bindingEnd=source.indexOf('    function cpGridActionTarget',bindingStart);
const menuApi=vm.runInNewContext(source.slice(kindStart,kindEnd)+source.slice(decoderStart,decoderEnd)+source.slice(parserStart,parserEnd)+
  (bindingStart>=0?source.slice(bindingStart,bindingEnd):'')+
  source.slice(menuStart,menuEnd)+'\ncpWiringTargets;');

test('script and inline page-menu targets preserve identifiers and separate adjacent handlers',()=>{
  const keys=["O'Brien",'Other"Name','value}),key:"wrong"',String.raw`literal\u0040`,"getElementById('fake') redirectPost('fake',{})"];
  for(const key of keys){
    const first=`redirectPost('/commpilot/User/Profile/',{userId:${JSON.stringify(key)}})`;
    const second="redirectPost('/commpilot/User/DND/')";
    const script=`document.getElementById('link_First').onclick=function(){${first};};document.getElementById('link_Second').onclick=function(){${second};};`;
    const result=menuApi({querySelectorAll:selector=>selector==='script'?[{textContent:script,getAttribute:()=>null,hasAttribute:()=>false}]:[
      {id:'link_Inline',getAttribute:()=>first},{id:'link_Empty',getAttribute:()=>second}]});
    assert.deepEqual(JSON.parse(JSON.stringify(result)),{
      link_First:{url:'/commpilot/User/Profile/',params:{userId:key}},
      link_Second:{url:'/commpilot/User/DND/',params:{}},
      link_Inline:{url:'/commpilot/User/Profile/',params:{userId:key}},
      link_Empty:{url:'/commpilot/User/DND/',params:{}}
    });
  }
});

for(const kind of ['non-navigation binding','comment','string literal'])test(`page-menu targets ignore an unrelated ${kind}`,()=>{
  const target="redirectPost('/commpilot/User/DND/',{key:'Selected'});";
  const real="document.getElementById('link_Real').onclick=function(){"+target+"};";
  const wrong="document.getElementById('link_Wrong').onclick=function(){redirectPost('/commpilot/User/Profile/',{key:'Wrong'});};";
  const prefix=kind==='non-navigation binding'?"document.getElementById('link_Help').onclick=function(){return false;};":
    kind==='comment'?'/*'+wrong+'*/':'const text='+JSON.stringify(wrong)+';';
  const actual=menuApi({querySelectorAll:selector=>selector==='script'?[{textContent:prefix+real,getAttribute:()=>null,hasAttribute:()=>false}]:[]});
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),{link_Real:{url:'/commpilot/User/DND/',params:{key:'Selected'}}});
});
