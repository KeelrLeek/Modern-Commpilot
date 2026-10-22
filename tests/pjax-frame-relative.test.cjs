const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const entry = '/commpilot/Reseller/Groups/Modify/index.jsp';
const shell = (marker, token) => `<!doctype html><html><body>
  <form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="${token}">
  <table><tr><td width="82%"><form name="mainForm"><div id="current">${marker}</div>
  <input name="description" value="Keep draft"></form></td></tr></table>
  <script>window.redirectPost=function(){};</script></body></html>`;

for (const [kind, target] of [['relative', '../../../Group/Profile/?tab=settings'],
  ['query', '?view=details'], ['absolute', '/commpilot/Group/Profile/?tab=settings'], ['response-redirect', '?view=details']])
test(`native frame resolves ${kind} redirect against its response page`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let server;
  try {
    const page = await browser.newPage(), requests = [], errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    const redirected = '/commpilot/Group/Profile/redirect.jsp';
    let origin, expected;
    const stub = `<html><body><input name="formtokenserial" value="token-1"><script>redirectPost('${target}',{key:'fixture-group'});</script><!--${'padding '.repeat(55)}--></body></html>`;
    // Use a local server for native HTTP redirects. Interception of only the initial
    // request cannot faithfully model the browser's subsequent redirect navigation.
    server = http.createServer(async (request, response) => {
      const url = new URL(request.url, origin);
      const send = (body, status = 200, headers = {}) => {
        response.writeHead(status, { 'content-type': 'text/html', ...headers }); response.end(body);
      };
      if (request.method !== 'POST') return send(kind === 'response-redirect' && url.pathname === redirected ? stub : shell('start', 'token-0'));
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push({ url: url.pathname + url.search, data: Object.fromEntries(new URLSearchParams(body)) });
      if (requests.length === 1) return kind === 'response-redirect' ? send('', 302, { location: redirected }) : send(stub);
      return send(shell(url.href === expected.href ? 'correct' : 'wrong-route', 'token-2'));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
    expected = new URL(target, origin + (kind === 'response-redirect' ? redirected : entry));
    await page.goto(origin + '/commpilot/Reseller/Profile/');
    await page.addScriptTag({ path: path.join(runtime, 'src/content/pjax.js') });
    await page.evaluate(entry => redirectPost(entry, { key: 'fixture-group' }), entry);
    await page.waitForFunction(() => document.querySelector('#current')?.textContent !== 'start');
    assert.deepEqual(requests.map(request => request.url), [entry, expected.pathname + expected.search]);
    assert.equal(await page.locator('#current').innerText(), 'correct');
    assert.deepEqual(requests.map(request => request.data.formtokenserial), ['token-0', 'token-1']);
    assert.deepEqual(requests.map(request => request.data.key), ['fixture-group', 'fixture-group']);
    assert.equal(await page.locator('iframe[name^=cpFrame], form[target^=cpFrame]').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
