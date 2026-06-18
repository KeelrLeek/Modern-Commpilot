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
@font-face { font-family: "Nunito"; font-weight: 400; font-style: normal; font-display: swap; src: url("${url("assets/fonts/nunito-400.woff2")}") format("woff2"); }
@font-face { font-family: "Nunito"; font-weight: 600; font-style: normal; font-display: swap; src: url("${url("assets/fonts/nunito-600.woff2")}") format("woff2"); }
@font-face { font-family: "Nunito"; font-weight: 700; font-style: normal; font-display: swap; src: url("${url("assets/fonts/nunito-700.woff2")}") format("woff2"); }
`;
  var style = document.createElement("style");
  style.id = "cp-fonts";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  // Eagerly trigger the (local) Nunito downloads at document_start, using the @font-face
  // declarations just registered above (no duplicate FontFace objects), so the faces are
  // usually ready by first paint and `swap` rarely shows a fallback flash. font-display
  // is `swap` (was `optional`, which only applied Nunito if it loaded within ~100ms and
  // otherwise fell back permanently for that page — the cause of the intermittent font).
  if (document.fonts && document.fonts.load) {
    try {
      document.fonts.load('400 16px Nunito');
      document.fonts.load('600 16px Nunito');
      document.fonts.load('700 16px Nunito');
    } catch (e) {}
  }
})();
