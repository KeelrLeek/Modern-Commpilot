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
const selectedLabels = onlyLabel ? onlyLabel.split('||') : [];
const startLabel = process.env.BW_START_LABEL || '';
const force = process.env.BW_AUDIT_FORCE === '1';
const maxReconnects = Math.max(1, Number(process.env.BW_MAX_RECONNECTS || 10));
const levels = new Set(['Reseller', 'Service Provider', 'Group', 'User',
  'Auto Attendant', 'Hunt Group', 'Call Center']);
if (!levels.has(level)) throw new Error(`Unknown level: ${level}`);

const loadAudit = () => JSON.parse(fs.readFileSync(auditPath, 'utf8'));
function saveAudit(audit) {
  audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const body = JSON.stringify(audit, null, 2) + '\n';
  for (let attempt = 0; attempt < 6; attempt++) {
    try { fs.writeFileSync(auditPath, body); return; }
    catch (error) {
      if (!['UNKNOWN','EBUSY','EPERM','EACCES'].includes(error.code) || attempt === 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}
const routePath = (url, base) => new URL(url, base).pathname;
const sameViewPath = (left, right) =>
  String(left || '').replace(/\/index\.jsp$/, '/') === String(right || '').replace(/\/index\.jsp$/, '/');
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
  await page.locator('a.leftnavfolder, a.leftnavfolderopen').filter({ hasText: new RegExp(`^\\s*${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).click();
  await page.waitForFunction(expected => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
    document.title.trim() === expected && !!document.querySelector('td[width="82%"]'),
  folder, { timeout: 25000 });
}
async function gotoLogin(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/',
        { waitUntil: 'commit', timeout: 15000 });
      return;
    } catch (error) {
      const state = await page.evaluate(() => ({ path: location.pathname,
        title: document.title.trim(), savedSignIns: document.querySelectorAll('button.bw-saved-account-name').length,
        hasContent: !!document.querySelector('td[width="82%"]') })).catch(() => null);
      console.log(JSON.stringify({ event: 'login-navigation-retry', attempt: attempt + 1,
        error: error.message.slice(0, 140), state }));
      if (state?.path === '/commpilot/Common/folder_contents.jsp' &&
          state.title === 'Profile' && state.hasContent) return;
      if (attempt === 2) throw error;
      await delay(600);
    }
  }
}
async function login(page) {
  if (new URL(page.url()).pathname !== '/commpilot/Login/') {
    await gotoLogin(page);
  }
  if (new URL(page.url()).pathname === '/commpilot/Common/folder_contents.jsp' &&
      (await page.title()).trim() === 'Profile') return;
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

async function captureRowTargets(page) {
  return page.evaluate(() => {
    const cell = document.querySelector('td[width="82%"]');
    if (!cell) return [];
    const original = window.redirectPost;
    const found = [];
    const preventAnchor = event => { if (event.target.closest?.('a')) event.preventDefault(); };
    const preventSubmit = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.redirectPost = (url, params) => { found.push({ url, params: params || {} }); return false; };
    document.addEventListener('click', preventAnchor, true);
    document.addEventListener('submit', preventSubmit, true);
    try {
      for (const link of cell.querySelectorAll('a[id]')) {
        const rowLink = /^Row\d+Col1$/.test(link.id);
        const editLink = /^link_/.test(link.id) &&
          /^(?:edit|view|details|modify|profile|open)$/i.test((link.innerText || '').trim());
        if (!rowLink && !editLink) continue;
        const before = found.length;
        link.click();
        if (found.length > before) {
          found[found.length - 1].label = rowLink ? 'Row detail' :
            (link.innerText || link.title || link.id).trim().slice(0, 80);
          found[found.length - 1].id = link.id;
          found[found.length - 1].method = 'POST';
        }
      }
    } finally {
      window.redirectPost = original;
      document.removeEventListener('click', preventAnchor, true);
      document.removeEventListener('submit', preventSubmit, true);
    }
    return found;
  });
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

async function captureDynamicControls(page) {
  return page.evaluate(() => {
    const cell = document.querySelector('td[width="82%"]');
    const totals = { search: 0, sort: 0, paging: 0, tabs: 0, transfer: 0, submit: 0 };
    if (!cell) return totals;
    for (const element of cell.querySelectorAll('a, button, input[type="button"], input[type="submit"], input[type="image"]')) {
      if (!element.getClientRects().length) continue;
      const label = (element.innerText || element.value || element.title || element.alt || '').trim();
      const id = element.id || '';
      const href = element.getAttribute('href') || '';
      const handler = element.getAttribute('onclick') || '';
      const formAction = element.closest('form')?.getAttribute('action') || '';
      const text = `${label} ${id} ${href} ${handler} ${formAction}`;
      if (/\b(?:search|find|findAll)\b|^search\d+$/i.test(text)) totals.search++;
      if (/\b(?:sort|doSort)\b|\/sort\.jsp/i.test(text)) totals.sort++;
      const pagingAction = `${id} ${href} ${handler}`;
      if (/\bdoPage\b|\/page\.jsp/i.test(pagingAction) ||
          /^(?:(?:first|last|next|previous|prev)(?:\s+page)?|page\s+\d+|[‹›«»<>])$/i.test(label))
        totals.paging++;
      const tabAction = `${id} ${href} ${handler}`;
      if (element.getAttribute('role') === 'tab' ||
          /(?:^|\s)(?:tab|tablink|tab-button)(?:\s|$)/i.test(element.className || '') ||
          /\btab(?:Submit|Page)?\b/i.test(tabAction)) totals.tabs++;
      if (/\b(?:upload|download|export|import)\b/i.test(text)) totals.transfer++;
      if (/^(?:save|ok|apply|cancel|delete|remove|add|create|submit)$/i.test(label) ||
          element.getAttribute('type') === 'submit') totals.submit++;
    }
    return totals;
  });
}

async function captureTabControls(page) {
  return page.evaluate(() => [...document.querySelectorAll('td[width="82%"] a.tab, td[width="82%"] [role="tab"], td[width="82%"] .cp-srch-tabs button')]
    .filter(element => element.getClientRects().length)
    .map(element => ({ label: (element.innerText || element.value || element.title || '').trim(),
      id: element.id || '', className: element.className || '',
      html: element.outerHTML.slice(0, 450),
      script: [...document.scripts].map(script => script.textContent || '')
        .find(source => element.id && source.includes(element.id))?.slice(0, 700) || '' })));
}

async function captureTransferControls(page) {
  return page.evaluate(() => [...document.querySelectorAll('td[width="82%"] a, td[width="82%"] button, td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]')]
    .filter(element => element.getClientRects().length)
    .map(element => ({ label: (element.innerText || element.value || element.title || '').trim(),
      id: element.id || '', type: element.type || '',
      href: element.getAttribute('href') || '', html: element.outerHTML.slice(0, 350),
      script: [...document.scripts].map(script => script.textContent || '')
        .find(source => element.id && source.includes(element.id))?.slice(0, 700) || '' }))
    .filter(item => /\b(?:upload|download|export|import)\b/i.test(item.label)));
}

async function captureUploadForms(page) {
  return page.evaluate(() => [...document.querySelectorAll('td[width="82%"] form')]
    .filter(form => form.querySelector('input[type="file"]'))
    .map(form => ({ name: form.getAttribute('name') || '',
      method: (form.getAttribute('method') || 'GET').toUpperCase(),
      action: new URL(form.getAttribute('action') || location.pathname, location.href).pathname,
      enctype: form.getAttribute('enctype') || '',
      files: [...form.querySelectorAll('input[type="file"]')]
        .map(input => ({ name: input.name || '', accept: input.accept || '' })) })));
}

async function verifyDownloadControl(page, audit, record, area) {
  record.interactionChecks ||= {};
  const downloadLink = page.locator('td[width="82%"] a').filter({ hasText: /^\s*Download\s*$/i }).first();
  const exportButton = page.locator('td[width="82%"] input[name="export"]').first();
  const hasDownload = await downloadLink.count() && await downloadLink.isVisible();
  const hasExport = await exportButton.count() && await exportButton.isVisible();
  if (!hasDownload && !hasExport) {
    record.interactionChecks.transfer = { status: 'upload-pending', type: 'import-entry',
      detail: 'Import entry opens by PJAX; file submission awaits verification' };
    saveAudit(audit);
    console.log(JSON.stringify({ event: 'download-probe', area, label: record.label,
      status: 'upload-pending' }));
    return 'continue';
  }
  const before = await page.evaluate(() => ({ path: location.pathname,
    marker: window.__bwTestDocMarker, historyLength: history.length,
    reskinCount: window.__bwReskinCount || 0 }));
  const responsePromise = page.waitForResponse(response =>
    hasDownload ? response.request().method() === 'POST' &&
      routePath(response.url(), page.url()) === '/commpilot/servlet/HttpProxy' :
      response.request().method() === 'POST' && /[?&]export=/.test(response.url()),
  { timeout: 15000 }).catch(() => null);
  const proxyPromise = hasExport ? page.waitForResponse(response =>
    response.request().method() === 'GET' &&
    routePath(response.url(), page.url()) === '/commpilot/servlet/HttpProxy',
  { timeout: 15000 }).catch(() => null) : Promise.resolve(null);
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await (hasDownload ? downloadLink : exportButton).click({ noWaitAfter: true });
  const [response, proxy, download] = await Promise.all([responsePromise, proxyPromise, downloadPromise]);
  // Chromium can briefly destroy the execution context while handing a top-level
  // attachment response to its download manager. Read the settled document.
  let after = null;
  let afterError = null;
  for (let attempt = 0; attempt < 5 && !after; attempt++) {
    if (attempt) await delay(150);
    after = await page.evaluate(() => ({ path: location.pathname,
      marker: window.__bwTestDocMarker, historyLength: history.length,
      reskinCount: window.__bwReskinCount || 0,
      title: document.title.trim() })).catch(error => { afterError = error.message.slice(0, 180); return null; });
  }
  const sameDocument = !!after && before.marker === after.marker &&
    before.path === after.path && before.historyLength === after.historyLength;
  const passed = response?.status() === 200 && (!hasExport || proxy?.status() === 200) &&
    !!download && sameDocument;
  record.interactionChecks.transfer = {
    status: passed ? 'pass' : after?.path === '/commpilot/Login/' ? 'pending' : 'needs',
    type: hasDownload ? 'binary-download' : 'export',
    responsePath: response ? routePath(response.url(), page.url()) : null,
    httpStatus: response?.status() || null, downloadStarted: !!download, sameDocument,
    proxyStatus: proxy?.status() || null,
    historyUnchanged: before.historyLength === after?.historyLength,
    beforePath: before.path, afterPath: after?.path || null,
    historyBefore: before.historyLength, historyAfter: after?.historyLength ?? null,
    markerUnchanged: before.marker === after?.marker,
    afterError, pageClosed: page.isClosed(),
    contentType: response?.headers()['content-type'] || null,
    contentLength: response?.headers()['content-length'] || null
  };
  if (download) await download.cancel().catch(() => {});
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'download-probe', area, label: record.label,
    ...record.interactionChecks.transfer }));
  return passed ? 'continue' : record.interactionChecks.transfer.status === 'pending' ? 'session' : 'gap';
}

async function verifySortControl(page, audit, record, area, wanted) {
  let sort = null;
  for (const candidate of await page.locator('td[width="82%"] a.listSortHeader').all()) {
    if (await candidate.isVisible()) { sort = candidate; break; }
  }
  record.interactionChecks ||= {};
  if (!sort) {
    record.interactionChecks.sort = { status: 'no-trigger' };
    saveAudit(audit);
    console.log(JSON.stringify({ event: 'sort-probe', area, label: record.label,
      status: 'no-trigger' }));
    return 'continue';
  }
  const trigger = (await sort.innerText()).trim();
  const before = await page.evaluate(() => ({ path: location.pathname,
    count: window.__bwReskinCount || 0,
    historyLength: history.length, nav: history.state?.cpNav?.url || null }));
  const sortResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
    /\/commpilot\/Common\/sort\.jsp$/.test(routePath(item.url(), page.url())),
  { timeout: 12000 }).catch(() => null);
  await sort.click();
  const found = await sortResponse;
  await page.waitForFunction(count => (window.__bwReskinCount || 0) > count ||
    location.pathname === '/commpilot/Login/', before.count, { timeout: 12000 }).catch(() => {});
  const after = await page.evaluate(() => ({ path: location.pathname,
    title: document.title, count: window.__bwReskinCount || 0,
    historyLength: history.length, nav: history.state?.cpNav?.url || null,
    sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
    hasContent: !!document.querySelector('td[width="82%"]'),
    alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
  const sorted = found?.status() === 200 && sameViewPath(after?.path, wanted) &&
    after.sameDocument && after.count > before.count && after.hasContent && !after.alert;
  let backStatus = 'pending';
  if (sorted) {
    try {
      await page.goBack();
      const restored = await page.waitForFunction(({ path, count }) =>
        location.pathname.replace(/\/index\.jsp$/, '/') === path.replace(/\/index\.jsp$/, '/') &&
          (window.__bwReskinCount || 0) > count &&
          !!document.querySelector('td[width="82%"]'),
      { path: before.path, count: after.count }, { timeout: 15000 }).then(() => true).catch(() => false);
      backStatus = restored ? 'pass' : 'needs';
    } catch { backStatus = 'needs'; }
  }
  record.interactionChecks.sort = { status: sorted && backStatus === 'pass' ? 'pass' :
    after?.path === '/commpilot/Login/' ? 'pending' : 'needs',
  trigger, responsePath: found ? routePath(found.url(), page.url()) : null,
  httpStatus: found?.status() || null, sameDocument: after?.sameDocument === true,
  reskinned: !!after && after.count > before.count, backStatus };
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'sort-probe', area, label: record.label,
    before, after, ...record.interactionChecks.sort }));
  return record.interactionChecks.sort.status === 'pass' ? 'continue' :
    record.interactionChecks.sort.status === 'pending' ? 'session' : 'gap';
}

async function verifyPagingControl(page, audit, record, area, wanted) {
  const controls = await page.locator('td[width="82%"] a, td[width="82%"] button, ' +
    'td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]').all();
  let paging = null;
  for (const label of ['Next', 'Last']) {
    for (const candidate of controls) {
      if (!await candidate.isVisible() || !await candidate.isEnabled()) continue;
      const text = (await candidate.evaluate(element =>
        (element.innerText || element.value || element.title || '').trim())).trim();
      if (text.toLowerCase() === label.toLowerCase()) { paging = candidate; break; }
    }
    if (paging) break;
  }
  record.interactionChecks ||= {};
  if (!paging) {
    record.interactionChecks.paging = { status: 'no-trigger' };
    saveAudit(audit);
    console.log(JSON.stringify({ event: 'paging-probe', area, label: record.label,
      status: 'no-trigger' }));
    return 'continue';
  }
  const trigger = await paging.evaluate(element =>
    (element.innerText || element.value || element.title || '').trim());
  const before = await page.evaluate(() => ({ path: location.pathname,
    count: window.__bwReskinCount || 0,
    historyLength: history.length, nav: history.state?.cpNav?.url || null }));
  const pageResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
    /\/commpilot\/Common\/page\.jsp$/.test(routePath(item.url(), page.url())),
  { timeout: 12000 }).catch(() => null);
  await paging.click();
  const found = await pageResponse;
  await page.waitForFunction(count => (window.__bwReskinCount || 0) > count ||
    location.pathname === '/commpilot/Login/', before.count, { timeout: 12000 }).catch(() => {});
  const after = await page.evaluate(() => ({ path: location.pathname,
    title: document.title, count: window.__bwReskinCount || 0,
    historyLength: history.length, nav: history.state?.cpNav?.url || null,
    sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
    hasContent: !!document.querySelector('td[width="82%"]'),
    alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
  const paged = found?.status() === 200 && sameViewPath(after?.path, wanted) &&
    after.sameDocument && after.count > before.count && after.hasContent && !after.alert;
  let backStatus = 'pending';
  if (paged) {
    try {
      await page.goBack();
      const restored = await page.waitForFunction(({ path, count }) =>
        location.pathname.replace(/\/index\.jsp$/, '/') === path.replace(/\/index\.jsp$/, '/') &&
          (window.__bwReskinCount || 0) > count &&
          !!document.querySelector('td[width="82%"]'),
      { path: before.path, count: after.count }, { timeout: 15000 }).then(() => true).catch(() => false);
      backStatus = restored ? 'pass' : 'needs';
    } catch { backStatus = 'needs'; }
  }
  record.interactionChecks.paging = { status: paged && backStatus === 'pass' ? 'pass' :
    after?.path === '/commpilot/Login/' ? 'pending' : 'needs',
  trigger, responsePath: found ? routePath(found.url(), page.url()) : null,
  httpStatus: found?.status() || null, sameDocument: after?.sameDocument === true,
  reskinned: !!after && after.count > before.count, backStatus };
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'paging-probe', area, label: record.label,
    before, after, ...record.interactionChecks.paging }));
  return record.interactionChecks.paging.status === 'pass' ? 'continue' :
    record.interactionChecks.paging.status === 'pending' ? 'session' : 'gap';
}

async function verifyTabControl(page, audit, record, area, wanted, tabIndex = 0) {
  const visibleTabs = [];
  for (const candidate of await page.locator('td[width="82%"] a.tab').all())
    if (await candidate.isVisible()) visibleTabs.push(candidate);
  const tab = visibleTabs[tabIndex] || null;
  record.interactionChecks ||= {};
  if (!tab) {
    record.interactionChecks.tabs = { status: 'no-trigger' };
    saveAudit(audit);
    console.log(JSON.stringify({ event: 'tab-probe', area, label: record.label,
      tabIndex, status: 'no-trigger' }));
    return 'continue';
  }
  const trigger = (await tab.innerText()).replace(/\s+/g, ' ').trim();
  // CommPilot persists the Call Park group when this tab is opened. Keep this
  // probe opt-in; the disposable group must be deleted after the run.
  if (/^\/commpilot\/Group\/CallPark\/Add\/index\.jsp$/.test(new URL(page.url()).pathname) &&
      trigger === 'Alternate Recall User' && process.env.BW_ALLOW_CALLPARK_TAB_WRITE !== '1') {
    console.log(JSON.stringify({ event: 'tab-probe', area, label: record.label,
      tabIndex, status: 'write-probe-skipped', trigger }));
    return 'continue';
  }
  if (/^\/commpilot\/Group\/CallPark\/Add\/index\.jsp$/.test(new URL(page.url()).pathname) &&
      trigger === 'Alternate Recall User')
    await page.locator('td[width="82%"] input[name="callParkGroupName"]').fill('PJAX Audit Unsaved');
  const before = await page.evaluate(() => ({ path: location.pathname,
    count: window.__bwReskinCount || 0,
    active: (document.querySelector('td[width="82%"] .tabActive')?.textContent || '')
      .replace(/\s+/g, ' ').trim(),
    historyLength: history.length, nav: history.state?.cpNav?.url || null }));
  const tabResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
    routePath(item.url(), page.url()).startsWith('/commpilot/'),
  { timeout: 12000 }).catch(() => null);
  await tab.click();
  const found = await tabResponse;
  await page.waitForFunction(({ count, trigger }) =>
    ((window.__bwReskinCount || 0) > count &&
      (document.querySelector('td[width="82%"] .tabActive')?.textContent || '')
        .replace(/\s+/g, ' ').trim() === trigger) ||
    location.pathname === '/commpilot/Login/',
  { count: before.count, trigger }, { timeout: 12000 }).catch(() => {});
  const after = await page.evaluate(() => ({ path: location.pathname,
    title: document.title, count: window.__bwReskinCount || 0,
    active: (document.querySelector('td[width="82%"] .tabActive')?.textContent || '')
      .replace(/\s+/g, ' ').trim(),
    sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
    hasContent: !!document.querySelector('td[width="82%"]'),
    alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
  const switched = found?.status() === 200 && after?.active === trigger &&
    after.sameDocument && after.count > before.count && after.hasContent && !after.alert;
  let backStatus = 'pending';
  let backState = null;
  if (switched) {
    try {
      await page.goBack();
      const restored = await page.waitForFunction(({ path, count, active }) =>
        location.pathname.replace(/\/index\.jsp$/, '/') === path.replace(/\/index\.jsp$/, '/') &&
          (window.__bwReskinCount || 0) > count &&
          (document.querySelector('td[width="82%"] .tabActive')?.textContent || '')
            .replace(/\s+/g, ' ').trim() === active,
      { path: before.path, count: after.count, active: before.active },
      { timeout: 15000 }).then(() => true).catch(() => false);
      backStatus = restored ? 'pass' : 'needs';
    } catch { backStatus = 'needs'; }
    if (backStatus !== 'pass') backState = await page.evaluate(() => ({
      path: location.pathname, active: (document.querySelector('td[width="82%"] .tabActive')?.textContent || '').trim(),
      count: window.__bwReskinCount || 0, historyLength: history.length,
      nav: history.state?.cpNav?.url || null, alert: document.querySelector('.cp-alert-error')?.textContent || ''
    })).catch(() => null);
  }
  record.interactionChecks.tabs = { status: switched && backStatus === 'pass' ? 'pass' :
    after?.path === '/commpilot/Login/' ? 'pending' : 'needs',
  trigger, activeBefore: before.active, activeAfter: after?.active || null,
  responsePath: found ? routePath(found.url(), page.url()) : null,
  httpStatus: found?.status() || null, sameDocument: after?.sameDocument === true,
  reskinned: !!after && after.count > before.count, backStatus };
  saveAudit(audit);
  console.log(JSON.stringify({ event: 'tab-probe', area, label: record.label,
    tabIndex, before, after, backState, ...record.interactionChecks.tabs }));
  return record.interactionChecks.tabs.status === 'pass' ? 'continue' :
    record.interactionChecks.tabs.status === 'pending' ? 'session' : 'gap';
}

async function verifyTabControls(page, audit, record, area, wanted) {
  const count = process.env.BW_FORCE_ALL_TABS === '1' ?
    await page.locator('td[width="82%"] a.tab:visible').count() : 1;
  for (let index = 0; index < count; index++) {
    const outcome = await verifyTabControl(page, audit, record, area, wanted, index);
    if (outcome !== 'continue') return outcome;
  }
  return 'continue';
}

function descendantDepthLimit() {
  return Math.min(8, Math.max(1, Number(process.env.BW_MAX_DESCENDANT_DEPTH || 4)));
}

function isCanonicalAction(path) {
  return /^\/commpilot\/Common\/(?:sort|page|find|findAll)\.jsp$/.test(path);
}

function needsSubpageWork(audit, area, item, depth = 0, seen = new Set()) {
  if (depth >= descendantDepthLimit() ||
      (isCanonicalAction(item.path) && process.env.BW_VERIFY_ACTION_COMMON !== '1')) return false;
  if (item.backPending) return true;
  if (process.env.BW_DISCOVER_DYNAMIC === '1' && !item.dynamicScanned) return true;
  if (process.env.BW_SEARCH_SUBPAGES === '1' && (item.dynamicControls?.search || 0) > 0 &&
      (process.env.BW_FORCE_SUBPAGE_SEARCH === '1' || !(item.searchCheck?.status === 'pass' && item.searchCheck.reskinned === true &&
        item.searchCheck.backStatus === 'pass'))) return true;
  if (process.env.BW_VERIFY_SORT === '1' && (item.dynamicControls?.sort || 0) > 0 &&
      (item.interactionChecks?.sort?.status !== 'pass' || process.env.BW_FORCE_SORT === '1')) return true;
  if (process.env.BW_VERIFY_PAGING === '1' && (item.dynamicControls?.paging || 0) > 0 &&
      (item.interactionChecks?.paging?.status !== 'pass' || process.env.BW_FORCE_PAGING === '1')) return true;
  if (process.env.BW_VERIFY_TABS === '1' && (item.dynamicControls?.tabs || 0) > 0 &&
      (item.interactionChecks?.tabs?.status !== 'pass' || process.env.BW_FORCE_TABS === '1')) return true;
  if (process.env.BW_VERIFY_DOWNLOAD === '1' && (item.dynamicControls?.transfer || 0) > 0 &&
      (!['pass', 'upload-pending'].includes(item.interactionChecks?.transfer?.status) ||
        process.env.BW_FORCE_DOWNLOAD === '1')) return true;
  if (process.env.BW_DISCOVER_UPLOADS === '1' && !item.uploadScanned) return true;
  if (!item.controlScanned) return true;
  const sourcePath = item.path.includes('/DefaultConfig/Nested/Configuration/') ?
    new URL('../Files/', new URL(item.path, 'https://audit.invalid')).pathname : item.path;
  if (seen.has(sourcePath)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(sourcePath);
  return audit.routes.some(child => child.kind === 'descendant' && child.area === area &&
    child.sourcePath === sourcePath && child.method !== 'GET' &&
    (child.status !== 'pass' || needsSubpageWork(audit, area, child, depth + 1, nextSeen)));
}

async function verifyInnerTarget(page, audit, area, sourcePath, parentLabel, inner, depth = 0) {
  const wanted = routePath(inner.url, page.url());
  if (process.env.BW_SKIP_UNFILLED_TRUNK_PRIORITY === '1' &&
      (/\/EnterpriseTrunk\/AddUsingWeightedRouting\/AssignPriorities\/?$/.test(wanted) ||
        (/\/EnterpriseTrunk\/AddUsers\/?$/.test(wanted) &&
          /\/EnterpriseTrunk\/AddUsing(?:Weighted|Ordered)Routing\/AddModify\//.test(sourcePath)))) {
    console.log(JSON.stringify({event:'fixture-blocked',area,parent:parentLabel,
      label:inner.label,path:wanted,reason:'Unfilled Enterprise Trunk Add form returns HTTP 500'}));
    return 'continue';
  }
  const record = audit.routes.find(item => ['nested', 'action', 'descendant'].includes(item.kind) && item.sourcePath === sourcePath &&
    item.path === wanted && item.area === area);
  const scanUploads = process.env.BW_DISCOVER_UPLOADS === '1' && record && !record.uploadScanned;
  const scanDescendants = process.env.BW_DISCOVER_DESCENDANTS === '1' && record &&
    (process.env.BW_RESCAN_DYNAMIC === '1' || !record.controlScanned ||
      (process.env.BW_VERIFY_DESCENDANTS === '1' &&
      needsSubpageWork(audit, area, record, depth)));
  if (!record || (record.status === 'pass' && process.env.BW_FORCE_NESTED !== '1' &&
      !scanDescendants && !scanUploads)) return 'continue';
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
  if (response?.status() === 200) await page.waitForFunction(pathname =>
    (location.pathname === pathname &&
      window.__bwReskinCount > window.__bwNestedReskinStart) ||
    document.title.trim() === 'Login', expected,
  { timeout: 12000 }).catch(() => {});
  let state = null, stateError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      state = await page.evaluate(() => ({ path: location.pathname, title: document.title.trim(),
        sameDocument: window.__bwTestDocMarker === window.__bwNestedMarker,
        reskinned: window.__bwReskinCount > window.__bwNestedReskinStart,
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
    state.sameDocument && state.reskinned && state.hasContent ? 'pass' : 'needs';
  record.status = status;
  record.backPending = status === 'pass';
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
  if (scanUploads) {
    record.uploadForms = await captureUploadForms(page);
    record.uploadScanned = true;
    saveAudit(audit);
    if (record.uploadForms.length) console.log(JSON.stringify({ event: 'upload-inventory',
      area, label: record.label, path: wanted, forms: record.uploadForms }));
  }
  if (process.env.BW_INSPECT_TABS === '1') console.log(JSON.stringify({ event: 'tab-controls',
    area, label: record.label, path: wanted, controls: await captureTabControls(page) }));
  if (process.env.BW_INSPECT_TAB_FUNCTION === '1') console.log(JSON.stringify({ event: 'tab-function',
    area, label: record.label, path: wanted, handlers: await page.evaluate(() => ({
      TabSubmit: String(window.TabSubmit || '').slice(0, 2500),
      TabWithSubmit: String(window.TabWithSubmit || '').slice(0, 2500),
      validate: String(window.validate || '').slice(0, 3500),
      forms: [...document.querySelectorAll('td[width="82%"] form')].map(form => ({
        name: form.name, action: form.getAttribute('action'), method: form.method,
        fields: [...form.elements].filter(item => item.name && item.type !== 'hidden' && item.type !== 'password')
          .map(item => ({ name: item.name, type: item.type, value: /^(?:text|number)$/.test(item.type) ? item.value : undefined,
            options: item.tagName === 'SELECT' ? item.options.length : undefined })) })) })) }));
  if (process.env.BW_INSPECT_TRANSFER_CONTROLS === '1' && (record.dynamicControls?.transfer || 0) > 0)
    console.log(JSON.stringify({ event: 'transfer-controls', area, label: record.label,
      path: wanted, controls: await captureTransferControls(page) }));
  if (process.env.BW_INSPECT_UPLOAD_FORM === '1') {
    const forms = await page.evaluate(() => ({ files: [...document.querySelectorAll('input[type="file"]')]
      .map(input => ({ name: input.name || '', id: input.id || '',
        form: input.closest('form')?.getAttribute('name') || '' })),
      forms: [...document.querySelectorAll('form')]
      .filter(form => form.querySelector('input[type="file"]'))
      .map(form => ({ name: form.getAttribute('name') || '', method: form.getAttribute('method') || '',
        action: form.getAttribute('action') || '', target: form.getAttribute('target') || '',
        enctype: form.getAttribute('enctype') || '',
        controls: [...form.elements].map(element => ({ name: element.name || '',
          type: element.type || '', label: /^(?:button|submit)$/.test(element.type || '') ?
            (element.value || element.title || '').slice(0, 45) : '' }))
          .filter(item => item.type !== 'password') })) }));
    console.log(JSON.stringify({ event: 'upload-form', area,
      label: record.label, path: wanted, ...forms }));
  }
  if (scanDescendants) {
    if (process.env.BW_DISCOVER_DYNAMIC === '1') {
      record.dynamicControls = await captureDynamicControls(page);
      record.dynamicScanned = true;
    }
    const rowTargets = state.path === sourcePath ? [] : await captureRowTargets(page);
    const actionScan = state.path === sourcePath ? { candidates: 0, targets: [] } :
      await captureActionTargets(page);
    if (record.dynamicControls && actionScan.targets.some(child => isCanonicalAction(routePath(child.url, page.url()))))
      record.dynamicControls.sort = Math.max(1, record.dynamicControls.sort);
    const children = [...rowTargets, ...actionScan.targets];
    const unique = new Map();
    for (const child of children) {
      const childPath = routePath(child.url, page.url());
      if (childPath === state.path || childPath === sourcePath ||
          !childPath.startsWith('/commpilot/') || unique.has(childPath)) continue;
      unique.set(childPath, child);
      if (!audit.routes.some(item => item.sourcePath === state.path &&
          item.path === childPath && item.area === area)) {
        audit.routes.push({ id: `discovered-${audit.routes.length + 1}`, kind: 'descendant',
          area, label: `${parentLabel} › ${inner.label || 'Detail'} › ${child.label || 'Open'}`,
          path: childPath, sourcePath: state.path, method: child.method || 'POST',
          status: 'pending' });
      }
    }
    record.controlScanned = true;
    record.controlCandidates = actionScan.candidates;
    saveAudit(audit);
    console.log(JSON.stringify({ event: 'descendant-scan', area, parent: parentLabel,
      path: state.path, depth, rowTargets: rowTargets.length,
      actionCandidates: actionScan.candidates, routes: unique.size }));
    if (process.env.BW_VERIFY_DESCENDANTS === '1') {
      for (const child of unique.values()) {
        const childPath = routePath(child.url, page.url());
        if (child.method === 'GET' ||
            (isCanonicalAction(childPath) && process.env.BW_VERIFY_ACTION_COMMON !== '1')) continue;
        const outcome = await verifyInnerTarget(page, audit, area, state.path,
          `${parentLabel} › ${inner.label || 'Detail'}`, child, depth + 1);
        if (outcome !== 'continue') return outcome;
      }
    }
  }
  if (process.env.BW_SEARCH_SUBPAGES === '1' && (record.dynamicControls?.search || 0) > 0 &&
      (process.env.BW_FORCE_SUBPAGE_SEARCH === '1' || !(record.searchCheck?.status === 'pass' && record.searchCheck.reskinned === true &&
        record.searchCheck.backStatus === 'pass'))) {
    const searchCandidates = page.locator('td[width="82%"] #search0, td[width="82%"] #findButton, ' +
      'td[width="82%"] input[type="submit"][id^="search" i], ' +
      'td[width="82%"] input[type="submit"][value="Find" i], ' +
      'td[width="82%"] input[type="submit"][value="Search" i]');
    let search = null;
    for (const candidate of await searchCandidates.all()) {
      if (await candidate.isVisible()) { search = candidate; break; }
    }
    if (search) {
      const trigger = /find/i.test(await search.getAttribute('value') || '') ? 'Find' :
        (await search.getAttribute('id') || 'Search');
      const beforeSearchPath = new URL(page.url()).pathname;
      const beforeSearchHistory = await page.evaluate(() => ({
        navPath: history.state?.cpNav?.url || null, length: history.length }));
      if (process.env.BW_TRACE_HISTORY === '1') await page.evaluate(() => {
        if (window.__bwHistoryTrace) return;
        window.__bwHistoryTrace = [];
        const push = history.pushState, replace = history.replaceState;
        history.pushState = function (historyState, title, url) {
          window.__bwHistoryTrace.push({ type: 'push', path: String(url || location.pathname),
            navPath: historyState?.cpNav?.url || null });
          return push.apply(this, arguments);
        };
        history.replaceState = function (historyState, title, url) {
          window.__bwHistoryTrace.push({ type: 'replace', path: String(url || location.pathname),
            navPath: historyState?.cpNav?.url || null });
          return replace.apply(this, arguments);
        };
        window.addEventListener('popstate', event => window.__bwHistoryTrace.push({
          type: 'pop', path: location.pathname, navPath: event.state?.cpNav?.url || null }), true);
      });
      const reskinStart = await page.evaluate(() => window.__bwReskinCount || 0);
      const searchResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
        (routePath(item.url(), page.url()) === beforeSearchPath ||
          routePath(item.url(), page.url()) === wanted ||
          /^\/commpilot\/Common\/(?:find|findAll|page)\.jsp$/.test(routePath(item.url(), page.url()))),
      { timeout: 12000 }).catch(() => null);
      await search.click();
      const found = await searchResponse;
      await page.waitForFunction(count => (window.__bwReskinCount || 0) > count ||
        location.pathname === '/commpilot/Login/' || !!document.querySelector('.cp-alert-error'),
      reskinStart, { timeout: 12000 }).catch(() => {});
      const searchState = await page.evaluate(count => ({ path: location.pathname,
        title: document.title.trim(), sameDocument: window.__bwTestDocMarker === window.__bwNestedMarker,
        reskinned: (window.__bwReskinCount || 0) > count,
        hasContent: !!document.querySelector('td[width="82%"]') }), reskinStart).catch(() => null);
      const unavailable = !found || found.status() >= 500 ||
        searchState?.path === '/commpilot/Login/' || searchState?.title === 'Login';
      record.searchCheck = { status: unavailable ? 'pending' : found.status() === 200 &&
        searchState?.sameDocument && searchState?.reskinned && searchState?.hasContent ? 'pass' : 'needs',
        trigger, responsePath: found ? routePath(found.url(), page.url()) : null,
        httpStatus: found?.status() || null, finalPath: searchState?.path || null,
        sameDocument: searchState?.sameDocument === true, reskinned: searchState?.reskinned === true,
        backStatus: 'pending' };
      if (record.searchCheck.responsePath) {
        let interaction = audit.routes.find(item => item.kind === 'interaction' && item.area === area &&
          item.sourcePath === wanted && item.path === record.searchCheck.responsePath);
        if (!interaction) {
          interaction = { id: `discovered-${audit.routes.length + 1}`, kind: 'interaction', area,
            label: `${record.label} › ${/find/i.test(trigger) ? 'Find' : 'Search'}`,
            sourcePath: wanted, path: record.searchCheck.responsePath, method: 'POST', status: 'pending' };
          audit.routes.push(interaction);
        }
        interaction.status = record.searchCheck.status;
        interaction.detail = `HTTP ${record.searchCheck.httpStatus || 'none'}; ` +
          (record.searchCheck.sameDocument ? 'same document' : 'document changed');
      }
      saveAudit(audit);
      console.log(JSON.stringify({ event: 'subpage-search-probe', area, label: record.label,
        path: wanted, beforeSearchHistory,
        afterSearchHistory: await page.evaluate(() => ({ navPath: history.state?.cpNav?.url || null,
          length: history.length, trace: window.__bwHistoryTrace || [] })).catch(() => null),
        ...record.searchCheck }));
      if (record.searchCheck.status !== 'pass')
        return record.searchCheck.status === 'pending' ? 'session' : 'gap';
      const searchBackStart = await page.evaluate(() => window.__bwReskinCount || 0).catch(() => null);
      if (searchBackStart === null) return 'session';
      try { await page.goBack(); } catch (error) {
        console.log(JSON.stringify({ event: 'subpage-search-back', area, label: record.label,
          status: 'navigation-error', error: error.message }));
        return 'session';
      }
      const restored = await page.waitForFunction(({ before, parent, count }) =>
        (location.pathname === before || location.pathname === parent) &&
          (window.__bwReskinCount || 0) > count && !!document.querySelector('td[width="82%"]'),
      { before: beforeSearchPath, parent: sourcePath, count: searchBackStart },
      { timeout: 20000 }).then(() => true).catch(() => false);
      console.log(JSON.stringify({ event: 'subpage-search-back', area, label: record.label,
        status: restored ? 'pass' : 'pending', beforeSearchPath, sourcePath,
        finalPath: new URL(page.url()).pathname,
        pageState: await page.evaluate(() => ({ title: document.title,
          navPath: history.state?.cpNav?.url || null,
          hasFind: !!document.querySelector('td[width="82%"] #findButton'),
          hasSearch: !!document.querySelector('td[width="82%"] #search0'),
          bodyLength: document.querySelector('td[width="82%"]')?.innerText?.length || 0,
          reskins: window.__bwReskinCount || 0,
          trace: window.__bwHistoryTrace || [] })).catch(() => null) }));
      if (!restored) {
        record.searchCheck.backStatus = 'needs';
        saveAudit(audit);
        return 'session';
      }
      // A shared Find result can add a state-less intermediate history entry.
      // Walk each Back step until the parent is actually restored in-shell.
      for (let step = 0; step < 4 && new URL(page.url()).pathname !== sourcePath; step++) {
        const count = await page.evaluate(() => window.__bwReskinCount || 0).catch(() => null);
        if (count === null) return 'session';
        const parentResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
          routePath(item.url(), page.url()) === sourcePath, { timeout: 8000 }).catch(() => null);
        try { await page.goBack(); } catch { return 'session'; }
        const ready = await page.waitForFunction(({ before, parent, start }) =>
          (location.pathname === before || location.pathname === parent) &&
            (window.__bwReskinCount || 0) > start && !!document.querySelector('td[width="82%"]'),
        { before: beforeSearchPath, parent: sourcePath, start: count },
        { timeout: 12000 }).then(() => true).catch(() => false);
        const path = new URL(page.url()).pathname;
        console.log(JSON.stringify({ event: 'subpage-search-parent-back', area,
          label: record.label, step: step + 1, path, ready,
          status: path === sourcePath ? (await parentResponse)?.status() || null : null }));
        if (!ready || (path !== beforeSearchPath && path !== sourcePath)) {
          record.searchCheck.backStatus = 'needs';
          saveAudit(audit);
          return 'session';
        }
      }
      if (new URL(page.url()).pathname === sourcePath) {
        record.searchCheck.backStatus = 'pass';
        record.backPending = false;
        const nestedFlow = audit.flows.find(item => item.label ===
          `${area} ${parentLabel} nested Back replay`);
        if (nestedFlow) nestedFlow.status = 'pass';
        saveAudit(audit);
        console.log(JSON.stringify({ event: 'subpage-search-complete', area,
          label: record.label, path: wanted, ...record.searchCheck }));
        return 'continue';
      }
      record.searchCheck.backStatus = 'needs';
      saveAudit(audit);
      return 'session';
    } else {
      record.searchCheck = { status: 'no-trigger' };
      saveAudit(audit);
      console.log(JSON.stringify({ event: 'subpage-search-probe', area, label: record.label,
        path: wanted, status: 'no-trigger' }));
      if (process.env.BW_INSPECT_SUBPAGE_CONTROLS === '1') {
        const controls = await page.evaluate(() =>
          [...document.querySelectorAll('td[width="82%"] a, td[width="82%"] button, td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]')]
            .filter(element => element.getClientRects().length)
            .map(element => ({ tag: element.tagName,
              label: (element.innerText || element.value || element.title || '').trim().slice(0, 70),
              id: element.id || '', type: element.type || '', href: element.getAttribute('href') || '',
              onclick: String(element.onclick || element.getAttribute('onclick') || '').slice(0, 130),
              formAction: element.closest('form')?.getAttribute('action') || '' })));
        console.log(JSON.stringify({ event: 'subpage-search-controls', area,
          label: record.label, path: wanted, controls }));
      }
    }
  }
  if (process.env.BW_VERIFY_SORT === '1' && (record.dynamicControls?.sort || 0) > 0 &&
      (record.interactionChecks?.sort?.status !== 'pass' || process.env.BW_FORCE_SORT === '1')) {
    const sortOutcome = await verifySortControl(page, audit, record, area, wanted);
    if (sortOutcome !== 'continue') return sortOutcome;
  }
  if (process.env.BW_VERIFY_PAGING === '1' && (record.dynamicControls?.paging || 0) > 0 &&
      (record.interactionChecks?.paging?.status !== 'pass' || process.env.BW_FORCE_PAGING === '1')) {
    const pagingOutcome = await verifyPagingControl(page, audit, record, area, wanted);
    if (pagingOutcome !== 'continue') return pagingOutcome;
  }
  if (process.env.BW_VERIFY_TABS === '1' && (record.dynamicControls?.tabs || 0) > 0 &&
      (record.interactionChecks?.tabs?.status !== 'pass' || process.env.BW_FORCE_TABS === '1')) {
    const tabOutcome = await verifyTabControls(page, audit, record, area, wanted);
    if (tabOutcome !== 'continue') return tabOutcome;
  }
  if (process.env.BW_VERIFY_DOWNLOAD === '1' && (record.dynamicControls?.transfer || 0) > 0 &&
      (!['pass', 'upload-pending'].includes(record.interactionChecks?.transfer?.status) ||
        process.env.BW_FORCE_DOWNLOAD === '1')) {
    const downloadOutcome = await verifyDownloadControl(page, audit, record, area);
    if (downloadOutcome !== 'continue') return downloadOutcome;
  }
  const backReskinStart = await page.evaluate(() => window.__bwReskinCount || 0).catch(() => null);
  if (backReskinStart === null) return 'session';
  const backResponsePromise = page.waitForResponse(item => item.request().method() === 'POST' &&
    routePath(item.url(), page.url()) === sourcePath, { timeout: 15000 }).catch(() => null);
  try { await page.goBack(); } catch { return 'session'; }
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
  const backReady = await page.waitForFunction(({ pathname, count }) => location.pathname === pathname &&
    window.__bwReskinCount > count && !!document.querySelector('td[width="82%"]'),
  { pathname: sourcePath, count: backReskinStart }, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!backReady) return 'session';
  const nestedFlow = audit.flows.find(item => item.label ===
    `${area} ${parentLabel} nested Back replay`);
  if (nestedFlow) { nestedFlow.status = 'pass'; saveAudit(audit); }
  record.backPending = false;
  saveAudit(audit);
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
    if (!window.__bwReskinProbe) {
      window.__bwReskinProbe = true;
      window.__bwReskinCount = 0;
      document.addEventListener('cp:reskin', () => { window.__bwReskinCount++; });
    }
    window.__bwAuditReskinStart = window.__bwReskinCount;
  });
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
    routePath(response.url(), page.url()) === wanted, { timeout: 15000 }).catch(() => null);
  let error = null;
  try { await page.evaluate(item => window.redirectPost(item.url, item.params), target); }
  catch (failure) { error = failure.message; }
  const response = await responsePromise;
  if (response?.status() === 200) await page.waitForFunction(pathname =>
    (location.pathname === pathname &&
      window.__bwReskinCount > window.__bwAuditReskinStart) ||
    document.title.trim() === 'Login' || !!document.querySelector('.cp-alert-error'),
  wanted, { timeout: 12000 }).catch(() => {});
  const state = await page.evaluate(() => ({ path: location.pathname,
    title: document.title.trim(),
    sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
    reskinned: window.__bwReskinCount > window.__bwAuditReskinStart,
    hasContent: !!document.querySelector('td[width="82%"]'),
    alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
  const loginDocument = state?.path === '/commpilot/Login/' || state?.title === 'Login';
  const status = loginDocument ? 'pending' :
    response?.status() === 200 && state?.sameDocument && state?.reskinned && state?.hasContent &&
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
  if (process.env.BW_INSPECT_TABS === '1' && status === 'pass') {
    result.tabs = await captureTabControls(page);
    result.tabHandler = await page.evaluate(() => ({
      tabWithSubmit: String(window.TabWithSubmit || '').slice(0, 1800),
      tabSubmit: String(window.TabSubmit || '').slice(0, 1800),
      forms: [...document.querySelectorAll('td[width="82%"] form')].map(form => ({
        name:form.name,action:form.getAttribute('action'),method:form.method,
        enctype:form.getAttribute('enctype'),fileInputs:form.querySelectorAll('input[type="file"]').length,
        fields:[...form.elements].filter(field => field.name).map(field =>
          ({name:field.name,type:field.type,value:String(field.value || '').slice(0,80)})).slice(0,30)}))
    }));
  }
  let searchedRows = false;
  let searchCheck = null;
  if (process.env.BW_DISCOVER_DEEP === '1' && status === 'pass') {
    if (process.env.BW_INSPECT_SORT === '1') {
      result.sortControls = await page.evaluate(() =>
        [...document.querySelectorAll('td[width="82%"] a')]
          .filter(element => element.getClientRects().length &&
            [...document.scripts].some(script => (script.textContent || '').includes(element.id) &&
              /sort\.jsp|doSort/i.test(script.textContent || '')))
          .map(element => ({ label: element.innerText.trim(), id: element.id,
            html: element.outerHTML.slice(0, 400),
            scripts: [...document.scripts].map(script => script.textContent || '')
              .filter(source => source.includes(element.id)).map(source => source.slice(0, 800)) })));
    }
    if (process.env.BW_SEARCH_ROWS === '1' && process.env.BW_SEARCH_SUBPAGES !== '1') {
      const search = page.locator('td[width="82%"] #search0, td[width="82%"] #findButton, ' +
        'td[width="82%"] input[type="submit"][value="Find" i], ' +
        'td[width="82%"] input[type="submit"][value="Search" i]').first();
      if (await search.count() && await search.isVisible()) {
        const searchId = /find/i.test(await search.getAttribute('value') || '') ? 'Find' :
          (await search.getAttribute('id') || 'Search');
        if (process.env.BW_INSPECT_SEARCH_RESPONSE === '1') {
          const control = await search.evaluate(element => ({ tag: element.tagName,
            html: element.outerHTML.slice(0, 450), formAction: element.closest('form')?.getAttribute('action') || '',
            formMethod: element.closest('form')?.getAttribute('method') || '',
            formTarget: element.closest('form')?.getAttribute('target') || '',
            formEnctype: element.closest('form')?.getAttribute('enctype') || '',
            clickHandler: String(element.onclick || '').slice(0, 250),
            hook: String(window.redirectPost || '').slice(0, 80),
            directSubmitBridge: String(HTMLFormElement.prototype.submit || '').slice(0, 80),
            formControls: [...(element.closest('form')?.elements || [])].map(item => ({ name: item.name, type: item.type })) }));
          console.log(JSON.stringify({ event: 'search-control', area: `${level} / ${folder}`,
            label: target.label, control }));
        }
        const searchResponse = page.waitForResponse(item => item.request().method() === 'POST' &&
          (routePath(item.url(), page.url()) === wanted ||
            /^\/commpilot\/Common\/(?:find|findAll|page)\.jsp$/.test(routePath(item.url(), page.url()))),
        { timeout: 10000 }).catch(() => null);
        const searchReskinStart = await page.evaluate(() => window.__bwReskinCount || 0);
        if (process.env.BW_TRACE_REQUESTS === '1') await page.evaluate(() => {
          if (window.__bwSearchSubmitTrace) return;
          window.__bwSearchSubmitTrace = true;
          const submit = HTMLFormElement.prototype.submit;
          HTMLFormElement.prototype.submit = function () {
            console.warn('[audit] direct form submit action=' + (this.getAttribute('action') || '') +
              ' method=' + (this.getAttribute('method') || '') + ' target=' + (this.getAttribute('target') || ''));
            return submit.apply(this, arguments);
          };
          document.addEventListener('submit', event => console.warn('[audit] submit event action=' +
            (event.target.getAttribute('action') || '') + ' prevented=' + event.defaultPrevented), true);
        });
        await search.click();
        const found = await searchResponse;
        if (process.env.BW_INSPECT_SEARCH_RESPONSE === '1' && found) {
          const html = await found.text().catch(() => '');
          const names = [...new Set([...new URLSearchParams(found.request().postData() || '').keys()])]
            .filter(name => name !== 'formtokenserial');
          console.log(JSON.stringify({ event: 'search-response', area: `${level} / ${folder}`,
            label: target.label, path: routePath(found.url(), page.url()), status: found.status(),
            length: html.length, title: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '',
            contentCell: /<td[^>]*width=["']?82%/i.test(html),
            redirects: [...html.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)].slice(0, 5).map(match => match[1]),
            hasLoginText: /Please login again|not authorized to access the system/i.test(html),
            requestFieldNames: names }));
        }
        searchedRows = true;
        await page.waitForFunction(count => (window.__bwReskinCount || 0) > count ||
          location.pathname === '/commpilot/Login/' || !!document.querySelector('.cp-alert-error'),
        searchReskinStart, { timeout: 10000 }).catch(() => {});
        const rowLinks = await page.locator('td[width="82%"] a[id^="Row"]').count();
        const searchState = await page.evaluate(reskinStart => ({ path: location.pathname,
          title: document.title.trim(),
          sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
          reskinned: (window.__bwReskinCount || 0) > reskinStart,
          hasContent: !!document.querySelector('td[width="82%"]') }), searchReskinStart).catch(() => null);
        const searchSession = !found || found.status() >= 500 ||
          searchState?.path === '/commpilot/Login/' || searchState?.title === 'Login';
        searchCheck = { status: searchSession ? 'pending' : found.status() === 200 &&
          searchState?.sameDocument && searchState?.reskinned && searchState?.hasContent ? 'pass' : 'needs',
          trigger: searchId || 'Search', responsePath: found ? routePath(found.url(), page.url()) : null,
          httpStatus: found?.status() || null, finalPath: searchState?.path || null,
          sameDocument: searchState?.sameDocument === true,
          reskinned: searchState?.reskinned === true, rowLinks };
        console.log(JSON.stringify({ event: 'search-probe', area: `${level} / ${folder}`,
          label: target.label, ...searchCheck }));
      } else searchCheck = { status: 'no-trigger' };
    }
    if (process.env.BW_INSPECT_CONTROLS === '1') {
    result.innerControls = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] a, td[width="82%"] button, td[width="82%"] input[type="button"], td[width="82%"] input[type="submit"]')]
      .filter(element => element.getClientRects().length)
      .map(element => ({ tag: element.tagName, label: (element.innerText || element.value || element.title || '').trim().slice(0, 80),
        id: element.id || '', href: element.getAttribute('href') || '',
        type: element.getAttribute('type') || '',
        formAction: element.closest('form')?.getAttribute('action') || '',
        onclick: String(element.onclick || element.getAttribute('onclick') || '').slice(0, 180) }))
      .filter(item => item.label || item.id || item.href));
    }
    result.innerTargets = searchedRows ? [] : await captureRowTargets(page);
  }
  if (process.env.BW_DISCOVER_ACTIONS === '1' && status === 'pass' && !searchedRows) {
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
  if (process.env.BW_DISCOVER_DYNAMIC === '1' && status === 'pass') {
    result.dynamicControls = await captureDynamicControls(page);
    if (result.actionTargets?.some(action => isCanonicalAction(routePath(action.url, page.url()))))
      result.dynamicControls.sort = Math.max(1, result.dynamicControls.sort);
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
  record.backPending = status === 'pass' && result.finalPath !== start;
  record.flakyHistory = hadReload && status === 'pass';
  record.detail = record.flakyHistory ?
    'PJAX passed; an earlier rapid sequence landed on Login' :
    response ? `HTTP ${response.status()}` : (error || 'No response');
  if (result.innerTargets) record.deepScanned = true;
  if (result.actionTargets) record.controlScanned = true;
  if (result.dynamicControls) {
    record.dynamicControls = result.dynamicControls;
    record.dynamicScanned = true;
  }
  if (process.env.BW_DISCOVER_UPLOADS === '1' && !record.uploadScanned) {
    record.uploadForms = await captureUploadForms(page);
    record.uploadScanned = true;
    if (record.uploadForms.length) console.log(JSON.stringify({ event: 'upload-inventory',
      area, label: record.label, path: wanted, forms: record.uploadForms }));
  }
  if (process.env.BW_INSPECT_UPLOAD_FORM === '1') {
    const forms = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] form')]
      .filter(form => form.querySelector('input[type="file"]'))
      .map(form => ({ action: new URL(form.getAttribute('action') || location.pathname, location.href).pathname,
        controls: [...form.elements].filter(item => item.name && item.type !== 'hidden' && item.type !== 'password')
          .map(item => ({ name: item.name, type: item.type, required: item.required || false,
            label: /^(?:button|submit)$/.test(item.type || '') ? item.value : undefined })) })));
    if (forms.length) console.log(JSON.stringify({ event: 'upload-form-controls', area,
      label: record.label, path: wanted, forms }));
  }
  if (process.env.BW_INSPECT_TRANSFER_CONTROLS === '1' &&
      (record.dynamicControls?.transfer || 0) > 0)
    console.log(JSON.stringify({ event: 'transfer-controls', area, label: record.label,
      path: wanted, controls: await captureTransferControls(page) }));
  if (searchCheck) {
    record.searchCheck = searchCheck;
    if (searchCheck.responsePath) {
      let interaction = audit.routes.find(item => item.kind === 'interaction' && item.area === area &&
        item.sourcePath === wanted && item.path === searchCheck.responsePath);
      if (!interaction) {
        interaction = { id: `discovered-${audit.routes.length + 1}`, kind: 'interaction', area,
          label: `${target.label} › ${/find/i.test(searchCheck.trigger) ? 'Find' : 'Search'}`,
          sourcePath: wanted, path: searchCheck.responsePath, method: 'POST', status: 'pending' };
        audit.routes.push(interaction);
      }
      interaction.status = searchCheck.status;
      interaction.detail = `HTTP ${searchCheck.httpStatus || 'none'}; ${searchCheck.sameDocument ? 'same document' : 'document changed'}`;
    }
  }
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
  if (process.env.BW_VERIFY_SORT === '1' && status === 'pass' &&
      (record.dynamicControls?.sort || 0) > 0 &&
      (record.interactionChecks?.sort?.status !== 'pass' || process.env.BW_FORCE_SORT === '1')) {
    const sortOutcome = await verifySortControl(page, audit, record, area, wanted);
    if (sortOutcome !== 'continue') return sortOutcome;
  }
  if (process.env.BW_VERIFY_PAGING === '1' && status === 'pass' &&
      (record.dynamicControls?.paging || 0) > 0 &&
      (record.interactionChecks?.paging?.status !== 'pass' || process.env.BW_FORCE_PAGING === '1')) {
    const pagingOutcome = await verifyPagingControl(page, audit, record, area, wanted);
    if (pagingOutcome !== 'continue') return pagingOutcome;
  }
  if (process.env.BW_VERIFY_TABS === '1' && status === 'pass' &&
      (record.dynamicControls?.tabs || 0) > 0 &&
      (record.interactionChecks?.tabs?.status !== 'pass' || process.env.BW_FORCE_TABS === '1')) {
    const tabOutcome = await verifyTabControls(page, audit, record, area, wanted);
    if (tabOutcome !== 'continue') return tabOutcome;
  }
  if (process.env.BW_VERIFY_DOWNLOAD === '1' && status === 'pass' &&
      (record.dynamicControls?.transfer || 0) > 0 &&
      (!['pass', 'upload-pending'].includes(record.interactionChecks?.transfer?.status) ||
        process.env.BW_FORCE_DOWNLOAD === '1')) {
    const downloadOutcome = await verifyDownloadControl(page, audit, record, area);
    if (downloadOutcome !== 'continue') return downloadOutcome;
  }
  if (searchedRows) {
    if (searchCheck?.status === 'pending') return 'session';
    try { await clickFolder(page, folder); } catch { return 'session'; }
    record.backPending = false;
    saveAudit(audit);
    return searchCheck?.status === 'pass' ? 'continue' : searchCheck?.status === 'pending' ? 'session' : 'gap';
  }
  if (result.finalPath !== start) {
    const tokenBeforeBack = process.env.BW_TRACE_TOKENS === '1' ?
      await page.locator('[name="formtokenserial"]').first().inputValue().catch(() => '') : '';
    const backReskinStart = await page.evaluate(() => window.__bwReskinCount || 0).catch(() => null);
    if (backReskinStart === null) return 'session';
    const backResponsePromise = page.waitForResponse(item => item.request().method() === 'POST' &&
      routePath(item.url(), page.url()) === start, { timeout: 15000 }).catch(() => null);
    try { await page.goBack(); } catch { return 'session'; }
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
    const backReady = await page.waitForFunction(({ pathname, title, count }) => location.pathname === pathname &&
      document.title.trim() === title &&
      document.documentElement.getAttribute('data-cp-path') === pathname &&
      window.__bwReskinCount > count,
    { pathname: start, title: folder, count: backReskinStart }, { timeout: 20000 })
      .then(() => true).catch(() => false);
    if (!backReady) return 'session';
    if (new URL(page.url()).pathname === '/commpilot/Login/') return 'session';
    const backFlow = audit.flows.find(item => item.label === `${level} ${folder} Back replay`);
    if (backFlow) { backFlow.status = 'pass'; saveAudit(audit); }
    record.backPending = false;
    saveAudit(audit);
  }
  return 'continue';
}

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: process.env.BW_VISIBLE !== '1', viewport: null,
    acceptDownloads: process.env.BW_VERIFY_DOWNLOAD !== '1',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  if (process.env.BW_TRACE_REQUESTS === '1') await context.addInitScript(() => {
    window.addEventListener('submit', event => console.warn('[audit] earliest submit event action=' +
      (event.target.getAttribute('action') || '') + ' prevented=' + event.defaultPrevented), true);
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      console.warn('[audit] earliest direct submit action=' + (this.getAttribute('action') || ''));
      return nativeSubmit.apply(this, arguments);
    };
  });
  if (process.env.BW_CP_DEBUG === '1') await context.addInitScript(() =>
    localStorage.setItem('cpDebug', '1'));
  const oldPages = context.pages();
  const page = await context.newPage();
  if (process.env.BW_TRACE_DOWNLOAD === '1') {
    page.on('close', () => console.log(JSON.stringify({ event: 'download-trace', detail: 'page-closed' })));
    page.on('crash', () => console.log(JSON.stringify({ event: 'download-trace', detail: 'page-crashed' })));
    context.on('close', () => console.log(JSON.stringify({ event: 'download-trace', detail: 'context-closed' })));
  }
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
    if (process.env.BW_TRACE_MOH_SERVLET === '1' &&
        new URL(response.url()).pathname === '/commpilot/servlet/MusicOnHoldUserServlet') {
      response.text().then(html => console.log(JSON.stringify({event:'moh-servlet-response',
        status:response.status(),length:html.length,
        redirectPosts:[...html.matchAll(/redirectPost\s*\(\s*['"]([^'"]+)/g)].map(match => match[1]).slice(0,4),
        location:response.headers().location || null,
        title:/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || ''}))).catch(() => {});
    }
    if (request.method() !== 'POST') return;
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
        if (reconnects >= maxReconnects) throw error;
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
      let reachedStart = !startLabel;
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
          if (!reachedStart) {
            if (target.label !== startLabel) continue;
            reachedStart = true;
          }
          if (selectedLabels.length && !selectedLabels.includes(target.label)) continue;
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
          const needsDescendants = process.env.BW_DISCOVER_DESCENDANTS === '1' &&
            deepAudit.routes.some(item => (item.kind === 'nested' || item.kind === 'action') &&
              item.area === `${level} / ${folder}` && item.sourcePath === wanted &&
              needsSubpageWork(deepAudit, item.area, item));
          const needsActions = process.env.BW_DISCOVER_ACTIONS === '1' &&
            (!known?.controlScanned || (process.env.BW_VERIFY_ACTIONS === '1' && pendingAction));
          const needsDynamic = process.env.BW_DISCOVER_DYNAMIC === '1' && !known?.dynamicScanned;
          const needsSearch = process.env.BW_SEARCH_ROWS === '1' &&
            process.env.BW_SEARCH_SUBPAGES !== '1' &&
            (known?.dynamicControls?.search || 0) > 0 &&
            (known?.searchCheck?.status !== 'pass' ||
              (known?.searchCheck?.status === 'pass' && known.searchCheck.reskinned !== true));
          const needsSort = process.env.BW_VERIFY_SORT === '1' &&
            (known?.dynamicControls?.sort || 0) > 0 &&
            (known?.interactionChecks?.sort?.status !== 'pass' || process.env.BW_FORCE_SORT === '1');
          const needsPaging = process.env.BW_VERIFY_PAGING === '1' &&
            (known?.dynamicControls?.paging || 0) > 0 &&
            (known?.interactionChecks?.paging?.status !== 'pass' || process.env.BW_FORCE_PAGING === '1');
          const needsTabs = process.env.BW_VERIFY_TABS === '1' &&
            (known?.dynamicControls?.tabs || 0) > 0 &&
            (known?.interactionChecks?.tabs?.status !== 'pass' || process.env.BW_FORCE_TABS === '1');
          const needsDownload = process.env.BW_VERIFY_DOWNLOAD === '1' &&
            (known?.dynamicControls?.transfer || 0) > 0 &&
            (!['pass', 'upload-pending'].includes(known?.interactionChecks?.transfer?.status) ||
              process.env.BW_FORCE_DOWNLOAD === '1');
          const needsUploads = process.env.BW_DISCOVER_UPLOADS === '1' && !known?.uploadScanned;
          if (known?.status === 'pass' && !force && !known.backPending &&
              !needsActions && !needsDescendants && !needsDynamic && !needsSearch && !needsSort && !needsPaging && !needsTabs && !needsDownload && !needsUploads &&
              (process.env.BW_DISCOVER_DEEP !== '1' || (known.deepScanned && !pendingInner))) continue;
          const outcome = await testTarget(page, target, folder);
          if (outcome === 'gap') { console.log(JSON.stringify({ event: 'needs-fix', level, folder, label: target.label })); return; }
          if (outcome === 'session') {
            console.log(JSON.stringify({ event: 'session-target', level, folder,
              label: target.label, path: wanted,
              currentPath: new URL(page.url()).pathname }));
            restart = true; break;
          }
          await delay(100);
        }
        if (restart) break;
        console.log(JSON.stringify({ event: 'folder-done', level, folder, passed: targets.length }));
      }
      if (!restart) break;
      reconnects++;
      if (reconnects >= maxReconnects) throw new Error(`Sandbox session bounced ${maxReconnects} times; stopping for inspection`);
      console.log(JSON.stringify({ event: 'session-reconnect', count: reconnects }));
      await gotoLogin(page);
    }
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message,
  at: error.stack?.split('\n').slice(1, 3).map(line => line.trim()) })); process.exitCode = 1; });
