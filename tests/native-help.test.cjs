const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const root = path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';

// A user's Call Forwarding Always page, the way the extension leaves it: the top bar with CommPilot's Help and Home,
// the sidebar and a menu board section, the page title and three settings (forms.js rows), and a form still in
// CommPilot's own layout.
const page = `<!doctype html><html><body id="initBody.menuTemplate">
  <table><tr><td class="headerBar"><a class="headerLink" id="native-help" href="#">Help</a> <a class="headerLink" href="#">Home</a></td></tr>
    <tr><td class="headerBar"><a class="headerAuthLevelLink">Reseller</a> <span class="headerAuthLevel">TriSandbox1002</span></td></tr></table>
  <form name="leftNavForm">
    <a class="leftnavfolder" href="#">Incoming Calls</a>
    <a class="leftnavfolder" href="#">Call Control</a>
    <a class="navMenuItem" name="/User/CallForwardingAlways/" href="#">Call Forwarding Always</a>
    <a class="navMenuItem" name="/User/DoNotDisturb/" href="#">Do Not Disturb</a>
  </form>
  <div class="cp-console"><section class="cp-console-section"><div class="cp-console-head"><span class="cp-console-head-name">Incoming Calls</span></div>
    <div class="cp-console-body"><table><tr><td><table>
      <tr><td><a class="navMenuItem" name="/User/CallForwardingAlways/" href="#">Call Forwarding Always</a></td></tr>
      <tr><td id="cfa-description">Forward all incoming calls. <div class="cp-leaf-summary"><span id="cfa-preview">Off</span></div></td></tr>
      <tr><td height="5"></td></tr>
      <tr><td><a class="navMenuItem" name="/Group/Auto_Attendant/Modify/index.jsp?key=StanMikitaAA" href="#">Auto Attendant Profile</a></td></tr>
      <tr><td>Its name and schedules.</td></tr>
    </table></td></tr></table></div></section></div>
  <table><tr><td width="82%">
    <table><tr><td class="screenName">Call Forwarding Always</td></tr></table>
    <div class="fx"><section class="fx-sec"><div class="fx-grid">
      <div class="fx-item fx-choice"><div class="fx-label">Call Forwarding Always</div><div class="fx-ctl"></div></div>
      <div class="fx-item fx-field"><label class="fx-label">Calls Forward to phone number / SIP-URI<span class="fx-req">*</span></label><div class="fx-ctl"></div></div>
      <div class="fx-item fx-check"><div class="fx-check-line"><label class="fx-check-label"><span class="fx-check-text">Play Ring Reminder when a call is forwarded</span></label></div></div>
    </div></section></div>
    <table id="native-form"><tr><td>Old field</td><td><input name="old"></td></tr></table>
  </td></tr></table>
  <script>window.nativeHelpClicks = 0; document.getElementById('native-help').onclick = () => window.nativeHelpClicks++;</script>
</body></html>`;
const help = {
  byName: { '/User/CallForwardingAlways/': { title: 'Call Forwarding Always', body: 'Sends every call to another number.' },
    '/Group/Auto_Attendant/Modify/': { title: 'Profile', body: 'Every auto attendant’s own profile.' } },
  bySection: { User: { 'Incoming Calls': { title: 'Incoming Calls', body: 'What happens to calls coming in.' } },
    Reseller: { 'Call Control': { title: 'Call Control', body: 'A reseller’s text: not for a user.' } } },
  bySetting: { '/User/CallForwardingAlways/': { 'Play Ring Reminder when a call is forwarded': { title: 'Ring Reminder', body: 'A short ring for each forwarded call.' } } },
};

test('damaged saved debug preferences do not disable Help tips or the debug panel', async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const tab = await browser.newPage(), errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    await tab.route('**/*', route => route.fulfill({ contentType:route.request().url().endsWith('help-content.json')?'application/json':'text/html',
      body:route.request().url().endsWith('help-content.json')?JSON.stringify(help):page }));
    await tab.goto(origin + '/commpilot/User/CallForwardingAlways/');
    await tab.evaluate(() => {
      chrome.runtime = {getURL:p=>'/ext/'+p,getManifest:()=>({version:'0.3.82'})};
      localStorage.setItem('cpDebugView','null');
      document.documentElement.setAttribute('data-cp-debug','');
    });
    await tab.addStyleTag({path:path.join(root,'src/content/native-help.css')});
    await tab.addScriptTag({path:path.join(root,'src/content/native-help.js')});
    await tab.waitForTimeout(150);
    assert.deepEqual(errors,[],'invalid saved JSON shape must not throw during startup');
    await tab.locator('#cp-help-tips').waitFor({timeout:2000});
    await tab.locator('#cp-debug').waitFor({timeout:2000});
    await tab.locator('#cp-debug input[name="native"]').check();
    assert.equal(await tab.evaluate(()=>JSON.parse(localStorage.getItem('cpDebugView')).native),true);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Help tips: the top bar’s button in place of CommPilot’s Help, tips for menus, sections, pages and settings, and the debug view with its colours, inspector and draggable panel', async () => {
  assert.ok(edge, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const tab = await context.newPage();
    await tab.route(`${origin}/**`, route => route.fulfill({ status: 200,
      contentType: route.request().url().endsWith('help-content.json') ? 'application/json' : 'text/html',
      body: route.request().url().endsWith('help-content.json') ? JSON.stringify(help) : page }));
    await tab.goto(`${origin}/commpilot/User/CallForwardingAlways/`);
    await tab.evaluate(() => {
      document.documentElement.dataset.cpDirection = 'atlas';
      globalThis.chrome = { runtime: { getURL: p => '/ext/' + p, getManifest: () => ({ version: '9.9.9' }) } };
    });
    await tab.addStyleTag({ path: path.join(root, 'src/content/native-help.css') });
    await tab.addScriptTag({ path: path.join(root, 'src/content/native-help.js') });

    // The button, where CommPilot's Help was; CommPilot's link stays in the page, hidden.
    const button = tab.locator('#cp-help-tips');
    await button.waitFor();
    const place = await tab.evaluate(() => ({ next: document.getElementById('cp-help-tips').nextElementSibling?.id,
      hidden: getComputedStyle(document.getElementById('native-help')).display }));
    assert.deepEqual(place, { next: 'native-help', hidden: 'none' });
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await tab.evaluate(() => window.nativeHelpClicks), 0, 'CommPilot’s own Help is not opened');

    const tipFor = async locator => {
      await tab.mouse.move(0, 0);
      await locator.hover();
      await tab.waitForTimeout(250);
      return tab.evaluate(() => { const t = document.getElementById('cp-native-help-tip'); return t && !t.hidden ? t.innerText : null; });
    };
    assert.match(await tipFor(tab.locator('form[name="leftNavForm"] a.navMenuItem').first()), /Sends every call to another number/);
    assert.match(await tipFor(tab.locator('td.screenName')), /Sends every call/, 'the page title: its menu option’s tip');
    assert.match(await tipFor(tab.locator('.fx-check-text', { hasText: 'Ring Reminder' })), /A short ring/);
    assert.match(await tipFor(tab.locator('a.leftnavfolder', { hasText: 'Incoming Calls' })), /calls coming in/);
    assert.equal(await tipFor(tab.locator('a.leftnavfolder', { hasText: 'Call Control' })), null, 'a reseller’s section tip is not a user’s');
    assert.equal(await tipFor(tab.locator('a.navMenuItem', { hasText: 'Do Not Disturb' })), null);
    // A menu board option is a whole box: its description and its preview show its tip too.
    assert.match(await tipFor(tab.locator('#cfa-description')), /Sends every call/);
    assert.match(await tipFor(tab.locator('#cfa-preview')), /Sends every call/);
    // An Auto Attendant's own name (key=…) is not part of the key: one tip serves every auto attendant.
    assert.match(await tipFor(tab.locator('a.navMenuItem', { hasText: 'Auto Attendant Profile' })), /Every auto attendant/);
    await tab.keyboard.press('Escape');
    assert.equal(await button.getAttribute('aria-pressed'), 'false');

    // The debug view: everything that could have a tip, green (solid) with one and red (dashed) without, counted.
    await tab.evaluate(() => document.documentElement.setAttribute('data-cp-debug', ''));
    await tab.locator('#cp-debug').waitFor();
    const counts = await tab.evaluate(() => ({ total: document.querySelector('.cp-debug-total').textContent,
      kinds: [...document.querySelectorAll('.cp-debug-kinds li')].map(li => `${li.querySelector('span').textContent}: ${li.querySelector('b').textContent}`),
      missing: [...document.querySelectorAll('[data-cp-tip="no"]')].map(el => el.textContent.trim()),
      lines: [...new Set([...document.querySelectorAll('[data-cp-tip]')].map(el => `${el.dataset.cpTip} ${getComputedStyle(el).outlineStyle}`))].sort(),
      copy: document.querySelector('.cp-debug-copy').textContent,
      page: document.querySelector('.cp-debug-page').textContent }));
    assert.equal(counts.total, 'Help tips on this page: 5 of 9');
    assert.deepEqual(counts.kinds, ['Menu options: 2 of 3', 'Sections: 1 of 2', 'Page title: 1 of 1', 'Settings: 1 of 3']);
    assert.deepEqual(counts.missing, ['Call Control', 'Do Not Disturb', 'Call Forwarding Always', 'Calls Forward to phone number / SIP-URI*']);
    assert.deepEqual(counts.lines, ['no dashed', 'yes none', 'yes solid'], 'the board’s option links give their colour to their box');
    // The box: the title row and the description row, tinted with a bar down the left.
    const box = await tab.evaluate(() => [...document.querySelectorAll('tr[data-cp-tip-box]')].map(tr =>
      `${tr.getAttribute('data-cp-tip-box')} ${/ 4px 0px 0px 0px inset/.test(getComputedStyle(tr.firstElementChild).boxShadow)}`));
    assert.deepEqual(box, ['yes true', 'yes true', 'yes true', 'yes true']);
    assert.equal(counts.copy, 'Copy the 4 missing as JSON');
    assert.match(counts.page, /Page\/User\/CallForwardingAlways\/LevelUser/);
    await tab.locator('.cp-debug-copy').click();
    assert.deepEqual(JSON.parse(await tab.evaluate(() => navigator.clipboard.readText())), {
      byName: { '/User/DoNotDisturb/': { title: 'Do Not Disturb', body: '' } },
      bySection: { User: { 'Call Control': { title: 'Call Control', body: '' } } },
      bySetting: { '/User/CallForwardingAlways/': {
        'Call Forwarding Always': { title: 'Call Forwarding Always', body: '' },
        'Calls Forward to phone number / SIP-URI': { title: 'Calls Forward to phone number / SIP-URI', body: '' } } } });

    // Pointing at something coloured names it and its key; Alt+click copies its entry alone, and the link does not open.
    const dnd = tab.locator('form[name="leftNavForm"] a.navMenuItem', { hasText: 'Do Not Disturb' });
    await dnd.hover();
    await tab.locator('#cp-debug-inspect:not([hidden])').waitFor();
    assert.match(await tab.locator('#cp-debug-inspect').innerText(), /Menu option · no tip yet\s*\/User\/DoNotDisturb\/\s*Alt\+click copies its entry/i);
    await dnd.click({ modifiers: ['Alt'] });
    await tab.waitForFunction(async () => (await navigator.clipboard.readText()).includes('DoNotDisturb') &&
      !(await navigator.clipboard.readText()).includes('Call Control'));

    // A kind's colours switch off in the panel (and stay off); the others keep theirs.
    await tab.locator('.cp-debug-kinds label', { hasText: 'Settings' }).locator('input').uncheck();
    await tab.waitForFunction(() => document.documentElement.getAttribute('data-cp-debug-hide') === 'setting');
    assert.deepEqual(await tab.evaluate(() => [getComputedStyle(document.querySelector('.fx-item > .fx-label')).outlineStyle,
      getComputedStyle(document.querySelector('td.screenName')).outlineStyle]), ['none', 'solid']);
    await tab.locator('.cp-debug-kinds label', { hasText: 'Settings' }).locator('input').check();
    await tab.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-debug-hide'));

    // The panel drags by its header, stays where it was left, and is back there the next time it opens.
    const head = await tab.locator('#cp-debug .cp-debug-head strong').boundingBox();
    await tab.mouse.move(head.x + 10, head.y + 5);
    await tab.mouse.down();
    await tab.mouse.move(head.x + 410, head.y - 195, { steps: 6 });
    await tab.mouse.up();
    const moved = await tab.evaluate(() => { const r = document.getElementById('cp-debug').getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), saved: JSON.parse(localStorage.getItem('cpDebugView')) }; });
    assert.ok(moved.left > 300, `dragged right (${moved.left})`);
    assert.deepEqual([moved.saved.left, moved.saved.top], [moved.left, moved.top]);
    await tab.evaluate(() => document.documentElement.removeAttribute('data-cp-debug'));
    await tab.waitForFunction(() => !document.getElementById('cp-debug'));
    await tab.evaluate(() => document.documentElement.setAttribute('data-cp-debug', ''));
    await tab.locator('#cp-debug').waitFor();
    assert.deepEqual(await tab.evaluate(() => { const r = document.getElementById('cp-debug').getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top)]; }), [moved.left, moved.top]);

    // CommPilot's own forms, outlined when switched on in the panel.
    await tab.locator('#cp-debug input[name="native"]').check();
    await tab.waitForFunction(() => document.getElementById('native-form').hasAttribute('data-cp-debug-native'));
    await tab.locator('#cp-debug input[name="native"]').uncheck();
    await tab.waitForFunction(() => !document.getElementById('native-form').hasAttribute('data-cp-debug-native'));

    // A new setting on the page is counted; debug off takes the panel and the colours away.
    await tab.evaluate(() => document.querySelector('.fx-grid').insertAdjacentHTML('beforeend',
      '<div class="fx-item fx-field"><div class="fx-label">A new one</div></div>'));
    await tab.waitForFunction(() => document.querySelector('.cp-debug-total')?.textContent === 'Help tips on this page: 5 of 10');
    await tab.evaluate(() => document.documentElement.removeAttribute('data-cp-debug'));
    await tab.waitForFunction(() => !document.getElementById('cp-debug') && !document.querySelector('[data-cp-tip]'));
  } finally { await browser.close(); }
});
