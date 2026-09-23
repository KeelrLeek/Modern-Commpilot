// Interactive sandbox walkthrough with the unpacked extension. It runs headless
// by default so automated checks do not steal focus; BW_VISIBLE=1 opts into a
// visible Edge window. Commands on stdin inspect the same Playwright page.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const extension = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = process.env.BW_LIVE_PROFILE ||
  path.join(process.env.LOCALAPPDATA, 'BroadWorksEnhancer', 'LivePreviewProfile');
fs.mkdirSync(profile, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge,
    headless: process.env.BW_VISIBLE !== '1',
    viewport: null,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  // Start each walkthrough with a fresh tab history. Edge may restore the prior
  // tab from this persistent profile, including hidden-frame history entries.
  const oldPages = context.pages();
  const page = await context.newPage();
  for (const oldPage of oldPages) await oldPage.close();
  const cdp = await context.newCDPSession(page);
  let capturedTargets = [];
  const auditPath = path.join(__dirname, 'pjax-route-audit.json');
  async function captureVisibleTargets() {
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
  page.on('console', message => {
    const value = message.text();
    if (value.includes('[pjax]')) console.log(JSON.stringify({ event: 'pjax-console',
      level: message.type(), message: value.slice(0, 400) }));
  });
  page.on('response', response => {
    const request = response.request();
    if (request.method() !== 'POST' || !response.url().includes('/commpilot/')) return;
    console.log(JSON.stringify({ event: 'response', method: 'POST',
      path: new URL(response.url()).pathname, status: response.status() }));
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) console.log(JSON.stringify({ event: 'navigation',
      path: new URL(frame.url()).pathname }));
  });
  await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  console.log(JSON.stringify({ event: 'ready', message: 'Sign in in Edge, then send a snapshot command.' }));

  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    try {
      const command = JSON.parse(line);
      if (command.type === 'exit') break;
      if (command.type === 'click') await page.locator(command.selector).click();
      if (command.type === 'clickWait') {
        await page.locator(command.selector).click();
        await page.waitForFunction(expected => location.pathname === expected &&
          document.documentElement.getAttribute('data-cp-path') === expected,
          command.path, { timeout: 20000 });
        console.log(JSON.stringify({ event: 'arrived', path: command.path }));
      }
      if (command.type === 'fill') await page.locator(command.selector).fill(command.value);
      if (command.type === 'back') await page.goBack();
      if (command.type === 'backUi') await page.keyboard.press('Alt+ArrowLeft');
      if (command.type === 'forward') await page.goForward();
      if (command.type === 'reload') await page.reload();
      if (command.type === 'clearCookies') {
        await context.clearCookies();
        await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
        console.log(JSON.stringify({ event: 'cookies-cleared', path: new URL(page.url()).pathname }));
      }
      if (command.type === 'goto') await page.goto(command.url, { waitUntil: 'domcontentloaded' });
      if (command.type === 'front') await page.bringToFront();
      if (command.type === 'brief') console.log(JSON.stringify({ event: 'brief',
        data: await page.evaluate(() => ({
          path: location.pathname, title: document.title,
          documentMarker: window.__bwTestDocMarker ||= Math.random().toString(36).slice(2),
          breadcrumb: (document.querySelector('td.headerBar:has(.headerAuthLevel)')?.innerText || '').trim(),
          content: (document.querySelector('td[width="82%"]')?.innerText || '').trim().slice(0, 350),
          userRows: document.querySelectorAll('tr[id^="Row"]').length,
          savedSignIns: !!document.querySelector('.bw-saved-login')
        })) }));
      if (command.type === 'menuInventory') console.log(JSON.stringify({ event: 'menuInventory',
        data: await page.evaluate(() => {
          const source = JSON.parse(sessionStorage.getItem('cp-level-pages') || '{}');
          return Object.keys(source).map(level => ({ level,
            groups: (source[level].groups || []).map(group => ({ label: group.label,
              items: (group.items || []).map(item => ({ name: item.name, url: item.url })) })) }));
        }) }));
      if (command.type === 'captureTargets') {
        capturedTargets = await captureVisibleTargets();
        console.log(JSON.stringify({ event: 'captureTargets', path: new URL(page.url()).pathname,
          count: capturedTargets.length,
          targets: capturedTargets.map(({ label, url, params }) =>
            ({ label, url, paramNames: Object.keys(params) })) }));
      }
      if (command.type === 'scanFolders') {
        const level = command.level || await page.evaluate(() =>
          (document.querySelector('.headerAuthLevel')?.textContent || 'Unknown').trim());
        const folders = await page.locator('a.leftnavfolder').allTextContents();
        const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
        audit.inventory ||= { complete: false, folders: [] };
        for (const raw of folders) {
          const folder = raw.trim();
          const response = page.waitForResponse(r => r.request().method() === 'POST' &&
            new URL(r.url()).pathname === '/commpilot/Common/folder_contents.jsp',
          { timeout: 15000 }).catch(() => null);
          await page.locator('a.leftnavfolder').filter({ hasText: new RegExp(`^\\s*${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).click();
          await response;
          await page.waitForFunction(expected => document.title.trim() === expected, folder,
            { timeout: 10000 }).catch(() => {});
          const targets = await captureVisibleTargets();
          const group = `${level} / ${folder}`;
          for (const target of targets) {
            const routePath = new URL(target.url, page.url()).pathname;
            const earlier = audit.routes.find(item => item.label === target.label && item.path === routePath &&
              (item.area === group || (folder === 'Profile' && item.area === level)));
            if (earlier) earlier.area = group;
            else {
              audit.routes.push({ id: `discovered-${audit.routes.length + 1}`, area: group,
                label: target.label, path: routePath, status: 'pending' });
            }
          }
          const existing = audit.inventory.folders.find(item => item.level === level && item.name === folder);
          if (existing) existing.count = targets.length;
          else audit.inventory.folders.push({ level, name: folder, count: targets.length });
          audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
          fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
          console.log(JSON.stringify({ event: 'folderScan', level, folder, count: targets.length,
            totalDiscovered: audit.routes.length }));
        }
      }
      if (command.type === 'auditCaptured') {
        if (command.capture) capturedTargets = await captureVisibleTargets();
        const homePath = new URL(page.url()).pathname;
        const selected = capturedTargets.slice(command.start || 0,
          command.end == null ? capturedTargets.length : command.end);
        for (const target of selected) {
          const targetPath = new URL(target.url, page.url()).pathname;
          await page.evaluate(() => {
            window.__bwTestDocMarker ||= Math.random().toString(36).slice(2);
            window.__bwAuditMarker = window.__bwTestDocMarker;
          });
          const responsePromise = page.waitForResponse(response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === targetPath,
          { timeout: 15000 }).catch(() => null);
          let failed = null;
          try { await page.evaluate(item => window.redirectPost(item.url, item.params), target); }
          catch (error) { failed = error.message; }
          const response = await responsePromise;
          if (response && response.status() === 200) {
            await page.waitForFunction(origin => location.pathname !== origin ||
              !!document.querySelector('.cp-alert-error'), homePath, { timeout: 12000 }).catch(() => {});
          }
          const observed = await page.evaluate(() => ({ path: location.pathname,
            sameDocument: window.__bwTestDocMarker === window.__bwAuditMarker,
            hasContent: !!document.querySelector('td[width="82%"]'),
            alert: !!document.querySelector('.cp-alert-error') })).catch(() => null);
          // The marker comparison is set in the page before each navigation so
          // a real document load cannot accidentally look like a PJAX pass.
          const result = { event: 'auditRoute', label: target.label, path: targetPath,
            httpStatus: response ? response.status() : null,
            finalPath: observed?.path || new URL(page.url()).pathname,
            sameDocument: observed?.sameDocument === true,
            hasContent: observed?.hasContent === true,
            error: failed || null };
          const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
          const record = audit.routes.find(route => (!command.area || route.area === command.area) &&
            route.label === target.label && route.path === targetPath);
          if (record) {
            record.status = result.httpStatus === 200 && result.sameDocument &&
              result.hasContent && !observed.alert ? 'pass' :
              result.httpStatus === 200 ? 'needs' : 'pending';
            record.detail = result.httpStatus ? `HTTP ${result.httpStatus}` : (failed || 'No response');
            audit.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');
            fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
          }
          console.log(JSON.stringify(result));
          if (result.httpStatus !== 200 || !result.sameDocument || result.finalPath === '/commpilot/Login/') break;
          if (result.finalPath !== homePath) {
            await page.goBack();
            await page.waitForFunction(expected => location.pathname === expected &&
              document.documentElement.getAttribute('data-cp-path') === expected,
              homePath, { timeout: 15000 }).catch(() => {});
          }
        }
      }
      if (command.type === 'traceHistory') await page.evaluate(() => {
        if (window.__bwHistoryTrace) return;
        window.__bwHistoryTrace = [];
        const record = (kind, url, state) => window.__bwHistoryTrace.push({ kind,
          path: String(url || location.pathname), nav: state?.cpNav?.url || null });
        const push = history.pushState;
        const replace = history.replaceState;
        history.pushState = function (state, title, url) {
          record('push', url, state); return push.apply(this, arguments);
        };
        history.replaceState = function (state, title, url) {
          record('replace', url, state); return replace.apply(this, arguments);
        };
        window.addEventListener('popstate', event =>
          { record('pop', location.pathname, event.state);
            console.warn('[pjax] harness popstate', location.pathname); }, true);
        window.addEventListener('pagehide', () =>
          console.warn('[pjax] harness pagehide', location.pathname), true);
      });
      if (command.type === 'history') console.log(JSON.stringify({ event: 'history',
        data: await page.evaluate(() => ({ path: location.pathname, length: history.length,
          state: history.state?.cpNav?.url || null, trace: window.__bwHistoryTrace || [] })) }));
      if (command.type === 'cdpHistory') {
        const result = await cdp.send('Page.getNavigationHistory');
        console.log(JSON.stringify({ event: 'cdpHistory', currentIndex: result.currentIndex,
          entries: result.entries.map((entry, index) => ({ index,
            path: new URL(entry.url).pathname, id: entry.id })) }));
      }
      if (command.type === 'workers') console.log(JSON.stringify({ event: 'workers',
        urls: context.serviceWorkers().map(worker => worker.url()) }));
      if (command.type === 'pjax') console.log(JSON.stringify({ event: 'pjax',
        data: await page.evaluate(() => ({ path: location.pathname,
          redirectPost: typeof window.redirectPost,
          redirectPostSource: String(window.redirectPost || '').slice(0, 140),
          morphed: typeof window.__cpPjaxMorphed,
          version: [...document.scripts].some(script => (script.textContent || '').includes('CP_PJAX_VERSION'))
        })) }));
      if (command.type === 'element') console.log(JSON.stringify({ event: 'element',
        data: await page.locator(command.selector).evaluate(el => ({
          html: el.outerHTML.slice(0, 1000), onclick: String(el.onclick || '').slice(0, 500)
        })) }));
      if (command.type === 'nav') await page.evaluate(({ url, params }) =>
        window.redirectPost(url, params || {}), command);
      if (command.type === 'reloadExtension') {
        const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'));
        if (!worker) throw new Error('Extension service worker is unavailable');
        await worker.evaluate(() => chrome.runtime.reload());
        await page.reload();
      }
      if (command.type === 'snapshot' || command.type === 'click' || command.type === 'fill' ||
          command.type === 'back' || command.type === 'forward' || command.type === 'reload' ||
          command.type === 'front' || command.type === 'reloadExtension' || command.type === 'goto') {
        console.log(JSON.stringify({ event: 'snapshot', data: await page.evaluate(() => ({
          path: location.pathname,
          title: document.title,
          text: (document.body?.innerText || '').slice(0, 1000),
          tokenInputs: document.getElementsByName('formtokenserial').length,
          forms: [...document.forms].map(form => ({ name: form.name, action: form.getAttribute('action') })),
          controls: [...document.querySelectorAll('a,button,input[type=submit]')]
            .filter(el => el.getClientRects().length)
            .slice(0, 100)
            .map(el => ({ tag: el.tagName, text: (el.innerText || el.value || '').trim().slice(0, 70),
              id: el.id, href: el.getAttribute('href') }))
        })) }));
      }
    } catch (error) {
      console.log(JSON.stringify({ event: 'error', message: error.message }));
    }
  }
  rl.close();
  await context.close();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
