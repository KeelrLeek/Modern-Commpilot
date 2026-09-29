const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const origin = 'https://apps-sbx.avpaas.io';
const folderPath = '/commpilot/Common/folder_contents.jsp';

// A reseller's menu board: three sidebar folders, one CommPilot has but the extension has no icon for.
const folders = [['Profile', 'R0'], ['Incoming Calls', 'R1'], ['Voice Portal Extras', 'R2']];
const menu = `<table width="100%"><tbody><tr><td width="50%" valign="TOP"><table width="100%"><tbody>
  <tr><td class="menuCategory">Basic</td></tr>
  <tr><td><a class="navMenuItem" onclick="redirectPost('/commpilot/User/Profile/', {})">Profile</a></td></tr><tr><td>About it.</td></tr>
  </tbody></table></td></tr></tbody></table>`;
function shell(token) {
  return `<!doctype html><html><head><title>Reseller</title></head><body id="initBody.menuTemplate">
    <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
    <table height="100%"><tr><td class="headandfoot" width="18%"><form name="leftNavForm">
      ${folders.map(([name, id], i) => `<a class="${i ? 'leftnavfolder' : 'leftnavfolderopen'}" onclick="redirectPost('${folderPath}', {folder:'${id}', menuId:'8'})">${name}</a>`).join('')}
    </form></td><td width="82%" valign="top" style="width:1000px">${menu}</td></tr></table>
    <input type="hidden" name="formtokenserial" value="${token}">
    <script>window.redirectPost=function(){};</script>
  </body></html>`;
}

test('each menu board section header shows its folder’s sidebar icon in the palette accent', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let serial = 1;
    const icons = [];
    await page.route(origin + '/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith('/ext/')) {
        icons.push(path.basename(pathname));
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, pathname.slice(5))) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell('token-' + (++serial)) });
    });
    await page.goto(origin + folderPath, { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css'])
      await page.addStyleTag({ path: path.join(root, 'src/content', file) });
    await page.evaluate(origin => {
      document.documentElement.dataset.cpDirection = 'terra';
      window.chrome = Object.assign(window.chrome || {}, { runtime: { getURL: p => origin + '/ext/' + p } });
    }, origin);
    await page.addScriptTag({ path: path.join(root, 'src/content/native-theme.js') });
    await page.addScriptTag({ path: path.join(root, 'src/content/pjax.js') });
    await page.waitForFunction(() => document.querySelectorAll('.cp-console-section .cp-console-head-ico').length === 3);

    const heads = await page.evaluate(() => [...document.querySelectorAll('.cp-console-section')].map(section => {
      const ico = section.querySelector('.cp-console-head-ico');
      const style = getComputedStyle(ico);
      return { name: section.querySelector('.cp-console-head-name').textContent,
        icon: (style.maskImage || style.webkitMaskImage).match(/palette-([\w-]+)\.svg/)?.[1],
        size: [style.width, style.height], radius: style.borderRadius,
        color: style.backgroundColor, accent: getComputedStyle(document.body).getPropertyValue('--d-accent').trim() };
    }));
    assert.deepEqual(heads.map(h => [h.name, h.icon]),
      [['Profile', 'profile'], ['Incoming Calls', 'incoming-calls'], ['Voice Portal Extras', 'unknown']],
      'the same icon as the sidebar, and the sidebar’s fallback for a folder without one');
    for (const head of heads) {
      assert.deepEqual(head.size, ['21px', '21px'], `${head.name} icon size`);
      assert.equal(head.radius, '0px', 'an icon, not the old dot');
    }
    const accent = await page.evaluate(value => { const probe = document.createElement('i'); probe.style.color = value;
      document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, heads[0].accent);
    assert.equal(heads[0].color, accent, 'drawn in the palette accent');
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => /palette-incoming-calls\.svg$/.test(e.name)));
    assert.ok(icons.includes('palette-incoming-calls.svg'), `icon files load: ${icons}`);
  } finally { await browser.close(); }
});
