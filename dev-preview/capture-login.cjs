// Capture the real sandbox login with the unpacked extension, without credentials.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '..', 'release', 'previews');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-login-capture-'));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge,
    headless: true,
    viewport: { width: 1200, height: 850 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    const page = await context.newPage();
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/', { waitUntil: 'domcontentloaded' });
    await page.locator('.bw-saved-trigger').waitFor();
    await page.screenshot({ path: path.join(output, 'BroadWorks-Enhancer-login-saved-collapsed.png') });
    await page.locator('.bw-saved-trigger').click();
    await page.getByRole('button', { name: 'Add login' }).click();
    await page.screenshot({ path: path.join(output, 'BroadWorks-Enhancer-login-saved-open.png') });
    console.log('Captured real sandbox login with the saved sign-ins drawer.');
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(profile, { recursive: true, force: true });
});
