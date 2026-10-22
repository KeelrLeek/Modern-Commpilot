const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';
const LIST = '/commpilot/Group/Members/';
const MODIFY = '/commpilot/Group/Members/Modify/index.jsp';
const CAP = 1000, PER_PAGE = 20;

// A group's users, shaped to exercise the sweep: more than CAP first names start with "M" (so "m" splits into
// "ma", "mb", …), one first name is exactly "M" (under no longer prefix), and three users have no first name
// (a first-name sweep cannot reach them; the User ID pass can).
function users() {
  const out = [], abc = 'abcdefghijklmnopqrstuvwxyz';
  const add = (first, last, id) => out.push({ id, first, last, ext: String(1000 + out.length) });
  for (let i = 0; i < 1150; i++) add(`M${abc[i % 26]}${abc[(i >> 3) % 26]}ria ${i}`, `Last${i}`, `${2055550000 + out.length}@x.test`);
  add('M', 'Solo', `${2055550000 + out.length}@x.test`);
  const starts = 'abcdefghijklnopqrstuvwxyz0123456789'.split('').concat(["'", '-', '.']);
  for (let i = 0; i < 1446; i++) {
    const c = starts[i % starts.length];
    add(`${c.toUpperCase()}${abc[i % 26]}ne ${i}`, `Last${i}`, `${2055550000 + out.length}@x.test`);
  }
  for (let i = 0; i < 3; i++) add('', `Nameless${i}`, `000${i}@x.test`);
  return out;
}
const PEOPLE = users();

function matches(criteria) {
  return PEOPLE.filter(u => criteria.every(c => {
    const field = { UserID: u.id, UserLastName: u.last, UserFirstName: u.first }[c.key] || '';
    const a = field.toLowerCase(), b = c.value.toLowerCase();
    return c.op === 'EQUAL_TO' ? a === b : c.op === 'CONTAINS' ? a.includes(b) : a.startsWith(b);
  })).sort((a, b) => a.id.localeCompare(b.id));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
function form(token, criteria, inner) {
  const c = criteria[0] || { key: 'UserFirstName', op: 'STARTS_WITH', value: '' };
  const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  return `<form name="mainForm" id="mainForm" method="post"><input type="hidden" name="formtokenserial" value="${token}">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>
    <tr><td class="screenName">Users</td></tr><tr><td class="tip">Add a new user or manage existing users.</td></tr>
    ${inner.message || ''}
    <tr id="buttonbartop"><td class="buttonbar"><input type="hidden" name="buttonClicked" value=""></td></tr>
    <tr><td class="enduserbody"><input type="hidden" id="rowNum" name="rowNum" value="0">
      <table class="enduserbody" id="searchTable"><tbody><tr id="tr0">
        <td><select id="findKey0" name="findKey0">${opt('UserID', 'User ID', c.key)}${opt('UserLastName', 'Last Name', c.key)}${opt('UserFirstName', 'First Name', c.key)}${opt('ExactUserDepartment', 'Department', c.key)}</select></td>
        <td><select id="findOp0" name="findOp0">${opt('STARTS_WITH', 'Starts With', c.op)}${opt('CONTAINS', 'Contains', c.op)}${opt('EQUAL_TO', 'Equal To', c.op)}</select></td>
        <td><input type="text" id="findValue0" name="findValue0" value="${esc(c.value)}"></td>
        <td><input type="submit" id="search0" name="search" value="Search"></td></tr></tbody></table>
      ${inner.list || ''}
    </td></tr></tbody></table>
    <script>function doPage(pg){ var parmsArray = { returnPage: '/Group/Members/', tableName: 'groupUserList', value: pg };
      redirectPost('/commpilot/Common/page.jsp', parmsArray); }</script></form>`;
}
function list(rows, pageNo, pages) {
  const head = ['User ID', 'Last Name', 'First Name', 'Extension'].map(h =>
    `<td class="listHeader"><img src="/commpilot/Graphics/onepx.gif" width="0" height="1"></td><td class="listHeader"><a class="listSortHeader">${h}&nbsp;</a></td>`).join('');
  const body = rows.map((u, i) => `<tr id="Row${i + 1}" class="unselected">` +
    [u.id, u.last, u.first, u.ext].map((v, c) => `<td width="0">&nbsp;</td><td><a id="Row${i + 1}Col${c}" class="tableLink">${esc(v)}</a></td>`).join('') +
    `<td class="unselected"><a class="headerLink" id="edit${i + 1}">Edit</a>
      <script>document.addEventListener('DOMContentLoaded', function () { document.getElementById('Row${i + 1}Col0').addEventListener('click', function () {
        redirectPost('${MODIFY}', { userId: '${esc(u.id)}' }); }); });</script></td></tr>`).join('');
  // Empty native searches include this marker; a bare header is an incomplete
  // response and must not count as a successfully searched prefix.
  return `<table border="0" cellpadding="2" cellspacing="0" width="100%"><tbody><tr>${head}<td class="listHeader"> Edit</td></tr>${body || '<tr><td colspan="9">No Entries Present</td></tr>'}</tbody></table>
    <table class="enduserbody"><tbody><tr><td width="33%"></td><td width="33%">[ Page ${pageNo} of ${pages} ]</td><td width="33%"></td></tr></tbody></table>`;
}
// The toast saying what the sweep loaded (toasts.js): its kind, title, body and button.
const note = page => page.evaluate(() => {
  const t = [...document.querySelectorAll('#cp-toasts .cp-toast:not(.cp-toast-leaving)')].at(-1);
  return t && { kind: t.className.match(/cp-toast-(info|warning|error)/)?.[1], title: t.querySelector('.cp-toast-title')?.textContent,
    body: t.querySelector('.cp-toast-body')?.textContent, act: t.querySelector('.cp-toast-act')?.textContent || null };
});
const noteSays = async (page, title) => {
  await page.waitForFunction(title => [...document.querySelectorAll('#cp-toasts .cp-toast:not(.cp-toast-leaving) .cp-toast-title')]
    .some(t => t.textContent === title || t.textContent === 'CommPilot stopped answering'), title, { timeout: 120000 });
  assert.equal((await note(page))?.title, title, 'unexpected sweep result: ' + JSON.stringify(await note(page)));
};
// The swept list, page by page through lists.js's pager (only the page on screen is in the page): each row's User ID
// and first name, the page's size, and the pager's total.
const listed = page => page.evaluate(async () => {
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const first = document.querySelector('.cp-pager [data-go="first"]');
  if (first && !first.disabled) { first.click(); await frame(); }
  const ids = [], names = [], sizes = [];
  for (;;) {
    const rows = document.querySelectorAll('.cp-sweep-table tr[id^="Row"]');
    sizes.push(rows.length);
    for (const tr of rows) { ids.push(tr.querySelector('a.tableLink[id$="Col0"]')?.textContent); names.push(tr.querySelector('a[id$="Col2"]')?.textContent); }
    const next = document.querySelector('.cp-pager [data-go="next"]');
    if (!next || next.disabled || next.closest('[hidden]')) break;
    next.click(); await frame();
  }
  if (first && !first.disabled) { first.click(); await frame(); }
  const total = /of ([\d,]+)$/.exec(document.querySelector('.cp-pager-text')?.textContent || '')?.[1];
  return { ids, names, sizes, total: total ? +total.replace(/,/g, '') : ids.length,
    held: document.querySelectorAll('.cp-sweep-table template').length };
});
const shell = content => `<!doctype html><html><head><title>Users</title></head><body id="initBody.menuTemplate">
  <table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr><td>
  <table width="100%"><tbody><tr><td class="headerBar"><img src="/commpilot/conf/clientLogo.gif"></td>
    <td class="headerBar"><a class="headerLink">Help</a>&nbsp;<a class="headerLink">Home</a></td></tr>
    <tr><td class="headerBar"><a class="headerAuthLevelLink">Group</a> &gt;&nbsp;<a class="headerAuthLevelLink">Users</a></td>
    <td class="headerBar"><span class="headerBarWelcome">Welcome&nbsp;Test&nbsp;</span> <a class="headerLink">[Logout]</a></td></tr></tbody></table>
  </td></tr></tbody></table>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" height="100%"><tbody><tr>
    <td width="18%" valign="top" class="headandfoot"><form name="leftNavForm"><table><tbody><tr><td class="navOptions">Options:</td></tr>
      <tr><td class="leftnavfolderopen"><a class="leftnavfolderopen">Users</a></td></tr></tbody></table></form></td>
    <td width="82%" valign="top">${content}</td></tr></tbody></table>
  <script>window.redirectPost = window.redirectPost || function () {};</script></body></html>`;

async function fixture() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-sweep-'));
  const context = await chromium.launchPersistentContext(profile, { executablePath: browserPath, headless: true,
    viewport: { width: 1400, height: 900 }, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const log = { posts: [], stale: [], searches: [] };
  let serial = 0, current = [];
  const next = () => `tok-${++serial}`;
  await context.route(origin + '/**', async route => {
    const req = route.request(), url = new URL(req.url()), body = new URLSearchParams(req.postData() || '');
    const html = content => route.fulfill({ status: 200, contentType: 'text/html', body: shell(content) });
    if (url.pathname === '/commpilot/Login/') return route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><title>Login</title><body id="loginBody"><form name="loginForm"></form></body>' });
    if (req.method() !== 'POST') return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    const token = body.get('formtokenserial');
    // Signing in (the login page posts to the list): the list's page with its empty search form.
    if (!body.has('formtokenserial')) { current = []; return html(form('tok-0', [], {})); }
    log.posts.push({ path: url.pathname, token });
    // CommPilot's single-use token: anything but the last one issued signs the session out.
    if (token !== `tok-${serial}`) { log.stale.push({ path: url.pathname, token, expected: `tok-${serial}` }); return route.fulfill({ status: 302, headers: { location: '/commpilot/Login/' } }); }
    if (url.pathname === '/commpilot/Common/page.jsp') {
      const p = Number(body.get('value')), pages = Math.max(1, Math.ceil(current.length / PER_PAGE));
      return html(form(next(), [], { list: list(current.slice(p * PER_PAGE, (p + 1) * PER_PAGE), p + 1, pages) }));
    }
    if (url.pathname === MODIFY) return html(`<form name="mainForm"><input type="hidden" name="formtokenserial" value="${next()}"><table><tbody><tr><td class="screenName">User ${esc(body.get('userId'))}</td></tr></tbody></table></form>`);
    if (url.pathname === LIST && !body.has('search') && body.get('buttonClicked') !== 'search') return html(form(next(), [], {}));
    if (url.pathname === LIST) {
      const criteria = [];
      for (let i = 0; body.has('findKey' + i); i++) {
        if (body.get('findValue' + i)) criteria.push({ key: body.get('findKey' + i), op: body.get('findOp' + i), value: body.get('findValue' + i) });
      }
      log.searches.push(criteria);
      const found = matches(criteria);
      if (found.length > CAP) {
        current = [];
        return html(form(next(), criteria, { message: `<tr><td class="error"><span class="Failure"><b>Failed to read: [Error 4027] Please narrow your search, there are ${found.length} matching records.</b></span></td></tr>` }));
      }
      current = found;
      return html(form(next(), criteria, { list: list(found.slice(0, PER_PAGE), 1, Math.max(1, Math.ceil(found.length / PER_PAGE))) }));
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
  });
  const page = await context.newPage();
  await page.goto(origin + '/commpilot/Login/');
  await page.evaluate(list => {
    const f = document.createElement('form'); f.method = 'POST'; f.action = list; document.body.append(f); f.submit();
  }, LIST);
  await page.waitForFunction(() => document.documentElement.dataset.cpDirection && document.getElementById('search0'));
  return { context, page, log, profile };
}
async function searchAll(page) {
  await page.locator('#search0').click();
  await page.locator('.cp-sweep-offer').waitFor({ timeout: 15000 });
}

test('a search CommPilot refuses as too many offers to load them all, sweeps by first name then User ID, and becomes one list', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const { context, page, log, profile } = await fixture();
  try {
    // The whole group matches 2,600 users: CommPilot refuses; the page offers to load them all, instead of a toast.
    await searchAll(page);
    const offer = await page.evaluate(() => ({
      h: document.querySelector('.cp-sweep-h').textContent, s: document.querySelector('.cp-sweep-offer .cp-sweep-s').textContent,
      go: document.querySelector('.cp-sweep-go').textContent, toasts: document.querySelectorAll('#cp-toasts .cp-toast, #cp-toasts > *').length,
      errorShown: getComputedStyle(document.querySelector('td.error')).display !== 'none' }));
    assert.equal(offer.h, 'Too many results for one search');
    assert.match(offer.s, /There are 2,600 matching records\./);
    assert.equal(offer.go, 'Load all 2,600');
    assert.deepEqual([offer.toasts, offer.errorShown], [0, false], 'the card says it: no toast, no raw error');

    // Loading: the alphabet tracker, the bar and count, the prefix being searched.
    await page.locator('.cp-sweep-go').click();
    await page.locator('.cp-sweep-run').waitFor();
    await page.waitForFunction(() => document.querySelector('.cp-sweep-sub')?.textContent.includes('› '), null, { timeout: 60000 });
    const running = await page.evaluate(() => ({
      h: document.querySelector('.cp-sweep-h').textContent, chips: document.querySelectorAll('.cp-sweep-tk').length,
      cur: document.querySelectorAll('.cp-sweep-tk.cur').length, sub: document.querySelector('.cp-sweep-sub').textContent,
      n: document.querySelector('.cp-sweep-n').textContent, cancel: !!document.querySelector('.cp-sweep-cancel') }));
    assert.equal(running.h, 'Loading all 2,600 results…');
    assert.equal(running.chips, 36 + 22, 'a chip for every first character: letters, digits and punctuation');
    assert.equal(running.cur, 1);
    assert.match(running.sub, /^Searching First Name m › m./, 'the busy "m" splits into longer prefixes');
    assert.match(running.n, /^[\d,]+ of 2,600$/);
    assert.equal(running.cancel, true);
    // The radar turns by CSS (off the main thread), and the logo's heartbeat line runs with the sweep.
    const live = await page.evaluate(() => ({
      radar: document.getAnimations().some(an => an.animationName === 'cp-sweep-radar' && an.playState === 'running'),
      line: document.documentElement.dataset.cpProgress,
      value: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cp-progress')) }));
    assert.deepEqual([live.radar, live.line], [true, 'on']);
    assert.ok(live.value > 0 && live.value < 1, `the line is part-way (${live.value})`);

    // Done: every user a first name reaches (all but the 3 without one, "M" itself included), as one list; a toast says
    // so, with the next step as its button.
    await noteSays(page, 'Some results are missing');
    await page.waitForFunction(() => document.documentElement.dataset.cpProgress !== 'on', null, { timeout: 5000 });   // the line lets go
    assert.deepEqual(await note(page), { kind: 'warning', title: 'Some results are missing',
      body: '2,597 of 2,600 loaded. 3 could not be reached by First Name.', act: 'Find the other 3 by User ID' });
    const first = await listed(page);
    assert.deepEqual([first.ids.length, new Set(first.ids).size, first.total, first.names.includes('M')], [2597, 2597, 2597, true],
      'each user once; the first name exactly "M" too');
    // Only the page on screen is in the page; the other rows wait outside it (lists.js), as the alpha's grid kept them.
    assert.ok(Math.max(...first.sizes) <= 40, `a page's rows, not thousands (${Math.max(...first.sizes)})`);
    assert.equal(first.held, 0, 'lists.js took the held rows');

    // The rest by User ID, from the toast's button.
    await page.locator('#cp-toasts .cp-toast-act').click();
    await noteSays(page, 'All results loaded');
    const done = await note(page);
    assert.deepEqual([done.kind, done.act], ['info', null], 'a note that goes by itself');
    assert.match(done.body, /^2,600 loaded in \d+ s, \d+ searches\.$/);
    const all = await page.evaluate(() => ({
      rows: document.querySelectorAll('.cp-sweep-table tr[id^="Row"]').length,
      pager: document.querySelector('.cp-pager-count')?.textContent || '', pagers: document.querySelectorAll('.cp-pager').length,
      shown: [...document.querySelectorAll('.cp-sweep-table tr[id^="Row"]')].filter(tr => getComputedStyle(tr).display !== 'none').length }));
    assert.equal(all.rows, all.shown, 'the page holds only the rows on screen');
    assert.match(all.pager, new RegExp(`^1–${all.shown} of 2,600$`), 'lists.js pages it like any list');
    assert.equal(all.pagers, 1, 'the first pass’s list went with its pager');
    const every = await listed(page);
    assert.deepEqual([every.ids.length, new Set(every.ids).size], [2600, 2600], 'every user, once, page by page');

    // A sort orders the whole list, not the page: the first page after it starts with the list's first name.
    const sorted = await page.evaluate(async () => {
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const link = [...document.querySelectorAll('.cp-sweep-table a.listSortHeader')].find(a => a.textContent.trim().startsWith('First Name'));
      link.click(); await frame();
      const top = () => document.querySelector('.cp-sweep-table tr[id^="Row"] a[id$="Col2"]')?.textContent;
      const up = top();
      link.click(); await frame();
      const downNames = [...document.querySelectorAll('.cp-sweep-table tr[id^="Row"] a[id$="Col2"]')].map(a => a.textContent);
      return { up, down: top(), downNames, rows: document.querySelectorAll('.cp-sweep-table tr[id^="Row"]').length };
    });
    const names = every.names.filter(Boolean).sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare);
    assert.deepEqual([sorted.up, sorted.down], [names[0], ''], 'ascending puts blanks last; descending brings them first across all 2,600');
    assert.deepEqual(sorted.downNames.slice(0, 3), ['', '', ''], 'all three users without first names lead the descending list');
    assert.equal(sorted.downNames.find(Boolean), names.at(-1), 'the highest populated name follows the blanks');
    assert.equal(sorted.rows, all.shown);

    // CommPilot's own list state is put back (the page's search, all users), and no request ever used a spent token.
    await page.waitForTimeout(500);
    assert.deepEqual(log.searches.at(-1), [], 'the last search is the page’s own');
    assert.deepEqual(log.stale, [], 'every request carried the token the previous answer issued');

    // A row opens its user, through CommPilot's own redirectPost.
    await page.locator('.cp-sweep-table tr[id^="Row"]:not(.cp-row-off) a.tableLink').first().click();
    await page.waitForFunction(() => /^User /.test(document.querySelector('td.screenName')?.textContent || ''));
    assert.equal(log.posts.at(-1).path, '/commpilot/Group/Members/Modify/index.jsp');
    assert.deepEqual(log.stale, []);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('Cancel keeps what was loaded; opening another page stops the sweep without spending a token twice', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const { context, page, log, profile } = await fixture();
  try {
    await searchAll(page);
    await page.locator('.cp-sweep-go').click();
    await page.waitForFunction(() => parseInt((document.querySelector('.cp-sweep-n')?.textContent || '0').replace(/,/g, ''), 10) > 300, null, { timeout: 60000 });
    await page.locator('.cp-sweep-cancel').click();
    await noteSays(page, 'Loading stopped');
    const stopped = await note(page);
    assert.deepEqual([stopped.kind, stopped.act], ['warning', 'Load all again']);
    assert.match(stopped.body, /^[\d,]+ of 2,600 loaded\.$/);
    const kept = (await listed(page)).total;
    assert.ok(kept > 300, `kept the rows loaded so far (${kept})`);

    // Again, and this time open another page mid-sweep: the sweep yields, the page opens, no token is reused.
    await page.locator('#cp-toasts .cp-toast-act').click();
    await page.waitForFunction(() => parseInt((document.querySelector('.cp-sweep-n')?.textContent || '0').replace(/,/g, ''), 10) > 100, null, { timeout: 60000 });
    await page.evaluate(() => window.redirectPost('/commpilot/Group/Members/Modify/index.jsp', { userId: 'someone' }));
    await page.waitForFunction(() => /^User /.test(document.querySelector('td.screenName')?.textContent || ''), null, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('#cp-toasts .cp-toast-stays:not(.cp-toast-leaving)'), null, { timeout: 5000 });   // no button left for a page that is gone
    const posted = log.posts.length;
    await page.waitForTimeout(800);
    assert.equal(log.posts.length, posted, 'nothing more is sent after the page opened');
    assert.deepEqual(log.stale, []);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
