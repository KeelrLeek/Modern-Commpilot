const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The twelve themes (themes.js): every side is a palette in theme-palettes.css with every token the rules read, a mark
// and its favicons, and text that stays readable. A theme added later gets the same checks with nothing else to do.
const root = path.resolve(__dirname, '..');
require(path.join(root, 'src/content/themes.js'));
const css = fs.readFileSync(path.join(root, 'src/content/theme-palettes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokensOf = palette => {
  const tokens = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = selector.split(',').map(part => part.trim());
    if (!parts.includes(`html[data-cp-direction="${palette}"] body[id="initBody.menuTemplate"]`)) continue;
    assert.ok(parts.includes(`[data-cp-palette="${palette}"]`), `${palette}'s tokens also apply to data-cp-palette elements`);
    assert.ok(parts.includes(`html[data-cp-direction="${palette}"] body[id="loginBody"]`), `${palette} also colours the Login page`);
    for (const [, k, v] of body.matchAll(/--d-([\w-]+)\s*:\s*([^;]+)/g)) tokens[k] = v.trim();
    tokens.scheme = (body.match(/color-scheme\s*:\s*(\w+)/) || [])[1];
  }
  return tokens;
};
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = hex => { const n = parseInt(hex.slice(1, 7), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const TOKENS = ['canvas', 'main', 'surface', 'raised', 'header', 'crumb', 'side', 'side-hover', 'side-text', 'side-active', 'side-active-text',
  'side-accent', 'text', 'muted', 'line', 'accent', 'action', 'action-text', 'input', 'ring', 'on', 'off', 'warn', 'logo', 'logo-blend',
  'logo-opacity', 'shadow'];

test('every theme has a light and a dark palette, each complete, readable, with its mark and favicons', () => {
  const themes = globalThis.cpThemes;
  assert.equal(themes.length, 12);
  assert.equal(new Set(themes.map(t => t.name)).size, 12, 'names are unique');
  assert.ok(globalThis.cpThemeOf(globalThis.cpThemeDefault), 'the default palette is a theme side');
  assert.equal(globalThis.cpThemeOf('midnight').palette, 'nord', 'the old Midnight name still finds Nord');
  for (const theme of themes) for (const mode of ['light', 'dark']) {
    const palette = theme[mode];
    const t = tokensOf(palette);
    const missing = TOKENS.filter(k => !t[k]);
    assert.deepEqual(missing, [], `${theme.name} ${mode} (${palette}) sets every token`);
    assert.equal(t.scheme, mode, `${palette} declares color-scheme ${mode}`);
    const read = [['text', ['main', 'surface', 'raised', 'input', 'header', 'crumb']], ['muted', ['main', 'surface', 'raised']],
      ['action-text', ['action']], ['side-text', ['side', 'side-hover']], ['on', ['surface']], ['off', ['surface']]];
    for (const [fg, grounds] of read) for (const g of grounds) {
      const r = ratio(t[fg], t[g]);
      assert.ok(r >= 4.5, `${palette}: --d-${fg} on --d-${g} is ${r.toFixed(2)}:1, under 4.5:1`);
    }
    for (const file of [`theme-${palette}.svg`, `pulse-${palette}.svg`, `pulse-${palette}-sbx.svg`])
      assert.ok(fs.existsSync(path.join(root, 'assets/icons', file)), `${file} is drawn (scripts/make-theme-marks.cjs, make-icons.cjs)`);
  }
});

test('nothing outside theme-palettes.css names a palette', () => {
  const files = ['src/content', 'src/popup'].flatMap(dir => fs.readdirSync(path.join(root, dir))
    .filter(f => /\.(css|js)$/.test(f) && f !== 'theme-palettes.css' && f !== 'themes.js').map(f => path.join(dir, f)));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /data-cp-direction="(nord|atlas|graphite|terra)/, `${file} keys a rule to one palette`);
    assert.doesNotMatch(text, /swatch-(nord|atlas|graphite|terra)/, `${file} has a per-palette swatch`);
  }
});
