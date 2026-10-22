const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { fixture, R } = require('./fixtures/bulk-group-harness.cjs');

for (const [label, values, valid] of [
  ['unreadable maximum', ['3', 'unknown', '4'], false],
  ['unreadable default', ['3', '6', 'unknown'], false],
  ['negative minimum', ['-1', '6', '4'], false],
  ['fractional default', ['3', '6', '4.5'], false],
  ['unbounded maximum', ['3', 'Infinity', '4'], false],
  ['ordinary range', ['3', '6', '4'], true],
  ['fixed length', ['4', '4', '4'], true]
]) test(`group extension policy rejects unreadable lengths: ${label}`, async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage(), server = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const outcome = await page.evaluate(async ({ values, extension }) => {
      const lease = await cpAcquireUserBulk(), navigate = lease.navigate;
      lease.navigate = async (...args) => {
        const result = await navigate(...args);
        if (args[0] === extension) {
          for (const [index, name] of ['groupExtMinLength', 'groupExtMaxLength', 'groupExtDefaultLength'].entries()) {
            const field = document.forms.mainForm.elements.namedItem(name);
            field.appendChild(new Option(values[index], values[index], true, true));
          }
        }
        return result;
      };
      try { return { info: await cpCreateBulkEngine(lease).initialize() }; }
      catch (error) { return { error: error.message }; }
      finally { lease.release(); }
    }, { values, extension: R.extension });
    if (valid) assert.deepEqual(outcome.info?.limits, { min: +values[0], max: +values[1], default: +values[2] });
    else {
      assert.match(outcome.error || '', /Extension Dialing limits could not be read/,
        'incomplete native rules cannot silently remove extension validation');
      assert.equal(server.requests.some(request => request.route === R.add), false,
        'initialization stops at the invalid rules before opening Add User');
    }
    assert.equal(server.writes.length, 0);
    assert.equal(server.badTokens, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
