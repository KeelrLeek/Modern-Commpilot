const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const chromePath = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(fs.existsSync);
const pjaxPath = path.resolve(__dirname, '../src/content/pjax.js');

function shell(title, content, token) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <form name="leftNavForm"><a class="leftnavfolder" href="#">Profile</a></form>
    <input name="formtokenserial" value="${token}">
    <table><tr><td width="82%">${content}</td></tr></table></body></html>`;
}

test('native Schedules list opens events over the list and keeps Add/Edit in PJAX', async () => {
  assert.ok(chromePath, 'Set CHROME_PATH to Chrome or Edge');
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const listPath = '/commpilot/ServiceProvider/Schedules/';
    const modifyPath = '/commpilot/ServiceProvider/Schedules/Modify/index.jsp';
    const eventPath = '/commpilot/ServiceProvider/Schedules/Events/Modify/index.jsp';
    const addPath = '/commpilot/ServiceProvider/Schedules/Events/Add/index.jsp';
    const list = shell('Schedules', `<table><tr id="Row1"><td><a class="tableLink">Test</a>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('Row1Col0')?.addEventListener('click', function () {
          redirectPost('${modifyPath}', { name: 'Time', key: 'Test' });
        });
      });</script></td>
      <td><a class="tableLink">Time</a></td><td><a>Edit</a></td></tr></table>`, 'tok-1');
    const modify = shell('Schedule Modify', `<table><tr id="Row1"><td><a class="tableLink">Holiday</a>
      <script>document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('Row1Col0')?.addEventListener('click', function () {
          redirectPost('${eventPath}', { name: 'Time', key: 'Test', eventName: 'Holiday' });
        });
      });</script>
      </td><td><a>Edit</a></td></tr></table>`, 'tok-2');
    const event = shell('Event Modify', '<h1>Holiday event</h1>', 'tok-3');
    const add = shell('Event Add', '<h1>Add event form</h1>', 'tok-4');
    const page = await browser.newPage();
    const posts = [];
    await page.route('https://apps-sbx.avpaas.io/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') posts.push(pathname);
      const body = pathname === modifyPath ? modify : pathname === eventPath ? event :
        pathname === addPath ? add : list;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto('https://apps-sbx.avpaas.io' + listPath);
    await page.evaluate(() => { window.redirectPost = function () {}; });
    await page.addScriptTag({ path: pjaxPath });
    await page.locator('.cp-native-schedule-launch').click();
    await page.getByText('Holiday', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, listPath);
    assert.equal(await page.locator('[name="formtokenserial"]').inputValue(), 'tok-2');
    await page.locator('.cp-native-schedule-event button').click();
    await page.getByText('Holiday event').waitFor();
    assert.equal(new URL(page.url()).pathname, eventPath);
    assert.deepEqual(posts.slice(0, 2), [modifyPath, eventPath]);
    await page.evaluate(() => window.redirectPost('/commpilot/ServiceProvider/Schedules/', {}));
    await page.locator('.cp-native-schedule-launch').click();
    await page.locator('.cp-native-schedule-add:not([disabled])').click();
    await page.getByText('Add event form').waitFor();
    assert.equal(new URL(page.url()).pathname, addPath);
  } finally { await browser.close(); }
});
