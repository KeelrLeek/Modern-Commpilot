// Seed the state-changing PJAX audit from the existing discovered route inventory.
// Reruns preserve live outcomes and newly discovered action checks.
const fs = require('node:fs');
const path = require('node:path');

const directory = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(directory, 'pjax-route-audit.json'), 'utf8'));
const output = path.join(directory, 'pjax-deep-action-audit.json');
const previous = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
const old = new Map((previous?.checks || []).map(check => [check.id, check]));
const deepKinds = new Set(['nested', 'action', 'descendant', 'auto-follow']);

function family(route) {
  const value = `${route.label || ''} ${route.path || ''}`;
  if (/Import|Upload|File|Configuration|Branding/i.test(value)) return 'Import / file';
  if (/Assign|Activation|Number|Domain|Profile/i.test(value)) return 'Assignment / pick-list';
  if (/(?:\/Add\/|\bAdd(?:\s|$)|\bCreate\b|\bNew\b)/i.test(value)) return 'Add / create';
  if (/Modify|Edit|Nested|Redirect/i.test(value)) return 'Edit / save';
  if (/Delete|Remove/i.test(value)) return 'Delete / remove';
  if (route.kind === 'interaction') return 'List interaction';
  return 'Other page action';
}

const checks = source.routes.map(route => {
  const prior = old.get(route.id);
  return prior || {
    id: route.id,
    area: route.area || 'Other',
    label: route.label || route.path,
    path: route.path || '',
    sourcePath: route.sourcePath || '',
    kind: route.kind || 'menu',
    family: family(route),
    deep: deepKinds.has(route.kind),
    submitControls: route.dynamicControls?.submit || 0,
    status: 'pending',
    detail: 'Deep action check not started.',
    checkedAt: null
  };
});
for (const prior of previous?.checks || []) {
  if (!checks.some(check => check.id === prior.id)) checks.push(prior);
}
const data = {
  title: 'CommPilot deep PJAX action audit',
  updated: new Date().toISOString(),
  environment: 'apps-sbx.avpaas.io · saved test account · headless Edge',
  scope: 'Sandbox route and interaction checks are tracked separately from final writes. A passed list interaction confirms navigation and Back; a write passes only after save and readback.',
  current: previous?.current || 'Inventory and fixture setup',
  checks,
  incidents: previous?.incidents || [],
  notes: previous?.notes || []
};
fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length,
  deep: checks.filter(x => x.deep).length,
  submitBearing: checks.filter(x => x.submitControls > 0).length,
  pending: checks.filter(x => x.status === 'pending').length }));
