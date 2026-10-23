// The toolbar button wears the Pulse tile in whatever palette the page is using. The top frame
// reports the palette's computed colours; they are kept in extension storage so the button is
// repainted when the browser starts. Until a page has reported, or where OffscreenCanvas or
// Path2D is missing, the manifest's PNGs stay. Tabs on the sandbox site get an "SBX" badge.
(function () {
  "use strict";
  var KEY = "cpIconColors";
  // The tile on its 24-unit grid; scripts/make-icons.cjs draws the same art for the PNGs and favicons.
  var TILE = "M6.72 0H17.28A6.72 6.72 0 0 1 24 6.72V17.28A6.72 6.72 0 0 1 17.28 24H6.72" +
    "A6.72 6.72 0 0 1 0 17.28V6.72A6.72 6.72 0 0 1 6.72 0Z";
  var GROUND = "M-1 17.4H5.6l1.7-2.2 1.7 2.2h1.5l2.2-12 2.5 13.8 1.3-1.8H25V25H-1Z";
  var LINE = "M-1 17.4H5.6l1.7-2.2 1.7 2.2h1.5l2.2-12 2.5 13.8 1.3-1.8H25";
  var shown = "";   // the colours on the button now, so a page load that repeats them costs nothing
  var told = false; // a page has reported since this worker started, so the stored copy is older

  function canPaint() { return typeof OffscreenCanvas === "function" && typeof Path2D === "function"; }
  // A CSS colour as [r, g, b, a], or null if the canvas cannot read it. The badge calls are given
  // this, since they parse only a few colour syntaxes (not hsl(), oklch() or space-separated rgb()).
  function rgba(value) {
    var context = new OffscreenCanvas(1, 1).getContext("2d");
    context.fillStyle = "black";
    context.fillStyle = value;
    var first = context.fillStyle;
    context.fillStyle = "white";
    context.fillStyle = value;
    if (context.fillStyle !== first) return null;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }
  function readable(value) {
    if (!canPaint()) return true;
    try { return rgba(value) !== null; } catch (_) { return false; }
  }
  // { tile, ink, accent } as CSS colours (--d-action, --d-action-text, --d-accent), or null.
  function usable(colors) {
    if (!colors || typeof colors !== "object") return null;
    var picked = {};
    var ok = ["tile", "ink", "accent"].every(function (name) {
      var value = typeof colors[name] === "string" ? colors[name].trim() : "";
      picked[name] = value;
      return value.length > 0 && value.length <= 64 && readable(value);
    });
    return ok ? picked : null;
  }
  // An action call that cannot throw out of a listener: a thrown error, a rejected promise and
  // chrome.runtime.lastError are all dropped, and the button keeps what it had.
  function act(method, details) {
    var api = chrome.action;
    if (!api || typeof api[method] !== "function") return;
    try {
      var result = api[method](details, function () { void chrome.runtime.lastError; });
      if (result && typeof result.then === "function") result.then(null, function () {});
    } catch (_) {}
  }
  function draw(size, colors) {
    var context = new OffscreenCanvas(size, size).getContext("2d");
    var tile = new Path2D(TILE);
    context.scale(size / 24, size / 24);
    context.fillStyle = colors.tile;
    context.fill(tile);
    context.clip(tile);
    context.globalAlpha = 0.26;
    context.fillStyle = colors.ink;
    context.fill(new Path2D(GROUND));
    context.globalAlpha = 1;
    context.strokeStyle = colors.ink;
    context.lineWidth = 2.6;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(new Path2D(LINE));
    return context.getImageData(0, 0, size, size);
  }
  // Badge colours are set for the whole button, so SBX badges already showing follow a palette change.
  function show(colors) {
    var key = JSON.stringify(colors);
    if (key === shown) return;
    shown = key;
    var art = null;
    if (canPaint()) {
      try {
        art = { images: { 16: draw(16, colors), 32: draw(32, colors) },
          accent: rgba(colors.accent), ink: rgba(colors.ink) };
      } catch (_) {}
    }
    act("setBadgeBackgroundColor", { color: (art && art.accent) || colors.accent });
    act("setBadgeTextColor", { color: (art && art.ink) || colors.ink });
    if (art) act("setIcon", { imageData: art.images });
  }
  function restore() {
    try {
      chrome.storage.local.get(KEY, function (values) {
        if (chrome.runtime.lastError || told) return;
        var colors = usable(values ? values[KEY] : null);
        if (colors) show(colors);
      });
    } catch (_) {}
  }
  function remember(colors) {
    var values = {}; values[KEY] = colors;
    try {
      chrome.storage.local.set(values, function () { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  // This extension's toolbar popup, which has no tab, reports a theme picked in it.
  function fromPopup(sender) {
    try {
      return typeof chrome.runtime.id === "string" && sender.id === chrome.runtime.id &&
        typeof sender.url === "string" && sender.url.indexOf(chrome.runtime.getURL("src/popup/")) === 0;
    } catch (_) { return false; }
  }

  restore();
  if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(restore);
  if (chrome.runtime.onInstalled) chrome.runtime.onInstalled.addListener(restore);
  // Only content scripts (they come with sender.tab) and the popup report. Nothing is replied and the
  // channel is not held, so other listeners, such as the vault's, answer their own kinds.
  chrome.runtime.onMessage.addListener(function (message, sender) {
    if (!message || !sender) return false;
    if (message.kind === "cpPalette" && (sender.tab || fromPopup(sender))) {
      var colors = usable(message.colors);
      if (!colors) return false;
      told = true;
      if (JSON.stringify(colors) !== shown) { remember(colors); show(colors); }
    } else if (message.kind === "cpEnv" && sender.tab && typeof sender.tab.id === "number" && sender.tab.id >= 0) {
      if (message.env === "sandbox") act("setBadgeText", { tabId: sender.tab.id, text: "SBX" });
      else if (message.env === "live") act("setBadgeText", { tabId: sender.tab.id, text: "" });
    }
    return false;
  });
})();
