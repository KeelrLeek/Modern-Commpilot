// Sandbox-only inspection of a multipart servlet's response contract.
const { chromium } = require('playwright-core');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
const kind = process.env.BW_MULTIPART_PROBE;
const specs = {
  'answer-confirmation': { label: 'Answer Confirmation',
    path: '/commpilot/ServiceProvider/AnswerConfirmation/',
    servlet: '/commpilot/servlet/AnswerConfirmationServlet' },
  'voice-portal-branding': { label: 'Voice Portal Branding',
    path: '/commpilot/ServiceProvider/VPBranding/',
    servlet: '/commpilot/servlet/VPBrandingServlet' },
  'web-portal-branding': { label: 'Web Portal Branding',
    path: '/commpilot/Operator/System/System_Preferences/index.jsp',
    servlet: '/commpilot/servlet/SysAdminPrefsServlet' },
  'report-branding': { level: 'Group', folder: 'Call Center', label: 'Report Branding',
    path: '/commpilot/Group/ReportBranding/',
    servlet: '/commpilot/servlet/CCReportBrandingServlet' },
  'intercept-group': { level: 'Group', folder: 'Utilities', label: 'Intercept Group',
    path: '/commpilot/Intercept/index.jsp',
    servlet: '/commpilot/servlet/InterceptServiceServlet' },
  'intercept-user': { level: 'User', folder: 'Utilities', label: 'Intercept User - Off',
    path: '/commpilot/Intercept/index.jsp',
    servlet: '/commpilot/servlet/InterceptServiceServlet' },
  'announcement-add': { level: 'Group', folder: 'Profile', label: 'Announcement Repository',
    listPath: '/commpilot/Group/AnnouncementRepository/Audio/',
    path: '/commpilot/Group/AnnouncementRepository/Add/index.jsp',
    servlet: '/commpilot/servlet/AnnouncementRepositoryServlet', submitName: 'ok' },
  'report-template-add': { level: 'Group', folder: 'Call Center', label: 'Report Templates',
    listPath: '/commpilot/Group/ReportTemplates/',
    path: '/commpilot/Group/ReportTemplates/Add/index.jsp',
    servlet: '/commpilot/servlet/CallCenterEnhancedReportingReportTemplateServlet', submitName: 'ok' }
};
const spec = specs[kind];
if (!profile || !spec)
  throw new Error('Set BW_LIVE_PROFILE and a supported BW_MULTIPART_PROBE kind');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const waitPath = (page, pathname) => page.waitForFunction(expected =>
  location.pathname === expected && !!document.querySelector('td[width="82%"]'),
pathname, { timeout: 25000 });

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: true, viewport: null, acceptDownloads: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const page = await context.newPage();
  for (const old of context.pages()) if (old !== page) await old.close();
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
    if (new URL(page.url()).hostname !== 'apps-sbx.avpaas.io')
      throw new Error('Probe must stay on the sandbox');
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Test_SP")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
    if (spec.level === 'Group' || spec.level === 'User') {
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
      await waitPath(page, '/commpilot/ServiceProvider/Members/');
      await page.locator('#search0').click();
      await page.locator('a:text-is("Stan Mikita Donuts")').click();
      await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
    }
    if (spec.level === 'User') {
      await page.locator('td[width="82%"] a.navMenuItem:text-is("Users")').click();
      await waitPath(page, '/commpilot/Group/Members/');
      await page.locator('#search0').click();
      await page.locator('a:text-is("SMDonuts21")').click();
      await waitPath(page, '/commpilot/Group/Members/Modify/index.jsp');
    }
    await page.locator('a.leftnavfolder, a.leftnavfolderopen')
      .filter({ hasText: new RegExp(`^\\s*${spec.folder || 'Utilities'}\\s*$`) }).click();
    await page.waitForFunction(expected => document.title.trim() === expected,
      spec.folder || 'Utilities', { timeout: 25000 });
    await page.locator('td[width="82%"] a.navMenuItem')
      .filter({ hasText: new RegExp(`^\\s*${spec.label}\\s*$`) }).click();
    if (spec.listPath) {
      await waitPath(page, spec.listPath);
      await page.locator('td[width="82%"] input[name="add"]:visible').first().click();
    }
    await waitPath(page, spec.path);
    if (process.env.BW_MULTIPART_INSPECT === '1') {
      const controls = await page.evaluate(() => [...document.querySelectorAll('td[width="82%"] form')]
        .filter(form => form.querySelector('input[type="file"]'))
        .map(form => ({ action: form.getAttribute('action') || '',
          controls: [...form.elements].filter(item => item.name && item.type !== 'hidden')
            .map(item => ({ name: item.name, type: item.type,
              label: /^(?:submit|button)$/.test(item.type) ? item.value : undefined })) })));
      console.log(JSON.stringify({ event: 'multipart-form-inspect', kind, controls }));
      return;
    }
    if (process.env.BW_MULTIPART_USE_EXTENSION === '1') {
      await page.evaluate(() => { window.__bwMultipartMarker = Date.now();
        window.__bwMultipartReskins = 0;
        document.addEventListener('cp:reskin', () => { window.__bwMultipartReskins++; }); });
      let servletPosts = 0;
      page.on('request', request => {
        if (request.method() === 'POST' &&
            new URL(request.url()).pathname === spec.servlet) servletPosts++;
      });
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === spec.servlet,
      { timeout: 20000 });
      await page.locator(`form[name="mainForm"] input[name="${spec.submitName || 'apply'}"]:visible`).first()
        .click({ noWaitAfter: true });
      const response = await responsePromise;
      await page.waitForFunction(() => (window.__bwMultipartReskins || 0) > 0,
        null, { timeout: 15000 });
      const after = await page.evaluate(() => ({ path: location.pathname,
        sameDocument: !!window.__bwMultipartMarker,
        reskins: window.__bwMultipartReskins || 0,
        content: document.querySelector('td[width="82%"]')?.innerText.slice(0, 350) }));
      let cancelAfter = null;
      if (spec.listPath && await page.locator('form[name="mainForm"] input[name="cancel"]:visible').count()) {
        const beforeCancelReskins = await page.evaluate(() => window.__bwMultipartReskins || 0);
        await page.locator('form[name="mainForm"] input[name="cancel"]:visible').first()
          .click({ noWaitAfter: true });
        await page.waitForFunction(start => (window.__bwMultipartReskins || 0) > start ||
          location.pathname === '/commpilot/Login/', beforeCancelReskins,
        { timeout: 15000 }).catch(() => {});
        cancelAfter = await page.evaluate(() => ({ path: location.pathname,
          sameDocument: !!window.__bwMultipartMarker,
          reskins: window.__bwMultipartReskins || 0 }));
      }
      console.log(JSON.stringify({ event: 'multipart-extension',
        kind, response: response.status(), servletPosts, after, cancelAfter }));
      return;
    }
    const result = await page.evaluate(async options => {
      const form = document.querySelector('td[width="82%"] form[name="mainForm"]');
      if (!form) throw new Error('Answer Confirmation multipart form missing');
      const action = new URL(form.getAttribute('action'), location.href);
      if (action.pathname !== options.servlet)
        throw new Error('Unexpected servlet action');
      const body = new FormData(form);
      body.append(options.submitName, options.submitName === 'ok' ? 'OK' : 'Apply');
      const response = await fetch(action.href, { method: 'POST', body,
        credentials: 'same-origin', redirect: 'manual' });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const source = [...doc.scripts].map(script => script.textContent || '').join('\n');
      return { status: response.status, type: response.type, length: html.length,
        contentCell: !!doc.querySelector('td[width="82%"]'),
        hasToken: !!doc.querySelector('input[name="formtokenserial"]'),
        stubTarget: /redirectPost\s*\(\s*['"]([^'"]+)/.exec(source)?.[1] || '',
        errors: [...doc.querySelectorAll('.error, .errorMsg')]
          .map(item => (item.textContent || '').trim().slice(0, 200)).filter(Boolean).slice(0, 2) };
    }, { servlet: spec.servlet, submitName: spec.submitName || 'apply' });
    console.log(JSON.stringify({ event: 'multipart-contract', kind, result }));
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message }));
  process.exitCode = 1; });
