// Exercise sandbox search, sort, paging, tabs, and download controls and stream
// their actual in-shell result/back checks into the live deep-audit page.
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.BW_LIVE_PROFILE) throw new Error('Set BW_LIVE_PROFILE to saved sandbox Edge profile');
const file = path.join(__dirname, 'pjax-deep-action-audit.json');
const routeFile = path.join(__dirname, 'pjax-route-audit.json');
const levels = process.argv.slice(2).length ? process.argv.slice(2) :
  ['Group', 'User', 'Auto Attendant', 'Hunt Group', 'Call Center', 'Service Provider', 'Reseller'];
const modes = process.env.BW_INTERACTION_MODE ? [process.env.BW_INTERACTION_MODE] : ['base','subpages'];
const folders = process.env.BW_INTERACTION_FOLDERS ?
  process.env.BW_INTERACTION_FOLDERS.split(',').map(value => value.trim()).filter(Boolean) : [''];

function record(item, mode) {
  const audit = JSON.parse(fs.readFileSync(file, 'utf8'));
  const routes = JSON.parse(fs.readFileSync(routeFile, 'utf8')).routes;
  const area = item.area;
  const type = item.status === 'upload-pending' ? 'import' :
    item.event.startsWith('subpage-search') ? 'subpage-search' : item.event.replace(/-probe$/, '');
  const source = routes.find(route => route.area === area && route.label === item.label &&
    route.kind !== 'interaction' && (!item.path || route.path === item.path));
  const interaction = item.responsePath && routes.find(route => route.kind === 'interaction' && route.area === area &&
    route.sourcePath === (source?.path || item.path) &&
    route.path === item.responsePath);
  const id = ((type === 'tab' ? null : interaction?.id) ||
    `interaction:${source?.id || area.replace(/\W+/g,'-')}:${type}`) +
    (type === 'tab' && item.tabIndex > 0 ? `:${item.tabIndex + 1}` : '');
  let check = audit.checks.find(value => value.id === id);
  if (!check) {
    check = {id,area,label:`${item.label} › ${type}${type === 'tab' && item.trigger ? `: ${item.trigger}` : ''}`,
      path:item.responsePath || source?.path || '',
      sourcePath:source?.path || '',kind:'interaction',family:'List interaction',deep:true,
      submitControls:0,status:'pending',detail:'Interaction check not started.',checkedAt:null};
    audit.checks.push(check);
  }
  const awaitingBack = type === 'subpage-search' && item.status === 'pass' && item.backStatus === 'pending';
  const good = item.status === 'pass' && !awaitingBack &&
    (item.backStatus == null || item.backStatus === 'pass');
  const unavailable = item.status === 'pending' || item.status === 'no-trigger' || item.status === 'upload-pending';
  check.status = good ? 'passed' : awaitingBack ? 'pending' : unavailable ? 'blocked' : 'failed';
  check.detail = good ? `${type} returned HTTP ${item.httpStatus || 200} in the same document.` +
    (item.backStatus === 'pass' ? ' Back restored the page.' : '') :
    awaitingBack ? `${type} returned HTTP ${item.httpStatus || 200} in-shell; checking Back now.` :
    unavailable ? `${type}: ${item.status}. ${item.status === 'no-trigger' ?
      'No usable control on this sandbox page.' : item.status === 'upload-pending' ?
      'The import entry opened in-shell; file submission needs a disposable fixture.' :
      'Requires a fixture or stable sandbox session.'}` :
      `${type} failed: ${item.status}; HTTP ${item.httpStatus || 'none'}; Back ${item.backStatus || 'not checked'}.`;
  check.checkedAt = new Date().toISOString();
  check.navigationCheckedAt = check.checkedAt;
  check.navigationStatus = good ? 'pass' : item.status;
  audit.current = `${area} → ${check.label}`;
  audit.currentNote = check.detail;
  audit.updated = check.checkedAt;
  fs.writeFileSync(file, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({event:'interaction-check',mode,id,status:check.status,detail:check.detail}));
}

async function run(level, mode, folder) {
  const env = {...process.env,BW_AUDIT_FORCE:'1',BW_FORCE_NESTED:'1',BW_DISCOVER_DEEP:'1',
    BW_VERIFY_NESTED:'1',BW_DISCOVER_ACTIONS:'1',BW_VERIFY_ACTIONS:'1',
    BW_DISCOVER_DESCENDANTS:'1',BW_VERIFY_DESCENDANTS:'1',BW_DISCOVER_DYNAMIC:'1',
    BW_REAL_INNER:'0',BW_MAX_DESCENDANT_DEPTH:'4',BW_MAX_RECONNECTS:'3',
    BW_SEARCH_ROWS:mode === 'base' ? '1':'0',BW_SEARCH_SUBPAGES:mode === 'subpages' ? '1':'0',
    BW_FORCE_SUBPAGE_SEARCH:mode === 'subpages' ? '1':'0',
    BW_START_LABEL:process.env.BW_INTERACTION_START_LABEL || '',
    BW_SKIP_UNFILLED_TRUNK_PRIORITY:'1',
    BW_VERIFY_SORT:'1',BW_FORCE_SORT:'1',BW_VERIFY_PAGING:'1',BW_FORCE_PAGING:'1',
    BW_VERIFY_TABS:'1',BW_FORCE_TABS:'1',BW_FORCE_ALL_TABS:'1',
    BW_VERIFY_DOWNLOAD:'1',BW_FORCE_DOWNLOAD:'1'};
  console.log(JSON.stringify({event:'interaction-start',level,mode,folder:folder || 'all'}));
  const child = spawn(process.execPath,[path.join(__dirname,'sitewide-audit.cjs'),level,folder],
    {cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let last = null, error = '';
  createInterface({input:child.stdout}).on('line',line => {
    try {
      const item = JSON.parse(line);
      if (item.event === 'route' || item.event === 'nested-route')
        last = {area:item.area || `${item.level} / ${item.folder}`,path:item.path};
      else if (['search-probe','subpage-search-probe','subpage-search-complete','sort-probe','paging-probe','tab-probe','download-probe'].includes(item.event))
        record(item,mode);
      else if (['needs-fix','fatal','fixture-blocked','session-target','session-reconnect','entry-reconnect'].includes(item.event))
        console.log(JSON.stringify({...item,last}));
    } catch { console.log(line.slice(0,300)); }
  });
  child.stderr.on('data',chunk => {error += chunk;if(error.length>4000) error=error.slice(-4000);});
  const code = await new Promise(resolve => child.on('exit',resolve));
  console.log(JSON.stringify({event:'interaction-done',level,mode,folder:folder || 'all',code,error:error.slice(-600)}));
  return code;
}

(async () => {let failed = false;for (const mode of modes) for (const level of levels) for (const folder of folders)
  failed = (await run(level,mode,folder)) !== 0 || failed;
  if (failed) process.exitCode = 1;})()
  .catch(error => {console.error(error);process.exitCode=1;});
