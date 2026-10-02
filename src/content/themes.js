/* The CommPilot themes (2026-10-02). Each theme has a light and a dark side; each side is one palette in
   theme-palettes.css, named by the id set on <html data-cp-direction>. The names are video-game nods the user picked.
   Colours live only in theme-palettes.css; scripts/make-theme-marks.cjs draws each side's mark from them
   (assets/icons/theme-<palette>.svg). Listed in the order Settings and the toolbar popup show them. Shared by the
   content scripts (theme-settings.js) and the popup. */
globalThis.cpThemes = Object.freeze([
  { id: "dmg", name: "DMG", light: "dmg-light", dark: "dmg-dark" },
  { id: "graphite", name: "Duke", light: "graphite-light", dark: "graphite" },
  { id: "atlas", name: "FLUDD", light: "atlas", dark: "atlas-dark" },
  { id: "rosepine", name: "Flowey", light: "rosepine-light", dark: "rosepine-dark" },
  { id: "gruvbox", name: "Gerudo", light: "gruvbox-light", dark: "gruvbox-dark" },
  { id: "contrast", name: "Kill Screen", light: "contrast-light", dark: "contrast-dark" },
  { id: "snes", name: "Mode 7", light: "snes-light", dark: "snes-dark" },
  { id: "terra", name: "Shovel Knight", light: "terra", dark: "terra-dark" },
  { id: "nord", name: "Snowdin", light: "nord-light", dark: "nord" },
  { id: "solarized", name: "Solaire", light: "solarized-light", dark: "solarized-dark" },
  { id: "tokyo", name: "Tokyo-to", light: "tokyo-light", dark: "tokyo-dark" },
  { id: "dracula", name: "Vampire Killer", light: "dracula-light", dark: "dracula-dark" },
].map(theme => Object.freeze(theme)));
// The palette a first run gets, and what an unknown saved value falls back to.
globalThis.cpThemeDefault = "atlas";
// Which theme and side a palette is, or null.
globalThis.cpThemeOf = palette => {
  if (palette === "midnight") palette = "nord";   // saved by versions before Nord
  for (const theme of globalThis.cpThemes) {
    if (theme.light === palette) return { theme, mode: "light", palette };
    if (theme.dark === palette) return { theme, mode: "dark", palette };
  }
  return null;
};
