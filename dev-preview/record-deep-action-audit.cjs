// Record an observed sandbox outcome without rewriting the 823-route inventory.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'pjax-deep-action-audit.json');
const [id, status, detail, current] = process.argv.slice(2);
if (!id || !['passed', 'failed', 'blocked', 'pending'].includes(status) || !detail)
  throw new Error('Usage: node record-deep-action-audit.cjs <id> <passed|failed|blocked|pending> <detail> [current]');
const audit = JSON.parse(fs.readFileSync(file, 'utf8'));
let check = audit.checks.find(item => item.id === id);
if (!check) {
  const routeFile = path.join(__dirname, 'pjax-route-audit.json');
  const source = fs.existsSync(routeFile) ?
    JSON.parse(fs.readFileSync(routeFile, 'utf8')).routes.find(item => item.id === id) : null;
  check = source ? {id,area:source.area,label:source.label,path:source.path,
    sourcePath:source.sourcePath || '',kind:source.kind || 'menu',family:'Other page action',
    deep:['nested','action','descendant','auto-follow'].includes(source.kind),
    submitControls:source.dynamicControls?.submit || 0} :
    { id, area: 'Cross-route action', label: id.replace(/[-:]/g, ' '), path: '',
      sourcePath: '', kind: 'action-check', family: 'Action and readback',
      deep: true, submitControls: 1 };
  audit.checks.push(check);
}
check.status = status;
check.detail = detail;
check.checkedAt = new Date().toISOString();
audit.updated = check.checkedAt;
audit.current = current || check.label;
audit.currentNote = detail;
fs.writeFileSync(file, JSON.stringify(audit, null, 2) + '\n');
console.log(`${id}: ${status} — ${detail}`);
