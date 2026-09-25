// Run a fresh headless sandbox traversal and stream each route back to the live HTML audit.
// Navigation checks are recorded separately from final submit/readback outcomes.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

const file = path.join(__dirname, 'pjax-deep-action-audit.json');
const routeFile = path.join(__dirname, 'pjax-route-audit.json');
const levels = process.argv.slice(2).length ? process.argv.slice(2) :
  ['Group', 'User', 'Auto Attendant', 'Hunt Group', 'Call Center', 'Service Provider', 'Reseller'];
if (!process.env.BW_LIVE_PROFILE) throw new Error('Set BW_LIVE_PROFILE to saved sandbox Edge profile');

function update(item) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const routes = JSON.parse(fs.readFileSync(routeFile, 'utf8')).routes;
  const source = routes.find(route => route.area === item.area && route.path === item.path &&
    (item.event === 'route' ? !['nested','action','descendant'].includes(route.kind) :
      ['nested','action','descendant'].includes(route.kind) &&
      (!item.parent || route.label.startsWith(item.parent))));
  if (!source) return;
  let check = data.checks.find(value => value.id === source.id);
  if (!check) {
    check = {id:source.id,area:source.area,label:source.label,path:source.path,
      sourcePath:source.sourcePath || '',kind:source.kind || 'menu',family:'Other page action',
      deep:['nested','action','descendant','auto-follow'].includes(source.kind),
      submitControls:source.dynamicControls?.submit || 0,status:'pending',
      detail:'Deep action check not started.',checkedAt:null};
    data.checks.push(check);
  }
  check.navigationCheckedAt = new Date().toISOString();
  check.navigationStatus = item.status;
  if (item.status === 'needs') {
    check.status = 'failed';
    check.detail = `Fresh sandbox navigation failed at ${item.path}: HTTP ${item.httpStatus || 'no response'}, landed ${item.finalPath || 'unknown'}.`;
    check.checkedAt = check.navigationCheckedAt;
  }
  data.current = `${source.area} → ${source.label}`;
  data.currentNote = item.status === 'pass' ?
    'Route reopened in the sandbox. Final controls and readback remain separate checks.' :
    check.detail;
  data.updated = check.navigationCheckedAt;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

async function run(level) {
  console.log(JSON.stringify({event:'level-start',level}));
  const env = {...process.env,BW_AUDIT_FORCE:'1',BW_FORCE_NESTED:'1',
    BW_DISCOVER_DEEP:'1',BW_VERIFY_NESTED:'1',BW_DISCOVER_ACTIONS:'1',
    BW_VERIFY_ACTIONS:'1',BW_DISCOVER_DESCENDANTS:'1',BW_VERIFY_DESCENDANTS:'1',
    BW_DISCOVER_DYNAMIC:'1',BW_REAL_INNER:'0',BW_MAX_DESCENDANT_DEPTH:'4',
    BW_MAX_RECONNECTS:'4',BW_SKIP_UNFILLED_TRUNK_PRIORITY:'1'};
  const child = spawn(process.execPath,[path.join(__dirname,'sitewide-audit.cjs'),level],
    {cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let error = '';
  let lastChecked = null;
  const out = createInterface({input:child.stdout});
  out.on('line',line => {
    try {
      const item = JSON.parse(line);
      if (item.event === 'route') item.area = `${item.level} / ${item.folder}`;
      if (item.event === 'route' || item.event === 'nested-route') {
        lastChecked = {area:item.area,path:item.path,status:item.status};
        update(item);
        console.log(JSON.stringify({event:'checked',area:item.area,path:item.path,status:item.status}));
      } else if (['needs-fix','fatal','session-target','session-reconnect','entry-reconnect'].includes(item.event))
        console.log(JSON.stringify({...item,lastChecked}));
    } catch { console.log(line.slice(0,300)); }
  });
  child.stderr.on('data',chunk => { error += chunk; if (error.length > 4000) error = error.slice(-4000); });
  const code = await new Promise(resolve => child.on('exit',resolve));
  console.log(JSON.stringify({event:'level-done',level,code,error:error.slice(-600)}));
  return code;
}

(async () => { for (const level of levels) await run(level); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
