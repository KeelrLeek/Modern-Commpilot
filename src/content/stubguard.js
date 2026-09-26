// Same-origin reload recovery for the native CommPilot interface.
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
// formtokenserial (bridged from chrome.storage by recovery-bridge.js).
//
// NOTE: an earlier version also patched HTMLFormElement.prototype.submit
// on ALL pages to hijack any redirect-stub whose target contained
// "/Login/". That heuristic cannot distinguish the logout-bounce from the
// legitimate POST-LOGIN HANDOFF stub, so it broke logins — verified live.
// Do not bring it back. Dead-session POSTs bouncing to /Login/ natively is
// correct behavior.
//
// Loop guard: "cp-stub-tries" in sessionStorage — two interstitial
// recoveries without a contentful page load in between (recovery-bridge.js resets the
// counter) means the session is really dead, and /Login/ proceeds normally.
(function () {
  if (window !== window.top) return;
  var path = location.pathname || "";

  var LOGIN = "/commpilot/Login/";
  var HOME = { url: "/commpilot/Common/folder_contents.jsp", params: { folder: "R0", menuId: "8" } };
  var realSubmit = HTMLFormElement.prototype.submit;

  // CP_DEBUG gates the ROUTINE recovery/login trace logs so a normal reload recovery is quiet; every warn stays
  // always-on. Flip with localStorage.cpDebug="1". Separate copy from pjax (different MAIN-world script). See
  // pjax.js CP_DEBUG note.
  var CP_DEBUG = false;
  try { CP_DEBUG = localStorage.getItem("cpDebug") === "1"; } catch (e) {}
  function cpDbg() { if (CP_DEBUG) { try { console.log.apply(console, arguments); } catch (e) {} } }

  function tries() {
    try { return parseInt(sessionStorage.getItem("cp-stub-tries") || "0", 10) || 0; } catch (e) { return 0; }
  }
  function bumpTries() {
    try { sessionStorage.setItem("cp-stub-tries", String(tries() + 1)); sessionStorage.setItem("cp-stub-tries-at", String(Date.now())); } catch (e) {}
  }
  function sessionNav() {
    try { return JSON.parse(sessionStorage.getItem("cp-last-nav") || "null"); } catch (e) { return null; }
  }

  // Preserve CommPilot's own inline styling on fetched pages.
  function cpStripInlineStyles(html) {
    return String(html);
  }

  // The native main-frame POST that commits recovery. Split out of replay()
  // so we can pick the token after an async harvest.
  function cpNativePost(nav, token) {
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

  // Harvest a FRESH, VALID app token from servlet/Login for the recovery replay. Why not just replay the STORED
  // token: it's frequently stale (consumed by the post-recovery console aggregation before the store caught up),
  // and a native POST of a stale token gets a 200 server login-redirect — the reload-recovery flakiness, observed
  // live. A GET to the POST-only folder_contents only yields a "go to Login" stub (a login-context token, also
  // rejected). But servlet/Login is GET-allowed (DNR rule 5) and SESSION-AWARE: while the session is alive it
  // returns redirectPost(folder_contents, {fresh token}) — a freshly-issued VALID app token (the same bounce the
  // live /Login/ page uses to send an already-logged-in user home). Returns that token, or null when the session
  // is dead / it's the login form / network error → caller falls back to the stored token (no regression).
  function cpHarvestOnce() {
    return fetch("/commpilot/servlet/Login", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual" })
      .then(function (r) {
        // redirect:"manual" — a dead session bounces servlet/Login to http:// Login; following it would CSP-fail
        // (mixed content) as a spurious connect-src violation. An opaqueredirect/3xx means "no fresh token" → null
        // (caller falls back to the stored token, identical to before). Only a real 200 body carries a harvestable stub.
        if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) return null;
        return r.text();
      })
      .then(function (html) {
        if (!html) return null;
        var stub = extractStub(new DOMParser().parseFromString(cpStripInlineStyles(html), "text/html"));
        // Only trust a token that arrives WITH an app redirect (folder_contents) — not the login form's own token.
        return (stub && stub.target && stub.target.indexOf("folder_contents") !== -1 && stub.token) ? stub.token : null;
      });
  }
  function cpHarvestToken() {
    // ONE-SHOT retry on a NETWORK error only: the harvest is the FIRST request after idle, so it can hit the same
    // dropped-socket "Failed to fetch" as the dead-click bug (0.2.264) — a second fetch opens a fresh socket. A
    // RESOLVED null (session dead / login form) is definitive and is NOT retried (it passes straight through). The
    // final fallback stays null → caller uses the stored token, identical to before (no 0.2.270 regression).
    return cpHarvestOnce().catch(function () {
      return new Promise(function (res) { setTimeout(res, 250); }).then(cpHarvestOnce);
    }).catch(function () { return null; });
  }

  function replay(nav, token) {
    // Never replay across origins. The recovery store is per-host + path-only now, but guard against any absolute
    // foreign URL (e.g. stale legacy global-store data) so apps01 can't be POSTed to the sandbox host.
    try { if (/^https?:\/\//i.test(nav.url) && nav.url.indexOf(location.origin + "/") !== 0) { location.replace("/commpilot/Login/"); return; } } catch (e) {}
    // Mark that a recovery replay is in flight, so a FAILED replay landing on /Login/ or the "temporarily
    // unavailable" error page can be detected and auto-retried ONCE (instead of forcing a manual re-login).
    try { sessionStorage.setItem("cp-replay-at", String(Date.now())); } catch (e) {}
    // FETCH-VERIFY: harvest a fresh token first, then native-POST with it. A native POST of a possibly-stale
    // STORED token is the recovery-flakiness root (→ 200 login-redirect). If the harvest yields a fresh token we
    // commit with that; if it fails for ANY reason (session dead, login page, network error, timeout) we fall
    // back to the stored token = the previous behaviour exactly (NO REGRESSION). Bounded by a timeout so a hung
    // fetch can't strand recovery.
    var committed = false;
    // Re-establish the ENTITY context before the final nav. The recovery lands on a session whose navigation
    // target was reset (the GET that triggered recovery / the harvest bounce), so replaying an SP/Group/User-
    // scoped nav alone answers "There is no target object to get viewable features" → 500s or a logout (live
    // repro: F5 on an SP Schedules grid, 2026-07-04). nav.entry = the nav that last CHANGED the sidebar level
    // (recorded by pjax): POST it in the background first and thread ITS fresh token into the final POST.
    function cpEnterEntity(entry, tok) {
      var body = [];
      var p = entry.params || {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) body.push(encodeURIComponent(k) + "=" + encodeURIComponent(p[k]));
      if (tok) body.push("formtokenserial=" + encodeURIComponent(tok));
      return fetch(entry.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        credentials: "same-origin",
        redirect: "manual",
        body: body.join("&")
      }).then(function (r) {
        if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) return null;
        return r.text();
      }).then(function (html) {
        if (!html) return null;
        var doc = new DOMParser().parseFromString(cpStripInlineStyles(html), "text/html");
        var t = doc.getElementsByName("formtokenserial")[0];
        if (t && t.value) return t.value;
        // A drill entry may answer with a redirect stub (context set + follow-on hop) — its token works too.
        var stub = extractStub(doc);
        return (stub && stub.token) ? stub.token : null;
      }).catch(function () { return null; });
    }
    function commit(tok, why) {
      if (committed) return; committed = true;
      var entry = nav && nav.entry;
      // One-shot hand-off to pjax.js on the landing page (cpReloadEntry): which entity entry this replay
      // re-established, so an SP/Group/User folder board can restore the context after its folder reads.
      try {
        sessionStorage.setItem("cp-reload-nav", JSON.stringify({ url: nav.url, params: nav.params || {},
          entry: entry && entry.url ? { url: entry.url, params: entry.params || {} } : null, at: Date.now() }));
      } catch (e) {}
      if (entry && entry.url && entry.url !== nav.url && !/^https?:\/\//i.test(entry.url)) {
        cpDbg("[stubguard] recovery replay — " + why + " + entity re-entry first: " + entry.url);
        cpEnterEntity(entry, tok).then(function (etok) { cpNativePost(nav, etok || tok); });
        return;
      }
      cpDbg("[stubguard] recovery replay — " + why);
      cpNativePost(nav, tok);
    }
    try {
      cpHarvestToken().then(
        function (fresh) { commit(fresh || token, fresh ? "fresh token harvested" : "harvest empty → stored token"); },
        function () { commit(token, "harvest rejected → stored token"); }
      );
    } catch (e) { commit(token, "harvest threw → stored token"); }
    // 8000ms (was 3500): a cold TLS re-handshake + server round-trip after an idle dropped socket routinely
    // exceeds 3.5s; committing the STORED (possibly-consumed) token early was forcing a 200 /Login/ bounce.
    setTimeout(function () { commit(token, "harvest timeout → stored token"); }, 8000);
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

  // Native login and logout remain under CommPilot control.
  // Let CommPilot render and process its login page normally.
  if (path.indexOf("/Login/") !== -1) return;

  if (path.indexOf("/Logout/") !== -1) return;

  // Query recovery-bridge.js (ISOLATED world) for the stored nav + token, then hand
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
        cpDbg("[stubguard] " + label + " → replay", nav.url);
        replay(nav, token);
      } else {
        // No stored token (slow/failed storage bridge on a cold service-worker, OR the bridge answered with none).
        // Rather than log out immediately, let replay() try to HARVEST a fresh token from servlet/Login first —
        // it commits a native POST only after the harvest, and a genuinely dead session still ends on Login (the
        // harvest yields null → a null-token POST bounces there). Net-safer: an alive-but-slow-bridge session
        // recovers instead of being ejected. See [[gotcha-idle-connection-drop-dead-click]] (bridge race).
        cpDbg("[stubguard] " + label + " — no stored token; harvest-replay before Login");
        replay(nav, null);
      }
    };
    // 3000ms (was 800): a cold service-worker + chrome.storage read via the recovery bridge routinely exceeds 800ms,
    // and firing the fallback with a null token used to log out a still-alive session. Give the real token time to
    // arrive; the fallback now attempts a harvest-replay anyway (above) rather than an immediate Login.
    var fallback = setTimeout(function () {
      finish(sessionNav(), null);
    }, 3000);
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
    // EXPIRE a stale loop-guard counter before the short-circuit. cp-stub-tries survives reloads and is reset only
    // when a contentful app page renders (recovery-bridge.js saveToken), so heavy churn (many extension reloads / earlier
    // cold-URL bounces) can leave it >=2 and send a FRESH, unrelated idle reload straight to Login with NO replay.
    // A genuine dead-session loop is RAPID (back-to-back reloads); a real idle reload is minutes later — so if the
    // last attempt was >30s ago, treat this as a new recovery cycle and reset, leaving the guard to catch only true
    // rapid loops. See [[gotcha-idle-connection-drop-dead-click]].
    // Reset when the last bump was >30s ago OR its timestamp is MISSING (older data written before the stamp
    // existed, or a cleared key): a missing timestamp must count as stale so a leftover counter can't short-circuit
    // a fresh idle reload to Login. (Fix 1a hardened — was gated on `_bAt &&`, which left a stampless counter stuck.)
    try { var _bAt = parseInt(sessionStorage.getItem("cp-stub-tries-at") || "0", 10) || 0; if (!_bAt || (Date.now() - _bAt > 30000)) sessionStorage.setItem("cp-stub-tries", "0"); } catch (e) {}
    if (tries() >= 2) {
      location.replace(LOGIN);
      return;
    }
    bumpTries();
    bridgeRecover("interstitial recovery", function () { location.replace(LOGIN); });
  }
})();
