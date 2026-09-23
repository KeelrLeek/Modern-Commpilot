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
async function gotoLogin(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(600);
    }
  }
}
async function login(page) {
  if (new URL(page.url()).pathname !== '/commpilot/Login/') {
    await gotoLogin(page);
  }
  await page.locator('button.bw-saved-account-name').first().click();
  try {
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
  } catch (error) {
    console.log(JSON.stringify({ event: 'login-not-ready', state: await page.evaluate(() => ({
      path: location.pathname, title: document.title,
      content: (document.querySelector('td[width="82%"]')?.innerText || document.body?.innerText || '')
        .trim().slice(0, 350),
      savedSignIns: document.querySelectorAll('button.bw-saved-account-name').length
    })).catch(() => null) }));
    throw error;
  }
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

async function verifySidebarInventory(page) {
  const names = await page.locator('form[name="leftNavForm"] a.leftnavfolder, form[name="leftNavForm"] a.leftnavfolderopen')
    .evaluateAll(links => [...new Set(links.map(link => (link.textContent || '').trim()).filter(Boolean))]);
  if (!names.length) return;
  const audit = loadAudit();
  audit.inventory.sidebarVerifiedLevels ||= [];
  const added = [];
  for (const name of names) {
    if (!audit.inventory.folders.some(item => item.level === level && item.name === name)) {
      audit.inventory.folders.push({ level, name, count: 0 });
      added.push(name);
    }
  }
  if (!audit.inventory.sidebarVerifiedLevels.includes(level))
    audit.inventory.sidebarVerifiedLevels.push(level);
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'sidebar-inventory', level, liveFolders: names.length,
    added, verifiedLevels: audit.inventory.sidebarVerifiedLevels.length }));
}

async function captureActionTargets(page) {
  return page.evaluate(() => {
    const cell = document.querySelector('td[width="82%"]');
    if (!cell) return { candidates: 0, targets: [] };
    const originalRedirect = window.redirectPost;
    const originalSubmit = HTMLFormElement.prototype.submit;
    const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    const originalOpen = window.open;
    const targets = [];
    const safeLabel = /^(?:add|new|import|create|edit|view|modify|details?|profile|configure|configuration|advanced|events?|members|agents|supervisors|assign|settings|general|polic(?:y|ies)|routing|users|numbers|schedules?|announcements?|greetings?|statistics|reports?|logs?|menus?|business hours|after hours|holidays?)(?:\b|$)/i;
    const unsafeLabel = /^(?:delete|remove|clear|reset|save|ok|apply|cancel|disable|enable|sign out|logout|log out|upload|download|export|search|find|find all|next|last|first|previous|prev|sort)(?:\b|$)/i;
    const labelCounts = new Map();
    const candidates = [...cell.querySelectorAll('a, input[type="button"], button[type="button"]')]
      .filter(element => {
        if (!element.getClientRects().length || /^Row\d+Col1$/.test(element.id || '')) return false;
        const label = (element.innerText || element.value || element.title || '').trim().slice(0, 80);
        if (!label || unsafeLabel.test(label)) return false;
        const href = element.tagName === 'A' ? element.getAttribute('href') || '' : '';
        if (!safeLabel.test(label) && (!href || /^#|^javascript:/i.test(href))) return false;
        const key = label.toLowerCase();
        const seen = labelCounts.get(key) || 0;
        if (seen >= 3) return false;
        labelCounts.set(key, seen + 1);
        return true;
      }).slice(0, 250);
    const blockAnchor = event => {
      if (event.target.closest?.('a')) event.preventDefault();
    };
    const formParams = form => {
      const params = {};
      for (const control of form.elements) {
        if (!control.name || control.name === 'formtokenserial' ||
            (control.type === 'checkbox' && !control.checked) ||
            (control.type === 'radio' && !control.checked)) continue;
        params[control.name] = control.value;
      }
      return params;
    };
    let active = null;
    const record = (url, params = {}, method = 'POST') => {
      if (typeof url !== 'string') return;
      let resolved;
      try {
        resolved = url === '../Add/index.jsp' &&
          location.pathname === '/commpilot/Group/CCScheduledReports/' ?
          new URL('/commpilot/Group/CCScheduledReports/Add/index.jsp', location.href) :
          new URL(url, location.href);
      } catch { return; }
      if (resolved.origin !== location.origin || !resolved.pathname.startsWith('/commpilot/')) return;
      targets.push({ url: resolved.pathname + resolved.search, rawUrl: url, params, method,
        id: active?.id || '', label: active?.label || 'Open' });
    };
    window.redirectPost = (url, params) => { record(url, params || {}); return false; };
    HTMLFormElement.prototype.submit = function () {
      record(this.getAttribute('action') || location.pathname, formParams(this)); return false;
    };
    HTMLFormElement.prototype.requestSubmit = function () {
      record(this.getAttribute('action') || location.pathname, formParams(this)); return false;
    };
    window.open = url => { record(url, {}, 'GET'); return null; };
    document.addEventListener('click', blockAnchor, true);
    try {
      for (const element of candidates) {
        const label = (element.innerText || element.value || element.title || '').trim().slice(0, 80);
        const href = element.tagName === 'A' ? element.getAttribute('href') || '' : '';
        if (href && !/^#|^javascript:/i.test(href)) {
          active = { id: element.id || '', label };
          record(href, {}, 'GET');
          continue;
        }
        if (!safeLabel.test(label)) continue;
        active = { id: element.id || '', label };
        try { element.click(); } catch {}
      }
    } finally {
      document.removeEventListener('click', blockAnchor, true);
      window.redirectPost = originalRedirect;
      HTMLFormElement.prototype.submit = originalSubmit;
      HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
      window.open = originalOpen;
    }
    return { candidates: candidates.length, targets };
  });
}

async function verifyInnerTarget(page, audit, area, sourcePath, parentLabel, inner) {
  const wanted = routePath(inner.url, page.url());
  const record = audit.routes.find(item => (item.kind === 'nested' || item.kind === 'action') && item.sourcePath === sourcePath &&
    item.path === wanted && item.area === area);
  if (!record || (record.status === 'pass' && process.env.BW_FORCE_NESTED !== '1')) return 'continue';
  await page.evaluate(() => {
    window.__bwNestedMarker = window.__bwTestDocMarker;
    if (!window.__bwReskinProbe) {
      window.__bwReskinProbe = true;
      window.__bwReskinCount = 0;
      document.addEventListener('cp:reskin', () => { window.__bwReskinCount++; });
    }
    window.__bwNestedReskinStart = window.__bwReskinCount;
  });
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
    routePath(response.url(), page.url()) === wanted, { timeout: 15000 }).catch(() => null);
  if (process.env.BW_TRACE_REQUESTS === '1') await page.evaluate(() => {
    if (window.__bwFormTrace) return;
    window.__bwFormTrace = true;
    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      console.warn('[audit] native form submit', this.getAttribute('action') || '', this.action,
        'method=' + this.method, 'target=' + this.target,
        'content=' + !!this.closest('td[width="82%"]'),
        'connected=' + this.isConnected,
        'file=' + !!this.querySelector('input[type="file"]'));
      return originalSubmit.apply(this, arguments);
    };
    document.addEventListener('submit', event => {
      console.warn('[audit] submit event', event.target.getAttribute('action') || '', event.target.action);
    }, true);
  });
  if (process.env.BW_REAL_INNER === '1' && inner.id) {
    await page.locator(`#${inner.id}`).click({ noWaitAfter: true });
  } else {
    await page.evaluate(item => window.redirectPost(item.url, item.params), inner);
  }
  const response = await responsePromise;
  const autoFollow = wanted.includes('/DefaultConfig/Nested/Configuration/') ?
    new URL('../Files/', new URL(wanted, page.url())).pathname : null;
  const returnPage = /^\/commpilot\/Common\/(?:sort|page|find|findAll)\.jsp$/.test(wanted) &&
    inner.params?.returnPage ? String(inner.params.returnPage) : null;
  const canonical = returnPage ? routePath(returnPage.startsWith('/commpilot') ? returnPage :
    `/commpilot${returnPage.startsWith('/') ? '' : '/'}${returnPage}`, page.url()) : null;
  const expected = autoFollow || canonical || wanted;
  if (response?.status() === 200) await page.waitForFunction(({ pathname, samePage }) =>
    (location.pathname === pathname && (!samePage ||
      window.__bwReskinCount > window.__bwNestedReskinStart)) ||
    document.title.trim() === 'Login', { pathname: expected, samePage: expected === sourcePath },
  { timeout: 12000 }).catch(() => {});
  let state = null, stateError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      state = await page.evaluate(() => ({ path: location.pathname, title: document.title.trim(),
        sameDocument: window.__bwTestDocMarker === window.__bwNestedMarker,
        hasContent: !!document.querySelector('td[width="82%"]') }));
      break;
    } catch (error) { stateError = error.message; await delay(250); }
  }
  const redirectPath = response?.status() >= 300 && response?.status() < 400 &&
    response.headers().location ? routePath(response.headers().location, page.url()) : null;
  const session = !response || response.status() >= 500 || state?.title === 'Login' ||
    (redirectPath && /\/commpilot\/(?:Login|Logout)\//.test(redirectPath));
  const status = session ? 'pending' : response.status() === 200 &&
    (state?.path === wanted || (autoFollow && state?.path === autoFollow) ||
      (canonical && state?.path === canonical &&
        await page.evaluate(() => window.__bwReskinCount > window.__bwNestedReskinStart).catch(() => false))) &&
    state.sameDocument && state.hasContent ? 'pass' : 'needs';
  record.status = status;
  record.detail = response ? `HTTP ${response.status()}` +
    (status === 'pass' && autoFollow ? `; auto-followed to ${autoFollow}` : '') +
    (status === 'pass' && canonical ? `; canonicalized to ${canonical}` : '') : 'No response';
  if (status === 'pass' && autoFollow && state?.path === autoFollow &&
      !audit.routes.some(item => item.kind === 'auto-follow' && item.sourcePath === wanted &&
        item.path === autoFollow && item.area === area)) {
    audit.routes.push({ id: `discovered-${audit.routes.length + 1}`, kind: 'auto-follow',
      area, label: `${parentLabel} › Files`, path: autoFollow,
      sourcePath: wanted, status: 'pass', detail: 'Automatic PJAX form navigation' });
  }
  record.attempts ||= [];
  record.attempts.push({ at: new Date().toISOString(), status,
    httpStatus: response?.status() || null, sameDocument: state?.sameDocument === true });
  if (record.attempts.length > 12) record.attempts.shift();
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'nested-route', area, parent: parentLabel, label: inner.label,
    path: wanted, status, httpStatus: response?.status() || null,
    redirectPath, finalPath: state?.path || new URL(page.url()).pathname, sameDocument: state?.sameDocument,
    stateError }));
  if (status === 'needs' && response) {
    const html = await response.text().catch(() => '');
    const calls = [...html.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)].slice(0, 8).map(match => match[1]);
    console.log(JSON.stringify({ event: 'nested-response', path: wanted, length: html.length,
      title: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '',
      contentCell: /<td[^>]*width=["']?82%/i.test(html), calls }));
  }
  if (session) return 'session';
  if (status === 'needs') return 'gap';
  const backResponsePromise = page.waitForResponse(item => item.request().method() === 'POST' &&
    routePath(item.url(), page.url()) === sourcePath, { timeout: 15000 }).catch(() => null);
  await page.goBack();
  const backResponse = await backResponsePromise;
  console.log(JSON.stringify({ event: 'nested-back', area, parent: parentLabel,
    expected: sourcePath, status: backResponse?.status() || null,
    after: new URL(page.url()).pathname }));
  if (backResponse?.status() !== 200) {
    const flowLabel = `${area} ${parentLabel} nested Back replay`;
    const flow = audit.flows.find(item => item.label === flowLabel);
    if (flow) flow.status = 'needs';
    else audit.flows.push({ label: flowLabel, status: 'needs' });
    saveAudit(audit);
    return 'session';
  }
  await waitPath(page, sourcePath);
  const nestedFlow = audit.flows.find(item => item.label ===
    `${area} ${parentLabel} nested Back replay`);
  if (nestedFlow) { nestedFlow.status = 'pass'; saveAudit(audit); }
  return 'continue';
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
    title: document.title.trim(),
    sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
    hasContent: !!document.querySelector('td[width="82%"]'),
    alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
  const loginDocument = state?.path === '/commpilot/Login/' || state?.title === 'Login';
  const status = loginDocument ? 'pending' :
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
  let searchedRows = false;
  if (process.env.BW_DISCOVER_DEEP === '1' && status === 'pass') {
    if (process.env.BW_SEARCH_ROWS === '1') {
      const search = page.locator('td[width="82%"] #search0').first();
      if (await search.count() && await search.isVisible()) {
        const searchResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
          routePath(item.url(), page.url()) === wanted, { timeout: 10000 }).catch(() => null);
        await search.click();
        const found = await searchResponse;
        searchedRows = true;
        await page.waitForFunction(() => document.querySelectorAll('a[id^="Row"]').length > 0,
          null, { timeout: 3500 }).catch(() => {});
        const rowLinks = await page.locator('td[width="82%"] a[id^="Row"]').count();
        console.log(JSON.stringify({ event: 'search-probe', area: `${level} / ${folder}`,
          label: target.label, status: found?.status() || null,
          finalPath: new URL(page.url()).pathname, rowLinks }));
      }
    }
    if (process.env.BW_INSPECT_CONTROLS === '1') {
    result.innerControls = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] a, td[width="82%"] button, td[width="82%"] input[type="submit"]')]
      .filter(element => element.getClientRects().length)
      .map(element => ({ tag: element.tagName, label: (element.innerText || element.value || element.title || '').trim().slice(0, 80),
        id: element.id || '', href: element.getAttribute('href') || '',
        type: element.getAttribute('type') || '',
        formAction: element.closest('form')?.getAttribute('action') || '',
        onclick: String(element.onclick || element.getAttribute('onclick') || '').slice(0, 180) }))
      .filter(item => item.label || item.id || item.href));
    }
    result.innerTargets = await page.evaluate(() => {
      const cell = document.querySelector('td[width="82%"]');
      const original = window.redirectPost;
      const found = [];
      const preventSubmit = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      document.addEventListener('submit', preventSubmit, true);
      window.redirectPost = (url, params) => { found.push({ url, params: params || {} }); return false; };
      try {
        for (const link of cell.querySelectorAll('a[id]')) {
          const rowLink = /^Row\d+Col1$/.test(link.id);
          const editLink = /^link_/.test(link.id) &&
            /^(?:edit|view|details|modify|profile|open)$/i.test((link.innerText || '').trim());
          if (!rowLink && !editLink) continue;
          const before = found.length;
          link.click();
          if (found.length > before) found[found.length - 1].label =
            rowLink ? 'Row detail' : (link.innerText || link.title || link.id).trim().slice(0, 80);
          if (found.length > before) found[found.length - 1].id = link.id;
        }
      } finally {
        window.redirectPost = original;
        document.removeEventListener('submit', preventSubmit, true);
      }
      return found;
    });
  }
  if (process.env.BW_DISCOVER_ACTIONS === '1' && status === 'pass') {
    if (process.env.BW_INSPECT_ACTION === '1') result.actionContext = await page.evaluate(() => ({
      base: document.baseURI, baseTag: document.querySelector('base')?.getAttribute('href') || '',
      path: location.pathname,
      addControls: [...document.querySelectorAll('td[width="82%"] a, td[width="82%"] input, td[width="82%"] button')]
        .filter(element => /add/i.test((element.innerText || element.value || '').trim()) &&
          element.getClientRects().length)
        .slice(0, 4).map(element => ({ tag: element.tagName, type: element.type || '',
          id: element.id || '', onclick: String(element.onclick || '').slice(0, 250) }))
    }));
    const actionScan = await captureActionTargets(page);
    result.actionCandidates = actionScan.candidates;
    result.actionTargets = actionScan.targets;
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
  record.status = status;
  record.flakyHistory = hadReload && status === 'pass';
  record.detail = record.flakyHistory ?
    'PJAX passed; an earlier rapid sequence landed on Login' :
    response ? `HTTP ${response.status()}` : (error || 'No response');
  if (result.innerTargets) record.deepScanned = true;
  if (result.actionTargets) record.controlScanned = true;
  if (result.innerTargets) {
    for (const inner of result.innerTargets) {
      const innerPath = routePath(inner.url, page.url());
      if (!innerPath.startsWith('/commpilot/') || innerPath === wanted ||
          audit.routes.some(item => item.kind === 'nested' && item.sourcePath === wanted &&
            item.path === innerPath && item.area === area)) continue;
      audit.routes.push({ id: `discovered-${audit.routes.length + 1}`, kind: 'nested',
        area, label: `${target.label} › ${inner.label || 'Detail'}`, path: innerPath,
        sourcePath: wanted, status: 'pending' });
    }
  }
  if (result.actionTargets) {
    for (const action of result.actionTargets) {
      const actionPath = routePath(action.url, page.url());
      if (actionPath === wanted || !actionPath.startsWith('/commpilot/') ||
          audit.routes.some(item => (item.kind === 'nested' || item.kind === 'action') &&
            item.sourcePath === wanted && item.path === actionPath && item.area === area)) continue;
      audit.routes.push({ id: `discovered-${audit.routes.length + 1}`, kind: 'action',
        area, label: `${target.label} › ${action.label}`, path: actionPath,
        sourcePath: wanted, method: action.method, status: 'pending' });
    }
  }
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'route', ...result,
    actionTargets: result.actionTargets?.map(({ url, rawUrl, label, method, params }) =>
      ({ url, rawUrl, label, method, paramNames: Object.keys(params || {}) })),
    innerTargets: result.innerTargets?.map(({ url, label, params }) =>
      ({ url, label, paramNames: Object.keys(params || {}) })) }));
  if (loginDocument || !response || response.status() >= 500) return 'session';
  if (status === 'needs') return 'gap';
  if (process.env.BW_VERIFY_NESTED === '1' && result.innerTargets) {
    const unique = new Map();
    for (const inner of result.innerTargets) {
      const path = routePath(inner.url, page.url());
      if (!unique.has(path)) unique.set(path, inner);
    }
    for (const inner of unique.values()) {
      const outcome = await verifyInnerTarget(page, audit, area, wanted, target.label, inner);
      if (outcome !== 'continue') return outcome;
    }
  }
  if (process.env.BW_VERIFY_ACTIONS === '1' && result.actionTargets) {
    const unique = new Map();
    for (const action of result.actionTargets) {
      const path = routePath(action.url, page.url());
      if (process.env.BW_VERIFY_ACTION_LABEL && action.label !== process.env.BW_VERIFY_ACTION_LABEL) continue;
      if (process.env.BW_VERIFY_ACTION_COMMON !== '1' &&
          /^\/commpilot\/Common\/(?:sort|page|find|findAll)\.jsp$/.test(path)) continue;
      if (action.method === 'POST' && path !== wanted && !unique.has(path)) unique.set(path, action);
    }
    for (const action of unique.values()) {
      const outcome = await verifyInnerTarget(page, audit, area, wanted, target.label, action);
      if (outcome !== 'continue') return outcome;
    }
  }
  if (searchedRows) { await clickFolder(page, folder); return 'continue'; }
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
    const backFlow = audit.flows.find(item => item.label === `${level} ${folder} Back replay`);
    if (backFlow) { backFlow.status = 'pass'; saveAudit(audit); }
  }
  return 'continue';
}

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: process.env.BW_VISIBLE !== '1', viewport: null,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  if (process.env.BW_CP_DEBUG === '1') await context.addInitScript(() =>
    localStorage.setItem('cpDebug', '1'));
  const oldPages = context.pages();
  const page = await context.newPage();
  for (const old of oldPages) await old.close();
  if (process.env.BW_TRACE_REQUESTS === '1') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', event => {
      if (!event.request.url.includes('/commpilot/Group/Files/')) return;
      console.log(JSON.stringify({ event: 'files-initiator', type: event.initiator?.type,
        url: event.initiator?.url, line: event.initiator?.lineNumber,
        frames: event.initiator?.stack?.callFrames?.slice(0, 5).map(frame =>
          ({ function: frame.functionName, url: frame.url, line: frame.lineNumber })) }));
    });
  }
  if (process.env.BW_TRACE_REQUESTS === '1') page.on('framenavigated', frame => {
    if (frame === page.mainFrame())
      console.log(JSON.stringify({ event: 'main-navigation', path: routePath(frame.url(), page.url()) }));
  });
  page.on('console', message => {
    if (message.text().startsWith('[audit]'))
      console.log(JSON.stringify({ event: 'form-trace', text: message.text().slice(0, 250) }));
    if (message.text().includes('[pjax]')) {
      pjaxLog.push(message.text().slice(0, 300));
      if (pjaxLog.length > 150) pjaxLog.shift();
    }
    if (message.text().includes('[pjax]') &&
        (message.type() !== 'log' || process.env.BW_LOG_PJAX === '1'))
      console.log(JSON.stringify({ event: 'console', level: message.type(), text: message.text().slice(0, 350) }));
  });
  if (process.env.BW_TRACE_REQUESTS === '1') page.on('response', response => {
    const request = response.request();
    if (request.method() !== 'POST' || !response.url().includes('/commpilot/')) return;
    const sent = new URLSearchParams(request.postData() || '');
    console.log(JSON.stringify({ event: 'post', path: routePath(response.url(), page.url()),
      status: response.status(), token: tokenId(sent.get('formtokenserial')),
      frame: request.frame() === page.mainFrame() ? 'main' : 'child' }));
  });
  let reconnects = 0;
  try {
    await gotoLogin(page);
    for (;;) {
      try { await enterLevel(page); }
      catch (error) {
        reconnects++;
        if (reconnects >= 10) throw error;
        console.log(JSON.stringify({ event: 'entry-reconnect', level, count: reconnects,
          at: error.stack?.split('\n').slice(1, 3).map(line => line.trim()) }));
        await gotoLogin(page);
        continue;
      }
      await verifySidebarInventory(page);
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
            item.kind !== 'nested' && item.label === target.label && item.path === wanted);
          const deepAudit = loadAudit();
          const pendingInner = deepAudit.routes.some(item => item.kind === 'nested' &&
            item.area === `${level} / ${folder}` && item.sourcePath === wanted && item.status !== 'pass');
          const pendingAction = deepAudit.routes.some(item => item.kind === 'action' &&
            item.area === `${level} / ${folder}` && item.sourcePath === wanted &&
            item.status !== 'pass' && item.method === 'POST' &&
            (process.env.BW_VERIFY_ACTION_COMMON === '1' ||
              !/^\/commpilot\/Common\/(?:sort|page|find|findAll)\.jsp$/.test(item.path)));
          const needsActions = process.env.BW_DISCOVER_ACTIONS === '1' &&
            (!known?.controlScanned || (process.env.BW_VERIFY_ACTIONS === '1' && pendingAction));
          if (known?.status === 'pass' && !force && !needsActions &&
              (process.env.BW_DISCOVER_DEEP !== '1' || (known.deepScanned && !pendingInner))) continue;
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
      if (reconnects >= 10) throw new Error('Sandbox session bounced ten times; stopping for inspection');
      console.log(JSON.stringify({ event: 'session-reconnect', count: reconnects }));
      await gotoLogin(page);
    }
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message,
  at: error.stack?.split('\n').slice(1, 3).map(line => line.trim()) })); process.exitCode = 1; });
