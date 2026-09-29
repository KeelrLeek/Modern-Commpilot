// Draws the Pulse logo files from one definition: a favicon pair for every palette in
// src/content/theme-palettes.css (assets/icons/pulse-<palette>.svg, the filled tile, and
// pulse-<palette>-sbx.svg, the tile outlined for the sandbox site) and the Atlas PNGs the
// manifest names (assets/icons/app/pulse-<size>.png), rendered by headless Edge.
//
//   node scripts/make-icons.cjs              favicons and PNGs
//   node scripts/make-icons.cjs --favicons   favicons only, no browser (build_release.py runs this)
//
// src/bg/icon.js paints the same tile on the toolbar from the colours the page reports.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cssFile = path.join(root, 'src', 'content', 'theme-palettes.css');
const iconDir = path.join(root, 'assets', 'icons');
const appDir = path.join(iconDir, 'app');
const edge = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SIZES = [16, 32, 48, 128];

// The tile on its 24-unit grid: a rounded square (radius 28%), a soft ground under a heartbeat line.
const RADIUS = 6.72;
const TILE = 'M6.72 0H17.28A6.72 6.72 0 0 1 24 6.72V17.28A6.72 6.72 0 0 1 17.28 24H6.72' +
  'A6.72 6.72 0 0 1 0 17.28V6.72A6.72 6.72 0 0 1 6.72 0Z';
const GROUND = 'M-1 17.4H5.6l1.7-2.2 1.7 2.2h1.5l2.2-12 2.5 13.8 1.3-1.8H25V25H-1Z';
const LINE = 'M-1 17.4H5.6l1.7-2.2 1.7 2.2h1.5l2.2-12 2.5 13.8 1.3-1.8H25';
const STROKE = 'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';

// Every palette the stylesheet names, coloured from the first block of the form
// html[data-cp-direction="<name>"] body[id="initBody.menuTemplate"] that sets all three tokens:
// tile = --d-action, ink = --d-action-text, accent = --d-accent.
function readPalettes(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = [...new Set([...css.matchAll(/data-cp-direction="([^"]*)"/g)].map(match => match[1]))];
  const palettes = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const tokens = {};
    for (const [, token, value] of body.matchAll(/--d-(accent|action|action-text)\s*:\s*([^;]+)/g))
      tokens[token] = value.trim();
    if (!tokens.accent || !tokens.action || !tokens['action-text']) continue;
    for (const part of selector.split(',')) {
      const match = part.trim().match(/^html\[data-cp-direction="([^"]*)"\]\s+body\[id="initBody\.menuTemplate"\]$/);
      if (match && !palettes[match[1]])
        palettes[match[1]] = { tile: tokens.action, ink: tokens['action-text'], accent: tokens.accent };
    }
  }
  const missing = names.filter(name => !palettes[name]);
  if (missing.length) throw new Error(`theme-palettes.css has no --d-action/--d-action-text/--d-accent block for: ${missing.join(', ')}`);
  for (const [name, colors] of Object.entries(palettes)) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Palette name cannot be a file name: ${name}`);
    for (const value of Object.values(colors))
      if (/var\(/.test(value) || !/^[#\w\s(),.%/+-]+$/.test(value))
        throw new Error(`Palette ${name} needs literal colours for its icons, not: ${value}`);
  }
  return palettes;
}

// The page's favicon: the filled tile, or for the sandbox the tile's outline (inset so its 2-unit
// stroke is not clipped) with the line in the accent and no ground, so sandbox tabs stand apart.
function faviconSvg(name, colors, sandbox) {
  const id = `pulse-${name}${sandbox ? '-sbx' : ''}-clip`;
  const art = sandbox ? [
    `<g clip-path="url(#${id})"><path d="${LINE}" fill="none" stroke="${colors.accent}" ${STROKE}/></g>`,
    `<rect x="1" y="1" width="22" height="22" rx="${+(RADIUS - 1).toFixed(2)}" fill="none" stroke="${colors.accent}" stroke-width="2"/>`
  ] : [
    `<path d="${TILE}" fill="${colors.tile}"/>`,
    `<g clip-path="url(#${id})">`,
    `  <path d="${GROUND}" fill="${colors.ink}" fill-opacity=".26"/>`,
    `  <path d="${LINE}" fill="none" stroke="${colors.ink}" ${STROKE}/>`,
    '</g>'
  ];
  return ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">',
    `<defs><clipPath id="${id}"><path d="${TILE}"/></clipPath></defs>`, ...art, '</svg>', ''].join('\n');
}

function faviconFiles(palettes) {
  return Object.entries(palettes).flatMap(([name, colors]) => [false, true].map(sandbox => ({
    file: path.join(iconDir, `pulse-${name}${sandbox ? '-sbx' : ''}.svg`),
    svg: faviconSvg(name, colors, sandbox)
  })));
}

// Files that already match are left alone, so a build does not touch them.
function writeFavicons(palettes) {
  const changed = [];
  for (const { file, svg } of faviconFiles(palettes)) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === svg) continue;
    fs.writeFileSync(file, svg);
    changed.push(path.basename(file));
  }
  return changed;
}

// The static toolbar and store icons in Atlas, the first-run palette; corners stay transparent.
async function renderPngs(colors) {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    fs.mkdirSync(appDir, { recursive: true });
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent('<!doctype html><style>html, body { margin: 0; background: transparent; } svg { display: block; }</style>' +
        faviconSvg('app', colors, false).replace('width="24" height="24"', `width="${size}" height="${size}"`));
      await page.screenshot({ path: path.join(appDir, `pulse-${size}.png`), omitBackground: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const palettes = readPalettes(fs.readFileSync(cssFile, 'utf8'));
  const changed = writeFavicons(palettes);
  console.log(`Favicons for ${Object.keys(palettes).join(', ')}: ${changed.length ? 'wrote ' + changed.join(', ') : 'up to date'}`);
  if (process.argv.includes('--favicons')) return;
  if (!palettes.atlas) throw new Error('theme-palettes.css has no Atlas palette for the default PNGs.');
  await renderPngs(palettes.atlas);
  console.log(`PNGs: ${SIZES.map(size => `assets/icons/app/pulse-${size}.png`).join(', ')}`);
}

module.exports = { RADIUS, TILE, GROUND, LINE, SIZES, cssFile, iconDir, readPalettes, faviconSvg, faviconFiles };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
