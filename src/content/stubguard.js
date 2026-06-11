// Same-origin reload recovery, v3.
//
// Why this shape: the app is POST-only — any main-frame GET that reaches a
// session-aware endpoint invalidates the session's token state (replaying
// even a known-good stored token afterwards gets answered with another
// redirect-stub, verified live). So, like the original recover.html design,
// the DNR ruleset stops the GET from ever reaching a JSP — but instead of
// bouncing through a cross-origin extension page (which breaks the
// browser's paint holding and flashes the theme background), it redirects
// to /commpilot/Common/styles.css: a static same-origin file with no
// session logic. Content scripts inject there; this script recognizes the
// interstitial and re-POSTs the last meaningful navigation with the stored
// formtokenserial (bridged from chrome.storage by cloak.js — tokens
// harvested from real logged-in pages by skin.js). Every hop is
// same-origin, so paint holding keeps the previous page (or the dark
// cloak) on screen end to end.
//
// Defense in depth: if a redirect-stub document ever does load (fetch-level
// GETs, dead sessions), the HTMLFormElement.prototype.submit patch below
// hijacks its auto-redirect to /Login/ and attempts the same replay.
// Loop guard: "cp-stub-tries" in sessionStorage — two recovery attempts
// without a contentful page load in between (skin.js resets the counter)
// means the session is really dead, and /Login/ proceeds normally.
(function () {
  if (window !== window.top) return;
  var path = location.pathname || "";
  if (path.indexOf("/Login/") !== -1 || path.indexOf("/Logout/") !== -1) return;

  var LOGIN = "/commpilot/Login/";
  var HOME = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
  var realSubmit = HTMLFormElement.prototype.submit;

  function pageHasContent() {
    return !!document.querySelector('td[width="82%"], form[name="loginForm"], a.navMenuItem, .navOptions');
  }
  function tries() {
    try { return parseInt(sessionStorage.getItem("cp-stub-tries") || "0", 10) || 0; } catch (e) { return 0; }
  }
  function bumpTries() {
    try { sessionStorage.setItem("cp-stub-tries", String(tries() + 1)); } catch (e) {}
  }
  function sessionNav() {
    try { return JSON.parse(sessionStorage.getItem("cp-last-nav") || "null"); } catch (e) { return null; }
  }

  function replay(nav, token) {
    var f = document.createElement("form");
    f.method = "POST";
    f.action = nav.url;
    function add(n, v) {
      var i = document.createElement("input");
      i.type = "hidden"; i.name = n; i.value = v;
      f.appendChild(i);
    }
    var p = nav.params || {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) add(k, p[k]);
    add("formtokenserial", token);
    (document.body || document.documentElement).appendChild(f);
    realSubmit.call(f);
  }

  // Query cloak.js (ISOLATED world) for the stored nav + token, then hand
  // {nav, token} to finish() — nav falls back to sessionStorage, then HOME.
  // onNoToken runs when there is nothing usable to replay.
  function bridgeRecover(label, onNoToken) {
    var settled = false;
    var ask = null;
    var finish = function (nav, token) {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      if (ask) clearInterval(ask);
      if (!(nav && nav.url)) nav = HOME;
      if (token) {
        console.log("[stubguard] " + label + " → replay", nav.url);
        replay(nav, token);
      } else {
        console.log("[stubguard] " + label + " — no stored token, going to Login");
        onNoToken();
      }
    };
    var fallback = setTimeout(function () {
      finish(sessionNav(), null);
    }, 800);
    window.addEventListener("message", function onReply(e) {
      if (e.source !== window || !e.data || !("__cpStubNavReply" in e.data)) return;
      window.removeEventListener("message", onReply);
      var stored = e.data.__cpStubNavReply || {};
      finish(sessionNav() || stored.nav, stored.token || null);
    });
    ask = setInterval(function () {
      if (settled) { clearInterval(ask); return; }
      try { window.postMessage({ __cpStubNavQuery: 1 }, location.origin); } catch (e) {}
    }, 100);
    try { window.postMessage({ __cpStubNavQuery: 1 }, location.origin); } catch (e) {}
  }

  // ---- Recovery interstitial (DNR redirected a main-frame GET here) ----
  if (path === "/commpilot/Common/styles.css") {
    try { document.documentElement.classList.add("cp-stub-hold"); } catch (e) {}
    if (tries() >= 2) {
      location.replace(LOGIN);
      return;
    }
    bumpTries();
    bridgeRecover("interstitial recovery", function () { location.replace(LOGIN); });
    return;
  }

  // ---- Stub hijack (defense in depth) -----------------------------------
  var armed = true;
  HTMLFormElement.prototype.submit = function () {
    try {
      if (
        armed &&
        (document.readyState === "loading" || document.readyState === "interactive") &&
        !pageHasContent() &&
        String(this.action || "").indexOf("/Login/") !== -1 &&
        tries() < 2
      ) {
        armed = false;
        bumpTries();
        try { document.documentElement.classList.add("cp-stub-hold"); } catch (e) {}
        var loginForm = this;
        bridgeRecover("stub hijack", function () {
          try { realSubmit.call(loginForm); } catch (e) {}
        });
        return;
      }
    } catch (e) {}
    return realSubmit.apply(this, arguments);
  };
})();
