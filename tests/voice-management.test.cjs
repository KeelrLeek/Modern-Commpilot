const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const root = path.resolve(process.env.BW_TEST_EXTENSION_PATH || path.join(__dirname, '..'));
const browserPath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';
const general = '/commpilot/User/VM/General/';
const advanced = '/commpilot/User/VM/Advanced/';

// Model the native save-and-forward contract, including formSubmitLinkForward
// from the captured CommPilot validator: validate, set linkForward, form.submit().
// The test server stands in for the PBX; no customer settings are read or written.
function html(content, head = '', title = 'Voice Management') {
  return `<!doctype html><html data-cp-direction="rosepine-light"><head><title>${title}</title>${head}</head>
    <body id="initBody.menuTemplate"><form name="leftNavForm"><a class="leftnavfolderopen">Messaging</a></form>
    <table width="100%"><tr><td width="82%" valign="top">${content}</td></tr></table>
    <script>window.redirectPost = window.redirectPost || function(){};</script></body></html>`;
}
async function fixture(page, initialPath = '/commpilot/User/') {
  const state = { serial: 0, enabled: false, posts: [], scripts: [], failScript: false, helperDelay: 80 };
  const validator = general + 'validate.js';
  const helpers = '/commpilot/Scripts/voice-test-utils.js';
  const scripts = {
    [helpers]: `window.voiceHelperInstalls=(window.voiceHelperInstalls||0)+1;
      function trim(s){return s.replace(/^\\s+|\\s+$/g,'');}`,
    [validator]: `window.voiceValidatorInstalls=(window.voiceValidatorInstalls||0)+1;
      window.voiceValidatorReady=trim(' ready ');
      function validate(form){
        window.voiceValidations=(window.voiceValidations||0)+1;
        if(!trim(form.elements.notification.value)){alert('Notification address is required.');return false;}
        return true;
      }
      function formSubmitLinkForward(s){
        var form=document.mainForm;
        if(validate(form)){form.linkForward.value=s;form.submit();}
      }`
  };
  function generalPage() {
    const head = `<script src="${helpers}"></script><script src="validate.js"></script>`;
    const body = `<form name="mainForm" id="mainForm" method="post">
      <input type="hidden" name="formtokenserial" value="vm-${state.serial}">
      <input type="hidden" name="linkForward" value="">
      <table width="100%"><tr><td class="screenName">Voice Management</td></tr>
      <tr id="buttonbartop"><td class="buttonbar"><input name="apply" type="submit" value="Apply"></td></tr>
      <tr><td class="enduserbody"><table class="enduserbody"><tr><td>Voice messaging:</td><td>
        <label><input type="radio" name="active" value="true" ${state.enabled ? 'checked' : ''}>On</label>
        <label><input type="radio" name="active" value="false" ${state.enabled ? '' : 'checked'}>Off</label>
      </td></tr><tr><td>Notification address:</td><td><input name="notification" value="alex@example.test"></td></tr>
      <tr><td colspan="2"><a class="nestedLink" id="voice-advanced">Advanced Settings (Also saves current screen data)</a>
      <script>document.addEventListener('DOMContentLoaded',function(){
        document.getElementById('voice-advanced').addEventListener('click',function(){
          formSubmitLinkForward('${advanced}');
        });
      });</script></td></tr></table></td></tr></table></form>`;
    return html(body, head);
  }
  await page.route(origin + '/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (scripts[url.pathname]) {
      state.scripts.push(url.pathname);
      if (state.failScript && url.pathname === validator)
        return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' });
      await new Promise(resolve => setTimeout(resolve, url.pathname === helpers ? state.helperDelay : 15));
      return route.fulfill({ contentType: 'application/javascript', body: scripts[url.pathname] });
    }
    let params = new URLSearchParams(req.postData() || '');
    if (req.method() === 'POST') {
      assert.equal(params.get('formtokenserial'), 'vm-' + state.serial);
      state.posts.push({ path: url.pathname, params: Object.fromEntries(params) });
      state.serial++;
    }
    if (params.get('linkForward')) {
      state.enabled = params.get('active') === 'true';
      return route.fulfill({ contentType: 'text/html', body: html(
        `<input type="hidden" name="formtokenserial" value="vm-${state.serial}">
         <h2 id="voice-advanced-page">Advanced Settings</h2><div id="saved-state">${state.enabled ? 'On' : 'Off'}</div>
         <script>window.validate=function(){throw Error('stale validator from another page');};</script>`
      ) });
    }
    if (url.pathname === general)
      return route.fulfill({ contentType: 'text/html', body: generalPage() });
    return route.fulfill({ contentType: 'text/html', body: html(
      `<input type="hidden" name="formtokenserial" value="vm-${state.serial}"><div>Messaging menu</div>`
    ) });
  });
  await page.goto(origin + initialPath, { waitUntil: 'load' });
  await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
  await page.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
  for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
    await page.addStyleTag({ path: path.join(root, 'src/content', file) });
  await page.evaluate(() => { window.originalDocument = document; });
  return state;
}

test('Voice Management saves the edited native form once before opening Advanced Settings through PJAX', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const state = await fixture(page);
    for (const enabled of [true, false]) {
      await page.evaluate(url => window.redirectPost(url, {}), general);
      await page.locator('.fx-saves#voice-advanced').waitFor({ timeout: 4000 });
      await page.locator(`input[name="active"][value="${enabled}"]`).check();
      await page.locator('input[name="notification"]').fill('changed@example.test');
      const before = state.posts.length;
      await page.locator('#voice-advanced').click();
      await page.locator('#voice-advanced-page').waitFor({ timeout: 2500 });
      assert.equal(state.posts.length, before + 1, 'one save, without a separate premature navigation');
      assert.equal(state.posts.at(-1).path, general);
      assert.equal(state.posts.at(-1).params.active, String(enabled));
      assert.equal(state.posts.at(-1).params.notification, 'changed@example.test');
      assert.equal(state.posts.at(-1).params.linkForward, advanced);
      assert.equal(await page.locator('#saved-state').innerText(), enabled ? 'On' : 'Off');
      assert.equal(await page.evaluate(() => document === originalDocument), true);
    }
    assert.equal(await page.evaluate(() => voiceHelperInstalls), 1, 'shared helpers are not installed twice');
    assert.equal(await page.evaluate(() => voiceValidatorInstalls), 2, 'page-specific validator is restored on revisit');
    assert.equal(await page.evaluate(() => voiceValidations), 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Advanced Settings keeps native validation and does not save invalid Voice Management fields', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage(), state = await fixture(page);
    const alerts = [];
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
    await page.evaluate(url => window.redirectPost(url, {}), general);
    await page.locator('.fx-saves#voice-advanced').waitFor({ timeout: 4000 });
    await page.locator('input[name="notification"]').fill(' ');
    const before = state.posts.length;
    await page.locator('#voice-advanced').click();
    await page.waitForFunction(() => window.voiceValidations === 1, null, { timeout: 2000 });
    assert.deepEqual(alerts, ['Notification address is required.']);
    assert.equal(state.posts.length, before);
    assert.equal(await page.locator('#voice-advanced-page').count(), 0);
    assert.equal(await page.locator('input[name="notification"]').inputValue(), ' ');
  } finally { await browser.close(); }
});

test('Advanced Settings also saves in-shell when Voice Management was the initial native page', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage(), state = await fixture(page, general);
    await page.locator('.fx-saves#voice-advanced').waitFor();
    await page.locator('input[name="active"][value="true"]').check();
    await page.locator('#voice-advanced').click();
    await page.locator('#voice-advanced-page').waitFor({ timeout: 2500 });
    assert.equal(state.posts.length, 1);
    assert.equal(state.enabled, true);
    assert.equal(await page.evaluate(() => document === originalDocument), true);
  } finally { await browser.close(); }
});

test('a failed Voice Management dependency shows an error and blocks the form until a successful reload', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage(), state = await fixture(page);
    state.failScript = true;
    await page.evaluate(url => window.redirectPost(url, {}), general);
    await page.locator('.cp-alert-error').waitFor({ timeout: 4000 });
    assert.match(await page.locator('.cp-alert-error').innerText(), /Voice Management could not initialize/);
    assert.equal(await page.locator('td[width="82%"]').evaluate(cell => cell.inert), true);
    assert.equal(state.posts.length, 1, 'only the page read was sent');
    state.failScript = false;
    await page.evaluate(url => window.redirectPost(url, {}), general);
    await page.locator('.fx-saves#voice-advanced').waitFor({ timeout: 4000 });
    assert.equal(await page.locator('td[width="82%"]').evaluate(cell => cell.inert), false);
    await page.locator('#voice-advanced').click();
    await page.locator('#voice-advanced-page').waitFor({ timeout: 2500 });
    assert.equal(state.posts.length, 3, 'read, explicit reload, then one save');
  } finally { await browser.close(); }
});

test('leaving Voice Management while its dependencies load does not initialize handlers on the next page', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage(), state = await fixture(page);
    state.helperDelay = 500;
    await page.evaluate(url => window.redirectPost(url, {}), general);
    await page.waitForFunction(() => document.querySelector('td[width="82%"]')?.inert);
    await page.evaluate(() => window.redirectPost('/commpilot/User/CallPolicies/', {}));
    await page.getByText('Messaging menu', { exact: true }).waitFor({ timeout: 4000 });
    await page.waitForTimeout(650);
    assert.equal(await page.locator('td[width="82%"]').evaluate(cell => cell.inert), false);
    assert.equal(await page.locator('.cp-alert-error').count(), 0);
    assert.equal(await page.evaluate(() => window.voiceValidatorInstalls || 0), 0);
    assert.equal(await page.evaluate(() => location.pathname), '/commpilot/User/CallPolicies/');
    assert.equal(state.posts.length, 2, 'only the two explicit page reads');
  } finally { await browser.close(); }
});

test('repeated Voice Management visits reload validators without accumulating head scripts', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage(), state = await fixture(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let firstHead;
    for (let visit = 0; visit < 12; visit++) {
      await page.evaluate(url => window.redirectPost(url, {}), general);
      await page.locator('.fx-saves#voice-advanced').waitFor({ timeout: 6000 });
      const headCount = await page.locator('head script').count();
      if (firstHead === undefined) firstHead = headCount;
      assert.ok(headCount <= firstHead, `head scripts grew from ${firstHead} to ${headCount} on visit ${visit + 1}`);
      assert.equal(await page.evaluate(() => voiceValidatorInstalls), visit + 1);
      await page.locator('#voice-advanced').click();
      await page.locator('#voice-advanced-page').waitFor({ timeout: 4000 });
      assert.equal(await page.evaluate(() => voiceValidations), visit + 1, 'the current native validator still runs');
    }
    assert.equal(await page.evaluate(() => voiceHelperInstalls), 1, 'shared helpers remain cached');
    assert.equal(state.posts.filter(post => post.params.linkForward).length, 12, 'one explicitly requested fixture save per visit');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
