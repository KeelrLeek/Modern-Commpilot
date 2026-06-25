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
    // Never replay across origins. The recovery store is per-host + path-only now, but guard against any absolute
    // foreign URL (e.g. stale legacy global-store data) so apps01 can't be POSTed to the sandbox host.
    try { if (/^https?:\/\//i.test(nav.url) && nav.url.indexOf(location.origin + "/") !== 0) { location.replace("/commpilot/Login/"); return; } } catch (e) {}
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
      var el = doc.querySelector(".loginerror");
      if (el && el.textContent.trim()) msg = el.textContent.trim();
      if (!msg) {
        var cand = Array.prototype.slice.call(doc.querySelectorAll("td,span,div,p,b,font")).find(function (e) {
          return e.childElementCount === 0 && /not authorized|login again|session timeout|invalid|incorrect|failed|disabled|locked|expired|suspend/i.test(e.textContent || "");
        });
        if (cand) msg = cand.textContent.trim();
      }
      if (!msg) msg = "Sign-in failed. Please check your User ID and password and try again.";
      // Insert into the form panel (split-panel login) — falling back to the card.
      // .cp-login-field now lives inside .cp-login-form-panel, so inserting relative
      // to it must use that panel as the parent (card.insertBefore threw silently).
      var panel = document.querySelector(".cp-login-form-panel") || document.querySelector(".cp-login-card");
      if (!panel) return;
      var al = panel.querySelector(".cp-login-alert");
      if (!al) {
        al = document.createElement("div");
        al.className = "cp-login-alert";
        al.innerHTML = '<svg class="cp-login-alert-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span class="cp-login-alert-msg"></span>';
        panel.insertBefore(al, panel.querySelector(".cp-login-field") || null);
      }
      (al.querySelector(".cp-login-alert-msg") || al).textContent = msg;
    } catch (e) {}
  }

  // ---- Single-navigation login (/Login/ pages only) ----------------------
  if (path.indexOf("/Login/") !== -1) {
    var armedLogin = true;

    function cpLoginFollow(u, p, token, depth) {
      var fb = new URLSearchParams();
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) fb.append(k, p[k]);
      if (token) fb.append("formtokenserial", token);
      return fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: fb.toString(),
        credentials: "same-origin"
      })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          if (html.indexOf("Please login again") !== -1 || html.indexOf("not authorized to access the system") !== -1) return { auth: false };
          var d = new DOMParser().parseFromString(html, "text/html");
          if (d.querySelector('td[width="82%"]')) return { doc: d };
          var stub = extractStub(d);
          if (stub && stub.target && depth < 4) {
            if (stub.target.indexOf("/Login/") !== -1) return { fallback: true };
            console.log("[stubguard] morph following stub ->", stub.target);
            return cpLoginFollow(stub.target, stub.data, stub.token, depth + 1);
          }
          return { doc: d };
        });
    }

    function morphIntoApp(stub) {
      if (!window.__cpReexec || !window.__cpPjaxMorphed) {
        console.warn("[stubguard] morph helpers missing — native fallback");
        replay({ url: stub.target, params: stub.data }, stub.token);
        return;
      }
      cpLoginFollow(stub.target, stub.data, stub.token, 0)
        .then(function (res) {
          if (!res || res.auth === false || res.fallback || !res.doc.querySelector('td[width="82%"]')) {
            console.warn("[stubguard] morph follow failed — native fallback");
            replay({ url: stub.target, params: stub.data }, stub.token);
            return;
          }
          var doc = res.doc;
          try { document.title = doc.title; } catch (e) {}
          /* Merge stylesheets and styles from doc.head */
          var liveHead = document.head || document.documentElement;
          doc.head.querySelectorAll("link[rel=stylesheet], style").forEach(function (el) {
            var key = el.tagName === "LINK" ? el.getAttribute("href") : (el.textContent || "").trim().slice(0, 200);
            if (!key) return;
            var exists = Array.prototype.some.call(liveHead.querySelectorAll("link[rel=stylesheet], style"), function (existing) {
              if (el.tagName === "LINK" && existing.tagName === "LINK") return existing.getAttribute("href") === key;
              if (el.tagName === "STYLE" && existing.tagName === "STYLE") return (existing.textContent || "").trim().slice(0, 200) === key;
              return false;
            });
            if (!exists) liveHead.appendChild(el.cloneNode(true));
          });
          /* Replace body wholesale */
          var liveBody = document.body;
          for (var ai = liveBody.attributes.length - 1; ai >= 0; ai--) liveBody.removeAttribute(liveBody.attributes[ai].name);
          for (var ai2 = 0; ai2 < doc.body.attributes.length; ai2++) liveBody.setAttribute(doc.body.attributes[ai2].name, doc.body.attributes[ai2].value);
          liveBody.innerHTML = doc.body.innerHTML;
          /* Re-exec head scripts not already present */
          var headScripts = [];
          doc.head.querySelectorAll("script").forEach(function (oldScript) {
            var key = oldScript.src || (oldScript.textContent || "").trim().slice(0, 200);
            if (!key) return;
            var exists = Array.prototype.some.call(liveHead.querySelectorAll("script"), function (existing) {
              if (oldScript.src) return existing.src === oldScript.src;
              return !existing.src && (existing.textContent || "").trim().slice(0, 200) === key;
            });
            if (!exists) headScripts.push(oldScript.cloneNode(true));
          });
          var headWrapper = null;
          if (headScripts.length > 0) {
            headWrapper = document.createElement("div");
            headWrapper.style.display = "none";
            document.body.appendChild(headWrapper);
            for (var hi = 0; hi < headScripts.length; hi++) headWrapper.appendChild(headScripts[hi]);
          }
          var headReady = headScripts.length > 0
            ? window.__cpReexec([headWrapper])
            : Promise.resolve(0);
          /* Move head script nodes to live head synchronously (nodes exist even if src hasn't loaded) */
          if (headWrapper) {
            while (headWrapper.firstChild) liveHead.appendChild(headWrapper.firstChild);
            document.body.removeChild(headWrapper);
          }
          /* Chain body reexec + pjax wiring + reveal after all head scripts have loaded */
          headReady
            .then(function () {
              return window.__cpReexec([liveBody]);
            })
            .then(function () {
              var pjaxOk = window.__cpPjaxMorphed({ url: stub.target, params: stub.data });
              if (!pjaxOk) console.warn("[stubguard] __cpPjaxMorphed returned false — pjax unavailable");
              try { document.documentElement.classList.remove("cp-stub-hold"); } catch (e) {}
              document.dispatchEvent(new Event("cp:morphed"));
            })
            .catch(function (e) {
              console.warn("[stubguard] morph failed — native fallback", e);
              replay({ url: stub.target, params: stub.data }, stub.token);
            });
        })
        .catch(function (e) {
          console.warn("[stubguard] morph failed — native fallback", e);
          replay({ url: stub.target, params: stub.data }, stub.token);
        });
    }

    function loginFetchFlow(form, attempt) {
      attempt = attempt || 0;
      var loginFlowStart = Date.now();
      document.dispatchEvent(new CustomEvent("cp:loginsplash"));
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
            if (stub.target.indexOf("/Login/") !== -1) {
              console.log("[stubguard] login produced /Login/ stub — failed login");
            } else {
              console.log("[stubguard] login ok — morphing into app via", stub.target);
              morphIntoApp(stub);
              return;
            }
          }
          // No handoff stub, or /Login/ stub — login failed.
          console.log("[stubguard] login produced no handoff — staying on form");
          armedLogin = true; // re-arm immediately so a quick retry never falls through to native submit
          var liveTok = form.querySelector('input[name="formtokenserial"]');
          var MIN_SPLASH = 600;
          var showFail = function (errDoc) {
            var freshTok = errDoc.getElementsByName("formtokenserial")[0];
            if (freshTok && liveTok) liveTok.value = freshTok.value;

            // Idle "stale session / not authorized" glitch: the first POST after long idle is rejected on a
            // stale token (regardless of credentials) and the rejection mints a fresh token (just swapped into
            // the form above). Re-submit ONCE, silently, under the splash. This is gated on the SPECIFIC
            // session-timeout / not-authorized message — "Authentication failed" (wrong password), account
            // "disabled", and lockout messages use different text and are NEVER auto-retried, so wrong
            // passwords are never silently hammered. Capped at one retry (attempt < 1) so it can never loop.
            if (attempt < 1 && freshTok) {
              var staleGlitch = false;
              errDoc.querySelectorAll(".loginerror").forEach(function (e) {
                if (/not authorized to access the system|session timeout/i.test(e.textContent || "")) staleGlitch = true;
              });
              if (staleGlitch) {
                console.log("[stubguard] stale-session login glitch — silent retry with fresh token");
                armedLogin = false;            // we drive the retry directly; prevent a stray submit piling on
                loginFetchFlow(form, attempt + 1);
                return;                         // keep splash up; skip showing the error
              }
            }

            var reveal = function () { showLoginError(errDoc); splashDown(); };
            var elapsed = Date.now() - loginFlowStart;
            if (elapsed < MIN_SPLASH) { setTimeout(reveal, MIN_SPLASH - elapsed); } else { reveal(); }
          };
          // The failure response is a stub with no message; the real error (td.loginerror) is
          // session-stored and renders on a GET of the login page.
          fetch("/commpilot/Login/", { credentials: "same-origin" })
            .then(function (r) { return r.text(); })
            .then(function (loginHtml) { showFail(new DOMParser().parseFromString(loginHtml, "text/html")); })
            .catch(function () { showFail(doc); });
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
