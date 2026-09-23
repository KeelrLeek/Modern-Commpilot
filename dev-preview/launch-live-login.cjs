// Opens the real sandbox login with this unpacked extension in a visible Edge window.
// No credentials are logged or saved by this launcher.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const extension = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = process.env.BW_LIVE_PROFILE ||
  path.join(process.env.LOCALAPPDATA, 'BroadWorksEnhancer', 'LivePreviewProfile');
fs.mkdirSync(profile, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge,
    headless: false,
    viewport: null,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto('https://apps-sbx.avpaas.io/commpilot/Login/',
      { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    // Keep the window available for inspecting a failed or stalled login.
    console.log('CommPilot login did not finish loading: ' + error.message.split('\n')[0]);
  }
  console.log('Visible Edge preview opened with BroadWorks Enhancer.');
  await new Promise(resolve => context.on('close', resolve));
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
