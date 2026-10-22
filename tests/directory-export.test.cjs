const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const pjax = process.env.BW_TEST_PJAX_PATH || path.resolve(__dirname, '../src/content/pjax.js');
const report = '<report><colHeading>Name</colHeading><colHeading>User ID</colHeading>' +
  '<colHeading>Department</colHeading><colHeading>Number</colHeading><colHeading>Extension</colHeading>' +
  '<row><col>Example, Alex</col><col>test1234</col><col>Operations</col><col>442012341234</col><col>1234</col></row></report>';

async function waitForDownload(page, downloads) {
  // The page's completed state can arrive before Playwright's download event.
  if (!downloads.length) await page.waitForEvent('download', {timeout: 6000});
}

async function fixture(options, check) {
  const browser = await chromium.launch({ headless: true, executablePath:
    process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    const errors = [], downloads = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('download', d => downloads.push(d));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      '<html><head><title>Fixture: Group Directory</title><style>.cp-uxp-hide{display:none}</style></head>' +
      '<body><form name="leftNavForm"></form><table><tr><td width="82%"><form name="mainForm">' +
      '<input name="formtokenserial" value="t0"><table id="searchTable"><tr><td>' +
      '<select id="findKey0" name="findKey0"><option value="UserLastName">Last Name</option></select>' +
      '</td></tr></table></form></td></tr></table><script>window.redirectPost=function(){};</script></body></html>' }));
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Group/CompanyDir/index.jsp');
    await page.evaluate(({ options, report }) => {
      const nativeFetch = window.fetch, timeout = window.setTimeout;
      window.fixtureReportRequests = 0;
      window.fixtureReportAborts = 0;
      window.fixtureOtherPosts = 0;
      window.setTimeout = (fn, delay, ...args) => {
        if (options.holdBuild && delay === 40) { window.fixtureFinishBuild = () => fn(...args); return 0; }
        return timeout(fn, options.deadline && delay === 300000 ? 100 : delay, ...args);
      };
      window.fetch = (url, init) => {
        if (!String(url).includes('/servlet/ClientBGListServlet')) {
          if (init?.method === 'POST') window.fixtureOtherPosts++;
          return nativeFetch(url, init);
        }
        window.fixtureReportRequests++;
        if (options.hold) return new Promise((resolve, reject) => {
          const abort = () => {
            window.fixtureReportAborts++;
            const finish = () => reject(new DOMException('Aborted', 'AbortError'));
            if (options.holdAbort) window.fixtureFinishAbort = finish; else finish();
          };
          if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort', abort, { once: true });
        });
        return Promise.resolve(new Response(options.status && options.status !== 200 ? 'Temporary failure' : (options.report || report),
          { status: options.status || 200, headers: { 'content-type': 'text/xml' } }));
      };
    }, { options, report });
    await page.addScriptTag({ path: pjax });
    await page.locator('#cp-native-directory-export').click();
    if (!options.noStart) await page.locator('.cp-uxp-start').click();
    await check({ page, errors, downloads });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

test('directory export owns keyboard focus and restores the launcher after Escape',
  () => fixture({ noStart: true }, async ({ page }) => {
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.cp-uxp'))), true);
    const dialog = page.getByRole('dialog', { name: 'Export directory', exact: true });
    assert.equal(await dialog.count(), 1);
    await page.locator('.cp-uxp-cancel').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.cp-uxp'))), true);
    await page.locator('#findKey0').focus();
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.cp-uxp'))), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cp-native-directory-export');
    await page.locator('#findKey0').focus();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'findKey0', 'closed dialog releases its focus listener');
  }));

for (const navigation of ['native navigation', 'browser Back']) test(`leaving the directory through ${navigation} drains its canceled report before another token POST`,
  () => fixture({hold:true,holdAbort:true},async({page})=>{
    await page.evaluate(navigation=>{
      const target='/commpilot/Group/Addresses/';
      if(navigation==='browser Back'){
        const current=location.href;
        history.replaceState({cpNav:{url:target,params:{}}},'',target);
        history.pushState({cpNav:{url:'/commpilot/Group/CompanyDir/index.jsp',params:{}}},'',current);
        history.back();
      }else window.redirectPost(target,{});
    },navigation);
    await page.waitForFunction(()=>typeof fixtureFinishAbort==='function');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>fixtureOtherPosts),0,'navigation must wait for the aborted request to settle');
    await page.evaluate(()=>fixtureFinishAbort());
    await page.waitForFunction(()=>document.documentElement.getAttribute('data-cp-path')==='/commpilot/Group/Addresses/');
    assert.equal(await page.evaluate(()=>fixtureOtherPosts),1);
    assert.equal(await page.locator('.cp-uxp').count(),0);
  }));

test('Escape from a running directory export aborts the report and restores focus',
  () => fixture({ hold: true }, async ({ page }) => {
    await page.waitForFunction(() => window.fixtureReportRequests === 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.cp-uxp').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureReportAborts), 1);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cp-native-directory-export');
  }));

for (const status of [403, 503]) test(`directory export reports HTTP ${status} without claiming session expiry`,
  () => fixture({ status }, async ({ page, downloads }) => {
    await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export stopped');
    const message = await page.locator('.cp-uxp-warns').innerText();
    assert.match(message, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(message, /sign in|session bounce/i);
    assert.equal(downloads.length, 0);
  }));

test('directory export cancellation aborts its pending report request',
  () => fixture({ hold: true }, async ({ page, downloads }) => {
    await page.waitForFunction(() => window.fixtureReportRequests === 1);
    await page.locator('.cp-uxp-cancel').click();
    assert.equal(await page.locator('.cp-uxp').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureReportAborts), 1);
    assert.equal(downloads.length, 0);
  }));

test('directory export has a bounded wait and does not replay a timed-out request',
  () => fixture({ hold: true, deadline: true }, async ({ page, downloads }) => {
    await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export stopped', null, { timeout: 2500 });
    assert.match(await page.locator('.cp-uxp-warns').innerText(), /timed out/i);
    assert.equal(await page.evaluate(() => window.fixtureReportRequests), 1);
    assert.equal(await page.evaluate(() => window.fixtureReportAborts), 1);
    assert.equal(downloads.length, 0);
  }));

test('successful directory export downloads both workbooks in a ZIP',
  () => fixture({}, async ({ page, downloads }) => {
    await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export complete');
    assert.match(await page.locator('.cp-uxp-n').innerText(), /1 users exported/);
    await waitForDownload(page, downloads);
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].suggestedFilename(), /^Users Export - Fixture - .*\.zip$/);
    const fs = require('node:fs');
    const zip = fs.readFileSync(await downloads[0].path()).toString('utf8');
    assert.ok(zip.includes('Users Export FULL - Fixture'));
    assert.ok(zip.includes('Phone Directory - Fixture'));
    assert.ok(zip.includes('442012341234'));
  }));

for (const form of ['raw', 'escaped']) test(`Unicode names in ${form} directory workbooks retain their characters`, () => {
  let payload = report.replace('Example, Alex', 'Example, Jos&#233; &#x1F600; &#131072;');
  if (form === 'escaped') payload = '<textarea>' + payload.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</textarea>';
  return fixture({report: payload}, async ({page, downloads}) => {
    await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export complete');
    await waitForDownload(page, downloads);
    assert.equal(downloads.length, 1);
    const zip = require('node:fs').readFileSync(await downloads[0].path()).toString('utf8');
    assert.ok(zip.includes('José 😀 𠀀'), 'the exported worksheet contains the original Unicode name');
    assert.ok(!zip.includes('&amp;#x1F600;'), 'hexadecimal entities are decoded before workbook escaping');
  });
});

test('closing a directory export before workbook assembly prevents a late download',
  () => fixture({ holdBuild: true }, async ({ page, downloads }) => {
    await page.waitForFunction(() => typeof window.fixtureFinishBuild === 'function');
    await page.locator('.cp-uxp-cancel').click();
    await page.evaluate(() => window.fixtureFinishBuild());
    await page.waitForTimeout(150);
    assert.equal(downloads.length, 0);
    assert.equal(await page.locator('.cp-uxp').count(), 0);
  }));

test('an explicit unauthorized directory report retains the sign-in guidance',
  () => fixture({ status: 401 }, async ({ page, downloads }) => {
    await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export stopped');
    assert.match(await page.locator('.cp-uxp-warns').innerText(), /sign in again/i);
    assert.equal(downloads.length, 0);
  }));

test('a redirected directory report stops without guessing that the session expired',
  () => fixture({ status: 302 }, async ({ page, downloads }) => {
    await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export stopped');
    assert.match(await page.locator('.cp-uxp-warns').innerText(), /redirect/i);
    assert.doesNotMatch(await page.locator('.cp-uxp-warns').innerText(), /sign in|session bounce/i);
    assert.equal(downloads.length, 0);
  }));

for (const name of ['constructor', '__proto__']) {
  test(`directory export retains a User ID named ${name}`,
    () => fixture({ report: report.replace('test1234', name) }, async ({ page, downloads }) => {
      await page.waitForFunction(() => /Export complete|Export stopped/.test(document.querySelector('.cp-uxp-h')?.textContent || ''));
      assert.equal(await page.locator('.cp-uxp-h').innerText(), 'Export complete');
      assert.match(await page.locator('.cp-uxp-n').innerText(), /1 users exported/);
      await waitForDownload(page, downloads);
      assert.equal(downloads.length, 1);
      const zip = require('node:fs').readFileSync(await downloads[0].path()).toString('utf8');
      assert.ok(zip.includes(`<t xml:space="preserve">${name}</t>`));
    }));
  test(`directory export groups a department named ${name} without prototype collisions`,
    () => fixture({ report: report.replace('Operations', name) }, async ({ page, downloads }) => {
      await page.waitForFunction(() => /Export complete|Export stopped/.test(document.querySelector('.cp-uxp-h')?.textContent || '') ||
        document.querySelector('.cp-uxp-warns')?.textContent.includes('Workbook build failed'));
      assert.equal(await page.locator('.cp-uxp-h').innerText(), 'Export complete', await page.locator('.cp-uxp-warns').innerText());
      await waitForDownload(page, downloads);
      assert.equal(downloads.length, 1);
      const zip = require('node:fs').readFileSync(await downloads[0].path()).toString('utf8');
      assert.ok(zip.includes(`name="${name}"`), 'keep the actual department worksheet name');
    }));
}

test('directory export still deduplicates repeated User IDs case-insensitively',
  () => fixture({ report: report.replace('</report>', report.match(/<row>[\s\S]*?<\/row>/)[0].replace('test1234', 'TEST1234') + '</report>') },
    async ({ page, downloads }) => {
      await page.waitForFunction(() => document.querySelector('.cp-uxp-h')?.textContent === 'Export complete');
      assert.match(await page.locator('.cp-uxp-n').innerText(), /1 users exported/);
      await waitForDownload(page, downloads);
      assert.equal(downloads.length, 1);
    }));

for (const navigation of ['native navigation', 'browser Back']) test(`leaving the directory through ${navigation} cancels its pending export`,
  () => fixture({ hold: true }, async ({ page, downloads }) => {
    await page.evaluate(navigation => {
      const target = '/commpilot/Group/Addresses/';
      if (navigation === 'browser Back') {
        const current = location.href;
        history.replaceState({ cpNav: { url: target, params: {} } }, '', target);
        history.pushState({ cpNav: { url: '/commpilot/Group/CompanyDir/index.jsp', params: {} } }, '', current);
        history.back();
      } else window.redirectPost(target, {});
    }, navigation);
    await page.waitForFunction(() => location.pathname === '/commpilot/Group/Addresses/' &&
      document.documentElement.getAttribute('data-cp-path') === '/commpilot/Group/Addresses/');
    assert.equal(await page.locator('.cp-uxp').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureReportAborts), 1);
    assert.equal(downloads.length, 0);
  }));

test('directory export refuses to overlap an active list search and permits a later explicit retry',
  ()=>fixture({noStart:true},async({page,downloads})=>{
    await page.evaluate(()=>{
      const fetch=window.fetch;
      window.fetch=(url,init)=>{
        if(init?.method==='POST'&&!String(url).includes('/servlet/ClientBGListServlet')){
          return new Promise((resolve,reject)=>{window.fixtureReleaseSearch=()=>reject(new Error('Fixture search finished'));});
        }
        return fetch(url,init);
      };
      window.fixtureSearchSettled=false;
      cpListSearch([{key:'UserLastName',value:'Fixture'}],{ctx:{landing:'/commpilot/Group/CompanyDir/index.jsp',baseParams:{}}})
        .catch(()=>{}).finally(()=>{window.fixtureSearchSettled=true;});
    });
    await page.waitForFunction(()=>typeof fixtureReleaseSearch==='function');
    await page.locator('.cp-uxp-start').click();
    await page.waitForFunction(()=>/Export stopped|Export complete/.test(document.querySelector('.cp-uxp-h')?.textContent||''));
    assert.equal(await page.locator('.cp-uxp-h').innerText(),'Export stopped');
    assert.match(await page.locator('.cp-uxp-warns').innerText(),/current operation/i);
    assert.equal(await page.evaluate(()=>fixtureReportRequests),0);
    assert.equal(downloads.length,0);
    await page.evaluate(()=>fixtureReleaseSearch());
    await page.waitForFunction(()=>fixtureSearchSettled);
    await page.locator('.cp-uxp-cancel').click();
    await page.locator('#cp-native-directory-export').click();
    await page.locator('.cp-uxp-start').click();
    await page.waitForFunction(()=>document.querySelector('.cp-uxp-h')?.textContent==='Export complete');
    assert.equal(await page.evaluate(()=>fixtureReportRequests),1);
    await waitForDownload(page,downloads);
    assert.equal(downloads.length,1);
  }));
