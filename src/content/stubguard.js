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

  // Recovery data can outlive the code that saved it. Validate both the destination and its entity entry
  // at the replay boundary; a malformed URL or an old form submission must never be posted on Reload.
  function recoveryNav(value, isEntry) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.url !== "string") return null;
      var url = new URL(value.url, location.href);
      if (url.origin !== location.origin || url.username || url.password || !url.pathname.startsWith("/commpilot/") ||
          /\/(?:Login|Logout|servlet|Add|AddRange|AddModify|Import|Delete)(?:\/|$)/i.test(decodeURIComponent(url.pathname))) return null;
      var source = value.params || {}, params = Object.create(null);
      if (typeof source !== "object" || Array.isArray(source)) return null;
      function mutation(name, val) {
        return /^(?:ok|apply|delete|cancel|save|submit|__cpFormEntries)$/i.test(name) ||
          /password|secret|passcode|^pin$/i.test(name) || /^buttonClicked$/i.test(name) && String(val || "").trim() !== "";
      }
      for (var pair of [...url.searchParams.entries()]) {
        if (mutation(pair[0], pair[1])) return null;
        if (/^formtokenserial$/i.test(pair[0])) url.searchParams.delete(pair[0]);
      }
      for (var key of Object.keys(source)) {
        if (mutation(key, source[key]) || source[key] !== null && typeof source[key] === "object") return null;
        if (/^(?:formtokenserial|__proto__|constructor|prototype)$/i.test(key)) continue;
        params[key] = source[key];
      }
      var entry = !isEntry && value.entry ? recoveryNav(value.entry, true) : null;
      if (!isEntry && value.entry && !entry) return null;
      return { url: url.pathname + url.search, params: params, entry: entry };
    } catch (e) { return null; }
  }

  function recoveryFailed(message) {
    // A paused read/transport failure is not a failed native replay loop. A later
    // manual reload must be allowed to check the session again; otherwise two
    // network failures force Login even after the connection has recovered.
    try { sessionStorage.removeItem('cp-stub-tries'); sessionStorage.removeItem('cp-stub-tries-at'); } catch (e) {}
    document.documentElement.classList.remove('cp-stub-hold');
    document.documentElement.classList.add('cp-recovery-page');
    document.getElementById('cp-cloak')?.remove();
    try { sessionStorage.removeItem('cp-replay-at'); sessionStorage.removeItem('cp-reload-nav'); } catch (e) {}
    var panel = document.createElement('section');
    panel.id = 'cp-recovery-error';
    panel.setAttribute('role', 'alert');
    var title = document.createElement('div');
    title.className = 'cp-alert-title'; title.textContent = 'Page recovery paused';
    var body = document.createElement('p');
    body.className = 'cp-alert-body'; body.textContent = message;
    var retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'cp-alert-act'; retry.textContent = 'Retry recovery';
    retry.addEventListener('click', function () {
      retry.disabled = true;
      try { sessionStorage.setItem('cp-stub-tries', '0'); } catch (e) {}
      location.reload();
    });
    var login = document.createElement('button');
    login.type = 'button'; login.className = 'cp-alert-act'; login.textContent = 'Go to login';
    login.addEventListener('click', function () {
      retry.disabled = true; login.disabled = true;
      // Abandon only this tab's recovery. Leaving cp-last-nav behind would make
      // pjax schedule the same failed destination again after the next sign-in.
      ['cp-last-nav', 'cp-pending-return', 'cp-return-at', 'cp-replay-at',
        'cp-reload-nav', 'cp-stub-tries', 'cp-stub-tries-at'].forEach(function (key) {
        try { sessionStorage.removeItem(key); } catch (e) {}
      });
      // Reuse the saved-sign-in pause so an automatic account does not immediately
      // undo this explicit choice. Navigation still works if storage is unavailable.
      try { sessionStorage.setItem('bwManualLogoutAt', String(Date.now())); } catch (e) {}
      location.replace(LOGIN);
    });
    var actions = document.createElement('div');
    actions.className = 'cp-recovery-actions'; actions.append(retry, login);
    panel.append(title, body, actions);
    var parent = document.body || document.documentElement;
    if (document.body) { document.body.classList.add('cp-recovery-page'); document.body.replaceChildren(panel); }
    else parent.appendChild(panel);
    function palette() {
      if (document.documentElement.dataset.cpDirection) {
        panel.dataset.cpPalette = document.documentElement.dataset.cpDirection;
        document.documentElement.dataset.cpPalette = panel.dataset.cpPalette;
        if (document.body) document.body.dataset.cpPalette = panel.dataset.cpPalette;
      }
    }
    palette();
    document.addEventListener('cp:theme-change', palette);
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
  // live /Login/ page uses to send an already-logged-in user home). Returns the token and authenticated home, or null when the session
  // is dead / it's the login form. Network and server errors reject: they do not establish session expiry.
  function cpHarvestOnce(signal) {
    return fetch("/commpilot/servlet/Login", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual", signal: signal })
      .then(function (r) {
        if (r.status >= 400 && r.status !== 401) {
          var error = new Error('Session check HTTP ' + r.status);
          error.noRetry = true;
          throw error;
        }
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
        var home = stub && stub.target && stub.target.indexOf("folder_contents") !== -1 &&
          recoveryNav({url:stub.target,params:stub.data}, true);
        return home && stub.token ? {token:stub.token,home:home} : null;
      });
  }
  function cpHarvestToken(signal) {
    // ONE-SHOT retry on a NETWORK error only: the harvest is the FIRST request after idle, so it can hit the same
    // dropped-socket "Failed to fetch" as the dead-click bug (0.2.264) — a second fetch opens a fresh socket. A
    // RESOLVED null (session dead / login form) is definitive and is NOT retried (it passes straight through). The
    // HTTP failures and two failed connections stop recovery; do not spend an unverified stored token.
    return cpHarvestOnce(signal).catch(function (error) {
      if (signal.aborted) return null;
      if (error.noRetry) throw error;
      return new Promise(function (res) { setTimeout(res, 250); }).then(function () {
        return signal.aborted ? null : cpHarvestOnce(signal);
      });
    });
  }

  function replay(nav, token) {
    nav = recoveryNav(nav, false);
    var useHome = !nav;
    if (!nav) {
      nav = HOME;
      try { sessionStorage.removeItem("cp-last-nav"); } catch (e) {}
    }
    // Mark that a recovery replay is in flight, so a FAILED replay landing on /Login/ or the "temporarily
    // unavailable" error page can be detected and auto-retried ONCE (instead of forcing a manual re-login).
    try { sessionStorage.setItem("cp-replay-at", String(Date.now())); } catch (e) {}
    // FETCH-VERIFY: harvest a fresh token first, then native-POST with it. A native POST of a possibly-stale
    // STORED token is the recovery-flakiness root (→ 200 login-redirect). If the harvest yields a fresh token we
    // commit with that. A settled unauthenticated response keeps the native expiry fallback. A request still pending
    // at the deadline must stop recovery instead: it may rotate the token after a fallback POST has started.
    var committed = false, stopped = false;
    var harvestController = new AbortController();
    var harvestTimeout;
    function stopRecovery(message) {
      if (committed || stopped) return;
      stopped = true;
      clearTimeout(harvestTimeout);
      harvestController.abort();
      recoveryFailed(message);
    }
    // Re-establish the ENTITY context before the final nav. The recovery lands on a session whose navigation
    // target was reset (the GET that triggered recovery / the harvest bounce), so replaying an SP/Group/User-
    // scoped nav alone answers "There is no target object to get viewable features" → 500s or a logout (live
    // repro: F5 on an SP Schedules grid, 2026-07-04). nav.entry = the nav that last CHANGED the sidebar level
    // (recorded by pjax): POST it in the background first and thread ITS fresh token into the final POST.
    function cpEnterEntity(entry, tok) {
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 12000);
      var body = [];
      var p = entry.params || {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) body.push(encodeURIComponent(k) + "=" + encodeURIComponent(p[k]));
      if (tok) body.push("formtokenserial=" + encodeURIComponent(tok));
      return fetch(entry.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        credentials: "same-origin",
        redirect: "manual",
        signal: controller.signal,
        body: body.join("&")
      }).then(function (r) {
        if (r.type === "opaqueredirect" || r.status === 0 || r.status >= 300) return null;
        return r.text();
      }).then(function (html) {
        if (!html) return null;
        var doc = new DOMParser().parseFromString(cpStripInlineStyles(html), "text/html");
        var t = doc.getElementsByName("formtokenserial")[0];
        if (t && t.value && doc.querySelector('td[width="82%"]')) return t.value;
        // A drill entry may answer with a redirect stub (context set + follow-on hop) — its token works too.
        var stub = extractStub(doc);
        return (stub && stub.token && recoveryNav({url:new URL(stub.target, new URL(entry.url, location.href)).href,params:stub.data}, true)) ? stub.token : null;
      }).catch(function () { return null; }).finally(function () { clearTimeout(timeout); });
    }
    function commit(tok, why, home) {
      if (committed || stopped) return; committed = true;
      clearTimeout(harvestTimeout);
      // When no valid saved location exists, use the authenticated landing returned by CommPilot. A group
      // or user administrator must not be sent to the reseller R0 menu just because recovery state is empty.
      if (useHome && home) nav = home;
      var entry = nav && nav.entry;
      // One-shot hand-off to pjax.js on the landing page (cpReloadEntry): which entity entry this replay
      // re-established, so an SP/Group/User folder board can restore the context after its folder reads.
      try {
        sessionStorage.setItem("cp-reload-nav", JSON.stringify({ url: nav.url, params: nav.params || {},
          entry: entry && entry.url ? { url: entry.url, params: entry.params || {} } : null, at: Date.now() }));
      } catch (e) {}
      if (entry && entry.url && entry.url !== nav.url && !/^https?:\/\//i.test(entry.url)) {
        cpDbg("[stubguard] recovery replay — " + why + " + entity re-entry first: " + entry.url);
        cpEnterEntity(entry, tok).then(function (etok) {
          if (etok) cpNativePost(nav, etok);
          else recoveryFailed('CommPilot could not restore the selected user or group. The destination was not opened. Wait a moment, then retry recovery.');
        });
        return;
      }
      cpDbg("[stubguard] recovery replay — " + why);
      cpNativePost(nav, tok);
    }
    try {
      cpHarvestToken(harvestController.signal).then(
        function (fresh) { commit(fresh ? fresh.token : token, fresh ? "fresh token harvested" : "harvest empty → stored token", fresh && fresh.home); },
        function () { stopRecovery('CommPilot could not refresh this session. Recovery stopped before reopening your last page. Wait a moment, then retry recovery.'); }
      );
    } catch (e) { stopRecovery('CommPilot could not refresh this session. Wait a moment, then retry recovery.'); }
    // A cold connection gets eight seconds. Do not race an unfinished harvest with a stored-token POST.
    harvestTimeout = setTimeout(function () {
      stopRecovery('CommPilot did not finish refreshing this session. Recovery stopped before reopening your last page. Wait a moment, then retry recovery.');
    }, 8000);
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

  // Query recovery-bridge.js (ISOLATED world) for a fallback token. The saved destination must belong
  // to this tab: host-wide navigation may have been written by a different tab viewing another user.
  // onNoToken runs when there is nothing usable to replay.
  function bridgeRecover(label, onNoToken) {
    var settled = false;
    var ask = null;
    var finish = function (nav, token) {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      if (ask) clearInterval(ask);
      if (token) {
        cpDbg("[stubguard] " + label + " → replay", nav && nav.url || "home");
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
      finish(sessionNav(), stored.token || null);
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
