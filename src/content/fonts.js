(function () {
  function url(p) { return chrome.runtime.getURL(p); }
  var css = `
@font-face {
  font-family: "Inter";
  src: url("${url("assets/fonts/InterVariable.woff2")}") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist";
  src: url("${url("assets/fonts/GeistVariable.woff2")}") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
`;
  var style = document.createElement("style");
  style.id = "cp-fonts";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  // Load the bundled UI faces before the page is painted when possible.
  if (document.fonts && document.fonts.load) {
    try {
      for (const face of ['400 14px Inter', '600 14px Inter', '650 26px Geist']) {
        document.fonts.load(face).catch(() => {});
      }
    } catch (e) {}
  }
})();
