/* The site's fonts. Every face the extension offers is packaged (OFL; licences in assets/fonts/licenses) or is a
   common system font, and one of them — the user's pick in Settings, Inter unless changed — is the font of every
   element on every CommPilot page: page titles, the breadcrumb, lists, forms, native controls and dialogs alike.
   theme-settings.js marks the pick on <html data-cp-font="…">; the rule below does the rest. Faces load only when
   used, so offering many costs nothing until one is chosen. The list is shared with theme-settings.js
   (globalThis.cpFontChoices, the content scripts' own global). */
(function () {
  if (window.frameElement && window.frameElement.hasAttribute("data-cp-transport")) return;   // pjax.js's hidden transport frames
  function url(p) { return chrome.runtime.getURL(p); }
  var FONTS = [
    { id: "inter", label: "Inter", family: "Inter", file: "InterVariable.woff2", weight: "100 900", note: "Default" },
    { id: "geist", label: "Geist", family: "Geist", file: "GeistVariable.woff2", weight: "100 900" },
    { id: "roboto", label: "Roboto", family: "Roboto Variable", file: "RobotoVariable.woff2", weight: "100 900" },
    { id: "open-sans", label: "Open Sans", family: "Open Sans Variable", file: "OpenSansVariable.woff2", weight: "300 800" },
    { id: "source-sans", label: "Source Sans 3", family: "Source Sans 3 Variable", file: "SourceSans3Variable.woff2", weight: "200 900" },
    { id: "ibm-plex", label: "IBM Plex Sans", family: "IBM Plex Sans Variable", file: "IBMPlexSansVariable.woff2", weight: "100 700" },
    { id: "public-sans", label: "Public Sans", family: "Public Sans Variable", file: "PublicSansVariable.woff2", weight: "100 900" },
    { id: "manrope", label: "Manrope", family: "Manrope Variable", file: "ManropeVariable.woff2", weight: "200 800" },
    { id: "dm-sans", label: "DM Sans", family: "DM Sans Variable", file: "DMSansVariable.woff2", weight: "100 1000" },
    { id: "figtree", label: "Figtree", family: "Figtree Variable", file: "FigtreeVariable.woff2", weight: "300 900" },
    { id: "nunito", label: "Nunito", family: "Nunito Variable", file: "NunitoVariable.woff2", weight: "200 1000" },
    { id: "atkinson", label: "Atkinson Hyperlegible", family: "Atkinson Hyperlegible Next Variable",
      file: "AtkinsonHyperlegibleNextVariable.woff2", weight: "200 800", note: "Made to be easy to read" },
    { id: "system", label: "System", stack: 'system-ui, "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif',
      note: "Your computer's own font" },
    { id: "arial", label: "Arial", stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif', note: "Classic CommPilot" },
    { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" }
  ];
  FONTS.forEach(function (f) {
    if (!f.stack) f.stack = '"' + f.family + '", ' + (f.id === "inter" ? "" : '"Inter", ') + '"Segoe UI", system-ui, sans-serif';
  });
  globalThis.cpFontChoices = FONTS;

  var css = FONTS.filter(function (f) { return f.file; }).map(function (f) {
    return '@font-face { font-family: "' + f.family + '"; src: url("' + url("assets/fonts/" + f.file) + '") format("woff2"); ' +
      "font-weight: " + f.weight + "; font-style: normal; font-display: swap; }";
  }).join("\n") + "\n" +
    FONTS.map(function (f) { return 'html[data-cp-font="' + f.id + '"] { --cp-font: ' + f.stack + "; }"; }).join("\n") + "\n" +
    // One font everywhere. Code keeps its monospace, icons are drawn, Settings' previews show their own face, and the
    // CommPilot logo (brand.js) keeps its lettering.
    // The never-matching #cp-font#cp-font#cp-font only raises the rule's weight above the extension's own styles
    // that name a font (the breadcrumb's pills, the menu board, the enhancer's popovers), so it wins everywhere.
    "html[data-cp-font] body, html[data-cp-font] body :not(#cp-font#cp-font#cp-font, svg, svg *, code, pre, kbd, samp, " +
      ".cp-font-sample, .cp-brand, .cp-brand *), html[data-cp-font] body :not(#cp-font#cp-font#cp-font, svg, svg *, code, " +
      "pre, kbd, samp, .cp-font-sample, .cp-brand, .cp-brand *)::before, html[data-cp-font] body :not(#cp-font#cp-font#cp-font, " +
      "svg, svg *, code, pre, kbd, samp, .cp-font-sample, .cp-brand, .cp-brand *)::after { font-family: var(--cp-font) !important; }\n";
  var style = document.createElement("style");
  style.id = "cp-fonts";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  // Load the default face before the page is painted when possible.
  if (document.fonts && document.fonts.load) {
    try {
      for (const face of ['400 14px Inter', '600 14px Inter', '700 14px Inter']) {
        document.fonts.load(face).catch(() => {});
      }
    } catch (e) {}
  }
})();
