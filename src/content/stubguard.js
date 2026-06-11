// Same-origin reload recovery + single-navigation login.
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
// harvested from real logged-in pages by skin.js).
//
// The login branch exists because the white "between documents" flash is
// the browser's own canvas — unpaintable by page code — and it appears per
// navigation. Native login burns THREE documents (login → auth stub →
// home). Here the slow auth POST happens via fetch while the dark login
// page stays on screen, and only the final fast hop is a real navigation.
// Failed logins never navigate at all: the error renders inline on the
// card and the fresh token from the response is swapped in for the retry.
//
// NOTE: an earlier version also patched HTMLFormElement.prototype.submit
// on ALL pages to hijack any redirect-stub whose target contained
// "/Login/". That heuristic cannot distinguish the logout-bounce from the
// legitimate POST-LOGIN HANDOFF stub, so it broke logins — verified live.
// Do not bring it back. Dead-session POSTs bouncing to /Login/ natively is
// correct behavior.
//
// Loop guard: "cp-stub-tries" in sessionStorage — two interstitial
// recoveries without a contentful page load in between (skin.js resets the
// counter) means the session is really dead, and /Login/ proceeds normally.
(function () {
  if (window !== window.top) return;
  var path = location.pathname || "";

  var LOGIN = "/commpilot/Login/";
  var HOME = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
  var realSubmit = HTMLFormElement.prototype.submit;

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

  // Parse a redirect-stub document: target URL, data object, fresh token.
  function extractStub(doc) {
    var ss = doc.querySelectorAll("script");
    var src = "";
    for (var i = 0; i < ss.length; i++) src += (ss[i].textContent || "") + "\n";
    var m = /redirectPost\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/.exec(src);
    if (!m) return null;
    var data = {};
    var re = /(\w+)\s*:\s*['"]([^'"]*)['"]/g, mm;
    while ((mm = re.exec(m[2]))) data[mm[1]] = mm[2];
    var tEl = doc.getElementsByName("formtokenserial")[0];
    return { target: m[1].replace(/\\u002F/g, "/"), data: data, token: tEl ? tEl.value : null };
  }

  // Dark splash — same look as cloak.js paints on incoming documents.
  function splashUp() {
    try { document.documentElement.classList.add("cp-stub-hold"); } catch (e) {}
    if (document.getElementById("cp-cloak")) return;
    var o = document.createElement("div");
    o.id = "cp-cloak";
    o.setAttribute(
      "style",
      "position:fixed;inset:0;z-index:2147483647;background:#1c1b19;" +
        "display:flex;align-items:center;justify-content:center;" +
        "font:600 14px/1.4 'Nunito','Segoe UI',system-ui,sans-serif;color:#6b6862;"
    );
    o.textContent = "CommPilot";
    document.documentElement.appendChild(o);
    if (o.animate) o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }
  function splashDown() {
    try { document.documentElement.classList.remove("cp-stub-hold"); } catch (e) {}
    var o = document.getElementById("cp-cloak");
    if (!o) return;
    var drop = function () { try { o.remove(); } catch (e) {} };
    if (o.animate) {
      o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out" }).onfinish = drop;
      setTimeout(drop, 400);
    } else {
      drop();
    }
  }

  function showLoginError(doc) {
    try {
      var msg = "";
      var cand = Array.prototype.slice.call(doc.querySelectorAll("td,span,div,p,b,font")).find(function (el) {
        return el.childElementCount === 0 &&
          /not authorized|login again|session timeout|invalid|incorrect|failed/i.test(el.textContent || "");
      });
      if (cand) msg = cand.textContent.trim();
      if (!msg) msg = "Sign-in failed. Please check your User ID and password and try again.";
      var card = document.querySelector(".cp-login-card");
      if (!card) return;
      var al = card.querySelector(".cp-login-alert");
      if (!al) {
        al = document.createElement("div");
        al.className = "cp-login-alert";
        card.insertBefore(al, card.querySelector(".cp-login-field") || null);
      }
      al.textContent = msg;
    } catch (e) {}
  }

  // ---- Single-navigation login (/Login/ pages only) ----------------------
  if (path.indexOf("/Login/") !== -1) {
    var armedLogin = true;

    function loginFetchFlow(form) {
      splashUp();
      var body = new URLSearchParams();
      try {
        new FormData(form).forEach(function (v, k) { body.append(k, v); });
      } catch (e) {}
      fetch(String(form.getAttribute("action") || form.action), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "same-origin"
      })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          var stub = extractStub(doc);
          if (stub && stub.target && stub.token) {
            console.log("[stubguard] login ok — entering app via", stub.target);
            replay({ url: stub.target, params: stub.data }, stub.token);
            return;
          }
          // No handoff stub — login failed (or unexpected page). Stay on
          // this page: refresh the token so a retry is valid, show why.
          console.log("[stubguard] login produced no handoff — staying on form");
          var freshTok = doc.getElementsByName("formtokenserial")[0];
          var liveTok = form.querySelector('input[name="formtokenserial"]');
          if (freshTok && liveTok) liveTok.value = freshTok.value;
          showLoginError(doc);
          splashDown();
          armedLogin = true;
        })
        .catch(function (e) {
          console.warn("[stubguard] login fetch failed — native fallback", e);
          try { realSubmit.call(form); } catch (err) {}
        });
    }

    HTMLFormElement.prototype.submit = function () {
      try {
        if (armedLogin && this.querySelector('input[name="Password"]')) {
          armedLogin = false;
          loginFetchFlow(this);
          return;
        }
      } catch (e) {}
      return realSubmit.apply(this, arguments);
    };
    return;
  }

  if (path.indexOf("/Logout/") !== -1) return;

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
  }
})();
