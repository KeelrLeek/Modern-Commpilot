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
const about = 'Call Forwarding Always allows you to forward all your incoming calls to a different phone number or SIP-URI, ' +
  'such as your home office or cell phone. You can also make your primary phone emit a short ring burst to inform you ' +
  'if you are next to your phone when the call is forwarded by using the Ring Reminder.';

// A user's service page as CommPilot frames it (trimmed): the sidebar with its open folder, then title, description,
// the action bar above and its copy below, and the content.
const page = `<!doctype html><html data-cp-direction="graphite"><head><title>Call Forwarding Always</title></head>
  <body id="initBody.menuTemplate"><table height="100%"><tbody><tr>
  <td class="headandfoot" width="18%"><form name="leftNavForm"><a class="leftnavfolder">Profile</a>
    <a class="leftnavfolderopen">Incoming Calls</a></form></td>
  <td width="82%" valign="top"><form name="mainForm" method="post"><input type="hidden" name="formtokenserial" value="t1">
  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>
  <tr><td height="10"></td></tr>
  <tr><td class="screenName">Call Forwarding Always</td></tr>
  <tr><td height="5"></td></tr>
  <tr><td class="tip">${about}</td></tr>
  <tr><td height="5"></td></tr>
  <tr id="buttonbartop"><td class="buttonbar"><input type="submit" name="ok" value="OK"> <input type="submit" name="apply" value="Apply">
    <input type="submit" name="delete" value="Delete"> <input type="button" name="cancel" value="Cancel"></td></tr>
  <tr><td class="enduserbody"><table class="enduserbody"><tbody><tr><td>Calls Forward to phone number / SIP-URI:</td>
    <td><input type="text" name="forwardedToNumber"></td></tr></tbody></table></td></tr>
  <tr id="buttonbarbottom"><td class="buttonbar"><input type="submit" name="ok" value="OK"></td></tr>
  </tbody></table></form></td></tr></tbody></table></body></html>`;

test('the page header: folder icon, title and buttons over an accent underline, the description behind an info button', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await tab.route(origin + '/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith('/ext/'))
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, pathname.slice(5))) });
      return route.fulfill({ status: 200, contentType: 'text/html', body: page });
    });
    await tab.goto(origin + '/commpilot/User/CF/Always/', { waitUntil: 'domcontentloaded' });
    for (const file of ['native-theme.css', 'theme-palettes.css', 'page-baseline.css', 'forms.css'])
      await tab.addStyleTag({ path: path.join(root, 'src/content', file) });
    await tab.evaluate(origin => { window.chrome = Object.assign(window.chrome || {}, { runtime: { getURL: p => origin + '/ext/' + p } }); }, origin);
    await tab.addScriptTag({ path: path.join(root, 'src/content/native-theme.js') });
    await tab.addScriptTag({ path: path.join(root, 'src/content/forms.js') });
    await tab.locator('.cp-frame-head').waitFor();

    // The header: the open folder's icon in the accent, the title, the buttons, and the board's accent underline.
    const head = await tab.evaluate(() => {
      const head = document.querySelector('.cp-frame-head');
      const icon = head.querySelector('.cp-frame-ico');
      const line = getComputedStyle(head, '::after');
      const accent = getComputedStyle(document.body).getPropertyValue('--d-accent').trim();
      const probe = document.createElement('i'); probe.style.color = accent; document.body.append(probe);
      const accentRgb = getComputedStyle(probe).color; probe.remove();
      return { order: [...head.children].map(el => el.className), folder: icon.dataset.cpName,
        icon: getComputedStyle(icon).maskImage.match(/palette-([\w-]+)\.svg/)?.[1], iconColor: getComputedStyle(icon).backgroundColor,
        underline: [line.width, line.height, line.backgroundColor], divider: getComputedStyle(head).borderBottomWidth, accentRgb,
        sticky: getComputedStyle(head.closest('td')).position };
    });
    assert.deepEqual(head.order, ['cp-frame-ico', 'cp-frame-title', 'cp-frame-actions']);
    assert.equal(head.folder, 'incoming calls');
    assert.equal(head.icon, 'incoming-calls', 'the same icon as the folder in the sidebar');
    assert.equal(head.iconColor, head.accentRgb);
    assert.deepEqual(head.underline, ['124px', '2px', head.accentRgb], 'the menu board’s accent underline');
    assert.equal(head.divider, '1px');
    assert.equal(head.sticky, 'sticky', 'the header stays in reach while the page scrolls');

    // The description is behind the info button: the content starts right under the header.
    const info = tab.getByRole('button', { name: 'About this page' });
    const card = tab.locator('#cp-frame-about');
    assert.equal(await card.isVisible(), false);
    const size = await info.evaluate(b => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]);
    assert.deepEqual(size, [23, 23], 'the info button is the board’s count chip in size');
    const glyph = await info.evaluate(b => {
      const r = b.getBoundingClientRect(), svg = b.querySelector('svg'), s = svg.getBoundingClientRect(), g = svg.querySelector('path').getBBox();
      return { rings: svg.querySelectorAll('circle').length, dx: (s.left + g.x + g.width / 2) - (r.left + r.width / 2),
        dy: (s.top + g.y + g.height / 2) - (r.top + r.height / 2) };
    });
    assert.equal(glyph.rings, 0, 'one ring: the button’s own outline');
    assert.ok(Math.abs(glyph.dx) <= 0.25 && Math.abs(glyph.dy) <= 0.25, `the i sits in the middle of the circle (${glyph.dx}, ${glyph.dy})`);
    // Icon, title, info button and the page's buttons share one centre line; the header is a board header's height.
    const line = await tab.evaluate(() => {
      const mid = el => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
      const text = document.createRange(); text.selectNodeContents(document.querySelector('.cp-frame-title').firstChild);
      const t = text.getBoundingClientRect();
      return { centres: ['.cp-frame-ico', '.cp-frame-info', '.cp-frame-actions'].map(s => mid(document.querySelector(s)) - (t.top + t.bottom) / 2),
        gaps: [t.left - document.querySelector('.cp-frame-ico').getBoundingClientRect().right,
          document.querySelector('.cp-frame-info').getBoundingClientRect().left - t.right],
        height: document.querySelector('.cp-frame-head').getBoundingClientRect().height };
    });
    assert.ok(line.centres.every(d => Math.abs(d) <= 1), `one centre line (${line.centres})`);
    assert.equal(line.height, 54);
    assert.ok(Math.abs(line.gaps[0] - 11) <= 0.5 && Math.abs(line.gaps[1] - 12) <= 0.5, `the board header’s spacing (${line.gaps})`);
    assert.equal(await tab.locator('tr:has(> td.tip)').isVisible(), false, 'no description row above the content');
    const gap = await tab.evaluate(() => document.querySelector('td.cp-frame-body').getBoundingClientRect().top -
      document.querySelector('.cp-frame-head').getBoundingClientRect().bottom);
    assert.ok(gap >= 10 && gap <= 20, `the content starts right under the header (${gap}px)`);
    await info.click();
    assert.equal(await card.isVisible(), true);
    assert.equal((await card.textContent()).trim(), about);
    assert.equal(await info.getAttribute('aria-expanded'), 'true');
    const box = await tab.evaluate(() => {
      const c = document.getElementById('cp-frame-about').getBoundingClientRect();
      const t = document.querySelector('.cp-frame-title').getBoundingClientRect();
      const hit = document.elementFromPoint(c.left + 20, c.top + 20);
      return { below: c.top >= t.bottom, inView: c.right <= innerWidth && c.bottom <= innerHeight, onTop: !!hit?.closest('#cp-frame-about') };
    });
    assert.deepEqual(box, { below: true, inView: true, onTop: true }, 'the card opens below the title, over the content');
    await tab.keyboard.press('Escape');
    assert.equal(await card.isVisible(), false, 'Escape closes it');
    assert.equal(await tab.evaluate(() => document.activeElement.classList.contains('cp-frame-info')), true, 'and returns to the button');
    await info.click();
    await tab.mouse.click(1300, 700);
    assert.equal(await card.isVisible(), false, 'a click elsewhere closes it');

    // The buttons: CommPilot's order, Delete apart on the left in red, Cancel quiet, Apply still the filled one.
    const buttons = await tab.evaluate(() => {
      const style = name => getComputedStyle(document.querySelector(`.cp-frame-actions input[name="${name}"]`));
      const x = name => document.querySelector(`.cp-frame-actions input[name="${name}"]`).getBoundingClientRect().left;
      const probe = document.createElement('i'); probe.style.color = getComputedStyle(document.body).getPropertyValue('--d-off').trim();
      document.body.append(probe); const red = getComputedStyle(probe).color; probe.remove();
      return { left: ['delete', 'ok', 'apply', 'cancel'].map(x).every((v, i, all) => i === 0 || v > all[i - 1]),
        deleteColor: style('delete').color, red, deleteBg: style('delete').backgroundColor,
        cancel: [style('cancel').backgroundColor, style('cancel').borderTopColor], apply: style('apply').backgroundColor,
        ok: style('ok').backgroundColor };
    });
    assert.equal(buttons.left, true, 'Delete, then OK, Apply, Cancel');
    assert.equal(buttons.deleteColor, buttons.red, 'Delete in the palette’s red');
    assert.equal(buttons.deleteBg, 'rgba(0, 0, 0, 0)');
    assert.deepEqual(buttons.cancel, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], 'Cancel is a quiet text button');
    assert.notEqual(buttons.apply, buttons.ok, 'Apply stays filled');
    assert.equal(await tab.evaluate(() => document.forms.mainForm.contains(document.querySelector('.cp-frame-actions input[name="delete"]'))), true);
  } finally { await browser.close(); }
});

// A reseller's menu board with one folder, for measuring its section header beside a page header.
const board = `<!doctype html><html data-cp-direction="graphite"><head><title>Reseller</title></head><body id="initBody.menuTemplate">
  <table><tr><td class="headerBar"><span class="headerAuthLevel">Reseller</span></td></tr></table>
  <table height="100%"><tr><td class="headandfoot" width="18%"><form name="leftNavForm">
    <a class="leftnavfolderopen" onclick="redirectPost('/commpilot/Common/folder_contents.jsp', {folder:'R0', menuId:'8'})">Profile</a>
  </form></td><td width="82%" valign="top"><table width="100%"><tbody><tr><td width="50%" valign="TOP"><table width="100%"><tbody>
    <tr><td class="menuCategory">Basic</td></tr>
    <tr><td><a class="navMenuItem" onclick="redirectPost('/commpilot/Reseller/Profile/', {})">Profile</a></td></tr><tr><td>About it.</td></tr>
  </tbody></table></td></tr></tbody></table></td></tr></table>
  <input type="hidden" name="formtokenserial" value="t1"><script>window.redirectPost=function(){};</script></body></html>`;

test('a page header measures the same as a menu board section header, at every window width', async () => {
  assert.ok(browserPath, 'Edge or Chrome is required');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const width of [1280, 1920]) {
      const measure = async (html, script, sel) => {
        const tab = await browser.newPage({ viewport: { width, height: 900 } });
        await tab.route(origin + '/**', route => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname.startsWith('/ext/'))
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, pathname.slice(5))) });
          return route.fulfill({ status: 200, contentType: 'text/html', body: html });
        });
        await tab.goto(origin + '/commpilot/Common/folder_contents.jsp', { waitUntil: 'domcontentloaded' });
        for (const file of ['native-theme.css', 'theme-palettes.css', 'menu-board.css', 'page-baseline.css', 'forms.css'])
          await tab.addStyleTag({ path: path.join(root, 'src/content', file) });
        await tab.evaluate(origin => { window.chrome = Object.assign(window.chrome || {}, { runtime: { getURL: p => origin + '/ext/' + p } }); }, origin);
        await tab.addScriptTag({ path: path.join(root, 'src/content/native-theme.js') });
        await tab.addScriptTag({ path: path.join(root, 'src/content', script) });
        await tab.locator(sel.head).first().waitFor();
        await tab.waitForTimeout(300);
        await tab.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));   // the board's reveal
        const m = await tab.evaluate(sel => {
          // The board's count chip fills in with a folder's option count; its size is the stylesheet's alone.
          const count = document.querySelector('.cp-console-count');
          if (count?.hidden) { count.hidden = false; count.textContent = '1'; }
          const cell = document.querySelector('td[width="82%"][valign="top"]').getBoundingClientRect();
          const at = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left - cell.left), Math.round(r.top - cell.top), Math.round(r.width), Math.round(r.height)]; };
          const q = s => document.querySelector(s);
          const name = q(sel.name), range = document.createRange(); range.selectNodeContents(name.firstChild);
          const t = range.getBoundingClientRect(), f = getComputedStyle(name), chip = getComputedStyle(q(sel.chip));
          return { head: at(q(sel.head)), icon: at(q(sel.icon)), title: [Math.round(t.left - cell.left), Math.round(t.top - cell.top)],
            type: [f.fontSize, f.fontWeight, f.lineHeight, f.letterSpacing], chip: [Math.round(q(sel.chip).getBoundingClientRect().height), chip.borderRadius,
              chip.borderTopWidth, chip.backgroundColor], underline: getComputedStyle(q(sel.head), '::after').width };
        }, sel);
        await tab.close();
        return m;
      };
      const boardHead = await measure(board, 'pjax.js', { head: '.cp-console-head', icon: '.cp-console-head-ico', name: '.cp-console-head-name', chip: '.cp-console-count' });
      const pageHead = await measure(page, 'forms.js', { head: '.cp-frame-head', icon: '.cp-frame-ico', name: '.cp-frame-title', chip: '.cp-frame-info' });
      assert.deepEqual(pageHead.head.slice(0, 2), boardHead.head.slice(0, 2), `${width}px: the header starts in the same place`);
      assert.equal(pageHead.head[3], boardHead.head[3], `${width}px: the same height`);
      assert.deepEqual(pageHead.icon, boardHead.icon, `${width}px: the same icon box`);
      assert.deepEqual(pageHead.title, boardHead.title, `${width}px: the title starts in the same place`);
      assert.deepEqual(pageHead.type, boardHead.type, `${width}px: the same title type`);
      assert.deepEqual(pageHead.chip, boardHead.chip, `${width}px: the info button is the count chip`);
      assert.equal(pageHead.underline, boardHead.underline);
    }
  } finally { await browser.close(); }
});
