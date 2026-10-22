const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const script = process.env.BW_TEST_PJAX_PATH || path.resolve(__dirname, '../src/content/pjax.js');
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';
const first = '/commpilot/User/Profile/';
const second = '/commpilot/User/DND/';
const third = '/commpilot/User/CallWaiting/';

function shell(url, token) {
  return `<!doctype html><html><head><title>Fixture</title></head><body>
    <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
    <table><tr><td width="82%" valign="top"><form name="mainForm" method="post">
    <input type="hidden" name="formtokenserial" value="${token}">
    <table><tr><td class="screenName">Fixture</td></tr><tr><td class="enduserbody">
    <div id="current">${url}</div><input name="description" value="My unsaved draft">
    <input type="submit" name="apply" value="Apply"></td></tr></table>
    </form></td></tr></table><script>window.redirectPost = window.redirectPost || function () {};</script>
    </body></html>`;
}

async function fixture(handler) {
  assert.ok(executablePath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const posts = [], requests = [], errors = [];
  let token = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    assert.equal(url.origin, origin, 'fixture must not contact external services');
    const data = new URLSearchParams(req.postData() || '');
    requests.push({ method: req.method(), url: url.pathname });
    if (req.method() === 'POST') {
      posts.push({ url: url.pathname, data: Object.fromEntries(data) });
      if (handler && await handler({ route, url: url.pathname, data, posts })) return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: shell(url.pathname, `token-${++token}`) });
  });
  await page.goto(origin + first);
  await page.addScriptTag({ path: script });
  return { page, posts, requests, errors, close: () => browser.close() };
}

async function navigate(page, url, params = {}) {
  await page.evaluate(({ url, params }) => window.redirectPost(url, params), { url, params });
}

for (const save of [false,true]) test(`a hung ${save?'save':'page read'} releases transport without replay or forced sign-in`,async()=>{
  let release,started;
  const held=new Promise(resolve=>{release=resolve});
  const began=new Promise(resolve=>{started=resolve});
  const f=await fixture(async({route,url,data})=>{
    if(url!==second&&!data.has('apply'))return;
    started();await held;await route.abort().catch(()=>{});return true;
  });
  try{
    await f.page.clock.install();
    if(save)await f.page.locator('input[name="apply"]').click({noWaitAfter:true});
    else await navigate(f.page,second);
    await began;
    await f.page.clock.runFor(91000);
    await f.page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cp-nav'),null,{timeout:1500});
    assert.equal(f.posts.length,1,'never replay a timed-out request automatically');
    assert.equal(f.requests.some(r=>/\/Login|\/servlet\/Login/.test(r.url)),false);
    assert.match(await f.page.locator('.cp-upload-notice').textContent(),save?/save.*not.*confirmed/i:/timed out|did not respond/i);
    assert.equal(await f.page.locator('input[name="description"]').inputValue(),'My unsaved draft');
    await navigate(f.page,third);
    await f.page.waitForFunction(url=>document.querySelector('#current')?.textContent===url,third);
    assert.deepEqual(f.errors,[]);
  }finally{release();await f.close();}
});

for (const failure of ['network', 403, 503, 'timeout']) {
  test(`a ${failure} session-refresh failure preserves the draft instead of forcing Login`, async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const f = await fixture(async ({ route }) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Navigation response interrupted</body></html>' });
      return true;
    });
    try {
      let harvests = 0;
      await f.page.route('**/commpilot/servlet/Login', async route => {
        harvests++;
        if (failure === 'timeout') { await held; await route.abort().catch(() => {}); }
        else if (failure === 'network') await route.abort('connectionreset');
        else await route.fulfill({ status: failure, body: 'Temporary refresh error' });
      });
      if (failure === 'timeout') await f.page.clock.install();
      await navigate(f.page, second);
      await f.page.waitForFunction(() => document.documentElement.hasAttribute('data-cp-nav'));
      if (failure === 'timeout') {
        await f.page.waitForTimeout(100);
        await f.page.clock.runFor(12500);
      }
      await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'), null, { timeout: 3000 });
      assert.equal(new URL(f.page.url()).pathname, first, 'a refresh failure does not establish session expiry');
      assert.match(await f.page.locator('.cp-upload-notice').textContent({ timeout: 1000 }), /check.*session|session.*check|refresh/i);
      assert.equal(await f.page.locator('input[name="description"]').inputValue(), 'My unsaved draft');
      assert.equal(harvests, 1);
      assert.equal(f.posts.length, 1, 'no automatic resend following an inconclusive session check');
      assert.deepEqual(f.errors, []);
    } finally { release(); await f.close(); }
  });
}

for (const supersede of [false, true]) {
  test(`a session refresh ${supersede ? 'drains before a newer click' : 'retries the original read'} with its rotated token`, async () => {
    let release, began;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { began = resolve; });
    const f = await fixture(async ({ route, posts, data }) => {
      if (posts.length === 1) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Incomplete read</body></html>' });
        return true;
      }
      if (data.get('formtokenserial') !== 'fresh-session-token') {
        await route.fulfill({ status: 500, body: 'Stale token reused' });
        return true;
      }
    });
    try {
      await f.page.route('**/commpilot/servlet/Login', async route => {
        began(); await held;
        await route.fulfill({ status: 200, contentType: 'text/html', body:
          '<input name="formtokenserial" value="fresh-session-token"><script>redirectPost("/commpilot/Common/folder_contents.jsp", {folder:"R0",menuId:"8"});</script>' });
      });
      await navigate(f.page, second);
      await started;
      if (supersede) await navigate(f.page, third);
      assert.equal(f.posts.length, 1, 'the session check must finish before another token-bearing request');
      release();
      await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, supersede ? third : second, { timeout: 4000 });
      assert.equal(f.posts.length, 2);
      assert.equal(f.posts[1].data.formtokenserial, 'fresh-session-token');
      assert.deepEqual(f.errors, []);
    } finally { release(); await f.close(); }
  });
}

test('a newer navigation waits for the older response and uses its rotated token without painting it', async () => {
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const f = await fixture(async ({ route, url, data }) => {
    if (url === second) {
      started();
      await held;
      await route.fulfill({ status: 200, contentType: 'text/html', body: shell(second, 'rotated-token') });
      return true;
    }
    if (url === third && data.get('formtokenserial') !== 'rotated-token') {
      await route.fulfill({ status: 500, body: 'Stale token was reused' });
      return true;
    }
  });
  try {
    await navigate(f.page, second);
    await began;
    await navigate(f.page, third);
    assert.equal(f.posts.length, 1, 'new navigation must wait for the token-bearing request');
    release();
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    assert.equal(f.posts.length, 2);
    assert.equal(f.posts[1].data.formtokenserial, 'rotated-token');
    assert.equal(await f.page.locator('#current').textContent(), third);
    assert.deepEqual(f.errors, []);
  } finally { release(); await f.close(); }
});

test('a failed Back replay does not make the next ordinary navigation replace history', async () => {
  let rejectBack = false;
  const f = await fixture(async ({ route, url }) => {
    if (rejectBack && url === first) { await route.fulfill({ status: 500, body: 'Temporary server error' }); return true; }
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, second);
    rejectBack = true;
    await f.page.goBack();
    await f.page.locator('.cp-alert').waitFor();
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    await f.page.evaluate(() => {
      window.newEntries = [];
      const push = history.pushState.bind(history);
      history.pushState = (state, title, url) => { window.newEntries.push(url); return push(state, title, url); };
    });
    rejectBack = false;
    await navigate(f.page, third);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, third);
    assert.deepEqual(await f.page.evaluate(() => window.newEntries), [third], 'the next click must create its own Back entry');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a failed Back replay leaves the address on the page still on screen, where its Apply posts', async () => {
  let rejectBack = false;
  const f = await fixture(async ({ route, url }) => {
    if (rejectBack && url === first) { await route.fulfill({ status: 500, body: 'Temporary server error' }); return true; }
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, second);
    const length = await f.page.evaluate(() => history.length);
    rejectBack = true;
    await f.page.goBack();
    await f.page.locator('.cp-alert').waitFor();
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    assert.deepEqual(await f.page.evaluate(() => [location.pathname, history.state.cpNav.url, history.length]), [second, second, length],
      'the address and its history entry describe the page still on screen');
    rejectBack = false;
    const saved = f.posts.length;
    await f.page.locator('input[name="apply"]').click();
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    assert.deepEqual(f.posts.slice(saved).map(post => [post.url, post.data.apply]), [[second, 'Apply']], 'Apply saves the page on screen');
    const back = f.posts.length;
    await f.page.goBack();
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, first);
    assert.deepEqual(f.posts.slice(back).map(post => post.url), [first], 'Back can still try the failed page again');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a cross-scope Back whose entry fails is not finished after the next click', async () => {
  const entry = '/commpilot/Group/Members/Modify/index.jsp', form = '/commpilot/User/Schedule/Add/';
  let rejectEntry = false;
  const f = await fixture(async ({ route, url }) => {
    if (rejectEntry && url === entry) { await route.fulfill({ status: 500, body: 'Temporary server error' }); return true; }
  });
  try {
    // An Add form has no recorded location chain, so Back re-enters its user before replaying it.
    for (const [url, params] of [[entry, { key: 'Fixture' }], [form, {}], ['/commpilot/Group/Profile/', {}]]) {
      await navigate(f.page, url, params);
      await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url && location.pathname === url, url);
    }
    rejectEntry = true;
    const before = f.posts.length;
    await f.page.goBack();
    await f.page.locator('.cp-alert').waitFor();
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    assert.deepEqual(f.posts.slice(before).map(post => post.url), [entry]);
    const clicked = f.posts.length;
    await navigate(f.page, third);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, third);
    await f.page.waitForTimeout(600);   // a chained follow-up is posted right after the swap
    assert.deepEqual(f.posts.slice(clicked).map(post => post.url), [third], 'the abandoned Back target is not posted');
    assert.equal(new URL(f.page.url()).pathname, third);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a cross-scope Back whose entry waits for an earlier request still reopens its page', async () => {
  const entry = '/commpilot/Group/Members/Modify/index.jsp', form = '/commpilot/User/Schedule/Add/';
  let release, started, hold = false;
  const held = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const f = await fixture(async ({ route, url }) => {
    if (!hold || url !== third) return;
    hold = false; started(); await held;
    await route.fulfill({ status: 200, contentType: 'text/html', body: shell(third, 'drained-token') });
    return true;
  });
  try {
    for (const [url, params] of [[entry, { key: 'Fixture' }], [form, {}], ['/commpilot/Group/Profile/', {}]]) {
      await navigate(f.page, url, params);
      await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url && location.pathname === url, url);
    }
    hold = true;
    await navigate(f.page, third);
    await began;
    const before = f.posts.length;
    await f.page.goBack();   // the entry drains behind the held request, then the form follows it
    release();
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url && location.pathname === url, form);
    assert.deepEqual(f.posts.slice(before).map(post => post.url), [entry, form]);
    assert.deepEqual(f.errors, []);
  } finally { release(); await f.close(); }
});

test('Forward during a delayed Back response uses the fresh token and preserves the history stack', async () => {
  let holdBack = false, release, started, token = 'token-1', issued = 0;
  const held = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const rejected = [];
  const f = await fixture(async ({ route, url, data }) => {
    if (data.get('formtokenserial') !== token) {
      rejected.push(url);
      await route.fulfill({ status: 500, body: 'Stale token' });
      return true;
    }
    token = `fresh-${++issued}`;
    if (holdBack && url === second) { started(); await held; }
    await route.fulfill({ status: 200, contentType: 'text/html', body: shell(url, token) });
    return true;
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, second);
    await navigate(f.page, third);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, third);
    const size = await f.page.evaluate(() => history.length);
    holdBack = true;
    await f.page.goBack();
    await began;
    await f.page.goForward();
    release();
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    assert.deepEqual(rejected, []);
    assert.equal(await f.page.locator('#current').textContent(), third);
    assert.equal(new URL(f.page.url()).pathname, third);
    assert.equal(await f.page.evaluate(() => history.length), size);
    holdBack = false;
    await f.page.goBack();
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, second);
    assert.deepEqual(f.errors, []);
  } finally { release(); await f.close(); }
});

test('a Back request that times out draining another navigation releases its history replay flag', async () => {
  let release, started, heldOnce = false;
  const held = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const f = await fixture(async ({ route, url }) => {
    if (url !== third || heldOnce) return;
    heldOnce = true; started(); await held;
    await route.fulfill({ status: 200, contentType: 'text/html', body: shell(third, 'drained-token') });
    return true;
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, second);
    await f.page.clock.install();
    await navigate(f.page, third);
    await began;
    await f.page.goBack();
    await f.page.clock.runFor(5400);
    assert.match(await f.page.locator('.cp-upload-notice').textContent(), /previous.*request.*still running/i);
    assert.equal(new URL(f.page.url()).pathname, second, 'the address returns to the page still on screen');
    release();
    await f.page.waitForFunction(() => document.querySelector('[name="formtokenserial"]').value === 'drained-token');
    await f.page.evaluate(() => {
      window.pushed = [];
      const push = history.pushState.bind(history);
      history.pushState = (state, title, url) => { pushed.push(url); return push(state, title, url); };
    });
    await navigate(f.page, third);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, third);
    assert.deepEqual(await f.page.evaluate(() => pushed), [third]);
    assert.deepEqual(f.errors, []);
  } finally { release(); await f.close(); }
});

for (const status of [400, 403, 404, 429]) {
  test(`HTTP ${status} preserves the current page without harvesting or forcing sign-in`, async () => {
    const f = await fixture(async ({ route }) => {
      await route.fulfill({ status, contentType: 'text/html', body: '<html><body>Request failed</body></html>' });
      return true;
    });
    try {
      await navigate(f.page, second);
      await f.page.waitForTimeout(800);
      assert.equal(new URL(f.page.url()).pathname, first);
      assert.equal(f.requests.some(request => /\/servlet\/Login|\/Login\//.test(request.url)), false);
      assert.equal(f.posts.length, 1);
      assert.match(await f.page.locator('.cp-alert').textContent({ timeout: 1500 }), new RegExp(`HTTP ${status}`));
      assert.equal(await f.page.locator('input[name="description"]').inputValue(), 'My unsaved draft');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

test('repeated server errors do not claim the session expired or offer a forced login', async () => {
  const f = await fixture(async ({ route }) => {
    await route.fulfill({ status: 503, body: 'Service temporarily unavailable' });
    return true;
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    await navigate(f.page, third);
    await f.page.waitForFunction(() => !document.documentElement.hasAttribute('data-cp-nav'));
    const text = await f.page.locator('.cp-alert').last().textContent();
    assert.doesNotMatch(text, /session expired|sign in/i);
    assert.match(text, /HTTP 503/);
    assert.equal(await f.page.locator('#current').textContent(), first);
    assert.equal(f.posts.length, 2);
  } finally { await f.close(); }
});

test('an explicit HTTP 401 still opens sign-in without replaying the rejected request', async () => {
  const f = await fixture(async ({ route }) => {
    await route.fulfill({ status: 401, body: 'Authentication required' });
    return true;
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForURL('**/commpilot/Login/');
    assert.equal(f.posts.length, 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const mode of ['network', 'missing-content']) {
  test(`an accepted save with a ${mode} response failure is not automatically replayed`, async () => {
    let saves = 0;
    const f = await fixture(async ({ route, data }) => {
      if (!data.has('apply')) return;
      saves++; // The server applied the request, but its response cannot be confirmed.
      if (mode === 'network') await route.abort('connectionreset');
      else await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Response interrupted</body></html>' });
      return true;
    });
    try {
      await navigate(f.page, first, { apply: 'Apply', description: 'Save once' });
      await f.page.waitForTimeout(900); // Includes the existing delayed automatic retry window.
      assert.equal(saves, 1, 'a lost response does not prove that a write failed at the server');
      assert.equal(new URL(f.page.url()).pathname, first, 'an uncertain save must not force a login navigation');
      assert.equal(f.requests.some(request => request.url === '/commpilot/servlet/Login'), false, 'do not harvest a token to resend a write');
      assert.match(await f.page.locator('.cp-upload-notice').textContent({ timeout: 2000 }), /not.*confirmed|could not.*confirm/i);
      assert.equal(await f.page.locator('input[name="description"]').inputValue(), 'My unsaved draft');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

test('a read-only navigation still retries one transient network failure and commits once', async () => {
  let attempts = 0;
  const f = await fixture(async ({ route, url }) => {
    if (url === second && ++attempts === 1) { await route.abort('connectionreset'); return true; }
  });
  try {
    const length = await f.page.evaluate(() => history.length);
    await navigate(f.page, second);
    await f.page.waitForFunction(url => document.querySelector('#current')?.textContent === url, second);
    assert.equal(attempts, 2);
    assert.equal(await f.page.evaluate(() => history.length), length + 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
for (const mode of ['retry-incomplete', 'check-incomplete']) test(`an incomplete ${mode} response does not establish session expiry`, async () => {
  const f = await fixture(async ({ route }) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Incomplete application response</body></html>' });
    return true;
  });
  try {
    let checks = 0;
    await f.page.route('**/commpilot/servlet/Login', async route => {
      checks++;
      const body = mode === 'retry-incomplete' ? '<html><body><input name="formtokenserial" value="fresh-check"><script>redirectPost("/commpilot/Common/folder_contents.jsp", {folder:"U0",menuId:"14"});</script></body></html>' :
        '<html><body>Temporary application response unavailable</body></html>';
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await navigate(f.page, second);
    await f.page.waitForTimeout(1200);
    assert.equal(new URL(f.page.url()).pathname, first, 'incomplete HTML is not proof that the session expired');
    assert.equal(await f.page.locator('input[name="description"]').inputValue(), 'My unsaved draft');
    assert.equal(f.requests.some(request => request.url === '/commpilot/Login/'), false);
    assert.equal(checks, 1);
    assert.equal(f.posts.length, mode === 'retry-incomplete' ? 2 : 1);
    assert.match(await f.page.locator('.cp-upload-notice').innerText(), /could not|unavailable|usable|incomplete/i);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});


test('ordinary authenticated page text quoting a login instruction is not an expiry response', async () => {
  const f = await fixture(async ({ route, url }) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: shell(url, 'quote-token')
      .replace('<div id="current">', '<p>Help text: Please login again after changing your credentials.</p><div id="current">') });
    return true;
  });
  try {
    await navigate(f.page, second);
    await f.page.waitForTimeout(1200);
    assert.equal(new URL(f.page.url()).pathname, second);
    assert.equal(f.requests.some(request => /\/(?:servlet\/)?Login/.test(request.url)), false,
      'valid application content is not session-expiry evidence');
    assert.equal(await f.page.locator('#current').innerText(), second);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
