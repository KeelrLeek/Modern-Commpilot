// Draws each theme side's mark, the small picture beside the site link in the top bar and in Settings' theme list:
// assets/icons/theme-<palette>.svg for every palette in src/content/themes.js, coloured from that palette's tokens in
// src/content/theme-palettes.css (the user's picks, 2026-10-02). A 20 × 20 grid; CommPilot's content policy blocks
// data: images, so the marks are files the extension serves.
//
//   node scripts/make-theme-marks.cjs        (build_release.py runs it with the favicons)
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cssFile = path.join(root, 'src', 'content', 'theme-palettes.css');
const iconDir = path.join(root, 'assets', 'icons');
require(path.join(root, 'src', 'content', 'themes.js'));

// A palette's tokens: every block whose selector names it with the app's body.
function readTokens(css, palette) {
  const tokens = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const named = selector.split(',').some(part => part.trim() === `html[data-cp-direction="${palette}"] body[id="initBody.menuTemplate"]`);
    if (named) for (const [, k, v] of body.matchAll(/--d-([\w-]+)\s*:\s*([^;]+)/g)) tokens[k] = v.trim();
  }
  return tokens;
}

const ring = (n, f) => Array.from({ length: n }, (_, i) => f(i * 360 / n)).join('');
const by = (mode, light, dark) => (mode === 'light' ? light : dark);
// One drawing per theme; t is the side's tokens, mode 'light' or 'dark'.
const MARKS = {
  // Snowdin: a snowman in a scarf.
  nord: (t, mode) => {
    const snow = by(mode, '#ffffff', '#eceff4');
    return `<g stroke="${t.accent}" stroke-width="1.3"><circle cx="10" cy="13.8" r="4.4" fill="${snow}"/><circle cx="10" cy="6.5" r="3.1" fill="${snow}"/></g>` +
      `<path fill="${t.off}" d="M6.9 8.9h6.2v1.5H12v2.8h-1.5v-2.8H6.9Z"/>` +
      `<circle cx="8.9" cy="6.1" r=".6" fill="#2e3440"/><circle cx="11.1" cy="6.1" r=".6" fill="#2e3440"/>`;
  },
  // Mode 7: the controller's four buttons around the diamond (X top, A right, B bottom, Y left).
  snes: t => `<circle cx="10" cy="4.6" r="2.9" fill="${t['quad-4']}"/><circle cx="15.4" cy="10" r="2.9" fill="${t['quad-1']}"/>` +
    `<circle cx="10" cy="15.4" r="2.9" fill="${t['quad-2']}"/><circle cx="4.6" cy="10" r="2.9" fill="${t['quad-3']}"/>`,
  // DMG: the Game Boy's B and A buttons, slanted as on the case.
  dmg: t => `<circle cx="6" cy="12.6" r="3.7" fill="${t.action}"/><circle cx="14" cy="7.4" r="3.7" fill="${t.action}"/>`,
  // Vampire Killer: the Morning Star, the chain whip's spiked end.
  dracula: (t, mode) => {
    const grip = by(mode, '#6c664b', '#cfcfde');
    return `<path fill="none" stroke="${grip}" stroke-width="2.6" stroke-linecap="round" d="M2.8 17.2 6 14"/>` +
      `<path fill="none" stroke="${t.accent}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray=".1 2.1" d="M6 14C8 9.4 10.6 7.2 13.6 6.4"/>` +
      `<g fill="${t.accent}"><circle cx="15.6" cy="5.2" r="2.5"/>${ring(6, a => `<path transform="rotate(${a} 15.6 5.2)" d="M15.6 1.2 16.4 3H14.8Z"/>`)}</g>`;
  },
  // Solaire: the Sun of Astora from his tabard, face and all.
  solarized: (t, mode) => {
    const [core, rays, face] = by(mode, ['#e0a91a', '#cb4b16', '#073642'], ['#e9b82a', '#e8743b', '#002b36']);
    return `<g fill="${rays}">${ring(12, a => { const long = Math.round(a / 30) % 2 === 0;
      return `<path transform="rotate(${a} 10 10)" d="M9 ${long ? 4.6 : 5.2} 10 ${long ? 0.6 : 2.2} 11 ${long ? 4.6 : 5.2}Z"/>`; })}</g>` +
      `<circle cx="10" cy="10" r="5" fill="${core}"/><circle cx="8.3" cy="9.2" r=".7" fill="${face}"/><circle cx="11.7" cy="9.2" r=".7" fill="${face}"/>` +
      `<path fill="none" stroke="${face}" stroke-width=".9" stroke-linecap="round" d="M8 11.4Q10 13 12 11.4"/>`;
  },
  // Flowey: a golden flower on its stem.
  rosepine: (t, mode) => {
    const [petal, heart, stem] = by(mode, ['#e5a032', '#b4637a', '#3e7a4a'], ['#f6c177', '#eb6f92', '#8fc79a']);
    return `<path fill="none" stroke="${stem}" stroke-width="1.6" stroke-linecap="round" d="M10 12.4V18.8"/><path fill="${stem}" d="M10 16.6C9 14.6 7 14 5.2 14.6 6.2 16.4 8 17.2 10 16.6Z"/>` +
      `<g fill="${petal}">${ring(6, a => `<ellipse transform="rotate(${a} 10 7.8)" cx="10" cy="3.8" rx="2.2" ry="3"/>`)}</g><circle cx="10" cy="7.8" r="2.3" fill="${heart}"/>`;
  },
  // Gerudo: the sun over the desert dunes.
  gruvbox: (t, mode) => {
    const [sun, near, far] = by(mode, ['#d79921', '#a13502', '#d65d0e'], ['#fabd2f', '#fe8019', '#d65d0e']);
    return `<circle cx="12.8" cy="6.6" r="3.2" fill="${sun}"/><path fill="${far}" d="M1 13.6C4.4 10.2 8 10.4 11 12.6 13.6 10.8 16.6 10.8 19 12.4V18H1Z"/>` +
      `<path fill="${near}" d="M1 16C5.2 13.2 10 13.4 13.4 15.4 15.4 14.6 17.4 14.8 19 15.6V18.4H1Z"/>`;
  },
  // Tokyo-to: a spray can, mid-tag.
  tokyo: (t, mode) => {
    const mist = by(mode, '#9854f1', '#bb9af7');
    return `<rect x="5" y="6.6" width="7.4" height="11.6" rx="1.8" fill="${t.accent}"/><rect x="6.9" y="3.8" width="3.6" height="2.4" rx=".6" fill="${t.accent}"/>` +
      `<rect x="5" y="10" width="7.4" height="3" fill="${mist}"/><g fill="${mist}"><circle cx="13.4" cy="4.4" r=".9"/><circle cx="15.6" cy="3" r=".9"/>` +
      `<circle cx="15.8" cy="5.6" r=".9"/><circle cx="18" cy="4.2" r=".9"/><circle cx="17.8" cy="1.6" r=".7"/></g>`;
  },
  // Kill Screen: Pac-Man's level 256, clean on the left and scrambled on the right.
  contrast: t => [[2, 2, t.accent], [2, 6, t.accent], [2, 10, t.accent], [2, 14, t.accent], [6, 2, t.accent], [6, 6, t.accent],
    [6, 10, t.accent], [6, 14, t.accent], [10.4, 2.6, t.off], [14.4, 3.4, t.accent], [11, 7.2, t.on], [14.6, 9.4, t.off],
    [10.2, 12.6, t.accent], [14, 14.4, t.on], [16.6, 6.4, t.accent]].map(([x, y, f]) => `<rect x="${x}" y="${y}" width="3.6" height="3.6" fill="${f}"/>`).join(''),
  // FLUDD: a drop of water.
  atlas: t => `<path fill="${t.accent}" d="M10 1.8C10 1.8 4.6 8.2 4.6 12.2a5.4 5.4 0 0 0 10.8 0C15.4 8.2 10 1.8 10 1.8Z"/>` +
    `<path fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width="1.3" stroke-linecap="round" d="M7.4 12.4a2.7 2.7 0 0 0 2 2.5"/>`,
  // Duke: the Xbox 360's Ring of Light, four quarters round the power button.
  graphite: (t, mode) => {
    const lit = by(mode, '#3f7d12', '#9be05a');
    return `<circle cx="10" cy="10" r="7" fill="none" stroke="${lit}" stroke-width="2.6" stroke-dasharray="8.5 2.5" stroke-dashoffset="5.5"/>` +
      `<circle cx="10" cy="10" r="2.6" fill="none" stroke="${lit}" stroke-width="1.4"/><path d="M10 6.6v2.6" stroke="${lit}" stroke-width="1.4" stroke-linecap="round"/>`;
  },
  // Shovel Knight: his horned helmet.
  terra: (t, mode) => {
    const slit = by(mode, t.surface, t.canvas);
    return `<path fill="${t.accent}" d="M4.6 9.4A5.4 5.4 0 0 1 15.4 9.4V16.6H4.6Z"/><path fill="${t.accent}" d="M5.6 6.4C3.6 5.6 2.4 3.6 2.6 1.4 4 2.8 5.8 3.6 7.4 4.2ZM14.4 6.4C16.4 5.6 17.6 3.6 17.4 1.4 16 2.8 14.2 3.6 12.6 4.2Z"/>` +
      `<path fill="${slit}" d="M6.4 9.6H13.6V11.2H10.8V15.4H9.2V11.2H6.4Z"/>`;
  },
};

function main() {
  const css = fs.readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const written = [];
  for (const theme of globalThis.cpThemes) {
    const draw = MARKS[theme.id];
    if (!draw) throw new Error(`No mark drawn for the ${theme.name} theme (${theme.id})`);
    for (const mode of ['light', 'dark']) {
      const palette = theme[mode];
      const tokens = readTokens(css, palette);
      if (!tokens.accent) throw new Error(`theme-palettes.css has no tokens for ${palette}`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${draw(tokens, mode)}</svg>\n`;
      if (/undefined|NaN/.test(svg)) throw new Error(`The ${palette} mark uses a token its palette does not set`);
      const name = `theme-${palette}.svg`;
      fs.writeFileSync(path.join(iconDir, name), svg);
      written.push(`assets/icons/${name}`);
    }
  }
  return written;
}

if (require.main === module) console.log(main().join('\n'));
module.exports = { main, readTokens };
