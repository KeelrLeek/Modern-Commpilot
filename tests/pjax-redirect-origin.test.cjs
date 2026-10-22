const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
const runtime = process.env.BW_TEST_EXTENSION_PATH || path.resolve(__dirname, '..');
const origin = 'https://apps-sbx.avpaas.io';
const shell = marker => `<html><body><form name="leftNavForm"><a class="leftnavfolderopen">Profile</a></form>
  <input name="formtokenserial" value="fixture-token"><table><tr><td width="82%"><form name="mainForm">
  <p id="marker">${marker}</p><input name="description" value="Preserve draft"></form></td></tr></table>
  <script>window.redirectPost=window.redirectPost||function(){};</script></body></html>`;

for (const [kind, redirect] of [
  ['cross-origin', 'https://other.invalid/commpilot/Group/Profile/'],
  ['credential-bearing', 'https://fixture-user:fixture-pass@apps-sbx.avpaas.io/commpilot/Group/Profile/']
]) for (const transport of ['fetch', 'frame']) test(`${transport} rejects a ${kind} native redirect before forwarding its token`, async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page=await browser.newPage(), requests=[];
    const target=transport==='frame'?'/commpilot/Reseller/Groups/Modify/index.jsp':'/commpilot/User/DND/';
    await page.route('**/*', route=>{
      const req=route.request(), url=new URL(req.url());
      if(req.method()==='POST') requests.push({origin:url.origin,path:url.pathname});
      if(url.pathname===target) return route.fulfill({contentType:'text/html',body:
        '<html><body><input name="formtokenserial" value="redirect-token"><script>redirectPost('+JSON.stringify(redirect)+',{key:"fixture"});</script></body></html>'});
      return route.fulfill({contentType:'text/html',body:shell(url.pathname==='/commpilot/User/Profile/'?'original':'unexpected destination')});
    });
    await page.goto(origin+'/commpilot/User/Profile/');
    await page.addScriptTag({path:path.join(runtime,'src/content/pjax.js')});
    await page.evaluate(target=>redirectPost(target,{}),target);
    await page.waitForTimeout(900);
    assert.deepEqual(requests,[{origin,path:target}], 'do not forward credentials or tokens, or reinterpret an unsafe target locally');
    assert.equal(await page.locator('#marker').innerText(),'original');
    assert.equal(await page.locator('[name=formtokenserial]').inputValue(),'redirect-token','retain the newly issued token even when rejecting its destination');
    assert.match(await page.locator('.cp-upload-notice').innerText(),/address|origin|redirect/i);
    assert.equal(await page.locator('[name=description]').inputValue(),'Preserve draft');
  } finally {await browser.close();}
});
