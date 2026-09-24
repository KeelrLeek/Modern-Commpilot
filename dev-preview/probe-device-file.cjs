// Sandbox probe for the Group Device Configuration file form.
const { chromium } = require('playwright-core');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = process.env.BW_LIVE_PROFILE;
if (!profile) throw new Error('Set BW_LIVE_PROFILE to the saved sandbox profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const waitPath = (page, expected) => page.waitForFunction(pathname =>
  location.pathname === pathname && !!document.querySelector('td[width="82%"]'),
expected, { timeout: 25000 });

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: true, viewport: null, acceptDownloads: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const page = await context.newPage();
  for (const old of context.pages()) if (old !== page) await old.close();
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'commit' });
    if (new URL(page.url()).hostname !== 'apps-sbx.avpaas.io') throw new Error('Sandbox only');
    if (new URL(page.url()).pathname === '/commpilot/Login/')
      await page.locator('button.bw-saved-account-name').first().click();
    await page.waitForFunction(() => location.pathname === '/commpilot/Common/folder_contents.jsp' &&
      document.title.trim() === 'Profile', null, { timeout: 30000 });
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Service Providers")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/index.jsp');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Test_SP")').click();
    await waitPath(page, '/commpilot/Reseller/ServiceProviders/Modify/index.jsp');
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Groups")').click();
    await waitPath(page, '/commpilot/ServiceProvider/Members/');
    await page.locator('#search0').click();
    await page.locator('a:text-is("Stan Mikita Donuts")').click();
    await waitPath(page, '/commpilot/ServiceProvider/Members/Modify/index.jsp');
    await page.locator('a.leftnavfolder, a.leftnavfolderopen')
      .filter({ hasText: /^\s*Utilities\s*$/ }).click();
    await page.waitForFunction(() => document.title.trim() === 'Utilities',
      null, { timeout: 25000 });
    await page.locator('td[width="82%"] a.navMenuItem:text-is("Device Configuration")').click();
    await waitPath(page, '/commpilot/Group/DefaultConfig/');
    const list = await page.evaluate(() => ({ text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 900),
      links: [...document.querySelectorAll('td[width="82%"] a')]
        .filter(item => item.getClientRects().length)
        .map(item => ({ text: item.textContent.trim(), id: item.id })).slice(0, 25) }));
    console.log(JSON.stringify({ event: 'device-config-list', list }));
    await page.locator('td[width="82%"] a:text-is("Edit")').first().click();
    await waitPath(page, '/commpilot/Group/DefaultConfig/Nested/Files/');
    const files = await page.evaluate(() => ({ text: document.querySelector('td[width="82%"]')?.innerText.slice(0, 1300),
      links: [...document.querySelectorAll('td[width="82%"] a')]
        .filter(item => item.getClientRects().length)
        .map(item => ({ text: item.textContent.trim(), id: item.id })).slice(0, 25) }));
    console.log(JSON.stringify({ event: 'device-config-files', files }));
  } finally { await context.close(); }
})().catch(error => { console.error(JSON.stringify({ event: 'fatal', error: error.message }));
  process.exitCode = 1; });
