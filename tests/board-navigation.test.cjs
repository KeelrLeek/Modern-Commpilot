const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const extension = path.resolve(process.env.BW_EXTENSION_ROOT || path.join(__dirname, '..'));
const origin = 'https://apps-sbx.avpaas.io';
const folderPath = '/commpilot/Common/folder_contents.jsp';
const peekPath = '/commpilot/Reseller/CallNotify/';
const folders = [['R0', 'Profile'], ['R1', 'Resources'], ['R2', 'Services'], ['R3', 'Utilities']];
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Exercise every manifest script and stylesheet in CommPilot's complete two-column shell, including
// late Peek replies during native smooth scrolling. Smaller board fixtures miss that interaction.
function html(folder, option, token, counts, peek, leaf = false) {
  const menu = `<table width="100%"><tr><td valign="TOP"><table width="100%"><tr><td class="menuCategory">Basic</td></tr>${Array.from({length:counts[folder]}, (_, i) =>
    peek && folder === 'R0' && i === counts[folder] - 1 ?
      `<tr><td><a class="navMenuItem" name="/Reseller/CallNotify/" onclick="redirectPost('${peekPath}',{})">Call Notify</a></td></tr><tr><td>Notification settings.</td></tr>` :
      `<tr><td><a class="navMenuItem" name="/Reseller/${folder}/${i}/" onclick="redirectPost('/commpilot/Reseller/${folder}/${i}/',{})">${folder} option ${i}</a></td></tr><tr><td>About this option.</td></tr>`).join('')}</table></td></tr></table>`;
  return `<!doctype html><html><head><title>${option ? 'Option' : 'Profile'}</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td><td class="headerBar"><a class="headerLink">Help</a><a class="headerLink">Home</a></td></tr></table>
    <table width="100%" height="100%"><tbody><tr><td width="18%" valign="top" class="headandfoot"><form name="leftNavForm"><b><table width="100%"><tr><td class="navOptions">Options:</td></tr>${folders.map(([id, name]) => {
      const cls = id === folder ? 'leftnavfolderopen' : 'leftnavfolder';
      return `<tr><td class="${cls}"><a class="${cls}" onclick="redirectPost('${folderPath}',{folder:'${id}',menuId:'8'})">${name}</a></td></tr>`;
    }).join('')}</table></b></form></td><td width="82%" valign="top">${option ?
      `<form name="mainForm"><table><tr><td class="screenName">Option</td></tr></table>${leaf ? '<input type="text" name="defaultFromEmailAddress" value="test@example.net">' : ''}</form>` : menu}</td></tr></tbody></table>
    <input type="hidden" name="formtokenserial" value="${token}"><script>window.redirectPost=function(){window.nativeFallbacks=(window.nativeFallbacks||0)+1;};</script></body></html>`;
}

async function fixture({counts = {R0:9,R1:9,R2:9,R3:9}, peek = false} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-board-nav-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath:edge, headless:true, viewport:{width:1280,height:800},
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  let releasePeek, peekRequested = false;
  const peekReady = new Promise(resolve => { releasePeek = resolve; });
  const close = async () => { releasePeek(); await context.close(); fs.rmSync(profile,{recursive:true,force:true}); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(peek => chrome.storage.local.set({cpThemePalette:'graphite',cpSettings:{peek,side:'rail'}}), peek);
    let serial = 0;
    await context.route(origin + '/**', async route => {
      const request = route.request();
      if (request.resourceType() === 'image') return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
      const pathname = new URL(request.url()).pathname;
      const leaf = pathname === peekPath;
      if (leaf) { peekRequested = true; await peekReady; }
      const folder = new URLSearchParams(request.postData() || '').get('folder') || 'R0';
      if (request.method() === 'POST' && pathname === folderPath) await new Promise(r => setTimeout(r,100));
      return route.fulfill({status:200,contentType:'text/html',body:html(folder,pathname !== folderPath,'token-' + ++serial,counts,peek,leaf)});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Record competing direct scroll writes as well as smooth-scroll requests for failure diagnostics.
    await page.addInitScript(() => {
      window.jumps = [];
      const scrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (...args) {
        if (this.matches('.cp-console')) window.jumps.push({from:this.scrollTop,args,height:this.clientHeight,scrollHeight:this.scrollHeight});
        return scrollTo.apply(this,args);
      };
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
      Object.defineProperty(Element.prototype,'scrollTop',{...descriptor,set(value) {
        if (this.matches('.cp-console')) window.jumps.push({write:value,from:descriptor.get.call(this),stack:new Error().stack.split('\n').slice(1,4)});
        return descriptor.set.call(this,value);
      }});
    });
    const sidebar = id => page.locator(`form[name="leftNavForm"] a[data-cp-folder="${id}"]`);
    const loaded = () => page.waitForFunction(() => document.querySelectorAll('.cp-console-body[data-cp-loaded="1"]').length === 4);
    await page.goto(origin + (peek ? '/commpilot/Reseller/Test/' : folderPath));
    // Enter through Resources so a late Peek reply previously re-pinned that OLD section.
    if (peek) await page.locator('form[name="leftNavForm"] a',{hasText:'Resources'}).click();
    await loaded();
    await page.waitForTimeout(800);
    return {page,sidebar,loaded,errors,close,releasePeek,peekRequested:() => peekRequested};
  } catch (error) { await close(); throw error; }
}

async function atSection(page, id, t) {
  try {
    await page.waitForFunction(id => {
      const board = document.querySelector('.cp-console');
      const section = board?.querySelector(`[data-cp-folder="${id}"]`);
      return section && Math.abs(section.getBoundingClientRect().top - board.getBoundingClientRect().top) < 4;
    }, id, {timeout:2500});
  } catch (error) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({classes:document.documentElement.className,jumps:window.jumps,scroll:document.querySelector('.cp-console')?.scrollTop}))));
    throw error;
  }
}

for (const mixed of [false,true]) test(`installed sidebar survives rapid clicks and repeated Back with ${mixed ? 'mixed' : 'tall'} sections`, async t => {
  const f = await fixture(mixed ? {counts:{R0:1,R1:2,R2:13,R3:1}} : {});
  try {
    for (let i = 0; i < 12; i++) {
      await f.sidebar(['R3','R0','R2','R1'][i % 4]).evaluate(a => a.click());
      await f.page.waitForTimeout(35);
    }
    for (let round = 0; round < 2; round++) {
      for (const id of ['R3','R0','R2','R1','R3','R2']) { await f.sidebar(id).click(); await atSection(f.page,id,t); }
      await f.page.locator('.cp-console-section[data-cp-folder="R2"] a.navMenuItem').first().click();
      await f.page.waitForFunction(() => !document.querySelector('.cp-console'));
      await f.page.goBack();
      await f.loaded();
      await f.page.waitForTimeout(700);
    }
    assert.deepEqual(f.errors,[]);
  } finally { await f.close(); }
});

test('a late Peek response cannot cancel a newer sidebar scroll', async t => {
  const f = await fixture({peek:true});
  try {
    assert.equal(f.peekRequested(),true,'a Peek read is waiting above the current section');
    await f.sidebar('R0').click();
    await f.page.waitForTimeout(50); // release the response during the upward smooth scroll
    f.releasePeek();
    await f.page.locator('.cp-leaf-defpill').waitFor({state:'attached',timeout:5000});
    await atSection(f.page,'R0',t);
    await f.sidebar('R3').click();
    await atSection(f.page,'R3',t);
    assert.deepEqual(f.errors,[]);
  } finally { await f.close(); }
});

test('a late Peek response leaves manual scrolling alone', async () => {
  const f = await fixture({peek:true});
  try {
    assert.equal(f.peekRequested(),true);
    const before = await f.page.locator('.cp-console').evaluate(el => el.scrollTop);
    const rect = await f.page.locator('.cp-console').boundingBox();
    await f.page.mouse.move(rect.x + rect.width / 2,rect.y + 80);
    await f.page.mouse.wheel(0,-64);
    await f.page.waitForFunction(before => document.querySelector('.cp-console').scrollTop < before - 30,before);
    const manual = await f.page.locator('.cp-console').evaluate(el => el.scrollTop);
    f.releasePeek();
    await f.page.locator('.cp-leaf-defpill').waitFor({state:'attached',timeout:5000});
    await f.page.waitForTimeout(350);
    const after = await f.page.locator('.cp-console').evaluate(el => el.scrollTop);
    assert.ok(Math.abs(after - manual) <= 2,`late Peek moved a manual scroll from ${manual} to ${after}`);
    assert.deepEqual(f.errors,[]);
  } finally { await f.close(); }
});
