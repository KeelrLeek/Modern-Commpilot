// Live sandbox smoke suite for the everyday PJAX paths. Headless; sandbox host only.
//
//   BW_LIVE_PROFILE=<Edge profile with the saved sandbox sign-in> npm run test:live
//
// Optional: BW_SP / BW_GROUP / BW_USER pick the sandbox entities; BW_SMOKE_WRITE=0 skips the one Peek save
// (which is always restored and re-read). Writes dev-preview/live-smoke/report.{json,html}; exit code 1 on failure.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const BASE = 'https://apps-sbx.avpaas.io';
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) { console.error('Set BW_LIVE_PROFILE to the Edge profile that holds the saved sandbox sign-in.'); process.exit(2); }
const SP = process.env.BW_SP || 'Trifecta_Sandbox_SP';
const GROUP = process.env.BW_GROUP || 'Trifecta_Sandbox_Group';
const USER = process.env.BW_USER || 'TriSandbox1002';
const WRITE = process.env.BW_SMOKE_WRITE !== '0';
const outDir = path.join(root, 'dev-preview', 'live-smoke');
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
const NOISE = /favicon|403|Blocked script|inline style|Refused to execute/;
const results = [];
let page;
let logs = [];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// `needs` names earlier checks this one depends on; if any did not pass, it is skipped with the reason.
async function check(name, fn, needs = []) {
  logs = [];
  const started = Date.now();
  const entry = { name, status: 'pass', ms: 0, detail: '' };
  const missing = needs.filter(n => results.find(r => r.name === n)?.status !== 'pass');
  if (missing.length) {
    entry.status = 'skip';
    entry.detail = 'skipped — needs: ' + missing.join('; ');
    results.push(entry);
    console.log(`SKIP  ${name}  — ${entry.detail}`);
    return false;
  }
  try {
    const detail = await fn();
    if (detail) entry.detail = detail;
  } catch (error) {
    entry.status = 'fail';
    entry.detail = error.message.split('\n')[0].slice(0, 300);
    entry.state = await snapshot().catch(() => null);
    entry.logs = logs.slice(-30);
  }
  entry.ms = Date.now() - started;
  results.push(entry);
  console.log(`${entry.status === 'pass' ? 'PASS' : 'FAIL'}  ${name}  (${(entry.ms / 1000).toFixed(1)}s)${entry.detail ? '  — ' + entry.detail : ''}`);
  return entry.status === 'pass';
}
function assert(condition, message) { if (!condition) throw new Error(message); }

function snapshot() {
  return page.evaluate(() => ({
    path: location.pathname,
    folders: [...document.querySelectorAll('.cp-console-section')].map(s => s.dataset.cpFolder).join(' '),
    boardError: document.querySelector('.cp-console-error')?.textContent.trim() || null,
    docks: document.querySelectorAll('.cp-leaf-summary').length,
    title: document.title
  }));
}
function assertSandbox() {
  assert(new URL(page.url()).origin === BASE, `Refusing to continue outside the sandbox (${new URL(page.url()).origin})`);
}

async function board(prefix, timeout = 60000) {
  await page.waitForFunction(p => {
    const secs = [...document.querySelectorAll('.cp-console-section')];
    return !document.querySelector('.cp-console-error') && secs.length && secs[0].dataset.cpFolder.startsWith(p) &&
      secs.every(s => s.querySelector('.cp-console-body')?.dataset.cpLoaded === '1');
  }, prefix, { timeout });
  assertSandbox();
  await delay(1500);
  return snapshot();
}
async function option(nameAttr) {
  await page.locator(`.cp-console-section a.navMenuItem[name="${nameAttr}"]`).first().click();
  await page.waitForFunction(n => location.pathname.includes(n.replace(/\/$/, '')), nameAttr, { timeout: 30000 });
}
async function optionByText(text) {
  await page.locator('td[width="82%"] a.navMenuItem').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
}
async function pick(name, landing) {
  await page.locator('#search0').click();
  await page.locator(`a:text-is(${JSON.stringify(name)})`).first().click({ timeout: 60000 });
  await page.waitForFunction(p => location.pathname === p, landing, { timeout: 45000 });
}
async function crumb(text) {
  await page.locator(`a.headerAuthLevelLink:text-is(${JSON.stringify(text)})`).first().click();
}
async function peekReady(target) {
  const row = page.locator(`.cp-console-section a.navMenuItem[name="${target}"]`).first()
    .locator('xpath=ancestor::tr[1]/following-sibling::tr[1]');
  await row.scrollIntoViewIfNeeded();
  await page.waitForFunction(t => {
    const box = document.querySelector(`.cp-console-section a.navMenuItem[name="${t}"]`)
      ?.closest('tr')?.nextElementSibling?.querySelector('.cp-leaf-summary');
    return box && box.getAttribute('aria-busy') === 'false';
  }, target, { timeout: 45000 });
  return row;
}
async function peekValue(target, key) {
  const row = await peekReady(target);
  return row.evaluate((el, k) => [...el.querySelectorAll('.cp-leaf-row')]
    .find(r => r.querySelector('.cp-leaf-key')?.textContent.trim().startsWith(k))
    ?.querySelector('.cp-leaf-defpill,.cp-leaf-val')?.textContent.trim() ?? null, key);
}
async function peekSet(target, key, value) {
  const row = (await peekReady(target)).locator('.cp-leaf-row')
    .filter({ has: page.locator(`.cp-leaf-key:text-matches("^${key}")`) }).first();
  await row.locator('button[aria-label="Edit value"]').click();
  await row.locator('select.cp-leaf-editin').selectOption(value);
  await row.locator('button[title="Save"]').click();
  const pill = await row.locator('.cp-leaf-defpill').elementHandle();
  await page.waitForFunction(el => /cp-leaf-(saved|fail)flash/.test(el.className), pill, { timeout: 30000 });
  return pill.evaluate(el => el.classList.contains('cp-leaf-savedflash'));
}
async function reenterUser() {
  // Back to the Users list and into the user again (the board re-reads every dock from the server).
  await page.goBack();
  await page.waitForFunction(() => location.pathname === '/commpilot/Group/Members/', null, { timeout: 30000 });
  await pick(USER, '/commpilot/Group/Members/Modify/index.jsp');
  await board('U');
}

async function signIn() {
  await page.goto(BASE + '/commpilot/Login/', { waitUntil: 'commit' });
  const saved = page.locator('button.bw-saved-account-name').first();
  await Promise.race([saved.waitFor({ timeout: 30000 }), page.waitForSelector('.cp-console-section', { timeout: 30000 })]);
  if (await saved.count()) await saved.click();
  await page.waitForSelector('.cp-console-section', { timeout: 60000 });
  const first = await page.evaluate(() => document.querySelector('.cp-console-section').dataset.cpFolder);
  if (!first.startsWith('R')) await crumb('Reseller');
  return board('R');
}
async function drillToUser() {
  await optionByText('Service Providers');
  await page.waitForFunction(() => /\/Reseller\/ServiceProviders\//.test(location.pathname), null, { timeout: 30000 });
  await pick(SP, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
  await board('S');
  await optionByText('Groups');
  await page.waitForFunction(() => location.pathname === '/commpilot/ServiceProvider/Members/', null, { timeout: 30000 });
  await pick(GROUP, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
  const g = await board('G');
  await optionByText('Users');
  await page.waitForFunction(() => location.pathname === '/commpilot/Group/Members/', null, { timeout: 30000 });
  await pick(USER, '/commpilot/Group/Members/Modify/index.jsp');
  const u = await board('U');
  return `Group ${g.docks} docks, User ${u.docks} docks`;
}

function writeReport(started) {
  fs.mkdirSync(outDir, { recursive: true });
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const summary = { version, started, finished: new Date().toISOString(), entities: { SP, GROUP, USER },
    pass: results.length - failed - skipped, fail: failed, skip: skipped, results };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  const rows = results.map(r => `<tr class="${r.status}"><td>${{ pass: '✔', fail: '✖', skip: '–' }[r.status]}</td><td>${esc(r.name)}</td>
    <td>${(r.ms / 1000).toFixed(1)} s</td><td>${esc(r.detail)}${r.logs ? `<details><summary>state and log</summary><pre>${
      esc(JSON.stringify(r.state, null, 1))}\n${esc(r.logs.join('\n'))}</pre></details>` : ''}</td></tr>`).join('');
  fs.writeFileSync(path.join(outDir, 'report.html'), `<!doctype html><meta charset="utf-8"><title>Live smoke ${esc(version)}</title>
<style>body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;margin:24px;color:#162b3d;background:#f5f8fb}
table{border-collapse:collapse;width:100%;background:#fff}td{padding:8px 10px;border-top:1px solid #d5e0e9;vertical-align:top}
tr.pass td:first-child{color:#1d7a47}tr.fail td:first-child{color:#b4371b;font-weight:700}pre{white-space:pre-wrap;font-size:12px}</style>
<h1>Live smoke · v${esc(version)}</h1><p>${summary.pass} passed, ${failed} failed, ${skipped} skipped · ${esc(started)} · ${esc(SP)} / ${esc(GROUP)} / ${esc(USER)}</p>
<table>${rows}</table>`);
  return failed;
}

(async () => {
  const started = new Date().toISOString();
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    viewport: { width: 1920, height: 1080 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  await context.addInitScript(() => { try { localStorage.setItem('cpDebug', '1'); } catch (e) {} });
  page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close();
  page.on('console', m => { if (!NOISE.test(m.text())) logs.push(m.text().slice(0, 240)); });
  page.on('framenavigated', f => { if (f === page.mainFrame()) logs.push('NAV ' + new URL(f.url()).pathname); });
  const restore = [];
  try {
    const signedIn = await check('Sign in with the saved sandbox account and reach the reseller board', async () => {
      const s = await signIn();
      return `${s.folders.split(' ').length} folders`;
    });
    if (!signedIn) throw new Error('stop');

    await check('Reseller Peek docks all load', async () => {
      await page.evaluate(async () => {
        for (const box of document.querySelectorAll('.cp-leaf-summary')) { box.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200)); }
      });
      await page.waitForFunction(() => [...document.querySelectorAll('.cp-leaf-summary')].every(b => b.getAttribute('aria-busy') === 'false'),
        null, { timeout: 45000 });
      return `${(await snapshot()).docks} docks`;
    });

    await check('Reseller › Domains opens in place and Back returns to the board signed in', async () => {
      await page.evaluate(() => document.querySelector('.cp-console')?.scrollTo(0, 0));
      await option('/Reseller/Domains/');
      await page.goBack();
      await board('R');
    });

    await check('Drill Reseller › Service Provider › Group › User through the boards', drillToUser);

    const DRILL = 'Drill Reseller › Service Provider › Group › User through the boards';
    await check('User board: open Call Waiting and Back', async () => {
      await option('/User/CW/');
      await page.goBack();
      await board('U');
    }, [DRILL]);

    if (WRITE) {
      await check('User Peek save: toggle Ring splash, re-read, restore, re-read', async () => {
        const before = await peekValue('/User/DND/', 'Ring splash');
        assert(before === 'On' || before === 'Off', `unexpected Ring splash value ${before}`);
        const flipped = before === 'On' ? 'false' : 'true';
        restore.push({ target: '/User/DND/', key: 'Ring splash', value: before === 'On' ? 'true' : 'false', before });
        assert(await peekSet('/User/DND/', 'Ring splash', flipped), 'save was not confirmed');
        await reenterUser();
        assert(await peekValue('/User/DND/', 'Ring splash') === (flipped === 'true' ? 'On' : 'Off'), 'fresh read did not show the saved value');
        assert(await peekSet('/User/DND/', 'Ring splash', restore[0].value), 'restore save was not confirmed');
        await reenterUser();
        assert(await peekValue('/User/DND/', 'Ring splash') === before, 'fresh read after restore does not match the original');
        restore.length = 0;
        return `was ${before}; saved, verified, restored`;
      }, [DRILL]);
    }

    await check('Browser Reload on the User board rebuilds it; Back from an option returns', async () => {
      await page.reload({ waitUntil: 'commit' });
      await board('U');
      await option('/User/CW/');
      await page.goBack();
      await board('U');
    }, [DRILL]);

    await check('Native breadcrumb climbs User › Group › Service Provider', async () => {
      await crumb(GROUP);
      await board('G');
      await crumb(SP);
      await board('S');
    }, [DRILL]);

    await check('Browser Reload on the Service Provider board (reached by breadcrumb) rebuilds it', async () => {
      await page.reload({ waitUntil: 'commit' });
      await board('S');
    }, ['Native breadcrumb climbs User › Group › Service Provider']);

    await check('Breadcrumb back to the reseller board', async () => {
      await crumb('Reseller');
      await board('R');
    });
  } catch (error) {
    if (error.message !== 'stop') results.push({ name: 'Suite aborted', status: 'fail', ms: 0, detail: error.message.slice(0, 300) });
  } finally {
    for (const item of restore) {
      // A check failed after changing a value: sign in fresh, put it back, and verify with a fresh read.
      await check(`Restore ${USER} ${item.key} to ${item.before} after a failed check`, async () => {
        await signIn();
        await drillToUser();
        assert(await peekSet(item.target, item.key, item.value), 'restore save was not confirmed');
        await reenterUser();
        const now = await peekValue(item.target, item.key);
        assert(now === item.before, `still ${now} — set ${USER} ${item.target} ${item.key} back to ${item.before} by hand`);
        return 'restored and re-read';
      });
    }
    const failed = writeReport(started);
    console.log(`\n${results.length - failed} passed, ${failed} failed — ${path.join(outDir, 'report.html')}`);
    await context.close();
    process.exitCode = failed ? 1 : 0;
  }
})();
