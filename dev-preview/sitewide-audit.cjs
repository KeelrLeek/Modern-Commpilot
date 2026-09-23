// Resumable, read-only menu audit in the saved Edge test profile. It opens
// destinations and returns; it never submits Add/Apply/Delete/OK forms.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const auditPath = path.join(__dirname, 'pjax-route-audit.json');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = process.env.BW_LIVE_PROFILE ||
  path.join(process.env.LOCALAPPDATA, 'BroadWorksEnhancer', 'LiveDiagnosticProfile');
const level = process.argv[2] || 'Call Center';
const onlyFolder = process.argv[3] || '';
const onlyLabel = process.argv[4] || '';
const force = process.env.BW_AUDIT_FORCE === '1';
const levels = new Set(['Reseller', 'Service Provider', 'Group', 'User',
  'Auto Attendant', 'Hunt Group', 'Call Center']);
if (!levels.has(level)) throw new Error(`Unknown level: ${level}`);

const loadAudit = () => JSON.parse(fs.readFileSync(auditPath, 'utf8'));
function saveAudit(audit) {
  audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
}
const routePath = (url, base) => new URL(url, base).pathname;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pjaxLog = [];
const tokenIds = new Map();
function tokenId(value) {
  if (!value) return 0;
  if (!tokenIds.has(value)) tokenIds.set(value, tokenIds.size + 1);
  return tokenIds.get(value);
}

async function captureTargets(page) {
  return page.evaluate(() => {
    const original = window.redirectPost;
    const links = [...document.querySelectorAll('td[width="82%"] a.navMenuItem')]
      .filter(link => link.getClientRects().length);
    const found = [];
    let target = null;
    window.redirectPost = (url, params) => { target = { url, params: params || {} }; return false; };
    try {
      for (const link of links) {
        target = null;
        const label = (link.innerText || '').trim();
        if (!label || /^(?:add|delete|remove|logout|ok|apply|cancel)$/i.test(label)) continue;
        link.click();
        if (target && typeof target.url === 'string') found.push({ label, ...target });
      }
    } finally { window.redirectPost = original; }
    return found;
  });
}

async function waitPath(page, expected) {
  await page.waitForFunction(pathname => location.pathname === pathname &&
    !!document.querySelector('td[width="82%"]'), expected, { timeout: 25000 });
}
async function clickPath(page, selector, expected) {
  await page.locator(selector).click();
  await waitPath(page, expected);
}
async function clickFolder(page, folder) {
  if ((await page.title()).trim() === folder &&
      await page.locator('td[width="82%"]').count()) return;
  await page.locator('a.leftnavfolder').filter({ hasText: new RegExp(`^\\s*${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).click();
  await page.waitForFunction(expected => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
    document.title.trim() === expected && !!document.querySelector('td[width="82%"]'),
  folder, { timeout: 25000 });
}
async function login(page) {
  if (new URL(page.url()).pathname !== '/commpilot/Login/') {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
  }
  await page.locator('button.bw-saved-account-name').first().click();
  await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
    document.title.trim() === 'Profile', null, { timeout: 30000 });
}
async function enterServiceProvider(page) {
  await clickPath(page, 'td[width="82%"] a.navMenuItem:text-is("Service Providers")',
    '/commpilot/Reseller/ServiceProviders/index.jsp');
  await page.locator('#search0').click();
  await page.locator('a:text-is("Test_SP")').click();
  await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
}
async function enterGroup(page) {
  await clickPath(page, 'td[width="82%"] a.navMenuItem:text-is("Groups")',
    '/commpilot/ServiceProvider/Members/');
  await page.locator('#search0').click();
  await page.locator('a:text-is("Stan Mikita Donuts")').click();
  await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
}
async function enterLevel(page) {
  await login(page);
  if (level === 'Reseller') return;
  await enterServiceProvider(page);
  if (level === 'Service Provider') return;
  await enterGroup(page);
  if (level === 'Group') return;
  if (level === 'User') {
    await clickPath(page, 'td[width="82%"] a.navMenuItem:text-is("Users")',
      '/commpilot/Group/Members/');
    await page.locator('#search0').click();
    await page.locator('a:text-is("SMDonuts21")').click();
    await waitPath(page, '/commpilot/Group/Members/Modify/index.jsp');
    return;
  }
  if (level === 'Auto Attendant' || level === 'Hunt Group') {
    await clickFolder(page, 'Services');
    await clickPath(page, `td[width="82%"] a.navMenuItem:text-is("${level}")`,
      level === 'Auto Attendant' ? '/commpilot/Group/Auto_Attendant/' : '/commpilot/Group/Hunt_Group/');
  } else {
    await clickFolder(page, 'Call Center');
    await clickPath(page, 'td[width="82%"] a.navMenuItem:text-is("Call Centers")',
      '/commpilot/Group/Call_Center/');
  }
  await page.locator('a#Row1Col1').click();
  await waitPath(page, level === 'Auto Attendant' ? '/commpilot/Group/Auto_Attendant/EditRedirect/index.jsp' :
    level === 'Hunt Group' ? '/commpilot/Group/Hunt_Group/EditRedirect/index.jsp' :
      '/commpilot/Group/Call_Center/EditRedirect/index.jsp');
}

async function testTarget(page, target, folder) {
  const start = new URL(page.url()).pathname;
  const wanted = routePath(target.url, page.url());
  const tokenBeforeTarget = process.env.BW_TRACE_TOKENS === '1' ?
    await page.locator('[name="formtokenserial"]').first().inputValue().catch(() => '') : '';
  const hookBefore = await page.evaluate(() => String(window.redirectPost || '').slice(0, 110));
  await page.evaluate(() => {
    window.__bwTestDocMarker ||= Math.random().toString(36).slice(2);
    window.__bwAuditMarker = window.__bwTestDocMarker;
  });
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
    routePath(response.url(), page.url()) === wanted, { timeout: 15000 }).catch(() => null);
  let error = null;
  try { await page.evaluate(item => window.redirectPost(item.url, item.params), target); }
  catch (failure) { error = failure.message; }
  const response = await responsePromise;
  if (response?.status() === 200) await page.waitForFunction(origin => location.pathname !== origin ||
    !!document.querySelector('.cp-alert-error'), start, { timeout: 12000 }).catch(() => {});
  const state = await page.evaluate(() => ({ path: location.pathname,
    sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
    hasContent: !!document.querySelector('td[width="82%"]'),
    alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
  const status = state?.path === '/commpilot/Login/' ? 'pending' :
    response?.status() === 200 && state?.sameDocument && state?.hasContent &&
    !state?.alert ? 'pass' : response?.status() === 200 ? 'needs' : 'pending';
  const result = { level, folder, label: target.label, path: wanted, status,
    httpStatus: response?.status() || null, finalPath: state?.path || routePath(page.url(), page.url()),
    sameDocument: state?.sameDocument === true, error };
  let postToken = null;
  if (process.env.BW_TRACE_TOKENS === '1') {
    const tokenAfterTarget = await page.locator('[name="formtokenserial"]').first().inputValue().catch(() => '');
    const sent = new URLSearchParams(response?.request().postData() || '');
    postToken = sent.get('formtokenserial');
    result.tokens = { targetPostUsedLive: postToken === tokenBeforeTarget,
      targetRotated: !!tokenAfterTarget && tokenAfterTarget !== tokenBeforeTarget,
      targetHadToken: !!tokenBeforeTarget, before: tokenId(tokenBeforeTarget),
      sent: tokenId(postToken), after: tokenId(tokenAfterTarget),
      sentCount: sent.getAll('formtokenserial').length };
  }
  if (status === 'needs' || target.label === 'Zone Calling Restrictions') result.hookBefore = hookBefore;
  if (status === 'needs') result.document = await page.evaluate(() => ({
    title: document.title, bodyLength: document.body?.innerText?.length || 0,
    pjaxHook: String(window.redirectPost || '').slice(0, 110)
  })).catch(() => null);
  if (status === 'needs' && process.env.BW_CP_DEBUG === '1') result.pjaxLog = pjaxLog.slice(-28);
  if (status === 'needs' && response) {
    const html = await response.text().catch(() => '');
    result.response = { length: html.length, contentCell: /<td[^>]*width=["']?82%/i.test(html),
      redirectPost: /redirectPost\s*\(/.test(html),
      locationAssign: /(?:top|window|self)?\.?location\s*(?:=|\.assign|\.replace)/.test(html),
      title: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '' };
  }
  const audit = loadAudit();
  const area = `${level} / ${folder}`;
  let record = audit.routes.find(item => item.area === area && item.label === target.label && item.path === wanted);
  if (!record) {
    record = { id: `discovered-${audit.routes.length + 1}`, area, label: target.label, path: wanted, status: 'pending' };
    audit.routes.push(record);
  }
  record.attempts ||= [];
  record.attempts.push({ at: new Date().toISOString(), status,
    httpStatus: response?.status() || null, sameDocument: state?.sameDocument === true });
  if (record.attempts.length > 12) record.attempts.shift();
  const hadReload = record.attempts.some(attempt => attempt.status === 'needs' && !attempt.sameDocument);
  record.status = hadReload && status === 'pass' && process.env.BW_CLEAR_FLAKY !== '1' ? 'needs' : status;
  record.detail = record.status === 'needs' && status === 'pass' ?
    'Intermittent document reload; PJAX passed on retry' :
    response ? `HTTP ${response.status()}` : (error || 'No response');
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'route', ...result }));
  if (result.finalPath === '/commpilot/Login/' || !response || response.status() >= 500) return 'session';
  if (status === 'needs') return 'gap';
  if (result.finalPath !== start) {
    const tokenBeforeBack = process.env.BW_TRACE_TOKENS === '1' ?
      await page.locator('[name="formtokenserial"]').first().inputValue().catch(() => '') : '';
    const backResponsePromise = page.waitForResponse(item => item.request().method() === 'POST' &&
      routePath(item.url(), page.url()) === start, { timeout: 15000 }).catch(() => null);
    await page.goBack();
    const backResponse = await backResponsePromise;
    if (process.env.BW_TRACE_TOKENS === '1') {
      const backToken = new URLSearchParams(backResponse?.request().postData() || '').get('formtokenserial');
      console.log(JSON.stringify({ event: 'back-token', level, folder, label: target.label,
        status: backResponse?.status() || null, backPostHasToken: !!backToken,
        backPostUsedLive: backToken === tokenBeforeBack,
        forwardPostMatchesBackPost: backToken === postToken,
        before: tokenId(tokenBeforeBack), sent: tokenId(backToken),
        sentCount: new URLSearchParams(backResponse?.request().postData() || '').getAll('formtokenserial').length }));
    }
    if (!backResponse || backResponse.status() !== 200) {
      const flowLabel = `${level} ${folder} Back replay`;
      const flow = audit.flows.find(item => item.label === flowLabel);
      if (flow) flow.status = 'needs';
      else audit.flows.push({ label: flowLabel, status: 'needs' });
      saveAudit(audit);
      console.log(JSON.stringify({ event: 'back-failed', level, folder,
        status: backResponse?.status() || null, after: new URL(page.url()).pathname }));
      return 'session';
    }
    await page.waitForFunction(({ pathname, title }) => location.pathname === pathname &&
      document.title.trim() === title && document.documentElement.getAttribute('data-cp-path') === pathname,
    { pathname: start, title: folder }, { timeout: 20000 }).catch(() => {});
    if (new URL(page.url()).pathname === '/commpilot/Login/') return 'session';
  }
  return 'continue';
}

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: process.env.BW_HEADLESS === '1', viewport: null,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  if (process.env.BW_CP_DEBUG === '1') await context.addInitScript(() =>
    localStorage.setItem('cpDebug', '1'));
  const oldPages = context.pages();
  const page = await context.newPage();
  for (const old of oldPages) await old.close();
  page.on('console', message => {
    if (message.text().includes('[pjax]')) {
      pjaxLog.push(message.text().slice(0, 300));
      if (pjaxLog.length > 150) pjaxLog.shift();
    }
    if (message.text().includes('[pjax]') && message.type() !== 'log')
      console.log(JSON.stringify({ event: 'console', level: message.type(), text: message.text().slice(0, 350) }));
  });
  let reconnects = 0;
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
    for (;;) {
      await enterLevel(page);
      const audit = loadAudit();
      const folders = audit.inventory.folders.filter(item => item.level === level &&
        (!onlyFolder || item.name === onlyFolder)).map(item => item.name);
      let restart = false;
      for (const folder of folders) {
        await clickFolder(page, folder);
        if (process.env.BW_INSPECT_LINK) {
          const inspected = await page.locator('td[width="82%"] a.navMenuItem')
            .filter({ hasText: process.env.BW_INSPECT_LINK }).first().evaluate(link => ({
              html: link.outerHTML.slice(0, 1200), onclick: String(link.onclick || '').slice(0, 1000),
              scripts: [...document.scripts].map(script => script.textContent || '')
                .filter(source => source.includes(link.id)).map(source => source.slice(0, 1000))
            }));
          console.log(JSON.stringify({ event: 'inspect-link', level, folder, ...inspected }));
          return;
        }
        const targets = await captureTargets(page);
        for (const target of targets) {
          if (onlyLabel && target.label !== onlyLabel) continue;
          const wanted = routePath(target.url, page.url());
          const known = loadAudit().routes.find(item => item.area === `${level} / ${folder}` &&
            item.label === target.label && item.path === wanted);
          if (known?.status === 'pass' && !force) continue;
          const outcome = await testTarget(page, target, folder);
          if (outcome === 'gap') { console.log(JSON.stringify({ event: 'needs-fix', level, folder, label: target.label })); return; }
          if (outcome === 'session') { restart = true; break; }
          await delay(100);
        }
        if (restart) break;
        console.log(JSON.stringify({ event: 'folder-done', level, folder, passed: targets.length }));
      }
      if (!restart) break;
      reconnects++;
      if (reconnects >= 4) throw new Error('Sandbox session bounced four times; stopping for inspection');
      console.log(JSON.stringify({ event: 'session-reconnect', count: reconnects }));
      await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
    }
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message })); process.exitCode = 1; });
