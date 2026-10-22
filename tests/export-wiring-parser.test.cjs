const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const runtime=process.env.BW_TEST_EXTENSION_PATH||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(runtime,'src/content/pjax.js'),'utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const code=part('  function cpNativeScriptKind(script) {','  // Re-execute scripts')+part('    function cpUnescapeJs(text) {','    // id →')+
  part('    function cpElementWiring(el, doc) {','    function cpGridActionTarget')+
  part('    function cpGridExportTarget(el)', '    // Replicates legacy exportComponent');
const args=['FixtureDevice','/commpilot','/System/DeviceTypes/Modify','formtokenserial'];
const call=values=>'exportComponent('+values.map(JSON.stringify).join(',')+');';
const handler=(id,values=args,padding='')=>`document.getElementById(${JSON.stringify(id)}).onclick=function(){${padding}${call(values)}};`;
for(const fixture of [
  {name:'ordinary native binding',scripts:[handler('export')]},
  {name:'ID prefix',scripts:[handler('exportOther',['Wrong',...args.slice(1)]),handler('export')]},
  {name:'quoted device type',scripts:[handler('export',["O'Brien",...args.slice(1)])],component:"O'Brien"},
  {name:'long handler',scripts:[handler('export',args,'/*'+'x'.repeat(600)+'*/')]},
  {name:'comment and string references',scripts:['/*'+handler('export',['Wrong',...args.slice(1)])+'*/ const text='+JSON.stringify(handler('export',['Wrong',...args.slice(1)]))+';'+handler('export')]},
  {name:'unrelated following action',scripts:["document.getElementById('export').onclick=function(){return false;};"+handler('exportOther')],absent:true},
  {name:'inline wiring without ID',id:'',inline:call(args),scripts:[]},
  {name:'escaped and Unicode identifier',scripts:[handler('export',[String.raw`Device\u002F"Ω`,...args.slice(1)])],component:String.raw`Device\u002F"Ω`}
])test(`export wiring resolves the selected native action (${fixture.name})`,()=>{
  const read=vm.runInNewContext(code+'\ncpGridExportTarget;',{document:{querySelectorAll:()=>fixture.scripts.map(textContent=>({textContent,getAttribute:()=>null,hasAttribute:()=>false}))}});
  const actual=read({id:fixture.id===undefined?'export':fixture.id,getAttribute:()=>fixture.inline||null});
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),fixture.absent?null:{component:fixture.component||args[0],contextPath:args[1],pagePath:args[2],tokenName:args[3]});
});
