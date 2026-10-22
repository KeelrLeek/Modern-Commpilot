const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(runtime,'src/content/pjax.js'),'utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const code=part('  function cpNativeScriptKind(script) {','  // Re-execute scripts')+part('    function cpUnescapeJs(text) {','    // id →')+
  part('    function cpParseNativeRedirect(src,','    function cpBulkRequestDiagnostic')+
  part('    function cpElementWiring(el, doc) {','    // BroadWorks table cells');
const target='/commpilot/Group/Users/Add/';
const handler=(id,key='Fixture',padding='')=>`document.getElementById(${JSON.stringify(id)}).onclick=function(){${padding}redirectPost('${target}',{key:${JSON.stringify(key)}});};`;
for(const fixture of [
  {name:'basic',scripts:[handler('add')]},
  {name:'ID prefix',scripts:[handler('addOther','Wrong'),handler('add')]},
  {name:'quoted identifier',scripts:[handler('add',"O'Brien")],key:"O'Brien"},
  {name:'long handler',scripts:[handler('add','Fixture','/*'+'x'.repeat(500)+'*/')]},
  {name:'comment and string references',scripts:['/*'+handler('add','Wrong')+'*/ const text='+JSON.stringify(handler('add','Wrong'))+';'+handler('add')]},
  {name:'an unrelated next binding',scripts:["document.getElementById('add').onclick=function(){return false;};"+handler('addOther','Wrong')],absent:true},
  {name:'escaped element ID',id:"add'quoted",scripts:[handler("add'quoted")]},
  {name:'Unicode escaped element ID',scripts:[handler('add').replace('"add"', '"\\u0061dd"')]},
  {name:'inline wiring without an ID',id:'',scripts:[],inline:`redirectPost('${target}',{key:'Fixture'});`}
])test(`grid action resolves only its own complete native handler (${fixture.name})`,()=>{
  const read=vm.runInNewContext(code+'\ncpGridActionTarget;',{document:{querySelectorAll:()=>fixture.scripts.map(textContent=>({textContent,getAttribute:()=>null,hasAttribute:()=>false}))}});
  const actual=read({id:fixture.id===undefined?'add':fixture.id,getAttribute:()=>fixture.inline||null});
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),fixture.absent?null:{url:target,params:{key:fixture.key||'Fixture'}});
});
