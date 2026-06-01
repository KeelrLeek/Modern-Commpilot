# Modern CommPilot Skin

Cosmetic overlay that re-skins the CommPilot web app
(`https://apps01.avpaas.io/commpilot/*`).

## Loading the extension

### Chrome / Edge (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this project's root folder (the one containing `manifest.json`).
5. The "Modern CommPilot Skin" card should appear in the extensions list.

### Firefox (temporary add-on)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Navigate into this project and select `manifest.json`.
4. The extension appears in the toolbar with its name.

## Verifying it works

1. Navigate to `https://apps01.avpaas.io/commpilot/` (or any sub-path under `/commpilot/`).
2. A thin blue bar should appear at the very top of the page (`4px solid #4a90d9`).
3. Open the browser console (F12 → Console). You should see:

   ```
   [Modern CommPilot Skin] content script loaded
   ```

If both the bar and the console message appear, the extension is working correctly.

## Project structure

```
manifest.json
assets/                  # fonts, icons (future)
src/content/
  skin.css               # injected CSS
  skin.js                # injected JS
README.md
```
