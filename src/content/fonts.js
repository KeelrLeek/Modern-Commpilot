(function () {
  function url(p) { return chrome.runtime.getURL(p); }
  var css = `
@font-face {
  font-family: "Inter";
  src: url("${url("assets/fonts/InterVariable.woff2")}") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: optional;
}
@font-face {
  font-family: "Geist";
  src: url("${url("assets/fonts/GeistVariable.woff2")}") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: optional;
}
@font-face { font-family: "Nunito"; font-weight: 400; font-style: normal; font-display: optional; src: url("${url("assets/fonts/nunito-400.woff2")}") format("woff2"); }
@font-face { font-family: "Nunito"; font-weight: 600; font-style: normal; font-display: optional; src: url("${url("assets/fonts/nunito-600.woff2")}") format("woff2"); }
@font-face { font-family: "Nunito"; font-weight: 700; font-style: normal; font-display: optional; src: url("${url("assets/fonts/nunito-700.woff2")}") format("woff2"); }
`;
  var style = document.createElement("style");
  style.id = "cp-fonts";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();
